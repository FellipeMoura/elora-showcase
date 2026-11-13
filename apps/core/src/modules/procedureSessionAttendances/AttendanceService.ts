import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appointments,
  eq,
  tenants as tenantsTable,
  withTenant,
} from '@elora/db';
import { EVENT_CHANNELS } from '@elora/events-contracts';
import { db } from '../../shared/database/db.js';
import { env } from '../../env.js';
import { eventBus } from '../../shared/eventBus/eventBus.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';
import {
  ensureTreatmentForJourney,
  linkSessionToTreatment,
} from '../../shared/journeys/treatmentLifecycle.js';
import { AttendanceStorage } from '../../shared/storage/AttendanceStorage.js';
import { dayBoundaries, toIsoDateString } from '../../shared/scheduling/timeUtils.js';
import { AttendanceQuery, type SessionInDayRow } from './AttendanceQuery.js';
import type {
  SignAttendanceInput,
  VerifyAttendanceInput,
} from './AttendanceTypes.js';

// Janela do token primário. 48h cobre cliente que demora pra abrir o link
// (recebeu no fim do dia, só viu de manhã) sem ficar pendurando entradas
// vivas indefinidamente.
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

// Janela do sub-token de verify (CPF+nascimento confirmados). Curto porque
// o cliente está com a tela aberta — não precisa atravessar o dia.
const VERIFY_TOKEN_TTL_MS = 15 * 60 * 1000;

// Brute-force trivial em CPF+data: 3 tentativas e o token primário morre.
const MAX_VERIFY_ATTEMPTS = 3;

export interface AttendanceDetailsResult {
  attendanceId: string;
  signedAt: string;
  attendanceDate: string;
  signatureSvg: string;
  photoDataUrl: string;
  signedFromIp: string | null;
  signedUserAgent: string | null;
  cpfConfirmed: boolean;
  birthDateConfirmed: boolean;
  coveredSessions: Array<{
    id: string;
    procedureName: string;
    scheduledAt: string;
    professionalName: string | null;
    appointmentId: string;
  }>;
}

export interface AttendanceLinkResult {
  token: string;
  signUrl: string;
  expiresAt: string;
  attendanceDate: string;
  coveredSessions: Array<{
    id: string;
    procedureName: string;
    scheduledAt: string;
    professionalName: string | null;
    appointmentId: string;
  }>;
  reused: boolean;
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

// HMAC determinístico do verifyToken — calcula a partir do token primário +
// secret do JWT. Não precisa coluna em DB; quem assina precisa ter passado
// pelo verify (que retornou esse hash) E ter o token primário válido.
// Após `consumeToken`, todo o fluxo morre — sub-hash perde sentido.
function deriveVerifyToken(primaryToken: string): string {
  return createHmac('sha256', env.jwt.secret)
    .update(`attendance-verify:${primaryToken}`)
    .digest('hex');
}

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Compara dois sets de UUIDs ignorando ordem.
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function clientLastInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return '';
  return parts
    .slice(1)
    .map((p) => (p[0] ?? '').toUpperCase() + (p.length > 1 ? '.' : ''))
    .join(' ');
}

function clientFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] ?? fullName;
}

// Parse 'data:image/webp;base64,XXX' → { mime, buffer }.
function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/);
  if (!match) {
    throw new AppError('Formato de imagem inválido', 400);
  }
  return {
    mime: match[1]!,
    buffer: Buffer.from(match[2]!, 'base64'),
  };
}

export const AttendanceService = {
  // ========== INTERNO (autenticado) ==========

  generateLink: async (
    tenantId: string,
    appointmentId: string,
    actorUserId: string | null,
    requestOrigin: string | null
  ): Promise<AttendanceLinkResult> => {
    return withTenant(db, tenantId, async (tx) => {
      // Carrega appointment + valida que é procedure
      const [appt] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      if (!appt) throw new AppError('Agendamento não encontrado', 404);
      if (appt.kind !== 'procedure') {
        throw new AppError(
          'Link de presença assinada só se aplica a agendamentos de procedimento',
          409
        );
      }
      if (appt.status === 'cancelled' || appt.status === 'no_show') {
        throw new AppError(
          `Agendamento em status=${appt.status} — não pode gerar link de presença`,
          409
        );
      }

      const { startOfDay } = dayBoundaries(appt.scheduledAt);
      const attendanceDate = toIsoDateString(appt.scheduledAt);

      // Range half-open: [dayStart, dayStart+24h). Mais simples e seguro
      // que usar `endOfDay` (23:59:59.999) — não pega timestamp em 00:00.
      const dayEnd = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const sessionsInDay = await AttendanceQuery.findPendingSessionsForClientDay(
        tx,
        appt.clientId,
        startOfDay,
        dayEnd
      );

      if (sessionsInDay.length === 0) {
        throw new AppError(
          'Não há sessões pendentes para este cliente neste dia',
          409
        );
      }

      const sessionIds = sessionsInDay.map((s) => s.sessionId);

      // Procura token vivo cobrindo o mesmo set → reusa.
      const existing = await AttendanceQuery.findActiveTokenForClientDay(
        tx,
        appt.clientId,
        attendanceDate
      );

      if (existing && sameSet(existing.sessionIds, sessionIds)) {
        logger.info(
          { tenantId, appointmentId, clientId: appt.clientId, attendanceDate },
          'attendance.generateLink.reused'
        );
        return buildResult(
          tenantId,
          existing.token,
          existing.expiresAt,
          attendanceDate,
          sessionsInDay,
          requestOrigin,
          true
        );
      }

      // Set divergente OU sem token: invalida tudo vivo da (client, data)
      // e cria novo.
      if (existing) {
        await AttendanceQuery.consumeTokensForClientDay(
          tx,
          appt.clientId,
          attendanceDate
        );
        logger.info(
          {
            tenantId,
            appointmentId,
            clientId: appt.clientId,
            attendanceDate,
            previousSet: existing.sessionIds,
            newSet: sessionIds,
          },
          'attendance.generateLink.set_changed_reissued'
        );
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      await AttendanceQuery.insertToken(tx, {
        tenantId,
        clientId: appt.clientId,
        token,
        attendanceDate,
        sessionIds,
        expiresAt,
        createdByUserId: actorUserId,
      });

      logger.info(
        {
          tenantId,
          appointmentId,
          clientId: appt.clientId,
          attendanceDate,
          sessionCount: sessionIds.length,
        },
        'attendance.generateLink.created'
      );

      return buildResult(
        tenantId,
        token,
        expiresAt,
        attendanceDate,
        sessionsInDay,
        requestOrigin,
        false
      );
    });
  },

  // Devolve detalhes da assinatura ligada a um appointment. Backend monta
  // SVG inline + foto base64 (objetos pequenos), evitando presigned URLs.
  // Lança 404 se o appointment não tem assinatura registrada (status não
  // necessariamente é `attended`; admins podem ter usado override).
  findForAppointment: async (
    tenantId: string,
    appointmentId: string
  ): Promise<AttendanceDetailsResult> => {
    const head = await withTenant(db, tenantId, (tx) =>
      AttendanceQuery.findAttendanceForAppointment(tx, appointmentId)
    );
    if (!head) {
      throw new AppError(
        'Esse agendamento ainda não tem assinatura de presença registrada',
        404
      );
    }

    // Storage degrade: sem MinIO/R2 configurado, devolve 503 — UI mostra
    // mensagem específica (não é "não encontrado").
    if (!AttendanceStorage.isConfigured) {
      throw new AppError(
        'Storage de assinaturas não está configurado neste ambiente',
        503
      );
    }

    const [signatureBuffer, photoBuffer] = await Promise.all([
      AttendanceStorage.fetchObject(head.signatureObjectKey),
      AttendanceStorage.fetchObject(head.photoObjectKey),
    ]);
    const photoMime = head.photoObjectKey.endsWith('.png')
      ? 'image/png'
      : head.photoObjectKey.endsWith('.jpeg') ||
          head.photoObjectKey.endsWith('.jpg')
        ? 'image/jpeg'
        : 'image/webp';

    return {
      attendanceId: head.attendanceId,
      signedAt: head.signedAt.toISOString(),
      attendanceDate: head.attendanceDate,
      signatureSvg: signatureBuffer.toString('utf-8'),
      photoDataUrl: `data:${photoMime};base64,${photoBuffer.toString('base64')}`,
      signedFromIp: head.signedFromIp,
      signedUserAgent: head.signedUserAgent,
      cpfConfirmed: head.cpfConfirmed,
      birthDateConfirmed: head.birthDateConfirmed,
      coveredSessions: head.coveredSessions.map((s) => ({
        id: s.sessionId,
        procedureName: s.procedureName,
        scheduledAt: s.scheduledAt.toISOString(),
        professionalName: s.professionalName,
        appointmentId: s.appointmentId,
      })),
    };
  },

  // ========== PÚBLICO (sem auth, alcançado via signUrl) ==========

  getPublicPreview: async (
    token: string
  ): Promise<{
    clientFirstName: string;
    clientLastInitial: string;
    clinicName: string;
    attendanceDate: string;
    procedures: Array<{
      name: string;
      scheduledAt: string;
      professionalName: string | null;
    }>;
    expiresAt: string;
  }> => {
    const tenantRow = await AttendanceQuery.findTenantByToken(db, token);
    if (!tenantRow) throw new AppError('Link inválido', 404);

    return withTenant(db, tenantRow.tenantId, async (tx) => {
      const row = await AttendanceQuery.loadTokenForPreview(tx, token);
      if (!row) throw new AppError('Link inválido', 404);
      if (row.consumedAt) throw new AppError('Link já foi utilizado', 410);
      if (row.expiresAt.getTime() < Date.now()) {
        throw new AppError('Link expirado', 410);
      }
      const [tenant] = await db
        .select({ name: tenantsTable.name, tradeName: tenantsTable.tradeName })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, tenantRow.tenantId))
        .limit(1);

      return {
        clientFirstName: clientFirstName(row.clientName),
        clientLastInitial: clientLastInitial(row.clientName),
        clinicName: tenant?.tradeName || tenant?.name || 'Clínica',
        attendanceDate: row.attendanceDate,
        procedures: row.procedures.map((p) => ({
          name: p.procedureName,
          scheduledAt: p.scheduledAt.toISOString(),
          professionalName: p.professionalName,
        })),
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  },

  verify: async (
    token: string,
    input: VerifyAttendanceInput
  ): Promise<{ verifyToken: string; expiresAt: string }> => {
    const tenantRow = await AttendanceQuery.findTenantByToken(db, token);
    if (!tenantRow) throw new AppError('Link inválido', 404);

    return withTenant(db, tenantRow.tenantId, async (tx) => {
      const row = await AttendanceQuery.loadTokenForPreview(tx, token);
      if (!row) throw new AppError('Link inválido', 404);
      if (row.consumedAt) throw new AppError('Link já foi utilizado', 410);
      if (row.expiresAt.getTime() < Date.now()) {
        throw new AppError('Link expirado', 410);
      }
      if (row.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
        await AttendanceQuery.consumeToken(tx, row.tokenId);
        throw new AppError(
          'Limite de tentativas excedido — link invalidado',
          410
        );
      }

      const providedDocument = normalizeDigits(input.document);
      const expectedDocument = row.clientDocument
        ? normalizeDigits(row.clientDocument)
        : '';

      // birth_date no DB vem como string 'YYYY-MM-DD' (date column).
      const expectedBirth = row.clientBirthDate ?? '';

      const docOk =
        expectedDocument.length > 0 && safeStringEqual(providedDocument, expectedDocument);
      const birthOk = expectedBirth.length > 0 && safeStringEqual(input.birthDate, expectedBirth);

      if (!docOk || !birthOk) {
        const newAttempts = await AttendanceQuery.incrementVerifyAttempts(
          tx,
          row.tokenId
        );
        logger.warn(
          { tenantId: tenantRow.tenantId, attempts: newAttempts, docOk, birthOk },
          'attendance.verify.failed'
        );
        if (newAttempts >= MAX_VERIFY_ATTEMPTS) {
          await AttendanceQuery.consumeToken(tx, row.tokenId);
          throw new AppError(
            'Limite de tentativas excedido — link invalidado',
            410
          );
        }
        throw new AppError('CPF ou data de nascimento incorretos', 401);
      }

      const verifyToken = deriveVerifyToken(token);
      return {
        verifyToken,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString(),
      };
    });
  },

  sign: async (
    token: string,
    verifyToken: string,
    input: SignAttendanceInput,
    requestMeta: { ip: string | null; userAgent: string | null }
  ): Promise<{
    attendanceId: string;
    signedAt: string;
    coveredSessionIds: string[];
  }> => {
    // Valida sub-token ANTES de tocar no banco.
    const expectedVerify = deriveVerifyToken(token);
    if (!safeStringEqual(verifyToken, expectedVerify)) {
      throw new AppError('Verificação inválida — refaça o passo anterior', 401);
    }

    const tenantRow = await AttendanceQuery.findTenantByToken(db, token);
    if (!tenantRow) throw new AppError('Link inválido', 404);

    // Decodifica imagens FORA da tx — operação CPU/IO independente do DB.
    const { mime, buffer: photoBuffer } = decodeDataUrl(input.photoDataUrl);

    // Pre-check estado do token (sem reservar nada). Confirmação final
    // acontece dentro da tx — aqui é só pra falhar rápido antes do upload.
    const preview = await withTenant(db, tenantRow.tenantId, (tx) =>
      AttendanceQuery.loadTokenForPreview(tx, token)
    );
    if (!preview) throw new AppError('Link inválido', 404);
    if (preview.consumedAt) throw new AppError('Link já foi utilizado', 410);
    if (preview.expiresAt.getTime() < Date.now()) {
      throw new AppError('Link expirado', 410);
    }

    // Faz upload FORA da tx (S3 pode demorar). Em caso de erro depois,
    // os objetos ficam órfãos — limpeza periódica é cron futuro.
    // Geramos um attendanceId-placeholder pro path; depois a row recebe
    // este mesmo ID.
    const placeholderAttendanceId = createHash('sha256')
      .update(`${token}:${Date.now()}`)
      .digest('hex')
      .slice(0, 32);

    const signatureKey = await AttendanceStorage.persistSignature(
      tenantRow.tenantId,
      placeholderAttendanceId,
      input.signatureSvg
    );
    let photoKey: string;
    try {
      photoKey = await AttendanceStorage.persistPhoto(
        tenantRow.tenantId,
        placeholderAttendanceId,
        photoBuffer,
        mime
      );
    } catch (err) {
      await AttendanceStorage.deleteObjectQuiet(signatureKey);
      throw err;
    }

    // Agora persiste no DB dentro de uma única tx.
    try {
      const result = await withTenant(db, tenantRow.tenantId, async (tx) => {
        // Re-check estado pra evitar race (outro sign passou nesse meio).
        const fresh = await AttendanceQuery.loadTokenForPreview(tx, token);
        if (!fresh) throw new AppError('Link inválido', 404);
        if (fresh.consumedAt) throw new AppError('Link já foi utilizado', 410);

        const attendance = await AttendanceQuery.insertAttendance(tx, {
          tenantId: tenantRow.tenantId,
          clientId: fresh.clientId,
          attendanceDate: fresh.attendanceDate,
          signatureObjectKey: signatureKey,
          photoObjectKey: photoKey,
          signedFromIp: requestMeta.ip,
          signedUserAgent: requestMeta.userAgent,
        });

        await AttendanceQuery.linkSessionsToAttendance(
          tx,
          tenantRow.tenantId,
          attendance.id,
          fresh.sessionIds
        );

        const signedSessionIds = await AttendanceQuery.markSessionsSigned(
          tx,
          fresh.sessionIds
        );

        await AttendanceQuery.markAppointmentsAttendedForSessions(
          tx,
          fresh.sessionIds
        );

        await AttendanceQuery.consumeToken(tx, fresh.tokenId);

        // Garantir treatment ativo + linkar sessões (mantém cascata clínica
        // que antes vivia em attend()). Faz por journey de cada appointment.
        const apptRows = await tx
          .select({
            journeyId: appointments.journeyId,
            sessionId: appointments.procedureSessionId,
          })
          .from(appointments)
          .where(eq(appointments.clientId, fresh.clientId));
        const journeyToSessions = new Map<string, string[]>();
        for (const r of apptRows) {
          if (!r.sessionId || !fresh.sessionIds.includes(r.sessionId)) continue;
          const list = journeyToSessions.get(r.journeyId) ?? [];
          list.push(r.sessionId);
          journeyToSessions.set(r.journeyId, list);
        }
        for (const [journeyId, sessionsForJourney] of journeyToSessions) {
          const ensure = await ensureTreatmentForJourney(
            tx,
            {
              tenantId: tenantRow.tenantId,
              journeyId,
              clientId: fresh.clientId,
            },
            null
          );
          for (const sessionId of sessionsForJourney) {
            await linkSessionToTreatment(
              tx,
              tenantRow.tenantId,
              ensure.treatmentId,
              sessionId
            );
          }
        }

        return {
          attendanceId: attendance.id,
          signedAt: attendance.signedAt,
          signedSessionIds,
          clientId: fresh.clientId,
          attendanceDate: fresh.attendanceDate,
        };
      });

      // Evento — best-effort, fora da tx.
      await eventBus.publish(
        EVENT_CHANNELS.procedureSessionAttendanceRecorded,
        {
          tenantId: tenantRow.tenantId,
          attendanceId: result.attendanceId,
          clientId: result.clientId,
          attendanceDate: result.attendanceDate,
          signedSessionIds: result.signedSessionIds,
          signedAt: result.signedAt.toISOString(),
        }
      );

      logger.info(
        {
          tenantId: tenantRow.tenantId,
          attendanceId: result.attendanceId,
          sessionCount: result.signedSessionIds.length,
        },
        'attendance.sign.recorded'
      );

      return {
        attendanceId: result.attendanceId,
        signedAt: result.signedAt.toISOString(),
        coveredSessionIds: result.signedSessionIds,
      };
    } catch (err) {
      // Rollback do storage só se a tx falhou. Se foi sucesso e o evento
      // depois falhou, os objetos ficam — assinatura está válida.
      await AttendanceStorage.deleteObjectQuiet(signatureKey);
      await AttendanceStorage.deleteObjectQuiet(photoKey);
      throw err;
    }
  },
};

function buildResult(
  _tenantId: string,
  token: string,
  expiresAt: Date,
  attendanceDate: string,
  sessionsInDay: SessionInDayRow[],
  requestOrigin: string | null,
  reused: boolean
): AttendanceLinkResult {
  // URL pública: usa o Origin da request (frontend) quando disponível.
  // Em fallback (chamada de teste sem Origin), monta com host vazio — caller
  // deve tratar como erro de config se quiser garantia.
  const baseUrl = requestOrigin ?? '';
  return {
    token,
    signUrl: `${baseUrl}/sessoes/assinar/${token}`,
    expiresAt: expiresAt.toISOString(),
    attendanceDate,
    coveredSessions: sessionsInDay.map((s) => ({
      id: s.sessionId,
      procedureName: s.procedureName,
      scheduledAt: s.scheduledAt.toISOString(),
      professionalName: s.professionalName,
      appointmentId: s.appointmentId,
    })),
    reused,
  };
}

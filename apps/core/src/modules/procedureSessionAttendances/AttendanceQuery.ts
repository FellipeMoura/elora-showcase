import {
  and,
  appointments,
  clients,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  procedureSessionAttendanceSessions,
  procedureSessionAttendances,
  procedureSessionSigningTokens,
  procedureSessions,
  procedures,
  sql,
  users,
  type Db,
  type Tx,
} from '@elora/db';

// =====================================================================
// Queries da presença assinada. Service usa estas helpers pra orquestrar
// a transação (read + write) sem espalhar SQL.
// =====================================================================

export interface SessionInDayRow {
  sessionId: string;
  appointmentId: string;
  scheduledAt: Date;
  procedureName: string;
  professionalName: string | null;
}

export const AttendanceQuery = {
  // Lista todas as sessões pending do cliente naquele dia (range half-open)
  // que estão ligadas a um appointment não-terminal. Ordenado por horário.
  findPendingSessionsForClientDay: async (
    tx: Tx,
    clientId: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<SessionInDayRow[]> => {
    const rows = await tx
      .select({
        sessionId: procedureSessions.id,
        appointmentId: appointments.id,
        scheduledAt: appointments.scheduledAt,
        procedureName: procedures.name,
        professionalName: users.name,
      })
      .from(appointments)
      .innerJoin(
        procedureSessions,
        eq(procedureSessions.id, appointments.procedureSessionId)
      )
      .innerJoin(procedures, eq(procedures.id, procedureSessions.procedureId))
      .leftJoin(users, eq(users.id, appointments.professionalId))
      .where(
        and(
          eq(appointments.kind, 'procedure'),
          eq(appointments.clientId, clientId),
          eq(procedureSessions.status, 'pending'),
          sql`${appointments.status} NOT IN ('cancelled', 'no_show', 'attended')`,
          gte(appointments.scheduledAt, dayStart),
          lt(appointments.scheduledAt, dayEnd)
        )
      )
      .orderBy(appointments.scheduledAt);
    return rows;
  },

  // Procura token vivo pra (cliente, data) e devolve. Vivo = sem consume +
  // expires no futuro. Usado pra reusar o mesmo link em re-emissões.
  findActiveTokenForClientDay: async (
    tx: Tx,
    clientId: string,
    attendanceDate: string
  ): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
    sessionIds: string[];
  } | undefined> => {
    const [row] = await tx
      .select({
        id: procedureSessionSigningTokens.id,
        token: procedureSessionSigningTokens.token,
        expiresAt: procedureSessionSigningTokens.expiresAt,
        sessionIds: procedureSessionSigningTokens.sessionIds,
      })
      .from(procedureSessionSigningTokens)
      .where(
        and(
          eq(procedureSessionSigningTokens.clientId, clientId),
          eq(
            procedureSessionSigningTokens.attendanceDate,
            attendanceDate
          ),
          isNull(procedureSessionSigningTokens.consumedAt),
          sql`${procedureSessionSigningTokens.expiresAt} > NOW()`
        )
      )
      .limit(1);
    return row;
  },

  insertToken: async (
    tx: Tx,
    input: {
      tenantId: string;
      clientId: string;
      token: string;
      attendanceDate: string;
      sessionIds: string[];
      expiresAt: Date;
      createdByUserId: string | null;
    }
  ): Promise<{ id: string }> => {
    const [row] = await tx
      .insert(procedureSessionSigningTokens)
      .values({
        tenantId: input.tenantId,
        clientId: input.clientId,
        token: input.token,
        attendanceDate: input.attendanceDate,
        sessionIds: input.sessionIds,
        expiresAt: input.expiresAt,
        createdByUserId: input.createdByUserId,
      })
      .returning({ id: procedureSessionSigningTokens.id });
    if (!row) throw new Error('Falha ao gravar token');
    return row;
  },

  // Invalida tokens vivos antigos do (cliente, data) ANTES de gravar novo
  // quando o set de sessões mudou. Mantém só 1 vivo por (cliente, data).
  consumeTokensForClientDay: async (
    tx: Tx,
    clientId: string,
    attendanceDate: string
  ): Promise<number> => {
    const updated = await tx
      .update(procedureSessionSigningTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(procedureSessionSigningTokens.clientId, clientId),
          eq(
            procedureSessionSigningTokens.attendanceDate,
            attendanceDate
          ),
          isNull(procedureSessionSigningTokens.consumedAt)
        )
      )
      .returning({ id: procedureSessionSigningTokens.id });
    return updated.length;
  },

  // Resolve tenant a partir do token. Como a rota pública NÃO passa por
  // tenantContextMiddleware, este lookup precisa rodar via `db` global
  // (sem RLS) — tokens estão isolados por token único, sem risco de
  // vazamento cross-tenant. Aceita Db (global) ou Tx (dentro de withTenant).
  findTenantByToken: async (
    handle: Db | Tx,
    token: string
  ): Promise<{ tenantId: string } | undefined> => {
    const [row] = await handle
      .select({ tenantId: procedureSessionSigningTokens.tenantId })
      .from(procedureSessionSigningTokens)
      .where(eq(procedureSessionSigningTokens.token, token))
      .limit(1);
    return row;
  },

  // Carrega token + dados públicos do cliente/clínica/procedimentos cobertos
  // pra a tela de preview. Tx já tem RLS aplicada via withTenant.
  loadTokenForPreview: async (
    tx: Tx,
    token: string
  ): Promise<
    | {
        tokenId: string;
        clientId: string;
        clientName: string;
        clientDocument: string | null;
        clientBirthDate: string | null;
        attendanceDate: string;
        sessionIds: string[];
        expiresAt: Date;
        consumedAt: Date | null;
        verifyAttempts: number;
        procedures: SessionInDayRow[];
      }
    | undefined
  > => {
    const [row] = await tx
      .select({
        tokenId: procedureSessionSigningTokens.id,
        clientId: procedureSessionSigningTokens.clientId,
        clientName: clients.name,
        clientDocument: clients.document,
        clientBirthDate: clients.birthDate,
        attendanceDate: procedureSessionSigningTokens.attendanceDate,
        sessionIds: procedureSessionSigningTokens.sessionIds,
        expiresAt: procedureSessionSigningTokens.expiresAt,
        consumedAt: procedureSessionSigningTokens.consumedAt,
        verifyAttempts: procedureSessionSigningTokens.verifyAttempts,
      })
      .from(procedureSessionSigningTokens)
      .innerJoin(
        clients,
        eq(clients.id, procedureSessionSigningTokens.clientId)
      )
      .where(eq(procedureSessionSigningTokens.token, token))
      .limit(1);
    if (!row) return undefined;
    const procs = row.sessionIds.length
      ? await tx
          .select({
            sessionId: procedureSessions.id,
            appointmentId: appointments.id,
            scheduledAt: appointments.scheduledAt,
            procedureName: procedures.name,
            professionalName: users.name,
          })
          .from(procedureSessions)
          .innerJoin(
            procedures,
            eq(procedures.id, procedureSessions.procedureId)
          )
          .innerJoin(
            appointments,
            eq(appointments.procedureSessionId, procedureSessions.id)
          )
          .leftJoin(users, eq(users.id, appointments.professionalId))
          .where(inArray(procedureSessions.id, row.sessionIds))
          .orderBy(appointments.scheduledAt)
      : [];
    return { ...row, procedures: procs };
  },

  incrementVerifyAttempts: async (
    tx: Tx,
    tokenId: string
  ): Promise<number> => {
    const [row] = await tx
      .update(procedureSessionSigningTokens)
      .set({
        verifyAttempts: sql`${procedureSessionSigningTokens.verifyAttempts} + 1`,
      })
      .where(eq(procedureSessionSigningTokens.id, tokenId))
      .returning({
        attempts: procedureSessionSigningTokens.verifyAttempts,
      });
    return row?.attempts ?? 0;
  },

  consumeToken: async (tx: Tx, tokenId: string): Promise<void> => {
    await tx
      .update(procedureSessionSigningTokens)
      .set({ consumedAt: new Date() })
      .where(eq(procedureSessionSigningTokens.id, tokenId));
  },

  insertAttendance: async (
    tx: Tx,
    input: {
      tenantId: string;
      clientId: string;
      attendanceDate: string;
      signatureObjectKey: string;
      photoObjectKey: string;
      signedFromIp: string | null;
      signedUserAgent: string | null;
    }
  ): Promise<{ id: string; signedAt: Date }> => {
    const [row] = await tx
      .insert(procedureSessionAttendances)
      .values({
        tenantId: input.tenantId,
        clientId: input.clientId,
        attendanceDate: input.attendanceDate,
        signatureObjectKey: input.signatureObjectKey,
        photoObjectKey: input.photoObjectKey,
        signedFromIp: input.signedFromIp,
        signedUserAgent: input.signedUserAgent,
        cpfConfirmed: true,
        birthDateConfirmed: true,
      })
      .returning({
        id: procedureSessionAttendances.id,
        signedAt: procedureSessionAttendances.signedAt,
      });
    if (!row) throw new Error('Falha ao inserir attendance');
    return row;
  },

  linkSessionsToAttendance: async (
    tx: Tx,
    tenantId: string,
    attendanceId: string,
    sessionIds: string[]
  ): Promise<void> => {
    if (sessionIds.length === 0) return;
    await tx.insert(procedureSessionAttendanceSessions).values(
      sessionIds.map((sessionId) => ({
        tenantId,
        attendanceId,
        sessionId,
      }))
    );
  },

  // Marca sessões como signed (não done — done é evolução). Idempotente:
  // só atualiza linhas que ainda estão pending. Sessões em signed/done/cancelled
  // são preservadas — qualquer divergência é caso de uso indevido (token
  // antigo cobrindo sessão que já foi assinada por outro caminho).
  markSessionsSigned: async (
    tx: Tx,
    sessionIds: string[]
  ): Promise<string[]> => {
    if (sessionIds.length === 0) return [];
    const updated = await tx
      .update(procedureSessions)
      .set({ status: 'signed' })
      .where(
        and(
          inArray(procedureSessions.id, sessionIds),
          eq(procedureSessions.status, 'pending')
        )
      )
      .returning({ id: procedureSessions.id });
    return updated.map((r) => r.id);
  },

  // Marca appointments como attended pra sessões que viraram signed.
  markAppointmentsAttendedForSessions: async (
    tx: Tx,
    sessionIds: string[]
  ): Promise<void> => {
    if (sessionIds.length === 0) return;
    await tx
      .update(appointments)
      .set({ status: 'attended' })
      .where(
        and(
          inArray(appointments.procedureSessionId, sessionIds),
          sql`${appointments.status} NOT IN ('cancelled', 'no_show', 'attended')`
        )
      );
  },

  // Resolve attendance a partir de um appointment id.
  // Path: appointment → procedure_session_id → procedure_session_attendance_sessions → procedure_session_attendances.
  // Devolve undefined se o appointment não é procedure, não tem session,
  // ou se a session ainda não tem assinatura registrada.
  findAttendanceForAppointment: async (
    tx: Tx,
    appointmentId: string
  ): Promise<
    | {
        attendanceId: string;
        signedAt: Date;
        attendanceDate: string;
        signatureObjectKey: string;
        photoObjectKey: string;
        signedFromIp: string | null;
        signedUserAgent: string | null;
        cpfConfirmed: boolean;
        birthDateConfirmed: boolean;
        coveredSessions: SessionInDayRow[];
      }
    | undefined
  > => {
    const [head] = await tx
      .select({
        attendanceId: procedureSessionAttendances.id,
        signedAt: procedureSessionAttendances.signedAt,
        attendanceDate: procedureSessionAttendances.attendanceDate,
        signatureObjectKey: procedureSessionAttendances.signatureObjectKey,
        photoObjectKey: procedureSessionAttendances.photoObjectKey,
        signedFromIp: procedureSessionAttendances.signedFromIp,
        signedUserAgent: procedureSessionAttendances.signedUserAgent,
        cpfConfirmed: procedureSessionAttendances.cpfConfirmed,
        birthDateConfirmed: procedureSessionAttendances.birthDateConfirmed,
      })
      .from(appointments)
      .innerJoin(
        procedureSessionAttendanceSessions,
        eq(
          procedureSessionAttendanceSessions.sessionId,
          appointments.procedureSessionId
        )
      )
      .innerJoin(
        procedureSessionAttendances,
        eq(
          procedureSessionAttendances.id,
          procedureSessionAttendanceSessions.attendanceId
        )
      )
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    if (!head) return undefined;

    // Carrega todas as sessões cobertas pela mesma assinatura (não só a
    // do appointment de entrada — a UX é "esta assinatura cobre X procedimentos").
    const covered = await tx
      .select({
        sessionId: procedureSessions.id,
        appointmentId: appointments.id,
        scheduledAt: appointments.scheduledAt,
        procedureName: procedures.name,
        professionalName: users.name,
      })
      .from(procedureSessionAttendanceSessions)
      .innerJoin(
        procedureSessions,
        eq(procedureSessions.id, procedureSessionAttendanceSessions.sessionId)
      )
      .innerJoin(procedures, eq(procedures.id, procedureSessions.procedureId))
      .innerJoin(
        appointments,
        eq(appointments.procedureSessionId, procedureSessions.id)
      )
      .leftJoin(users, eq(users.id, appointments.professionalId))
      .where(
        eq(
          procedureSessionAttendanceSessions.attendanceId,
          head.attendanceId
        )
      )
      .orderBy(appointments.scheduledAt);

    return { ...head, coveredSessions: covered };
  },
};

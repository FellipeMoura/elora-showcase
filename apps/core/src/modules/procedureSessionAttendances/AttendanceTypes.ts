import {
  procedureSessionAttendances,
  type InferSelectModel,
} from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type AttendanceRecord = InferSelectModel<
  typeof procedureSessionAttendances
>;

// =====================================================================
// Schemas Zod do módulo de presença assinada.
//
// Dois grupos de schemas:
//  1. Internos (autenticados) — gerar link, consultar histórico, revogar.
//  2. Públicos (sem JWT) — endpoints que o cliente atinge via signUrl,
//     verificar CPF/nascimento, submeter foto + assinatura.
// =====================================================================

// ---- Internos ----

export const appointmentIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

// Devolvida pelo GET /appointments/:id/attendance — usada pela UI
// "Ver assinatura" no popover de agendamentos kind=procedure já atendidos.
// SVG inline (texto leve, ~2-8KB) + foto como data URL base64 (~30-100KB)
// — total cabe num único request, sem precisar de presigned URLs separadas.
export const attendanceDetailsResponseSchema = z
  .object({
    attendanceId: z.string().uuid(),
    signedAt: z.string().datetime(),
    attendanceDate: z.string(),
    signatureSvg: z.string(),
    photoDataUrl: z.string(),
    signedFromIp: z.string().nullable(),
    signedUserAgent: z.string().nullable(),
    cpfConfirmed: z.boolean(),
    birthDateConfirmed: z.boolean(),
    coveredSessions: z.array(
      z.object({
        id: z.string().uuid(),
        procedureName: z.string(),
        scheduledAt: z.string().datetime(),
        professionalName: z.string().nullable(),
        appointmentId: z.string().uuid(),
      })
    ),
  })
  .openapi('SessionAttendanceDetails');

export const attendanceLinkResponseSchema = z
  .object({
    token: z.string(),
    signUrl: z.string().url(),
    expiresAt: z.string().datetime(),
    attendanceDate: z.string(),
    coveredSessions: z.array(
      z.object({
        id: z.string().uuid(),
        procedureName: z.string(),
        scheduledAt: z.string().datetime(),
        professionalName: z.string().nullable(),
        appointmentId: z.string().uuid(),
      })
    ),
    // Quando true, este token foi reutilizado de uma emissão anterior viva
    // pro mesmo (cliente, data, set de sessões). UI pode informar "link já
    // existia" em vez de "novo link gerado".
    reused: z.boolean(),
  })
  .openapi('SessionAttendanceLink');

// ---- Públicos (sem auth, alcançados via signUrl) ----

export const publicTokenParamSchema = z.object({
  token: z
    .string()
    .min(32, 'Token inválido')
    .max(128, 'Token inválido')
    .regex(/^[a-f0-9]+$/i, 'Token inválido'),
});

export const publicAttendancePreviewResponseSchema = z
  .object({
    clientFirstName: z.string(),
    // Iniciais do(s) sobrenome(s) — UX de privacidade enquanto não verifica.
    // Ex: "Maria S.S.". Após verify, frontend pode exibir nome completo se
    // quiser (não exposto por este endpoint pra evitar enumeração).
    clientLastInitial: z.string(),
    clinicName: z.string(),
    attendanceDate: z.string(),
    procedures: z.array(
      z.object({
        name: z.string(),
        scheduledAt: z.string().datetime(),
        professionalName: z.string().nullable(),
      })
    ),
    expiresAt: z.string().datetime(),
  })
  .openapi('PublicAttendancePreview');

export const verifyAttendanceBodySchema = z
  .object({
    // Aceita CPF com ou sem máscara — service normaliza pra dígitos antes
    // de comparar com clients.document (que guarda só dígitos).
    document: z
      .string()
      .trim()
      .min(11, 'CPF inválido')
      .max(20, 'CPF inválido'),
    // Formato ISO date (YYYY-MM-DD) — frontend envia direto do <input type=date>.
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de nascimento inválida'),
  })
  .openapi('VerifyAttendanceInput');

export const verifyAttendanceResponseSchema = z
  .object({
    // Sub-token JWT curto (10min) emitido após verify OK. Frontend coloca
    // no header Authorization da chamada de sign — backend valida ambos.
    verifyToken: z.string(),
    expiresAt: z.string().datetime(),
  })
  .openapi('VerifyAttendanceResponse');

export const signAttendanceBodySchema = z
  .object({
    // Assinatura como SVG completo (string). Limite generoso pra não rejeitar
    // assinaturas detalhadas, mas ainda barrar payload abusivo.
    signatureSvg: z
      .string()
      .min(20, 'Assinatura vazia')
      .max(200_000, 'Assinatura muito grande'),
    // Foto como base64 data URL (data:image/webp;base64,...). Aceita PNG
    // como fallback de navegador velho.
    photoDataUrl: z
      .string()
      .min(100, 'Foto vazia')
      .max(1_500_000, 'Foto muito grande (limite ~1MB base64 = ~750KB binário)')
      .regex(/^data:image\/(webp|png|jpeg);base64,/, 'Formato de foto inválido'),
  })
  .openapi('SignAttendanceInput');

export const signAttendanceResponseSchema = z
  .object({
    attendanceId: z.string().uuid(),
    signedAt: z.string().datetime(),
    coveredSessionIds: z.array(z.string().uuid()),
  })
  .openapi('SignAttendanceResponse');

// Tipo inferido pros service inputs.
export type VerifyAttendanceInput = z.infer<typeof verifyAttendanceBodySchema>;
export type SignAttendanceInput = z.infer<typeof signAttendanceBodySchema>;

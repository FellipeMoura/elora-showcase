import {
  and,
  appointments,
  eq,
  gt,
  gte,
  lt,
  lte,
  ne,
  professionalSchedules,
  scheduleExceptions,
  sql,
  type Tx,
} from '@elora/db';
import { AppError } from '../errors/AppError.js';
import { combineDateAndTime, toIsoDateString, weekdayOf } from './timeUtils.js';

// =====================================================================
// validateAppointmentSlot — checagem completa antes de agendar.
//
// Lança AppError 409 com mensagem específica se:
//   - Profissional não tem horário definido nesse dia da semana
//   - Horário cai fora da janela de trabalho
//   - Há outro appointment ativo do mesmo profissional sobrepondo
//   - Há schedule_exception ativa (férias, atestado, etc.) no período
//
// Chamado pelo AppointmentsService.create (e .update se houver mudança
// de scheduledAt/professionalId/durationMinutes). Se `professionalId` é
// null, valida nada — appointments sem profissional não têm gate de
// disponibilidade (cenário raro, mas schema permite).
// =====================================================================

export interface ValidateSlotInput {
  userId: string;
  scheduledAt: Date;
  durationMinutes: number;
  // Quando atualizando um appointment existente, passa o ID pra ignorar
  // conflito com ele próprio.
  skipAppointmentId?: string;
}

export async function validateAppointmentSlot(
  tx: Tx,
  input: ValidateSlotInput
): Promise<void> {
  const start = input.scheduledAt;
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const dow = weekdayOf(start);
  const isoDateStr = toIsoDateString(start);

  // 1. Janela de trabalho
  const schedules = await tx
    .select({
      startTime: professionalSchedules.startTime,
      endTime: professionalSchedules.endTime,
    })
    .from(professionalSchedules)
    .where(
      and(
        eq(professionalSchedules.userId, input.userId),
        eq(professionalSchedules.dayOfWeek, dow),
        lte(professionalSchedules.effectiveFrom, isoDateStr),
        sql`(${professionalSchedules.effectiveTo} IS NULL OR ${professionalSchedules.effectiveTo} >= ${isoDateStr})`
      )
    );
  if (schedules.length === 0) {
    throw new AppError(
      'Profissional sem horário definido neste dia da semana',
      409
    );
  }

  const fitsInWindow = schedules.some((s) => {
    const windowStart = combineDateAndTime(start, s.startTime);
    const windowEnd = combineDateAndTime(start, s.endTime);
    return start >= windowStart && end <= windowEnd;
  });
  if (!fitsInWindow) {
    throw new AppError(
      'Horário fora da janela de trabalho do profissional',
      409
    );
  }

  // 2. Conflitos com outros appointments ativos.
  //
  // Overlap check é feito em JS depois de buscar candidatos do mesmo dia.
  // Versão anterior calculava `(scheduled_at + duration * INTERVAL '1 minute') > $start`
  // via `sql\`...\`` template, mas tinha bug de TZ: `lt(col, date)` (Drizzle
  // operator) serializa Date com mapper da coluna (UTC components sem Z),
  // enquanto `sql\`... > ${date}\`` interpola Date como ISO com Z. Quando a
  // session TZ do Postgres não é UTC, Pg trata o lado direito como timestamptz,
  // faz cast implícito do timestamp-sem-TZ da esquerda usando session TZ, e o
  // resultado fica deslocado — disparava conflito entre 08:30-09:00 e 10:00-10:30.
  // Comparação em JS com Dates já em UTC elimina a assimetria.
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const candidates = await tx
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      durationMinutes: appointments.durationMinutes,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.professionalId, input.userId),
        sql`${appointments.status} NOT IN ('cancelled', 'no_show')`,
        gte(appointments.scheduledAt, dayStart),
        lte(appointments.scheduledAt, dayEnd),
        input.skipAppointmentId
          ? ne(appointments.id, input.skipAppointmentId)
          : undefined
      )
    );

  const conflict = candidates.find((c) => {
    const existingStart = c.scheduledAt;
    const existingEnd = new Date(
      existingStart.getTime() + c.durationMinutes * 60_000
    );
    return existingStart < end && existingEnd > start;
  });
  if (conflict) {
    throw new AppError(
      'Conflito com outro agendamento do mesmo profissional',
      409,
      { conflictAppointmentId: conflict.id }
    );
  }

  // 3. Exceções (férias, treinamento, etc.)
  const [exception] = await tx
    .select({
      id: scheduleExceptions.id,
      kind: scheduleExceptions.kind,
    })
    .from(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.userId, input.userId),
        lt(scheduleExceptions.startAt, end),
        gt(scheduleExceptions.endAt, start)
      )
    )
    .limit(1);
  if (exception) {
    throw new AppError(
      `Profissional indisponível neste período (${exception.kind})`,
      409,
      { exceptionId: exception.id, kind: exception.kind }
    );
  }
}

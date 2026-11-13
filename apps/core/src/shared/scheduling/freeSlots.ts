import {
  and,
  appointments,
  eq,
  gt,
  gte,
  lt,
  lte,
  professionalSchedules,
  scheduleExceptions,
  sql,
  type Tx,
} from '@elora/db';
import {
  combineDateAndTime,
  dayBoundaries,
  toIsoDateString,
  weekdayOf,
} from './timeUtils.js';

// =====================================================================
// computeFreeSlots — calcula slots livres pra (professional, dia, duração).
//
// Algoritmo:
//   1. Working windows: linhas de professional_schedules pra (user, dow,
//      vigentes na data).
//   2. Blocked: appointments ativos (status != cancelled/no_show) do user
//      naquele dia.
//   3. Excepted: schedule_exceptions cobrindo o dia.
//   4. Subtrai (2)+(3) dos intervals de (1).
//   5. Quebra cada interval restante em slots de N minutos.
//
// Output ordenado por startAt asc.
// =====================================================================

export interface FreeSlotsInput {
  userId: string;
  date: Date;
  durationMinutes: number;
}

export interface FreeSlot {
  startAt: Date;
  endAt: Date;
}

interface Interval {
  startAt: Date;
  endAt: Date;
}

export async function computeFreeSlots(
  tx: Tx,
  input: FreeSlotsInput
): Promise<FreeSlot[]> {
  if (input.durationMinutes <= 0) return [];

  const { startOfDay, endOfDay } = dayBoundaries(input.date);
  const isoDateStr = toIsoDateString(input.date);
  const dow = weekdayOf(input.date);

  // 1. Working windows
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
  if (schedules.length === 0) return [];

  // 2. Blocked appointments
  const blocked = await tx
    .select({
      scheduledAt: appointments.scheduledAt,
      durationMinutes: appointments.durationMinutes,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.professionalId, input.userId),
        gte(appointments.scheduledAt, startOfDay),
        lte(appointments.scheduledAt, endOfDay),
        sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
      )
    );

  // 3. Exceptions covering this day (range overlap)
  const exceptions = await tx
    .select({
      startAt: scheduleExceptions.startAt,
      endAt: scheduleExceptions.endAt,
    })
    .from(scheduleExceptions)
    .where(
      and(
        eq(scheduleExceptions.userId, input.userId),
        lt(scheduleExceptions.startAt, endOfDay),
        gt(scheduleExceptions.endAt, startOfDay)
      )
    );

  // Inicia working intervals a partir das schedules.
  let intervals: Interval[] = schedules.map((s) => ({
    startAt: combineDateAndTime(input.date, s.startTime),
    endAt: combineDateAndTime(input.date, s.endTime),
  }));

  // Subtrai blocked.
  for (const b of blocked) {
    const blockEnd = new Date(
      b.scheduledAt.getTime() + b.durationMinutes * 60_000
    );
    intervals = subtractRange(intervals, b.scheduledAt, blockEnd);
  }
  // Subtrai exceções.
  for (const e of exceptions) {
    intervals = subtractRange(intervals, e.startAt, e.endAt);
  }

  // Quebra em slots de N minutos.
  const stepMs = input.durationMinutes * 60_000;
  const slots: FreeSlot[] = [];
  for (const iv of intervals) {
    let cursor = iv.startAt.getTime();
    const limit = iv.endAt.getTime();
    while (cursor + stepMs <= limit) {
      slots.push({
        startAt: new Date(cursor),
        endAt: new Date(cursor + stepMs),
      });
      cursor += stepMs;
    }
  }
  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return slots;
}

// Subtrai [blockStart, blockEnd) de uma lista de intervals, retornando a
// nova lista (intervals podem ser quebrados em 2 se o bloqueio cair no meio).
function subtractRange(
  intervals: Interval[],
  blockStart: Date,
  blockEnd: Date
): Interval[] {
  const out: Interval[] = [];
  for (const iv of intervals) {
    // Sem sobreposição.
    if (blockEnd <= iv.startAt || blockStart >= iv.endAt) {
      out.push(iv);
      continue;
    }
    // Bloqueio cobre interval inteiro.
    if (blockStart <= iv.startAt && blockEnd >= iv.endAt) {
      continue;
    }
    // Bloqueio no meio — quebra em 2.
    if (blockStart > iv.startAt && blockEnd < iv.endAt) {
      out.push({ startAt: iv.startAt, endAt: blockStart });
      out.push({ startAt: blockEnd, endAt: iv.endAt });
      continue;
    }
    // Bloqueio cobre início.
    if (blockStart <= iv.startAt) {
      out.push({ startAt: blockEnd, endAt: iv.endAt });
      continue;
    }
    // Bloqueio cobre fim.
    out.push({ startAt: iv.startAt, endAt: blockStart });
  }
  return out;
}

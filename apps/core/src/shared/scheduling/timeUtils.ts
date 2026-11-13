// Helpers de manipulação de TIME e Date pra cálculo de disponibilidade.
// Tudo em server-local TZ — Postgres `time` e `timestamp` (sem timezone)
// trabalham na TZ do servidor. UI converte na borda.

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

// JS Date.getDay() retorna 0..6 com 0=Sunday. Mapeia pro enum do schema.
const WEEKDAY_MAP: readonly Weekday[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

export function weekdayOf(date: Date): Weekday {
  const w = WEEKDAY_MAP[date.getDay()];
  if (!w) throw new Error(`weekdayOf: dia inválido (${date.getDay()})`);
  return w;
}

// Parse 'HH:MM' ou 'HH:MM:SS' (formato retornado pelo Postgres TIME).
export function parseTimeOfDay(timeStr: string): {
  hours: number;
  minutes: number;
} {
  const [hStr, mStr] = timeStr.split(':');
  const hours = Number(hStr);
  const minutes = Number(mStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`parseTimeOfDay: formato inválido (${timeStr})`);
  }
  return { hours, minutes };
}

// Combina uma Date (qualquer hora — usamos só ano/mês/dia) com uma string
// TIME ('HH:MM') pra produzir um timestamp local completo.
export function combineDateAndTime(date: Date, timeStr: string): Date {
  const { hours, minutes } = parseTimeOfDay(timeStr);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// Retorna [00:00, 23:59:59.999] do dia da data passada.
export function dayBoundaries(date: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
}

// Format Date como 'YYYY-MM-DD' (sem timezone shift — usa componentes locais).
export function toIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

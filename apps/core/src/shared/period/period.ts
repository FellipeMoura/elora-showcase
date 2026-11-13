import { z } from '../openapi/registry.js';
import { AppError } from '../errors/AppError.js';

// =====================================================================
// Período compartilhado — usado por dashboard, relatórios e qualquer
// endpoint que aceite filtro de janela temporal.
//
// 9 presets + custom. `custom` exige from+to. Resolvers retornam range
// [from, to) com `to` EXCLUSIVO (queries comparam `col < to`).
// =====================================================================

export const periodEnum = z.enum([
  'today',
  '7d',
  '30d',
  '90d',
  '6m',
  '12m',
  'current_month',
  'previous_month',
  'custom',
]);

export type Period = z.infer<typeof periodEnum>;

// ISO YYYY-MM-DD ou timestamp ISO completo — o resolver trunca pro início
// do dia UTC de qualquer forma.
const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Data inválida (use formato ISO, ex: 2026-06-01)',
  });

// Schema reusável pra qualquer paramsSchema que precise de filtro de
// período. Default '30d'; `period=custom` exige from+to (superRefine).
export const periodQuerySchema = z
  .object({
    period: periodEnum.default('30d'),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.period === 'custom' && (!val.from || !val.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'period=custom exige from e to',
        path: ['from'],
      });
    }
  });

export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export interface PeriodRange {
  from: Date;
  to: Date; // exclusivo (col < to)
}

const DAY_MS = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function addUtcMonths(d: Date, months: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()),
  );
}

// Resolve o range [from, to) do período selecionado. `to` é sempre exclusivo.
// Pros presets de N dias, a janela termina no início de amanhã — inclui
// "hoje" inteiro. Mês corrente/anterior usam fronteiras de calendário;
// custom inclui o dia `to` inteiro (+1 dia).
export function resolvePeriodRange(
  period: Period,
  fromIso?: string,
  toIso?: string,
): PeriodRange {
  const now = new Date();
  const today = startOfUtcDay(now);
  const tomorrow = addDays(today, 1);

  switch (period) {
    case 'today':
      return { from: today, to: tomorrow };
    case '7d':
      return { from: addDays(tomorrow, -7), to: tomorrow };
    case '30d':
      return { from: addDays(tomorrow, -30), to: tomorrow };
    case '90d':
      return { from: addDays(tomorrow, -90), to: tomorrow };
    case '6m':
      return { from: addUtcMonths(tomorrow, -6), to: tomorrow };
    case '12m':
      return { from: addUtcMonths(tomorrow, -12), to: tomorrow };
    case 'current_month':
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      };
    case 'previous_month':
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      };
    case 'custom': {
      if (!fromIso || !toIso) {
        throw new AppError('period=custom exige from e to', 400);
      }
      const from = startOfUtcDay(new Date(fromIso));
      const to = addDays(startOfUtcDay(new Date(toIso)), 1);
      if (to <= from) {
        throw new AppError('Range inválido: to deve ser >= from', 400);
      }
      return { from, to };
    }
  }
}

// Helper pra formatar Date → YYYY-MM-DD em UTC. Usado pra devolver o
// range resolvido pro frontend (renderer mostra como label).
export function toIsoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

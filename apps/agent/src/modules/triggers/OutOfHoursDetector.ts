import type { BusinessHours } from '@elora/db';

// =====================================================================
// OutOfHoursDetector — utility puro pra decidir se um instante está
// dentro do horário de funcionamento da clínica.
//
// Usa Intl.DateTimeFormat com timeZone pra evitar libs externas. Os
// horários em `BusinessHours.schedule` são HH:MM no fuso da clínica;
// converter "agora" pra esse fuso e comparar minutos do dia.
//
// Semântica:
//   - `businessHours = null` → `isOpenNow = true` (sempre "em horário").
//     O trigger out_of_hours nunca dispara; só idle. Decisão registrada
//     em ai-agent-implementation.md §5.1.
//   - Janela `open <= now < close` → dentro (semi-aberta no fim, igual à
//     convenção de slot livre da agenda).
//   - Múltiplas janelas no mesmo dia (ex.: almoço dividido) → OR entre
//     elas. Match em qualquer cobre.
// =====================================================================

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface InstantInTimezone {
  dayOfWeek: number;
  minutesOfDay: number;
}

function instantInTimezone(now: Date, timezone: string): InstantInTimezone {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(now);
  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayStr = find('weekday');
  const dayOfWeek = WEEKDAY_TO_NUM[weekdayStr] ?? 0;
  const hour = Number(find('hour'));
  const minute = Number(find('minute'));
  return { dayOfWeek, minutesOfDay: hour * 60 + minute };
}

function parseHHMMToMinutes(value: string): number {
  // Aceita "HH:MM" e "HH:MM:SS". Segundos ignorados — comparação minuto a minuto.
  const [hStr, mStr] = value.split(':');
  return Number(hStr ?? 0) * 60 + Number(mStr ?? 0);
}

export function isOpenNow(
  businessHours: BusinessHours | null,
  now: Date = new Date(),
): boolean {
  if (!businessHours) return true;
  const { dayOfWeek, minutesOfDay } = instantInTimezone(now, businessHours.timezone);
  return businessHours.schedule.some((window) => {
    if (window.dayOfWeek !== dayOfWeek) return false;
    const open = parseHHMMToMinutes(window.open);
    const close = parseHHMMToMinutes(window.close);
    return minutesOfDay >= open && minutesOfDay < close;
  });
}

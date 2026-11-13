import { z } from 'zod';
import { tenantResolver } from '../../../shared/coreClient/index.js';
import { isOpenNow } from '../../triggers/OutOfHoursDetector.js';
import type { ToolDefinition } from '../types.js';

// =====================================================================
// tool: getBusinessHours
//
// Retorna horário de funcionamento da clínica + estado atual (aberto/
// fechado agora). Tenant config carregada do tenantResolver (cache).
//
// Sem `businessHours` cadastrado: retorna `configured: false` pro LLM
// dizer "não tenho essa informação" em vez de inventar horário.
// =====================================================================

const inputZod = z.object({}).strict();

interface BusinessHoursOutput {
  configured: boolean;
  timezone: string | null;
  schedule:
    | Array<{
        dayOfWeek: number;
        dayOfWeekLabel: string;
        open: string;
        close: string;
      }>
    | null;
  isOpenNow: boolean | null;
}

const WEEKDAY_LABELS: Record<number, string> = {
  0: 'domingo',
  1: 'segunda',
  2: 'terça',
  3: 'quarta',
  4: 'quinta',
  5: 'sexta',
  6: 'sábado',
};

export const getBusinessHoursTool: ToolDefinition<
  z.infer<typeof inputZod>,
  BusinessHoursOutput
> = {
  name: 'getBusinessHours',
  description:
    'Retorna o horário de funcionamento da clínica e se está aberta agora. ' +
    'Use quando cliente perguntar "abrem hoje?", "que horas funcionam?", ' +
    '"atendem sábado?" ou similar. Se `configured` for false, NÃO invente ' +
    'horário — diga que não tem essa informação e ofereça chamar a equipe.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  inputZod,
  handler: async (_input, ctx) => {
    const tenant = await tenantResolver.byTenantId(ctx.tenantId);
    const bh = tenant.businessHours;
    if (!bh) {
      return {
        configured: false,
        timezone: null,
        schedule: null,
        isOpenNow: null,
      };
    }
    return {
      configured: true,
      timezone: bh.timezone,
      schedule: bh.schedule.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        dayOfWeekLabel: WEEKDAY_LABELS[s.dayOfWeek] ?? String(s.dayOfWeek),
        open: s.open,
        close: s.close,
      })),
      isOpenNow: isOpenNow(bh),
    };
  },
};

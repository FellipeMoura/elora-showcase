import { z } from 'zod';
import { coreClient } from '../../../shared/coreClient/index.js';
import type { ToolDefinition } from '../types.js';

// =====================================================================
// tool: getClientInfo
//
// Retorna dados básicos do cliente da conversa atual. Não aceita input —
// `clientId` vem do ToolHandlerContext (resolvido a partir da conversation
// no início da rodada). Útil pro LLM personalizar resposta com o nome
// e verificar se cliente já é recorrente (`lastAppointmentAt`).
//
// V1: shape mínimo (id, name, phoneE164). PR 7 expande com journey stage
// + último appointment + pacotes ativos quando tools de agendamento
// precisarem dessa info.
// =====================================================================

const inputZod = z.object({}).strict();

interface ClientInfoOutput {
  id: string;
  name: string;
  phoneE164: string | null;
}

export const getClientInfoTool: ToolDefinition<
  z.infer<typeof inputZod>,
  ClientInfoOutput
> = {
  name: 'getClientInfo',
  description:
    'Retorna dados básicos do cliente da conversa atual (nome + telefone). ' +
    'Use no início do turno pra personalizar saudação ou referenciar cliente pelo nome.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  inputZod,
  handler: async (_input, ctx) => {
    const client = await coreClient.getClient(ctx.tenantId, ctx.clientId);
    return {
      id: client.id,
      name: client.name,
      phoneE164: client.phoneE164,
    };
  },
};

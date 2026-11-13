import { z } from 'zod';
import { coreClient } from '../../../shared/coreClient/index.js';
import type { ToolDefinition } from '../types.js';

// =====================================================================
// tool: getProcedureInfo
//
// Busca procedimentos ativos do tenant. Sem filtro = lista tudo (paginação
// no core devolve até 200). Com `search` = filtra por nome via ILIKE.
//
// Usado pelo LLM quando o cliente pergunta preço, duração ou existência
// de um procedimento específico. Catálogo geralmente é pequeno (5-50 itens)
// — listar tudo cabe no contexto sem problema.
// =====================================================================

const inputZod = z
  .object({
    search: z.string().trim().min(1).max(64).optional().describe(
      'Substring (case-insensitive) pra filtrar pelo nome. Omita pra listar tudo.',
    ),
  })
  .strict();

interface ProcedureOutput {
  id: string;
  name: string;
  description: string | null;
  /** Preço em centavos de R$. Null = "consultar" — sem preço cadastrado. */
  priceCents: number | null;
  /** Quantidade típica de sessões pro tratamento (1+). */
  defaultSessions: number;
}

export const getProcedureInfoTool: ToolDefinition<
  z.infer<typeof inputZod>,
  { items: ProcedureOutput[] }
> = {
  name: 'getProcedureInfo',
  description:
    'Lista procedimentos ativos do catálogo da clínica. Use quando cliente perguntar ' +
    'sobre preço, sessões necessárias, ou se a clínica oferece um procedimento específico. ' +
    'Passe "search" pra filtrar por nome quando quiser dirigir a busca. ' +
    'Preço retornado em centavos — divida por 100 pra mostrar em reais.',
  inputSchema: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description:
          'Substring opcional pra filtrar nome (case-insensitive). Omita pra listar tudo.',
      },
    },
    additionalProperties: false,
  },
  inputZod,
  handler: async (input, ctx) => {
    const procedures = await coreClient.listProcedures(ctx.tenantId, {
      ...(input.search ? { search: input.search } : {}),
    });
    return {
      items: procedures.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        defaultSessions: p.defaultSessions,
      })),
    };
  },
};

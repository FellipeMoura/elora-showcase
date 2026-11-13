import { getBusinessHoursTool } from './definitions/getBusinessHours.js';
import { getClientInfoTool } from './definitions/getClientInfo.js';
import { getProcedureInfoTool } from './definitions/getProcedureInfo.js';
import { handoffToHumanTool } from './definitions/handoffToHuman.js';
import { tagConversationTool } from './definitions/tagConversation.js';
import type { ToolDefinition } from './types.js';

// Registry estático — adicionar tool nova = importar + push no array.
// PR 7 traz searchAvailableSlots + proposeAppointment + confirmAppointment.
const ALL_TOOLS: Array<ToolDefinition<unknown, unknown>> = [
  tagConversationTool as ToolDefinition<unknown, unknown>,
  getClientInfoTool as ToolDefinition<unknown, unknown>,
  getProcedureInfoTool as ToolDefinition<unknown, unknown>,
  getBusinessHoursTool as ToolDefinition<unknown, unknown>,
  handoffToHumanTool as ToolDefinition<unknown, unknown>,
];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export const ToolRegistry = {
  /** Retorna a tool por nome ou undefined. */
  get: (name: string): ToolDefinition<unknown, unknown> | undefined => byName.get(name),

  /** Tools registradas filtradas por subset de nomes — usada pra montar o `tools` da chamada Anthropic. */
  forNames: (names: readonly string[]): ToolDefinition<unknown, unknown>[] => {
    return names
      .map((n) => byName.get(n))
      .filter((t): t is ToolDefinition<unknown, unknown> => t !== undefined);
  },

  /** Todas as tools registradas. */
  all: (): ToolDefinition<unknown, unknown>[] => [...ALL_TOOLS],
};

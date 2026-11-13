import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
  buildClassifierV1System,
  CLASSIFIER_V1,
} from './versions/classifier.v1.js';
import {
  buildConversationalV1System,
  CONVERSATIONAL_V1,
} from './versions/conversational.v1.js';

// =====================================================================
// PromptBuilder — fachada que reúne os "ingredientes" (system text + lista
// de mensagens no formato Anthropic) pros vários modos do agente.
//
//   - `classifier` (PR 5): força tool_use em tagConversation, não responde texto.
//   - `conversational` (PR 6): responde ao cliente + classifica + faz handoff.
//   - `scheduling` (PR 7): inclui propose/confirm appointment.
// =====================================================================

interface ConversationTurnForPrompt {
  /** 'inbound' = cliente; 'outbound' = atendente humano OU agente; 'internal_note' = entre staff. */
  direction: 'inbound' | 'outbound' | 'internal_note';
  body: string | null;
  /** Nome do atendente quando direction='outbound' e humano; null pro cliente, agente ou nota. */
  authorLabel: string | null;
  /** ISO local pra contextualizar tempo entre mensagens. */
  createdAt: string;
  /** 'text' | 'media' | 'sticker' | 'template' | 'call' | 'system' — usado pra renderizar placeholder em mídia/call. */
  kind: string;
}

interface TagForPrompt {
  id: string;
  name: string;
  /** Não-vazio. Tag sem instrução = humano-only, NÃO passa pra cá. */
  agentInstruction: string;
}

interface ProcedureForPrompt {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  defaultSessions: number;
}

interface ClientForPrompt {
  name: string;
  /** "primeira visita" ou ISO da última visita. Null = cliente novo OU sem histórico carregado. */
  lastAppointmentSummary: string | null;
}

export interface ClassifierPromptInput {
  tenantName: string;
  tags: TagForPrompt[];
  history: ConversationTurnForPrompt[];
}

export interface ConversationalPromptInput {
  tenantName: string;
  tenantPersona: string | null;
  tags: TagForPrompt[];
  procedures: ProcedureForPrompt[];
  client: ClientForPrompt;
  history: ConversationTurnForPrompt[];
}

export interface BuiltPrompt {
  promptVersion: string;
  system: string;
  messages: MessageParam[];
}

function formatHistory(history: readonly ConversationTurnForPrompt[]): string {
  if (history.length === 0) return '(sem mensagens — conversa vazia)';
  return history
    .map((m) => {
      const who =
        m.direction === 'inbound'
          ? 'cliente'
          : m.direction === 'internal_note'
            ? 'nota interna'
            : `atendente${m.authorLabel ? ` ${m.authorLabel}` : ''}`;

      let body: string;
      if (m.kind === 'media') body = m.body ?? '[MÍDIA]';
      else if (m.kind === 'sticker') body = '[STICKER]';
      else if (m.kind === 'call') body = '[CHAMADA]';
      else if (m.kind === 'system') body = m.body ? `[SISTEMA] ${m.body}` : '[SISTEMA]';
      else body = m.body ?? '(vazio)';

      return `[${m.createdAt} | ${who}] ${body}`;
    })
    .join('\n');
}

export const PromptBuilder = {
  classifier: (input: ClassifierPromptInput): BuiltPrompt => {
    const system = buildClassifierV1System({
      tenantName: input.tenantName,
      tags: input.tags,
    });
    const formattedHistory = formatHistory(input.history);

    const messages: MessageParam[] = [
      {
        role: 'user',
        content: `Conversa pra classificar:\n\n${formattedHistory}\n\nUse tagConversation com os IDs apropriados.`,
      },
    ];

    return {
      promptVersion: CLASSIFIER_V1.promptVersion,
      system,
      messages,
    };
  },

  conversational: (input: ConversationalPromptInput): BuiltPrompt => {
    const system = buildConversationalV1System({
      tenantName: input.tenantName,
      tenantPersona: input.tenantPersona,
      tags: input.tags,
      procedures: input.procedures,
    });
    const formattedHistory = formatHistory(input.history);
    const clientLine = `${input.client.name}${
      input.client.lastAppointmentSummary
        ? ` (${input.client.lastAppointmentSummary})`
        : ''
    }`;

    const messages: MessageParam[] = [
      {
        role: 'user',
        content:
          `CONTEXTO DA CONVERSA ATUAL\n` +
          `Cliente: ${clientLine}\n\n` +
          `Histórico (mais antigo primeiro):\n${formattedHistory}\n\n` +
          `Avalie e responda conforme suas responsabilidades. Comece chamando tagConversation com as tags aplicáveis (ou array vazio).`,
      },
    ];

    return {
      promptVersion: CONVERSATIONAL_V1.promptVersion,
      system,
      messages,
    };
  },
};

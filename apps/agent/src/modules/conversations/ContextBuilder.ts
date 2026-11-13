import {
  and,
  clients,
  conversationTags,
  conversations,
  desc,
  eq,
  isNull,
  messages,
  procedures,
  users,
  withTenant,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { tenantResolver, type TenantInfo } from '../../shared/coreClient/index.js';

// =====================================================================
// ContextBuilder — carrega tudo que o PromptBuilder precisa pra montar
// system + messages do agent.
//
// Tudo via DB direto (`withTenant`) em vez de HTTP pro core. Justificativa:
//   - Performance: cada turn carrega ~4 entidades; HTTP somaria 4 hops.
//   - Read-only + RLS já filtra por tenant — segurança preservada.
//   - Dados estruturais (mensagens/cliente) raramente mudam de shape;
//     baixo risco de drift entre core's *Types e o que carregamos aqui.
//
// Quando o agente precisar publicar/mudar coisa, vai via CoreClient
// (HTTP) pra reaproveitar regras de domínio do core.
// =====================================================================

export interface MessageForContext {
  direction: 'inbound' | 'outbound' | 'internal_note';
  body: string | null;
  kind: string;
  authorLabel: string | null;
  createdAt: string;
}

export interface TagForContext {
  id: string;
  name: string;
  agentInstruction: string;
}

export interface ClientForContext {
  id: string;
  name: string;
  phoneE164: string | null;
}

export interface ProcedureForContext {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  defaultSessions: number;
}

export interface ConversationContext {
  tenant: TenantInfo;
  conversationId: string;
  /** Quando preenchido, AgentRunner skip a rodada (sem custo de IA). */
  pausedUntil: Date | null;
  client: ClientForContext;
  /** Apenas tags ATIVAS COM agentInstruction não-vazia — humano-only fica fora. */
  tags: TagForContext[];
  /** Procedimentos ativos do tenant — entram no system prompt da rodada conversacional. */
  procedures: ProcedureForContext[];
  /** Cronológica (mais antiga → mais recente), até 30 entradas. */
  history: MessageForContext[];
}

// Volume razoável de contexto pra classificação sem inflar tokens.
const HISTORY_LIMIT = 30;

function formatTimestamp(d: Date): string {
  // ISO sem milissegundos pra economizar tokens — granularidade segundo
  // é suficiente pra ordenação contextual ao LLM.
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const ContextBuilder = {
  load: async (
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationContext> => {
    const tenant = await tenantResolver.byTenantId(tenantId);

    const loaded = await withTenant(db, tenantId, async (tx) => {
      // 1) Conversation — confirma existência + pega clientId + pausa.
      const [conv] = await tx
        .select({
          id: conversations.id,
          clientId: conversations.clientId,
          agentPausedUntil: conversations.agentPausedUntil,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (!conv) {
        throw new AppError(
          `Conversation ${conversationId} não encontrada no tenant`,
          404,
        );
      }

      // 2) Cliente.
      const [clientRow] = await tx
        .select({
          id: clients.id,
          name: clients.name,
          phoneE164: clients.phoneE164,
        })
        .from(clients)
        .where(eq(clients.id, conv.clientId))
        .limit(1);

      if (!clientRow) {
        throw new AppError(
          `Cliente ${conv.clientId} não encontrado`,
          500,
        );
      }

      // 3) Tags ativas com agentInstruction populada (humano-only fica de fora).
      const tagsRaw = await tx
        .select({
          id: conversationTags.id,
          name: conversationTags.name,
          agentInstruction: conversationTags.agentInstruction,
        })
        .from(conversationTags)
        .where(eq(conversationTags.active, true));

      const tags: TagForContext[] = tagsRaw
        .filter((t): t is { id: string; name: string; agentInstruction: string } =>
          typeof t.agentInstruction === 'string' && t.agentInstruction.trim().length > 0,
        )
        .map((t) => ({
          id: t.id,
          name: t.name,
          agentInstruction: t.agentInstruction,
        }));

      // 4) Procedimentos ativos do tenant. `defaultPrice` vem como string
      // decimal "450.00" do Drizzle — converte pra cents pra consistência
      // com o resto do código do agent.
      const procRaw = await tx
        .select({
          id: procedures.id,
          name: procedures.name,
          description: procedures.description,
          defaultPrice: procedures.defaultPrice,
          defaultSessions: procedures.defaultSessions,
        })
        .from(procedures)
        .where(eq(procedures.active, true));

      const proceduresForCtx: ProcedureForContext[] = procRaw.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents:
          typeof p.defaultPrice === 'string' && p.defaultPrice.length > 0
            ? Math.round(Number(p.defaultPrice) * 100)
            : null,
        defaultSessions: p.defaultSessions,
      }));

      // 5) Histórico — últimas N mensagens NÃO apagadas, joinando users
      // pra pegar nome do atendente em outbound humanas.
      const historyRaw = await tx
        .select({
          direction: messages.direction,
          kind: messages.kind,
          body: messages.body,
          createdAt: messages.createdAt,
          authorUserId: messages.authorUserId,
          authorName: users.name,
          authorIsSystemAgent: users.isSystemAgent,
        })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorUserId))
        .where(
          and(
            eq(messages.conversationId, conversationId),
            isNull(messages.deletedAt),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(HISTORY_LIMIT);

      const history: MessageForContext[] = historyRaw
        .reverse() // chronological asc
        .map((m) => ({
          direction: m.direction,
          kind: m.kind,
          body: m.body,
          authorLabel:
            m.direction === 'outbound' && m.authorName
              ? m.authorIsSystemAgent
                ? 'IA'
                : m.authorName
              : null,
          createdAt: formatTimestamp(m.createdAt),
        }));

      return {
        pausedUntil: conv.agentPausedUntil,
        client: clientRow,
        tags,
        procedures: proceduresForCtx,
        history,
      };
    });

    return {
      tenant,
      conversationId,
      pausedUntil: loaded.pausedUntil,
      client: loaded.client,
      tags: loaded.tags,
      procedures: loaded.procedures,
      history: loaded.history,
    };
  },
};

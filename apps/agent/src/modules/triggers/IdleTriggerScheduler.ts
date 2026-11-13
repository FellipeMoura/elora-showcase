import { env } from '../../env.js';
import { logger } from '../../shared/observability/logger.js';
import { channelResolver, tenantResolver } from '../../shared/coreClient/index.js';
import {
  cancelAgentTrigger,
  scheduleAgentTrigger,
} from '../../shared/workers/agentTrigger/index.js';
import type { AgentTriggerJobData } from '../../shared/workers/agentTrigger/types.js';
import { isOpenNow } from './OutOfHoursDetector.js';

// =====================================================================
// IdleTriggerScheduler — orquestra o enqueue/cancel da fila agent-trigger
// a partir das decisões de subscribers.
//
// Responsabilidades:
//   1. Decidir se um inbound vira trigger (gate kill switch + agent_enabled).
//   2. Calcular delay (out_of_hours = 0; idle = tenant.agentIdleMinutes).
//   3. Empacotar `AgentTriggerJobData` e chamar `scheduleAgentTrigger`.
//   4. Cancelar trigger pendente quando humano responde.
//
// Não conhece a forma do evento Redis (subscribers fazem o parse e
// passam um shape canônico) — facilita testes em isolamento.
// =====================================================================

export interface InboundContext {
  tenantId: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  clientId: string;
  /**
   * Quando o WhatsApp efetivamente recebeu a mensagem (vem do evento
   * `wa.message.received`). Comparado com `channel.agent_starts_at` pra
   * filtrar backfill histórico do Baileys.
   */
  receivedAt: Date;
}

export interface HumanReplyContext {
  tenantId: string;
  conversationId: string;
  /** authorUserId do MessageCreatedEvent. Null quando origem é automação. */
  authorUserId: string | null;
}

export const idleTriggerScheduler = {
  /**
   * Chamado pelo `InboundSubscriber` pra cada `wa.message.received`.
   * Retorna a decisão tomada (útil pra logs/teste).
   */
  handleInbound: async (
    ctx: InboundContext,
  ): Promise<
    | { decision: 'skipped'; reason: string }
    | { decision: 'scheduled'; triggerType: 'idle' | 'out_of_hours'; delayMs: number }
  > => {
    if (env.agent.globalKillSwitch) {
      return { decision: 'skipped', reason: 'global_kill_switch' };
    }

    const tenant = await tenantResolver.byTenantId(ctx.tenantId);
    if (!tenant.agentEnabled) {
      return { decision: 'skipped', reason: 'tenant_disabled' };
    }

    // Cutoff por canal: ignora backfill histórico do Baileys que veio no
    // pareamento. Inbounds com `received_at < channel.agent_starts_at` são
    // mensagens importadas (não interações reais pós-sync) — agente não
    // deve responder. Conversas antigas que receberem inbound NOVO depois
    // do cutoff passam normalmente.
    const channel = await channelResolver.byChannelId(ctx.tenantId, ctx.channelId);
    if (ctx.receivedAt.getTime() < channel.agentStartsAt.getTime()) {
      logger.debug(
        {
          tenantId: ctx.tenantId,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          receivedAt: ctx.receivedAt.toISOString(),
          agentStartsAt: channel.agentStartsAt.toISOString(),
        },
        '[idleTriggerScheduler] inbound anterior ao cutoff do canal — drop',
      );
      return { decision: 'skipped', reason: 'before_channel_agent_starts_at' };
    }

    const openNow = isOpenNow(tenant.businessHours);
    const triggerType: 'idle' | 'out_of_hours' = openNow ? 'idle' : 'out_of_hours';
    const delayMs = openNow ? tenant.agentIdleMinutes * 60_000 : 0;

    const data: AgentTriggerJobData = {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      inputMessageId: ctx.messageId,
      clientId: ctx.clientId,
      triggerType,
      triggerMetadata: openNow
        ? { idleMinutes: tenant.agentIdleMinutes }
        : {
            timezone: tenant.businessHours?.timezone ?? null,
            detectedAt: new Date().toISOString(),
          },
      enqueuedAt: new Date().toISOString(),
    };

    await scheduleAgentTrigger(data, delayMs);

    logger.debug(
      {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        triggerType,
        delayMs,
      },
      '[idleTriggerScheduler] inbound → trigger agendado',
    );
    return { decision: 'scheduled', triggerType, delayMs };
  },

  /**
   * Chamado pelo `HumanReplyCanceller` pra cada `message.created`. Cancela
   * o trigger pendente se a mensagem veio de qualquer um EXCETO o próprio
   * system agent user — humano staff respondeu, agente fica fora.
   */
  handleHumanReply: async (
    ctx: HumanReplyContext,
  ): Promise<{ decision: 'cancelled' | 'kept'; reason?: string }> => {
    const tenant = await tenantResolver.byTenantId(ctx.tenantId);
    if (ctx.authorUserId === tenant.agentUserId) {
      // É o próprio agente — não cancela. Esse evento vai existir quando PR 6
      // wirar o sendMessage; até lá, agente não publica `message.created`.
      return { decision: 'kept', reason: 'authored_by_agent' };
    }

    const removed = await cancelAgentTrigger(ctx.conversationId);
    if (removed) {
      logger.info(
        {
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId,
          authorUserId: ctx.authorUserId,
        },
        '[idleTriggerScheduler] humano respondeu — trigger cancelado',
      );
      return { decision: 'cancelled' };
    }
    return { decision: 'kept', reason: 'no_pending_trigger' };
  },
};

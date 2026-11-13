// =====================================================================
// BullMQ — fila de triggers do agente.
//
// Pra cada inbound do cliente, o InboundSubscriber decide se enfileira:
//   - delay = 0           → trigger "out_of_hours"
//   - delay = N min       → trigger "idle" (tenant.agentIdleMinutes)
//
// `jobId` é determinístico por conversa (`agent-trigger-{conversationId}`)
// — inbound novo na mesma conv substitui o job pendente (timer reseta), e
// `HumanReplyCanceller` remove o jobId quando staff responde.
// =====================================================================

export const AGENT_TRIGGER_QUEUE_NAME = 'agent-trigger';

export interface AgentTriggerJobData {
  tenantId: string;
  conversationId: string;
  // Última mensagem do cliente que motivou o trigger — vira `input_message_id`
  // do `agent_turns` quando o AgentRunner persistir o turno (PR 5+).
  inputMessageId: string;
  // Cliente alvo da conversa — passado pra evitar lookup extra no AgentRunner.
  clientId: string;
  triggerType: 'idle' | 'out_of_hours';
  // Snapshot do momento do enqueue. AgentRunner não precisa hoje, mas log
  // estruturado fica útil quando coexistirem várias razões pro mesmo job.
  triggerMetadata: Record<string, unknown>;
  // ISO de quando o job foi enfileirado — pra calcular drift real vs delay
  // configurado quando o worker processar.
  enqueuedAt: string;
}

export function agentTriggerJobId(conversationId: string): string {
  // `:` é proibido pelo BullMQ em custom job IDs (separador de keys Redis).
  return `agent-trigger-${conversationId}`;
}

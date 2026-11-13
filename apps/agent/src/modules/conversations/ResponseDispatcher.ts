import { coreClient } from '../../shared/coreClient/index.js';
import { logger } from '../../shared/observability/logger.js';

// =====================================================================
// ResponseDispatcher — envia mensagens outbound em nome do agente.
//
// Implementação fina sobre `coreClient.sendMessage` (POST /conversations/
// :id/messages no apps/chat). Coleta os IDs das messages criadas pra
// AgentRunner persistir em `agent_turns.output_message_ids`.
//
// Decisões V1:
//   - Texto puro só (sem mídia/template). LLM gera mensagens curtas.
//   - 1 mensagem por bloco `text` na resposta da Anthropic — o LLM pode
//     emitir 2-3 textos curtos em vez de 1 parágrafo. UI mostra como
//     mensagens separadas (mais natural no WhatsApp).
//   - Sem reply/quote: PR 6 não implementa "respondendo a msg X" — agente
//     responde fluidamente. Threading natural fica pra PR posterior se
//     virar dor.
//   - Erros de envio propagam — caller (AgentRunner) decide se persiste
//     turn com erro ou re-tenta. Worker do BullMQ vai marcar job failed
//     se runner lançar.
// =====================================================================

export interface DispatchedMessage {
  id: string;
  body: string;
  createdAt: string;
}

export const ResponseDispatcher = {
  /**
   * Envia 1 mensagem outbound. Retorna o ID da row criada em `messages`.
   * `body` precisa estar não-vazio (caller filtra blocks vazios antes).
   */
  sendText: async (
    tenantId: string,
    conversationId: string,
    body: string,
  ): Promise<DispatchedMessage> => {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      throw new Error('ResponseDispatcher.sendText: body vazio');
    }
    const sent = await coreClient.sendMessage(tenantId, {
      conversationId,
      body: trimmed,
    });
    logger.debug(
      {
        conversationId,
        messageId: sent.id,
        bodyLength: trimmed.length,
      },
      '[responseDispatcher] outbound enviada',
    );
    return { id: sent.id, body: trimmed, createdAt: sent.createdAt };
  },
};

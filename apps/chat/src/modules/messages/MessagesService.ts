import { and, eq, journeys, withTenant } from '@elora/db';
import { env } from '../../env.js';
import { db } from '../../shared/database/db.js';
import { coreGateway } from '../../shared/coreGateway/index.js';
import { EVENT_CHANNELS, eventBus } from '../../shared/eventBus/index.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';
import { createWhatsappProvider } from '../../shared/providers/whatsapp/providerFactory.js';
import { MediaStorage } from '../../shared/storage/index.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import {
  enqueueOutboundDelivery,
  retryOutboundDelivery,
} from '../../shared/workers/outboundDelivery/queue.js';
import { ConversationsQuery } from '../conversations/ConversationsQuery.js';
import { ConversationsService } from '../conversations/ConversationsService.js';
import { MessageTemplatesService } from '../messageTemplates/MessageTemplatesService.js';
import { WhatsappChannelsService } from '../whatsappChannels/WhatsappChannelsService.js';
import { WhatsappContactsQuery } from '../whatsappContacts/WhatsappContactsQuery.js';
import { WhatsappConversationsQuery } from '../whatsappConversations/WhatsappConversationsQuery.js';
import { WhatsappMessagesQuery } from '../whatsappMessages/WhatsappMessagesQuery.js';
import { MessagesQuery } from './MessagesQuery.js';
import type {
  FindMessagesQuery,
  Message,
  PostInternalNoteInput,
  SendMessageInput,
} from './MessagesTypes.js';

// Input do normalizer pra criar mensagem inbound no domain layer.
interface CreateInboundInput {
  conversationId: string;
  journeyId?: string;
  whatsappMessageId: string;
  body?: string;
  // ObjectKey do MinIO (NÃO presigned URL — armazenamos o path estável).
  mediaUrl?: string;
  // Tipo da mídia. Quando `kind='sticker'`, `mediaType='sticker'`.
  mediaType?: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  // `kind` aceita 'text' | 'media' | 'sticker'. 'template' e 'system' são
  // pra outros fluxos (outbound/internal); normalizer só lida com inbound user.
  kind: 'text' | 'media' | 'sticker';
  // Local id da mensagem citada — resolvido pelo normalizer a partir de
  // `event.replyToExternalId` quando o cliente responde uma msg do histórico.
  // Null aceitável: citação aponta pra msg fora do nosso registro.
  replyToMessageId?: string;
  sentAt: Date;
}

// Input pra outbound capturada do celular pareado (não veio pela UI do Elora).
// `authorUserId` é sempre null por construção — não temos como saber qual
// operador no celular fez o envio.
interface CreateOutboundExternalInput {
  conversationId: string;
  journeyId?: string;
  whatsappMessageId: string;
  body?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  kind: 'text' | 'media' | 'sticker';
  replyToMessageId?: string;
  sentAt: Date;
}

// Substituição simples de `{{var}}` no body do template. Variáveis ausentes
// ficam como o placeholder original — frontend evita esse caso preenchendo
// tudo, mas se passar fica visível no histórico (debug-friendly).
function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

export const MessagesService = {
  listForConversation: async (
    tenantId: string,
    conversationId: string,
    query: FindMessagesQuery
  ): Promise<PaginatedResult<Message>> => {
    return withTenant(db, tenantId, async (tx) => {
      // Confirma que a conversation existe DENTRO do tenant (RLS já filtra,
      // mas erro amigável é melhor que array vazio silencioso).
      const conv = await ConversationsQuery.findById(tx, conversationId);
      if (!conv) throw new AppError('Conversation não encontrada', 404);

      const { items, total } = await MessagesQuery.findPaginated(
        tx,
        {
          conversationId,
          journeyId: query.journeyId,
          visibility: query.visibility,
        },
        { page: query.page, pageSize: query.pageSize }
      );

      return {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  // Anotação interna entre staff. Vive só no domain layer — não vai pro
  // WhatsApp. Atualiza last_activity_at da journey (se vinculada) per §10.1.
  postInternalNote: async (
    tenantId: string,
    conversationId: string,
    input: PostInternalNoteInput,
    authorUserId: string
  ): Promise<Message> => {
    return withTenant(db, tenantId, async (tx) => {
      const conv = await ConversationsQuery.findById(tx, conversationId);
      if (!conv) throw new AppError('Conversation não encontrada', 404);

      // Resolve journeyId pela journey ativa do cliente se UI não passou.
      // Mesma lógica do sendOutbound — nota interna conta como ação de
      // staff (§10.1) e precisa ficar linkada pra alimentar audit/timeline.
      let effectiveJourneyId = input.journeyId;
      if (!effectiveJourneyId) {
        const [active] = await tx
          .select({ id: journeys.id })
          .from(journeys)
          .where(
            and(eq(journeys.clientId, conv.clientId), eq(journeys.status, 'active'))
          )
          .limit(1);
        effectiveJourneyId = active?.id;
      }

      const now = new Date();
      const message = await MessagesQuery.create(tx, {
        tenantId,
        conversationId,
        journeyId: effectiveJourneyId,
        direction: 'internal_note',
        kind: 'text',
        body: input.body,
        authorUserId,
        sentAt: now,
        // Nota interna nasce concluída — não passa pelo worker outbound.
        // Sem isso, pega o default 'pending' do schema e o reconciler
        // erradamente marca como worker_timeout depois de 5min.
        deliveryStatus: 'sent',
      });

      // Toca conversation pra ordem por atividade refletir a nota.
      await ConversationsQuery.touchLastMessageAt(tx, conversationId, now);

      // Toca journey.last_activity_at quando a nota está taggada — §10.1
      // diz que internal_note conta como ação de staff. Sem journeyId,
      // não há journey específica pra atualizar.
      if (effectiveJourneyId) {
        await MessagesQuery.touchJourneyActivity(tx, effectiveJourneyId);
      }

      return message;
    });
  },

  // Cria mensagem inbound no domain layer a partir do normalizer (passo 7).
  // Idempotente por whatsapp_message_id — BullMQ pode reprocessar o mesmo
  // job em erro transiente.
  //
  // NÃO toca journey.last_activity_at: inbound do cliente não conta como
  // ação de staff (chat-domain.md §10.1). Toca conversation.last_message_at
  // pra ordenar a inbox por atividade.
  createInbound: async (
    tenantId: string,
    input: CreateInboundInput
  ): Promise<Message> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await MessagesQuery.findByWhatsappMessageId(
        tx,
        input.whatsappMessageId
      );
      if (existing) return existing;

      const message = await MessagesQuery.create(tx, {
        tenantId,
        conversationId: input.conversationId,
        journeyId: input.journeyId,
        direction: 'inbound',
        kind: input.kind,
        body: input.body,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType,
        whatsappMessageId: input.whatsappMessageId,
        replyToMessageId: input.replyToMessageId,
        sentAt: input.sentAt,
        // Inbound já chegou no nosso servidor — não passa pelo worker.
        // 'sent' aqui significa "entrega concluída no domain layer".
        deliveryStatus: 'sent',
      });

      await ConversationsQuery.touchLastMessageAt(tx, input.conversationId, input.sentAt);

      return message;
    }).then(async (message) => {
      // Recompute lead_substage após inbound — pode mover 'template' → 'contact'
      // (cliente respondeu à última outbound). Fora da tx pra não estender
      // hot path do normalizer. No-op se journey não está em stage='lead'.
      if (input.journeyId) {
        await coreGateway.journeysRecomputeLeadSubstage(
          tenantId,
          input.journeyId,
          'inbound_received'
        );
      }
      return message;
    });
  },

  // Cria mensagem outbound capturada do celular pareado. Idempotente por
  // whatsapp_message_id — pipeline também dedupa por externalId em camada
  // acima, este é o cinto extra (BullMQ retry).
  //
  // Decisões importantes (chat-domain.md §10.1 + arquitetura.md §7.4):
  //   - direction='outbound' (a mensagem saiu do canal)
  //   - authoredOnDevice=true (marca visualmente diferente da UI)
  //   - authorUserId=null (sem como saber qual operador no celular)
  //   - TOCA journey.last_activity_at: conta como ação de staff p/ SLA,
  //     mesmo que tenha sido feita fora do sistema.
  createOutboundExternal: async (
    tenantId: string,
    input: CreateOutboundExternalInput
  ): Promise<Message> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await MessagesQuery.findByWhatsappMessageId(
        tx,
        input.whatsappMessageId
      );
      if (existing) return existing;

      const message = await MessagesQuery.create(tx, {
        tenantId,
        conversationId: input.conversationId,
        journeyId: input.journeyId,
        direction: 'outbound',
        kind: input.kind,
        body: input.body,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType,
        whatsappMessageId: input.whatsappMessageId,
        replyToMessageId: input.replyToMessageId,
        authoredOnDevice: true,
        sentAt: input.sentAt,
        // Mensagem já saiu pelo celular pareado — não passa pelo worker
        // outbound. 'sent' direto pra não cair na varredura do reconciler
        // (que marcaria como worker_timeout depois de 5min).
        deliveryStatus: 'sent',
      });

      await ConversationsQuery.touchLastMessageAt(tx, input.conversationId, input.sentAt);

      if (input.journeyId) {
        await MessagesQuery.touchJourneyActivity(tx, input.journeyId);
      }

      return message;
    }).then(async (message) => {
      // Outbound capturada do celular pareado — primeira mensagem de staff
      // sai 'new' → 'template'. Sem await dentro da tx pra manter o caminho
      // do webhook enxuto. No-op se stage != 'lead'.
      if (input.journeyId) {
        await coreGateway.journeysRecomputeLeadSubstage(
          tenantId,
          input.journeyId,
          'outbound_device_sent'
        );
      }
      return message;
    });
  },

  // Cria entrada de chamada na timeline (kind='call'). Não tem whatsapp_message
  // associada — call não é mensagem no protocolo WhatsApp, é evento à parte.
  // Sem dedup forte: BullMQ retry duplicaria, mas calls são raras e o impacto
  // é cosmético (item extra na timeline, sem corromper estado).
  //
  // NÃO toca last_inbound_at (janela 24h só conta texto/mídia) nem dispara
  // opt-in (call não é consentimento textual). Toca conversation.last_message_at
  // pra ordenar a inbox.
  createCallMessage: async (
    tenantId: string,
    input: {
      conversationId: string;
      journeyId?: string;
      externalId: string;
      callDirection: 'inbound' | 'outbound';
      status: 'missed' | 'received' | 'declined';
      durationSec?: number;
      startedAt: Date;
    },
  ): Promise<Message> => {
    return withTenant(db, tenantId, async (tx) => {
      const message = await MessagesQuery.create(tx, {
        tenantId,
        conversationId: input.conversationId,
        journeyId: input.journeyId,
        direction: input.callDirection === 'inbound' ? 'inbound' : 'outbound',
        kind: 'call',
        callPayload: {
          direction: input.callDirection,
          status: input.status,
          durationSec: input.durationSec,
          startedAt: input.startedAt.toISOString(),
        },
        sentAt: input.startedAt,
        // Call já aconteceu — não passa pelo worker outbound. Sem 'sent'
        // explícito, vira spinner eterno na timeline e o reconciler iria
        // marcar como worker_timeout.
        deliveryStatus: 'sent',
      });
      await ConversationsQuery.touchLastMessageAt(
        tx,
        input.conversationId,
        input.startedAt,
      );
      return message;
    });
  },

  // Atualiza delivered_at / read_at na mensagem domain quando webhook de
  // status chega. Match via whatsapp_message_id. Idempotente.
  applyStatusUpdate: async (
    tenantId: string,
    whatsappMessageId: string,
    status: string,
    at: Date
  ): Promise<string | null> => {
    // Devolve o conversationId da mensagem domain (null se não houver) —
    // o evento wa.status.updated precisa dele pra ser roteado no core.
    return withTenant(db, tenantId, async (tx) => {
      const message = await MessagesQuery.findByWhatsappMessageId(tx, whatsappMessageId);
      if (!message) return null;
      if (status === 'delivered' || status === 'read') {
        const field = status === 'delivered' ? 'deliveredAt' : 'readAt';
        await MessagesQuery.setDeliveryTimestamp(tx, whatsappMessageId, field, at);
      }
      return message.conversationId;
    });
  },

  // =====================================================================
  // POST /conversations/:id/messages — Enfileira envio outbound.
  //
  // O controller faz só o mínimo síncrono:
  //   1. Resolve conversation (404 se não existir / fora do tenant)
  //   2. Resolve journey ativa (pra carimbar messages.journey_id)
  //   3. INSERT messages com delivery_status='pending', sent_at=null
  //   4. Publica `message.created` (outras sessões vêem a bolha imediatamente)
  //   5. Enfileira o job — worker faz pre-flight + adapter + UPDATE
  //   6. Retorna a row (HTTP 201)
  //
  // Todas as validações de regra de negócio (opt-in, janela 24h, canal
  // ativo+open, OutboundGuard) e a chamada ao adapter Evolution rodam no
  // OutboundDeliveryWorker. Falhas viram `delivery_status='rejected'`
  // (pre-flight) ou `'failed'` (adapter) e aparecem como bolha laranja na UI.
  // Sucesso vira `'sent'` com sent_at preenchido + whatsapp_message_id ligado.
  // =====================================================================
  enqueueOutbound: async (
    tenantId: string,
    conversationId: string,
    input: SendMessageInput,
    authorUserId: string
  ): Promise<Message> => {
    // 1. Conversation — única validação síncrona com 404. Validações de
    // regra de negócio (opt-in, canal, janela, rate limit) viram bolha
    // laranja na UI via worker; só infra/permissão batem aqui.
    const conv = await ConversationsService.findById(tenantId, conversationId);

    // 2. Resolve journey ativa pra carimbar a row — lead_substage e métricas
    // dependem de journey_id. Invariante §5: no máx 1 active por cliente.
    // Null aceitável (cliente sem journey aberta, cenário transitório).
    const effectiveJourneyId =
      input.journeyId ??
      (await coreGateway.journeysFindActiveByClient(tenantId, conv.clientId))?.id;

    // 2a. Valida reply target. Erros aqui são bug do cliente (UI selecionou
    // msg errada), por isso 400 síncrono em vez de virar bolha rejected.
    //   - tem que existir e estar na mesma conversa (RLS por findById já
    //     garante o tenant)
    //   - não pode ser internal_note (não saiu pro WhatsApp; sem externalId
    //     pro adapter montar o quoted)
    //   - precisa de whatsapp_message_id; se a alvo está pending sem isso,
    //     respondendo gera quoted vazio no provider
    if (input.replyToMessageId) {
      const replyTarget = await withTenant(db, tenantId, (tx) =>
        MessagesQuery.findById(tx, input.replyToMessageId!),
      );
      if (!replyTarget) {
        throw new AppError('Mensagem citada não encontrada', 400);
      }
      if (replyTarget.conversationId !== conversationId) {
        throw new AppError('Mensagem citada é de outra conversa', 400);
      }
      if (replyTarget.direction === 'internal_note') {
        throw new AppError(
          'Anotação interna não pode ser citada no WhatsApp',
          400,
        );
      }
      if (!replyTarget.whatsappMessageId) {
        throw new AppError(
          'Mensagem citada ainda não foi enviada — aguarde a entrega antes de responder',
          400,
        );
      }
    }

    // 3. Resolve channelId pra carregar no evento `message.created`. O worker
    // re-resolve via contact em runtime — aqui só precisamos pro relay socket.
    // Se cliente tem múltiplos contatos, pega o primeiro (mesma heurística do
    // worker em V1). Se sem contato, channelId vira vazio — o worker vai
    // rejeitar como no_opt_in mas a UI já mostra a bolha pending primeiro.
    const contacts = await withTenant(db, tenantId, (tx) =>
      WhatsappContactsQuery.findByClientId(tx, conv.clientId),
    );
    const fallbackChannelId = contacts[0]?.whatsappChannelId ?? '';

    // 4. INSERT pending. Pra template, renderiza o body localmente pra UI
    // mostrar texto inteligível na bolha (worker também usa esse body no
    // track baileys). Pra mídia, mediaUrl é o objectKey (presigned é gerado
    // só no momento do envio real, no worker).
    const message = await withTenant(db, tenantId, async (tx) => {
      const create = await buildCreateInput(
        tenantId,
        conversationId,
        effectiveJourneyId,
        authorUserId,
        input,
      );
      return MessagesQuery.create(tx, create);
    });

    // 5. Publica `message.created` — outras abas/devices vêem a bolha pending
    // imediatamente via socket. A sessão que disparou o POST vai receber
    // também (idempotente: invalidate de cache, sem efeito visual extra).
    await eventBus.publish(EVENT_CHANNELS.messageCreated, {
      tenantId,
      channelId: fallbackChannelId,
      conversationId,
      messageId: message.id,
      clientId: conv.clientId,
      authorUserId,
      createdAt: message.createdAt.toISOString(),
    });

    // 6. Enfileira. Worker pega o job, faz pre-flight + adapter + UPDATE,
    // publica `wa.message.status_changed`. Falha aqui (Redis fora?) é grave —
    // a row fica pending até o reconciler marcar como worker_timeout. Por
    // isso log error explícito, sem tentar reverter o INSERT (UI já viu).
    try {
      await enqueueOutboundDelivery({
        tenantId,
        conversationId,
        messageId: message.id,
      });
    } catch (err) {
      logger.error(
        {
          tenantId,
          messageId: message.id,
          err: err instanceof Error ? err.message : err,
        },
        '[enqueueOutbound] BullMQ.add falhou — row ficará pending até reconciler',
      );
    }

    return message;
  },

  // =====================================================================
  // POST /conversations/:id/upload-media — recebe arquivo do frontend (já
  // bufferizado pelo multer) e persiste no MinIO. Devolve objectKey +
  // presigned URL pro frontend mostrar preview antes de confirmar o envio.
  //
  // Valida que a conversation existe (RLS dá 404 indireto, mas erro claro
  // é melhor que falhar lá embaixo no upload).
  // =====================================================================
  uploadOutboundMedia: async (
    tenantId: string,
    conversationId: string,
    file: { buffer: Buffer; mimeType: string; originalFilename: string },
  ): Promise<{ objectKey: string; presignedUrl: string; size: number; mimeType: string }> => {
    const conv = await ConversationsService.findById(tenantId, conversationId);
    const result = await MediaStorage.uploadOutbound({
      tenantId,
      channelId: conv.whatsappChannelId,
      buffer: file.buffer,
      mimeType: file.mimeType,
      originalFilename: file.originalFilename,
    });
    const presignedUrl = await MediaStorage.getSignedDownloadUrl(result.objectKey);
    return {
      objectKey: result.objectKey,
      presignedUrl,
      size: result.size,
      mimeType: result.mimeType,
    };
  },

  // GET /messages/:messageId/media-url — devolve presigned URL pra mensagem
  // com `mediaUrl` (objectKey). RLS garante isolamento de tenant; se mensagem
  // existe e tem mediaUrl, geramos presigned. 404 se não existe / não é mídia.
  getMediaUrl: async (
    tenantId: string,
    messageId: string,
  ): Promise<{ url: string; expiresInSec: number }> => {
    const message = await withTenant(db, tenantId, (tx) =>
      MessagesQuery.findById(tx, messageId),
    );
    if (!message) throw new AppError('Mensagem não encontrada', 404);
    if (!message.mediaUrl) {
      throw new AppError('Mensagem não tem mídia associada', 400);
    }
    const url = await MediaStorage.getSignedDownloadUrl(message.mediaUrl);
    return { url, expiresInSec: env.minio.presignedUrlTtlSec };
  },

  // =====================================================================
  // PATCH /messages/:id — staff edita mensagem outbound de texto.
  //
  // Restrições V1 (WhatsApp + escolha de produto):
  //   - direction='outbound' (não edita o que cliente mandou)
  //   - kind='text' (caption de mídia fica pra V2)
  //   - not deletedAt (msg apagada não pode ser editada)
  //   - tem whatsappMessageId (foi pro WhatsApp; nota interna não passa por aqui)
  //
  // Fluxo: valida → resolve transport (channel + contato + externalId) →
  // adapter.editMessage (rede; WhatsApp recusa após 15min do envio) →
  // markEdited no domain.
  // =====================================================================
  editMessage: async (
    tenantId: string,
    messageId: string,
    newBody: string,
  ): Promise<Message> => {
    const ctx = await resolveOutboundActionContext(tenantId, messageId);

    if (ctx.message.kind !== 'text') {
      throw new AppError(
        'Edição V1 só suporta mensagens de texto',
        400,
      );
    }

    const channel = await WhatsappChannelsService.findById(tenantId, ctx.channelId);
    const provider = createWhatsappProvider(channel);
    await provider.editMessage({
      externalId: ctx.externalId,
      toE164: ctx.toE164,
      text: newBody,
    });

    const editedAt = new Date();
    const updated = await withTenant(db, tenantId, (tx) =>
      MessagesQuery.markEdited(tx, messageId, newBody, editedAt),
    );
    if (!updated) {
      throw new AppError('Falha ao gravar edição local', 500);
    }
    return updated;
  },

  // =====================================================================
  // DELETE /messages/:id — staff revoga mensagem outbound ("apagar pra
  // cliente"). Soft delete sempre: registro permanece no DB com deletedAt
  // + deletion_origin='staff'.
  //
  // Idempotente: já deletada devolve a própria mensagem sem chamar provider.
  // =====================================================================
  revokeMessage: async (
    tenantId: string,
    messageId: string,
  ): Promise<Message> => {
    const ctx = await resolveOutboundActionContext(tenantId, messageId);
    if (ctx.message.deletedAt) {
      // Já estava deletada — caminho idempotente (UI clica 2x, retry de rede).
      return ctx.message;
    }

    const channel = await WhatsappChannelsService.findById(tenantId, ctx.channelId);
    const provider = createWhatsappProvider(channel);
    await provider.revokeMessage({
      externalId: ctx.externalId,
      toE164: ctx.toE164,
    });

    const deletedAt = new Date();
    const updated = await withTenant(db, tenantId, (tx) =>
      MessagesQuery.markDeleted(tx, messageId, 'staff', deletedAt),
    );
    if (!updated) {
      throw new AppError('Falha ao gravar revogação local', 500);
    }

    await eventBus.publish(EVENT_CHANNELS.whatsappMessageRevoked, {
      tenantId,
      channelId: ctx.channelId,
      conversationId: updated.conversationId,
      messageId: updated.id,
      origin: 'staff',
      deletedAt: deletedAt.toISOString(),
    });

    return updated;
  },

  // =====================================================================
  // POST /messages/:id/retry — staff aciona "Tentar novamente" em bolha
  // failed/rejected. Validações:
  //   - direction='outbound' (não dá pra retentar msg do cliente)
  //   - not deletedAt
  //   - deliveryStatus in ('failed','rejected') — só estados terminais de
  //     falha podem ser ressuscitados. resetToPending faz esse check no DB
  //     (atômico, evita race entre 2 abas clicando ao mesmo tempo).
  //
  // O worker re-roda pre-flight inteiro (opt-in, canal, janela, OutboundGuard)
  // — se a causa raiz não foi corrigida, vira `rejected` de novo. Logo a UX
  // ideal é mostrar o botão "Tentar novamente" + um botão "Corrigir <coisa>"
  // contextual (ex: "Registrar opt-in" pra no_opt_in). Frontend escolhe quais
  // ações mostrar baseado em `failureReason`.
  // =====================================================================
  retryDelivery: async (
    tenantId: string,
    messageId: string,
  ): Promise<Message> => {
    const before = await withTenant(db, tenantId, (tx) =>
      MessagesQuery.findById(tx, messageId),
    );
    if (!before) throw new AppError('Mensagem não encontrada', 404);
    if (before.direction !== 'outbound') {
      throw new AppError('Só mensagens outbound podem ser reenviadas', 400);
    }
    if (before.deletedAt) {
      throw new AppError('Mensagem apagada não pode ser reenviada', 400);
    }
    if (
      before.deliveryStatus !== 'failed' &&
      before.deliveryStatus !== 'rejected'
    ) {
      // Pending/sent já caíram nos seus terminais — retry seria duplicar
      // envio. 409 = state conflict (frontend mapeia pra toast claro).
      throw new AppError(
        'Só mensagens em estado de falha podem ser reenviadas',
        409,
      );
    }

    const updated = await withTenant(db, tenantId, (tx) =>
      MessagesQuery.resetToPending(tx, messageId),
    );
    if (!updated) {
      // Race com outra aba — alguém já clicou retry e a row saiu de failed/
      // rejected entre o findById e o UPDATE. Devolve estado atual (idempotente).
      return before;
    }

    // Resolve channelId só pra carimbar o evento socket — worker re-resolve
    // em runtime (pode ter mudado entre tentativa original e retry).
    const conv = await ConversationsService.findById(tenantId, updated.conversationId);
    const contacts = await withTenant(db, tenantId, (tx) =>
      WhatsappContactsQuery.findByClientId(tx, conv.clientId),
    );
    const fallbackChannelId = contacts[0]?.whatsappChannelId ?? '';

    await eventBus.publish(EVENT_CHANNELS.whatsappMessageStatusChanged, {
      tenantId,
      channelId: fallbackChannelId,
      conversationId: updated.conversationId,
      messageId: updated.id,
      deliveryStatus: 'pending',
      failureReason: null,
      updatedAt: new Date().toISOString(),
    });

    try {
      await retryOutboundDelivery({
        tenantId,
        conversationId: updated.conversationId,
        messageId: updated.id,
      });
    } catch (err) {
      logger.error(
        {
          tenantId,
          messageId: updated.id,
          err: err instanceof Error ? err.message : err,
        },
        '[retryDelivery] BullMQ.add falhou — row ficará pending até reconciler',
      );
    }

    return updated;
  },

  // =====================================================================
  // Chamado pelo pipeline quando webhook reporta edição feita pelo cliente.
  // Idempotente: se nada bate o externalId (provider emitiu pra msg fora
  // do nosso histórico), log + skip. Sem publish no bus por enquanto
  // (decisão de projeto — automações não re-disparam em edit).
  // =====================================================================
  applyClientEdit: async (
    tenantId: string,
    externalId: string,
    newBody: string,
    editedAt: Date,
  ): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      const message = await MessagesQuery.findByExternalId(tx, externalId);
      if (!message) {
        logger.debug(
          { tenantId, externalId },
          '[edit-inbound] sem message correspondente — drop',
        );
        return;
      }
      if (message.deletedAt) {
        // Cliente editou após apagar? Cenário improvável (WhatsApp não
        // permite), mas se chegar, drop — apagada é estado final.
        return;
      }
      await MessagesQuery.markEdited(tx, message.id, newBody, editedAt);
    });
  },

  // =====================================================================
  // Chamado pelo pipeline quando webhook reporta deleção pelo cliente.
  // Soft delete + publish no bus (frontend escuta pra atualizar UI em
  // tempo real). Idempotente — markDeleted só atualiza se ainda não
  // estava deletada.
  // =====================================================================
  applyClientDelete: async (
    tenantId: string,
    channelId: string,
    externalId: string,
    deletedAt: Date,
  ): Promise<void> => {
    const result = await withTenant(db, tenantId, async (tx) => {
      const message = await MessagesQuery.findByExternalId(tx, externalId);
      if (!message) return null;
      return MessagesQuery.markDeleted(tx, message.id, 'client', deletedAt);
    });
    if (!result) {
      logger.debug(
        { tenantId, externalId },
        '[delete-inbound] sem message correspondente ou já deletada — drop',
      );
      return;
    }
    await eventBus.publish(EVENT_CHANNELS.whatsappMessageRevoked, {
      tenantId,
      channelId,
      conversationId: result.conversationId,
      messageId: result.id,
      origin: 'client',
      deletedAt: deletedAt.toISOString(),
    });
  },
};

// Resolve {channel, externalId, toE164} a partir de uma message domain.
// Centralizado aqui porque editMessage e revokeMessage fazem o mesmo lookup
// e as validações comuns (direction, whatsappMessageId, RLS) também.
async function resolveOutboundActionContext(
  tenantId: string,
  messageId: string,
): Promise<{
  message: Message;
  externalId: string;
  toE164: string;
  channelId: string;
}> {
  return withTenant(db, tenantId, async (tx) => {
    const message = await MessagesQuery.findById(tx, messageId);
    if (!message) throw new AppError('Mensagem não encontrada', 404);
    if (message.direction !== 'outbound') {
      throw new AppError(
        'Só é possível editar/revogar mensagens enviadas pela clínica',
        400,
      );
    }
    if (!message.whatsappMessageId) {
      throw new AppError(
        'Mensagem não tem registro de envio no WhatsApp (nota interna?)',
        400,
      );
    }
    const waMsg = await WhatsappMessagesQuery.findById(tx, message.whatsappMessageId);
    if (!waMsg) throw new AppError('whatsapp_message não encontrada', 404);
    if (!waMsg.externalId) {
      throw new AppError('Mensagem sem externalId — nada a editar/revogar', 400);
    }
    const waConv = await WhatsappConversationsQuery.findById(
      tx,
      waMsg.whatsappConversationId,
    );
    if (!waConv) throw new AppError('whatsapp_conversation não encontrada', 404);
    const waContact = await WhatsappContactsQuery.findById(
      tx,
      waConv.whatsappContactId,
    );
    if (!waContact) throw new AppError('whatsapp_contact não encontrado', 404);

    return {
      message,
      externalId: waMsg.externalId,
      // Edit/revoke operam sobre key.remoteJid no provider — precisamos do
      // número que o WhatsApp efetivamente reconhece. Fallback pra phoneE164
      // se a JID ainda não foi cacheada (contact pré-feature).
      toE164: waContact.whatsappE164 ?? waContact.phoneE164,
      channelId: waConv.whatsappChannelId,
    };
  });
}

// =====================================================================
// Monta `CreateInput` pra MessagesQuery.create a partir do SendMessageInput
// do controller. Renderiza template localmente pra UI ver o body inteligível
// na bolha pending — worker re-renderiza no envio real (caminho baileys
// usa o renderedBody; cloud usa templateVariables no payload da Cloud API).
//
// Template inexistente vira AppError 404 sync — caso raro porque a UI
// seleciona em dropdown. Template DESATIVADO entre INSERT e worker é tratado
// pelo worker (vira bolha rejected/invalid_template).
// =====================================================================
async function buildCreateInput(
  tenantId: string,
  conversationId: string,
  journeyId: string | undefined,
  authorUserId: string,
  input: SendMessageInput,
): Promise<ReturnType<typeof identityCreateInput>> {
  const base = {
    tenantId,
    conversationId,
    journeyId,
    direction: 'outbound' as const,
    authorUserId,
    deliveryStatus: 'pending' as const,
    // Já validado no enqueueOutbound (mesma conversa + alvo elegível).
    replyToMessageId: input.replyToMessageId,
    // sent_at intencionalmente omitido — fica null até o worker confirmar
    // sucesso. Frontend usa deliveryStatus pra renderizar spinner.
  };

  if (input.kind === 'text') {
    return identityCreateInput({
      ...base,
      kind: 'text',
      body: input.body,
    });
  }

  if (input.kind === 'media') {
    return identityCreateInput({
      ...base,
      kind: 'media',
      body: input.caption,
      mediaUrl: input.mediaObjectKey,
      mediaType: input.mediaType,
    });
  }

  const template = await MessageTemplatesService.findById(tenantId, input.templateId);
  const renderedBody = renderTemplate(template.body, input.templateVariables);
  return identityCreateInput({
    ...base,
    kind: 'template',
    body: renderedBody,
    templateId: template.id,
    templateVariables: input.templateVariables,
  });
}

// Identity pra inferir o type do CreateInput de MessagesQuery sem importar
// o tipo (encapsulado no módulo). Mantém autoria de tipos no MessagesQuery.
function identityCreateInput<T extends Parameters<typeof MessagesQuery.create>[1]>(
  x: T,
): T {
  return x;
}

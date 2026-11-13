import { withTenant } from '@elora/db';
import { ConversationsService } from '../../../modules/conversations/ConversationsService.js';
import { MessagesQuery } from '../../../modules/messages/MessagesQuery.js';
import { MessagesService } from '../../../modules/messages/MessagesService.js';
import { db } from '../../database/db.js';
import { WhatsappChannelsService } from '../../../modules/whatsappChannels/WhatsappChannelsService.js';
import { WhatsappContactsService } from '../../../modules/whatsappContacts/WhatsappContactsService.js';
import { WhatsappConversationsService } from '../../../modules/whatsappConversations/WhatsappConversationsService.js';
import { WhatsappMessagesService } from '../../../modules/whatsappMessages/WhatsappMessagesService.js';
import { coreGateway } from '../../coreGateway/index.js';
import { EVENT_CHANNELS, eventBus } from '../../eventBus/index.js';
import { logger } from '../../observability/logger.js';
import { recordClockSample } from '../../observability/clockSkewMonitor.js';
import { hadRecentUiOutbound } from '../../observability/outboundDuplicationDetector.js';
import { parseArrivedAt, resolveMessageTimestamp } from '../../utils/messageClock.js';
import type { IWhatsAppProvider } from '../../providers/whatsapp/IWhatsAppProvider.js';
import { createWhatsappProvider } from '../../providers/whatsapp/providerFactory.js';
import type {
  InboundCallEvent,
  InboundConnectionStateEvent,
  InboundMessageDeletedEvent,
  InboundMessageEditedEvent,
  InboundMessageEvent,
  InboundStatusEvent,
  MediaPayload,
} from '../../providers/whatsapp/types.js';
import { MediaStorage } from '../../storage/index.js';
import type { InboundJobData } from './types.js';

// =====================================================================
// Pipeline do normalizer — função pura(-ish) com side-effects bem
// delimitados via Services + coreGateway + eventBus. Testável em
// isolamento (basta mockar os Services).
//
// Idempotência: cada passo é idempotente por chave natural
//   - whatsapp_contact: unique (channel_id, phone)
//   - clients: unique (tenant_id, phone_e164) via coreGateway
//   - journey ativa: 1 por client (via gateway)
//   - conversation: unique (client_id)
//   - whatsapp_conversation: unique (channel_id, contact_id)
//   - whatsapp_message: idempotente por external_id
//   - message domain: idempotente por whatsapp_message_id
// Retry do BullMQ é seguro — passes repetidos convergem ao mesmo estado.
// =====================================================================

export async function processInboundJob(data: InboundJobData): Promise<void> {
  const { tenantId, channelId, rawPayload } = data;
  // Momento em que o webhook bateu no nosso servidor (não o do worker — fila
  // atrasada não desloca o horário). Ver shared/utils/messageClock.ts.
  const arrivedAt = parseArrivedAt(data.receivedAt);

  // Lookup do canal já com tenant context. Se foi desativado entre o
  // enqueue e o processamento: log + skip (não retry — admin decidiu).
  let channel;
  try {
    channel = await WhatsappChannelsService.findById(tenantId, channelId);
  } catch (err) {
    logger.warn(
      { tenantId, channelId, err: err instanceof Error ? err.message : err },
      '[normalizer] canal não acessível — drop'
    );
    return;
  }
  if (!channel.active) {
    logger.info({ tenantId, channelId }, '[normalizer] canal inativo — drop');
    return;
  }

  const provider = createWhatsappProvider(channel);
  const event = provider.normalizeWebhook(rawPayload);

  switch (event.kind) {
    case 'ignored':
      logger.debug(
        { tenantId, channelId, reason: event.reason },
        '[normalizer] evento ignorado'
      );
      return;

    case 'status_updated':
      await handleStatusUpdate(tenantId, channelId, event);
      return;

    case 'connection_state':
      await handleConnectionState(tenantId, channelId, event);
      return;

    case 'message_received':
      // Provider + rawPayload propagados pra que o handler possa pedir o
      // conteúdo decodificado da mídia (Evolution descriptografa via
      // getBase64FromMediaMessage). Sem isso, áudio/imagem vai pro MinIO
      // como `.enc` cifrado e player não toca.
      if (event.direction === 'outbound') {
        await handleOutboundCaptured(provider, tenantId, channelId, event, rawPayload, arrivedAt);
      } else {
        await handleInbound(provider, tenantId, channelId, event, rawPayload, arrivedAt);
      }
      return;

    case 'message_edited':
      await handleMessageEdited(tenantId, channelId, event);
      return;

    case 'message_deleted':
      await handleMessageDeleted(tenantId, channelId, event);
      return;

    case 'call_received':
      await handleCallReceived(tenantId, channelId, event, arrivedAt);
      return;
  }
}

// Atualiza whatsapp_channels.connection_state. Query é idempotente (só grava
// se state mudou) — evita escrever a cada presença do socket. Publica evento
// no eventBus APENAS quando o estado realmente mudou, pra UI receber 1 push
// por transição (open→closed→open = 3 eventos, não dezenas).
async function handleConnectionState(
  tenantId: string,
  channelId: string,
  event: InboundConnectionStateEvent
): Promise<void> {
  const updated = await WhatsappChannelsService.setConnectionState(
    tenantId,
    channelId,
    event.state,
    event.receivedAt
  );
  if (!updated) {
    // Mesmo estado de antes — drop silencioso. Sem log: Evolution+Baileys
    // dispara dezenas de eventos por segundo durante reconexão; logar
    // todos polui o STDOUT.
    return;
  }
  logger.info(
    { tenantId, channelId, state: event.state },
    '[normalizer] estado do socket mudou'
  );
  await eventBus.publish(EVENT_CHANNELS.whatsappChannelConnectionChanged, {
    tenantId,
    channelId,
    state: event.state,
    changedAt: event.receivedAt.toISOString(),
  });
}

async function handleInbound(
  provider: IWhatsAppProvider,
  tenantId: string,
  channelId: string,
  event: InboundMessageEvent,
  rawPayload: unknown,
  arrivedAt: Date,
): Promise<void> {
  // Horário da timeline = chegada no servidor (relógio único); o timestamp
  // do provider fica só no transport. Ver shared/utils/messageClock.ts.
  const sentAt = resolveMessageTimestamp(event.receivedAt, arrivedAt);
  recordClockSample(tenantId, channelId, event.receivedAt, arrivedAt);

  // 1) whatsapp_contact (transport).
  const waContact = await WhatsappContactsService.findOrCreateByPhone(
    tenantId,
    channelId,
    event.fromE164,
    event.profileName
  );

  // 2) client (core-owned, via gateway).
  const client = await coreGateway.clientsFindOrCreateByPhone(tenantId, {
    phoneE164: event.fromE164,
    name: event.profileName,
  });

  // 3) link contact → client se ainda não tem.
  if (!waContact.clientId) {
    await WhatsappContactsService.update(tenantId, waContact.id, {
      clientId: client.id,
    });
  }

  // 4) journey ativa (core-owned, via gateway). `wasCreated` é true quando
  //    a journey nasceu ou foi reaberta nesse inbound — propagado pro evento
  //    socket como `isNewLead` pra UI renderizar notificação "Novo Lead".
  const { journey, wasCreated: isNewLead } =
    await coreGateway.journeysFindOrCreateActive(tenantId, {
      clientId: client.id,
      source: 'whatsapp',
      sourceMetadata: { channel_id: channelId, contact_phone: event.fromE164 },
    });

  // 5) conversation domain (1 por par cliente×canal). Cada canal de WhatsApp
  //    gera sua própria timeline pra esse cliente — históricos não misturam.
  const conversation = await ConversationsService.findOrCreateForClientChannel(
    tenantId,
    client.id,
    channelId,
  );

  // 6) whatsapp_conversation (transport), linkada à conversation domain.
  const waConv = await WhatsappConversationsService.findOrCreate(
    tenantId,
    channelId,
    waContact.id,
    conversation.id
  );

  // 7) Persistência de mídia: pede o conteúdo DECODIFICADO ao provider e
  //    persiste no MinIO. URLs `audioMessage.url` etc no payload bruto
  //    apontam pra `.enc` cifrado do WhatsApp — baixar direto resulta em
  //    bytes que nenhum player toca. Provider (Evolution) descriptografa
  //    via `getBase64FromMediaMessage`. Falha degrada pra log + null
  //    (mensagem grava sem mediaUrl; UI mostra placeholder de erro).
  const storedMedia = event.media
    ? await persistInboundMedia(
        provider,
        tenantId,
        channelId,
        event.externalId,
        event.media,
        rawPayload,
      )
    : null;

  // 8) whatsapp_message (transport) — idempotente por external_id.
  const payloadType = event.media ? event.media.type : 'text';
  const payload: Record<string, unknown> = event.text
    ? { text: event.text }
    : { media: { ...event.media, objectKey: storedMedia?.objectKey } };
  const waMsg = await WhatsappMessagesService.recordInbound(tenantId, {
    whatsappConversationId: waConv.id,
    externalId: event.externalId,
    payloadType,
    payload,
    // Transport espelha o provider: timestamp cru do WhatsApp.
    sentAt: event.receivedAt,
  });

  // 9) message domain — idempotente por whatsapp_message_id. Tocará
  //    conversation.last_message_at automaticamente.
  // Caption de mídia (image/video) chega em event.media.caption e merece
  // virar `body` igual a texto puro — UI renderiza embaixo do preview na
  // mesma bolha, espelhando o WhatsApp.
  //
  // Reply: quando o webhook trouxe contextInfo.stanzaId, resolve via
  // externalId pra ligar o local id da msg citada. Pode dar miss (citação
  // aponta pra msg fora do nosso histórico — cliente respondendo a algo bem
  // antigo ou trocado pelo celular) — gravamos sem replyToMessageId nesse
  // caso, UI mostra a bolha normal sem o stub de citação.
  const replyToMessageId = event.replyToExternalId
    ? await resolveReplyTarget(tenantId, event.replyToExternalId)
    : undefined;

  const message = await MessagesService.createInbound(tenantId, {
    conversationId: conversation.id,
    journeyId: journey.id,
    whatsappMessageId: waMsg.id,
    kind: kindFromMedia(event.media),
    body: event.text ?? event.media?.caption,
    mediaUrl: storedMedia?.objectKey,
    mediaType: event.media?.type,
    replyToMessageId,
    sentAt,
  });

  // 10) touch last_inbound_at no transport (rastreia janela 24h) +
  //    opt-in implícito (cliente iniciou contato = consentimento). Pareado
  //    porque conceitualmente é o mesmo gatilho: "inbound chegou". Opt-in
  //    é conservador — só seta se ainda era null, preservando o timestamp
  //    original como auditoria.
  await WhatsappConversationsService.touchInbound(tenantId, waConv.id);
  await WhatsappContactsService.ensureInboundOptIn(
    tenantId,
    waContact.id,
    sentAt
  );

  // 11) publish evento canônico pro core (passo 9 vai consumir).
  await eventBus.publish(EVENT_CHANNELS.whatsappMessageReceived, {
    tenantId,
    channelId,
    whatsappConversationId: waConv.id,
    conversationId: conversation.id,
    whatsappMessageId: waMsg.id,
    messageId: message.id,
    clientId: client.id,
    receivedAt: sentAt.toISOString(),
    isNewLead,
  });
}

// Captura outbound feito direto pelo celular pareado (ver arquitetura.md §7.4).
// Dois subcasos que entram aqui (ambos com `fromMe=true` no webhook):
//   A. Eco do nosso próprio `sendText`/`sendMedia`/`sendTemplate` — externalId
//      já está em `whatsapp_messages` (salvo síncrono em sendOutbound). Drop
//      cedo, antes de qualquer write extra. É a maioria dos eventos.
//   B. Staff respondeu pelo WhatsApp do celular sem usar a UI — externalId
//      NOVO. Persistimos com `authored_on_device=true` no domain pra UI
//      mostrar marcador visual.
async function handleOutboundCaptured(
  provider: IWhatsAppProvider,
  tenantId: string,
  channelId: string,
  event: InboundMessageEvent,
  rawPayload: unknown,
  arrivedAt: Date,
): Promise<void> {
  // Dedup de eco — caminho mais quente. Olha o transport antes de tocar em
  // qualquer outra tabela. Se já existe, é eco do nosso envio: drop.
  const existing = await WhatsappMessagesService.findByExternalId(
    tenantId,
    event.externalId
  );
  if (existing) {
    logger.debug(
      { tenantId, channelId, externalId: event.externalId },
      '[normalizer] outbound eco — externalId já registrado, drop'
    );
    return;
  }

  // Mesmo relógio único do inbound (ver handleInbound). Sem amostra pro
  // clockSkewMonitor: o timestamp de mensagem enviada pelo celular pareado
  // pode refletir o relógio do próprio celular, não referência confiável.
  const sentAt = resolveMessageTimestamp(event.receivedAt, arrivedAt);

  // Aqui pra baixo: outbound NOVO (subcaso B). Resolve as mesmas entidades
  // que inbound — contact, client, journey, conversation — porque a mensagem
  // precisa aparecer na timeline do cliente certo. `fromE164` neste path é o
  // DESTINATÁRIO; mesmo número que viraria contact se ele fosse o remetente.
  const waContact = await WhatsappContactsService.findOrCreateByPhone(
    tenantId,
    channelId,
    event.fromE164
    // SEM profileName: pushName em fromMe=true seria nome do nosso canal,
    // não do contato. EvolutionAdapter já zera no parse, mas reforço aqui.
  );

  const client = await coreGateway.clientsFindOrCreateByPhone(tenantId, {
    phoneE164: event.fromE164,
  });

  if (!waContact.clientId) {
    await WhatsappContactsService.update(tenantId, waContact.id, {
      clientId: client.id,
    });
  }

  // Outbound capturado do celular pareado: wasCreated é irrelevante pra UI
  // (não notifica como "novo lead" — quem mandou foi a staff, não o cliente).
  const { journey } = await coreGateway.journeysFindOrCreateActive(tenantId, {
    clientId: client.id,
    source: 'whatsapp',
    sourceMetadata: { channel_id: channelId, contact_phone: event.fromE164 },
  });

  const conversation = await ConversationsService.findOrCreateForClientChannel(
    tenantId,
    client.id,
    channelId,
  );

  const waConv = await WhatsappConversationsService.findOrCreate(
    tenantId,
    channelId,
    waContact.id,
    conversation.id
  );

  // Detector de duplicação: se a UI enviou na mesma conversation nos últimos
  // ~10s, esse "outbound novo" é quase certamente eco do nosso envio com
  // externalId divergente do que persistimos (visto em prod com sendMedia
  // do Evolution v2 — id da resposta síncrona ≠ id do webhook). markUiOutbound
  // é chamado ANTES de provider.send no OutboundDeliveryWorker, então a flag
  // já está setada quando o eco chega — bloqueio é determinístico.
  //
  // Trade-off conhecido: outbound legítimo do celular pareado nos 10s seguintes
  // a um envio UI é descartado silenciosamente. Aceito pra V1: workflow real
  // raramente combina envio UI + envio celular na mesma conversa em <10s.
  if (hadRecentUiOutbound(tenantId, conversation.id)) {
    logger.info(
      {
        tenantId,
        channelId,
        externalId: event.externalId,
        conversationId: conversation.id,
        clientId: client.id,
      },
      '[normalizer] outbound eco bloqueado por recent UI flag — externalId divergiu do persistido (presumindo duplicação)'
    );
    return;
  }

  // Persiste mídia outbound do celular pareado no MinIO também — staff que
  // mandou foto direto do zap merece o mesmo histórico durável que envio
  // pela UI. Comportamento idêntico ao inbound (provider descriptografa).
  const storedMedia = event.media
    ? await persistInboundMedia(
        provider,
        tenantId,
        channelId,
        event.externalId,
        event.media,
        rawPayload,
      )
    : null;

  const payloadType = event.media ? event.media.type : 'text';
  const payload: Record<string, unknown> = event.text
    ? { text: event.text }
    : { media: { ...event.media, objectKey: storedMedia?.objectKey } };
  const waMsg = await WhatsappMessagesService.recordOutbound(tenantId, {
    whatsappConversationId: waConv.id,
    externalId: event.externalId,
    payloadType,
    payload,
    // Mensagem já saiu pelo celular; status real virá via MESSAGES_UPDATE.
    // Marcamos 'sent' como ponto de partida (vs. 'queued' do nosso outbound).
    status: 'sent',
    sentAt: event.receivedAt,
  });

  const replyToMessageId = event.replyToExternalId
    ? await resolveReplyTarget(tenantId, event.replyToExternalId)
    : undefined;

  const message = await MessagesService.createOutboundExternal(tenantId, {
    conversationId: conversation.id,
    journeyId: journey.id,
    whatsappMessageId: waMsg.id,
    kind: kindFromMedia(event.media),
    body: event.text ?? event.media?.caption,
    mediaUrl: storedMedia?.objectKey,
    mediaType: event.media?.type,
    replyToMessageId,
    sentAt,
  });

  // Touch last_outbound_at — outbound externo conta como atividade saindo
  // do canal pra fins de tracking. NÃO toca last_inbound_at (janela 24h
  // continua atrelada só a inbound do cliente).
  await WhatsappConversationsService.touchOutbound(tenantId, waConv.id);

  // Publica como `wa.message.sent` pra core repassar via socket. Mesmo canal
  // de evento que o outbound de UI usa — frontend trata via flag no payload.
  await eventBus.publish(EVENT_CHANNELS.whatsappMessageSent, {
    tenantId,
    channelId,
    whatsappConversationId: waConv.id,
    conversationId: conversation.id,
    whatsappMessageId: waMsg.id,
    messageId: message.id,
    clientId: client.id,
    authorUserId: null,
    authoredOnDevice: true,
    sentAt: sentAt.toISOString(),
  });
}

async function handleStatusUpdate(
  tenantId: string,
  channelId: string,
  event: InboundStatusEvent
): Promise<void> {
  const waMsg = await WhatsappMessagesService.updateStatusByExternalId(
    tenantId,
    event.externalId,
    event.status,
    event.error
  );

  if (!waMsg) {
    // Mensagem não foi originada por nós (admin testou fora, status veio
    // por engano, etc.). Log e drop.
    logger.debug(
      { tenantId, channelId, externalId: event.externalId, status: event.status },
      '[normalizer] status sem whatsapp_message correspondente — drop'
    );
    return;
  }

  // Reflete delivered/read no domain layer (timestamps em messages).
  const conversationId = await MessagesService.applyStatusUpdate(
    tenantId,
    waMsg.id,
    event.status,
    event.updatedAt
  );
  // Sem mensagem domain não há bolha pra atualizar — e sem conversa o core
  // não tem como rotear o evento.
  if (!conversationId) return;

  await eventBus.publish(EVENT_CHANNELS.whatsappStatusUpdated, {
    tenantId,
    channelId,
    conversationId,
    whatsappMessageId: waMsg.id,
    externalId: event.externalId,
    status: event.status,
    updatedAt: event.updatedAt.toISOString(),
  });
}

// Cliente editou mensagem dele (msg inbound nossa). Adapter já filtrou
// fromMe=true (eco do nosso editMessage) — aqui só recebemos edição real
// do cliente. UPDATE in-place no body, sem publish no bus (decisão de
// projeto — automações não re-disparam em edit).
async function handleMessageEdited(
  tenantId: string,
  channelId: string,
  event: InboundMessageEditedEvent,
): Promise<void> {
  await MessagesService.applyClientEdit(
    tenantId,
    event.externalId,
    event.text,
    event.editedAt,
  );
  logger.debug(
    { tenantId, channelId, externalId: event.externalId },
    '[normalizer] edição inbound aplicada',
  );
}

// Cliente apagou mensagem dele ("apagar pra todos" no app). Soft delete +
// publish no bus pra UI atualizar em tempo real. Adapter já filtrou eco
// de revoke nosso (fromMe=true).
async function handleMessageDeleted(
  tenantId: string,
  channelId: string,
  event: InboundMessageDeletedEvent,
): Promise<void> {
  await MessagesService.applyClientDelete(
    tenantId,
    channelId,
    event.externalId,
    event.deletedAt,
  );
  logger.debug(
    { tenantId, channelId, externalId: event.externalId },
    '[normalizer] deleção inbound aplicada',
  );
}

// Chamada de voz/vídeo. Cria entrada visual na timeline (kind='call').
// Resolve as mesmas entidades que inbound de texto — contact, client,
// journey, conversation — porque a notificação precisa aparecer na timeline
// do cliente certo. Diferente de mensagem normal: NÃO cria whatsapp_message
// (call não é msg no protocolo), NÃO toca last_inbound_at (janela 24h
// continua atrelada só a texto/mídia), NÃO chama ensureInboundOptIn.
async function handleCallReceived(
  tenantId: string,
  channelId: string,
  event: InboundCallEvent,
  arrivedAt: Date,
): Promise<void> {
  // Relógio único da timeline (ver handleInbound).
  const startedAt = resolveMessageTimestamp(event.startedAt, arrivedAt);

  const waContact = await WhatsappContactsService.findOrCreateByPhone(
    tenantId,
    channelId,
    event.fromE164,
  );

  const client = await coreGateway.clientsFindOrCreateByPhone(tenantId, {
    phoneE164: event.fromE164,
  });

  if (!waContact.clientId) {
    await WhatsappContactsService.update(tenantId, waContact.id, {
      clientId: client.id,
    });
  }

  const { journey, wasCreated: isNewLead } =
    await coreGateway.journeysFindOrCreateActive(tenantId, {
      clientId: client.id,
      source: 'whatsapp',
      sourceMetadata: { channel_id: channelId, contact_phone: event.fromE164 },
    });

  const conversation = await ConversationsService.findOrCreateForClientChannel(
    tenantId,
    client.id,
    channelId,
  );

  const message = await MessagesService.createCallMessage(tenantId, {
    conversationId: conversation.id,
    journeyId: journey.id,
    externalId: event.externalId,
    callDirection: 'inbound',
    status: event.status,
    durationSec: event.durationSec,
    startedAt,
  });

  // Reusa wa.message.received pra UI atualizar — frontend distingue via
  // message.kind='call' pra renderizar bolha de notificação em vez de bolha
  // de texto. Sem whatsapp_message, então whatsappMessageId vai como o
  // próprio messageId (campo serve só pra correlação no socket).
  await eventBus.publish(EVENT_CHANNELS.whatsappMessageReceived, {
    tenantId,
    channelId,
    whatsappConversationId: '',
    conversationId: conversation.id,
    whatsappMessageId: message.id,
    messageId: message.id,
    clientId: client.id,
    receivedAt: startedAt.toISOString(),
    isNewLead,
  });

  logger.debug(
    {
      tenantId,
      channelId,
      externalId: event.externalId,
      status: event.status,
    },
    '[normalizer] call recebida',
  );
}

// =====================================================================
// Helpers locais — persistência de mídia + classificação de kind
// =====================================================================

// Sticker recebido vira `kind='sticker'` (categoria própria pra UI distinguir
// renderização — bolha sem background, sem botão de download). Outros tipos
// de mídia vão pra 'media' genérico; o tipo específico fica em `mediaType`.
function kindFromMedia(
  media: MediaPayload | undefined,
): 'text' | 'media' | 'sticker' {
  if (!media) return 'text';
  if (media.type === 'sticker') return 'sticker';
  return 'media';
}

// Persiste mídia inbound em duas estratégias, em ordem:
//   1. Pede o conteúdo decodificado ao provider (Evolution chama
//      `getBase64FromMediaMessage` e descriptografa o `.enc` do WhatsApp).
//      Esse é o caminho correto pra mídia real — player do browser toca.
//   2. Fallback pra download direto da URL (`media.url`). Útil pro
//      MockAdapter (URLs públicas de placeholder) e como degradação se o
//      endpoint decodificador falhar.
// Erro persistente degrada pra log + null — a mensagem ainda é gravada
// (sem mediaUrl), UI mostra placeholder. Re-tentativa do BullMQ raramente
// resolve URL cifrada do WhatsApp expira em poucas horas.
async function persistInboundMedia(
  provider: IWhatsAppProvider,
  tenantId: string,
  channelId: string,
  externalId: string,
  media: MediaPayload,
  rawPayload: unknown,
): Promise<{ objectKey: string } | null> {
  // Caminho 1: buffer decodificado pelo provider.
  try {
    const decoded = await provider.fetchInboundMediaBuffer(rawPayload);
    if (decoded) {
      const result = await MediaStorage.persistInboundMediaBuffer({
        tenantId,
        channelId,
        externalId,
        buffer: decoded.buffer,
        mimeType: decoded.mimeType,
        filename: decoded.filename ?? media.filename,
      });
      return { objectKey: result.objectKey };
    }
  } catch (err) {
    logger.warn(
      {
        tenantId,
        channelId,
        externalId,
        mediaType: media.type,
        err: err instanceof Error ? err.message : err,
      },
      '[normalizer] fetchInboundMediaBuffer falhou — tentando fallback de URL',
    );
  }

  // Caminho 2: fallback pra URL (Mock, ou Evolution offline). Pra mídia
  // real do WhatsApp isso baixa bytes cifrados — player não toca — mas a
  // entrada na timeline ainda é preservada como placeholder até o admin
  // decidir o que fazer.
  if (!media.url) return null;
  try {
    const result = await MediaStorage.persistInboundMedia({
      tenantId,
      channelId,
      externalId,
      sourceUrl: media.url,
      mimeType: media.mimeType,
      filename: media.filename,
    });
    return { objectKey: result.objectKey };
  } catch (err) {
    logger.warn(
      {
        tenantId,
        channelId,
        externalId,
        mediaType: media.type,
        err: err instanceof Error ? err.message : err,
      },
      '[normalizer] falha ao persistir mídia inbound — message gravada sem mediaUrl',
    );
    return null;
  }
}

// Resolve o local id da mensagem citada a partir do externalId do provider.
// Webhook traz contextInfo.stanzaId — bate com whatsapp_messages.external_id
// no nosso registro. Se não bater (citação aponta pra msg fora do histórico),
// retorna undefined; gravamos sem reply e UI mostra a bolha normal.
async function resolveReplyTarget(
  tenantId: string,
  externalId: string,
): Promise<string | undefined> {
  const target = await withTenant(db, tenantId, (tx) =>
    MessagesQuery.findByExternalId(tx, externalId),
  );
  return target?.id;
}

import {
  type ContractStatusChangedEvent,
  type ConversationTagsUpdatedEvent,
  EVENT_CHANNELS,
  type EventChannel,
  type EventPayloadByChannel,
  type LeadCreatedEvent,
  type MessageCreatedEvent,
  type ProcedureSessionAttendanceRecordedEvent,
  type ProcedureSessionEvolvedEvent,
  SOCKET_ROOMS,
  type WhatsappChannelConnectionChangedEvent,
  type WhatsappMessageReceivedEvent,
  type WhatsappMessageRevokedEvent,
  type WhatsappMessageSentEvent,
  type WhatsappMessageStatusChangedEvent,
  type WhatsappStatusUpdatedEvent,
} from '@elora/events-contracts';
import { ChatPushNotifier } from '../../modules/pushSubscriptions/ChatPushNotifier.js';
import { logger } from '../observability/logger.js';
import { redisSubscriber } from '../redis/redis.js';
import type { ElorIoServer } from './socketServer.js';

// =====================================================================
// Bridge Redis pub/sub → Socket.IO. Roda 1 vez no boot, subscreve nos
// canais canônicos publicados pelo apps/chat e repassa pra(s) sala(s)
// apropriada(s).
//
// Tópicos no Redis ≠ salas no socket.io. Topic é "tipo de evento"; sala é
// "público dele":
//   - eventos de chat → sala `chat` do tenant (quem tem chat:use). Nada de
//     conversa vai pra sala do tenant inteiro.
//   - eventos de clínica (contratos, presença, evolução, lead) → sala do
//     tenant.
// Payloads são só IDs; o frontend refetcha via HTTP.
// =====================================================================

const SUBSCRIBED_CHANNELS: EventChannel[] = [
  EVENT_CHANNELS.whatsappMessageReceived,
  EVENT_CHANNELS.whatsappMessageSent,
  EVENT_CHANNELS.whatsappStatusUpdated,
  EVENT_CHANNELS.whatsappChannelConnectionChanged,
  EVENT_CHANNELS.whatsappMessageRevoked,
  EVENT_CHANNELS.leadCreated,
  EVENT_CHANNELS.messageCreated,
  EVENT_CHANNELS.whatsappMessageStatusChanged,
  EVENT_CHANNELS.contractStatusChanged,
  EVENT_CHANNELS.procedureSessionAttendanceRecorded,
  EVENT_CHANNELS.procedureSessionEvolved,
  EVENT_CHANNELS.conversationTagsUpdated,
];

let started = false;

export async function startRedisSubscriber(io: ElorIoServer): Promise<void> {
  if (started) return;
  started = true;

  await redisSubscriber.subscribe(...SUBSCRIBED_CHANNELS);

  redisSubscriber.on('message', (channel, raw) => {
    try {
      const payload = JSON.parse(raw) as EventPayloadByChannel[EventChannel];
      dispatch(io, channel as EventChannel, payload);
    } catch (err) {
      logger.error(
        {
          channel,
          err: err instanceof Error ? err.message : err,
          raw: raw.slice(0, 200),
        },
        '[redisSubscriber] falha ao parsear payload'
      );
    }
  });

  logger.info(
    { channels: SUBSCRIBED_CHANNELS },
    '[redisSubscriber] iniciado'
  );
}

export async function stopRedisSubscriber(): Promise<void> {
  if (!started) return;
  await redisSubscriber.unsubscribe(...SUBSCRIBED_CHANNELS);
  started = false;
}

// Roteia evento → sala. Mantemos exhaustive switch pra forçar erro de
// type quando um canal novo entrar (TypeScript valida).
function dispatch(
  io: ElorIoServer,
  channel: EventChannel,
  payload: EventPayloadByChannel[EventChannel]
): void {
  switch (channel) {
    case EVENT_CHANNELS.whatsappMessageReceived: {
      const p = payload as WhatsappMessageReceivedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.message.received', p);
      // Push pro aparelho de quem não está com o app na frente. Não espera:
      // envio pros serviços de push pode levar segundos e não pode atrasar
      // o próximo evento. Nunca lança (loga internamente).
      void ChatPushNotifier.notifyMessageReceived(p);
      return;
    }
    case EVENT_CHANNELS.whatsappMessageSent: {
      const p = payload as WhatsappMessageSentEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.message.sent', p);
      return;
    }
    case EVENT_CHANNELS.whatsappStatusUpdated: {
      // Tiques de entregue/lido. Chat só publica quando há mensagem domain
      // (payload traz conversationId).
      const p = payload as WhatsappStatusUpdatedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.status.updated', p);
      return;
    }
    case EVENT_CHANNELS.whatsappMessageRevoked: {
      // Mensagem apagada (pela equipe ou pelo cliente) — bolha vira
      // "mensagem apagada" ao vivo.
      const p = payload as WhatsappMessageRevokedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.message.revoked', p);
      return;
    }
    case EVENT_CHANNELS.whatsappChannelConnectionChanged: {
      // Estado do canal — indicador na inbox e nas telas de canal.
      const p = payload as WhatsappChannelConnectionChangedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.channel.connection_changed', p);
      return;
    }
    case EVENT_CHANNELS.messageCreated: {
      // Bolha pending recém-inserida (antes do envio). Inbox sobe a conversa
      // pro topo; quem está com ela aberta refetcha as mensagens.
      const p = payload as MessageCreatedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('message.created', p);
      return;
    }
    case EVENT_CHANNELS.whatsappMessageStatusChanged: {
      // pending → sent/failed/rejected (spinner → check ou alerta laranja).
      const p = payload as WhatsappMessageStatusChangedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('wa.message.status_changed', p);
      return;
    }
    case EVENT_CHANNELS.conversationTagsUpdated: {
      // Tags da conversa (re)aplicadas (humano ou agente IA).
      const p = payload as ConversationTagsUpdatedEvent;
      io.to(SOCKET_ROOMS.chat(p.tenantId)).emit('conversation.tags_updated', p);
      return;
    }
    case EVENT_CHANNELS.leadCreated: {
      // Lead novo via canal NÃO-WhatsApp (form, sheets, manual...). Badge e
      // board de leads do tenant inteiro; frontend filtra toast por source.
      const p = payload as LeadCreatedEvent;
      io.to(SOCKET_ROOMS.tenant(p.tenantId)).emit('lead.created', p);
      return;
    }
    case EVENT_CHANNELS.contractStatusChanged: {
      // Contrato viewed/signed/declined/expired — telas de contrato e ficha
      // do cliente compartilham a mesma query key.
      const p = payload as ContractStatusChangedEvent;
      io.to(SOCKET_ROOMS.tenant(p.tenantId)).emit('contract.status_changed', p);
      return;
    }
    case EVENT_CHANNELS.procedureSessionAttendanceRecorded: {
      // Presença assinada — agenda repinta o card como atendido.
      const p = payload as ProcedureSessionAttendanceRecordedEvent;
      io.to(SOCKET_ROOMS.tenant(p.tenantId)).emit('procedure_session_attendance.recorded', p);
      return;
    }
    case EVENT_CHANNELS.procedureSessionEvolved: {
      // Evolução clínica encerrada — /evolutions e /agenda repintam.
      const p = payload as ProcedureSessionEvolvedEvent;
      io.to(SOCKET_ROOMS.tenant(p.tenantId)).emit('procedure_session.evolved', p);
      return;
    }
  }
}

import type { ChatPushPayload } from './PushSubscriptionsTypes.js';

// =====================================================================
// Montagem pura do conteúdo da notificação — sem DB, testável. Espelha
// as regras de exibição do front (lib/conversationDisplay.ts e
// previewFallback em hooks/useChatRealtime.ts) pra notificação do sistema
// e a tela mostrarem o mesmo nome e o mesmo resumo.
// =====================================================================

export const PUSH_PREVIEW_MAX = 120;

export type MessageKind = 'text' | 'media' | 'template' | 'system' | 'sticker' | 'call';
export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'sticker';

export interface ChatPushSource {
  conversationId: string;
  isNewLead: boolean;
  receivedAt: string;
  clientName: string | null;
  clientTradeName: string | null;
  contactProfileName: string | null;
  contactPhoneE164: string | null;
  messageBody: string | null;
  messageKind: MessageKind | null;
  messageMediaType: MediaType | null;
}

// Mesmo formato do displayPhone do front: +55 (DD) 9XXXX-XXXX.
export function displayPhone(e164: string | null): string {
  if (!e164) return '';
  if (!e164.startsWith('+55')) return e164;
  const rest = e164.slice(3);
  if (rest.length === 11) return `+55 (${rest.slice(0, 2)}) ${rest.slice(2, 7)}-${rest.slice(7)}`;
  if (rest.length === 10) return `+55 (${rest.slice(0, 2)}) ${rest.slice(2, 6)}-${rest.slice(6)}`;
  return e164;
}

export function conversationTitle(src: ChatPushSource): string {
  const clientName = src.clientTradeName?.trim() || src.clientName?.trim();
  // Cliente nascido do WhatsApp sem nome de perfil recebe o próprio E.164
  // como placeholder (LocalCoreGateway) — exibe o telefone formatado.
  if (clientName && clientName !== src.contactPhoneE164) return clientName;
  return src.contactProfileName?.trim() || displayPhone(src.contactPhoneE164) || 'Contato';
}

const MEDIA_LABEL: Record<MediaType, string> = {
  image: '📷 Foto',
  audio: '🎤 Áudio',
  video: '🎥 Vídeo',
  document: '📄 Documento',
  sticker: 'Figurinha',
};

export function messagePreview(src: ChatPushSource): string {
  const body = src.messageBody?.trim();
  if (src.messageKind === 'media' && src.messageMediaType) {
    const label = MEDIA_LABEL[src.messageMediaType];
    // Foto/vídeo com legenda: "📷 Foto: legenda".
    return body ? truncate(`${label}: ${body}`) : label;
  }
  if (body) return truncate(body);
  switch (src.messageKind) {
    case 'media':
      return 'Mídia';
    case 'sticker':
      return 'Figurinha';
    case 'call':
      return '📞 Chamada';
    default:
      return 'Nova mensagem';
  }
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > PUSH_PREVIEW_MAX
    ? `${oneLine.slice(0, PUSH_PREVIEW_MAX - 1)}…`
    : oneLine;
}

export function buildChatPushPayload(src: ChatPushSource): ChatPushPayload {
  const title = conversationTitle(src);
  return {
    type: 'chat.message',
    title: src.isNewLead ? `Novo lead: ${title}` : title,
    body: messagePreview(src),
    tag: `conversation:${src.conversationId}`,
    conversationId: src.conversationId,
    url: `/?conversation=${src.conversationId}`,
    isNewLead: src.isNewLead,
    timestamp: Date.parse(src.receivedAt) || Date.now(),
  };
}

// Topic do Web Push: o serviço de push troca a mensagem pendente de mesmo
// topic pela nova (aparelho offline acorda com 1 por conversa). UUID sem
// hífens = 32 hex, exatamente o máximo permitido.
export function conversationTopic(conversationId: string): string {
  return conversationId.replace(/-/g, '');
}

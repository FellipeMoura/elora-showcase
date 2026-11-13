import type { InferSelectModel, whatsappConversations } from '@elora/db';

export type WhatsappConversation = InferSelectModel<typeof whatsappConversations>;

// Janela de 24h pra Cloud API: se last_inbound_at > now() - 24h, podemos
// mandar texto livre. Fora dessa janela, só template aprovado (arquitetura.md
// §7.3 + chat-domain.md §9 nível 3).
export interface WindowStatus {
  withinInboundWindow: boolean;
  lastInboundAt: Date | null;
  hoursUntilExpiry: number | null;
}

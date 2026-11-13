-- conversations: muda de 1-por-cliente pra 1-por-(cliente, canal). Decisão
-- de produto: cada canal tem identidade própria; histórico não deve misturar.
--
-- Migration destrutiva: TRUNCATE no início pra resolver o ADD COLUMN NOT NULL
-- sem default (e porque populate por backfill exigiria SQL complexo pra um
-- dataset que em dev é só de testes — combinado com o user).
-- Cascata limpa messages e whatsapp_conversations.conversation_id.
TRUNCATE "conversations" CASCADE;--> statement-breakpoint

ALTER TABLE "conversations" DROP CONSTRAINT "conversations_client_unique";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "whatsapp_channel_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsapp_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("whatsapp_channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_channel_idx" ON "conversations" USING btree ("whatsapp_channel_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_channel_unique" UNIQUE("client_id","whatsapp_channel_id");

import type { InferSelectModel, clients, journeys } from '@elora/db';

// =====================================================================
// CoreGateway — fronteira entre apps/chat e o que (eventualmente) vai
// virar HTTP interno pro apps/core.
//
// Por que existe: o webhook normalizer precisa CRIAR `clients` e
// `journeys` quando inbound novo chega (chat-domain.md §11.1). Essas
// tabelas conceitualmente pertencem ao core (donas das regras de
// duplicidade, validação E.164, dedupe de journey ativa, etc.). Mas o
// core ainda não tem esses módulos.
//
// Compromisso (decidido em 2026-05-13): chat escreve direto no DB hoje
// (RLS protege isolamento entre tenants), por trás dessa interface.
// Quando core ganhar `modules/clients` e `modules/journeys`, criamos
// `HttpCoreGateway implements CoreGateway` que faz chamada interna
// (X-Internal-Auth) e trocamos o singleton em `index.ts`. ZERO mudança
// nos call sites do normalizer.
//
// Regra: TUDO que escreve em tabela que vai virar do core passa por
// aqui. Reads diretos via tx ficam no chat (RLS aplica) — gateway é só
// pra writes que migram.
// =====================================================================

export type Client = InferSelectModel<typeof clients>;
export type Journey = InferSelectModel<typeof journeys>;

export interface FindOrCreateClientInput {
  phoneE164: string;
  // Nome vindo do profile do WhatsApp quando inbound novo. Opcional pra
  // permitir criação por outras fontes (form, manual) no futuro.
  name?: string;
}

export interface FindOrCreateActiveJourneyInput {
  clientId: string;
  // Quando o normalizer cria por inbound do WhatsApp, sempre 'whatsapp'.
  // Mantido genérico pra outras fontes (form, sheets) chamarem o mesmo
  // gateway no futuro.
  source: 'whatsapp' | 'form' | 'sheets' | 'manual' | 'recycling' | 'imported' | 'other';
  sourceMetadata?: Record<string, unknown>;
}

export interface CoreGateway {
  // Idempotente por (tenant_id, phone_e164). Se cliente já existe, retorna —
  // não sobrescreve nome. Lógica de "atualizar nome quando profile muda"
  // fica no caller (whatsapp_contacts.profile_name é a fonte de verdade pro
  // nome WhatsApp; clients.name é o nome "oficial" da recepção).
  clientsFindOrCreateByPhone(
    tenantId: string,
    input: FindOrCreateClientInput
  ): Promise<Client>;

  // Idempotente por (client_id, status='active'). Cliente pode ter no
  // máximo 1 journey ativa por vez (chat-domain.md §5 — off-ramps pra
  // lost antes de criar nova).
  //
  // Se cliente JÁ tem journey ativa, retorna a existente — não cria nova.
  // Caso contrário, cria com stage=lead, status=active e registra
  // journey_event de criação.
  //
  // `wasCreated=true` cobre tanto criação nova quanto reabertura de journey
  // 'lost' por inbound espontâneo (source='whatsapp'): em ambos os casos
  // não havia journey ativa antes desta call, e o frontend deve tratar como
  // "novo lead" pra fins de notificação.
  journeysFindOrCreateActive(
    tenantId: string,
    input: FindOrCreateActiveJourneyInput
  ): Promise<{ journey: Journey; wasCreated: boolean }>;

  // Read-only: retorna a journey ativa do cliente (no máximo 1 por
  // invariante §5) ou null. Usado pelo MessagesService pra resolver
  // `journeyId` em outbounds que vêm da UI sem o campo — garante que a
  // mensagem fique linkada à journey, alimentando o compute do
  // `lead_substage`.
  journeysFindActiveByClient(
    tenantId: string,
    clientId: string
  ): Promise<Journey | null>;

  // Atualiza `journeys.last_activity_at = NOW()`. Chamado em toda ação
  // de staff que conta como atividade (chat-domain.md §10.1):
  //   - outbound enviado
  //   - quote criado/editado/reenviado
  //   - stage movido manualmente
  //   - appointment criado/movido
  //   - internal note registrada
  // Inbound do cliente NÃO chama isso. Idempotente — chamadas repetidas
  // só atualizam o timestamp.
  journeysTouchActivity(tenantId: string, journeyId: string): Promise<void>;

  // Recalcula `journeys.lead_substage` baseado no estado atual de messages,
  // appointments e quotes (chat-domain.md §5.1 extensão 2026-05). Idempotente —
  // se já está correto, no-op. Só age quando stage='lead'. Chamado pelos
  // services do chat quando outbound/inbound é registrado, pra mover entre
  // 'new' → 'template' → 'contact'. Cascatas de appointments/quotes que
  // alteram precedência maior (scheduled/no_show/rescheduled/quoted) vêm
  // dos services do core (mesma função, chamada local).
  //
  // `reason` vai pro payload do journey_event 'lead_substage_changed'.
  journeysRecomputeLeadSubstage(
    tenantId: string,
    journeyId: string,
    reason: string
  ): Promise<void>;
}

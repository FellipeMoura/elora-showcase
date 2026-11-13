import {
  and,
  clients,
  eq,
  journeyEvents,
  journeys,
  sql,
  whatsappChannels,
  whatsappContacts,
  withTenant,
  type ClientAddress,
  type Tx,
} from '@elora/db';
import { EVENT_CHANNELS, type LeadCreatedEvent } from '@elora/events-contracts';
import { db } from '../database/db.js';
import { AppError } from '../errors/AppError.js';
import { eventBus } from '../eventBus/eventBus.js';
import { logger } from '../observability/logger.js';

// =====================================================================
// Helper canônico de criação de lead via canal NÃO-WhatsApp.
//
// Todas as origens externas (manual via UI, form de landing page, sync
// Google Sheets, importação em massa, reciclagem de cliente perdido)
// passam por aqui. Garante por construção que:
//   1. cliente existe ou é criado pelo helper (find-or-create por phone),
//   2. cliente não tem journey ativa (invariante "1 active por cliente"),
//   3. journey nasce com stage='lead', substage='new', status='active',
//   4. evento `journey_created` é registrado,
//   5. (opcional) whatsapp_contact é criado/vinculado no canal default,
//   6. evento socket `lead.created` é publicado **depois do commit** pra
//      garantir que o frontend nunca recebe notificação de algo que
//      ainda não vê no DB.
//
// Quem NÃO usa este helper: o pipeline inbound do apps/chat (que cria
// journey via `LocalCoreGateway.journeysFindOrCreateActive` e já publica
// `wa.message.received`, que o frontend usa pra invalidar leads também).
// =====================================================================

export type ExternalLeadSource =
  | 'manual'
  | 'form'
  | 'sheets'
  | 'recycling'
  | 'imported'
  | 'other';

// Subset de campos de cliente aceitos no cadastro inline. Mantemos enxuto
// — campos opcionais clínicos (notes, isVip, birthDate) ficam de fora e
// podem ser editados depois via PATCH /clients/:id.
export interface CreateExternalLeadClientData {
  name: string;
  phoneE164: string;
  email?: string | null;
  birthDate?: string | null;
  document?: string | null;
  address?: ClientAddress | null;
  notes?: string | null;
  isVip?: boolean;
}

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export interface CreateExternalLeadInput {
  // EXCLUSIVO com `clientData`: caller passa um ou o outro. `clientId`
  // representa cliente já cadastrado (caminho de reciclagem, ou integrações
  // futuras que recebem ID resolvido). `clientData` representa cadastro
  // inline (form único do frontend que cria cliente + lead numa ação).
  clientId?: string;
  clientData?: CreateExternalLeadClientData;
  source: ExternalLeadSource;
  sourceMetadata?: Record<string, unknown>;
  // Quando true e o tenant tem canal WhatsApp default, cria um
  // whatsapp_contact vinculando phone+canal+cliente. Frontend só deve
  // setar true depois que GET /whatsapp/numbers/check confirmou que o
  // número existe no WhatsApp. Best-effort: se não há canal disponível
  // ou criação falha por motivo recuperável, journey é criada mesmo
  // assim (UX trata como "lead sem contato WhatsApp").
  createWhatsappContact?: boolean;
  // E.164 que o WhatsApp efetivamente reconhece — vem do mesmo check que
  // disparou `createWhatsappContact`. Quando ausente, contact é criado
  // com `whatsappE164=null` e o outbound worker faz lazy backfill no
  // primeiro envio.
  whatsappE164?: string;
  // Permite ao caller adicionar payload customizado ao journey_event de
  // criação (ex: form_id, sheet_row, recycled_from). Mescla com os campos
  // base sem sobrescrevê-los.
  eventPayloadExtra?: Record<string, unknown>;
  // Tipo do event a registrar. Default 'journey_created' — recycling
  // sobrescreve com 'recycled_from'. Mantém audit trail rico sem inflar
  // este helper com lógicas específicas de cada canal.
  eventType?: 'journey_created' | 'recycled_from';
}

export interface CreateExternalLeadResult {
  journeyId: string;
  clientId: string;
  clientName: string;
  source: ExternalLeadSource;
  createdAt: string;
  whatsappContactId: string | null;
}

export async function createExternalLead(
  tenantId: string,
  input: CreateExternalLeadInput,
  actorUserId: string | null
): Promise<CreateExternalLeadResult> {
  if ((input.clientId && input.clientData) || (!input.clientId && !input.clientData)) {
    throw new AppError(
      'createExternalLead: forneça exatamente um entre clientId e clientData',
      500,
    );
  }

  const result = await withTenant(db, tenantId, async (tx) => {
    // 1. Resolve cliente — existente ou novo.
    const client = await resolveClient(tx, tenantId, input);

    // 2. Invariante "1 active por cliente" — retorna 409 com o id da ativa
    // pra UI redirecionar pro lead existente.
    const [existing] = await tx
      .select({ id: journeys.id })
      .from(journeys)
      .where(
        and(eq(journeys.clientId, client.id), eq(journeys.status, 'active'))
      )
      .limit(1);
    if (existing) {
      throw new AppError('Cliente já possui uma jornada ativa', 409, {
        activeJourneyId: existing.id,
      });
    }

    // 3. Cria journey lead.
    const [created] = await tx
      .insert(journeys)
      .values({
        tenantId,
        clientId: client.id,
        stage: 'lead',
        source: input.source,
        sourceMetadata: input.sourceMetadata ?? {},
        status: 'active',
        leadSubstage: 'new',
      })
      .returning({ id: journeys.id, createdAt: journeys.createdAt });
    if (!created) throw new AppError('Falha ao criar lead', 500);

    // 4. Audit trail.
    await tx.insert(journeyEvents).values({
      tenantId,
      journeyId: created.id,
      eventType: input.eventType ?? 'journey_created',
      payload: {
        source: input.source,
        sourceMetadata: input.sourceMetadata ?? {},
        createdVia: 'createExternalLead',
        ...(input.eventPayloadExtra ?? {}),
      } as Record<string, unknown>,
      actorUserId,
    });

    // 5. WhatsApp contact opcional. Falha graciosamente — log warn e segue.
    let whatsappContactId: string | null = null;
    if (input.createWhatsappContact) {
      whatsappContactId = await tryCreateWhatsappContact(
        tx,
        tenantId,
        client.id,
        client.phoneE164,
        client.name,
        input.source,
        input.whatsappE164 ?? null,
      );
    }

    return {
      journeyId: created.id,
      clientId: client.id,
      clientName: client.name,
      source: input.source,
      createdAt: created.createdAt.toISOString(),
      whatsappContactId,
    } satisfies CreateExternalLeadResult;
  });

  // 6. Publica AFTER commit. eventBus é best-effort — falha de publish é
  // logada e não interrompe (entidade já existe no DB; pior caso é badge
  // atrasar até polling/refetch).
  const event: LeadCreatedEvent = {
    tenantId,
    journeyId: result.journeyId,
    clientId: result.clientId,
    clientName: result.clientName,
    source: result.source,
    createdAt: result.createdAt,
  };
  await eventBus.publish(EVENT_CHANNELS.leadCreated, event);

  return result;
}

// ---------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------

async function resolveClient(
  tx: Tx,
  tenantId: string,
  input: CreateExternalLeadInput,
): Promise<{ id: string; name: string; phoneE164: string }> {
  if (input.clientId) {
    const [existing] = await tx
      .select({
        id: clients.id,
        name: clients.name,
        phoneE164: clients.phoneE164,
      })
      .from(clients)
      .where(eq(clients.id, input.clientId))
      .limit(1);
    if (!existing) throw new AppError('Cliente não encontrado', 404);
    return existing;
  }

  // Cadastro inline. Frontend já chamou /clients/check antes — duplicidade
  // aqui é race ou bypass do frontend. Unique (tenant_id, phone_e164) cuida.
  const data = input.clientData!;
  try {
    const [created] = await tx
      .insert(clients)
      .values({
        tenantId,
        name: data.name,
        phoneE164: data.phoneE164,
        email: data.email ?? null,
        birthDate: data.birthDate ?? null,
        document: data.document ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        isVip: data.isVip ?? false,
      })
      .returning({
        id: clients.id,
        name: clients.name,
        phoneE164: clients.phoneE164,
      });
    if (!created) throw new AppError('Falha ao criar cliente', 500);
    return created;
  } catch (err) {
    if (isPgError(err) && err.code === '23505') {
      throw new AppError(
        'Já existe um cliente com este telefone neste tenant',
        409,
      );
    }
    throw err;
  }
}

// Cria (ou linka) whatsapp_contact pelo canal default do tenant. Retorna
// o id do contact ou null quando nada foi criado (sem canal disponível).
//
// Cenários cobertos:
//   - Canal default não existe → null + log info.
//   - Já existe contact (channel, phone) sem clientId → vincula ao cliente.
//   - Já existe contact (channel, phone) já vinculado → idempotente, retorna o existente.
//   - Não existe → insere com active=true.
//
// Opt-in: criação por staff via UI é o momento real de captura de consentimento
// (cliente entregou o telefone explicitamente). Gravamos `opted_in_at=now()` +
// `opt_in_source=<source do lead>` pra registrar o trail — `'manual'` quando
// recepção cadastra, `'form'` quando landing page, etc.
//
// Regra conservadora (igual `ensureInboundOptIn` no chat): só **define** opt-in
// quando ele ainda é null. Quando o contato já tinha opt-in (de inbound prévio
// ou registro manual anterior), preserva o timestamp original como auditoria
// de "quando o consentimento começou".
async function tryCreateWhatsappContact(
  tx: Tx,
  tenantId: string,
  clientId: string,
  phoneE164: string,
  profileName: string,
  source: ExternalLeadSource,
  whatsappE164: string | null,
): Promise<string | null> {
  const [channel] = await tx
    .select({ id: whatsappChannels.id })
    .from(whatsappChannels)
    .where(eq(whatsappChannels.active, true))
    .orderBy(
      sql`CASE WHEN ${whatsappChannels.connectionState} = 'open' THEN 0 ELSE 1 END`,
      whatsappChannels.createdAt,
    )
    .limit(1);

  if (!channel) {
    logger.info(
      { tenantId, clientId },
      '[createExternalLead] tenant sem canal WhatsApp — lead criado sem contact',
    );
    return null;
  }

  const [existing] = await tx
    .select({
      id: whatsappContacts.id,
      clientId: whatsappContacts.clientId,
      optedInAt: whatsappContacts.optedInAt,
      whatsappE164: whatsappContacts.whatsappE164,
    })
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.whatsappChannelId, channel.id),
        eq(whatsappContacts.phoneE164, phoneE164),
      ),
    )
    .limit(1);

  if (existing) {
    // Já existe — vincula ao cliente se ainda não estava vinculado, garante
    // active=true. Se já estava vinculado a outro cliente, o
    // clients_tenant_phone_unique JÁ teria explodido na criação do cliente,
    // então esse branch só roda quando é o mesmo cliente ou contato anônimo.
    // Aproveita pra cachear `whatsappE164` se o caller resolveu agora e o
    // contato ainda não tinha — vale tanto pro caso anonymous→linkado
    // quanto pro idempotente (recadastro).
    const setOptIn = existing.clientId === null && existing.optedInAt === null;
    const setWhatsappE164 =
      whatsappE164 !== null && existing.whatsappE164 === null;
    if (existing.clientId === null || setWhatsappE164) {
      await tx
        .update(whatsappContacts)
        .set({
          ...(existing.clientId === null && { clientId, active: true }),
          ...(setOptIn && {
            optedInAt: new Date(),
            optInSource: source,
          }),
          ...(setWhatsappE164 && { whatsappE164 }),
        })
        .where(eq(whatsappContacts.id, existing.id));
    }
    return existing.id;
  }

  try {
    const [created] = await tx
      .insert(whatsappContacts)
      .values({
        tenantId,
        whatsappChannelId: channel.id,
        phoneE164,
        whatsappE164,
        clientId,
        profileName,
        active: true,
        // Novo contato criado direto pelo staff = momento de opt-in. Sem
        // isso o primeiro outbound bate 403 ("sem opt-in") e força clique
        // de banner — fricção sem benefício pro caminho feliz.
        optedInAt: new Date(),
        optInSource: source,
      })
      .returning({ id: whatsappContacts.id });
    return created?.id ?? null;
  } catch (err) {
    // 23505 cobre dois constraints: (channel, phone) — já tratado acima por
    // re-query — e o partial unique (client, active). Se cair aqui, é race
    // raro. Log e segue sem contact.
    if (isPgError(err) && err.code === '23505') {
      logger.warn(
        { tenantId, clientId, channelId: channel.id, phoneE164 },
        '[createExternalLead] race em whatsapp_contacts — lead criado sem contact',
      );
      return null;
    }
    throw err;
  }
}

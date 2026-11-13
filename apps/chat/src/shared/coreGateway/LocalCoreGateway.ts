import {
  and,
  clients,
  eq,
  journeyEvents,
  journeys,
  recomputeLeadSubstage,
  tryReopenJourneyForClient,
  withTenant,
} from '@elora/db';
import { db } from '../database/db.js';
import { logger } from '../observability/logger.js';
import type {
  Client,
  CoreGateway,
  FindOrCreateActiveJourneyInput,
  FindOrCreateClientInput,
  Journey,
} from './CoreGateway.js';

// =====================================================================
// LocalCoreGateway — escreve direto no DB usando withTenant (RLS efetiva).
// Substituído por HttpCoreGateway quando o core tiver os módulos de
// clients/journeys e expuser internal routes.
// =====================================================================
export class LocalCoreGateway implements CoreGateway {
  async clientsFindOrCreateByPhone(
    tenantId: string,
    input: FindOrCreateClientInput
  ): Promise<Client> {
    return withTenant(db, tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(clients)
        .where(eq(clients.phoneE164, input.phoneE164))
        .limit(1);
      if (existing) return existing;

      // ON CONFLICT em vez de catch de 23505: depois do erro o Postgres
      // aborta a transação e o re-fetch falharia. Race: dois inbound do
      // mesmo phone simultâneos — unique(tenant_id, phone_e164) serializa e
      // quem perde lê o cliente do vencedor.
      const [created] = await tx
        .insert(clients)
        .values({
          tenantId,
          phoneE164: input.phoneE164,
          // Sem name vindo do WhatsApp, usa o próprio telefone como
          // placeholder. Recepção edita depois. NOT NULL no schema —
          // não pode ficar vazio.
          name: input.name?.trim() || input.phoneE164,
        })
        .onConflictDoNothing({ target: [clients.tenantId, clients.phoneE164] })
        .returning();
      if (created) {
        logger.info(
          { tenantId, clientId: created.id, phone: input.phoneE164 },
          '[CoreGateway] client criado por inbound WhatsApp'
        );
        return created;
      }
      const [reread] = await tx
        .select()
        .from(clients)
        .where(eq(clients.phoneE164, input.phoneE164))
        .limit(1);
      if (!reread) throw new Error('Falha ao inserir client');
      return reread;
    });
  }

  async journeysFindOrCreateActive(
    tenantId: string,
    input: FindOrCreateActiveJourneyInput
  ): Promise<{ journey: Journey; wasCreated: boolean }> {
    return withTenant(db, tenantId, async (tx) => {
      // 1. Já tem active? Retorna ela (wasCreated=false).
      const [existing] = await tx
        .select()
        .from(journeys)
        .where(
          and(
            eq(journeys.clientId, input.clientId),
            eq(journeys.status, 'active')
          )
        )
        .orderBy(journeys.createdAt)
        .limit(1);
      if (existing) return { journey: existing, wasCreated: false };

      // 2. Inbound espontâneo (source='whatsapp') pode reabrir lost recente.
      //    Outras fontes (form, manual, sheets, imported, recycling) sempre
      //    criam — porque expressam decisão deliberada de iniciar nova jornada.
      //    `won` nunca reabre (selo final), helper já filtra por status='lost'.
      //    Reopen conta como wasCreated=true: do ponto de vista do front é
      //    nascimento de lead ativo novo (cliente perdido voltou).
      if (input.source === 'whatsapp') {
        const reopened = await tryReopenJourneyForClient(tx, input.clientId);
        if (reopened) {
          logger.info(
            {
              tenantId,
              journeyId: reopened.journey.id,
              clientId: input.clientId,
              previousLostReason: reopened.previousLostReason,
              daysClosed: reopened.daysClosed,
            },
            '[CoreGateway] journey reaberta por inbound espontâneo'
          );
          return { journey: reopened.journey, wasCreated: true };
        }
      }

      // 3. Cria journey nova. leadSubstage='new' por padrão — cascata
      //    posterior move pra 'template'/'contact' conforme outbound/inbound.
      //    Partial unique index `journeys_client_active_unique` serializa
      //    contra race (dois webhooks inbound em paralelo, p.ex.) — sem linha
      //    devolvida, outra tx ganhou; re-buscamos a ativa que sobrou.
      //    ON CONFLICT sem alvo cobre o índice parcial; um catch de 23505
      //    abortaria a transação e o re-fetch falharia.
      const [created] = await tx
        .insert(journeys)
        .values({
          tenantId,
          clientId: input.clientId,
          stage: 'lead',
          source: input.source,
          sourceMetadata: input.sourceMetadata ?? {},
          status: 'active',
          leadSubstage: 'new',
        })
        .onConflictDoNothing()
        .returning();

      if (!created) {
        const [winner] = await tx
          .select()
          .from(journeys)
          .where(
            and(
              eq(journeys.clientId, input.clientId),
              eq(journeys.status, 'active')
            )
          )
          .orderBy(journeys.createdAt)
          .limit(1);
        if (!winner) throw new Error('Falha ao inserir journey');
        logger.info(
          { tenantId, journeyId: winner.id, clientId: input.clientId },
          '[CoreGateway] race detectada em journeysFindOrCreateActive — usando a journey criada por outra tx'
        );
        // wasCreated=false: do ponto de vista do caller, esta tx NÃO foi
        // responsável pelo nascimento — quem ganhou já publicou o evento
        // de "nova journey". Evita dobrar notificações isNewLead.
        return { journey: winner, wasCreated: false };
      }

      // Audit trail. event_type é varchar livre (schema §4.2 comentário).
      await tx.insert(journeyEvents).values({
        tenantId,
        journeyId: created.id,
        eventType: 'journey_created',
        payload: { source: input.source, sourceMetadata: input.sourceMetadata ?? {} },
      });

      logger.info(
        { tenantId, journeyId: created.id, clientId: input.clientId, source: input.source },
        '[CoreGateway] journey criada'
      );
      return { journey: created, wasCreated: true };
    });
  }

  async journeysFindActiveByClient(
    tenantId: string,
    clientId: string
  ): Promise<Journey | null> {
    return withTenant(db, tenantId, async (tx) => {
      const [active] = await tx
        .select()
        .from(journeys)
        .where(
          and(eq(journeys.clientId, clientId), eq(journeys.status, 'active'))
        )
        .limit(1);
      return active ?? null;
    });
  }

  async journeysTouchActivity(tenantId: string, journeyId: string): Promise<void> {
    await withTenant(db, tenantId, async (tx) => {
      await tx
        .update(journeys)
        .set({ lastActivityAt: new Date() })
        .where(eq(journeys.id, journeyId));
    });
  }

  async journeysRecomputeLeadSubstage(
    tenantId: string,
    journeyId: string,
    reason: string
  ): Promise<void> {
    await withTenant(db, tenantId, async (tx) => {
      await recomputeLeadSubstage(tx, journeyId, { reason });
    });
  }
}

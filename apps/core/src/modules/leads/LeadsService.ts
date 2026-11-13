import {
  eq,
  journeys,
  LEAD_SUBSTAGES,
  recomputeLeadSubstage,
  setLeadSubstageManual,
  withTenant,
  type LeadSubstage,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  markJourneyLost,
  type LostReason,
} from '../../shared/journeys/stageTransition.js';
import { createExternalLead } from '../../shared/leads/createExternalLead.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { LeadsQuery } from './LeadsQuery.js';
import {
  leadsSortSpec,
  type CreateLeadInput,
  type FindLeadsQuery,
  type LeadCard,
  type LeadDetail,
  type LeadsBoardResponse,
  type LeadsCountsResponse,
  type LeadSubstageValue,
} from './LeadsTypes.js';

// =====================================================================
// LeadsService — orquestra reads sobre `journeys WHERE stage='lead'`.
//
// Não tem tabela própria. Writes específicos de lead (criação manual,
// override de substage, mark-lost) reutilizam helpers já consolidados
// (`@elora/db` substage helpers, `shared/journeys/stageTransition` lost).
// =====================================================================

export const LeadsService = {
  // =====================================================================
  // GET /leads/board — uma página de cada coluna do kanban.
  // =====================================================================
  findBoard: async (
    tenantId: string,
    query: FindLeadsQuery
  ): Promise<LeadsBoardResponse> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        leadsSortSpec
      );

      // Filtros aplicados em todas as colunas EXCETO substage — esse é
      // implícito pelo agrupamento.
      const baseFilters = {
        source: query.source,
        ageMinDays: query.ageMinDays,
        ageMaxDays: query.ageMaxDays,
        channelId: query.channelId,
        search: query.search,
      };

      // 1 query por coluna em paralelo. Cada uma traz a 1ª página + total
      // pra renderizar count + pagination da coluna.
      const columnEntries = await Promise.all(
        LEAD_SUBSTAGES.map(async (substage) => {
          const { items, total } = await LeadsQuery.findCards(
            tx,
            { ...baseFilters, substage },
            { page: query.page, pageSize: query.pageSize },
            orderBy
          );
          return [
            substage,
            {
              items,
              total,
              page: query.page,
              pageSize: query.pageSize,
              totalPages: totalPagesOf(total, query.pageSize),
            },
          ] as const;
        })
      );

      // Counts agregados (inclui 'unset'). Em paralelo com as colunas pra
      // evitar serialização — total da coluna já vem na column itself, mas
      // 'unset' não tem coluna no board.
      const totals = (await LeadsQuery.countsBySubstage(
        tx,
        baseFilters
      )) as LeadsCountsResponse;

      const columns = Object.fromEntries(columnEntries) as LeadsBoardResponse['columns'];

      return { columns, totals };
    });
  },

  // =====================================================================
  // GET /leads — flat list paginada (table view alternativa ao kanban).
  // =====================================================================
  find: async (
    tenantId: string,
    query: FindLeadsQuery
  ): Promise<{
    items: LeadCard[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        leadsSortSpec
      );
      const { items, total } = await LeadsQuery.findCards(
        tx,
        {
          substage: query.substage,
          source: query.source,
          ageMinDays: query.ageMinDays,
          ageMaxDays: query.ageMaxDays,
          channelId: query.channelId,
          search: query.search,
        },
        { page: query.page, pageSize: query.pageSize },
        orderBy
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

  // =====================================================================
  // GET /leads/counts — apenas totais por substage.
  // =====================================================================
  counts: async (
    tenantId: string,
    query: Omit<FindLeadsQuery, 'page' | 'pageSize' | 'substage' | 'sortBy' | 'sortDir'>
  ): Promise<LeadsCountsResponse> => {
    return withTenant(db, tenantId, async (tx) => {
      const totals = await LeadsQuery.countsBySubstage(tx, query);
      return totals as LeadsCountsResponse;
    });
  },

  // =====================================================================
  // GET /leads/:id — detalhe enriquecido.
  // =====================================================================
  findById: async (tenantId: string, id: string): Promise<LeadDetail> => {
    return withTenant(db, tenantId, async (tx) => {
      const detail = await LeadsQuery.findDetailById(tx, id);
      if (!detail) {
        throw new AppError('Lead não encontrado (ou jornada já avançou)', 404);
      }
      return detail;
    });
  },

  // =====================================================================
  // POST /leads — cadastro inline (form único).
  //
  // Recebe os dados do cliente + flag opcional pra criar whatsapp_contact.
  // Cliente é criado pelo helper (find-or-create por phone com unique
  // (tenant, phone)). Source fixa em 'manual'. Substage nasce 'new';
  // cascata posterior move conforme operação.
  // =====================================================================
  create: async (
    tenantId: string,
    input: CreateLeadInput,
    actorUserId: string | null
  ): Promise<LeadDetail> => {
    const { journeyId } = await createExternalLead(
      tenantId,
      {
        clientData: {
          name: input.name,
          phoneE164: input.phoneE164,
          email: input.email,
          birthDate: input.birthDate,
          document: input.document,
          address: input.address,
          notes: input.notes,
          isVip: input.isVip,
        },
        source: 'manual',
        createWhatsappContact: input.createWhatsappContact,
        whatsappE164: input.whatsappE164,
      },
      actorUserId
    );
    return LeadsService.findById(tenantId, journeyId);
  },

  // =====================================================================
  // PUT /leads/:id/substage — override manual (admin tool). Cascata pode
  // sobrescrever depois — comportamento intencional (ver leadSubstage.ts).
  // =====================================================================
  setSubstageManual: async (
    tenantId: string,
    id: string,
    substage: LeadSubstageValue,
    actorUserId: string | null
  ): Promise<LeadDetail> => {
    await withTenant(db, tenantId, async (tx) => {
      const result = await setLeadSubstageManual(
        tx,
        id,
        substage as LeadSubstage,
        actorUserId
      );
      if (result === null) {
        throw new AppError(
          'Lead não encontrado ou jornada não está em stage=lead',
          404
        );
      }
    });
    return LeadsService.findById(tenantId, id);
  },

  // =====================================================================
  // POST /leads/:id/recompute-substage — força recompute. Debug tool —
  // útil quando algum write fora do Drizzle deixou o substage divergente.
  // =====================================================================
  recomputeSubstage: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<LeadDetail> => {
    await withTenant(db, tenantId, async (tx) => {
      const result = await recomputeLeadSubstage(tx, id, {
        reason: 'manual_recompute',
        actorUserId,
      });
      if (result === null) {
        throw new AppError(
          'Lead não encontrado ou jornada não está em stage=lead',
          404
        );
      }
    });
    return LeadsService.findById(tenantId, id);
  },

  // =====================================================================
  // POST /leads/:previousJourneyId/recycle — recepcionista retoma cliente
  // perdido (chat-domain.md §5.6 ext.). Diferente de reabertura por inbound
  // espontâneo: aqui a INICIATIVA é da empresa, então cria journey nova com
  // source='recycling' (não reabre a anterior).
  //
  // Pré-requisitos:
  //   - previousJourneyId é uma journey lost do mesmo tenant
  //   - cliente NÃO tem journey ativa atualmente (princípio "1 active por cliente")
  //
  // Resultado: journey nova com:
  //   stage='lead', substage='new', status='active', source='recycling',
  //   sourceMetadata={ previous_journey_id, recycled_by_user_id, recycled_at }
  //
  // Audit: registra journey_event 'recycled_from' na nova journey, payload
  // com previousJourneyId pra rastreabilidade.
  // =====================================================================
  recycle: async (
    tenantId: string,
    previousJourneyId: string,
    actorUserId: string | null
  ): Promise<LeadDetail> => {
    // 1. Valida journey anterior — existe, é lost, do mesmo tenant (RLS).
    // Lê numa transação separada; o helper revalida "sem ativa" dentro da
    // sua própria tx, então race entre check e create cai em 409 limpo.
    const previousClientId = await withTenant(db, tenantId, async (tx) => {
      const [previous] = await tx
        .select({
          id: journeys.id,
          clientId: journeys.clientId,
          status: journeys.status,
        })
        .from(journeys)
        .where(eq(journeys.id, previousJourneyId))
        .limit(1);
      if (!previous) throw new AppError('Jornada anterior não encontrada', 404);
      if (previous.status !== 'lost') {
        throw new AppError(
          `Reciclagem só permitida a partir de jornada perdida (atual=${previous.status})`,
          409
        );
      }
      return previous.clientId;
    });

    // 2. Cria via helper centralizado — valida "sem ativa", insere journey,
    // registra event `recycled_from` (com previousJourneyId no payload), e
    // publica `lead.created` no socket. Toast no frontend dispara porque
    // source='recycling' não está na lista de "sem toast" (manual/imported).
    const now = new Date();
    const { journeyId } = await createExternalLead(
      tenantId,
      {
        clientId: previousClientId,
        source: 'recycling',
        sourceMetadata: {
          previous_journey_id: previousJourneyId,
          recycled_by_user_id: actorUserId,
          recycled_at: now.toISOString(),
        },
        eventType: 'recycled_from',
        eventPayloadExtra: { previousJourneyId },
      },
      actorUserId
    );

    return LeadsService.findById(tenantId, journeyId);
  },

  // =====================================================================
  // POST /leads/:id/mark-lost — proxy pra markJourneyLost. Mantém
  // simétrico com /journeys/:id/lost mas no domínio /leads pra coesão.
  // =====================================================================
  markLost: async (
    tenantId: string,
    id: string,
    reason: LostReason,
    actorUserId: string | null
  ): Promise<LeadDetail> => {
    await withTenant(db, tenantId, async (tx) => {
      // Confere que journey ainda é lead — endpoint /leads não faz sentido
      // pra journeys que já avançaram. UI deve usar /journeys/:id/lost.
      const [j] = await tx
        .select({ stage: journeys.stage, status: journeys.status })
        .from(journeys)
        .where(eq(journeys.id, id))
        .limit(1);
      if (!j) throw new AppError('Lead não encontrado', 404);
      if (j.stage !== 'lead') {
        throw new AppError(
          `Jornada em stage=${j.stage} — use /journeys/${id}/lost`,
          409
        );
      }
      await markJourneyLost(tx, id, reason, actorUserId);
    });
    // Após markLost, journey saiu de status=active. findById só retorna
    // se ainda em stage=lead — agora lostJourney provavelmente vai 404.
    // Retorna o último snapshot lendo direto a journey.
    return withTenant(db, tenantId, async (tx) => {
      const detail = await LeadsQuery.findDetailById(tx, id);
      if (!detail) {
        // Pode ter sido encerrada e o filtro `stage='lead'` ainda bate
        // (lost mantém stage). Defensive — retorna 404 com mensagem clara.
        throw new AppError('Lead não encontrado após mark-lost', 500);
      }
      return detail;
    });
  },
};


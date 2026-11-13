import { randomUUID } from 'node:crypto';
import {
  withTenant,
  clients as clientsTable,
  tenants as tenantsTable,
  sales as salesTable,
  saleItems as saleItemsTable,
  eq,
} from '@elora/db';
import { EVENT_CHANNELS } from '@elora/events-contracts';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { eventBus } from '../../shared/eventBus/eventBus.js';
import { logger } from '../../shared/observability/logger.js';
import { getSignatureProvider } from '../../shared/providers/signature/index.js';
import type { NormalizedSignatureEvent } from '../../shared/providers/signature/types.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import { ContractStorage } from '../../shared/storage/ContractStorage.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { ConsentTemplateProceduresQuery } from './ConsentTemplateProceduresQuery.js';
import { ContractsQuery } from './ContractsQuery.js';
import {
  contractsSortSpec,
  type ContractWithRelations,
  type CreateContractInput,
  type FindContractsQuery,
} from './ContractsTypes.js';
import { ContractTemplatesQuery } from './ContractTemplatesQuery.js';
import {
  getKnownVariableKeys,
  resolveKnownVariables,
  type MissingVariableField,
} from './variableResolvers.js';

interface PgError extends Error {
  code?: string;
  constraint?: string;
}

// Match 23505 (unique_violation) opcionalmente filtrado por constraint name —
// só esse caso classifica como "race de idempotência resolvida". Outros 23505
// (zapsign_document_id duplicado, tenant+phone duplicado em algum dia) sobem.
function isPgUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as PgError;
  if (e.code !== '23505') return false;
  if (!constraint) return true;
  return e.constraint === constraint;
}

export interface ResolveVariablesResult {
  // Valores das chaves conhecidas resolvidas pra esse cliente+tenant.
  // Sempre presentes (mesmo vazias) pra todas as chaves do catálogo.
  resolved: Record<string, string>;
  // Catálogo completo das chaves que o backend sabe resolver. Frontend
  // usa pra marcar quais variáveis do template são "auto-preenchidas".
  knownKeys: string[];
  // Campos faltantes agrupados por label — UI mostra banner avisando o
  // operador quais cadastros precisa completar antes de gerar o contrato.
  missing: MissingVariableField[];
}

interface SignedPdfDownload {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

// Termo que o bulk NÃO criou: já ativo (pré-check ou race) ou erro de provider.
export interface SkippedConsentTerm {
  templateId: string;
  templateName: string;
  reason: 'already_active' | 'provider_error';
}

export interface GenerateConsentTermsResult {
  created: ContractWithRelations[];
  skipped: SkippedConsentTerm[];
}

// Lê o discriminador que `create` carimba em AppError.details pros conflitos de
// venda — evita parsear mensagem. Ver branches do 23505 em `create`.
function appErrorCode(err: unknown): string | undefined {
  if (!(err instanceof AppError)) return undefined;
  const details = err.details as { code?: string } | undefined;
  return details?.code;
}

export const ContractsService = {
  find: async (
    tenantId: string,
    query: FindContractsQuery,
  ): Promise<PaginatedResult<ContractWithRelations>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        contractsSortSpec,
      );
      const { items, total } = await ContractsQuery.findPaginated(
        tx,
        {
          clientId: query.clientId,
          journeyId: query.journeyId,
          status: query.status,
          kind: query.kind,
          pendingOnly: query.pendingOnly,
        },
        { page: query.page, pageSize: query.pageSize },
        orderBy,
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

  findById: async (tenantId: string, id: string): Promise<ContractWithRelations> => {
    return withTenant(db, tenantId, async (tx) => {
      const contract = await ContractsQuery.findById(tx, id);
      if (!contract) throw new AppError('Contrato não encontrado', 404);
      return contract;
    });
  },

  // Resolve as variáveis "conhecidas" (catálogo em variableResolvers.ts) pra
  // um cliente específico. Usado pelo ContractSendSheet pra pré-preencher
  // inputs ao escolher template — operador só precisa preencher variáveis
  // específicas de contexto (ex: `procedure`, `session_count`).
  resolveVariables: async (
    tenantId: string,
    clientId: string,
  ): Promise<ResolveVariablesResult> => {
    const client = await withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, clientId))
        .limit(1);
      return row;
    });
    if (!client) throw new AppError('Cliente não encontrado', 404);

    // Tenants table não tem RLS — query direto via `db`.
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) throw new AppError('Tenant não encontrado', 500);

    const { resolved, missing } = resolveKnownVariables({ client, tenant });

    // Log focado nos campos faltantes — quando há algo a preencher, mostra
    // por label (ex: "CPF do cliente", "Razão social da clínica") pra ficar
    // óbvio no grep o que precisa ser cadastrado. Caminho feliz não polui log.
    if (missing.length > 0) {
      logger.info(
        {
          clientId,
          tenantId,
          missingLabels: missing.map((m) => `${m.source}:${m.label}`),
          missingKeys: missing.flatMap((m) => m.keys),
        },
        'contracts.resolveVariables.missing',
      );
    }

    return {
      resolved,
      knownKeys: getKnownVariableKeys(),
      missing,
    };
  },

  create: async (
    tenantId: string,
    input: CreateContractInput,
    actorUserId: string | null,
  ): Promise<ContractWithRelations> => {
    // Carrega template + cliente FORA da transação principal — apenas leituras
    // protegidas por RLS. Service mantém transação curta na escrita final.
    const provider = getSignatureProvider();

    // Idempotência: se o caller mandou uma chave e já existe contrato pra ela,
    // devolve o existente SEM chamar o provider de novo. Protege contra
    // duplo-submit (duplo-clique, retry de rede, duas abas) que criava 2 docs
    // órfãos na ZapSign. Race residual entre dois POSTs simultâneos é resolvida
    // pelo unique index parcial em (tenant_id, idempotency_key) — o segundo
    // INSERT falha com 23505 e o catch abaixo re-busca pelo unique key.
    if (input.idempotencyKey) {
      const existing = await withTenant(db, tenantId, async (tx) =>
        ContractsQuery.findByIdempotencyKey(tx, input.idempotencyKey!),
      );
      if (existing) {
        logger.info(
          { tenantId, contractId: existing.id, idempotencyKey: input.idempotencyKey },
          'contracts.create.idempotent_replay',
        );
        return existing;
      }
    }

    const { template, client } = await withTenant(db, tenantId, async (tx) => {
      const t = await ContractTemplatesQuery.findById(tx, input.templateId);
      if (!t) throw new AppError('Template de contrato não encontrado', 404);
      if (!t.active) throw new AppError('Template de contrato está desativado', 409);

      const [c] = await tx
        .select()
        .from(clientsTable)
        .where(eq(clientsTable.id, input.clientId))
        .limit(1);
      if (!c) throw new AppError('Cliente não encontrado', 404);
      if (!c.active) throw new AppError('Cliente está desativado', 409);
      // phoneE164 é notNull no schema — não checamos. ZapSign recebe o telefone
      // como metadata do signer (notificações ficam desabilitadas; quem manda
      // o link é a clínica via WhatsApp).
      return { template: t, client: c };
    });

    // Aviso (não-bloqueante) se alguma variável do payload não estiver
    // declarada no template. ZapSign aceita variáveis extras silenciosamente,
    // mas isso costuma ser sinal de typo na UI.
    const unknownVars = input.variables.filter(
      (v) => !template.variables.includes(v.name),
    );
    if (unknownVars.length > 0) {
      logger.warn(
        {
          tenantId,
          templateId: template.id,
          unknown: unknownVars.map((v) => v.name),
        },
        'contracts.create.unknown_variables',
      );
    }

    // Calcula expiresAt UMA vez aqui — passa o mesmo Date pro provider e pra
    // persistência. Antes esse cálculo era duplicado (service + adapter) com
    // bases distintas (local vs UTC), risco de divergir 1 dia perto da meia-noite.
    const now = new Date();
    const expiresAt = input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    // Chama provider FORA da transação — request HTTP que pode demorar não
    // deve segurar conexão de DB. Se ZapSign falhar, nada foi gravado.
    const documentName = (input.title ?? template.name).slice(0, 255);
    const docRef = await provider.createDocumentFromTemplate({
      externalTemplateId: template.zapsignTemplateId,
      documentName,
      signer: {
        name: client.name,
        email: client.email ?? undefined,
        phoneE164: client.phoneE164,
      },
      variables: input.variables,
      disableSignerNotifications: true,
      expiresAt,
    });

    // Agora persiste — operação curta, idempotência via unique index em
    // (zapsign_document_id).

    try {
      return await withTenant(db, tenantId, async (tx) => {
        const inserted = await ContractsQuery.insert(tx, tenantId, {
          clientId: client.id,
          journeyId: input.journeyId ?? null,
          saleId: input.saleId ?? null,
          templateId: template.id,
          variables: input.variables,
          kind: template.kind,
          title: documentName,
          status: 'sent',
          zapsignDocumentId: docRef.externalDocumentId,
          zapsignOpenId: docRef.externalOpenId || null,
          signUrl: docRef.signUrl,
          sentAt: now,
          expiresAt,
          createdByUserId: actorUserId,
          idempotencyKey: input.idempotencyKey ?? null,
        });

        const enriched = await ContractsQuery.findById(tx, inserted.id);
        if (!enriched) {
          throw new AppError('Contrato não encontrado após criação', 500);
        }
        return enriched;
      });
    } catch (err) {
      // Race do unique index: dois POSTs simultâneos passaram pelo pre-flight
      // e ambos chamaram o provider. O segundo INSERT bate 23505 — devolve o
      // contrato do primeiro (o segundo doc criado na ZapSign vira órfão, que
      // é o trade-off conhecido; o pre-flight elimina o caso comum). Só vale
      // pra idempotency_key — uniqueness em zapsign_document_id NÃO conflita
      // (token é gerado pelo provider por chamada).
      if (
        input.idempotencyKey &&
        isPgUniqueViolation(err, 'contracts_tenant_idempotency_unique')
      ) {
        const existing = await withTenant(db, tenantId, async (tx) =>
          ContractsQuery.findByIdempotencyKey(tx, input.idempotencyKey!),
        );
        if (existing) {
          logger.warn(
            {
              tenantId,
              contractId: existing.id,
              idempotencyKey: input.idempotencyKey,
              orphanedZapsignDocumentId: docRef.externalDocumentId,
            },
            'contracts.create.idempotent_race_resolved',
          );
          return existing;
        }
      }

      // Uniques parciais de venda (Fase 7) — regra de negócio violada. Checados
      // DEPOIS do idempotency (que é o caso esperado de retry). O doc criado na
      // ZapSign vira órfão (mesmo trade-off do race de idempotência). O bulk
      // pré-filtra pra que esse caminho só dispare em corrida real.
      if (isPgUniqueViolation(err, 'contracts_sale_service_active_unique')) {
        logger.warn(
          { tenantId, saleId: input.saleId, orphanedZapsignDocumentId: docRef.externalDocumentId },
          'contracts.create.sale_service_active_conflict',
        );
        throw new AppError(
          'Já existe um contrato de serviço ativo para esta venda. Cancele o anterior antes de criar outro.',
          409,
          { code: 'sale_service_contract_active' },
        );
      }
      if (isPgUniqueViolation(err, 'contracts_sale_consent_template_active_unique')) {
        logger.warn(
          {
            tenantId,
            saleId: input.saleId,
            templateId: input.templateId,
            orphanedZapsignDocumentId: docRef.externalDocumentId,
          },
          'contracts.create.sale_consent_term_active_conflict',
        );
        throw new AppError(
          'Já existe um termo deste tipo ativo para esta venda.',
          409,
          { code: 'sale_consent_term_active' },
        );
      }
      throw err;
    }
  },

  // Gera os termos de consentimento PENDENTES de uma venda (Fase 7). Pra cada
  // template de termo que cobre algum procedimento da venda e que ainda NÃO tem
  // termo ativo, cria um contrato. Idempotente e resiliente:
  // - Pré-check (`listActiveConsentTemplateIdsForSale`) pula templates já gerados
  //   SEM chamar a ZapSign — rerun não gasta quota. O unique parcial fica só como
  //   guarda de corrida (2 cliques simultâneos → 23505 → skipped already_active).
  // - Erro de provider (ZapSign 5xx) num template não aborta os outros: vai pra
  //   `skipped` com reason 'provider_error', `created` parcial é retornado.
  // - Dedup por template (regra 3) já vem do `selectDistinct` em
  //   `listTemplatesForProcedures`: 2 procedimentos no mesmo template = 1 termo.
  generateConsentTermsForSale: async (
    tenantId: string,
    saleId: string,
    actorUserId: string | null,
  ): Promise<GenerateConsentTermsResult> => {
    // Leituras numa tx curta: valida venda, coleta procedimentos, templates
    // aplicáveis, templates já cobertos e o cliente.
    const { sale, templates, alreadyActive, client } = await withTenant(
      db,
      tenantId,
      async (tx) => {
        const [s] = await tx
          .select()
          .from(salesTable)
          .where(eq(salesTable.id, saleId))
          .limit(1);
        if (!s) throw new AppError('Venda não encontrada', 404);

        const itemRows = await tx
          .selectDistinct({ procedureId: saleItemsTable.procedureId })
          .from(saleItemsTable)
          .where(eq(saleItemsTable.saleId, saleId));
        const procedureIds = itemRows.map((r) => r.procedureId);

        const tpls = await ConsentTemplateProceduresQuery.listTemplatesForProcedures(
          tx,
          procedureIds,
        );
        const active = await ContractsQuery.listActiveConsentTemplateIdsForSale(
          tx,
          saleId,
        );

        const [c] = await tx
          .select()
          .from(clientsTable)
          .where(eq(clientsTable.id, s.clientId))
          .limit(1);
        if (!c) throw new AppError('Cliente da venda não encontrado', 404);

        return { sale: s, templates: tpls, alreadyActive: new Set(active), client: c };
      },
    );

    // Tenant não tem RLS — query direto via `db`. Necessário pra resolver as
    // variáveis conhecidas (clínica) dos termos.
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) throw new AppError('Tenant não encontrado', 500);

    const { resolved } = resolveKnownVariables({ client, tenant });

    const created: ContractWithRelations[] = [];
    const skipped: SkippedConsentTerm[] = [];

    for (const template of templates) {
      // Pré-check: termo já ativo pra esse template → skip sem tocar na ZapSign.
      if (alreadyActive.has(template.id)) {
        skipped.push({
          templateId: template.id,
          templateName: template.name,
          reason: 'already_active',
        });
        continue;
      }

      // Resolve as variáveis conhecidas declaradas no template. Variáveis manuais
      // (ex: `procedure`) que o catálogo não cobre saem vazias — termo auto-gerado
      // não tem operador pra preencher (limitação aceita do bulk).
      const variables = template.variables.map((name) => ({
        name,
        value: resolved[name] ?? '',
      }));

      try {
        const contract = await ContractsService.create(
          tenantId,
          {
            clientId: client.id,
            templateId: template.id,
            journeyId: sale.journeyId,
            saleId,
            variables,
            // Chave server-side por template — protege contra retry de rede do
            // próprio create; o dedup entre cliques é do pré-check + unique parcial.
            idempotencyKey: randomUUID(),
          },
          actorUserId,
        );
        created.push(contract);
      } catch (err) {
        // Corrida real (2 bulks simultâneos): o unique parcial barrou o 2º INSERT.
        if (appErrorCode(err) === 'sale_consent_term_active') {
          skipped.push({
            templateId: template.id,
            templateName: template.name,
            reason: 'already_active',
          });
          continue;
        }
        // Falha de provider (ZapSign 5xx) não derruba o lote — segue pros demais.
        if (err instanceof AppError && err.statusCode >= 500) {
          logger.warn(
            { tenantId, saleId, templateId: template.id, err: err.message },
            'contracts.generateConsentTerms.provider_error',
          );
          skipped.push({
            templateId: template.id,
            templateName: template.name,
            reason: 'provider_error',
          });
          continue;
        }
        // Erro inesperado (config/bug) afeta provavelmente todos — aborta o lote.
        throw err;
      }
    }

    logger.info(
      {
        tenantId,
        saleId,
        createdCount: created.length,
        skippedCount: skipped.length,
        applicableTemplates: templates.length,
      },
      'contracts.generateConsentTerms.done',
    );

    return { created, skipped };
  },

  cancel: async (tenantId: string, id: string): Promise<ContractWithRelations> => {
    const provider = getSignatureProvider();

    // Lê estado atual numa tx curta pra decidir se vale cancelar.
    const current = await withTenant(db, tenantId, async (tx) => {
      const c = await ContractsQuery.findById(tx, id);
      if (!c) throw new AppError('Contrato não encontrado', 404);
      return c;
    });

    if (['signed', 'declined', 'expired', 'cancelled'].includes(current.status)) {
      throw new AppError(
        `Contrato em status '${current.status}' não pode ser cancelado`,
        409,
      );
    }

    // Se o documento foi criado no ZapSign, cancela lá. Tolerante a 404 do
    // provider (documento pode ter sido apagado por outro caminho).
    if (current.zapsignDocumentId) {
      try {
        await provider.cancelDocument(current.zapsignDocumentId);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 404) {
          logger.warn(
            { contractId: id, zapsignDocumentId: current.zapsignDocumentId },
            'contracts.cancel.zapsign_already_gone',
          );
        } else {
          throw err;
        }
      }
    }

    return withTenant(db, tenantId, async (tx) => {
      await ContractsQuery.updateStatus(tx, id, { status: 'cancelled' });
      const enriched = await ContractsQuery.findById(tx, id);
      if (!enriched) throw new AppError('Contrato não encontrado após cancelar', 500);
      return enriched;
    });
  },

  // Devolve o contrato (com signUrl pronta) pra UI copiar o link. Nome
  // antigo era `resend` — enganador porque NÃO há disparo aqui; quem manda
  // é o operador (Fase 3.5 vai trocar isso pra disparo de WhatsApp direto
  // pelo backend, aí o verbo "resend" volta a fazer sentido).
  copyLink: async (tenantId: string, id: string): Promise<ContractWithRelations> => {
    return withTenant(db, tenantId, async (tx) => {
      const c = await ContractsQuery.findById(tx, id);
      if (!c) throw new AppError('Contrato não encontrado', 404);
      if (!['sent', 'viewed'].includes(c.status)) {
        throw new AppError(
          `Contrato em status '${c.status}' não tem link ativo`,
          409,
        );
      }
      if (!c.signUrl) {
        throw new AppError('Contrato sem URL de assinatura disponível', 409);
      }
      return c;
    });
  },

  // Baixa o PDF assinado. Quando o webhook persistiu o PDF no R2/MinIO
  // (`signedPdfObjectKey` preenchido), serve direto do storage. Fallback:
  // baixa do ZapSign on-demand (mesmo caminho que existia antes do webhook
  // existir — usado quando storage não tá provisionado, ou pra contratos
  // antigos persistidos pré-Fase 4).
  downloadSignedPdf: async (
    tenantId: string,
    id: string,
  ): Promise<SignedPdfDownload> => {
    const current = await withTenant(db, tenantId, async (tx) => {
      const c = await ContractsQuery.findById(tx, id);
      if (!c) throw new AppError('Contrato não encontrado', 404);
      return c;
    });

    if (current.status !== 'signed') {
      throw new AppError(
        `Contrato ainda não foi assinado (status: ${current.status})`,
        409,
      );
    }

    let buffer: Buffer;
    if (current.signedPdfObjectKey && ContractStorage.isConfigured) {
      buffer = await ContractStorage.fetchSignedPdf(current.signedPdfObjectKey);
    } else {
      if (!current.zapsignDocumentId) {
        throw new AppError('Contrato sem referência no provider', 500);
      }
      const provider = getSignatureProvider();
      buffer = await provider.downloadSignedPdf(current.zapsignDocumentId);
    }

    const safeTitle = current.title.replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 60);
    return {
      buffer,
      filename: `contrato-${safeTitle}-${id.slice(0, 8)}.pdf`,
      mimeType: 'application/pdf',
    };
  },

  // Processa um evento normalizado do provider de assinatura (webhook).
  // Idempotente: webhook pode chegar 2x (provider retry, NAT, etc), eventos
  // que não mudam estado (ex: viewed quando já está signed) são skip silencioso.
  //
  // Tenant é resolvido upstream (controller chama ContractsQuery.resolveTenant…
  // via SECURITY DEFINER) — aqui já temos o id.
  //
  // Pra `document.signed`: baixa o PDF e persiste no R2 antes de fechar a tx.
  // Download fora da tx (HTTP lento). Se storage não tá configurado, ainda
  // marca como signed — `downloadSignedPdf` cai no fallback ZapSign on-demand.
  handleSignatureEvent: async (
    tenantId: string,
    event: NormalizedSignatureEvent,
  ): Promise<void> => {
    if (event.kind === 'unknown') {
      logger.debug(
        { tenantId, rawEvent: event.rawEvent, externalDocumentId: event.externalDocumentId },
        'contracts.webhook.unknown_event',
      );
      return;
    }

    // Localiza contrato pelo zapsign_document_id (RLS já filtra por tenant).
    const current = await withTenant(db, tenantId, async (tx) => {
      return ContractsQuery.findByZapsignDocumentId(tx, event.externalDocumentId);
    });

    if (!current) {
      logger.warn(
        { tenantId, externalDocumentId: event.externalDocumentId, kind: event.kind },
        'contracts.webhook.contract_not_found',
      );
      return;
    }

    // Idempotência: estados terminais não regridem. signed/declined/cancelled
    // são absorvidos sem atualizar (provider pode retransmitir).
    if (['signed', 'declined', 'cancelled', 'expired'].includes(current.status)) {
      logger.debug(
        { contractId: current.id, currentStatus: current.status, eventKind: event.kind },
        'contracts.webhook.skip_terminal_state',
      );
      return;
    }

    // Snapshot estável dos campos que o evento realtime carrega — UI monta
    // toast/notif sem precisar de fetch extra. Lemos antes de cada case
    // mexer no DB pra ficar imune ao update.
    const eventSnapshot = {
      tenantId,
      contractId: current.id,
      clientId: current.clientId,
      clientName: current.client.name,
      contractTitle: current.title,
    };

    switch (event.kind) {
      case 'document.viewed': {
        await withTenant(db, tenantId, async (tx) => {
          await ContractsQuery.updateStatus(tx, current.id, {
            status: 'viewed',
            viewedAt: event.viewedAt,
            metadata: { ...current.metadata, lastViewedEvent: event.metadata },
          });
        });
        await eventBus.publish(EVENT_CHANNELS.contractStatusChanged, {
          ...eventSnapshot,
          status: 'viewed',
          changedAt: event.viewedAt.toISOString(),
        });
        return;
      }

      case 'document.declined': {
        await withTenant(db, tenantId, async (tx) => {
          await ContractsQuery.updateStatus(tx, current.id, {
            status: 'declined',
            declinedAt: event.declinedAt,
            failureReason: event.reason,
            metadata: { ...current.metadata, lastDeclinedEvent: event.metadata },
          });
        });
        await eventBus.publish(EVENT_CHANNELS.contractStatusChanged, {
          ...eventSnapshot,
          status: 'declined',
          changedAt: event.declinedAt.toISOString(),
        });
        return;
      }

      case 'document.expired': {
        await withTenant(db, tenantId, async (tx) => {
          await ContractsQuery.updateStatus(tx, current.id, {
            status: 'expired',
            metadata: { ...current.metadata, lastExpiredEvent: event.metadata },
          });
        });
        // `document.expired` não carrega timestamp no payload normalizado —
        // usamos `now` como momento da transição (matching o instante do UPDATE).
        await eventBus.publish(EVENT_CHANNELS.contractStatusChanged, {
          ...eventSnapshot,
          status: 'expired',
          changedAt: new Date().toISOString(),
        });
        return;
      }

      case 'document.signed': {
        // Baixa o PDF FORA da tx — HTTP pode demorar e não deve segurar
        // conexão. Origem: `signedPdfUrl` do evento se vier, senão consulta
        // o provider pelo documento.
        let pdfBuffer: Buffer | null = null;
        try {
          if (event.signedPdfUrl) {
            const res = await fetch(event.signedPdfUrl);
            if (res.ok) {
              pdfBuffer = Buffer.from(await res.arrayBuffer());
            } else {
              logger.warn(
                { contractId: current.id, status: res.status },
                'contracts.webhook.signed_pdf_url_failed_fallback_provider',
              );
            }
          }
          if (!pdfBuffer && current.zapsignDocumentId) {
            const provider = getSignatureProvider();
            pdfBuffer = await provider.downloadSignedPdf(current.zapsignDocumentId);
          }
        } catch (err) {
          // Falha no download não bloqueia o update de status — sem PDF o
          // fallback de `downloadSignedPdf` puxa do ZapSign on-demand depois.
          logger.warn(
            { contractId: current.id, err: (err as Error).message },
            'contracts.webhook.signed_pdf_download_failed',
          );
        }

        let objectKey: string | null = null;
        if (pdfBuffer && ContractStorage.isConfigured) {
          try {
            objectKey = await ContractStorage.persistSignedPdf(
              tenantId,
              current.id,
              pdfBuffer,
            );
          } catch (err) {
            logger.error(
              { contractId: current.id, err: (err as Error).message },
              'contracts.webhook.persist_signed_pdf_failed',
            );
          }
        }

        await withTenant(db, tenantId, async (tx) => {
          await ContractsQuery.updateStatus(tx, current.id, {
            status: 'signed',
            signedAt: event.signedAt,
            signedPdfObjectKey: objectKey,
            metadata: { ...current.metadata, lastSignedEvent: event.metadata },
          });
        });
        await eventBus.publish(EVENT_CHANNELS.contractStatusChanged, {
          ...eventSnapshot,
          status: 'signed',
          changedAt: event.signedAt.toISOString(),
        });
        return;
      }
    }
  },
};

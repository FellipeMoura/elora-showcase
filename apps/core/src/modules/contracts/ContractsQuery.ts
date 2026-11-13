import {
  and,
  clients,
  contractTemplates,
  contracts,
  eq,
  inArray,
  isNotNull,
  ne,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import type {
  Contract,
  ContractWithRelations,
} from './ContractsTypes.js';

interface FindFilters {
  clientId?: string;
  journeyId?: string;
  saleId?: string;
  status?: Contract['status'];
  kind?: Contract['kind'];
  pendingOnly?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

// Status considerados "pendentes" pra filtro pendingOnly=true.
const PENDING_STATUSES: Array<Contract['status']> = ['draft', 'sent', 'viewed'];

// Seleção canônica de Contract + relacionados (cliente + template). LEFT JOIN
// no template porque ele é nullable (contratos sem template — upload avulso —
// existem no schema, mesmo que a Fase 3 ainda não exponha esse fluxo).
function selectContractWithRelations() {
  return {
    id: contracts.id,
    tenantId: contracts.tenantId,
    clientId: contracts.clientId,
    journeyId: contracts.journeyId,
    saleId: contracts.saleId,
    templateId: contracts.templateId,
    variables: contracts.variables,
    kind: contracts.kind,
    title: contracts.title,
    status: contracts.status,
    zapsignDocumentId: contracts.zapsignDocumentId,
    zapsignOpenId: contracts.zapsignOpenId,
    signUrl: contracts.signUrl,
    signedPdfObjectKey: contracts.signedPdfObjectKey,
    sentAt: contracts.sentAt,
    viewedAt: contracts.viewedAt,
    signedAt: contracts.signedAt,
    declinedAt: contracts.declinedAt,
    expiresAt: contracts.expiresAt,
    failureReason: contracts.failureReason,
    createdByUserId: contracts.createdByUserId,
    idempotencyKey: contracts.idempotencyKey,
    metadata: contracts.metadata,
    createdAt: contracts.createdAt,
    updatedAt: contracts.updatedAt,
    clientName: clients.name,
    clientPhone: clients.phoneE164,
    templateName: contractTemplates.name,
    templateKind: contractTemplates.kind,
  };
}

type ContractRow = {
  id: string;
  tenantId: string;
  clientId: string;
  journeyId: string | null;
  saleId: string | null;
  templateId: string | null;
  variables: ContractWithRelations['variables'];
  kind: ContractWithRelations['kind'];
  title: string;
  status: ContractWithRelations['status'];
  zapsignDocumentId: string | null;
  zapsignOpenId: string | null;
  signUrl: string | null;
  signedPdfObjectKey: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  expiresAt: Date | null;
  failureReason: string | null;
  createdByUserId: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  clientPhone: string;
  templateName: string | null;
  templateKind: ContractWithRelations['kind'] | null;
};

function shape(row: ContractRow): ContractWithRelations {
  return {
    id: row.id,
    tenantId: row.tenantId,
    clientId: row.clientId,
    journeyId: row.journeyId,
    saleId: row.saleId,
    templateId: row.templateId,
    variables: row.variables,
    kind: row.kind,
    title: row.title,
    status: row.status,
    zapsignDocumentId: row.zapsignDocumentId,
    zapsignOpenId: row.zapsignOpenId,
    signUrl: row.signUrl,
    signedPdfObjectKey: row.signedPdfObjectKey,
    sentAt: row.sentAt,
    viewedAt: row.viewedAt,
    signedAt: row.signedAt,
    declinedAt: row.declinedAt,
    expiresAt: row.expiresAt,
    failureReason: row.failureReason,
    createdByUserId: row.createdByUserId,
    idempotencyKey: row.idempotencyKey,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    client: {
      id: row.clientId,
      name: row.clientName,
      phoneE164: row.clientPhone,
    },
    template:
      row.templateId && row.templateName
        ? {
            id: row.templateId,
            name: row.templateName,
            kind: row.templateKind ?? 'other',
          }
        : null,
  };
}

export const ContractsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL,
  ): Promise<{ items: ContractWithRelations[]; total: number }> => {
    const conds: SQL[] = [];
    if (filters.clientId) conds.push(eq(contracts.clientId, filters.clientId));
    if (filters.journeyId) conds.push(eq(contracts.journeyId, filters.journeyId));
    if (filters.saleId) conds.push(eq(contracts.saleId, filters.saleId));
    if (filters.status) conds.push(eq(contracts.status, filters.status));
    if (filters.kind) conds.push(eq(contracts.kind, filters.kind));
    if (filters.pendingOnly) {
      conds.push(inArray(contracts.status, PENDING_STATUSES));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Serializadas — transação Drizzle usa 1 conexão; paralelo quebra o protocolo.
    const rows = await tx
      .select(selectContractWithRelations())
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(contractTemplates, eq(contractTemplates.id, contracts.templateId))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(contracts)
      .where(where);

    return {
      items: rows.map((r) => shape(r as ContractRow)),
      total: totalRow?.count ?? 0,
    };
  },

  findById: async (tx: Tx, id: string): Promise<ContractWithRelations | null> => {
    const rows = await tx
      .select(selectContractWithRelations())
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(contractTemplates, eq(contractTemplates.id, contracts.templateId))
      .where(eq(contracts.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return shape(rows[0] as ContractRow);
  },

  // Resolve tenant via função SECURITY DEFINER (0028_resolve_contract_tenant).
  // Necessário pro webhook do ZapSign — o payload só traz `token` (= zapsign
  // document id), sem subdomínio nem tenantId. RLS impede SELECT cross-tenant
  // pelo role do app; a função bypassa só pra essa lookup específica.
  //
  // Usa `db` direto (sem withTenant) porque o objetivo é justamente *descobrir*
  // o tenant. Caller usa o id retornado pra abrir withTenant nas operações
  // subsequentes. Retorna null quando token não existe (webhook órfão).
  resolveTenantByZapsignDocumentId: async (
    zapsignDocumentId: string,
  ): Promise<string | null> => {
    const result = await db.execute<{ tenant_id: string | null }>(
      sql`SELECT resolve_contract_tenant(${zapsignDocumentId}) AS tenant_id`,
    );
    const row = result.rows[0];
    return row?.tenant_id ?? null;
  },

  findByZapsignDocumentId: async (
    tx: Tx,
    zapsignDocumentId: string,
  ): Promise<ContractWithRelations | null> => {
    const rows = await tx
      .select(selectContractWithRelations())
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(contractTemplates, eq(contractTemplates.id, contracts.templateId))
      .where(eq(contracts.zapsignDocumentId, zapsignDocumentId))
      .limit(1);
    if (rows.length === 0) return null;
    return shape(rows[0] as ContractRow);
  },

  // Lookup pra idempotência da criação. Tenant filtrado por RLS — só ecoa rows
  // do tenant atual mesmo se outro tenant tiver gerado a mesma key (raro mas
  // possível com UUIDv4 colisão; o unique index é `(tenant_id, key)`).
  findByIdempotencyKey: async (
    tx: Tx,
    idempotencyKey: string,
  ): Promise<ContractWithRelations | null> => {
    const rows = await tx
      .select(selectContractWithRelations())
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .leftJoin(contractTemplates, eq(contractTemplates.id, contracts.templateId))
      .where(eq(contracts.idempotencyKey, idempotencyKey))
      .limit(1);
    if (rows.length === 0) return null;
    return shape(rows[0] as ContractRow);
  },

  // Pre-check do bulk: templateIds de consent_terms ATIVOS (não cancelados) já
  // existentes pra venda. O bulk usa pra pular templates já gerados sem chamar a
  // ZapSign (evita doc órfão a cada rerun). `templateId` é nullable no schema, mas
  // todo consent_term de venda tem template — isNotNull garante o tipo string[].
  listActiveConsentTemplateIdsForSale: async (
    tx: Tx,
    saleId: string,
  ): Promise<string[]> => {
    const rows = await tx
      .select({ templateId: contracts.templateId })
      .from(contracts)
      .where(
        and(
          eq(contracts.saleId, saleId),
          eq(contracts.kind, 'consent_term'),
          ne(contracts.status, 'cancelled'),
          isNotNull(contracts.templateId),
        ),
      );
    return rows.map((r) => r.templateId).filter((id): id is string => id !== null);
  },

  insert: async (
    tx: Tx,
    tenantId: string,
    input: {
      clientId: string;
      journeyId: string | null;
      saleId: string | null;
      templateId: string | null;
      variables: Array<{ name: string; value: string }>;
      kind: Contract['kind'];
      title: string;
      status: Contract['status'];
      zapsignDocumentId: string | null;
      zapsignOpenId: string | null;
      signUrl: string | null;
      sentAt: Date | null;
      expiresAt: Date | null;
      createdByUserId: string | null;
      idempotencyKey: string | null;
    },
  ): Promise<Contract> => {
    const [row] = await tx
      .insert(contracts)
      .values({
        tenantId,
        clientId: input.clientId,
        journeyId: input.journeyId,
        saleId: input.saleId,
        templateId: input.templateId,
        variables: input.variables,
        kind: input.kind,
        title: input.title,
        status: input.status,
        zapsignDocumentId: input.zapsignDocumentId,
        zapsignOpenId: input.zapsignOpenId,
        signUrl: input.signUrl,
        sentAt: input.sentAt,
        expiresAt: input.expiresAt,
        createdByUserId: input.createdByUserId,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir contrato');
    return row;
  },

  updateStatus: async (
    tx: Tx,
    id: string,
    patch: {
      status?: Contract['status'];
      viewedAt?: Date | null;
      signedAt?: Date | null;
      declinedAt?: Date | null;
      signedPdfObjectKey?: string | null;
      failureReason?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Contract | null> => {
    const updates: Record<string, unknown> = {};
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.viewedAt !== undefined) updates.viewedAt = patch.viewedAt;
    if (patch.signedAt !== undefined) updates.signedAt = patch.signedAt;
    if (patch.declinedAt !== undefined) updates.declinedAt = patch.declinedAt;
    if (patch.signedPdfObjectKey !== undefined)
      updates.signedPdfObjectKey = patch.signedPdfObjectKey;
    if (patch.failureReason !== undefined)
      updates.failureReason = patch.failureReason;
    if (patch.metadata !== undefined) updates.metadata = patch.metadata;

    if (Object.keys(updates).length === 0) {
      const rows = await tx.select().from(contracts).where(eq(contracts.id, id)).limit(1);
      return rows[0] ?? null;
    }

    const [row] = await tx
      .update(contracts)
      .set(updates)
      .where(eq(contracts.id, id))
      .returning();
    return row ?? null;
  },
};

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContractsService } from './ContractsService.js';
import { ContractsQuery } from './ContractsQuery.js';
import { ContractTemplatesQuery } from './ContractTemplatesQuery.js';
import { ConsentTemplateProceduresQuery } from './ConsentTemplateProceduresQuery.js';
import { ContractStorage } from '../../shared/storage/ContractStorage.js';
import { AppError } from '../../shared/errors/AppError.js';
import { eventBus } from '../../shared/eventBus/eventBus.js';
import type { NormalizedSignatureEvent } from '../../shared/providers/signature/types.js';

// ---------------------------------------------------------------------------
// Camada B — unit com mocks. NÃO testa RLS/SQL real: `withTenant` é
// neutralizado (invoca o callback com um `tx` falso) e ContractsQuery é
// stubado. Prova a ORQUESTRAÇÃO do Service: idempotência, recuperação de race
// 23505, e as transições do webhook. Cobertura de integração (índice parcial
// dispara mesmo? policy isola mesmo?) fica pra uma suíte de Postgres real.
// ---------------------------------------------------------------------------

// Estado compartilhado entre os mocks hoisted e os testes. `clientRows` abastece
// o `tx.select()...limit()` que o `create` usa pra carregar o cliente; `provider`
// é o retorno de getSignatureProvider() pra assertar chamadas ao ZapSign.
const mocks = vi.hoisted(() => ({
  clientRows: [] as unknown[],
  saleRows: [] as unknown[],
  saleItemRows: [] as unknown[],
  tenantRows: [] as unknown[],
  provider: {
    createDocumentFromTemplate: vi.fn(),
    downloadSignedPdf: vi.fn(),
    cancelDocument: vi.fn(),
  },
}));

// Mantém @elora/db real (tabelas, eq, createSortSpec usados por ContractsTypes)
// e sobrescreve SÓ o withTenant: invoca o callback com um `tx` falso table-aware.
// O `from(table)` escolhe quais rows o `.limit()` (ou o await direto do
// selectDistinct) resolve — comparando a tabela por identidade contra as reais.
vi.mock('@elora/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@elora/db')>();
  const rowsFor = (table: unknown): unknown[] =>
    table === actual.sales
      ? mocks.saleRows
      : table === actual.saleItems
        ? mocks.saleItemRows
        : table === actual.clients
          ? mocks.clientRows
          : table === actual.tenants
            ? mocks.tenantRows
            : [];
  const buildChain = (table: unknown) => {
    const resolve = () => Promise.resolve(rowsFor(table));
    const chain: Record<string, unknown> = {
      where: () => chain,
      limit: () => resolve(),
      orderBy: () => resolve(),
      // Thenable: permite `await tx.selectDistinct().from().where()` sem .limit().
      then: (f: (v: unknown) => unknown, j: (e: unknown) => unknown) =>
        resolve().then(f, j),
    };
    return chain;
  };
  const fakeTx = {
    select: () => ({ from: (t: unknown) => buildChain(t) }),
    selectDistinct: () => ({ from: (t: unknown) => buildChain(t) }),
  };
  return {
    ...actual,
    withTenant: (_db: unknown, _t: string, cb: (tx: unknown) => unknown) =>
      cb(fakeTx),
  };
});
// `db` direto (sem RLS) é usado só pra ler tenants — resolve tenantRows.
vi.mock('../../shared/database/db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mocks.tenantRows) }),
      }),
    }),
  },
}));
// Resolver de variáveis estável — o bulk só precisa do mapa resolvido.
vi.mock('./variableResolvers.js', () => ({
  resolveKnownVariables: () => ({
    resolved: { clientName: 'Maria Silva' },
    missing: [],
  }),
  getKnownVariableKeys: () => ['clientName'],
}));
vi.mock('./ConsentTemplateProceduresQuery.js', () => ({
  ConsentTemplateProceduresQuery: {
    listTemplatesForProcedures: vi.fn(),
    list: vi.fn(),
    listByTemplateIds: vi.fn(),
    link: vi.fn(),
    unlink: vi.fn(),
  },
}));
vi.mock('../../shared/providers/signature/index.js', () => ({
  getSignatureProvider: () => mocks.provider,
}));
vi.mock('./ContractsQuery.js', () => ({
  ContractsQuery: {
    findByIdempotencyKey: vi.fn(),
    insert: vi.fn(),
    findById: vi.fn(),
    findByZapsignDocumentId: vi.fn(),
    updateStatus: vi.fn(),
    findPaginated: vi.fn(),
    listActiveConsentTemplateIdsForSale: vi.fn(),
  },
}));
vi.mock('./ContractTemplatesQuery.js', () => ({
  ContractTemplatesQuery: { findById: vi.fn() },
}));
vi.mock('../../shared/storage/ContractStorage.js', () => ({
  ContractStorage: { isConfigured: true, persistSignedPdf: vi.fn(), fetchSignedPdf: vi.fn() },
}));
vi.mock('../../shared/eventBus/eventBus.js', () => ({ eventBus: { publish: vi.fn() } }));
vi.mock('../../shared/observability/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@elora/events-contracts', () => ({
  EVENT_CHANNELS: { contractStatusChanged: 'contract.status_changed' },
}));

const TENANT = 'tenant-1';

const activeTemplate = {
  id: 'tpl-1',
  name: 'Termo de Consentimento',
  kind: 'consent_term',
  zapsignTemplateId: 'zap-tpl-1',
  variables: ['clientName'],
  active: true,
};

const activeClient = {
  id: 'cli-1',
  name: 'Maria Silva',
  email: 'maria@example.com',
  phoneE164: '+5511987654321',
  active: true,
};

const docRef = { externalDocumentId: 'zap-doc-1', externalOpenId: 'open-1', signUrl: 'https://sign/abc' };

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'tpl-1',
    clientId: 'cli-1',
    variables: [{ name: 'clientName', value: 'Maria Silva' }],
    idempotencyKey: 'idem-1',
    ...overrides,
  } as Parameters<typeof ContractsService.create>[1];
}

beforeEach(() => {
  mocks.clientRows = [activeClient];
  mocks.provider.createDocumentFromTemplate.mockResolvedValue(docRef);
  vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue(activeTemplate as never);
  vi.mocked(ContractsQuery.findByIdempotencyKey).mockResolvedValue(null as never);
  vi.mocked(ContractsQuery.insert).mockResolvedValue({ id: 'contract-1' } as never);
  vi.mocked(ContractsQuery.findById).mockResolvedValue({ id: 'contract-1', status: 'sent' } as never);
});

describe('ContractsService.create — idempotência', () => {
  it('replay: chave já existente devolve o contrato SEM chamar o provider', async () => {
    vi.mocked(ContractsQuery.findByIdempotencyKey).mockResolvedValue({
      id: 'contract-existing',
    } as never);

    const result = await ContractsService.create(TENANT, baseInput(), 'user-1');

    expect(result).toMatchObject({ id: 'contract-existing' });
    expect(mocks.provider.createDocumentFromTemplate).not.toHaveBeenCalled();
    expect(ContractsQuery.insert).not.toHaveBeenCalled();
  });

  it('caminho feliz: chama provider uma vez e insere com status "sent"', async () => {
    const result = await ContractsService.create(TENANT, baseInput(), 'user-1');

    expect(mocks.provider.createDocumentFromTemplate).toHaveBeenCalledTimes(1);
    expect(ContractsQuery.insert).toHaveBeenCalledTimes(1);
    const insertedRow = vi.mocked(ContractsQuery.insert).mock.calls[0]?.[2] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      status: 'sent',
      zapsignDocumentId: 'zap-doc-1',
      signUrl: 'https://sign/abc',
      idempotencyKey: 'idem-1',
    });
    expect(result).toMatchObject({ id: 'contract-1' });
  });

  it('race 23505 no insert: recupera o vencedor via re-busca pela idempotency_key', async () => {
    const pgErr = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'contracts_tenant_idempotency_unique',
    });
    vi.mocked(ContractsQuery.insert).mockRejectedValueOnce(pgErr as never);
    // preflight → null (não existia); na recuperação do catch → o vencedor.
    vi.mocked(ContractsQuery.findByIdempotencyKey)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'contract-winner' } as never);

    const result = await ContractsService.create(TENANT, baseInput(), 'user-1');

    expect(result).toMatchObject({ id: 'contract-winner' });
  });

  it('23505 de OUTRA constraint não é tratado como race — propaga o erro', async () => {
    const pgErr = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'contracts_zapsign_document_id_unique',
    });
    vi.mocked(ContractsQuery.insert).mockRejectedValueOnce(pgErr as never);

    await expect(ContractsService.create(TENANT, baseInput(), 'user-1')).rejects.toThrow('dup');
  });
});

describe('ContractsService.create — validações', () => {
  it('template desativado → AppError 409', async () => {
    vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue({
      ...activeTemplate,
      active: false,
    } as never);

    await expect(ContractsService.create(TENANT, baseInput(), 'user-1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.provider.createDocumentFromTemplate).not.toHaveBeenCalled();
  });

  it('cliente desativado → AppError 409', async () => {
    mocks.clientRows = [{ ...activeClient, active: false }];

    await expect(ContractsService.create(TENANT, baseInput(), 'user-1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.provider.createDocumentFromTemplate).not.toHaveBeenCalled();
  });

  it('template inexistente → AppError 404', async () => {
    vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue(null as never);

    await expect(ContractsService.create(TENANT, baseInput(), 'user-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('ContractsService.create — uniques de venda (Fase 7)', () => {
  it('23505 do unique de contrato de serviço → 409 com code sale_service_contract_active', async () => {
    const pgErr = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'contracts_sale_service_active_unique',
    });
    vi.mocked(ContractsQuery.insert).mockRejectedValueOnce(pgErr as never);

    await expect(
      ContractsService.create(
        TENANT,
        baseInput({ saleId: 'sale-1', idempotencyKey: undefined }),
        'user-1',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'sale_service_contract_active' },
    });
  });

  it('23505 do unique de termo de consentimento → 409 com code sale_consent_term_active', async () => {
    const pgErr = Object.assign(new Error('dup'), {
      code: '23505',
      constraint: 'contracts_sale_consent_template_active_unique',
    });
    vi.mocked(ContractsQuery.insert).mockRejectedValueOnce(pgErr as never);

    await expect(
      ContractsService.create(
        TENANT,
        baseInput({ saleId: 'sale-1', idempotencyKey: undefined }),
        'user-1',
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'sale_consent_term_active' },
    });
  });
});

describe('ContractsService.generateConsentTermsForSale (Fase 7)', () => {
  // Dedup da regra 3 (2 procedimentos no mesmo template = 1 termo) acontece no
  // SQL (selectDistinct em listTemplatesForProcedures) — aqui a query mockada já
  // devolve a lista deduplicada. O service só orquestra create por template.
  beforeEach(() => {
    mocks.saleRows = [{ id: 'sale-1', clientId: 'cli-1', journeyId: 'jrn-1' }];
    mocks.saleItemRows = [{ procedureId: 'proc-1' }, { procedureId: 'proc-2' }];
    mocks.tenantRows = [{ id: TENANT, name: 'Clínica' }];
    mocks.clientRows = [activeClient];
    vi.mocked(
      ConsentTemplateProceduresQuery.listTemplatesForProcedures,
    ).mockResolvedValue([
      { id: 'tpl-1', name: 'Termo A', variables: ['clientName'] },
    ] as never);
    vi.mocked(
      ContractsQuery.listActiveConsentTemplateIdsForSale,
    ).mockResolvedValue([] as never);
  });

  it('caminho feliz: cria 1 termo por template aplicável, passando saleId+variables resolvidas', async () => {
    const createSpy = vi
      .spyOn(ContractsService, 'create')
      .mockResolvedValue({ id: 'c-1' } as never);

    const res = await ContractsService.generateConsentTermsForSale(
      TENANT,
      'sale-1',
      'user-1',
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        saleId: 'sale-1',
        templateId: 'tpl-1',
        clientId: 'cli-1',
        journeyId: 'jrn-1',
        variables: [{ name: 'clientName', value: 'Maria Silva' }],
      }),
      'user-1',
    );
    expect(res.created).toHaveLength(1);
    expect(res.skipped).toHaveLength(0);
    createSpy.mockRestore();
  });

  it('pré-check: template já ativo é pulado SEM chamar create (não gasta quota)', async () => {
    vi.mocked(
      ContractsQuery.listActiveConsentTemplateIdsForSale,
    ).mockResolvedValue(['tpl-1'] as never);
    const createSpy = vi.spyOn(ContractsService, 'create');

    const res = await ContractsService.generateConsentTermsForSale(
      TENANT,
      'sale-1',
      'user-1',
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(res.created).toHaveLength(0);
    expect(res.skipped).toEqual([
      { templateId: 'tpl-1', templateName: 'Termo A', reason: 'already_active' },
    ]);
    createSpy.mockRestore();
  });

  it('erro de provider (5xx) num template não aborta os outros — created parcial + skipped provider_error', async () => {
    vi.mocked(
      ConsentTemplateProceduresQuery.listTemplatesForProcedures,
    ).mockResolvedValue([
      { id: 'tpl-1', name: 'Termo A', variables: ['clientName'] },
      { id: 'tpl-2', name: 'Termo B', variables: ['clientName'] },
    ] as never);
    const createSpy = vi
      .spyOn(ContractsService, 'create')
      .mockResolvedValueOnce({ id: 'c-1' } as never)
      .mockRejectedValueOnce(new AppError('ZapSign 503', 503));

    const res = await ContractsService.generateConsentTermsForSale(
      TENANT,
      'sale-1',
      'user-1',
    );

    expect(res.created).toHaveLength(1);
    expect(res.skipped).toEqual([
      { templateId: 'tpl-2', templateName: 'Termo B', reason: 'provider_error' },
    ]);
    createSpy.mockRestore();
  });

  it('corrida 23505 (sale_consent_term_active) vira skipped already_active, não erro', async () => {
    const createSpy = vi
      .spyOn(ContractsService, 'create')
      .mockRejectedValueOnce(
        new AppError('Já existe um termo deste tipo ativo para esta venda.', 409, {
          code: 'sale_consent_term_active',
        }),
      );

    const res = await ContractsService.generateConsentTermsForSale(
      TENANT,
      'sale-1',
      'user-1',
    );

    expect(res.created).toHaveLength(0);
    expect(res.skipped).toEqual([
      { templateId: 'tpl-1', templateName: 'Termo A', reason: 'already_active' },
    ]);
    createSpy.mockRestore();
  });

  it('venda inexistente → AppError 404', async () => {
    mocks.saleRows = [];
    await expect(
      ContractsService.generateConsentTermsForSale(TENANT, 'sale-x', 'user-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('ContractsService.handleSignatureEvent', () => {
  const foundContract = {
    id: 'contract-1',
    clientId: 'cli-1',
    client: { name: 'Maria Silva' },
    title: 'Termo',
    status: 'sent',
    metadata: {},
    zapsignDocumentId: 'zap-doc-1',
  };

  beforeEach(() => {
    vi.mocked(ContractsQuery.findByZapsignDocumentId).mockResolvedValue(foundContract as never);
    vi.mocked(ContractsQuery.updateStatus).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('evento unknown: não busca contrato nem publica', async () => {
    const ev: NormalizedSignatureEvent = {
      kind: 'unknown',
      rawEvent: 'doc_deleted',
      externalDocumentId: 'zap-doc-1',
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(ContractsQuery.findByZapsignDocumentId).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('contrato não encontrado: retorna sem publicar', async () => {
    vi.mocked(ContractsQuery.findByZapsignDocumentId).mockResolvedValue(null as never);
    const ev: NormalizedSignatureEvent = {
      kind: 'document.viewed',
      externalDocumentId: 'zap-doc-x',
      viewedAt: new Date('2026-06-03T10:00:00Z'),
      metadata: {},
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(ContractsQuery.updateStatus).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('estado terminal (já signed): viewed é absorvido sem update nem publish', async () => {
    vi.mocked(ContractsQuery.findByZapsignDocumentId).mockResolvedValue({
      ...foundContract,
      status: 'signed',
    } as never);
    const ev: NormalizedSignatureEvent = {
      kind: 'document.viewed',
      externalDocumentId: 'zap-doc-1',
      viewedAt: new Date('2026-06-03T10:00:00Z'),
      metadata: {},
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(ContractsQuery.updateStatus).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('viewed: atualiza status e publica contractStatusChanged', async () => {
    const viewedAt = new Date('2026-06-03T10:00:00Z');
    const ev: NormalizedSignatureEvent = {
      kind: 'document.viewed',
      externalDocumentId: 'zap-doc-1',
      viewedAt,
      metadata: { ip: '1.2.3.4' },
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(ContractsQuery.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'contract-1',
      expect.objectContaining({ status: 'viewed', viewedAt }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      'contract.status_changed',
      expect.objectContaining({ contractId: 'contract-1', status: 'viewed' }),
    );
  });

  it('declined: persiste failureReason e publica', async () => {
    const ev: NormalizedSignatureEvent = {
      kind: 'document.declined',
      externalDocumentId: 'zap-doc-1',
      declinedAt: new Date('2026-06-03T11:00:00Z'),
      reason: 'refused',
      metadata: {},
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(ContractsQuery.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'contract-1',
      expect.objectContaining({ status: 'declined', failureReason: 'refused' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      'contract.status_changed',
      expect.objectContaining({ status: 'declined' }),
    );
  });

  it('signed: baixa PDF da signedPdfUrl, persiste no storage e marca signed com objectKey', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    vi.mocked(ContractStorage.persistSignedPdf).mockResolvedValue('tenant-1/2026/06/contract-1.pdf');

    const signedAt = new Date('2026-06-03T12:00:00Z');
    const ev: NormalizedSignatureEvent = {
      kind: 'document.signed',
      externalDocumentId: 'zap-doc-1',
      signedAt,
      signedPdfUrl: 'https://files/y.pdf',
      metadata: {},
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    expect(fetch).toHaveBeenCalledWith('https://files/y.pdf');
    expect(ContractStorage.persistSignedPdf).toHaveBeenCalledWith(
      TENANT,
      'contract-1',
      expect.any(Buffer),
    );
    expect(ContractsQuery.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'contract-1',
      expect.objectContaining({
        status: 'signed',
        signedAt,
        signedPdfObjectKey: 'tenant-1/2026/06/contract-1.pdf',
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      'contract.status_changed',
      expect.objectContaining({ status: 'signed' }),
    );
  });

  it('signed: falha no download do PDF não bloqueia o update de status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mocks.provider.downloadSignedPdf.mockRejectedValue(new Error('provider down'));

    const ev: NormalizedSignatureEvent = {
      kind: 'document.signed',
      externalDocumentId: 'zap-doc-1',
      signedAt: new Date('2026-06-03T12:00:00Z'),
      signedPdfUrl: 'https://files/y.pdf',
      metadata: {},
    };
    await ContractsService.handleSignatureEvent(TENANT, ev);

    // Sem PDF, persistSignedPdf não roda, mas o status ainda vira signed
    // (objectKey null → download cai no fallback on-demand depois).
    expect(ContractStorage.persistSignedPdf).not.toHaveBeenCalled();
    expect(ContractsQuery.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'contract-1',
      expect.objectContaining({ status: 'signed', signedPdfObjectKey: null }),
    );
  });
});

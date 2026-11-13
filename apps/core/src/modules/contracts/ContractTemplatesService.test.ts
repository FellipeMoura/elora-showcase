import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractTemplatesService } from './ContractTemplatesService.js';
import { ContractTemplatesQuery } from './ContractTemplatesQuery.js';
import { ConsentTemplateProceduresQuery } from './ConsentTemplateProceduresQuery.js';

// ---------------------------------------------------------------------------
// Camada B — unit com mocks. Foca na ORQUESTRAÇÃO do vínculo template ×
// procedimento (Fase 7): validação de `kind='consent_term'`, existência do
// procedimento, e o retorno da lista atualizada. SQL/RLS real fica pra
// integração.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  procRows: [] as unknown[],
}));

// withTenant fake: cb(tx) cujo select().from().where().limit() resolve procRows
// (usado pra checar existência do procedimento dentro do link).
vi.mock('@elora/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@elora/db')>();
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(mocks.procRows),
  };
  return {
    ...actual,
    withTenant: (_db: unknown, _t: string, cb: (tx: unknown) => unknown) =>
      cb({ select: () => chain }),
  };
});
vi.mock('../../shared/database/db.js', () => ({ db: {} }));
vi.mock('../../shared/providers/signature/index.js', () => ({
  getSignatureProvider: () => ({}),
}));
vi.mock('./ContractTemplatesQuery.js', () => ({
  ContractTemplatesQuery: { findById: vi.fn() },
}));
vi.mock('./ConsentTemplateProceduresQuery.js', () => ({
  ConsentTemplateProceduresQuery: {
    list: vi.fn(),
    link: vi.fn(),
    unlink: vi.fn(),
  },
}));

const TENANT = 'tenant-1';
const consentTemplate = { id: 'tpl-1', kind: 'consent_term', name: 'Termo' };
const linkedList = [{ id: 'proc-1', name: 'Depilação' }];

beforeEach(() => {
  mocks.procRows = [{ id: 'proc-1' }];
  vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue(
    consentTemplate as never,
  );
  vi.mocked(ConsentTemplateProceduresQuery.list).mockResolvedValue(
    linkedList as never,
  );
  vi.mocked(ConsentTemplateProceduresQuery.link).mockResolvedValue(
    undefined as never,
  );
  vi.mocked(ConsentTemplateProceduresQuery.unlink).mockResolvedValue(
    true as never,
  );
});

describe('ContractTemplatesService.linkProcedure', () => {
  it('template que não é consent_term → AppError 409 e não vincula', async () => {
    vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue({
      ...consentTemplate,
      kind: 'service_contract',
    } as never);

    await expect(
      ContractTemplatesService.linkProcedure(TENANT, 'tpl-1', 'proc-1'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(ConsentTemplateProceduresQuery.link).not.toHaveBeenCalled();
  });

  it('template inexistente → AppError 404', async () => {
    vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue(null as never);

    await expect(
      ContractTemplatesService.linkProcedure(TENANT, 'tpl-x', 'proc-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(ConsentTemplateProceduresQuery.link).not.toHaveBeenCalled();
  });

  it('procedimento inexistente → AppError 404', async () => {
    mocks.procRows = [];

    await expect(
      ContractTemplatesService.linkProcedure(TENANT, 'tpl-1', 'proc-x'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(ConsentTemplateProceduresQuery.link).not.toHaveBeenCalled();
  });

  it('consent_term + procedimento existente: vincula e devolve a lista atualizada', async () => {
    const result = await ContractTemplatesService.linkProcedure(
      TENANT,
      'tpl-1',
      'proc-1',
    );

    expect(ConsentTemplateProceduresQuery.link).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      'tpl-1',
      'proc-1',
    );
    expect(result).toEqual(linkedList);
  });
});

describe('ContractTemplatesService.unlinkProcedure', () => {
  it('remove o vínculo e devolve a lista atualizada', async () => {
    const result = await ContractTemplatesService.unlinkProcedure(
      TENANT,
      'tpl-1',
      'proc-1',
    );

    expect(ConsentTemplateProceduresQuery.unlink).toHaveBeenCalledWith(
      expect.anything(),
      'tpl-1',
      'proc-1',
    );
    expect(result).toEqual(linkedList);
  });

  it('template inexistente → AppError 404', async () => {
    vi.mocked(ContractTemplatesQuery.findById).mockResolvedValue(null as never);

    await expect(
      ContractTemplatesService.unlinkProcedure(TENANT, 'tpl-x', 'proc-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

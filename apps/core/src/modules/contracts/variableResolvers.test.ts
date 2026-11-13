import { describe, it, expect } from 'vitest';
import type { ClientAddress, InferSelectModel, clients, tenants } from '@elora/db';
import { resolveKnownVariables, getKnownVariableKeys } from './variableResolvers.js';

type Client = InferSelectModel<typeof clients>;
type Tenant = InferSelectModel<typeof tenants>;

// Fixtures mínimas — só os campos que o catálogo lê. Cast via `unknown` porque
// `clients`/`tenants` têm colunas de infra (id, tenant_id, timestamps) que não
// importam aqui; cada teste varia UM campo por spread pra isolar o que prova.
const fullAddress: ClientAddress = {
  zipCode: '01310100',
  street: 'Av. Paulista',
  number: '1000',
  complement: 'Conj. 42',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'SP',
  country: 'Brasil',
};

const baseClient = {
  name: 'Maria Silva',
  document: '52998224725', // 11 dígitos (formatter só checa contagem, não dígito verificador)
  email: 'maria@example.com',
  phoneE164: '+5511987654321',
  birthDate: '1990-05-20',
  address: fullAddress,
} as unknown as Client;

const baseTenant = {
  name: 'Clínica Estética X',
  legalName: 'Clínica X LTDA',
  tradeName: 'Estética X',
  document: '11222333000181', // 14 dígitos
  representativeName: 'Dra. Ana',
} as unknown as Tenant;

const ctx = () => ({ client: { ...baseClient }, tenant: { ...baseTenant } });

describe('resolveKnownVariables — formatters fiscais', () => {
  it('formata CPF de 11 dígitos como XXX.XXX.XXX-XX', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientDocument).toBe('529.982.247-25');
  });

  it('expõe o CPF cru sem formatação em clientDocumentRaw', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientDocumentRaw).toBe('52998224725');
  });

  it('CPF com contagem de dígitos errada vira string vazia (não lança)', () => {
    const { resolved } = resolveKnownVariables({
      client: { ...baseClient, document: '123' } as Client,
      tenant: baseTenant,
    });
    expect(resolved.clientDocument).toBe('');
  });

  it('formata CNPJ de 14 dígitos como XX.XXX.XXX/XXXX-XX', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.tenantDocument).toBe('11.222.333/0001-81');
  });

  it('formata CEP de 8 dígitos como XXXXX-XXX', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientAddressZip).toBe('01310-100');
  });

  it('formata telefone E.164 BR como +55 (DD) XXXXX-XXXX', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientPhone).toBe('+55 (11) 98765-4321');
  });

  it('telefone não-BR é devolvido cru (não inventa formato)', () => {
    const { resolved } = resolveKnownVariables({
      client: { ...baseClient, phoneE164: '+14155552671' } as Client,
      tenant: baseTenant,
    });
    expect(resolved.clientPhone).toBe('+14155552671');
  });

  it('formata birthDate YYYY-MM-DD como DD/MM/AAAA', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientBirthDate).toBe('20/05/1990');
  });

  it('concatena o endereço completo com separadores legíveis', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(resolved.clientAddress).toBe(
      'Av. Paulista, 1000, Conj. 42 — Bela Vista — São Paulo/SP — CEP 01310-100',
    );
  });
});

describe('resolveKnownVariables — campos faltantes (missing)', () => {
  it('CPF ausente cai como missing reason "empty"', () => {
    const { missing } = resolveKnownVariables({
      client: { ...baseClient, document: null } as unknown as Client,
      tenant: baseTenant,
    });
    const cpf = missing.find((m) => m.label === 'CPF do cliente');
    expect(cpf?.reason).toBe('empty');
  });

  it('CPF cadastrado mas com formato inválido cai como reason "invalid"', () => {
    // '12345' existe no cadastro mas o formatter rejeita (não tem 11 dígitos).
    // UX precisa distinguir disso de "não cadastrado" — senão o operador que
    // digitou algo pensa "mas eu preenchi!".
    const { missing } = resolveKnownVariables({
      client: { ...baseClient, document: '12345' } as Client,
      tenant: baseTenant,
    });
    const cpf = missing.find((m) => m.label === 'CPF do cliente');
    expect(cpf?.reason).toBe('invalid');
  });

  it('dedupa por label: clientDocument + clientDocumentRaw viram UMA entrada', () => {
    const { missing } = resolveKnownVariables({
      client: { ...baseClient, document: null } as unknown as Client,
      tenant: baseTenant,
    });
    const cpfEntries = missing.filter((m) => m.label === 'CPF do cliente');
    expect(cpfEntries).toHaveLength(1);
    // ambas as chaves da mesma origem ficam agrupadas sob a entrada única.
    expect(cpfEntries[0]?.keys).toEqual(
      expect.arrayContaining(['clientDocument', 'clientDocumentRaw']),
    );
  });

  it('variáveis source "system" (today/todayLong) nunca entram em missing', () => {
    const { missing } = resolveKnownVariables(ctx());
    expect(missing.every((m) => m.source !== 'system')).toBe(true);
  });

  it('ordena missing com origem client antes de tenant', () => {
    const { missing } = resolveKnownVariables({
      client: { ...baseClient, document: null, email: null } as unknown as Client,
      tenant: { ...baseTenant, document: null } as unknown as Tenant,
    });
    const firstTenantIdx = missing.findIndex((m) => m.source === 'tenant');
    const lastClientIdx = missing.map((m) => m.source).lastIndexOf('client');
    expect(lastClientIdx).toBeLessThan(firstTenantIdx);
  });
});

describe('getKnownVariableKeys', () => {
  it('inclui as chaves conhecidas de client, tenant e system', () => {
    const keys = getKnownVariableKeys();
    expect(keys).toEqual(
      expect.arrayContaining(['clientName', 'clientDocument', 'tenantDocument', 'today']),
    );
  });

  it('toda chave resolvida está presente no catálogo de chaves conhecidas', () => {
    const { resolved } = resolveKnownVariables(ctx());
    expect(Object.keys(resolved).sort()).toEqual(getKnownVariableKeys().sort());
  });
});

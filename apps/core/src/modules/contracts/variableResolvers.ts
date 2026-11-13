import {
  clients,
  tenants,
  type ClientAddress,
  type InferSelectModel,
} from '@elora/db';

type Client = InferSelectModel<typeof clients>;
type Tenant = InferSelectModel<typeof tenants>;

// =====================================================================
// Catálogo de variáveis "conhecidas" — chaves que o backend resolve
// automaticamente a partir de `clients` + `tenants` quando o operador
// abre o ContractSendSheet pra um cliente específico.
//
// Convenção (Opção A, ver docs/contracts-domain.md §11):
// - Chaves em camelCase (regra 1 do CLAUDE.md — JS = camelCase). Prefixo
//   `client*` pra dados do cliente, `tenant*` pra dados da clínica (bate
//   com nome da tabela; "clínica" é vertical de produto, tenant é infra).
// - Admin cria o template no painel ZapSign usando ESSES nomes de variável.
// - Backend resolve tudo que conhece; resto cai como input manual no envio.
// - Nada de mapeamento explícito por template — convenção > configuração.
//
// Quando um campo novo for adicionado em `clients`/`tenants` que faça
// sentido expor, basta acrescentar uma entrada aqui e atualizar a tabela
// no doc. Não precisa migration nem mexer em template.
// =====================================================================

export interface ResolverContext {
  client: Client;
  tenant: Tenant;
}

// `system` = data atual/derivado, não vem de cadastro → nunca conta como
// "campo faltante" no preflight. `client`/`tenant` apontam pro cadastro
// que o operador precisa preencher quando o resolver retorna vazio.
export type VariableSource = 'client' | 'tenant' | 'system';

type ResolverFn = (ctx: ResolverContext) => string;
type RawValueFn = (ctx: ResolverContext) => string | null | undefined;

interface CatalogEntry {
  resolve: ResolverFn;
  source: VariableSource;
  // Label PT-BR humano usado no banner de aviso ("Preencha X no cadastro").
  // Múltiplas chaves podem compartilhar o mesmo label (e.g., `clientDocument`
  // e `clientDocumentRaw` viram "CPF do cliente") — o `missing` final é
  // dedupado por label pra UX não listar 2x o mesmo campo.
  label: string;
  // Para chaves com formatter (CPF/CNPJ/CEP/data): valor cru antes da
  // formatação. Permite distinguir "cadastro vazio" de "cadastro com formato
  // inválido" — UX importa porque o operador que cadastrou "12345" como CPF
  // veria "preencha CPF" sem entender que o problema é o formato.
  rawValue?: RawValueFn;
}

const CATALOG: Record<string, CatalogEntry> = {
  // ---- Cliente ----
  clientName: {
    resolve: ({ client }) => client.name,
    source: 'client',
    label: 'Nome do cliente',
  },
  clientDocument: {
    resolve: ({ client }) => formatCpf(client.document),
    rawValue: ({ client }) => client.document,
    source: 'client',
    label: 'CPF do cliente',
  },
  clientDocumentRaw: {
    resolve: ({ client }) => client.document ?? '',
    source: 'client',
    label: 'CPF do cliente',
  },
  clientEmail: {
    resolve: ({ client }) => client.email ?? '',
    source: 'client',
    label: 'E-mail do cliente',
  },
  clientPhone: {
    resolve: ({ client }) => formatPhone(client.phoneE164),
    source: 'client',
    label: 'Telefone do cliente',
  },
  clientPhoneRaw: {
    resolve: ({ client }) => client.phoneE164,
    source: 'client',
    label: 'Telefone do cliente',
  },
  clientBirthDate: {
    resolve: ({ client }) => formatDate(client.birthDate),
    rawValue: ({ client }) => client.birthDate,
    source: 'client',
    label: 'Data de nascimento do cliente',
  },

  // `clientAddress` é o endereço inteiro concatenado — formato pronto pra
  // colocar no contrato. Os componentes individuais ficam disponíveis caso
  // o template prefira montar a frase no DOCX.
  clientAddress: {
    resolve: ({ client }) => formatAddressFull(client.address),
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressZip: {
    resolve: ({ client }) => formatCep(client.address?.zipCode),
    rawValue: ({ client }) => client.address?.zipCode,
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressStreet: {
    resolve: ({ client }) => client.address?.street ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressNumber: {
    resolve: ({ client }) => client.address?.number ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressComplement: {
    resolve: ({ client }) => client.address?.complement ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressNeighborhood: {
    resolve: ({ client }) => client.address?.neighborhood ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressCity: {
    resolve: ({ client }) => client.address?.city ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressState: {
    resolve: ({ client }) => client.address?.state ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },
  clientAddressCountry: {
    resolve: ({ client }) => client.address?.country ?? '',
    source: 'client',
    label: 'Endereço do cliente',
  },

  // ---- Tenant (clínica) ----
  // Prefixo `tenant*` em vez de `clinic_*` pra bater com a tabela do banco
  // (tenants) — clínica é o vertical de produto, tenant é a infra. Convenção
  // camelCase segue a regra 1 do CLAUDE.md (JS = camelCase).
  tenantName: {
    resolve: ({ tenant }) => tenant.name,
    source: 'tenant',
    label: 'Nome da clínica',
  },
  tenantLegalName: {
    resolve: ({ tenant }) => tenant.legalName ?? '',
    source: 'tenant',
    label: 'Razão social da clínica',
  },
  tenantTradeName: {
    resolve: ({ tenant }) => tenant.tradeName ?? '',
    source: 'tenant',
    label: 'Nome fantasia da clínica',
  },
  tenantDocument: {
    resolve: ({ tenant }) => formatCnpj(tenant.document),
    rawValue: ({ tenant }) => tenant.document,
    source: 'tenant',
    label: 'CNPJ da clínica',
  },
  tenantDocumentRaw: {
    resolve: ({ tenant }) => tenant.document ?? '',
    source: 'tenant',
    label: 'CNPJ da clínica',
  },
  tenantRepresentativeName: {
    resolve: ({ tenant }) => tenant.representativeName ?? '',
    source: 'tenant',
    label: 'Representante legal da clínica',
  },

  // ---- Tempo (system — sempre tem valor, nunca vai pra missing) ----
  today: {
    resolve: () => formatDate(new Date()),
    source: 'system',
    label: 'Data de hoje',
  },
  todayLong: {
    resolve: () => formatDateLong(new Date()),
    source: 'system',
    label: 'Data de hoje (extenso)',
  },
};

export function getKnownVariableKeys(): string[] {
  return Object.keys(CATALOG);
}

// `empty`  = cadastro não preenchido (operador precisa cadastrar).
// `invalid` = cadastro tem valor, mas formatter rejeitou (ex: CPF "12345" não
//            forma 11 dígitos). UI mostra "formato inválido" pra evitar que
//            o operador pense "mas eu cadastrei!".
export type MissingReason = 'empty' | 'invalid';

export interface MissingVariableField {
  // Chaves do catálogo que ficaram vazias e compartilham o mesmo label.
  keys: string[];
  source: VariableSource;
  label: string;
  reason: MissingReason;
}

export interface ResolveVariablesOutput {
  resolved: Record<string, string>;
  missing: MissingVariableField[];
}

// Resolve todas as variáveis conhecidas + lista campos vazios (agrupados
// por label pra evitar listar 2x o mesmo "CPF do cliente" só porque `_raw`
// e formatado vêm da mesma coluna).
export function resolveKnownVariables(ctx: ResolverContext): ResolveVariablesOutput {
  const resolved: Record<string, string> = {};
  // Por label: acumula chaves vazias compartilhando a origem comum.
  const missingByLabel = new Map<string, MissingVariableField>();

  for (const [key, entry] of Object.entries(CATALOG)) {
    let value: string;
    try {
      value = entry.resolve(ctx);
    } catch {
      value = '';
    }
    resolved[key] = value;

    if (value !== '' || entry.source === 'system') continue;

    // Distingue "vazio" de "inválido": se o catálogo declarou `rawValue` e ele
    // veio com conteúdo, o cadastro existe mas o formatter rejeitou.
    let reason: MissingReason = 'empty';
    if (entry.rawValue) {
      const raw = (entry.rawValue(ctx) ?? '').toString().trim();
      if (raw !== '') reason = 'invalid';
    }

    const existing = missingByLabel.get(entry.label);
    if (existing) {
      existing.keys.push(key);
      // `invalid` é mais informativo que `empty` quando ambas as chaves
      // dividem o mesmo label — promove pra invalid se qualquer uma for.
      if (reason === 'invalid') existing.reason = 'invalid';
    } else {
      missingByLabel.set(entry.label, {
        keys: [key],
        source: entry.source,
        label: entry.label,
        reason,
      });
    }
  }

  return {
    resolved,
    // Ordem estável: client primeiro, depois tenant — facilita varredura visual.
    missing: Array.from(missingByLabel.values()).sort((a, b) => {
      if (a.source !== b.source) return a.source === 'client' ? -1 : 1;
      return a.label.localeCompare(b.label, 'pt-BR');
    }),
  };
}

// =====================================================================
// Formatters — todos defensivos, devolvem string vazia se entrada inválida.
// Não jogamos exceção: contrato com 1 campo vazio é melhor que envio que
// quebra inteiro porque alguém não cadastrou CPF.
// =====================================================================

function formatCpf(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return '';
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCnpj(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length !== 14) return '';
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function formatCep(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

// Formata phone E.164 BR como "+55 (11) 98765-4321". Demais países: devolve
// o E.164 cru pra não inventar formato.
function formatPhone(e164: string | null | undefined): string {
  const raw = (e164 ?? '').trim();
  if (!raw) return '';
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(raw);
  if (!m) return raw;
  return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
}

// `date` da coluna `birthDate` vem como string YYYY-MM-DD (Drizzle/pg).
// `Date` (hoje) é processado pelos campos `today*`.
function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function formatDateLong(value: Date): string {
  return `${pad(value.getDate())} de ${MONTH_NAMES_PT[value.getMonth()]} de ${value.getFullYear()}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatAddressFull(addr: ClientAddress | null | undefined): string {
  if (!addr) return '';
  // "Rua X, 123, Apto 4 — Bairro Y, Cidade/UF — CEP 00000-000"
  const street = [addr.street, addr.number].filter(Boolean).join(', ');
  const head = [street, addr.complement].filter(Boolean).join(', ');
  const mid = [addr.neighborhood].filter(Boolean).join(', ');
  const cityState = [addr.city, addr.state].filter(Boolean).join('/');
  const tail = formatCep(addr.zipCode);
  return [head, mid, cityState, tail ? `CEP ${tail}` : '']
    .filter(Boolean)
    .join(' — ');
}

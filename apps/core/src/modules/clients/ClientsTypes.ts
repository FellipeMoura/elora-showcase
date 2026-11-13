import { clients, type ClientAddress, type InferSelectModel } from '@elora/db';

// Client enriquecido com info de chat e jornada atual. Vem da
// `findPaginated` e `findById` via subqueries. UI usa pra:
//  - surfacear ícone "abrir chat" (whatsappContactId / conversationId);
//  - criar conversation lazy (whatsappChannelId);
//  - mostrar chip do stage da jornada ativa (currentJourneyStage).
export type ClientWithChat = InferSelectModel<typeof clients> & {
  whatsappContactId: string | null;
  whatsappChannelId: string | null;
  conversationId: string | null;
  // Stage da journey active do cliente. Null quando o cliente não tem
  // jornada ativa (cadastro novo sem lead, ou todas as jornadas em lost/won).
  currentJourneyStage:
    | 'lead'
    | 'evaluation'
    | 'sale'
    | 'treatment'
    | 'result'
    | null;
};
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Client = InferSelectModel<typeof clients>;

// Whitelist de campos sortáveis. Cada slug mapeia pra coluna Drizzle —
// nunca recebemos string crua do cliente direto pra orderBy.
export const clientsSortSpec = createSortSpec(
  {
    name: clients.name,
    phoneE164: clients.phoneE164,
    email: clients.email,
    birthDate: clients.birthDate,
    createdAt: clients.createdAt,
    updatedAt: clients.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

// Telefone armazenado em E.164 (+ código do país + número, sem espaço/máscara).
// Frontend é responsável por normalizar antes de submeter.
const phoneE164Regex = /^\+[1-9]\d{7,14}$/;
const phoneE164Schema = z
  .string()
  .trim()
  .regex(phoneE164Regex, 'Telefone deve estar em formato E.164 (ex: +5511999999999)')
  .max(20);

// Aceitamos `null` explícito em campos opcionais pra permitir "limpar" o
// valor via PATCH; `undefined` significa "não mexer".
const optionalNullableEmail = z
  .string()
  .trim()
  .email('Email inválido')
  .max(255)
  .nullable();

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em formato YYYY-MM-DD');

// CPF — dígitos apenas. Aceita entrada com ou sem máscara (normaliza no
// transform). Refine confere só o tamanho (11); validação do DV fica fora do
// escopo pra não bloquear seed/dev com CPFs fictícios.
const cpfSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 11, 'CPF deve conter 11 dígitos');

// Endereço — todos campos opcionais. Estado em UF (2 letras maiúsculas),
// CEP em dígitos apenas. UI formata na apresentação.
const addressSchema = z
  .object({
    zipCode: z
      .string()
      .trim()
      .transform((s) => s.replace(/\D/g, ''))
      .refine((s) => s.length === 0 || s.length === 8, 'CEP deve conter 8 dígitos')
      .optional(),
    street: z.string().trim().max(255).optional(),
    number: z.string().trim().max(20).optional(),
    complement: z.string().trim().max(255).optional(),
    neighborhood: z.string().trim().max(255).optional(),
    city: z.string().trim().max(120).optional(),
    state: z
      .string()
      .trim()
      .length(2, 'UF deve ter 2 letras')
      .toUpperCase()
      .optional(),
    country: z.string().trim().max(60).optional(),
  })
  .openapi('ClientAddress');

// Sanity check (compile-time): output do addressSchema continua compatível
// com a tipagem do jsonb armazenado em clients.address.
const _addressShape: ClientAddress = {} as z.infer<typeof addressSchema>;
void _addressShape;

export const clientResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    phoneE164: z.string(),
    email: z.string().nullable(),
    birthDate: z.string().nullable(),
    document: z.string().nullable(),
    address: addressSchema.nullable(),
    notes: z.string().nullable(),
    isVip: z.boolean(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    // whatsapp_contacts.id do contact ativo do cliente (null quando o cliente
    // não tem WhatsApp cadastrado ou contact foi desativado).
    whatsappContactId: z.string().uuid().nullable(),
    // Canal WhatsApp do contact ativo — usado pelo frontend pra criar
    // conversation via POST /conversations quando o cliente tem contact
    // mas ainda não tem conversation (cadastro manual + WhatsApp checado).
    whatsappChannelId: z.string().uuid().nullable(),
    // conversation associada ao contact ativo — usada pelo botão "abrir
    // chat" na listagem. Null quando contact não tem conversation ainda
    // (ex.: cliente cadastrado manualmente, sem mensagem trocada).
    conversationId: z.string().uuid().nullable(),
    // Stage da journey ativa do cliente. Cliente tem no máximo 1 ativa
    // (invariante). Null quando não há ativa — cadastro sem lead ou todas
    // as journeys fechadas (won/lost).
    currentJourneyStage: z
      .enum(['lead', 'evaluation', 'sale', 'treatment', 'result'])
      .nullable(),
  })
  .openapi('Client');

export const createClientSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Maria Silva' }),
    phoneE164: phoneE164Schema.openapi({ example: '+5511999999999' }),
    email: optionalNullableEmail.optional(),
    birthDate: isoDateSchema.nullable().optional(),
    document: cpfSchema.nullable().optional().openapi({ example: '12345678909' }),
    address: addressSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    isVip: z.boolean().optional(),
  })
  .openapi('CreateClientInput');

export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    phoneE164: phoneE164Schema.optional(),
    email: optionalNullableEmail.optional(),
    birthDate: isoDateSchema.nullable().optional(),
    document: cpfSchema.nullable().optional(),
    address: addressSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    isVip: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateClientInput');

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const findClientsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    isVip: z.coerce.boolean().optional(),
  })
  .merge(sortQuerySchema(clientsSortSpec))
  .openapi('FindClientsQuery');

export type FindClientsQuery = z.infer<typeof findClientsQuerySchema>;

// Endpoint GET /clients/check — usado pelo cadastro pra dar feedback em
// tempo real (telefone já cadastrado bloqueia submit). Devolve o cliente
// existente (id+name) quando o telefone bate com algum do tenant.
export const checkClientQuerySchema = z
  .object({
    phoneE164: z
      .string()
      .trim()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'phoneE164 deve estar em formato E.164 (ex: +5511999999999)',
      )
      .openapi({ example: '+5511999999999' }),
  })
  .openapi('CheckClientQuery');

export type CheckClientQuery = z.infer<typeof checkClientQuerySchema>;

export const checkClientResponseSchema = z
  .object({
    exists: z.boolean(),
    client: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        active: z.boolean(),
      })
      .nullable()
      .openapi({
        description:
          'Cliente existente quando phoneE164 bate. Inclui `active` pra UI ' +
          'decidir se sugere reativar ou bloqueia (regra de cadastro vai no ' +
          'frontend — backend só reporta).',
      }),
  })
  .openapi('CheckClientResponse');

export const clientIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type ClientIdParam = z.infer<typeof clientIdParamSchema>;

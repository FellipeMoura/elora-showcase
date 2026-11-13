import type { InferSelectModel, users } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type User = InferSelectModel<typeof users>;
export type PublicUser = Omit<User, 'passwordHash'>;

// Schema Zod do shape de preferences. Single source of truth — `me` e users
// re-exportam. Mantém em sync com `UserPreferences` em @elora/db/schema.ts.
export const userPreferencesSchema = z
  .object({
    chatNotificationLevel: z.enum(['quiet', 'medium', 'aggressive']).optional(),
    // Determina qual cor é destaque no card da agenda — status ou procedure.
    // Default no app: 'status' (ver shared/journeys ou frontend calendar).
    calendarColorMode: z.enum(['status', 'procedure']).optional(),
  })
  .openapi('UserPreferences');

// Schema Zod do PublicUser — fonte de verdade pra resposta de /users e
// /auth/me. AuthTypes re-exporta este schema. Atualizar se schema.ts
// mudar a tabela users.
export const publicUserSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    username: z.string(),
    // `email` é opcional — usado só como contato/recovery. Null quando o user
    // foi criado sem endereço (fluxo interno como system agent).
    email: z.string().email().nullable(),
    name: z.string(),
    active: z.boolean(),
    canEvaluate: z.boolean().openapi({
      description:
        'Habilita o usuário como avaliador. Gate adicional ao role: appointments ' +
        'kind=evaluation exigem o profissional com canEvaluate=true.',
    }),
    canApplyProcedures: z.boolean().openapi({
      description:
        'Habilita o usuário como aplicador. Gate adicional ao role: appointments ' +
        'kind=procedure exigem o profissional com canApplyProcedures=true.',
    }),
    preferences: userPreferencesSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('PublicUser');

// Mesma forma do PublicUser + groupIds embedded. Resposta de /users (lista
// e single) usa esta. /auth/me continua com publicUserSchema (sem groups,
// pra não engordar a resposta do happy-path de auth check).
//
// Schema Zod só pra OpenAPI; o type TS usa o shape do DB (datas como Date,
// não string) — mesma convenção de PublicUser. Express serializa Date pra
// ISO no JSON automaticamente.
export const userWithGroupsSchema = publicUserSchema
  .extend({
    groupIds: z.array(z.string().uuid()).openapi({
      description: 'IDs dos grupos globais a que o usuário pertence (user_groups).',
    }),
  })
  .openapi('UserWithGroups');

export type UserWithGroups = PublicUser & { groupIds: string[] };

export const createUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, 'Username obrigatório')
      .max(255)
      .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _')
      .openapi({ example: 'maria', description: 'Identificador de login. Único por tenant. Apenas [a-z0-9_].' }),
    email: z
      .string()
      .trim()
      .email('Email inválido')
      .max(255)
      .nullable()
      .optional()
      .openapi({ example: 'maria@clinica.com', description: 'Contato opcional (omitir ou `null` = sem email); usado só pra recuperação de senha e afins.' }),
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Maria Silva' }),
    password: z
      .string()
      .min(6, 'Senha muito curta')
      .max(100)
      .openapi({ example: 'senha123' }),
    canEvaluate: z.boolean().optional().openapi({
      description: 'Habilita o usuário como avaliador. Default false.',
    }),
    canApplyProcedures: z.boolean().optional().openapi({
      description: 'Habilita o usuário como aplicador. Default false.',
    }),
  })
  .openapi('CreateUserInput');

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _')
      .optional(),
    // `null` explícito remove o e-mail atual; string vazia é rejeitada como
    // formato inválido pela validação `.email()`.
    email: z.string().trim().email('Email inválido').max(255).nullable().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(6).max(100).optional(),
    canEvaluate: z.boolean().optional(),
    canApplyProcedures: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateUserInput');

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const findUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .openapi('FindUsersQuery');

export type FindUsersQuery = z.infer<typeof findUsersQuerySchema>;

export const userIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;

// Set idempotente — substitui a lista completa de grupos do user.
export const setUserGroupsSchema = z
  .object({
    groupIds: z
      .array(z.string().uuid('groupId inválido'))
      .openapi({
        description:
          'Lista exata de grupos globais que o usuário deve pertencer. ' +
          'Backend faz diff: insere os que faltam, remove os ausentes.',
      }),
  })
  .openapi('SetUserGroupsInput');

export type SetUserGroupsInput = z.infer<typeof setUserGroupsSchema>;

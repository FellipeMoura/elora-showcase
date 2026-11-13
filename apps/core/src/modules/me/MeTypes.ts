import { z } from '../../shared/openapi/registry.js';
import { userPreferencesSchema } from '../users/UsersTypes.js';

// Re-exporta o schema completo pra OpenAPI registrar com nome local também.
// O backend trata ambos como o mesmo conceito; o re-export é pra deixar
// claro nos endpoints `/me/preferences` qual é o shape.
export const meGetPreferencesResponseSchema = userPreferencesSchema;

// Patch: aceita os mesmos campos opcionais, mas exige ao menos um campo
// presente — PATCH vazio não faz sentido.
export const meUpdatePreferencesSchema = userPreferencesSchema
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateMyPreferencesInput');

export type MeUpdatePreferencesInput = z.infer<typeof meUpdatePreferencesSchema>;

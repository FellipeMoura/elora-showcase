import { z } from '../../shared/openapi/registry.js';
import { publicUserSchema, type PublicUser } from '../users/UsersTypes.js';

export const loginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, 'Username obrigatório')
      .max(255)
      .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _')
      .openapi({ example: 'admin', description: 'Nome de usuário (login). Apenas [a-z0-9_].' }),
    password: z
      .string()
      .min(6, 'Senha muito curta')
      .openapi({ example: 'senha123', description: 'Mínimo 6 caracteres.' }),
  })
  .openapi('LoginInput');

export type LoginInput = z.infer<typeof loginSchema>;

// Resposta pública — token vai no cookie httpOnly, nunca no body.
export interface LoginResponse {
  user: PublicUser;
}

// `publicUserSchema` mora em UsersTypes (fonte de verdade da entidade User).
// Aqui só envolvemos em wrappers de response específicos do auth.
export const loginResponseSchema = z
  .object({
    user: publicUserSchema,
  })
  .openapi('LoginResponse');

export const meResponseSchema = z
  .object({
    user: publicUserSchema,
    roleCodes: z.array(z.string()).openapi({
      example: ['admin'],
      description: 'Roles efetivos do usuário (dedup dos grupos).',
    }),
    chatEnabled: z.boolean().openapi({
      example: true,
      description:
        'Chat WhatsApp visível pra este usuário: permission chat:use e ao menos um canal ativo no tenant.',
    }),
  })
  .openapi('MeResponse');

// Resultado interno do Service — Controller usa o token pra setar cookie.
export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: PublicUser;
}

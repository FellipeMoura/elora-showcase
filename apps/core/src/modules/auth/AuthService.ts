import { getTokenExpiration, signToken, verifyPassword } from '@elora/auth';
import { eq, groups, userGroups, whatsappChannels, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { env } from '../../env.js';
import { hasPermission, type RoleCode } from '../../shared/permissions/permissions.js';
import { UsersQuery } from '../users/UsersQuery.js';
import type { PublicUser, User } from '../users/UsersTypes.js';
import type { LoginInput, LoginResult } from './AuthTypes.js';

function toPublic(user: User): PublicUser {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

export const AuthService = {
  login: async (tenantId: string, input: LoginInput): Promise<LoginResult> => {
    return withTenant(db, tenantId, async (tx) => {
      const user = await UsersQuery.findByUsername(tx, input.username);
      // Mensagem genérica pra não vazar se o username existe ou não.
      if (!user) throw new AppError('Credenciais inválidas', 401);

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) throw new AppError('Credenciais inválidas', 401);

      if (!user.active) throw new AppError('Usuário desativado', 403);

      const token = signToken(
        { userId: user.id, tenantId: user.tenantId, username: user.username },
        env.jwt.secret,
        env.jwt.expiresIn
      );

      const expiresAt = getTokenExpiration(token);
      if (!expiresAt) throw new AppError('Erro ao gerar token', 500);

      return { token, expiresAt, user: toPublic(user) };
    });
  },

  me: async (
    tenantId: string,
    userId: string
  ): Promise<{ user: PublicUser; roleCodes: RoleCode[]; chatEnabled: boolean }> => {
    return withTenant(db, tenantId, async (tx) => {
      const user = await UsersQuery.findById(tx, userId);
      if (!user) throw new AppError('Usuário não encontrado', 404);

      // Mesmo query que loadUserRoles middleware faz — dedup por role.
      const rows = await tx
        .select({ roleCode: groups.roleCode })
        .from(userGroups)
        .innerJoin(groups, eq(userGroups.groupId, groups.id))
        .where(eq(userGroups.userId, userId));
      const roleCodes = Array.from(new Set(rows.map((r) => r.roleCode))) as RoleCode[];

      // Chat WhatsApp: o usuário precisa de chat:use E o tenant de ao menos
      // um canal ativo — sem canal o frontend nem liga inbox/realtime do chat.
      // Configurar o primeiro canal é tela de configurações (chat:manage),
      // fora deste flag.
      let chatEnabled = false;
      if (hasPermission(roleCodes, 'chat:use')) {
        const [channel] = await tx
          .select({ id: whatsappChannels.id })
          .from(whatsappChannels)
          .where(eq(whatsappChannels.active, true))
          .limit(1);
        chatEnabled = !!channel;
      }

      return { user: toPublic(user), roleCodes, chatEnabled };
    });
  },
};

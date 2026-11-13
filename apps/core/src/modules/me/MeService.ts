import type { UserPreferences } from '@elora/db';
import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { UsersQuery } from '../users/UsersQuery.js';
import type { MeUpdatePreferencesInput } from './MeTypes.js';

export const MeService = {
  getPreferences: async (
    tenantId: string,
    userId: string
  ): Promise<UserPreferences> => {
    return withTenant(db, tenantId, async (tx) => {
      const user = await UsersQuery.findById(tx, userId);
      if (!user) throw new AppError('Usuário não encontrado', 404);
      return user.preferences;
    });
  },

  updatePreferences: async (
    tenantId: string,
    userId: string,
    patch: MeUpdatePreferencesInput
  ): Promise<UserPreferences> => {
    return withTenant(db, tenantId, async (tx) => {
      // Garante existência antes do UPDATE pra retornar 404 amigável em vez
      // de "0 rows affected" silencioso.
      const current = await UsersQuery.findById(tx, userId);
      if (!current) throw new AppError('Usuário não encontrado', 404);

      const updated = await UsersQuery.mergePreferences(tx, userId, patch);
      if (!updated) throw new AppError('Usuário não encontrado', 404);
      return updated.preferences;
    });
  },
};

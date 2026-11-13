import { and, eq, groups, userGroups, users, withTenant } from '@elora/db';
import { db } from '../database/db.js';
import { hasPermission, type RoleCode } from '../permissions/permissions.js';

// =====================================================================
// Quem recebe aviso de conversa do chat fora do socket (push). Mesma regra
// da sala `chat`: usuários com `chat:use`. Clínica não tem recorte de
// carteira — toda a equipe vê todas as conversas.
//
// Fora: usuários inativos e o agente IA (`is_system_agent`), que tem
// `chat:use` pra enviar resposta mas não tem aparelho.
// Roles resolvidos em código (hasPermission) pra seguir o mapa único de
// permissões, sem repetir a lista de role_codes no SQL.
// =====================================================================

export async function chatUserIds(tenantId: string): Promise<string[]> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ userId: users.id, roleCode: groups.roleCode })
      .from(users)
      .innerJoin(userGroups, eq(userGroups.userId, users.id))
      .innerJoin(groups, eq(groups.id, userGroups.groupId))
      .where(and(eq(users.active, true), eq(users.isSystemAgent, false)))
  );

  const rolesByUser = new Map<string, RoleCode[]>();
  for (const r of rows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.roleCode as RoleCode);
    rolesByUser.set(r.userId, list);
  }
  return [...rolesByUser]
    .filter(([, roles]) => hasPermission(roles, 'chat:use'))
    .map(([userId]) => userId);
}

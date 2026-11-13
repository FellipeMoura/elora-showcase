import { sql } from '@elora/db';
import { db } from '../../shared/database/db.js';

// Resolve channel → tenant SEM tenant context (webhook não conhece subdomínio).
// Usa a função SECURITY DEFINER `resolve_channel_tenant` criada na migration
// 0005 — ver migrations/0005_resolve_channel_tenant.sql.
//
// Retorna null se canal não existe, foi removido, ou está inativo.
// Handler responde 404/410 com base nesse retorno.
export const WebhooksService = {
  resolveChannelTenant: async (channelId: string): Promise<string | null> => {
    const result = await db.execute<{ resolve_channel_tenant: string | null }>(
      sql`SELECT resolve_channel_tenant(${channelId}::uuid) AS resolve_channel_tenant`
    );
    const tenantId = result.rows[0]?.resolve_channel_tenant ?? null;
    return tenantId;
  },
};

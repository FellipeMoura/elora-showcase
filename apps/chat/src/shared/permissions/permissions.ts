// Permissões do apps/chat. Manter ROLE_CODES em sincronia com o enum
// `role_code` do banco e PERMISSIONS espelhado em
// apps/core/src/shared/permissions/permissions.ts (o core usa pras salas do
// socket e pro `chatEnabled` do /auth/me) — mudar os dois juntos.
//
// Clínica não tem recorte de carteira: toda a equipe vê todas as conversas
// (sem `chat:view_all`, que no Frostie separa vendedor de gestão).

export const ROLE_CODES = [
  'admin',
  'manager',
  'professional',
  'reception',
  'viewer',
  'agent',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSIONS = {
  // Inbox, conversas, mensagens (envio, nota, edição, exclusão), templates
  // (leitura), contato da conversa (opt-in, foto). O agente IA envia a
  // resposta via POST /conversations/:id/messages.
  'chat:use': ['admin', 'manager', 'professional', 'reception', 'viewer', 'agent'],
  // Canais WhatsApp (criar, parear, desativar, limpar), escrita de
  // templates, listagem de contatos e payload bruto do provider.
  'chat:manage': ['admin', 'manager'],
} as const satisfies Record<string, readonly RoleCode[]>;

export type PermissionAction = keyof typeof PERMISSIONS;

export function hasPermission(
  userRoles: readonly RoleCode[],
  action: PermissionAction
): boolean {
  const allowed = PERMISSIONS[action] as readonly RoleCode[];
  return userRoles.some((role) => allowed.includes(role));
}

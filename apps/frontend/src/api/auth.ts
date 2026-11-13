import { coreApi } from './client';

// Espelha o shape de PublicUser do backend (apps/core/src/modules/users/UsersTypes.ts).
// Datas vêm como ISO strings na rede.
export interface PublicUser {
  id: string;
  tenantId: string;
  username: string;
  // Opcional agora — só preenchido quando o user quer receber recovery de
  // senha etc. Null quando não cadastrado.
  email: string | null;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// Espelha RoleCode do backend (shared/permissions/permissions.ts).
export type RoleCode =
  | 'admin'
  | 'manager'
  | 'professional'
  | 'reception'
  | 'viewer';

export interface MeResult {
  user: PublicUser;
  roleCodes: RoleCode[];
  // chat:use + ao menos um canal WhatsApp ativo no tenant. Sem isso a
  // inbox (tab CHAT) some e as queries de conversa não disparam.
  chatEnabled: boolean;
}

export async function login(username: string, password: string): Promise<PublicUser> {
  const res = await coreApi.post<{ user: PublicUser }>('/auth/login', { username, password });
  return res.data.user;
}

export async function logout(): Promise<void> {
  await coreApi.post('/auth/logout');
}

// Resolve usuário corrente + roleCodes a partir do cookie httpOnly. 401 quando
// não logado — fica a cargo do caller distinguir "deslogado" de "erro real".
export async function me(): Promise<MeResult> {
  const res = await coreApi.get<MeResult>('/auth/me');
  return res.data;
}

import { coreApi } from './client'

// Espelha UserPreferences do backend (apps/core/.../UsersTypes.ts).
// Todas as chaves são opcionais — usuário pode nunca ter setado nada.
export interface UserPreferences {
  chatNotificationLevel?: 'quiet' | 'medium' | 'aggressive'
  calendarColorMode?: 'status' | 'procedure'
}

export async function fetchMyPreferences(): Promise<UserPreferences> {
  const res = await coreApi.get<UserPreferences>('/me/preferences')
  return res.data
}

export async function updateMyPreferences(
  patch: UserPreferences,
): Promise<UserPreferences> {
  const res = await coreApi.patch<UserPreferences>('/me/preferences', patch)
  return res.data
}

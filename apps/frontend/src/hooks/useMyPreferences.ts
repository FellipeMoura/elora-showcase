import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  fetchMyPreferences,
  updateMyPreferences,
  type UserPreferences,
} from '@/api/me'
import { ME_QUERY_KEY, useMe } from '@/hooks/useMe'

export const MY_PREFERENCES_QUERY_KEY = ['me', 'preferences'] as const

// Defaults aplicados no app (não no DB). Mantém o backend simples e permite
// alterar default sem migration. Sempre que campo for undefined no payload,
// assume o default abaixo.
export const DEFAULT_PREFERENCES: Required<UserPreferences> = {
  chatNotificationLevel: 'medium',
  // Status em destaque é mais conservador — recepção lê status primeiro,
  // procedimento como contexto secundário (ícone no canto).
  calendarColorMode: 'status',
}

// `enabled: !!me?.user` impede o fetch antes do login. Esse hook é chamado
// indiretamente pelo useChatRealtime (via useEffectivePreferences), que vive
// no ChatRealtimeBoot fora do RequireAuth — sem o gate, dispara 401 no boot.
export function useMyPreferences() {
  const { data: me } = useMe()
  return useQuery<UserPreferences, Error>({
    queryKey: MY_PREFERENCES_QUERY_KEY,
    queryFn: fetchMyPreferences,
    enabled: !!me?.user,
    staleTime: 5 * 60 * 1000,
  })
}

// Retorna prefs com defaults aplicados — pra UI que precisa de valor
// sempre definido. `data` da query continua bruto pra quem prefere.
export function useEffectivePreferences(): Required<UserPreferences> {
  const { data } = useMyPreferences()
  return {
    chatNotificationLevel:
      data?.chatNotificationLevel ?? DEFAULT_PREFERENCES.chatNotificationLevel,
    calendarColorMode:
      data?.calendarColorMode ?? DEFAULT_PREFERENCES.calendarColorMode,
  }
}

export function useUpdateMyPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: UserPreferences) => updateMyPreferences(patch),
    onSuccess: (updated) => {
      // Hidrata cache local com o que o backend retornou (objeto completo).
      queryClient.setQueryData(MY_PREFERENCES_QUERY_KEY, updated)
      // /auth/me também carrega `preferences` no shape do user — invalida
      // pra o useMe() refletir mudanças se a UI estiver lendo de lá.
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

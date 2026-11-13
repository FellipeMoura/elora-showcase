import { useLeadsCounts } from './useLeads'

// Total de leads com substage='new' — usado pelo badge do menu item `leads`
// na sidebar. Reaproveita `useLeadsCounts` (GET /leads/counts) sem filtros;
// `placeholderData` mantém o badge enquanto refetch acontece, evitando
// flicker. Invalidação acontece via `useChatRealtime` quando chega
// `lead.created` ou `wa.message.*` (que pode mexer no substage).
export function useLeadsNewCount(): number | undefined {
  const { data } = useLeadsCounts({})
  return data?.new
}

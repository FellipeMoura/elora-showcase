import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createTenant,
  deleteTenantLogo,
  fetchTenantById,
  fetchTenantLogoUrl,
  fetchTenants,
  updateTenant,
  uploadTenantLogo,
  type CreateTenantInput,
  type LogoUrlResponse,
  type Tenant,
  type TenantSummary,
  type UpdateTenantInput,
} from '@/api/tenants'

export const TENANTS_QUERY_KEY = ['tenants'] as const

export function tenantsListKey() {
  return [...TENANTS_QUERY_KEY, 'list'] as const
}

export function tenantByIdKey(id: string) {
  return [...TENANTS_QUERY_KEY, 'detail', id] as const
}

// Lista tenants — só super-admin consegue (gate no backend). Cache longo:
// catálogo de tenants muda raramente; mutations explícitas invalidam.
// Mantido em `TENANTS_QUERY_KEY` direto (sem sufixo 'list') pra preservar
// consumidores anteriores (MenuFormSheet) — mutations invalidam pela raiz.
export function useTenants() {
  return useQuery<TenantSummary[], Error>({
    queryKey: TENANTS_QUERY_KEY,
    queryFn: fetchTenants,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTenant(id: string | undefined) {
  return useQuery<Tenant, Error>({
    queryKey: tenantByIdKey(id ?? ''),
    queryFn: () => fetchTenantById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTenantInput) => createTenant(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY })
    },
  })
}

export function useUpdateTenant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTenantInput }) =>
      updateTenant(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: tenantByIdKey(vars.id) })
    },
  })
}

export function tenantLogoUrlKey(id: string) {
  return [...TENANTS_QUERY_KEY, 'logo-url', id] as const
}

// Presigned URL do logo — cache curto (TTL do backend é 1h; deixamos 30min
// no client pra reduzir refresh visual sem risco de servir URL expirada).
export function useTenantLogoUrl(id: string | undefined) {
  return useQuery<LogoUrlResponse, Error>({
    queryKey: tenantLogoUrlKey(id ?? ''),
    queryFn: () => fetchTenantLogoUrl(id as string),
    enabled: Boolean(id),
    staleTime: 30 * 60 * 1000,
  })
}

export function useUploadTenantLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      uploadTenantLogo(id, file),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: tenantByIdKey(vars.id) })
      queryClient.invalidateQueries({ queryKey: tenantLogoUrlKey(vars.id) })
    },
  })
}

export function useDeleteTenantLogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTenantLogo(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: tenantByIdKey(id) })
      queryClient.invalidateQueries({ queryKey: tenantLogoUrlKey(id) })
    },
  })
}

import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ChatRealtimeBoot } from '@/components/chat/ChatRealtimeBoot'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { AppRoutes } from '@/app/routes/routes'
import { useTheme } from '@/components/theme/ThemeProvider'

// QueryClient único pro app inteiro. Defaults conservadores:
// - retry: handled per-query (useMe sobrescreve pra não retry em 401)
// - refetchOnWindowFocus: true (default) — bom pra detectar logout em outra aba
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
})

function App(): React.ReactElement {
  const { resolved } = useTheme()

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <BrowserRouter>
            <ChatRealtimeBoot />
            <AppRoutes />
          </BrowserRouter>
          {/* Toaster único — Sonner renderiza o mesmo toast em todos os
              <Toaster> montados, então múltiplas instâncias = duplicação.
              Default position=top-right cobre toasts de mutation (save/delete
              em ~40 telas). Notificações ricas (RichNotification via
              toast.custom) sobrescrevem com `position: 'bottom-right'` por
              chamada. */}
          <Toaster theme={resolved} duration={1500} richColors closeButton position="top-right" />
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App

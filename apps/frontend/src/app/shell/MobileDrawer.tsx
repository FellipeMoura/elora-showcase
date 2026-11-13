import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { Sidebar } from './Sidebar'
import { useUiStore } from '@/stores/uiStore'

// Sidebar versão mobile — vive dentro de um Sheet (overlay slide-in).
// Compartilha o componente Sidebar com a versão desktop, mas suprime os
// tabs MENU/CHAT (que vivem na MobileTopBar acima do overlay). Drawer
// fecha automaticamente após navegação via `onNavigate`.
//
// `modal={false}` é crítico: Radix Dialog modal aplica pointer-events:none
// no body fora do content, o que torna a MobileTopBar inerte mesmo com
// z-shell. Com modal=false, o body fica interativo → tabs MENU/CHAT podem
// alternar o conteúdo do drawer sem fechá-lo (handleTap só faz
// setSidebarTab quando já está open). Trade-off aceito: Esc não fecha mais
// automático — mas no mobile não tem teclado, e click fora não fecha
// porque sem overlay click handler. Pra fechar: toque no item de navegação
// (onNavigate) ou na seta-voltar quando o chat estiver aberto.
//
// SheetTitle invisível atende o requisito de acessibilidade do Radix
// Dialog — sem ele, console warning de a11y na hidratação.
export function MobileDrawer(): React.ReactElement {
  const open = useUiStore((s) => s.mobileSidebarOpen)
  const setOpen = useUiStore((s) => s.setMobileSidebarOpen)

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        side="left"
        // Ancora abaixo da MobileTopBar (h-12) e ocupa toda a largura/
        // altura restante. `inset-y-auto` + `top-12 bottom-0` cancela o
        // `inset-y-0 h-full` do variant default — sem isso, o drawer
        // cobriria a topbar e os primeiros 48px do conteúdo ficariam
        // atrás dela. `max-w-full` sobrescreve o cap `sm:max-w-sm`.
        className="inset-y-auto top-12 bottom-0 h-auto w-full max-w-full border-r-0 p-0 sm:max-w-full"
      >
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <Sidebar showTabs={false} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}

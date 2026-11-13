import { create } from 'zustand'

// Estado puramente de UI — não persiste, não conversa com servidor. Coisas
// como "drawer do mobile está aberto?" e flags efêmeras de navegação.
//
// Server state (user, menus, etc.) vive no TanStack Query. Theme tem seu
// próprio context com persistência. Aqui mora o resto.

export type SidebarTab = 'menu' | 'chat'

interface UiState {
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  toggleMobileSidebar: () => void

  // Tab ativo da sidebar — alterna entre o menu do sistema e a lista de
  // conversas. Compartilhado entre desktop (sidebar fixa) e mobile
  // (drawer). Sem persistência: sessão começa sempre em 'menu'.
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void
}

export const useUiStore = create<UiState>((set) => ({
  mobileSidebarOpen: false,
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  toggleMobileSidebar: () =>
    set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),

  sidebarTab: 'menu',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))

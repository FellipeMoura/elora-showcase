import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// =====================================================================
// Store do chat — slot único da flutuante + totalizador de não-lidas.
//
// Princípio: a flutuante é UMA. Trocar de conversa não cria janela nova —
// substitui o conteúdo da janela atual. Geometria (x/y/w/h) e expanded são
// **sticky por usuário** — uma vez ajustados, valem pra todas as conversas.
//
// Não há mais conceito de "minimizado". Fechar a flutuante encerra a
// conversa no slot; reabrir é via item da CHAT sidebar.
//
// `floating.geometry` e `floating.expanded` são persistidos em
// localStorage. O resto do estado é vivo da sessão (open/conversationId/
// totalUnread) e é recriado quando o usuário faz login de novo.
// =====================================================================

export interface FloatingGeometry {
  x: number
  y: number
  width: number
  height: number
}

interface FloatingState {
  open: boolean
  conversationId: string | null
  geometry: FloatingGeometry
  // Quando true, a flutuante (desktop) renderiza em modo tela-cheia
  // (estilo MobileChatSheet) em vez do Rnd. Persistido — escolha do user
  // vale entre sessões. No mobile o estado é ignorado: MobileChatSheet
  // já é sempre fullscreen, sem botão de toggle.
  expanded: boolean
}

// Rascunho a pré-preencher no composer ao abrir uma conversa. Disparado por
// ações fora do chat (ex: "enviar link de contrato"). O MessageComposer
// consome uma vez (seta o texto + limpa via clearDraft) quando o
// conversationId bate. Vivo da sessão — não persistido.
interface PendingDraft {
  conversationId: string
  text: string
}

// Alvo de reply ativo no composer. Sticky por conversa — staff clica
// "Responder" numa bolha, escolhe o que digitar, manda. Persistido só na
// sessão (não em localStorage). Limpo em troca de conversa e após envio.
interface ReplyTarget {
  conversationId: string
  messageId: string
}

interface ChatStoreState {
  floating: FloatingState
  // Total de inbound não-lidas em todas as conversas. Alimentado pelo
  // ChatRealtimeBoot (fetch inicial + refetch após invalidação) e
  // incrementado pelo useChatRealtime quando chega inbound numa conversa
  // que não é a flutuante ativa.
  totalUnread: number

  // Rascunho pendente pro composer (consumido uma vez). Ver PendingDraft.
  pendingDraft: PendingDraft | null

  // Mensagem-alvo do reply ativo (null = composer livre). Ver ReplyTarget.
  replyTarget: ReplyTarget | null

  // ---- Actions ----

  // Promove conversa pro slot ativo da flutuante. Não carrega payload —
  // metadados (nome do cliente, telefone, etc.) vêm do useConversation
  // dentro da própria FloatingChatWindow. `draftText` opcional pré-preenche
  // o composer (link de contrato, etc).
  openConversation: (conversationId: string, draftText?: string) => void

  // Limpa o rascunho pendente — chamado pelo MessageComposer após consumir.
  clearDraft: () => void

  // Define / limpa o reply target. `setReplyTarget(null)` cancela.
  setReplyTarget: (target: ReplyTarget | null) => void

  // Fecha a flutuante. Sem estado intermediário "minimizado" — o slot
  // simplesmente esvazia.
  closeFloating: () => void

  // Patch parcial em geometry. Disparado em drag/resize.
  updateGeometry: (patch: Partial<FloatingGeometry>) => void

  // Alterna entre modo flutuante (Rnd) e modo expandido (fullscreen). Só
  // chamado pelo botão no header da flutuante desktop.
  toggleExpanded: () => void

  setTotalUnread: (n: number) => void

  // Reset completo — chamado no logout pra limpar a sessão.
  reset: () => void
}

// Geometria default — canto inferior direito do viewport, deixando ~20px
// de margem. Recomputado uma vez no module load.
function computeDefaultGeometry(): FloatingGeometry {
  const width = 360
  const height = 480
  if (typeof window === 'undefined') {
    return { x: 40, y: 40, width, height }
  }
  return {
    x: Math.max(20, window.innerWidth - width - 20),
    y: Math.max(20, window.innerHeight - height - 80),
    width,
    height,
  }
}

const initialFloating = (): FloatingState => ({
  open: false,
  conversationId: null,
  geometry: computeDefaultGeometry(),
  expanded: false,
})

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      floating: initialFloating(),
      totalUnread: 0,
      pendingDraft: null,
      replyTarget: null,

      openConversation: (conversationId, draftText) => {
        set((state) => ({
          floating: { ...state.floating, open: true, conversationId },
          pendingDraft: draftText
            ? { conversationId, text: draftText }
            : state.pendingDraft,
          // Trocar de conversa cancela o reply pendente — alvo é por-conversa.
          replyTarget:
            state.replyTarget?.conversationId === conversationId
              ? state.replyTarget
              : null,
        }))
      },

      clearDraft: () => set({ pendingDraft: null }),

      setReplyTarget: (target) => set({ replyTarget: target }),

      closeFloating: () => {
        set((state) => ({
          floating: { ...state.floating, open: false, conversationId: null },
          // Fechar a flutuante também limpa o reply — operador vai re-abrir
          // do zero quando voltar pra conversa.
          replyTarget: null,
        }))
      },

      updateGeometry: (patch) => {
        set((state) => ({
          floating: {
            ...state.floating,
            geometry: { ...state.floating.geometry, ...patch },
          },
        }))
      },

      toggleExpanded: () => {
        set((state) => ({
          floating: { ...state.floating, expanded: !state.floating.expanded },
        }))
      },

      setTotalUnread: (n) => set({ totalUnread: Math.max(0, n) }),

      reset: () =>
        set({
          floating: initialFloating(),
          totalUnread: 0,
          pendingDraft: null,
          replyTarget: null,
        }),
    }),
    {
      name: 'elora:chat-store',
      storage: createJSONStorage(() => localStorage),
      // Só persiste a geometria — open/totalUnread são vivos da sessão.
      // Sem isso, dados velhos voltariam após logout/reload.
      partialize: (state) => ({
        floating: {
          geometry: state.floating.geometry,
          expanded: state.floating.expanded,
        },
      }),
      // Hydration merge: preserva tudo do estado inicial e só sobrepõe a
      // geometria + expanded. Sem isso, persistedState (parcial) sobrescreve
      // o resto do estado com undefined.
      merge: (persisted, current) => {
        const p = persisted as
          | {
              floating?: { geometry?: FloatingGeometry; expanded?: boolean }
            }
          | undefined
        return {
          ...current,
          floating: {
            ...current.floating,
            geometry: p?.floating?.geometry ?? current.floating.geometry,
            expanded: p?.floating?.expanded ?? current.floating.expanded,
          },
        }
      },
    },
  ),
)

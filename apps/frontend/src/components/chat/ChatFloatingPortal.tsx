import { useEffect } from 'react'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useChatStore } from '@/stores/chatStore'
import { FloatingChatWindow } from './FloatingChatWindow'
import { MobileChatSheet } from './MobileChatSheet'

// Wrapper que decide se a flutuante existe na árvore React e escolhe a
// implementação adequada ao viewport.
//
// Montado no AppShell — abrir uma conversa pela tab CHAT da sidebar
// faz `floating.open=true` e esta árvore renderiza a janela apropriada
// sobreposta ao conteúdo da página.
//
// Desktop (>=768px): FloatingChatWindow com react-rnd (drag+resize).
// Mobile (<768px): MobileChatSheet (bottom-sheet fixo, sem drag).
//
// O `key` força remount ao trocar de conversa — garante limpeza do estado
// interno (lista de mensagens, scroll) sem race conditions.
export function ChatFloatingPortal(): React.ReactElement | null {
  const open = useChatStore((s) => s.floating.open)
  const conversationId = useChatStore((s) => s.floating.conversationId)
  const closeFloating = useChatStore((s) => s.closeFloating)
  const isDesktop = useBreakpoint('md')

  // Atalho global: Esc fecha a flutuante (sem minimizar). Listener só vive
  // enquanto open=true. Respeita defaultPrevented — Radix overlays (popover,
  // dialog) e MessageEditInline já consomem o evento quando estão ativos,
  // então o fechar só dispara quando ninguém mais quis o Esc.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      closeFloating()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, closeFloating])

  if (!open || !conversationId) return null

  if (isDesktop) {
    return (
      <FloatingChatWindow key={conversationId} conversationId={conversationId} />
    )
  }

  return <MobileChatSheet key={conversationId} conversationId={conversationId} />
}

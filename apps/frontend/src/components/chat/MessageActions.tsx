import * as DialogPrimitive from '@radix-ui/react-dialog'
import { MoreHorizontal, Pencil, Reply, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useRevokeMessage } from '@/hooks/useConversationMessages'
import type { Message } from '@/api/messages'
import { useChatStore } from '@/stores/chatStore'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

interface MessageActionsProps {
  message: Message
  conversationId: string
  // Disparado quando staff clica em "Editar" — o pai entra em modo edit
  // inline trocando a bolha por textarea + Salvar/Cancelar. Pode ser
  // undefined quando o caller exibe o menu pra inbound (sem edit).
  onStartEdit?: () => void
}

// Popover de ações no canto da bolha. Caller decide se renderiza — entradas
// dinâmicas conforme propriedade da msg:
//   - "Responder" (universal): inbound ou outbound, desde que tenha
//     `whatsappMessageId` (sem isso, adapter não monta o quoted).
//   - "Editar" (outbound + kind=text): caption/mídia fica pra V2.
//   - "Apagar pra cliente" (outbound): mesmo pra mídia/template — backend
//     rejeita se canal não permite. Encapsula o confirm dialog do revoke.
export function MessageActions({
  message,
  conversationId,
  onStartEdit,
}: MessageActionsProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const revokeMutation = useRevokeMessage(conversationId)
  const setReplyTarget = useChatStore((s) => s.setReplyTarget)

  const isOutbound = message.direction === 'outbound'
  const canReply = Boolean(message.whatsappMessageId)
  const canEdit = isOutbound && message.kind === 'text' && Boolean(onStartEdit)
  const canDelete = isOutbound

  const handleReply = (): void => {
    setMenuOpen(false)
    setReplyTarget({ conversationId, messageId: message.id })
  }

  const handleEdit = (): void => {
    setMenuOpen(false)
    onStartEdit?.()
  }

  const handleRequestDelete = (): void => {
    setMenuOpen(false)
    setConfirmOpen(true)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    try {
      await revokeMutation.mutateAsync(message.id)
      setConfirmOpen(false)
      toast.success('Mensagem apagada')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = apiErrorText(err)
      if (status === 400) {
        toast.error(msg ?? 'Não foi possível apagar essa mensagem')
      } else {
        toast.error('Erro ao apagar mensagem. Tente novamente.')
      }
    }
  }

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Ações da mensagem"
            className={cn(
              'absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded',
              // Pouca presença visual: visível só on-hover do .group da
              // bolha. Em mobile o user usa o foco/tap pra revelar.
              'text-current/70 opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100',
              'hover:bg-black/10 dark:hover:bg-white/10',
              // Quando o popover está aberto, mantém visível pra não
              // sumir embaixo do cursor.
              menuOpen && 'opacity-100',
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={4}
          className="w-44 p-1"
        >
          {canReply && (
            <button
              type="button"
              onClick={handleReply}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Reply className="size-3.5" />
              Responder
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={handleEdit}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Pencil className="size-3.5" />
              Editar
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleRequestDelete}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-error hover:bg-error/10"
            >
              <Trash2 className="size-3.5" />
              Apagar para o cliente
            </button>
          )}
        </PopoverContent>
      </Popover>

      <DialogPrimitive.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
          <DialogPrimitive.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2',
              'rounded-lg border border-border bg-card p-5 shadow-lg',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            )}
          >
            <DialogPrimitive.Title className="text-base font-semibold">
              Apagar mensagem?
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
              O cliente verá uma notificação dizendo que a mensagem foi
              apagada. A clínica continua vendo o conteúdo no histórico.
            </DialogPrimitive.Description>
            <div className="mt-5 flex justify-end gap-2">
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancelar
                </Button>
              </DialogPrimitive.Close>
              <Button
                type="button"
                variant="error"
                size="sm"
                disabled={revokeMutation.isPending}
                onClick={handleConfirmDelete}
              >
                {revokeMutation.isPending ? 'Apagando…' : 'Apagar'}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

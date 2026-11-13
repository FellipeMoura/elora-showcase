import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useEditMessage } from '@/hooks/useConversationMessages'
import type { Message } from '@/api/messages'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

interface MessageEditInlineProps {
  message: Message
  conversationId: string
  // Fechar o modo edit (sucesso ou cancelar). Caller volta a renderizar
  // a bolha normal.
  onClose: () => void
}

// Substitui a bolha por um composer mini quando staff inicia edição.
// Mantém alinhamento (right pra outbound) — visualmente é a "mesma"
// bolha em estado mutável. Esc/click-em-cancelar volta sem mudanças;
// Enter envia (Shift+Enter quebra linha — coerente com o composer).
//
// V1 só edita texto (kind='text'); caller já filtra. Backend valida
// novamente; se rejeitar (fora da janela 15min), surface o erro do
// provider.
export function MessageEditInline({
  message,
  conversationId,
  onClose,
}: MessageEditInlineProps): React.ReactElement {
  const [text, setText] = useState(message.body ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editMutation = useEditMessage(conversationId)

  useEffect(() => {
    // Foca + seleciona todo o texto pra UX de "edit imediato"
    // (user digita pra substituir, ou usa teclas pra refinar).
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.select()
    }
  }, [])

  const trimmed = text.trim()
  const hasChange = trimmed !== (message.body ?? '').trim()
  const canSave = trimmed.length > 0 && hasChange && !editMutation.isPending

  const handleSave = async (): Promise<void> => {
    if (!canSave) return
    try {
      await editMutation.mutateAsync({
        messageId: message.id,
        body: trimmed,
      })
      onClose()
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = apiErrorText(err)
      if (status === 400) {
        toast.error(msg ?? 'Edição rejeitada (fora da janela de 15min?)')
      } else {
        toast.error('Erro ao salvar edição. Tente novamente.')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      void handleSave()
    }
  }

  const isOutbound = message.direction === 'outbound'

  return (
    <div
      className={cn(
        'flex w-full',
        isOutbound ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[78%] rounded-lg border-2 px-3 py-2 shadow-sm',
          'border-info bg-card text-foreground',
        )}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={editMutation.isPending}
          className={cn(
            'max-h-40 w-full min-w-[200px] resize-none rounded-sm bg-background px-2 py-1 text-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={editMutation.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="info"
            disabled={!canSave}
            onClick={handleSave}
          >
            {editMutation.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

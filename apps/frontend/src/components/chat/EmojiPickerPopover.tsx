import { Smile } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTheme } from '@/components/theme/ThemeProvider'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// emoji-picker-react é ~85KB gzip + carrega imagens de emoji em runtime.
// Lazy-load: bundle inicial não paga o custo até alguém clicar no smile.
// Fallback é vazio (placeholder de altura via div ocupa o espaço enquanto
// chunk carrega — fica imperceptível em rede normal).
const EmojiPicker = lazy(() => import('emoji-picker-react'))

interface EmojiPickerPopoverProps {
  onSelect: (emoji: string) => void
  disabled?: boolean
}

export function EmojiPickerPopover({
  onSelect,
  disabled,
}: EmojiPickerPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const { resolved } = useTheme()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Inserir emoji"
        >
          <Smile className="size-4 text-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-auto border-0 bg-transparent p-0 shadow-none"
        // Picker tem seu próprio container — não precisa de padding/border
        // do PopoverContent default (poluiria o visual).
      >
        <Suspense
          fallback={
            <div className="flex h-[450px] w-[400px] items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground">
              Carregando…
            </div>
          }
        >
          {/* CSS vars custom da lib emoji-picker-react — reduzem o
              tamanho de cada emoji (default 28px) e dos labels de
              categoria pra caber mais conteúdo por painel. Combinado
              com width/height maiores, mostra ~10 colunas e ~7 linhas
              de emojis simultaneamente (era ~7×4). */}
          <EmojiPicker
            theme={resolved === 'dark' ? ('dark' as never) : ('light' as never)}
            width={400}
            height={450}
            style={
              {
                '--epr-emoji-size': '22px',
                '--epr-category-label-height': '24px',
                '--epr-category-label-text-color': 'var(--muted-foreground)',
              } as React.CSSProperties
            }
            // Categorias + search ativos. Skin tones permitidos (default).
            onEmojiClick={(data) => {
              onSelect(data.emoji)
              // Fecha depois do click pra UX mais natural — alternativa
              // seria deixar aberto pra múltiplos. Padrão WhatsApp Web é
              // permanecer aberto; mas pro nosso caso (composer pequeno),
              // fechar evita confusão de "como volto pro textarea".
              setOpen(false)
            }}
            // Disabled lazyLoadEmojis: como o popover é lazy, quando abre a
            // primeira vez já vem com tudo carregado. Forçar lazy interno
            // gera scroll com placeholders enquanto baixa imagens.
            lazyLoadEmojis={false}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}

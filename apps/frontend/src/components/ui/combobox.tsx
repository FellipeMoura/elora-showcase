import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react'
import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// =====================================================================
// Combobox — campo de busca com lista filtrada e seleção única.
//
// Implementação: UM input (no anchor) + PopoverContent só com a lista.
// Anteriormente havia um segundo input dentro do popover, que quebrava
// o foco quando o Combobox vivia dentro de um <Sheet>/<Dialog>: o
// PopoverContent é renderizado em portal fora do Sheet, e o FocusScope
// do Sheet (modal=true) puxava o foco de volta a cada re-render — input
// perdia foco a cada keystroke. Mantendo o input no anchor (dentro do
// DOM tree do Sheet), o focus trap não disputa.
//
// Sem cmdk (pra não adicionar dep nova). Keyboard handling próprio:
//   - ArrowDown/Up navegam highlight
//   - Enter seleciona highlight
//   - Esc fecha popover
//
// Caller é responsável pela query (debounced externo). Combobox só renderiza.
// =====================================================================

export interface ComboboxOption {
  value: string
  label: string
  /** Texto secundário (e.g., telefone) — exibido abaixo do label. */
  hint?: string
}

interface ComboboxProps {
  value: string | null
  onChange: (value: string | null) => void
  options: ComboboxOption[]
  /** Valor atual do input de busca (controlled). */
  search: string
  onSearchChange: (search: string) => void
  placeholder?: string
  emptyLabel?: string
  isLoading?: boolean
  disabled?: boolean
  /** Label livre pra mostrar quando há `value` mas opção não está em `options`. */
  selectedLabel?: string | null
  className?: string
  id?: string
  'aria-label'?: string
  /** Repassados ao <input> — usados pelo ComboboxField (erro/helper). */
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  /** Render custom dos items (e.g., adicionar avatar). Default usa label+hint. */
  renderOption?: (option: ComboboxOption, isActive: boolean) => React.ReactNode
}

export function Combobox({
  value,
  onChange,
  options,
  search,
  onSearchChange,
  placeholder = 'Buscar…',
  emptyLabel = 'Nenhum resultado',
  isLoading = false,
  disabled = false,
  selectedLabel,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  renderOption,
}: ComboboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [activeIdx, setActiveIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  // Trava pra não reabrir popover quando o blur dispara fechamento e o
  // foco ainda está no input (ex: user pressionou Esc).
  const suppressOpenOnFocus = React.useRef(false)

  // Destaque volta pro topo quando a lista muda. Ajuste durante o render
  // (padrão do React para estado derivado) em vez de efeito — evita um
  // render extra a cada tecla digitada na busca.
  const listToken = `${options.length}|${search}`
  const [prevListToken, setPrevListToken] = React.useState(listToken)
  if (listToken !== prevListToken) {
    setPrevListToken(listToken)
    setActiveIdx(0)
  }

  // Label mostrado quando o input não está em modo de busca. Prefere
  // selectedLabel do caller (vem de hook externo, ex: useClient(id)),
  // fallback pra label da option presente.
  const displayLabel = React.useMemo(() => {
    if (!value) return null
    if (selectedLabel) return selectedLabel
    const opt = options.find((o) => o.value === value)
    return opt?.label ?? null
  }, [value, selectedLabel, options])

  // Valor visual do input. Quando o popover está fechado E há valor
  // selecionado, mostra o label. Caso contrário, mostra o que o user
  // digitou. Isso evita "esquecer" o que está selecionado e ao mesmo
  // tempo permite digitar pra trocar.
  const inputValue = open ? search : displayLabel ?? search

  const handleSelect = (val: string) => {
    onChange(val)
    setOpen(false)
    onSearchChange('')
    // Mantém foco no input pra continuar fluxo de form sem precisar de Tab.
    inputRef.current?.focus()
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
    onSearchChange('')
    inputRef.current?.focus()
    setOpen(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, options.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const opt = options[activeIdx]
      if (opt) handleSelect(opt.value)
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        suppressOpenOnFocus.current = true
        setOpen(false)
      }
    }
  }

  const handleFocus = () => {
    if (suppressOpenOnFocus.current) {
      suppressOpenOnFocus.current = false
      return
    }
    setOpen(true)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value)
    if (!open) setOpen(true)
  }

  // Scroll do item ativo pra dentro da viewport.
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    if (item) {
      const top = item.offsetTop
      const bottom = top + item.offsetHeight
      if (top < list.scrollTop) list.scrollTop = top
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight
      }
    }
  }, [activeIdx, open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm',
            'focus-within:ring-2 focus-within:ring-ring',
            disabled && 'cursor-not-allowed opacity-50',
            className,
          )}
          onClick={() => {
            if (disabled) return
            inputRef.current?.focus()
          }}
        >
          <input
            ref={inputRef}
            id={id}
            aria-label={ariaLabel ?? placeholder}
            aria-invalid={ariaInvalid || undefined}
            aria-describedby={ariaDescribedBy}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />
          <div className="flex shrink-0 items-center gap-1">
            {value && !disabled && (
              <button
                type="button"
                aria-label="Limpar"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleClear}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </PopoverAnchor>
      {/* Content INLINE (sem Portal). Motivo: quando o Combobox vive dentro
          de um <Sheet>/<Dialog>, o `react-remove-scroll` do Radix Dialog
          bloqueia eventos de wheel fora da sua "shard" (DialogContent).
          O Portal padrão do Popover renderiza no body — fora dessa shard —
          então scroll por rolagem de mouse não funciona (só por drag da
          barra). Inline, o conteúdo é descendente direto do DialogContent
          e os eventos de wheel passam livres. */}
      <PopoverPrimitive.Content
        align="start"
        sideOffset={4}
        className={cn(
          'z-popover w-[var(--radix-popover-trigger-width)] rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Sem PopoverTrigger, o Radix não reconhece o anchor como "dentro"
        // do popover: o `focusin` do input (que abre a lista) chegava ao
        // DismissableLayer como foco-fora e fechava a lista no mesmo
        // evento — abria e fechava em sequência ao clicar. Pointerdown no
        // anchor (input, chevron, botão limpar) também fechava. Ignora
        // qualquer interação que parta de dentro do anchor.
        onInteractOutside={(e) => {
          const target = e.target as Node | null
          if (target && anchorRef.current?.contains(target)) e.preventDefault()
        }}
      >
        <div
          ref={listRef}
          role="listbox"
          className="max-h-60 overflow-y-auto overscroll-contain p-1"
        >
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando…
            </div>
          )}
          {!isLoading && options.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          )}
          {!isLoading &&
            options.map((opt, idx) => {
              const isSelected = opt.value === value
              const isActive = idx === activeIdx
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-idx={idx}
                  // mousedown roda antes do blur do input — preventDefault
                  // mantém o foco no input enquanto registramos a seleção
                  // no click.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none',
                    isActive && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isSelected ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {renderOption ? (
                    renderOption(opt, isActive)
                  ) : (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{opt.label}</span>
                      {opt.hint && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {opt.hint}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
        </div>
      </PopoverPrimitive.Content>
    </Popover>
  )
}

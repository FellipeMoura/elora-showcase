import * as React from 'react'
import { X } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  SheetClose,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// =====================================================================
// SheetToolbar — barra de ferramentas padrão pra forms em sidebar
// (Sheets). Espelha o papel do PageToolbar, mas pra superfícies
// inline/temporárias.
//
// Filosofia minimalista: o próprio sheet já é o "cartão" que sinaliza
// contexto — não precisamos repetir título redundante nem texto didático.
// A toolbar carrega só o essencial pra operar:
//   - Close (X) — sempre presente, à direita
//   - Actions — botões primários/secundários (Salvar, Cancelar, …)
//   - Leading slot opcional — back-arrow ou ícone contextual
//
// Título e descrição ficam sr-only (Radix Dialog exige `DialogTitle`
// pra a11y). Texto narrativo que antes morava em `SheetDescription`
// migra pra `helperText` dos próprios fields ou pra um tooltip inline —
// nunca pra uma legenda no topo.
//
// **Sticky no topo via SheetContainer.** Esta toolbar NÃO usa CSS
// `position: sticky` nem offsets negativos. Ela é um flex item com
// `shrink-0` e depende da cascata flex do `<SheetContainer>` (`h-full
// → flex-col`) + `<SheetBody>` (`flex-1 overflow-y-auto`) pra ficar
// fixa enquanto o conteúdo rola embaixo. **Sempre** usar dentro de
// SheetContainer — fora dele, o layout quebra.
//
// API:
//   <Sheet …>
//     <SheetContent hideCloseButton …>
//       <SheetContainer>
//         <SheetToolbar srTitle="Editar sala">
//           <SheetToolbar.Action label="Cancelar" variant="ghost" onClick={…} />
//           <SheetToolbar.Action label="Salvar" type="submit" form="unit-form" />
//         </SheetToolbar>
//         <SheetBody>
//           <form id="unit-form" onSubmit={…}>…</form>
//         </SheetBody>
//       </SheetContainer>
//     </SheetContent>
//   </Sheet>
//
// Observação: SheetContent precisa de `hideCloseButton` — sem ele, o
// X nativo do Radix conviveria com o X da toolbar.
// =====================================================================

// ─── Subcomponent props ──────────────────────────────────────────────

interface ActionProps {
  label?: string
  icon?: React.ReactNode
  onClick?: () => void
  /** `submit` exige o `form` prop apontando pro id do <form> dentro do sheet. */
  type?: 'button' | 'submit'
  variant?: ButtonProps['variant']
  disabled?: boolean
  /** Liga o submit a um form fora da árvore visual (HTML form attribute). */
  form?: string
  'aria-label'?: string
}

// Marker component — não renderiza direto. O root inspeciona `child.type`.
function SheetToolbarAction(_props: ActionProps): React.ReactElement | null {
  return null
}
SheetToolbarAction.displayName = 'SheetToolbar.Action'

// ─── Root ────────────────────────────────────────────────────────────

interface RootProps {
  /** Título acessível — visível só pro screen reader (Radix exige). */
  srTitle: string
  /** Descrição acessível opcional — só pro screen reader. */
  srDescription?: string
  /** Slot leading (esquerda). Útil pra back-arrow ou ícone de contexto. */
  leading?: React.ReactNode
  /** Esconde o botão X (caso o close seja controlado por outro lugar). */
  hideClose?: boolean
  children?: React.ReactNode
  className?: string
}

function SheetToolbar({
  srTitle,
  srDescription,
  leading,
  hideClose,
  children,
  className,
}: RootProps): React.ReactElement {
  const actions = React.useMemo(() => {
    const acc: Array<{ key: React.Key; props: ActionProps }> = []
    React.Children.forEach(children, (child, idx) => {
      if (!React.isValidElement(child)) return
      const key = child.key ?? idx
      if (child.type === SheetToolbarAction) {
        acc.push({ key, props: child.props as ActionProps })
      }
    })
    return acc
  }, [children])

  return (
    <>
      {/* A11y: Radix Dialog avisa em runtime se faltar Title/Description.
          Renderizamos sr-only — visível só pro leitor de tela. */}
      <SheetTitle className="sr-only">{srTitle}</SheetTitle>
      {srDescription && (
        <SheetDescription className="sr-only">{srDescription}</SheetDescription>
      )}

      <div
        className={cn(
          // Faixa edge-to-edge dentro do SheetContainer (que já cancelou
          // o padding do SheetContent via `-m-6`). `shrink-0` mantém a
          // altura fixa enquanto o SheetBody irmão absorve o overflow.
          'flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-1 mb-1.5',
          className,
        )}
      >
        {leading && <div className="flex shrink-0 items-center">{leading}</div>}

        {/* Spacer empurra actions + close pra direita. */}
        <div className="min-w-0 flex-1" />

        {actions.map(({ key, props }) => (
          <ActionButton key={key} {...props} />
        ))}

        {!hideClose && (
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fechar"
              className="shrink-0"
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
        )}
      </div>
    </>
  )
}

// ─── Internal renderer ───────────────────────────────────────────────

function ActionButton({
  label,
  icon,
  onClick,
  type = 'button',
  variant = 'default',
  disabled,
  form,
  'aria-label': ariaLabel,
}: ActionProps): React.ReactElement {
  return (
    <Button
      type={type}
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      form={form}
      aria-label={ariaLabel ?? label}
      size="sm"
      className="shrink-0"
    >
      {icon}
      {label && <span>{label}</span>}
    </Button>
  )
}

// ─── Public compound API ─────────────────────────────────────────────

// Statics em vez de Object.assign: o export precisa ser uma declaração de
// função PascalCase para o Fast Refresh (e a regra react-refresh/
// only-export-components) reconhecerem o arquivo como módulo de componente.
SheetToolbar.Action = SheetToolbarAction

export { SheetToolbar }

export type { ActionProps as SheetToolbarActionProps }

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Dialog genérico (não-modal action). Diferente do AlertDialog:
// - role="dialog" (não "alertdialog") — sem ARIA-role de urgência
// - conteúdo livre (sem Action/Cancel obrigatórios)
// - largura customizável via className
//
// Uso típico: janelas de listagem/inspeção (drill-down, detalhes,
// visualização). Pra confirmações destrutivas use AlertDialog.
//
// Layout (espelha SheetContainer/SheetBody do universo dos sheets):
// - `DialogContent` é uma coluna flex limitada à viewport com margem de
//   1rem em todo lado (`calc(100% - 2rem)` — o containing block de um
//   `fixed` é a viewport, então não precisa de `vh`). Nunca cresce além
//   da tela nem encosta nas bordas no mobile.
// - `DialogHeader`/`DialogFooter` são `shrink-0` — ficam fixos.
// - `DialogBody` é a ÚNICA região rolável (`min-h-0 flex-1 overflow-y-auto`).
//   Listas, tabelas e mapas longos vão dentro dele; nada de `max-h-[Nvh]`
//   ad-hoc em div interna.
// - Dialog sem `DialogBody` (form curto) continua funcionando: o próprio
//   `DialogContent` rola como fallback se passar da viewport.
// - Camada: `z-dialog` (index.css) — SEMPRE acima de Sheet, abaixo só do
//   AlertDialog/useConfirm e dos popovers. Nunca sobrescrever z-index aqui.
//
//   <DialogContent className="max-w-lg">
//     <DialogHeader>…</DialogHeader>
//     {/* filtros/controles fixos, se houver */}
//     <DialogBody>…lista longa…</DialogBody>
//     <DialogFooter>…</DialogFooter>
//   </DialogContent>

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-dialog bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideCloseButton?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-dialog -translate-x-1/2 -translate-y-1/2',
        // Coluna flex limitada à viewport (1rem de margem em cada lado).
        // `min-w-0` nos filhos vem de `flex-col` + stretch; `overflow-y-auto`
        // aqui é só fallback pra dialog sem DialogBody.
        'flex max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col gap-4 overflow-y-auto',
        'rounded-md border border-border bg-background p-6 shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Fechar"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('flex shrink-0 flex-col space-y-1.5 text-left', className)}
      {...props}
    />
  )
}
DialogHeader.displayName = 'DialogHeader'

// Região rolável do dialog. `min-h-0` é o que permite o flex item encolher
// abaixo do conteúdo (sem ele, a coluna "explode" e o overflow vaza pra
// fora do DialogContent). `min-w-0` deixa `truncate` funcionar nos filhos.
// `-mx-6 px-6` leva a barra de scroll pra borda do dialog em vez de
// aparecer no meio do padding.
function DialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      data-slot="dialog-body"
      className={cn('-mx-6 min-h-0 min-w-0 flex-1 overflow-y-auto px-6', className)}
      {...props}
    />
  )
}
DialogBody.displayName = 'DialogBody'

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

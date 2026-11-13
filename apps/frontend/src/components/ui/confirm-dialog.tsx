import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ConfirmContext,
  type ConfirmContextValue,
  type ConfirmOptions,
} from '@/components/ui/confirm-context'

// =====================================================================
// useConfirm — substitui `window.confirm` por AlertDialog acessível.
//
// Uso:
//   const confirm = useConfirm()
//   const ok = await confirm({ title: 'Cancelar agendamento?', confirmLabel: 'Cancelar' })
//   if (!ok) return
//
// Provider precisa estar no root (AppShell ou main.tsx).
// =====================================================================

type Resolver = (value: boolean) => void

interface PendingConfirm extends ConfirmOptions {
  resolve: Resolver
}

export function ConfirmProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const handleResolve = (value: boolean) => {
    if (pending) {
      pending.resolve(value)
      setPending(null)
    }
  }

  const value = React.useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) handleResolve(false)
        }}
      >
        {pending && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending.title}</AlertDialogTitle>
              {pending.description && (
                <AlertDialogDescription>
                  {pending.description}
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => handleResolve(false)}>
                {pending.cancelLabel ?? 'Cancelar'}
              </AlertDialogCancel>
              <AlertDialogAction
                variant={pending.variant ?? 'primary'}
                onClick={() => handleResolve(true)}
              >
                {pending.confirmLabel ?? 'Confirmar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}

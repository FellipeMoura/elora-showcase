import * as React from 'react'
import type { ButtonProps } from '@/components/ui/button'

// Contexto + hook do confirm, separados de <ConfirmProvider> para que o
// arquivo do provider exporte só componentes — requisito do Fast Refresh
// (react-refresh/only-export-components). Ver confirm-dialog.tsx.

export interface ConfirmOptions {
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Variante do botão de confirmação. Use 'error'/'destructive' pra ações destrutivas. */
  variant?: ButtonProps['variant']
}

export interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

export const ConfirmContext = React.createContext<ConfirmContextValue | null>(
  null,
)

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>')
  }
  return ctx.confirm
}

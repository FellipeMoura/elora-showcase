import * as React from 'react'
import { cn } from '@/lib/utils'

// Wrapper raiz das páginas autenticadas. Define o ritmo vertical entre
// PageToolbar e o conteúdo principal, e o respiro nas bordas. Toda página
// dentro de AppShell começa com este container — quem precisar de
// comportamento específico (ex: chat em tela cheia) renderiza fora.
//
// Convive com a toolbar sticky: o `m-1` afasta levemente a toolbar das
// bordas do <main>, mas o sticky continua resolvendo contra o scroll
// container (a própria <main> do AppShell) — não contra este div.

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function PageContainer({
  children,
  className,
  ...rest
}: PageContainerProps): React.ReactElement {
  return (
    <div
      className={cn(
        // h-full + overflow-hidden: claim toda a altura visível do <main>
        // e contém o scroll dentro dos filhos. Combine com `flex-1` em um
        // dos filhos pra ele virar o scroll container interno (padrão da
        // tabela em ClientsPage). Cascata sem calc/vh/vw — mobile-safe.
        'flex h-full flex-col gap-1.5 overflow-hidden bg-page p-1.5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

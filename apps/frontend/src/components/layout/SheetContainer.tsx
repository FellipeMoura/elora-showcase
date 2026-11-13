import * as React from 'react'
import { cn } from '@/lib/utils'

// =====================================================================
// SheetContainer + SheetBody — wrappers de layout pra forms em sheet.
// Paralelizam PageContainer no universo dos sheets: definem o ritmo
// flex que mantém a SheetToolbar sticky no topo (via `shrink-0`)
// enquanto o conteúdo rola dentro do SheetBody (`flex-1 overflow-y-auto`).
//
// Como funciona:
//   - SheetContent tem `p-6` por default (do primitivo shadcn).
//   - SheetContainer aplica `-m-6` pra reclamar o full inner area do
//     SheetContent → toolbar fica edge-to-edge naturalmente.
//   - SheetBody restaura `p-6` só na região rolável → toolbar mantém
//     `border-b` colado nas bordas, conteúdo respira nas margens
//     habituais.
//   - Cascata flex (`h-full → flex-col → flex-1 min-h-0`) garante
//     mobile-safe sem `vh`/`calc(100vh - Npx)`.
//
// Quando usar:
//   - SEMPRE que um sheet usa SheetToolbar. A combinação SheetToolbar
//     + SheetContainer + SheetBody é o padrão de form em sidebar.
//
// Quando NÃO usar:
//   - Sheets de shell (MobileDrawer) que precisam de layout customizado.
//
// API:
//   <SheetContent hideCloseButton …>     // sem `overflow-y-auto` no className
//     <SheetContainer>
//       <SheetToolbar srTitle="…">…</SheetToolbar>
//       <SheetBody>
//         <form id={FORM_ID} …>…</form>
//       </SheetBody>
//     </SheetContainer>
//   </SheetContent>
// =====================================================================

interface SheetContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function SheetContainer({
  children,
  className,
  ...rest
}: SheetContainerProps): React.ReactElement {
  return (
    <div
      // `data-slot` deixa este wrapper endereçável por CSS (hoje só como
      // âncora estrutural — a animação de abertura vive no SheetContent
      // pai, que desliza como um portão de correr e leva o container
      // junto).
      data-slot="sheet-container"
      className={cn(
        // `-m-6` cancela o `p-6` default do SheetContent — toolbar e
        // body cuidam do próprio padding. `h-full` + `flex-col` montam
        // a cascata pro SheetBody virar o scroll container interno.
        '-m-6 flex h-full flex-col',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

interface SheetBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function SheetBody({
  children,
  className,
  ...rest
}: SheetBodyProps): React.ReactElement {
  return (
    <div
      className={cn(
        // `min-h-0` é o ingrediente mágico — sem ele, o flex item de
        // conteúdo "explode" pra mostrar tudo e derrota o overflow.
        // `p-6` restaura o padding pra respiro do conteúdo (toolbar
        // fica fora desse padding via flex-col do pai).
        'min-h-0 flex-1 overflow-y-auto p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

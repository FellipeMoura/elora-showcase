import * as React from 'react'
import { Button } from '@/components/ui/button'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { SortableHeader } from '@/components/data/SortableHeader'
import type { SortDir } from '@/lib/sorting'
import { cn } from '@/lib/utils'

// =====================================================================
// Table — tabela de página padronizada. Junta o cartão, scroll wrapper,
// thead sticky, body, estados (loading/erro/vazio), footer slot e mobile
// cards opcional num único componente.
//
// API:
//   - `columns` declara cada coluna ({ key, header, cell }). Adicionar
//     `sortField` torna o header sortable via SortableHeader.
//   - `actions` opcional: callback que retorna RowAction[] por row. Quando
//     definido, vira primeira coluna (ou segunda se `renderRowLead` ativo).
//   - `renderRowLead` opcional: coluna inicial customizada (ex: chevron
//     de expand em MenusPage). Sempre antes da coluna de actions.
//   - `renderRowAddon` opcional: nó renderizado APÓS o <tr> de cada row.
//     Recebe `(row, totalCols)` — usar `totalCols` no colSpan da SubTable.
//     Deve retornar um `<tr>` (ou null).
//   - `mobileCard` opcional: renderer alternativo pra breakpoints < md.
//     Recebe `(row, actions)` já calculadas. Quando ausente, a tabela
//     aparece em todos breakpoints (pode quebrar em mobile estreito).
//   - `footer` opcional: conteúdo no rodapé do card, fora do scroll
//     (paginação, contadores). O wrapper aplica border-t + padding;
//     usar `flex justify-between` no conteúdo se quiser dois grupos.
//
// O componente reivindica `flex-initial min-h-0` no card — encolhe se a
// página apertar e habilita o scroll interno. Sempre filho direto de
// PageContainer.
// =====================================================================

export interface TableColumn<T, SF extends string = string> {
  /** Identificador único da coluna pro React key. */
  key: string
  header: React.ReactNode
  /** Quando setado, header vira clicável (SortableHeader). */
  sortField?: SF
  /** Classe aplicada ao <th> E ao <td>. Use pra width/align. */
  className?: string
  cell: (row: T) => React.ReactNode
}

interface TableProps<T, SF extends string = string> {
  columns: TableColumn<T, SF>[]
  data: T[]
  rowKey: (row: T) => string | number
  actions?: (row: T) => RowAction[]

  /** Estado de ordenação atual (null = sem sort). */
  sortField?: SF | null
  sortDir?: SortDir | null
  onSort?: (field: SF) => void

  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  emptyText?: string
  loadingText?: string
  errorText?: string

  footer?: React.ReactNode
  /** Coluna inicial customizada (chevron, checkbox). Renderizada antes de actions. */
  renderRowLead?: (row: T) => React.ReactNode
  /** Linha extra logo após o <tr> de cada row. Tipicamente uma <SubTable>. */
  renderRowAddon?: (row: T, totalCols: number) => React.ReactNode
  /** Mobile renderer (md:hidden). Quando ausente, tabela em todos breakpoints. */
  mobileCard?: (row: T, actions: RowAction[]) => React.ReactNode
}

export function Table<T, SF extends string = string>({
  columns,
  data,
  rowKey,
  actions,
  sortField,
  sortDir,
  onSort,
  isLoading,
  isError,
  onRetry,
  emptyText = 'Nenhum resultado',
  loadingText = 'Carregando…',
  errorText = 'Erro ao carregar.',
  footer,
  renderRowLead,
  renderRowAddon,
  mobileCard,
}: TableProps<T, SF>): React.ReactElement {
  const leadCount = renderRowLead ? 1 : 0
  const actionsCount = actions ? 1 : 0
  const totalCols = leadCount + actionsCount + columns.length

  // Pré-renderiza estados que substituem todo o conteúdo do card.
  let body: React.ReactNode

  if (isLoading) {
    body = <div className="p-6 text-sm text-muted-foreground">{loadingText}</div>
  } else if (isError) {
    body = (
      <div className="space-y-2 p-6 text-sm">
        <p className="text-destructive">{errorText}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
      </div>
    )
  } else if (data.length === 0) {
    body = <div className="p-6 text-sm text-muted-foreground">{emptyText}</div>
  } else {
    const desktopTable = (
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground backdrop-blur">
          <tr>
            {renderRowLead && (
              <th className="w-px px-2 py-2.5 sm:pl-6" aria-label="Expandir" />
            )}
            {actions && (
              <th
                className={cn(
                  'w-px px-2 py-2.5',
                  // Quando NÃO tem lead, actions vira a primeira coluna e
                  // herda o pl-6 do respiro lateral do card.
                  !renderRowLead && 'sm:pl-6',
                )}
                aria-label="Ações"
              />
            )}
            {columns.map((col) => {
              if (col.sortField && onSort) {
                return (
                  <SortableHeader
                    key={col.key}
                    field={col.sortField}
                    currentField={sortField ?? null}
                    currentDir={sortDir ?? null}
                    onSort={onSort}
                    className={col.className}
                  >
                    {col.header}
                  </SortableHeader>
                )
              }
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 py-2.5 font-medium first:sm:pl-6 last:sm:pr-6',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const rowActions = actions ? actions(row) : []
            return (
              <React.Fragment key={rowKey(row)}>
                <tr className="border-b border-border last:border-0 hover:bg-accent/40">
                  {renderRowLead && (
                    <td className="w-px px-2 py-2.5 sm:pl-6">
                      {renderRowLead(row)}
                    </td>
                  )}
                  {actions && (
                    <td
                      className={cn(
                        'w-px px-2 py-2.5',
                        !renderRowLead && 'sm:pl-6',
                      )}
                    >
                      <RowActions actions={rowActions} />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-2.5 first:sm:pl-6 last:sm:pr-6',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
                {renderRowAddon?.(row, totalCols)}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    )

    if (mobileCard) {
      body = (
        <>
          <div className="hidden md:block">{desktopTable}</div>
          <ul className="divide-y divide-border md:hidden">
            {data.map((row) => (
              <li key={rowKey(row)}>
                {mobileCard(row, actions ? actions(row) : [])}
              </li>
            ))}
          </ul>
        </>
      )
    } else {
      body = desktopTable
    }
  }

  return (
    <div className="flex flex-initial flex-col overflow-hidden rounded-md border border-border bg-background min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      {footer && (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background px-4 py-3 text-sm sm:px-6">
          {footer}
        </footer>
      )}
    </div>
  )
}

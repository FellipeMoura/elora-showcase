import * as React from 'react'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { cn } from '@/lib/utils'

// =====================================================================
// SubTable — tabela aninhada que mora dentro da linha expandida de outra
// tabela. Recebe `colSpan` (= número de colunas da tabela pai) e renderiza
// um <tr><td colSpan> contendo um cartão com a sub-tabela.
//
// Modo declarativo: passar `columns` + `data` + `rowKey` (+ `actions`
// opcional). Mantém visual coerente sem reinventar thead/tbody em cada
// callsite. Pra casos onde o conteúdo aninhado não é uma tabela, dá pra
// usar `<SubTable colSpan={N} bare>...</SubTable>` (TODO se necessário —
// não implementado até alguém precisar).
//
// O wrapping <tr><td colSpan> precisa ser filho direto do <tbody> da
// tabela pai pra alinhamento de colunas funcionar.
// =====================================================================

export interface SubTableColumn<T> {
  /** Identificador único da coluna pro React key. */
  key: string
  header: React.ReactNode
  /** Classe extra aplicada ao <th> e <td> dessa coluna (alinhar largura, text-right etc). */
  className?: string
  /** Renderização da célula. */
  cell: (row: T) => React.ReactNode
}

interface SubTableProps<T> {
  /** Número de colunas da tabela PAI — vira `colSpan` da célula que envelopa. */
  colSpan: number
  columns: SubTableColumn<T>[]
  data: T[]
  rowKey: (row: T) => string | number
  /** Ações de linha. Quando definido, renderiza coluna inicial de RowActions. */
  actions?: (row: T) => RowAction[]
  /** Texto exibido quando `data` está vazio. */
  emptyText?: string
  /** Classe extra no cartão interno. */
  className?: string
}

export function SubTable<T>({
  colSpan,
  columns,
  data,
  rowKey,
  actions,
  emptyText = 'Nenhum subitem',
  className,
}: SubTableProps<T>): React.ReactElement {
  return (
    <tr>
      {/* O fundo `muted/30` cria o "encaixe" visual em volta do cartão
          interno — sinaliza que essa linha pertence à anterior. O padding
          horizontal (`pl-10`) recua o cartão pra direita, reforçando a
          relação parent → child. */}
      <td colSpan={colSpan} className="bg-muted/30 px-2 py-2 sm:pl-10 sm:pr-6">
        <div
          className={cn(
            'overflow-hidden rounded-md border border-border bg-background',
            className,
          )}
        >
          {data.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {actions && (
                    <th className="w-px px-2 py-2 sm:pl-3" aria-label="Ações" />
                  )}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'px-3 py-2 font-medium first:sm:pl-3 last:sm:pr-4',
                        col.className,
                      )}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className="border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    {actions && (
                      <td className="w-px px-2 py-1.5 sm:pl-3">
                        <RowActions actions={actions(row)} />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          'px-3 py-1.5 first:sm:pl-3 last:sm:pr-4',
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}

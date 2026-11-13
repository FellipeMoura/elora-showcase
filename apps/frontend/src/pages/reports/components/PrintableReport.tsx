import { useMe } from '@/hooks/useMe'
import { displayDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

// Wrapper de impressão padronizado pra TODO renderer de relatório.
//
// Layout:
//   - Header (nome do relatório, período, gerado em/por) — sempre visível em
//     tela e impressão
//   - Conteúdo (children)
//   - Footer com numeração — só visível no print (via CSS @media print +
//     `position: fixed`)
//
// Estratégia de PDF: usa `window.print()` nativo do browser. CSS @media print
// em [index.css](../../../index.css §"Print de relatórios") esconde shell
// (sidebar, toolbar), aplica margens A4 e libera quebra de página ótima nas
// seções (via PrintableSection). Browser gera o PDF sem libs extras.
//
// Trade-off aceito: layout do PDF segue o browser do usuário. Se a qualidade
// não satisfizer no futuro, migra pra puppeteer server-side em UM ponto (esse
// componente) sem mexer em cada renderer. Os renderers só precisam: (1)
// envolver seções em PrintableSection, (2) não usar JS dinâmico no resultado.

interface PrintableReportProps {
  reportName: string
  period?: { from: string; to: string } | null
  generatedAt: string
  children: React.ReactNode
  className?: string
}

export function PrintableReport({
  reportName,
  period,
  generatedAt,
  children,
  className,
}: PrintableReportProps): React.ReactElement {
  const { data: me } = useMe()

  return (
    <article
      data-report-printable
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-surface p-4',
        // No print, remove a "ilha" visual e ocupa toda a folha
        'print:rounded-none print:border-0 print:bg-transparent print:p-0',
        className,
      )}
    >
      <header className="flex flex-col gap-1 border-b pb-3">
        <h1 className="text-lg font-semibold">{reportName}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {period && (
            <span>
              Período:{' '}
              <strong className="text-foreground">
                {formatDateLabel(period.from)} → {formatDateLabel(period.to)}
              </strong>
            </span>
          )}
          <span>
            Gerado em:{' '}
            <strong className="text-foreground">
              {displayDateTime(generatedAt)}
            </strong>
          </span>
          {me?.user && (
            <span>
              Por: <strong className="text-foreground">{me.user.name}</strong>
            </span>
          )}
        </div>
      </header>
      {children}
    </article>
  )
}

// Datas vêm como YYYY-MM-DD. Formata pra DD/MM/YYYY local sem hora.
function formatDateLabel(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  if (!y || !m || !d) return yyyymmdd
  return `${d}/${m}/${y}`
}

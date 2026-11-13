import * as React from 'react'

// Observa a largura de um elemento via ResizeObserver. Usado por layouts que
// precisam decidir colapso/overflow em runtime (PageToolbar é o primeiro caso).
//
// Retorna `null` até a primeira medição — quem consome deve tratar esse estado
// (assumir largura grande pra evitar flash de overflow desnecessário).
export function useElementWidth(
  ref: React.RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    // Medição síncrona inicial — antes do paint, evita 1 frame com layout errado.
    setWidth(el.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      // `contentRect.width` exclui borda/padding; pra cálculo de orçamento
      // (que considera padding interno do container), usamos `borderBoxSize`
      // quando disponível, com fallback pro contentRect.
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width
      setWidth(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}

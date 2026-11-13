import { useEffect, type RefObject } from 'react'

// Scroll horizontal por arrasto de mouse no elemento referenciado.
// - Só dispara com mouse (touch/caneta seguem comportamento nativo).
// - Ignora mousedown em elementos interativos (button, a, input…).
// - Drag só começa após THRESHOLD px de movimento horizontal, então clicks
//   curtos passam normalmente; quando o drag aconteceu, o click subsequente
//   é interceptado em capture pra não disparar ações dos cards.
export function useDragScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const THRESHOLD = 4
    let startX = 0
    let startScroll = 0
    let pressed = false
    let dragging = false
    let activePointerId: number | null = null

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'button, a, input, textarea, select, [role="button"], [data-no-drag-scroll]',
        )
      ) {
        return
      }
      pressed = true
      dragging = false
      startX = e.clientX
      startScroll = el!.scrollLeft
      activePointerId = e.pointerId
    }

    function onPointerMove(e: PointerEvent) {
      if (!pressed || e.pointerId !== activePointerId) return
      const dx = e.clientX - startX
      if (!dragging && Math.abs(dx) >= THRESHOLD) {
        dragging = true
        el!.style.cursor = 'grabbing'
        el!.style.userSelect = 'none'
        try {
          el!.setPointerCapture(e.pointerId)
        } catch {
          // ignore — captura é opcional
        }
      }
      if (dragging) {
        el!.scrollLeft = startScroll - dx
        e.preventDefault()
      }
    }

    function endDrag(e: PointerEvent) {
      if (e.pointerId !== activePointerId) return
      const wasDragging = dragging
      pressed = false
      dragging = false
      activePointerId = null
      el!.style.cursor = ''
      el!.style.userSelect = ''
      if (wasDragging) {
        const stop = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        el!.addEventListener('click', stop, { capture: true, once: true })
      }
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [ref])
}

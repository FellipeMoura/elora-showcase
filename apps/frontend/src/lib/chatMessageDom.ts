// Localização de bolhas de mensagem no DOM — usado pelo QuotedSnippet
// (click no stub da citação) e pelo composer (click no preview do reply
// pendente) pra levar o foco até a mensagem original.

// ID DOM da bolha (`msg-<uuid>`), aplicado pelo MessageBubble.
export function bubbleDomId(messageId: string): string {
  return `msg-${messageId}`
}

// Rola até a bolha e pisca o destaque (classe `chat-bubble-flash`, que o
// MessageBubble estiliza com uma variante arbitrária do Tailwind).
// Se a alvo não estiver renderizada (off-page), devolve false — caller pode
// mostrar toast.
export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') return false
  const el = document.getElementById(bubbleDomId(messageId))
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('chat-bubble-flash')
  // Remove a classe após ~1.2s — cobre a animação de scroll lento
  // ('smooth' costuma ser ~600-800ms).
  setTimeout(() => el.classList.remove('chat-bubble-flash'), 1200)
  return true
}

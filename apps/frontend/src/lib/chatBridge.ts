// Bridge imperativo pra disparar ações do domínio chat a partir do core.
//
// Motivação: regra dura do design system — `core/` não pode importar de
// `chat/`. Mas há ações no core (ex: clicar "Abrir conversa" num card de
// lead) que precisam invocar `chatStore.openConversation`. Em vez de violar
// a regra, expomos uma função imperativa que o `app/` shell registra com
// a implementação real (que importa de `chat/` legitimamente — `app/` é
// o único lugar autorizado a colar os dois lados).
//
// Antes do registro, a função é no-op + warn. Em prática registramos no
// AppShell que monta antes de qualquer rota autenticada, então no flow
// real nunca cai no no-op.

// `draftText` opcional: pré-preenche o composer da conversa (ex: link de
// contrato pronto pra enviar). Consumido uma vez pelo MessageComposer.
type OpenChatConversationFn = (
  conversationId: string,
  draftText?: string,
) => void

let openChatConversationImpl: OpenChatConversationFn = (conversationId) => {
  // No-op de segurança. Indica que algum consumidor chamou antes do
  // registro — sintoma de ordering bug.
  console.warn(
    '[chatBridge] openChatConversation chamado antes do registro pelo AppShell',
    { conversationId },
  )
}

export function registerChatBridge(impl: OpenChatConversationFn): void {
  openChatConversationImpl = impl
}

export function openChatConversation(
  conversationId: string,
  draftText?: string,
): void {
  openChatConversationImpl(conversationId, draftText)
}

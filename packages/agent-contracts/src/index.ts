// =====================================================================
// @elora/agent-contracts — contratos compartilhados entre apps/agent e
// apps/core (e eventualmente apps/chat).
// =====================================================================
//
// O que mora aqui:
//   - Schemas Zod dos inputs/outputs das LLM tools (tagConversation,
//     searchAvailableSlots, proposeAppointment, etc.) — populados a partir
//     do PR 5. Tools precisam do MESMO schema em dois lugares: agent envia
//     pra Anthropic como JSON Schema (via .openapi() ou conversão); core
//     valida o mesmo input quando o agent chama o endpoint que o tool
//     dispara internamente.
//   - DTOs das respostas das chamadas do CoreClient (PR 3) — quando a
//     duplicação ficar dolorosa, formaliza aqui.
//
// O que NÃO mora aqui:
//   - Tipos do schema do banco (`BusinessHours`, `Appointment`, etc.) —
//     `@elora/db` já é a fonte da verdade. Re-export se quiser, mas sem
//     redefinir.
//   - Lógica de negócio. Esse pacote é só shape + validação.
//
// Como evoluir:
//   - PR 5 adiciona schemas das tools de classificação.
//   - PR 6-7 adicionam schemas das tools de read-only + agendamento.
//   - Cada tool ganha um arquivo `src/tools/<name>.ts` com `name`,
//     `description`, `inputSchema`. Index re-exporta.
// =====================================================================

export {};

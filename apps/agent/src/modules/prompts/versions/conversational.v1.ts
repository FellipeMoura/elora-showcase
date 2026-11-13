// =====================================================================
// conversational.v1 — system prompt do agente "consultivo" (PR 6).
//
// Substitui o `classifier.v1` em todas as rodadas a partir do PR 6. Agente
// agora RESPONDE ao cliente, mas NÃO marca/confirma agendamento (V1 sem
// scheduling — `handoffToHuman` cobre quem quer fechar). PR 7 adiciona
// `proposeAppointment` + `confirmAppointment` e este prompt evolui pra
// .v2.
//
// Estrutura:
//   1. Identidade da clínica + persona
//   2. Catálogo (procedimentos cabe inline; tags via tool tagConversation)
//   3. Contexto do cliente
//   4. Responsabilidades + REGRAS DURAS
//   5. Tom + tamanho de mensagem
//
// Cache_control marca este bloco como ephemeral — o AnthropicClient já
// põe automaticamente; o conteúdo aqui é estável entre rodadas do mesmo
// tenant (varia só o "CONTEXTO DO CLIENTE" — mantido na MENSAGEM user,
// fora do cache).
// =====================================================================

interface TagCatalogEntry {
  id: string;
  name: string;
  agentInstruction: string;
}

interface ProcedureEntry {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  defaultSessions: number;
}

export interface ConversationalV1SystemInput {
  tenantName: string;
  tenantPersona: string | null;
  tags: TagCatalogEntry[];
  procedures: ProcedureEntry[];
}

const PROMPT_VERSION = 'conversational.v1';

function formatPriceCents(cents: number | null): string {
  if (cents === null) return 'consultar';
  const reais = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${reais}`;
}

function formatProcedures(items: readonly ProcedureEntry[]): string {
  if (items.length === 0) return '(catálogo não cadastrado)';
  return items
    .map((p) => {
      const sessions =
        p.defaultSessions > 1 ? ` (pacote ${p.defaultSessions} sessões)` : '';
      const desc = p.description ? `: ${p.description}` : '';
      return `- ${p.name}${sessions} — ${formatPriceCents(p.priceCents)}${desc}`;
    })
    .join('\n');
}

function formatTags(tags: readonly TagCatalogEntry[]): string {
  if (tags.length === 0) return '(sem tags configuradas — pule tagConversation)';
  return tags
    .map((t) => `- ${t.id} | "${t.name}" — ${t.agentInstruction}`)
    .join('\n');
}

export function buildConversationalV1System(
  input: ConversationalV1SystemInput,
): string {
  const personaLine = input.tenantPersona?.trim()
    ? input.tenantPersona.trim()
    : 'Você é educado, próximo e direto. Português brasileiro coloquial.';

  return `Você é o assistente virtual de WhatsApp da ${input.tenantName}.

PERSONA
${personaLine}

PROCEDIMENTOS DISPONÍVEIS
${formatProcedures(input.procedures)}

CATÁLOGO DE TAGS (use tagConversation pra classificar o estado da conversa)
${formatTags(input.tags)}

SUAS RESPONSABILIDADES
1. Responder dúvidas sobre procedimentos, preços e horários — use as tools quando precisar de dado fresco (getProcedureInfo, getBusinessHours, getClientInfo).
2. Classificar a conversa via tagConversation a cada turno (passe os IDs das tags aplicáveis ou array vazio).
3. Quando o cliente quiser AGENDAR/CONFIRMAR um horário: chame handoffToHuman(reason="cliente_quer_agendar") e avise no texto que alguém vai retomar. NÃO marque agendamento (V1 não confirma — só identifica e passa pra equipe).
4. Use handoffToHuman também quando: cliente reclama, mencionar urgência médica, pedir explicitamente "falar com alguém", ou se não souber responder com confiança.

REGRAS DURAS
- NUNCA dê conselho médico, indicação clínica ou opinião sobre se um procedimento é adequado pra alguém. Resposta padrão: "Vou agendar uma avaliação com nossa profissional pra te orientar."
- NUNCA invente preço, horário, ou disponibilidade. Use as tools — se a tool retornar "configured: false" ou vazio, diga que não tem essa informação.
- NUNCA prometa retorno em X minutos. Apenas: "alguém da equipe vai te responder em breve".
- Foco no presente: últimas 2-3 mensagens do cliente pesam mais que histórico antigo.

TOM
Mensagens curtas (2-3 linhas no máximo). Sem emojis. Sem markdown. Sem listas longas. Resposta direta — clínica de WhatsApp não escreve parágrafos.`;
}

export const CONVERSATIONAL_V1 = {
  promptVersion: PROMPT_VERSION,
  buildSystem: buildConversationalV1System,
};

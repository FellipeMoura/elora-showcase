// =====================================================================
// classifier.v1 — system prompt do classificador puro (PR 5).
//
// Identificador no campo `agent_turns.prompt_version` = "classifier.v1".
// Mudou a regra/estrutura do prompt? Cria versão nova (.v2) e atualiza
// quem chama; mantém este pra rastrear turns antigos.
//
// Decisões:
//   - Português direto. Tom curto. Sem markdown (LLM tende a responder em
//     prosa quando system tem ## headings; queremos só a tool_use).
//   - Catálogo de tags listado com ID UUID + nome + instrução. ID precisa
//     bater literalmente — espaços/quebras adicionais quebram match
//     porque o LLM copia.
//   - História da conversa NÃO entra aqui — vai como user message separado
//     pra cache do system permanecer estável entre conversas do mesmo
//     tenant.
// =====================================================================

interface TagCatalogEntry {
  id: string;
  name: string;
  agentInstruction: string;
}

export interface ClassifierV1SystemInput {
  tenantName: string;
  tags: TagCatalogEntry[];
}

const PROMPT_VERSION = 'classifier.v1';

export function buildClassifierV1System(input: ClassifierV1SystemInput): string {
  const tagsBlock = input.tags
    .map(
      (t) =>
        `- ${t.id} | "${t.name}"\n  Aplicar quando: ${t.agentInstruction}`,
    )
    .join('\n');

  return `Você é o classificador automático de conversas WhatsApp da clínica ${input.tenantName}.

Sua única tarefa: usar a tool tagConversation para classificar o estado/intenção atual da conversa abaixo, escolhendo entre as tags do catálogo.

TAGS DISPONÍVEIS:
${tagsBlock}

REGRAS DE CLASSIFICAÇÃO:
- Aplique TODAS as tags do catálogo cuja instrução se encaixa na conversa.
- Aplique conjunto vazio (tagIds: []) se NENHUMA tag se encaixa.
- Foque no ESTADO ATUAL — últimas mensagens pesam mais que primeiras.
- IDs precisam ser EXATAMENTE os que aparecem em TAGS DISPONÍVEIS. Qualquer outro causa erro.

Você DEVE chamar tagConversation exatamente uma vez. NÃO responda ao cliente nesta etapa — só classifica.`;
}

export const CLASSIFIER_V1 = {
  promptVersion: PROMPT_VERSION,
  buildSystem: buildClassifierV1System,
};

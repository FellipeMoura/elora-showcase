import type {
  CreateFromTemplateInput,
  DocumentRef,
  DocumentStatus,
  NormalizedSignatureEvent,
  ProviderTemplateInfo,
  ProviderTemplateSummary,
  WebhookRequest,
} from './types.js';

// Contrato canônico dos providers de assinatura eletrônica. Implementado
// por ZapSignAdapter (default) e potencialmente por outros providers no
// futuro (Clicksign, Autentique, D4Sign). O resto do app conhece SÓ essa
// interface — trocar provider = trocar implementação no factory.
//
// Diferente do IWhatsAppProvider, aqui não há config por canal: cada
// instância do app usa uma única conta no provider (env var global).
export interface ISignatureProvider {
  // Identificador do provider concreto (`zapsign`, `clicksign`, ...).
  // Usado em logs e métricas pra distinguir origem.
  readonly providerType: string;

  // Verifica se o adapter está com config válida (token presente).
  // Quando false, qualquer operação de envio retorna AppError 503 — útil
  // pra subir o backend sem ZapSign provisionado em dev.
  readonly isConfigured: boolean;

  // URL pública do painel web do provider (lista de templates do usuário).
  // Frontend usa pra link "Abrir painel ZapSign" no form de cadastro de
  // template. Sempre disponível — independe de isConfigured (URL é só
  // derivada do ambiente).
  readonly panelUrl: string;

  // True quando o adapter está apontando pra ambiente sandbox/teste do
  // provider — UI mostra badge avisando que assinaturas não têm validade
  // jurídica nesse modo.
  readonly isSandbox: boolean;

  // ---- Operações de template ----

  // Busca metadados de um template cadastrado no painel do provider. Usado
  // pelo cadastro de apontamento pra preencher automaticamente o array de
  // variáveis (evita erro de digitação que quebra envio).
  getTemplate(externalTemplateId: string): Promise<ProviderTemplateInfo>;

  // Lista todos os templates da conta. Usado pelo combobox de seleção no
  // cadastro de apontamento. Provider pagina internamente; caller recebe
  // array consolidado já dedupado.
  listTemplates(): Promise<ProviderTemplateSummary[]>;

  // ---- Operações de documento ----

  // Cria documento a partir de template cadastrado no provider. Retorna
  // URL pública de assinatura — caller manda pro signer via canal escolhido
  // (no nosso fluxo: WhatsApp da clínica).
  createDocumentFromTemplate(input: CreateFromTemplateInput): Promise<DocumentRef>;

  // Busca status atual de um documento. Usado como fallback quando o
  // webhook não chega (reconciliação periódica) ou pra UI consultar.
  getDocument(externalDocumentId: string): Promise<DocumentStatus>;

  // Cancela documento. No ZapSign: DELETE /docs/{token}. Se já estiver
  // signed, provider rejeita (caller surfaceia 400 pro frontend).
  cancelDocument(externalDocumentId: string): Promise<void>;

  // Baixa o PDF assinado final. Throws AppError se documento ainda não tá
  // signed. Caller persiste o Buffer no MinIO/R2.
  downloadSignedPdf(externalDocumentId: string): Promise<Buffer>;

  // ---- Webhook ----

  // Verifica autenticidade do webhook ANTES de processar o payload.
  // ZapSign não tem assinatura HMAC nativa — usamos header secret custom
  // configurado no painel deles (X-Elora-Webhook-Token). Sem token
  // configurado, retorna true (modo dev sem proteção).
  verifyWebhook(req: WebhookRequest): boolean;

  // Normaliza payload bruto do webhook pro shape canônico do nosso domain.
  // Eventos não mapeados viram `kind: 'unknown'` — caller loga e dropa.
  normalizeWebhook(rawPayload: unknown): NormalizedSignatureEvent;
}

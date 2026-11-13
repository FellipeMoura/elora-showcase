// Tipos canônicos do domínio "assinatura eletrônica". O resto do app
// (módulo contracts, webhook handler) conhece SÓ esses tipos — adapter
// concreto (ZapSign hoje, outro provider amanhã) traduz pro shape externo.

export interface SignatureSigner {
  name: string;
  email?: string;
  // E.164 (ex: '+5511987654321'). ZapSign aceita mas, no nosso fluxo, é
  // só metadata — o envio do link de assinatura sai pelo nosso WhatsApp.
  phoneE164?: string;
  cpf?: string;
}

export interface SignatureVariable {
  name: string;
  value: string;
}

export interface CreateFromTemplateInput {
  // ID do template cadastrado no painel do provider (zapsign_template_id).
  externalTemplateId: string;
  // Título do documento que aparece pro signer no fluxo de assinatura.
  documentName: string;
  signer: SignatureSigner;
  variables: SignatureVariable[];
  // Se true (default), provider não dispara email/SMS automático pro signer —
  // ficamos responsáveis por mandar o link via WhatsApp da clínica.
  disableSignerNotifications?: boolean;
  // Data exata de expiração — caller calcula uma vez e passa o mesmo Date
  // pro provider e pra persistência (evita divergência de timezone/seg entre
  // os dois cálculos paralelos). Null = sem prazo.
  expiresAt?: Date | null;
}

// Snapshot leve de um template cadastrado no painel do provider. Usado pelo
// admin no momento do cadastro do apontamento — vem do `getTemplate` do
// provider e abastece o form do `ContractTemplateSheet` sem digitação manual
// da lista de variáveis (que é a maior fonte de erro: variável escrita errada
// no Elora não casa com `{{key}}` no template e o envio quebra).
export interface ProviderTemplateInfo {
  // Nome amigável do template no provider (pode ser usado como sugestão).
  name: string | null;
  // Lista de chaves de variáveis declaradas no template, sem `{{}}`.
  variables: string[];
}

// Resumo de um template — payload leve do `listTemplates` pra abastecer
// combobox de seleção no front. Variáveis não vêm aqui (caller chama
// `getTemplate(id)` no momento da seleção pra obter shape completo).
export interface ProviderTemplateSummary {
  externalTemplateId: string;
  name: string;
}

export interface DocumentRef {
  // ID/token do documento no provider — usado nas próximas chamadas.
  externalDocumentId: string;
  // ID público (open_id no ZapSign) — compõe URL pública compartilhável.
  // Vazio quando o provider não distingue de externalDocumentId.
  externalOpenId: string;
  // URL pública que o signer abre pra assinar. Caller manda ela via WhatsApp.
  signUrl: string;
}

// Status retornado pelo provider quando consultamos um documento.
// Mantém shape discriminado pra facilitar o switch no caller.
export type DocumentStatus =
  | { status: 'pending' }
  | { status: 'sent'; sentAt: Date | null }
  | { status: 'viewed'; viewedAt: Date | null }
  | { status: 'signed'; signedAt: Date | null; signedPdfUrl: string | null }
  | { status: 'declined'; declinedAt: Date | null; reason: string | null }
  | { status: 'expired' }
  | { status: 'cancelled' };

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

// Eventos canônicos derivados do webhook. Caller (ContractsService) consome
// e atualiza linha em `contracts`. Eventos desconhecidos viram `unknown` —
// caller pode logar e dropar.
export type NormalizedSignatureEvent =
  | {
      kind: 'document.viewed';
      externalDocumentId: string;
      viewedAt: Date;
      metadata: Record<string, unknown>;
    }
  | {
      kind: 'document.signed';
      externalDocumentId: string;
      signedAt: Date;
      // URL temporária pra baixar o PDF assinado — caller faz download e
      // persiste em MinIO/R2 logo após (URL expira em horas).
      signedPdfUrl: string | null;
      metadata: Record<string, unknown>;
    }
  | {
      kind: 'document.declined';
      externalDocumentId: string;
      declinedAt: Date;
      reason: string | null;
      metadata: Record<string, unknown>;
    }
  | {
      kind: 'document.expired';
      externalDocumentId: string;
      metadata: Record<string, unknown>;
    }
  | {
      // Evento que o provider mandou mas a gente não trata. Caller loga e dropa.
      kind: 'unknown';
      rawEvent: string;
      externalDocumentId: string | null;
    };

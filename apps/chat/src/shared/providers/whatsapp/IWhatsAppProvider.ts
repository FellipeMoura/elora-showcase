import type {
  EditMessageInput,
  MessageRef,
  MessageStatus,
  NormalizedInboundEvent,
  OutboundMedia,
  OutboundTemplate,
  OutboundText,
  RevokeMessageInput,
  WebhookRequest,
} from './types.js';

// Contrato canônico dos providers WhatsApp. Implementado por EvolutionAdapter
// (Baileys + Meta Cloud via Evolution v2 — modo escolhido em provider_config)
// e MockAdapter (dev/teste). O resto do app conhece SÓ essa interface — trocar
// provider = trocar implementação, sem mudar lógica de cima.
//
// Ver arquitetura.md §7.1 e §13.6 (mock-first em dev).
export interface IWhatsAppProvider {
  // ID do canal correspondente em `whatsapp_channels`. Usado pra log e pra
  // amarrar a impl à config (token, endpoint). Adapter já vem instanciado
  // com a config — esse id é só pra referência cruzada.
  readonly channelId: string;

  // Identificador do provider (`baileys`, `meta_cloud`, `mock`). Usado em
  // logs e métricas pra distinguir origem.
  readonly providerType: string;

  // Provider enforça as regras "Cloud-like" da janela de 24h + template?
  // - meta_cloud: true (Meta valida no protocolo — texto livre fora da janela
  //   é erro de API).
  // - baileys / mock: false (protocolo não tem janela; defesa contra
  //   banimento mora em outras camadas — rate limit + dedupe no Service).
  //
  // MessagesService consulta isso pra decidir se valida janela 24h + se
  // permite template. Quando false, texto/mídia/áudio fluem sem restrição
  // de tempo e templates ficam efetivamente desabilitados (UI esconde,
  // backend rejeita kind='template' com 400).
  requiresWindowGate(): boolean;

  // ---- Outbound ----

  sendText(input: OutboundText): Promise<MessageRef>;
  sendMedia(input: OutboundMedia): Promise<MessageRef>;
  sendTemplate(input: OutboundTemplate): Promise<MessageRef>;

  // Edita mensagem outbound já entregue. WhatsApp permite editar até 15min
  // após o envio (limite imposto pelo protocolo, não pelo Elora). Após esse
  // prazo o provider retorna erro — caller surfaceia 400 pro frontend.
  // V1 só edita texto; editar caption de mídia fica pra V2.
  editMessage(input: EditMessageInput): Promise<void>;

  // Revoga ("apagar pra todos") mensagem outbound. Soft delete na nossa base
  // fica a cargo do Service (esse método só fala com o provider). WhatsApp
  // permite revogar a qualquer momento — não há janela.
  revokeMessage(input: RevokeMessageInput): Promise<void>;

  // Pra polling. Webhook de status é o caminho padrão — getStatus é fallback
  // pra reconciliar mensagens que ficaram "perdidas" (ex: reinício do chat
  // sem ter processado o webhook).
  getStatus(externalId: string): Promise<MessageStatus>;

  // Foto de perfil pública do contato no WhatsApp. Retorna URL temporária do
  // provedor (Evolution/Baileys) — caller é responsável por baixar e
  // re-uploadar no MinIO se quiser persistência (URLs expiram rápido).
  // Retorna null quando o contato não tem foto / privacidade está restrita /
  // número não existe no WhatsApp. NÃO lança nesses casos — caller decide.
  getProfilePicture(toE164: string): Promise<string | null>;

  // Verifica se o número existe no WhatsApp. Usado em fluxos de cadastro
  // (UI bloqueia/avisa antes de tentar criar contact). Retorna `true` se o
  // número tem WhatsApp ativo no provider, `false` se não. Lança quando o
  // provider está inacessível — caller decide se trata como "warning" e
  // segue sem contact ou propaga 502 pro frontend.
  checkNumberExists(toE164: string): Promise<boolean>;

  // Resolve o número que o WhatsApp realmente reconhece. Diferença pra
  // `checkNumberExists`: lida com a quirk BR (celular cadastrado sem o nono
  // dígito) probando as variantes com/sem 9. Quando uma das variantes
  // responder positivo, devolve `matchedE164` — pode diferir do input.
  // Quando nenhuma existe, `exists=false` e `matchedE164=null`.
  //
  // Caller usa `matchedE164` como o número canônico de envio (persistido em
  // `whatsapp_contacts.whatsappE164`). Lança quando o provider está
  // inacessível — mesma política de erro do `checkNumberExists`.
  resolveNumber(
    toE164: string,
  ): Promise<{ exists: boolean; matchedE164: string | null }>;

  // ---- Inbound ----

  // Verifica autenticidade do webhook ANTES de processar o payload.
  // - Evolution (Baileys e Cloud): Bearer token em `Authorization`, comparado
  //   contra `provider_config.webhookToken` (gerado pelo Elora ao provisionar
  //   a instância e configurado no webhook.headers da Evolution).
  // - Mock: sempre true (dev/CI não simula ataque).
  //
  // Retorna false → handler responde 401 e dropa o evento sem tocar no
  // pipeline. Pode ser async pra casos que precisem de I/O (raro).
  verifyWebhook(req: WebhookRequest): boolean | Promise<boolean>;

  // Recebe payload bruto do webhook (ou body decodificado de evento push) e
  // retorna evento normalizado. Não emite/persiste nada — o normalizer
  // chama isso e decide o que fazer com o evento.
  normalizeWebhook(rawPayload: unknown): NormalizedInboundEvent;

  // Baixa o conteúdo BINÁRIO + decodificado da mídia inbound. WhatsApp/Baileys
  // entrega `audioMessage.url` (e similares) apontando pra `mmg.whatsapp.net/
  // .../*.enc` — bytes CIFRADOS. Player de áudio/imagem do browser não toca
  // isso. O provider (Evolution) tem endpoint dedicado que descriptografa
  // usando a `mediaKey` do payload (`/chat/getBase64FromMediaMessage`).
  //
  // Recebe o `rawPayload` do webhook (envelope completo) — adapter extrai o
  // que precisa. Retorna `null` quando não suporta (mock, payload sem mídia,
  // erro recuperável). Caller pode fallback pra fetch direto da URL nesse
  // caso (útil pra mock/dev).
  fetchInboundMediaBuffer(rawPayload: unknown): Promise<InboundMediaBuffer | null>;
}

export interface InboundMediaBuffer {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

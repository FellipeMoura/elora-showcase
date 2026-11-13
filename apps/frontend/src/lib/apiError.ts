// Helpers pra ler o corpo de erro padrão do core/chat:
//   { message: string, details?: { path: string; message: string }[] }
// `details` vem do middleware de validação Zod (validateBody/Query/Params).

export interface ApiErrorDetail {
  path: string
  message: string
}

interface ApiErrorBody {
  message?: string
  details?: unknown
}

// Rótulos PT-BR dos campos de input dos schemas do backend. Usado quando o
// form não passa `labels` próprios; path sem rótulo aparece cru.
const DEFAULT_LABELS: Record<string, string> = {
  active: 'Ativo',
  agentEnabled: 'Agente habilitado',
  agentIdleMinutes: 'Minutos de inatividade do agente',
  agentInstruction: 'Instrução do agente',
  agentPersona: 'Persona do agente',
  amount: 'Valor',
  answerBoolean: 'Resposta',
  answerDate: 'Resposta',
  answerNumber: 'Resposta',
  answerOption: 'Resposta',
  answerText: 'Resposta',
  answers: 'Respostas',
  appointmentId: 'Agendamento',
  attended: 'Compareceu',
  birthDate: 'Data de nascimento',
  body: 'Texto',
  canApplyProcedures: 'Aplicador',
  canEvaluate: 'Avaliador',
  caption: 'Legenda',
  category: 'Categoria',
  channelId: 'Canal',
  city: 'Cidade',
  clientId: 'Cliente',
  clinicName: 'Nome da clínica',
  code: 'Código',
  color: 'Cor',
  complement: 'Complemento',
  country: 'País',
  dateFrom: 'Data inicial',
  dateTo: 'Data final',
  dayOfWeek: 'Dia da semana',
  defaultPrice: 'Preço padrão',
  defaultSessions: 'Sessões padrão',
  description: 'Descrição',
  discountAmount: 'Desconto (R$)',
  discountPct: 'Desconto (%)',
  document: 'Documento',
  dueDate: 'Vencimento',
  durationMinutes: 'Duração (min)',
  effectiveFrom: 'Vigência inicial',
  effectiveTo: 'Vigência final',
  email: 'Email',
  endAt: 'Fim',
  endTime: 'Horário final',
  equipmentId: 'Equipamento',
  evaluationId: 'Avaliação',
  evolutionNotes: 'Evolução',
  expiresInDays: 'Validade (dias)',
  formTemplateId: 'Formulário',
  generalNotes: 'Observações gerais',
  groupId: 'Grupo',
  groupIds: 'Grupos',
  icon: 'Ícone',
  installment: 'Parcela',
  items: 'Itens',
  journeyId: 'Jornada',
  kind: 'Tipo',
  label: 'Rótulo',
  legalName: 'Razão social',
  lostReason: 'Motivo da perda',
  method: 'Forma de pagamento',
  name: 'Nome',
  neighborhood: 'Bairro',
  notes: 'Observações',
  number: 'Número',
  options: 'Opções',
  origin: 'Origem',
  paidAmount: 'Valor pago',
  paidAt: 'Data do pagamento',
  parentId: 'Menu pai',
  password: 'Senha',
  path: 'Caminho',
  paymentMethod: 'Forma de pagamento',
  payments: 'Pagamentos',
  phoneNumber: 'Telefone',
  position: 'Posição',
  procedureId: 'Procedimento',
  professionalId: 'Profissional',
  professionalObservation: 'Observação do profissional',
  prompt: 'Pergunta',
  providerConfig: 'Configuração do provedor',
  providerType: 'Provedor',
  quantitySessions: 'Sessões',
  questionType: 'Tipo de pergunta',
  reason: 'Motivo',
  representativeName: 'Representante',
  required: 'Obrigatório',
  roleCode: 'Papel',
  roleCodes: 'Papéis',
  scheduledAt: 'Data agendada',
  section: 'Seção',
  signatureSvg: 'Assinatura',
  slug: 'Subdomínio',
  source: 'Origem',
  stage: 'Etapa',
  startAt: 'Início',
  startTime: 'Horário inicial',
  status: 'Status',
  street: 'Rua',
  substage: 'Subetapa',
  tagIds: 'Etiquetas',
  templateId: 'Modelo',
  templateName: 'Modelo',
  templateVariables: 'Variáveis do modelo',
  text: 'Texto',
  timezone: 'Fuso horário',
  title: 'Título',
  totalInstallments: 'Parcelas',
  tradeName: 'Nome fantasia',
  unitId: 'Unidade',
  unitPrice: 'Preço unitário',
  url: 'URL',
  username: 'Usuário',
  validUntil: 'Válido até',
  value: 'Valor',
  variables: 'Variáveis',
  visibility: 'Visibilidade',
  whatsappChannelId: 'Canal do WhatsApp',
  zipCode: 'CEP',
}

function body(err: unknown): ApiErrorBody | undefined {
  return (err as { response?: { data?: ApiErrorBody } })?.response?.data
}

export function apiErrorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export function apiErrorDetails(err: unknown): ApiErrorDetail[] {
  const details = body(err)?.details
  if (!Array.isArray(details)) return []
  return details.filter(
    (d): d is ApiErrorDetail =>
      typeof d === 'object' &&
      d !== null &&
      typeof (d as ApiErrorDetail).path === 'string' &&
      typeof (d as ApiErrorDetail).message === 'string',
  )
}

// "items.0.unitPrice" → "Itens #1 › Preço unitário". Path vazio (erro do
// objeto inteiro, ex.: refine) → string vazia.
function labelFor(path: string, labels: Record<string, string>): string {
  if (path === '') return ''
  const direct = labels[path] ?? DEFAULT_LABELS[path]
  if (direct) return direct
  return path
    .split('.')
    .map((seg) =>
      /^\d+$/.test(seg)
        ? `#${Number(seg) + 1}`
        : (labels[seg] ?? DEFAULT_LABELS[seg] ?? seg),
    )
    .join(' › ')
    .replace(/ › #/g, ' #')
}

/**
 * Mensagem do backend com os campos inválidos anexados, ou `undefined` se o
 * erro não veio do backend. Pensado pro padrão `apiErrorText(err) ?? 'fallback'`:
 *   "Dados inválidos: Email: Email inválido; Senha: Senha muito curta"
 * `labels` sobrescreve o rótulo de um path específico do form.
 */
export function apiErrorText(
  err: unknown,
  labels: Record<string, string> = {},
): string | undefined {
  const message = body(err)?.message
  const details = apiErrorDetails(err)
  if (details.length === 0) return message
  const parts = details.map((d) => {
    const label = labelFor(d.path, labels)
    return label ? `${label}: ${d.message}` : d.message
  })
  return `${message ?? 'Dados inválidos'}: ${parts.join('; ')}`
}

/** Igual a `apiErrorText`, mas sempre devolve string (usa `fallback`). */
export function apiErrorMessage(
  err: unknown,
  fallback: string,
  labels: Record<string, string> = {},
): string {
  return apiErrorText(err, labels) ?? fallback
}

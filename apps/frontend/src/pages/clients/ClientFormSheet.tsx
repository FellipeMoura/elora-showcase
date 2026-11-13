import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Loader2, MessageSquareWarning } from 'lucide-react'
import { MaskedField } from '@/components/form/MaskedField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useUpdateClient } from '@/hooks/useClients'
import { useCreateLead } from '@/hooks/useLeads'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  checkClientByPhone,
  type CheckClientByPhoneResponse,
  type Client,
  type ClientAddress,
} from '@/api/clients'
import {
  checkWhatsappNumber,
  type CheckNumberResponse,
} from '@/api/whatsappContacts'
import { normalizePhoneE164 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Form único de cadastro/edição de pessoa no sistema.
//
// Criar: cria cliente + journey (lead) + opcionalmente whatsapp_contact
// numa só chamada via POST /leads. Verifica em tempo real se o número:
//   - já está cadastrado → bloqueia submit (error)
//   - existe no WhatsApp → cria contact junto (ok)
//   - não existe no WhatsApp → cadastra sem contact (warning)
//
// Editar: PATCH /clients/:id (modo legado de edição). Não mexe em
// journey nem contact — mudança de número (1 ativo, 1 histórico) entra
// em sessão futura.
// =====================================================================

// CPF, CEP e UF mantidos em DÍGITOS no estado do form (CPF/CEP) ou em UF
// uppercase (state). Máscara é só apresentação — MaskedField cuida.
const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  phoneRaw: z.string().trim().min(1, 'Telefone obrigatório'),
  email: z
    .string()
    .trim()
    .max(255)
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email inválido',
    ),
  birthDate: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v),
      'Data deve estar em YYYY-MM-DD',
    ),
  document: z
    .string()
    .trim()
    .refine((v) => v === '' || v.length === 11, 'CPF deve conter 11 dígitos'),
  zipCode: z
    .string()
    .trim()
    .refine((v) => v === '' || v.length === 8, 'CEP deve conter 8 dígitos'),
  street: z.string().trim().max(255),
  number: z.string().trim().max(20),
  complement: z.string().trim().max(255),
  neighborhood: z.string().trim().max(255),
  city: z.string().trim().max(120),
  state: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[A-Za-z]{2}$/.test(v), 'UF deve ter 2 letras'),
  notes: z.string().trim().max(5000),
  isVip: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

const FORM_ID = 'client-form'

interface ClientFormSheetProps {
  open: boolean
  // null = criar novo (vira lead). Client = editar existente.
  client: Client | null
  onOpenChange: (open: boolean) => void
}

const emptyValues: FormValues = {
  name: '',
  phoneRaw: '',
  email: '',
  birthDate: '',
  document: '',
  zipCode: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  notes: '',
  isVip: false,
}

function valuesFromClient(client: Client | null): FormValues {
  if (!client) return emptyValues
  const addr = client.address
  return {
    name: client.name,
    phoneRaw: client.phoneE164,
    email: client.email ?? '',
    birthDate: client.birthDate ?? '',
    document: client.document ?? '',
    zipCode: addr?.zipCode ?? '',
    street: addr?.street ?? '',
    number: addr?.number ?? '',
    complement: addr?.complement ?? '',
    neighborhood: addr?.neighborhood ?? '',
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    notes: client.notes ?? '',
    isVip: client.isVip,
  }
}

// Constrói o objeto de endereço a partir dos campos do form. Retorna null
// quando todos os campos estão vazios — evita gravar `{}` no jsonb.
function buildAddress(data: FormValues): ClientAddress | null {
  const fields = {
    zipCode: data.zipCode || undefined,
    street: data.street || undefined,
    number: data.number || undefined,
    complement: data.complement || undefined,
    neighborhood: data.neighborhood || undefined,
    city: data.city || undefined,
    state: data.state ? data.state.toUpperCase() : undefined,
  }
  const hasAny = Object.values(fields).some((v) => v !== undefined)
  return hasAny ? fields : null
}

const e164Regex = /^\+[1-9]\d{7,14}$/

interface PhoneStatus {
  client: CheckClientByPhoneResponse
  whatsapp: CheckNumberResponse
}

export function ClientFormSheet({
  open,
  client,
  onOpenChange,
}: ClientFormSheetProps): React.ReactElement {
  const isEdit = Boolean(client)
  const navigate = useNavigate()
  const createLead = useCreateLead()
  const updateClient = useUpdateClient()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  useEffect(() => {
    if (open) {
      reset(valuesFromClient(client))
    }
  }, [open, client, reset])

  const phoneRaw = watch('phoneRaw')
  const normalizedPhone = normalizePhoneE164(phoneRaw)
  const phoneIsValid = e164Regex.test(normalizedPhone)
  const debouncedPhone = useDebouncedValue(
    phoneIsValid ? normalizedPhone : '',
    400,
  )

  // Em modo edit, número não-alterado não dispara check — o backend não
  // bloqueia "duplicidade contra si mesmo", mas o frontend também não
  // precisa pedir confirmação.
  const isUnchangedPhone = isEdit && client?.phoneE164 === debouncedPhone
  const shouldCheck = open && Boolean(debouncedPhone) && !isUnchangedPhone

  const phoneCheckQuery = useQuery<PhoneStatus, Error>({
    queryKey: ['phone-check', debouncedPhone],
    queryFn: async () => {
      const [clientCheck, waCheck] = await Promise.all([
        checkClientByPhone(debouncedPhone),
        checkWhatsappNumber(debouncedPhone),
      ])
      return { client: clientCheck, whatsapp: waCheck }
    },
    enabled: shouldCheck,
    staleTime: 30 * 1000,
  })

  const phoneStatus = derivePhoneStatus({
    open,
    phoneIsValid,
    isUnchangedPhone,
    debounceLag: phoneIsValid && normalizedPhone !== debouncedPhone,
    isFetching: phoneCheckQuery.isFetching,
    isError: phoneCheckQuery.isError,
    data: phoneCheckQuery.data,
    editingClientId: client?.id ?? null,
  })

  const isVip = watch('isVip')

  const onSubmit = handleSubmit(async (data) => {
    const phoneE164 = normalizePhoneE164(data.phoneRaw)
    if (!e164Regex.test(phoneE164)) {
      setError('phoneRaw', {
        type: 'manual',
        message: 'Telefone inválido. Use formato +55DDDNumero ou apenas dígitos.',
      })
      return
    }

    if (phoneStatus.kind === 'taken') {
      setError('phoneRaw', {
        type: 'manual',
        message:
          phoneStatus.takenBy.active
            ? `Já cadastrado em ${phoneStatus.takenBy.name}.`
            : `Já cadastrado em ${phoneStatus.takenBy.name} (inativo).`,
      })
      return
    }

    const address = buildAddress(data)
    const documentDigits = data.document === '' ? null : data.document

    try {
      if (isEdit && client) {
        // Modo edit: só PATCH cliente. Contacts (incluindo histórico de
        // mudança de número) ficam pra sessão futura.
        await updateClient.mutateAsync({
          id: client.id,
          input: {
            name: data.name,
            phoneE164,
            email: data.email === '' ? null : data.email,
            birthDate: data.birthDate === '' ? null : data.birthDate,
            document: documentDigits,
            address,
            notes: data.notes === '' ? null : data.notes,
            isVip: data.isVip,
          },
        })
        toast.success('Cliente atualizado')
        onOpenChange(false)
        return
      }

      // Modo create: cria cliente + lead + (opcional) contact.
      // `createWhatsappContact` só `true` quando check confirmou WhatsApp.
      // Quando o check resolveu pra uma variante BR diferente (ex.: cliente
      // digitou +5531991112222 mas a conta WhatsApp é +553191112222),
      // propaga `whatsappE164` pra evitar novo probe no worker outbound.
      const createContact = phoneStatus.kind === 'available_with_whatsapp'
      const whatsappE164 =
        phoneStatus.kind === 'available_with_whatsapp'
          ? phoneStatus.whatsappE164 ?? undefined
          : undefined
      await createLead.mutateAsync({
        name: data.name,
        phoneE164,
        email: data.email === '' ? null : data.email,
        birthDate: data.birthDate === '' ? null : data.birthDate,
        document: documentDigits,
        address,
        notes: data.notes === '' ? null : data.notes,
        isVip: data.isVip,
        createWhatsappContact: createContact,
        whatsappE164,
      })
      toast.success('Cadastrado com sucesso')
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const respData = (
        err as {
          response?: { data?: { message?: string; activeJourneyId?: string } }
        }
      )?.response?.data
      if (status === 409 && respData?.activeJourneyId) {
        const activeId = respData.activeJourneyId
        toast.error(respData.message ?? 'Cliente já possui jornada ativa', {
          action: {
            label: 'Ver jornada',
            onClick: () => {
              onOpenChange(false)
              navigate(`/journeys/${activeId}`)
            },
          },
        })
      } else if (status === 409) {
        toast.error(apiErrorText(err) ?? 'Conflito ao salvar')
      } else if (status === 400) {
        toast.error(apiErrorText(err) ?? 'Dados inválidos')
      } else {
        toast.error('Erro ao salvar. Tente novamente.')
      }
    }
  })

  const submitBlocked = phoneStatus.kind === 'taken'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar cadastro' : 'Novo cadastro'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={
                isSubmitting
                  ? 'Salvando…'
                  : isEdit
                    ? 'Salvar'
                    : 'Cadastrar'
              }
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting || submitBlocked}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Nome"
            placeholder="Maria Silva"
            autoComplete="name"
            error={errors.name?.message ?? null}
            required
            {...register('name')}
          />
          <div className="flex flex-col gap-1.5">
            <TextField
              label="Telefone"
              placeholder="+55 11 99999-9999"
              autoComplete="tel"
              helperText="Aceita com ou sem máscara. Brasileiros podem omitir +55."
              error={errors.phoneRaw?.message ?? null}
              required
              {...register('phoneRaw')}
            />
            <PhoneStatusHint status={phoneStatus} />
          </div>
          <TextField
            label="Email"
            type="email"
            placeholder="maria@exemplo.com"
            autoComplete="email"
            error={errors.email?.message ?? null}
            {...register('email')}
          />
          <TextField
            label="Data de nascimento"
            type="date"
            error={errors.birthDate?.message ?? null}
            {...register('birthDate')}
          />
          <MaskedField
            control={control}
            name="document"
            mask="cpf"
            label="CPF"
            placeholder="000.000.000-00"
            error={errors.document?.message ?? null}
          />

          <FieldsetSection title="Endereço">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <MaskedField
                  control={control}
                  name="zipCode"
                  mask="cep"
                  label="CEP"
                  placeholder="00000-000"
                  error={errors.zipCode?.message ?? null}
                />
              </div>
              <div className="col-span-2">
                <TextField
                  label="Rua"
                  placeholder="Av. Paulista"
                  autoComplete="address-line1"
                  error={errors.street?.message ?? null}
                  {...register('street')}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <TextField
                  label="Número"
                  placeholder="123"
                  error={errors.number?.message ?? null}
                  {...register('number')}
                />
              </div>
              <div className="col-span-2">
                <TextField
                  label="Complemento"
                  placeholder="Apto 12"
                  autoComplete="address-line2"
                  error={errors.complement?.message ?? null}
                  {...register('complement')}
                />
              </div>
            </div>
            <TextField
              label="Bairro"
              placeholder="Bela Vista"
              autoComplete="address-level3"
              error={errors.neighborhood?.message ?? null}
              {...register('neighborhood')}
            />
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <TextField
                  label="Cidade"
                  placeholder="São Paulo"
                  autoComplete="address-level2"
                  error={errors.city?.message ?? null}
                  {...register('city')}
                />
              </div>
              <div className="col-span-1">
                <TextField
                  label="UF"
                  placeholder="SP"
                  maxLength={2}
                  autoComplete="address-level1"
                  className="uppercase"
                  error={errors.state?.message ?? null}
                  {...register('state')}
                />
              </div>
            </div>
          </FieldsetSection>

          <TextArea
            id="client-notes"
            label="Observações"
            rows={4}
            placeholder="Alergias, preferências, observações internas…"
            error={errors.notes?.message ?? null}
            {...register('notes')}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={isVip}
              onChange={(e) => setValue('isVip', e.target.checked)}
            />
            <span>Marcar como VIP</span>
          </label>

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

// =====================================================================
// Estado derivado da checagem do telefone
// =====================================================================

type DerivedPhoneStatus =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'error' }
  | { kind: 'available_with_whatsapp'; whatsappE164: string | null }
  | { kind: 'available_without_whatsapp' }
  | { kind: 'available_no_channel' }
  | { kind: 'taken'; takenBy: { id: string; name: string; active: boolean } }

interface DeriveArgs {
  open: boolean
  phoneIsValid: boolean
  isUnchangedPhone: boolean
  debounceLag: boolean
  isFetching: boolean
  isError: boolean
  data: PhoneStatus | undefined
  editingClientId: string | null
}

function derivePhoneStatus(args: DeriveArgs): DerivedPhoneStatus {
  if (!args.open) return { kind: 'idle' }
  if (!args.phoneIsValid) return { kind: 'invalid' }
  if (args.isUnchangedPhone) return { kind: 'idle' }
  if (args.debounceLag || args.isFetching) return { kind: 'checking' }
  if (args.isError) return { kind: 'error' }
  if (!args.data) return { kind: 'idle' }

  // Edit: se número bate com OUTRO cliente, é taken. Bater com o próprio
  // (não deve acontecer porque isUnchangedPhone já filtrou) seria ignorado.
  if (
    args.data.client.exists &&
    args.data.client.client &&
    args.data.client.client.id !== args.editingClientId
  ) {
    return { kind: 'taken', takenBy: args.data.client.client }
  }

  if (args.data.whatsapp.onWhatsApp) {
    return {
      kind: 'available_with_whatsapp',
      whatsappE164: args.data.whatsapp.whatsappE164,
    }
  }
  if (args.data.whatsapp.reason === 'no_channel')
    return { kind: 'available_no_channel' }
  return { kind: 'available_without_whatsapp' }
}

function PhoneStatusHint({
  status,
}: {
  status: DerivedPhoneStatus
}): React.ReactElement | null {
  if (status.kind === 'idle' || status.kind === 'invalid') return null

  if (status.kind === 'checking') {
    return (
      <HintRow tone="muted">
        <Loader2 className="size-3.5 animate-spin" />
        Verificando número…
      </HintRow>
    )
  }
  if (status.kind === 'error') {
    return (
      <HintRow tone="muted">
        <AlertCircle className="size-3.5" />
        Não foi possível verificar o número agora — o cadastro segue, o
        backend revalida.
      </HintRow>
    )
  }
  if (status.kind === 'available_with_whatsapp') {
    return (
      <HintRow tone="success">
        <CheckCircle2 className="size-3.5" />
        Disponível e com WhatsApp — contato será criado junto.
      </HintRow>
    )
  }
  if (status.kind === 'available_without_whatsapp') {
    return (
      <HintRow tone="warning">
        <MessageSquareWarning className="size-3.5" />
        Disponível, mas sem WhatsApp — cadastrado sem contato.
      </HintRow>
    )
  }
  if (status.kind === 'available_no_channel') {
    return (
      <HintRow tone="warning">
        <MessageSquareWarning className="size-3.5" />
        Sem canal WhatsApp configurado — cadastrado sem contato.
      </HintRow>
    )
  }
  // taken
  return (
    <HintRow tone="error">
      <AlertCircle className="size-3.5" />
      Já cadastrado em <strong>{status.takenBy.name}</strong>
      {!status.takenBy.active && ' (inativo)'}. Não é possível duplicar.
    </HintRow>
  )
}

// Agrupador visual leve pra seções dentro do form. Sem fieldset nativo pra
// não puxar o estilo default do browser; mantém o ritmo de gap dos campos.
function FieldsetSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function HintRow({
  tone,
  children,
}: {
  tone: 'muted' | 'success' | 'warning' | 'error'
  children: React.ReactNode
}): React.ReactElement {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 px-3 text-xs',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'success' &&
          'text-emerald-700 dark:text-emerald-300',
        tone === 'warning' &&
          'text-amber-700 dark:text-amber-300',
        tone === 'error' && 'text-destructive',
      )}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </p>
  )
}

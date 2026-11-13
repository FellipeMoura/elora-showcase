import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { TextArea } from '@/components/form/TextArea'
import { MaskedField } from '@/components/form/MaskedField'
import { TextField } from '@/components/form/TextField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import {
  useCreateTenant,
  useDeleteTenantLogo,
  useTenant,
  useTenantLogoUrl,
  useUpdateTenant,
  useUploadTenantLogo,
} from '@/hooks/useTenants'
import type { BusinessHours } from '@/api/tenants'
import { apiErrorText } from '@/lib/apiError'

// Mantém a regra alinhada com o backend (TenantsTypes.ts → slugSchema).
// Lowercase, alfanumérico + hífens, sem hífens nas bordas, 2-63 chars.
const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

// HH:mm 24h. Mesmo regex do backend.
const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/

// Catálogo curto de timezones BR — o backend aceita qualquer IANA. Caso
// vire dor (clínica fora de BR), basta ampliar a lista ou trocar por
// input livre.
const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT, -03)' },
  { value: 'America/Bahia', label: 'Bahia (-03)' },
  { value: 'America/Fortaleza', label: 'Fortaleza (-03)' },
  { value: 'America/Recife', label: 'Recife (-03)' },
  { value: 'America/Belem', label: 'Belém (-03)' },
  { value: 'America/Manaus', label: 'Manaus (AMT, -04)' },
  { value: 'America/Boa_Vista', label: 'Boa Vista (-04)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (-04)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (-04)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (-05)' },
] as const
const DEFAULT_TIMEZONE = 'America/Sao_Paulo'

// 0=Dom..6=Sáb. Layout no form segue convenção brasileira (Dom primeiro).
const DAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const

interface BusinessHoursDayForm {
  enabled: boolean
  open: string
  close: string
}

function emptyBusinessHoursDays(): BusinessHoursDayForm[] {
  return Array.from({ length: 7 }, () => ({
    enabled: false,
    open: '09:00',
    close: '18:00',
  }))
}

// Hidrata o array de 7 dias a partir do payload do backend. Cada entrada
// do schedule "liga" um dia; dias ausentes ficam disabled com defaults.
function hydrateBusinessHoursDays(
  bh: BusinessHours | null | undefined,
): BusinessHoursDayForm[] {
  const days = emptyBusinessHoursDays()
  if (!bh) return days
  for (const entry of bh.schedule) {
    days[entry.dayOfWeek] = {
      enabled: true,
      open: entry.open,
      close: entry.close,
    }
  }
  return days
}

// Inverso: array de 7 dias → BusinessHours (ou null se tudo desligado /
// businessHoursEnabled=false).
function serializeBusinessHours(
  enabled: boolean,
  timezone: string,
  days: BusinessHoursDayForm[],
): BusinessHours | null {
  if (!enabled) return null
  const schedule = days
    .map((d, idx) => ({ dayOfWeek: idx as 0 | 1 | 2 | 3 | 4 | 5 | 6, ...d }))
    .filter((d) => d.enabled)
    .map(({ dayOfWeek, open, close }) => ({ dayOfWeek, open, close }))
  if (schedule.length === 0) return null
  return { timezone: timezone || DEFAULT_TIMEZONE, schedule }
}

const businessHoursDayShape = z.object({
  enabled: z.boolean(),
  open: z.string().regex(timeRegex, 'Use HH:mm'),
  close: z.string().regex(timeRegex, 'Use HH:mm'),
})

// CNPJ mantido em DÍGITOS apenas no estado do form — MaskedField formata
// só na apresentação. Strings opcionais (legalName/tradeName/…) vivem como
// '' no form e viram null no submit.
//
// `logoUrl` NÃO faz parte deste form — upload passa por endpoint dedicado
// (POST /tenants/:id/logo), gerenciado pelo LogoUploader inline.
const tenantBaseShape = {
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  legalName: z.string().trim().max(255),
  tradeName: z.string().trim().max(255),
  document: z
    .string()
    .trim()
    .refine((v) => v === '' || v.length === 14, 'CNPJ deve conter 14 dígitos'),
  representativeName: z.string().trim().max(255),
  skipEvaluation: z.boolean(),
  agentEnabled: z.boolean(),
  // valueAsNumber no register → vem como number; coerce dá segurança extra
  // se o consumidor mexer manualmente.
  agentIdleMinutes: z.coerce
    .number({ invalid_type_error: 'Informe um número inteiro' })
    .int('Use número inteiro')
    .min(1, 'Mínimo 1 minuto')
    .max(1440, 'Máximo 1440 (24h)'),
  agentPersona: z.string().trim().max(2000),
  businessHoursEnabled: z.boolean(),
  businessHoursTimezone: z.string().min(1),
  businessHoursDays: z.array(businessHoursDayShape).length(7),
}

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2, 'Slug mínimo de 2 caracteres')
    .max(63, 'Slug máximo de 63 caracteres')
    .regex(
      slugRegex,
      'Use apenas letras minúsculas, números e hífens (sem hífen no início/fim)',
    ),
  ...tenantBaseShape,
})

// No update, slug fica fora — é imutável (parte do subdomínio).
const editSchema = z.object(tenantBaseShape)

type CreateValues = z.infer<typeof createSchema>
type EditValues = z.infer<typeof editSchema>

// '' → null no payload do backend (campo nullable).
function emptyToNull(v: string): string | null {
  return v === '' ? null : v
}

interface TenantFormSheetProps {
  open: boolean
  // null = criar. string (uuid) = editar. Detalhe (incluindo
  // skipEvaluation) é carregado via useTenant — list endpoint só traz
  // id/slug/name.
  tenantId: string | null
  onOpenChange: (open: boolean) => void
}

const CREATE_FORM_ID = 'tenant-create-form'
const EDIT_FORM_ID = 'tenant-edit-form'

export function TenantFormSheet({
  open,
  tenantId,
  onOpenChange,
}: TenantFormSheetProps): React.ReactElement {
  const isEdit = Boolean(tenantId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        {/* Monta o form correto pra cada modo — chaves diferentes resetam o
            estado interno do RHF entre create/edit, evitando vazamento de
            valores entre aberturas consecutivas. */}
        {isEdit ? (
          <EditForm
            key={`edit-${tenantId}`}
            tenantId={tenantId as string}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <CreateForm
            key="create"
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

interface CreateFormProps {
  onDone: () => void
  onCancel: () => void
}

function CreateForm({ onDone, onCancel }: CreateFormProps): React.ReactElement {
  const createMutation = useCreateTenant()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      slug: '',
      name: '',
      legalName: '',
      tradeName: '',
      document: '',
      representativeName: '',
      skipEvaluation: false,
      agentEnabled: false,
      agentIdleMinutes: 15,
      agentPersona: '',
      businessHoursEnabled: false,
      businessHoursTimezone: DEFAULT_TIMEZONE,
      businessHoursDays: emptyBusinessHoursDays(),
    },
  })

  const skipEvaluation = watch('skipEvaluation')
  const agentEnabled = watch('agentEnabled')
  const businessHoursEnabled = watch('businessHoursEnabled')
  const businessHoursDays = watch('businessHoursDays')

  const onSubmit = handleSubmit(async (data) => {
    try {
      await createMutation.mutateAsync({
        slug: data.slug,
        name: data.name,
        legalName: emptyToNull(data.legalName),
        tradeName: emptyToNull(data.tradeName),
        document: emptyToNull(data.document),
        representativeName: emptyToNull(data.representativeName),
        skipEvaluation: data.skipEvaluation,
        agentEnabled: data.agentEnabled,
        agentIdleMinutes: data.agentIdleMinutes,
        agentPersona: emptyToNull(data.agentPersona),
        businessHours: serializeBusinessHours(
          data.businessHoursEnabled,
          data.businessHoursTimezone,
          data.businessHoursDays,
        ),
      })
      toast.success('Tenant criado')
      onDone()
    } catch (err) {
      handleMutationError(err, 'criar')
    }
  })

  return (
    <SheetContainer>
      <SheetToolbar srTitle="Novo tenant">
        <SheetToolbar.Action
          label="Cancelar"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        />
        <SheetToolbar.Action
          label={isSubmitting ? 'Salvando…' : 'Criar'}
          type="submit"
          form={CREATE_FORM_ID}
          disabled={isSubmitting}
        />
      </SheetToolbar>

      <SheetBody>
        <form
          id={CREATE_FORM_ID}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <TextField
            label="Slug"
            placeholder="clinica-bela"
            helperText="Vira o subdomínio. Use letras minúsculas, números e hífens."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            error={errors.slug?.message ?? null}
            required
            {...register('slug')}
          />
          <TextField
            label="Nome"
            placeholder="Clínica Bela"
            helperText="Rótulo curto exibido na sidebar e cabeçalho."
            error={errors.name?.message ?? null}
            required
            {...register('name')}
          />
          <TextField
            label="Razão social"
            placeholder="Clínica Bela Estética LTDA"
            helperText="Nome jurídico — usado em contratos e recibos."
            error={errors.legalName?.message ?? null}
            {...register('legalName')}
          />
          <TextField
            label="Nome fantasia"
            placeholder="Clínica Bela"
            error={errors.tradeName?.message ?? null}
            {...register('tradeName')}
          />
          <MaskedField
            control={control}
            name="document"
            mask="cnpj"
            label="CNPJ"
            placeholder="00.000.000/0000-00"
            error={errors.document?.message ?? null}
          />
          <TextField
            label="Representante legal"
            placeholder="Maria Souza"
            autoComplete="name"
            error={errors.representativeName?.message ?? null}
            {...register('representativeName')}
          />
          <p className="rounded-md border border-input/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            O logo do tenant é adicionado após a criação — abra o cadastro em
            modo edição pra fazer upload.
          </p>
          <SkipEvaluationField
            checked={skipEvaluation}
            onChange={(v) => setValue('skipEvaluation', v)}
          />

          <AgentSection
            agentEnabled={agentEnabled}
            onAgentEnabledChange={(v) => setValue('agentEnabled', v)}
            register={register}
            errors={errors}
          />

          <BusinessHoursSection
            enabled={businessHoursEnabled}
            onEnabledChange={(v) => setValue('businessHoursEnabled', v)}
            timezone={watch('businessHoursTimezone')}
            onTimezoneChange={(v) => setValue('businessHoursTimezone', v)}
            days={businessHoursDays}
            onDayChange={(idx, patch) =>
              setValue(`businessHoursDays.${idx}`, {
                ...businessHoursDays[idx],
                ...patch,
              })
            }
            errors={errors}
          />
        </form>
      </SheetBody>
    </SheetContainer>
  )
}

interface EditFormProps {
  tenantId: string
  onDone: () => void
  onCancel: () => void
}

function EditForm({ tenantId, onDone, onCancel }: EditFormProps): React.ReactElement {
  const tenantQuery = useTenant(tenantId)
  const updateMutation = useUpdateTenant()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: '',
      legalName: '',
      tradeName: '',
      document: '',
      representativeName: '',
      skipEvaluation: false,
      agentEnabled: false,
      agentIdleMinutes: 15,
      agentPersona: '',
      businessHoursEnabled: false,
      businessHoursTimezone: DEFAULT_TIMEZONE,
      businessHoursDays: emptyBusinessHoursDays(),
    },
  })

  const skipEvaluation = watch('skipEvaluation')
  const agentEnabled = watch('agentEnabled')
  const businessHoursEnabled = watch('businessHoursEnabled')
  const businessHoursDays = watch('businessHoursDays')

  // Hidrata o form quando o detalhe chega. reset() sem dirtying — depois
  // disso, isDirty reflete edições reais do usuário.
  useEffect(() => {
    if (tenantQuery.data) {
      reset({
        name: tenantQuery.data.name,
        legalName: tenantQuery.data.legalName ?? '',
        tradeName: tenantQuery.data.tradeName ?? '',
        document: tenantQuery.data.document ?? '',
        representativeName: tenantQuery.data.representativeName ?? '',
        skipEvaluation: tenantQuery.data.skipEvaluation,
        agentEnabled: tenantQuery.data.agentEnabled,
        agentIdleMinutes: tenantQuery.data.agentIdleMinutes,
        agentPersona: tenantQuery.data.agentPersona ?? '',
        businessHoursEnabled: tenantQuery.data.businessHours !== null,
        businessHoursTimezone:
          tenantQuery.data.businessHours?.timezone ?? DEFAULT_TIMEZONE,
        businessHoursDays: hydrateBusinessHoursDays(
          tenantQuery.data.businessHours,
        ),
      })
    }
  }, [tenantQuery.data, reset])

  const onSubmit = handleSubmit(async (data) => {
    if (!isDirty) {
      onDone()
      return
    }
    try {
      await updateMutation.mutateAsync({
        id: tenantId,
        input: {
          name: data.name,
          legalName: emptyToNull(data.legalName),
          tradeName: emptyToNull(data.tradeName),
          document: emptyToNull(data.document),
          representativeName: emptyToNull(data.representativeName),
          skipEvaluation: data.skipEvaluation,
          agentEnabled: data.agentEnabled,
          agentIdleMinutes: data.agentIdleMinutes,
          agentPersona: emptyToNull(data.agentPersona),
          businessHours: serializeBusinessHours(
            data.businessHoursEnabled,
            data.businessHoursTimezone,
            data.businessHoursDays,
          ),
        },
      })
      toast.success('Tenant atualizado')
      onDone()
    } catch (err) {
      handleMutationError(err, 'atualizar')
    }
  })

  if (tenantQuery.isLoading) {
    return (
      <SheetContainer>
        <SheetToolbar srTitle="Editar tenant">
          <SheetToolbar.Action
            label="Cancelar"
            variant="ghost"
            onClick={onCancel}
          />
        </SheetToolbar>
        <SheetBody>
          <div className="text-sm text-muted-foreground">Carregando tenant…</div>
        </SheetBody>
      </SheetContainer>
    )
  }

  if (tenantQuery.isError || !tenantQuery.data) {
    return (
      <SheetContainer>
        <SheetToolbar srTitle="Editar tenant">
          <SheetToolbar.Action
            label="Cancelar"
            variant="ghost"
            onClick={onCancel}
          />
        </SheetToolbar>
        <SheetBody>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-error">Erro ao carregar tenant.</p>
            <Button type="button" variant="outline" onClick={() => tenantQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </SheetBody>
      </SheetContainer>
    )
  }

  return (
    <SheetContainer>
      <SheetToolbar srTitle="Editar tenant">
        <SheetToolbar.Action
          label="Cancelar"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        />
        <SheetToolbar.Action
          label={isSubmitting ? 'Salvando…' : 'Salvar'}
          type="submit"
          form={EDIT_FORM_ID}
          disabled={isSubmitting}
        />
      </SheetToolbar>

      <SheetBody>
        <form
          id={EDIT_FORM_ID}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <TextField
            label="Slug"
            defaultValue={tenantQuery.data.slug}
            disabled
            helperText="Imutável — o slug está embutido no subdomínio e nos JWTs ativos."
          />
          <TextField
            label="Nome"
            helperText="Rótulo curto exibido na sidebar e cabeçalho."
            error={errors.name?.message ?? null}
            required
            {...register('name')}
          />
          <TextField
            label="Razão social"
            placeholder="Clínica Bela Estética LTDA"
            helperText="Nome jurídico — usado em contratos e recibos."
            error={errors.legalName?.message ?? null}
            {...register('legalName')}
          />
          <TextField
            label="Nome fantasia"
            placeholder="Clínica Bela"
            error={errors.tradeName?.message ?? null}
            {...register('tradeName')}
          />
          <MaskedField
            control={control}
            name="document"
            mask="cnpj"
            label="CNPJ"
            placeholder="00.000.000/0000-00"
            error={errors.document?.message ?? null}
          />
          <TextField
            label="Representante legal"
            placeholder="Maria Souza"
            autoComplete="name"
            error={errors.representativeName?.message ?? null}
            {...register('representativeName')}
          />
          <LogoUploader
            tenantId={tenantId}
            hasLogo={Boolean(tenantQuery.data.logoUrl)}
          />
          <SkipEvaluationField
            checked={skipEvaluation}
            onChange={(v) => setValue('skipEvaluation', v, { shouldDirty: true })}
          />

          <AgentSection
            agentEnabled={agentEnabled}
            onAgentEnabledChange={(v) =>
              setValue('agentEnabled', v, { shouldDirty: true })
            }
            register={register}
            errors={errors}
          />

          <BusinessHoursSection
            enabled={businessHoursEnabled}
            onEnabledChange={(v) =>
              setValue('businessHoursEnabled', v, { shouldDirty: true })
            }
            timezone={watch('businessHoursTimezone')}
            onTimezoneChange={(v) =>
              setValue('businessHoursTimezone', v, { shouldDirty: true })
            }
            days={businessHoursDays}
            onDayChange={(idx, patch) =>
              setValue(
                `businessHoursDays.${idx}`,
                { ...businessHoursDays[idx], ...patch },
                { shouldDirty: true },
              )
            }
            errors={errors}
          />
        </form>
      </SheetBody>
    </SheetContainer>
  )
}

interface SkipEvaluationFieldProps {
  checked: boolean
  onChange: (v: boolean) => void
}

function SkipEvaluationField({
  checked,
  onChange,
}: SkipEvaluationFieldProps): React.ReactElement {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
        id="tenant-skip-evaluation"
      />
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">Pular etapa de avaliação</span>
        <span className="text-xs text-muted-foreground">
          Jornadas deste tenant podem ir direto pra orçamento, sem passar por
          avaliação.
        </span>
      </div>
    </label>
  )
}

// =====================================================================
// AgentSection — bloco do agente de IA (V1, ver
// docs/ai-agent-implementation.md). Gate principal é `agentEnabled`;
// idle minutes e persona ficam visíveis sempre pra deixar config pronta
// antes de ligar.
// =====================================================================

// `register/errors` tipados como `any`: o subcomponente serve CreateValues
// e EditValues e os tipos do RHF são invariantes — generic real exigiria
// cast no call site sem ganho de segurança. Os paths usados são literais.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRegister = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyErrors = any

interface AgentSectionProps {
  agentEnabled: boolean
  onAgentEnabledChange: (v: boolean) => void
  register: AnyRegister
  errors: AnyErrors
}

function AgentSection({
  agentEnabled,
  onAgentEnabledChange,
  register,
  errors,
}: AgentSectionProps): React.ReactElement {
  const idleError = errors.agentIdleMinutes?.message as string | undefined
  const personaError = errors.agentPersona?.message as string | undefined

  return (
    <section className="flex flex-col gap-3 rounded-md border border-input p-3">
      <header className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Agente de IA</span>
        <span className="text-xs text-muted-foreground">
          Sujeito ao kill switch global do ambiente. Desligado por default
          em tenants novos.
        </span>
      </header>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={agentEnabled}
          onCheckedChange={(v) => onAgentEnabledChange(v === true)}
          className="mt-0.5"
          id="tenant-agent-enabled"
        />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Ativar agente</span>
          <span className="text-xs text-muted-foreground">
            Quando ligado, o agente assume conversas após o tempo de
            inatividade configurado.
          </span>
        </div>
      </label>

      <TextField
        type="number"
        label="Minutos de inatividade"
        helperText="Tempo sem resposta humana antes do agente entrar na conversa (1-1440)."
        error={idleError ?? null}
        min={1}
        max={1440}
        required
        {...register('agentIdleMinutes', { valueAsNumber: true })}
      />

      <TextArea
        id="tenant-agent-persona"
        label="Persona do agente"
        rows={4}
        placeholder="Tom informal e próximo, sem jargão técnico."
        error={personaError}
        helperText="Entra no system prompt. Em branco usa o tom padrão."
        {...register('agentPersona')}
      />
    </section>
  )
}

// =====================================================================
// BusinessHoursSection — horário de funcionamento. Quando desligado,
// salva null no DB (= "agente não sabe o horário, nunca dispara fora").
// Quando ligado: timezone + grid de 7 dias com toggle por dia + open/close.
// =====================================================================

interface BusinessHoursSectionProps {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  timezone: string
  onTimezoneChange: (v: string) => void
  days: BusinessHoursDayForm[]
  onDayChange: (idx: number, patch: Partial<BusinessHoursDayForm>) => void
  errors: AnyErrors
}

function BusinessHoursSection({
  enabled,
  onEnabledChange,
  timezone,
  onTimezoneChange,
  days,
  onDayChange,
  errors,
}: BusinessHoursSectionProps): React.ReactElement {
  const daysErrors = errors.businessHoursDays as
    | Array<{ open?: { message?: string }; close?: { message?: string } } | undefined>
    | undefined

  return (
    <section className="flex flex-col gap-3 rounded-md border border-input p-3">
      <header className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Horário de funcionamento</span>
        <span className="text-xs text-muted-foreground">
          Usado pelo agente pra decidir quando responder fora de hora e pra
          tool getBusinessHours.
        </span>
      </header>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => onEnabledChange(v === true)}
          className="mt-0.5"
          id="tenant-business-hours-enabled"
        />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Definir horário</span>
          <span className="text-xs text-muted-foreground">
            Sem horário definido, o agente assume "sempre aberto" pra
            disparar.
          </span>
        </div>
      </label>

      {enabled && (
        <>
          <SelectField
            id="tenant-business-hours-timezone"
            label="Fuso horário"
            value={timezone}
            onValueChange={onTimezoneChange}
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectField>

          <div className="flex flex-col gap-1.5">
            {DAY_LABELS.map((label, idx) => {
              const day = days[idx]
              const dayError = daysErrors?.[idx]
              const dayHasError = Boolean(dayError?.open?.message ?? dayError?.close?.message)
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-md border border-input/60 px-2 py-1.5"
                >
                  <Checkbox
                    checked={day.enabled}
                    onCheckedChange={(v) =>
                      onDayChange(idx, { enabled: v === true })
                    }
                    id={`tenant-bh-day-${idx}`}
                  />
                  <label
                    htmlFor={`tenant-bh-day-${idx}`}
                    className="w-20 shrink-0 cursor-pointer text-sm"
                  >
                    {label}
                  </label>
                  {/* eslint-disable-next-line no-restricted-syntax -- input compacto na grade de horários (linha por dia) */}
                  <input
                    type="time"
                    aria-label={`${label} abre`}
                    value={day.open}
                    onChange={(e) => onDayChange(idx, { open: e.target.value })}
                    disabled={!day.enabled}
                    className={cn(
                      'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      dayHasError && 'border-destructive',
                    )}
                  />
                  <span className="text-xs text-muted-foreground">às</span>
                  {/* eslint-disable-next-line no-restricted-syntax -- input compacto na grade de horários (linha por dia) */}
                  <input
                    type="time"
                    aria-label={`${label} fecha`}
                    value={day.close}
                    onChange={(e) => onDayChange(idx, { close: e.target.value })}
                    disabled={!day.enabled}
                    className={cn(
                      'h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      dayHasError && 'border-destructive',
                    )}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

// =====================================================================
// LogoUploader — bloco out-of-band do form. Upload/delete falam com
// endpoints dedicados (POST/DELETE /tenants/:id/logo) e persistem
// direto — NÃO participa do isDirty/submit do form principal. Preview
// usa presigned URL (GET /tenants/:id/logo-url) com cache curto.
//
// Aparece SÓ na edição. No create form, o tenant ainda não existe.
// =====================================================================

interface LogoUploaderProps {
  tenantId: string
  hasLogo: boolean
}

// Aceita PNG/JPEG/WebP — casado com allow-list do backend
// (TenantLogoStorage). SVG omitido de propósito (risco XSS).
const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const ALLOWED_LOGO_ACCEPT = ALLOWED_LOGO_MIMES.join(',')
const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024

function LogoUploader({
  tenantId,
  hasLogo,
}: LogoUploaderProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const logoUrlQuery = useTenantLogoUrl(hasLogo ? tenantId : undefined)
  const uploadMutation = useUploadTenantLogo()
  const deleteMutation = useDeleteTenantLogo()

  const isBusy = uploadMutation.isPending || deleteMutation.isPending

  const onPick = (): void => {
    inputRef.current?.click()
  }

  const onFileChange = async (
    evt: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    setLocalError(null)
    const file = evt.target.files?.[0]
    // Zera o input pra permitir escolher o mesmo arquivo de novo depois
    // de um erro; sem isso, `change` não dispara na 2ª seleção.
    evt.target.value = ''
    if (!file) return
    if (!ALLOWED_LOGO_MIMES.includes(file.type)) {
      setLocalError('Formato não suportado. Use PNG, JPEG ou WebP.')
      return
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      setLocalError('Arquivo maior que 5MB.')
      return
    }
    try {
      await uploadMutation.mutateAsync({ id: tenantId, file })
      toast.success('Logo atualizado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao enviar logo. Tente novamente.')
    }
  }

  const onRemove = async (): Promise<void> => {
    setLocalError(null)
    try {
      await deleteMutation.mutateAsync(tenantId)
      toast.success('Logo removido')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao remover logo. Tente novamente.')
    }
  }

  const previewUrl = hasLogo ? logoUrlQuery.data?.url ?? null : null

  return (
    <section className="flex flex-col gap-3 rounded-md border border-input p-3">
      <header className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Logo</span>
        <span className="text-xs text-muted-foreground">
          PNG, JPEG ou WebP. Máximo 5MB. Upload/remoção são salvos na hora.
        </span>
      </header>

      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input/60 bg-muted/40">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Logo do tenant"
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Sem logo
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_LOGO_ACCEPT}
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPick}
            disabled={isBusy}
          >
            {uploadMutation.isPending
              ? 'Enviando…'
              : hasLogo
                ? 'Trocar arquivo'
                : 'Enviar arquivo'}
          </Button>
          {hasLogo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={isBusy}
            >
              {deleteMutation.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          )}
        </div>
      </div>

      {localError && (
        <p className="text-xs text-destructive" role="alert">
          {localError}
        </p>
      )}
    </section>
  )
}

function handleMutationError(err: unknown, verb: string): void {
  const status = (err as { response?: { status?: number } })?.response?.status
  const message =
    apiErrorText(err)
  if (status === 409) {
    toast.error(message ?? 'Já existe um tenant com este slug')
  } else if (status === 400) {
    toast.error(message ?? 'Dados inválidos')
  } else {
    toast.error(`Erro ao ${verb} tenant. Tente novamente.`)
  }
}

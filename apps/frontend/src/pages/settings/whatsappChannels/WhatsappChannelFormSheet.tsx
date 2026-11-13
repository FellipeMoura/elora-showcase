import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { TextField } from '@/components/form/TextField'
import { Label } from '@/components/ui/label'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateWhatsappChannel,
  useUpdateWhatsappChannel,
} from '@/hooks/useWhatsappChannels'
import type { WhatsappChannel } from '@/api/whatsappChannels'
import { apiErrorText } from '@/lib/apiError'

// Form leniente — o que vai pro backend é montado no submit a partir
// destes campos. providerConfig fica oculto na UI: criação sempre começa
// com `{}` (admin provisiona depois no fluxo de conexão); edição preserva
// o config existente. Mock channels não devem ser editados aqui — a UI
// principal não oferece o botão.
const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  providerType: z.enum(['baileys', 'meta_cloud']),
  phoneRaw: z.string().trim().max(32),
  // Hex `#RRGGBB` ou vazio (sem cor). Aceita maiúscula/minúscula.
  color: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v),
      'Cor deve ser hex no formato #RRGGBB',
    ),
})

type FormValues = z.infer<typeof formSchema>

const PROVIDER_OPTIONS = [
  { value: 'baileys' as const, label: 'Baileys (WhatsApp Web)' },
  { value: 'meta_cloud' as const, label: 'Meta Cloud' },
]

interface WhatsappChannelFormSheetProps {
  open: boolean
  // null = criar novo. WhatsappChannel = editar.
  channel: WhatsappChannel | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'whatsapp-channel-form'
const emptyValues: FormValues = {
  name: '',
  providerType: 'baileys',
  phoneRaw: '',
  color: '',
}

function valuesFromChannel(channel: WhatsappChannel | null): FormValues {
  if (!channel) return emptyValues
  return {
    name: channel.name,
    providerType: channel.providerType,
    phoneRaw: channel.phoneNumber ?? '',
    color: channel.color ?? '',
  }
}

export function WhatsappChannelFormSheet({
  open,
  channel,
  onOpenChange,
}: WhatsappChannelFormSheetProps): React.ReactElement {
  const isEdit = Boolean(channel)
  const navigate = useNavigate()
  const createMutation = useCreateWhatsappChannel()
  const updateMutation = useUpdateWhatsappChannel()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  useEffect(() => {
    if (open) {
      reset(valuesFromChannel(channel))
    }
  }, [open, channel, reset])

  const providerType = watch('providerType')

  const onSubmit = handleSubmit(async (data) => {
    const phoneNumber = data.phoneRaw.trim() || undefined
    const color = data.color.trim() || undefined

    try {
      if (isEdit && channel) {
        await updateMutation.mutateAsync({
          id: channel.id,
          input: {
            name: data.name,
            providerType: data.providerType,
            phoneNumber: phoneNumber ?? null,
            // Vazio no form = limpar a cor (null no backend).
            color: color ?? null,
          },
        })
        toast.success('Canal atualizado')
      } else {
        const created = await createMutation.mutateAsync({
          name: data.name,
          providerType: data.providerType,
          providerConfig: {},
          phoneNumber,
          color,
        })
        toast.success('Canal criado')
        // Vai direto pro detail — o sheet de provisionamento abre lá
        // automaticamente porque o canal acabou de nascer não-provisionado.
        onOpenChange(false)
        navigate(`/settings/whatsapp-channels/${created.id}`)
        return
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(message ?? 'Conflito ao salvar canal')
      } else if (status === 400) {
        toast.error(message ?? 'Dados inválidos')
      } else {
        toast.error('Erro ao salvar canal. Tente novamente.')
      }
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar canal' : 'Novo canal'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form
              id={FORM_ID}
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
              <TextField
                label="Nome"
                placeholder="WhatsApp Recepção"
                helperText="Nome interno do canal — fica visível pra equipe."
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />

              <div className="flex flex-col gap-1.5">
                <Label>Tipo de provider</Label>
                <ButtonGroup
                  value={providerType}
                  onChange={(v) =>
                    setValue('providerType', v, { shouldDirty: true })
                  }
                  options={PROVIDER_OPTIONS}
                  aria-label="Tipo de provider"
                />
                <p className="text-xs text-muted-foreground">
                  {providerType === 'baileys'
                    ? 'Não-oficial via QR. Sem custo por mensagem, risco de banimento mitigado pelas disciplinas internas.'
                    : 'Oficial via Meta Cloud API. Custo por conversa, exige Business Verification.'}
                </p>
              </div>

              <TextField
                label="Telefone (opcional)"
                placeholder="+55 11 99999-9999"
                autoComplete="tel"
                helperText="E.164 ou apenas dígitos. Pode ser preenchido depois do pareamento."
                error={errors.phoneRaw?.message ?? null}
                {...register('phoneRaw')}
              />

              <ColorField
                value={watch('color')}
                onChange={(v) => setValue('color', v, { shouldDirty: true })}
                error={errors.color?.message ?? null}
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

// Picker de cor — `<input type="color">` nativo é o caminho mais direto.
// Damos uma palette de atalhos pra escolhas comuns e um botão "Limpar" pra
// devolver ao default (color=null no backend).
const PRESET_COLORS = [
  '#25D366', // verde WhatsApp
  '#128C7E', // verde teal
  '#34B7F1', // azul WhatsApp
  '#7C3AED', // roxo
  '#F59E0B', // âmbar
  '#EF4444', // vermelho
  '#EC4899', // rosa
  '#0EA5E9', // sky
] as const

function ColorField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error: string | null
}): React.ReactElement {
  const isEmpty = value === ''
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="channel-color">Cor de destaque</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="channel-color"
          type="color"
          value={isEmpty ? '#25D366' : value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background p-0.5"
          aria-label="Escolher cor"
        />
        <div className="flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="size-6 rounded border border-input transition-transform hover:scale-110"
              style={{ backgroundColor: c }}
              aria-label={`Selecionar ${c}`}
              title={c}
            />
          ))}
        </div>
        {!isEmpty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange('')}
          >
            Limpar
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Aparece como destaque nas conversas deste canal (cards minimizados e
        janela flutuante). Deixe vazio pra usar a cor padrão.
      </p>
      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

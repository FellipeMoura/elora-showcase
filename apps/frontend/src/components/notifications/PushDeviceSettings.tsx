import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BellRing, Share, SquarePlus } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from '@/lib/pushNotifications'

// =====================================================================
// Liga/desliga a notificação do sistema (push) NESTE aparelho. Vale por
// navegador/celular, independente do nível in-app (Discreto/Médio/
// Agressivo). Estados especiais têm instrução em vez de switch:
//   - iPhone no Safari: precisa "Adicionar à Tela de Início" antes;
//   - permissão bloqueada: só o usuário libera, nas configs do navegador.
// =====================================================================
export function PushDeviceSettings(): React.ReactElement {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void getPushState().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

  // O pedido de permissão tem que sair direto do clique (exigência do iOS).
  const handleToggle = async (checked: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = checked ? await enablePush() : await disablePush()
      setState(next)
      if (checked && next === 'enabled') toast.success('Notificações ativadas neste aparelho')
      if (checked && next === 'denied') toast.error('Permissão de notificação bloqueada')
      if (!checked) toast.success('Notificações desativadas neste aparelho')
    } catch {
      toast.error('Não foi possível alterar as notificações. Tente novamente.')
      setState(await getPushState())
    } finally {
      setBusy(false)
    }
  }

  if (state === null) {
    return <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
  }

  if (state === 'ios-needs-install') {
    return (
      <div className="space-y-2 p-4 text-sm">
        <p className="font-medium">No iPhone, instale o Elora primeiro</p>
        <ol className="space-y-1.5 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            1. Toque em <Share className="inline size-4" aria-label="Compartilhar" /> no Safari
          </li>
          <li className="flex items-center gap-1.5">
            2. Escolha <SquarePlus className="inline size-4" aria-hidden />
            <span className="font-medium text-foreground">Adicionar à Tela de Início</span>
          </li>
          <li>3. Abra o Elora pelo ícone e volte aqui pra ativar.</li>
        </ol>
      </div>
    )
  }

  if (state === 'unsupported') {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Este navegador não suporta notificações. Use Chrome, Edge, Firefox ou Safari atualizados.
      </p>
    )
  }

  return (
    <div className="flex items-start gap-3 p-4">
      <BellRing className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <label htmlFor="push-device" className="text-sm font-medium">
          Avisar neste aparelho
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {state === 'denied'
            ? 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ícone de cadeado ao lado do endereço) e recarregue a página.'
            : 'Notificação do sistema quando chegar mensagem e o Elora não estiver na sua frente, mesmo com o app fechado.'}
        </p>
      </div>
      <Switch
        id="push-device"
        checked={state === 'enabled'}
        disabled={busy || state === 'denied'}
        onCheckedChange={(checked) => void handleToggle(checked)}
      />
    </div>
  )
}

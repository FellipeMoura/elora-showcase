import { useState } from 'react'
import { useContactProfilePictureUrl } from '@/hooks/useWhatsappContacts'
import { cn } from '@/lib/utils'

interface ContactAvatarProps {
  // ID do whatsapp_contact (Conversation.whatsappContactId). Null quando
  // contato não foi resolvido (caso raro de conv sem inbound prévio) ou
  // quando o caller só conhece dados do cliente.
  contactId: string | null | undefined
  // Nome (qualquer string) usado pra extrair a inicial do fallback.
  name: string
  // ID estável (clientId, contactId) usado pra picar uma cor da paleta.
  // Mesmo id → mesma cor entre renders/sessões.
  colorSeed: string
  // Lado do quadrado, em px. Default 40 (size-10 no Tailwind).
  size?: number
  className?: string
  // Mostra a inicial mesmo sem chamar a API. Útil pra listagem inicial onde
  // o usuário ainda não confirmou que quer ver fotos (otimização opcional).
  // Default true: lazy fetch só dispara quando o componente monta.
  fetchEnabled?: boolean
}

// Avatar do contato WhatsApp. Tenta presigned URL via TanStack Query (lazy,
// staleTime 10min — ver useContactProfilePictureUrl); enquanto carrega ou
// se não houver foto, mostra inicial sobre cor estável da paleta.
//
// Falha de carga da imagem (URL expirada por race, contato apagou foto
// entre fetch e render) cai pra inicial automaticamente via onError.
export function ContactAvatar({
  contactId,
  name,
  colorSeed,
  size = 40,
  className,
  fetchEnabled = true,
}: ContactAvatarProps): React.ReactElement {
  const enabled = fetchEnabled && Boolean(contactId)
  const { data } = useContactProfilePictureUrl(enabled ? contactId : null)
  const [imageBroken, setImageBroken] = useState(false)

  const initial = name.trim().charAt(0).toUpperCase() || '?'
  const url = !imageBroken && data?.url ? data.url : null

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-chat-accent-foreground',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: url ? undefined : avatarColorFromId(colorSeed),
        // Font-size proporcional ao quadrado — initial preenche bem em
        // qualquer tamanho (32px, 40px, 56px, etc).
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden
    >
      {url ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setImageBroken(true)}
        />
      ) : (
        initial
      )}
    </div>
  )
}

// Paleta canônica + hash estável. Mesmo helper que ChatSidebarItem usava
// inline; centralizado aqui pra que todos os avatares (sidebar, header,
// minimized card) usem a mesma cor pro mesmo cliente.
const AVATAR_PALETTE = [
  '#0ea5e9', // sky-500
  '#14b8a6', // teal-500
  '#22c55e', // green-500
  '#eab308', // yellow-500
  '#f97316', // orange-500
  '#ef4444', // red-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
]

function avatarColorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0]!
}

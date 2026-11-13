import * as LucideIcons from 'lucide-react'
import type { LucideProps } from 'lucide-react'

// Renderiza um ícone do lucide-react a partir do nome em string. O backend
// guarda `menus.icon` como string portável (sem amarrar a tabela à lib);
// o frontend resolve aqui. Aceita tanto kebab-case ('user-cog') quanto já
// PascalCase ('UserCog') — converte pro nome do export do pacote.
//
// Quando o ícone não existe, faz `console.warn` e cai pro AlertCircle pra
// o slot ficar visualmente preenchido (não some sem aviso).

interface LucideIconProps extends Omit<LucideProps, 'ref'> {
  icon: string
}

// 'user-cog' → 'UserCog', 'calendar-days' → 'CalendarDays', 'users' → 'Users'.
function toPascalCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

type IconMap = Record<string, React.ComponentType<LucideProps>>

const LucideIcon: React.FC<LucideIconProps> = ({
  icon,
  size = 24,
  color = 'currentColor',
  className,
  ...rest
}) => {
  const iconName = toPascalCase(icon)
  const IconComponent = (LucideIcons as unknown as IconMap)[iconName]

  if (!IconComponent) {
    console.warn(
      `Icon "${icon}" não encontrado no lucide-react — usando AlertCircle.`,
    )
    return (
      <LucideIcons.AlertCircle
        size={size}
        color={color}
        className={className}
        {...rest}
      />
    )
  }

  return (
    <IconComponent
      size={size}
      color={color}
      className={className}
      {...rest}
    />
  )
}

export default LucideIcon

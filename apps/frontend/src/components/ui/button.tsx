import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // `default` = `primary`. Mantido como variant explícito porque
        // CVA exige um valor default e pra preservar `<Button>` (sem prop)
        // como CTA primário — caso de uso mais comum.
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        tertiary:
          'bg-tertiary text-tertiary-foreground hover:bg-tertiary/80',
        info: 'bg-info text-info-foreground hover:bg-info/90',
        success: 'bg-success text-success-foreground hover:bg-success/90',
        warning: 'bg-warning text-warning-foreground hover:bg-warning/90',
        error: 'bg-error text-error-foreground hover:bg-error/90',
        // Alias de `error` — código antigo do shadcn usa `destructive`.
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // Estilos (não-categorias): cor herda do contexto.
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

// Envolve nós de texto direto em span truncável — permite o texto encolher
// com ellipsis quando o botão está apertado em um pai flex. Ícones e demais
// elementos ficam intactos (svg herda `shrink-0` do variant).
// Não se aplica quando `asChild`: o Slot passa através, então quem estende
// (ex: `<Button asChild><Link>...</Link>`) fica responsável pelo truncate.
const wrapTextChildren = (children: React.ReactNode) =>
  React.Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? (
      <span className="min-w-0 truncate">{child}</span>
    ) : (
      child
    ),
  )

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {asChild ? children : wrapTextChildren(children)}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
export type { ButtonProps }

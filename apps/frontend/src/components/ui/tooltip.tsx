import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

// Wrapper shadcn-style do Radix Tooltip. Uso típico:
//
//   <Tooltip>
//     <TooltipTrigger asChild>
//       <Button>...</Button>
//     </TooltipTrigger>
//     <TooltipContent>Texto</TooltipContent>
//   </Tooltip>
//
// O <TooltipProvider> mora no App.tsx (envolve toda a árvore) — não
// precisa instanciar localmente. delayDuration=300 dá feedback rápido
// sem disparar acidentalmente em hovers passantes.

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-popover overflow-hidden rounded-md border border-border bg-popover px-2 py-1 text-xs',
        'text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

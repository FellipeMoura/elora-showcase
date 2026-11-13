import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn = "class names". Combina clsx (condicionais) com tailwind-merge
// (resolve conflitos como "px-2 px-4" → "px-4"). É o helper canônico
// do shadcn — todo componente UI usa.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

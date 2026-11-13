import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PERIOD_OPTIONS, type Period } from '@/hooks/usePeriodFilter'
import { displayIsoDate } from '@/lib/format'
import { cn } from '@/lib/utils'

// Filtro de período universal — usado pelo dashboard e por relatórios que
// aceitam range. Select com 9 presets; "Personalizado" abre popover com
// inputs De/Até.
//
// **Pure UI** — não toca em URL nem em estado global. Consumidor decide
// onde o estado vive (tipicamente `usePeriodFilter()` que persiste na URL)
// e re-executa as queries no `onChange`.

interface PeriodFilterProps {
  period: Period
  from?: string
  to?: string
  onChange: (next: Period, customRange?: { from: string; to: string }) => void
  // Mostra a label "DD/MM – DD/MM" do range custom à esquerda do select.
  // Útil quando a toolbar tem espaço; oculto em layouts apertados.
  showCustomRangeLabel?: boolean
  className?: string
  // Largura do Select. Default w-44 (176px) bate com dashboard.
  selectWidthClassName?: string
}

export function PeriodFilter({
  period,
  from,
  to,
  onChange,
  showCustomRangeLabel = true,
  className,
  selectWidthClassName = 'w-44',
}: PeriodFilterProps): React.ReactElement {
  const [customOpen, setCustomOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from ?? '')
  const [draftTo, setDraftTo] = useState(to ?? '')

  function handleSelect(next: Period): void {
    if (next === 'custom') {
      // Semeia os inputs com o range atual e abre o popover.
      setDraftFrom(from ?? '')
      setDraftTo(to ?? '')
      setCustomOpen(true)
      return
    }
    onChange(next)
  }

  const customValid = Boolean(draftFrom && draftTo && draftFrom <= draftTo)

  function applyCustom(): void {
    if (!customValid) return
    onChange('custom', { from: draftFrom, to: draftTo })
    setCustomOpen(false)
  }

  const hasCustomRange = period === 'custom' && from && to

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {showCustomRangeLabel && hasCustomRange && (
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {displayIsoDate(from)} – {displayIsoDate(to)}
        </span>
      )}

      <Popover open={customOpen} onOpenChange={setCustomOpen}>
        {/* Anchor (não Trigger) pra popover só POSICIONAR ao lado do Select
            sem capturar o clique — quem abre é handleSelect('custom'). */}
        <PopoverAnchor asChild>
          <div className={selectWidthClassName}>
            <Select
              value={period}
              onValueChange={(v) => handleSelect(v as Period)}
            >
              <SelectTrigger aria-label="Período">
                <CalendarRange className="h-4 w-4 opacity-70" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverAnchor>

        <PopoverContent align="end" className="w-72 space-y-3 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="period-filter-from">De</Label>
            <Input
              id="period-filter-from"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="period-filter-to">Até</Label>
            <Input
              id="period-filter-to"
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            size="sm"
            disabled={!customValid}
            onClick={applyCustom}
          >
            Aplicar
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MiniCalendarProps {
  selectedDate: Date
  onSelect: (d: Date) => void
  // Quando true, destaca a linha inteira da semana do selectedDate.
  weekMode?: boolean
}

const WEEKDAY_HEADERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfWeek(d: Date): Date {
  // Domingo=0 como início da semana (alinha com cabeçalho).
  const result = new Date(d)
  result.setDate(d.getDate() - d.getDay())
  result.setHours(0, 0, 0, 0)
  return result
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isSameWeek(a: Date, b: Date): boolean {
  return isSameDay(startOfWeek(a), startOfWeek(b))
}

interface GridCell {
  date: Date
  inCurrentMonth: boolean
}

function buildMonthGrid(focusDate: Date): GridCell[] {
  // 6 rows × 7 cols = 42 cells.
  const first = startOfMonth(focusDate)
  const gridStart = startOfWeek(first)
  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push({ date: d, inCurrentMonth: d.getMonth() === focusDate.getMonth() })
  }
  return cells
}

export function MiniCalendar({
  selectedDate,
  onSelect,
  weekMode = false,
}: MiniCalendarProps): React.ReactElement {
  // Mês visível pode divergir do selectedDate (user navegando antes de
  // escolher). Inicializa com mês do selectedDate.
  const [viewDate, setViewDate] = useState<Date>(() => startOfMonth(selectedDate))

  const cells = useMemo(() => buildMonthGrid(viewDate), [viewDate])
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const goPrev = () => {
    const d = new Date(viewDate)
    d.setMonth(d.getMonth() - 1)
    setViewDate(d)
  }
  const goNext = () => {
    const d = new Date(viewDate)
    d.setMonth(d.getMonth() + 1)
    setViewDate(d)
  }
  const goToday = () => {
    setViewDate(startOfMonth(new Date()))
    onSelect(new Date())
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <header className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={goPrev}
          aria-label="Mês anterior"
          className="rounded p-1 hover:bg-accent/40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium tabular-nums">
          {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </span>
        <button
          type="button"
          onClick={goNext}
          aria-label="Próximo mês"
          className="rounded p-1 hover:bg-accent/40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-muted-foreground">
        {WEEKDAY_HEADERS.map((h, i) => (
          <span key={i} className="font-medium">
            {h}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((cell) => {
          const isSelected = isSameDay(cell.date, selectedDate)
          const isToday = isSameDay(cell.date, today)
          const inWeek =
            weekMode && isSameWeek(cell.date, selectedDate) && !isSelected
          return (
            <button
              key={cell.date.toISOString()}
              type="button"
              onClick={() => onSelect(cell.date)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded text-[11px] tabular-nums transition-colors',
                !cell.inCurrentMonth && 'text-muted-foreground/50',
                cell.inCurrentMonth && 'text-foreground',
                isToday && !isSelected && 'font-semibold underline',
                inWeek && 'bg-primary/15 text-primary',
                isSelected && 'bg-primary text-primary-foreground font-medium',
                !isSelected && 'hover:bg-accent/40',
              )}
            >
              {cell.date.getDate()}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={goToday}
        className="mt-1 rounded border border-input px-2 py-1 text-xs hover:bg-accent/30"
      >
        Hoje
      </button>
    </div>
  )
}

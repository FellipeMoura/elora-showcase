// Helpers de formatação compartilhados pela UI. Sem dependência de libs
// externas pra manter bundle leve.

// =====================================================================
// Telefone
// =====================================================================

// Normaliza entrada do usuário pra E.164. Mantém leniente:
// - Já em E.164 (`+55...`): só limpa caracteres não-digitais depois do `+`.
// - Sem `+` mas começando com `55`: prepende `+`.
// - Sem `+` e sem `55`: assume Brasil e prepende `+55`.
// Strings vazias retornam `''` pra evitar emitir `+55` solto pro backend.
export function normalizePhoneE164(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length === 0 ? '' : `+${digits}`
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.startsWith('55')) return `+${digits}`
  return `+55${digits}`
}

// Apresenta um E.164 brasileiro como `+55 (11) 99999-9999`. Pra outros
// países, retorna o número sem máscara. Mantém o `+` sempre. Útil em
// listas e cabeçalhos onde a leitura humana importa.
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  if (!e164.startsWith('+55')) return e164
  const rest = e164.slice(3)
  if (rest.length === 11) {
    const dd = rest.slice(0, 2)
    const first = rest.slice(2, 7)
    const last = rest.slice(7)
    return `+55 (${dd}) ${first}-${last}`
  }
  if (rest.length === 10) {
    const dd = rest.slice(0, 2)
    const first = rest.slice(2, 6)
    const last = rest.slice(6)
    return `+55 (${dd}) ${first}-${last}`
  }
  return e164
}

// =====================================================================
// Documentos brasileiros (CPF, CNPJ, CEP)
// =====================================================================

// Mantém só dígitos — usado tanto antes de submeter (pra enviar digits-only
// ao backend) quanto antes de aplicar máscara (renderização).
export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

// Máscara CPF: 000.000.000-00 (11 dígitos).
export function formatCpf(digits: string): string {
  const d = onlyDigits(digits).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

// Máscara CNPJ: 00.000.000/0000-00 (14 dígitos).
export function formatCnpj(digits: string): string {
  const d = onlyDigits(digits).slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

// Máscara CEP: 00000-000 (8 dígitos).
export function formatCep(digits: string): string {
  const d = onlyDigits(digits).slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

// =====================================================================
// Moeda
// =====================================================================

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// Backend devolve valores monetários como string (Drizzle decimal) — formato
// '1234.56'. Aceita também number. Vazio/null vira '—' pra UI consistente.
export function displayMoney(
  v: string | number | null | undefined,
  fallback = '—',
): string {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return fallback
  return brl.format(n)
}

// =====================================================================
// Datas
// =====================================================================

// Exibe `YYYY-MM-DD` como `DD/MM/YYYY` sem montar Date (evita timezone
// shift que aconteceria em new Date('2026-05-13').toLocaleDateString).
export function displayIsoDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [, y, m, d] = match
  return `${d}/${m}/${y}`
}

// Data absoluta com hora — `DD/MM/YYYY HH:mm`. Usado em histórico clínico
// (timeline de avaliações, fichas finalizadas) onde "há 3 meses" perde
// informação útil pro profissional. Aceita ISO datetime completo.
export function displayDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const d = pad(then.getDate())
  const m = pad(then.getMonth() + 1)
  const y = then.getFullYear()
  const hh = pad(then.getHours())
  const mm = pad(then.getMinutes())
  return `${d}/${m}/${y} ${hh}:${mm}`
}

// Tempo relativo estilo WhatsApp Web pra lista de conversas:
// - <1min      → "agora"
// - <60min     → "5min"
// - mesmo dia  → "14:32"
// - dia anterior → "ontem"
// - <7 dias    → dia da semana abreviado ("seg", "qui")
// - antes      → DD/MM
//
// Não usa Intl (peso) nem date-fns/luxon (dep). KISS — recomputa em cada
// render mas é trivial.
export function displayRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return ''
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `${diffMin}min`

  // Mesmo dia: hora HH:mm
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate()
  if (sameDay) {
    const h = String(then.getHours()).padStart(2, '0')
    const m = String(then.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate()
  if (isYesterday) return 'ontem'

  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays < 7) {
    const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
    return wd[then.getDay()] ?? ''
  }

  const d = String(then.getDate()).padStart(2, '0')
  const m = String(then.getMonth() + 1).padStart(2, '0')
  return `${d}/${m}`
}

import { ilike, or, type AnyColumn, type SQL } from 'drizzle-orm';

// Busca textual case-insensitive em qualquer das colunas listadas.
// Retorna undefined se a query for vazia — combina naturalmente com `and(...)`
// do drizzle, que já ignora undefineds.
export function searchInColumns(
  query: string | undefined,
  ...columns: AnyColumn[]
): SQL | undefined {
  if (!query) return undefined;
  const pattern = `%${query}%`;
  return or(...columns.map((col) => ilike(col, pattern)));
}

import { asc, desc, type AnyColumn, type SQL } from '@elora/db';
import { z } from '../openapi/registry.js';

// =====================================================================
// Sort helper — padroniza ordenação dinâmica em endpoints paginados.
//
// 3 peças:
//   1) `createSortSpec(fields, default)` — declara a whitelist de campos
//      sortáveis (map slug → coluna Drizzle) + ordenação default.
//   2) `sortQuerySchema(spec)` — gera um schema Zod base com `sortBy` (enum
//      restrito) + `sortDir` (asc/desc), pra mesclar no schema de query
//      do endpoint via `.merge()`.
//   3) `resolveSort(query, spec)` — converte o par {sortBy, sortDir} em
//      uma expressão pronta pra `orderBy(...)` do Drizzle, aplicando o
//      default quando o cliente não informa.
//
// Segurança: o cliente NUNCA escolhe a coluna direto via string — apenas
// um dos slugs declarados. Inválido = Zod barra antes de chegar ao banco.
// =====================================================================

export type SortDirection = 'asc' | 'desc';

// `unknown` no value evita variance de InferSelectModel<typeof t> em uniões
// de specs; ainda assim o tipo das chaves é estritamente derivado.
export interface SortSpec<TFieldNames extends string> {
  fields: Record<TFieldNames, AnyColumn>;
  default: { field: TFieldNames; direction: SortDirection };
}

export function createSortSpec<TFields extends Record<string, AnyColumn>>(
  fields: TFields,
  defaultSort: { field: keyof TFields & string; direction: SortDirection }
): SortSpec<keyof TFields & string> {
  if (!fields[defaultSort.field]) {
    // Erro em tempo de carregamento do módulo — pega digitação errada
    // na declaração do spec antes de subir o servidor.
    throw new Error(
      `[createSortSpec] default field "${defaultSort.field}" não está declarado em fields`
    );
  }
  return { fields, default: defaultSort };
}

// Cria o schema base pra mesclar no query schema do endpoint:
//
//   findClientsQuerySchema = z.object({...}).merge(sortQuerySchema(spec))
//
// O resultado é um schema Zod com `sortBy: enum(<keys>).optional()` e
// `sortDir: enum(['asc','desc']).optional()`. Ambos opcionais — o default
// é aplicado em `resolveSort`.
export function sortQuerySchema<TFields extends string>(
  spec: SortSpec<TFields>
) {
  const fieldNames = Object.keys(spec.fields) as [TFields, ...TFields[]];
  return z.object({
    sortBy: z.enum(fieldNames).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  });
}

// Converte o par recebido (ou ausente) numa expressão pronta pro orderBy.
// Quando `sortBy` é fornecido sem `sortDir`, default é 'asc'.
export function resolveSort<TFields extends string>(
  query: { sortBy?: TFields; sortDir?: SortDirection },
  spec: SortSpec<TFields>
): SQL {
  const field = query.sortBy ?? spec.default.field;
  const direction =
    query.sortDir ?? (query.sortBy ? 'asc' : spec.default.direction);
  const column = spec.fields[field];
  return direction === 'desc' ? desc(column) : asc(column);
}

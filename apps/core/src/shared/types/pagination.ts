// Shape padrão de respostas paginadas em qualquer módulo.
// Use junto com z.coerce.number().int().min(1).default(1) etc. nos schemas
// Zod de query (ver findUsersQuerySchema como referência).

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function totalPagesOf(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

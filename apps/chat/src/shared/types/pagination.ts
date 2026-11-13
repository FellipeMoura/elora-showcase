// Shape padrão de respostas paginadas em qualquer módulo.

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

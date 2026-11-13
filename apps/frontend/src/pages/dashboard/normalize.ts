// Normaliza uma série pra índice 100 no primeiro valor positivo. Usado no
// Evolution Chart pra as 3 séries (leads, vendas qtd, vendas R$) — que vivem
// em ordens de grandeza diferentes — caberem no mesmo eixo Y mantendo a
// leitura de tendência. Perde valores absolutos (que o tooltip recupera).
//
// Se não há nenhum valor positivo (série toda zerada), devolve 100 em todos
// os pontos — linha reta, sem divisão por zero.
export function normalizeToIndex100(values: number[]): number[] {
  const base = values.find((v) => v > 0)
  if (!base) return values.map(() => 100)
  return values.map((v) => Math.round((v / base) * 100))
}

// Relógio único da timeline de mensagens.
//
// Problema: a timeline misturava dois relógios. Inbound era carimbado com o
// `messageTimestamp` do WhatsApp (relógio externo); outbound, com o relógio do
// host do Evolution/servidor. Com o servidor adiantado 74s em dev, uma
// resposta enviada entre duas mensagens do cliente aparecia DEPOIS da segunda.
//
// Regra: o horário da mensagem no domínio (`messages.sent_at`) é o horário em
// que ela chegou no NOSSO servidor (webhook recebido / envio confirmado). O
// timestamp do provider fica preservado na camada de transporte
// (`whatsapp_messages.sent_at`) pra auditoria.
//
// Exceção: quando o provider diz que a mensagem é bem mais antiga que a
// chegada (Evolution reconectou e despejou o atraso, fila parada), ela é
// antiga de verdade — usa o timestamp do provider pra ela cair na posição
// real. O limite fica bem acima de qualquer dessincronia de relógio razoável
// (segundos) e abaixo de um atraso real (minutos/horas). Se o servidor estiver
// desajustado além disso, o clockSkewMonitor avisa no log.
export const MESSAGE_BACKLOG_THRESHOLD_MS = 5 * 60 * 1000;

export function resolveMessageTimestamp(
  providerAt: Date | null | undefined,
  arrivedAt: Date
): Date {
  if (!providerAt || Number.isNaN(providerAt.getTime())) return arrivedAt;
  const lagMs = arrivedAt.getTime() - providerAt.getTime();
  return lagMs > MESSAGE_BACKLOG_THRESHOLD_MS ? providerAt : arrivedAt;
}

// `receivedAt` do job é ISO gravado pelo webhook handler. Job antigo/replay
// manual sem o campo cai no "agora" do worker.
export function parseArrivedAt(iso: string | undefined): Date {
  if (!iso) return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

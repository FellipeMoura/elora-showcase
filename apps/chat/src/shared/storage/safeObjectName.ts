// =====================================================================
// Nome de arquivo → trecho seguro de object key (só [A-Za-z0-9._-]).
//
// Por quê: a chave vai assinada (SigV4) no PUT e no presigned GET. Em
// prod o storage fica atrás de um proxy (storage.example.com) que
// decodifica/recodifica o caminho — com espaço, acento ou parênteses no
// nome (`Comprovante Pix (1).pdf`, `Nota março.pdf`) a assinatura deixa de
// bater e o upload falha. Imagem/áudio nunca sofreram porque a chave deles
// é só o id da mensagem. Em dev o MinIO é acessado direto, então não
// aparecia.
//
// Acento vira a letra base (março → marco), o resto vira `-`. Extensão é
// preservada (o browser usa pra abrir o PDF).
// =====================================================================

const MAX_LENGTH = 120;

export function safeObjectName(name: string | null | undefined): string {
  const base = (name ?? '').replaceAll('\\', '/').split('/').pop() ?? '';
  const ascii = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[-.]+|-+$/g, '');

  if (!ascii) return 'file';
  if (ascii.length <= MAX_LENGTH) return ascii;

  // Corta o nome, não a extensão.
  const dot = ascii.lastIndexOf('.');
  const ext = dot > 0 && ascii.length - dot <= 10 ? ascii.slice(dot) : '';
  return ascii.slice(0, MAX_LENGTH - ext.length).replace(/-+$/, '') + ext;
}

// Variantes BR de um número celular em E.164.
//
// Quirk brasileira: linhas móveis SEMPRE têm o nono dígito (resolução Anatel
// nº 553/2010), mas algumas contas WhatsApp — especialmente as criadas há
// muitos anos com DDDs do interior — ficaram cadastradas SEM o 9. WhatsApp
// trata os dois como contas potencialmente distintas, e a Evolution só
// responde "exists" pra variante que realmente está na rede WhatsApp.
//
// Estratégia: pra qualquer celular BR a gente pede ao provider as DUAS
// variantes de uma vez (a Evolution aceita array em `numbers`) e usa a que
// responder "exists". Pra não-BR, ou pra entrada que não bate o formato
// móvel BR, devolve só o próprio número — sem probe.
//
// Convenção: a função NÃO inventa números — se a entrada não bate um padrão
// móvel BR esperado, ela só ecoa `[input]`. Caller usa a primeira variante
// que retornar `exists` no provider.

const BR_MOBILE_WITH_9 = /^\+55(\d{2})9(\d{8})$/; // 14 chars: +55 DD 9 XXXXXXXX
const BR_MOBILE_WITHOUT_9 = /^\+55(\d{2})(\d{8})$/; // 13 chars: +55 DD XXXXXXXX

export function getBrMobileVariants(e164: string): string[] {
  const withNine = BR_MOBILE_WITH_9.exec(e164);
  if (withNine) {
    const ddd = withNine[1]!;
    const tail = withNine[2]!;
    return [e164, `+55${ddd}${tail}`];
  }

  const withoutNine = BR_MOBILE_WITHOUT_9.exec(e164);
  if (withoutNine) {
    const ddd = withoutNine[1]!;
    const tail = withoutNine[2]!;
    return [e164, `+55${ddd}9${tail}`];
  }

  return [e164];
}

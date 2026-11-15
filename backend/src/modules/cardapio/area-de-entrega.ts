/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ÁREA DE ENTREGA DO PEDIDO DO CARDÁPIO (15/11/2026, pedido do dono — ERR-470). O pedido #71 da loja-piloto saiu a ~119 km,
 * num lugar sem entrega, com frete R$ 0,00, e foi pago no Pix: o cancelamento devolveu o dinheiro, mas o gateway já tinha
 * cobrado a tarifa. Até aqui, além da última faixa o cardápio cobrava a taxa da ÚLTIMA faixa (a desta loja é R$ 0) em vez de
 * recusar, e no modo bairro o pedido sem bairro da lista entrava com frete zero. Agora o pedido fora da área é RECUSADO antes
 * de existir — e, por isso, antes de qualquer cobrança. A tela confere o mesmo antes de chegar aqui (`frontend/.../etapas.ts`).
 *
 * Regra (a mesma do robô, `robo-pedido.service.ts#enderecoConferido`, que já recusava):
 *  • distância (modo `raio`, com as faixas e o ponto da loja cadastrados): além da última faixa → recusa; endereço que não se
 *    acha no mapa → recusa (pede para conferir ou usar a localização);
 *  • bairro: sem um bairro da lista de entrega → recusa;
 *  • cadastro da loja incompleto (modo distância sem faixas ou sem o ponto da loja): não recusa — é a configuração da loja que
 *    falta, e recusar pararia todas as entregas dela sem aviso (fica como antes).
 */

export type ResultadoDaTaxa = {
  alemDaUltimaFaixa: boolean;
  semLocalizacao: boolean;
  km: number | null;
  bairro: { id: string; nome: string } | null;
};

export type RecusaDaArea = { code: 'FORA_DA_AREA' | 'ENDERECO_NAO_ENCONTRADO' | 'BAIRRO_FORA_DA_AREA'; message: string };

const umaCasa = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** O alcance da entrega por distância: a maior faixa cadastrada (km), ou null sem faixa válida. */
export function alcanceDasFaixas(raios: unknown): number | null {
  const kms = (Array.isArray(raios) ? raios : []).map((r: any) => Number(r?.ateKm)).filter((n) => Number.isFinite(n) && n > 0);
  return kms.length ? Math.max(...kms) : null;
}

/** O modo distância só funciona com as faixas e o ponto da loja. */
export function raioConfigurado(cfg: any): boolean {
  // `Number(null)` e `Number('')` dão 0 (um ponto no oceano): coordenada vazia não conta.
  const coord = (v: unknown) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v));
  return alcanceDasFaixas(cfg?.raios) != null && coord(cfg?.endLat) && coord(cfg?.endLng);
}

/** Por que o pedido de ENTREGA não pode sair para este endereço — ou null (pode). */
export function recusaDaArea(cfg: any, t: ResultadoDaTaxa): RecusaDaArea | null {
  if (cfg?.areaModo === 'raio') {
    if (!raioConfigurado(cfg)) return null;
    if (t.semLocalizacao)
      return {
        code: 'ENDERECO_NAO_ENCONTRADO',
        message: 'Não encontramos esse endereço no mapa para calcular a entrega. Confira a rua e o número, ou use a sua localização.',
      };
    if (t.alemDaUltimaFaixa) {
      const alcance = alcanceDasFaixas(cfg.raios)!;
      const onde = t.km != null ? `ele fica a ~${umaCasa(t.km)} km da loja, e a entrega vai até ${umaCasa(alcance)} km` : `a entrega vai até ${umaCasa(alcance)} km`;
      return { code: 'FORA_DA_AREA', message: `Não entregamos nesse endereço: ${onde}. Confira o endereço.` };
    }
    return null;
  }
  if (!t.bairro) return { code: 'BAIRRO_FORA_DA_AREA', message: 'Não entregamos nesse bairro. Escolha um dos bairros da lista de entrega.' };
  return null;
}

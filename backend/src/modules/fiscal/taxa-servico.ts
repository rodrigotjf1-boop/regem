import { NfceItem } from './nfce-xml.builder';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TAXA DE SERVIÇO (garçom) NA NFC-e — cada casa tem o seu protocolo, e o contador decide.
//
// O que a lei fixa, e que vale para qualquer escolha:
//  • CLT, art. 457, §3º-§6º (Lei 13.419/17): a taxa cobrada "como serviço ou adicional" é
//    GORJETA, NÃO é receita própria do empregador, e quem cobra deve "lançá-la na respectiva
//    nota de consumo" (a conta que o cliente recebe).
//  • ICMS, regime normal: o Convênio ICMS 125/11 autoriza tirá-la da base, LIMITADA a 10% da
//    conta (15% em SP desde 19/02/2026, Conv. 8/26). No RJ ela entra como ITEM da NFC-e com
//    **CST 41** (não tributada), sem base nem alíquota, com CFOP da lista 5101–5115 (manual da
//    SEFAZ-RJ, Resolução SEFAZ 588/13).
//  • Simples Nacional: a exclusão NÃO vale — "as gorjetas, sejam elas compulsórias ou não,
//    integram a receita bruta que serve de base de cálculo do Simples" (Res. CGSN 140/18,
//    art. 2º, §4º, II). Se ela vai na nota, vai TRIBUTADA (CSOSN 102).
//
// A escolha da loja fica em `fiscal_config.taxa_servico_nfce`. NULO quer dizer "ainda não
// escolhido": a nota de uma comanda COM taxa é recusada até a loja escolher, em vez de o
// sistema decidir por ela uma questão tributária.

export type ModoTaxaServico = 'fora_da_nota' | 'item_tributado' | 'item_nao_tributado';
export const MODOS_TAXA_SERVICO: ModoTaxaServico[] = ['fora_da_nota', 'item_tributado', 'item_nao_tributado'];

/** Teto da exclusão da base do ICMS (Conv. 125/11, redação do Conv. 8/26). */
export function tetoGorjetaIcms(uf: string | null | undefined): number {
  return String(uf ?? '').toUpperCase() === 'SP' ? 15 : 10;
}

export class TaxaServicoBloqueada extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A linha da taxa de serviço para a NFC-e, ou `null` quando ela não vai no documento.
 *
 * O VALOR é o que o cliente pagou a mais: a comanda cobra `subtotal × (1 + pct/100)`
 * arredondado a centavos, então a linha é exatamente essa diferença — a soma da nota bate com
 * o pagamento, centavo a centavo (o `vPag` tem de fechar com o `vNF`, regra YA09).
 */
export function linhaTaxaServico(p: {
  pct: number;
  itens: Pick<NfceItem, 'quantidade' | 'precoUnitario'>[];
  modo?: string | null;
  crt?: number | string | null;
  uf?: string | null;
}): NfceItem | null {
  const pct = Number(p.pct) || 0;
  if (pct <= 0) return null;

  const modo = String(p.modo ?? '').trim();
  if (!modo)
    throw new TaxaServicoBloqueada(
      `A comanda tem taxa de serviço de ${pct}%, e a loja ainda não definiu como ela entra na NFC-e ` +
        '(Configuração fiscal → Taxa de serviço). É decisão do contador: no Simples ela integra a ' +
        'receita bruta; no regime normal, sai da base do ICMS como item não tributado.',
    );
  if (modo === 'fora_da_nota') return null;

  const subtotal = r2(p.itens.reduce((s, it) => s + Number(it.quantidade) * Number(it.precoUnitario), 0));
  const cobrado = r2(subtotal * (1 + pct / 100));
  const valor = r2(cobrado - subtotal);
  if (valor <= 0) return null;

  const crt = Number(p.crt) || 1;
  const linha: NfceItem = {
    codigo: 'TAXA-SERVICO',
    descricao: `Taxa de servico ${pct}%`,
    // Não é mercadoria: "item que não possa ser classificado" leva NCM de oito zeros
    // (NT 2014/004, manual da SEFAZ-RJ). O "00" de dois dígitos é outra coisa (item de serviço).
    ncm: '00000000',
    cfop: '5102',
    origem: '0',
    unidadeTrib: 'UN',
    quantidade: 1,
    precoUnitario: valor,
  };

  if (modo === 'item_tributado') {
    if (crt !== 1)
      throw new TaxaServicoBloqueada(
        'Taxa de serviço tributada no regime normal exige ICMS com base e alíquota (CST 00), que o ' +
          'emissor ainda não monta. No regime normal o caminho previsto é o item não tributado (CST 41).',
      );
    return { ...linha, csosn: '102' };
  }

  if (modo === 'item_nao_tributado') {
    if (crt === 1)
      throw new TaxaServicoBloqueada(
        'No Simples Nacional a taxa de serviço NÃO sai da base: "as gorjetas, sejam elas compulsórias ' +
          'ou não, integram a receita bruta" (Res. CGSN 140/18, art. 2º, §4º, II). Escolha "linha ' +
          'tributada" ou "fora da nota" com o contador.',
      );
    const teto = tetoGorjetaIcms(p.uf);
    if (pct > teto)
      throw new TaxaServicoBloqueada(
        `A exclusão da gorjeta da base do ICMS vale até ${teto}% da conta (Convênio ICMS 125/11); ` +
          `esta comanda tem ${pct}%. O excedente seria tributado, e o emissor ainda não separa as duas partes.`,
      );
    return { ...linha, cstIcms: '41' };
  }

  throw new TaxaServicoBloqueada(`Modo de taxa de serviço desconhecido: ${modo}.`);
}

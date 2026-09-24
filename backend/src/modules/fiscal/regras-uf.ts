/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE CADA UF EXIGE ALÉM DO LEIAUTE NACIONAL.
//
// O XSD e o MOC valem para o país inteiro; cada estado acrescenta listas fechadas, textos
// obrigatórios e prazos próprios. Nada daqui é constante nacional — e só entra UF com a norma
// conferida em fonte oficial (a regra da skill `cupom-fiscal`: linha não confirmada não vira
// código). UF fora da tabela segue só as regras nacionais.

/** CSOSN que a NFC-e aceita no país (MOC, N12a-20 → 383). O 900 é "a critério da UF". */
export const CSOSN_NFCE_NACIONAL = new Set(['102', '103', '300', '400', '500']);

/**
 * CSOSN 500 (ICMS já retido por substituição tributária) só anda com estes CFOP
 * (MOC, N12a-44 → 386): 5405 (mercadoria de terceiro com ST), 5656/5667 (combustível) e 5910.
 */
export const CFOP_DO_CSOSN_500 = new Set(['5405', '5656', '5667', '5910']);

export interface RegrasUf {
  /** Lista FECHADA de CFOP: código fora dela é "dado incorreto" na UF. */
  cfop?: Set<string>;
  /** Lista FECHADA de CSOSN (Simples). */
  csosn?: Set<string>;
  /** Texto de defesa do consumidor exigido por lei estadual, no campo do contribuinte. */
  rodapeConsumidor?: string;
  /** O `infAdFisco` é obrigatório nesta UF (texto configurado pela loja/contador). */
  exigeInfoFisco?: boolean;
  /** Prazo do cancelamento comum, em minutos contados da autorização. */
  cancelamentoMinutos?: number;
}

/**
 * RIO DE JANEIRO — manual da NFC-e da SEFAZ-RJ de 16/07/2026, digerido na ficha RJ da skill:
 *
 *  • listas fechadas (§A4): CFOP 5101/5102/5103/5104/5115/5405/5656/5667 (o 5933 é letra morta
 *    — "atualmente, não há nenhum convênio" — e o 5929 não existe na NFC-e); CSOSN 102/300/500.
 *    "Um emissor genérico que ofereça a tabela inteira produz nota recusável no RJ";
 *  • Lei estadual 5.817/10 (§A2): telefone e endereço do PROCON-RJ e da Comissão de Defesa do
 *    Consumidor da ALERJ no campo "Mensagem de Interesse do Contribuinte" do DANFE;
 *  • Lei 8.405/19 (pergunta 1.49): FECP em `infAdFisco` — "em caso de NÃO INCIDÊNCIA do FECP,
 *    deverá constar essa informação". O campo nunca fica vazio;
 *  • cancelamento em 30 minutos da autorização, desde que a mercadoria não tenha circulado (§A5).
 */
const RJ: RegrasUf = {
  cfop: new Set(['5101', '5102', '5103', '5104', '5115', '5405', '5656', '5667']),
  csosn: new Set(['102', '300', '500']),
  rodapeConsumidor:
    'PROCON-RJ: 151 - Av. Rio Branco, 25, 5o andar, Centro, Rio de Janeiro. ' +
    'Comissao de Defesa do Consumidor da ALERJ: 0800 282 7060 - R. da Alfandega, 8, Centro, Rio de Janeiro.',
  exigeInfoFisco: true,
  cancelamentoMinutos: 30,
};

const POR_UF: Record<string, RegrasUf> = { RJ };

export function regrasDaUf(uf: string | null | undefined): RegrasUf {
  return POR_UF[String(uf ?? '').toUpperCase()] ?? {};
}

/**
 * Cadastro fiscal de produto fora do que a NFC-e (ou a UF) aceita. É erro de CADASTRO — a loja
 * corrige o produto —, então tem classe própria: o serviço traduz para 400 com a mensagem, em
 * vez de o `Error` genérico virar 500 "erro interno" (LIC-023), e o totem sabe que a próxima
 * venda do mesmo produto vai falhar igual.
 */
export class CadastroFiscalIncompativel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'CadastroFiscalIncompativel';
  }
}

/**
 * Confere CSOSN e CFOP de cada item ANTES de gastar número. Devolve a lista de problemas em
 * português, para a mensagem da venda dizer exatamente qual produto está com o cadastro errado.
 * Só vale para o Simples (CRT 1); o regime normal usa CST e tem outra lista.
 */
export function problemasDosItens(
  uf: string | null | undefined,
  crt: number,
  itens: { descricao: string; csosn?: string; cfop?: string }[],
): string[] {
  if (Number(crt) !== 1) return [];
  const r = regrasDaUf(uf);
  const probs: string[] = [];
  for (const it of itens) {
    const csosn = String(it.csosn || '102');
    const cfop = String(it.cfop ?? '').replace(/[^0-9]/g, '') || '5102';
    if (!CSOSN_NFCE_NACIONAL.has(csosn))
      probs.push(`${it.descricao}: CSOSN ${csosn} não é aceito na NFC-e (rejeição 383)`);
    else if (r.csosn && !r.csosn.has(csosn))
      probs.push(`${it.descricao}: CSOSN ${csosn} fora da lista da UF (${[...r.csosn].join(', ')})`);
    if (csosn === '500' && !CFOP_DO_CSOSN_500.has(cfop))
      probs.push(`${it.descricao}: com CSOSN 500 o CFOP tem de ser 5405 (rejeição 386) — está ${cfop}`);
    else if (r.cfop && !r.cfop.has(cfop))
      probs.push(`${it.descricao}: CFOP ${cfop} fora da lista da UF (${[...r.cfop].join(', ')})`);
  }
  return probs;
}

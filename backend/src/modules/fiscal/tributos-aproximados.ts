// VALOR APROXIMADO DOS TRIBUTOS — Lei 12.741/2012 (Decreto 8.264/2014; NT 2013.003).
//
// A NFC-e tem um `vTotTrib` por item (M02) e um no total (W16a). O valor é INFORMATIVO ao
// consumidor (Decreto 8.264, art. 6º; Manual do DANFE NFC-e, §2.1.9.1): não entra no vNF, não muda
// imposto nenhum da nota nem relatório, caixa ou CMV. A SEFAZ confere só uma conta: o total tem de
// ser a SOMA dos itens — senão, rejeição 685. Por isso tudo aqui é em CENTAVOS, item a item, e o
// total nasce da soma.
//
// Regras (base da skill `cupom-fiscal`, §5.7 — fontes do IBPT):
//  • percentual da tabela do IBPT da UF do emitente, pelo NCM (sem exceção de TIPI: o produto não a
//    tem cadastrada);
//  • federal: `nacionalfederal` quando o 1º dígito da origem é 0, 3, 4 ou 5; `importadosfederal`
//    nos demais (regra literal do manual do IBPT — a origem 8 cai em importados);
//  • base = valor do item MENOS o desconto rateado (FAQ do IBPT). Entrega e outras despesas ficam
//    fora: não são o produto;
//  • TRUNCADO, não arredondado — é a sugestão do IBPT ("irrelevante para efeitos legais");
//  • linha sem NCM de mercadoria (`00000000`, a da taxa de serviço) e NCM fora da tabela: zero.

export type AliquotaIbpt = {
  nacionalFederal: number;
  importadosFederal: number;
  estadual: number;
  municipal: number;
};

/** Tabela vigente da UF, só com as linhas dos NCMs da nota (chave: NCM de 8 dígitos). */
export type TabelaIbptDaNota = {
  fonte: string;
  chave: string;
  versao: string;
  aliquotas: Record<string, AliquotaIbpt>;
  /** Tabela PRÓPRIA da empresa (token do lojista, mig 292) — senão, a da distribuição. */
  propria?: boolean;
};

/** O que fica gravado na nota (`nota_fiscal.tributos_aprox`) e é impresso no cupom. */
export type TributosAprox = {
  federal: number;
  estadual: number;
  municipal: number;
  total: number;
  fonte: string;
  chave: string;
  versao: string;
  /** Presente (true) só quando a nota usou a tabela própria da empresa. */
  propria?: true;
};

export type TributosDaNota = { porItem: number[]; resumo: TributosAprox };

const NCM_SEM_MERCADORIA = '00000000';

export function origemNacional(origem?: string | null): boolean {
  const d = String(origem ?? '0').trim().charAt(0) || '0';
  return ['0', '3', '4', '5'].includes(d);
}

// Percentual sobre centavos, truncado. O epsilon absorve o erro do float: uma conta que em
// decimal dá inteiro exato pode sair 28,999999… em binário, e o truncamento tiraria um centavo.
function parte(centavos: number, pct: number): number {
  if (!(centavos > 0) || !(pct > 0)) return 0;
  return Math.floor((centavos * pct) / 100 + 1e-7);
}

export function calcularTributosAprox(
  itens: { ncm?: string | null; origem?: string | null; base: number }[],
  tabela: TabelaIbptDaNota,
): TributosDaNota {
  let fed = 0;
  let est = 0;
  let mun = 0;
  const porItem = itens.map((it) => {
    const ncm = String(it.ncm ?? '').replace(/\D/g, '');
    const aliq = ncm && ncm !== NCM_SEM_MERCADORIA ? tabela.aliquotas[ncm] : undefined;
    if (!aliq) return 0;
    const base = Math.round(Number(it.base) * 100);
    const f = parte(base, origemNacional(it.origem) ? aliq.nacionalFederal : aliq.importadosFederal);
    const e = parte(base, aliq.estadual);
    const m = parte(base, aliq.municipal);
    fed += f;
    est += e;
    mun += m;
    return (f + e + m) / 100;
  });
  return {
    porItem,
    resumo: {
      federal: fed / 100,
      estadual: est / 100,
      municipal: mun / 100,
      total: (fed + est + mun) / 100,
      fonte: tabela.fonte,
      chave: tabela.chave,
      versao: tabela.versao,
      ...(tabela.propria ? { propria: true as const } : {}),
    },
  };
}

const reais = (v: number) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A frase do cupom. Vai no `infCpl` e é impressa na Divisão IX do DANFE (Manual do DANFE NFC-e:
 * "não devem ser inseridas informações que não constem do XML"). Segue a opção 2 do manual do IBPT
 * (AFRAC) com os três entes separados (Decreto 8.264, art. 2º) — o municipal só quando existe — e
 * cita fonte e chave, que é a condição de uso da tabela.
 */
export function fraseTributosAprox(entrada: TributosAprox | string | null | undefined): string | null {
  let t: TributosAprox | null = null;
  try {
    t = typeof entrada === 'string' ? JSON.parse(entrada) : (entrada ?? null);
  } catch {
    t = null;
  }
  if (!t || !(Number(t.total) > 0)) return null;
  const partes = [`R$ ${reais(t.federal)} Federal`, `R$ ${reais(t.estadual)} Estadual`];
  if (Number(t.municipal) > 0) partes.push(`R$ ${reais(t.municipal)} Municipal`);
  const entes = partes.length === 3 ? `${partes[0]}, ${partes[1]} e ${partes[2]}` : `${partes[0]} e ${partes[1]}`;
  return `Trib aprox ${entes} (Lei 12.741/12). Fonte: ${t.fonte} ${t.chave}`.trim();
}

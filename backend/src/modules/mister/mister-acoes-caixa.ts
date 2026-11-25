// O CAIXA À DISTÂNCIA PELA CONVERSA (versão 9, O5, etapa 1 do pedido do dono de 24/11: "mesas e comandas, junto com o caixa à
// distância"). Fechar o caixa esquecido e lançar uma sangria, pelo MESMO serviço do PDV (`FinanceiroService.fecharSessao` e
// `movimentarCaixa`), com o PIN — é dinheiro. O fechamento é CEGO, como na tela: quem fecha diz o dinheiro contado ou "sem
// contagem"; o Regem nunca mostra o esperado antes. Aqui só a conferência; sem banco.

export type CaixaDaLoja = 'pdv' | 'delivery';
export type ParametrosDoCaixa =
  | { acao: 'fechar_caixa'; caixa: CaixaDaLoja; operador: string | null; dinheiroContado: number | null; semContagem: boolean; motivo: string | null }
  | { acao: 'sangria'; caixa: CaixaDaLoja; operador: string | null; valor: number; motivo: string };

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reais = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_REAIS = 1_000_000;
/** O mínimo de letras do motivo de fechar o turno do delivery com entrega pendente (o mesmo do serviço). */
export const MOTIVO_MINIMO = 10;

/** "balcão", "pdv", "caixa 1" → o caixa do balcão; "delivery", "entrega" → o do delivery. */
export function lerCaixa(v: unknown): CaixaDaLoja | null {
  const t = semAcento(texto(v));
  if (!t) return null;
  if (/deliver|entreg/.test(t)) return 'delivery';
  if (/balcao|pdv|caixa|loja|salao/.test(t)) return 'pdv';
  return null;
}

export function conferirCaixa(acao: ParametrosDoCaixa['acao'], en: Record<string, unknown>): { parametros: ParametrosDoCaixa; resumo: string } | { erro: string } {
  const caixa = lerCaixa(en.caixaDaLoja);
  if (!caixa) return { erro: 'Diga qual caixa: o do balcão ou o do delivery.' };
  const operador = texto(en.operadorDoCaixa).slice(0, 80) || null;
  if (acao === 'sangria') {
    const v = en.valorDaSangria;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_REAIS) return { erro: 'Diga o valor da sangria em reais.' };
    const motivo = texto(en.motivoDoCaixa).slice(0, 200);
    if (motivo.length < 3) return { erro: 'Diga o motivo da sangria (ex.: "pagar o gás", "dinheiro demais na gaveta").' };
    return { parametros: { acao, caixa, operador, valor: Math.round(v * 100) / 100, motivo }, resumo: `Lançar a sangria de ${reais(Math.round(v * 100) / 100)} (motivo: ${motivo}) no caixa do ${caixa === 'delivery' ? 'delivery' : 'balcão'}.` };
  }
  const semContagem = en.semContagem === true;
  const d = en.dinheiroContado;
  let dinheiroContado: number | null = null;
  if (d !== undefined && d !== null && d !== '') {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > MAX_REAIS) return { erro: 'O dinheiro contado é um valor em reais (0 ou mais).' };
    dinheiroContado = Math.round(d * 100) / 100;
  }
  if (semContagem && dinheiroContado !== null) return { erro: 'Ou a pessoa contou o dinheiro, ou fecha sem contagem: não os dois.' };
  if (!semContagem && dinheiroContado === null)
    return { erro: 'O fechamento é cego: diga quanto de dinheiro foi contado na gaveta, ou que fecha sem contagem.' };
  const motivo = texto(en.motivoDoCaixa).slice(0, 300) || null;
  return {
    parametros: { acao, caixa, operador, dinheiroContado, semContagem, motivo },
    resumo: `Fechar o caixa do ${caixa === 'delivery' ? 'delivery' : 'balcão'} ${semContagem ? 'sem contagem' : `com ${reais(dinheiroContado as number)} de dinheiro contado`}.`,
  };
}

/** O caixa achado, como aparece na pergunta: "o caixa do balcão (PDV 1, aberto por Bruna em 23/11 18:02, há 26 h)". */
export function nomeDoCaixa(c: { caixa: CaixaDaLoja; terminal: string | null; abertoPor: string | null; abertoEm: string; abertoHaHoras: number }): string {
  const desde = `aberto${c.abertoPor ? ` por ${c.abertoPor}` : ''} em ${c.abertoEm}, há ${c.abertoHaHoras.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return c.caixa === 'delivery' ? `o caixa do delivery (${desde})` : `o caixa do balcão (${c.terminal ? `${c.terminal}, ` : ''}${desde})`;
}

export function resumoDoFechamento(nome: string, p: Extract<ParametrosDoCaixa, { acao: 'fechar_caixa' }>, pendencias: number): string {
  const contagem = p.semContagem
    ? 'sem contagem: tudo o que não foi contado fica como diferença no relatório de turnos'
    : `com ${reais(p.dinheiroContado as number)} de dinheiro contado na gaveta; as outras formas ficam como não contadas`;
  const pend = pendencias > 0 ? ` Há ${pendencias === 1 ? '1 entrega pendente' : `${pendencias} entregas pendentes`}: fecha mesmo assim, com o motivo "${p.motivo}" na auditoria.` : '';
  return `Fechar ${nome}, ${contagem}.${pend} O comprovante sai na impressora do caixa.`;
}

export function resumoDaSangria(nome: string, p: Extract<ParametrosDoCaixa, { acao: 'sangria' }>): string {
  return `Lançar a sangria de ${reais(p.valor)} (motivo: ${p.motivo}) no ${nome.replace(/^o /, '')}. O comprovante sai na impressora do caixa; o dinheiro sai da gaveta de quem está lá.`;
}

/** A página do PIN: o fechamento sem o esperado (é cego) e a sangria com o valor em destaque. */
export function apresentacaoDoCaixa(p: Record<string, any>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  if (p.acao === 'sangria')
    return { titulo: 'Lançar a sangria', itens: [`Caixa: ${p.nomeDoCaixa}`, `Motivo: ${p.motivo}`], detalhe: 'O comprovante sai na impressora do caixa.', valor: Number(p.valor), botao: 'Lançar a sangria' };
  return {
    titulo: 'Fechar o caixa',
    itens: [
      `Caixa: ${p.nomeDoCaixa}`,
      p.semContagem ? 'Sem contagem' : `Dinheiro contado: ${reais(Number(p.dinheiroContado))}`,
      ...(p.pendencias ? [`${p.pendencias} entrega(s) pendente(s), motivo: ${p.motivo}`] : []),
    ],
    detalhe: 'O fechamento é cego: a diferença aparece depois, no relatório de turnos.',
    valor: null,
    botao: 'Fechar o caixa',
  };
}

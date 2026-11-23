import { descricaoCrua, ehLinhaDeSaldo, mascararDescricao, normalizarTexto, origemDaDescricao, resumoComSal, textoDaRegra, type Fonte } from './mascara';
import type { ExtratoOfx, LinhaOfx, MotivoDaRecusa } from './ofx';

// As regras do extrato (R1 da versão 8 do Mister), sem banco de dados: os tipos do "Isso é o quê?", as situações, a chave
// que impede duplicar, o período sem lançamento e as frases de recusa do arquivo.

export const TIPOS = [
  { chave: 'venda_ifood', rotulo: 'Venda do iFood' },
  { chave: 'venda_ifood_pago', rotulo: 'Venda do iFood Pago' },
  { chave: 'venda_99', rotulo: 'Venda da 99' },
  { chave: 'venda_maquininha', rotulo: 'Venda da maquininha' },
  { chave: 'pix_cliente', rotulo: 'Pix de cliente' },
  { chave: 'deposito_caixa', rotulo: 'Depósito do caixa' },
  { chave: 'fornecedor', rotulo: 'Fornecedor' },
  { chave: 'folha', rotulo: 'Folha' },
  { chave: 'imposto', rotulo: 'Imposto' },
  { chave: 'retirada_dono', rotulo: 'Retirada do dono' },
  { chave: 'transferencia_contas', rotulo: 'Transferência entre contas' },
  { chave: 'outra_despesa', rotulo: 'Outra despesa da loja' },
  { chave: 'outra_entrada', rotulo: 'Outra entrada da loja' },
  { chave: 'nao_e_da_loja', rotulo: 'Não é da loja' },
] as const;
export const CHAVES_DE_TIPO: readonly string[] = TIPOS.map((t) => t.chave);

export const SITUACOES = ['casado', 'a_conferir', 'so_no_banco', 'esperado', 'nao_e_da_loja'] as const;
export type Situacao = (typeof SITUACOES)[number];

export const FONTES: readonly Fonte[] = ['banco', 'ifood', 'ifood_pago', '99', 'maquininha'];

/** A situação de um lançamento pela fonte que a descrição indica: só outra fonte confirmaria iFood, 99 e maquininha. */
export const situacaoPelaFonte = (fonte: Fonte): Situacao => (fonte === 'banco' ? 'so_no_banco' : 'a_conferir');

/** A situação depois de dizer "isso é o quê": "Não é da loja" tira da conta; desmarcar volta ao que a fonte indica. */
export function situacaoDoTipo(tipo: string | null, fonte: Fonte): Situacao {
  return tipo === 'nao_e_da_loja' ? 'nao_e_da_loja' : situacaoPelaFonte(fonte);
}

// ── a chave do lançamento ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * FITID que não serve para identificar a linha: banco que numera as linhas do próprio arquivo (1, 2, 3…) dá outro FITID
 * para o mesmo lançamento na exportação seguinte, e a mesma linha entraria duas vezes.
 */
export function fitidsSaoSequencia(linhas: Pick<LinhaOfx, 'fitid'>[]): boolean {
  if (!linhas.length) return false;
  const primeiro = Number(linhas[0].fitid);
  if (!/^\d{1,7}$/.test(linhas[0].fitid) || primeiro > 1) return false;
  return linhas.every((l, i) => /^\d{1,7}$/.test(l.fitid) && Number(l.fitid) === primeiro + i);
}

export interface LancamentoPreparado {
  chave: string;
  data: string;
  valor: number;
  descricao: string;
  hash: string;
  fonte: Fonte;
  situacao: Situacao;
}

export interface LinhasPreparadas {
  lancamentos: LancamentoPreparado[];
  /** Linhas que só informam o saldo, ou de valor zero: não são lançamento. */
  informativas: number;
}

/** Linha que só informa o saldo, ou de valor zero: não é lançamento. */
const ehInformativa = (l: LinhaOfx) => l.valorCentavos === 0 || ehLinhaDeSaldo(descricaoCrua(l.nome, l.memo));

/** Os dias que têm lançamento de verdade: a mesma conta na conferência e na gravação (V74). */
export const diasComLancamento = (extrato: Pick<ExtratoOfx, 'linhas'>): string[] => extrato.linhas.filter((l) => !ehInformativa(l)).map((l) => l.data);

/**
 * Prepara as linhas do arquivo: tira as informativas, mascara a descrição e monta a chave. A chave usa FITID + data + valor.
 * Sem FITID confiável (vazio, repetido no arquivo ou numeração do arquivo), usa data + valor + descrição + a ordem entre as
 * linhas IGUAIS do mesmo dia: dois Pix idênticos no mesmo dia continuam sendo dois, e a ordem não muda quando outra exportação
 * traz mais linhas nesse dia. O sal é da empresa; o texto cru só existe aqui, enquanto a função roda.
 */
export function prepararLinhas(sal: string, extrato: Pick<ExtratoOfx, 'linhas'>): LinhasPreparadas {
  const reais: { l: LinhaOfx; cru: string }[] = [];
  let informativas = 0;
  for (const l of extrato.linhas) {
    if (ehInformativa(l)) informativas++;
    else reais.push({ l, cru: descricaoCrua(l.nome, l.memo) });
  }

  // Olha o arquivo INTEIRO: tirar a linha de saldo do meio quebraria a sequência e faria a numeração valer como identidade.
  const semSequencia = !fitidsSaoSequencia(extrato.linhas);
  const vezesDoFitid = new Map<string, number>();
  if (semSequencia) {
    for (const { l } of reais) {
      if (!l.fitid) continue;
      const k = `${l.fitid}|${l.data}|${l.valorCentavos}`;
      vezesDoFitid.set(k, (vezesDoFitid.get(k) ?? 0) + 1);
    }
  }

  const ordemIgual = new Map<string, number>();
  const lancamentos = reais.map(({ l, cru }) => {
    const k = `${l.fitid}|${l.data}|${l.valorCentavos}`;
    const confiavel = semSequencia && !!l.fitid && vezesDoFitid.get(k) === 1;
    let chave: string;
    if (confiavel) {
      chave = resumoComSal(sal, `f|${k}`);
    } else {
      const igual = `${l.data}|${l.valorCentavos}|${normalizarTexto(cru)}`;
      const ordem = ordemIgual.get(igual) ?? 0;
      ordemIgual.set(igual, ordem + 1);
      chave = resumoComSal(sal, `h|${igual}|${ordem}`);
    }
    const fonte = origemDaDescricao(cru, l.valorCentavos);
    return {
      chave,
      data: l.data,
      valor: l.valorCentavos,
      descricao: mascararDescricao(cru),
      hash: resumoComSal(sal, textoDaRegra(cru, l.valorCentavos)),
      fonte,
      situacao: situacaoPelaFonte(fonte),
    };
  });
  return { lancamentos, informativas };
}

// ── o período sem lançamento ───────────────────────────────────────────────────────────────────────────────────────

/** Dias seguidos sem lançamento a partir dos quais o Regem pergunta se a loja vendeu neles. */
export const DIAS_PARA_BURACO = 5;

const diaEmMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const msEmDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const UM_DIA = 86_400_000;

/** O maior trecho de dias sem nenhum lançamento dentro do período do arquivo (com as pontas), ou `null` se for curto. */
export function maiorBuraco(datas: string[], de: string | null, ate: string | null, minimo = DIAS_PARA_BURACO): { de: string; ate: string; dias: number } | null {
  if (!datas.length) return null;
  const unicas = [...new Set(datas)].sort();
  const inicio = de && de < unicas[0] ? de : unicas[0];
  const fim = ate && ate > unicas[unicas.length - 1] ? ate : unicas[unicas.length - 1];
  let melhor: { de: string; ate: string; dias: number } | null = null;
  const pontos = [diaEmMs(inicio) - UM_DIA, ...unicas.map(diaEmMs), diaEmMs(fim) + UM_DIA];
  for (let i = 1; i < pontos.length; i++) {
    const dias = Math.round((pontos[i] - pontos[i - 1]) / UM_DIA) - 1;
    if (dias >= minimo && (!melhor || dias > melhor.dias)) melhor = { de: msEmDia(pontos[i - 1] + UM_DIA), ate: msEmDia(pontos[i] - UM_DIA), dias };
  }
  return melhor;
}

// ── as frases da recusa ────────────────────────────────────────────────────────────────────────────────────────────

/** O arquivo abriu, mas não sobrou nenhum lançamento para importar. */
export const fraseSemLancamento = (recusadas: number): string =>
  recusadas > 0
    ? `${recusadas === 1 ? 'A única linha dele tem' : `As ${recusadas} linhas dele têm`} valor ou data que não dá para ler.`
    : 'Ele não traz nenhum lançamento.';

/** A frase de "Não consegui abrir esse arquivo" (o título e o "Nada foi gravado" ficam na tela). */
export function fraseDaRecusa(motivo: MotivoDaRecusa): string {
  switch (motivo) {
    case 'pdf':
      return 'Ele veio em PDF, e o Regem lê o extrato em OFX.';
    case 'planilha':
      return 'Ele veio em planilha, e o Regem lê o extrato em OFX.';
    case 'vazio':
      return 'Ele está vazio.';
    case 'grande':
      return 'Ele passa de 5 MB. Baixe um período menor.';
    case 'muitas_linhas':
      return 'Ele passa de 20 mil lançamentos. Baixe um período menor.';
    case 'sem_conta':
      return 'Ele não diz de qual conta é.';
    case 'varias_contas':
      return 'Ele traz mais de uma conta. Baixe o extrato de uma conta por vez.';
    case 'cartao':
      return 'Ele é da fatura do cartão de crédito, e o Regem lê o extrato da conta.';
    default:
      return 'Ele não está em OFX, o formato que o Regem lê.';
  }
}

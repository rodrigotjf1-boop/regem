import type { Tom } from '@/components/ui/lista';

// FINANCEIRO › BANCO E REPASSES (R1 da versão 8 do Mister; protótipo `mockups/regem-mister-v8.html`, aba "Na loja"): os tipos
// da resposta do servidor e os textos da tela. Dinheiro em CENTAVOS inteiros, do servidor até a tela.

export type SituacaoDoLancamento = 'casado' | 'a_conferir' | 'so_no_banco' | 'esperado' | 'nao_e_da_loja';
export type FonteDoLancamento = 'banco' | 'ifood' | 'ifood_pago' | '99' | 'maquininha';

export interface Lancamento {
  id: string;
  data: string;
  valor: number;
  descricao: string;
  fonte: FonteDoLancamento;
  situacao: SituacaoDoLancamento;
  tipo: string | null;
}

export interface RespostaDoBanco {
  periodo: { de: string | null; ate: string | null };
  contas: { banco: string; final: string; unidadeId: string; lidoAte: string | null; importadoEm: string | null }[];
  fontes: { banco: { situacao: 'em_dia' | 'antigo' | 'nunca'; lidoAte: string | null }; comDado: string[] };
  total: number;
  base: number;
  filtrados: number;
  contagem: Record<SituacaoDoLancamento, number>;
  totais: { entrou: number; saiu: number; diferenca: number; esperado: number };
  lista: Lancamento[];
  tipos: readonly { chave: string; rotulo: string }[];
}

export type ConferenciaDoArquivo =
  | { caso: 'nao_abre'; motivo: string }
  | { caso: 'outra_conta'; conta: { banco: string; final: string }; contaDaLoja: { banco: string; final: string } }
  | {
      caso: 'ok' | 'repetido' | 'buraco';
      conta: { banco: string; final: string };
      periodo: { de: string | null; ate: string | null };
      total: number;
      jaEstavam: number;
      novos: number;
      recusados: number;
      informativas: number;
      saldoFinal: number | null;
      saldoAnterior: number | null;
      fecha: boolean | null;
      entradasNovas: number;
      saidasNovas: number;
      buraco: { de: string; ate: string } | null;
      jaEntrouEm: string | null;
      novosLista: { data: string; descricao: string; valor: number }[];
    };

export const SITUACOES: { v: SituacaoDoLancamento; rotulo: string; tom: Tom; explica: string }[] = [
  { v: 'casado', rotulo: 'Casado', tom: 'ok', explica: 'O valor do banco bateu, exato e em data próxima, com o que a outra fonte informou.' },
  { v: 'a_conferir', rotulo: 'A conferir', tom: 'aviso', explica: 'Quase bateu, ou falta o arquivo para confirmar. Precisa do seu olho.' },
  { v: 'so_no_banco', rotulo: 'Só no banco', tom: 'neutro', explica: 'Está no extrato e não tem par em nenhuma outra fonte.' },
  { v: 'esperado', rotulo: 'Esperado', tom: 'info', explica: 'A plataforma informou que vem. Ainda não apareceu no banco.' },
  { v: 'nao_e_da_loja', rotulo: 'Não é da loja', tom: 'critico', explica: 'Você marcou. Fica fora das contas da loja.' },
];
export const situacaoDe = (v: SituacaoDoLancamento) => SITUACOES.find((s) => s.v === v) ?? SITUACOES[2];

export const NOME_DA_FONTE: Record<FonteDoLancamento, string> = {
  banco: 'Banco',
  ifood: 'iFood',
  ifood_pago: 'iFood Pago',
  '99': '99',
  maquininha: 'Maquininha',
};

/** A ordem das fontes no filtro (as chaves numéricas de um objeto viriam primeiro). */
export const ORDEM_DAS_FONTES: FonteDoLancamento[] = ['banco', 'ifood', 'ifood_pago', '99', 'maquininha'];

/** O que falta para conferir um lançamento que a descrição liga a outra fonte. */
export const FALTA_PARA_CONFERIR: Partial<Record<FonteDoLancamento, string>> = {
  ifood: 'Falta ligar o iFood para conferir',
  ifood_pago: 'Falta a planilha do iFood Pago para conferir',
  '99': 'Falta a planilha da 99 para conferir',
  maquininha: 'Falta o arquivo da maquininha para conferir',
};

/** A linha de apoio embaixo da descrição, como no protótipo. */
export function apoioDoLancamento(l: Pick<Lancamento, 'situacao' | 'fonte'>): string {
  if (l.situacao === 'nao_e_da_loja') return 'Você marcou: fica fora das contas da loja';
  if (l.situacao === 'a_conferir') return FALTA_PARA_CONFERIR[l.fonte] ?? '';
  return '';
}

/** As fontes que ainda não estão ligadas: só dizem isso, sem botão (entram nas etapas R3 e R4). */
export const FONTES_NAO_LIGADAS: { id: string; nome: string; como: string }[] = [
  { id: 'ifood', nome: 'iFood', como: 'Automático' },
  { id: 'pago', nome: 'iFood Pago / Anota Aí', como: 'Arquivo do portal' },
  { id: 'n99', nome: '99', como: 'Arquivo do portal' },
  { id: 'maq', nome: 'Maquininha', como: 'Arquivo da operadora' },
];

// ── dinheiro e datas, sem conta em ponto flutuante ──────────────────────────────────────────────────────────────────

export function brlDeCentavos(c: number): string {
  const a = Math.abs(Math.trunc(c));
  const reais = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(a % 100).padStart(2, '0')}`;
}
export const comSinal = (c: number) => `${c < 0 ? '−' : '+'}${brlDeCentavos(c)}`;
export const diaCurto = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
export const diaInteiro = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const periodoCurto = (de: string | null | undefined, ate: string | null | undefined) => (de || ate ? `${diaCurto(de)} a ${diaCurto(ate)}` : '—');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const dia2 = (n: number) => String(n).padStart(2, '0');

export type OpcaoDePeriodo = { v: string; rotulo: string; de: string | null; ate: string | null };

/**
 * As opções do filtro de período a partir do último extrato: o mês inteiro, os seus três pedaços (como o protótipo), o mês
 * anterior, tudo e "Outro período" (com o seletor de data).
 */
export function opcoesDePeriodo(lidoAte: string | null): OpcaoDePeriodo[] {
  const fim: OpcaoDePeriodo[] = [
    { v: 'tudo', rotulo: 'Todo o extrato', de: null, ate: null },
    { v: 'outro', rotulo: 'Outro período', de: null, ate: null },
  ];
  if (!lidoAte) return fim;
  const ano = Number(lidoAte.slice(0, 4));
  const mes = Number(lidoAte.slice(5, 7));
  const aaaamm = lidoAte.slice(0, 7);
  const ultimo = ultimoDiaDoMes(ano, mes);
  const ateDia = Math.min(Number(lidoAte.slice(8, 10)), ultimo);
  const mm = dia2(mes);
  const pedacos: OpcaoDePeriodo[] = [];
  for (const [a, b] of [[16, ateDia], [9, 15], [1, 8]] as const) {
    if (a > ateDia) continue;
    const f = Math.min(b, ateDia);
    pedacos.push({ v: `d${a}`, rotulo: `De ${dia2(a)} a ${dia2(f)}/${mm}`, de: `${aaaamm}-${dia2(a)}`, ate: `${aaaamm}-${dia2(f)}` });
  }
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const aaaammAnt = `${anoAnt}-${dia2(mesAnt)}`;
  return [
    { v: 'mes', rotulo: `${MESES[mes - 1]} inteiro`, de: `${aaaamm}-01`, ate: `${aaaamm}-${dia2(ultimo)}` },
    ...pedacos,
    { v: 'anterior', rotulo: `${MESES[mesAnt - 1]} inteiro`, de: `${aaaammAnt}-01`, ate: `${aaaammAnt}-${dia2(ultimoDiaDoMes(anoAnt, mesAnt))}` },
    ...fim,
  ];
}

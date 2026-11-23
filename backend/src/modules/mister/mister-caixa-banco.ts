import { somarDias } from '../../common/data';
import { DIAS_PARA_BURACO } from '../banco-repasses/banco-repasses.regras';
import { diaMes } from './mister-agente.regras';
import type { MesDaAnalise } from './mister-analises';
import { saldoVale, type DadoInformado } from './mister-indicadores';

// O CAIXA PELO EXTRATO DO BANCO (R2 da versão 8; `docs/plano-mister.md` § "Versão 8", V8-5; definições em `docs/logica-negocio.md`
// § 2.6; protótipo `mockups/regem-mister-v8.html`, "Quanto tempo de caixa eu tenho?"). Só o que é puro.
//
//  • Burn rate e runway só saem com os 3 ÚLTIMOS MESES FECHADOS completos em todas as contas. Faltando um, diz qual: nunca estima.
//  • Mês completo = os arquivos cobrem do dia 1 ao último, sem trecho de 5 dias ou mais sem lançamento em que a loja vendeu.
//  • Ficam fora da conta as transferências entre as contas da pessoa e o que ela marcou como não sendo da loja.
//  • Loja que gera caixa não tem runway: o caixa está crescendo.

export const MESES_DA_CONTA = 3;
const ONDE_IMPORTAR = 'Financeiro › Banco e repasses';
const O_QUE_FICA_FORA = 'Transferências entre as suas contas e o que você marcou como não sendo da loja.';

export interface LojaDoCaixa {
  id: string;
  nome: string;
}
export interface ContaDoCaixa {
  id: string;
  unidadeId: string;
  final: string;
  saldoCentavos: number | null;
  saldoEm: string | null;
}
export interface PeriodoDoExtrato {
  contaId: string;
  de: string;
  ate: string;
}
export interface DiaDoExtrato {
  contaId: string;
  dia: string;
  /** Sem transferência entre contas e sem "Não é da loja". */
  entrouCentavos: number;
  saiuCentavos: number;
}
export interface DiaDeVenda {
  /** Venda sem loja vale para todas (V4). */
  unidadeId: string | null;
  dia: string;
}
export interface LeituraDoCaixa {
  lojas: LojaDoCaixa[];
  contas: ContaDoCaixa[];
  periodos: PeriodoDoExtrato[];
  dias: DiaDoExtrato[];
  vendas: DiaDeVenda[];
}
export const LEITURA_VAZIA: LeituraDoCaixa = { lojas: [], contas: [], periodos: [], dias: [], vendas: [] };

export interface MesDoCaixa {
  nome: string;
  entrouCentavos: number;
  saiuCentavos: number;
}
export interface CaixaDoBanco {
  /** Os 3 meses fechados estão completos em todas as lojas. */
  pronto: boolean;
  /** Os meses completos, do mais antigo ao mais novo. */
  meses: MesDoCaixa[];
  faltam: string[];
  nomesDosMeses: string[];
  /** A soma do último saldo de cada conta, com o dia mais antigo entre eles. */
  saldo: DadoInformado | null;
  porQueSemSaldo: string | null;
}

const reais = (centavos: number): number => Math.round(centavos) / 100;

const emLista = (nomes: string[]): string => (nomes.length < 2 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`);

/** Os arquivos, juntos, cobrem todos os dias do trecho? */
export function periodosCobrem(periodos: ReadonlyArray<{ de: string; ate: string }>, de: string, ate: string): boolean {
  const ordem = periodos.filter((p) => p.ate >= de && p.de <= ate).sort((a, b) => (a.de < b.de ? -1 : a.de > b.de ? 1 : 0));
  let falta = de;
  for (const p of ordem) {
    if (p.de > falta) return false;
    if (p.ate >= falta) falta = somarDias(p.ate, 1);
    if (falta > ate) return true;
  }
  return false;
}

/** Um trecho de 5 dias ou mais sem lançamento em que a loja vendeu: o banco cortou o arquivo. Loja fechada não conta. */
export function temBuracoComVenda(comLancamento: ReadonlySet<string>, comVenda: ReadonlySet<string>, de: string, ate: string): boolean {
  let seguidos = 0;
  let vendeu = false;
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    if (comLancamento.has(d)) {
      seguidos = 0;
      vendeu = false;
      continue;
    }
    seguidos++;
    if (comVenda.has(d)) vendeu = true;
    if (seguidos >= DIAS_PARA_BURACO && vendeu) return true;
  }
  return false;
}

function saldoDoExtrato(contas: ReadonlyArray<ContaDoCaixa>, hoje: string): { saldo: DadoInformado | null; porQueSemSaldo: string | null } {
  if (!contas.length) return { saldo: null, porQueSemSaldo: null };
  if (contas.some((c) => c.saldoCentavos === null || !c.saldoEm)) return { saldo: null, porQueSemSaldo: 'O último extrato não trouxe o saldo da conta.' };
  const dia = contas.map((c) => c.saldoEm as string).sort()[0];
  if (contas.some((c) => !saldoVale(c.saldoEm as string, hoje))) {
    return { saldo: null, porQueSemSaldo: `O saldo do último extrato é de ${diaMes(dia)}, e já passou de uma semana. Para dizer quanto tempo o caixa dura, importe o extrato de hoje em ${ONDE_IMPORTAR}.` };
  }
  return { saldo: { centavos: contas.reduce((s, c) => s + (c.saldoCentavos as number), 0), dia }, porQueSemSaldo: null };
}

/** Lê o que os extratos permitem dizer sobre os 3 últimos meses fechados. */
export function caixaPeloBanco(l: LeituraDoCaixa, meses: ReadonlyArray<MesDaAnalise>, hoje: string): CaixaDoBanco {
  const nomesDosMeses = meses.map((m) => m.nome);
  if (!l.contas.length) {
    return {
      pronto: false,
      meses: [],
      nomesDosMeses,
      faltam: [`O extrato do banco de ${emLista(nomesDosMeses)}: baixe em OFX no site ou no app do banco e importe em ${ONDE_IMPORTAR}.`],
      saldo: null,
      porQueSemSaldo: null,
    };
  }

  const nomeDaLoja = new Map(l.lojas.map((x) => [x.id, x.nome]));
  const varias = l.lojas.length > 1;
  const faltam: string[] = [];
  const semConta = l.lojas.filter((x) => !l.contas.some((c) => c.unidadeId === x.id));
  if (semConta.length) faltam.push(`O extrato do banco de ${emLista(semConta.map((x) => x.nome))}: importe em ${ONDE_IMPORTAR}, com a loja escolhida no topo da tela.`);

  const fechados: MesDoCaixa[] = [];
  for (const m of meses) {
    const ruins: ContaDoCaixa[] = [];
    let entrouCentavos = 0;
    let saiuCentavos = 0;
    for (const c of l.contas) {
      const dias = l.dias.filter((d) => d.contaId === c.id && d.dia >= m.de && d.dia <= m.ate);
      const comVenda = new Set(l.vendas.filter((v) => (v.unidadeId === c.unidadeId || v.unidadeId === null) && v.dia >= m.de && v.dia <= m.ate).map((v) => v.dia));
      const cobre = periodosCobrem(l.periodos.filter((p) => p.contaId === c.id), m.de, m.ate);
      if (!cobre || temBuracoComVenda(new Set(dias.map((d) => d.dia)), comVenda, m.de, m.ate)) {
        ruins.push(c);
        continue;
      }
      for (const d of dias) {
        entrouCentavos += d.entrouCentavos;
        saiuCentavos += d.saiuCentavos;
      }
    }
    if (ruins.length) {
      const deQuem = varias ? ` de ${emLista(ruins.map((c) => nomeDaLoja.get(c.unidadeId) ?? `conta final ${c.final}`))}` : '';
      faltam.push(`O extrato completo de ${m.nome}${deQuem}: baixe em OFX no banco e importe em ${ONDE_IMPORTAR}.`);
    } else if (!semConta.length) {
      fechados.push({ nome: m.nome, entrouCentavos, saiuCentavos });
    }
  }

  const { saldo, porQueSemSaldo } = saldoDoExtrato(l.contas, hoje);
  return { pronto: !semConta.length && fechados.length === meses.length, meses: fechados, faltam, nomesDosMeses, saldo: semConta.length ? null : saldo, porQueSemSaldo };
}

const mesesNoBanco = (meses: ReadonlyArray<MesDoCaixa>) =>
  meses.map((m) => ({ mes: m.nome, entrou: reais(m.entrouCentavos), saiu: reais(m.saiuCentavos), sobrouOuFaltou: reais(m.entrouCentavos - m.saiuCentavos) }));

/** Com os 3 meses completos: o caixa de verdade. O saldo informado na conversa só entra se o extrato não tiver um saldo válido. */
export function indicadorDeCaixaPeloBanco(r: CaixaDoBanco, informado: DadoInformado | null, hoje: string): Record<string, unknown> {
  const media = Math.round(r.meses.reduce((s, m) => s + m.entrouCentavos - m.saiuCentavos, 0) / r.meses.length);
  const burn = media < 0 ? -media : 0;
  const informadoOk = !r.saldo && informado && saldoVale(informado.dia, hoje) ? informado : null;
  const saldo = r.saldo ?? informadoOk;
  // Para baixo: dizer que o caixa dura mais do que dura é o erro que custa caro.
  const runway = burn > 0 && saldo ? (saldo.centavos > 0 ? Math.floor((saldo.centavos * 10) / burn) / 10 : 0) : null;

  const avisos = [
    'A conta só enxerga o que passou no banco: o dinheiro que fica no caixa da loja e não é depositado não aparece.',
    `Transferência sua que ainda não foi marcada em ${ONDE_IMPORTAR} entra como se fosse da loja.`,
    'O que vence depois do último extrato não está nessa conta.',
  ];
  if (burn > 0 && saldo && saldo.centavos <= 0) avisos.unshift('O saldo já está zerado ou negativo.');

  const oQueFalta = burn > 0 && !saldo ? [r.porQueSemSaldo ?? `O saldo de hoje: importe o extrato em ${ONDE_IMPORTAR}.`] : [];
  return {
    alcance: 'a empresa inteira',
    fonte: 'extrato do banco',
    saldo: saldo ? { valor: reais(saldo.centavos), em: diaMes(saldo.dia), origem: r.saldo ? 'do extrato do banco' : 'veio de você, não do banco' } : null,
    mesesNoBanco: mesesNoBanco(r.meses),
    situacao: media < 0 ? 'caixa_encolhendo' : media > 0 ? 'gerando_caixa' : 'empatado',
    mediaPorMes: reais(media),
    burnRate: burn > 0 ? reais(burn) : null,
    runwayEmMeses: runway,
    ...(media >= 0 ? { porQueNaoTemRunway: 'A loja não está gastando mais do que entra: não faz sentido dizer quanto tempo o caixa dura.' } : {}),
    foraDaConta: O_QUE_FICA_FORA,
    avisos,
    ...(oQueFalta.length ? { oQueFalta } : {}),
  };
}

/** Sem os 3 meses: o que já dá para mostrar do banco e o que falta, para somar ao indicador de sempre. */
export function oQueFaltaNoBanco(r: CaixaDoBanco): Record<string, unknown> {
  return {
    porQueNaoTemRunway: `O burn rate e o runway saem do extrato do banco, com os 3 meses fechados (${emLista(r.nomesDosMeses)}) completos.`,
    faltaNoBanco: r.faltam,
    ...(r.meses.length ? { mesesNoBanco: mesesNoBanco(r.meses), foraDaContaNoBanco: O_QUE_FICA_FORA } : {}),
  };
}

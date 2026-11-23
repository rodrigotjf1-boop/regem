import { REFERENCIA } from '../perfil-cliente/efeito-do-evento';
import { somarDias } from '../perfil-cliente/calendario-regra';
import { type LinhaOficial, diaDeTrabalho } from './mister-analises';
import { type CidadeDaLoja, type EventoDaBase, type ItemDaLoja, alcanceDoEvento, diaCurto, diaDoEvento, rotuloDoDia } from './mister-clima-eventos';

// A VENDA EM DIAS ASSIM (versão 8, E2; `docs/plano-mister.md` § "Versão 8"). Cada dia do evento contra o MESMO dia da semana
// nas 8 semanas anteriores, sem evento nenhum e com a loja aberta: a mesma régua do "mexe na sua loja?" do calendário, com a
// venda oficial e o dia de trabalho do Mister (vira às 06:00). Com menos de 4 dias não sai número (V8-10). A chuva guardada é
// a PREVISÃO da véspera, não a chuva que caiu, e só se compara com cerca de 60 dias gravados.

export const TIPOS_DE_COMPARACAO = ['jogo', 'feriado', 'ponto_facultativo', 'comemorativa', 'dinheiro', 'chuva'] as const;
export type TipoDeComparacao = (typeof TIPOS_DE_COMPARACAO)[number];
/** Quantos dias para trás a comparação olha. */
export const JANELA_DA_COMPARACAO = 180;
/** V8-10: abaixo disto é pouco para dizer que é um padrão. */
export const MINIMO_DE_DIAS_PARECIDOS = 4;
export const DIAS_DE_CHUVA_PARA_COMPARAR = 60;

const NOME: Record<TipoDeComparacao, string> = {
  jogo: 'dia de jogo na cidade',
  feriado: 'feriado',
  ponto_facultativo: 'ponto facultativo',
  comemorativa: 'data comemorativa',
  dinheiro: 'dia de dinheiro no bolso',
  chuva: 'dia com chuva prevista na véspera',
};

const semAcento = (t: unknown) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/** Os dias do tipo pedido e todos os dias com algum evento (que ficam fora da referência). */
export function diasDoTipo(a: {
  tipo: TipoDeComparacao;
  nome?: unknown;
  daBase: EventoDaBase[];
  daLoja: ItemDaLoja[];
  cidade: CidadeDaLoja;
  de: string;
  ate: string;
}): { dias: Set<string>; comEvento: Set<string> } {
  const dias = new Set<string>();
  const comEvento = new Set<string>();
  const filtro = semAcento(a.nome);
  const bate = (nome: unknown) => !filtro || semAcento(nome).includes(filtro);
  for (const e of a.daBase) {
    const quando = diaDoEvento(e);
    if (!quando || quando.dia < a.de || quando.dia > a.ate) continue;
    const alcance = alcanceDoEvento(e.abrangencia, a.cidade.municipio, a.cidade.uf);
    if (!alcance) continue;
    // Jogo de outra cidade passa na TV, mas não é "dia de jogo aqui": só entra quando a pessoa pediu aquele jogo pelo nome.
    const daCidade = e.tipo !== 'jogo' || alcance === 'cidade';
    if (daCidade) comEvento.add(quando.dia);
    if (e.tipo === a.tipo && bate(e.nome) && (daCidade || !!filtro)) dias.add(quando.dia);
  }
  for (const i of a.daLoja) {
    if (i.dia < a.de || i.dia > a.ate) continue;
    comEvento.add(i.dia);
    const tipoDoItem = i.origem === 'regra' ? i.tipo : i.grupo === 'feriado' ? 'feriado' : 'loja';
    if (tipoDoItem === a.tipo && bate(i.nome)) dias.add(i.dia);
  }
  return { dias, comEvento };
}

const reais = (c: number) => Math.round(c) / 100;
const pct = (agora: number, antes: number) => Math.round((agora / antes - 1) * 1000) / 10;

/** A comparação. Dia sem venda (loja fechada) não conta nem como dia do evento nem como referência. */
export function compararDias(o: { dias: Iterable<string>; linhas: LinhaOficial[]; comEvento: Set<string>; verValores: boolean }): Record<string, unknown> {
  const porDia = new Map<string, { pedidos: number; centavos: number }>();
  for (const l of o.linhas) {
    const d = diaDeTrabalho(l.dia, l.hora);
    const x = porDia.get(d) ?? { pedidos: 0, centavos: 0 };
    x.pedidos += l.pedidos;
    x.centavos += l.centavos;
    porDia.set(d, x);
  }
  const quais: string[] = [];
  const soma = { pedidos: 0, centavos: 0, refPedidos: 0, refCentavos: 0 };
  for (const dia of [...o.dias].sort()) {
    const doDia = porDia.get(dia);
    if (!doDia?.pedidos) continue;
    const ref: { pedidos: number; centavos: number }[] = [];
    for (let k = 1; k <= REFERENCIA.semanas; k++) {
      const d = somarDias(dia, -7 * k);
      if (o.comEvento.has(d)) continue;
      const x = porDia.get(d);
      if (x?.pedidos) ref.push(x);
    }
    if (ref.length < REFERENCIA.minimoDeDias) continue;
    quais.push(dia);
    soma.pedidos += doDia.pedidos;
    soma.centavos += doDia.centavos;
    soma.refPedidos += ref.reduce((s, x) => s + x.pedidos, 0) / ref.length;
    soma.refCentavos += ref.reduce((s, x) => s + x.centavos, 0) / ref.length;
  }
  const n = quais.length;
  const base = { diasComparados: n, quais: quais.slice(-8).map(rotuloDoDia), comparadoCom: 'o mesmo dia da semana nas 8 semanas antes, sem evento e com a loja aberta' };
  if (n < MINIMO_DE_DIAS_PARECIDOS) {
    return {
      ...base,
      poucoDado: true,
      oQueFalta: n
        ? `Só ${n === 1 ? '1 dia' : `${n} dias`} para comparar. Com menos de ${MINIMO_DE_DIAS_PARECIDOS}, ainda não dá para dizer que é um padrão.`
        : 'Ainda não há dia assim com venda e dias comuns para comparar.',
    };
  }
  return {
    ...base,
    pedidosPorDia: {
      emDiasAssim: Math.round((soma.pedidos / n) * 10) / 10,
      diasComuns: Math.round((soma.refPedidos / n) * 10) / 10,
      variacaoPct: pct(soma.pedidos, soma.refPedidos),
    },
    ...(o.verValores && soma.refCentavos > 0
      ? { vendaPorDia: { emDiasAssim: reais(soma.centavos / n), diasComuns: reais(soma.refCentavos / n), variacaoPct: pct(soma.centavos, soma.refCentavos) } }
      : {}),
  };
}

/** A chuva: com menos de 60 dias gravados, diz quando vai dar. Com eles, os dias e os que ficam fora da referência. */
export function diasDeChuva(
  lidos: { dia: string; chuva: boolean }[],
  de: string,
  ate: string,
  hoje: string,
): { ainda: Record<string, unknown> } | { dias: Set<string>; foraDaReferencia: Set<string> } {
  if (lidos.length < DIAS_DE_CHUVA_PARA_COMPARAR) {
    const primeiro = lidos.map((l) => l.dia).sort()[0] ?? hoje;
    return {
      ainda: {
        ainda: true,
        diasGravados: lidos.length,
        precisaDe: DIAS_DE_CHUVA_PARA_COMPARAR,
        daParaCompararPorVoltaDe: diaCurto(somarDias(primeiro, DIAS_DE_CHUVA_PARA_COMPARAR - 1)),
        oQueFalta: `Só tenho ${lidos.length === 1 ? '1 dia' : `${lidos.length} dias`} de previsão guardados. Para comparar, preciso de cerca de ${DIAS_DE_CHUVA_PARA_COMPARAR}.`,
      },
    };
  }
  const semChuva = new Set(lidos.filter((l) => !l.chuva).map((l) => l.dia));
  const foraDaReferencia = new Set<string>();
  for (let d = somarDias(de, -7 * REFERENCIA.semanas); d <= ate; d = somarDias(d, 1)) if (!semChuva.has(d)) foraDaReferencia.add(d);
  return { dias: new Set(lidos.filter((l) => l.chuva).map((l) => l.dia)), foraDaReferencia };
}

export const nomeDaComparacao = (t: TipoDeComparacao) => NOME[t];

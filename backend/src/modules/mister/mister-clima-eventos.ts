import { diaDaSemana, diaValido, diasEntre, somarDias } from '../perfil-cliente/calendario-regra';
import { FUSO_OPERACAO } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CLIMA E EVENTOS NA CONVERSA (versão 8, E1; `docs/plano-mister.md` § "Versão 8"; protótipo `mockups/regem-mister-v8.html`).
// Só o que é puro: o período, o dia e a hora de cada evento, se ele vale na cidade da loja, o que cada previsão diz e a agenda
// pronta para o modelo. A previsão não traz milímetros nem hora da chuva, e aqui nada é estimado.

export const DIAS_DA_AGENDA = { padrao: 7, maximo: 16 } as const;
const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const NOME_DO_TIPO: Record<string, string> = {
  feriado: 'Feriado',
  ponto_facultativo: 'Ponto facultativo',
  comemorativa: 'Data comemorativa',
  dinheiro: 'Dinheiro no bolso',
  jogo: 'Jogo',
  loja: 'Da loja',
};

export const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const rotuloDoDia = (d: string) => `${NOME_DO_DIA[diaDaSemana(d)]}, ${diaCurto(d)}`;

/** O período pedido: um dia, ou de hoje a N dias (7, até 16). Dia passado ou inválido volta o motivo. */
export function periodoDaAgenda(en: { dia?: unknown; dias?: unknown }, hoje: string): { de: string; ate: string } | { erro: string } {
  if (en.dia !== undefined && en.dia !== null && en.dia !== '') {
    if (!diaValido(en.dia)) return { erro: 'Diga o dia no formato AAAA-MM-DD.' };
    if (en.dia < hoje) return { erro: 'Esta consulta olha de hoje para a frente.' };
    if (diasEntre(hoje, en.dia) >= 120) return { erro: 'Consigo olhar até 120 dias para a frente.' };
    return { de: en.dia, ate: en.dia };
  }
  const n = Math.floor(Number(en.dias));
  const dias = Number.isFinite(n) && n >= 1 ? Math.min(n, DIAS_DA_AGENDA.maximo) : DIAS_DA_AGENDA.padrao;
  return { de: hoje, ate: somarDias(hoje, dias - 1) };
}

export type EventoDaBase = {
  id?: string;
  tipo: string;
  nome: string | null;
  dia_inteiro: boolean;
  inicio: string | null;
  fuso: string | null;
  abrangencia: any;
  situacao: string;
};

const noFuso = (instante: Date, fuso: string): { dia: string; hora: string } | null => {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instante);
    const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
  } catch {
    return null;
  }
};

/** O dia e a hora do evento no relógio da loja: o jogo das 21h de segunda vem da base como 00:00 de terça em UTC. */
export function diaDoEvento(e: Pick<EventoDaBase, 'dia_inteiro' | 'inicio' | 'fuso'>): { dia: string; hora: string | null } | null {
  const inicio = String(e.inicio ?? '');
  if (e.dia_inteiro || /^\d{4}-\d{2}-\d{2}$/.test(inicio)) return diaValido(inicio.slice(0, 10)) ? { dia: inicio.slice(0, 10), hora: null } : null;
  const instante = new Date(inicio);
  if (Number.isNaN(instante.getTime())) return null;
  return noFuso(instante, e.fuso || FUSO_OPERACAO) ?? noFuso(instante, FUSO_OPERACAO);
}

/** Onde o evento vale para esta loja: na cidade, no estado, no país, ou null (só de outro lugar, ou só de um time). */
export function alcanceDoEvento(abrangencia: unknown, municipio: number | null, uf: string | null): 'cidade' | 'estado' | 'nacional' | null {
  const lista: any[] = Array.isArray(abrangencia) ? abrangencia : [];
  const de = (nivel: string[]) => lista.filter((a) => nivel.includes(String(a?.nivel ?? '').toLowerCase())).map((a) => String(a?.valor ?? '').toUpperCase());
  if (municipio != null && de(['municipio']).includes(String(municipio))) return 'cidade';
  if (uf && de(['uf', 'estado']).includes(uf.toUpperCase())) return 'estado';
  if (de(['nacional']).length) return 'nacional';
  return null;
}

export type FonteDaPrevisao = { resumo: string | null; minima: number | null; maxima: number | null; chuva: boolean | null };

const numeroOuNulo = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** O que uma fonte diz do dia. Sem nada aproveitável: null. */
export function previsaoDaFonte(v: any): FonteDaPrevisao | null {
  if (!v || typeof v !== 'object') return null;
  const resumo = typeof v.resumo === 'string' && v.resumo.trim() ? v.resumo.trim().slice(0, 120) : null;
  const minima = numeroOuNulo(v.minima);
  const maxima = numeroOuNulo(v.maxima);
  const chuva = typeof v.chuva_prevista === 'boolean' ? v.chuva_prevista : null;
  return resumo == null && minima == null && maxima == null && chuva == null ? null : { resumo, minima, maxima, chuva };
}

export type LeituraDaChuva = 'as_duas_dao_chuva' | 'as_duas_sem_chuva' | 'discordam' | 'so_uma_fonte' | 'sem_dado';

/** As duas previsões juntas. Quando discordam, nenhuma vence (V8-8). */
export function leituraDaChuva(inmet: FonteDaPrevisao | null, cptec: FonteDaPrevisao | null): LeituraDaChuva {
  const a = inmet?.chuva ?? null;
  const b = cptec?.chuva ?? null;
  if (a === null && b === null) return 'sem_dado';
  if (a === null || b === null) return 'so_uma_fonte';
  if (a !== b) return 'discordam';
  return a ? 'as_duas_dao_chuva' : 'as_duas_sem_chuva';
}

export type CidadeDaEmpresa = { tenantId: string; unidadeId: string | null; municipio: number; uf: string | null };
export type LinhaDaAgenda = { id: string; alvoId: string; tenantId: string; unidadeId: string | null; rotulo: string; campos: Record<string, unknown> };

/**
 * A fonte `agenda` das regras (versão 8, E3): cada evento dos próximos dias que vale na cidade de cada loja. O jogo de fora
 * da cidade entra com `na_cidade = false`: "o meu time" pode jogar em outro lugar, e a pessoa pede pelo nome.
 */
export function linhasDaAgenda(cidades: CidadeDaEmpresa[], eventos: EventoDaBase[], hoje: string, ate: string): LinhaDaAgenda[] {
  const fora: LinhaDaAgenda[] = [];
  for (const c of cidades) {
    for (const e of eventos) {
      const quando = diaDoEvento(e);
      if (!e.id || !e.nome || !quando || quando.dia < hoje || quando.dia > ate) continue;
      const alcance = alcanceDoEvento(e.abrangencia, c.municipio, c.uf);
      if (!alcance) continue;
      fora.push({
        id: e.id,
        alvoId: e.id,
        tenantId: c.tenantId,
        unidadeId: c.unidadeId,
        rotulo: `${e.nome} · ${rotuloDoDia(quando.dia)}${quando.hora ? ` às ${quando.hora}` : ''}`,
        campos: { tipo: e.tipo, nome: e.nome, dias_para: diasEntre(hoje, quando.dia), na_cidade: alcance === 'cidade' },
      });
    }
  }
  return fora;
}

export type ClimaLido = { dia: string; inmet: any; cptec: any };
export type ItemDaLoja = { dia: string; grupo: string; tipo: string; nome: string; origem: string; hora?: string | null };
export type EventoNaAgenda = { tipo: string; nome: string; hora?: string; alcance?: 'cidade' | 'estado' | 'nacional'; aConfirmar?: true };
export type CidadeDaLoja = { situacao: 'ok' | 'sem_cidade' | 'varias_cidades'; municipio: number | null; uf: string | null };

const QUEM_NAO_REPETE = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const MENSAGEM_SEM_CIDADE =
  'Falta o município da loja: preencha o "Código IBGE do município" em Financeiro › Configuração para o Mister ver a previsão.';
const MENSAGEM_VARIAS_CIDADES = 'As lojas ficam em cidades diferentes: pergunte de qual loja é a previsão.';
const MENSAGEM_SEM_LEITURA = 'Ainda não tenho a previsão desta cidade: ela chega na próxima leitura da manhã.';

/**
 * A agenda de cada dia. Os eventos vêm da base nacional; sem ela no período, da regra fixa do calendário. O que a loja
 * cadastrou entra sempre, sem repetir o que já veio da base pelo nome. Dia sem nada fica de fora, menos quando se pediu um dia só.
 */
export function montarAgenda(a: {
  de: string;
  ate: string;
  hoje: string;
  loja: string;
  cidade: CidadeDaLoja;
  daBase: EventoDaBase[];
  daLoja: ItemDaLoja[];
  clima: ClimaLido[];
}): Record<string, unknown> {
  const porDia = new Map<string, EventoNaAgenda[]>();
  const nomes = new Map<string, Set<string>>();
  const guardar = (dia: string, e: EventoNaAgenda) => {
    const chave = QUEM_NAO_REPETE(e.nome);
    if (nomes.get(dia)?.has(chave)) return;
    nomes.set(dia, (nomes.get(dia) ?? new Set()).add(chave));
    porDia.set(dia, [...(porDia.get(dia) ?? []), e]);
  };
  let daBaseNoPeriodo = 0;
  for (const e of a.daBase) {
    const quando = diaDoEvento(e);
    if (!quando || quando.dia < a.de || quando.dia > a.ate || !e.nome) continue;
    const alcance = alcanceDoEvento(e.abrangencia, a.cidade.municipio, a.cidade.uf);
    if (!alcance) continue;
    daBaseNoPeriodo += 1;
    guardar(quando.dia, {
      tipo: NOME_DO_TIPO[e.tipo] ?? 'Evento',
      nome: e.nome,
      ...(quando.hora ? { hora: quando.hora } : {}),
      ...(e.tipo === 'jogo' ? { alcance } : {}),
      ...(e.situacao !== 'confirmado' ? { aConfirmar: true as const } : {}),
    });
  }
  for (const i of a.daLoja) {
    if (i.dia < a.de || i.dia > a.ate) continue;
    if (i.origem === 'regra' && daBaseNoPeriodo > 0) continue;
    guardar(i.dia, { tipo: NOME_DO_TIPO[i.origem === 'regra' ? i.tipo : 'loja'] ?? NOME_DO_TIPO[i.grupo] ?? 'Evento', nome: i.nome, ...(i.hora ? { hora: i.hora } : {}) });
  }
  const climaPorDia = new Map(a.clima.map((c) => [c.dia, c]));
  const dias: Record<string, unknown>[] = [];
  for (let d = a.de; d <= a.ate; d = somarDias(d, 1)) {
    const c = climaPorDia.get(d);
    const inmet = previsaoDaFonte(c?.inmet);
    const cptec = previsaoDaFonte(c?.cptec);
    const temClima = !!(inmet || cptec);
    const eventos = (porDia.get(d) ?? []).sort((x, y) => (x.hora ?? '').localeCompare(y.hora ?? ''));
    if (!temClima && !eventos.length && a.de !== a.ate) continue;
    dias.push({
      dia: d,
      rotulo: rotuloDoDia(d),
      ...(d === a.hoje ? { ehHoje: true } : {}),
      eventos,
      previsao: temClima ? { inmet, cptec, chuva: leituraDaChuva(inmet, cptec) } : null,
    });
  }
  const comPrevisao = a.clima.filter((c) => previsaoDaFonte(c.inmet) || previsaoDaFonte(c.cptec)).map((c) => c.dia).sort();
  const ultima = comPrevisao.at(-1) ?? null;
  const situacaoDaPrevisao = a.cidade.situacao !== 'ok' ? a.cidade.situacao : comPrevisao.length ? 'ok' : 'sem_leitura';
  const avisos: string[] = [];
  if (situacaoDaPrevisao === 'sem_cidade') avisos.push(MENSAGEM_SEM_CIDADE);
  if (situacaoDaPrevisao === 'varias_cidades') avisos.push(MENSAGEM_VARIAS_CIDADES);
  if (situacaoDaPrevisao === 'sem_leitura') avisos.push(MENSAGEM_SEM_LEITURA);
  if (ultima && ultima < a.ate) avisos.push(`A previsão só vai até ${diaCurto(ultima)}.`);
  return {
    loja: a.loja,
    periodo: a.de === a.ate ? rotuloDoDia(a.de) : `de ${diaCurto(a.de)} a ${diaCurto(a.ate)}`,
    situacaoDaPrevisao,
    dias,
    ...(avisos.length ? { avisos } : {}),
    ...(comPrevisao.length ? { fontesDaPrevisao: 'INMET e CPTEC/INPE' } : {}),
  };
}

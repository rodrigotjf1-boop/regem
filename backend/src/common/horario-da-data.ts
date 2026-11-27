/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O HORÁRIO DE UMA DATA (dias especiais e feriados — fase H1, protótipo `mockups/regem-dias-especiais.html`, aprovado pelo
 * dono em 27/11/2026). Até aqui o horário da loja era só por dia da semana (`cardapio_config.horarios` e
 * `horarios_retirada`): no Natal o cardápio abria, o agendado oferecia janela e o atendente dizia "sexta abrimos às 18:00".
 *
 * A regra, uma só para o cardápio, o agendado, o pedido e o atendente: as aberturas que COMEÇAM numa data são as do dia
 * especial que cobre a data (fechada = nenhuma; outro horário = a dele; horário normal = as da semana), senão as do dia da
 * semana. A madrugada de uma abertura que vira a meia-noite continua sendo da data em que ela começou (o Natal fechado não
 * corta o fim da véspera às 00:00). Sem horário da semana cadastrado, a loja vale o dia inteiro, como sempre — a não ser
 * que um dia especial diga outra coisa.
 *
 * Datas em "AAAA-MM-DD" e horas em "HH:MM", sempre de São Paulo. Funções puras: quem chama lê os dias especiais da loja.
 */

export type FuncionamentoEspecial = 'fechada' | 'horario' | 'normal';
export type ConjuntoEspecial = 'todos' | 'entrega' | 'retirada';

export type DiaEspecialDoHorario = {
  id?: string;
  data: string;
  /** Último dia do período (inclusive); nulo = só a `data`. */
  dataFim: string | null;
  nome: string;
  funcionamento: FuncionamentoEspecial;
  abre: string | null;
  fecha: string | null;
  /** A que horário o dia especial vale: os dois (todos), só o da entrega ou só o da retirada/consumo no local. */
  conjunto: ConjuntoEspecial;
  avisoAntes?: boolean;
  pausarCanais?: boolean;
};

export type Abertura = { abre: string; fecha: string };

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const NOME_DO_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "AAAA-MM-DD" + n dias. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado (o mesmo `dia` do cadastro de horários). */
export const diaDaSemanaDe = (dia: string): number => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** "dd/mm". */
export const diaCurto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** Agora em São Paulo: a data e a hora ("HH:MM"). */
export function agoraEmSaoPaulo(agora: Date = new Date()): { dia: string; hhmm: string } {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { dia: `${sp.getFullYear()}-${p2(sp.getMonth() + 1)}-${p2(sp.getDate())}`, hhmm: `${p2(sp.getHours())}:${p2(sp.getMinutes())}` };
}

/** O conjunto que vale para o tipo do pedido: a entrega usa o da entrega; a retirada e o consumo no local, o da retirada. */
const conjuntoDoTipo = (tipo?: string | null): 'entrega' | 'retirada' => (tipo === 'retirada' || tipo === 'local' ? 'retirada' : 'entrega');

/** Os dias especiais que valem para o tipo do pedido (os de "todos" e os do conjunto dele). */
export function especiaisDoTipo(especiais: readonly DiaEspecialDoHorario[] | null | undefined, tipo?: string | null): DiaEspecialDoHorario[] {
  const c = conjuntoDoTipo(tipo);
  return (Array.isArray(especiais) ? especiais : []).filter((e) => e && (e.conjunto === 'todos' || e.conjunto === c));
}

/**
 * O dia especial que cobre a data (já filtrado pelo tipo). Dois cobrindo a mesma data: vale o de início mais recente; com o
 * mesmo início (o par que nasce da loja e da nuvem — sem índice único, ERR-640), vale o que veio PRIMEIRO na lista: a
 * leitura (`lerDiasEspeciais`) põe o alterado por último na frente, e a ordenação aqui é estável.
 */
export function especialDaData(especiais: readonly DiaEspecialDoHorario[] | null | undefined, dia: string): DiaEspecialDoHorario | null {
  const cobre = (Array.isArray(especiais) ? especiais : []).filter(
    (e) => e && DATA.test(e.data) && e.data <= dia && (e.dataFim && DATA.test(e.dataFim) ? e.dataFim : e.data) >= dia,
  );
  if (!cobre.length) return null;
  return cobre.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))[0];
}

/** As aberturas do dia da semana (só as ativas e com as duas horas válidas), na ordem. */
function daSemana(semana: readonly any[], dia: string): Abertura[] {
  const d = diaDaSemanaDe(dia);
  return semana
    .filter((h) => h && h.ativo !== false && Number(h.dia) === d && HORA.test(String(h.abre)) && HORA.test(String(h.fecha)))
    .map((h) => ({ abre: String(h.abre), fecha: String(h.fecha) }))
    .sort((a, b) => a.abre.localeCompare(b.abre));
}

/**
 * As aberturas que COMEÇAM na data, ou `'dia_inteiro'` (a loja sem horário da semana cadastrado e sem dia especial que
 * mude a data). `semana` = o conjunto do tipo (`horarios` ou `horarios_retirada`); `especiais` já filtrados pelo tipo.
 */
export function aberturasDoDia(
  semana: readonly any[] | null | undefined,
  especiais: readonly DiaEspecialDoHorario[] | null | undefined,
  dia: string,
): Abertura[] | 'dia_inteiro' {
  const lista = Array.isArray(semana) ? semana : [];
  const e = especialDaData(especiais, dia);
  if (e?.funcionamento === 'fechada') return [];
  if (e?.funcionamento === 'horario' && HORA.test(String(e.abre)) && HORA.test(String(e.fecha)))
    return [{ abre: String(e.abre), fecha: String(e.fecha) }];
  if (!lista.length) return 'dia_inteiro';
  return daSemana(lista, dia);
}

const vira = (a: Abertura) => a.fecha <= a.abre;

/**
 * A abertura em que a loja está AGORA, `'dia_inteiro'` (sem horário cadastrado) ou `null` (fechada). A de hoje, ou a de
 * ontem que virou a meia-noite e ainda não fechou.
 */
export function aberturaDeAgora(
  semana: readonly any[] | null | undefined,
  especiais: readonly DiaEspecialDoHorario[] | null | undefined,
  agora: Date = new Date(),
): Abertura | 'dia_inteiro' | null {
  const { dia, hhmm } = agoraEmSaoPaulo(agora);
  const hoje = aberturasDoDia(semana, especiais, dia);
  if (hoje === 'dia_inteiro') return 'dia_inteiro';
  const deHoje = hoje.find((a) => (vira(a) ? hhmm >= a.abre : hhmm >= a.abre && hhmm <= a.fecha));
  if (deHoje) return deHoje;
  const ontem = aberturasDoDia(semana, especiais, somarDias(dia, -1));
  if (ontem === 'dia_inteiro') return null;
  return ontem.find((a) => vira(a) && hhmm <= a.fecha) ?? null;
}

/**
 * A próxima abertura: "18:00" (hoje mais tarde), "sex 18:00" (nos próximos 6 dias) ou "15/01 18:00" (mais longe — um
 * período fechado pode passar de uma semana). Olha até 21 dias; nada = `null`. O mesmo formato do "Abre às…" de antes.
 */
export function proximaAberturaDaData(
  semana: readonly any[] | null | undefined,
  especiais: readonly DiaEspecialDoHorario[] | null | undefined,
  agora: Date = new Date(),
): string | null {
  const { dia, hhmm } = agoraEmSaoPaulo(agora);
  for (let d = 0; d < 21; d++) {
    const data = somarDias(dia, d);
    const ab = aberturasDoDia(semana, especiais, data);
    if (ab === 'dia_inteiro') return d === 0 ? null : d < 7 ? `${NOME_DO_DIA[diaDaSemanaDe(data)]} 00:00` : `${diaCurto(data)} 00:00`;
    const proxima = ab.filter((a) => d > 0 || a.abre > hhmm)[0];
    if (proxima) return d === 0 ? proxima.abre : d < 7 ? `${NOME_DO_DIA[diaDaSemanaDe(data)]} ${proxima.abre}` : `${diaCurto(data)} ${proxima.abre}`;
  }
  return null;
}

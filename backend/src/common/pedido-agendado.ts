// O PEDIDO AGENDADO (D4, 18/11/2026 — protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 2, decisões
// G1–G10 aprovadas pelo dono em 16/11 com as recomendadas; "pode" em 18/11).
//
// G1: ajuste próprio, em cima das peças da encomenda — o pedido usa a coluna `agendamento` que já existe e se distingue
//     pela `retirada_tipo = 'agendado'` (a encomenda usa 'encomenda'); a encomenda não muda para quem já usa.
// G2: o cliente escolhe o DIA e a lista das janelas de 15 min ("19:30" = chega entre 19:30 e 19:45).
// G3: entra em preparo o tempo de entrega (ou de retirada) da loja antes do horário — o mesmo número do "O quanto antes".
// G7: a pausa segura só pedido novo — as janelas cujo preparo começaria durante a pausa deixam de ser oferecidas.
// G9: o limite por janela conta só os pedidos agendados daquela janela.
// G10: valores de fábrica — antecedência de 45 min, hoje e amanhã, 4 pedidos por janela, janela fixa de 15 min.
//
// Hora de São Paulo com o deslocamento FIXO de −03:00 (o Brasil não tem horário de verão desde 2019): o checkout manda
// "AAAA-MM-DDTHH:MM" sem fuso; aqui ele vira o instante certo (a nuvem roda em UTC).

export const JANELA_MIN = 15;
export const ANTECEDENCIAS_MIN = [30, 45, 60, 90, 120] as const;
export const DIAS_A_FRENTE = [0, 1, 2, 3, 7] as const;
/** null = sem limite. */
export const LIMITES_POR_JANELA = [2, 3, 4, 6, 8, null] as const;
export const PADRAO = { antecedenciaMin: 45, dias: 1, limite: 4 as number | null };

const OFFSET_SP = '-03:00';
const MIN = 60_000;

export type HorarioDoDia = { dia?: number | string; ativo?: boolean; abre?: string; fecha?: string };
export type AjustesDoAgendado = { ativo: boolean; antecedenciaMin: number; dias: number; limite: number | null };

/** Os ajustes gravados → os de trabalho (fora da lista = o padrão). */
export function ajustesDoAgendado(cfg: any): AjustesDoAgendado {
  const ant = Number(cfg?.agendadoAntecedenciaMin);
  const dias = Number(cfg?.agendadoDias);
  const lim = cfg?.agendadoLimiteJanela;
  return {
    ativo: cfg?.agendadoAtivo === true,
    antecedenciaMin: (ANTECEDENCIAS_MIN as readonly number[]).includes(ant) ? ant : PADRAO.antecedenciaMin,
    dias: (DIAS_A_FRENTE as readonly number[]).includes(dias) ? dias : PADRAO.dias,
    limite: lim == null ? null : (LIMITES_POR_JANELA as readonly (number | null)[]).includes(Number(lim)) ? Number(lim) : PADRAO.limite,
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "AAAA-MM-DDTHH:MM" (hora de São Paulo) → o instante. Fora do formato ou data inexistente = null. */
export function instanteDeSaoPaulo(diaHora: unknown): Date | null {
  const s = String(diaHora ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}:00${OFFSET_SP}`);
  if (isNaN(d.getTime())) return null;
  // Confere que a data existe (30/02 vira 02/03 no Date): a volta tem de dar o mesmo texto.
  return emSaoPaulo(d).diaHora === s ? d : null;
}

/** O instante na hora de São Paulo: o dia ("AAAA-MM-DD"), a hora ("HH:MM"), "AAAA-MM-DDTHH:MM" e o dia da semana (0 = dom). */
export function emSaoPaulo(d: Date): { dia: string; hora: string; diaHora: string; semana: number } {
  const x = new Date(d.getTime() - 3 * 3600_000);
  const dia = `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`;
  const hora = `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
  return { dia, hora, diaHora: `${dia}T${hora}`, semana: x.getUTCDay() };
}

/** "AAAA-MM-DD" + n dias. */
export function somarDiasAoDia(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Os dias que o cliente pode escolher: hoje (São Paulo) até `dias` à frente. */
export function diasPermitidos(agora: Date, dias: number): string[] {
  const hoje = emSaoPaulo(agora).dia;
  return Array.from({ length: dias + 1 }, (_, i) => somarDiasAoDia(hoje, i));
}

/**
 * Os trechos em que a loja ATENDE no dia (de São Paulo), em instantes: os horários do próprio dia (o que vira a meia-noite
 * vai até a madrugada seguinte) e o fim de madrugada do horário de ontem que virou a meia-noite. Sem horário cadastrado =
 * o dia inteiro (a mesma regra do cardápio: sem horários, sempre aberta).
 */
export function trechosDoDia(horarios: HorarioDoDia[] | null | undefined, dia: string): Array<{ inicio: Date; fim: Date }> {
  const lista = Array.isArray(horarios) ? horarios : [];
  const em = (d: string, hhmm: string) => instanteDeSaoPaulo(`${d}T${hhmm}`)!;
  if (!lista.length) return [{ inicio: em(dia, '00:00'), fim: em(somarDiasAoDia(dia, 1), '00:00') }];
  const semana = emSaoPaulo(em(dia, '12:00')).semana;
  const ontem = (semana + 6) % 7;
  const validos = lista.filter((h) => h && h.ativo !== false && /^\d{2}:\d{2}$/.test(String(h.abre)) && /^\d{2}:\d{2}$/.test(String(h.fecha)));
  const out: Array<{ inicio: Date; fim: Date }> = [];
  for (const h of validos.filter((x) => Number(x.dia) === ontem && String(x.fecha) <= String(x.abre)))
    out.push({ inicio: em(dia, '00:00'), fim: em(dia, String(h.fecha)) });
  for (const h of validos.filter((x) => Number(x.dia) === semana)) {
    const vira = String(h.fecha) <= String(h.abre);
    out.push({ inicio: em(dia, String(h.abre)), fim: vira ? em(somarDiasAoDia(dia, 1), String(h.fecha)) : em(dia, String(h.fecha)) });
  }
  return out.filter((t) => t.fim.getTime() > t.inicio.getTime());
}

export type Janela = {
  /** "AAAA-MM-DDTHH:MM" (São Paulo) — o valor que o checkout manda. */
  valor: string;
  hora: string;
  /** "19:30 às 19:45". */
  rotulo: string;
  ocupados: number;
  esgotada: boolean;
};

/**
 * As janelas de 15 min do dia que o cliente pode escolher (G2, G3, G7, G9):
 *  • dentro de um trecho em que a loja atende: o preparo começa no trecho (horário − tempo de preparo ≥ início) e a
 *    janela termina até o fim dele;
 *  • com a antecedência mínima a partir de agora (e nunca com o preparo já devendo ter começado);
 *  • fora da pausa: o preparo não começa antes do fim dela;
 *  • a janela cheia vem `esgotada` (aparece riscada, não se escolhe).
 * `ocupacao` = quantos pedidos agendados já há em cada janela (pelo `valor`).
 *
 * O atendimento que atravessa a meia-noite é UM trecho (ERR-552): os trechos da véspera e do dia se juntam quando se
 * encostam ou se cruzam — senão a janela das 00:00 (e as primeiras da madrugada, na loja das 18h às 02h) sumia, porque o
 * preparo dela começa antes da meia-noite, no trecho do "outro dia".
 */
export function trechosContinuos(horarios: HorarioDoDia[] | null | undefined, dia: string): Array<{ inicio: Date; fim: Date }> {
  const todos = [...trechosDoDia(horarios, somarDiasAoDia(dia, -1)), ...trechosDoDia(horarios, dia)].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const out: Array<{ inicio: Date; fim: Date }> = [];
  for (const t of todos) {
    const ult = out[out.length - 1];
    if (ult && t.inicio.getTime() <= ult.fim.getTime()) {
      if (t.fim.getTime() > ult.fim.getTime()) ult.fim = t.fim;
    } else out.push({ inicio: t.inicio, fim: t.fim });
  }
  return out;
}

export function janelasDoDia(p: {
  horarios: HorarioDoDia[] | null | undefined;
  dia: string;
  agora: Date;
  antecedenciaMin: number;
  preparoMin: number;
  limite: number | null;
  ocupacao?: Map<string, number>;
  pausaAte?: Date | null;
}): Janela[] {
  const passo = JANELA_MIN * MIN;
  const preparo = Math.max(0, Number(p.preparoMin) || 0) * MIN;
  const minimo = p.agora.getTime() + Math.max(p.antecedenciaMin * MIN, preparo);
  const vistos = new Set<string>();
  const out: Janela[] = [];
  for (const t of trechosContinuos(p.horarios, p.dia)) {
    let ini = Math.max(t.inicio.getTime() + preparo, minimo);
    if (p.pausaAte) ini = Math.max(ini, p.pausaAte.getTime() + preparo);
    ini = Math.ceil(ini / passo) * passo; // na grade de 15 min (São Paulo tem deslocamento de horas inteiras)
    for (let x = ini; x + passo <= t.fim.getTime(); x += passo) {
      const sp = emSaoPaulo(new Date(x));
      if (sp.dia !== p.dia || vistos.has(sp.diaHora)) continue;
      vistos.add(sp.diaHora);
      const ocupados = p.ocupacao?.get(sp.diaHora) ?? 0;
      out.push({
        valor: sp.diaHora,
        hora: sp.hora,
        rotulo: `${sp.hora} às ${emSaoPaulo(new Date(x + passo)).hora}`,
        ocupados,
        esgotada: p.limite != null && ocupados >= p.limite,
      });
    }
  }
  return out.sort((a, b) => a.valor.localeCompare(b.valor));
}

/** As duas janelas livres mais perto da pedida (o atendente oferece estas quando a pedida encheu). */
export function janelasMaisPerto(janelas: Janela[], valor: string, n = 2): Janela[] {
  const alvo = instanteDeSaoPaulo(valor)?.getTime() ?? 0;
  return janelas
    .filter((j) => !j.esgotada && j.valor !== valor)
    .sort((a, b) => Math.abs(instanteDeSaoPaulo(a.valor)!.getTime() - alvo) - Math.abs(instanteDeSaoPaulo(b.valor)!.getTime() - alvo))
    .slice(0, n)
    .sort((a, b) => a.valor.localeCompare(b.valor));
}

export type ConferenciaDoHorario =
  | { ok: true; janela: Janela; instante: Date }
  | { ok: false; motivo: 'desligado' | 'formato' | 'dia' | 'fora' | 'esgotada'; mensagem: string; sugestoes: Janela[] };

/**
 * Confere o horário pedido (o servidor confere tudo de novo — a tela só ajuda): ligado, no formato, no dia permitido,
 * numa janela oferecida e não esgotada. A mensagem vai ao cliente; as sugestões são as livres mais perto.
 */
export function conferirHorario(p: {
  ajustes: AjustesDoAgendado;
  valor: unknown;
  horarios: HorarioDoDia[] | null | undefined;
  agora: Date;
  preparoMin: number;
  ocupacao?: Map<string, number>;
  pausaAte?: Date | null;
}): ConferenciaDoHorario {
  const nao = (motivo: Extract<ConferenciaDoHorario, { ok: false }>['motivo'], mensagem: string, sugestoes: Janela[] = []) =>
    ({ ok: false, motivo, mensagem, sugestoes }) as const;
  if (!p.ajustes.ativo) return nao('desligado', 'Esta loja não aceita pedido agendado.');
  const instante = instanteDeSaoPaulo(p.valor);
  if (!instante) return nao('formato', 'Escolha o dia e o horário do pedido agendado.');
  const valor = String(p.valor);
  const dia = valor.slice(0, 10);
  if (!diasPermitidos(p.agora, p.ajustes.dias).includes(dia))
    return nao('dia', p.ajustes.dias === 0 ? 'O pedido agendado vale só para hoje.' : `O pedido agendado vale até ${p.ajustes.dias === 1 ? 'amanhã' : `${p.ajustes.dias} dias à frente`}.`);
  const janelas = janelasDoDia({ horarios: p.horarios, dia, agora: p.agora, antecedenciaMin: p.ajustes.antecedenciaMin, preparoMin: p.preparoMin, limite: p.ajustes.limite, ocupacao: p.ocupacao, pausaAte: p.pausaAte });
  const j = janelas.find((x) => x.valor === valor);
  if (!j) return nao('fora', `O horário das ${valor.slice(11)} não está disponível. Escolha outro.`, janelasMaisPerto(janelas, valor));
  if (j.esgotada) return nao('esgotada', `O horário das ${j.hora} já encheu. Escolha outro.`, janelasMaisPerto(janelas, valor));
  return { ok: true, janela: j, instante };
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * Como o horário agendado aparece para o cliente: "hoje, 19:30", "amanhã, 19:30" ou "sáb 22/11, 19:30", com a hora e o
 * fim da janela ("19:45").
 */
export function quandoDoAgendado(agendamento: Date, agora: Date = new Date()): { texto: string; hora: string; ate: string } {
  const sp = emSaoPaulo(agendamento);
  const hoje = emSaoPaulo(agora).dia;
  const ate = emSaoPaulo(new Date(agendamento.getTime() + JANELA_MIN * MIN)).hora;
  const dia =
    sp.dia === hoje ? 'hoje' : sp.dia === somarDiasAoDia(hoje, 1) ? 'amanhã' : `${SEMANA[sp.semana]} ${sp.dia.slice(8, 10)}/${sp.dia.slice(5, 7)}`;
  return { texto: `${dia}, ${sp.hora}`, hora: sp.hora, ate };
}

/**
 * O horário como opção para o cliente tocar no WhatsApp (D4c) — "Hoje 19:30", "Amanhã 12:00" ou "22/11 12:00" —, que o
 * `horarioDoTexto` lê de volta. `valor` = "AAAA-MM-DDTHH:MM" de São Paulo.
 */
export function rotuloDaJanela(valor: string, agora: Date = new Date()): string {
  const dia = String(valor).slice(0, 10);
  const hora = String(valor).slice(11, 16);
  const hoje = emSaoPaulo(agora).dia;
  if (dia === hoje) return `Hoje ${hora}`;
  if (dia === somarDiasAoDia(hoje, 1)) return `Amanhã ${hora}`;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${hora}`;
}

const sem = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * O horário que o cliente disse ao atendente (D4c) → "AAAA-MM-DDTHH:MM" de São Paulo, ou `{ tirar: true }` ("o quanto
 * antes", "sem agendar"), ou null quando não dá para entender. Aceita "19:30", "19h30", "19h", "hoje 19:30", "amanhã às
 * 20h", "depois de amanhã 19:00" e "dd/mm 19:30". Sem dia: hoje (o servidor confere se a janela ainda serve).
 */
export function horarioDoTexto(texto: unknown, agora: Date = new Date()): { valor: string } | { tirar: true } | null {
  const t = sem(texto);
  if (!t) return null;
  if (/^(tirar|sem agendar|nao agendar|o quanto antes|quanto antes|agora|cancelar agendamento|desmarcar)$/.test(t)) return { tirar: true };
  const h = /(\d{1,2})\s*(?::|h)\s*(\d{2})?|(\d{1,2})\s*horas?/.exec(t);
  if (!h) return null;
  const hh = Number(h[1] ?? h[3]);
  const mm = Number(h[2] ?? 0);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  const hoje = emSaoPaulo(agora).dia;
  let dia = hoje;
  if (/depois de amanha/.test(t)) dia = somarDiasAoDia(hoje, 2);
  else if (/amanha/.test(t)) dia = somarDiasAoDia(hoje, 1);
  else {
    const d = /(\d{1,2})\/(\d{1,2})/.exec(t);
    if (d) {
      const ano = Number(hoje.slice(0, 4));
      const cand = `${ano}-${p2(Number(d[2]))}-${p2(Number(d[1]))}`;
      dia = cand < hoje ? `${ano + 1}${cand.slice(4)}` : cand;
    }
  }
  return { valor: `${dia}T${p2(hh)}:${p2(mm)}` };
}

/** Quando o preparo começa (G3): o horário menos o tempo de entrega (ou de retirada) da loja. */
export function inicioDoPreparo(agendamento: Date, preparoMin: number): Date {
  return new Date(agendamento.getTime() - Math.max(0, Number(preparoMin) || 0) * MIN);
}

/** O tempo de preparo do tipo (G3): retirada/local = o de retirada; entrega = o de entrega (padrão 40 e 20). */
export function preparoDoTipo(cfg: any, tipo: unknown): number {
  const t = String(tipo ?? '');
  const n = t === 'retirada' || t === 'local' ? Number(cfg?.tempoRetiradaMin) : Number(cfg?.tempoEntregaMin);
  return Number.isFinite(n) && n > 0 ? n : t === 'retirada' || t === 'local' ? 20 : 40;
}

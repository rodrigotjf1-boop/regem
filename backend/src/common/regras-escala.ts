// Regras trabalhistas (CLT) da escala — funções PURAS e testáveis.
// Ref.: art. 71 (intrajornada), art. 66 (interjornada 11h), DSR/folgas.

export type Violacao = { regra: string; nivel: 'bloqueio' | 'aviso'; msg: string };

export type TurnoInfo = {
  horaInicio: string;
  horaFim: string;
  pausaInicio?: string | null;
  pausaFim?: string | null;
};
export type AlocSemana = { data: string; turno: TurnoInfo };

// "HH:MM" | "HH:MM:SS" → minutos desde 00:00.
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

// Duração de um turno em horas decimais (cruza a meia-noite se fim <= início).
export function horasEntre(inicio: string, fim: string): number {
  let d = toMin(fim) - toMin(inicio);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

// Duração da pausa em horas (0 se não definida).
export function pausaHoras(ini?: string | null, fim?: string | null): number {
  if (!ini || !fim) return 0;
  let d = toMin(fim) - toMin(ini);
  if (d < 0) d += 24 * 60;
  return d / 60;
}

// Intervalo intrajornada mínimo (horas) pela jornada BRUTA (art. 71).
export function intervaloMinimoHoras(jornadaBrutaHoras: number): number {
  if (jornadaBrutaHoras > 6) return 1;
  if (jornadaBrutaHoras > 4) return 0.25;
  return 0;
}

// Segunda-feira (YYYY-MM-DD) da semana de uma data.
function segundaDaSemana(dataISO: string): string {
  const d = new Date(`${dataISO}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

// Limites absolutos (ms UTC) de um turno num dia (fim no dia seguinte se cruza).
function limites(dataISO: string, t: TurnoInfo): { ini: number; fim: number } {
  const base = Date.parse(`${dataISO}T00:00:00Z`);
  const ini = base + toMin(t.horaInicio) * 60000;
  let fim = base + toMin(t.horaFim) * 60000;
  if (fim <= ini) fim += 24 * 3600 * 1000;
  return { ini, fim };
}

const H11 = 11 * 3600 * 1000;

// Valida uma alocação (nova/alterada) de UM colaborador no contexto da semana dele.
export function validarAlocacao(params: {
  jornadaTipo?: string | null;
  data: string;
  turno: TurnoInfo;
  outrasNaSemana: AlocSemana[]; // demais alocações do colaborador (exclui a atual)
}): Violacao[] {
  const { jornadaTipo, data, turno, outrasNaSemana } = params;
  const v: Violacao[] = [];

  // --- Intrajornada (art. 71) ---
  const jornada = horasEntre(turno.horaInicio, turno.horaFim);
  const pausa = pausaHoras(turno.pausaInicio, turno.pausaFim);
  const minimo = intervaloMinimoHoras(jornada);
  if (jornada > 6 && pausa <= 0) {
    v.push({
      regra: 'intrajornada',
      nivel: 'bloqueio',
      msg: `Jornada de ${jornada.toFixed(1)}h sem intervalo — a CLT exige no mínimo 1h.`,
    });
  } else if (pausa + 1e-9 < minimo) {
    v.push({
      regra: 'intrajornada',
      nivel: 'aviso',
      msg: `Intervalo de ${Math.round(pausa * 60)}min abaixo do mínimo (${Math.round(
        minimo * 60,
      )}min) para jornada de ${jornada.toFixed(1)}h.`,
    });
  }

  // --- Carga horária diária x limite do tipo de escala (CLT vigente) ---
  const maxJornada = jornadaMaximaHoras(jornadaTipo ?? '');
  if (maxJornada != null && jornada > maxJornada + 0.02) {
    v.push({
      regra: 'carga_horaria',
      nivel: 'aviso',
      msg: `Jornada de ${jornada.toFixed(1)}h acima do máximo da escala ${jornadaTipo} (~${maxJornada}h/dia) — fora do praticado na CLT.`,
    });
  }

  // --- Interjornada 11h (art. 66) com dias adjacentes ---
  const atual = limites(data, turno);
  for (const o of outrasNaSemana) {
    const diff =
      (Date.parse(`${o.data}T00:00:00Z`) - Date.parse(`${data}T00:00:00Z`)) / 86400000;
    if (Math.abs(diff) > 1) continue; // só adjacentes importam p/ descanso entre jornadas
    const outro = limites(o.data, o.turno);
    const [antes, depois] = atual.ini <= outro.ini ? [atual, outro] : [outro, atual];
    const descanso = depois.ini - antes.fim;
    if (descanso < H11) {
      const horas = Math.max(0, descanso) / 3600000;
      v.push({
        regra: 'interjornada',
        nivel: 'bloqueio',
        msg: `Descanso de ${horas.toFixed(1)}h entre turnos (dia ${o.data}) — mínimo 11h.`,
      });
      break;
    }
  }

  // --- Folgas semanais (aviso) ---
  const seg = segundaDaSemana(data);
  const dom = new Date(`${seg}T00:00:00Z`);
  dom.setUTCDate(dom.getUTCDate() + 6);
  const fimSemana = dom.toISOString().slice(0, 10);
  const diasTrabalho = new Set<string>([data]);
  for (const o of outrasNaSemana)
    if (o.data >= seg && o.data <= fimSemana) diasTrabalho.add(o.data);
  const nDias = diasTrabalho.size;
  if (jornadaTipo === '5x2' && nDias > 5) {
    v.push({
      regra: 'folgas',
      nivel: 'aviso',
      msg: `5x2 exige 2 folgas semanais — já são ${nDias} dias de trabalho nesta semana.`,
    });
  } else if (jornadaTipo === '4x3' && nDias > 4) {
    v.push({
      regra: 'folgas',
      nivel: 'aviso',
      msg: `4x3 prevê 4 dias de trabalho — já são ${nDias} nesta semana.`,
    });
  }

  return v;
}

export function bloqueios(vs: Violacao[]): Violacao[] {
  return vs.filter((x) => x.nivel === 'bloqueio');
}

// ===== Geração recorrente da escala (Fase 1 — motor puro) =====

// Minutos desde 00:00 → "HH:MM" (envolve em 24h se passar da meia-noite).
function fromMin(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Dia da semana (0=domingo..6=sábado) em UTC, consistente com o resto do arquivo.
function diaSemana(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
function proximoDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function diasEntre(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000,
  );
}

// Tipos de escala CÍCLICOS (padrão rotativo a partir da data-base, ignora dia da
// semana): 12x36 = 1 dia sim / 1 não; 4x3 = 4 dias / 3 folgas. Os demais (5x2,
// 6x1, horista, outro) são POR DIA DA SEMANA (folga = dias marcados).
// Escalas por CICLO (a folga "anda" sozinha, não cabe em dia fixo): 12x36 (dia sim/
// não) e 5x1 (5 on/1 off, 6 dias, não fecha a semana). As que somam 7 (5x2, 6x1,
// 4x3) são POR DIA DA SEMANA — o usuário escolhe os dias de folga.
const CICLOS: Record<string, { on: number; off: number }> = {
  '12x36': { on: 1, off: 1 }, // 12h trabalho / 36h descanso = 1 dia sim, 1 não
  '5x1': { on: 5, off: 1 }, // 5 dias / 1 folga (revezamento, 6 dias)
};

// Precisa perguntar dias de folga no wizard? Só os tipos por dia da semana.
export function precisaPerguntarFolga(jornadaTipo: string): boolean {
  return !CICLOS[jornadaTipo];
}

// Nº EXATO de folgas semanais que o tipo exige (regra inquebrável). Vale p/ os tipos
// por dia da semana (soma 7): 5x2=2, 6x1=1, 4x3=3. null = ciclo/livre.
export function folgasSemanais(jornadaTipo: string): number | null {
  if (jornadaTipo === '5x2') return 2;
  if (jornadaTipo === '6x1') return 1;
  if (jornadaTipo === '4x3') return 3;
  return null;
}

// Jornada MÁXIMA por dia (horas) do tipo de escala — base p/ o alerta CLT. Deriva
// do limite de 44h semanais (exceto 12x36, exceção legal de 12h). null = sem teto
// fixo (horista/outro/personalizada).
export function jornadaMaximaHoras(jornadaTipo: string): number | null {
  switch (jornadaTipo) {
    case '12x36':
      return 12;
    case '4x3':
      return 11; // ~44h / 4 dias
    case '5x2':
    case '5x1':
      return 8.8; // 44h / 5 (8h48)
    case '6x1':
      return 7.34; // ~44h / 6 (7h20)
    default:
      return null;
  }
}

// DSR (art. 67/CLT): ao menos 1 domingo de folga por mês. Aviso por mês do período
// em que TODOS os domingos foram trabalhados. Usa as datas de trabalho geradas.
export function avisosDsr(
  diasTrabalho: string[],
  dataInicio: string,
  dataFim: string,
): Violacao[] {
  const trabalho = new Set(diasTrabalho);
  const meses = new Map<string, { domingos: number; folga: number }>();
  let d = dataInicio;
  let guarda = 0;
  while (d <= dataFim && guarda++ < 800) {
    if (diaSemana(d) === 0) {
      const mes = d.slice(0, 7);
      const m = meses.get(mes) ?? { domingos: 0, folga: 0 };
      m.domingos++;
      if (!trabalho.has(d)) m.folga++;
      meses.set(mes, m);
    }
    d = proximoDia(d);
  }
  const v: Violacao[] = [];
  for (const [mes, m] of meses) {
    if (m.domingos > 0 && m.folga === 0) {
      v.push({
        regra: 'dsr',
        nivel: 'aviso',
        msg: `Nenhum domingo de folga em ${mes} — a CLT exige ao menos 1 domingo de folga por mês.`,
      });
    }
  }
  return v;
}

const MAX_DIAS_GERACAO = 800; // trava de segurança (~2 anos) contra range absurdo

export type RegraGeracao = {
  jornadaTipo: string;
  dataInicio: string; // YYYY-MM-DD (data-base do ciclo / 1º dia)
  dataFim: string; // YYYY-MM-DD (inclusive)
  folgasSemana?: number[]; // 0..6 — dias de folga (tipos por dia da semana)
  feriados?: string[]; // datas a PULAR quando "fechar nos feriados"
};

// Expande a regra nas DATAS de trabalho (YYYY-MM-DD). Puro e determinístico.
export function gerarDiasTrabalho(regra: RegraGeracao): string[] {
  const { jornadaTipo, dataInicio, dataFim } = regra;
  if (!dataInicio || !dataFim || dataFim < dataInicio) return [];
  const feriados = new Set(regra.feriados ?? []);
  const folgaDow = new Set(regra.folgasSemana ?? []);
  const ciclo = CICLOS[jornadaTipo];
  const dias: string[] = [];
  let dia = dataInicio;
  let guarda = 0;
  while (dia <= dataFim && guarda++ < MAX_DIAS_GERACAO) {
    let trabalha: boolean;
    if (ciclo) {
      const periodo = ciclo.on + ciclo.off;
      const pos = ((diasEntre(dataInicio, dia) % periodo) + periodo) % periodo;
      trabalha = pos < ciclo.on;
    } else {
      trabalha = !folgaDow.has(diaSemana(dia));
    }
    if (trabalha && !feriados.has(dia)) dias.push(dia);
    dia = proximoDia(dia);
  }
  return dias;
}

// Pausa (intervalo intrajornada) SUGERIDA pela CLT, centralizada no meio da
// jornada. Jornada ≤ 4h → sem pausa; 4–6h → 15min; > 6h → 1h. Editável depois.
export function pausaSugerida(
  entrada: string,
  saida: string,
): { pausaInicio: string | null; pausaFim: string | null } {
  const jornadaMin = Math.round(horasEntre(entrada, saida) * 60);
  const durMin = Math.round(intervaloMinimoHoras(jornadaMin / 60) * 60);
  if (durMin <= 0) return { pausaInicio: null, pausaFim: null };
  const iniMin = toMin(entrada) + Math.round(jornadaMin / 2 - durMin / 2);
  return { pausaInicio: fromMin(iniMin), pausaFim: fromMin(iniMin + durMin) };
}

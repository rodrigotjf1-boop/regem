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

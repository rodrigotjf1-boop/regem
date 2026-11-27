// A PAUSA DO IFOOD E DA 99 NO DIA ESPECIAL (fase H3 dos dias especiais; protótipo `mockups/regem-dias-especiais.html`, decisão 5:
// "pausar sozinho pela pausa de cada canal, com a chave na gaveta ligada por padrão"). O iFood e a 99 têm o horário deles no
// portal de cada um, que não sabe do feriado: no dia especial a loja pausa o canal nas horas em que estaria aberta e não vai
// abrir. Pela pausa de sempre (`PausaDoCanalService`, a mesma do "⏸ Pausar" do painel).
//
//  • Dia FECHADO: o iFood fica pausado em cada abertura da semana daquele dia (de 1 hora antes de abrir até a hora de
//    fechar); a 99 fica pausada "até o fim do dia" (a 99 só aceita 10, 20 ou 30 min ou o fim do dia), a partir de 1 hora antes
//    da primeira abertura.
//  • OUTRO HORÁRIO: só o iFood, nas horas da semana que o dia especial não cobre — antes (abre mais tarde) e depois (fecha
//    mais cedo). A 99 não pausa por horas.
//  • HORÁRIO NORMAL, ou a chave desligada: nada.
//
// Funções puras: o que pausar e quando. Quem pausa é a rotina (`DiasEspeciaisPausaService`), que também guarda o "já fiz".

import { aberturasDoDia, type DiaEspecialDoHorario } from '../../common/horario-da-data';
import { instanteNoFuso } from '../../common/pausa-do-canal';
import { somarDias } from '../../common/data';

/** Quanto antes de abrir a pausa começa (o portal do canal pode abrir antes do horário do Regem). */
export const ANTECEDENCIA_DA_PAUSA_MIN = 60;

export type JanelaDePausa = {
  canal: 'ifood' | 'food99';
  /** Quando a rotina pausa. */
  de: Date;
  /** Até quando a pausa vale (o "Até HH:MM" do iFood; a 99 vai "até o fim do dia"). */
  ate: Date;
  /** Desde que horas o canal fica pausado (HH:MM, sem a antecedência — o que a tela mostra). */
  desde: string;
  /** O "Até" do iFood (HH:MM) ou `null` na 99 (fim do dia). */
  ateHora: string | null;
  /** O "já fiz": uma pausa por dia especial, dia, canal e começo. */
  chave: string;
  /** O motivo que o canal recebe (texto do "outro"). */
  motivoTexto: string;
};

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hora = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** O instante de `min` minutos contados da meia-noite de `dia` (passa de 1440 = dia seguinte). */
const instante = (dia: string, min: number) => instanteNoFuso(somarDias(dia, Math.floor(min / 1440)), hora(min));

/**
 * As pausas de UM dia de um dia especial (`dia` dentro do período dele), pelo horário da semana da entrega (`semana`). O dia
 * especial já vem filtrado para o tipo da entrega (todos ou só a entrega): a pausa é do delivery.
 */
export function pausasDoDiaEspecial(e: DiaEspecialDoHorario, semana: readonly any[] | null | undefined, dia: string): JanelaDePausa[] {
  if (!e || e.pausarCanais === false || e.funcionamento === 'normal') return [];
  if (dia < e.data || dia > (e.dataFim ?? e.data)) return [];
  const normal = aberturasDoDia(semana, [], dia);
  // Sem horário da semana a loja abre o dia inteiro: a janela normal é o dia todo.
  const janelas = normal === 'dia_inteiro' ? [{ abre: 0, fecha: 1440 }] : normal.map((a) => ({ abre: minutos(a.abre), fecha: minutos(a.fecha) <= minutos(a.abre) ? minutos(a.fecha) + 1440 : minutos(a.fecha) }));
  if (!janelas.length) return []; // a loja já não abre nesse dia da semana: nada a pausar
  const nome = String(e.nome ?? '').trim();
  const out: JanelaDePausa[] = [];
  // `antes`: a pausa cobre a abertura da loja — começa 1 hora antes (o portal pode abrir antes); a que começa no meio do
  // horário (o dia especial fecha mais cedo) começa na hora em que ele fecha.
  const ifood = (deMin: number, ateMin: number, motivo: string, antes: boolean) => {
    if (ateMin <= deMin) return;
    const inicio = Math.max(deMin - (antes ? ANTECEDENCIA_DA_PAUSA_MIN : 0), 0);
    out.push({
      canal: 'ifood',
      de: instante(dia, inicio),
      ate: instante(dia, ateMin),
      desde: hora(deMin),
      ateHora: hora(ateMin),
      chave: `${e.id}:${dia}:ifood:${hora(deMin)}`,
      motivoTexto: motivo.slice(0, 80),
    });
  };
  if (e.funcionamento === 'fechada') {
    for (const j of janelas) ifood(j.abre, j.fecha, `Fechado hoje: ${nome}`, true);
    const primeira = Math.max(janelas[0].abre - ANTECEDENCIA_DA_PAUSA_MIN, 0);
    out.push({
      canal: 'food99',
      de: instante(dia, primeira),
      ate: instanteNoFuso(dia, '23:59'),
      desde: hora(janelas[0].abre),
      ateHora: null,
      chave: `${e.id}:${dia}:food99`,
      motivoTexto: `Fechado hoje: ${nome}`.slice(0, 80),
    });
    return out;
  }
  // Outro horário: as horas da semana fora do horário do dia especial.
  if (!e.abre || !e.fecha) return [];
  const eAbre = minutos(e.abre);
  const eFecha = minutos(e.fecha) <= eAbre ? minutos(e.fecha) + 1440 : minutos(e.fecha);
  for (const j of janelas) {
    if (eAbre > j.abre) ifood(j.abre, Math.min(eAbre, j.fecha), `Hoje abrimos às ${e.abre}: ${nome}`, true);
    if (eFecha < j.fecha) ifood(Math.max(eFecha, j.abre), j.fecha, `Hoje fechamos às ${e.fecha}: ${nome}`, eFecha <= j.abre);
  }
  return out;
}

/** As pausas que valem AGORA: começou e ainda não acabou (a rotina pausa as que ainda não fez). */
export function pausasDeAgora(janelas: readonly JanelaDePausa[], agora: Date): JanelaDePausa[] {
  return janelas.filter((j) => j.de.getTime() <= agora.getTime() && agora.getTime() < j.ate.getTime() - 60_000);
}

// O dia especial do horário na tela (H1b, mig 512): os textos e as regras puras que aparecem em mais de um lugar — a faixa
// do cardápio (`components/loja/cardapio/vitrines.tsx`), o "Para quando?" (`agendado-janelas.tsx`) e a prévia da gaveta em
// Delivery › Configurações › Horários (`components/delivery/dias-especiais.tsx`). Um lugar só para a prévia dizer
// exatamente o que o cliente vai ler (V39). A regra de verdade mora no servidor (`backend/src/common/horario-da-data.ts`);
// as daqui são a mesma conta, e o `npm run check:dias-especiais` compara as duas (V74).

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── datas (sempre texto AAAA-MM-DD, contadas ao meio-dia em UTC: nada de fuso no meio da conta) ──────────────────────
export const NOME_DO_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const NOME_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const meioDia = (d: string) => new Date(`${d}T12:00:00Z`);
export const diaDaSemana = (d: string) => meioDia(d).getUTCDay();
export const curto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const porExtenso = (d: string) => `${NOME_DO_DIA[diaDaSemana(d)]}, ${curto(d)}`;
export const minusculo = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
export const dataValida = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(meioDia(v).getTime());
export function somarDias(d: string, n: number): string {
  const x = meioDia(d);
  x.setUTCDate(x.getUTCDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}
/** Quantos dias de `de` a `ate`, contando os dois (12/01 a 14/01 = 3). */
export const diasEntre = (de: string, ate: string) => Math.round((meioDia(ate).getTime() - meioDia(de).getTime()) / 86_400_000) + 1;

// ── "mudou": a faixa do topo e a lista de Horários releem quando uma das duas grava ───────────────────────────────
// A faixa (no Shell) e a lista (em Configurações) são peças separadas na mesma tela: responder numa e a outra ficar com o
// feriado velho confunde. Quem grava avisa; quem mostra relê.
export const EVENTO_DIAS_ESPECIAIS = 'regem:dias-especiais-mudou';
export function avisarQueMudou(): void {
  try {
    window.dispatchEvent(new Event(EVENTO_DIAS_ESPECIAIS));
  } catch {
    /* fora do navegador */
  }
}

// ── os textos ────────────────────────────────────────────────────────────────────────────────────────────────────
/** "das 18:00 às 21:00" — com a virada da meia-noite; a mesma frase do servidor (`faixaDeHoras`). */
export const faixaDeHoras = (abre: string, fecha: string) => `das ${abre} às ${fecha}${fecha <= abre ? ' do dia seguinte' : ''}`;

/**
 * "Voltamos sáb às 18:00." a partir da próxima abertura que o servidor manda (`proximaAberturaDaData`: "18:00", "sáb 18:00"
 * ou "15/01 18:00").
 */
export const fraseDaVolta = (volta: string) => (volta.includes(' ') ? `Voltamos ${volta.replace(' ', ' às ')}.` : `Voltamos às ${volta}.`);

/** A faixa do dia de outro horário: o título e a linha de apoio. */
export const textosDoOutroHorario = (nome: string, abre: string, fecha: string) => ({
  titulo: `Hoje abrimos ${faixaDeHoras(abre, fecha)}`,
  texto: `Horário especial de ${nome}.`,
});

// ── as regras ────────────────────────────────────────────────────────────────────────────────────────────────────
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * O horário da semana de um dia: a primeira abertura (a mesma conta do `daSemana` do servidor: `ativo` ausente conta como
 * ligado, as duas horas válidas, na ordem da hora de abrir), ou `null` (fechada nesse dia da semana).
 */
export function normalDoDia(semana: readonly any[] | null | undefined, d: string): { abre: string; fecha: string } | null {
  const h = (Array.isArray(semana) ? semana : [])
    .filter((x) => x && x.ativo !== false && Number(x.dia) === diaDaSemana(d) && HORA.test(String(x.abre)) && HORA.test(String(x.fecha)))
    .map((x) => ({ abre: String(x.abre), fecha: String(x.fecha) }))
    .sort((a, b) => a.abre.localeCompare(b.abre));
  return h[0] ?? null;
}

/**
 * A próxima abertura pela semana depois do último dia fechado, no formato do servidor (`proximaAberturaDaData`) visto no
 * primeiro dia fechado: "sáb 18:00" nos próximos 6 dias, "15/01 18:00" mais longe. Olha até 21 dias, como ele; a loja
 * sem horário da semana abre o dia inteiro ("00:00").
 */
export function proximaAberturaDepois(primeiro: string, ultimo: string, semana: readonly any[] | null | undefined): string | null {
  const semHorario = !Array.isArray(semana) || !semana.length;
  for (let d = diasEntre(primeiro, ultimo); d < 21; d++) {
    const data = somarDias(primeiro, d);
    const abre = semHorario ? '00:00' : normalDoDia(semana, data)?.abre;
    if (abre) return d < 7 ? `${NOME_CURTO[diaDaSemana(data)]} ${abre}` : `${curto(data)} ${abre}`;
  }
  return null;
}

export type EspecialDoMenu = { data: string; dataFim: string | null; nome: string; funcionamento: string; abre: string | null; fecha: string | null; conjunto: string };

/**
 * O dia especial que vale num dia para o tipo do pedido — a mesma escolha do servidor (`especiaisDoTipo` +
 * `especialDaData`): os da loja toda e os do tipo; dois cobrindo o dia, o de início mais recente (o servidor recusa os que
 * se cruzam, então é o caso raro). Os próximos 30 dias vêm no menu (`diasEspeciais.proximos`).
 */
export function especialDoDia(proximos: unknown, dia: string, tipo: 'entrega' | 'retirada'): EspecialDoMenu | null {
  const lista = (Array.isArray(proximos) ? proximos : []) as EspecialDoMenu[];
  const cobrem = lista.filter((e) => e && (e.conjunto === 'todos' || e.conjunto === tipo) && e.data <= dia && (e.dataFim ?? e.data) >= dia);
  return cobrem.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))[0] ?? null;
}

import { sql } from 'drizzle-orm';

// O HORÁRIO DA SEMANA DA LOJA, DIA A DIA (M6j lote 9). A lista é a de `cardapio_config.horarios` (ou `horarios_retirada`), a
// mesma que Delivery › Configurações › Horários edita: `{ dia: 0..6, abre, fecha, ativo }`, com 0 = domingo. Fechar depois da
// meia-noite é `fecha <= abre`.
//
// Duas armadilhas da regra do cardápio (`CardapioService.estaAberta`), que a recusa abaixo cobre:
//  • a lista VAZIA quer dizer "sempre aberta": gravar um dia só nela fecharia a loja nos outros seis;
//  • a lista sem nenhum dia ativo quer dizer "sempre fechada".

export interface JanelaDoDia {
  abre: string;
  fecha: string;
}
/** O que muda em um dia; `janela` null = o dia fica fechado. */
export interface MudancaDoDia {
  dia: number;
  janela: JanelaDoDia | null;
}
export type ColunaDoHorario = 'horarios' | 'horarios_retirada';

export const NOMES_DOS_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;
const DIAS_DITOS = new Map<string, number>([
  ['domingo', 0], ['dom', 0],
  ['segunda', 1], ['seg', 1],
  ['terca', 2], ['ter', 2],
  ['quarta', 3], ['qua', 3],
  ['quinta', 4], ['qui', 4],
  ['sexta', 5], ['sex', 5],
  ['sabado', 6], ['sab', 6],
]);

/** O dia como a pessoa (ou a IA) diz: "domingo", "terça-feira", "sáb". Qualquer outra coisa é null. */
export function lerDiaDaSemana(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '').replace(/-feira$/, '');
  return DIAS_DITOS.get(t) ?? null;
}

export const ehHoraDoDia = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const doDia = (lista: unknown, dia: number): any[] => (Array.isArray(lista) ? lista : []).filter((h) => h && Number(h.dia) === dia);
const ativa = (h: any) => !!(h.ativo && h.abre && h.fecha);

/** Como o dia está: a janela que vale, ou null (fechado). `varias`: o dia tem mais de uma janela (a tela mostra só uma). */
export function situacaoDoDia(lista: unknown, dia: number): { janela: JanelaDoDia | null; varias: boolean } {
  const hs = doDia(lista, dia).filter(ativa);
  return { janela: hs.length ? { abre: String(hs[0].abre), fecha: String(hs[0].fecha) } : null, varias: hs.length > 1 };
}

export const mesmaJanela = (a: JanelaDoDia | null, b: JanelaDoDia | null): boolean =>
  a === null || b === null ? a === b : a.abre === b.abre && a.fecha === b.fecha;

export const textoDaJanela = (j: JanelaDoDia | null): string => (j ? `${j.abre} às ${j.fecha}${j.fecha <= j.abre ? ' do dia seguinte' : ''}` : 'fechado');

/** As horas da janela, virando a meia-noite quando precisa. */
export function horasDaJanela(j: JanelaDoDia): number {
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const a = min(j.abre);
  const f = min(j.fecha);
  return (f > a ? f - a : 24 * 60 - a + f) / 60;
}

/** A lista com os dias pedidos trocados; os outros dias ficam como estão. O dia fechado guarda as horas, como na tela. */
export function aplicarAosDias(lista: unknown, mudancas: readonly MudancaDoDia[]): any[] {
  const pedidos = new Set(mudancas.map((m) => m.dia));
  const resto = (Array.isArray(lista) ? lista : []).filter((h) => h && !pedidos.has(Number(h.dia)));
  const novos = mudancas.map((m) => {
    const atual = doDia(lista, m.dia)[0] ?? {};
    return m.janela
      ? { ...atual, dia: m.dia, abre: m.janela.abre, fecha: m.janela.fecha, ativo: true }
      : { ...atual, dia: m.dia, abre: atual.abre ?? '18:00', fecha: atual.fecha ?? '23:00', ativo: false };
  });
  return [...resto, ...novos].sort((a, b) => Number(a.dia) - Number(b.dia) || String(a.abre).localeCompare(String(b.abre)));
}

/** O que impede a mudança (a frase para a pessoa), ou null. */
export function recusaDoHorario(lista: unknown, mudancas: readonly MudancaDoDia[]): string | null {
  if (!Array.isArray(lista) || !lista.length)
    return 'A loja ainda não tem o horário da semana cadastrado. Cadastre a semana inteira em Delivery › Configurações › Horários: mudar um dia só fecharia os outros.';
  const dobrado = mudancas.find((m) => situacaoDoDia(lista, m.dia).varias);
  if (dobrado) return `${NOMES_DOS_DIAS[dobrado.dia]} tem mais de um horário cadastrado: mude em Delivery › Configurações › Horários.`;
  if (!aplicarAosDias(lista, mudancas).some(ativa))
    return 'Assim a loja ficaria sem nenhum dia aberto. Para fechar por um tempo, use a pausa dos canais.';
  return null;
}

/**
 * Grava só os dias pedidos, com a linha travada e relendo a lista na mesma transação. A tela regrava a configuração inteira
 * (`setConfig`); aqui não: uma mudança feita ao lado, no mesmo instante (o "aberto", outro dia da semana), não se perde.
 */
export async function gravarHorariosDosDias(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  coluna: ColunaDoHorario,
  mudancas: readonly MudancaDoDia[],
): Promise<{ id: string; lista: any[] } | { erro: string }> {
  const col = sql.raw(coluna === 'horarios_retirada' ? 'horarios_retirada' : 'horarios');
  return db.transaction(async (tx: any) => {
    const r: any = await tx.execute(sql`
      select id::text as id, ${col} as lista from cardapio_config
       where tenant_id = ${tenantId}::uuid and ${unidadeId ? sql`unidade_id = ${unidadeId}::uuid` : sql`unidade_id is null`}
       order by created_at
       limit 1
         for update`);
    const [l] = r?.rows ?? r ?? [];
    if (!l) return { erro: 'A loja não tem cardápio digital configurado.' };
    const recusa = recusaDoHorario(l.lista, mudancas);
    if (recusa) return { erro: recusa };
    const lista = aplicarAosDias(l.lista, mudancas);
    await tx.execute(sql`update cardapio_config set ${col} = ${JSON.stringify(lista)}::jsonb, updated_at = now() where id = ${l.id}::uuid and tenant_id = ${tenantId}::uuid`);
    return { id: String(l.id), lista };
  });
}

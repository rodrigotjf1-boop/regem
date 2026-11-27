/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import {
  agoraEmSaoPaulo,
  diaCurto,
  diaDaSemanaDe,
  especiaisDoTipo,
  especialDaData,
  somarDias,
  type DiaEspecialDoHorario,
  type FuncionamentoEspecial,
} from '../../common/horario-da-data';

// OS DIAS ESPECIAIS DA LOJA (fase H1; mig 512; protótipo `mockups/regem-dias-especiais.html`, aprovado em 27/11/2026).
// A leitura (para o cardápio, o agendado e o atendente), a conferência do que a tela manda e os textos ao cliente. A regra
// do horário de uma data mora em `common/horario-da-data.ts`.

export const LIMITE_DO_NOME = 40;
/** Até quantos dias à frente o cardápio e o atendente olham (o atendente fala dos próximos 30 dias; o agendado, de menos). */
export const DIAS_A_FRENTE = 60;
/** O aviso no cardápio, quando ligado no dia especial: este número de dias antes (decisão 6). */
export const DIAS_DO_AVISO = 3;
/** O período mais longo de um dia especial (férias coletivas, reforma). */
export const PERIODO_MAXIMO = 60;

const NOME_LONGO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FUNCIONAMENTOS = ['fechada', 'horario', 'normal'] as const;
const CONJUNTOS = ['todos', 'entrega', 'retirada'] as const;

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** A linha do banco no formato da regra. */
export function deLinha(r: any): DiaEspecialDoHorario {
  return {
    id: String(r.id),
    data: String(r.data),
    dataFim: r.data_fim ? String(r.data_fim) : null,
    nome: String(r.nome ?? ''),
    funcionamento: (FUNCIONAMENTOS as readonly string[]).includes(r.funcionamento) ? r.funcionamento : 'normal',
    abre: r.abre ?? null,
    fecha: r.fecha ?? null,
    conjunto: (CONJUNTOS as readonly string[]).includes(r.conjunto) ? r.conjunto : 'todos',
    avisoAntes: r.aviso_antes !== false,
    pausarCanais: r.pausar_canais !== false,
  };
}

/**
 * Os dias especiais da loja que tocam a faixa [de, ate] (só os que valem). A loja de um cardápio com loja vê os dela e os
 * da empresa toda (V4); o cardápio sem loja, os da empresa. Sem a tabela (o servidor da loja antes da mig 512): nenhum —
 * vale o horário da semana, como antes.
 */
export async function lerDiasEspeciais(db: any, tenantId: string, unidadeId: string | null, de: string, ate: string): Promise<DiaEspecialDoHorario[]> {
  try {
    const r = await db.execute(sql`
      select id, to_char(data, 'YYYY-MM-DD') as data, to_char(data_fim, 'YYYY-MM-DD') as data_fim, nome, funcionamento, abre,
             fecha, conjunto, aviso_antes, pausar_canais
        from horario_especial
       where tenant_id = ${tenantId}::uuid
         and (unidade_id is not distinct from ${unidadeId}::uuid or unidade_id is null)
         and deleted_at is null
         and data <= ${ate}::date and coalesce(data_fim, data) >= ${de}::date
       order by data`);
    return linhas(r).map(deLinha);
  } catch (e: any) {
    if (e?.code === '42P01' || e?.cause?.code === '42P01') return [];
    throw e;
  }
}

/** A faixa que o cardápio lê: de ontem (a madrugada que vira a meia-noite) até `DIAS_A_FRENTE` dias. */
export function faixaDoCardapio(agora: Date = new Date()): { de: string; ate: string } {
  const { dia } = agoraEmSaoPaulo(agora);
  return { de: somarDias(dia, -1), ate: somarDias(dia, DIAS_A_FRENTE) };
}

/** "Sexta, 25/12". */
export const diaPorExtenso = (dia: string) => `${NOME_LONGO[diaDaSemanaDe(dia)]}, ${diaCurto(dia)}`;

/** "das 18:00 às 21:00" (o que vira a meia-noite: "das 18:00 às 02:00 do dia seguinte"). */
export const faixaDeHoras = (abre: string, fecha: string) => `das ${abre} às ${fecha}${fecha <= abre ? ' do dia seguinte' : ''}`;

/**
 * O aviso ao cliente sobre um dia especial que vem aí (decisão 6: 3 dias antes): "Sexta, 25/12, estaremos fechados
 * (Natal)." ou "Quinta, 24/12, abriremos das 18:00 às 21:00 (Véspera de Natal)." O período: "De 12/01 a 14/01, estaremos
 * fechados (Reforma da cozinha)."
 */
export function textoDoAviso(e: DiaEspecialDoHorario): string {
  const quando = e.dataFim && e.dataFim !== e.data ? `De ${diaCurto(e.data)} a ${diaCurto(e.dataFim)}` : diaPorExtenso(e.data);
  if (e.funcionamento === 'fechada') return `${quando}, estaremos fechados (${e.nome}).`;
  return `${quando}, abriremos ${faixaDeHoras(String(e.abre), String(e.fecha))} (${e.nome}).`;
}

export type SituacaoDosDiasEspeciais = {
  /** O dia especial de hoje (o da entrega, ou o da empresa toda). */
  hoje: { nome: string; funcionamento: FuncionamentoEspecial; abre: string | null; fecha: string | null } | null;
  /** O aviso dos próximos `DIAS_DO_AVISO` dias (o primeiro com o aviso ligado), já com o texto. */
  aviso: { data: string; nome: string; texto: string } | null;
  /** Os próximos 30 dias, para o atendente e o "Para quando?". O "horário normal" não entra: não muda nada para o cliente. */
  proximos: Array<{ data: string; dataFim: string | null; nome: string; funcionamento: FuncionamentoEspecial; abre: string | null; fecha: string | null; conjunto: string }>;
};

/** O que o cardápio público e o atendente recebem dos dias especiais da loja. */
export function situacaoDosDiasEspeciais(especiais: readonly DiaEspecialDoHorario[], agora: Date = new Date()): SituacaoDosDiasEspeciais {
  const { dia } = agoraEmSaoPaulo(agora);
  const valem = especiais.filter((e) => e.funcionamento !== 'normal');
  const hojeE = especialDaData(especiaisDoTipo(valem, 'entrega'), dia) ?? especialDaData(valem, dia);
  const limite = somarDias(dia, DIAS_DO_AVISO);
  const avisoE = valem.find((e) => e.avisoAntes !== false && e.data > dia && e.data <= limite) ?? null;
  const ate30 = somarDias(dia, 30);
  return {
    hoje: hojeE ? { nome: hojeE.nome, funcionamento: hojeE.funcionamento, abre: hojeE.abre, fecha: hojeE.fecha } : null,
    aviso: avisoE ? { data: avisoE.data, nome: avisoE.nome, texto: textoDoAviso(avisoE) } : null,
    proximos: valem
      .filter((e) => (e.dataFim ?? e.data) >= dia && e.data <= ate30)
      .map((e) => ({ data: e.data, dataFim: e.dataFim, nome: e.nome, funcionamento: e.funcionamento, abre: e.abre, fecha: e.fecha, conjunto: e.conjunto })),
  };
}

/** Uma linha do atendente: "sex 25/12 (Natal) — fechada" ou "qui 24/12 (Véspera de Natal) — das 18:00 às 21:00". */
export function linhaDoAtendente(e: SituacaoDosDiasEspeciais['proximos'][number]): string {
  const quando = e.dataFim && e.dataFim !== e.data ? `de ${diaPorExtenso(e.data)} a ${diaPorExtenso(e.dataFim)}` : diaPorExtenso(e.data);
  const como = e.funcionamento === 'fechada' ? 'fechada' : faixaDeHoras(String(e.abre), String(e.fecha));
  const so = e.conjunto === 'entrega' ? ' (só a entrega)' : e.conjunto === 'retirada' ? ' (só a retirada)' : '';
  return `${quando} (${e.nome}) — ${como}${so}`;
}

export type DiaEspecialConferido = {
  data: string;
  dataFim: string | null;
  nome: string;
  funcionamento: FuncionamentoEspecial;
  abre: string | null;
  fecha: string | null;
  conjunto: 'todos' | 'entrega' | 'retirada';
  avisoAntes: boolean;
  pausarCanais: boolean;
  feriadoChave: string | null;
};

const dataValida = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATA.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * Confere o que a tela (ou o Mister) manda. Toda recusa diz o porquê. `hoje` = a data de hoje em São Paulo: dia especial no
 * passado não se cria (editar um passado também não).
 */
export function conferirDiaEspecial(dto: any, hoje: string): { ok: true; v: DiaEspecialConferido } | { ok: false; erro: string } {
  const nao = (erro: string) => ({ ok: false as const, erro });
  if (!dataValida(dto?.data)) return nao('Escolha o dia.');
  if (dto.data < hoje) return nao('Escolha hoje ou um dia à frente.');
  const fim = dto?.dataFim == null || dto.dataFim === '' ? null : dto.dataFim;
  if (fim != null && !dataValida(fim)) return nao('O "até" não é uma data válida.');
  if (fim != null && fim < dto.data) return nao('O "até" vem antes do dia: escolha uma data depois.');
  const dataFim = fim === dto.data ? null : fim;
  if (dataFim && somarDias(dto.data, PERIODO_MAXIMO) < dataFim) return nao(`O período pode ter até ${PERIODO_MAXIMO} dias.`);
  const nome = String(dto?.nome ?? '').replace(/\s+/g, ' ').trim();
  if (!nome) return nao('Escreva o nome que o cliente vê (ex.: Natal).');
  if (nome.length > LIMITE_DO_NOME) return nao(`O nome pode ter até ${LIMITE_DO_NOME} letras.`);
  const funcionamento = dto?.funcionamento;
  if (!(FUNCIONAMENTOS as readonly string[]).includes(funcionamento)) return nao('Escolha como a loja fica: fechada, outro horário ou horário normal.');
  let abre: string | null = null;
  let fecha: string | null = null;
  if (funcionamento === 'horario') {
    if (!HORA.test(String(dto?.abre ?? '')) || !HORA.test(String(dto?.fecha ?? ''))) return nao('Escolha a hora em que abre e a hora em que fecha.');
    if (dto.abre === dto.fecha) return nao('A hora de abrir e a de fechar são iguais.');
    abre = dto.abre;
    fecha = dto.fecha;
  }
  const conjunto = dto?.conjunto == null || dto.conjunto === '' ? 'todos' : dto.conjunto;
  if (!(CONJUNTOS as readonly string[]).includes(conjunto)) return nao('Escolha a que horário vale: os dois, a entrega ou a retirada.');
  // Liga/desliga (V15): ausente = o padrão da decisão 6 (o aviso ligado no dia fechado, desligado no de outro horário) e o
  // da decisão 5 (pausar ligado); presente, só true ou false.
  const bool = (v: unknown, padrao: boolean, campo: string): boolean | string => {
    if (v === undefined || v === null) return padrao;
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    return `Informe "${campo}" (ligado ou desligado).`;
  };
  const avisoAntes = bool(dto?.avisoAntes, funcionamento === 'fechada', 'Avisar no cardápio');
  if (typeof avisoAntes === 'string') return nao(avisoAntes);
  const pausarCanais = bool(dto?.pausarCanais, funcionamento !== 'normal', 'Pausar o iFood e a 99');
  if (typeof pausarCanais === 'string') return nao(pausarCanais);
  const feriadoChave = typeof dto?.feriadoChave === 'string' && dto.feriadoChave.trim() ? dto.feriadoChave.trim().slice(0, 80) : null;
  return {
    ok: true,
    v: { data: dto.data, dataFim, nome, funcionamento, abre, fecha, conjunto, avisoAntes: funcionamento === 'normal' ? false : avisoAntes, pausarCanais: funcionamento === 'normal' ? false : pausarCanais, feriadoChave },
  };
}

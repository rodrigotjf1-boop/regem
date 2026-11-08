import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ROBÔ CALADO NUMA CONVERSA — quando um humano assume (mig 342). Uma regra só para as duas vias (Evolution e API oficial),
// para a caixa de conversas e para o robô (n8n):
//
//  • o robô fica calado enquanto houver uma PAUSA valendo para o número: "Pausar robô" (manual), o atendente respondeu
//    pela caixa do Regem ('atendente') ou pelo app do WhatsApp ('app', coexistência). Ela vence em `ate` — o tempo que a
//    loja escolheu em robo_config.pausa_minutos (0 = só quando alguém retomar);
//  • e enquanto houver um CHAMADO ABERTO para o número (o robô chamou o atendente), pelo mesmo tempo, contado da abertura —
//    o robô não fica falando por cima de quem vai atender, mas também não some para sempre se ninguém aparecer;
//  • RESOLVER o chamado devolve a conversa ao robô: chamado resolvido DEPOIS da pausa encerra a pausa. Vale também quando
//    o chamado é resolvido no servidor da loja — a resolução chega à nuvem pelo sync e a regra a lê, sem aviso à parte;
//  • "Retomar robô" vale contra tudo o que veio ANTES dele (pausa e chamado já aberto);
//  • HORÁRIO DA EQUIPE (mig 379): o chamado que é RECADO PARA A ABERTURA (`detalhe.recado`, fora do horário) NÃO cala o
//    robô enquanto espera — não há ninguém para atender, e o robô segue respondendo o que sabe. No `ate` (a equipe
//    começou) ele vira um chamado comum: o tempo da pausa conta DALI, não da criação.
//  • ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): o RECADO PARA O RESPONSÁVEL (`detalhe.responsavel` — fornecedor, vaga,
//    parceria) que espera alguém NÃO cala o robô: a conversa continua com ele. Quem pegar o caso e responder pela caixa
//    cala pela pausa de sempre ('atendente'). Como o caso comum é o que manda na conversa, ele vem antes do recado na
//    escolha do "chamado aberto do número".
//
// O número é comparado pela CHAVE do telefone (com/sem 55, com/sem o nono dígito — ERR-134).

export const PAUSA_PADRAO_MINUTOS = 60;
export type MotivoPausa = 'manual' | 'atendente' | 'app';

export type ChamadoAberto = {
  id: string;
  tipo: string;
  pedidoNumero: string | null;
  criadoEm: Date;
  /** 'urgente' = cliente irritado (mig 343): a caixa mostra em vermelho. Ausente = 'normal'. */
  prioridade?: 'normal' | 'urgente';
  /** O resumo da dificuldade que o robô escreveu ao chamar (a caixa mostra na faixa do chamado). */
  mensagem?: string | null;
  /** Recado para a abertura (mig 379): até quando ele espera a equipe. Ausente/null = chamado comum. */
  recadoAte?: Date | null;
  /** Recado para o responsável esperando alguém (mig 381): não cala o robô. Ausente/false = chamado comum. */
  paraOResponsavel?: boolean;
};
const prioridadeDaLinha = (v: unknown): 'normal' | 'urgente' => (v === 'urgente' ? 'urgente' : 'normal');
const mensagemDaLinha = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
export type EstadoPausa = {
  pausado: boolean;
  /** Quando o robô volta sozinho. `null` com `pausado` = só quando alguém retomar. */
  ate: Date | null;
  /** manual | atendente | app | chamado — o que está calando o robô agora. */
  motivo: string | null;
  /** Chamado aberto deste número (mesmo que já não cale o robô), para a caixa mostrar. */
  chamado: ChamadoAberto | null;
};

type LinhaPausa = { ate: Date | null; motivo: string; atualizadoEm: Date } | null;

const SEM_PAUSA: EstadoPausa = { pausado: false, ate: null, motivo: null, chamado: null };
const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const data = (v: any): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));
/** O `recadoAte` do chamado (mig 379), só quando o caso é recado e a data é válida — o chamado comum fica como era. */
const recadoDaLinha = (v: unknown): { recadoAte?: Date } => {
  const d = typeof v === 'string' && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? { recadoAte: d } : {};
};
/** O `paraOResponsavel` do chamado (mig 381), só quando é verdade — o chamado comum fica como era. */
const responsavelDaLinha = (v: unknown): { paraOResponsavel?: true } => (v === true ? { paraOResponsavel: true } : {});
/**
 * SQL (mig 381): o chamado `a` é um recado para o responsável que espera alguém — a coluna que a regra lê e a ORDEM da
 * escolha do "chamado aberto do número": o caso comum (o que manda na conversa) antes do recado; depois, o mais novo.
 */
const RESPONSAVEL_ESPERANDO = sql.raw(`((a.detalhe -> 'responsavel') is not null and a.responsavel_id is null)`);

/**
 * A decisão, sem banco (testável caso a caso). `minutos` = robo_config.pausa_minutos (0 = sem prazo); `resolvidoEm` = a
 * resolução mais recente de um chamado deste número; `agora` vem do banco, a mesma hora que gravou as pausas.
 */
export function decidirPausa(e: {
  pausa: LinhaPausa;
  chamado: ChamadoAberto | null;
  minutos: number;
  resolvidoEm: Date | null;
  agora: Date;
}): EstadoPausa {
  const { pausa, chamado, minutos, resolvidoEm, agora } = e;
  const retomadoEm = pausa?.motivo === 'retomado' ? pausa.atualizadoEm : null;

  const pausaVale =
    !!pausa &&
    pausa.motivo !== 'retomado' &&
    (pausa.ate == null || pausa.ate.getTime() > agora.getTime()) &&
    !(resolvidoEm && resolvidoEm.getTime() > pausa.atualizadoEm.getTime());

  // O recado que ainda espera a equipe não cala; o que já chegou à abertura conta o tempo da volta da equipe (mig 379).
  const recadoAte = chamado?.recadoAte && !Number.isNaN(chamado.recadoAte.getTime()) ? chamado.recadoAte : null;
  const recadoEsperando = !!recadoAte && recadoAte.getTime() > agora.getTime();
  const inicioDoChamado = chamado ? (recadoAte ?? chamado.criadoEm) : null;
  const fimDoChamado = inicioDoChamado && minutos > 0 ? new Date(inicioDoChamado.getTime() + minutos * 60_000) : null;
  // O recado para o responsável que espera alguém (mig 381) também não cala: a conversa segue com o robô.
  const chamadoVale =
    !!chamado &&
    !recadoEsperando &&
    chamado.paraOResponsavel !== true &&
    !(retomadoEm && retomadoEm.getTime() >= chamado.criadoEm.getTime()) &&
    (minutos === 0 || (fimDoChamado as Date).getTime() > agora.getTime());

  if (!pausaVale && !chamadoVale) return { ...SEM_PAUSA, chamado };
  const semPrazo = (pausaVale && pausa!.ate == null) || (chamadoVale && minutos === 0);
  let ate: Date | null = null;
  if (!semPrazo) {
    const fins = [pausaVale ? pausa!.ate : null, chamadoVale ? fimDoChamado : null].filter((d): d is Date => !!d);
    ate = new Date(Math.max(...fins.map((d) => d.getTime())));
  }
  return { pausado: true, ate, motivo: pausaVale ? pausa!.motivo : 'chamado', chamado };
}

function chaveOuErro(telefone: string): string {
  const k = chaveTelefone(telefone);
  if (!k || k.length < 8) throw new BadRequestException('Número inválido.');
  return k;
}

/** Minutos que o robô fica calado depois que o humano assume (0 = até alguém retomar). */
export async function minutosDaPausa(db: any, tenantId: string): Promise<number> {
  const r = await db.execute(sql`select pausa_minutos from robo_config where tenant_id = ${tenantId}::uuid`);
  const v = Number(linhas(r)[0]?.pausa_minutos);
  return Number.isInteger(v) && v >= 0 ? v : PAUSA_PADRAO_MINUTOS;
}

/** O estado de UM número (portão do robô: n8n pelo resolver, webhook da API oficial, envio do robô). */
export async function estadoDaPausa(db: any, tenantId: string, telefone: string): Promise<EstadoPausa> {
  const k = chaveTelefone(telefone);
  if (!k) return SEM_PAUSA;
  const chaveDoChamado = sqlChaveTelefone(sql`a.telefone`);
  const r = await db.execute(sql`
    select
      (select row_to_json(p) from (
         select rp.ate, rp.motivo, rp.atualizado_em from robo_pausa rp
          where rp.tenant_id = ${tenantId}::uuid and rp.telefone_chave = ${k}) p) as pausa,
      (select row_to_json(c) from (
         select a.id, a.tipo, a.pedido_numero, a.criado_em, a.prioridade, a.mensagem,
                a.detalhe -> 'recado' ->> 'ate' as recado_ate, ${RESPONSAVEL_ESPERANDO} as para_o_responsavel
           from atendimento_chamado a
          where a.tenant_id = ${tenantId}::uuid and a.status = 'aberto' and ${chaveDoChamado} = ${k}
          order by ${RESPONSAVEL_ESPERANDO}, a.criado_em desc limit 1) c) as chamado,
      (select max(a.resolvido_em) from atendimento_chamado a
        where a.tenant_id = ${tenantId}::uuid and a.status = 'resolvido' and ${chaveDoChamado} = ${k}) as resolvido_em,
      coalesce((select pausa_minutos from robo_config where tenant_id = ${tenantId}::uuid), ${PAUSA_PADRAO_MINUTOS}) as minutos,
      now() as agora`);
  const l = linhas(r)[0];
  if (!l) return SEM_PAUSA;
  const p = l.pausa;
  const c = l.chamado;
  return decidirPausa({
    pausa: p ? { ate: data(p.ate), motivo: String(p.motivo), atualizadoEm: data(p.atualizado_em) as Date } : null,
    chamado: c
      ? {
          id: String(c.id),
          tipo: String(c.tipo),
          pedidoNumero: c.pedido_numero ?? null,
          criadoEm: data(c.criado_em) as Date,
          prioridade: prioridadeDaLinha(c.prioridade),
          mensagem: mensagemDaLinha(c.mensagem),
          ...recadoDaLinha(c.recado_ate),
          ...responsavelDaLinha(c.para_o_responsavel),
        }
      : null,
    minutos: Number(l.minutos),
    resolvidoEm: data(l.resolvido_em),
    agora: data(l.agora) as Date,
  });
}

/**
 * O estado de TODOS os números da loja com pausa ou chamado (lista da caixa de conversas). Chave do telefone → estado;
 * número fora do mapa = robô respondendo, sem chamado.
 */
export async function pausasDaLoja(db: any, tenantId: string): Promise<Map<string, EstadoPausa>> {
  const r = await db.execute(sql`
    select
      coalesce((select json_agg(p) from (
         select rp.telefone_chave, rp.ate, rp.motivo, rp.atualizado_em from robo_pausa rp
          where rp.tenant_id = ${tenantId}::uuid) p), '[]'::json) as pausas,
      coalesce((select json_agg(c) from (
         select a.id, a.tipo, a.pedido_numero, a.criado_em, a.telefone, a.prioridade, a.mensagem,
                a.detalhe -> 'recado' ->> 'ate' as recado_ate, ${RESPONSAVEL_ESPERANDO} as para_o_responsavel
           from atendimento_chamado a
          where a.tenant_id = ${tenantId}::uuid and a.status = 'aberto' and a.telefone is not null
          order by ${RESPONSAVEL_ESPERANDO}, a.criado_em desc limit 300) c), '[]'::json) as chamados,
      coalesce((select json_agg(x) from (
         select a.telefone, max(a.resolvido_em) as resolvido_em from atendimento_chamado a
          where a.tenant_id = ${tenantId}::uuid and a.status = 'resolvido' and a.telefone is not null
            and a.resolvido_em > now() - interval '30 days'
          group by a.telefone) x), '[]'::json) as resolvidos,
      coalesce((select pausa_minutos from robo_config where tenant_id = ${tenantId}::uuid), ${PAUSA_PADRAO_MINUTOS}) as minutos,
      now() as agora`);
  const l = linhas(r)[0];
  const mapa = new Map<string, EstadoPausa>();
  if (!l) return mapa;
  const agora = data(l.agora) as Date;
  const minutos = Number(l.minutos);

  const pausas = new Map<string, LinhaPausa>();
  for (const p of l.pausas ?? [])
    pausas.set(String(p.telefone_chave), { ate: data(p.ate), motivo: String(p.motivo), atualizadoEm: data(p.atualizado_em) as Date });
  const chamados = new Map<string, ChamadoAberto>();
  for (const c of l.chamados ?? []) {
    const k = chaveTelefone(c.telefone);
    if (!k || chamados.has(k)) continue; // o caso comum antes do recado para o responsável; depois, o mais novo
    chamados.set(k, {
      id: String(c.id),
      tipo: String(c.tipo),
      pedidoNumero: c.pedido_numero ?? null,
      criadoEm: data(c.criado_em) as Date,
      prioridade: prioridadeDaLinha(c.prioridade),
      mensagem: mensagemDaLinha(c.mensagem),
      ...recadoDaLinha(c.recado_ate),
      ...responsavelDaLinha(c.para_o_responsavel),
    });
  }
  const resolvidos = new Map<string, Date>();
  for (const x of l.resolvidos ?? []) {
    const k = chaveTelefone(x.telefone);
    const d = data(x.resolvido_em);
    if (!k || !d) continue;
    const antes = resolvidos.get(k);
    if (!antes || d > antes) resolvidos.set(k, d);
  }

  for (const k of new Set([...pausas.keys(), ...chamados.keys()])) {
    const e = decidirPausa({
      pausa: pausas.get(k) ?? null,
      chamado: chamados.get(k) ?? null,
      minutos,
      resolvidoEm: resolvidos.get(k) ?? null,
      agora,
    });
    if (e.pausado || e.chamado) mapa.set(k, e);
  }
  return mapa;
}

/** O estado de um número dentro do mapa da loja (sem pausa nem chamado = robô respondendo). */
export function estadoNoMapa(mapa: Map<string, EstadoPausa>, telefone: string): EstadoPausa {
  const k = chaveTelefone(telefone);
  return (k && mapa.get(k)) || SEM_PAUSA;
}

/**
 * O que a caixa de conversas mostra de uma conversa: robô calado (e até quando, e por quê) e o chamado aberto do número.
 * Mesmo contrato nas duas vias (Evolution e API oficial). `antigos` = a pausa antiga do vetor robo_pausados, que vale
 * até alguém retomar.
 */
export function pausaDaConversa(mapa: Map<string, EstadoPausa>, antigos: Set<string>, telefone: string) {
  if (!telefone) return { pausada: false, pausadaAte: null as Date | null, pausaMotivo: null as string | null, chamado: null as ChamadoAberto | null };
  const e = estadoNoMapa(mapa, telefone);
  if (!e.pausado && antigos.has(telefone)) return { pausada: true, pausadaAte: null, pausaMotivo: 'manual', chamado: e.chamado };
  return { pausada: e.pausado, pausadaAte: e.ate, pausaMotivo: e.motivo, chamado: e.chamado };
}

/** As pausas da loja para a lista; se a consulta falhar, a lista sai sem elas (e o motivo vai para o log). */
export async function pausasDaLojaOuVazio(db: any, tenantId: string, avisar: (m: string) => void): Promise<Map<string, EstadoPausa>> {
  try {
    return await pausasDaLoja(db, tenantId);
  } catch (e: any) {
    avisar(`pausas da loja não consultadas (a lista sai sem elas): ${e?.message ?? e}`);
    return new Map();
  }
}

/** Cala o robô no número: `minutos` nulo ou 0 = até alguém retomar. Grava pela hora do banco. */
export async function pausarConversa(
  db: any,
  e: { tenantId: string; telefone: string; minutos: number | null; motivo: MotivoPausa; por?: string | null },
): Promise<void> {
  const k = chaveOuErro(e.telefone);
  const tel = String(e.telefone).replace(/\D/g, '');
  const min = e.minutos && e.minutos > 0 ? Math.min(Math.floor(e.minutos), 1440) : null;
  await db.execute(sql`
    insert into robo_pausa (tenant_id, telefone, telefone_chave, ate, motivo, por)
    values (${e.tenantId}::uuid, ${tel}, ${k},
            ${min == null ? sql`null` : sql`now() + make_interval(mins => ${min}::int)`},
            ${e.motivo}, ${uuidOuNulo(e.por)}::uuid)
    on conflict (tenant_id, telefone_chave) do update
       set telefone = excluded.telefone, ate = excluded.ate, motivo = excluded.motivo,
           por = excluded.por, atualizado_em = now()`);
}

/**
 * O HUMANO RESPONDEU (caixa do Regem ou app do WhatsApp): o robô fica calado pelo tempo da loja. Não encurta uma pausa
 * manual sem prazo que ainda vale — quem pausou "até eu retomar" continua mandando.
 */
export async function pausarPeloAtendente(
  db: any,
  e: { tenantId: string; telefone: string; motivo: 'atendente' | 'app'; por?: string | null },
): Promise<void> {
  const atual = await estadoDaPausa(db, e.tenantId, e.telefone);
  if (atual.pausado && atual.motivo === 'manual' && atual.ate == null) return;
  const minutos = await minutosDaPausa(db, e.tenantId);
  await pausarConversa(db, { ...e, minutos: minutos > 0 ? minutos : null });
}

/** "Retomar robô": vale contra a pausa e contra o chamado já aberto deste número. */
export async function retomarConversa(db: any, e: { tenantId: string; telefone: string; por?: string | null }): Promise<void> {
  const k = chaveOuErro(e.telefone);
  const tel = String(e.telefone).replace(/\D/g, '');
  await db.execute(sql`
    insert into robo_pausa (tenant_id, telefone, telefone_chave, ate, motivo, por)
    values (${e.tenantId}::uuid, ${tel}, ${k}, now(), 'retomado', ${uuidOuNulo(e.por)}::uuid)
    on conflict (tenant_id, telefone_chave) do update
       set telefone = excluded.telefone, ate = now(), motivo = 'retomado',
           por = excluded.por, atualizado_em = now()`);
}

function uuidOuNulo(v: unknown): string | null {
  const s = String(v ?? '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

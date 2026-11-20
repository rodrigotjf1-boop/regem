import { ForbiddenException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { sqlChaveTelefone } from './telefone-chave';
import { ehServidorLocal } from './modo';
import { sqlOlhouENaoPediu } from './interesse-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS SEGMENTOS "PELO PERFIL" (F7 parte 1 do docs/plano-perfil-cliente.md, §6.3; protótipo, aba "Marketing" — "público pelo
// perfil"). Um lugar só para a lista de Delivery › Clientes e para a campanha: o segmento RFM do perfil, "atrasado no
// ritmo" e os selos do que move o cliente (F3 parte 2). Regras:
//  • só com o módulo "Perfil do cliente" ligado, só presidente e gerente (o perfil é dado pessoal — como a ficha) e só na
//    nuvem (as tabelas do perfil não existem no servidor da loja) — `conferirSegmentoDoPerfil`;
//  • na CAMPANHA, só quem tem o aceite de marketing CLICADO (D4/D15): o último evento do número é um aceite (ou a volta)
//    vindo do próprio cliente — o cardápio (caixa clicada, a chave do Perfil, a entrada) ou o WhatsApp. A caixa que já
//    vinha marcada no checkout (`cardapio_checkout_marcada`, mantida pelo dono em 19/11), o painel, a integração e a lista
//    inicial NÃO contam (`sqlAceiteClicado`).
//  • o cliente que só pediu pela 99 (ou pelo iFood) não tem perfil — fica fora de todo segmento daqui (D1).
// Alias da tabela do cliente = `c`.

type Def = { rotulo: string; grupo: 'segmento' | 'ritmo' | 'evento' | 'interesse'; cond: SQL };
const perfil = (cond: SQL): SQL =>
  sql`and exists (select 1 from cliente_perfil cp where cp.cliente_id = c.id and cp.tenant_id = c.tenant_id and ${cond})`;
const selo = (tipo: string): SQL =>
  sql`and exists (select 1 from cliente_evento_sensibilidade s where s.cliente_id = c.id and s.tenant_id = c.tenant_id
                    and s.tipo = ${tipo} and s.selo)`;

export const SEGMENTOS_DO_PERFIL: Record<string, Def> = {
  perfil_campeoes: { rotulo: 'Campeões', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'campeoes'`) },
  perfil_leais: { rotulo: 'Leais', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'leais'`) },
  perfil_recentes: { rotulo: 'Recentes', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'recentes'`) },
  perfil_atencao: { rotulo: 'Precisam de atenção', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'atencao'`) },
  perfil_em_risco: { rotulo: 'Em risco', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'em_risco'`) },
  perfil_inativos: { rotulo: 'Inativos', grupo: 'segmento', cond: perfil(sql`cp.segmento = 'inativos'`) },
  perfil_atrasado: { rotulo: 'Atrasados no próprio ritmo', grupo: 'ritmo', cond: perfil(sql`'atrasado' = any(cp.etiquetas)`) },
  perfil_dinheiro: { rotulo: 'Pedem no dinheiro no bolso', grupo: 'evento', cond: selo('dinheiro') },
  perfil_feriado: { rotulo: 'Pedem em feriado', grupo: 'evento', cond: selo('feriado') },
  perfil_comemorativa: { rotulo: 'Pedem em data comemorativa', grupo: 'evento', cond: selo('comemorativa') },
  perfil_loja: { rotulo: 'Pedem nos eventos da loja', grupo: 'evento', cond: selo('loja') },
  // F4b: viu e não pediu — só quem ligou as recomendações tem cliques ligados a si (`common/interesse-do-cliente.ts`).
  perfil_olhou: { rotulo: 'Olharam e não pediram', grupo: 'interesse', cond: sql`and ${sqlOlhouENaoPediu()}` },
};

export const ehSegmentoDoPerfil = (chave: unknown): boolean => typeof chave === 'string' && chave in SEGMENTOS_DO_PERFIL;

/** O `and …` do segmento "pelo perfil", ou `null` se a chave não é daqui (o chamador segue com os segmentos dele). */
export function sqlSegmentoDoPerfil(chave: unknown): SQL | null {
  return ehSegmentoDoPerfil(chave) ? SEGMENTOS_DO_PERFIL[chave as string].cond : null;
}

/** As origens de um aceite que veio do próprio cliente (um "sim" clicado — D15). */
export const ORIGENS_DO_ACEITE_CLICADO = ['cardapio_checkout', 'cardapio_perfil', 'whatsapp'] as const;

/** Na campanha "pelo perfil": o último evento de consentimento do número é um aceite (ou a volta) clicado pelo cliente. */
export function sqlAceiteClicado(): SQL {
  const origens = sql.join(ORIGENS_DO_ACEITE_CLICADO.map((o) => sql`${o}`), sql`, `);
  return sql`and exists (select 1 from (select mc.acao, mc.origem from marketing_consentimento mc
                 where mc.tenant_id = c.tenant_id and mc.telefone_chave = ${sqlChaveTelefone(sql`c.telefone`)}
                 order by mc.em desc limit 1) u
               where u.acao in ('aceite', 'volta') and u.origem in (${origens}))`;
}

/** O módulo "Perfil do cliente" está ligado na empresa? */
export async function perfilLigado(db: any, tenantId: string): Promise<boolean> {
  const r: any = await db.execute(sql`
    select exists (select 1 from modulo_ativacao where tenant_id = ${tenantId}::uuid and modulo = 'perfil_cliente' and ativo) as ok`);
  return !!(r.rows ?? r)[0]?.ok;
}

/**
 * Recusa o segmento "pelo perfil" fora das regras (antes de qualquer consulta): só nuvem, só presidente e gerente, só com
 * o módulo ligado. Segmento que não é daqui passa direto.
 */
export async function conferirSegmentoDoPerfil(db: any, user: { tenantId: string; categoria?: string | null }, chave: unknown): Promise<void> {
  if (!ehSegmentoDoPerfil(chave)) return;
  if (ehServidorLocal()) throw new ForbiddenException('Os segmentos pelo perfil ficam no Regem na nuvem.');
  if (!['presidente', 'gerente'].includes(String(user.categoria ?? ''))) throw new ForbiddenException('Só o presidente e o gerente usam os segmentos pelo perfil.');
  if (!(await perfilLigado(db, user.tenantId))) throw new ForbiddenException('Ligue o módulo "Perfil do cliente" em Visão C&O › Módulos do produto.');
}

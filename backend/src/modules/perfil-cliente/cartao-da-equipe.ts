import { sql } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { CANAIS_FORA_DO_PERFIL } from './calculo-do-perfil';
import { clienteFoiAvisado } from './aviso-do-perfil';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARTÃO DO CLIENTE PARA A EQUIPE (F6b do docs/plano-perfil-cliente.md, §6.2; protótipo, aba "Atendimento"): o cartão
// CURTO que quem atende vê ao lado do caso — o de sempre, o jeito que o cliente pediu, os cuidados (alergia guardada), as
// reclamações agrupadas pelo motivo, as avaliações e as etiquetas. Valor gasto, número de pedidos, RFM e sensibilidades
// ficam só na ficha (presidente e gerente). Só com o módulo ligado e nunca para quem pediu para não ser analisado; o
// cliente do caso só se for DIRETO (o pedido do iFood/99 não forma perfil — D1).

const linhas = (r: any): any[] => r?.rows ?? r ?? [];

export type CartaoDaEquipe = {
  nome: string | null;
  deSempre?: string;
  jeito?: string[];
  time?: string;
  cuidados?: string[];
  reclamacoes?: { nome: string; vezes: number }[];
  avaliacoes?: { media: number | null; quantas: number; ultimas: number[] };
  etiquetas?: string[];
  confianca?: string;
};

/** O cliente direto do caso: pelo pedido ligado (fora do iFood/99) ou, sem pedido, pelo telefone da conversa. */
export async function clienteDoCaso(db: any, tenantId: string, caso: { pedidoId?: string | null; telefone?: string | null; canal?: string | null }): Promise<string | null> {
  if ((CANAIS_FORA_DO_PERFIL as readonly string[]).includes(String(caso.canal ?? ''))) return null;
  if (caso.pedidoId) {
    const [p] = linhas(await db.execute(sql`
      select cliente_id, canal from pedido_externo where id = ${caso.pedidoId}::uuid and tenant_id = ${tenantId}::uuid`));
    if (p?.cliente_id && !(CANAIS_FORA_DO_PERFIL as readonly string[]).includes(String(p.canal ?? ''))) return p.cliente_id;
    if (p) return null;
  }
  const chave = chaveTelefone(caso.telefone);
  if (!chave) return null;
  const [c] = linhas(await db.execute(sql`
    select id from cliente where tenant_id = ${tenantId}::uuid and ${sqlChaveTelefone(sql`telefone`)} = ${chave}
     order by ultimo_pedido_em desc nulls last limit 1`));
  return c?.id ?? null;
}

/** Monta o cartão da equipe. `null` = módulo desligado, "não analisar", ou nada a mostrar. */
export async function cartaoDaEquipe(db: any, tenantId: string, clienteId: string): Promise<CartaoDaEquipe | null> {
  const [m] = linhas(await db.execute(sql`
    select exists (select 1 from modulo_ativacao where tenant_id = ${tenantId}::uuid and modulo = 'perfil_cliente' and ativo) as ligado`));
  if (!m?.ligado) return null;
  const [e] = linhas(await db.execute(sql`
    select valor from cliente_escolha where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid
       and escolha = 'nao_analisar' order by em desc limit 1`));
  if (e?.valor) return null;
  const [c] = linhas(await db.execute(sql`select nome from cliente where id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`));
  if (!c) return null;
  // Quem ainda não viu o aviso (regra `PERFIL_SO_COM_AVISO`): a equipe vê só o que o cliente contou, como a alergia.
  const [p] = (await clienteFoiAvisado(db, tenantId, clienteId))
    ? linhas(await db.execute(sql`
    select confianca, etiquetas, camadas from cliente_perfil where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`))
    : [];
  const d = new Map(linhas(await db.execute(sql`
    select chave, valor from cliente_declarado where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`)).map((x: any) => [x.chave, x.valor]));
  const cam = p?.camadas ?? {};
  const out: CartaoDaEquipe = { nome: c.nome ?? null };
  if (cam.gosto?.de_sempre?.nome) out.deSempre = String(cam.gosto.de_sempre.nome);
  const jeito = [d.get('respostas_curtas') === true ? 'pediu respostas curtas' : null, d.get('prefere_audio') === true ? 'prefere áudio' : null]
    .filter(Boolean) as string[];
  if (jeito.length) out.jeito = jeito;
  if (typeof d.get('time') === 'string') out.time = String(d.get('time'));
  const cuidados: string[] = [];
  if (d.get('alergia')) cuidados.push(`alergia a ${d.get('alergia')} (o cliente pediu para guardar)`);
  if (d.get('nao_gosta')) cuidados.push(`não gosta de ${d.get('nao_gosta')}`);
  if (cuidados.length) out.cuidados = cuidados;
  const grupos = (cam.reclamacoes?.grupos ?? []).map((g: any) => ({ nome: String(g.nome), vezes: Number(g.vezes) || 0 }));
  if (grupos.length) out.reclamacoes = grupos;
  if (Number(cam.avaliacoes?.quantas) > 0)
    out.avaliacoes = { media: cam.avaliacoes.media != null ? Number(cam.avaliacoes.media) : null, quantas: Number(cam.avaliacoes.quantas), ultimas: cam.avaliacoes.ultimas ?? [] };
  if (Array.isArray(p?.etiquetas) && p.etiquetas.length) out.etiquetas = p.etiquetas;
  if (p?.confianca) out.confianca = p.confianca;
  return Object.keys(out).length > 1 ? out : null;
}

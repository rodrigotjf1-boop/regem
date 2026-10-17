import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ONDE CADA DOCUMENTO SAI (central de impressão, fase 2; mig 327). Teste do dono na loja
// (17/10/2026): sem impressora escolhida, a via ia para TODAS as impressoras de cupom. Decisões do
// mesmo dia ("1A 2A 3A" e "mais de um local para sair"): cada documento tem a sua lista de
// impressoras, com as vias de cada uma; documento sem regra continua como sempre.
//
//  • balcao     — via do cliente da venda de balcão e da conta da mesa: a impressora do PDV que
//                 vendeu (`pdv`, com `pdvVias`) e/ou as impressoras da lista.
//  • delivery   — via do caixa do pedido externo (iFood, 99, cardápio, telefone; o totem não).
//  • entregador — comanda do entregador: as mesmas do delivery (padrão, decisão 2A) ou a sua lista.
//
// A reimpressão NÃO passa por aqui: sai num lugar só (ERR-247).

export type DocumentoImpressao = 'balcao' | 'delivery' | 'entregador';
export type AlvoDaRegra = { id: string; vias: number };
export type RegrasDeImpressao = {
  balcao?: { pdv: boolean; pdvVias: number; impressoras: AlvoDaRegra[] };
  delivery?: { impressoras: AlvoDaRegra[] };
  entregador?: { mesmasDoDelivery: boolean; impressoras: AlvoDaRegra[] };
};

export const VIAS_MAX = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const vias = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(VIAS_MAX, n) : 1;
};
const objeto = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);

/** Lista de impressoras sem repetir (a repetida soma as vias, até o máximo), na ordem em que veio. */
function lista(v: unknown): AlvoDaRegra[] {
  const porId = new Map<string, number>();
  for (const x of Array.isArray(v) ? v : []) {
    const o = objeto(x);
    const id = typeof o?.id === 'string' ? o.id : typeof x === 'string' ? x : '';
    if (!id) continue;
    porId.set(id, Math.min(VIAS_MAX, (porId.get(id) ?? 0) + vias(o?.vias)));
  }
  return [...porId].map(([id, n]) => ({ id, vias: n }));
}

/** O formato guardado, a partir do que veio (da tela ou do banco). Chave ausente = documento sem regra. */
export function normalizarRegras(bruto: unknown): RegrasDeImpressao {
  const r = objeto(bruto) ?? {};
  const saida: RegrasDeImpressao = {};
  const b = objeto(r.balcao);
  if (b) saida.balcao = { pdv: b.pdv !== false, pdvVias: vias(b.pdvVias), impressoras: lista(b.impressoras) };
  const d = objeto(r.delivery);
  if (d) saida.delivery = { impressoras: lista(d.impressoras) };
  const e = objeto(r.entregador);
  if (e) saida.entregador = { mesmasDoDelivery: e.mesmasDoDelivery !== false, impressoras: lista(e.impressoras) };
  return saida;
}

/**
 * Para salvar: normaliza e confere as impressoras — só IMPRESSORA desta empresa e EM USO, numa
 * consulta só. O fora de uso é recusado pelo nome (como os destinos de produção, ERR-241).
 */
export async function conferirRegras(db: any, tenantId: string, bruto: unknown): Promise<RegrasDeImpressao> {
  const regras = normalizarRegras(bruto);
  const ids = [...new Set([...(regras.balcao?.impressoras ?? []), ...(regras.delivery?.impressoras ?? []), ...(regras.entregador?.impressoras ?? [])].map((a) => a.id))];
  if (!ids.length) return regras;
  if (!ids.every((x) => UUID.test(x))) throw new BadRequestException('Impressora inválida.');
  const r: any = await db.execute(sql`
    select id, nome, tipo, ativo from equipamento
     where tenant_id = ${tenantId} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  const porId = new Map<string, { nome: string; tipo: string; ativo: boolean }>((r.rows ?? r).map((x: any) => [String(x.id), x]));
  if (ids.some((id) => porId.get(id)?.tipo !== 'impressora'))
    throw new BadRequestException('Impressora não encontrada. Atualize a tela e tente de novo.');
  const fora = ids.filter((id) => !porId.get(id)!.ativo).map((id) => `"${porId.get(id)!.nome}"`);
  if (fora.length === 1) throw new BadRequestException(`A impressora ${fora[0]} está fora de uso (revogada ou desligada): desmarque-a para salvar.`);
  if (fora.length > 1) throw new BadRequestException(`As impressoras ${fora.join(', ')} estão fora de uso (revogadas ou desligadas): desmarque-as para salvar.`);
  return regras;
}

/** As regras da loja: a da unidade; sem ela, a da rede (unidade nula) — como os perfis de cupom. */
export async function regrasDaLoja(db: any, tenantId: string, unidadeId: string | null): Promise<RegrasDeImpressao> {
  const r: any = await db.execute(sql`
    select impressao_regras as regras from delivery_config
     where tenant_id = ${tenantId} and (unidade_id is null ${unidadeId ? sql`or unidade_id = ${unidadeId}::uuid` : sql``})
     order by (unidade_id is null) asc
     limit 1`);
  return normalizarRegras((r.rows ?? r)[0]?.regras);
}

/**
 * Para onde vai este documento: a lista (impressora + vias), ou `null` = sem regra (o caminho de
 * sempre). `impressoraDoPdv` = a impressora de cupom do terminal que vendeu (só o balcão usa).
 */
export function alvosDoDocumento(regras: RegrasDeImpressao, documento: DocumentoImpressao, impressoraDoPdv: string | null): AlvoDaRegra[] | null {
  if (documento === 'entregador') {
    const e = regras.entregador;
    if (!e || e.mesmasDoDelivery) return alvosDoDocumento(regras, 'delivery', null);
    return e.impressoras.length ? e.impressoras : null;
  }
  if (documento === 'delivery') return regras.delivery?.impressoras.length ? regras.delivery.impressoras : null;
  const b = regras.balcao;
  if (!b) return null;
  const todos = lista([...(b.pdv && impressoraDoPdv ? [{ id: impressoraDoPdv, vias: b.pdvVias }] : []), ...b.impressoras]);
  return todos.length ? todos : null;
}

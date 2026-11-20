import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { verificarCliente } from '../cliente/cliente-token';
import { perfilLigado } from '../../common/segmentos-do-perfil';
import { INTERESSE, sqlNaoPediuDesde, sqlPontosDoClique } from '../../common/interesse-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS CLIQUES NO CARDÁPIO (F4 do docs/plano-perfil-cliente.md, §4.3; mig 466). O cardápio manda, em lotes, o que a pessoa
// fez: produto aberto (com o tempo aberto), produto posto no carrinho e busca (o termo e quantos itens achou). Regras:
//  • só com o módulo "Perfil do cliente" ligado (sem ele, nada é gravado);
//  • ANÔNIMO por padrão (a sessão da visita, a mesma do funil); o cliente só entra se provou que é ele (o `clienteToken`
//    do código do WhatsApp — V79) E ligou "Recomendações personalizadas" — e só dali em diante, porque só se grava o que
//    chega depois do "sim";
//  • telemetria: o evento torto é descartado (nunca erro para a tela), no máximo 25 por lote, e o produto tem de ser da
//    própria empresa;
//  • apagado aos 90 dias (`expurgarInteracoes`).

export const TIPOS_DE_INTERACAO = ['produto_aberto', 'produto_adicionado', 'busca'] as const;
export const MAX_POR_LOTE = 25;
/** Tempo máximo aceito com o produto aberto (10 min — depois disso a pessoa saiu da tela). */
const MS_MAXIMO = 600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSAO = /^[a-z0-9]{6,64}$/i;

export type Interacao = { tipo: string; produto_id: string | null; ms: number | null; termo: string | null; resultados: number | null };

/** O termo de busca como se guarda: minúsculo, sem espaço duplicado e sem caractere de controle, até 60 letras. */
export function normalizarTermo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 60);
  return t.length >= 2 ? t : null;
}

const inteiro = (v: unknown, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/** Lê o lote. Nunca recusa: o que não serve fica de fora. */
export function lerInteracoes(dto: any): { sessao: string | null; clienteToken: string | null; eventos: Interacao[] } {
  const sessao = typeof dto?.sessao === 'string' && SESSAO.test(dto.sessao) ? dto.sessao : null;
  const clienteToken = typeof dto?.clienteToken === 'string' && dto.clienteToken.length < 2000 ? dto.clienteToken : null;
  const eventos: Interacao[] = [];
  for (const e of Array.isArray(dto?.eventos) ? dto.eventos.slice(0, MAX_POR_LOTE) : []) {
    const tipo = String(e?.tipo ?? '');
    if (!(TIPOS_DE_INTERACAO as readonly string[]).includes(tipo)) continue;
    if (tipo === 'busca') {
      const termo = normalizarTermo(e?.termo);
      if (!termo) continue;
      eventos.push({ tipo, produto_id: null, ms: null, termo, resultados: inteiro(e?.resultados, 10_000) });
      continue;
    }
    const produto = typeof e?.produtoId === 'string' && UUID.test(e.produtoId) ? e.produtoId.toLowerCase() : null;
    if (!produto) continue;
    eventos.push({ tipo, produto_id: produto, ms: tipo === 'produto_aberto' ? inteiro(e?.ms, MS_MAXIMO) : null, termo: null, resultados: null });
  }
  return { sessao, clienteToken, eventos };
}

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Grava o lote. Devolve quantos gravou (0 = módulo desligado, cardápio desconhecido ou nada que sirva). Nunca rejeita. */
export async function registrarInteracoes(db: any, token: string, dto: any): Promise<{ gravadas: number }> {
  try {
    const lido = lerInteracoes(dto);
    if (!lido.sessao || !lido.eventos.length || typeof token !== 'string' || !token) return { gravadas: 0 };
    const [cfg] = rows(await db.execute(sql`select tenant_id from cardapio_config where token = ${token} limit 1`));
    if (!cfg) return { gravadas: 0 };
    const tenantId = String(cfg.tenant_id);
    if (!(await perfilLigado(db, tenantId))) return { gravadas: 0 };
    // O cliente só com a prova (o token do código do WhatsApp, da MESMA empresa) e o "sim" das recomendações (o último).
    let clienteId: string | null = null;
    const v = verificarCliente(lido.clienteToken);
    if (v && v.tenant === tenantId) {
      // A última de cada escolha: "recomendações" ligada E sem "não quero ser analisado".
      const [e] = rows(await db.execute(sql`
        select (select x.valor from cliente_escolha x
                 where x.cliente_id = ${v.cli}::uuid and x.tenant_id = ${tenantId}::uuid and x.escolha = 'recomendacoes'
                 order by x.em desc limit 1) as rec,
               (select x.valor from cliente_escolha x
                 where x.cliente_id = ${v.cli}::uuid and x.tenant_id = ${tenantId}::uuid and x.escolha = 'nao_analisar'
                 order by x.em desc limit 1) as nao`));
      if (e?.rec === true && e?.nao !== true) clienteId = v.cli;
    }
    const r: any = await db.execute(sql`
      insert into cardapio_interacao (tenant_id, sessao, cliente_id, tipo, produto_id, ms, termo, resultados)
      select ${tenantId}::uuid, ${lido.sessao}, ${clienteId}::uuid, x.tipo, x.produto_id, x.ms, x.termo, x.resultados
        from jsonb_to_recordset(${JSON.stringify(lido.eventos)}::jsonb)
             as x(tipo text, produto_id uuid, ms int, termo text, resultados int)
       where x.produto_id is null
          or exists (select 1 from produto p where p.id = x.produto_id and p.tenant_id = ${tenantId}::uuid)`);
    return { gravadas: Number(r?.rowCount ?? 0) };
  } catch (e: any) {
    new Logger('InteracoesDoCardapio').warn(`cliques não gravados: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return { gravadas: 0 };
  }
}

/** O funil anônimo do cardápio (`cardapio_evento`, mig 196) com mais de 400 dias sai — o relatório do funil lê até 365.
 *  Em lotes de 20 mil por volta (a primeira limpeza não segura a tabela). */
export async function expurgarFunil(db: any): Promise<number> {
  const r: any = await db.execute(sql`
    delete from cardapio_evento
     where id in (select id from cardapio_evento where criado_em < now() - interval '400 days' limit 20000)`);
  return Number(r?.rowCount ?? 0);
}

/** O `meta` do funil como se guarda: objeto de até 1.000 letras (em JSON); o resto vira nulo — o funil conta sessões. */
export function metaDoFunil(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  try {
    const t = JSON.stringify(meta);
    return t.length <= 1000 ? t : null;
  } catch {
    return null;
  }
}

/**
 * "O QUE OLHA NO CARDÁPIO" (F4b; protótipo, camada 3 da ficha): os produtos com mais pontos de interesse do cliente (os
 * cliques ligados a ele — só depois do "sim" das recomendações), com o "viu e não pediu" pela régua de
 * `common/interesse-do-cliente.ts`. `desde` = o primeiro clique ligado (os de mais de 90 dias já saíram).
 */
export async function oQueOlha(db: any, tenantId: string, clienteId: string) {
  const I = INTERESSE;
  const itens = rows(await db.execute(sql`
    with por as (
      select i.produto_id,
             sum(${sqlPontosDoClique('i')}) as pontos,
             count(*) filter (where i.tipo = 'produto_aberto' and i.em > now() - make_interval(days => ${I.viuJanelaDias}::int)) as abriu,
             min(i.em) filter (where i.tipo = 'produto_aberto' and i.em > now() - make_interval(days => ${I.viuJanelaDias}::int)) as desde
        from cardapio_interacao i
       where i.cliente_id = ${clienteId}::uuid and i.tenant_id = ${tenantId}::uuid and i.produto_id is not null
       group by i.produto_id
    )
    select por.produto_id, coalesce(pr.nome, 'Produto que saiu do cardápio') as nome,
           round(por.pontos::numeric, 1)::float8 as pontos,
           (por.abriu >= ${I.viuVezes}::int
             and ${sqlNaoPediuDesde(sql`${tenantId}::uuid`, sql`${clienteId}::uuid`, sql`por.produto_id`, sql`por.desde`)}) as viu_nao_pediu
      from por left join produto pr on pr.id = por.produto_id and pr.tenant_id = ${tenantId}::uuid
     order by por.pontos desc, 2
     limit 5`));
  const [d] = rows(await db.execute(sql`
    select min(em) as desde from cardapio_interacao where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`));
  return {
    desde: d?.desde ?? null,
    itens: itens.map((x: any) => ({ produtoId: x.produto_id, nome: x.nome, pontos: Number(x.pontos), viuNaoPediu: x.viu_nao_pediu === true })),
  };
}

/** Os cliques com mais de 90 dias saem (o que fica para a loja é a soma — Saúde da base). */
export async function expurgarInteracoes(db: any): Promise<number> {
  const r: any = await db.execute(sql`delete from cardapio_interacao where em < now() - interval '90 days'`);
  return Number(r?.rowCount ?? 0);
}

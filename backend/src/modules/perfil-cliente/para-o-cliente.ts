import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { verificarCliente } from '../cliente/cliente-token';
import { perfilLigado } from '../../common/segmentos-do-perfil';
import { INTERESSE, sqlNaoPediuDesde, sqlPontosDoClique } from '../../common/interesse-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARDÁPIO PARA O CLIENTE IDENTIFICADO (F8 do docs/plano-perfil-cliente.md, §6.4; protótipo, aba "No cardápio"). O que
// o cardápio Regem mostra no topo para quem entrou com o código do WhatsApp (o `clienteToken` — V79):
//  • "Seu de sempre": o item do perfil (o mesmo do cálculo — 3 pedidos ou mais e o item em metade deles), achado no cadastro
//    pelo produto, pelo código PDV ou pelo nome; vem dos PEDIDOS, então aparece mesmo sem as recomendações;
//  • "Você viu" e a ordem das categorias: só com "Recomendações personalizadas" ligado (os cliques ligados a ele —
//    `common/interesse-do-cliente.ts`): os produtos do "viu e não pediu" e as categorias pelo que ele mais abre.
// Nada com o módulo desligado, com "não quero ser analisado", com token de outra empresa ou sem prova. Nunca devolve
// dado pessoal: só ids de produto e de categoria (o nome do cliente o cardápio já tem). Nunca rejeita.
// NASCE DESLIGADO (muda o que o cliente vê no cardápio — regra "nada muda para ninguém no deploy"): só com a variável
// `PERFIL_CARDAPIO_PARA_VOCE=1` na API (o dono liga no EasyPanel, como as `MISTER_*`). Desligado = tudo vazio.

/** A F8 ligada na instalação (o dono liga; lida a cada chamada — vale sem reiniciar o código). */
export const paraVoceLigado = (): boolean => String(process.env.PERFIL_CARDAPIO_PARA_VOCE ?? '').trim() === '1';

export type ParaVoce = { deSempre: string | null; voceViu: string[]; ordemCategorias: string[] };
const VAZIO: ParaVoce = { deSempre: null, voceViu: [], ordemCategorias: [] };
const rows = (r: any): any[] => r?.rows ?? r ?? [];

export async function paraOCliente(db: any, token: string, clienteToken: unknown): Promise<ParaVoce> {
  try {
    if (!paraVoceLigado()) return VAZIO;
    if (typeof token !== 'string' || !token || typeof clienteToken !== 'string' || clienteToken.length > 2000) return VAZIO;
    const [cfg] = rows(await db.execute(sql`select tenant_id from cardapio_config where token = ${token} limit 1`));
    if (!cfg) return VAZIO;
    const tenantId = String(cfg.tenant_id);
    const v = verificarCliente(clienteToken);
    if (!v || v.tenant !== tenantId) return VAZIO;
    if (!(await perfilLigado(db, tenantId))) return VAZIO;
    const clienteId = v.cli;
    const [e] = rows(await db.execute(sql`
      select (select x.valor from cliente_escolha x
               where x.cliente_id = ${clienteId}::uuid and x.tenant_id = ${tenantId}::uuid and x.escolha = 'recomendacoes'
               order by x.em desc limit 1) as rec,
             (select x.valor from cliente_escolha x
               where x.cliente_id = ${clienteId}::uuid and x.tenant_id = ${tenantId}::uuid and x.escolha = 'nao_analisar'
               order by x.em desc limit 1) as nao`));
    if (e?.nao === true) return VAZIO;

    // "Seu de sempre": a chave gravada pelo cálculo do perfil → o produto do cadastro (id, código PDV ou nome igual).
    const [s] = rows(await db.execute(sql`
      with ds as (
        select camadas -> 'gosto' -> 'de_sempre' as d from cliente_perfil
         where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid
      )
      select p.id
        from ds join produto p on p.tenant_id = ${tenantId}::uuid
       where ds.d is not null
         and (p.id::text = ds.d ->> 'chave' or (p.codigo is not null and p.codigo = ds.d ->> 'chave')
              or lower(trim(p.nome)) = lower(trim(ds.d ->> 'nome')))
       order by (p.id::text = ds.d ->> 'chave') desc, (p.codigo = ds.d ->> 'chave') desc nulls last
       limit 1`));
    const deSempre = s?.id ? String(s.id) : null;
    if (e?.rec !== true) return { deSempre, voceViu: [], ordemCategorias: [] };

    const I = INTERESSE;
    const viu = rows(await db.execute(sql`
      select i.produto_id
        from cardapio_interacao i
       where i.cliente_id = ${clienteId}::uuid and i.tenant_id = ${tenantId}::uuid and i.tipo = 'produto_aberto'
         and i.produto_id is not null and i.em > now() - make_interval(days => ${I.viuJanelaDias}::int)
       group by i.produto_id
      having count(*) >= ${I.viuVezes}::int
         and ${sqlNaoPediuDesde(sql`${tenantId}::uuid`, sql`${clienteId}::uuid`, sql`i.produto_id`, sql`min(i.em)`)}
       order by max(i.em) desc
       limit 3`));
    const ordem = rows(await db.execute(sql`
      select p.categoria_id
        from cardapio_interacao i join produto p on p.id = i.produto_id and p.tenant_id = i.tenant_id
       where i.cliente_id = ${clienteId}::uuid and i.tenant_id = ${tenantId}::uuid and p.categoria_id is not null
       group by p.categoria_id
       order by sum(${sqlPontosDoClique('i')}) desc
       limit 20`));
    return {
      deSempre,
      voceViu: viu.map((x: any) => String(x.produto_id)).filter((id: string) => id !== deSempre),
      ordemCategorias: ordem.map((x: any) => String(x.categoria_id)),
    };
  } catch (err: any) {
    new Logger('ParaOCliente').warn(`cardápio para o cliente não lido: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`);
    return VAZIO;
  }
}

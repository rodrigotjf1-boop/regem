import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { telefoneE164 } from '../../common/telefone-e164';
import { ProdutoService } from '../produto/produto.service';
import { codificarCursor, lerCursor, lerInstante, lerLimite, vinculoCursor } from './cursor-integracao';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaException } from './problema';
import { FotoVenda, sqlIso } from './venda-integracao';
import { bairroOuNulo, MARKETPLACES_REGEMCAST } from './contato-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LEITURA DAS VENDAS da API de integração (trilha C, C1c — contrato Regem → Liame v1, §2.2 e §2.3).
//
// Lê SÓ a tabela de versões (mig 296): índice + foto publicada. Uma ida ao banco por página (mais
// a validação do token, no guard). Empresa e loja vêm SEMPRE do token:
//   • empresa com várias lojas → só a loja do token (estrito, como o Painel com a loja escolhida);
//   • empresa de UMA loja → a empresa toda, sem filtro de loja — como o Painel dela
//     (`UnidadeUnicaInterceptor`): as vendas SEM loja (cardápio da rede) entram.
// O que depende do token é resolvido aqui, na hora: `cliente` (escopo `clientes.telefone.ler`;
// telefone lido do cadastro, nunca guardado na foto; marketplace nunca manda) e `custo_centavos`
// (escopo `custos.ler` E quem autorizou ainda vê valores em R$ — senão `null`: margem desconhecida
// não é zero). A `origem` do pedido do cardápio (mig 299) também sai daqui, lida na hora: os
// códigos de clique apagados aos 90 dias já saem sem eles, sem versão nova.

/** Atraso de segurança sobre o carimbo, em segundos (o contrato pede pelo menos 5). */
export const ATRASO_LEITURA_SEG = 15;
/** Cache da permissão "ver valores em R$" de quem autorizou, por token. */
const TTL_PERMISSAO_MS = 5 * 60_000;
/** Cache do mapa de custo (o da Curva ABC), por empresa. */
const TTL_CUSTO_MS = 60_000;
const MAX_CACHE = 5_000;
/** Margem do filtro `confirmados_desde` sobre o carimbo (relógio da loja adiantado). */
const MARGEM_CARIMBO_DIAS = 2;

type Consulta = { cursor?: unknown; limite?: unknown; confirmados_desde?: unknown };

@Injectable()
export class VendasIntegracaoService {
  /** Atraso aplicado nesta instância (os testes encurtam; em produção é o da constante). */
  atrasoSeg = ATRASO_LEITURA_SEG;
  private readonly permissao = new Map<string, { em: number; ok: boolean }>();
  private readonly custos = new Map<string, { em: number; mapa: Record<string, number> }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tokens: IntegracaoTokenService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  // ───────────────────────────── GET /integracao/pedidos ─────────────────────────────

  async pedidos(ctx: IntegracaoCtxData, q: Consulta) {
    const limite = lerLimite(q.limite);
    const vinculo = vinculoCursor(ctx.tenantId, ctx.unidadeId);
    const temCursor = q.cursor !== undefined && q.cursor !== '';
    const cur = temCursor ? lerCursor(q.cursor, 'venda', vinculo) : { posicao: null, desde: null };
    let desde = cur.desde;
    if (q.confirmados_desde !== undefined && q.confirmados_desde !== '') {
      const d = lerInstante(q.confirmados_desde, 'confirmados_desde');
      if (temCursor && d !== cur.desde) {
        throw new ProblemaException(
          400,
          'parametro-invalido',
          '"confirmados_desde" vale só na primeira página (sem cursor): depois ele segue dentro do cursor.',
        );
      }
      desde = d;
    }
    const comTelefone = ctx.escopos.includes('clientes.telefone.ler');
    // Token da EMPRESA (RegemCast): todas as lojas, cada venda com o fuso da loja dela. Os campos a
    // mais do contrato do RegemCast (loja, tipo, bairro, cidade, taxa) são lidos NA HORA — o
    // endereço é dado pessoal e não entra na foto; a resposta do Liame não muda.
    const empresa = !ctx.unidadeId;
    const extras = ctx.cliente === 'regemcast';
    const com99 = ctx.escopos.includes('vendas.99food.ler');

    const linhas = this.rows(
      await this.db.execute(sql`
        select v.recurso_id::text as id, v.versao::text as versao, ${sqlIso(sql`v.atualizado_em`)} as atualizado_em,
               v.situacao, v.foto, coalesce(u.timezone, 'America/Sao_Paulo') as fuso,
               ${
                 extras
                   ? sql`v.unidade_id::text as x_unidade_id, uv.nome as x_unidade_nome, pe.tipo as x_tipo,
                         pe.endereco_bairro as x_bairro, pe.endereco_cidade as x_cidade,
                         round(coalesce(pe.taxa_entrega, 0) * 100)::text as x_taxa,
                         (select cc.end_cidade from cardapio_config cc
                           where cc.tenant_id = v.tenant_id and (cc.unidade_id = v.unidade_id or cc.unidade_id is null)
                           order by (cc.unidade_id is null) asc, cc.created_at asc
                           limit 1) as x_cidade_loja,`
                   : sql``
               }
               ${comTelefone ? sql`cl.telefone` : sql`null::text`} as telefone,
               case when po.pedido_id is not null then jsonb_build_object(
                 'capturado_em', ${sqlIso(sql`po.capturado_em`)},
                 'lk', po.lk, 'utm_source', po.utm_source, 'utm_medium', po.utm_medium,
                 'utm_campaign', po.utm_campaign, 'utm_content', po.utm_content, 'utm_term', po.utm_term,
                 'campaign_id', po.campaign_id, 'adset_id', po.adset_id, 'adgroup_id', po.adgroup_id,
                 'ad_id', po.ad_id, 'gclid', po.gclid, 'gbraid', po.gbraid, 'wbraid', po.wbraid,
                 'fbclid', po.fbclid) end as origem
          from integracao_versao v
          left join unidade u on u.id = ${empresa ? sql`v.unidade_id` : sql`${ctx.unidadeId}::uuid`}
          ${
            extras
              ? sql`left join unidade uv on uv.id = v.unidade_id
                    left join pedido_externo pe
                           on v.fonte = 'pedido_externo' and pe.id = v.recurso_id and pe.tenant_id = v.tenant_id`
              : sql``
          }
          left join pedido_origem po
                 on v.fonte = 'pedido_externo' and po.pedido_id = v.recurso_id and po.tenant_id = v.tenant_id
          ${
            comTelefone
              ? sql`left join cliente cl on cl.id = nullif(v.foto->'cliente'->>'id', '')::uuid and cl.tenant_id = v.tenant_id`
              : sql``
          }
         where v.tenant_id = ${ctx.tenantId}::uuid and v.recurso = 'venda'
           and v.atualizado_em is not null
           and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
           ${ctx.lojaUnica || empresa ? sql`` : sql`and v.unidade_id = ${ctx.unidadeId}::uuid`}
           ${
             cur.posicao
               ? sql`and (v.atualizado_em, v.recurso_id) > (${cur.posicao.t}::timestamptz, ${cur.posicao.i}::uuid)`
               : sql``
           }
           ${
             desde
               ? sql`and v.confirmado_em >= ${desde}::timestamptz
                     and v.atualizado_em >= ${desde}::timestamptz - make_interval(days => ${MARGEM_CARIMBO_DIAS})`
               : sql``
           }
         order by v.atualizado_em, v.recurso_id
         limit ${limite + 1}`),
    );

    const pagina = linhas.slice(0, limite);
    const mapa = pagina.some((l) => l.foto?.itens?.length) ? await this.custosDaLeitura(ctx) : null;
    const itens = pagina.map((l) => {
      const venda = this.vendaDoContrato(l, comTelefone, mapa, { com99, extras });
      return extras ? { ...venda, ...camposRegemcast(l) } : venda;
    });
    const ultimo = pagina[pagina.length - 1];
    return {
      itens,
      proximo_cursor: codificarCursor('venda', vinculo, {
        posicao: ultimo ? { t: ultimo.atualizado_em, i: ultimo.id } : cur.posicao,
        desde,
      }),
      tem_mais: linhas.length > limite,
    };
  }

  /** A foto publicada no formato do contrato, com o que depende do token resolvido agora. */
  private vendaDoContrato(
    l: any,
    comTelefone: boolean,
    mapa: Record<string, number> | null,
    o: { com99: boolean; extras: boolean } = { com99: false, extras: false },
  ) {
    const f = l.foto as FotoVenda;
    const situacao = l.situacao as 'confirmado' | 'cancelado' | 'removido';
    // Marketplace nunca manda cliente (D-A2.5-11) — exceto a 99Food com o escopo próprio, que só o
    // RegemCast recebe (a autorização do dono fica registrada lá). Para o RegemCast, a lista dele
    // (com o aiqfome) também conta; a resposta do Liame não muda.
    const marketplace = f.grupo === 'marketplace' || (o.extras && MARKETPLACES_REGEMCAST.has(f.canal));
    const clienteLiberado = !marketplace || (o.com99 && f.canal === '99food');
    const cliente =
      comTelefone && clienteLiberado && f.cliente
        ? { id: f.cliente.id, telefone: telefoneE164(l.telefone), novo: f.cliente.novo ?? null }
        : null;
    return {
      id: l.id as string,
      versao: Number(l.versao),
      atualizado_em: l.atualizado_em as string,
      canal: f.canal,
      grupo_canal: f.grupo,
      situacao,
      moeda: 'BRL',
      fuso: l.fuso as string,
      receita_centavos: f.receita,
      desconto_loja_centavos: f.desconto,
      // Sem estorno parcial no Regem: cancelar desfaz a venda inteira, e isso vai pela `situacao`.
      estornado_centavos: 0,
      cupom: f.cupom ?? null,
      cliente,
      criado_em: f.criado_em ?? null,
      confirmado_em: f.confirmado_em,
      faturado_em: f.faturado_em ?? null,
      cancelado_em: situacao === 'cancelado' ? (f.cancelado_em ?? null) : null,
      itens: (f.itens ?? []).map((it) => ({
        id: it.id,
        produto_id: it.produto_id ?? null,
        nome: it.nome,
        quantidade: it.quantidade,
        receita_centavos: it.receita,
        custo_centavos: custoDoItem(mapa, it.produto_id, it.quantidade),
      })),
      // De onde o cliente do cardápio veio (C3a, mig 299); `null` sem origem gravada.
      origem: l.origem ?? null,
    };
  }

  // ───────────────────────────── custo (o da Curva ABC) ─────────────────────────────

  /**
   * O mapa de custo efetivo por produto — `ProdutoService.custoEfetivoMapa`, a MESMA função da
   * Curva ABC (manual → ficha → estoque), vigente na leitura. Só com `custos.ler` E se quem
   * autorizou o token ainda vê valores em R$ hoje; senão `null` (e todo `custo_centavos` sai nulo).
   * Erro aqui vira 5xx (o Liame tenta de novo): mandar `null` por falha seria gravado como
   * "custo desconhecido" da primeira leitura.
   */
  private async custosDaLeitura(ctx: IntegracaoCtxData): Promise<Record<string, number> | null> {
    if (!ctx.escopos.includes('custos.ler')) return null;
    if (!(await this.autorizadorVeValores(ctx))) return null;
    const agora = Date.now();
    const c = this.custos.get(ctx.tenantId);
    if (c && agora - c.em < TTL_CUSTO_MS) return c.mapa;
    const produtos = this.moduleRef.get(ProdutoService, { strict: false });
    const mapa = Object.freeze(await produtos.custoEfetivoMapa(ctx.tenantId)) as Record<string, number>;
    if (this.custos.size > MAX_CACHE) this.custos.clear();
    this.custos.set(ctx.tenantId, { em: agora, mapa });
    return mapa;
  }

  /** Quem autorizou o token ainda tem "Ver valores em R$" hoje? (pelo cadastro; cache de 5 min) */
  private async autorizadorVeValores(ctx: IntegracaoCtxData): Promise<boolean> {
    const agora = Date.now();
    const c = this.permissao.get(ctx.tokenId);
    if (c && agora - c.em < TTL_PERMISSAO_MS) return c.ok;
    const quem = await this.tokens.autorizador(ctx.tenantId, ctx.autorizadoPor);
    const ok = quem?.verFinanceiro === true;
    if (this.permissao.size > MAX_CACHE) this.permissao.clear();
    this.permissao.set(ctx.tokenId, { em: agora, ok });
    return ok;
  }

  // ───────────────────────────── GET /integracao/clientes/anonimizados ─────────────────────────────

  async clientesAnonimizados(ctx: IntegracaoCtxData, q: Consulta) {
    const limite = lerLimite(q.limite);
    const vinculo = vinculoCursor(ctx.tenantId, ctx.unidadeId);
    const temCursor = q.cursor !== undefined && q.cursor !== '';
    const cur = temCursor ? lerCursor(q.cursor, 'cliente', vinculo) : { posicao: null, desde: null };
    // O cliente é da EMPRESA (não da loja): o aviso vale para todas as lojas dela. Só o id sai.
    const linhas = this.rows(
      await this.db.execute(sql`
        select v.recurso_id::text as id, v.versao::text as versao, ${sqlIso(sql`v.atualizado_em`)} as atualizado_em,
               ${sqlIso(sql`coalesce(v.removido_em, v.atualizado_em)`)} as anonimizado_em
          from integracao_versao v
         where v.tenant_id = ${ctx.tenantId}::uuid and v.recurso = 'cliente'
           and v.atualizado_em is not null
           and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
           ${
             cur.posicao
               ? sql`and (v.atualizado_em, v.recurso_id) > (${cur.posicao.t}::timestamptz, ${cur.posicao.i}::uuid)`
               : sql``
           }
         order by v.atualizado_em, v.recurso_id
         limit ${limite + 1}`),
    );
    const pagina = linhas.slice(0, limite);
    const ultimo = pagina[pagina.length - 1];
    return {
      itens: pagina.map((l) => ({
        id: l.id as string,
        anonimizado_em: l.anonimizado_em as string,
        versao: Number(l.versao),
        atualizado_em: l.atualizado_em as string,
      })),
      proximo_cursor: codificarCursor('cliente', vinculo, {
        posicao: ultimo ? { t: ultimo.atualizado_em, i: ultimo.id } : cur.posicao,
        desde: null,
      }),
      tem_mais: linhas.length > limite,
    };
  }
}

/** Custo do item em centavos: custo unitário vigente × quantidade; sem custo (ou sem mapa) → `null`. */
export function custoDoItem(
  mapa: Record<string, number> | null,
  produtoId: string | null | undefined,
  quantidade: string,
): number | null {
  if (!mapa || !produtoId || !Object.prototype.hasOwnProperty.call(mapa, produtoId)) return null;
  const unitario = Number(mapa[produtoId]);
  const q = Number(quantidade);
  if (!Number.isFinite(unitario) || unitario < 0 || !Number.isFinite(q) || q < 0) return null;
  const c = Math.round(unitario * q * 100);
  return Number.isSafeInteger(c) && c >= 0 ? c : null;
}

/**
 * Campos a mais do contrato do RegemCast (docs/integracao-regemcast.md), lidos na hora:
 *  • `tipo`: entrega | retirada (pedido) · mesa | balcao (comanda — o totem direto é balcão);
 *  • `bairro` e `cidade` da ENTREGA (retirada/balcão/mesa: `null`); "bairro" que é distância
 *    ("~3.2 km", frete por raio) sai `null`; sem cidade no pedido (o cardápio não grava), a cidade
 *    do cardápio da loja — a mesma regra da nota fiscal;
 *  • `taxa_entrega_centavos`: a taxa cobrada no pedido (comanda: 0).
 */
export function camposRegemcast(l: any) {
  const f = l.foto as FotoVenda;
  const doPedido = f.fonte === 'pedido_externo';
  const tipoPedido = String(l.x_tipo ?? '').toLowerCase();
  const tipo = doPedido
    ? tipoPedido === 'entrega' || tipoPedido === 'retirada'
      ? tipoPedido
      : null
    : f.canal === 'mesa'
      ? 'mesa'
      : 'balcao';
  const entrega = tipo === 'entrega';
  const taxa = Math.round(Number(l.x_taxa));
  return {
    unidade_id: (l.x_unidade_id as string | null) ?? null,
    unidade_nome: (l.x_unidade_nome as string | null) ?? null,
    tipo,
    bairro: entrega ? bairroOuNulo(l.x_bairro) : null,
    cidade: entrega ? (String(l.x_cidade ?? '').trim() || String(l.x_cidade_loja ?? '').trim() || null) : null,
    taxa_entrega_centavos: doPedido && Number.isFinite(taxa) && taxa > 0 ? taxa : 0,
  };
}

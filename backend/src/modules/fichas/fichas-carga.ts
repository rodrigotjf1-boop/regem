import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { custoTotalFicha, fichaAlcancavel, type FichaCusto } from '../../common/regras-negocio';
import { fichaIngrediente, fichaTecnica, itemEstoque } from '../../db/schema';
import { normalizarUnidade } from '../estoque/unidades';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CARGA das fichas de uma empresa (fichas vivas, ingredientes vivos e o mapa de custo) e a regra do
// PRODUTO FEITO NA LOJA (mig 314): o produto do estoque ligado à ficha que o produz.
//
// Fica fora do `FichasService` de propósito: o cadastro do estoque precisa das mesmas regras (para
// validar a ligação e mostrar o custo pela ficha) sem depender do serviço — são funções que recebem
// a conexão (ou a transação) e devolvem o resultado.

/** Um produto do estoque feito na loja: qual ficha o produz. */
export type ProdutoFeito = { itemId: string; fichaId: string; nome: string };

/** Os produtos do estoque ligados a uma ficha VIVA (ficha excluída = sem ligação). */
export async function produtosFeitosNaLoja(db: any, tenantId: string): Promise<ProdutoFeito[]> {
  return db
    .select({ itemId: itemEstoque.id, fichaId: itemEstoque.fichaId, nome: itemEstoque.nome })
    .from(itemEstoque)
    .innerJoin(fichaTecnica, and(eq(fichaTecnica.id, itemEstoque.fichaId), eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)))
    .where(and(eq(itemEstoque.tenantId, tenantId), isNotNull(itemEstoque.fichaId), isNull(itemEstoque.deletedAt)))
    .orderBy(asc(itemEstoque.nome));
}

/** A ficha existe e não foi excluída? */
export async function fichaExiste(db: any, tenantId: string, fichaId: string): Promise<boolean> {
  const [f] = await db
    .select({ id: fichaTecnica.id })
    .from(fichaTecnica)
    .where(and(eq(fichaTecnica.id, fichaId), eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)));
  return !!f;
}

// Insumo de custo (pro cálculo recursivo) a partir da ficha + suas linhas. A linha que usa um
// produto FEITO NA LOJA leva a ficha dele: é dela que sai o custo (ver `custoTotalFicha`).
export function fichaCustoDe(f: any, ings: any[], fichaDoItem: Map<string, string> = new Map()): FichaCusto {
  return {
    rendimento: Number(f.rendimento) || 1,
    ingredientes: ings.map((i) => ({
      quantidade: Number(i.quantidade),
      fatorCorrecao: Number(i.fatorCorrecao),
      custoUnitario: Number(i.custoUnitario),
      subFichaId: i.subFichaId ?? null,
      fichaDoItemId: !i.subFichaId && i.itemId ? fichaDoItem.get(i.itemId) ?? null : null,
      somenteDelivery: !!i.somenteDelivery,
    })),
  };
}

/** Tudo o que o cálculo de custo precisa: fichas vivas, ingredientes vivos, o mapa e as ligações. */
export async function carregarFichas(db: any, tenantId: string) {
  const fichas: any[] = await db
    .select()
    .from(fichaTecnica)
    .where(and(eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)))
    .orderBy(asc(fichaTecnica.nome));
  const ings: any[] = fichas.length
    ? await db
        .select()
        .from(fichaIngrediente)
        .where(
          and(
            inArray(fichaIngrediente.fichaId, fichas.map((f) => f.id)),
            isNull(fichaIngrediente.deletedAt), // ingrediente removido não entra no custo
          ),
        )
    : [];
  const feitos = fichas.length ? await produtosFeitosNaLoja(db, tenantId) : [];
  const fichaDoItem = new Map(feitos.map((p) => [p.itemId, p.fichaId]));
  const mapa: Record<string, FichaCusto> = {};
  const nome: Record<string, string> = {};
  for (const f of fichas) {
    nome[f.id] = f.nome;
    mapa[f.id] = fichaCustoDe(f, ings.filter((i) => i.fichaId === f.id), fichaDoItem);
  }
  return { fichas, ings, mapa, nome, feitos, fichaDoItem };
}

/** Custo por unidade de rendimento de uma ficha (custo total ÷ rendimento). 0 = a ficha não tem custo. */
export function custoPorUnidadeDaFicha(fichaId: string, mapa: Record<string, FichaCusto>): number {
  const f = mapa[fichaId];
  if (!f) return 0;
  return custoTotalFicha(fichaId, mapa) / (Number(f.rendimento) > 0 ? Number(f.rendimento) : 1);
}

/** itemId → custo por unidade pela ficha que o produz (só os que têm ficha com custo). */
export async function custoDosProdutosFeitos(db: any, tenantId: string): Promise<Map<string, number>> {
  const { mapa, feitos } = await carregarFichas(db, tenantId);
  const custos = new Map<string, number>();
  for (const p of feitos) {
    const custo = custoPorUnidadeDaFicha(p.fichaId, mapa);
    if (custo > 0) custos.set(p.itemId, custo);
  }
  return custos;
}

/**
 * Do que cada ficha DEPENDE: as sub-receitas dela e as fichas dos produtos feitos na loja que ela
 * usa como ingrediente. É o grafo em que um ciclo ("A é feita de B, que é feita de A") não pode existir.
 */
export function dependenciasDasFichas(
  ings: { fichaId: string; subFichaId?: string | null; itemId?: string | null }[],
  fichaDoItem: Map<string, string>,
): Record<string, string[]> {
  const arestas: Record<string, string[]> = {};
  for (const i of ings) {
    const de = i.subFichaId ?? (i.itemId ? fichaDoItem.get(i.itemId) : undefined);
    if (de) (arestas[i.fichaId] ??= []).push(de);
  }
  return arestas;
}

/**
 * Confere a ligação "este produto é feito por esta ficha" ANTES de gravar (400 dizendo o porquê):
 *  • a ficha existe e não foi excluída;
 *  • ela rende na unidade do produto — é o que faz "custo total ÷ rendimento" ser o custo de uma
 *    unidade do produto, e a produção dar entrada na unidade certa;
 *  • a ficha não usa o próprio produto (direto, por sub-receita ou por outro produto feito na loja).
 * `itemId` ausente = produto que está sendo criado (ainda não há quem o use: não há ciclo possível).
 */
export async function conferirFichaDoProduto(
  db: any,
  tenantId: string,
  p: { itemId?: string | null; fichaId: string; unidade: string; nome: string },
): Promise<{ id: string; nome: string }> {
  const [ficha] = await db
    .select({ id: fichaTecnica.id, nome: fichaTecnica.nome, rendimentoUnidade: fichaTecnica.rendimentoUnidade })
    .from(fichaTecnica)
    .where(and(eq(fichaTecnica.id, p.fichaId), eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)));
  if (!ficha) throw new BadRequestException('Ficha técnica não encontrada: ela pode ter sido excluída.');

  const rende = normalizarUnidade(ficha.rendimentoUnidade);
  const doProduto = normalizarUnidade(p.unidade) ?? p.unidade;
  if (!rende || rende !== doProduto)
    throw new BadRequestException(
      `A ficha "${ficha.nome}" rende em "${ficha.rendimentoUnidade || 'unidade não informada'}" e o produto "${p.nome}" é contado em "${p.unidade}". ` +
        'Para ligar os dois, a ficha tem de render na unidade principal do produto.',
    );

  if (p.itemId) {
    const { ings, fichaDoItem } = await carregarFichas(db, tenantId);
    // A ligação nova cria a dependência "quem usa este produto → esta ficha": há ciclo se a ficha
    // já chega (por sub-receita ou por produto feito na loja) a alguma ficha que usa o produto.
    fichaDoItem.delete(p.itemId); // a ligação ANTIGA deste produto não conta: está sendo trocada
    const dependencias = dependenciasDasFichas(ings, fichaDoItem);
    const usam = new Set(ings.filter((i) => !i.subFichaId && i.itemId === p.itemId).map((i) => i.fichaId as string));
    for (const fichaQueUsa of usam)
      if (fichaAlcancavel(ficha.id, fichaQueUsa, dependencias))
        throw new BadRequestException(
          `A ficha "${ficha.nome}" usa "${p.nome}" como ingrediente (direto ou por outra ficha): o produto não pode ser feito dele mesmo.`,
        );
  }
  return { id: ficha.id, nome: ficha.nome };
}

import { createHash } from 'crypto';
import { arredondarInformado, fatorParaEstoque, type Conversao } from '../../common/conversao-unidade';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CATÁLOGO E FICHAS para a API de integração (Farol — mig 315; contrato em docs/integracao-farol.md):
// as peças sem banco. O serviço lê as tabelas em conjunto e entrega as linhas; aqui elas viram o
// RETRATO que a rota devolve, e o retrato ganha a sua VERSÃO.
//
// SEM DINHEIRO, POR CONSTRUÇÃO: nenhuma consulta do serviço seleciona preço, custo, margem ou CMV,
// e nada daqui os calcula. O teste `integracao-farol.http.spec` varre as duas respostas atrás de
// qualquer campo com nome de dinheiro (ERR-166).
//
// A VERSÃO é a impressão do conteúdo (SHA-256), não um carimbo de data: a linha que o sincronismo
// traz da loja chega com o `updated_at` de quem a editou — mais velho que uma leitura já feita —,
// e uma versão por "maior data" deixaria essa mudança passar. Mudou o retrato, muda a versão;
// mudou só o preço (que não está no retrato), a versão é a mesma.

export type RetratoCatalogo = {
  loja_id: string | null;
  categorias: any[];
  setores: any[];
  produtos: any[];
};

export type RetratoFichas = {
  loja_id: string | null;
  // A empresa usa a MESMA embalagem no balcão e no delivery: as linhas `so_delivery` valem para as duas vendas.
  mesma_embalagem: boolean;
  fichas: any[];
};

/** A impressão de um retrato: os primeiros 32 caracteres do SHA-256 do JSON, na ordem em que foi montado. */
export function versaoDoRetrato(retrato: unknown): string {
  return createHash('sha256').update(JSON.stringify(retrato), 'utf8').digest('hex').slice(0, 32);
}

/** A versão que o cliente diz ter (`?versao=`): só vale se tiver a cara de uma. */
export function versaoInformada(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v) ? v : null;
}

function agrupar<T extends Record<string, any>>(linhas: T[], chave: string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) {
    const lista = mapa.get(l[chave]);
    if (lista) lista.push(l);
    else mapa.set(l[chave], [l]);
  }
  return mapa;
}

/**
 * O que a opção ACRESCENTA ao lanche. Insumo direto: o item do estoque e quanto dele sai, na unidade
 * do estoque (é como o Regem guarda — mig 309). Opção de ficha: a ficha dela. Opção que é um produto
 * (a bebida do combo): o produto. Opção informativa ("ponto da carne") não acrescenta nada.
 */
function acrescenta(o: any) {
  if (o.item_id) {
    return {
      tipo: 'insumo' as const,
      insumo_id: o.item_id as string,
      nome: (o.item_nome as string | null) ?? null,
      quantidade_estoque: Number(o.quantidade),
      unidade_estoque: (o.item_unidade as string | null) ?? null,
    };
  }
  if (o.origem_tipo === 'ficha' && o.origem_ficha_id) return { tipo: 'ficha' as const, ficha_id: o.origem_ficha_id as string };
  if (o.produto_ref_id) return { tipo: 'produto' as const, produto_id: o.produto_ref_id as string };
  return null;
}

/** O ingrediente da ficha que a opção RETIRA ("sem cebola"): o insumo (ou a sub-receita) e o nome dele. */
function retira(o: any) {
  if (!o.tem_retira) return null;
  return {
    insumo_id: (o.retira_item_id as string | null) ?? null,
    sub_ficha_id: (o.retira_sub_ficha_id as string | null) ?? null,
    nome: (o.retira_nome as string | null) ?? null,
  };
}

/** Monta o retrato do catálogo a partir das linhas das sete consultas (cada lista já vem ordenada). */
export function montarCatalogo(
  lojaId: string | null,
  linhas: { categorias: any[]; setores: any[]; produtos: any[]; variacoes: any[]; combos: any[]; grupos: any[]; opcoes: any[] },
): RetratoCatalogo {
  const variacoes = agrupar(linhas.variacoes, 'produto_id');
  const combos = agrupar(linhas.combos, 'produto_id');
  const grupos = agrupar(linhas.grupos, 'produto_id');
  const opcoes = agrupar(linhas.opcoes, 'grupo_id');
  return {
    loja_id: lojaId,
    categorias: linhas.categorias.map((c) => ({
      id: c.id,
      nome: c.nome,
      categoria_pai_id: c.categoria_pai_id ?? null,
      ordem: Number(c.ordem),
      ativo: c.ativo === true,
    })),
    setores: linhas.setores.map((s) => ({ id: s.id, nome: s.nome })),
    produtos: linhas.produtos.map((p) => ({
      id: p.id,
      codigo: p.codigo ?? null,
      nome: p.nome,
      descricao: p.descricao ?? null,
      tipo: p.tipo,
      unidade_medida: p.unidade_medida ?? null,
      categoria_id: p.categoria_id ?? null,
      vai_para_producao: p.vai_para_producao === true,
      setor_producao_id: p.setor_producao_id ?? null,
      tempo_preparo_min: p.tempo_preparo_min == null ? null : Number(p.tempo_preparo_min),
      ficha_id: p.ficha_id ?? null,
      ativo: p.ativo === true,
      variacoes: (variacoes.get(p.id) ?? []).map((v) => ({
        id: v.id,
        nome: v.nome,
        codigo: v.codigo ?? null,
        fator_ficha: Number(v.fator_ficha),
        ativo: v.ativo === true,
      })),
      combo: (combos.get(p.id) ?? []).map((c) => ({ produto_id: c.componente_id, quantidade: Number(c.quantidade) })),
      adicionais: (grupos.get(p.id) ?? []).map((g) => ({
        id: g.id,
        etapa_id: g.etapa_id ?? null,
        nome: g.nome,
        tipo: g.tipo,
        min: Number(g.min),
        max: g.max == null ? null : Number(g.max),
        obrigatorio: g.obrigatorio === true,
        ordem: Number(g.ordem),
        opcoes: (opcoes.get(g.id) ?? []).map((o) => ({
          id: o.id,
          opcao_id: o.opcao_id ?? null,
          nome: o.nome,
          codigo: o.codigo ?? null,
          ordem: Number(o.ordem),
          informativa: !String(o.codigo ?? '').trim(),
          acrescenta: g.tipo === 'remover' ? null : acrescenta(o),
          retira: g.tipo === 'remover' ? retira(o) : null,
        })),
      })),
    })),
  };
}

/**
 * Monta o retrato das fichas. O Regem GRAVA a quantidade na unidade do estoque do insumo e guarda
 * ao lado a unidade em que a pessoa a informou ("2 fatia" de um queijo em kg = 0,04 kg): saem as
 * duas — a informada, que é como a cozinha fala, e a do estoque, que é a da baixa. Insumo escrito
 * à mão e sub-receita não têm conversão: a quantidade sai como está.
 */
export function montarFichas(
  lojaId: string | null,
  linhas: { fichas: any[]; ingredientes: any[]; conversoes: any[]; mesmaEmbalagem?: boolean },
): RetratoFichas {
  const ingredientes = agrupar(linhas.ingredientes, 'ficha_id');
  const conversoes = agrupar(linhas.conversoes, 'item_id');
  return {
    loja_id: lojaId,
    mesma_embalagem: linhas.mesmaEmbalagem === true,
    fichas: linhas.fichas.map((f) => ({
      id: f.id,
      nome: f.nome,
      categoria: f.categoria ?? null,
      rendimento: Number(f.rendimento),
      rendimento_unidade: f.rendimento_unidade ?? null,
      porcao_tamanho: f.porcao_tamanho == null ? null : Number(f.porcao_tamanho),
      porcao_unidade: f.porcao_unidade ?? null,
      setor_id: f.setor_id ?? null,
      ativo: f.ativo === true,
      ingredientes: (ingredientes.get(f.id) ?? []).map((i) => {
        const noEstoque = Number(i.quantidade);
        const doItem = !i.sub_ficha_id && i.item_id && i.item_unidade ? (i.item_unidade as string) : null;
        const conv = (doItem ? conversoes.get(i.item_id) ?? [] : []) as Conversao[];
        const fator = doItem ? fatorParaEstoque(i.unidade, doItem, conv) ?? 1 : 1;
        return {
          ordem: Number(i.ordem),
          insumo_id: i.sub_ficha_id ? null : i.item_id ?? null,
          sub_ficha_id: i.sub_ficha_id ?? null,
          nome: i.insumo_nome,
          quantidade: fator === 1 ? noEstoque : arredondarInformado(noEstoque / fator),
          unidade: i.unidade ?? doItem,
          quantidade_estoque: noEstoque,
          unidade_estoque: doItem,
          fator_correcao: Number(i.fator_correcao),
          so_delivery: i.somente_delivery === true,
          so_balcao: i.somente_balcao === true,
        };
      }),
    })),
  };
}

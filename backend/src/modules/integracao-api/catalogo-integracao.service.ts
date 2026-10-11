import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { montarCatalogo, montarFichas, versaoDoRetrato, versaoInformada } from './catalogo-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LEITURA DO CATÁLOGO E DAS FICHAS pela API de integração (Farol — mig 315; contrato em
// docs/integracao-farol.md). Lê as tabelas NA HORA e devolve o retrato inteiro, com a versão dele:
// catálogo de loja tem centenas de linhas, e um retrato com versão é mais simples e mais seguro
// do que uma lista de mudanças (os ids de variação, de ingrediente e de adicional materializado
// mudam a cada salvamento — não há o que seguir por eles).
//
// ESCALA: sete consultas no catálogo e três nas fichas, QUALQUER que seja o número de produtos —
// cada tabela é lida uma vez, já recortada pela loja com `join`, nunca uma consulta por produto.
//
// LOJA: vem do token. Produto e ficha são da loja OU da rede (sem loja — V4); a empresa de uma
// loja só lê tudo, como nas vendas e nos cupons. Setor é sempre de uma loja: só os dela.
//
// DINHEIRO: nenhuma consulta daqui seleciona preço, custo, margem ou CMV (ERR-166).

type Consulta = { versao?: unknown };

@Injectable()
export class CatalogoIntegracaoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async rows(q: SQL): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r?.rows ?? r ?? [];
  }

  /** Da loja do token OU da rede. Empresa de uma loja só (ou token da empresa inteira): tudo. */
  private daLoja(coluna: SQL, ctx: IntegracaoCtxData): SQL {
    if (!ctx.unidadeId || ctx.lojaUnica) return sql`true`;
    return sql`(${coluna} = ${ctx.unidadeId}::uuid or ${coluna} is null)`;
  }

  private responder<T extends object>(retrato: T, q: Consulta) {
    const versao = versaoDoRetrato(retrato);
    if (versaoInformada(q.versao) === versao) return { versao, atualizado: false as const };
    return { versao, atualizado: true as const, gerado_em: new Date().toISOString(), ...retrato };
  }

  /** `GET /integracao/catalogo`: categorias, setores, produtos, variações, combos e adicionais. */
  async catalogo(ctx: IntegracaoCtxData, q: Consulta = {}) {
    const tenant = sql`${ctx.tenantId}::uuid`;
    const produtoDaLoja = this.daLoja(sql`p.unidade_id`, ctx);

    const categorias = await this.rows(sql`
      select c.id::text as id, c.nome, c.parent_id::text as categoria_pai_id, c.ordem, c.ativo
        from categoria_produto c
       where c.tenant_id = ${tenant} and c.deleted_at is null
       order by c.ordem, c.nome, c.id`);

    const setores = await this.rows(sql`
      select s.id::text as id, s.nome
        from setor s
       where s.tenant_id = ${tenant} and s.deleted_at is null
         and ${ctx.unidadeId ? sql`s.unidade_id = ${ctx.unidadeId}::uuid` : sql`true`}
       order by s.nome, s.id`);

    const produtos = await this.rows(sql`
      select p.id::text as id, p.codigo, p.nome, p.descricao, p.tipo, p.unidade_medida,
             p.categoria_id::text as categoria_id, p.vai_para_producao,
             p.setor_producao_id::text as setor_producao_id, p.tempo_preparo_min,
             p.ficha_id::text as ficha_id, p.ativo
        from produto p
       where p.tenant_id = ${tenant} and p.deleted_at is null and ${produtoDaLoja}
       order by p.nome, p.id`);

    const variacoes = await this.rows(sql`
      select v.id::text as id, v.produto_id::text as produto_id, v.nome, v.codigo,
             v.fator_ficha::float8 as fator_ficha, v.ativo
        from produto_variacao v
        join produto p on p.id = v.produto_id and p.tenant_id = v.tenant_id
       where v.tenant_id = ${tenant} and v.deleted_at is null and p.deleted_at is null and ${produtoDaLoja}
       order by v.produto_id, v.nome, v.id`);

    const combos = await this.rows(sql`
      select ci.combo_produto_id::text as produto_id, ci.componente_produto_id::text as componente_id,
             ci.quantidade::float8 as quantidade
        from produto_combo_item ci
        join produto p on p.id = ci.combo_produto_id and p.tenant_id = ci.tenant_id
       where ci.tenant_id = ${tenant} and ci.deleted_at is null and p.deleted_at is null and ${produtoDaLoja}
       order by ci.combo_produto_id, ci.componente_produto_id, ci.id`);

    const grupos = await this.rows(sql`
      select g.id::text as id, g.produto_id::text as produto_id, g.nome, g.tipo, g.min, g.max, g.obrigatorio,
             g.ordem, g.origem_complemento_id::text as etapa_id
        from complemento_grupo g
        join produto p on p.id = g.produto_id and p.tenant_id = g.tenant_id
       where g.tenant_id = ${tenant} and g.deleted_at is null and p.deleted_at is null and ${produtoDaLoja}
       order by g.produto_id, g.ordem, g.nome, g.id`);

    // A opção com o que ela põe ou tira: o insumo (pelo item do estoque), a ficha (pela opção
    // reutilizável de onde foi materializada) ou o produto; e, no grupo de retirar, o ingrediente
    // da ficha — lido mesmo se a ficha foi salva de novo depois (a linha antiga fica, apagada).
    const opcoes = await this.rows(sql`
      select o.id::text as id, o.grupo_id::text as grupo_id, o.nome, o.codigo_pdv as codigo, o.ordem,
             o.origem_opcao_id::text as opcao_id,
             o.item_id::text as item_id, o.quantidade::float8 as quantidade,
             i.nome as item_nome, i.unidade_medida as item_unidade,
             op.tipo as origem_tipo, op.ficha_id::text as origem_ficha_id,
             o.produto_ref_id::text as produto_ref_id,
             (o.ficha_ingrediente_id is not null) as tem_retira,
             fi.item_id::text as retira_item_id, fi.sub_ficha_id::text as retira_sub_ficha_id,
             fi.insumo_nome as retira_nome
        from complemento_opcao o
        join complemento_grupo g on g.id = o.grupo_id and g.tenant_id = o.tenant_id
        join produto p on p.id = g.produto_id and p.tenant_id = g.tenant_id
        left join opcao op on op.id = o.origem_opcao_id and op.tenant_id = o.tenant_id
        left join item_estoque i on i.id = o.item_id and i.tenant_id = o.tenant_id
        left join ficha_ingrediente fi on fi.id = o.ficha_ingrediente_id and fi.tenant_id = o.tenant_id
       where o.tenant_id = ${tenant} and o.deleted_at is null and g.deleted_at is null
         and p.deleted_at is null and ${produtoDaLoja}
       order by o.grupo_id, o.ordem, o.nome, o.id`);

    return this.responder(
      montarCatalogo(ctx.unidadeId, { categorias, setores, produtos, variacoes, combos, grupos, opcoes }),
      q,
    );
  }

  /** `GET /integracao/fichas`: as fichas técnicas e os ingredientes de cada uma. */
  async fichas(ctx: IntegracaoCtxData, q: Consulta = {}) {
    const tenant = sql`${ctx.tenantId}::uuid`;
    const fichaDaLoja = this.daLoja(sql`f.unidade_id`, ctx);

    const fichas = await this.rows(sql`
      select f.id::text as id, f.nome, f.categoria, f.rendimento::float8 as rendimento, f.rendimento_unidade,
             f.porcao_tamanho::float8 as porcao_tamanho, f.porcao_unidade, f.setor_id::text as setor_id, f.ativo
        from ficha_tecnica f
       where f.tenant_id = ${tenant} and f.deleted_at is null and ${fichaDaLoja}
       order by f.nome, f.id`);

    const ingredientes = await this.rows(sql`
      select fi.ficha_id::text as ficha_id, fi.item_id::text as item_id, fi.sub_ficha_id::text as sub_ficha_id,
             fi.insumo_nome, fi.quantidade::float8 as quantidade, fi.unidade,
             fi.fator_correcao::float8 as fator_correcao, fi.somente_delivery, fi.ordem,
             i.unidade_medida as item_unidade
        from ficha_ingrediente fi
        join ficha_tecnica f on f.id = fi.ficha_id and f.tenant_id = fi.tenant_id
        left join item_estoque i on i.id = fi.item_id and i.tenant_id = fi.tenant_id
       where fi.tenant_id = ${tenant} and fi.deleted_at is null and f.deleted_at is null and ${fichaDaLoja}
       order by fi.ficha_id, fi.ordem, fi.insumo_nome, fi.id`);

    // As conversões de unidade dos insumos que aparecem nessas fichas (uma consulta para todos).
    const conversoes = await this.rows(sql`
      select c.item_id::text as item_id, c.unidade_de as "unidadeDe", c.fator::float8 as fator,
             c.unidade_para as "unidadePara"
        from item_conversao c
       where c.tenant_id = ${tenant}
         and c.item_id in (
           select fi.item_id
             from ficha_ingrediente fi
             join ficha_tecnica f on f.id = fi.ficha_id and f.tenant_id = fi.tenant_id
            where fi.tenant_id = ${tenant} and fi.deleted_at is null and fi.item_id is not null
              and f.deleted_at is null and ${fichaDaLoja})
       order by c.item_id, c.unidade_de, c.unidade_para, c.id`);

    return this.responder(montarFichas(ctx.unidadeId, { fichas, ingredientes, conversoes }), q);
  }
}

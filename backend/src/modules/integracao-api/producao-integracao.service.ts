import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { ConsultaComVersao, daLojaDoToken, responderComVersao } from './leitura-na-hora';
import { HORAS_DOS_ABERTOS, HORAS_DOS_CONCLUIDOS, montarProducao } from './producao-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LEITURA DA FILA DE PRODUÇÃO pela API de integração (Farol — escopo `producao.ler`; contrato em
// docs/integracao-farol.md). Lida NA HORA: o retrato inteiro da janela, com a versão dele.
//
// A JANELA: os pedidos em produção (recebido ou em preparo) criados nas últimas 24 horas, e os
// concluídos (pronto ou entregue) ou cancelados nas últimas 2 horas. É a fila que a cozinha vê
// (`destino_tipo = 'kds'`), sem o histórico.
//
// ESCALA: três consultas, QUALQUER que seja o número de pedidos — os pedidos, os itens e as
// escolhas, cada tabela lida uma vez. O recorte no tempo usa `updated_at` (índice
// `idx_sync_producao_pedido`): o pedido que entra na janela foi criado ou mudou de etapa dentro
// dela, então a leitura nunca percorre o histórico da empresa.
//
// LOJA: vem do token (`daLojaDoToken`). Na nuvem, a fila da loja que tem servidor próprio é a que
// o sincronismo trouxe: chega com até um minuto de atraso.
//
// SEM CLIENTE E SEM DINHEIRO: nenhuma consulta daqui toca a `comanda` (onde estão o cliente, o CPF,
// a mesa e o total) nem seleciona `preco_unitario` ou `preco_delta` (ERR-166).

@Injectable()
export class ProducaoIntegracaoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async rows(q: SQL): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r?.rows ?? r ?? [];
  }

  /** `GET /integracao/producao`: a fila da cozinha da loja do token. */
  async producao(ctx: IntegracaoCtxData, q: ConsultaComVersao = {}) {
    const tenant = sql`${ctx.tenantId}::uuid`;
    // O pedido que está na janela. `updated_at` primeiro: é o que o índice alcança, e nenhum pedido
    // da janela tem `updated_at` mais velho do que o começo dela.
    const naJanela = sql`
          pp.tenant_id = ${tenant}
      and pp.updated_at > now() - make_interval(hours => ${HORAS_DOS_ABERTOS})
      and pp.destino_tipo = 'kds'
      and ${daLojaDoToken(sql`pp.unidade_id`, ctx)}
      and (   (pp.status in ('recebido', 'preparo')
               and pp.criado_em > now() - make_interval(hours => ${HORAS_DOS_ABERTOS}))
           or (pp.status in ('pronto', 'entregue', 'cancelado')
               and coalesce(greatest(pp.pronto_em, pp.entregue_em, pp.cancelado_em), pp.updated_at)
                   > now() - make_interval(hours => ${HORAS_DOS_CONCLUIDOS})))`;

    const pedidos = await this.rows(sql`
      select pp.id::text as id, pp.numero, pp.origem, pp.plataforma, pp.consumo, pp.status,
             pp.setor_id::text as setor_id, pp.tempo_preparo_min, (pp.obs = 'ALTERADO') as alterado,
             pp.criado_em, pp.iniciado_em, pp.pronto_em, pp.entregue_em, pp.cancelado_em
        from producao_pedido pp
       where ${naJanela}
       order by pp.criado_em, pp.id`);

    // O item da fila guarda só o texto; o produto, a variação e a ficha estão no item da venda. A
    // variação é lida mesmo se o produto foi salvo de novo depois (a linha antiga fica, apagada).
    const itens = await this.rows(sql`
      select i.id::text as id, i.pedido_id::text as pedido_id, i.descricao, i.quantidade::float8 as quantidade,
             i.complementos_texto, i.observacao, i.status,
             ci.id::text as comanda_item_id, ci.produto_id::text as produto_id, ci.ficha_id::text as ficha_id,
             ci.variacao_id::text as variacao_id, v.nome as variacao_nome, v.codigo as variacao_codigo,
             v.fator_ficha::float8 as variacao_fator
        from producao_pedido_item i
        join producao_pedido pp on pp.id = i.pedido_id and pp.tenant_id = i.tenant_id
        left join comanda_item ci on ci.id = i.comanda_item_id and ci.tenant_id = i.tenant_id
        left join produto_variacao v on v.id = ci.variacao_id and v.tenant_id = ci.tenant_id
       where i.tenant_id = ${tenant} and ${naJanela}
       order by i.pedido_id, ci.created_at nulls last, i.id`);

    // As escolhas de cada item, como ficaram gravadas na venda: o que acrescentaram (insumo, ficha
    // ou produto) e o ingrediente que tiraram. O id fixo da opção vem da opção do produto de onde
    // a escolha saiu — lida mesmo se o produto foi salvo de novo depois.
    const escolhas = await this.rows(sql`
      select c.comanda_item_id::text as comanda_item_id, c.tipo, c.nome, c.quantidade::float8 as quantidade,
             c.item_id::text as item_id, c.produto_ref_id::text as produto_ref_id,
             co.origem_opcao_id::text as opcao_id, op.tipo as origem_tipo, op.ficha_id::text as origem_ficha_id,
             ie.nome as item_nome, ie.unidade_medida as item_unidade,
             (c.ficha_ingrediente_id is not null) as tem_retira,
             fi.item_id::text as retira_item_id, fi.sub_ficha_id::text as retira_sub_ficha_id,
             fi.insumo_nome as retira_nome
        from comanda_item_complemento c
        left join complemento_opcao co on co.id = c.opcao_id and co.tenant_id = c.tenant_id
        left join opcao op on op.id = co.origem_opcao_id and op.tenant_id = co.tenant_id
        left join item_estoque ie on ie.id = c.item_id and ie.tenant_id = c.tenant_id
        left join ficha_ingrediente fi on fi.id = c.ficha_ingrediente_id and fi.tenant_id = c.tenant_id
       where c.tenant_id = ${tenant}
         and c.comanda_item_id in (
           select i.comanda_item_id
             from producao_pedido_item i
             join producao_pedido pp on pp.id = i.pedido_id and pp.tenant_id = i.tenant_id
            where i.tenant_id = ${tenant} and i.comanda_item_id is not null and ${naJanela})
       order by c.comanda_item_id, c.created_at, c.id`);

    return responderComVersao(montarProducao(ctx.unidadeId, { pedidos, itens, escolhas }), q);
  }
}

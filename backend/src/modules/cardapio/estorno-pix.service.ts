import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ESTORNO DO PIX NO CANCELAMENTO (mig 372, 06/11/2026 — o dono cancelou um pedido pago por Pix e o dinheiro não voltou).
// Só na NUVEM (o token do gateway mora lá; o cancelamento feito no servidor da loja chega pelo sincronismo do pedido). A
// cada volta:
//   1. ENFILEIRA: todo pedido cancelado que foi pago online (Pix aprovado pelo Mercado Pago, PagBank ou Rede) e ainda não
//      tem linha em `pedido_estorno` ganha uma (`pendente`) — uma consulta só, para todas as empresas, com a condição
//      inteira no `where` (LIC-527) e pelo índice parcial; `pedido_id` único (duas réplicas, uma linha). Encomenda com
//      sinal fica fora (o sinal tem o caminho dele, `reembolsarSinal`). Só os cancelados nos últimos 30 dias;
//   2. PEGA A VEZ (`for update skip locked`; `processando` com prazo — a réplica que caiu no meio devolve a vez em 5 min)
//      e pede o estorno TOTAL ao gateway (`CardapioService.reembolsarPagamentoTotal`; o Mercado Pago ainda tem a chave de
//      idempotência `refund-<pagamento>`: a 2ª tentativa do mesmo estorno não devolve duas vezes);
//   3. `feito` com o id do estorno; falha → conta a tentativa e devolve à fila; na 3ª, `falhou` e um caso URGENTE na fila do
//      Atendimento: "devolva à mão" (com o motivo). Nunca some calado.
export const TENTATIVAS_DO_ESTORNO = 3;
const POR_VOLTA = 20;
const JANELA_DIAS = 30;

export type Reembolsador = Pick<CardapioService, 'reembolsarPagamentoTotal'>;

@Injectable()
export class EstornoPixService {
  private readonly logger = new Logger('EstornoPix');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(CardapioService) private readonly cardapio: Reembolsador,
    // O caso novo aparece na fila na hora (o sino). Opcional: os testes montam sem.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private linhas(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  /** Os cancelados pagos online sem linha de estorno ganham uma (`pendente`). Devolve quantas entraram. */
  async enfileirar(): Promise<number> {
    const r = this.linhas(
      await this.db.execute(sql`
        insert into pedido_estorno (tenant_id, pedido_id, provedor, valor)
        select pe.tenant_id, pe.id, pe.gateway_provider, pe.total
          from pedido_externo pe
         where pe.status = 'cancelado' and pe.pago and pe.status_pagamento = 'aprovado' and pe.gateway_payment_id is not null
           and pe.cancelado_em > now() - make_interval(days => ${JANELA_DIAS})
           and pe.gateway_provider in ('mercadopago', 'pagseguro', 'rede')
           and pe.sinal_status is null
           and not exists (select 1 from pedido_estorno e where e.pedido_id = pe.id)
         order by pe.cancelado_em
         limit ${POR_VOLTA}
        on conflict (pedido_id) do nothing
        returning id`),
    );
    return r.length;
  }

  /** Pega a vez de até POR_VOLTA estornos (os pendentes e os "processando" de uma réplica que caiu há 5 min+). */
  private async pegar(): Promise<any[]> {
    return this.linhas(
      await this.db.execute(sql`
        with alvo as (
          select e.id from pedido_estorno e
           where e.situacao = 'pendente'
              or (e.situacao = 'processando' and e.atualizado_em < now() - interval '5 minutes')
           order by e.atualizado_em
           limit ${POR_VOLTA}
           for update skip locked
        )
        update pedido_estorno e
           set situacao = 'processando', atualizado_em = clock_timestamp()
          from alvo, pedido_externo pe
         where e.id = alvo.id and pe.id = e.pedido_id
        returning e.id, e.tenant_id as "tenantId", e.pedido_id as "pedidoId", e.provedor, e.valor, e.tentativas,
                  pe.gateway_payment_id as "pagamento", pe.unidade_id as "unidadeId", pe.display_id as "numero",
                  pe.cliente_nome as "cliente", pe.cliente_telefone as "telefone"`),
    );
  }

  /** Uma volta: enfileira e trata a vez. Devolve o que aconteceu (a rotina anota; o teste confere). */
  async volta(): Promise<{ enfileirados: number; feitos: number; falhas: number; desistiu: number }> {
    const enfileirados = await this.enfileirar();
    let feitos = 0;
    let falhas = 0;
    let desistiu = 0;
    for (const e of await this.pegar()) {
      try {
        const r = await this.cardapio.reembolsarPagamentoTotal(e.tenantId, e.provedor, e.pagamento);
        await this.db.execute(sql`
          update pedido_estorno
             set situacao = 'feito', estorno_id = ${r?.id ? String(r.id) : null}, erro = null, tentativas = tentativas + 1,
                 feito_em = clock_timestamp(), atualizado_em = clock_timestamp()
           where id = ${e.id}::uuid`);
        feitos++;
        this.logger.log(`estorno feito: pedido ${e.pedidoId} (${e.provedor}, R$ ${Number(e.valor).toFixed(2)})`);
      } catch (err: any) {
        const motivo = String(err?.message ?? err).slice(0, 300);
        const ultima = Number(e.tentativas) + 1 >= TENTATIVAS_DO_ESTORNO;
        await this.db.execute(sql`
          update pedido_estorno
             set situacao = ${ultima ? 'falhou' : 'pendente'}, erro = ${motivo}, tentativas = tentativas + 1,
                 atualizado_em = clock_timestamp()
           where id = ${e.id}::uuid`);
        if (ultima) {
          desistiu++;
          await this.avisarALoja(e, motivo);
        } else falhas++;
        this.logger.warn(`estorno do pedido ${e.pedidoId} falhou (tentativa ${Number(e.tentativas) + 1}/${TENTATIVAS_DO_ESTORNO}): ${motivo}`);
      }
    }
    return { enfileirados, feitos, falhas, desistiu };
  }

  /** A 3ª falha: um caso URGENTE na fila do Atendimento — a loja devolve à mão. */
  private async avisarALoja(e: any, motivo: string): Promise<void> {
    const nome = { mercadopago: 'Mercado Pago', pagseguro: 'PagBank', rede: 'Rede' }[e.provedor as string] ?? e.provedor;
    const valor = Number(e.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const mensagem =
      `O estorno do Pix do pedido #${e.numero ?? ''} (${valor}) não saiu: devolva o valor ao cliente pelo app do ${nome}. ` +
      `Motivo do ${nome}: ${motivo}`;
    const [caso] = this.linhas(
      await this.db.execute(sql`
        insert into atendimento_chamado (tenant_id, unidade_id, tipo, cliente, telefone, pedido_numero, pedido_id, mensagem, prioridade)
        values (${e.tenantId}::uuid, ${e.unidadeId}::uuid, 'atendimento', ${e.cliente ?? null}, ${e.telefone ?? null},
                ${e.numero ?? null}, ${e.pedidoId}::uuid, ${mensagem}, 'urgente')
        returning *`),
    );
    if (caso) this.events?.emit('atendimento.novo', { tenantId: e.tenantId, chamado: caso });
  }
}

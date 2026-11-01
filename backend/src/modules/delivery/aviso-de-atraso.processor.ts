import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AVISO AUTOMÁTICO DE ATRASO AO CLIENTE (Bloco 5 do plano do robô, aprovado pelo dono; mig 347). Só na NUVEM: o aviso
 * sai pelo WhatsApp OFICIAL (o modelo `pedido_atrasado` e a janela de 24 h só existem lá) — na Evolution o aviso
 * dependeria do fluxo do n8n, que não trata o "atrasado".
 *
 * Quem entra: a loja que LIGOU o aviso (`robo_config.aviso_atraso`, nasce desligado) e está na API oficial; o pedido do
 * cardápio próprio (`canal = 'cardapio'` — o robô do WhatsApp também grava assim; iFood e 99 avisam pelo app deles), sem
 * agendamento, com o telefone do cliente, ainda em andamento (entrega: em produção, pronto ou a caminho; retirada: em
 * produção — pronto, o cliente já foi avisado), que passou do tempo PROMETIDO (tempo de entrega ou de retirada da
 * loja, contado da entrada do pedido) mais a tolerância da loja. Só pedidos das últimas 6 horas.
 *
 * Uma vez só por pedido: a linha de `pedido_aviso_atraso` é gravada ANTES do envio (`on conflict do nothing`) — duas
 * réplicas da API, ou duas voltas, nunca avisam duas vezes (V24, V42). Até 100 pedidos por volta, de 2 em 2 minutos.
 */
@Injectable()
export class AvisoDeAtrasoProcessor {
  private readonly logger = new Logger('AvisoDeAtraso');
  private rodando = false;
  static readonly POR_VOLTA = 100;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(120_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.avisarAtrasados();
    } catch (e: any) {
      // Uma volta que falha não derruba a próxima; o motivo vai para o log.
      this.logger.warn(`aviso de atraso: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** Os pedidos atrasados das lojas que ligaram o aviso — uma consulta para todas as lojas (set-based). */
  async pedidosAtrasados(): Promise<{ id: string; tenantId: string }[]> {
    const r: any = await this.db.execute(sql`
      select p.id, p.tenant_id
        from pedido_externo p
        join robo_config rc on rc.tenant_id = p.tenant_id and rc.aviso_atraso
        join lateral (
          select c.provedor,
                 case when p.tipo = 'retirada' then c.tempo_retirada_min else c.tempo_entrega_min end as prometido
            from cardapio_config c
           where c.tenant_id = p.tenant_id
           order by (c.unidade_id is not distinct from p.unidade_id) desc, (c.unidade_id is null) desc
           limit 1
        ) cfg on true
       where cfg.provedor = 'cloud'
         and p.canal = 'cardapio'
         and p.agendamento is null
         and p.cliente_telefone is not null
         and ((p.tipo = 'entrega' and p.status in ('confirmado', 'pronto', 'despachado'))
              or (p.tipo = 'retirada' and p.status = 'confirmado'))
         and p.criado_em > now() - interval '6 hours'
         and coalesce(cfg.prometido, 0) > 0
         and p.criado_em + make_interval(mins => cfg.prometido + rc.aviso_atraso_tolerancia_min) < now()
         and not exists (select 1 from pedido_aviso_atraso a where a.pedido_id = p.id)
       order by p.criado_em
       limit ${AvisoDeAtrasoProcessor.POR_VOLTA}`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ id: String(x.id), tenantId: String(x.tenant_id) }));
  }

  /** Avisa os atrasados: marca "já avisei" primeiro (quem não marcou, outra volta já avisou) e manda. Devolve quantos. */
  async avisarAtrasados(): Promise<number> {
    let n = 0;
    for (const p of await this.pedidosAtrasados()) {
      const r: any = await this.db.execute(sql`
        insert into pedido_aviso_atraso (pedido_id, tenant_id) values (${p.id}::uuid, ${p.tenantId}::uuid)
        on conflict (pedido_id) do nothing
        returning pedido_id`);
      if (!(r?.rows ?? r ?? []).length) continue;
      const saida = await this.delivery.avisarAtraso(p.tenantId, p.id);
      if (saida.saiu) n++;
    }
    if (n) this.logger.log(`aviso de atraso: ${n} cliente(s) avisado(s)`);
    return n;
  }
}

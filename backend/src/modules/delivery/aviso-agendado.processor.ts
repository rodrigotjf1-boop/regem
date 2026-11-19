import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "ENTROU EM PREPARO" DO PEDIDO AGENDADO (mig 455, D4 — protótipo `regem-atendente-alergenos-agendado.html`, parte 2, os
 * cinco avisos ao cliente). Só na NUVEM (os avisos ao cliente saem por ela; no servidor da loja o `dispararWebhook`
 * encaminha). No aceite, o cliente do agendado recebe a confirmação do agendamento; o "em produção" de sempre sai aqui, na
 * hora em que o cartão começa a contar na cozinha (G3: o tempo de entrega ou de retirada antes do horário).
 *
 * Quem entra: o pedido do cardápio próprio agendado (`retirada_tipo = 'agendado'`), aceito (`confirmado`), ainda não
 * avisado, cujo preparo já começou, das últimas 2 horas. Uma vez só por pedido: a marca `agendado_preparo_avisado_em` é
 * gravada ANTES do envio por gravação condicional — duas réplicas, ou duas voltas, nunca avisam duas vezes (V42).
 * Até 100 pedidos por volta, de minuto em minuto.
 */
@Injectable()
export class AvisoAgendadoProcessor {
  private readonly logger = new Logger('AvisoAgendado');
  private rodando = false;
  static readonly POR_VOLTA = 100;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(60_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.avisarEmPreparo();
    } catch (e: any) {
      this.logger.warn(`aviso do agendado em preparo: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** Os agendados cujo preparo começou e que ainda não foram avisados — uma consulta para todas as lojas (set-based). */
  async agendadosEmPreparo(): Promise<{ id: string; tenantId: string }[]> {
    const r: any = await this.db.execute(sql`
      select p.id, p.tenant_id
        from pedido_externo p
        join lateral (
          select case when p.tipo in ('retirada', 'local') then coalesce(c.tempo_retirada_min, 20) else coalesce(c.tempo_entrega_min, 40) end as preparo
            from cardapio_config c
           where c.tenant_id = p.tenant_id
           order by (c.unidade_id is not distinct from p.unidade_id) desc, (c.unidade_id is null) desc
           limit 1
        ) cfg on true
       where p.canal = 'cardapio'
         and p.retirada_tipo = 'agendado'
         and p.status = 'confirmado'
         and p.agendado_preparo_avisado_em is null
         and p.agendamento is not null
         and p.agendamento > now() - interval '2 hours'
         and p.agendamento - make_interval(mins => greatest(cfg.preparo, 0)) <= now()
       order by p.agendamento
       limit ${AvisoAgendadoProcessor.POR_VOLTA}`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ id: String(x.id), tenantId: String(x.tenant_id) }));
  }

  /** Marca "já avisei" primeiro (quem não marcou, outra volta já avisou) e manda o "em produção". Devolve quantos. */
  async avisarEmPreparo(): Promise<number> {
    let n = 0;
    for (const p of await this.agendadosEmPreparo()) {
      const r: any = await this.db.execute(sql`
        update pedido_externo set agendado_preparo_avisado_em = now()
         where id = ${p.id}::uuid and agendado_preparo_avisado_em is null
        returning id`);
      if (!(r?.rows ?? r ?? []).length) continue;
      await this.delivery.avisarAgendadoEmPreparo(p.tenantId, p.id);
      n++;
    }
    if (n) this.logger.log(`agendado em preparo: ${n} cliente(s) avisado(s)`);
    return n;
  }
}

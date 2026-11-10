import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { SEM_LOGISTICA_DO_CANAL } from '../entregador/modo-entrega';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O "SAIU PARA ENTREGA" COM O RASTREIO AO CLIENTE DA 99 pelo WhatsApp da loja (pedido do dono, 09/11/2026: "na 99 como
 * temos o contato o link de rastreio vai ser enviado como no cardápio digital"; mig 388). Só na NUVEM: o WhatsApp da loja
 * (oficial ou por QR) só a nuvem alcança — e o despacho feito no servidor da loja ou pelo app da 99 não gera evento na
 * nuvem (a mesma razão da rotina dos avisos do chat). De 30 em 30 s.
 *
 * Quem entra: a loja que LIGOU "Falar com o cliente da 99 pelo WhatsApp" (`robo_config.cliente_99_whatsapp`, nasce
 * desligado); o pedido da 99 de ENTREGA DA LOJA (o do entregador da 99, a 99 avisa — `SEM_LOGISTICA_DO_CANAL`), com o
 * telefone, que saiu há até 10 min (ligar o ajuste não avisa o que saiu há uma hora). Toda a condição está no `where`
 * (V84): o que não pode receber nem entra na lista.
 *
 * Uma vez só por pedido: a linha de `pedido_aviso_99` é gravada ANTES do envio (`on conflict do nothing`) — duas réplicas
 * da API ou duas voltas nunca mandam duas vezes (V24, V42). Até 100 pedidos por volta.
 */
@Injectable()
export class AvisoDa99Processor {
  private readonly logger = new Logger('AvisoDa99');
  private rodando = false;
  static readonly POR_VOLTA = 100;
  static readonly JANELA_MIN = 10;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(30_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.avisarOsQueSairam();
    } catch (e: any) {
      // Banco sem a 388 ainda: nada a fazer — não enche o log a cada volta.
      const code = e?.code ?? e?.cause?.code;
      if (code !== '42703' && code !== '42P01') this.logger.warn(`aviso da 99: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** Os pedidos da 99 que acabaram de sair, das lojas que ligaram o ajuste — uma consulta para todas (set-based). */
  async pedidosQueSairam(): Promise<{ id: string; tenantId: string }[]> {
    const r: any = await this.db.execute(sql`
      select p.id, p.tenant_id
        from pedido_externo p
        join robo_config rc on rc.tenant_id = p.tenant_id and rc.cliente_99_whatsapp
       where p.canal = '99food'
         and p.tipo <> 'retirada'
         and p.status = 'despachado'
         and p.cliente_telefone is not null
         and p.despachado_em > now() - make_interval(mins => ${AvisoDa99Processor.JANELA_MIN})
         and ${SEM_LOGISTICA_DO_CANAL}
         and not exists (select 1 from pedido_aviso_99 a where a.pedido_id = p.id and a.evento = 'saiu_entrega')
       order by p.despachado_em
       limit ${AvisoDa99Processor.POR_VOLTA}`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ id: String(x.id), tenantId: String(x.tenant_id) }));
  }

  /** Marca "já mandei" primeiro (quem não marcou, outra volta já mandou) e manda. Devolve quantos saíram. */
  async avisarOsQueSairam(): Promise<number> {
    let n = 0;
    for (const p of await this.pedidosQueSairam()) {
      const r: any = await this.db.execute(sql`
        insert into pedido_aviso_99 (pedido_id, evento, tenant_id) values (${p.id}::uuid, 'saiu_entrega', ${p.tenantId}::uuid)
        on conflict (pedido_id, evento) do nothing
        returning pedido_id`);
      if (!(r?.rows ?? r ?? []).length) continue;
      const saida = await this.delivery.avisarSaiuDa99(p.tenantId, p.id);
      if (saida.saiu) n++;
    }
    if (n) this.logger.log(`aviso da 99: ${n} cliente(s) avisado(s) do "saiu para entrega"`);
    return n;
  }
}

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { campanha, campanhaEnvio, cliente } from '../../db/schema';
import { WhatsappService } from '../whatsapp/whatsapp.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Campanhas de WhatsApp por segmento (F5). USO INTERNO do lojista, sempre por
// tenant. Envio pela instância da própria loja, PAUSADO (anti-ban), respeitando
// opt-out. Worker resiliente: se o processo reiniciar, retoma os pendentes.
@Injectable()
export class CampanhaService {
  private readonly logger = new Logger('Campanha');
  private rodando = false;
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly whatsapp: WhatsappService,
  ) {}

  // Fragmento SQL do segmento (mesma lógica do CRM; alias da tabela = `c`).
  private segFrag(segmento?: string) {
    const m: Record<string, any> = {
      mes: sql`and c.ultimo_pedido_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')`,
      '30d': sql`and c.ultimo_pedido_em >= now() - interval '30 days'`,
      sem_30: sql`and c.ultimo_pedido_em < now() - interval '30 days'`,
      sem_60: sql`and c.ultimo_pedido_em < now() - interval '60 days'`,
      campeoes: sql`and (select count(*) from pedido_externo p where p.cliente_id = c.id and p.status <> 'cancelado' and p.criado_em >= now() - interval '30 days') >= 3`,
    };
    return m[String(segmento ?? '')] ?? sql``;
  }

  // Público estimado (quem receberia): do segmento, com telefone, exceto opt-out.
  async previa(tenantId: string, segmento: string) {
    const r: any = await this.db.execute(sql`
      select count(*)::int as total from cliente c
      where c.tenant_id = ${tenantId} and c.opt_out_marketing = false
        and coalesce(c.telefone, '') <> '' ${this.segFrag(segmento)}`);
    return { total: (r.rows ?? r)[0]?.total ?? 0 };
  }

  async listar(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select id, segmento, mensagem, intervalo_seg, teto_dia, total, enviados, falhas, status, criado_em
      from campanha where tenant_id = ${tenantId} order by criado_em desc limit 50`);
    return r.rows ?? r;
  }

  // Cria a campanha e MATERIALIZA os destinatários numa única query (set-based —
  // nunca loop N), excluindo opt-out. O worker cuida do envio pausado.
  async criar(
    tenantId: string,
    criadoPor: string | null,
    dto: {
      segmento?: string;
      mensagem?: string;
      intervaloSeg?: number;
      tetoDia?: number | null;
      instanciaTipo?: string;
    },
  ) {
    const mensagem = String(dto.mensagem ?? '').trim();
    if (mensagem.length < 3) throw new BadRequestException('Mensagem muito curta.');
    if (mensagem.length > 900) throw new BadRequestException('Mensagem muito longa (máx. 900 caracteres).');
    const segmento = String(dto.segmento ?? 'todos');
    const intervaloSeg = Math.min(Math.max(Number(dto.intervaloSeg) || 7, 3), 120);
    const tetoDia = dto.tetoDia != null && Number(dto.tetoDia) > 0 ? Number(dto.tetoDia) : null;
    const instanciaTipo = dto.instanciaTipo === 'marketing' ? 'marketing' : 'loja';

    // Loja na API oficial: a Meta NAO aceita texto livre para iniciar conversa, so
    // modelo aprovado. Barrar aqui e melhor que deixar a campanha rodar e falhar um
    // contato de cada vez, deixando o lojista achando que o numero foi bloqueado.
    const prov: any = await this.db.execute(
      sql`select provedor from cardapio_config where tenant_id = ${tenantId} limit 1`,
    );
    if ((prov.rows ?? prov)[0]?.provedor === 'cloud')
      throw new BadRequestException(
        'Esta loja usa a API oficial da Meta, que não permite campanha com texto livre — ' +
          'só modelo aprovado. Use os avisos de pedido, ou volte a conexão por QR Code em ' +
          'Delivery · Config · Robô.',
      );
    if (instanciaTipo === 'marketing') {
      const r: any = await this.db.execute(
        sql`select marketing_instancia from cardapio_config where tenant_id = ${tenantId} limit 1`,
      );
      if (!(r.rows ?? r)[0]?.marketing_instancia)
        throw new BadRequestException('Número de marketing não conectado. Conecte antes de enviar por ele.');
    }

    const [camp] = await this.db
      .insert(campanha)
      .values({ tenantId, criadoPor: criadoPor ?? null, segmento, mensagem, intervaloSeg, tetoDia, instanciaTipo })
      .returning();

    const ins: any = await this.db.execute(sql`
      insert into campanha_envio (campanha_id, tenant_id, cliente_id, telefone)
      select ${camp.id}, c.tenant_id, c.id, c.telefone
      from cliente c
      where c.tenant_id = ${tenantId} and c.opt_out_marketing = false
        and coalesce(c.telefone, '') <> '' ${this.segFrag(segmento)}`);
    const total = ins.rowCount ?? 0;
    await this.db
      .update(campanha)
      .set({ total, status: total > 0 ? 'enviando' : 'concluida', atualizadoEm: new Date() })
      .where(eq(campanha.id, camp.id));
    return { id: camp.id, total };
  }

  // Cliente opta por não receber campanhas (LGPD). Escopo por tenant.
  async toggleOptOut(tenantId: string, clienteId: string, optOut: boolean) {
    if (!clienteId) throw new BadRequestException('Cliente inválido.');
    await this.db
      .update(cliente)
      .set({ optOutMarketing: !!optOut, atualizadoEm: new Date() })
      .where(and(eq(cliente.tenantId, tenantId), eq(cliente.id, clienteId)));
    return { ok: true, optOut: !!optOut };
  }

  // Worker: a cada tick, envia 1 mensagem por campanha PRONTA (pacing por
  // intervalo_seg), respeitando o teto diário. Só na nuvem; nunca sobrepõe.
  @Interval(3000)
  async worker() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return;
    this.rodando = true;
    try {
      const prontas: any = await this.db.execute(sql`
        select id, tenant_id, mensagem, intervalo_seg, teto_dia, instancia_tipo from campanha
        where status = 'enviando'
          and (select coalesce(max(enviado_em), to_timestamp(0)) from campanha_envio e
               where e.campanha_id = campanha.id and e.status = 'enviado')
              < now() - (intervalo_seg || ' seconds')::interval
        limit 20`);
      for (const camp of prontas.rows ?? prontas) {
        if (camp.teto_dia) {
          const hj: any = await this.db.execute(sql`
            select count(*)::int as n from campanha_envio
            where campanha_id = ${camp.id} and status = 'enviado'
              and enviado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo')`);
          if (((hj.rows ?? hj)[0]?.n ?? 0) >= camp.teto_dia) continue;
        }
        const prox: any = await this.db.execute(sql`
          select id, telefone from campanha_envio
          where campanha_id = ${camp.id} and status = 'pendente' order by id limit 1`);
        const envio = (prox.rows ?? prox)[0];
        if (!envio) {
          await this.db
            .update(campanha)
            .set({ status: 'concluida', atualizadoEm: new Date() })
            .where(eq(campanha.id, camp.id));
          continue;
        }
        const tel = String(envio.telefone).replace(/\D/g, '');
        const numero = tel.length === 10 || tel.length === 11 ? '55' + tel : tel;
        try {
          await this.whatsapp.enviarCampanha(camp.tenant_id, camp.instancia_tipo ?? 'loja', numero, camp.mensagem);
          await this.db
            .update(campanhaEnvio)
            .set({ status: 'enviado', enviadoEm: new Date() })
            .where(eq(campanhaEnvio.id, envio.id));
          await this.db.execute(sql`update campanha set enviados = enviados + 1, atualizado_em = now() where id = ${camp.id}`);
        } catch (e: any) {
          await this.db
            .update(campanhaEnvio)
            .set({ status: 'falha', erro: String(e?.message ?? e).slice(0, 300), enviadoEm: new Date() })
            .where(eq(campanhaEnvio.id, envio.id));
          await this.db.execute(sql`update campanha set falhas = falhas + 1, atualizado_em = now() where id = ${camp.id}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`worker: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}

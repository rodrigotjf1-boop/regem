import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { CalendarioDaLojaService } from './calendario-da-loja.service';
import { calcularSensibilidadeDaEmpresa } from './sensibilidade-da-empresa';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_SQL } from '../../common/fuso-sql';
import { sqlCalcularPerfis } from './calculo-do-perfil';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O módulo ativável (`modulo.service` MODULOS): nasce DESLIGADO — o presidente liga (D10). */
export const MODULO_PERFIL = 'perfil_cliente';
/** A volta da rotina vale por 20 horas (uma por dia, com folga para o horário andar). */
const VALIDADE_HORAS = 20;
/** A rotina só roda de madrugada/manhã (a loja vende das 19h às 02h): das 4h às 11h de Brasília. */
const JANELA = { de: 4, ate: 11 };
/** A ficha recalcula o cliente na hora se o perfil tiver mais de 6 horas (ou não existir). */
const FICHA_FRESCA_HORAS = 6;

@Injectable()
export class PerfilClienteService {
  private readonly log = new Logger(PerfilClienteService.name);
  private rodando = false;
  private avaliacaoExiste: boolean | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // A cópia do calendário por loja (F2) vai na mesma volta da rotina noturna.
    @Optional() private readonly calendario?: CalendarioDaLojaService,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  /** `pedido_avaliacao` (mig 453) mora só na nuvem; no banco de loja do CI ela não existe. */
  private async temAvaliacao(): Promise<boolean> {
    if (this.avaliacaoExiste === null) {
      const r = this.rows(await this.db.execute(sql`select to_regclass('pedido_avaliacao') is not null as ok`));
      this.avaliacaoExiste = !!r[0]?.ok;
    }
    return this.avaliacaoExiste;
  }

  /** O módulo está ligado na empresa (na rede ou em alguma loja)? */
  async moduloLigado(tenantId: string): Promise<boolean> {
    const r = this.rows(await this.db.execute(sql`
      select exists (select 1 from modulo_ativacao where tenant_id = ${tenantId}::uuid
                       and modulo = ${MODULO_PERFIL} and ativo) as ligado`));
    return !!r[0]?.ligado;
  }

  /**
   * Recalcula o perfil de TODOS os clientes diretos da empresa, numa transação: grava os perfis e apaga os que não valem
   * mais (o cliente pediu para não ser analisado, ou ficou sem pedido direto). Idempotente.
   */
  async calcularEmpresa(tenantId: string): Promise<{ clientes: number; removidos: number; ms: number }> {
    const inicio = Date.now();
    const temAval = await this.temAvaliacao();
    const r = await this.db.transaction(async (tx: any) => {
      const gravados = this.rows(await tx.execute(sqlCalcularPerfis(tenantId, null, temAval)));
      const removidos: any = await tx.execute(sql`
        delete from cliente_perfil where tenant_id = ${tenantId}::uuid and calculado_em < now()`);
      return { clientes: gravados.length, removidos: Number(removidos?.rowCount ?? 0) };
    });
    const ms = Date.now() - inicio;
    await this.db.execute(sql`
      insert into perfil_cliente_execucao (tenant_id, rodou_em, clientes, duracao_ms, erro)
      values (${tenantId}::uuid, now(), ${r.clientes}, ${ms}, null)
      on conflict (tenant_id) do update set rodou_em = now(), clientes = excluded.clientes,
        duracao_ms = excluded.duracao_ms, erro = null`);
    return { ...r, ms };
  }

  /** Recalcula UM cliente (com os números da loja do mesmo jeito). Sem pedido direto ou sem análise: o perfil sai. */
  async calcularCliente(tenantId: string, clienteId: string): Promise<boolean> {
    const temAval = await this.temAvaliacao();
    return this.db.transaction(async (tx: any) => {
      const gravados = this.rows(await tx.execute(sqlCalcularPerfis(tenantId, clienteId, temAval)));
      if (!gravados.length) {
        await tx.execute(sql`delete from cliente_perfil where tenant_id = ${tenantId}::uuid and cliente_id = ${clienteId}::uuid`);
      }
      return gravados.length > 0;
    });
  }

  /**
   * A rotina: a cada 30 minutos, dentro da janela da manhã, pega UMA empresa com o módulo ligado cuja última volta
   * passou da validade e a "reserva" na mesma instrução (duas réplicas não pegam a mesma — V98). O relógio de cadência
   * longa fica no banco, não no processo (V104: o `@Interval` longo recomeça a cada deploy).
   */
  @Cron('0 */30 * * * *', { timeZone: 'America/Sao_Paulo' })
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      for (let i = 0; i < 20; i++) {
        const tenantId = await this.reservarProxima();
        if (!tenantId) break;
        try {
          const r = await this.calcularEmpresa(tenantId);
          this.log.log(`perfil do cliente: empresa ${tenantId.slice(0, 8)} — ${r.clientes} perfis, ${r.removidos} removidos, ${r.ms} ms`);
          // A cópia do calendário por loja e dia (F2, mig 461) — à parte: se falhar, o perfil já foi gravado.
          if (this.calendario) {
            await this.calendario
              .materializar(tenantId)
              .then((c) => this.log.log(`calendário da loja: empresa ${tenantId.slice(0, 8)} — ${c.lojas} loja(s), ${c.dias} dias`))
              .catch((e: any) => this.log.error(`calendário da loja: empresa ${tenantId.slice(0, 8)} falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack));
          }
          // O que move cada cliente (F3 parte 2, mig 463) — depois da cópia do calendário, que ela lê. À parte também.
          await calcularSensibilidadeDaEmpresa(this.db, tenantId)
            .then((s) => s && this.log.log(`sensibilidade a eventos: empresa ${tenantId.slice(0, 8)} — ${s.linhas} medidas, ${s.selos} selos`))
            .catch((e: any) => this.log.error(`sensibilidade a eventos: empresa ${tenantId.slice(0, 8)} falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack));
        } catch (e: any) {
          this.log.error(`perfil do cliente: empresa ${tenantId.slice(0, 8)} falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
          await this.db.execute(sql`update perfil_cliente_execucao set erro = ${String(e?.message ?? e).slice(0, 300)}
                                     where tenant_id = ${tenantId}::uuid`);
        }
      }
    } catch (e: any) {
      this.log.error(`perfil do cliente: a rotina falhou: ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Reserva a próxima empresa (insere/atualiza a volta só se a anterior passou da validade). `null` = nenhuma. */
  async reservarProxima(): Promise<string | null> {
    const r = this.rows(await this.db.execute(sql`
      with candidata as (
        select m.tenant_id from (select distinct tenant_id from modulo_ativacao where modulo = ${MODULO_PERFIL} and ativo) m
          left join perfil_cliente_execucao x on x.tenant_id = m.tenant_id
         where extract(hour from now() at time zone ${FUSO_SQL}) between ${JANELA.de} and ${JANELA.ate}
           and (x.rodou_em is null or x.rodou_em < now() - make_interval(hours => ${VALIDADE_HORAS}))
         order by x.rodou_em nulls first
         limit 1
      )
      insert into perfil_cliente_execucao as x (tenant_id, rodou_em)
      select tenant_id, now() from candidata
      on conflict (tenant_id) do update set rodou_em = now()
        where x.rodou_em < now() - make_interval(hours => ${VALIDADE_HORAS})
      returning x.tenant_id`));
    return r[0]?.tenant_id ?? null;
  }

  /** A ficha do cliente (presidente e gerente — conferido no controlador). Recalcula na hora se estiver velha. */
  async ficha(tenantId: string, clienteId: string) {
    const c = this.rows(await this.db.execute(sql`
      select id, nome, telefone, total_pedidos, criado_em from cliente
       where id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`))[0];
    if (!c) throw new NotFoundException('Cliente não encontrado.');
    const atual = this.rows(await this.db.execute(sql`
      select calculado_em > now() - make_interval(hours => ${FICHA_FRESCA_HORAS}) as fresca
        from cliente_perfil where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`))[0];
    if (!atual?.fresca) await this.calcularCliente(tenantId, clienteId);
    const perfil = this.rows(await this.db.execute(sql`
      select pedidos_diretos, primeiro_pedido_em, ultimo_pedido_em, segmento, rfm, ticket_medio, ticket_ajustado,
             intervalo_dias, proximo_previsto, atraso, faixa_habitual, dia_habitual, confianca, etiquetas, camadas,
             calculado_em
        from cliente_perfil where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`))[0] ?? null;
    const declarado = this.rows(await this.db.execute(sql`
      select chave, valor, origem, informado_em, atualizado_em from cliente_declarado
       where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid order by chave`));
    const escolhas = this.rows(await this.db.execute(sql`
      select distinct on (escolha) escolha, valor, origem, em from cliente_escolha
       where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid
       order by escolha, em desc`));
    const naoAnalisar = escolhas.some((e: any) => e.escolha === 'nao_analisar' && e.valor);
    // O que move o cliente (F3 parte 2, mig 463): só com perfil; o selo primeiro.
    const sensibilidade = perfil
      ? this.rows(await this.db.execute(sql`
          select tipo, rr, prob, pedidos, esperado, dias_com_pedido, selo, calculado_em from cliente_evento_sensibilidade
           where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid order by selo desc, prob desc`))
      : [];
    // Quem pediu só pelo iFood/99 tem pedidos, mas não tem perfil (D1): a ficha diz por quê.
    const soPlataforma = !perfil && !naoAnalisar && Number(c.total_pedidos ?? 0) > 0;
    return {
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone, desde: c.criado_em },
      situacao: naoAnalisar ? 'nao_analisar' : perfil ? 'com_perfil' : soPlataforma ? 'so_plataforma' : 'sem_pedido',
      perfil,
      declarado,
      escolhas,
      sensibilidade,
    };
  }

  /** A contagem dos segmentos e das etiquetas da empresa (a linha de situações de Delivery › Clientes). */
  async resumo(tenantId: string) {
    const seg = this.rows(await this.db.execute(sql`
      select segmento, count(*)::int as n from cliente_perfil where tenant_id = ${tenantId}::uuid group by segmento`));
    const etq = this.rows(await this.db.execute(sql`
      select e as etiqueta, count(*)::int as n from cliente_perfil, unnest(etiquetas) e
       where tenant_id = ${tenantId}::uuid group by e`));
    const exec = this.rows(await this.db.execute(sql`
      select rodou_em, clientes, duracao_ms, erro from perfil_cliente_execucao where tenant_id = ${tenantId}::uuid`))[0] ?? null;
    return {
      segmentos: Object.fromEntries(seg.map((s: any) => [s.segmento, s.n])),
      etiquetas: Object.fromEntries(etq.map((s: any) => [s.etiqueta, s.n])),
      total: seg.reduce((a: number, s: any) => a + s.n, 0),
      ultimaVolta: exec,
    };
  }
}

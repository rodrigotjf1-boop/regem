import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { dataNoFuso, hojeISO, horaAgora, somarDias } from '../../common/data';
import { MidiaService } from '../midia/midia.service';
import { EstoqueService } from '../estoque/estoque.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';
import { PedidoManutencaoService } from '../pedido-manutencao/pedido-manutencao.service';
import { EtiquetaValidadeService } from '../etiqueta-validade/etiqueta-validade.service';
import { PontoService, competenciaMesAnterior } from '../ponto/ponto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Agendador de jobs do backend. (Instância única no EasyPanel — sem lock distribuído.)
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
    private readonly estoque: EstoqueService,
    private readonly ordemProducao: OrdemProducaoService,
    private readonly manutencao: PedidoManutencaoService,
    private readonly etiquetas: EtiquetaValidadeService,
    private readonly ponto: PontoService,
    private readonly events: EventEmitter2,
  ) {}

  // Épico #2 — Fechamento mensal de ponto. No 1º dia do mês, para cada tenant,
  // detecta pendências do mês anterior e materializa o fechamento; se houver
  // pendências, alerta o gestor (Gerenciamento de ponto).
  @Cron('0 6 1 * *') // 06:00 do dia 1 de cada mês
  async fecharPontoMensal() {
    const competencia = competenciaMesAnterior();
    const [ano, mes] = competencia.split('-');
    for (const tenantId of await this.tenantsAtivos()) {
      try {
        const f = await this.ponto.gerarFechamento(tenantId, competencia);
        const pend = Number(f.totalPendencias) || 0;
        if (pend > 0) {
          const titulo = `Fechamento de ponto ${mes}/${ano}: ${pend} pendência(s)`;
          const detalhe = 'Corrija as batidas faltantes em Gerenciamento de ponto e encaminhe o espelho ao RH.';
          this.events.emit('kds.alerta.sistema', {
            tenantId,
            titulo,
            detalhe,
            prioridade: 'alta',
          });
        }
        this.log.log(
          `fechamento de ponto ${competencia} (${tenantId}): ${pend} pendência(s)`,
        );
      } catch (e: any) {
        this.log.error(`fecharPontoMensal[${tenantId}]: ${e?.message ?? e}`);
      }
    }
  }

  // Alertas de etiquetas de validade (a vencer / vencidas) ao C&O/gerente. Mig 136.
  // Expurgo das tabelas de sync que crescem sem fim (janela da mig 265). Sem isto:
  //  • `sync_exclusao` guarda um registro por exclusão para sempre — o Sync Gateway do
  //    Couchbase expurga em 3 dias, o SQL Data Sync da Azure em 45, o AppSync usa TTL;
  //  • `edge_heartbeat` crescia 2 linhas por minuto por loja (14,4 milhões/dia em 5.000).
  // Quem ficar parado além da janela é mandado para a restauração por arquivo pelo pull
  // (bandeira `reinicializar`), em vez de seguir com exclusão perdida em silêncio.
  @Cron('50 4 * * *') // 04:50 todos os dias, fora do movimento
  async expurgarMetadadosSync() {
    const dias = Number(process.env.SYNC_RETENCAO_DIAS ?? 30);
    for (const [tabela, coluna, janela] of [
      ['sync_exclusao', 'created_at', dias],
      ['edge_heartbeat', 'recebido_em', dias],
      ['edge_telemetria', 'criado_em', 90],
    ] as [string, string, number][]) {
      try {
        const r: any = await this.db.execute(
          sql`delete from ${sql.identifier(tabela)} where ${sql.identifier(coluna)} < now() - make_interval(days => ${janela})`,
        );
        const n = r?.rowCount ?? 0;
        if (n) this.log.log(`expurgo ${tabela}: ${n} linha(s) acima de ${janela} dias`);
      } catch (e: any) {
        // Tabela só-nuvem ausente no edge (42P01) é esperado — o job roda nos dois.
        if (e?.code !== '42P01') this.log.error(`expurgo ${tabela}: ${e?.message ?? e}`);
      }
    }
  }

  @Cron('15 6 * * *') // 06:15 todos os dias
  async alertasEtiquetas() {
    try {
      const n = await this.etiquetas.alertasValidade();
      if (n) this.log.log(`etiquetas a vencer/vencidas avaliadas: ${n}`);
    } catch (e: any) {
      this.log.error(`alertasEtiquetas: ${e?.message ?? e}`);
    }
  }

  // Pedidos de manutenção abertos há mais de 15 dias perguntam ao C&O o que fazer
  // (manter / concluir / excluir). Dispara o alerta uma vez por pedido. Mig 134.
  @Cron('40 6 * * *') // 06:40 todos os dias
  async promoverManutencaoAntiga() {
    try {
      const n = await this.manutencao.promoverAntigos();
      if (n) this.log.log(`manutenção pendente > 15 dias: ${n}`);
    } catch (e: any) {
      this.log.error(`promoverManutencaoAntiga: ${e?.message ?? e}`);
    }
  }

  // Ordens de produção "aguardando lançamento" com data prevista > 1 dia viram
  // pendência crítica (sobem no painel do gerente/C&O; exigem desfecho). Mig 130.
  @Cron('20 6 * * *') // 06:20 todos os dias
  async promoverOrdensPendentes() {
    try {
      const n = await this.ordemProducao.promoverPendenciasCriticas();
      if (n) this.log.log(`ordens de produção → pendência crítica: ${n}`);
    } catch (e: any) {
      this.log.error(`promoverOrdensPendentes: ${e?.message ?? e}`);
    }
  }

  // Gera as ordens de produção RECORRENTES do dia (a partir de tarefa_def). Mig 130.
  @Cron('30 5 * * *') // 05:30 todos os dias
  async gerarOrdensRecorrentes() {
    const hoje = new Date().toISOString().slice(0, 10);
    for (const tid of await this.tenantsAtivos()) {
      try {
        const n = await this.ordemProducao.gerarRecorrentes(tid, hoje);
        if (n) this.log.log(`ordens recorrentes geradas (${tid}): ${n}`);
      } catch (e: any) {
        this.log.error(`gerarOrdensRecorrentes[${tid}]: ${e?.message ?? e}`);
      }
    }
  }

  // Para quem calcular o alerta de estoque (auditoria #45, mig 249).
  //  • Rede de UMA loja (ou nenhuma cadastrada): um alerta só, de unidade nula — igual
  //    a antes. O `UnidadeUnicaInterceptor` zera o filtro nesses tenants, então a tela
  //    enxerga o alerta de qualquer jeito.
  //  • Rede de VÁRIAS lojas: um alerta POR LOJA, calculado com o MESMO escopo da tela
  //    que aquela loja já usa. Antes o alerta era do tenant inteiro e gravado sem
  //    unidade: a loja não via nada, e a correção óbvia (mostrar o de rede) exporia a
  //    lista de insumos das outras lojas.
  private async alvosDeAlerta(tenantId: string): Promise<(string | null)[]> {
    const r: any = await this.db.execute(
      sql`select id from unidade where tenant_id = ${tenantId} and deleted_at is null order by id`,
    );
    const ids = (r.rows ?? r).map((x: any) => x.id as string);
    return ids.length > 1 ? ids : [null];
  }

  private async tenantsAtivos(): Promise<string[]> {
    const r: any = await this.db.execute(
      sql`select id from empresa where deleted_at is null`,
    );
    return (r.rows ?? r).map((x: any) => x.id);
  }

  // Expurgo LGPD: apaga do storage as fotos de ponto vencidas (data_expurgo < hoje).
  @Cron('0 3 * * *') // 03:00 todos os dias
  async expurgarFotosPonto() {
    const r: any = await this.db.execute(sql`
      select id, foto_ref as "fotoRef" from ponto_marcacao
      where foto_ref is not null and data_expurgo is not null
        and data_expurgo < current_date
      limit 500
    `);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    let apagadas = 0;
    for (const row of rows) {
      const ok = await this.midia.remover(row.fotoRef);
      // Zera a referência mesmo se o storage falhar — evita reprocessar sem fim.
      await this.db.execute(
        sql`update ponto_marcacao set foto_ref = null where id = ${row.id}`,
      );
      if (ok) apagadas++;
    }
    this.log.log(
      `Expurgo LGPD: ${apagadas}/${rows.length} fotos de ponto removidas do storage`,
    );
  }

  // Expurgo LGPD: apaga as fotos de comprovação de tarefas vencidas (retenção 30d).
  @Cron('5 3 * * *') // 03:05 todos os dias
  async expurgarFotosTarefa() {
    const r: any = await this.db.execute(sql`
      select id, foto_ref as "fotoRef", fotos from tarefa_instancia
      where data_expurgo is not null and data_expurgo < current_date
      limit 500
    `);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    let apagadas = 0;
    for (const row of rows) {
      const refs: string[] = Array.isArray(row.fotos) ? row.fotos : [];
      if (row.fotoRef && !refs.includes(row.fotoRef)) refs.push(row.fotoRef);
      for (const ref of refs) if (await this.midia.remover(ref)) apagadas++;
      await this.db.execute(
        sql`update tarefa_instancia set foto_ref = null, fotos = '[]'::jsonb, data_expurgo = null where id = ${row.id}`,
      );
    }
    this.log.log(
      `Expurgo LGPD: ${apagadas} foto(s) de tarefa removida(s) do storage (${rows.length} tarefa(s))`,
    );
  }

  // Expurgo LGPD: fotos de desperdício e vistoria retidas > 90 dias (não tinham
  // rotina de expurgo). Baseado em created_at → cobre também as fotos antigas.
  @Cron('7 3 * * *') // 03:07 todos os dias
  async expurgarFotosOperacao() {
    const RETENCAO_DIAS = 90;
    for (const tabela of ['desperdicio', 'vistoria'] as const) {
      const r: any = await this.db.execute(sql`
        select id, foto_ref as "fotoRef" from ${sql.raw(tabela)}
        where foto_ref is not null
          and created_at < now() - (${RETENCAO_DIAS} * interval '1 day')
        limit 500
      `);
      const rows = r.rows ?? r;
      if (!rows.length) continue;
      let apagadas = 0;
      for (const row of rows) {
        if (row.fotoRef && (await this.midia.remover(row.fotoRef))) apagadas++;
        await this.db.execute(sql`update ${sql.raw(tabela)} set foto_ref = null where id = ${row.id}`);
      }
      this.log.log(`Expurgo LGPD: ${apagadas} foto(s) de ${tabela} removida(s) (${rows.length})`);
    }
  }

  // §1.4 — Ponto de pedido: alerta os itens no/abaixo do ROP (por tenant, em tempo real).
  @Cron('0 6 * * *') // 06:00
  async pontoDePedido() {
    // Fuso da operação (common/data). `toISOString()` dava o dia certo só porque o job
    // roda às 06:00; era a mesma armadilha das seis cópias de `hojeISO`.
    const hoje = hojeISO();
    const ini = dataNoFuso(new Date(Date.now() - 27 * 86400000)); // janela 28d
    for (const tenantId of await this.tenantsAtivos()) {
      const alvos = await this.alvosDeAlerta(tenantId);
      // Virou multi-loja: o alerta antigo, de unidade nula e calculado sobre todas as
      // lojas, é substituído pelos por loja — senão ficaria aberto para sempre.
      if (alvos[0] !== null) await this.estoque.resolverAlertasSistema(tenantId, 'ponto_pedido', null);

      for (const unidadeId of alvos) {
        const { itens } = await this.estoque.inteligencia(tenantId, ini, hoje, true, unidadeId);
        const repor = itens.filter((i: any) => i.repor);
        if (!repor.length) {
          await this.estoque.resolverAlertasSistema(tenantId, 'ponto_pedido', unidadeId);
          continue;
        }
        const titulo = `${repor.length} item(ns) no ponto de pedido`;
        const detalhe = repor.slice(0, 6).map((i: any) => i.nome).join(', ');
        await this.estoque.registrarAlerta(tenantId, 'ponto_pedido', {
          titulo,
          detalhe,
          prioridade: 'alta',
          unidadeId,
        });
        this.events.emit('kds.alerta.sistema', { tenantId, unidadeId, titulo, detalhe, prioridade: 'alta' });
        this.log.log(`ROP tenant ${tenantId}${unidadeId ? ` loja ${unidadeId}` : ''}: ${repor.length} item(ns) a repor`);
      }
    }
  }

  // §1.3 — Snapshot DIÁRIO de estoque (fecha o dia → CMV real O(1) e preciso em
  // qualquer período). Upsert por (tenant, item, data): reexecutar é inofensivo.
  // Snapshot diário de estoque — base do CMV real (auditoria #15, mig 250).
  //
  // Antes: 02:00 fixas, fotografando o dia ATUAL — um dia que mal tinha começado. O CMV
  // usava esse snapshot como estoque FINAL e perdia o movimento inteiro do último dia.
  //
  // Agora fotografa o dia ANTERIOR, já fechado, a partir da hora que cada empresa define
  // (`empresa.snapshot_hora`, padrão 06:00). Como o snapshot do dia D soma os movimentos
  // com data <= D, a hora não muda o resultado: dá tempo para as vendas da noite
  // sincronizarem do servidor local da loja. Roda a cada 15 min porque cada empresa tem a
  // sua hora; depois do primeiro disparo do dia, a checagem de existência encerra cedo.
  @Cron('*/15 * * * *')
  async snapshotDiario() {
    const agora = horaAgora();
    const ontem = somarDias(hojeISO(), -1);
    let n = 0;
    const r: any = await this.db.execute(
      sql`select id, to_char(snapshot_hora, 'HH24:MI') as hora from empresa where deleted_at is null`,
    );
    for (const e of (r.rows ?? r) as { id: string; hora: string }[]) {
      if (agora < (e.hora || '06:00')) continue; // ainda não é a hora desta empresa
      const ja: any = await this.db.execute(
        sql`select 1 from estoque_snapshot where tenant_id = ${e.id} and data = ${ontem} limit 1`,
      );
      if ((ja.rows ?? ja).length) continue; // o de ontem já foi tirado
      try {
        await this.estoque.gerarSnapshot(e.id, ontem);
        n++;
      } catch (err: any) {
        // Uma empresa com problema não pode impedir o snapshot das outras.
        this.log.error(`snapshot ${e.id} (${ontem}): ${err?.message ?? err}`);
      }
    }
    if (n) this.log.log(`Snapshot de estoque de ${ontem} gerado para ${n} empresa(s)`);
  }

  // §1.6 — Validades FEFO: alerta lotes vencidos/vencendo (≤2d crítico) por tenant.
  @Cron('10 6 * * *') // 06:10
  async validadesFefo() {
    for (const tenantId of await this.tenantsAtivos()) {
      const alvos = await this.alvosDeAlerta(tenantId);
      if (alvos[0] !== null) await this.estoque.resolverAlertasSistema(tenantId, 'validade', null);

      for (const unidadeId of alvos) {
        const lotes = await this.estoque.validades(tenantId, unidadeId);
        const criticos = lotes.filter(
          (l: any) => l.status === 'vencido' || l.status === 'critico',
        );
        if (!criticos.length) {
          await this.estoque.resolverAlertasSistema(tenantId, 'validade', unidadeId);
          continue;
        }
        const vencidos = criticos.filter((l: any) => l.status === 'vencido').length;
        const titulo = `${criticos.length} lote(s) vencendo${vencidos ? ` · ${vencidos} vencido(s)` : ''}`;
        const detalhe = criticos.slice(0, 6).map((l: any) => l.itemNome).join(', ');
        const prioridade = vencidos ? 'danger' : 'alta';
        await this.estoque.registrarAlerta(tenantId, 'validade', { titulo, detalhe, prioridade, unidadeId });
        this.events.emit('kds.alerta.sistema', { tenantId, unidadeId, titulo, detalhe, prioridade });
        this.log.log(`FEFO tenant ${tenantId}${unidadeId ? ` loja ${unidadeId}` : ''}: ${criticos.length} lote(s) crítico(s)`);
      }
    }
  }
}

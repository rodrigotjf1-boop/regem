import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { dataNoFuso, hojeISO, horaAgora, somarDias } from '../../common/data';
import { MidiaService } from '../midia/midia.service';
import { EstoqueService } from '../estoque/estoque.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';
import { PedidoManutencaoService } from '../pedido-manutencao/pedido-manutencao.service';
import { EtiquetaValidadeService } from '../etiqueta-validade/etiqueta-validade.service';
import { PontoService, competenciaMesAnterior } from '../ponto/ponto.service';
import { ehServidorLocal } from '../../common/modo';
import { edgeAtivo } from '../../common/edge-ativo';
import { PREFIXO_DA_MIDIA_LOCAL, esteLadoApaga, padraoDasFotosDoLado } from './expurgo-de-fotos';

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
    // SÓ NA NUVEM. O servidor local guarda apenas a janela de espelho (~60 dias) do
    // ponto, então aqui ele calcularia o fechamento sobre um mês INCOMPLETO e gravaria
    // um `ponto_fechamento` errado — que não sobe para lugar nenhum (a tabela é da
    // nuvem) e ainda ficava travando a reinstalação do servidor local, por ser dado
    // que não sai dali. A nuvem tem o histórico inteiro e é quem fecha.
    if (ehServidorLocal()) return;
    const competencia = competenciaMesAnterior();
    const [ano, mes] = competencia.split('-');
    for (const tenantId of await this.tenantsAtivos()) {
      try {
        const f = await this.ponto.gerarFechamento(tenantId, competencia);
        const pend = Number(f.totalPendencias) || 0;
        // O já enviado ao contador não é recalculado (ERR-650): não há pendência nova a avisar.
        if (pend > 0 && !f.jaEnviado) {
          const titulo = `Fechamento de ponto ${mes}/${ano}: ${pend} pendência(s)`;
          const detalhe = 'Corrija as batidas faltantes em Gerenciamento de ponto e encaminhe o espelho ao RH.';
          this.events.emit('kds.alerta.sistema', {
            tenantId,
            titulo,
            detalhe,
            prioridade: 'alta',
            tipo: 'gestao', // fechamento do ponto: aviso de gestão (as telas de preparo não recebem por padrão, mig 408)
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
  // ONDE RODA: nos DOIS lados — cada lado limpa a própria janela; a tabela que não existe no lado é 42P01 esperado.
  @Cron('50 4 * * *') // 04:50 todos os dias, fora do movimento
  async expurgarMetadadosSync() {
    const dias = Number(process.env.SYNC_RETENCAO_DIAS ?? 30);
    for (const [tabela, coluna, janela] of [
      ['sync_exclusao', 'created_at', dias],
      ['edge_heartbeat', 'recebido_em', dias],
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
    await this.expurgarTelemetria();
  }

  /** Há quantos dias sem NOVA ocorrência a linha da telemetria sai (decisão do dono, 12/11/2026). */
  static readonly TELEMETRIA_RETENCAO_DIAS = 90;

  /**
   * Expurgo da telemetria de erros (`telemetria_evento`, só da nuvem). A linha é UMA por assinatura de erro e soma
   * ocorrências (`ultimo_em`): sai a que está há 90 dias sem ocorrer de novo, resolvida ou não — o erro que continua
   * acontecendo fica, por mais antigo que seja.
   * ERR-455: até 12/11/2026 esta limpeza mirava `edge_telemetria`/`criado_em`, tabela e coluna que não existem; o erro
   * (42P01) era engolido como "tabela ausente no servidor da loja" e a telemetria crescia sem limite.
   * `soEmpresas`: só para o teste — a rotina passa por todas, e no CI as specs dividem o banco (V32). Nunca lança.
   */
  async expurgarTelemetria(soEmpresas?: string[]): Promise<number> {
    const empresas = this.soAs(soEmpresas);
    try {
      const r: any = await this.db.execute(
        sql`delete from telemetria_evento where ultimo_em < now() - make_interval(days => ${JobsService.TELEMETRIA_RETENCAO_DIAS}) ${empresas}`,
      );
      const n = r?.rowCount ?? 0;
      if (n) this.log.log(`expurgo telemetria_evento: ${n} linha(s) sem ocorrência há mais de ${JobsService.TELEMETRIA_RETENCAO_DIAS} dias`);
      return n;
    } catch (e: any) {
      // No servidor da loja a tabela não existe (42P01): esperado — o job roda nos dois. Qualquer outro motivo fica no log.
      if (e?.code !== '42P01') this.log.error(`expurgo telemetria_evento: ${e?.message ?? e}`);
      return 0;
    }
  }

  // ONDE RODA: nos DOIS lados (ERR-075) — não grava nada; o aviso de cada lado vai às telas DELE (a loja conta as etiquetas
  // dela e toca no KDS dela; a nuvem soma a empresa).
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
  // ONDE RODA: SÓ NA NUVEM (ERR-075). Na loja a tabela não é filtrada por loja e o aviso, sem loja nem tipo, tocava no KDS de uma
  // loja o pedido de manutenção de outra; a pergunta é para o C&O (aviso de gestão, com a loja do pedido).
  @Cron('40 6 * * *') // 06:40 todos os dias
  async promoverManutencaoAntiga() {
    if (ehServidorLocal()) return;
    try {
      const n = await this.manutencao.promoverAntigos();
      if (n) this.log.log(`manutenção pendente > 15 dias: ${n}`);
    } catch (e: any) {
      this.log.error(`promoverManutencaoAntiga: ${e?.message ?? e}`);
    }
  }

  // Ordens de produção "aguardando lançamento" com data prevista > 1 dia viram
  // pendência crítica (sobem no painel do gerente/C&O; exigem desfecho). Mig 130.
  // ONDE RODA: nos DOIS lados (ERR-075) — o servidor da loja costuma estar desligado de madrugada, então a nuvem marca também.
  // A ordem ENCERRADA é protegida no sync (V60: sync.service `encerradaVence`/`naoReabreOrdem` e o `ESTADOS_TERMINAIS` do
  // daemon): a conclusão feita na loja sem internet não volta a pendência pela marca que a nuvem pôs depois.
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
  // ONDE RODA: nos DOIS lados (ERR-075) — o id da ordem é da chave de negócio (`uuidDeChave(def, dia)`) e há índice único
  // por definição e dia: os dois lados geram a MESMA linha. O dia é o da operação (V46), não o do relógio UTC.
  @Cron('30 5 * * *') // 05:30 todos os dias
  async gerarOrdensRecorrentes() {
    const hoje = hojeISO();
    for (const tid of await this.tenantsAtivos()) {
      try {
        const n = await this.ordemProducao.gerarRecorrentes(tid, hoje);
        if (n) this.log.log(`ordens recorrentes geradas (${tid}): ${n}`);
      } catch (e: any) {
        this.log.error(`gerarOrdensRecorrentes[${tid}]: ${e?.message ?? e}`);
      }
    }
  }

  // A via em papel das ordens recorrentes de HOJE que pedem impressão — uma vez por ordem.
  // De 10 em 10 minutos, nos dois lados: a ordem do dia pode ter nascido no outro lado e chegado
  // pelo sincronismo, e o servidor da loja costuma estar desligado às 05:30 (ONDE RODA: nos DOIS, de propósito). Uma consulta para
  // todas as empresas; quem imprime e como não repete está em `imprimirRecorrentesDoDia`.
  @Cron('*/10 * * * *')
  async imprimirOrdensRecorrentes() {
    try {
      const n = await this.ordemProducao.imprimirRecorrentesDoDia();
      if (n) this.log.log(`ordens recorrentes: ${n} via(s) para impressão`);
    } catch (e: any) {
      this.log.error(`imprimirOrdensRecorrentes: ${e?.message ?? e}`);
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

  /**
   * As lojas cujo alerta de estoque ESTE lado calcula (ERR-075; o mesmo desenho dos esgotados do cardápio). O alerta vai e
   * volta pelo sync com id aleatório e um aberto por (empresa, loja, tipo): se os DOIS lados abrem o mesmo, o segundo a
   * chegar esbarra no índice (23505) e os lados divergem. Então cada loja tem UM lado:
   *  • no servidor da loja, só a loja dele (`EDGE_UNIDADE_ID`) — as outras lojas da rede ele nem tem o movimento para
   *    calcular; servidor antigo sem a variável: todas, como antes;
   *  • na nuvem, só as lojas SEM servidor ligado agora (`edgeAtivo`): a do servidor ligado é ele que calcula e toca no KDS
   *    dela (o aviso da nuvem não chega às telas ligadas ao servidor da loja).
   */
  async alvosDesteLado(tenantId: string, todos?: (string | null)[]): Promise<(string | null)[]> {
    const alvos = todos ?? (await this.alvosDeAlerta(tenantId));
    if (ehServidorLocal()) {
      const loja = (process.env.EDGE_UNIDADE_ID || '').trim();
      return loja && alvos[0] !== null ? alvos.filter((a) => a === loja) : alvos;
    }
    const fica: (string | null)[] = [];
    for (const a of alvos) if (!(await edgeAtivo(this.db, tenantId, a))) fica.push(a);
    return fica;
  }

  private async tenantsAtivos(): Promise<string[]> {
    const r: any = await this.db.execute(
      sql`select id from empresa where deleted_at is null`,
    );
    return (r.rows ?? r).map((x: any) => x.id);
  }

  // ── Expurgo LGPD das fotos. ONDE RODA: nos DOIS lados, cada um com as fotos que ELE consegue apagar (ERR-075,
  //    `expurgo-de-fotos.ts`): a loja as do disco dela, a nuvem as do storage. A referência só sai quando o arquivo saiu (ou
  //    já não existia). Antes, o lado que não conseguia apagar zerava assim mesmo; nas tabelas que vão e voltam pelo sync
  //    (tarefa, desperdício, vistoria) o "zerado" vencia no outro lado, e o arquivo ficava órfão para sempre.
  //    `soEmpresas`: só para o teste (no CI as specs dividem o banco).

  /** O `like` das fotos deste lado. */
  private padraoDasFotos(): string {
    return padraoDasFotosDoLado(ehServidorLocal(), !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY));
  }
  // `soEmpresas` só vale como LISTA: o `@Cron` chama o método com o que a biblioteca `cron` passar (hoje, o `onComplete`
  // indefinido) — nunca confiar que o primeiro argumento é o do teste.
  private soAs(soEmpresas?: string[]) {
    return Array.isArray(soEmpresas) && soEmpresas.length
      ? sql`and tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})`
      : sql``;
  }
  private async empresas(soEmpresas?: string[]): Promise<string[]> {
    return Array.isArray(soEmpresas) && soEmpresas.length ? soEmpresas : this.tenantsAtivos();
  }
  /** Tamanho da página do expurgo (o teste diminui para provar a passagem de página). */
  pagina = 500;
  /**
   * Percorre as linhas do expurgo em páginas pelo id (V84): a foto que não sai hoje (rede, referência malformada) não fica
   * na frente da fila trancando as seguintes. `consulta(depoisDe, n)` filtra `id > depoisDe`, ordena por id e limita a `n`.
   * Até 40 páginas por rodada; o que passar disso fica para o dia seguinte.
   */
  private async emPaginas(consulta: (depoisDe: string, n: number) => SQL, tratar: (rows: any[]) => Promise<void>) {
    let depoisDe = '00000000-0000-0000-0000-000000000000';
    for (let p = 0; p < 40; p++) {
      const r: any = await this.db.execute(consulta(depoisDe, this.pagina));
      const rows = r.rows ?? r;
      if (rows.length) await tratar(rows);
      if (rows.length < this.pagina) return;
      depoisDe = rows[rows.length - 1].id;
    }
  }

  // As fotos de ponto vencidas (data_expurgo < hoje).
  @Cron('0 3 * * *') // 03:00 todos os dias
  async expurgarFotosPonto(soEmpresas?: string[]) {
    const padrao = this.padraoDasFotos();
    let vistas = 0;
    let apagadas = 0;
    await this.emPaginas(
      (depoisDe, n) => sql`
        select id, foto_ref as "fotoRef" from ponto_marcacao
        where foto_ref like ${padrao} and data_expurgo is not null
          and data_expurgo < ${hojeISO()}::date ${this.soAs(soEmpresas)}
          and id > ${depoisDe}::uuid
        order by id limit ${n}`,
      async (rows) => {
        for (const row of rows) {
          vistas++;
          if (!(await this.midia.remover(row.fotoRef))) continue; // não saiu: tenta de novo amanhã, a referência fica
          await this.db.execute(sql`update ponto_marcacao set foto_ref = null where id = ${row.id}`);
          apagadas++;
        }
      },
    );
    // A cópia na NUVEM da marcação feita na loja: o arquivo mora no disco da loja, e a marcação só SOBE (nunca volta — o
    // `update` daqui não chega lá). A nuvem não serve nem apaga esse arquivo; quem apaga é a loja, na cópia dela. Vencida, a
    // nuvem só larga a referência da cópia dela — num comando só.
    if (!ehServidorLocal() && !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)) {
      const r: any = await this.db.execute(sql`
        update ponto_marcacao set foto_ref = null
         where foto_ref like ${`%${PREFIXO_DA_MIDIA_LOCAL}%`} and data_expurgo is not null
           and data_expurgo < ${hojeISO()}::date ${this.soAs(soEmpresas)}`);
      const n = r.rowCount ?? 0;
      if (n) this.log.log(`Expurgo LGPD: ${n} referência(s) de ponto da loja largada(s) na nuvem (o arquivo é a loja que apaga)`);
    }
    if (!vistas) return;
    if (apagadas < vistas) this.log.error(`Expurgo LGPD: ${vistas - apagadas} foto(s) de ponto não saíram do armazenamento (tentam de novo amanhã)`);
    this.log.log(`Expurgo LGPD: ${apagadas}/${vistas} fotos de ponto removidas`);
  }

  // As fotos de comprovação de tarefas vencidas (retenção 30d). Uma tarefa pode ter fotos dos DOIS lados: cada lado apaga as
  // dele, e a tarefa só sai do expurgo quando não sobrar nenhuma.
  @Cron('5 3 * * *') // 03:05 todos os dias
  async expurgarFotosTarefa(soEmpresas?: string[]) {
    const padrao = this.padraoDasFotos();
    const servidorLocal = ehServidorLocal();
    const comStorage = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
    let tarefas = 0;
    let apagadas = 0;
    await this.emPaginas(
      (depoisDe, n) => sql`
        select id, foto_ref as "fotoRef", fotos from tarefa_instancia
        where data_expurgo is not null and data_expurgo < ${hojeISO()}::date ${this.soAs(soEmpresas)}
          and (foto_ref like ${padrao} or exists (
                select 1 from jsonb_array_elements_text(case when jsonb_typeof(fotos) = 'array' then fotos else '[]'::jsonb end) f(u)
                 where f.u like ${padrao}))
          and id > ${depoisDe}::uuid
        order by id limit ${n}`,
      async (rows) => {
        for (const row of rows) {
          tarefas++;
          const refs: string[] = Array.isArray(row.fotos) ? [...row.fotos] : [];
          if (row.fotoRef && !refs.includes(row.fotoRef)) refs.push(row.fotoRef);
          const ficam: string[] = [];
          for (const ref of refs) {
            if (esteLadoApaga(ref, servidorLocal, comStorage) && (await this.midia.remover(ref))) apagadas++;
            else ficam.push(ref); // do outro lado, ou não saiu agora
          }
          // O que sobrou continua onde estava: a foto principal e a lista, cada uma só com o que não saiu.
          const restam = new Set(ficam);
          const fotoRef = row.fotoRef && restam.has(row.fotoRef) ? row.fotoRef : null;
          const fotos = (Array.isArray(row.fotos) ? row.fotos : []).filter((x: string) => restam.has(x));
          await this.db.execute(sql`
            update tarefa_instancia set foto_ref = ${fotoRef}, fotos = ${JSON.stringify(fotos)}::jsonb,
                   data_expurgo = case when ${ficam.length} = 0 then null else data_expurgo end
             where id = ${row.id}`);
        }
      },
    );
    if (tarefas) this.log.log(`Expurgo LGPD: ${apagadas} foto(s) de tarefa removida(s) (${tarefas} tarefa(s))`);
  }

  // As fotos de desperdício e vistoria retidas > 90 dias (não tinham rotina de expurgo). Pelo created_at → cobre também as antigas.
  // ONDE RODA: nos DOIS lados, cada um com as fotos que ELE consegue apagar (ERR-075, `padraoDasFotos`).
  @Cron('7 3 * * *') // 03:07 todos os dias
  async expurgarFotosOperacao(soEmpresas?: string[]) {
    const RETENCAO_DIAS = 90;
    const padrao = this.padraoDasFotos();
    for (const tabela of ['desperdicio', 'vistoria'] as const) {
      let vistas = 0;
      let apagadas = 0;
      await this.emPaginas(
        (depoisDe, n) => sql`
          select id, foto_ref as "fotoRef" from ${sql.raw(tabela)}
          where foto_ref like ${padrao}
            and created_at < now() - (${RETENCAO_DIAS} * interval '1 day') ${this.soAs(soEmpresas)}
            and id > ${depoisDe}::uuid
          order by id limit ${n}`,
        async (rows) => {
          for (const row of rows) {
            vistas++;
            if (!(await this.midia.remover(row.fotoRef))) continue; // não saiu: a referência fica para amanhã
            await this.db.execute(sql`update ${sql.raw(tabela)} set foto_ref = null where id = ${row.id}`);
            apagadas++;
          }
        },
      );
      if (!vistas) continue;
      if (apagadas < vistas) this.log.error(`Expurgo LGPD: ${vistas - apagadas} foto(s) de ${tabela} não saíram do armazenamento (tentam de novo amanhã)`);
      this.log.log(`Expurgo LGPD: ${apagadas}/${vistas} foto(s) de ${tabela} removida(s)`);
    }
  }

  // §1.4 — Ponto de pedido: alerta os itens no/abaixo do ROP (por tenant, em tempo real).
  // ONDE RODA: nos DOIS lados, cada LOJA num só (ERR-075, `alvosDesteLado`): o servidor da loja a dele; a nuvem as lojas sem
  // servidor ligado. Assim o mesmo alerta não nasce dos dois lados (23505 no sync) e o aviso toca no KDS que a loja usa.
  @Cron('0 6 * * *') // 06:00
  async pontoDePedido(soEmpresas?: string[]) {
    // Fuso da operação (common/data). `toISOString()` dava o dia certo só porque o job
    // roda às 06:00; era a mesma armadilha das seis cópias de `hojeISO`.
    const hoje = hojeISO();
    const ini = dataNoFuso(new Date(Date.now() - 27 * 86400000)); // janela 28d
    for (const tenantId of await this.empresas(soEmpresas)) {
      const alvos = await this.alvosDeAlerta(tenantId);
      // Virou multi-loja: o alerta antigo, de unidade nula e calculado sobre todas as
      // lojas, é substituído pelos por loja — senão ficaria aberto para sempre.
      if (alvos[0] !== null) await this.estoque.resolverAlertasSistema(tenantId, 'ponto_pedido', null);

      for (const unidadeId of await this.alvosDesteLado(tenantId, alvos)) {
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
        this.events.emit('kds.alerta.sistema', { tenantId, unidadeId, titulo, detalhe, prioridade: 'alta', tipo: 'estoque' });
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
  // ONDE RODA: nos DOIS lados (ERR-075) — `estoque_snapshot` não sincroniza (DESCARTAVEL): cada lado tira o seu para o CMV dele.
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
      // Pula só se TODA loja que tem produto já tem o fechamento de ontem (EST-G-04 da revisão de 25/11/2026): o snapshot avulso
      // de UMA loja ("Gerar snapshot" no painel) fazia a rotina achar "o de ontem já foi tirado" e a outra loja ficava sem.
      // Empresa sem loja cadastrada: o balde sem loja. Empresa sem produto: nada a fotografar (antes tentava a cada 15 min).
      if (!(await this.estoque.fechamentoIncompleto(e.id, ontem))) continue; // o de ontem já foi tirado em todas as lojas
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
  // ONDE RODA: como o ponto de pedido acima — cada LOJA num lado só (`alvosDesteLado`, o mesmo `alerta_estoque`).
  @Cron('10 6 * * *') // 06:10
  async validadesFefo(soEmpresas?: string[]) {
    for (const tenantId of await this.empresas(soEmpresas)) {
      const alvos = await this.alvosDeAlerta(tenantId);
      if (alvos[0] !== null) await this.estoque.resolverAlertasSistema(tenantId, 'validade', null);

      for (const unidadeId of await this.alvosDesteLado(tenantId, alvos)) {
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
        this.events.emit('kds.alerta.sistema', { tenantId, unidadeId, titulo, detalhe, prioridade, tipo: 'estoque' });
        this.log.log(`FEFO tenant ${tenantId}${unidadeId ? ` loja ${unidadeId}` : ''}: ${criticos.length} lote(s) crítico(s)`);
      }
    }
  }
}

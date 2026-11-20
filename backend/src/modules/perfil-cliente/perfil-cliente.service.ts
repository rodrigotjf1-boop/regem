import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { CalendarioDaLojaService } from './calendario-da-loja.service';
import { calcularSensibilidadeDaEmpresa } from './sensibilidade-da-empresa';
import { expurgarFunil, expurgarInteracoes, oQueOlha } from './interacoes-do-cardapio';
import { sqlOlhouENaoPediu } from '../../common/interesse-do-cliente';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_SQL, inicioDoPeriodo } from '../../common/fuso-sql';
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

/** As réguas da Saúde da base (F4): "pediam toda semana" = intervalo de até 8 dias; "sumiu" = 15 dias sem pedir; os itens
 *  da estreia só com 30 estreias ou mais (o protótipo). */
export const SAUDE = { semanalAteDias: 8, sumiuDias: 15, minimoEstreias: 30 } as const;

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
   * A limpeza do cardápio (F4) — todo dia às 4h40, para todas as empresas: os cliques (mig 466) com mais de 90 dias e o
   * funil anônimo (`cardapio_evento`, mig 196) com mais de 400 dias (o relatório do funil lê até 365). Cada uma sozinha.
   */
  @Cron('0 40 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async expurgo(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      const n = await expurgarInteracoes(this.db);
      if (n) this.log.log(`cliques do cardápio: ${n} com mais de 90 dias apagados`);
    } catch (e: any) {
      this.log.warn(`cliques do cardápio: a limpeza dos 90 dias falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    }
    try {
      const n = await expurgarFunil(this.db);
      if (n) this.log.log(`funil do cardápio: ${n} eventos com mais de 400 dias apagados`);
    } catch (e: any) {
      this.log.warn(`funil do cardápio: a limpeza dos 400 dias falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    }
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
    // O que olha no cardápio (F4b, mig 466): só os cliques ligados a ele (depois do "sim" das recomendações); nada com
    // "não analisar". Lido sozinho: se falhar, a ficha abre sem a camada (null, com o motivo no log).
    const olha = naoAnalisar
      ? null
      : await oQueOlha(this.db, tenantId, clienteId).catch((e: any) => {
          this.log.warn(`o que olha (ficha) não lido — empresa ${tenantId.slice(0, 8)}: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
          return null;
        });
    // Quem pediu só pelo iFood/99 tem pedidos, mas não tem perfil (D1): a ficha diz por quê.
    const soPlataforma = !perfil && !naoAnalisar && Number(c.total_pedidos ?? 0) > 0;
    return {
      cliente: { id: c.id, nome: c.nome, telefone: c.telefone, desde: c.criado_em },
      situacao: naoAnalisar ? 'nao_analisar' : perfil ? 'com_perfil' : soPlataforma ? 'so_plataforma' : 'sem_pedido',
      perfil,
      declarado,
      escolhas,
      sensibilidade,
      olha,
    };
  }

  /**
   * SAÚDE DA BASE (F4 do plano do perfil do cliente; protótipo, aba "Saúde da base"): os números da loja, SOMADOS e sem
   * pessoa — o resumo em frases (semanais que sumiram, novos e o 2º pedido contra o mesmo ponto do mês passado, quem voltou
   * depois de 60 dias), os itens da estreia que fazem voltar e os que levam a sumir, o que os clientes querem encontrar (a
   * pergunta da F1c), as reclamações por motivo (do perfil), as buscas sem resultado e os produtos mais abertos no cardápio
   * Regem (30 dias, mig 466) e quanto do perfil tem dado em cada camada. Pedidos diretos com a régua do cálculo do perfil
   * (sem iFood e 99, sem cancelado, sem quem pediu "não analisar"). Cada bloco se lê sozinho: o que falhar volta `null`
   * (com o motivo no log), o resto aparece.
   */
  async saude(tenantId: string) {
    const bloco = async <T>(nome: string, f: () => Promise<T>): Promise<T | null> => {
      try {
        return await f();
      } catch (e: any) {
        this.log.warn(`saúde da base (${nome}) não lida — empresa ${tenantId.slice(0, 8)}: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
        return null;
      }
    };
    const ped = sql`
      nao as (
        select distinct on (e.cliente_id) e.cliente_id, e.valor
          from cliente_escolha e
         where e.tenant_id = ${tenantId}::uuid and e.escolha = 'nao_analisar'
         order by e.cliente_id, e.em desc
      ),
      ped as materialized (
        select p.cliente_id, p.criado_em, p.itens,
               row_number() over (partition by p.cliente_id order by p.criado_em, p.id) as k,
               lag(p.criado_em) over (partition by p.cliente_id order by p.criado_em, p.id) as antes
          from pedido_externo p
         where p.tenant_id = ${tenantId}::uuid and p.cliente_id is not null and p.status <> 'cancelado'
           and coalesce(p.canal, '') not in ('ifood', '99food')
           and not exists (select 1 from nao where nao.cliente_id = p.cliente_id and nao.valor)
      ),
      cli as (
        select cliente_id, min(criado_em) filter (where k = 1) as primeiro, min(criado_em) filter (where k = 2) as segundo
          from ped group by cliente_id
      )`;
    // O mês de hoje e o mesmo pedaço do mês passado (do dia 1 até o mesmo ponto), na hora de Brasília (V46, ERR-542).
    const iniMes = inicioDoPeriodo('month');
    const iniAnt = sql`((date_trunc('month', now() at time zone ${FUSO_SQL}) - interval '1 month') at time zone ${FUSO_SQL})`;
    const fimAnt = sql`(${iniAnt} + (now() - ${iniMes}))`;

    const [frase, itens, gostaria, reclamacoes, buscas, abertos, dado] = await Promise.all([
      bloco('frase', async () => {
        const [m] = this.rows(await this.db.execute(sql`
          with ${ped}
          select count(*) filter (where primeiro >= ${iniMes})::int as novos,
                 count(*) filter (where primeiro >= ${iniMes} and segundo is not null)::int as novos_2o,
                 count(*) filter (where primeiro >= ${iniAnt} and primeiro < ${fimAnt})::int as novos_ant,
                 count(*) filter (where primeiro >= ${iniAnt} and primeiro < ${fimAnt} and segundo < ${fimAnt})::int as novos_2o_ant,
                 (select count(distinct cliente_id) from ped
                   where criado_em >= ${iniMes} and antes is not null and criado_em - antes >= interval '60 days')::int as voltaram
            from cli`));
        const [s] = this.rows(await this.db.execute(sql`
          select count(*)::int as semanais,
                 count(*) filter (where jsonb_array_length(coalesce(camadas -> 'reclamacoes' -> 'grupos', '[]'::jsonb)) > 0)::int as com_reclamacao
            from cliente_perfil
           where tenant_id = ${tenantId}::uuid and pedidos_diretos >= 3 and intervalo_dias <= ${SAUDE.semanalAteDias}
             and ultimo_pedido_em < now() - make_interval(days => ${SAUDE.sumiuDias}::int)
             and ultimo_pedido_em >= now() - interval '90 days'`));
        return {
          novos: Number(m?.novos ?? 0),
          novos2o: Number(m?.novos_2o ?? 0),
          novosAnt: Number(m?.novos_ant ?? 0),
          novos2oAnt: Number(m?.novos_2o_ant ?? 0),
          voltaram: Number(m?.voltaram ?? 0),
          semanaisSumidos: Number(s?.semanais ?? 0),
          semanaisComReclamacao: Number(s?.com_reclamacao ?? 0),
          sumiuDias: SAUDE.sumiuDias,
        };
      }),
      bloco('itens', async () => {
        // A estreia de 30 a 210 dias atrás (a janela de 30 dias para o 2º pedido já fechou); só itens com 30 estreias ou mais.
        const [r] = this.rows(await this.db.execute(sql`
          with ${ped},
          est as (
            select cliente_id, primeiro, segundo from cli
             where primeiro >= now() - interval '210 days' and primeiro < now() - interval '30 days'
          ),
          it as (
            select coalesce(i ->> 'produtoId', i ->> 'codigo', lower(trim(i ->> 'descricao'))) as chave,
                   max(trim(i ->> 'descricao')) as nome,
                   count(distinct e.cliente_id)::int as estreias,
                   count(distinct e.cliente_id) filter (where e.segundo <= e.primeiro + interval '30 days')::int as voltaram
              from est e
              join ped p on p.cliente_id = e.cliente_id and p.k = 1
              cross join lateral jsonb_array_elements(case when jsonb_typeof(p.itens) = 'array' then p.itens else '[]'::jsonb end) i
             where coalesce(trim(i ->> 'descricao'), '') <> ''
             group by 1
          )
          select (select count(*)::int from est) as estreias,
                 (select count(*) filter (where segundo <= primeiro + interval '30 days')::int from est) as voltaram,
                 coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'estreias', estreias, 'voltaram', voltaram)
                                            order by voltaram::numeric / estreias desc, estreias desc, nome)
                             from it where estreias >= ${SAUDE.minimoEstreias}), '[]'::jsonb) as itens`));
        const lista: { nome: string; estreias: number; voltaram: number }[] = Array.isArray(r?.itens) ? r.itens : [];
        const voltam = lista.slice(0, 3);
        const somem = lista.slice(3).slice(-3).reverse();
        return { estreias: Number(r?.estreias ?? 0), voltaram: Number(r?.voltaram ?? 0), minimo: SAUDE.minimoEstreias, voltam, somem };
      }),
      bloco('gostaria', async () =>
        this.rows(await this.db.execute(sql`
          select o as opcao, count(*)::int as n
            from cliente_declarado d, jsonb_array_elements_text(case when jsonb_typeof(d.valor) = 'array' then d.valor else '[]'::jsonb end) o
           where d.tenant_id = ${tenantId}::uuid and d.chave = 'gostaria'
           group by o order by n desc, o limit 15`)),
      ),
      bloco('reclamacoes', async () => {
        const porMotivo = this.rows(await this.db.execute(sql`
          select g ->> 'nome' as nome, sum((g ->> 'vezes')::int)::int as vezes, count(*)::int as clientes
            from cliente_perfil cp,
                 jsonb_array_elements(coalesce(cp.camadas -> 'reclamacoes' -> 'grupos', '[]'::jsonb)) g
           where cp.tenant_id = ${tenantId}::uuid
           group by 1 order by vezes desc, 1 limit 12`));
        const [rep] = this.rows(await this.db.execute(sql`
          select count(*)::int as n from cliente_perfil cp
           where cp.tenant_id = ${tenantId}::uuid
             and exists (select 1 from jsonb_array_elements(coalesce(cp.camadas -> 'reclamacoes' -> 'grupos', '[]'::jsonb)) g
                          where (g ->> 'vezes')::int >= 2)`));
        return { porMotivo, repetidos: Number(rep?.n ?? 0) };
      }),
      bloco('buscas', async () =>
        this.rows(await this.db.execute(sql`
          select termo, count(*)::int as vezes, count(distinct sessao)::int as pessoas
            from cardapio_interacao
           where tenant_id = ${tenantId}::uuid and tipo = 'busca' and coalesce(resultados, 0) = 0
             and em > now() - interval '30 days'
           group by termo order by pessoas desc, vezes desc, termo limit 15`)),
      ),
      bloco('abertos', async () =>
        this.rows(await this.db.execute(sql`
          select i.produto_id, coalesce(p.nome, 'Produto que saiu do cardápio') as nome,
                 count(distinct i.sessao) filter (where i.tipo = 'produto_aberto')::int as abriram,
                 count(distinct i.sessao) filter (where i.tipo = 'produto_adicionado')::int as carrinho
            from cardapio_interacao i left join produto p on p.id = i.produto_id
           where i.tenant_id = ${tenantId}::uuid and i.produto_id is not null and i.em > now() - interval '30 days'
           group by i.produto_id, p.nome
           order by abriram desc, carrinho desc, 2 limit 15`)),
      ),
      bloco('dado', async () => {
        // Clientes ativos (pediram nos últimos 90 dias) com dado em cada camada: o que pede (3 pedidos ou mais), quando pede
        // (o ritmo pede 4 ou mais), o que move (um selo da F3) e o que olha (cliques depois do "sim" das recomendações).
        const [c] = this.rows(await this.db.execute(sql`
          select count(*)::int as ativos,
                 count(*) filter (where cp.pedidos_diretos >= 3)::int as pede,
                 count(*) filter (where cp.pedidos_diretos >= 4 and cp.faixa_habitual is not null)::int as quando,
                 count(*) filter (where exists (select 1 from cliente_evento_sensibilidade s
                                                 where s.cliente_id = cp.cliente_id and s.tenant_id = cp.tenant_id and s.selo))::int as move,
                 count(*) filter (where exists (select 1 from cardapio_interacao i
                                                 where i.cliente_id = cp.cliente_id and i.tenant_id = cp.tenant_id))::int as olha
            from cliente_perfil cp
           where cp.tenant_id = ${tenantId}::uuid and cp.ultimo_pedido_em >= now() - interval '90 days'`));
        const [v] = this.rows(await this.db.execute(sql`
          select count(distinct sessao)::int as n from cardapio_interacao
           where tenant_id = ${tenantId}::uuid and em > now() - interval '30 days'`));
        return {
          ativos: Number(c?.ativos ?? 0),
          pede: Number(c?.pede ?? 0),
          quando: Number(c?.quando ?? 0),
          move: Number(c?.move ?? 0),
          olha: Number(c?.olha ?? 0),
          visitasComCliques30d: Number(v?.n ?? 0),
        };
      }),
    ]);
    return { frase, itens, gostaria, reclamacoes, buscas, abertos, dado };
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
    // Os selos do que move o cliente (F3 parte 2): as abas "pelo perfil" de Delivery › Clientes (F7 parte 1) mostram a conta.
    const selos = this.rows(await this.db.execute(sql`
      select tipo, count(*)::int as n from cliente_evento_sensibilidade where tenant_id = ${tenantId}::uuid and selo group by tipo`));
    // Viu e não pediu (F4b): a aba "Olharam e não pediram" — começa só de quem tem clique ligado nos últimos 30 dias.
    const [olharam] = this.rows(await this.db.execute(sql`
      select count(*)::int as n from cliente c
       where c.tenant_id = ${tenantId}::uuid
         and c.id in (select i.cliente_id from cardapio_interacao i
                       where i.tenant_id = ${tenantId}::uuid and i.cliente_id is not null and i.tipo = 'produto_aberto'
                         and i.em > now() - interval '30 days')
         and ${sqlOlhouENaoPediu()}`));
    return {
      olharam: Number(olharam?.n ?? 0),
      segmentos: Object.fromEntries(seg.map((s: any) => [s.segmento, s.n])),
      etiquetas: Object.fromEntries(etq.map((s: any) => [s.etiqueta, s.n])),
      selos: Object.fromEntries(selos.map((s: any) => [s.tipo, s.n])),
      total: seg.reduce((a: number, s: any) => a + s.n, 0),
      ultimaVolta: exec,
    };
  }
}

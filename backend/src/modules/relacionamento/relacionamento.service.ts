import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO, somarDias } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { saiuDoMarketing, sqlRecebeMarketing } from '../../common/marketing-quem-recebe';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappNumeroService } from '../whatsapp/whatsapp-numero.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import {
  CASHBACK_DIAS_ANTES,
  CASHBACK_SALDO_MIN,
  HORA_MAX,
  HORARIOS,
  INTERVALOS_OFERTA,
  MAX_POR_DIA,
  agoraNaOperacao,
  ajustesDaLinha,
  dataCurta,
  horaDoEnvio,
  lerAjustes,
  nomeCurto,
  podeMandarAgora,
  primeiroNome,
  reais,
  textoCashbackQr,
  type AjustesRelacionamento,
} from './relacionamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AUTOMÁTICAS DE MARKETING (Onda 3 · PR 2, mig 356 — só NUVEM). Delivery › Marketing › Automáticas: os ajustes para
// todas (frequência, limite por dia, horário) e o "cashback vencendo". Uma rotina, a cada minuto, no horário do envio de
// cada empresa: SEPARA a lista do dia numa gravação só (o índice único é a trava "uma mensagem por vencimento") e MANDA o
// que separou, marcando antes de mandar (dois servidores não mandam a mesma). O aniversário e o "sentimos sua falta"
// entram nos PRs seguintes, pela mesma rotina.

const PUB = () => (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
const APP = () => (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O modelo de utilidade do aviso do cashback na API oficial. */
export const MODELO_CASHBACK = 'cashback_vencendo';
/** Quantas mensagens por minuto, por empresa: a API oficial aguenta; o QR vai devagar (protege o número). */
const POR_MINUTO = { cloud: 10, evolution: 1 } as const;
/** Quantos nomes a prévia mostra ("Ver quem"). */
const NA_PREVIA = 5;

type Prontidao = { pronto: boolean; provedor: 'cloud' | 'evolution'; motivo?: string; instancia?: string | null; phoneId?: string | null; oferta: boolean };

@Injectable()
export class RelacionamentoService {
  private readonly logger = new Logger('Automaticas');
  private rodando = false;
  /** "Já separei a lista de hoje desta empresa" (por processo; a trava de verdade é o índice único). */
  private readonly separado = new Map<string, string>();
  /** "Já perguntei à Meta hoje como está o modelo desta empresa". */
  private readonly perguntouMeta = new Map<string, string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numeros: WhatsappNumeroService,
    private readonly cloud: WhatsappCloudService,
    private readonly whatsapp: WhatsappService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  // ===================== Ajustes =====================

  async ajustes(tenantId: string): Promise<AjustesRelacionamento> {
    const r = this.rows(await this.db.execute(sql`select * from relacionamento_config where tenant_id = ${tenantId}::uuid`));
    return ajustesDaLinha(r[0]);
  }

  /** Grava SÓ o que mudou (V16) e deixa na auditoria o de → para. Gerente e presidente (o controller confere). */
  async salvar(user: AuthUser, dto: unknown): Promise<void> {
    const parcial = lerAjustes(dto);
    const antes = await this.ajustes(user.tenantId);
    const mudou = (Object.keys(parcial) as (keyof AjustesRelacionamento)[]).filter((k) => parcial[k] !== antes[k]);
    if (!mudou.length) return;
    const colunas: Record<keyof AjustesRelacionamento, string> = {
      intervaloOfertasDias: 'intervalo_ofertas_dias',
      maxPorDia: 'max_por_dia',
      horario: 'horario',
      cashbackAtivo: 'cashback_ativo',
      cashbackDiasAntes: 'cashback_dias_antes',
      cashbackSaldoMin: 'cashback_saldo_min',
    };
    const nomes = mudou.map((k) => sql.raw(colunas[k]));
    const valores = mudou.map((k) => sql`${parcial[k] as any}`);
    const sets = mudou.map((k) => sql`${sql.raw(colunas[k])} = excluded.${sql.raw(colunas[k])}`);
    await this.db.execute(sql`
      insert into relacionamento_config (tenant_id, ${sql.join(nomes, sql`, `)})
      values (${user.tenantId}::uuid, ${sql.join(valores, sql`, `)})
      on conflict (tenant_id) do update set ${sql.join(sets, sql`, `)}, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'ajustou_automaticas',
      origem: 'marketing',
      entidadeTipo: 'relacionamento_config',
      entidadeId: user.tenantId,
      detalhe: {
        de: Object.fromEntries(mudou.map((k) => [k, antes[k]])),
        para: Object.fromEntries(mudou.map((k) => [k, parcial[k]])),
      },
    });
  }

  // ===================== O horário das lojas =====================

  /** Os horários do cardápio de todas as lojas da empresa (e o da empresa). */
  private async horarios(tenantId: string): Promise<any[][]> {
    const r = this.rows(await this.db.execute(sql`select horarios from cardapio_config where tenant_id = ${tenantId}::uuid`));
    return r.map((x) => (Array.isArray(x.horarios) ? x.horarios : []));
  }

  /** O próximo envio a partir de agora: hoje (se ainda dá) ou o próximo dia em que alguma loja abre. */
  proximoEnvio(listas: any[][], horario: AjustesRelacionamento['horario'], agora = agoraNaOperacao()): { dia: string; hora: string; emDias: number } | null {
    for (let d = 0; d < 8; d++) {
      const dia = (agora.dia + d) % 7;
      const hora = horaDoEnvio(listas, horario, dia);
      if (!hora) continue;
      if (d === 0 && agora.hhmm >= HORA_MAX) continue;
      return { dia: somarDias(hojeISO(), d), hora, emDias: d };
    }
    return null;
  }

  // ===================== O número e o modelo =====================

  /** Dá para mandar o aviso do cashback agora? Pelo número principal (é utilidade, como os avisos do pedido). */
  async prontidaoCashback(tenantId: string, perguntarAMeta = false): Promise<Prontidao> {
    let num: any;
    try {
      num = await this.numeros.resolver(tenantId, 'principal');
    } catch {
      return { pronto: false, provedor: 'evolution', motivo: 'sem WhatsApp conectado', oferta: false };
    }
    if (num?.provedor === 'cloud') {
      if (!num.phoneId) return { pronto: false, provedor: 'cloud', motivo: 'sem número da API oficial', oferta: false };
      let m = await this.modelo(tenantId, MODELO_CASHBACK);
      if (m && m.status === 'pendente' && perguntarAMeta) {
        await this.cloud.atualizarModelo(tenantId, MODELO_CASHBACK).catch(() => undefined);
        m = await this.modelo(tenantId, MODELO_CASHBACK);
      }
      const oferta = m?.categoria === 'MARKETING';
      if (!m) return { pronto: false, provedor: 'cloud', motivo: 'o modelo ainda não foi enviado à Meta', oferta };
      if (m.status !== 'aprovado') return { pronto: false, provedor: 'cloud', motivo: `o modelo está ${m.status} na Meta`, oferta };
      return { pronto: true, provedor: 'cloud', phoneId: num.phoneId, oferta };
    }
    if (!num?.instancia) return { pronto: false, provedor: 'evolution', motivo: 'o WhatsApp da loja não está conectado', oferta: false };
    return { pronto: true, provedor: 'evolution', instancia: num.instancia, oferta: false };
  }

  private async modelo(tenantId: string, nome: string): Promise<{ status: string; categoria: string; motivo: string | null } | null> {
    const r = this.rows(
      await this.db.execute(sql`
        select status, categoria, motivo_rejeicao from whatsapp_template
         where tenant_id = ${tenantId}::uuid and nome = ${nome} and idioma = 'pt_BR' limit 1`),
    );
    return r[0] ? { status: String(r[0].status), categoria: String(r[0].categoria), motivo: r[0].motivo_rejeicao ?? null } : null;
  }

  /** "Enviar à Meta" (só API oficial). */
  async enviarModelo(user: AuthUser, tipo: string): Promise<{ status: string }> {
    if (tipo !== 'cashback') throw new BadRequestException('Automática desconhecida.');
    const num = await this.numeros.resolver(user.tenantId, 'principal').catch(() => null);
    if (num?.provedor !== 'cloud') throw new BadRequestException('O modelo é da API oficial: o número principal da loja usa o QR, e o aviso sai como texto.');
    const status = await this.cloud.garantirModeloRelacionamento(user.tenantId, MODELO_CASHBACK);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'enviou_modelo_automatica',
      origem: 'marketing',
      entidadeTipo: 'whatsapp_template',
      entidadeId: user.tenantId,
      detalhe: { modelo: MODELO_CASHBACK, status },
    });
    return { status };
  }

  // ===================== Quem recebe (cashback) =====================

  /**
   * Os clientes cujo cashback vence entre o dia seguinte ao envio e N dias depois, com saldo de pelo menos R$ X, que
   * recebem marketing (regra única), que já pediram fora do iFood e da 99 (o telefone dessas é da plataforma) e que ainda
   * não foram avisados DESTE vencimento. Um por telefone (pela chave). Com o aviso classificado pela Meta como marketing,
   * também respeita "uma oferta a cada N dias" (somando as campanhas).
   */
  private candidatosCashback(tenantId: string, dia: string, a: AjustesRelacionamento, oferta: boolean) {
    const freq = oferta
      ? sql`and not exists (select 1 from relacionamento_envio e2 where e2.tenant_id = ${tenantId}::uuid and e2.chave_telefone = x.chave
               and e2.oferta and e2.status = 'enviado' and e2.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int))
            and not exists (select 1 from campanha_envio ce where ce.tenant_id = ${tenantId}::uuid and ce.status = 'enviado'
               and ce.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int)
               and ${sqlChaveTelefone(sql`ce.telefone`)} = x.chave)`
      : sql``;
    return sql`
      select x.* from (
        select distinct on (${sqlChaveTelefone(sql`c.telefone`)})
               ${sqlChaveTelefone(sql`c.telefone`)} as chave, c.id as cliente_id, c.nome, c.telefone,
               s.saldo::float8 as saldo, s.expira_em,
               to_char((s.expira_em at time zone ${FUSO_SQL})::date, 'YYYY-MM-DD') as referencia,
               (select p.unidade_id from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                 order by p.criado_em desc limit 1) as unidade_id
          from cashback_saldo s
          join cliente c on c.tenant_id = s.tenant_id
                        and ${sqlChaveTelefone(sql`c.telefone`)} = ${sqlChaveTelefone(sql`s.telefone`)}
         where s.tenant_id = ${tenantId}::uuid and s.tipo = 'valor'
           and s.saldo >= ${a.cashbackSaldoMin}::numeric and s.expira_em is not null
           and (s.expira_em at time zone ${FUSO_SQL})::date between ${dia}::date + 1 and ${dia}::date + ${a.cashbackDiasAntes}::int
           ${sqlRecebeMarketing()}
           and exists (select 1 from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                         and coalesce(p.canal, '') not in ('ifood', '99food'))
         order by ${sqlChaveTelefone(sql`c.telefone`)}, s.expira_em asc, s.saldo desc
      ) x
      where not exists (select 1 from relacionamento_envio e where e.tenant_id = ${tenantId}::uuid and e.tipo = 'cashback'
                          and e.chave_telefone = x.chave and e.referencia = x.referencia)
      ${freq}`;
  }

  /** Quantas mensagens das automáticas a empresa já separou no dia (o limite é de todas juntas). */
  private async usadasNoDia(tenantId: string, dia: string): Promise<number> {
    const r = this.rows(
      await this.db.execute(sql`
        select count(*)::int as n from relacionamento_envio
         where tenant_id = ${tenantId}::uuid and dia = ${dia}::date and status in ('pendente', 'enviado', 'falha')`),
    );
    return Number(r[0]?.n ?? 0);
  }

  // ===================== O painel da aba =====================

  /** Tudo o que a aba Automáticas mostra: ajustes, opções, o número, o modelo, a prévia e o resultado. */
  async painel(tenantId: string) {
    const a = await this.ajustes(tenantId);
    const listas = await this.horarios(tenantId);
    const hoje = agoraNaOperacao();
    const envioHoje = {
      antes_de_abrir: horaDoEnvio(listas, 'antes_de_abrir', hoje.dia),
      ao_abrir: horaDoEnvio(listas, 'ao_abrir', hoje.dia),
    };
    const prox = this.proximoEnvio(listas, a.horario, hoje);
    const pronto = await this.prontidaoCashback(tenantId, true);
    const modelo = pronto.provedor === 'cloud' ? await this.modelo(tenantId, MODELO_CASHBACK) : null;

    let previa: any = null;
    if (prox) {
      const total = Number(
        this.rows(await this.db.execute(sql`select count(*)::int as n from (${this.candidatosCashback(tenantId, prox.dia, a, pronto.oferta)}) q`))[0]?.n ?? 0,
      );
      const vagas = Math.max(0, a.maxPorDia - (await this.usadasNoDia(tenantId, prox.dia)));
      const lista = this.rows(
        await this.db.execute(sql`
          select q.nome, q.saldo, q.expira_em from (${this.candidatosCashback(tenantId, prox.dia, a, pronto.oferta)}) q
           order by q.expira_em asc, q.saldo desc limit ${NA_PREVIA}`),
      ).map((x) => ({ nome: nomeCurto(x.nome), detalhe: `${reais(x.saldo)} · vence ${dataCurta(x.expira_em)}` }));
      previa = { ...prox, total, vagas, lista };
    }
    return {
      ajustes: a,
      opcoes: {
        intervalos: [...INTERVALOS_OFERTA],
        maxPorDia: [...MAX_POR_DIA],
        horarios: [...HORARIOS],
        cashbackDiasAntes: [...CASHBACK_DIAS_ANTES],
        cashbackSaldoMin: [...CASHBACK_SALDO_MIN],
      },
      envioHoje,
      cashback: {
        provedor: pronto.provedor,
        pronto: pronto.pronto,
        motivo: pronto.motivo ?? null,
        modelo: modelo ? { nome: MODELO_CASHBACK, ...modelo } : null,
        previa,
        resultado: await this.resultado(tenantId, 'cashback'),
      },
    };
  }

  /** "Últimos 30 dias": mensagens, cliques, quem voltou (pediu em até 7 dias depois — a conta das campanhas) e quanto. */
  async resultado(tenantId: string, tipo: string) {
    const r = this.rows(
      await this.db.execute(sql`
        with env as (
          select id, cliente_id, enviado_em, clicou_em from relacionamento_envio
           where tenant_id = ${tenantId}::uuid and tipo = ${tipo} and status = 'enviado'
             and enviado_em > now() - interval '30 days'
        ),
        ped as (
          select distinct p.id, p.total, p.cliente_id
            from env join pedido_externo p on p.tenant_id = ${tenantId}::uuid and p.cliente_id = env.cliente_id
           where p.status <> 'cancelado' and p.criado_em >= env.enviado_em and p.criado_em <= env.enviado_em + interval '7 days'
        )
        select (select count(*) from env)::int as mensagens,
               (select count(clicou_em) from env)::int as cliques,
               (select count(distinct cliente_id) from ped)::int as voltaram,
               (select coalesce(sum(total), 0) from ped)::float8 as valor`),
    );
    const x = r[0] ?? {};
    return { mensagens: Number(x.mensagens ?? 0), cliques: Number(x.cliques ?? 0), voltaram: Number(x.voltaram ?? 0), valor: Number(x.valor ?? 0) };
  }

  // ===================== A rotina =====================

  @Interval(60_000)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return; // só a NUVEM manda (o WhatsApp mora lá)
    this.rodando = true;
    try {
      const empresas = this.rows(await this.db.execute(sql`select tenant_id from relacionamento_config where cashback_ativo`));
      for (const e of empresas) {
        try {
          await this.rodarEmpresa(String(e.tenant_id));
        } catch (err: any) {
          this.logger.warn(`automáticas da empresa ${e.tenant_id}: ${err?.message ?? err}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`rotina das automáticas: ${err?.message ?? err}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Uma passada numa empresa: no horário, separa a lista do dia (uma vez) e manda um punhado. */
  async rodarEmpresa(tenantId: string, agora = agoraNaOperacao()): Promise<{ separados: number; enviados: number }> {
    const a = await this.ajustes(tenantId);
    if (!a.cashbackAtivo) return { separados: 0, enviados: 0 };
    const listas = await this.horarios(tenantId);
    if (!podeMandarAgora(listas, a.horario, agora)) return { separados: 0, enviados: 0 };
    const dia = hojeISO();
    const perguntar = this.perguntouMeta.get(tenantId) !== dia;
    const pronto = await this.prontidaoCashback(tenantId, perguntar);
    if (perguntar) this.perguntouMeta.set(tenantId, dia);
    if (!pronto.pronto) return { separados: 0, enviados: 0 };

    let separados = 0;
    if (this.separado.get(tenantId) !== dia) {
      separados = await this.separarCashback(tenantId, dia, a, pronto.oferta);
      this.separado.set(tenantId, dia);
    }
    const enviados = await this.mandar(tenantId, dia, a, pronto);
    return { separados, enviados };
  }

  /**
   * Separa a lista do dia numa gravação só: até o limite do dia (todas as automáticas juntas), quem vence antes
   * primeiro. A trava contra mandar duas vezes é o índice único (um aviso por vencimento). O que ficou separado de um dia
   * anterior sem sair volta a valer (some e pode entrar de novo).
   */
  async separarCashback(tenantId: string, dia: string, a: AjustesRelacionamento, oferta: boolean): Promise<number> {
    await this.db.execute(sql`
      delete from relacionamento_envio where tenant_id = ${tenantId}::uuid and status = 'pendente' and dia < ${dia}::date`);
    const r = this.rows(
      await this.db.execute(sql`
        insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, unidade_id, dia, oferta, valor, vence_em)
        select ${tenantId}::uuid, 'cashback', q.chave, q.referencia, q.telefone, q.cliente_id, q.unidade_id, ${dia}::date, ${oferta}, q.saldo, q.expira_em
          from (${this.candidatosCashback(tenantId, dia, a, oferta)}) q
         order by q.expira_em asc, q.saldo desc
         limit greatest(0, ${a.maxPorDia}::int - (select count(*)::int from relacionamento_envio u
                                                   where u.tenant_id = ${tenantId}::uuid and u.dia = ${dia}::date
                                                     and u.status in ('pendente', 'enviado', 'falha')))
        on conflict (tenant_id, tipo, chave_telefone, referencia) do nothing
        returning id`),
    );
    return r.length;
  }

  /**
   * Manda o que foi separado para o dia: marca como enviado ANTES de mandar (`for update skip locked` — dois servidores
   * nunca pegam a mesma linha); confere de novo quem saiu e o saldo; falha volta como `falha`, com o motivo.
   */
  async mandar(tenantId: string, dia: string, a: AjustesRelacionamento, pronto: Prontidao): Promise<number> {
    const lote = this.rows(
      await this.db.execute(sql`
        update relacionamento_envio set status = 'enviado', enviado_em = now()
         where id in (select id from relacionamento_envio
                       where tenant_id = ${tenantId}::uuid and dia = ${dia}::date and status = 'pendente'
                       order by vence_em asc nulls last, criado_em asc
                       limit ${POR_MINUTO[pronto.provedor]} for update skip locked)
        returning *`),
    ).sort(
      // o `returning` não garante a ordem: quem vence antes recebe antes
      (x, y) => new Date(x.vence_em ?? 0).getTime() - new Date(y.vence_em ?? 0).getTime() || new Date(x.criado_em).getTime() - new Date(y.criado_em).getTime(),
    );
    let enviados = 0;
    for (const e of lote) {
      const fora = (motivo: string) =>
        this.db.execute(sql`update relacionamento_envio set status = 'fora', motivo = ${motivo}, enviado_em = null where id = ${e.id}::uuid`);
      try {
        if (await saiuDoMarketing(this.db, tenantId, String(e.telefone), e.cliente_id ?? null)) {
          await fora('pediu para sair');
          continue;
        }
        // O saldo de agora: usou (ou caiu do mínimo) não recebe; ganhou de novo (o vencimento mudou), também não — o
        // aviso deste vencimento não vale mais.
        const s = this.rows(
          await this.db.execute(sql`
            select saldo::float8 as saldo, expira_em,
                   to_char((expira_em at time zone ${FUSO_SQL})::date, 'YYYY-MM-DD') as referencia
              from cashback_saldo
             where tenant_id = ${tenantId}::uuid and tipo = 'valor' and ${sqlChaveTelefone(sql`telefone`)} = ${e.chave_telefone}
             order by expira_em asc nulls last limit 1`),
        )[0];
        if (!s || Number(s.saldo) < a.cashbackSaldoMin) {
          await fora('usou o saldo');
          continue;
        }
        if (s.referencia !== e.referencia) {
          await fora('o vencimento mudou');
          continue;
        }
        const nome = String(
          this.rows(await this.db.execute(sql`select nome from cliente where id = ${e.cliente_id}::uuid`))[0]?.nome ?? '',
        );
        const tel = String(e.telefone).replace(/\D/g, '');
        const numero = tel.length === 10 || tel.length === 11 ? `55${tel}` : tel;
        if (pronto.provedor === 'cloud') {
          await this.cloud.enviarTemplate(tenantId, numero, MODELO_CASHBACK, 'pt_BR', [primeiroNome(nome) || 'cliente', reais(s.saldo), dataCurta(s.expira_em)], {
            envioId: String(e.id),
            phoneId: pronto.phoneId ?? undefined,
          });
        } else {
          const loja = await this.nomeDaLoja(tenantId, e.unidade_id ?? null);
          const texto = textoCashbackQr({ nome, valor: Number(s.saldo), loja, vence: s.expira_em, link: `${PUB()}/publico/relacionamento/r/${e.id}` });
          await this.whatsapp.enviarPorInstancia(tenantId, String(pronto.instancia), numero, texto);
        }
        await this.db.execute(sql`update relacionamento_envio set valor = ${Number(s.saldo)}, vence_em = ${s.expira_em} where id = ${e.id}::uuid`);
        enviados += 1;
      } catch (err: any) {
        const motivo = String(err?.message ?? err).slice(0, 300);
        await this.db.execute(sql`update relacionamento_envio set status = 'falha', motivo = ${motivo} where id = ${e.id}::uuid`);
        this.logger.warn(`aviso do cashback (empresa ${tenantId}, envio ${e.id}) não saiu: ${motivo}`);
      }
    }
    return enviados;
  }

  /** O nome da loja do último pedido do cliente (empresa com várias lojas); senão o da empresa. */
  private async nomeDaLoja(tenantId: string, unidadeId: string | null): Promise<string> {
    const r = this.rows(
      await this.db.execute(sql`
        select coalesce(nullif(trim(cc.nome_publico), ''), e.nome) as nome
          from empresa e
          left join cardapio_config cc on cc.tenant_id = e.id
         where e.id = ${tenantId}::uuid
         order by (cc.unidade_id is not distinct from ${unidadeId}::uuid) desc nulls last, (cc.unidade_id is null) desc nulls last
         limit 1`),
    );
    return String(r[0]?.nome ?? 'nossa loja');
  }

  // ===================== O clique =====================

  /**
   * O botão "Ver meu saldo" (e o link do QR): marca o clique (uma vez) e devolve o endereço de Sua conta › Benefícios no
   * cardápio da loja do envio. Envio desconhecido (o exemplo que a Meta abre na análise): o endereço do app.
   */
  async destinoDoClique(id: string): Promise<string> {
    if (!UUID.test(String(id ?? ''))) return APP();
    const r = this.rows(
      await this.db.execute(sql`
        update relacionamento_envio set clicou_em = coalesce(clicou_em, now())
         where id = ${id}::uuid
        returning tenant_id, unidade_id`),
    );
    if (!r[0]) return APP();
    // O cardápio da loja do envio; senão o da empresa; senão qualquer um da empresa.
    const cfg = this.rows(
      await this.db.execute(sql`
        select token from cardapio_config
         where tenant_id = ${r[0].tenant_id}::uuid and token is not null
         order by (unidade_id is not distinct from ${r[0].unidade_id ?? null}::uuid) desc, (unidade_id is null) desc
         limit 1`),
    )[0];
    return cfg?.token ? `${APP()}/c/${cfg.token}?conta=beneficios` : APP();
  }
}

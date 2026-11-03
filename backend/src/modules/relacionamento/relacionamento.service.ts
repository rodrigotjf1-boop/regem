import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { dataNoFuso, hojeISO, somarDias } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { sqlChaveTelefone, sqlPodeTerAChave } from '../../common/telefone-chave';
import { saiuDoMarketing, sqlRecebeMarketing } from '../../common/marketing-quem-recebe';
import { aniversarioValendoEntre, sqlOcorrenciaEntre, valePara } from '../../common/aniversario';
import { descricaoDoCupom, validadeDoPresente } from '../aniversario/aniversario.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappNumeroService } from '../whatsapp/whatsapp-numero.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import {
  ANIV_ATRASO_MAX,
  ANIV_DESCONTO,
  ANIV_MINIMO,
  ANIV_QUANDO,
  ANIV_VALIDADE,
  VOLTA_DESCONTO,
  VOLTA_DIAS,
  VOLTA_ENTRE_TENTATIVAS_DIAS,
  VOLTA_JANELA_DIAS,
  VOLTA_MINIMO,
  VOLTA_PEDIDOS,
  VOLTA_TENTATIVAS,
  VOLTA_VALIDADE,
  textoVoltaQr,
  type AnivDesconto,
  type VoltaDesconto,
  CASHBACK_DIAS_ANTES,
  CASHBACK_SALDO_MIN,
  DIAS_ANTES_DO_ANIVERSARIO,
  HORA_MAX,
  HORARIOS,
  INTERVALOS_OFERTA,
  MAX_POR_DIA,
  agoraNaOperacao,
  ajustesDaLinha,
  codigoDoCupom,
  cupomDoDesconto,
  dataCurta,
  horaDoEnvio,
  lerAjustes,
  nomeCurto,
  podeMandarAgora,
  primeiroNome,
  reais,
  textoAniversarioQr,
  textoCashbackQr,
  type AjustesRelacionamento,
} from './relacionamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AUTOMÁTICAS DE MARKETING (Onda 3 — PR 2, mig 356; PR 3, mig 357 — só NUVEM). Delivery › Marketing › Automáticas: os
// ajustes para todas (frequência, limite por dia, horário), o "cashback vencendo" e o "aniversário". Uma rotina, a cada
// minuto, no horário do envio de cada empresa: SEPARA a lista do dia numa gravação só (o índice único é a trava "uma
// mensagem por vencimento" / "uma por ano") e MANDA o que separou, marcando antes de mandar (dois servidores não mandam a
// mesma). O cupom pessoal do aniversário nasce só na hora de mandar. O "sentimos sua falta" entra no PR 4.

const PUB = () => (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
const APP = () => (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O modelo de utilidade do aviso do cashback na API oficial. */
export const MODELO_CASHBACK = 'cashback_vencendo';
/** Os modelos de marketing do aniversário: com o presente e só os parabéns. */
export const MODELO_ANIV_PRESENTE = 'aniversario_presente';
export const MODELO_ANIV_PARABENS = 'aniversario_parabens';
/** Os modelos de marketing do "sentimos sua falta": com o cupom e só o lembrete. */
export const MODELO_VOLTA_CUPOM = 'volta_cupom';
export const MODELO_VOLTA_LEMBRETE = 'volta_lembrete';
/** Quantas mensagens por minuto, por empresa: a API oficial aguenta; o QR vai devagar (protege o número). */
const POR_MINUTO = { cloud: 10, evolution: 1 } as const;
/** Quantos nomes a prévia mostra ("Ver quem"). */
const NA_PREVIA = 5;
const NA_PREVIA_ANIV = 8;

export type Tipo = 'cashback' | 'aniversario' | 'volta';
/** O número que manda: o aviso do cashback é utilidade (o principal, como os avisos do pedido); o resto, o de marketing. */
const PAPEL: Record<Tipo, 'principal' | 'marketing'> = { cashback: 'principal', aniversario: 'marketing', volta: 'marketing' };
/** A ordem da rotina: o que tem prazo primeiro (o limite do dia é de todas juntas). */
const ORDEM: Tipo[] = ['cashback', 'aniversario', 'volta'];
const LIGADA: Record<Tipo, (a: AjustesRelacionamento) => boolean> = {
  cashback: (a) => a.cashbackAtivo,
  aniversario: (a) => a.aniversarioAtivo,
  volta: (a) => a.voltaAtivo,
};

type Prontidao = { pronto: boolean; provedor: 'cloud' | 'evolution'; motivo?: string; instancia?: string | null; phoneId?: string | null; oferta: boolean };

@Injectable()
export class RelacionamentoService {
  private readonly logger = new Logger('Automaticas');
  private rodando = false;
  /** "Já separei a lista de hoje desta empresa, deste tipo" (por processo; a trava de verdade é o índice único). */
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
      aniversarioAtivo: 'aniversario_ativo',
      aniversarioQuando: 'aniversario_quando',
      aniversarioPresente: 'aniversario_presente',
      aniversarioDesconto: 'aniversario_desconto',
      aniversarioMinimo: 'aniversario_minimo',
      aniversarioValidadeDias: 'aniversario_validade_dias',
      voltaAtivo: 'volta_ativo',
      voltaDias: 'volta_dias',
      voltaMinPedidos: 'volta_min_pedidos',
      voltaPresente: 'volta_presente',
      voltaDesconto: 'volta_desconto',
      voltaMinimo: 'volta_minimo',
      voltaValidadeDias: 'volta_validade_dias',
      voltaTentativas: 'volta_tentativas',
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

  /** O modelo da API oficial que a automática usa agora. */
  modeloDe(tipo: Tipo, a: AjustesRelacionamento): string {
    if (tipo === 'cashback') return MODELO_CASHBACK;
    if (tipo === 'volta') return a.voltaPresente === 'cupom' ? MODELO_VOLTA_CUPOM : MODELO_VOLTA_LEMBRETE;
    return a.aniversarioPresente === 'cupom' ? MODELO_ANIV_PRESENTE : MODELO_ANIV_PARABENS;
  }

  /**
   * Dá para mandar agora? O número do papel (principal para o cashback, marketing para o resto); na API oficial, o modelo
   * aprovado. `oferta`: conta na frequência das ofertas — o cashback só se a Meta o classificou como marketing.
   */
  async prontidao(tenantId: string, tipo: Tipo, a: AjustesRelacionamento, perguntarAMeta = false): Promise<Prontidao> {
    const ofertaPadrao = tipo !== 'cashback';
    let num: any;
    try {
      num = await this.numeros.resolver(tenantId, PAPEL[tipo]);
    } catch {
      return { pronto: false, provedor: 'evolution', motivo: 'sem WhatsApp conectado', oferta: ofertaPadrao };
    }
    if (num?.provedor === 'cloud') {
      if (!num.phoneId) return { pronto: false, provedor: 'cloud', motivo: 'sem número da API oficial', oferta: ofertaPadrao };
      const nome = this.modeloDe(tipo, a);
      let m = await this.modelo(tenantId, nome);
      if (m && m.status === 'pendente' && perguntarAMeta) {
        await this.cloud.atualizarModelo(tenantId, nome).catch(() => undefined);
        m = await this.modelo(tenantId, nome);
      }
      const oferta = tipo === 'cashback' ? m?.categoria === 'MARKETING' : true;
      if (!m) return { pronto: false, provedor: 'cloud', motivo: 'o modelo ainda não foi enviado à Meta', oferta };
      if (m.status !== 'aprovado') return { pronto: false, provedor: 'cloud', motivo: `o modelo está ${m.status} na Meta`, oferta };
      return { pronto: true, provedor: 'cloud', phoneId: num.phoneId, oferta };
    }
    if (!num?.instancia)
      return {
        pronto: false,
        provedor: 'evolution',
        motivo: PAPEL[tipo] === 'principal' ? 'o WhatsApp da loja não está conectado' : 'o número de marketing não está conectado',
        oferta: ofertaPadrao,
      };
    return { pronto: true, provedor: 'evolution', instancia: num.instancia, oferta: ofertaPadrao };
  }

  /** Dá para mandar o aviso do cashback agora? (o atalho que o PR 2 usava) */
  async prontidaoCashback(tenantId: string, perguntarAMeta = false): Promise<Prontidao> {
    return this.prontidao(tenantId, 'cashback', await this.ajustes(tenantId), perguntarAMeta);
  }

  private async modelo(tenantId: string, nome: string): Promise<{ status: string; categoria: string; motivo: string | null } | null> {
    const r = this.rows(
      await this.db.execute(sql`
        select status, categoria, motivo_rejeicao from whatsapp_template
         where tenant_id = ${tenantId}::uuid and nome = ${nome} and idioma = 'pt_BR' limit 1`),
    );
    return r[0] ? { status: String(r[0].status), categoria: String(r[0].categoria), motivo: r[0].motivo_rejeicao ?? null } : null;
  }

  /** "Enviar à Meta" (só API oficial). O aniversário manda os dois modelos (com o presente e só os parabéns). */
  async enviarModelo(user: AuthUser, tipo: string): Promise<{ status: string }> {
    if (tipo !== 'cashback' && tipo !== 'aniversario' && tipo !== 'volta') throw new BadRequestException('Automática desconhecida.');
    const num = await this.numeros.resolver(user.tenantId, PAPEL[tipo]).catch(() => null);
    if (num?.provedor !== 'cloud')
      throw new BadRequestException(
        tipo === 'cashback'
          ? 'O modelo é da API oficial: o número principal da loja usa o QR, e o aviso sai como texto.'
          : 'O modelo é da API oficial: o número de marketing usa o QR, e a mensagem sai como texto.',
      );
    const nomes =
      tipo === 'cashback' ? [MODELO_CASHBACK] : tipo === 'volta' ? [MODELO_VOLTA_CUPOM, MODELO_VOLTA_LEMBRETE] : [MODELO_ANIV_PRESENTE, MODELO_ANIV_PARABENS];
    let status = '';
    for (const nome of nomes) status = await this.cloud.garantirModeloRelacionamento(user.tenantId, nome);
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
      detalhe: { modelos: nomes, status },
    });
    return { status };
  }

  // ===================== Quem recebe =====================

  /**
   * "Uma oferta a cada N dias" somando as automáticas e as campanhas (só para o que é oferta). Conta também a oferta já
   * SEPARADA hoje e ainda na fila (pelo QR sai uma por minuto): sem isso, o aniversário na fila e o "sentimos sua falta"
   * da mesma pessoa saíam no mesmo dia (ERR-352). O envio confere de novo na hora (`ofertaRecente`).
   */
  private frequencia(tenantId: string, a: AjustesRelacionamento, oferta: boolean) {
    return oferta
      ? sql`and not exists (select 1 from relacionamento_envio e2 where e2.tenant_id = ${tenantId}::uuid and e2.chave_telefone = x.chave
               and e2.oferta
               and ((e2.status = 'enviado' and e2.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int))
                    or (e2.status = 'pendente' and e2.dia = ${hojeISO()}::date)))
            and not exists (select 1 from campanha_envio ce where ce.tenant_id = ${tenantId}::uuid and ce.status = 'enviado'
               and ce.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int)
               and ${sqlChaveTelefone(sql`ce.telefone`)} = x.chave)`
      : sql``;
  }

  /**
   * Na hora de mandar uma oferta: outra oferta (automática ou campanha) já saiu para este telefone nos últimos N dias?
   * Pega o que mudou depois da separação — a campanha que saiu no meio, a outra automática que andou na frente (ERR-352).
   */
  private async ofertaRecente(tenantId: string, e: any, a: AjustesRelacionamento): Promise<boolean> {
    const r = this.rows(
      await this.db.execute(sql`
        select 1 as sim
         where exists (select 1 from relacionamento_envio e2 where e2.tenant_id = ${tenantId}::uuid and e2.id <> ${e.id}::uuid
                         and e2.chave_telefone = ${e.chave_telefone} and e2.oferta and e2.status = 'enviado'
                         and e2.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int))
            or exists (select 1 from campanha_envio ce where ce.tenant_id = ${tenantId}::uuid and ce.status = 'enviado'
                         and ce.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int)
                         and ${sqlChaveTelefone(sql`ce.telefone`)} = ${e.chave_telefone})`),
    );
    return r.length > 0;
  }

  /** Quem já pediu fora do iFood e da 99 (o telefone dessas é da plataforma). Alias `c`. */
  private pediuNaLoja() {
    return sql`and exists (select 1 from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                             and coalesce(p.canal, '') not in ('ifood', '99food'))`;
  }

  /**
   * Os clientes cujo cashback vence entre o dia seguinte ao envio e N dias depois, com saldo de pelo menos R$ X, que
   * recebem marketing (regra única), que já pediram fora do iFood e da 99 e que ainda não foram avisados DESTE
   * vencimento. Um por telefone (pela chave). Com o aviso classificado pela Meta como marketing, também respeita "uma
   * oferta a cada N dias" (somando as campanhas).
   *
   * Os poucos saldos que vencem na janela PRIMEIRO; os clientes, por um filtro barato antes da chave do telefone (que é
   * cara: ~20 `regexp_replace` por número). A chave só mexe no COMEÇO do número (0055/55/0 e o nono dígito depois do DDD):
   * quem tem a mesma chave tem os mesmos 8 últimos dígitos; o número curto ou estranho (chave com menos de 8 dígitos)
   * passa pelo filtro e é conferido pela chave. CTE `materialized`: o planejador não pode reordenar — a consulta antiga
   * cruzava pedidos × saldos e calculava a chave 1 milhão de vezes (3,7 s na nuvem, 20 s com o volume da loja aqui; a aba
   * Automáticas não carregava — ERR-353).
   */
  private candidatosCashback(tenantId: string, dia: string, a: AjustesRelacionamento, oferta: boolean) {
    return sql`
      with sal as materialized (
        select s.saldo::float8 as saldo, s.expira_em,
               to_char((s.expira_em at time zone ${FUSO_SQL})::date, 'YYYY-MM-DD') as referencia,
               ${sqlChaveTelefone(sql`s.telefone`)} as chave,
               right(regexp_replace(coalesce(s.telefone, ''), '[^0-9]', '', 'g'), 8) as fim
          from cashback_saldo s
         where s.tenant_id = ${tenantId}::uuid and s.tipo = 'valor'
           and s.saldo >= ${a.cashbackSaldoMin}::numeric and s.expira_em is not null
           and (s.expira_em at time zone ${FUSO_SQL})::date between ${dia}::date + 1 and ${dia}::date + ${a.cashbackDiasAntes}::int
      ),
      cli as materialized (
        select c.id, c.nome, c.telefone, c.tenant_id, c.opt_out_marketing, ${sqlChaveTelefone(sql`c.telefone`)} as chave
          from cliente c
          cross join lateral (select regexp_replace(coalesce(c.telefone, ''), '[^0-9]', '', 'g') as d) dd
         where c.tenant_id = ${tenantId}::uuid
           and ${sqlPodeTerAChave(sql`dd.d`, sql`select fim from sal`)}
      )
      select x.* from (
        select distinct on (c.chave)
               c.chave, c.id as cliente_id, c.nome, c.telefone, s.saldo, s.expira_em, s.referencia,
               (select p.unidade_id from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                 order by p.criado_em desc limit 1) as unidade_id
          from sal s
          join cli c on c.chave = s.chave
         where true
           ${sqlRecebeMarketing()}
           ${this.pediuNaLoja()}
         order by c.chave, s.expira_em asc, s.saldo desc
      ) x
      where not exists (select 1 from relacionamento_envio e where e.tenant_id = ${tenantId}::uuid and e.tipo = 'cashback'
                          and e.chave_telefone = x.chave and e.referencia = x.referencia)
      ${this.frequencia(tenantId, a, oferta)}`;
  }

  /** A janela do aniversário para o envio do dia: a data alvo (no dia, 3 ou 7 dias antes) e até 3 dias de atraso. */
  janelaAniversario(dia: string, a: AjustesRelacionamento): { desde: string; ate: string } {
    const alvo = somarDias(dia, DIAS_ANTES_DO_ANIVERSARIO[a.aniversarioQuando]);
    return { desde: somarDias(alvo, -ANIV_ATRASO_MAX), ate: alvo };
  }

  /**
   * Os aniversariantes da janela com a PROTEÇÃO (regra única em `common/aniversario.ts`): a data informada 30 dias ou
   * mais antes do aniversário, quem pediu nos últimos 12 meses, um presente a cada 12 meses (com cupom), quem recebe
   * marketing, quem pediu fora do iFood e da 99, uma vez por ano (a referência é o ano) e "uma oferta a cada N dias".
   */
  private candidatosAniversario(tenantId: string, dia: string, a: AjustesRelacionamento) {
    const { desde, ate } = this.janelaAniversario(dia, a);
    const presente = a.aniversarioPresente === 'cupom'
      ? sql`and (ca.ultimo_presente_em is null or ca.ultimo_presente_em < now() - interval '12 months')`
      : sql``;
    return sql`
      select x.* from (
        select distinct on (${sqlChaveTelefone(sql`c.telefone`)})
               ${sqlChaveTelefone(sql`c.telefone`)} as chave, c.id as cliente_id, c.nome, c.telefone,
               o.data as aniversario, to_char(o.data, 'YYYY') as referencia,
               (select p.unidade_id from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                 order by p.criado_em desc limit 1) as unidade_id
          from cliente c
          join cliente_aniversario ca on ca.cliente_id = c.id and ca.tenant_id = c.tenant_id
          cross join lateral (select ${sqlOcorrenciaEntre(desde, ate)} as data) o
         where c.tenant_id = ${tenantId}::uuid and ca.dia is not null and o.data is not null
           and c.ultimo_pedido_em >= now() - interval '12 months'
           ${presente}
           ${sqlRecebeMarketing()}
           ${this.pediuNaLoja()}
         order by ${sqlChaveTelefone(sql`c.telefone`)}, o.data asc
      ) x
      where not exists (select 1 from relacionamento_envio e where e.tenant_id = ${tenantId}::uuid and e.tipo = 'aniversario'
                          and e.chave_telefone = x.chave and e.referencia = x.referencia)
      ${this.frequencia(tenantId, a, true)}`;
  }

  /**
   * "Sentimos sua falta": quem não pede há N dias (a 1ª chamada só até N + 30 — quem sumiu há mais tempo fica para as
   * campanhas), com pelo menos M pedidos, que recebe marketing, que pediu fora do iFood e da 99, sem caso aberto no
   * Atendimento e respeitando "uma oferta a cada N dias". A 2ª chamada (com 2 tentativas) sai 60 dias depois da 1ª, se o
   * cliente não pediu no meio; pedido novo zera as tentativas (a referência é o dia do último pedido + "#tentativa").
   */
  private candidatosVolta(tenantId: string, a: AjustesRelacionamento) {
    const chave = sqlChaveTelefone(sql`c.telefone`);
    return sql`
      select x.*, x.dia_pedido || '#' || (x.tentativas + 1) as referencia from (
        select distinct on (${chave})
               ${chave} as chave, c.id as cliente_id, c.nome, c.telefone, c.ultimo_pedido_em, c.total_pedidos,
               to_char((c.ultimo_pedido_em at time zone ${FUSO_SQL})::date, 'YYYY-MM-DD') as dia_pedido,
               (select count(*) from relacionamento_envio e where e.tenant_id = c.tenant_id and e.tipo = 'volta'
                  and e.status = 'enviado' and e.chave_telefone = ${chave} and e.enviado_em > c.ultimo_pedido_em)::int as tentativas,
               (select max(e.enviado_em) from relacionamento_envio e where e.tenant_id = c.tenant_id and e.tipo = 'volta'
                  and e.status = 'enviado' and e.chave_telefone = ${chave} and e.enviado_em > c.ultimo_pedido_em) as ultima_tentativa,
               (select p.unidade_id from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                 order by p.criado_em desc limit 1) as unidade_id
          from cliente c
         where c.tenant_id = ${tenantId}::uuid and c.ultimo_pedido_em is not null
           and c.ultimo_pedido_em <= now() - make_interval(days => ${a.voltaDias}::int)
           and coalesce(c.total_pedidos, 0) >= ${a.voltaMinPedidos}::int
           ${sqlRecebeMarketing()}
           ${this.pediuNaLoja()}
           and not exists (select 1 from atendimento_chamado ac where ac.tenant_id = c.tenant_id and ac.status <> 'resolvido'
                             and ${sqlChaveTelefone(sql`ac.telefone`)} = ${chave})
         order by ${chave}, c.ultimo_pedido_em desc
      ) x
      where x.tentativas < ${a.voltaTentativas}::int
        and ((x.tentativas = 0 and x.ultimo_pedido_em > now() - make_interval(days => ${a.voltaDias + VOLTA_JANELA_DIAS}::int))
             or (x.tentativas > 0 and x.ultima_tentativa <= now() - make_interval(days => ${VOLTA_ENTRE_TENTATIVAS_DIAS}::int)))
        and not exists (select 1 from relacionamento_envio e where e.tenant_id = ${tenantId}::uuid and e.tipo = 'volta'
                          and e.chave_telefone = x.chave and e.referencia = x.dia_pedido || '#' || (x.tentativas + 1))
      ${this.frequencia(tenantId, a, true)}`;
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
    const [pronto, prontoAniv] = await Promise.all([this.prontidao(tenantId, 'cashback', a, true), this.prontidao(tenantId, 'aniversario', a, true)]);
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
    // O "sentimos sua falta" sai DEPOIS do cashback e do aniversário (`ORDEM`): as vagas dele são as que sobram deles.
    let antesDaVolta = 0;
    if (prox) {
      if (a.cashbackAtivo && pronto.pronto) antesDaVolta += previa?.total ?? 0;
      if (a.aniversarioAtivo && prontoAniv.pronto)
        antesDaVolta += Number(
          this.rows(await this.db.execute(sql`select count(*)::int as n from (${this.candidatosAniversario(tenantId, prox.dia, a)}) q`))[0]?.n ?? 0,
        );
    }
    return {
      ajustes: a,
      opcoes: {
        intervalos: [...INTERVALOS_OFERTA],
        maxPorDia: [...MAX_POR_DIA],
        horarios: [...HORARIOS],
        cashbackDiasAntes: [...CASHBACK_DIAS_ANTES],
        cashbackSaldoMin: [...CASHBACK_SALDO_MIN],
        aniversarioQuando: [...ANIV_QUANDO],
        aniversarioDesconto: [...ANIV_DESCONTO],
        aniversarioMinimo: [...ANIV_MINIMO],
        aniversarioValidade: [...ANIV_VALIDADE],
        voltaDias: [...VOLTA_DIAS],
        voltaPedidos: [...VOLTA_PEDIDOS],
        voltaDesconto: [...VOLTA_DESCONTO],
        voltaMinimo: [...VOLTA_MINIMO],
        voltaValidade: [...VOLTA_VALIDADE],
        voltaTentativas: [...VOLTA_TENTATIVAS],
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
      aniversario: {
        provedor: prontoAniv.provedor,
        pronto: prontoAniv.pronto,
        motivo: prontoAniv.motivo ?? null,
        modelos:
          prontoAniv.provedor === 'cloud'
            ? {
                presente: await this.modelo(tenantId, MODELO_ANIV_PRESENTE),
                parabens: await this.modelo(tenantId, MODELO_ANIV_PARABENS),
              }
            : null,
        informaram: await this.quantosInformaram(tenantId),
        previa: await this.previaAniversario(tenantId, a),
        resultado: await this.resultado(tenantId, 'aniversario'),
      },
      volta: await this.painelVolta(tenantId, a, prox, antesDaVolta),
    };
  }

  /**
   * O grupo do "sentimos sua falta": o número e os modelos, a prévia do próximo envio e o resultado. `antes`: quantos do
   * cashback e do aniversário saem antes no mesmo dia (o limite do dia é de todas juntas).
   */
  private async painelVolta(tenantId: string, a: AjustesRelacionamento, prox: { dia: string; hora: string; emDias: number } | null, antes = 0) {
    const pronto = await this.prontidao(tenantId, 'volta', a, true);
    let previa: any = null;
    if (prox) {
      const total = Number(this.rows(await this.db.execute(sql`select count(*)::int as n from (${this.candidatosVolta(tenantId, a)}) q`))[0]?.n ?? 0);
      const vagas = Math.max(0, a.maxPorDia - (await this.usadasNoDia(tenantId, prox.dia)) - antes);
      const lista = this.rows(
        await this.db.execute(sql`
          select q.nome, q.ultimo_pedido_em, q.total_pedidos, q.tentativas from (${this.candidatosVolta(tenantId, a)}) q
           order by q.ultimo_pedido_em desc limit ${NA_PREVIA}`),
      ).map((x) => {
        const dias = Math.max(0, Math.floor((Date.now() - new Date(x.ultimo_pedido_em).getTime()) / 86_400_000));
        const pedidos = Number(x.total_pedidos ?? 0);
        const tentativa = Number(x.tentativas ?? 0) > 0 ? ` · ${Number(x.tentativas) + 1}ª tentativa` : '';
        return { nome: nomeCurto(x.nome), detalhe: `${dias} dias sem pedir · ${pedidos} ${pedidos === 1 ? 'pedido' : 'pedidos'}${tentativa}` };
      });
      previa = { ...prox, total, vagas, lista };
    }
    return {
      provedor: pronto.provedor,
      pronto: pronto.pronto,
      motivo: pronto.motivo ?? null,
      modelos:
        pronto.provedor === 'cloud'
          ? { cupom: await this.modelo(tenantId, MODELO_VOLTA_CUPOM), lembrete: await this.modelo(tenantId, MODELO_VOLTA_LEMBRETE) }
          : null,
      previa,
      resultado: await this.resultado(tenantId, 'volta'),
    };
  }

  /**
   * "Quem voltou" (últimos 30 dias): quem recebeu a mensagem e pediu em até 7 dias depois — quanto, quantos dias depois e
   * se usou o cupom da mensagem. A mesma conta do resultado (a das campanhas).
   */
  async quemVoltou(tenantId: string, tipo: string) {
    if (!['cashback', 'aniversario', 'volta'].includes(tipo)) throw new BadRequestException('Automática desconhecida.');
    const r = this.rows(
      await this.db.execute(sql`
        select c.nome, e.enviado_em, p.criado_em, p.total::float8 as total,
               exists (select 1 from cupom_uso u where u.cupom_id = e.cupom_id and u.pedido_id = p.id) as usou_cupom
          from relacionamento_envio e
          join cliente c on c.id = e.cliente_id
          join lateral (select p.id, p.criado_em, p.total from pedido_externo p
                         where p.tenant_id = e.tenant_id and p.cliente_id = e.cliente_id and p.status <> 'cancelado'
                           and p.criado_em >= e.enviado_em and p.criado_em <= e.enviado_em + interval '7 days'
                         order by p.criado_em asc limit 1) p on true
         where e.tenant_id = ${tenantId}::uuid and e.tipo = ${tipo} and e.status = 'enviado'
           and e.enviado_em > now() - interval '30 days'
         order by p.criado_em desc
         limit 50`),
    );
    return r.map((x) => {
      const dias = Math.floor((new Date(x.criado_em).getTime() - new Date(x.enviado_em).getTime()) / 86_400_000);
      const quando = dias <= 0 ? 'pediu no mesmo dia' : `pediu ${dias} ${dias === 1 ? 'dia' : 'dias'} depois`;
      return { nome: nomeCurto(x.nome), detalhe: `${quando} · ${reais(x.total)} · ${x.usou_cupom ? 'usou o cupom' : 'sem cupom'}` };
    });
  }

  private async quantosInformaram(tenantId: string): Promise<number> {
    const r = this.rows(
      await this.db.execute(sql`select count(*)::int as n from cliente_aniversario where tenant_id = ${tenantId}::uuid and dia is not null`),
    );
    return Number(r[0]?.n ?? 0);
  }

  /**
   * "Esta semana: 3 presentes (5 aniversários)" + o "Ver quem" com o motivo de cada um — os aniversários dos próximos 7
   * dias, com a mesma ordem da regra: saiu, só iFood/99, não pede há 12 meses, a carência, o presente nos 12 meses, já
   * recebeu este ano, oferta recente.
   */
  async previaAniversario(tenantId: string, a: AjustesRelacionamento) {
    const hoje = hojeISO();
    const fim = somarDias(hoje, 6);
    const r = this.rows(
      await this.db.execute(sql`
        select c.nome, c.ultimo_pedido_em, ca.dia, ca.mes, ca.informado_em, ca.ultimo_presente_em,
               ${sqlOcorrenciaEntre(hoje, fim, false)} as aniversario,
               (c.opt_out_marketing or coalesce(c.telefone, '') = '' or c.telefone like 'S/N-%'
                or exists (select 1 from marketing_optout mo where mo.tenant_id = c.tenant_id
                             and ${sqlChaveTelefone(sql`mo.telefone`)} = ${sqlChaveTelefone(sql`c.telefone`)})) as saiu,
               exists (select 1 from pedido_externo p where p.tenant_id = c.tenant_id and p.cliente_id = c.id
                         and coalesce(p.canal, '') not in ('ifood', '99food')) as na_loja,
               exists (select 1 from relacionamento_envio e where e.tenant_id = c.tenant_id and e.tipo = 'aniversario'
                         and e.chave_telefone = ${sqlChaveTelefone(sql`c.telefone`)} and e.status = 'enviado'
                         and e.referencia = to_char(${sqlOcorrenciaEntre(hoje, fim, false)}, 'YYYY')) as ja_recebeu,
               (exists (select 1 from relacionamento_envio e2 where e2.tenant_id = c.tenant_id and e2.oferta and e2.status = 'enviado'
                          and e2.chave_telefone = ${sqlChaveTelefone(sql`c.telefone`)}
                          and e2.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int))
                or exists (select 1 from campanha_envio ce where ce.tenant_id = c.tenant_id and ce.status = 'enviado'
                          and ce.enviado_em > now() - make_interval(days => ${a.intervaloOfertasDias}::int)
                          and ${sqlChaveTelefone(sql`ce.telefone`)} = ${sqlChaveTelefone(sql`c.telefone`)})) as oferta_recente
          from cliente c join cliente_aniversario ca on ca.cliente_id = c.id and ca.tenant_id = c.tenant_id
         where c.tenant_id = ${tenantId}::uuid and ca.dia is not null and ${sqlOcorrenciaEntre(hoje, fim, false)} is not null
         order by 7 asc, c.nome asc
         limit 200`),
    );
    const doze = Date.now() - 365 * 86_400_000;
    const { tipo, valor } = cupomDoDesconto(a.aniversarioDesconto);
    const presenteTxt = a.aniversarioPresente === 'cupom' ? `cupom ${descricaoDoCupom(tipo, valor, a.aniversarioMinimo)}` : 'só os parabéns';
    let recebem = 0;
    const lista = r.map((x) => {
      const quando = dataCurta(`${String(x.aniversario).slice(0, 10)}T15:00:00Z`);
      const aniversario = String(x.aniversario).slice(0, 10);
      let motivo: string;
      if (x.saiu) motivo = 'pediu para sair: não recebe';
      else if (!x.na_loja) motivo = 'só pediu pelo iFood ou pela 99';
      else if (!x.ultimo_pedido_em || new Date(x.ultimo_pedido_em).getTime() < doze) motivo = 'não pede há mais de 12 meses';
      else if (!valePara(x.informado_em, aniversario))
        motivo = `informou em ${dataCurta(x.informado_em)}: fica para o ano que vem (menos de 30 dias)`;
      else if (a.aniversarioPresente === 'cupom' && x.ultimo_presente_em && new Date(x.ultimo_presente_em).getTime() > doze)
        motivo = 'já ganhou presente nos últimos 12 meses';
      else if (x.ja_recebeu) motivo = 'já recebeu este ano';
      else if (x.oferta_recente) motivo = `recebeu uma oferta nos últimos ${a.intervaloOfertasDias} dias: não recebe`;
      else {
        motivo = presenteTxt;
        recebem += 1;
      }
      return { nome: nomeCurto(x.nome), detalhe: `${quando} · ${motivo}` };
    });
    return { inicio: hoje, fim, aniversarios: r.length, recebem, lista: lista.slice(0, NA_PREVIA_ANIV) };
  }

  /** "Últimos 30 dias": mensagens, cliques, quem voltou (pediu em até 7 dias depois — a conta das campanhas), quanto e os cupons usados. */
  async resultado(tenantId: string, tipo: string) {
    const r = this.rows(
      await this.db.execute(sql`
        with env as (
          select id, cliente_id, enviado_em, clicou_em, cupom_id from relacionamento_envio
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
               (select coalesce(sum(total), 0) from ped)::float8 as valor,
               (select count(*) from env where cupom_id is not null
                  and exists (select 1 from cupom_uso u where u.cupom_id = env.cupom_id))::int as cupons`),
    );
    const x = r[0] ?? {};
    return {
      mensagens: Number(x.mensagens ?? 0),
      cliques: Number(x.cliques ?? 0),
      voltaram: Number(x.voltaram ?? 0),
      valor: Number(x.valor ?? 0),
      cupons: Number(x.cupons ?? 0),
    };
  }

  // ===================== A rotina =====================

  @Interval(60_000)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return; // só a NUVEM manda (o WhatsApp mora lá)
    this.rodando = true;
    try {
      const empresas = this.rows(
        await this.db.execute(sql`select tenant_id from relacionamento_config where cashback_ativo or aniversario_ativo or volta_ativo`),
      );
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

  /**
   * Uma passada numa empresa: no horário, para cada automática ligada e pronta (o cashback primeiro — tem prazo), separa
   * a lista do dia (uma vez; o limite do dia é de todas juntas) e manda um punhado.
   */
  async rodarEmpresa(tenantId: string, agora = agoraNaOperacao()): Promise<{ separados: number; enviados: number }> {
    const a = await this.ajustes(tenantId);
    if (!ORDEM.some((t) => LIGADA[t](a))) return { separados: 0, enviados: 0 };
    const listas = await this.horarios(tenantId);
    if (!podeMandarAgora(listas, a.horario, agora)) return { separados: 0, enviados: 0 };
    const dia = hojeISO();
    let separados = 0;
    let enviados = 0;
    for (const tipo of ORDEM) {
      if (!LIGADA[tipo](a)) continue;
      const chave = `${tenantId}|${tipo}`;
      const perguntar = this.perguntouMeta.get(chave) !== dia;
      const pronto = await this.prontidao(tenantId, tipo, a, perguntar);
      if (perguntar) this.perguntouMeta.set(chave, dia);
      if (!pronto.pronto) continue;
      if (this.separado.get(chave) !== dia) {
        separados +=
          tipo === 'cashback'
            ? await this.separarCashback(tenantId, dia, a, pronto.oferta)
            : tipo === 'volta'
              ? await this.separarVolta(tenantId, dia, a)
              : await this.separarAniversario(tenantId, dia, a);
        this.separado.set(chave, dia);
      }
      enviados += await this.mandar(tenantId, dia, a, pronto, tipo);
    }
    return { separados, enviados };
  }

  /** O que ficou separado de um dia anterior sem sair volta a valer (some e pode entrar de novo). */
  private async soltarPendentesAntigos(tenantId: string, dia: string, tipo: Tipo) {
    await this.db.execute(sql`
      delete from relacionamento_envio where tenant_id = ${tenantId}::uuid and tipo = ${tipo} and status = 'pendente' and dia < ${dia}::date`);
  }

  /** O limite do dia (todas as automáticas juntas), dentro da gravação. */
  private vagasSql(tenantId: string, dia: string, a: AjustesRelacionamento) {
    return sql`greatest(0, ${a.maxPorDia}::int - (select count(*)::int from relacionamento_envio u
                                                   where u.tenant_id = ${tenantId}::uuid and u.dia = ${dia}::date
                                                     and u.status in ('pendente', 'enviado', 'falha')))`;
  }

  /**
   * Separa a lista do dia numa gravação só: até o limite do dia (todas as automáticas juntas), quem vence antes
   * primeiro. A trava contra mandar duas vezes é o índice único (um aviso por vencimento).
   */
  async separarCashback(tenantId: string, dia: string, a: AjustesRelacionamento, oferta: boolean): Promise<number> {
    await this.soltarPendentesAntigos(tenantId, dia, 'cashback');
    const r = this.rows(
      await this.db.execute(sql`
        insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, unidade_id, dia, oferta, valor, vence_em)
        select ${tenantId}::uuid, 'cashback', q.chave, q.referencia, q.telefone, q.cliente_id, q.unidade_id, ${dia}::date, ${oferta}, q.saldo, q.expira_em
          from (${this.candidatosCashback(tenantId, dia, a, oferta)}) q
         order by q.expira_em asc, q.saldo desc
         limit ${this.vagasSql(tenantId, dia, a)}
        on conflict (tenant_id, tipo, chave_telefone, referencia) do nothing
        returning id`),
    );
    return r.length;
  }

  /**
   * Separa os clientes do "sentimos sua falta" do dia — quem sumiu há MENOS tempo primeiro (os outros ficam para os
   * próximos dias). A referência (o dia do último pedido + a tentativa) é a trava.
   */
  async separarVolta(tenantId: string, dia: string, a: AjustesRelacionamento): Promise<number> {
    await this.soltarPendentesAntigos(tenantId, dia, 'volta');
    const r = this.rows(
      await this.db.execute(sql`
        insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, unidade_id, dia, oferta, vence_em)
        select ${tenantId}::uuid, 'volta', q.chave, q.referencia, q.telefone, q.cliente_id, q.unidade_id, ${dia}::date, true, q.ultimo_pedido_em
          from (${this.candidatosVolta(tenantId, a)}) q
         order by q.ultimo_pedido_em desc
         limit ${this.vagasSql(tenantId, dia, a)}
        on conflict (tenant_id, tipo, chave_telefone, referencia) do nothing
        returning id`),
    );
    return r.length;
  }

  /** Separa os aniversariantes do dia (uma vez por ano por telefone — a referência é o ano). */
  async separarAniversario(tenantId: string, dia: string, a: AjustesRelacionamento): Promise<number> {
    await this.soltarPendentesAntigos(tenantId, dia, 'aniversario');
    const r = this.rows(
      await this.db.execute(sql`
        insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, cliente_id, unidade_id, dia, oferta, vence_em)
        select ${tenantId}::uuid, 'aniversario', q.chave, q.referencia, q.telefone, q.cliente_id, q.unidade_id, ${dia}::date, true,
               (q.aniversario::timestamp + interval '12 hours') at time zone ${FUSO_SQL}
          from (${this.candidatosAniversario(tenantId, dia, a)}) q
         order by q.aniversario asc
         limit ${this.vagasSql(tenantId, dia, a)}
        on conflict (tenant_id, tipo, chave_telefone, referencia) do nothing
        returning id`),
    );
    return r.length;
  }

  /**
   * Manda o que foi separado para o dia: marca como enviado ANTES de mandar (`for update skip locked` — dois servidores
   * nunca pegam a mesma linha); confere de novo o que pode ter mudado; falha volta como `falha`, com o motivo.
   */
  async mandar(tenantId: string, dia: string, a: AjustesRelacionamento, pronto: Prontidao, tipo: Tipo = 'cashback'): Promise<number> {
    // A ordem: quem vence antes (cashback, aniversário); no "sentimos sua falta", quem sumiu há MENOS tempo (o `vence_em`
    // dele é o último pedido).
    const recente = tipo === 'volta';
    const lote = this.rows(
      await this.db.execute(sql`
        update relacionamento_envio set status = 'enviado', enviado_em = now()
         where id in (select id from relacionamento_envio
                       where tenant_id = ${tenantId}::uuid and tipo = ${tipo} and dia = ${dia}::date and status = 'pendente'
                       order by ${recente ? sql`vence_em desc nulls last` : sql`vence_em asc nulls last`}, criado_em asc
                       limit ${POR_MINUTO[pronto.provedor]} for update skip locked)
        returning *`),
    ).sort(
      // o `returning` não garante a ordem
      (x, y) =>
        (new Date(x.vence_em ?? 0).getTime() - new Date(y.vence_em ?? 0).getTime()) * (recente ? -1 : 1) ||
        new Date(x.criado_em).getTime() - new Date(y.criado_em).getTime(),
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
        if (e.oferta && (await this.ofertaRecente(tenantId, e, a))) {
          await fora(`recebeu outra oferta nos últimos ${a.intervaloOfertasDias} dias`);
          continue;
        }
        const ok =
          tipo === 'cashback'
            ? await this.mandarCashback(tenantId, e, a, pronto, fora)
            : tipo === 'volta'
              ? await this.mandarVolta(tenantId, e, a, pronto, fora)
              : await this.mandarAniversario(tenantId, dia, e, a, pronto, fora);
        if (ok) enviados += 1;
      } catch (err: any) {
        const motivo = String(err?.message ?? err).slice(0, 300);
        await this.db.execute(sql`update relacionamento_envio set status = 'falha', motivo = ${motivo} where id = ${e.id}::uuid`);
        this.logger.warn(`automática ${tipo} (empresa ${tenantId}, envio ${e.id}) não saiu: ${motivo}`);
      }
    }
    return enviados;
  }

  private numeroParaMandar(telefone: string): string {
    const tel = String(telefone).replace(/\D/g, '');
    return tel.length === 10 || tel.length === 11 ? `55${tel}` : tel;
  }

  private async nomeDoCliente(clienteId: string | null): Promise<string> {
    if (!clienteId) return '';
    return String(this.rows(await this.db.execute(sql`select nome from cliente where id = ${clienteId}::uuid`))[0]?.nome ?? '');
  }

  /** O aviso do cashback: o saldo de agora (usou ou ganhou de novo → não manda) e o modelo de utilidade ou o texto do QR. */
  private async mandarCashback(tenantId: string, e: any, a: AjustesRelacionamento, pronto: Prontidao, fora: (m: string) => Promise<unknown>): Promise<boolean> {
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
      return false;
    }
    if (s.referencia !== e.referencia) {
      await fora('o vencimento mudou');
      return false;
    }
    const nome = await this.nomeDoCliente(e.cliente_id ?? null);
    const numero = this.numeroParaMandar(e.telefone);
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
    return true;
  }

  /**
   * Os parabéns: confere de novo a PROTEÇÃO (a data pode ter mudado; o presente dos 12 meses), cria o cupom PESSOAL (só
   * agora — envio que não sai não deixa cupom), manda e marca o presente. Falhou o envio: o cupom fica desligado.
   */
  private async mandarAniversario(tenantId: string, dia: string, e: any, a: AjustesRelacionamento, pronto: Prontidao, fora: (m: string) => Promise<unknown>): Promise<boolean> {
    const [ca] = this.rows(
      await this.db.execute(sql`select dia, mes, informado_em, ultimo_presente_em from cliente_aniversario where cliente_id = ${e.cliente_id}::uuid`),
    );
    const { desde, ate } = this.janelaAniversario(dia, a);
    const ocorrencia = aniversarioValendoEntre(ca ? { dia: ca.dia, mes: ca.mes, informadoEm: ca.informado_em } : null, desde, ate);
    if (!ocorrencia || ocorrencia.slice(0, 4) !== e.referencia) {
      await fora('a data mudou');
      return false;
    }
    const comPresente = a.aniversarioPresente === 'cupom';
    if (comPresente && ca.ultimo_presente_em && new Date(ca.ultimo_presente_em).getTime() > Date.now() - 365 * 86_400_000) {
      await fora('já ganhou presente nos últimos 12 meses');
      return false;
    }
    const nome = await this.nomeDoCliente(e.cliente_id ?? null);
    const numero = this.numeroParaMandar(e.telefone);
    let cupom: { id: string; codigo: string; descricao: string; ate: string } | null = null;
    if (comPresente)
      cupom = await this.criarCupomPessoal(tenantId, e, nome, {
        prefixo: 'NIVER',
        origem: 'aniversario',
        rotulo: 'Aniversário',
        desconto: a.aniversarioDesconto,
        minimo: a.aniversarioMinimo,
        validadeDias: a.aniversarioValidadeDias,
      });
    try {
      if (pronto.provedor === 'cloud') {
        if (cupom)
          await this.cloud.enviarTemplate(tenantId, numero, MODELO_ANIV_PRESENTE, 'pt_BR', [primeiroNome(nome) || 'cliente', cupom.descricao, dataCurta(`${cupom.ate}T15:00:00Z`)], {
            envioId: String(e.id),
            cupom: cupom.codigo,
            phoneId: pronto.phoneId ?? undefined,
          });
        else
          await this.cloud.enviarTemplate(tenantId, numero, MODELO_ANIV_PARABENS, 'pt_BR', [primeiroNome(nome) || 'cliente'], {
            envioId: String(e.id),
            phoneId: pronto.phoneId ?? undefined,
          });
      } else {
        const loja = await this.nomeDaLoja(tenantId, e.unidade_id ?? null);
        const texto = textoAniversarioQr({
          nome,
          loja,
          link: `${PUB()}/publico/relacionamento/r/${e.id}`,
          presente: cupom ? { descricao: cupom.descricao, ate: cupom.ate, cupom: cupom.codigo } : null,
        });
        await this.whatsapp.enviarPorInstancia(tenantId, String(pronto.instancia), numero, texto);
      }
    } catch (err) {
      if (cupom) await this.db.execute(sql`update cupom set ativo = false where id = ${cupom.id}::uuid`);
      throw err;
    }
    if (comPresente)
      await this.db.execute(sql`update cliente_aniversario set ultimo_presente_em = now(), atualizado_em = now() where cliente_id = ${e.cliente_id}::uuid`);
    if (cupom) await this.db.execute(sql`update relacionamento_envio set cupom_id = ${cupom.id}::uuid where id = ${e.id}::uuid`);
    return true;
  }

  /**
   * O "sentimos sua falta": confere de novo (pediu depois de separado? caso aberto?), cria o cupom PESSOAL (só agora),
   * manda. Falhou o envio: o cupom fica desligado.
   */
  private async mandarVolta(tenantId: string, e: any, a: AjustesRelacionamento, pronto: Prontidao, fora: (m: string) => Promise<unknown>): Promise<boolean> {
    const [c] = this.rows(
      await this.db.execute(sql`
        select to_char((ultimo_pedido_em at time zone ${FUSO_SQL})::date, 'YYYY-MM-DD') as dia_pedido, nome from cliente where id = ${e.cliente_id}::uuid`),
    );
    if (!c || !String(e.referencia).startsWith(`${c.dia_pedido}#`)) {
      await fora('voltou a pedir');
      return false;
    }
    const [caso] = this.rows(
      await this.db.execute(sql`
        select 1 from atendimento_chamado ac where ac.tenant_id = ${tenantId}::uuid and ac.status <> 'resolvido'
           and ${sqlChaveTelefone(sql`ac.telefone`)} = ${e.chave_telefone} limit 1`),
    );
    if (caso) {
      await fora('caso aberto no Atendimento');
      return false;
    }
    const nome = String(c.nome ?? '');
    const numero = this.numeroParaMandar(e.telefone);
    const cupom =
      a.voltaPresente === 'cupom'
        ? await this.criarCupomPessoal(tenantId, e, nome, {
            prefixo: 'VOLTA',
            origem: 'volta',
            rotulo: 'Sentimos sua falta',
            desconto: a.voltaDesconto,
            minimo: a.voltaMinimo,
            validadeDias: a.voltaValidadeDias,
          })
        : null;
    try {
      if (pronto.provedor === 'cloud') {
        if (cupom)
          await this.cloud.enviarTemplate(tenantId, numero, MODELO_VOLTA_CUPOM, 'pt_BR', [primeiroNome(nome) || 'cliente', cupom.descricao, dataCurta(`${cupom.ate}T15:00:00Z`)], {
            envioId: String(e.id),
            cupom: cupom.codigo,
            phoneId: pronto.phoneId ?? undefined,
          });
        else
          await this.cloud.enviarTemplate(tenantId, numero, MODELO_VOLTA_LEMBRETE, 'pt_BR', [primeiroNome(nome) || 'cliente'], {
            envioId: String(e.id),
            phoneId: pronto.phoneId ?? undefined,
          });
      } else {
        const loja = await this.nomeDaLoja(tenantId, e.unidade_id ?? null);
        const texto = textoVoltaQr({
          nome,
          loja,
          link: `${PUB()}/publico/relacionamento/r/${e.id}`,
          presente: cupom ? { descricao: cupom.descricao, ate: cupom.ate, cupom: cupom.codigo } : null,
        });
        await this.whatsapp.enviarPorInstancia(tenantId, String(pronto.instancia), numero, texto);
      }
    } catch (err) {
      if (cupom) await this.db.execute(sql`update cupom set ativo = false where id = ${cupom.id}::uuid`);
      throw err;
    }
    if (cupom) await this.db.execute(sql`update relacionamento_envio set cupom_id = ${cupom.id}::uuid where id = ${e.id}::uuid`);
    return true;
  }

  /**
   * O cupom PESSOAL do presente: uso único, só do cliente (a regra em `cupom_regra`), com o desconto, o mínimo e a validade
   * dos ajustes. O código é sorteado; repetido (índice único da empresa), sorteia de novo.
   */
  private async criarCupomPessoal(
    tenantId: string,
    e: any,
    nome: string,
    o: { prefixo: string; origem: 'aniversario' | 'volta'; rotulo: string; desconto: AnivDesconto | VoltaDesconto; minimo: number; validadeDias: number },
  ) {
    const { tipo, valor } = cupomDoDesconto(o.desconto);
    const ate = validadeDoPresente(o.validadeDias);
    const minimo = o.minimo > 0 ? o.minimo : null;
    for (let tentativa = 0; tentativa < 6; tentativa += 1) {
      const codigo = codigoDoCupom(o.prefixo);
      try {
        const [c] = this.rows(
          await this.db.execute(sql`
            insert into cupom (tenant_id, codigo, tipo, valor, minimo, ativo, validade, valido_de, max_usos, max_por_cliente, nome)
            values (${tenantId}::uuid, ${codigo}, ${tipo}, ${String(valor)}, ${minimo === null ? null : String(minimo)}, true,
                    ${ate}::date, ${dataNoFuso(new Date())}::date, 1, 1, ${`${o.rotulo} · ${nomeCurto(nome)}`})
            returning id`),
        );
        await this.db.execute(sql`
          insert into cupom_regra (cupom_id, tenant_id, cliente_id, chave_telefone, origem, relacionamento_envio_id)
          values (${c.id}::uuid, ${tenantId}::uuid, ${e.cliente_id}::uuid, ${e.chave_telefone}, ${o.origem}, ${e.id}::uuid)`);
        return { id: String(c.id), codigo, descricao: descricaoDoCupom(tipo, valor, minimo ?? 0), ate };
      } catch (err: any) {
        if (err?.code === '23505' || /duplicate key/i.test(String(err?.message))) continue;
        throw err;
      }
    }
    throw new Error('não consegui sortear um código de cupom livre');
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
   * O botão do WhatsApp (e o link do QR): marca o clique (uma vez) e devolve o endereço no cardápio da loja do envio — o
   * cashback em Sua conta › Benefícios; o presente com o cupom já aplicado (`?cupom=`); sem cupom, o cardápio. Envio
   * desconhecido (o exemplo que a Meta abre na análise): o endereço do app.
   */
  async destinoDoClique(id: string): Promise<string> {
    if (!UUID.test(String(id ?? ''))) return APP();
    const r = this.rows(
      await this.db.execute(sql`
        update relacionamento_envio set clicou_em = coalesce(clicou_em, now())
         where id = ${id}::uuid
        returning tenant_id, unidade_id, tipo, cupom_id`),
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
    if (!cfg?.token) return APP();
    if (r[0].tipo === 'cashback') return `${APP()}/c/${cfg.token}?conta=beneficios`;
    if (r[0].cupom_id) {
      const [c] = this.rows(await this.db.execute(sql`select codigo from cupom where id = ${r[0].cupom_id}::uuid`));
      if (c?.codigo) return `${APP()}/c/${cfg.token}?cupom=${encodeURIComponent(String(c.codigo))}`;
    }
    return `${APP()}/c/${cfg.token}`;
  }
}

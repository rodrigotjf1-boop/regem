import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO } from '../../common/data';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { LicencaService } from '../licenca/licenca.service';
import { IDEMPOTENCIA_HORAS } from './carimbador-integracao.service';
import {
  cupomDoContrato,
  decidirCupom,
  FotoCupom,
  sqlCupons,
  usoDoContrato,
  validarCriacaoCupom,
} from './cupom-integracao';
import { codificarCursor, lerCursor, lerInstante, lerLimite, vinculoCursor } from './cursor-integracao';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { corpoProblema, ProblemaException } from './problema';
import { sqlIso, textoCanonico } from './venda-integracao';
import { ATRASO_LEITURA_SEG } from './vendas-integracao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CUPONS da API de integração (trilha C, C1c — PR3; contrato de cupons v1 do Liame, §3).
//
// LEITURA (`GET /cupons`, `GET /cupons/usos`): só a tabela de versões (mig 296/298) — índice +
// foto publicada, como as vendas. Empresa e loja vêm SEMPRE do token:
//   • cupom (configuração): os da loja do token e os sem loja (valem para a empresa inteira);
//     empresa de UMA loja → todos os dela;
//   • uso (transacional, a loja é a do PEDIDO): empresa com várias lojas → só a loja do token;
//     empresa de uma loja → todos (entra o pedido sem loja do cardápio da rede), como as vendas.
//
// ESCRITA (`POST /cupons`, `POST /cupons/{id}/desativar`), só com `cupons.criar`:
//   • `Idempotency-Key` obrigatória (até 24 h): a chave é reservada e a resposta gravada na MESMA
//     transação da escrita. Mesma chave e mesmo corpo → a MESMA resposta (LIC-042), inclusive
//     404/409/422; outro corpo ou outra rota → 422 `chave-reutilizada`; a mesma chave ainda em
//     curso (a outra transação não terminou em 3 s) → 409 `chave-em-uso`;
//   • criar NUNCA atualiza um cupom existente: o código repetido cai no índice único
//     (`uq_cupom_tenant_codigo`) → 409 `codigo-em-uso` (V24) — a tela do Regem faz "upsert" pelo
//     código (achado A7); aqui não;
//   • desativar vale só para o cupom que a integração criou (marca `integracao_cupom`; decisão do
//     dono) e visível para a loja do token; o resto → 404 (contrato §3.4);
//   • conta da empresa bloqueada (licença) → 403 `conta-bloqueada` na escrita nova (o
//     `LicenseInterceptor` só olha usuário logado, e a integração não tem); o REENVIO de uma
//     escrita que já aconteceu devolve a resposta dela;
//   • a versão do cupom é publicada na própria transação (a resposta 201/200 é exatamente o que a
//     leitura vai mostrar), com a trava da versão tomada ANTES de ler o cupom;
//   • auditoria na trilha da EMPRESA (`actor_tipo` `integracao`), depois do commit, nunca com o
//     token (só o prefixo), e só na primeira execução.
// O cupom criado DESCE para a loja pelo sync de sempre (`cupom` desce, mig 272); a desativação
// também (o gatilho `trg_bump_updated_at` carimba o `updated_at`).

/** Tempo esperando a mesma chave em curso antes do 409 `chave-em-uso`. */
const ESPERA_CHAVE_MS = 3000;
const TTL_LICENCA_MS = 60_000;
const MAX_CACHE = 5_000;
/** Margem do filtro `desde` sobre o carimbo (o mesmo das vendas). */
const MARGEM_CARIMBO_DIAS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Consulta = { cursor?: unknown; limite?: unknown; desde?: unknown };

/** Resultado de uma escrita: a resposta (nova ou a guardada) e se foi reenvio. */
export type ResultadoEscrita = { status: number; corpo: any; replay: boolean };
type Execucao = { status: number; corpo: any; depois?: () => Promise<void> };
type CupomPublicado = { id: string; versao: string; atualizado_em: string; situacao: string | null; foto: FotoCupom };

/** `Idempotency-Key`: de 1 a 255 caracteres visíveis (ASCII 33 a 126), sem espaço. */
export function lerChaveIdempotencia(v: unknown): string {
  const k = Array.isArray(v) ? v[0] : v;
  const ok =
    typeof k === 'string' &&
    k.length >= 1 &&
    k.length <= 255 &&
    [...k].every((ch) => ch.charCodeAt(0) >= 33 && ch.charCodeAt(0) <= 126);
  if (!ok) {
    throw new ProblemaException(
      400,
      'parametro-invalido',
      'Cabeçalho Idempotency-Key obrigatório nesta rota: de 1 a 255 caracteres visíveis, sem espaço.',
    );
  }
  return k as string;
}

/** Hash do pedido (método, caminho e corpo canônico — a ordem das chaves não importa). */
export function hashPedidoIntegracao(metodo: string, caminho: string, corpo: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([metodo, caminho, textoCanonico(corpo ?? {})]), 'utf8')
    .digest('hex');
}

const chaveEmUso = () =>
  new ProblemaException(
    409,
    'chave-em-uso',
    'Esta Idempotency-Key está num pedido que ainda não terminou: tente de novo em instantes.',
  );

@Injectable()
export class CuponsIntegracaoService {
  private readonly log = new Logger('IntegracaoCupons');
  /** Atraso aplicado nesta instância (os testes encurtam; em produção é o das vendas: 15 s). */
  atrasoSeg = ATRASO_LEITURA_SEG;
  /** Espera pela mesma chave em curso (os testes encurtam). */
  esperaChaveMs = ESPERA_CHAVE_MS;
  private readonly licencas = new Map<string, { em: number; ativa: boolean }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  // ───────────────────────────── GET /integracao/cupons ─────────────────────────────

  async cupons(ctx: IntegracaoCtxData, q: Consulta) {
    const limite = lerLimite(q.limite);
    const vinculo = vinculoCursor(ctx.tenantId, ctx.unidadeId);
    const temCursor = q.cursor !== undefined && q.cursor !== '';
    const cur = temCursor ? lerCursor(q.cursor, 'cupom', vinculo) : { posicao: null, desde: null };
    const linhas = this.rows(
      await this.db.execute(sql`
        select v.recurso_id::text as id, v.versao::text as versao, ${sqlIso(sql`v.atualizado_em`)} as atualizado_em,
               v.situacao, v.foto
          from integracao_versao v
         where v.tenant_id = ${ctx.tenantId}::uuid and v.recurso = 'cupom'
           and v.atualizado_em is not null
           and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
           ${ctx.lojaUnica ? sql`` : sql`and (v.unidade_id = ${ctx.unidadeId}::uuid or v.unidade_id is null)`}
           ${
             cur.posicao
               ? sql`and (v.atualizado_em, v.recurso_id) > (${cur.posicao.t}::timestamptz, ${cur.posicao.i}::uuid)`
               : sql``
           }
         order by v.atualizado_em, v.recurso_id
         limit ${limite + 1}`),
    );
    const pagina = linhas.slice(0, limite);
    const ultimo = pagina[pagina.length - 1];
    return {
      itens: pagina.map((l) => cupomDoContrato(l)),
      proximo_cursor: codificarCursor('cupom', vinculo, {
        posicao: ultimo ? { t: ultimo.atualizado_em, i: ultimo.id } : cur.posicao,
        desde: null,
      }),
      tem_mais: linhas.length > limite,
    };
  }

  // ───────────────────────────── GET /integracao/cupons/usos ─────────────────────────────

  async usos(ctx: IntegracaoCtxData, q: Consulta) {
    const limite = lerLimite(q.limite);
    const vinculo = vinculoCursor(ctx.tenantId, ctx.unidadeId);
    const temCursor = q.cursor !== undefined && q.cursor !== '';
    const cur = temCursor ? lerCursor(q.cursor, 'uso', vinculo) : { posicao: null, desde: null };
    let desde = cur.desde;
    if (q.desde !== undefined && q.desde !== '') {
      const d = lerInstante(q.desde, 'desde');
      if (temCursor && d !== cur.desde) {
        throw new ProblemaException(
          400,
          'parametro-invalido',
          '"desde" vale só na primeira página (sem cursor): depois ele segue dentro do cursor.',
        );
      }
      desde = d;
    }
    const linhas = this.rows(
      await this.db.execute(sql`
        select v.recurso_id::text as id, v.versao::text as versao, ${sqlIso(sql`v.atualizado_em`)} as atualizado_em,
               v.situacao, v.foto
          from integracao_versao v
         where v.tenant_id = ${ctx.tenantId}::uuid and v.recurso = 'cupom_uso'
           and v.atualizado_em is not null
           and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
           ${ctx.lojaUnica ? sql`` : sql`and v.unidade_id = ${ctx.unidadeId}::uuid`}
           ${
             cur.posicao
               ? sql`and (v.atualizado_em, v.recurso_id) > (${cur.posicao.t}::timestamptz, ${cur.posicao.i}::uuid)`
               : sql``
           }
           ${
             desde
               ? sql`and v.confirmado_em >= ${desde}::timestamptz
                     and v.atualizado_em >= ${desde}::timestamptz - make_interval(days => ${MARGEM_CARIMBO_DIAS})`
               : sql``
           }
         order by v.atualizado_em, v.recurso_id
         limit ${limite + 1}`),
    );
    const pagina = linhas.slice(0, limite);
    const ultimo = pagina[pagina.length - 1];
    return {
      itens: pagina.map((l) => usoDoContrato(l)),
      proximo_cursor: codificarCursor('uso', vinculo, {
        posicao: ultimo ? { t: ultimo.atualizado_em, i: ultimo.id } : cur.posicao,
        desde,
      }),
      tem_mais: linhas.length > limite,
    };
  }

  // ───────────────────────────── POST /integracao/cupons ─────────────────────────────

  async criar(ctx: IntegracaoCtxData, chaveBruta: unknown, corpo: unknown): Promise<ResultadoEscrita> {
    return this.escreverIdempotente(
      ctx,
      chaveBruta,
      { modelo: 'POST /cupons', caminho: '/integracao/cupons' },
      corpo,
      async (tx, chave) => {
        const v = validarCriacaoCupom(corpo, hojeISO());
        if (!v.ok) return { status: 422, corpo: corpoProblema(422, 'regra-invalida', `Regra inválida — ${v.erros.join('; ')}.`) };
        const c = v.cupom;
        let cupomId: string;
        try {
          // Em savepoint: o 23505 do código repetido não pode abortar a transação (a resposta 409
          // é gravada na chave de idempotência logo abaixo).
          const [novo] = this.rows(
            await tx.transaction((sp: any) =>
              sp.execute(sql`
                insert into cupom (tenant_id, unidade_id, codigo, nome, tipo, valor, teto_desconto, minimo, ativo,
                                   validade, valido_de, max_usos, somente_novos, max_por_cliente, min_dias_sem_compra)
                values (${ctx.tenantId}::uuid, ${ctx.unidadeId}::uuid, ${c.codigo}, ${c.nome}, ${c.tipo},
                        ${c.valor}::numeric, ${c.tetoDesconto}::numeric, ${c.minimo}::numeric, true,
                        ${c.validade}::date, ${c.validoDe}::date, ${c.maxUsos}::int, ${c.somenteNovos},
                        ${c.maxPorCliente}::int, ${c.minDiasSemCompra}::int)
                returning id::text as id`),
            ),
          );
          cupomId = novo.id;
        } catch (e: any) {
          const codigoErro = e?.code ?? e?.cause?.code;
          const restricao = e?.constraint ?? e?.cause?.constraint;
          if (codigoErro === '23505' && restricao === 'uq_cupom_tenant_codigo') {
            return {
              status: 409,
              corpo: corpoProblema(
                409,
                'codigo-em-uso',
                `O código ${c.codigo} já existe nesta empresa: o cupom existente não é alterado. Use outro código.`,
              ),
            };
          }
          throw e;
        }
        await tx.execute(sql`
          insert into integracao_cupom (cupom_id, tenant_id, unidade_id, cliente, token_id, chave)
          values (${cupomId}::uuid, ${ctx.tenantId}::uuid, ${ctx.unidadeId}::uuid, ${ctx.cliente}, ${ctx.tokenId}::uuid, ${chave})`);
        const publicado = await this.publicarCupomAgora(tx, ctx.tenantId, cupomId);
        return {
          status: 201,
          corpo: cupomDoContrato(publicado),
          depois: () =>
            this.auditoria.registrar({
              tenantId: ctx.tenantId,
              unidadeId: ctx.unidadeId,
              atorTipo: 'integracao',
              tipo: 'integracao',
              acao: 'integracao.cupom_criado',
              origem: 'integracao',
              entidadeTipo: 'cupom',
              entidadeId: cupomId,
              detalhe: {
                cliente: ctx.cliente,
                prefixo: ctx.prefixo,
                tokenId: ctx.tokenId,
                codigo: publicado.foto.codigo,
                tipo: publicado.foto.tipo,
                idempotencia: chave,
              },
            }),
        };
      },
    );
  }

  // ───────────────────────────── POST /integracao/cupons/{id}/desativar ─────────────────────────────

  async desativar(ctx: IntegracaoCtxData, chaveBruta: unknown, idBruto: string, corpo: unknown): Promise<ResultadoEscrita> {
    const id = UUID.test(String(idBruto ?? '')) ? String(idBruto).toLowerCase() : String(idBruto ?? '');
    return this.escreverIdempotente(
      ctx,
      chaveBruta,
      { modelo: 'POST /cupons/{id}/desativar', caminho: `/integracao/cupons/${id}/desativar` },
      corpo,
      async (tx, chave) => {
        const naoEncontrado = {
          status: 404,
          corpo: corpoProblema(404, 'nao-encontrado', 'Cupom não encontrado entre os criados por esta integração nesta loja.'),
        };
        if (!UUID.test(id)) return naoEncontrado;
        // Só o cupom que ESTA integração criou (a marca), da empresa do token e visível para a loja
        // dele. Trava a linha do cupom: dois "desativar" juntos passam um de cada vez.
        const [c] = this.rows(
          await tx.execute(sql`
            select c.id::text as id, c.ativo
              from cupom c
              join integracao_cupom ic on ic.cupom_id = c.id and ic.tenant_id = c.tenant_id and ic.cliente = ${ctx.cliente}
             where c.id = ${id}::uuid and c.tenant_id = ${ctx.tenantId}::uuid
               ${ctx.lojaUnica ? sql`` : sql`and (c.unidade_id = ${ctx.unidadeId}::uuid or c.unidade_id is null)`}
             for update of c`),
        );
        if (!c) return naoEncontrado;
        const mudou = c.ativo === true;
        if (mudou) {
          await tx.execute(sql`update cupom set ativo = false where id = ${id}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
        }
        const publicado = await this.publicarCupomAgora(tx, ctx.tenantId, id);
        return {
          status: 200,
          corpo: cupomDoContrato(publicado),
          depois: mudou
            ? () =>
                this.auditoria.registrar({
                  tenantId: ctx.tenantId,
                  unidadeId: ctx.unidadeId,
                  atorTipo: 'integracao',
                  tipo: 'integracao',
                  acao: 'integracao.cupom_desativado',
                  origem: 'integracao',
                  entidadeTipo: 'cupom',
                  entidadeId: id,
                  detalhe: {
                    cliente: ctx.cliente,
                    prefixo: ctx.prefixo,
                    tokenId: ctx.tokenId,
                    codigo: publicado.foto.codigo,
                    idempotencia: chave,
                  },
                })
            : undefined,
        };
      },
    );
  }

  // ───────────────────────────── escrita idempotente ─────────────────────────────

  private async escreverIdempotente(
    ctx: IntegracaoCtxData,
    chaveBruta: unknown,
    rota: { modelo: string; caminho: string },
    corpo: unknown,
    executar: (tx: any, chave: string) => Promise<Execucao>,
  ): Promise<ResultadoEscrita> {
    const chave = lerChaveIdempotencia(chaveBruta);
    const hash = hashPedidoIntegracao('POST', rota.caminho, corpo);
    // Licença: a escrita NOVA de empresa bloqueada não entra; o reenvio de uma que já aconteceu
    // devolve a resposta guardada (o cupom existe — dizer "bloqueado" faria o Liame achar que não).
    if (!(await this.contaAtiva(ctx.tenantId))) {
      const g = await this.respostaGuardada(ctx, chave);
      if (g && g.hash_corpo === hash && g.status_http) return { status: Number(g.status_http), corpo: g.resposta, replay: true };
      throw new ProblemaException(
        403,
        'conta-bloqueada',
        'A conta desta empresa no Regem está bloqueada (teste ou assinatura vencida): a integração não cria nem desativa cupons até ela ser reativada.',
      );
    }

    let depois: (() => Promise<void>) | undefined;
    const r = await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`select set_config('statement_timeout', '15s', true)`);
      await tx.execute(sql`select set_config('lock_timeout', ${`${this.esperaChaveMs}ms`}, true)`);
      let reservou = false;
      try {
        // A chave vencida (mais de 24 h) sai antes: depois disso a mesma chave vale de novo.
        await tx.execute(sql`
          delete from integracao_idempotencia
           where tenant_id = ${ctx.tenantId}::uuid and unidade_id = ${ctx.unidadeId}::uuid
             and cliente = ${ctx.cliente} and chave = ${chave}
             and criado_em < now() - make_interval(hours => ${IDEMPOTENCIA_HORAS})`);
        // Reserva: com a mesma chave numa transação que ainda não terminou, este insert ESPERA por
        // ela (índice da chave primária) — até `lock_timeout`; ela confirma → conflito → reenvio.
        const ins = this.rows(
          await tx.execute(sql`
            insert into integracao_idempotencia (tenant_id, unidade_id, cliente, chave, token_id, rota, hash_corpo)
            values (${ctx.tenantId}::uuid, ${ctx.unidadeId}::uuid, ${ctx.cliente}, ${chave}, ${ctx.tokenId}::uuid,
                    ${rota.modelo}, ${hash})
            on conflict (tenant_id, unidade_id, cliente, chave) do nothing
            returning 1 as ok`),
        );
        reservou = ins.length === 1;
      } catch (e: any) {
        if ((e?.code ?? e?.cause?.code) === '55P03') throw chaveEmUso();
        throw e;
      }
      if (!reservou) {
        const [g] = this.rows(
          await tx.execute(sql`
            select hash_corpo, status_http, resposta from integracao_idempotencia
             where tenant_id = ${ctx.tenantId}::uuid and unidade_id = ${ctx.unidadeId}::uuid
               and cliente = ${ctx.cliente} and chave = ${chave}`),
        );
        if (!g || g.status_http === null || g.status_http === undefined) throw chaveEmUso();
        if (g.hash_corpo !== hash) {
          throw new ProblemaException(
            422,
            'chave-reutilizada',
            'Esta Idempotency-Key já foi usada nas últimas 24 h com outro pedido (outro corpo ou outra rota): gere uma chave nova.',
          );
        }
        return { status: Number(g.status_http), corpo: g.resposta, replay: true };
      }
      // Daqui em diante, a espera normal por trava (ex.: o mesmo código criado ao mesmo tempo).
      await tx.execute(sql`select set_config('lock_timeout', '10s', true)`);
      const x = await executar(tx, chave);
      await tx.execute(sql`
        update integracao_idempotencia set status_http = ${x.status}, resposta = ${JSON.stringify(x.corpo)}::jsonb
         where tenant_id = ${ctx.tenantId}::uuid and unidade_id = ${ctx.unidadeId}::uuid
           and cliente = ${ctx.cliente} and chave = ${chave}`);
      depois = x.depois;
      return { status: x.status, corpo: x.corpo, replay: false };
    });
    // Depois do commit (a auditoria roda na transação dela e nunca derruba a operação).
    if (depois) await depois();
    return r;
  }

  private async respostaGuardada(ctx: IntegracaoCtxData, chave: string): Promise<any | null> {
    const [g] = this.rows(
      await this.db.execute(sql`
        select hash_corpo, status_http, resposta from integracao_idempotencia
         where tenant_id = ${ctx.tenantId}::uuid and unidade_id = ${ctx.unidadeId}::uuid
           and cliente = ${ctx.cliente} and chave = ${chave}
           and criado_em >= now() - make_interval(hours => ${IDEMPOTENCIA_HORAS})`),
    );
    return g ?? null;
  }

  /**
   * A conta da empresa está ativa? A MESMA regra do `LicenseInterceptor` (`statusConta`, cache de
   * 60 s por empresa, e falha na consulta não bloqueia — com log).
   */
  private async contaAtiva(tenantId: string): Promise<boolean> {
    const agora = Date.now();
    const c = this.licencas.get(tenantId);
    if (c && agora - c.em < TTL_LICENCA_MS) return c.ativa;
    let ativa = true;
    try {
      const licenca = this.moduleRef.get(LicencaService, { strict: false });
      ativa = !!(await licenca.statusConta(tenantId)).ativa;
    } catch (e: any) {
      this.log.warn(`licença da empresa ${tenantId} não consultada (${e?.message ?? e}) — a escrita segue liberada`);
    }
    if (this.licencas.size > MAX_CACHE) this.licencas.clear();
    this.licencas.set(tenantId, { em: agora, ativa });
    return ativa;
  }

  /**
   * Publica a versão do cupom na transação da escrita — a MESMA regra do carimbador
   * (`decidirCupom`). A trava da linha de versão vem ANTES de ler o cupom: um uso gravado ao mesmo
   * tempo espera esta transação e entra depois pela fila (a versão nunca fica "em dia" sem ele).
   * O carimbo (`clock_timestamp()`) é a última coisa antes da resposta e do commit.
   */
  private async publicarCupomAgora(tx: any, tenantId: string, cupomId: string): Promise<CupomPublicado> {
    await tx.execute(sql`
      insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, pendente, mudou_em)
      values ('cupom', ${cupomId}::uuid, ${tenantId}::uuid, 'cupom', false, clock_timestamp())
      on conflict (recurso, recurso_id) do nothing`);
    const [v] = this.rows(
      await tx.execute(sql`
        select v.versao::text as versao, v.situacao, v.foto, v.unidade_id::text as unidade_id,
               (v.atualizado_em is not null) as publicada, ${sqlIso(sql`v.atualizado_em`)} as atualizado_em,
               ${sqlIso(sql`v.mudou_em`)} as mudou_em
          from integracao_versao v
         where v.recurso = 'cupom' and v.recurso_id = ${cupomId}::uuid
         for update`),
    );
    const [rep] = this.rows(await tx.execute(sqlCupons([cupomId])));
    const d = decidirCupom(
      {
        recurso: 'cupom',
        publicada: !!v?.publicada,
        situacao: v?.situacao ?? null,
        unidade_id: v?.unidade_id ?? null,
        foto: v?.foto ?? null,
        confirmado_em: null,
        mudou_em: v?.mudou_em ?? null,
      },
      rep,
      (m) => this.log.warn(m),
    );
    if (d.acao === 'publicar') {
      const [n] = this.rows(
        await tx.execute(sql`
          update integracao_versao
             set versao = coalesce(versao, 0) + 1, atualizado_em = clock_timestamp(), situacao = ${d.situacao},
                 unidade_id = ${d.unidade_id}::uuid, foto = ${JSON.stringify(d.foto)}::jsonb, pendente = false,
                 confirmado_em = null, removido_em = ${d.removido_em}::timestamptz, erro_em = null, erro = null
           where recurso = 'cupom' and recurso_id = ${cupomId}::uuid
          returning versao::text as versao, ${sqlIso(sql`atualizado_em`)} as atualizado_em`),
      );
      return { id: cupomId, versao: n.versao, atualizado_em: n.atualizado_em, situacao: d.situacao, foto: d.foto as FotoCupom };
    }
    if (d.acao === 'manter' && v?.publicada) {
      await tx.execute(sql`
        update integracao_versao set pendente = false, erro_em = null, erro = null
         where recurso = 'cupom' and recurso_id = ${cupomId}::uuid`);
      return { id: cupomId, versao: v.versao, atualizado_em: v.atualizado_em, situacao: v.situacao ?? null, foto: v.foto as FotoCupom };
    }
    throw new Error(`cupom ${cupomId} não pôde ser publicado (${d.acao === 'erro' ? d.erro : d.acao})`);
  }
}

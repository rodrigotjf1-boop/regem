import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { fetchExterno } from '../../common/fetch-externo';
import { ehServidorLocal } from '../../common/modo';
import {
  CAMINHO_PEDIDO_CANCELADO,
  DESISTIR_DEPOIS_DE_DIAS,
  DesfechoAviso,
  EstornoGogem,
  GOGEM_NUVEM_PADRAO,
  MSG_PENDENTE,
  RECUO_INTEGRACAO_MINUTOS,
  lerRespostaGogem,
  lerRetryAfter,
  recuoMinutos,
} from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O operador espera o cancelamento: a primeira tentativa tem prazo curto; passou, o job segue. */
export const PRAZO_ENVIO_IMEDIATO_MS = 8_000;
/** O job não tem ninguém esperando na frente. */
const PRAZO_ENVIO_FILA_MS = 15_000;
/** Reserva de um aviso em envio: se o processo morrer no meio, ele volta à fila sozinho. */
const RESERVA_MINUTOS = 2;

const MSG_SEM_TOKEN: EstornoGogem = {
  situacao: 'integracao_recusou',
  mensagem:
    'A integração com o GoGeM não tem token neste servidor — o estorno NÃO foi pedido. Confira a ' +
    'integração; o Regem tenta de novo a cada 6 h.',
};

/**
 * Envia os avisos da fila `aviso_integracao` ao GoGeM. O aviso é GRAVADO por quem cancela (na
 * mesma transação do cancelamento — `gravarAvisoCancelamentoTotem`); aqui ele sai: na hora, com
 * prazo curto, e depois pelo job, com recuo, até o GoGeM confirmar.
 *
 * Roda na loja e na nuvem, cada uma com a SUA fila (a tabela não sincroniza): o aviso sai da
 * máquina que cancelou.
 */
@Injectable()
export class GogemAvisoService {
  private readonly log = new Logger('AvisoGoGeM');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private url(): string {
    return (process.env.GOGEM_CLOUD_URL || GOGEM_NUVEM_PADRAO).replace(/\/$/, '') + CAMINHO_PEDIDO_CANCELADO;
  }

  /**
   * O token que o GoGeM reconhece — o da integração, o mesmo do "Publicar no GoGeM". No SERVIDOR
   * DA LOJA o `equipamento` servidor_local não existe (o sync nunca o baixa): o token é o
   * `SYNC_TOKEN` do próprio servidor. Na nuvem, o do `servidor_local` ativo do tenant.
   */
  async tokenDaIntegracao(tenantId: string): Promise<string | null> {
    if (ehServidorLocal()) return String(process.env.SYNC_TOKEN ?? '').trim() || null;
    const [srv] = await this.db
      .select({ token: equipamento.token })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'servidor_local'),
          eq(equipamento.ativo, true),
        ),
      )
      .limit(1);
    return srv?.token ?? null;
  }

  /**
   * Manda AGORA o aviso recém-gravado — o operador vê o resultado se ele vier a tempo. Nunca
   * lança: sem resposta no prazo, o aviso continua na fila e a mensagem diz isso.
   */
  async enviarAgora(avisoId: string, prazoMs = PRAZO_ENVIO_IMEDIATO_MS): Promise<EstornoGogem> {
    try {
      const [linha] = await this.reservar({ avisoId, limite: 1 });
      if (!linha) return await this.situacaoAtual(avisoId);
      return (await this.enviar(linha, prazoMs)).desfecho.paraOperador;
    } catch (e: any) {
      this.log.warn(`aviso ${avisoId}: envio imediato não aconteceu (${e?.message ?? e}) — segue na fila`);
      return { situacao: 'pendente', mensagem: MSG_PENDENTE };
    }
  }

  /**
   * O job: a cada minuto, manda o que está vencido na fila. Na loja e na nuvem — cada uma com a
   * fila dela.
   */
  @Cron('*/1 * * * *')
  async rodarFila(limite = 20) {
    let linhas: any[] = [];
    try {
      linhas = await this.reservar({ limite });
    } catch (e: any) {
      // Instalação sem a mig 289, ou banco fora: o job não pode derrubar nada.
      this.log.warn(`fila de avisos ao GoGeM não rodou: ${e?.message ?? e}`);
      return { enviados: 0, entregues: 0 };
    }
    let entregues = 0;
    let enviados = 0;
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      let limitado: { retryAfterS: number | null } | null = null;
      try {
        const r = await this.enviar(l, PRAZO_ENVIO_FILA_MS);
        enviados++;
        if (r.desfecho.status === 'entregue') entregues++;
        if (r.http === 429) limitado = { retryAfterS: r.retryAfterS };
      } catch (e: any) {
        this.log.warn(`aviso ${l.id} não foi processado: ${e?.message ?? e}`);
      }
      // 429: o GoGeM limita 120 requisições por minuto POR IP, e na nuvem os avisos de todas as
      // lojas saem do mesmo IP. Insistir no resto do lote só tomaria mais 429 — o lote PARA aqui
      // (mesmo que a devolução abaixo falhe: aí a reserva de 2 min os devolve sozinha).
      if (limitado) {
        await this.devolverAFila(linhas.slice(i + 1), limitado.retryAfterS).catch((e: any) =>
          this.log.warn(`avisos do lote não voltaram à fila agora (a reserva expira em ${RESERVA_MINUTOS} min): ${e?.message ?? e}`),
        );
        break;
      }
    }
    if (linhas.length) this.log.log(`avisos ao GoGeM: ${entregues} de ${enviados} entregue(s)`);
    return { enviados, entregues };
  }

  /**
   * Devolve à fila, SEM contar tentativa, avisos reservados que não chegaram a sair (o lote
   * parou num 429). Esperam o `Retry-After` — ou 1 minuto, se ele não veio.
   */
  private async devolverAFila(linhas: any[], retryAfterS: number | null) {
    if (!linhas.length) return;
    const segundos = Math.max(60, retryAfterS ?? 0);
    // Lista de valores por `sql.join` — array JS direto no template do Drizzle vira "malformed
    // array literal" (ver cliente.service.ts). Uma query só, para o lote inteiro.
    const valores = sql.join(
      linhas.map((l) => sql`(${l.id}::uuid, ${String(l.status_anterior ?? 'pendente')})`),
      sql`, `,
    );
    await this.db.execute(sql`
      update aviso_integracao a
         set status = case when v.anterior = 'aguardando_integracao' then 'aguardando_integracao' else 'pendente' end,
             tentativas = greatest(a.tentativas - 1, 0),
             proxima_tentativa_em = now() + make_interval(secs => ${segundos}),
             updated_at = now()
        from (values ${valores}) as v(id, anterior)
       where a.id = v.id and a.status = 'enviando'`);
    this.log.warn(`GoGeM pediu para esperar (429): ${linhas.length} aviso(s) de volta à fila por ${segundos} s`);
  }

  /**
   * RESERVA atômica: marca `enviando` e empurra a próxima tentativa para daqui a 2 min (se o
   * processo morrer no meio do envio, o aviso volta sozinho). `skip locked`: duas réplicas — ou o
   * envio imediato e o job — nunca pegam o mesmo aviso.
   */
  private async reservar(p: { avisoId?: string; limite: number }): Promise<any[]> {
    // `status_anterior`: a linha devolvida já está `enviando`, e é o estado de ANTES que diz se o
    // aviso acabou de entrar em "aguardando integração" (alerta uma vez) ou já estava nele.
    // `materialized` (LIC-069): embutida, a CTE com LIMIT pode ser reexecutada a cada linha do
    // UPDATE e reservar a fila inteira em vez de N — Postgres 12+ (a loja e a nuvem são 15+).
    const r: any = await this.db.execute(sql`
      with fila as materialized (
        select id, status as status_anterior from aviso_integracao
         where status in ('pendente', 'enviando', 'aguardando_integracao')
           and proxima_tentativa_em <= now()
           and ${p.avisoId ? sql`id = ${p.avisoId}::uuid` : sql`true`}
         order by proxima_tentativa_em
         limit ${p.limite}
         for update skip locked)
      update aviso_integracao a
         set status = 'enviando', tentativas = a.tentativas + 1,
             proxima_tentativa_em = now() + make_interval(mins => ${RESERVA_MINUTOS}), updated_at = now()
        from fila
       where a.id = fila.id
      returning a.*, fila.status_anterior`);
    return (r.rows ?? r) as any[];
  }

  /** O que o operador fica sabendo quando outro processo já pegou o aviso (ou ele já saiu). */
  private async situacaoAtual(avisoId: string): Promise<EstornoGogem> {
    const r: any = await this.db.execute(sql`
      select status, ultimo_status_http, ultima_resposta from aviso_integracao where id = ${avisoId}::uuid`);
    const l = (r.rows ?? r)[0];
    if (l?.status === 'entregue' || l?.status === 'recusado')
      return lerRespostaGogem(l.ultimo_status_http ?? null, l.ultima_resposta).paraOperador;
    if (l?.status === 'aguardando_integracao') return MSG_SEM_TOKEN;
    return { situacao: 'pendente', mensagem: MSG_PENDENTE };
  }

  /** Um envio: chama o GoGeM, lê a resposta, grava o desfecho e o que o operador precisa saber. */
  private async enviar(
    linha: any,
    prazoMs: number,
  ): Promise<{ desfecho: DesfechoAviso; http: number | null; retryAfterS: number | null }> {
    const tenantId = linha.tenant_id as string;
    const token = await this.tokenDaIntegracao(tenantId);
    if (!token) {
      const d: DesfechoAviso = { status: 'aguardando_integracao', estorno: null, paraOperador: MSG_SEM_TOKEN };
      await this.registrar(linha, d, null, null, 'sem token da integração neste servidor', null);
      return { desfecho: d, http: null, retryAfterS: null };
    }

    let http: number | null = null;
    let corpo: any = null;
    let erro: string | null = null;
    let retryAfterS: number | null = null;
    try {
      const res = await fetchExterno(
        this.url(),
        {
          method: 'POST',
          headers: { 'X-Sync-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(linha.corpo),
        },
        prazoMs,
      );
      http = res.status;
      retryAfterS = lerRetryAfter(res.headers.get('retry-after'));
      const texto = await res.text().catch(() => '');
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        corpo = { texto: texto.slice(0, 500) };
      }
    } catch (e: any) {
      erro = String(e?.message ?? e);
    }
    const d = lerRespostaGogem(http, corpo);
    await this.registrar(linha, d, http, corpo, erro, retryAfterS);
    return { desfecho: d, http, retryAfterS };
  }

  /** Grava o desfecho na fila e, quando é o fim da história (ou um alerta), na auditoria. */
  private async registrar(
    linha: any,
    d: DesfechoAviso,
    http: number | null,
    corpo: any,
    erro: string | null,
    retryAfterS: number | null,
  ) {
    const idadeDias = (Date.now() - new Date(linha.created_at).getTime()) / 86_400_000;
    let status: string = d.status;
    let ultimoErro = erro ?? (d.status === 'entregue' ? null : d.paraOperador.mensagem);
    // Tentou por dias e o GoGeM nunca confirmou: o aviso sai da fila GRITANDO — o estorno vira
    // manual, e isso tem de aparecer para alguém (log de erro + auditoria), não sumir.
    if ((status === 'pendente' || status === 'aguardando_integracao') && idadeDias >= DESISTIR_DEPOIS_DE_DIAS) {
      status = 'recusado';
      ultimoErro = `Sem confirmação do GoGeM em ${DESISTIR_DEPOIS_DE_DIAS} dias — estorno MANUAL. ${ultimoErro ?? ''}`.trim();
    }
    // Passageiro (rede, 408, 429, 5xx): o recuo da fila — ou o `Retry-After`, se o GoGeM pediu mais.
    const segundos =
      status === 'aguardando_integracao'
        ? RECUO_INTEGRACAO_MINUTOS * 60
        : status === 'pendente'
          ? Math.max(recuoMinutos(Number(linha.tentativas)) * 60, retryAfterS ?? 0)
          : 0;
    await this.db.execute(sql`
      update aviso_integracao
         set status = ${status},
             ultimo_status_http = ${http},
             ultima_resposta = ${corpo == null ? null : JSON.stringify(corpo)}::jsonb,
             ultimo_erro = ${ultimoErro ? String(ultimoErro).slice(0, 500) : null},
             proxima_tentativa_em = now() + make_interval(secs => ${segundos}),
             entregue_em = case when ${status} = 'entregue' then now() else entregue_em end,
             updated_at = now()
       where id = ${linha.id}::uuid`);

    const base = {
      chave: linha.chave,
      referencia: { tipo: linha.referencia_tipo, id: linha.referencia_id },
      tentativa: Number(linha.tentativas),
      http,
    };
    if (status === 'entregue') {
      this.log.log(
        `aviso ao GoGeM entregue (${linha.chave}): ${d.estorno ? `estorno ${d.estorno.feito ? 'feito' : 'não feito'} · ${d.estorno.meio}` : 'sem detalhe de estorno'}`,
      );
      await this.auditar(linha, 'aviso_gogem_entregue', { ...base, estorno: d.estorno, situacao: d.paraOperador.situacao });
    } else if (status === 'recusado') {
      this.log.error(`aviso ao GoGeM RECUSADO (${linha.chave}) — estorno manual: ${ultimoErro}`);
      await this.auditar(linha, 'aviso_gogem_recusado', { ...base, erro: ultimoErro, resposta: corpo });
    } else if (status === 'aguardando_integracao' && linha.status_anterior !== 'aguardando_integracao') {
      // Alerta UMA vez, na entrada neste estado — não a cada tentativa de 6 h.
      this.log.error(`integração GoGeM recusou/sem token (${linha.chave}) — estorno NÃO pedido: ${ultimoErro}`);
      await this.auditar(linha, 'aviso_gogem_integracao_recusou', { ...base, erro: ultimoErro });
    } else {
      this.log.warn(`aviso ao GoGeM sem confirmação (${linha.chave}), tentativa ${linha.tentativas}: ${ultimoErro}`);
    }
  }

  private async auditar(linha: any, acao: string, detalhe: Record<string, unknown>) {
    await this.auditoria
      .registrar({
        tenantId: linha.tenant_id,
        atorId: null,
        atorPerfil: 'servico',
        tipo: 'integracao',
        acao,
        entidadeTipo: linha.referencia_tipo ?? 'aviso_integracao',
        entidadeId: linha.referencia_id ?? linha.id,
        detalhe,
      })
      .catch((e: any) => this.log.warn(`auditoria do aviso ${linha.id} falhou: ${e?.message ?? e}`));
  }
}

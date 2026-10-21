import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { fetchExterno } from '../../common/fetch-externo';
import { causaDeRede } from '../../common/causa-de-rede';
import { ehServidorLocal } from '../../common/modo';
import { SyncCtxData } from '../sync/sync-token.guard';
import {
  CAMINHO_PEDIDO_CANCELADO,
  CAMINHO_REPASSE_DA_LOJA,
  DESISTIR_DEPOIS_DE_DIAS,
  DESTINO_GOGEM,
  DesfechoAviso,
  EstornoGogem,
  GOGEM_NUVEM_PADRAO,
  MSG_GOGEM_NAO_IDENTIFICADO,
  MSG_LOJA_SEM_NUVEM,
  MSG_PENDENTE,
  RECUO_INTEGRACAO_MINUTOS,
  TIPO_ASSINADO,
  TIPO_PEDIDO_CANCELADO,
  corpoCancelamento,
  corpoPedidoCancelado,
  corpoRepasse,
  idDoAvisoAssinado,
  lerRespostaDaNuvem,
  lerRespostaGogem,
  lerRetryAfter,
  recuoMinutos,
} from './aviso-gogem';
import { notarEnvioAoGogem, registroDoGogem, tokenDoGogem } from './credencial-gogem';
import { cabecalhosDoAviso } from '../integracao-api/webhook-integracao';
import { HubDmsService } from '../integracao-api/hub-dms.service';
import { montarAviso } from '../integracao-api/hub.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O operador espera o cancelamento: a primeira tentativa tem prazo curto; passou, o job segue. */
export const PRAZO_ENVIO_IMEDIATO_MS = 8_000;
/**
 * A nuvem, recebendo o repasse do servidor da loja, tenta o GoGeM com um prazo MENOR que o da loja
 * (8 s): a resposta tem de voltar a tempo de o operador da loja vê-la.
 */
export const PRAZO_REPASSE_MS = 5_000;
/** O job não tem ninguém esperando na frente. */
const PRAZO_ENVIO_FILA_MS = 15_000;
/** Reserva de um aviso em envio: se o processo morrer no meio, ele volta à fila sozinho. */
const RESERVA_MINUTOS = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Envia os avisos da fila `aviso_integracao` ao GoGeM. O aviso é GRAVADO por quem cancela (na
 * mesma transação do cancelamento — `gravarAvisoCancelamentoTotem`); aqui ele sai: na hora, com
 * prazo curto, e depois pelo job, com recuo, até ser entregue.
 *
 * Roda na loja e na nuvem, cada uma com a SUA fila (a tabela não sincroniza), mas só a NUVEM fala
 * com o GoGeM — com o token do equipamento que o GoGeM marcou (ERR-108). O servidor da loja
 * repassa o aviso para a nuvem com o token de sync dele; para a loja, "entregue" é a nuvem ter
 * aceitado, e a nuvem segue com ele.
 *
 * Hub da DMS (F3, decisão D-1, 21/10/2026): cada envio da nuvem ao GoGeM vai ao registro do hub, e
 * NENHUMA parada segura o estorno — nem a do hub nem a chave própria (`ACEITAR_INTEGRACOES`): é
 * dinheiro do cliente. Desligado com o hub (`HUB_LIGADO`).
 */
@Injectable()
export class GogemAvisoService {
  private readonly log = new Logger('AvisoGoGeM');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * O cliente do hub. Ele mora no módulo da integração, que é só da nuvem e nem sobe no servidor da
   * loja: daqui ele é pedido na hora, como o `ProdutoService` da integração, e sem ele nada se
   * registra. Só o caminho da nuvem chama (o da loja repassa, e a nuvem registra o envio dela).
   */
  private hubDaNuvem(): HubDmsService | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get(HubDmsService, { strict: false });
    } catch {
      return null;
    }
  }

  /**
   * O pedido de estorno no registro do hub: saiu, para onde (só a origem), o que o GoGeM respondeu,
   * quanto levou e a tentativa — nunca o conteúdo. O `webhook-id` do aviso é o mesmo em todas as
   * tentativas (o GoGeM reconhece a repetição); no hub cada tentativa é uma linha, então o código
   * leva o número dela. 2xx com o estorno que não saiu volta para a fila (V30): lá vale "falhou".
   * Com o hub desligado, nada. Nunca rejeita.
   */
  private async anotarNoHub(
    linha: any,
    a: { inicio: number; url: string; http: number | null; prefixo: string | null; desfecho: DesfechoAviso },
  ): Promise<void> {
    const hub = this.hubDaNuvem();
    if (!hub?.ligado) return;
    try {
      const tentativa = Number(linha.tentativas) || 1;
      const aviso = montarAviso({
        codigo: `${idDoAvisoAssinado(linha.id)}:${tentativa}`,
        inicio: a.inicio,
        agora: Date.now(),
        aplicativo: DESTINO_GOGEM,
        prefixo: a.prefixo,
        conta: linha.unidade_id ?? linha.tenant_id,
        contaNome: await hub.nomeDaConta(linha.tenant_id, linha.unidade_id ?? null),
        tipo: TIPO_ASSINADO.cancelado,
        url: a.url,
        status: a.http,
        pausado: false,
        tentativa,
        concluido: a.desfecho.status === 'entregue',
      });
      if (aviso) hub.registrarAviso(aviso);
    } catch (e: any) {
      this.log.warn(`aviso ${linha.id}: o registro no hub não saiu (${e?.message ?? e})`);
    }
  }

  private url(): string {
    return (process.env.GOGEM_CLOUD_URL || GOGEM_NUVEM_PADRAO).replace(/\/$/, '') + CAMINHO_PEDIDO_CANCELADO;
  }

  /**
   * NUVEM: o aviso que o servidor da loja repassou (`POST /gogem/avisos/pedido-cancelado`, com o
   * token de sync dele). Grava na fila DESTA nuvem com o MESMO id do aviso da loja — repetir o
   * repasse devolve o mesmo aviso, e um cancelamento que já avisou por aqui não avisa duas vezes
   * (índice único da venda) — e tenta o GoGeM na hora, com prazo curto, para a loja responder ao
   * operador. Sem resposta no prazo, o job desta nuvem segue com ele.
   */
  async receberDaLoja(sync: SyncCtxData, repasse: any): Promise<{ aceito: true; avisoId: string; estorno: EstornoGogem }> {
    const chave = String(repasse?.chave ?? repasse?.corpo?.idempotencyKey ?? '').trim();
    if (!chave) throw new BadRequestException('Aviso sem a chave da venda.');
    const corpo = corpoCancelamento({
      idempotencyKey: chave,
      regemComandaId: repasse?.corpo?.regemComandaId ?? null,
      motivo: repasse?.corpo?.motivo ?? null,
    });
    const avisoId = UUID.test(String(repasse?.avisoId ?? '')) ? String(repasse.avisoId) : null;
    const refTipo = ['comanda', 'pedido_externo'].includes(repasse?.referenciaTipo) ? repasse.referenciaTipo : null;
    const refId = UUID.test(String(repasse?.referenciaId ?? '')) ? String(repasse.referenciaId) : null;

    const ins: any = await this.db.execute(sql`
      insert into aviso_integracao
        (id, tenant_id, unidade_id, destino, tipo, chave, corpo, referencia_tipo, referencia_id)
      values (coalesce(${avisoId}::uuid, gen_random_uuid()), ${sync.tenantId}::uuid, ${sync.unidadeId ?? null}::uuid,
              ${DESTINO_GOGEM}, ${TIPO_PEDIDO_CANCELADO}, ${corpo.idempotencyKey}, ${JSON.stringify(corpo)}::jsonb,
              ${refTipo}, ${refId}::uuid)
      on conflict do nothing
      returning id`);
    let id = (ins.rows ?? ins)[0]?.id as string | undefined;
    if (!id) {
      const ja: any = await this.db.execute(sql`
        select id from aviso_integracao
         where tenant_id = ${sync.tenantId}::uuid and destino = ${DESTINO_GOGEM}
           and tipo = ${TIPO_PEDIDO_CANCELADO} and chave = ${corpo.idempotencyKey}
         limit 1`);
      id = (ja.rows ?? ja)[0]?.id as string | undefined;
    }
    // O id do aviso já existia em OUTRA empresa (ou em outra venda): não se sobrescreve nada alheio.
    if (!id) throw new BadRequestException('Aviso não aceito: o identificador já está em uso.');
    const estorno = await this.enviarAgora(id, PRAZO_REPASSE_MS);
    return { aceito: true, avisoId: id, estorno };
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
  async rodarFila(limite = 20, soEmpresas?: string[]) {
    let linhas: any[] = [];
    try {
      // `soEmpresas`: o job passa pela fila de todas; o teste, só pela das empresas dele — no CI
      // as specs dividem o banco em paralelo, e a fila de uma pegaria o aviso da outra (LIC-084).
      linhas = await this.reservar({ limite, soEmpresas });
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
  private async reservar(p: { avisoId?: string; limite: number; soEmpresas?: string[] }): Promise<any[]> {
    // `status_anterior`: a linha devolvida já está `enviando`, e é o estado de ANTES que diz se o
    // aviso acabou de entrar em "aguardando integração" (alerta uma vez) ou já estava nele.
    // `materialized` (LIC-069): embutida, a CTE com LIMIT pode ser reexecutada a cada linha do
    // UPDATE e reservar a fila inteira em vez de N — Postgres 12+ (a loja e a nuvem são 15+).
    const empresas = p.soEmpresas?.length
      ? sql`tenant_id in (${sql.join(p.soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})`
      : sql`true`;
    const r: any = await this.db.execute(sql`
      with fila as materialized (
        select id, status as status_anterior from aviso_integracao
         where status in ('pendente', 'enviando', 'aguardando_integracao')
           and proxima_tentativa_em <= now()
           and ${p.avisoId ? sql`id = ${p.avisoId}::uuid` : sql`true`}
           and ${empresas}
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
    const naLoja = ehServidorLocal();
    const ler = naLoja ? lerRespostaDaNuvem : lerRespostaGogem;
    if (l?.status === 'entregue' || l?.status === 'recusado')
      return ler(l.ultimo_status_http ?? null, l.ultima_resposta).paraOperador;
    if (l?.status === 'aguardando_integracao') {
      // Sem código HTTP = não chegou a sair: na nuvem, o GoGeM ainda não se identificou; na loja,
      // o servidor não tem a ligação com a nuvem.
      if (l.ultimo_status_http == null) return naLoja ? MSG_LOJA_SEM_NUVEM : MSG_GOGEM_NAO_IDENTIFICADO;
      if (naLoja) return lerRespostaDaNuvem(l.ultimo_status_http, l.ultima_resposta).paraOperador;
      // 404/410/redirecionamento só param o aviso quando vieram do endereço registrado (aviso assinado).
      const h = Number(l.ultimo_status_http);
      return lerRespostaGogem(h, l.ultima_resposta, h === 404 || h === 410 || (h >= 300 && h < 400)).paraOperador;
    }
    return { situacao: 'pendente', mensagem: MSG_PENDENTE };
  }

  /**
   * Um envio. Na NUVEM: ao GoGeM — assinado, no endereço que ele registrou, se registrou; senão
   * com o token que ele marcou. No servidor da LOJA: à nuvem do Regem, que envia por ele. Grava o
   * desfecho e devolve o que o operador precisa saber.
   */
  private async enviar(
    linha: any,
    prazoMs: number,
  ): Promise<{ desfecho: DesfechoAviso; http: number | null; retryAfterS: number | null }> {
    if (ehServidorLocal()) return this.enviarPelaNuvem(linha, prazoMs);
    const token = await tokenDoGogem(this.db, linha.tenant_id, linha.unidade_id ?? null);
    const registro = await registroDoGogem(this.db, linha.tenant_id, linha.unidade_id ?? null);
    if (registro) {
      // Fase 2 (`docs/integracao-gogem/AVISOS-ASSINADOS.md`): o GoGeM registrou o endereço dele.
      // Mesmas regras da fila; o `webhook-id` é o do aviso em todas as tentativas. O `X-Sync-Token`
      // vai junto até a fase 4, quando houver — sem ele o aviso assinado sai do mesmo jeito.
      const corpo = corpoPedidoCancelado(linha, registro.lojaId ?? linha.unidade_id ?? null);
      const inicio = Date.now();
      const r = await this.postar(registro.url, token, corpo, prazoMs, { chave: registro.chave, id: idDoAvisoAssinado(linha.id) });
      const d = lerRespostaGogem(r.http, r.corpo, true);
      await notarEnvioAoGogem(this.db, registro.tokenId, r.http);
      await this.registrar(linha, d, r.http, r.corpo, r.erro, r.retryAfterS, true);
      await this.anotarNoHub(linha, { inicio, url: registro.url, http: r.http, prefixo: registro.prefixo, desfecho: d });
      return { desfecho: d, http: r.http, retryAfterS: r.retryAfterS };
    }
    if (!token) {
      // Não se chuta um servidor_local qualquer (5 de 6 davam 401): o aviso espera o GoGeM se
      // identificar — a marca solta a fila na hora (`soltarAvisosParados`).
      const d: DesfechoAviso = { status: 'aguardando_integracao', estorno: null, paraOperador: MSG_GOGEM_NAO_IDENTIFICADO };
      await this.registrar(linha, d, null, null, 'o GoGeM ainda não se identificou para esta empresa', null);
      return { desfecho: d, http: null, retryAfterS: null };
    }
    const inicio = Date.now();
    const r = await this.postar(this.url(), token, linha.corpo, prazoMs);
    const d = lerRespostaGogem(r.http, r.corpo);
    await this.registrar(linha, d, r.http, r.corpo, r.erro, r.retryAfterS);
    // O token do equipamento não tem prefixo público: no hub o envio vai sem ele.
    await this.anotarNoHub(linha, { inicio, url: this.url(), http: r.http, prefixo: null, desfecho: d });
    return { desfecho: d, http: r.http, retryAfterS: r.retryAfterS };
  }

  /**
   * Servidor da LOJA: o aviso vai para a nuvem do Regem, nunca direto ao GoGeM — o token da
   * integração não mora na loja (credencial de integração é da distribuição), e o GoGeM recusa
   * qualquer outro (ERR-108). Autentica com o token de sync deste servidor.
   */
  private async enviarPelaNuvem(
    linha: any,
    prazoMs: number,
  ): Promise<{ desfecho: DesfechoAviso; http: number | null; retryAfterS: number | null }> {
    const nuvem = String(process.env.CLOUD_API ?? '').trim().replace(/\/$/, '');
    const token = String(process.env.SYNC_TOKEN ?? '').trim();
    if (!nuvem || !token) {
      const d: DesfechoAviso = { status: 'aguardando_integracao', estorno: null, paraOperador: MSG_LOJA_SEM_NUVEM };
      await this.registrar(linha, d, null, null, 'servidor da loja sem CLOUD_API/SYNC_TOKEN', null);
      return { desfecho: d, http: null, retryAfterS: null };
    }
    const r = await this.postar(nuvem + CAMINHO_REPASSE_DA_LOJA, token, corpoRepasse(linha), prazoMs);
    const d = lerRespostaDaNuvem(r.http, r.corpo);
    await this.registrar(linha, d, r.http, r.corpo, r.erro, r.retryAfterS);
    return { desfecho: d, http: r.http, retryAfterS: r.retryAfterS };
  }

  /**
   * O POST com o `X-Sync-Token` — ou ASSINADO (Standard Webhooks), quando vem `assinar`: aí o token
   * vai junto só se houver, e redirecionamento não se segue (o endereço foi conferido no registro).
   * Devolve o código, o corpo lido e o `Retry-After` (sem lançar).
   */
  private async postar(
    url: string,
    token: string | null,
    corpo: unknown,
    prazoMs: number,
    assinar?: { chave: Buffer; id: string },
  ) {
    let http: number | null = null;
    let lido: any = null;
    let erro: string | null = null;
    let retryAfterS: number | null = null;
    // O texto assinado é exatamente o texto enviado.
    const enviado = JSON.stringify(corpo);
    const headers: Record<string, string> = assinar
      ? { ...cabecalhosDoAviso(assinar.chave, assinar.id, enviado), Accept: 'application/json', ...(token ? { 'X-Sync-Token': token } : {}) }
      : { 'X-Sync-Token': token ?? '', 'Content-Type': 'application/json', Accept: 'application/json' };
    try {
      const res = await fetchExterno(
        url,
        { method: 'POST', headers, body: enviado, ...(assinar ? { redirect: 'manual' as const } : {}) },
        prazoMs,
      );
      http = res.status;
      retryAfterS = lerRetryAfter(res.headers.get('retry-after'));
      const texto = await res.text().catch(() => '');
      try {
        lido = texto ? JSON.parse(texto) : null;
      } catch {
        lido = { texto: texto.slice(0, 500) };
      }
    } catch (e: any) {
      // Com a causa de rede (ERR-239): o `ultimo_erro` e a auditoria do aviso dizem o porquê.
      const causa = causaDeRede(e);
      erro = `${String(e?.message ?? e)}${causa ? ` (${causa})` : ''}`;
    }
    return { http, corpo: lido, erro, retryAfterS };
  }

  /** Grava o desfecho na fila e, quando é o fim da história (ou um alerta), na auditoria. */
  private async registrar(
    linha: any,
    d: DesfechoAviso,
    http: number | null,
    corpo: any,
    erro: string | null,
    retryAfterS: number | null,
    assinado = false,
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
      // Por qual caminho saiu: o assinado (endereço registrado pelo GoGeM) ou o do `X-Sync-Token`.
      ...(assinado ? { assinado: true } : {}),
    };
    if (status === 'entregue' && ehServidorLocal()) {
      // Na loja, "entregue" é a nuvem ter aceitado: quem fala com o GoGeM (e audita o estorno) é ela.
      this.log.log(`aviso ao GoGeM repassado à nuvem (${linha.chave}): ${d.paraOperador.situacao}`);
      await this.auditar(linha, 'aviso_gogem_repassado', { ...base, situacao: d.paraOperador.situacao });
    } else if (status === 'entregue') {
      this.log.log(
        `aviso ao GoGeM entregue (${linha.chave}): ${d.estorno ? `estorno ${d.estorno.feito ? 'feito' : 'não feito'} · ${d.estorno.meio}` : 'sem detalhe de estorno'}`,
      );
      await this.auditar(linha, 'aviso_gogem_entregue', { ...base, estorno: d.estorno, situacao: d.paraOperador.situacao });
    } else if (status === 'recusado') {
      this.log.error(`aviso ao GoGeM RECUSADO (${linha.chave}) — estorno manual: ${ultimoErro}`);
      await this.auditar(linha, 'aviso_gogem_recusado', { ...base, erro: ultimoErro, resposta: corpo });
    } else if (status === 'aguardando_integracao' && linha.status_anterior !== 'aguardando_integracao') {
      // Alerta UMA vez, na entrada neste estado — não a cada tentativa de 6 h. Sem código HTTP, o
      // aviso nem saiu: falta a credencial (o GoGeM não se identificou; a loja sem a nuvem).
      const semCredencial = http == null;
      this.log.error(
        `aviso ao GoGeM parado (${linha.chave}) — ${semCredencial ? 'sem credencial' : 'credencial recusada'}, ` +
          `estorno NÃO pedido: ${ultimoErro}`,
      );
      await this.auditar(linha, semCredencial ? 'aviso_gogem_sem_integracao' : 'aviso_gogem_integracao_recusou', {
        ...base,
        erro: ultimoErro,
      });
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

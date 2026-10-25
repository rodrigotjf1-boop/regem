import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { ChaveSegredosAusente, cifrar, decifrar } from '../../common/cifra-segredo';
import { conferirDestino, enviarComSeguranca, type OpcoesDoEnvio } from '../../common/envio-seguro';
import { fetchExterno } from '../../common/fetch-externo';
import { POLITICA_LIGACAO } from '../../dms/integracao-dms';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DESTINO_GOGEM, soltarAvisosParados } from '../gogem/aviso-gogem';
import { CLIENTES_INTEGRACAO } from './escopos';
import { HubDmsService } from './hub-dms.service';
import { aceitaIntegracoes, montarAviso } from './hub.regras';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { lerConfigDmsId } from './ligacao.regras';
import { aplicativoNoHub, clienteDoParceiro, ehClienteDeParceiro, permissoesDoParceiro } from './parceiros.regras';
import { ProblemaException } from './problema';
import { sqlIso } from './venda-integracao';
import { ATRASO_LEITURA_SEG } from './vendas-integracao.service';
import {
  basesDoParceiro,
  basesDoWebhook,
  cabecalhosDoAviso,
  chaveDoSegredo,
  corpoDoAviso,
  desfechoDoEnvio,
  dominiosProibidosDoAmbiente,
  ehRetrato,
  enderecoDoParceiro,
  enderecoPermitido,
  EVENTO_DO_RECURSO,
  EVENTO_DO_RETRATO,
  RecursoAvisado,
  RetratoAvisado,
} from './webhook-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AVISOS (webhooks) da API de integração (trilha C, C3b — mig 304). SÓ NUVEM.
//
// A integração registra, com o token da loja, o endereço e o segredo dela (`PUT /integracao/webhook`).
// A cada 15 s este job olha, numa consulta só, quais lojas têm versão publicada MAIS NOVA do que o
// último aviso (`avisado_ate`) — pelas mesmas regras de escopo e de loja da leitura com cursor — e
// manda UM aviso assinado por loja, no máximo um por minuto. Não há fila de eventos: o aviso é só
// gatilho ("leia de novo"), e a posição fica na própria linha do registro.
//
// RETRATOS (catálogo e fichas, lidos na hora — mig 316): não têm versão publicada. Os gatilhos das
// tabelas do cardápio anotam a mudança numa fila; no começo de cada ciclo o job esvazia a fila e
// carimba a marca (`integracao_retrato_marca`), e a busca de novidade olha a marca junto das versões.
// Só o job grava a marca, depois de a escrita de quem salvou estar confirmada — por isso a hora dela
// nunca fica atrás de um aviso já mandado.
//
// Escala: parado (nada novo) custa DUAS consultas (a fila dos retratos, vazia, e a busca) e nenhuma
// gravação; nenhum retrato é relido para comparar. Só a loja com novidade é
// reservada (a reserva é a `proxima_verificacao_em` empurrada — duas réplicas não mandam o mesmo
// aviso) e ganha uma gravação com o resultado. O destino fora do ar não segura ninguém: prazo
// curto, recuo por loja, e o lote para quando ninguém respondeu.
// Os métodos aceitam `{ tenantIds }` para os testes rodarem só nas empresas deles (V32).
//
// HUB DMS (F3, parte D; decisão F3-3: o hub vê e para, mas não entrega). Os avisos continuam saindo daqui, e:
// - a chave própria (`ACEITAR_INTEGRACOES`, Padrão §10) desligada segura também os avisos (D-2, na recomendada): nada
//   sai e nada se grava; saem quando ela voltar, pela posição da linha, que não andou;
// - a parada do hub vale para eles: a geral e a de aplicativo tiram o aplicativo da reserva (nada se grava por loja); a
//   de ligação (o prefixo do token ou o da ligação do DMS ID) e a de tipo de aviso (`aviso pedido.alterado`) soltam a
//   reserva daquela loja em 30 s, sem contar falha nem andar a posição;
// - cada envio vai ao registro do hub (o `webhook-id` daquele envio, o aplicativo, o tipo, o resultado, a tentativa e só
//   a origem do destino; nunca o conteúdo). Com o hub desligado (`HUB_LIGADO`), nada disso muda o job.
//
// APLICATIVO DE PARCEIRO (Hub DMS, F4 parte F, R2): os avisos dele têm um job PRÓPRIO (outro relógio, outra trava), para
// o destino de um parceiro fora do ar nunca atrasar os do Liame, do Farol e do GoGeM — e a reserva dos produtos da DMS
// nunca pega linha de parceiro. Só com a chave `PARCEIROS_LIGADOS`, o hub ligado, a parada lida e o aplicativo na lista
// de aprovados (`hub.parceirosAprovados()`): a lista do hub é a fonte das permissões do aviso (o que ele aprovou, dentro do
// teto da classe e da etapa — tirar uma permissão é na lista). Na reserva, o acesso vale pela MESMA régua da porta: token
// e ligação vivos, a ligação do aplicativo aprovado, usada nos últimos 90 dias, a loja e a empresa vivas. A janela de
// leitura (só o que aconteceu depois da autorização, M4) vale também para o aviso: a venda confirmada antes e o cliente
// esquecido antes não viram aviso — e, quando só há novidade de antes, a posição anda sem mandar nada. No envio, de novo:
// o aplicativo aprovado e o endereço dentro de uma base da lista de hoje; e o envio seguro (`common/envio-seguro.ts`:
// resolve, confere todos os IPs, conecta no IP conferido, sem redirecionamento, 5 s). Disjuntor por origem: no máximo um
// envio em curso por servidor de destino, e a primeira falha de um servidor solta as outras linhas dele por 30 s.

/** Intervalo mínimo entre dois avisos da mesma loja (segundos). */
export const INTERVALO_AVISO_SEG = 60;
/** Reserva do envio em curso (segundos): se o processo cair no meio, a loja volta à fila depois disso. */
const RESERVA_SEG = 120;
const PRAZO_ENVIO_MS = 5000;
const LOTE = 40;
const EM_PARALELO = 8;
const ORCAMENTO_CICLO_MS = 10_000;
const ESPERA_SEM_TABELA_MS = 10 * 60_000;
/** Depois de um erro ao esvaziar a fila dos retratos, quanto esperar para tentar de novo. */
const ESPERA_ERRO_RETRATO_MS = 60_000;
const LIMPEZA_INTERVALO_MS = 10 * 60_000;
/** O aviso parado pelo hub (ligação ou tipo de aviso) volta a ser olhado depois disto: a lista é lida a cada 15 s. */
export const ESPERA_PARADO_SEG = 30;
/** Os avisos de parceiro: o lote e o tempo de um ciclo do job deles. */
const LOTE_PARCEIRO = 20;
const ORCAMENTO_PARCEIRO_MS = 10_000;

/**
 * O acesso da linha vale (a mesma regra do guard, `TOKEN_VALE` em `validar-token-integracao.ts`): o token da empresa da
 * linha, não revogado nem vencido, a empresa viva e — token de loja — a loja viva e da empresa. Sem isso, com a loja do
 * token apagada a empresa ficava com uma loja viva só e a venda dela passava como venda da "loja única" (ERR-302).
 */
const ACESSO_VIVO = sql`t.tenant_id = w.tenant_id
             and t.revogado_em is null
             and (t.expira_em is null or t.expira_em > now())
             and exists (select 1 from empresa e where e.id = w.tenant_id and e.deleted_at is null)
             and (t.unidade_id is null
                  or exists (select 1 from unidade ut
                              where ut.id = t.unidade_id and ut.tenant_id = t.tenant_id and ut.deleted_at is null))`;

/** O motivo da pausa da linha de parceiro cuja ligação ficou 90 dias sem uso (a porta já a recusa). */
export const MOTIVO_LIGACAO_SUSPENSA =
  'a ligação ficou 90 dias sem uso: a loja precisa autorizar o aplicativo de novo, e o aviso ser registrado de novo';
/** O motivo da pausa quando o endereço registrado saiu das bases aprovadas pela DMS. */
export const MOTIVO_BASE_FORA_DA_LISTA = 'o endereço saiu da lista de avisos aprovada pela DMS — registre um endereço permitido';

/** O servidor de destino de um endereço (o disjuntor do parceiro é por ele). */
const origemDoEndereco = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** O que a fila do parceiro recebe de cada aplicativo aprovado: o `cliente` dele, o client_id e as permissões que valem. */
export type ParceiroNaFila = { cliente: string; clientId: string; escopos: string[] };

const codigoPg = (e: any): string | undefined => e?.code ?? e?.cause?.code;

export type EscopoAviso = { tenantIds?: string[] };

/** O tipo do aviso de cada recurso (o mesmo que vai no corpo e no registro do hub). */
export const tipoDoAviso = (r: RecursoAvisado | RetratoAvisado): string => (ehRetrato(r) ? EVENTO_DO_RETRATO[r].tipo : EVENTO_DO_RECURSO[r].tipo);

type Devido = {
  token_id: string;
  /** O prefixo visível do `rgm_it_` (a lista de parada reconhece a ligação por ele, e pelo da ligação do DMS ID). */
  token_prefixo: string;
  tenant_id: string;
  unidade_id: string | null;
  cliente: string;
  url: string;
  segredo_cifrado: string;
  falhas_seguidas: number;
  falhando_ha: number | null;
  recurso: RecursoAvisado | RetratoAvisado;
  /** Nulo no retrato (catálogo, fichas): o aviso vale pela loja, não por um recurso. */
  recurso_id: string | null;
  versao: string | null;
  ate: string;
  cupom_id: string | null;
  pedido_id: string | null;
  /** Só na linha de parceiro: o client_id do aplicativo (é por ele que o hub registra e para) e o prefixo da ligação. */
  client_id?: string | null;
  ligacao_prefixo?: string | null;
};

@Injectable()
export class WebhookIntegracaoService {
  private readonly log = new Logger('IntegracaoWebhook');
  private rodando = false;
  private pausadoAte = 0;
  private limpezaEm = 0;
  /** Sem as tabelas da 316 (ou com erro na fila dos retratos): os avisos de venda e de cupom seguem sozinhos. */
  private retratosParadosAte = 0;
  /** Atraso sobre o carimbo, o mesmo da leitura (os testes encurtam). */
  atrasoSeg = ATRASO_LEITURA_SEG;
  /** Intervalo entre avisos da mesma loja (os testes encurtam). */
  intervaloSeg = INTERVALO_AVISO_SEG;
  prazoEnvioMs = PRAZO_ENVIO_MS;
  /**
   * O job dos avisos de parceiro (o dele, à parte): um ciclo por vez, e a pausa de 10 min quando falta uma tabela ou
   * coluna que só ele lê (migs 329 e 340) — sem parar os avisos dos produtos da DMS.
   */
  private rodandoParceiros = false;
  private parceirosPausadosAte = 0;
  private limpezaParceirosEm = 0;
  /**
   * As opções do envio seguro do parceiro. Os testes trocam por CÓDIGO (o resolvedor, a porta, o certificado de teste);
   * nunca por variável de ambiente. Os domínios proibidos (os serviços do próprio Regem) são lidos do ambiente a cada uso.
   */
  envioDoParceiro: OpcoesDoEnvio = {};

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    // O cliente do hub (F3, A2 e D). Opcional: quem monta o serviço à mão (testes de outros módulos) segue sem hub.
    @Optional() private readonly hub?: HubDmsService,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  private escopo(coluna: SQL, e?: EscopoAviso): SQL {
    if (!e?.tenantIds) return sql``;
    if (!e.tenantIds.length) return sql`and false`;
    return sql`and ${coluna} in (${sql.join(
      e.tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`;
  }

  // ───────────────────────────── registro (rotas do token) ─────────────────────────────

  /** O que a integração vê do próprio registro — nunca o segredo. */
  private estado(l: any) {
    return {
      url: l.url as string,
      registrado_em: l.registrado_em as string,
      pausado: !!l.pausado_em,
      pausado_em: (l.pausado_em as string | null) ?? null,
      motivo_pausa: (l.motivo_pausa as string | null) ?? null,
      ultimo_envio_em: (l.ultimo_envio_em as string | null) ?? null,
      ultimo_status_http: l.ultimo_status_http === null || l.ultimo_status_http === undefined ? null : Number(l.ultimo_status_http),
      falhas_seguidas: Number(l.falhas_seguidas ?? 0),
      entregues: Number(l.entregues ?? 0),
    };
  }

  private colunasDoEstado(): SQL {
    return sql`w.url, ${sqlIso(sql`w.registrado_em`)} as registrado_em, ${sqlIso(sql`w.pausado_em`)} as pausado_em,
               w.motivo_pausa, ${sqlIso(sql`w.ultimo_envio_em`)} as ultimo_envio_em, w.ultimo_status_http,
               w.falhas_seguidas, w.entregues::text as entregues`;
  }

  /**
   * `PUT /integracao/webhook`: registra (ou troca) o endereço e o segredo do aviso deste token.
   * Registrar de novo religa o que estava pausado e zera as falhas. O endereço tem de estar na
   * lista do cliente (definida pela distribuição); o segredo é guardado cifrado.
   */
  async registrar(ctx: IntegracaoCtxData, corpo: unknown) {
    const c = corpo as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new ProblemaException(400, 'parametro-invalido', 'Envie um JSON com "url" e "segredo".');
    }
    const estranhos = Object.keys(c).filter((k) => k !== 'url' && k !== 'segredo');
    if (estranhos.length) {
      throw new ProblemaException(400, 'parametro-invalido', `Campo desconhecido: ${estranhos.join(', ')}.`);
    }
    // O aplicativo de PARCEIRO (F4 parte F, R2): as bases são as que a DMS aprovou para ele, da lista do hub de AGORA, e o
    // endereço é uma base + UM trecho; os produtos da DMS, a lista da distribuição (`WEBHOOK_INTEGRACAO`).
    const parceiro = ehClienteDeParceiro(ctx.cliente);
    const bases = parceiro ? this.basesDoAprovado(ctx) : basesDoWebhook(ctx.cliente);
    if (!bases.length) {
      throw new ProblemaException(
        422,
        'endereco-nao-permitido',
        parceiro ? 'Este aplicativo não tem endereço de aviso aprovado pela DMS.' : 'Esta integração não tem aviso habilitado no Regem.',
      );
    }
    const url = parceiro ? enderecoDoParceiro(c.url, bases) : enderecoPermitido(c.url, bases);
    if (!url) {
      this.log.warn(`token ${ctx.prefixo}… (${ctx.cliente}): endereço de aviso fora da lista permitida — recusado`);
      throw new ProblemaException(
        422,
        'endereco-nao-permitido',
        parceiro
          ? '"url" precisa ser uma base de aviso aprovada pela DMS para este aplicativo + um trecho (letras, números, - e _, até 64), com até 500 caracteres.'
          : '"url" precisa ser um endereço da própria integração, registrado no Regem pela distribuição.',
      );
    }
    if (!chaveDoSegredo(c.segredo)) {
      throw new ProblemaException(
        400,
        'parametro-invalido',
        '"segredo" precisa estar no formato Standard Webhooks: "whsec_" + base64 de 24 a 64 bytes.',
      );
    }
    if (parceiro) {
      // O endereço é do parceiro: o nome tem de resolver só para IP público (o registro já recusa o que aponta para dentro,
      // V68). O envio confere de novo, a cada aviso, e conecta no IP conferido.
      const conferido = await conferirDestino(url, this.opcoesDoParceiro());
      if ('motivo' in conferido) {
        this.log.warn(`ligação ${ctx.prefixo}… (${ctx.cliente}): endereço de aviso recusado — ${conferido.motivo}`);
        throw new ProblemaException(422, 'endereco-nao-permitido', `"url" não pode receber aviso: ${conferido.motivo}.`);
      }
    }
    const segredo = c.segredo as string;
    let cifrado: string;
    try {
      cifrado = cifrar(segredo);
    } catch (e: any) {
      // Sem a chave de segredos na nuvem não há como guardar: motivo no log, resposta sem detalhe.
      this.log.error(`aviso não registrado: ${e instanceof ChaveSegredosAusente ? e.message : (e?.message ?? e)}`);
      throw new ProblemaException(503, 'aviso-indisponivel', 'Os avisos não estão disponíveis agora. A leitura com cursor segue valendo.');
    }

    const [antes] = this.rows(
      await this.db.execute(sql`
        select w.url, w.segredo_cifrado, w.pausado_em is not null as pausado
          from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid`),
    );
    let mesmoSegredo = false;
    if (antes) {
      try {
        mesmoSegredo = decifrar(antes.segredo_cifrado) === segredo;
      } catch {
        mesmoSegredo = false; // o guardado não abre mais: o novo o substitui
      }
    }
    const mudou = !antes || antes.url !== url || !mesmoSegredo || !!antes.pausado;

    const [l] = this.rows(
      await this.db.execute(sql`
        insert into integracao_webhook as w (token_id, tenant_id, unidade_id, cliente, url, segredo_cifrado)
        values (${ctx.tokenId}::uuid, ${ctx.tenantId}::uuid, ${ctx.unidadeId}::uuid, ${ctx.cliente}, ${url}, ${cifrado})
        on conflict (token_id) do update
           set url = excluded.url,
               segredo_cifrado = excluded.segredo_cifrado,
               registrado_em = now(),
               falhas_seguidas = 0,
               primeira_falha_em = null,
               pausado_em = null,
               motivo_pausa = null,
               proxima_verificacao_em = least(w.proxima_verificacao_em, now())
        returning ${this.colunasDoEstado()}`),
    );
    if (mudou) {
      // O registro repetido do dia a dia (mesmo endereço, mesmo segredo) não vira linha de auditoria.
      await this.auditoria.registrar({
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId,
        atorTipo: 'integracao',
        tipo: 'integracao',
        acao: 'integracao.webhook_registrado',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: ctx.tokenId,
        // do parceiro, só a origem: o trecho é o id interno da conexão no sistema dele (o registro do hub faz o mesmo)
        detalhe: { cliente: ctx.cliente, prefixo: ctx.prefixo, url: parceiro ? new URL(url).origin : url, novo: !antes },
      });
      // O GoGeM ligou (ou trocou) os avisos assinados: o cancelamento que esperava por ele — sem
      // credencial, ou parado 6 h por recusa — sai agora, pelo endereço novo. Nunca derruba o registro.
      if (ctx.cliente === DESTINO_GOGEM) {
        await soltarAvisosParados(this.db, ctx.tenantId).catch((e: any) =>
          this.log.warn(`avisos parados do GoGeM não soltos agora (saem no próximo recuo): ${e?.message ?? e}`),
        );
      }
    }
    return this.estado(l);
  }

  /** As bases de aviso do aplicativo de parceiro que chamou (pela ligação), da lista do hub de agora. Fora dela: nenhuma. */
  private basesDoAprovado(ctx: IntegracaoCtxData): string[] {
    const aprovado = ctx.aplicativo ? (this.hub?.parceiroAprovado(ctx.aplicativo) ?? null) : null;
    return aprovado ? basesDoParceiro(aprovado, dominiosProibidosDoAmbiente()) : [];
  }

  /** As opções do envio seguro do parceiro: o prazo do serviço, os serviços do próprio Regem e o que o teste trocou. */
  private opcoesDoParceiro(): OpcoesDoEnvio {
    return { prazoMs: this.prazoEnvioMs, proibidos: dominiosProibidosDoAmbiente(), ...this.envioDoParceiro };
  }

  /** `GET /integracao/webhook`: a situação do aviso deste token (404 se não há registro). */
  async ler(ctx: IntegracaoCtxData) {
    const [l] = this.rows(
      await this.db.execute(sql`
        select ${this.colunasDoEstado()}
          from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid`),
    );
    if (!l) throw new ProblemaException(404, 'nao-encontrado', 'Este token não tem aviso registrado.');
    return this.estado(l);
  }

  /** `DELETE /integracao/webhook`: para de avisar. Sem registro, não faz nada (a resposta é a mesma). */
  async remover(ctx: IntegracaoCtxData): Promise<void> {
    const apagados = this.rows(
      await this.db.execute(sql`
        delete from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid
        returning w.url`),
    );
    if (!apagados.length) return;
    await this.auditoria.registrar({
      tenantId: ctx.tenantId,
      unidadeId: ctx.unidadeId,
      atorTipo: 'integracao',
      tipo: 'integracao',
      acao: 'integracao.webhook_removido',
      origem: 'integracao',
      entidadeTipo: 'integracao_token',
      entidadeId: ctx.tokenId,
      detalhe: {
        cliente: ctx.cliente,
        prefixo: ctx.prefixo,
        url: ehClienteDeParceiro(ctx.cliente) ? new URL(apagados[0].url).origin : apagados[0].url,
      },
    });
  }

  // ───────────────────────────── o job ─────────────────────────────

  // Um ciclo por vez neste processo. Só na NUVEM (V1, ERR-075): o módulo nem sobe no servidor da
  // loja (e a tabela não existe lá), e o job se guarda sozinho mesmo assim.
  @Interval(15000)
  async tick(): Promise<void> {
    if (ehServidorLocal() || this.rodando || Date.now() < this.pausadoAte) return;
    this.rodando = true;
    try {
      if (Date.now() >= this.limpezaEm) {
        this.limpezaEm = Date.now() + LIMPEZA_INTERVALO_MS;
        await this.limpar();
      }
      await this.ciclo();
    } catch (e: any) {
      if (e?.code === '42P01') {
        // Tabela da 304 ausente (migration ainda não aplicada): um aviso a cada 10 min. Nada mais
        // depende deste job — a leitura com cursor segue igual.
        this.pausadoAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(`avisos da integração parados por 10 min: ${e?.message ?? e} — aplique a migration 304 na nuvem`);
      } else {
        this.log.error(`ciclo dos avisos falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
      }
    } finally {
      this.rodando = false;
    }
  }

  /** Apaga o registro de token revogado ou vencido (o segredo guardado sai junto). */
  async limpar(e?: EscopoAviso): Promise<number> {
    const r: any = await this.db.execute(sql`
      delete from integracao_webhook w
       using integracao_token_loja t
       where t.id = w.token_id
         and (t.revogado_em is not null or (t.expira_em is not null and t.expira_em <= now()))
         ${this.escopo(sql`w.tenant_id`, e)}`);
    return Number(r?.rowCount ?? 0);
  }

  /** Um ciclo: reserva as lojas com novidade e manda os avisos, até acabar ou o tempo do ciclo. */
  async ciclo(e?: EscopoAviso, orcamentoMs = ORCAMENTO_CICLO_MS) {
    const fim = Date.now() + orcamentoMs;
    await this.carimbarRetratos(e);
    let enviados = 0;
    let entregues = 0;
    // A chave própria desligada segura os avisos também (D-2): nada é reservado, e a posição de cada loja fica onde está.
    if (!aceitaIntegracoes()) return { enviados, entregues };
    // A parada geral e a de aplicativo, pela última lista do hub: esses aplicativos nem entram na reserva.
    const fora = this.aplicativosParados();
    for (;;) {
      const lote = await this.reservar(e, LOTE, fora);
      if (!lote.length) break;
      const ligacoes = await this.prefixosDasLigacoes(lote);
      const mandar: Devido[] = [];
      const parados: string[] = [];
      for (const l of lote) {
        const parada = this.hub?.avisoParado({ aplicativo: l.cliente, ligacaoPrefixos: [l.token_prefixo, ligacoes.get(l.token_id)], tipo: tipoDoAviso(l.recurso) });
        if (parada) parados.push(l.token_id);
        else mandar.push(l);
      }
      if (parados.length) await this.soltarParados(parados);
      let ok = 0;
      for (let i = 0; i < mandar.length; i += EM_PARALELO) {
        const r = await Promise.all(mandar.slice(i, i + EM_PARALELO).map((l) => this.enviar(l, ligacoes.get(l.token_id) ?? null)));
        ok += r.filter(Boolean).length;
      }
      enviados += mandar.length;
      entregues += ok;
      // Ninguém respondeu (destino fora do ar): o resto fica para o próximo ciclo. O lote só de parados não conta: as
      // lojas dele voltam daqui a 30 s, então a próxima reserva já não as pega.
      if ((mandar.length && !ok) || lote.length < LOTE || Date.now() > fim) break;
    }
    return { enviados, entregues };
  }

  /**
   * Esvazia a fila que os gatilhos do cardápio e das fichas escrevem (mig 316) e carimba a marca de
   * cada empresa × loja × tipo que mudou — num comando só. A hora da marca é a DESTE job, e não a da
   * escrita: ele só enxerga o que já foi confirmado, então a marca nunca nasce "no passado" de um aviso
   * já mandado. Duas réplicas não se atrapalham (cada linha da fila sai por uma só).
   * Nunca rejeita: sem as tabelas da 316, ou com erro, os avisos de venda e de cupom seguem valendo.
   */
  async carimbarRetratos(e?: EscopoAviso): Promise<number> {
    if (Date.now() < this.retratosParadosAte) return 0;
    try {
      const r: any = await this.db.execute(sql`
        with lidas as (
          delete from integracao_retrato_mudanca m
           where true ${this.escopo(sql`m.tenant_id`, e)}
          returning m.tenant_id, m.recurso, m.unidade_id
        )
        insert into integracao_retrato_marca as k (tenant_id, recurso, unidade_id, atualizado_em)
        select d.tenant_id, d.recurso, d.unidade_id, clock_timestamp()
          from (select distinct l.tenant_id, l.recurso, l.unidade_id from lidas l) d
        on conflict (tenant_id, recurso, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        do update set atualizado_em = excluded.atualizado_em`);
      return Number(r?.rowCount ?? 0);
    } catch (erro: any) {
      if (erro?.code === '42P01') {
        this.retratosParadosAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(
          `avisos do cardápio e das fichas parados por 10 min: ${erro?.message ?? erro} — aplique a migration 316 na nuvem (os avisos de venda e de cupom seguem)`,
        );
      } else {
        this.retratosParadosAte = Date.now() + ESPERA_ERRO_RETRATO_MS;
        this.log.error(
          `fila dos retratos não esvaziada: ${erro?.code ? `[${erro.code}] ` : ''}${erro?.message ?? erro} — tento de novo em 1 min`,
          erro?.stack,
        );
      }
      return 0;
    }
  }

  /**
   * As lojas com registro ativo, na vez delas, que têm versão publicada mais nova do que o último
   * aviso — e a reserva delas, no MESMO comando. O que conta como novidade segue a leitura com
   * cursor: só o recurso que o escopo do token libera, só o carimbado há mais de 15 s, e a loja do
   * token (empresa de uma loja, ou token da empresa: tudo; cupom sem loja vale para todas; cliente
   * anonimizado é da empresa). O retrato (catálogo, fichas) entra pela marca, com a mesma regra: a
   * marca sem loja é da rede e vale para todas as lojas da empresa.
   */
  private async reservar(e: EscopoAviso | undefined, lote: number, foraDosAplicativos: string[] = []): Promise<Devido[]> {
    // A parada geral ou de aplicativo (F3, parte D): o aplicativo parado nem entra na reserva.
    const fora = foraDosAplicativos.length ? sql`and w.cliente not in (${sql.join(foraDosAplicativos.map((c) => sql`${c}`), sql`, `)})` : sql``;
    return this.rows(
      await this.db.execute(sql`
        with nov as materialized (
          select w.token_id, t.prefixo as token_prefixo, n.recurso, n.recurso_id, n.versao, n.atualizado_em, n.cupom_id, n.pedido_id
            from integracao_webhook w
            join integracao_token_loja t on t.id = w.token_id
           cross join lateral (${this.sqlDasPermissoes(sql`t.escopos`)}) p
           cross join lateral ${this.sqlDaNovidade(null)} n
           where w.pausado_em is null
             and w.proxima_verificacao_em <= now()
             and ${ACESSO_VIVO}
             -- a linha de aplicativo de parceiro tem a fila dela (job próprio): esta nunca a pega
             and w.cliente !~ '^parceiro_'
             ${fora}
             ${this.escopo(sql`w.tenant_id`, e)}
           order by w.proxima_verificacao_em
           limit ${lote}
        ), res as (
          update integracao_webhook w
             set proxima_verificacao_em = now() + make_interval(secs => ${RESERVA_SEG})
            from nov
           where w.token_id = nov.token_id
             and w.pausado_em is null
             and w.proxima_verificacao_em <= now()
          returning w.token_id, w.tenant_id, w.unidade_id, w.cliente, w.url, w.segredo_cifrado, w.falhas_seguidas,
                    extract(epoch from (now() - w.primeira_falha_em))::float8 as falhando_ha
        )
        select res.token_id::text as token_id, nov.token_prefixo, res.tenant_id::text as tenant_id, res.unidade_id::text as unidade_id,
               res.cliente, res.url,
               res.segredo_cifrado, res.falhas_seguidas, res.falhando_ha,
               nov.recurso, nov.recurso_id::text as recurso_id, nov.versao::text as versao,
               ${sqlIso(sql`nov.atualizado_em`)} as ate, nov.cupom_id, nov.pedido_id
          from res
          join nov on nov.token_id = res.token_id`),
    ) as Devido[];
  }

  /**
   * As listas do que a linha pode receber, pelas permissões dadas (`escopos`, um `text[]`): os recursos publicados e os
   * retratos que elas liberam, e se a empresa tem uma loja viva só. Corpo de um `lateral` (`p`).
   */
  private sqlDasPermissoes(escopos: SQL): SQL {
    const pares = sql.join(
      (Object.keys(EVENTO_DO_RECURSO) as RecursoAvisado[]).map((r) => sql`(${r}, ${EVENTO_DO_RECURSO[r].escopo})`),
      sql`, `,
    );
    const paresRetrato = sql.join(
      (Object.keys(EVENTO_DO_RETRATO) as RetratoAvisado[]).map((r) => sql`(${r}, ${EVENTO_DO_RETRATO[r].escopo})`),
      sql`, `,
    );
    return sql`
                  select array(select r.recurso from (values ${pares}) as r(recurso, escopo)
                                where r.escopo = any(${escopos})) as recursos,
                         array(select r.recurso from (values ${paresRetrato}) as r(recurso, escopo)
                                where r.escopo = any(${escopos})) as retratos,
                         (select count(*) from unidade u
                           where u.tenant_id = w.tenant_id and u.deleted_at is null) = 1 as loja_unica`;
  }

  /**
   * A novidade mais nova da linha `w` depois do último aviso (uma linha, ou nenhuma), pelas listas de `p` e pela loja do
   * token: a versão publicada (a mesma regra da leitura com cursor) ou a marca do retrato. Com `janela` (o parceiro, M4),
   * a venda confirmada antes dela e o cliente esquecido antes dela não contam — as mesmas expressões da leitura
   * (`vendas-integracao.service.ts`). Um `lateral` entre parênteses.
   */
  private sqlDaNovidade(janela: SQL | null): SQL {
    // Sem as tabelas da 316 a busca segue só com as versões (os avisos de antes não param).
    const marcas =
      Date.now() < this.retratosParadosAte
        ? sql``
        : sql`
                  union all
                  (select m.recurso, null::uuid as recurso_id, null::bigint as versao, m.atualizado_em,
                          null::text as cupom_id, null::text as pedido_id
                     from integracao_retrato_marca m
                    where m.tenant_id = w.tenant_id
                      and m.recurso = any(p.retratos)
                      and m.atualizado_em > w.avisado_ate
                      and m.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
                      and (p.loja_unica or w.unidade_id is null or m.unidade_id is null or m.unidade_id = w.unidade_id)
                    order by m.atualizado_em desc
                    limit 1)`;
    const naJanela = janela
      ? sql`
                      and (v.recurso <> 'venda' or v.confirmado_em >= ${janela})
                      and (v.recurso <> 'cliente' or coalesce(v.removido_em, v.atualizado_em) >= ${janela})`
      : sql``;
    return sql`(
                  select x.recurso, x.recurso_id, x.versao, x.atualizado_em, x.cupom_id, x.pedido_id
                    from (
                  (select v.recurso, v.recurso_id, v.versao, v.atualizado_em,
                          case when v.recurso = 'cupom_uso' then v.foto->>'cupom_id' end as cupom_id,
                          case when v.recurso = 'cupom_uso' then v.foto->>'pedido_id' end as pedido_id
                     from integracao_versao v
                    where v.tenant_id = w.tenant_id
                      and v.recurso = any(p.recursos)
                      and v.atualizado_em > w.avisado_ate
                      and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
                      and (p.loja_unica or w.unidade_id is null or v.recurso = 'cliente'
                           or v.unidade_id = w.unidade_id
                           or (v.recurso = 'cupom' and v.unidade_id is null))${naJanela}
                    order by v.atualizado_em desc, v.recurso_id desc
                    limit 1)${marcas}
                         ) x
                   order by x.atualizado_em desc
                   limit 1
                 )`;
  }

  /**
   * A reserva dos avisos de PARCEIRO (o job deles), no MESMO comando — como a dos produtos da DMS, mais:
   * - só os aplicativos da lista de aprovados de agora (`parceiros`), com as permissões que valem (as do acesso E as do
   *   teto da classe e da etapa que o hub aprovou);
   * - a ligação viva do aplicativo aprovado (não revogada, da mesma empresa, usada nos últimos 90 dias — a suspensa não
   *   recebe), além do acesso vivo (`ACESSO_VIVO`);
   * - a janela de leitura (`coalesce(t.ler_desde, t.criado_em)`, a mesma da porta): a novidade mais nova SEM a janela é
   *   o limite; a mais nova DENTRO dela é o que se avisa. Só há novidade de antes da janela → a posição anda até o limite,
   *   sem envio (uma gravação, e a próxima busca não varre de novo); há as duas → reserva, e o envio entregue anda até o
   *   limite (o aviso é só gatilho: "leia de novo").
   */
  private async reservarParceiros(e: EscopoAviso | undefined, lote: number, parceiros: ParceiroNaFila[]): Promise<Devido[]> {
    if (!parceiros.length) return [];
    const aprovados = sql.join(
      parceiros.map((p) => sql`(${p.cliente}, ${p.clientId}, ${`{${p.escopos.join(',')}}`}::text[])`),
      sql`, `,
    );
    return this.rows(
      await this.db.execute(sql`
        with pa(cliente, client_id, escopos) as (values ${aprovados}),
        nov as materialized (
          select w.token_id, t.prefixo as token_prefixo, l.prefixo as ligacao_prefixo, pa.client_id,
                 nj.recurso, nj.recurso_id, nj.versao, nj.cupom_id, nj.pedido_id,
                 n.atualizado_em as limite, nj.recurso is not null as avisar
            from integracao_webhook w
            join pa on pa.cliente = w.cliente
            join integracao_token_loja t on t.id = w.token_id
            join integracao_ligacao l
              on l.id = w.token_id and l.tenant_id = w.tenant_id and l.revogado_em is null and l.aplicativo = pa.client_id
             and coalesce(l.ultimo_uso_em, l.criado_em) > now() - make_interval(days => ${POLITICA_LIGACAO.suspensaoParadaDias})
           cross join lateral (
                  select array(select unnest(t.escopos) intersect select unnest(pa.escopos)) as escopos,
                         coalesce(t.ler_desde, t.criado_em) as inicio
                 ) pe
           cross join lateral (${this.sqlDasPermissoes(sql`pe.escopos`)}) p
           cross join lateral ${this.sqlDaNovidade(null)} n
            left join lateral ${this.sqlDaNovidade(sql`pe.inicio`)} nj on true
           where w.pausado_em is null
             and w.proxima_verificacao_em <= now()
             and ${ACESSO_VIVO}
             ${this.escopo(sql`w.tenant_id`, e)}
           order by w.proxima_verificacao_em
           limit ${lote}
        ), andou as (
          update integracao_webhook w
             set avisado_ate = greatest(w.avisado_ate, nov.limite)
            from nov
           where w.token_id = nov.token_id
             and not nov.avisar
             and w.pausado_em is null
             and w.proxima_verificacao_em <= now()
          returning w.token_id
        ), res as (
          update integracao_webhook w
             set proxima_verificacao_em = now() + make_interval(secs => ${RESERVA_SEG})
            from nov
           where w.token_id = nov.token_id
             and nov.avisar
             and w.pausado_em is null
             and w.proxima_verificacao_em <= now()
          returning w.token_id, w.tenant_id, w.unidade_id, w.cliente, w.url, w.segredo_cifrado, w.falhas_seguidas,
                    extract(epoch from (now() - w.primeira_falha_em))::float8 as falhando_ha
        )
        select res.token_id::text as token_id, nov.token_prefixo, res.tenant_id::text as tenant_id, res.unidade_id::text as unidade_id,
               res.cliente, res.url,
               res.segredo_cifrado, res.falhas_seguidas, res.falhando_ha,
               nov.recurso, nov.recurso_id::text as recurso_id, nov.versao::text as versao,
               ${sqlIso(sql`nov.limite`)} as ate, nov.cupom_id, nov.pedido_id,
               nov.client_id, nov.ligacao_prefixo
          from res
          join nov on nov.token_id = res.token_id`),
    ) as Devido[];
  }

  /**
   * Manda um aviso e grava o resultado. Nunca rejeita (V3): devolve se foi entregue. `ligacaoPrefixo`: o da ligação do
   * DMS ID da mesma linha, quando há (vai ao registro do hub no lugar do prefixo do token).
   */
  private async enviar(l: Devido, ligacaoPrefixo: string | null = null): Promise<boolean> {
    // O id deste envio (o `webhook-id` que o destino recebe) é o mesmo código do registro no hub.
    const id = randomUUID();
    const inicio = Date.now();
    try {
      let status: number | null = null;
      let erro: string | null = null;
      let chave: Buffer | null = null;
      try {
        chave = chaveDoSegredo(decifrar(l.segredo_cifrado));
      } catch {
        chave = null;
      }
      if (!chave) {
        // A chave de segredos desta nuvem mudou (ou o valor foi alterado): não é falha do destino.
        await this.anotarNoHub(l, { id, inicio, status: null, pausado: true, ligacaoPrefixo });
        await this.gravarPausa(l, null, 'o segredo guardado não abre mais neste servidor — registre o aviso de novo');
        return false;
      }
      const corpo = JSON.stringify(
        corpoDoAviso(
          {
            recurso: l.recurso,
            id: l.recurso_id ?? null,
            versao: l.versao === null || l.versao === undefined ? null : Number(l.versao),
            cupom_id: l.cupom_id,
            pedido_id: l.pedido_id,
          },
          l.unidade_id,
        ),
      );
      if (l.client_id) {
        // O aplicativo de PARCEIRO: o envio seguro (resolve, confere todos os IPs, conecta no IP conferido, sem
        // redirecionamento, prazo total). Nunca rejeita; o nome que passou a apontar para dentro volta como erro (recuo).
        const r = await enviarComSeguranca(l.url, cabecalhosDoAviso(chave, id, corpo), corpo, this.opcoesDoParceiro());
        status = r.status;
        if (status === null) erro = (r.erro ?? 'falha de conexão').slice(0, 300);
        else if (status < 200 || status >= 300) erro = `o destino respondeu ${status}`;
      } else {
        try {
          // `redirect: 'manual'`: o endereço foi conferido na entrada; um redirecionamento do destino
          // não leva o aviso (nem a assinatura) para outro lugar.
          const r = await fetchExterno(
            l.url,
            { method: 'POST', headers: cabecalhosDoAviso(chave, id, corpo), body: corpo, redirect: 'manual' },
            this.prazoEnvioMs,
          );
          status = r.status;
          await r.body?.cancel().catch(() => undefined);
          if (status < 200 || status >= 300) erro = `o destino respondeu ${status}`;
        } catch (e: any) {
          erro = String(e?.message ?? e).slice(0, 300);
        }
      }

      const d = desfechoDoEnvio({ status, falhasSeguidas: Number(l.falhas_seguidas ?? 0), falhandoHaSeg: l.falhando_ha });
      await this.anotarNoHub(l, { id, inicio, status, pausado: d.resultado === 'pausa', ligacaoPrefixo });
      if (d.resultado === 'entregue') {
        await this.db.execute(sql`
          update integracao_webhook
             set avisado_ate = greatest(avisado_ate, ${l.ate}::timestamptz),
                 proxima_verificacao_em = now() + make_interval(secs => ${this.intervaloSeg}),
                 falhas_seguidas = 0, primeira_falha_em = null,
                 ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = null,
                 entregues = entregues + 1
           where token_id = ${l.token_id}::uuid`);
        return true;
      }
      if (d.resultado === 'pausa') {
        await this.gravarPausa(l, status, d.motivo);
        return false;
      }
      await this.db.execute(sql`
        update integracao_webhook
           set falhas_seguidas = falhas_seguidas + 1,
               primeira_falha_em = coalesce(primeira_falha_em, now()),
               proxima_verificacao_em = now() + make_interval(secs => ${d.recuoSeg}),
               ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = ${erro}
         where token_id = ${l.token_id}::uuid`);
      this.log.warn(
        `aviso ao ${l.cliente} (empresa ${l.tenant_id}) não entregue: ${erro} — tento de novo em ${Math.round(d.recuoSeg / 60)} min`,
      );
      return false;
    } catch (e: any) {
      // Falhou ao gravar o resultado: a reserva (2 min) devolve a loja à fila sozinha.
      this.log.error(`aviso do token ${l.token_id}: resultado não gravado — ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
      return false;
    }
  }

  // ───────────────────────────── o aplicativo de parceiro (F4 parte F, R2) ─────────────────────────────

  // O job dos avisos de parceiro: o relógio e a trava são dele. Um destino de parceiro fora do ar (ou uma tabela que só
  // esta fase lê, ausente) nunca atrasa nem para os avisos dos produtos da DMS. Só na NUVEM, como o outro.
  @Interval(15000)
  async tickParceiros(): Promise<void> {
    if (ehServidorLocal() || this.rodandoParceiros || Date.now() < this.parceirosPausadosAte) return;
    this.rodandoParceiros = true;
    try {
      if (Date.now() >= this.limpezaParceirosEm) {
        this.limpezaParceirosEm = Date.now() + LIMPEZA_INTERVALO_MS;
        await this.limparParceiros();
      }
      await this.cicloParceiros();
    } catch (e: any) {
      const codigo = codigoPg(e);
      if (codigo === '42P01' || codigo === '42703') {
        this.parceirosPausadosAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(
          `avisos de aplicativo de parceiro parados por 10 min: ${e?.message ?? e} — aplique as migrations 329 e 340 na nuvem (os avisos dos produtos da DMS seguem)`,
        );
      } else {
        this.log.error(`ciclo dos avisos de parceiro falhou: ${codigo ? `[${codigo}] ` : ''}${e?.message ?? e}`, e?.stack);
      }
    } finally {
      this.rodandoParceiros = false;
    }
  }

  /**
   * A linha de parceiro sem ligação viva: a revogada (ou que não existe) sai, com o segredo; a parada há 90 dias é pausada
   * com o motivo (a porta recusa essa ligação; volta só com um clique novo da loja, que cria outro acesso). A linha com o
   * token revogado ou vencido sai pela limpeza de sempre (`limpar`).
   */
  async limparParceiros(e?: EscopoAviso): Promise<{ apagadas: number; pausadas: number }> {
    const apagadas: any = await this.db.execute(sql`
      delete from integracao_webhook w
       where w.cliente ~ '^parceiro_'
         and not exists (select 1 from integracao_ligacao l where l.id = w.token_id and l.revogado_em is null)
         ${this.escopo(sql`w.tenant_id`, e)}`);
    const pausadas: any = await this.db.execute(sql`
      update integracao_webhook w
         set pausado_em = now(),
             motivo_pausa = ${MOTIVO_LIGACAO_SUSPENSA},
             ultimo_erro = ${MOTIVO_LIGACAO_SUSPENSA}
        from integracao_ligacao l
       where l.id = w.token_id
         and w.cliente ~ '^parceiro_'
         and w.pausado_em is null
         and coalesce(l.ultimo_uso_em, l.criado_em) <= now() - make_interval(days => ${POLITICA_LIGACAO.suspensaoParadaDias})
         ${this.escopo(sql`w.tenant_id`, e)}`);
    return { apagadas: Number(apagadas?.rowCount ?? 0), pausadas: Number(pausadas?.rowCount ?? 0) };
  }

  /**
   * Os aplicativos de parceiro que entram na fila agora: os da lista de aprovados (a chave, o hub e a parada lida — as
   * guardas de `parceirosAprovados`), menos os da DMS (o client_id que a distribuição cadastrou para um produto nunca é
   * parceiro), menos os parados pelo client_id (geral ou de aplicativo), e só com alguma permissão que vale.
   */
  private parceirosNaFila(): ParceiroNaFila[] {
    const hub = this.hub;
    if (!hub) return [];
    const aprovados = hub.parceirosAprovados();
    if (!aprovados.length) return [];
    const cfg = lerConfigDmsId();
    const daDms = new Set(cfg.ligado ? Object.values(cfg.aplicativos) : []);
    return aprovados
      .filter((a) => !daDms.has(a.aplicativo) && hub.parado({ aplicativo: a.aplicativo }) === null)
      .map((a) => ({ cliente: clienteDoParceiro(a.aplicativo), clientId: a.aplicativo, escopos: permissoesDoParceiro(a) as string[] }))
      .filter((p) => p.escopos.length > 0);
  }

  /** Um ciclo dos avisos de parceiro: reserva e manda, até acabar ou o tempo do ciclo. Nada aprovado: nem consulta. */
  async cicloParceiros(e?: EscopoAviso, orcamentoMs = ORCAMENTO_PARCEIRO_MS): Promise<{ enviados: number; entregues: number }> {
    const fim = Date.now() + orcamentoMs;
    let enviados = 0;
    let entregues = 0;
    if (!aceitaIntegracoes()) return { enviados, entregues };
    const parceiros = this.parceirosNaFila();
    if (!parceiros.length) return { enviados, entregues };
    for (;;) {
      const lote = await this.reservarParceiros(e, LOTE_PARCEIRO, parceiros);
      if (!lote.length) break;
      const r = await this.entregarAoParceiro(lote, fim);
      enviados += r.enviados;
      entregues += r.entregues;
      if ((r.enviados && !r.entregues) || lote.length < LOTE_PARCEIRO || Date.now() > fim) break;
    }
    return { enviados, entregues };
  }

  /**
   * Manda o lote reservado do parceiro. Antes de cada envio, de novo: o aplicativo ainda aprovado (caiu entre a reserva e o
   * envio → volta em 30 s, sem pausar) e o endereço dentro de uma base da lista de hoje (saiu → pausa com o motivo, sem
   * contar falha do destino). A parada do hub (ligação, tipo) como nos produtos da DMS. DISJUNTOR por origem: no máximo um
   * envio em curso por servidor de destino; a primeira falha de um servidor solta as outras linhas dele por 30 s (sem
   * contar falha). O que o tempo do ciclo não alcança volta à fila na hora.
   */
  private async entregarAoParceiro(lote: Devido[], fim: number): Promise<{ enviados: number; entregues: number }> {
    const soltar: string[] = [];
    let fila: Devido[] = [];
    for (const l of lote) {
      const aprovado = l.client_id ? (this.hub?.parceiroAprovado(l.client_id) ?? null) : null;
      if (!aprovado) {
        soltar.push(l.token_id);
        continue;
      }
      if (!enderecoDoParceiro(l.url, basesDoParceiro(aprovado, dominiosProibidosDoAmbiente()))) {
        await this.anotarNoHub(l, { id: randomUUID(), inicio: Date.now(), status: null, pausado: true, ligacaoPrefixo: l.ligacao_prefixo ?? null });
        await this.pausarSemFalha(l, MOTIVO_BASE_FORA_DA_LISTA);
        continue;
      }
      const parada = this.hub?.avisoParado({
        aplicativo: l.client_id as string,
        ligacaoPrefixos: [l.token_prefixo, l.ligacao_prefixo ?? undefined],
        tipo: tipoDoAviso(l.recurso),
      });
      if (parada) soltar.push(l.token_id);
      else fila.push(l);
    }
    let enviados = 0;
    let entregues = 0;
    const caidas = new Set<string>();
    const devolver: string[] = [];
    while (fila.length) {
      if (Date.now() > fim) {
        devolver.push(...fila.map((l) => l.token_id));
        break;
      }
      const rodada: Devido[] = [];
      const resto: Devido[] = [];
      const naRodada = new Set<string>();
      for (const l of fila) {
        const origem = origemDoEndereco(l.url);
        if (caidas.has(origem)) soltar.push(l.token_id);
        else if (naRodada.has(origem) || rodada.length >= EM_PARALELO) resto.push(l);
        else {
          naRodada.add(origem);
          rodada.push(l);
        }
      }
      const r = await Promise.all(rodada.map((l) => this.enviar(l, l.ligacao_prefixo ?? null)));
      rodada.forEach((l, i) => {
        if (!r[i]) caidas.add(origemDoEndereco(l.url));
      });
      enviados += rodada.length;
      entregues += r.filter(Boolean).length;
      fila = resto;
    }
    if (soltar.length) await this.soltarParados(soltar);
    if (devolver.length) await this.devolverAFila(devolver);
    return { enviados, entregues };
  }

  /** Pausa sem contar falha do destino (o motivo é de cá: a base saiu da lista). Um registro novo religa. */
  private async pausarSemFalha(l: Devido, motivo: string): Promise<void> {
    await this.db.execute(sql`
      update integracao_webhook
         set pausado_em = now(), motivo_pausa = ${motivo}, ultimo_erro = ${motivo}
       where token_id = ${l.token_id}::uuid`);
    this.log.warn(`aviso ao aplicativo de parceiro ${l.client_id ?? l.cliente} (empresa ${l.tenant_id}) PAUSADO: ${motivo}`);
  }

  /** Devolve à fila, já na vez, as linhas reservadas que o tempo do ciclo não alcançou (sem esperar os 2 min da reserva). */
  private async devolverAFila(tokenIds: string[]): Promise<void> {
    const ids = sql.join(
      tokenIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await this.db.execute(sql`update integracao_webhook set proxima_verificacao_em = now() where token_id in (${ids})`);
  }

  // ───────────────────────────── o hub (F3, parte D) ─────────────────────────────

  /** Os aplicativos parados no geral ou pelo nome, pela última lista do hub. Hub desligado: nenhum. */
  private aplicativosParados(): string[] {
    const hub = this.hub;
    if (!hub?.ligado) return [];
    return Object.keys(CLIENTES_INTEGRACAO).filter((cliente) => hub.parado({ aplicativo: cliente }) !== null);
  }

  /**
   * O prefixo da ligação do DMS ID de cada linha do lote que tem uma ativa (a ligação é a mesma linha do token: o mesmo
   * id). Uma consulta por lote, e só com o hub ligado. Sem a tabela da 329 ou com erro: nenhum (a parada e o registro
   * seguem pelo prefixo do token).
   */
  private async prefixosDasLigacoes(lote: Devido[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    if (!this.hub?.ligado || !lote.length) return m;
    try {
      const ids = sql.join(
        lote.map((l) => sql`${l.token_id}::uuid`),
        sql`, `,
      );
      const r = await this.db.execute(sql`select id::text as id, prefixo from integracao_ligacao where revogado_em is null and id in (${ids})`);
      for (const x of this.rows(r)) m.set(String(x.id), String(x.prefixo));
    } catch (e: any) {
      if (e?.code !== '42P01') this.log.warn(`prefixos das ligações para os avisos não lidos: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    }
    return m;
  }

  /** Solta a reserva das lojas paradas pelo hub: voltam em 30 s, sem contar falha e sem andar a posição. */
  private async soltarParados(tokenIds: string[]): Promise<void> {
    const ids = sql.join(
      tokenIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await this.db.execute(sql`
      update integracao_webhook
         set proxima_verificacao_em = now() + make_interval(secs => ${ESPERA_PARADO_SEG})
       where token_id in (${ids})`);
  }

  /** O envio no registro do hub. Nunca rejeita (V3); hub desligado: nada. */
  private async anotarNoHub(
    l: Devido,
    a: { id: string; inicio: number; status: number | null; pausado: boolean; ligacaoPrefixo: string | null },
  ): Promise<void> {
    const hub = this.hub;
    if (!hub?.ligado) return;
    try {
      const aviso = montarAviso({
        codigo: a.id,
        inicio: a.inicio,
        agora: Date.now(),
        // o parceiro é registrado (e parado) no hub pelo client_id; os produtos da DMS, pelo `cliente`
        aplicativo: aplicativoNoHub(l.cliente, l.client_id),
        prefixo: a.ligacaoPrefixo ?? l.token_prefixo,
        conta: l.unidade_id ?? l.tenant_id,
        contaNome: await hub.nomeDaConta(l.tenant_id, l.unidade_id),
        tipo: tipoDoAviso(l.recurso),
        url: l.url,
        status: a.status,
        pausado: a.pausado,
        tentativa: Number(l.falhas_seguidas ?? 0) + 1,
      });
      if (aviso) hub.registrarAviso(aviso);
    } catch (e: any) {
      this.log.warn(`aviso ao ${l.cliente}: o registro no hub não saiu (${e?.message ?? e})`);
    }
  }

  private async gravarPausa(l: Devido, status: number | null, motivo: string): Promise<void> {
    await this.db.execute(sql`
      update integracao_webhook
         set pausado_em = now(), motivo_pausa = ${motivo},
             falhas_seguidas = falhas_seguidas + 1,
             primeira_falha_em = coalesce(primeira_falha_em, now()),
             ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = ${motivo}
       where token_id = ${l.token_id}::uuid`);
    this.log.warn(`aviso ao ${l.cliente} (empresa ${l.tenant_id}) PAUSADO: ${motivo}. Um registro novo religa.`);
  }
}

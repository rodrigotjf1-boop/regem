import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { gerarChave, POLITICA_LIGACAO, problemaDaParada, type AplicativoAprovado } from '../../dms/integracao-dms';
import { conferirSenhaDoColaborador } from '../../common/senha-do-colaborador';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { anotarChamada } from './chamada-integracao';
import {
  APLICATIVOS_DO_CLIQUE,
  APLICATIVO_PARADO,
  APLICATIVO_SEM_CLIQUE,
  CLIQUE_DESLIGADO,
  CODIGO_INVALIDO,
  CORRIDA_DA_TROCA,
  MAX_ERROS_SENHA_AUTORIZACAO,
  MINUTOS_TRAVA_AUTORIZACAO,
  PEDIDO_INVALIDO,
  SO_O_PRESIDENTE,
  VALIDADE_DO_PEDIDO_MS,
  conferirPedido,
  emissorDoRegem,
  formatoDoPedido,
  fraseDe,
  fraseDaSenhaErrada,
  fraseDaTrava,
  gerarPedido,
  hashDoPedido,
  lerConfigClique,
  minutosDaTrava,
  naOrdemDoCatalogo,
  type AplicativoDoClique,
  type ConfigClique,
  type ContaQuePede,
} from './autorizacao-clique.regras';
import { montarTela, textoGuardado, type TelaDaAutorizacao } from './autorizacao-clique.tela';
import {
  clienteAutorizacao,
  formatoCodigoAutorizacao,
  gerarCodigoAutorizacao,
  hashCodigoAutorizacao,
  urlDeVolta,
  verificadorConfere,
} from './autorizacao-loja';
import { avisarAutorizacaoPorClique } from './aviso-ligacao';
import { DmsIdService, type TokenDmsIdDoRegem } from './dms-id.service';
import type { EscopoIntegracao } from './escopos';
import { HubDmsService } from './hub-dms.service';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { IntegracaoTokenService, type Autorizador } from './integracao-token.service';
import {
  aplicativoDoClique,
  aplicativoNoHub,
  clienteDoParceiro,
  parceiroNoClique,
  permissoesDoParceiro,
  type ParceiroNoClique,
} from './parceiros.regras';
import { ProblemaException } from './problema';
import { gerarTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECARREGUE = 'Recarregue a página e decida de novo.';
const INCOMPLETO = 'O pedido chegou incompleto. Volte ao aplicativo e comece de novo.';

type PedidoGuardado = {
  id: string;
  cliente: string;
  aplicativo: string;
  redirectUri: string;
  necessarias: EscopoIntegracao[];
  opcionais: EscopoIntegracao[];
  state: string;
  desafio: string;
  contaQuePede: ContaQuePede;
};

export type SituacaoDaTela =
  | { situacao: 'indisponivel' }
  | { situacao: 'invalido'; aplicativo: { cliente: string; nome: string; inicio: string } | null }
  | { situacao: 'pausado'; aplicativo: { cliente: string; nome: string; inicio: string } }
  | { situacao: 'nao_presidente'; aplicativo: { cliente: string; nome: string; inicio: string }; pessoa: { nome: string | null; nivel: string } }
  | { situacao: 'travada'; aplicativo: { cliente: string; nome: string; inicio: string }; pessoa: { nome: string; nivel: string }; minutos: number }
  /** O aplicativo de parceiro em teste já chegou às N lojas, e esta empresa não tem nenhuma com ele (R1b). */
  | { situacao: 'limite'; aplicativo: { cliente: string; nome: string; inicio: string }; pessoa: { nome: string; nivel: string }; maximo: number; frase: string }
  | { situacao: 'escolha'; aplicativo: { cliente: string; nome: string; inicio: string }; pessoa: { nome: string; nivel: string }; tela: TelaDaAutorizacao };

/** O aplicativo do clique: o da DMS (`parceiro` nulo) ou o de parceiro aprovado, com o que a lista do hub diz dele. */
type AppDoClique = {
  cliente: string;
  clientId: string;
  app: AplicativoDoClique;
  parceiro: (ParceiroNoClique & { aprovado: AplicativoAprovado }) | null;
};

/** A frase das 3 lojas da etapa de teste (na tela, ao autorizar e na troca). */
const fraseDoLimite = (maximo: number) =>
  `Este aplicativo está em teste na DMS e já chegou ao limite de ${maximo} ${maximo === 1 ? 'loja' : 'lojas'}, somando as empresas. ` +
  'Fale com quem fez o aplicativo.';

/** A troca do parceiro que passaria do teto de lojas da etapa de teste (desfaz a transação; quem chama responde 400). */
class LimiteDeLojas extends Error {
  constructor(
    readonly maximo: number,
    readonly emUso: number,
  ) {
    super('limite de lojas do aplicativo de parceiro');
  }
}

/** O acesso de parceiro que ainda conta: a ligação viva e usada nos últimos 90 dias (a suspensa não segura vaga). */
const LIGACAO_VIVA = sql`l.revogado_em is null and coalesce(l.ultimo_uso_em, l.criado_em) > now() - make_interval(days => ${POLITICA_LIGACAO.suspensaoParadaDias})`;

/** A loja e a ligação entregues na troca: o segredo da ligação aparece só aqui. */
export type LojaLigada = Record<string, unknown> & {
  loja_id: string;
  ligacao: string;
  prefixo: string;
  permissoes: EscopoIntegracao[];
  segredo_em: string;
};

/**
 * A AUTORIZAÇÃO POR CLIQUE do Regem (Hub DMS, F3, parte C; mig 336, só nuvem; nasce desligada: `AUTORIZACAO_POR_CLIQUE`).
 *
 * O aplicativo empurra o pedido com o token do DMS ID (RFC 9126) e manda a pessoa para a página com o número; o
 * presidente confere, marca as lojas, decide as opcionais e confirma com a SENHA (nunca o PIN; 5 erradas em 15 minutos
 * travam a autorização, não a entrada); o Regem devolve um código de uso único ao endereço cadastrado, com o `iss`; o
 * servidor do aplicativo troca o código, com o PKCE e o token do DMS ID, por UMA ligação por loja. Nada nasce no clique:
 * a ligação só existe depois da troca. A loja já conectada soma o que foi liberado; o acesso antigo dela é trocado na
 * mesma transação. O contrato espelha o da B1 do RegemCast. Nem o código, nem o número do pedido, nem a senha, nem o
 * segredo vão para log, erro ou auditoria.
 */
@Injectable()
export class AutorizacaoCliqueService {
  private readonly log = new Logger('AutorizacaoClique');
  private lida: { chave: string; config: ConfigClique } | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly tokens: IntegracaoTokenService,
    private readonly dmsId: DmsIdService,
    private readonly hub: HubDmsService,
  ) {}

  // ───────────────────────────── configuração e peças comuns ─────────────────────────────

  /** A configuração do ambiente, relida só quando muda. A torta vai ao log uma vez. */
  get config(): ConfigClique {
    const e = process.env;
    const chave = [e.AUTORIZACAO_POR_CLIQUE, e.AUTORIZACAO_DMS_RAZAO_SOCIAL, e.AUTORIZACAO_DMS_CNPJ].join('\n');
    if (this.lida?.chave !== chave) {
      const config = lerConfigClique(e);
      if (config.motivo) this.log.error(`autorização por clique desligada: ${config.motivo}`);
      this.lida = { chave, config };
    }
    return this.lida.config;
  }

  /** Ligada só com a via do DMS ID ligada também (o pedido e a troca vêm com o token dele). */
  get ligada(): boolean {
    return this.config.ligada && this.dmsId.ligado;
  }

  private async rows(q: SQL, executor: any = this.db): Promise<any[]> {
    const r: any = await executor.execute(q);
    return r.rows ?? r;
  }

  private lista(ids: readonly string[]): SQL {
    return sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
  }

  /**
   * O aplicativo do client_id do DMS ID, se ele usa o clique. Primeiro "é da DMS?" (`DMS_ID_APLICATIVOS`): o da DMS só
   * usa o clique se estiver em `APLICATIVOS_DO_CLIQUE`, e NUNCA vira parceiro (o Farol, o GoGeM e o RegemCast ficam
   * fora, mesmo se o hub os listar). Depois o aplicativo de PARCEIRO aprovado (F4, parte F, R1b; só com
   * `PARCEIROS_LIGADOS`, o hub e a parada lida): o `cliente` dele é `clienteDoParceiro`.
   */
  private aplicativoDe(clientId: unknown): AppDoClique | null {
    if (typeof clientId !== 'string' || !clientId) return null;
    const aplicativos = this.dmsId.aplicativos;
    const cliente = Object.keys(aplicativos).find((c) => aplicativos[c] === clientId);
    if (cliente) {
      if (!Object.prototype.hasOwnProperty.call(APLICATIVOS_DO_CLIQUE, cliente)) return null;
      return { cliente, clientId, app: APLICATIVOS_DO_CLIQUE[cliente], parceiro: null };
    }
    const aprovado = this.hub.parceiroAprovado(clientId);
    const p = aprovado ? parceiroNoClique(aprovado) : null;
    if (!aprovado || !p) return null;
    return { cliente: clienteDoParceiro(clientId), clientId, app: aplicativoDoClique(p), parceiro: { ...p, aprovado } };
  }

  private enderecosDeVolta(a: AppDoClique): string[] {
    return a.parceiro ? a.parceiro.enderecos : (clienteAutorizacao(a.cliente)?.redirectUris ?? []);
  }

  /** A chave própria desligada ou o aplicativo na lista de parada do hub (o parceiro, pelo client_id). */
  private parado(a: AppDoClique, ferramenta: string): boolean {
    return !this.hub.aceitaIntegracoes || this.hub.parado({ aplicativo: aplicativoNoHub(a.cliente, a.clientId), ferramenta }) !== null;
  }

  /** Os parâmetros da volta, com o `iss` (RFC 9207) quando a via do DMS ID está ligada (é ela que dá o endereço). */
  private volta(params: Record<string, string>): Record<string, string> {
    const c = this.dmsId.config;
    return c.ligado ? { ...params, iss: emissorDoRegem(c.recurso) } : params;
  }

  /** O aplicativo nas situações da página: a chave (o selo dele), o nome e o início cadastrado (para "Voltar"). */
  private resumoDoApp(cliente: string, app: AplicativoDoClique) {
    return { cliente, nome: app.nome, inicio: app.inicio };
  }

  /** O pedido ainda valendo (não usado, não vencido, do aplicativo do token). `paraGastar` trava a linha. */
  private async lerPedido(cliente: string, clientId: string, numero: unknown, executor: any = this.db, paraGastar = false): Promise<PedidoGuardado | null> {
    if (!formatoDoPedido(numero)) return null;
    const [p] = await this.rows(
      sql`
      select id, cliente, aplicativo, redirect_uri, necessarias, opcionais, state, desafio, conta_que_pede
        from integracao_pedido
       where numero_hash = ${hashDoPedido(numero)} and cliente = ${cliente} and aplicativo = ${clientId}
         and usado_em is null and vence_em > now()
       ${paraGastar ? sql`for update` : sql``}`,
      executor,
    );
    if (!p) return null;
    return {
      id: p.id,
      cliente: p.cliente,
      aplicativo: p.aplicativo,
      redirectUri: p.redirect_uri,
      necessarias: naOrdemDoCatalogo(p.necessarias ?? []),
      opcionais: naOrdemDoCatalogo(p.opcionais ?? []),
      state: p.state,
      desafio: p.desafio,
      contaQuePede: p.conta_que_pede,
    };
  }

  /** Quem está logado, lido do cadastro de hoje. O técnico do suporte não é colaborador: `null`. */
  private async quemAutoriza(user: AuthUser): Promise<Autorizador | null> {
    if (user.categoria === 'suporte' || !UUID.test(String(user.colaboradorId))) return null;
    return this.tokens.autorizador(user.tenantId, user.colaboradorId);
  }

  /**
   * A empresa e as lojas, com o que cada uma já liberou para este aplicativo (o acesso ativo de hoje). Para o PARCEIRO
   * (R1b): só conta o acesso com a ligação viva e usada nos últimos 90 dias (o suspenso recomeça do zero, como na troca),
   * "desde" é o início da janela de leitura (a autorização contínua) e o "já liberado" é cortado pelo teto de hoje.
   */
  private async empresaELojas(tenantId: string, a: Pick<AppDoClique, 'cliente' | 'parceiro'>, executor: any = this.db) {
    const cliente = a.cliente;
    const [empresa] = await this.rows(sql`select nome, cnpj from empresa where id = ${tenantId}::uuid and deleted_at is null`, executor);
    const doAcessoAtivo = a.parceiro
      ? sql`from integracao_token_loja t
             join integracao_ligacao l on l.id = t.id and l.tenant_id = t.tenant_id and ${LIGACAO_VIVA}`
      : sql`from integracao_token_loja t`;
    const lojas = await this.rows(
      sql`
      select u.id, u.nome, u.tipo, coalesce(nullif(u.timezone, ''), 'America/Sao_Paulo') as fuso,
             d.desde, coalesce(s.escopos, '{}') as escopos
        from unidade u
        left join lateral (
          select min(${a.parceiro ? sql`coalesce(t.ler_desde, t.criado_em)` : sql`t.criado_em`}) as desde
            ${doAcessoAtivo}
           where t.tenant_id = u.tenant_id and t.unidade_id = u.id and t.cliente = ${cliente}
             and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
        ) d on true
        left join lateral (
          select array_agg(distinct e.escopo) as escopos
            ${doAcessoAtivo}
            cross join lateral unnest(t.escopos) as e(escopo)
           where t.tenant_id = u.tenant_id and t.unidade_id = u.id and t.cliente = ${cliente}
             and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
        ) s on true
       where u.tenant_id = ${tenantId}::uuid and u.deleted_at is null
       order by (u.tipo = 'matriz') desc, u.nome`,
      executor,
    );
    const valem = a.parceiro ? new Set<string>(permissoesDoParceiro(a.parceiro.aprovado)) : null;
    return {
      empresa: empresa ? { nome: empresa.nome as string, cnpj: (empresa.cnpj as string | null) ?? null } : null,
      lojas: lojas.map((l) => ({
        id: l.id as string,
        nome: l.nome as string,
        tipo: (l.tipo as string | null) ?? null,
        fuso: l.fuso as string,
        conectadaDesde: l.desde ? new Date(l.desde) : null,
        jaLiberado: ((l.escopos ?? []) as string[]).filter((e) => !valem || valem.has(e)),
      })),
    };
  }

  /**
   * As lojas que o parceiro já usa em OUTRAS empresas (para as vagas da etapa de teste na tela e ao autorizar): os acessos
   * vivos e as autorizações de lá ainda não trocadas. As desta empresa ficam de fora: marcar de novo uma loja que ele já
   * lê troca o acesso, não soma; e a autorização pendente desta empresa é a própria tentativa de antes.
   */
  private async lojasEmOutrasEmpresas(tenantId: string, cliente: string, executor: any = this.db): Promise<number> {
    const [r] = await this.rows(
      sql`
      select count(*)::int as n from (
        select t.tenant_id, t.unidade_id
          from integracao_token_loja t
          join integracao_ligacao l on l.id = t.id and l.tenant_id = t.tenant_id and ${LIGACAO_VIVA}
          join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id and u.deleted_at is null
          join empresa e on e.id = t.tenant_id and e.deleted_at is null
         where t.cliente = ${cliente} and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
           and t.tenant_id <> ${tenantId}::uuid
        union
        select a.tenant_id, x.loja
          from integracao_autorizacao a cross join lateral unnest(a.lojas) as x(loja)
         where a.cliente = ${cliente} and a.usado_em is null and a.expira_em > now() and a.texto is not null
           and a.tenant_id <> ${tenantId}::uuid
      ) z`,
      executor,
    );
    return Number(r?.n ?? 0);
  }

  private montar(
    a: AppDoClique,
    pedido: PedidoGuardado,
    dados: Awaited<ReturnType<AutorizacaoCliqueService['empresaELojas']>>,
    quem: Autorizador,
    emOutras: number | null = null,
  ) {
    const cfg = this.config;
    const maximo = a.parceiro?.lojas ?? null;
    return montarTela({
      cliente: a.cliente,
      app: a.app,
      dms: { empresa: cfg.empresa, cnpj: cfg.cnpj },
      pedido,
      empresa: dados.empresa ?? { nome: '', cnpj: null },
      lojas: dados.lojas,
      verFinanceiro: quem.verFinanceiro,
      lojasDoTeste: maximo !== null && emOutras !== null ? { maximo, emOutras } : null,
    });
  }

  // ───────────────────────────── o lado do aplicativo ─────────────────────────────

  /**
   * `POST /integracao/autorizacao/pedido`: o aplicativo empurra o pedido (RFC 9126). Devolve o número de uso único, que
   * vence em 10 minutos; só o resumo dele fica gravado.
   */
  async criarPedido(doToken: TokenDmsIdDoRegem, corpo: unknown): Promise<{ request_uri: string; expires_in: number }> {
    const a = this.aplicativoDe(doToken.aplicativo);
    if (!a) throw new ProblemaException(401, 'cliente-invalido', APLICATIVO_SEM_CLIQUE);
    anotarChamada({ aplicativo: aplicativoNoHub(a.cliente, a.clientId) });
    if (this.parado(a, 'POST /integracao/autorizacao/pedido')) throw problemaDaParada();
    const c = conferirPedido(
      corpo !== null && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : {},
      a.app,
      doToken.aplicativo,
      this.enderecosDeVolta(a),
    );
    if ('erro' in c) throw new ProblemaException(400, 'parametro-invalido', c.erro);

    // Pedidos vencidos há mais de um dia saem aqui (não há rotina para isso). Nunca derruba o pedido.
    await this.db
      .execute(sql`delete from integracao_pedido where vence_em < now() - interval '1 day'`)
      .catch((e: any) => this.log.warn(`limpeza dos pedidos vencidos falhou: ${e?.message ?? e}`));

    const { numero, hash } = gerarPedido();
    await this.db.execute(sql`
      insert into integracao_pedido
        (cliente, aplicativo, numero_hash, redirect_uri, necessarias, opcionais, state, desafio, conta_que_pede, vence_em)
      values (${a.cliente}, ${doToken.aplicativo}, ${hash}, ${c.redirectUri}, ${`{${c.necessarias.join(',')}}`}::text[],
              ${`{${c.opcionais.join(',')}}`}::text[], ${c.state}, ${c.desafio}, ${JSON.stringify(c.contaQuePede)}::jsonb,
              now() + make_interval(secs => ${VALIDADE_DO_PEDIDO_MS / 1000}))`);
    return { request_uri: numero, expires_in: VALIDADE_DO_PEDIDO_MS / 1000 };
  }

  /**
   * `POST /integracao/autorizacao/token` com o token do DMS ID: troca o código por UMA ligação por loja. O código é gasto
   * ANTES de qualquer conferência (uma instrução: de duas trocas, só uma leva; a que falha depois também gasta), e o
   * código usado de novo desliga o que ele criou. Na transação: o acesso ativo de cada loja é trocado (revogado), e nasce
   * o novo, com o que a loja já tinha somado ao que foi liberado.
   */
  async trocarCodigo(doToken: TokenDmsIdDoRegem, corpo: unknown): Promise<{ lojas: LojaLigada[] }> {
    const a = this.aplicativoDe(doToken.aplicativo);
    if (!a) throw new ProblemaException(401, 'cliente-invalido', APLICATIVO_SEM_CLIQUE);
    anotarChamada({ aplicativo: aplicativoNoHub(a.cliente, a.clientId) });
    if (this.parado(a, 'POST /integracao/autorizacao/token')) throw problemaDaParada();
    const b = (corpo !== null && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
    const recusar = (motivo: string): never => {
      this.log.warn(`troca do código do clique recusada (${a.cliente}): ${motivo}`);
      throw new ProblemaException(400, 'autorizacao-invalida', CODIGO_INVALIDO);
    };
    if (b.client_id !== undefined && b.client_id !== doToken.aplicativo) return recusar('client_id diferente do token do DMS ID');
    if (b.grant_type !== 'authorization_code') throw new ProblemaException(400, 'parametro-invalido', 'grant_type precisa ser "authorization_code".');
    if (!formatoCodigoAutorizacao(b.code)) return recusar('código fora do formato');
    const hash = hashCodigoAutorizacao(b.code);

    const [aut] = await this.rows(sql`
      update integracao_autorizacao set usado_em = now()
       where codigo_hash = ${hash} and cliente = ${a.cliente} and usado_em is null and expira_em > now()
         and texto is not null
         and pedido_id in (select id from integracao_pedido where aplicativo = ${doToken.aplicativo})
       returning id, tenant_id, lojas, escopos, autorizado_por, desafio, redirect_uri`);
    if (!aut) {
      await this.desligarPeloReuso(hash, a.cliente);
      return recusar('código desconhecido, vencido, já usado ou de outro aplicativo');
    }
    if (b.redirect_uri !== aut.redirect_uri) return recusar('endereço de volta diferente do da autorização');
    if (!verificadorConfere(b.code_verifier, aut.desafio)) return recusar('o verificador do PKCE não confere');

    const tenantId = aut.tenant_id as string;
    // O parceiro: o que foi liberado e o que o acesso antigo tinha, cortados pelo teto de HOJE (a lista do hub pode ter
    // mudado desde o clique); o produto da DMS, como sempre.
    const valem = a.parceiro ? new Set<string>(permissoesDoParceiro(a.parceiro.aprovado)) : null;
    const cortar = (lista: readonly string[]) => (valem ? lista.filter((e) => valem.has(e)) : [...lista]);
    const liberadas = naOrdemDoCatalogo(cortar(aut.escopos ?? []));
    if (!liberadas.length) return recusar('nada do que foi liberado cabe hoje no teto do aplicativo');
    const quem = await this.tokens.autorizador(tenantId, aut.autorizado_por);
    if (!quem?.presidente) return recusar('quem autorizou deixou de ser presidente');
    if (liberadas.includes('custos.ler') && !quem.verFinanceiro) return recusar('quem autorizou perdeu "Ver valores em R$"');
    const ids = (aut.lojas ?? []) as string[];
    const lojas = await this.rows(sql`
      select u.id, u.nome from unidade u join empresa e on e.id = u.tenant_id
       where u.tenant_id = ${tenantId}::uuid and u.deleted_at is null and e.deleted_at is null and u.id in (${this.lista(ids)})
       order by (u.tipo = 'matriz') desc, u.nome`);
    if (lojas.length !== ids.length) return recusar('loja apagada depois da autorização');

    const evidencia = `autorizado pelo presidente com a senha, na autorização por clique (${aut.id})`;
    const maximo = a.parceiro?.lojas ?? null;
    let feito: { antigos: any[]; novos: { loja: { id: string; nome: string }; id: string; prefixo: string; chave: string; escopos: EscopoIntegracao[]; segredoEm: string; antes: EscopoIntegracao[] | null }[] };
    try {
      feito = await this.db.transaction(async (tx: any) => {
        // O PARCEIRO na etapa de teste (F4-12): até N lojas por aplicativo, somando as empresas. A conta que vale é esta,
        // dentro da transação e sob a trava de TRANSAÇÃO do aplicativo (V10 proíbe só a de sessão; é a técnica da V24):
        // duas trocas de empresas diferentes não passam juntas do teto. Contam os acessos vivos (a ligação suspensa não
        // segura vaga), fora as lojas desta troca, que são trocadas — e TODAS as lojas desta troca entram.
        if (a.parceiro && maximo !== null) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('parceiro-lojas'), hashtext(${a.clientId}))`);
          const [c] = await this.rows(
            sql`
            select count(*)::int as n from (
              select distinct t.tenant_id, t.unidade_id
                from integracao_token_loja t
                join integracao_ligacao l on l.id = t.id and l.tenant_id = t.tenant_id and ${LIGACAO_VIVA}
                join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id and u.deleted_at is null
                join empresa e on e.id = t.tenant_id and e.deleted_at is null
               where t.cliente = ${a.cliente} and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
                 and not (t.tenant_id = ${tenantId}::uuid and t.unidade_id in (${this.lista(ids)}))
            ) z`,
            tx,
          );
          if (Number(c?.n ?? 0) + ids.length > maximo) throw new LimiteDeLojas(maximo, Number(c?.n ?? 0));
        }
        // O parceiro: o início da janela de leitura de cada loja. Herda o do acesso que esta troca substitui, se ele
        // estava vivo (a ligação usada nos últimos 90 dias); o suspenso (ou nenhum) começa agora — e não leva as
        // permissões de antes.
        const janelas = new Map<string, { desde: string; vivo: boolean }>();
        if (a.parceiro) {
          const velhos = await this.rows(
            sql`
            select t.unidade_id,
                   to_char(min(coalesce(t.ler_desde, t.criado_em)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as desde,
                   bool_or(l.id is not null and ${LIGACAO_VIVA}) as vivo
              from integracao_token_loja t
              left join integracao_ligacao l on l.id = t.id and l.tenant_id = t.tenant_id
             where t.tenant_id = ${tenantId}::uuid and t.cliente = ${a.cliente} and t.revogado_em is null
               and t.unidade_id in (${this.lista(ids)})
             group by t.unidade_id`,
            tx,
          );
          for (const v of velhos) janelas.set(v.unidade_id, { desde: v.desde, vivo: Boolean(v.vivo) });
        }
        // O acesso ativo de cada loja com este aplicativo (o do console, o da página de 01/10 ou um clique anterior) é
        // trocado: para de valer na mesma transação em que o novo nasce. O que ele liberava continua (soma).
        const antigos = await this.rows(
          sql`
          update integracao_token_loja
             set revogado_em = now(), revogado_por = ${`autorizacao:${quem.nome}`},
                 motivo_revogacao = 'trocado pela autorização por clique'
           where tenant_id = ${tenantId}::uuid and cliente = ${a.cliente} and revogado_em is null
             and unidade_id in (${this.lista(ids)})
           returning id, unidade_id, prefixo, escopos`,
          tx,
        );
        const novos: (typeof feito)['novos'] = [];
        for (const l of lojas) {
          const janela = janelas.get(l.id) ?? null;
          const doAntigo =
            a.parceiro && !janela?.vivo ? [] : cortar(antigos.filter((t) => t.unidade_id === l.id).flatMap((t) => (t.escopos ?? []) as string[]));
          const escopos = naOrdemDoCatalogo([...doAntigo, ...liberadas]);
          const t = gerarTokenIntegracao(); // o token não sai daqui: a loja passa a ser lida pela ligação
          const [linha] = await this.rows(
            a.parceiro
              ? sql`
            insert into integracao_token_loja
              (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por, autorizado_por_nome,
               autorizado_via, evidencia, autorizacao_id, ler_desde)
            values (${tenantId}::uuid, ${l.id}::uuid, ${a.cliente}, ${t.prefixo}, ${t.hash}, ${`{${escopos.join(',')}}`}::text[],
                    ${quem.id}::uuid, ${quem.nome}, 'autorizacao_loja', ${evidencia}, ${aut.id}::uuid,
                    coalesce(${janela?.vivo ? janela.desde : null}::timestamptz, now()))
            returning id`
              : sql`
            insert into integracao_token_loja
              (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por, autorizado_por_nome,
               autorizado_via, evidencia, autorizacao_id)
            values (${tenantId}::uuid, ${l.id}::uuid, ${a.cliente}, ${t.prefixo}, ${t.hash}, ${`{${escopos.join(',')}}`}::text[],
                    ${quem.id}::uuid, ${quem.nome}, 'autorizacao_loja', ${evidencia}, ${aut.id}::uuid)
            returning id`,
            tx,
          );
          const lg = gerarChave('lg', 'regem');
          const [lig] = await this.rows(
            sql`
            insert into integracao_ligacao (id, tenant_id, aplicativo, prefixo, segredo_hash)
            values (${linha.id}::uuid, ${tenantId}::uuid, ${doToken.aplicativo}, ${lg.prefixo}, ${lg.resumo})
            returning segredo_em`,
            tx,
          );
          novos.push({
            loja: { id: l.id, nome: l.nome },
            id: linha.id,
            prefixo: lg.prefixo,
            chave: lg.chave,
            escopos,
            segredoEm: new Date(lig.segredo_em).toISOString(),
            // O acesso suspenso do parceiro não conta como "já tinha": a loja recebe o e-mail de autorização nova.
            antes: antigos.some((t) => t.unidade_id === l.id) && (!a.parceiro || janela?.vivo) ? naOrdemDoCatalogo(doAntigo) : null,
          });
        }
        return { antigos, novos };
      });
    } catch (erro: any) {
      // A corrida que só o índice único decide (duas trocas da mesma loja ao mesmo tempo): fica UM acesso ativo.
      if (erro?.code === '23505' || erro?.cause?.code === '23505') {
        this.log.warn(`troca do código do clique (${a.cliente}): outra troca da mesma loja terminou antes`);
        throw new ProblemaException(400, 'autorizacao-invalida', CORRIDA_DA_TROCA);
      }
      // O parceiro passou do teto de lojas na troca (duas empresas autorizaram juntas): nada nasceu, o código fica gasto e
      // a empresa fica com o registro (a autorização dela consta como concedida; esta linha diz por que não virou acesso).
      if (erro instanceof LimiteDeLojas) {
        this.log.warn(`troca do código do clique (${a.cliente}): o parceiro chegou ao limite de ${erro.maximo} lojas`);
        await this.auditoria.registrar({
          tenantId,
          atorTipo: 'integracao',
          tipo: 'integracao',
          acao: 'integracao.troca_recusada',
          origem: 'integracao',
          entidadeTipo: 'integracao_autorizacao',
          entidadeId: aut.id,
          detalhe: { cliente: a.cliente, motivo: 'limite_de_lojas', maximo: erro.maximo, emUso: erro.emUso, pedidas: ids.length },
        });
        throw new ProblemaException(400, 'autorizacao-invalida', fraseDoLimite(erro.maximo));
      }
      throw erro;
    }

    for (const t of feito.antigos) {
      await this.auditoria.registrar({
        tenantId,
        unidadeId: t.unidade_id,
        atorId: quem.id,
        atorPerfil: 'presidente',
        tipo: 'integracao',
        acao: 'integracao.token_revogado',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: t.id,
        detalhe: { cliente: a.cliente, prefixo: t.prefixo, por: 'autorizacao', motivo: 'trocado pela autorização por clique' },
      });
    }
    for (const n of feito.novos) {
      await this.auditoria.registrar({
        tenantId,
        unidadeId: n.loja.id,
        atorTipo: 'integracao',
        tipo: 'integracao',
        acao: 'integracao.ligacao_criada',
        origem: 'integracao',
        entidadeTipo: 'integracao_ligacao',
        entidadeId: n.id,
        detalhe: { cliente: a.cliente, prefixo: n.prefixo, escopos: n.escopos, via: 'clique', autorizacao: aut.id, loja: n.loja.nome },
      });
    }

    // O aviso aos presidentes, depois da troca: a ligação só existe agora. Nunca rejeita.
    void avisarAutorizacaoPorClique(this.db, {
      tenantId,
      cliente: a.cliente,
      porNome: quem.nome,
      autorizacaoId: aut.id,
      lojas: feito.novos.map((n) => ({ id: n.loja.id, nome: n.loja.nome, escopos: n.escopos, antes: n.antes })),
    });

    const saida: LojaLigada[] = [];
    for (const n of feito.novos) {
      const ctx: IntegracaoCtxData = {
        tokenId: n.id,
        tenantId,
        unidadeId: n.loja.id,
        abrangencia: 'loja',
        lojaUnica: lojas.length === 1,
        escopos: n.escopos,
        cliente: a.cliente,
        autorizadoPor: quem.id,
        prefixo: n.prefixo,
      };
      saida.push({ ...(await this.tokens.dadosDaLoja(ctx)), loja_id: n.loja.id, ligacao: n.chave, prefixo: n.prefixo, permissoes: n.escopos, segredo_em: n.segredoEm });
    }
    return { lojas: saida };
  }

  /**
   * O código do clique usado de novo: desliga o que ele criou (alguém copiou o código no caminho, ou a resposta voltou
   * duas vezes). Nunca rejeita: a resposta ao segundo uso é sempre a mesma recusa.
   */
  private async desligarPeloReuso(hash: string, cliente: string): Promise<void> {
    try {
      const [a] = await this.rows(sql`
        select id, tenant_id from integracao_autorizacao
         where codigo_hash = ${hash} and cliente = ${cliente} and usado_em is not null and texto is not null`);
      if (!a) return;
      const revogados = await this.rows(sql`
        update integracao_token_loja
           set revogado_em = now(), revogado_por = 'integracao:codigo-reutilizado',
               motivo_revogacao = 'o código de autorização foi usado duas vezes'
         where autorizacao_id = ${a.id}::uuid and revogado_em is null
         returning id, unidade_id, prefixo`);
      for (const t of revogados) {
        await this.auditoria.registrar({
          tenantId: a.tenant_id,
          unidadeId: t.unidade_id,
          atorTipo: 'sistema',
          tipo: 'integracao',
          acao: 'integracao.ligacao_revogada',
          origem: 'integracao',
          entidadeTipo: 'integracao_ligacao',
          entidadeId: t.id,
          detalhe: { cliente, prefixo: t.prefixo, motivo: 'codigo_reutilizado', autorizacao: a.id },
        });
      }
    } catch (e: any) {
      this.log.warn(`código do clique reutilizado: não deu para desligar o que ele criou (${e?.message ?? e})`);
    }
  }

  // ───────────────────────────── o lado de quem está logado ─────────────────────────────

  /** `GET /integracoes/autorizacao`: o que a página mostra, em uma das situações. */
  async lerParaTela(user: AuthUser, q: any): Promise<SituacaoDaTela> {
    if (!this.ligada) return { situacao: 'indisponivel' };
    const a = this.aplicativoDe(q?.client_id);
    if (!a) return { situacao: 'invalido', aplicativo: null };
    const aplicativo = this.resumoDoApp(a.cliente, a.app);
    const pedido = await this.lerPedido(a.cliente, q.client_id, q?.request_uri);
    if (!pedido) return { situacao: 'invalido', aplicativo };
    if (this.parado(a, 'GET /integracoes/autorizacao')) return { situacao: 'pausado', aplicativo };
    const quem = await this.quemAutoriza(user);
    if (!quem?.presidente) return { situacao: 'nao_presidente', aplicativo, pessoa: { nome: quem?.nome ?? user.nome ?? null, nivel: user.categoria } };
    const pessoa = { nome: quem.nome, nivel: user.categoria };
    const [trava] = await this.rows(sql`
      select travada_ate from integracao_autorizacao_trava
       where colaborador_id = ${quem.id}::uuid and travada_ate > now()`);
    if (trava) return { situacao: 'travada', aplicativo, pessoa, minutos: minutosDaTrava(new Date(trava.travada_ate)) };
    const dados = await this.empresaELojas(user.tenantId, a);
    const maximo = a.parceiro?.lojas ?? null;
    const emOutras = maximo !== null ? await this.lojasEmOutrasEmpresas(user.tenantId, a.cliente) : null;
    // Sem vaga e sem nenhuma loja desta empresa que ele já leia: não há o que marcar (a que ele já lê sempre pode).
    if (maximo !== null && (emOutras as number) >= maximo && !dados.lojas.some((l) => l.conectadaDesde)) {
      return { situacao: 'limite', aplicativo, pessoa, maximo, frase: fraseDoLimite(maximo) };
    }
    return { situacao: 'escolha', aplicativo, pessoa, tela: this.montar(a, pedido, dados, quem, emOutras) };
  }

  /**
   * A senha de quem clicou, com a trava da autorização: 5 erradas em 15 minutos travam por 15 minutos, separada da entrada
   * no Regem. A senha é conferida mesmo com a trava (o tempo da resposta não a revela), e a conta da senha errada roda
   * fora da transação de quem chama (sobrevive à recusa).
   */
  private async conferirSenha(tenantId: string, quem: Autorizador, senha: unknown): Promise<void> {
    const confere = await conferirSenhaDoColaborador(this.db, tenantId, quem.id, senha);
    const [t] = await this.rows(sql`
      select travada_ate, erros from integracao_autorizacao_trava where colaborador_id = ${quem.id}::uuid`);
    if (t?.travada_ate && new Date(t.travada_ate).getTime() > Date.now()) {
      throw new HttpException(fraseDaTrava(minutosDaTrava(new Date(t.travada_ate))), 423);
    }
    if (!confere) {
      const [n] = await this.rows(sql`
        insert into integracao_autorizacao_trava as tr (colaborador_id, tenant_id, erros, erro_em, travada_ate)
        values (${quem.id}::uuid, ${tenantId}::uuid, 1, now(), null)
        on conflict (colaborador_id) do update
           set erros = case when tr.erro_em is null or tr.erro_em < now() - make_interval(mins => ${MINUTOS_TRAVA_AUTORIZACAO})
                            then 1 else tr.erros + 1 end,
               erro_em = now(),
               travada_ate = case when (case when tr.erro_em is null or tr.erro_em < now() - make_interval(mins => ${MINUTOS_TRAVA_AUTORIZACAO})
                                             then 1 else tr.erros + 1 end) >= ${MAX_ERROS_SENHA_AUTORIZACAO}
                                  then now() + make_interval(mins => ${MINUTOS_TRAVA_AUTORIZACAO}) else tr.travada_ate end
        returning erros, travada_ate`);
      await this.auditoria.registrar({
        tenantId,
        atorId: quem.id,
        atorPerfil: 'presidente',
        tipo: 'integracao',
        acao: Number(n?.erros) >= MAX_ERROS_SENHA_AUTORIZACAO ? 'integracao.autorizacao_travada' : 'integracao.autorizacao_senha_errada',
        origem: 'web',
        entidadeTipo: 'colaborador',
        entidadeId: quem.id,
        detalhe: { erros: Number(n?.erros) || 1 },
      });
      if (Number(n?.erros) >= MAX_ERROS_SENHA_AUTORIZACAO) throw new HttpException(fraseDaTrava(MINUTOS_TRAVA_AUTORIZACAO), 423);
      throw new UnprocessableEntityException(fraseDaSenhaErrada(Number(n?.erros) || 1));
    }
    if (t && (Number(t.erros) > 0 || t.travada_ate)) {
      await this.db.execute(sql`
        update integracao_autorizacao_trava set erros = 0, erro_em = null, travada_ate = null
         where colaborador_id = ${quem.id}::uuid`);
    }
  }

  private corpoDeAutorizar(dto: any) {
    const d = dto !== null && typeof dto === 'object' ? dto : {};
    const texto = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
    if (!texto(d.clientId, 200) || !texto(d.requestUri, 200)) throw new BadRequestException(INCOMPLETO);
    if (typeof d.senha !== 'string' || d.senha.length < 1 || d.senha.length > 200) {
      throw new BadRequestException('Digite a sua senha do Regem para autorizar.');
    }
    if (!Array.isArray(d.lojas) || !d.lojas.length) throw new BadRequestException('Marque ao menos uma loja.');
    if (d.lojas.length > 200) throw new BadRequestException('Lojas demais numa autorização só (até 200).');
    const lojas = [...new Set(d.lojas.map((i: unknown) => String(i).toLowerCase()))] as string[];
    if (lojas.some((i) => !UUID.test(i))) throw new BadRequestException('Loja inválida.');
    if (!Array.isArray(d.opcionais) || d.opcionais.length > 20 || d.opcionais.some((o: unknown) => typeof o !== 'string')) {
      throw new BadRequestException(RECARREGUE);
    }
    if (typeof d.confirmoOutraEmpresa !== 'boolean') throw new BadRequestException(RECARREGUE);
    // O resumo do texto que a página mostrou (só a tela do parceiro o traz; ausente nos produtos da DMS).
    if (d.resumo !== undefined && !texto(d.resumo, 100)) throw new BadRequestException(RECARREGUE);
    return {
      clientId: d.clientId as string,
      requestUri: d.requestUri as string,
      senha: d.senha as string,
      lojas,
      opcionais: [...new Set(d.opcionais as string[])],
      confirmoOutraEmpresa: d.confirmoOutraEmpresa as boolean,
      resumo: (d.resumo as string | undefined) ?? null,
    };
  }

  /**
   * `POST /integracoes/autorizacao`: o presidente autoriza com a senha. Grava a prova (o texto que ele viu, com a versão,
   * e a decisão), gasta o pedido e devolve o endereço cadastrado com o código, o state e o `iss`.
   */
  async autorizar(user: AuthUser, dto: any, origem: { ip?: string | null; navegador?: string | null } = {}): Promise<{ redirect: string }> {
    if (!this.ligada) throw new NotFoundException(CLIQUE_DESLIGADO);
    const d = this.corpoDeAutorizar(dto);
    const a = this.aplicativoDe(d.clientId);
    if (!a) throw new GoneException(PEDIDO_INVALIDO);
    if (this.parado(a, 'POST /integracoes/autorizacao')) throw new ServiceUnavailableException(APLICATIVO_PARADO);
    const quem = await this.quemAutoriza(user);
    if (!quem) throw new UnauthorizedException('Entre de novo para continuar.');
    if (!quem.presidente) throw new ForbiddenException(SO_O_PRESIDENTE);
    // A senha ANTES da validade do pedido: a senha errada num pedido vencido também conta para a trava.
    await this.conferirSenha(user.tenantId, quem, d.senha);

    const gerado = gerarCodigoAutorizacao();
    const r = await this.db.transaction(async (tx: any) => {
      const pedido = await this.lerPedido(a.cliente, d.clientId, d.requestUri, tx, true);
      if (!pedido) throw new GoneException(PEDIDO_INVALIDO);
      if (d.opcionais.some((o) => !pedido.opcionais.includes(o as EscopoIntegracao))) {
        throw new BadRequestException(`A escolha trouxe uma permissão que o aplicativo não pediu. ${RECARREGUE}`);
      }
      const ligadas = naOrdemDoCatalogo(d.opcionais);
      const travadas = ligadas.filter((o) => a.app.financeiras.includes(o)) as EscopoIntegracao[];
      if (travadas.length && !quem.verFinanceiro) {
        throw new BadRequestException(
          `Seu perfil não tem "Ver valores em R$": ${(fraseDe(a.app, travadas[0])?.naFrase ?? travadas[0])} não pode ser liberado.`,
        );
      }
      const dados = await this.empresaELojas(user.tenantId, a, tx);
      const marcadas = dados.lojas.filter((l) => d.lojas.includes(l.id));
      if (marcadas.length !== d.lojas.length) throw new BadRequestException('Loja não encontrada nesta empresa.');
      const maximo = a.parceiro?.lojas ?? null;
      const emOutras = maximo !== null ? await this.lojasEmOutrasEmpresas(user.tenantId, a.cliente, tx) : null;
      const tela = this.montar(a, pedido, dados, quem, emOutras);
      // O parceiro: o texto que o presidente leu é o desta tela? A lista do hub pode ter mudado entre abrir e clicar
      // (o nome, a empresa, o "para que serve", as permissões) — a prova tem de ser o que ele viu.
      if (a.parceiro && tela.resumo !== d.resumo) {
        throw new ConflictException('O texto desta autorização mudou desde que a página abriu. Recarregue e confira de novo.');
      }
      // As vagas da etapa de teste: as lojas marcadas (as desta empresa que ele já lê são trocadas, entram na conta) mais
      // as que ele já usa em outras empresas. A conta que vale de verdade é a da troca, sob trava.
      if (maximo !== null && (emOutras as number) + marcadas.length > maximo) {
        throw new BadRequestException(
          (emOutras as number) >= maximo
            ? fraseDoLimite(maximo)
            : `Este aplicativo está em teste na DMS e pode ler até ${maximo} lojas no total, somando as empresas: aqui, marque até ${maximo - (emOutras as number)}.`,
        );
      }
      // A confirmação vale pela TELA: o parceiro a tem sempre; o produto da DMS, quando a conta é de outra empresa.
      if (tela.confirmacao && d.confirmoOutraEmpresa !== true) {
        throw new BadRequestException('Marque a confirmação para ligar a conta de outra empresa.');
      }
      const escopos = naOrdemDoCatalogo([...pedido.necessarias, ...ligadas]);
      const desligadas = pedido.opcionais.filter((o) => !ligadas.includes(o));
      const texto = textoGuardado(tela, { lojas: d.lojas, ligadas, confirmouOutraEmpresa: d.confirmoOutraEmpresa });
      const [nova] = await this.rows(
        sql`
        insert into integracao_autorizacao
          (tenant_id, cliente, codigo_hash, desafio, redirect_uri, lojas, escopos, autorizado_por, autorizado_por_nome,
           expira_em, pedido_id, conta_que_pede, outra_empresa, opcionais_desligados, texto_versao, texto)
        values (${user.tenantId}::uuid, ${a.cliente}, ${gerado.hash}, ${pedido.desafio}, ${pedido.redirectUri},
                ${`{${d.lojas.join(',')}}`}::uuid[], ${`{${escopos.join(',')}}`}::text[], ${quem.id}::uuid, ${quem.nome},
                now() + interval '10 minutes', ${pedido.id}::uuid, ${JSON.stringify(pedido.contaQuePede)}::jsonb,
                ${tela.confirmacao !== null}, ${`{${desligadas.join(',')}}`}::text[], ${tela.versao},
                ${JSON.stringify(texto)}::jsonb)
        returning id`,
        tx,
      );
      await tx.execute(sql`update integracao_pedido set usado_em = now() where id = ${pedido.id}::uuid`);
      return { id: nova.id as string, pedido, escopos, desligadas, outra: tela.confirmacao !== null, versao: tela.versao, lojas: marcadas.map((l) => l.nome) };
    });

    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: quem.id,
      atorPerfil: user.categoria,
      tipo: 'integracao',
      acao: 'integracao.autorizacao_concedida',
      origem: 'web',
      entidadeTipo: 'integracao_autorizacao',
      entidadeId: r.id,
      detalhe: {
        cliente: a.cliente,
        via: 'clique',
        lojas: r.lojas,
        escopos: r.escopos,
        opcionaisDesligados: r.desligadas,
        outraEmpresa: r.outra,
        textoVersao: r.versao,
        ...(a.parceiro ? { classe: 'parceiro' } : {}),
        autorizadoPor: quem.nome,
        ...(origem.ip ? { ip: origem.ip } : {}),
        ...(origem.navegador ? { navegador: origem.navegador.slice(0, 300) } : {}),
      },
    });
    return { redirect: urlDeVolta(r.pedido.redirectUri, this.volta({ code: gerado.codigo, state: r.pedido.state })) };
  }

  /** `POST /integracoes/autorizacao/recusar`: "Cancelar" ou "Agora não". Gasta o pedido e volta com `access_denied`. */
  async recusar(user: AuthUser, dto: any): Promise<{ redirect: string }> {
    const d = dto !== null && typeof dto === 'object' ? dto : {};
    if (typeof d.clientId !== 'string' || d.clientId.length > 200 || typeof d.requestUri !== 'string' || d.requestUri.length > 200) {
      throw new BadRequestException(INCOMPLETO);
    }
    const a = this.aplicativoDe(d.clientId);
    if (!a || !formatoDoPedido(d.requestUri)) throw new GoneException(PEDIDO_INVALIDO);
    const [p] = await this.rows(sql`
      update integracao_pedido set usado_em = now()
       where numero_hash = ${hashDoPedido(d.requestUri)} and cliente = ${a.cliente} and aplicativo = ${d.clientId}
         and usado_em is null and vence_em > now()
       returning id, redirect_uri, state`);
    if (!p) throw new GoneException(PEDIDO_INVALIDO);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: UUID.test(String(user.colaboradorId)) ? user.colaboradorId : undefined,
      atorPerfil: user.categoria,
      tipo: 'integracao',
      acao: 'integracao.autorizacao_recusada',
      origem: 'web',
      entidadeTipo: 'integracao_pedido',
      entidadeId: p.id,
      detalhe: { cliente: a.cliente, nivel: user.categoria },
    });
    return { redirect: urlDeVolta(p.redirect_uri, this.volta({ error: 'access_denied', state: p.state })) };
  }
}

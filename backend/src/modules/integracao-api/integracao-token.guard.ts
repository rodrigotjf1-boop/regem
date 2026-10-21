import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  bearerDe,
  contarChamadaIntegracao,
  credencialDaChamada,
  esquecerTokenIntegracao,
  registrarTokenIntegracaoValidado,
} from '../../common/integracao-limite';
import { ErroTokenDmsId, problemaDaParada } from '../../dms/integracao-dms';
import { anotarChamada } from './chamada-integracao';
import { DmsIdService, type TokenDmsIdDoRegem } from './dms-id.service';
import { EscopoIntegracao } from './escopos';
import { aceitaIntegracoes, ferramentaDaRota } from './hub.regras';
import { HubDmsService } from './hub-dms.service';
import { CABECALHO_LIGACAO_NO_NODE, desafioDaRecusa, EscopoFaltando, LIGACAO_INVALIDA, ligacaoDoCabecalho } from './ligacao.regras';
import { ProblemaException } from './problema';
import { formatoTokenIntegracao } from './token-integracao';
import { IntegracaoTokenService } from './integracao-token.service';
import type { LimiteContado } from './validar-token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quem está chamando a API de integração — montado pelo guard, lido por `@IntegracaoCtx()`. */
export type IntegracaoCtxData = {
  /** O id do token (`integracao_token_loja`). Pela ligação, é o MESMO id: limite, idempotência e aviso seguem a chave. */
  tokenId: string;
  tenantId: string;
  /** A loja do token; `null` = token da EMPRESA inteira (só o RegemCast — mig 302). */
  unidadeId: string | null;
  /** `loja` = token de uma loja (Liame); `empresa` = todas as lojas da empresa. */
  abrangencia: 'loja' | 'empresa';
  /** A empresa tem UMA loja só (venda sem loja conta nela — a regra do Painel). */
  lojaUnica: boolean;
  escopos: EscopoIntegracao[];
  cliente: string;
  autorizadoPor: string;
  /** O prefixo da credencial que chamou: `rgm_it_…` ou, pela ligação, `dms_lg_regem_…`. */
  prefixo: string;
  /** `ligacao` = pela via do DMS ID (Hub DMS, F3, mig 329); ausente = pelo `rgm_it_`. */
  via?: 'ligacao';
  /** O aplicativo do DMS ID que chamou (só pela ligação). É da distribuição: nunca vai para a loja. */
  aplicativo?: string;
};

export const ESCOPOS_KEY = 'integracao_escopos';
/** Escopos que a rota exige (TODOS). Sem o decorator, qualquer token válido entra. */
export const Escopos = (...escopos: EscopoIntegracao[]) => SetMetadata(ESCOPOS_KEY, escopos);

const TOKEN_INVALIDO = 'Token de integração ausente, inválido, vencido ou revogado.';

/** IP de quem chamou — o mesmo critério do limite por IP (`cf-throttler.guard`). */
export function ipDe(req: any): string | null {
  if (process.env.TRUST_CLOUDFLARE === 'true') {
    const cf = req?.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  return req?.ip ?? null;
}

/**
 * Autentica a API de integração (`/api/v1/integracao/*`). Duas vias, com o MESMO contexto no fim:
 *
 * - **o token por loja** (`Authorization: Bearer rgm_it_…`), no padrão do `SyncTokenGuard`: formato (sem ir ao banco)
 *   → SHA-256 → busca pelo hash com a loja e a empresa → 401 se não existe, revogado, vencido, loja apagada ou de outra
 *   empresa. Com ele no cabeçalho, nada muda, ligada ou não a outra via;
 * - **o DMS ID** (Hub DMS, F3, mig 329), só com `DMS_ID_LIGADO`: o token do DMS ID no `Authorization` (401
 *   `token-invalido` se não vale; 403 se não tem permissão nenhuma do Regem) e o segredo da ligação no `DMS-Ligacao`
 *   (401 `ligacao-invalida`, a mesma resposta para todo motivo). Valem as permissões que a loja autorizou E o token tem.
 *
 * Depois, nas duas: limite da credencial (429) → lista de parada do hub (503) → escopos da rota (403, com todos os que
 * faltam) → contexto. Todo 401 leva o desafio `WWW-Authenticate` (com a via ligada, também o endereço dos metadados do
 * recurso, RFC 9728).
 *
 * A parada (Padrão §10; Hub DMS F3, A2), nas duas vias, com 503 `integracao-parada`: a chave própria
 * `ACEITAR_INTEGRACOES` recusa antes de tudo, sem ir ao banco e sem depender do hub; a lista do hub (só com
 * `HUB_LIGADO`) vale depois de reconhecer quem chama — a geral, a do aplicativo (o cliente: `liame`, `farol`…), a da
 * credencial (pelo prefixo visível) e a da rota. O que o guard fica sabendo vai anotado na chamada, para o registro.
 *
 * Sem cache de validação: revogar vale na chamada seguinte. O limite conta TODA chamada da credencial válida,
 * inclusive a que cai no 403 — é ele que substitui o limite por IP. A credencial que o banco recusa perde a isenção do
 * limite por IP na mesma hora.
 */
@Injectable()
export class IntegracaoTokenGuard implements CanActivate {
  private readonly log = new Logger('IntegracaoToken');
  private readonly dmsId: DmsIdService;
  private readonly hub: HubDmsService | null;

  constructor(
    private readonly tokens: IntegracaoTokenService,
    private readonly reflector: Reflector,
    @Optional() dmsId?: DmsIdService,
    @Optional() hub?: HubDmsService,
  ) {
    this.dmsId = dmsId ?? new DmsIdService();
    this.hub = hub ?? null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    // O guard também é montado à mão (rotas do totem, testes) com um contexto que só tem o pedido.
    const res = typeof (http as any).getResponse === 'function' ? http.getResponse() : null;
    const bearer = bearerDe(req);
    const metadadosRecurso = this.dmsId.ligado ? this.dmsId.enderecoDosMetadados() : null;
    const desafiar = (erro: unknown): never => {
      const desafio = desafioDaRecusa(erro, { veioToken: bearer !== null, metadadosRecurso });
      if (desafio && res?.setHeader && !res.headersSent) res.setHeader('WWW-Authenticate', desafio);
      throw erro;
    };
    const peloToken = formatoTokenIntegracao(bearer);
    anotarChamada({ credencial: peloToken || !this.dmsId.ligado ? 'token_integracao' : 'dms_id' });
    // A chave própria: antes de tudo, sem banco e sem hub.
    if (!(this.hub ? this.hub.aceitaIntegracoes : aceitaIntegracoes())) throw problemaDaParada();

    let achado: IntegracaoCtxData & { limite?: LimiteContado };
    if (peloToken) {
      achado = await this.pelaViaDoToken(req, bearer as string, desafiar);
    } else if (this.dmsId.ligado) {
      achado = await this.pelaViaDoDmsId(req, bearer, desafiar);
    } else {
      return desafiar(new ProblemaException(401, 'token-invalido', TOKEN_INVALIDO));
    }
    const { limite: contadoNoBanco, ...t } = achado;
    anotarChamada({ aplicativo: t.cliente, ligacaoPrefixo: t.prefixo, conta: t.unidadeId ?? t.tenantId, tenantId: t.tenantId });

    // O limite do acesso: o contado no banco, na mesma ida da validação (mig 333, vale entre processos); sem a tabela,
    // o da memória do processo.
    const limite = contadoNoBanco ?? contarChamadaIntegracao(t.tokenId);
    if (!limite.ok) {
      throw new ProblemaException(
        429,
        'limite-de-chamadas',
        t.via === 'ligacao'
          ? 'Muitas chamadas com esta ligação — aguarde e tente de novo.'
          : 'Muitas chamadas com este token — aguarde e tente de novo.',
        limite.retryAfterSeg,
      );
    }

    // A lista de parada do hub: a geral, a do aplicativo, a da credencial e a da rota (hub desligado: nada para).
    if (this.hub?.parado({ aplicativo: t.cliente, ligacaoPrefixo: t.prefixo, ferramenta: ferramentaDaRota(req?.method, req?.route?.path) })) {
      throw problemaDaParada();
    }

    const exigidos =
      this.reflector.getAllAndOverride<EscopoIntegracao[]>(ESCOPOS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const faltam = exigidos.filter((e) => !t.escopos.includes(e));
    if (faltam.length) desafiar(new EscopoFaltando(faltam, t.via === 'ligacao' ? 'ligacao' : 'token'));

    // Último uso: no máximo 1×/min, sem esperar e sem derrubar a chamada (V3).
    if (t.via === 'ligacao') this.tokens.marcarUsoLigacao(t.tokenId, ipDe(req));
    else this.tokens.marcarUso(t.tokenId, ipDe(req));
    req.integracao = t satisfies IntegracaoCtxData;
    return true;
  }

  /** O `rgm_it_`: o banco decide sozinho (inválido, revogado ou vencido = 401; nunca cai para a outra via). */
  private async pelaViaDoToken(
    req: any,
    token: string,
    desafiar: (erro: unknown) => never,
  ): Promise<IntegracaoCtxData & { limite?: LimiteContado }> {
    const t = await this.tokens.validar(token, { contar: true });
    if (!t) {
      esquecerTokenIntegracao(credencialDaChamada(req));
      return desafiar(new ProblemaException(401, 'token-invalido', TOKEN_INVALIDO));
    }
    registrarTokenIntegracaoValidado(credencialDaChamada(req));
    return t;
  }

  /**
   * O token do DMS ID primeiro (sem ele, ou com ele torto, nem se procura a ligação), depois a ligação. O motivo da
   * recusa do token vai só para o log local; a resposta é a mesma para todo motivo (Padrão §7).
   */
  private async pelaViaDoDmsId(
    req: any,
    bearer: string | null,
    desafiar: (erro: unknown) => never,
  ): Promise<IntegracaoCtxData & { limite?: LimiteContado }> {
    let doToken: TokenDmsIdDoRegem;
    try {
      doToken = await this.dmsId.conferir(bearer);
    } catch (erro) {
      if (erro instanceof ErroTokenDmsId && bearer !== null) this.log.warn(`token do DMS ID recusado: ${erro.motivo}`);
      return desafiar(erro);
    }
    const segredo = ligacaoDoCabecalho(req?.headers?.[CABECALHO_LIGACAO_NO_NODE]);
    const t = segredo ? await this.tokens.validarLigacao(segredo, doToken, this.dmsId.aplicativos, { contar: true }) : null;
    if (!t) {
      esquecerTokenIntegracao(credencialDaChamada(req));
      return desafiar(new ProblemaException(401, 'ligacao-invalida', LIGACAO_INVALIDA));
    }
    registrarTokenIntegracaoValidado(credencialDaChamada(req));
    return t;
  }
}

export const IntegracaoCtx = createParamDecorator(
  (_d, ctx: ExecutionContext): IntegracaoCtxData => ctx.switchToHttp().getRequest().integracao,
);

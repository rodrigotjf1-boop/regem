import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  bearerDe,
  contarChamadaIntegracao,
  esquecerTokenIntegracao,
  registrarTokenIntegracaoValidado,
} from '../../common/integracao-limite';
import { EscopoIntegracao } from './escopos';
import { ProblemaException } from './problema';
import { formatoTokenIntegracao } from './token-integracao';
import { IntegracaoTokenService } from './integracao-token.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quem está chamando a API de integração — montado pelo guard, lido por `@IntegracaoCtx()`. */
export type IntegracaoCtxData = {
  tokenId: string;
  tenantId: string;
  unidadeId: string;
  /** A empresa tem UMA loja só (venda sem loja conta nela — a regra do Painel). */
  lojaUnica: boolean;
  escopos: EscopoIntegracao[];
  cliente: string;
  autorizadoPor: string;
  prefixo: string;
};

export const ESCOPOS_KEY = 'integracao_escopos';
/** Escopos que a rota exige (TODOS). Sem o decorator, qualquer token válido entra. */
export const Escopos = (...escopos: EscopoIntegracao[]) => SetMetadata(ESCOPOS_KEY, escopos);

const TOKEN_INVALIDO = 'Token de integração ausente, inválido, vencido ou revogado.';

/** IP de quem chamou — o mesmo critério do limite por IP (`cf-throttler.guard`). */
function ipDe(req: any): string | null {
  if (process.env.TRUST_CLOUDFLARE === 'true') {
    const cf = req?.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  return req?.ip ?? null;
}

/**
 * Autentica a API de integração (`/api/v1/integracao/*`) pelo token POR LOJA, no padrão do
 * `SyncTokenGuard`: `Authorization: Bearer rgm_it_…` → formato (sem ir ao banco) → SHA-256 →
 * busca pelo hash com a loja e a empresa → 401 se não existe, revogado, vencido, loja apagada
 * ou de outra empresa → limite do token (429) → escopos da rota (403) → contexto.
 *
 * Sem cache de validação: revogar vale na chamada seguinte. O limite conta TODA chamada do
 * token válido, inclusive a que cai no 403 — é ele que substitui o limite por IP. O token que o
 * banco recusa perde a isenção do limite por IP na mesma hora.
 */
@Injectable()
export class IntegracaoTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: IntegracaoTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = bearerDe(req);
    if (!formatoTokenIntegracao(token)) throw new ProblemaException(401, 'token-invalido', TOKEN_INVALIDO);

    const t = await this.tokens.validar(token);
    if (!t) {
      esquecerTokenIntegracao(token);
      throw new ProblemaException(401, 'token-invalido', TOKEN_INVALIDO);
    }

    registrarTokenIntegracaoValidado(token);
    const limite = contarChamadaIntegracao(t.tokenId);
    if (!limite.ok) {
      throw new ProblemaException(
        429,
        'limite-de-chamadas',
        'Muitas chamadas com este token — aguarde e tente de novo.',
        limite.retryAfterSeg,
      );
    }

    const exigidos =
      this.reflector.getAllAndOverride<EscopoIntegracao[]>(ESCOPOS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const faltam = exigidos.filter((e) => !t.escopos.includes(e));
    if (faltam.length) {
      throw new ProblemaException(
        403,
        'escopo-insuficiente',
        `Este token não tem o escopo ${faltam.join(', ')}.`,
      );
    }

    // Último uso: no máximo 1×/min, sem esperar e sem derrubar a chamada (V3).
    this.tokens.marcarUso(t.tokenId, ipDe(req));
    req.integracao = t satisfies IntegracaoCtxData;
    return true;
  }
}

export const IntegracaoCtx = createParamDecorator(
  (_d, ctx: ExecutionContext): IntegracaoCtxData => ctx.switchToHttp().getRequest().integracao,
);

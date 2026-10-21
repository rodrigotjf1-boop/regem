import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import {
  bearerDe,
  contarChamadaIntegracao,
  esquecerTokenIntegracao,
  registrarTokenIntegracaoValidado,
} from '../../common/integracao-limite';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { equipamentoDoGogem } from '../gogem/credencial-gogem';
import { SyncTokenGuard, type SyncCtxData } from '../sync/sync-token.guard';
import { EscopoIntegracao } from './escopos';
import { ESCOPOS_KEY, ipDe } from './integracao-token.guard';
import { ProblemaException } from './problema';
import { formatoTokenIntegracao } from './token-integracao';
import { marcarUsoTokenIntegracao, validarTokenIntegracao } from './validar-token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL DO TOTEM (GoGeM) NAS CINCO ROTAS DELE — fase 1 da credencial própria (mig 323, 14/10/2026).
//
// Até aqui o GoGeM chamava com o token de um equipamento `servidor_local` (mig 290) — a mesma espécie de
// credencial do servidor da loja, guardada em texto puro no Regem e no GoGeM. Agora ele tem token PRÓPRIO
// da API de integração: `Authorization: Bearer rgm_it_…`, um por loja, emitido pelo console da distribuição
// com a autorização do presidente, só o resumo (SHA-256) guardado, com escopos, revogação e último uso.
//
// As cinco rotas aceitam os dois na TRANSIÇÃO:
//  • `Authorization: Bearer rgm_it_…` → o token de integração decide sozinho: inválido, revogado ou
//    vencido = 401 (nunca cai para o token antigo, senão revogar não valeria); só o cliente `gogem` e só
//    com o escopo da rota (403); a loja é a do token;
//  • sem ele → o `X-Sync-Token` de sempre, pelo `SyncTokenGuard` (com a contenção da fase 0).
// A venda feita com o token novo sai IGUAL à de hoje: o equipamento que representa o GoGeM na empresa
// (o marcado pelo `X-Integrador`) segue como a origem dela e decide a NFC-e — sem ele, a origem fica vazia.
//
// As rotas moram em módulos que rodam também no SERVIDOR DA LOJA (venda, delivery, produto) — por isso
// este guard não importa o `IntegracaoApiModule` (só nuvem, `edge-manifest.ts`): usa as funções de
// `validar-token-integracao.ts`. No servidor da loja o token de integração nem existe (a tabela é só da
// nuvem): lá só vale o caminho antigo — o totem fala com o servidor pela rede da loja, como sempre.

/** O contexto das rotas do totem: o do sincronismo, com o equipamento que pode faltar. */
export type CtxDoTotem = Omit<SyncCtxData, 'equipamentoId' | 'token'> & {
  equipamentoId: string | null;
  token: string | null;
  /** O token de integração que chamou (`null` = o caminho antigo, `X-Sync-Token`). */
  integracaoTokenId: string | null;
};

const TOKEN_INVALIDO = 'Token de integração ausente, inválido, vencido ou revogado.';

@Injectable()
export class CredencialDoTotemGuard implements CanActivate {
  private readonly antigo: SyncTokenGuard;
  private readonly reflector = new Reflector();

  constructor(
    equipamentos: EquipamentoService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {
    this.antigo = new SyncTokenGuard(equipamentos);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const bearer = bearerDe(req);
    // Sem token de integração (ou no servidor da loja): o caminho antigo. Outro Authorization não conta.
    if (ehServidorLocal() || !formatoTokenIntegracao(bearer)) {
      const ok = await this.antigo.canActivate(context);
      if (ok && req.sync) req.sync = { ...req.sync, integracaoTokenId: null } satisfies CtxDoTotem;
      return ok;
    }

    const token = bearer as string;
    const achado = await validarTokenIntegracao(this.db, token, { contar: true });
    if (!achado) {
      esquecerTokenIntegracao(token);
      throw new ProblemaException(401, 'token-invalido', TOKEN_INVALIDO);
    }
    registrarTokenIntegracaoValidado(token);
    // O limite do acesso: o contado no banco na mesma ida (mig 333); sem a tabela, o da memória do processo.
    const { limite: contadoNoBanco, ...t } = achado;
    const limite = contadoNoBanco ?? contarChamadaIntegracao(t.tokenId);
    if (!limite.ok) {
      throw new ProblemaException(429, 'limite-de-chamadas', 'Muitas chamadas com este token — aguarde e tente de novo.', limite.retryAfterSeg);
    }
    if (t.cliente !== 'gogem' || !t.unidadeId) {
      throw new ProblemaException(403, 'escopo-insuficiente', 'Este token não é do totem de uma loja.');
    }
    const exigidos =
      this.reflector.getAllAndOverride<EscopoIntegracao[]>(ESCOPOS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    // Rota sem escopo declarado não aceita token de integração (a lista é do que pode).
    const faltam = exigidos.length ? exigidos.filter((e) => !t.escopos.includes(e)) : ['(rota sem escopo)'];
    if (faltam.length) {
      throw new ProblemaException(403, 'escopo-insuficiente', `Este token não tem o escopo ${faltam.join(', ')}.`);
    }

    marcarUsoTokenIntegracao(this.db, t.tokenId, ipDe(req));
    req.integracao = t;
    req.sync = {
      tenantId: t.tenantId,
      unidadeId: t.unidadeId,
      equipamentoId: await equipamentoDoGogem(this.db, t.tenantId, t.unidadeId),
      token: null,
      integracaoTokenId: t.tokenId,
    } satisfies CtxDoTotem;
    return true;
  }
}

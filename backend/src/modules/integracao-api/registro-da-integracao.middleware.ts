import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { comChamada } from './chamada-integracao';
import { codigoDoHub, ferramentaDaRota, montarChamada, type ChamadaAtual } from './hub.regras';
import { HubDmsService } from './hub-dms.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O REGISTRO de cada chamada da API de integração para o hub da DMS (Padrão §10; Hub DMS F3, parte A2).
//
// Abre a chamada atual (`chamada-integracao.ts`) antes do guard; quando a resposta termina, monta o registro com o que
// o guard, a troca e o filtro anotaram e entrega ao `HubDmsService`, que só anota (o envio sai em lote, depois). O
// código do pedido é o `request_id` que a resposta já leva (quando tem a forma de código do hub). Com o hub desligado,
// não monta nada.
//
// Uma vez por pedido: o Nest pode registrar o middleware mais de uma vez para o mesmo pedido (RegemCast ERR-047); a marca
// garante uma chamada só.

const JA_ABERTA = Symbol('registro-da-integracao');

@Injectable()
export class RegistroDaIntegracao implements NestMiddleware {
  constructor(private readonly hub: HubDmsService) {}

  use(req: any, res: any, next: (erro?: unknown) => void): void {
    if (req[JA_ABERTA]) {
      next();
      return;
    }
    req[JA_ABERTA] = true;
    const chamada: ChamadaAtual = { inicio: Date.now() };
    res.once('close', () => void this.registrar(chamada, req, res));
    comChamada(chamada, () => next());
  }

  /** O registro nunca derruba nada (a resposta já saiu) e nunca rejeita (V3). */
  private async registrar(chamada: ChamadaAtual, req: any, res: any): Promise<void> {
    if (!this.hub.ligado) return;
    try {
      const agora = Date.now();
      const codigo = codigoDoHub(req?.requestId) ?? `rq_${randomBytes(8).toString('hex')}`;
      const ferramenta = ferramentaDaRota(req?.method, req?.route?.path);
      if (chamada.tenantId && !chamada.contaNome) {
        const unidade = chamada.conta && chamada.conta !== chamada.tenantId ? chamada.conta : null;
        chamada.contaNome = (await this.hub.nomeDaConta(chamada.tenantId, unidade)) ?? undefined;
      }
      this.hub.registrar(montarChamada(chamada, { codigo, ferramenta, status: res?.statusCode, terminou: !!res?.writableFinished, agora }));
      if (chamada.erro) this.hub.erro({ origem: 'backend', tipo: chamada.erro.tipo, mensagem: chamada.erro.mensagem, lugar: ferramenta, codigo });
    } catch {
      /* só anota na memória; se nem isso deu, a chamada fica sem registro */
    }
  }
}

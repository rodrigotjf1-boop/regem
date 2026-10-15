import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import {
  dentroDoLimite,
  registrarTokenValidado,
  rotaDaFilaDeImpressao,
} from '../../common/dispositivo-limite';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FilaCtxData = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
  // A estação de impressão que chamou (mig 324); null = o token de sempre (servidor da loja,
  // agente antigo dos caixas).
  estacaoId: string | null;
};

const primeiro = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/**
 * Quem pode consumir a FILA de impressão (pegar, confirmar, devolver, dar erro):
 *  • a ESTAÇÃO de impressão (mig 324), pelo `X-Estacao-Id` + `X-Estacao-Segredo` que ela recebeu
 *    ao parear com o código de 6 dígitos. Com o cabeçalho presente ela decide SOZINHA: inválida,
 *    revogada ou de outro tipo é 401 — nunca cai no token antigo. Esta guarda só existe nas rotas
 *    da fila: a credencial da estação não abre o sincronismo nem o tempo real (ERR-232);
 *  • sem o cabeçalho, o token de sempre (`SyncTokenGuard`), com todas as regras dele.
 * Funciona igual na nuvem e no servidor da loja: a estação existe nos dois (o tipo sincroniza).
 */
@Injectable()
export class FilaImpressaoGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const estacaoId = primeiro(req.headers?.['x-estacao-id']);
    if (estacaoId !== undefined) {
      const segredo = primeiro(req.headers?.['x-estacao-segredo']);
      const est = await this.equipamentos.validarEstacao(String(estacaoId ?? ''), segredo ? String(segredo) : null);
      if (!est) {
        throw new UnauthorizedException(
          'Estação de impressão não pareada ou revogada. Gere um código no Regem e pareie de novo.',
        );
      }
      // Fila com credencial JÁ validada: sai do limite por IP (que a loja divide) e fica no limite
      // por dispositivo — o mesmo tratamento do token antigo (common/dispositivo-limite.ts).
      registrarTokenValidado(String(segredo));
      if (rotaDaFilaDeImpressao(req.originalUrl ?? req.url) && !dentroDoLimite(est.id)) {
        throw new HttpException('Muitas requisições desta estação — aguarde um minuto.', HttpStatus.TOO_MANY_REQUESTS);
      }
      req.fila = {
        tenantId: est.tenantId,
        unidadeId: est.unidadeId ?? null,
        equipamentoId: est.id,
        estacaoId: est.id,
      } satisfies FilaCtxData;
      return true;
    }
    const ok = await new SyncTokenGuard(this.equipamentos).canActivate(context);
    const s = req.sync as SyncCtxData;
    req.fila = {
      tenantId: s.tenantId,
      unidadeId: s.unidadeId ?? null,
      equipamentoId: s.equipamentoId,
      estacaoId: null,
    } satisfies FilaCtxData;
    return ok;
  }
}

export const FilaCtx = createParamDecorator(
  (_data, ctx: ExecutionContext): FilaCtxData => ctx.switchToHttp().getRequest().fila,
);

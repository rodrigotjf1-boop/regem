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
import {
  dentroDoLimite,
  registrarTokenValidado,
  rotaDaFilaDeImpressao,
} from '../../common/dispositivo-limite';

export type SyncCtxData = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
  token: string; // usado p/ derivar a chave HMAC da assinatura de push
};

// Autentica o SERVIDOR LOCAL por token de dispositivo (menor privilégio, revogável),
// nunca por JWT de usuário. Só aceita equipamentos do tipo 'servidor_local' ativos.
@Injectable()
export class SyncTokenGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-sync-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw new UnauthorizedException('Token de sync ausente.');

    const dev = await this.equipamentos.validarToken(String(token));
    if (!dev || dev.tipo !== 'servidor_local') {
      throw new UnauthorizedException('Token de sync inválido.');
    }
    registrarTokenValidado(String(token));
    // Fila de impressão: isenta do limite por IP (cf-throttler.guard) → limite próprio por
    // dispositivo. As demais rotas de sync seguem no limite por IP de sempre.
    if (rotaDaFilaDeImpressao(req.originalUrl ?? req.url) && !dentroDoLimite(dev.id)) {
      throw new HttpException('Muitas requisições deste dispositivo — aguarde um minuto.', HttpStatus.TOO_MANY_REQUESTS);
    }
    req.sync = {
      tenantId: dev.tenantId,
      unidadeId: dev.unidadeId ?? null,
      equipamentoId: dev.id,
      token: String(token),
    } satisfies SyncCtxData;
    return true;
  }
}

export const SyncCtx = createParamDecorator(
  (_data, ctx: ExecutionContext): SyncCtxData =>
    ctx.switchToHttp().getRequest().sync,
);

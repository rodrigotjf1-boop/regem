import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';

export type SyncCtxData = {
  tenantId: string;
  unidadeId: string | null;
  equipamentoId: string;
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
    req.sync = {
      tenantId: dev.tenantId,
      unidadeId: dev.unidadeId ?? null,
      equipamentoId: dev.id,
    } satisfies SyncCtxData;
    return true;
  }
}

export const SyncCtx = createParamDecorator(
  (_data, ctx: ExecutionContext): SyncCtxData =>
    ctx.switchToHttp().getRequest().sync,
);

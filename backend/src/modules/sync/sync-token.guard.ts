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
import { ehServidorLocal } from '../../common/modo';
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

// Autentica por token de DISPOSITIVO (menor privilégio, revogável), nunca por JWT de
// usuário. Aceita:
//  • 'servidor_local' — em qualquer lugar (é o edge falando com a nuvem);
//  • 'totem'          — SÓ no servidor local (R1). O totem fala com o edge pela LAN; um
//    token de totem nunca vale contra a nuvem, então um aparelho público comprometido
//    não alcança a API da nuvem. O tipo é conferido com `ehServidorLocal()` e nunca
//    comparando EDGE_MODE à mão (registro interno: V2).
// O totem PRECISA ter loja: sem `unidade_id`, a venda nasceria "da rede" — desceria para
// todos os servidores e sairia do CMV por loja (registro interno: V17).
/**
 * Regra ÚNICA de quem pode usar token de dispositivo (R1). Exportada porque o guard do
 * módulo `totem` aplica exatamente a mesma — duas cópias divergiriam com o tempo, e é
 * regra de autenticação. Lança `UnauthorizedException`; devolve o dispositivo válido.
 */
export function conferirDispositivo(dev: any): asserts dev {
  const tipoAceito =
    dev?.tipo === 'servidor_local' || (dev?.tipo === 'totem' && ehServidorLocal());
  if (!dev || !tipoAceito) {
    throw new UnauthorizedException('Token de sync inválido.');
  }
  if (dev.tipo === 'totem' && !dev.unidadeId) {
    throw new UnauthorizedException(
      'Totem sem loja definida — vincule o aparelho a uma loja antes de usá-lo.',
    );
  }
}

@Injectable()
export class SyncTokenGuard implements CanActivate {
  constructor(private readonly equipamentos: EquipamentoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-sync-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw new UnauthorizedException('Token de sync ausente.');

    const dev = await this.equipamentos.validarToken(String(token));
    conferirDispositivo(dev);
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

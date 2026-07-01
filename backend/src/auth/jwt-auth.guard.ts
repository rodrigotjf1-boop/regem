import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// Valida o Bearer token e injeta req.user (tenantId + categoria) em cada request.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string | undefined;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    try {
      const payload = this.jwt.verify(header.slice(7));
      req.user = {
        colaboradorId: payload.sub,
        tenantId: payload.tenant,
        categoria: payload.cat,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
  }
}

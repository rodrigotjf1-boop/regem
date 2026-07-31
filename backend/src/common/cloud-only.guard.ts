import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLOUD_ONLY } from './cloud-only.decorator';

// Guard global: quando EDGE_MODE=true, qualquer handler/controller marcado com
// @CloudOnly() responde 404 (sem revelar que existe). Na nuvem é passthrough.
// É defesa em profundidade — o corte real é por build (o bundle do edge não inclui
// os módulos cloud-only), este guard blinda em runtime caso algo vaze.
@Injectable()
export class CloudOnlyGuard implements CanActivate {
  private readonly edge =
    String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.edge) return true;
    const cloudOnly = this.reflector.getAllAndOverride<boolean>(CLOUD_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (cloudOnly) throw new NotFoundException();
    return true;
  }
}

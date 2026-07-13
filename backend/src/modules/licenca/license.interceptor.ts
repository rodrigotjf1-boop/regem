import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { LicencaService } from './licenca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Bloqueio duro (G-1): quando o trial/assinatura da conta expira, corta as
// operações de ESCRITA na NUVEM. Leitura (GET) e rotas públicas continuam, para
// o cliente ver o aviso e renovar. O edge tem verificação própria (via sync_state),
// por isso aqui saímos quando EDGE_MODE=true.
@Injectable()
export class LicenseInterceptor implements NestInterceptor {
  // Cache curto por tenant (nuvem) e um global (edge) para não bater no banco a cada escrita.
  private readonly cache = new Map<string, { ativa: boolean; exp: number }>();
  private edgeCache?: { ativa: boolean; exp: number };

  constructor(private readonly licenca: LicencaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = ctx.switchToHttp().getRequest();
    const metodo = String(req.method ?? '');

    // Leitura sempre passa (o cliente precisa ver o aviso e renovar).
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return next.handle();
    // Rotas que precisam funcionar mesmo com a licença vencida.
    const url = String(req.originalUrl ?? req.url ?? '');
    if (/\/api\/v1\/(auth|licenca|provisionamento|edge|publico|sync)\b/.test(url)) {
      return next.handle();
    }

    const isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
    let ativa: boolean;

    if (isEdge) {
      // EDGE: licença é global do servidor local (via sync_state/lease).
      if (this.edgeCache && this.edgeCache.exp > Date.now()) {
        ativa = this.edgeCache.ativa;
      } else {
        try {
          ativa = !!(await this.licenca.statusEdge()).ativa;
        } catch {
          ativa = true; // fail-open
        }
        this.edgeCache = { ativa, exp: Date.now() + 30000 };
      }
    } else {
      // NUVEM: licença é por conta (trial/assinatura).
      const user = req.user as { tenantId?: string } | undefined;
      if (!user?.tenantId) return next.handle();
      const cached = this.cache.get(user.tenantId);
      if (cached && cached.exp > Date.now()) {
        ativa = cached.ativa;
      } else {
        try {
          ativa = !!(await this.licenca.statusConta(user.tenantId)).ativa;
        } catch {
          ativa = true; // fail-open
        }
        this.cache.set(user.tenantId, { ativa, exp: Date.now() + 60000 });
      }
    }

    if (!ativa) {
      throw new HttpException(
        { message: 'Seu teste do Regem expirou. Assine para reativar.', licenca: 'expirado' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return next.handle();
  }
}

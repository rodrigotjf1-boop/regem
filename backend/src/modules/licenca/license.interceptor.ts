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
  // Cache curto por tenant para não bater no banco a cada escrita.
  private readonly cache = new Map<string, { ativa: boolean; exp: number }>();

  constructor(private readonly licenca: LicencaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const metodo = String(req.method ?? '');
    const user = req.user as { tenantId?: string } | undefined;

    // Só barra escrita autenticada; leitura e requisições sem usuário passam.
    if (!user?.tenantId || metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') {
      return next.handle();
    }
    // Rotas que precisam funcionar mesmo com o teste vencido (login, licença,
    // provisionamento/ativação, edge, público, sync).
    const url = String(req.originalUrl ?? req.url ?? '');
    if (/\/api\/v1\/(auth|licenca|provisionamento|edge|publico|sync)\b/.test(url)) {
      return next.handle();
    }

    const cached = this.cache.get(user.tenantId);
    let ativa: boolean;
    if (cached && cached.exp > Date.now()) {
      ativa = cached.ativa;
    } else {
      // Fail-open: qualquer erro ao apurar o status (coluna ausente durante o
      // deploy, glitch de banco) LIBERA — nunca bloquear cliente por falha nossa.
      try {
        const s = await this.licenca.statusConta(user.tenantId);
        ativa = !!s.ativa;
      } catch {
        ativa = true;
      }
      this.cache.set(user.tenantId, { ativa, exp: Date.now() + 60000 });
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

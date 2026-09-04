import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

// Checa a categoria da hierarquia (RBAC) contra o que o endpoint exige.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    // Suporte (F9) = nível GERÊNCIA (decisão do dono): no teste de PAPEL, trata
    // 'suporte' como 'gerente'. Assim o suporte alcança as telas de gestão/config
    // (equipamentos, impressão, KDS…) sem precisar marcar 'suporte' em dezenas de
    // @Roles. O que ele pode DE FATO fazer segue governado pelo @RequirePerm + o
    // PACOTE_SUPORTE (sem financeiro/acessos/planos/…) e por tudo ser AUDITADO na
    // loja. Endpoints presidente-only (sem 'gerente' no @Roles) seguem barrados —
    // inclusive o /suporte da própria loja (o técnico não se desbloqueia).
    const categoria = req.user?.categoria === 'suporte' ? 'gerente' : req.user?.categoria;
    if (!req.user || !required.includes(categoria)) {
      throw new ForbiddenException('Permissão insuficiente');
    }
    return true;
  }
}

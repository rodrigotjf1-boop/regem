import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERM, type PermSpec } from './require-perm.decorator';
import { AuthUser } from './auth-user';
import { pode, type Permissoes } from './permissoes';

// Aplica o RBAC configurável: checa a permissão exigida por @RequirePerm contra
// o pacote de permissões do perfil (no JWT). Sem @RequirePerm → deixa passar
// (o endpoint pode ser governado por @Roles). Presidente tem tudo por padrão.
@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<PermSpec | undefined>(
      REQUIRE_PERM,
      [context.getHandler(), context.getClass()],
    );
    if (!spec) return true;

    const user: AuthUser | undefined = context
      .switchToHttp()
      .getRequest().user;
    const perm: Permissoes | undefined = user?.permissoes;

    const ok =
      'acao' in spec
        ? pode(perm, spec.modulo, spec.acao)
        : !!perm?.[spec.modulo as keyof Permissoes];

    if (!ok) {
      throw new ForbiddenException(
        'Seu perfil de acesso não permite esta ação.',
      );
    }
    return true;
  }
}

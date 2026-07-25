import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERM, type PermSpec } from './require-perm.decorator';
import { AuthUser } from './auth-user';
import { pode, podeAcessar, type Permissoes } from './permissoes';

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

    // Presidente/C&O tem acesso total SEMPRE — independente do pacote de
    // permissões no token (que pode estar defasado após mudança de catálogo).
    if (user?.categoria === 'presidente') return true;

    const perm: Permissoes | undefined = user?.permissoes;

    // Checa o VALOR de `acao`, não a presença da chave: `@RequirePerm('escalas')`
    // gera { modulo, acao: undefined }, e `'acao' in spec` seria true mesmo sem
    // ação — caindo em pode(..., undefined) = sempre false (barrava a leitura).
    const spc = spec as { modulo: string; acao?: 'ver' | 'criar' | 'editar' | 'excluir' };
    const ok = spc.acao
      ? pode(perm, spc.modulo as any, spc.acao)
      // String simples: `podeAcessar` trata chave CRUD como o `.ver`. Sem isto,
      // uma permissão CRUD (ex.: escalas={ver:false}) passaria por ser objeto
      // truthy — furo silencioso ao migrar um bool para CRUD.
      : podeAcessar(perm, spc.modulo as keyof Permissoes);

    if (!ok) {
      throw new ForbiddenException(
        'Seu perfil de acesso não permite esta ação.',
      );
    }
    return true;
  }
}

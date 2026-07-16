import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuloService } from '../modules/modulo/modulo.service';
import { MODULO_KEY } from './require-modulo.decorator';
import type { AuthUser } from './auth-user';

// Corta o acesso quando o módulo ativável exigido está DESLIGADO para a unidade do
// usuário (override da loja > padrão da rede). Aplica RBAC no servidor: mesmo que o
// front mostre a tela, a API recusa. O escopo por unidade usa a unidade do usuário.
@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modulos: ModuloService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const chave = this.reflector.getAllAndOverride<string | undefined>(MODULO_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!chave) return true; // handler sem @RequireModulo → não gera restrição
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return true; // sem usuário, o JwtAuthGuard já barra antes
    const ativo = await this.modulos.ativo(user.tenantId, user.unidadeId ?? null, chave);
    if (!ativo)
      throw new ForbiddenException(`Módulo "${chave}" está desativado para esta unidade.`);
    return true;
  }
}

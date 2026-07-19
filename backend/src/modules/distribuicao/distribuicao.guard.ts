import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DistribuicaoService } from './distribuicao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DistCtx = { sub: string; nome: string; perfil: string };

// Valida o token da DISTRIBUIÇÃO (escopo próprio + secret próprio). Rejeita token de
// loja (escopo != 'distribuicao') e carrega o usuário ativo. Anexa em req.distUser.
@Injectable()
export class DistribuicaoGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly service: DistribuicaoService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] ?? '';
    if (!h.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: any;
    try {
      payload = this.jwt.verify(h.slice(7), {
        secret: process.env.DIST_JWT_SECRET || process.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (payload?.escopo !== 'distribuicao') throw new UnauthorizedException();
    const u = await this.service.porId(payload.sub);
    if (!u) throw new UnauthorizedException();
    req.distUser = { sub: u.id, nome: u.nome, perfil: u.perfil } as DistCtx;
    return true;
  }
}

// @PerfilDist('diretoria', ...) + PerfilDistGuard: restringe por perfil da distribuição.
export const PERFIL_DIST_KEY = 'perfilDist';
export const PerfilDist = (...perfis: string[]) => SetMetadata(PERFIL_DIST_KEY, perfis);

@Injectable()
export class PerfilDistGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const perfis = this.reflector.getAllAndOverride<string[]>(PERFIL_DIST_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!perfis?.length) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!perfis.includes(req.distUser?.perfil)) {
      throw new ForbiddenException('Perfil da distribuição sem acesso a esta ação.');
    }
    return true;
  }
}

export const DistUser = createParamDecorator(
  (_d, ctx: ExecutionContext): DistCtx => ctx.switchToHttp().getRequest().distUser,
);

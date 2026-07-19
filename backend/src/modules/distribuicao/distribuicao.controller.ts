import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DistribuicaoService } from './distribuicao.service';
import { DistCtx, DistUser, DistribuicaoGuard, PerfilDist, PerfilDistGuard } from './distribuicao.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição (Fase 1). Realm próprio: login, perfil, auditoria.
@Controller('distribuicao')
export class DistribuicaoController {
  constructor(private readonly service: DistribuicaoService) {}

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  login(@Body() dto: any, @Req() req: any) {
    return this.service.login(dto?.email, dto?.senha, req?.ip);
  }

  // Cria o 1º usuário (diretoria) com a tabela vazia. Header x-bootstrap-secret =
  // DIST_BOOTSTRAP_SECRET (env). Some assim que existir 1 usuário.
  @Post('bootstrap')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  bootstrap(@Body() dto: any, @Headers('x-bootstrap-secret') seg: string) {
    return this.service.bootstrap(dto, seg ?? '');
  }

  @Get('me')
  @UseGuards(DistribuicaoGuard)
  me(@DistUser() u: DistCtx) {
    return u;
  }

  // Gestão de usuários — só Diretoria.
  @Get('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  usuarios() {
    return this.service.listar();
  }

  @Post('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  criarUsuario(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.criar(dto, u);
  }

  // Auditoria — Diretoria (histórico das ações da distribuição).
  @Get('auditoria')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  auditoria() {
    return this.service.listarAuditoria();
  }
}

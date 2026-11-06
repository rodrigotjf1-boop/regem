import { BadRequestException, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { PublicarIntegracoesService } from './publicar-integracoes.service';

const GESTOR = ['presidente', 'gerente', 'supervisao'];

/**
 * "Publicar nas integrações" (Cadastros › Cardápio). Só gestão — os mesmos perfis do antigo "Publicar no GoGeM".
 * A situação e o envio moram na nuvem; no servidor da loja, o serviço pede à nuvem.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integracoes/publicar')
export class PublicarIntegracoesController {
  constructor(private readonly service: PublicarIntegracoesService) {}

  @Get()
  @Roles(...GESTOR)
  situacao(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.situacaoDaTela(user.tenantId, unidadeId);
  }

  @Post()
  @HttpCode(200)
  @Roles(...GESTOR)
  publicar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.publicarDaTela(user.tenantId, unidadeId, { id: user.colaboradorId ?? null, perfil: user.categoria ?? '' });
  }
}

/**
 * O servidor da loja pedindo à NUVEM (V37; ERR-108: a credencial do GoGeM, a fila do iFood e os registros de aviso só
 * existem aqui). Token de sync do servidor; a nuvem responde pela empresa do TOKEN e confere que a loja pedida é dela
 * (quem chama confere que a resposta é da empresa do usuário). A auditoria fica no servidor da loja, onde a pessoa clicou.
 */
@Controller('integracoes/loja/publicar')
@CloudOnly()
@UseGuards(SyncTokenGuard)
export class PublicarIntegracoesLojaController {
  constructor(private readonly service: PublicarIntegracoesService) {}

  private async loja(ctx: SyncCtxData, unidade: string | undefined): Promise<string | null> {
    const u = unidade?.trim() || null;
    if (!(await this.service.lojaDaEmpresa(ctx.tenantId, u))) throw new BadRequestException('Loja não encontrada nesta empresa.');
    return u;
  }

  @Get()
  async situacao(@SyncCtx() ctx: SyncCtxData, @Query('unidade') unidade?: string) {
    const u = await this.loja(ctx, unidade);
    return { tenantId: ctx.tenantId, ...(await this.service.situacao(ctx.tenantId, u)) };
  }

  @Post()
  @HttpCode(200)
  async publicar(@SyncCtx() ctx: SyncCtxData, @Query('unidade') unidade?: string) {
    const u = await this.loja(ctx, unidade);
    return { tenantId: ctx.tenantId, ...(await this.service.publicar(ctx.tenantId, u)) };
  }
}

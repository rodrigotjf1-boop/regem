import { Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterDocumentosService } from './mister-documentos.service';

// A PARTE "DOCUMENTOS" DO MISTER NA LOJA (M3a parte 3, mig 439; versão 3 do protótipo): os boletos e as contas que
// chegaram por foto, o que foi lido e onde foi lançado, e o "Desfazer o lançamento". Só o presidente (é quem manda as
// fotos), só na nuvem e só com o módulo ligado. Mora no módulo do agente porque o serviço dos documentos mora lá.
@Controller('mister/documentos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterDocumentosController {
  constructor(private readonly documentos: MisterDocumentosService) {}

  /** Os documentos da empresa no período (7, 30 ou 90 dias). */
  @Get()
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  listar(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.documentos.listar(user.tenantId, dias);
  }

  /** O PDF do boleto lançado (M3a parte 4b): o mesmo do "Ver o PDF" da conversa. Só do documento lançado. */
  @Get(':id/pdf')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const arquivo = await this.documentos.pdf(user.tenantId, id);
    if (!arquivo) throw new NotFoundException('O PDF é do boleto lançado: este documento não foi lançado.');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${arquivo.nome}"`);
    res.send(arquivo.pdf);
  }

  /** Desfaz o lançamento (a conta a pagar ainda em aberto): o mesmo caminho do botão "Desfazer" da conversa. */
  @Post(':id/desfazer')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  desfazer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documentos.desfazerPelaTela(user.tenantId, user.colaboradorId, user.categoria, id);
  }
}

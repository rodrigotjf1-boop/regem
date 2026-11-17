import { BadRequestException, Controller, ForbiddenException, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { pedidoDaPagina } from './insumo-vendido';

// M3c.4 — A PÁGINA DO RELATÓRIO NO REGEM ("Ver no Regem", versão 3 do protótipo, aba "Arquivos e links" › "A página do
// link"; decisão 7: abre no Regem com o usuário da pessoa). O relatório é refeito NO ESCOPO de quem abre — a MESMA régua
// da conversa (presidente ou gerente com o módulo, a permissão de estoque ou de relatórios, só as lojas que a pessoa
// consulta, o insumo da empresa dela) —, e a página mostra o MESMO plano do PDF.

@Controller('mister/relatorio')
@UseGuards(JwtAuthGuard, RolesGuard, ModuloGuard)
export class MisterRelatorioController {
  constructor(private readonly ferramentas: MisterFerramentasService) {}

  private async escopo(user: AuthUser): Promise<EscopoDoMister> {
    const e = await this.ferramentas.escopoDaTela(user.tenantId, user.colaboradorId);
    if (!e) throw new ForbiddenException('Este relatório é do Mister: abre para o presidente e o gerente com o módulo ligado.');
    return e;
  }

  private pedido(q: Record<string, unknown>) {
    const p = pedidoDaPagina(q);
    if (!p) throw new BadRequestException('O endereço do relatório está incompleto. Abra de novo pelo link do Mister.');
    return p;
  }

  @Get('insumo')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async insumo(@CurrentUser() user: AuthUser, @Query() q: Record<string, unknown>) {
    const r = await this.ferramentas.relatorioDoPedido(await this.escopo(user), this.pedido(q));
    if ('erro' in r) throw new ForbiddenException(r.erro);
    return { plano: r.plano, nomeDoPdf: r.nome, total: r.relatorio.total, unidade: r.relatorio.insumo.unidade, periodo: r.relatorio.periodo };
  }

  @Get('insumo/pdf')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async pdf(@CurrentUser() user: AuthUser, @Query() q: Record<string, unknown>, @Res() res: Response) {
    const r = await this.ferramentas.pdfDoInsumo(await this.escopo(user), this.pedido(q));
    if ('erro' in r) throw new ForbiddenException(r.erro);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(r.pdf);
  }
}

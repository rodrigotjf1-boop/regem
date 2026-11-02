import { Body, Controller, Get, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { TerminalAtual } from '../../auth/terminal-atual.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService, RespostaDaDisputa } from './disputa-ifood.service';

// Chamados de atendimento (handoff). Operados por quem está no balcão/gestão.
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
export class AtendimentoController {
  constructor(
    private readonly service: AtendimentoService,
    private readonly disputa: DisputaIfoodService,
  ) {}

  // Resposta à DISPUTA do iFood (aceitar, recusar ou propor). Quem decide é a senha: só gerente e presidente (decisão
  // do dono, 01/11/2026) — qualquer pessoa da equipe abre o diálogo, a senha diz quem respondeu.
  @Post(':id/disputa')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  responderDisputa(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RespostaDaDisputa) {
    return this.disputa.responder(user, id, dto);
  }

  // A foto `n` que o cliente mandou na disputa (o iFood só entrega com a credencial da loja).
  @Get(':id/foto/:n')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  async fotoDaDisputa(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.disputa.foto(user.tenantId, id, Number(n) || 0);
    res.setHeader('Content-Type', f.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(f.bytes);
  }

  @Get()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  // A FILA da central de atendimento (Onda 1): os casos abertos da loja em uso, na ordem da fila, e as contagens.
  @Get('fila')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  fila(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.service.fila(user, unidade);
  }

  // Os casos resolvidos hoje (a situação "Resolvidos hoje" da tela).
  @Get('fila/resolvidos')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  resolvidos(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.service.resolvidosHoje(user, unidade);
  }

  // As pessoas ativas da loja (só id e nome) — a lista do "Passar o caso".
  @Get('equipe')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  equipe(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.service.equipe(user, unidade);
  }

  @Post(':id/pegar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  pegar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.pegar(user, id);
  }

  // `para` = colaborador ativo da equipe; vazio = de volta para a fila.
  @Post(':id/passar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  passar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { para?: string | null }) {
    return this.service.passar(user, id, dto);
  }

  // `aguardando` true = esperando o cliente; false = volta para a fila (ou para quem tem o caso).
  @Post(':id/aguardar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  aguardar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { aguardando?: unknown }) {
    return this.service.aguardar(user, id, dto);
  }

  @Post(':id/resolver')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  resolver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resolver(user.tenantId, id, user.colaboradorId);
  }

  // Veredito de um pedido de cancelamento feito pelo cliente: aceita (cancela o
  // pedido de fato — exige senha de gestor) ou recusa (só encerra o chamado). Aceitando, o destino dos insumos é o
  // mesmo do cancelamento do painel (ERR-339): `reaproveitado` (padrão true) e, na perda, `perdaItens`.
  @Post(':id/cancelamento')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  decidirCancelamento(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { aceita?: boolean; senha?: string; motivo?: string; reaproveitado?: boolean; perdaItens?: unknown },
    @TerminalAtual() terminalId: string | null, // o comprovante do cancelamento sai na impressora deste PC
  ) {
    return this.service.decidirCancelamento(user, id, dto, terminalId);
  }
}

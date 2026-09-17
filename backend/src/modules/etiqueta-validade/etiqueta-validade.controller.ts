import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EtiquetaValidadeService } from './etiqueta-validade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTAO = ['presidente', 'gerente', 'supervisao'];
// Ponto de baixa: equipamento com leitor óptico na rede da loja. Aberto aos quatro
// papéis, mas travado pela permissão `desperdicio` — ligada na gestão e, na execução, só
// quando o presidente libera no perfil (decisão do dono).
const TODOS = ['presidente', 'gerente', 'supervisao', 'execucao'];

// Os decorators ficam em CADA rota, não na classe: uma permissão declarada na classe não
// tem como ser anulada num método (o guard devolve a da classe quando o método não tem a
// sua). Duas famílias:
//  • GESTÃO — template, fontes, listagem e criação de etiqueta: perfil de gestão E o
//    pacote de permissões configurável (#49).
//  • PONTO DE BAIXA — buscar, ler, abrir, finalizar e perda: os quatro papéis, travados
//    pela permissão `desperdicio` (não pela de estoque, que a execução não tem e que é
//    ampla demais). A perda grava quem registrou e em qual ponto (mig 251).
@Controller('etiquetas-validade')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class EtiquetaValidadeController {
  constructor(private readonly service: EtiquetaValidadeService) {}

  @Get('template')
  @Roles(...GESTAO)
  @RequirePerm('estoque', 'ver')
  template(@CurrentUser() user: AuthUser) {
    return this.service.getTemplate(user.tenantId);
  }

  @Put('template')
  @Roles(...GESTAO)
  @RequirePerm('estoque', 'editar')
  salvarTemplate(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarTemplate(user.tenantId, dto);
  }

  @Get('fontes')
  @Roles(...GESTAO)
  @RequirePerm('estoque', 'ver')
  fontes(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.fontes(user.tenantId, atual);
  }

  @Get()
  @Roles(...GESTAO)
  @RequirePerm('estoque', 'ver')
  listar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listar(user.tenantId, atual);
  }

  @Post()
  @Roles(...GESTAO)
  @RequirePerm('estoque', 'editar')
  criar(@CurrentUser() user: AuthUser, @Body() dto: any, @UnidadeAtual() atual: string | null) {
    return this.service.criar(user.tenantId, user.colaboradorId, dto, atual);
  }

  // Leitura do código (baixa por uso).
  @Post('ler')
  @Roles(...TODOS)
  @RequirePerm('desperdicio')
  ler(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.lerCodigo(user.tenantId, user.colaboradorId, dto?.codigo);
  }

  // Busca por código (read-only) — o Ponto de baixa lê, mostra e decide a ação.
  @Post('buscar')
  @Roles(...TODOS)
  @RequirePerm('desperdicio')
  buscar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.buscarPorCodigo(user.tenantId, dto?.codigo);
  }

  // Abrir por id (fechado → em uso; reimprime se a validade após aberto encurtar).
  @Post(':id/abrir')
  @Roles(...TODOS)
  @RequirePerm('desperdicio')
  abrir(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.abrir(user.tenantId, user.colaboradorId, id);
  }

  @Post(':id/finalizar')
  @Roles(...TODOS)
  @RequirePerm('desperdicio')
  finalizar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.finalizar(user.tenantId, user.colaboradorId, id);
  }

  @Post(':id/perda')
  @Roles(...TODOS)
  @RequirePerm('desperdicio')
  perda(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UnidadeAtual() atual: string | null,
    @Body() dto: any,
  ) {
    const q = dto?.quantidade != null && dto.quantidade !== '' ? Number(dto.quantidade) : undefined;
    return this.service.perda(user.tenantId, user.colaboradorId, id, atual, q);
  }
}

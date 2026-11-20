import { Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MisterRegrasService } from './mister-regras.service';

// MISTER › REGRAS NA LOJA (versão 6, M6f; `mockups/regem-mister-v6.html`, "Na loja" › Regras): a lista das regras de aviso
// e pausar, retomar e apagar. Gerente e presidente, só na nuvem e só com o módulo ligado. O escopo é o da conversa
// (`escopoDaTela`: a pessoa ativa, gerente ou presidente, conferida no banco): o presidente vê e mexe nas de todos, o
// gerente só nas dele (decisão V6-5). Criar e mudar é pela conversa.
@Controller('mister/regras')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterRegrasController {
  constructor(
    private readonly regras: MisterRegrasService,
    private readonly ferramentas: MisterFerramentasService,
  ) {}

  private async escopo(user: AuthUser) {
    const e = await this.ferramentas.escopoDaTela(user.tenantId, user.colaboradorId);
    if (!e) throw new ForbiddenException('Só gerente ou presidente fala com o Mister.');
    return e;
  }

  @Get()
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async listar(@CurrentUser() user: AuthUser) {
    return this.regras.daTela(await this.escopo(user));
  }

  @Post(':id/pausar')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async pausar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.regras.mudarPelaTela(await this.escopo(user), id, 'pausar');
  }

  @Post(':id/retomar')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async retomar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.regras.mudarPelaTela(await this.escopo(user), id, 'retomar');
  }

  @Delete(':id')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  async apagar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.regras.mudarPelaTela(await this.escopo(user), id, 'apagar');
  }
}

import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterVinculoService } from './mister-vinculo.service';

// O WHATSAPP DE QUEM ESTÁ LOGADO no Mister (mig 417). Gerente e presidente, só na nuvem e só com o módulo ligado.
// Cada um liga o PRÓPRIO número: nenhuma rota recebe telefone nem a pessoa de outro — tudo sai do usuário logado.
@Controller('mister')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterController {
  constructor(private readonly vinculo: MisterVinculoService) {}

  /** A situação do meu WhatsApp no Mister e, se eu gerei um código que ainda vale, o código. */
  @Get('whatsapp')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  meu(@CurrentUser() user: AuthUser) {
    return this.vinculo.meu(user);
  }

  /** Gera o código de ligar (vale 10 minutos e uma vez). */
  @Post('whatsapp/codigo')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  gerarCodigo(@CurrentUser() user: AuthUser) {
    return this.vinculo.gerarCodigo(user);
  }

  /** Desliga o meu WhatsApp do Mister. */
  @Delete('whatsapp')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  desligar(@CurrentUser() user: AuthUser) {
    return this.vinculo.desligar(user);
  }
}

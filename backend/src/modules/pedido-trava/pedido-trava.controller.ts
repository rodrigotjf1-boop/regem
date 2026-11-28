import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { LiberarTravaDto } from './dto/liberar-trava.dto';
import { PedidoTravaService } from './pedido-trava.service';

// A TRAVA DO PEDIDO ENQUANTO O CLIENTE ALTERA (mig 517). Roda nos dois lados: no servidor da loja, o "Liberar" daqui sobe
// pelo sincronismo e a nuvem avisa o cliente.
@Controller('delivery')
export class PedidoTravaController {
  constructor(private readonly travas: PedidoTravaService) {}

  // "Liberar o pedido" (TR-4): o pedido segue como estava, sem a mudança — a senha de quem libera (presidente, gerente ou
  // supervisão, a mesma do cancelar) e o motivo. Painel do Delivery e KDS de despacho.
  @Post('pedidos/:id/liberar-alteracao')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  liberar(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: LiberarTravaDto) {
    return this.travas.liberar(user, id, dto);
  }
}

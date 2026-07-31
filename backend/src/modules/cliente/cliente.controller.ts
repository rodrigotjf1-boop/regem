import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClienteService } from './cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente do cardápio (público, sem login) — identidade por "link mágico".
import { CloudOnly } from '../../common/cloud-only.decorator';

// O clienteToken vai no corpo (POST) ou como query (GET/DELETE).
// Identidade do cliente do cardápio online = nuvem → não roda no edge.
@Controller('publico/cardapio')
@CloudOnly()
export class ClientePublicoController {
  constructor(private readonly service: ClienteService) {}

  @Post(':token/cliente/identificar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  identificar(@Param('token') token: string, @Body() dto: any) {
    return this.service.identificar(token, dto);
  }

  // Link curto do cliente (robô/n8n): devolve { slug, url, clienteToken }.
  @Post(':token/cliente/link')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  criarLink(@Param('token') token: string, @Body() dto: any) {
    return this.service.criarLink(token, dto);
  }

  // Resolve o slug curto → clienteToken (o cardápio chama ao abrir ?u=slug).
  @Get(':token/cliente/link/:slug')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  resolverLink(@Param('token') token: string, @Param('slug') slug: string) {
    return this.service.resolverLink(token, slug);
  }

  // OTP por WhatsApp: envia o código e confirma (identidade verificada).
  @Post(':token/cliente/otp/enviar')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  otpEnviar(@Param('token') token: string, @Body() dto: any) {
    return this.service.enviarOtp(token, dto?.telefone);
  }

  @Post(':token/cliente/otp/confirmar')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  otpConfirmar(@Param('token') token: string, @Body() dto: any) {
    return this.service.confirmarOtp(token, dto);
  }

  @Get(':token/cliente')
  perfil(@Param('token') token: string, @Query('clienteToken') clienteToken?: string) {
    return this.service.perfil(token, clienteToken);
  }

  @Post(':token/cliente/endereco')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  addEndereco(@Param('token') token: string, @Body() dto: any) {
    return this.service.adicionarEndereco(token, dto?.clienteToken, dto);
  }

  @Delete(':token/cliente/endereco/:id')
  removerEndereco(
    @Param('token') token: string,
    @Param('id') id: string,
    @Query('clienteToken') clienteToken?: string,
  ) {
    return this.service.removerEndereco(token, clienteToken, id);
  }

  @Post(':token/cliente/endereco/:id/principal')
  principal(@Param('token') token: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.definirPrincipal(token, dto?.clienteToken, id);
  }

  @Post(':token/cliente/esquecer')
  esquecer(@Param('token') token: string, @Body() dto: any) {
    return this.service.esquecer(token, dto?.clienteToken);
  }

  @Post(':token/cliente/pedir-de-novo/:pedidoId')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  pedirDeNovo(@Param('token') token: string, @Param('pedidoId') pedidoId: string, @Body() dto: any) {
    return this.service.pedirDeNovo(token, dto?.clienteToken, pedidoId);
  }

  // Cliente solicita cancelamento do pedido (abre chamado no sino da equipe).
  @Post(':token/cliente/pedido/:pedidoId/solicitar-cancelamento')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  solicitarCancelamento(@Param('token') token: string, @Param('pedidoId') pedidoId: string, @Body() dto: any) {
    return this.service.solicitarCancelamento(token, dto?.clienteToken, pedidoId);
  }

  // Cliente solicita alteração (endereço/pedido/pagamento) — só avisa a equipe.
  @Post(':token/cliente/pedido/:pedidoId/solicitar-alteracao')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  solicitarAlteracao(@Param('token') token: string, @Param('pedidoId') pedidoId: string, @Body() dto: any) {
    return this.service.solicitarAlteracao(token, dto?.clienteToken, pedidoId, {
      alvo: dto?.alvo,
      detalhe: dto?.detalhe,
    });
  }
}

import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cartaoDaEquipe, clienteDoCaso } from './cartao-da-equipe';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MODULO_PERFIL, PerfilClienteService } from './perfil-cliente.service';

// Delivery › Clientes › Perfil do cliente (F1a do docs/plano-perfil-cliente.md). Só NUVEM e só gestão: o perfil é dado
// pessoal — presidente e gerente com a permissão de delivery, e o módulo "Perfil do cliente" ligado (conferido aqui, não
// na tela). A equipe que atende vê o cartão curto do caso (F6), por outra rota.
@Controller('perfil-cliente')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
@RequirePerm('delivery')
@RequireModulo(MODULO_PERFIL)
@Roles('presidente', 'gerente')
export class PerfilClienteController {
  constructor(private readonly service: PerfilClienteService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user.tenantId);
  }

  /** Saúde da base (F4): os números da loja, somados e sem pessoa — do presidente (protótipo, aba 5). Antes de `:clienteId`
   *  (a rota leria "saude" como id). */
  @Get('saude')
  @Roles('presidente')
  saude(@CurrentUser() user: AuthUser) {
    return this.service.saude(user.tenantId);
  }

  @Get(':clienteId')
  ficha(@CurrentUser() user: AuthUser, @Param('clienteId', new ParseUUIDPipe()) clienteId: string) {
    return this.service.ficha(user.tenantId, clienteId);
  }

  /** Recalcular agora a empresa inteira (o presidente, depois de ligar o módulo). Uma vez por minuto basta. */
  @Post('recalcular')
  @Roles('presidente')
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  recalcular(@CurrentUser() user: AuthUser) {
    return this.service.calcularEmpresa(user.tenantId);
  }
}

// O CARTÃO DO CLIENTE NO CASO DA CENTRAL (F6b do plano do perfil): quem atende — os mesmos papéis e a permissão da Central
// (`pedidos`) — vê o cartão curto do cliente do caso. Só NUVEM: no servidor da loja a tela diz que o cartão aparece pelo
// app na nuvem (as tabelas do perfil só existem lá). Módulo desligado ou "não analisar": `cartao: null`.
@Controller('perfil-cliente/caso')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
@Roles('presidente', 'gerente', 'supervisao', 'execucao')
export class CartaoDoCasoController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get(':casoId')
  async cartao(@CurrentUser() user: AuthUser, @Param('casoId', new ParseUUIDPipe()) casoId: string) {
    const r: any = await this.db.execute(sql`
      select pedido_id, telefone, canal from atendimento_chamado where id = ${casoId}::uuid and tenant_id = ${user.tenantId}::uuid`);
    const caso = (r?.rows ?? r)[0];
    if (!caso) throw new NotFoundException('Caso não encontrado.');
    const clienteId = await clienteDoCaso(this.db, user.tenantId, { pedidoId: caso.pedido_id, telefone: caso.telefone, canal: caso.canal });
    return { cartao: clienteId ? await cartaoDaEquipe(this.db, user.tenantId, clienteId) : null };
  }
}

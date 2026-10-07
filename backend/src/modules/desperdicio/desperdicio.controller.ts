import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { periodoDaConsulta } from '../../common/periodo';
import { DesperdicioService } from './desperdicio.service';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';
import { MOTIVOS_DESPERDICIO, exigirMotivo } from './motivos';

@Controller('desperdicios')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class DesperdicioController {
  constructor(private readonly service: DesperdicioService) {}

  // Registro de desperdício: gestão com a permissão `desperdicio` e, quando o presidente
  // libera no perfil, a execução (decisão do dono). Antes a rota listava execucao nos
  // papéis mas exigia `estoque.criar` — permissão ampla demais (também cria insumo) e que
  // nem a supervisão padrão tinha. O rastro (quem, onde, quando) é gravado sempre.
  @Post()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  @RequirePerm('desperdicio')
  create(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateDesperdicioDto,
  ) {
    // Motivo é da LISTA (motivos.ts): o que vier de fora dela é recusado, não vira motivo novo.
    // Sem motivo continua valendo (campo opcional).
    const motivo = dto.motivo === undefined || dto.motivo.trim() === '' ? undefined : exigirMotivo(dto.motivo);
    return this.service.create(user.tenantId, { ...dto, motivo }, atual, undefined, user.colaboradorId);
  }

  // Lista fechada de motivos (a tela não guarda cópia). Mesma permissão do registro.
  @Get('motivos')
  @RequirePerm('desperdicio')
  motivos() {
    return { motivos: [...MOTIVOS_DESPERDICIO] };
  }

  // `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` limita pela data do desperdício; sem eles, tudo.
  // O custo (base do valor da perda em R$) só sai para quem tem "ver valores em R$" — a mesma
  // regra da lista de produtos. Antes saía para qualquer um com a tela de estoque.
  @Get()
  @RequirePerm('estoque', 'ver')
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const periodo = periodoDaConsulta(inicio, fim);
    const verFinanceiro = !!user.permissoes?.ver_financeiro;
    return this.service
      .findAll(user, atual, periodo)
      .then((lista) => (verFinanceiro ? lista : lista.map((d) => ({ ...d, custoUnitario: null }))));
  }
}

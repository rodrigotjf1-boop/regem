import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { exigirLojaParaLancar } from '../../common/loja-lancamento';
import { ProducaoService } from './producao.service';
import { ProduzirDto } from './dto/produzir.dto';

@Controller('producao')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('producao_kds')
export class ProducaoController {
  constructor(
    private readonly service: ProducaoService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  async produzir(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: ProduzirDto,
  ) {
    // Produção manual consome insumos de UMA loja: sem loja escolhida, em empresa de duas
    // lojas, é recusada (separação total por loja).
    const unidadeId = await exigirLojaParaLancar(this.db, user.tenantId, atual);
    return this.service.produzir(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
      undefined,
      unidadeId,
    );
  }
}

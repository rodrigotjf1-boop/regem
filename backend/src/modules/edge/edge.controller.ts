import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { EdgeService } from './edge.service';

// Rota pública de identificação: o cliente confirma que achou o servidor Regem
// (na LAN via mDNS/IP, ou a nuvem). Sem auth — só diz "sou o Regem".
@Controller()
export class EdgeController {
  constructor(private readonly service: EdgeService) {}

  @Get('ping')
  ping() {
    return this.service.info();
  }

  // O edge consulta se há versão nova publicada (Fase E-D). Só informa versão +
  // url/sha do pacote — nada sensível, por isso público.
  @Get('edge/update-check')
  updateCheck(@Query('versao') versao?: string) {
    return this.service.atualizacao(versao);
  }

  // ----- Atualização pelo app (só no edge; gestão) -----
  @Get('edge/atualizacao/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  atualizacaoStatus() {
    return this.service.statusAtualizacao();
  }

  @Post('edge/atualizacao/verificar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  atualizacaoVerificar() {
    return this.service.verificarAtualizacao();
  }

  @Post('edge/atualizacao/aplicar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  atualizacaoAplicar() {
    return this.service.aplicarAtualizacao();
  }

  @Post('edge/atualizacao/reverter')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  atualizacaoReverter() {
    return this.service.reverterAtualizacao();
  }

  // Disponibilidade do instalador (.exe) — o botão sempre aparece; aqui decide se
  // baixa ou mostra "sem arquivo". Autenticado (a tela /servidor já exige login).
  @Get('edge/instalador')
  @UseGuards(JwtAuthGuard)
  instalador() {
    return this.service.instalador();
  }

  // Telemetria de FALHA de atualização, postada PELO EDGE (atualizar.ps1) na nuvem.
  // Público (o edge não tem sessão de usuário); rate-limit apertado; correlaciona
  // pelo corpo. Nada sensível é executado — só registra + encaminha à distribuição.
  @Post('edge/telemetria/erro')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  telemetriaErro(@Body() body: any) {
    return this.service.telemetriaErro(body ?? {});
  }

  // ----- Restauração do estado da nuvem (só no edge) -----
  @Get('edge/restaurar/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  restaurarStatus() {
    return this.service.statusRestauracao();
  }

  // Operação séria (puxa a nuvem) — só presidente/C&O dispara.
  @Post('edge/restaurar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  restaurar() {
    return this.service.solicitarRestauracao();
  }
}

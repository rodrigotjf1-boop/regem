import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { EdgeService } from './edge.service';
import { EquipamentoService } from '../equipamento/equipamento.service';

// Rota pública de identificação: o cliente confirma que achou o servidor Regem
// (na LAN via mDNS/IP, ou a nuvem). Sem auth — só diz "sou o Regem".
@Controller()
export class EdgeController {
  constructor(
    private readonly service: EdgeService,
    private readonly equipamentos: EquipamentoService,
  ) {}

  // Heartbeat dos clientes (app da loja, KDS, PDV, Ponto) e health-check da atualização.
  // Responde o MESMO corpo sempre — só o status muda: banco fora → 503, para que
  // `r.ok === false` no front derrube o indicador e ofereça o modo nuvem, e para que o
  // `edge/saude-local.mjs` (que já descarta status != 200) REPROVE a atualização.
  @Get('ping')
  async ping(@Res({ passthrough: true }) res: Response) {
    const corpo = await this.service.info();
    if (!corpo.banco) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return corpo;
  }

  // Handshake de compatibilidade cliente↔servidor (Fase 1.3). Público (LAN): o
  // cliente magro checa se sua versão ≥ minClient e se o servidor ≥ seu minServer,
  // recusando combinações incompatíveis antes de operar.
  @Get('edge/handshake')
  handshake() {
    return this.service.handshake();
  }

  // O edge consulta se há versão nova publicada. Só informa versão + url/sha/assinaturas do
  // pacote — nada sensível, por isso público. O token do servidor (x-sync-token) é OPCIONAL:
  // com ele a loja entra no piloto/percentual do release; sem ele (ou inválido) só vê release
  // em 100% — servidores na 1.29.x não mandam token e seguem funcionando.
  @Get('edge/update-check')
  async updateCheck(@Query('versao') versao?: string, @Headers('x-sync-token') token?: string) {
    let tenantId: string | null = null;
    if (token) {
      try {
        const dev = await this.equipamentos.validarToken(String(token));
        if (dev?.tipo === 'servidor_local') tenantId = dev.tenantId;
      } catch {
        /* token ilegível: segue anônimo */
      }
    }
    return this.service.atualizacao(versao, tenantId);
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
  atualizacaoAplicar(@Body() dto: any) {
    return this.service.aplicarAtualizacao(dto ?? {});
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

  // Telemetria GERAL do edge (Frente A): o edge posta erros autenticado por
  // x-sync-token (tenant derivado, sem spoof). Persiste com dedup + alerta a distrib.
  @Post('edge/telemetria')
  @UseGuards(SyncTokenGuard)
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  telemetria(@SyncCtx() ctx: SyncCtxData, @Body() body: any) {
    return this.service.registrarTelemetria(ctx.tenantId, body ?? {});
  }

  // Telemetria do FRONTEND (erro no navegador do cliente). Público + rate-limit; no
  // edge é encaminhado pra nuvem (tenant do sync token); na nuvem, registra se vier
  // tenant. Assim a distribuição vê também os erros de tela, não só de API.
  @Post('edge/telemetria-cliente')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  telemetriaCliente(@Body() body: any) {
    return this.service.encaminharErroCliente(body ?? {});
  }

  // Envia o log recente do servidor local pra distribuição (sob demanda do gestor).
  @Post('edge/enviar-logs')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  enviarLogs() {
    return this.service.enviarLogs();
  }

  // Comandos remotos (Fase 4): o daemon do edge busca os pendentes e confirma.
  @Get('edge/comandos')
  @UseGuards(SyncTokenGuard)
  comandos(@SyncCtx() ctx: SyncCtxData) {
    return this.service.comandosPendentes(ctx.tenantId, ctx.equipamentoId);
  }

  @Post('edge/comandos/:id/ack')
  @UseGuards(SyncTokenGuard)
  ackComando(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() body: any) {
    return this.service.ackComando(ctx.tenantId, id, body?.ok !== false, body?.resultado);
  }

  // C&O da loja vê os erros do próprio edge (histórico + ocorrências). Só na NUVEM: a tabela
  // telemetria_evento não existe no servidor local (lá a rota dava 500).
  @Get('edge/telemetria')
  @CloudOnly()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  listarTelemetria(@CurrentUser() user: AuthUser) {
    return this.service.listarTelemetria(user.tenantId);
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

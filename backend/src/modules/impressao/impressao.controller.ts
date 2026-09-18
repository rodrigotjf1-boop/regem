import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ImpressaoSinalService } from './impressao-sinal.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Teto da espera longa. Abaixo do corte de proxies (Cloudflare 100 s) com folga, e o agente
// usa um timeout maior que isto do lado dele.
const ESPERA_MAX_SEG = 25;
// Sem aviso do banco (LISTEN fora), a espera reconsulta a fila neste intervalo.
const RECONSULTA_MS = 5000;

// Fila de impressão térmica. O agente/worker autentica por token 'servidor_local'
// (x-sync-token) — nunca JWT de usuário; tenant é forçado pelo token.
@Controller('impressao')
export class ImpressaoController {
  constructor(
    private readonly service: ProducaoPedidoService,
    private readonly sinal: ImpressaoSinalService,
  ) {}

  // Agente ANTIGO (consulta a cada 3 s, sem se identificar). Mantido para compatibilidade.
  @Get('pendentes')
  @UseGuards(SyncTokenGuard)
  pendentes(@SyncCtx() ctx: SyncCtxData) {
    // F2: canal de impressão POR LOJA — a unidade vem do token (não-spoofável).
    return this.service.jobsPendentes(ctx.tenantId, ctx.unidadeId ?? null);
  }

  // Agente NOVO: ESPERA LONGA + identificação da máquina.
  //  corpo: { maquina, dispositivos: [nomes das impressoras do Windows], espera: segundos }
  // A requisição fica aberta até `espera` s e volta NA HORA quando entra job da empresa
  // (aviso do banco via ImpressaoSinalService). Antes: 20 consultas/min por agente; agora ~2,4
  // quando a fila está parada. `maquina`/`dispositivos` fazem o job de impressora USB ir só
  // para a máquina onde ela está instalada.
  @Post('pendentes')
  @UseGuards(SyncTokenGuard)
  async pendentesEspera(@SyncCtx() ctx: SyncCtxData, @Body() dto: any, @Req() req: any) {
    const maquina = typeof dto?.maquina === 'string' ? dto.maquina.slice(0, 120) : null;
    const dispositivos = Array.isArray(dto?.dispositivos)
      ? dto.dispositivos.filter((d: any) => typeof d === 'string').map((d: string) => d.slice(0, 200))
      : null;
    // Impressoras ocupadas/fora do ar no agente (fila por impressora + disjuntor lá).
    const excluir = Array.isArray(dto?.excluir) ? dto.excluir : null;
    this.service.registrarAgente(ctx.tenantId, maquina, dispositivos);
    const esperaMs = Math.max(0, Math.min(ESPERA_MAX_SEG, Number(dto?.espera) || 0)) * 1000;
    const fim = Date.now() + esperaMs;
    // Se o agente desistir (rede caiu, serviço parou) não reservamos mais nada para ele — senão
    // o job ficaria preso 120 s numa resposta que ninguém recebe.
    // (`req.on('close')` NÃO serve: desde o Node 16 dispara quando o corpo termina de ser lido.)
    const foi = () => !!req?.socket?.destroyed;
    for (;;) {
      if (foi()) return [];
      const marca = this.sinal.marca(ctx.tenantId); // antes da consulta (ver ImpressaoSinalService)
      const jobs = await this.service.jobsPendentes(ctx.tenantId, ctx.unidadeId ?? null, { maquina, dispositivos, excluir });
      const resta = fim - Date.now();
      if (jobs.length || resta <= 0) return jobs;
      // Com o aviso do banco de pé, espera o tempo que resta (acorda na hora se entrar job — ou
      // se entrou entre a consulta e agora). Sem ele, reconsulta a cada 5 s. Medido antes: 6
      // consultas por espera de 25 s mesmo com o aviso funcionando; agora 2.
      await this.sinal.esperar(ctx.tenantId, this.sinal.ouvindo ? resta : Math.min(RECONSULTA_MS, resta), marca);
    }
  }

  @Post(':id/impresso')
  @UseGuards(SyncTokenGuard)
  impresso(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() dto: any) {
    const maquina = typeof dto?.maquina === 'string' ? dto.maquina.slice(0, 120) : null;
    return this.service.marcarImpresso(ctx.tenantId, id, maquina);
  }

  // Devolve sem gastar tentativa (o agente pausou a impressora — disjuntor).
  @Post(':id/devolver')
  @UseGuards(SyncTokenGuard)
  devolver(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() dto: any) {
    const maquina = typeof dto?.maquina === 'string' ? dto.maquina.slice(0, 120) : null;
    return this.service.devolverJob(ctx.tenantId, id, maquina);
  }

  @Post(':id/erro')
  @UseGuards(SyncTokenGuard)
  erro(
    @SyncCtx() ctx: SyncCtxData,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.marcarErro(ctx.tenantId, id, dto?.erro, dto?.definitivo === true);
  }

  // Fila recente para o painel (status + impressora). Gestor logado; usuário com loja vê a dela.
  @Get('fila')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('producao_kds')
  fila(@CurrentUser() user: AuthUser) {
    return this.service.filaRecente(user.tenantId, user.unidadeId ?? null);
  }

  // Estado de cada impressora (última impressão certa / falha / sem responder). Gestor logado;
  // usuário com loja vê as dela. Nas lojas com servidor local, o painel do app da loja lê o
  // banco dele (onde o worker grava).
  @Get('impressoras/estado')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('producao_kds')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.estadoImpressoras(user.tenantId, user.unidadeId ?? null);
  }

  // Produtos cujo setor não existe nesta loja (via cai na impressora padrão). Gestor logado.
  @Get('avisos-roteamento')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('producao_kds')
  avisos(@CurrentUser() user: AuthUser) {
    return this.service.avisosRoteamento(user.tenantId, user.unidadeId ?? null);
  }

  // Página de teste para uma impressora (gestor logado).
  @Post('impressoras/:id/teste')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('producao_kds')
  teste(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.enfileirarTeste(user.tenantId, id);
  }

  // Reimprimir (gestor logado) — reenfileira um job com erro. Usuário com loja: só da dela.
  @Post(':id/reimprimir')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('producao_kds')
  reimprimir(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.reimprimir(user.tenantId, id, dto?.equipamentoId ?? null, user.unidadeId ?? null);
  }
}

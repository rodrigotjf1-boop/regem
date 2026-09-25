import { exigirBooleano } from '../../common/exigir';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { FiscalService } from './fiscal.service';
import { CloudOnly } from '../../common/cloud-only.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A GESTÃO fiscal (config, lista de notas, cancelamento) exige a permissão "fiscal".
// A EMISSÃO da NFC-e no PDV/delivery é operacional (fica liberada ao operador).
@Controller('fiscal')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class FiscalController {
  constructor(private readonly service: FiscalService) {}

  @Get('config')
  @RequirePerm('fiscal_config')
  config(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeAtual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.getConfig(
      user.tenantId,
      (user.categoria === 'presidente' ? unidadeId || unidadeAtual : unidadeAtual) || null,
    );
  }

  @Put('config')
  @Roles('presidente')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId || null, dto);
  }

  // ===== Certificado A1 e CSC (mig 279) =====
  // Leitura: só dados PÚBLICOS (titular, CNPJ, validade, IDs de CSC) — nunca segredo.
  @Get('credencial')
  @RequirePerm('fiscal_config')
  credencial(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeAtual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.getCredencial(
      user.tenantId,
      (user.categoria === 'presidente' ? unidadeId || unidadeAtual : unidadeAtual) || null,
    );
  }

  // Escrita: SÓ NA NUVEM e só o presidente. A cópia-mestra fica cifrada na nuvem; o servidor
  // local recebe a sua pelo canal autenticado do sync, cifrada com a chave DELE.
  @CloudOnly()
  @Put('credencial/certificado')
  @Roles('presidente')
  setCertificado(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setCertificado(user.tenantId, user.colaboradorId, dto?.unidadeId || null, dto);
  }

  // Prova o certificado guardado: assina uma nota de exemplo e confere. Sem SEFAZ, sem gravar.
  @CloudOnly()
  @Post('credencial/testar')
  @Roles('presidente')
  testarCertificado(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.testarCertificado(user.tenantId, dto?.unidadeId || null);
  }

  // NFC-e de TESTE — só em HOMOLOGAÇÃO (a rota recusa produção). Um item de R$ 1,00, sem
  // comanda, sem impressão: a primeira nota de verdade, sem inventar venda.
  @CloudOnly()
  @Post('sefaz/teste-homologacao')
  @Roles('presidente')
  emitirTesteHomologacao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.emitirTesteHomologacao(user.tenantId, user.colaboradorId, dto?.unidadeId || null);
  }

  // Consulta de STATUS da SEFAZ com o certificado guardado. Não emite nada.
  @CloudOnly()
  @Post('sefaz/status')
  @Roles('presidente')
  statusSefaz(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.statusSefaz(user.tenantId, dto?.unidadeId || null);
  }

  @CloudOnly()
  @Put('credencial/csc')
  @Roles('presidente')
  setCsc(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setCsc(user.tenantId, user.colaboradorId, dto?.unidadeId || null, dto);
  }

  @Post('comandas/:id/emitir')
  emitir(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.emitir(user.tenantId, user.colaboradorId, id);
  }

  @Get('notas')
  @RequirePerm('fiscal')
  notas(@CurrentUser() user: AuthUser) {
    return this.service.listarNotas(user.tenantId);
  }

  @Get('notas/:id')
  @RequirePerm('fiscal')
  nota(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getNota(user.tenantId, id);
  }

  // Pergunta à SEFAZ o que aconteceu com uma nota que ficou sem resposta. NÃO é só-nuvem:
  // a loja emite as próprias notas e é a única que pode resolver as pendências dela.
  @Post('notas/:id/consultar')
  @Roles('presidente', 'gerente')
  consultarNota(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.consultarNota(user.tenantId, id, user.colaboradorId);
  }

  // Vendas com DUAS notas autorizadas (a pendente que apareceu autorizada depois) e o
  // cancelamento por substituição, que é a única forma legal de desfazer — em 168 h.
  @Get('duplicidades')
  @Roles('presidente', 'gerente')
  duplicidades(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.duplicidades(user.tenantId, unidadeId);
  }

  @Post('notas/:id/cancelar-substituicao')
  @Roles('presidente', 'gerente')
  cancelarPorSubstituicao(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelarPorSubstituicao(user.tenantId, user.colaboradorId, id, dto?.justificativa);
  }

  // LACUNAS de numeração e INUTILIZAÇÃO. Não é só-nuvem: a loja emite as próprias notas,
  // deixa as próprias lacunas e pede a própria inutilização (a série dela é dela).
  @Get('lacunas')
  @Roles('presidente', 'gerente')
  lacunas(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null, @Query('serie') serie?: string) {
    return this.service.lacunas(user.tenantId, unidadeId, serie ? Number(serie) : undefined);
  }

  // CONTINGÊNCIA OFF-LINE. Também não é só-nuvem: quem fica sem SEFAZ é o caixa da loja, e é
  // lá que a fila precisa ser vista — inclusive quando a internet ainda não voltou.
  @Get('contingencia')
  @Roles('presidente', 'gerente')
  contingencia(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.painelContingencia(user.tenantId, unidadeId);
  }

  // Força um ciclo agora (sair da contingência se a SEFAZ voltou + transmitir a fila), em vez
  // de esperar os 5 minutos do job. É o botão de quem está olhando o prazo correr. Só a fila da
  // PRÓPRIA empresa: o job é que passa pela fila de todas as lojas (ERR-105).
  @Post('contingencia/transmitir')
  @Roles('presidente', 'gerente')
  transmitirContingencia(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.transmitirContingencia({ tenantIds: [user.tenantId], unidadeId });
  }

  // QUAIS TERMINAIS EMITEM NFC-e (mig 288). Decisão com peso fiscal: só PRESIDENTE e GERÊNCIA
  // — no servidor, não na tela —, e cada mudança fica auditada com o antes e o depois.
  @Get('terminais')
  @Roles('presidente', 'gerente')
  terminais(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.listarTerminaisFiscais(user.tenantId, unidadeId);
  }

  @Put('terminais/:id')
  @Roles('presidente', 'gerente')
  definirTerminal(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    // Liga/desliga EXPLÍCITO: corpo vazio não pode virar "não emite" em silêncio (V15).
    const emite = exigirBooleano(dto?.emiteNfce, 'emiteNfce');
    return this.service.definirTerminalFiscal(user.tenantId, user.colaboradorId ?? null, user.categoria ?? '', id, emite);
  }

  @Get('inutilizacoes')
  @Roles('presidente', 'gerente')
  inutilizacoes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.service.listarInutilizacoes(user.tenantId, unidadeId);
  }

  // Irreversível: a faixa homologada nunca mais pode virar nota. Só o presidente.
  @Post('inutilizar')
  @Roles('presidente')
  inutilizar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.inutilizarFaixa(user.tenantId, user.colaboradorId, dto);
  }

  @Post('notas/:id/cancelar')
  @Roles('presidente', 'gerente')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, id, dto?.justificativa);
  }
}

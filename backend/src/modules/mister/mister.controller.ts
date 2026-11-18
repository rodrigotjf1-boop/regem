import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { MisterAvisosHistoricoService } from './mister-avisos-historico.service';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterMemoriaService } from './mister-memoria.service';
import { MisterVinculoService } from './mister-vinculo.service';

// O WHATSAPP DE QUEM ESTÁ LOGADO no Mister e a parte "Pessoas" (mig 417). Gerente e presidente, só na nuvem e só com o
// módulo ligado. Cada um liga o PRÓPRIO número: nenhuma rota recebe telefone, e o código sai sempre para o usuário logado.
// A única rota que nomeia outra pessoa é a de DESLIGAR — e o serviço só a aceita do presidente, dentro da empresa dele.
@Controller('mister')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterController {
  constructor(
    private readonly vinculo: MisterVinculoService,
    private readonly avisos: MisterAvisosConfigService,
    private readonly relatorios: MisterRelatoriosConfigService,
    private readonly historico: MisterAvisosHistoricoService,
    private readonly conversa: MisterConversaConfigService,
    private readonly memoria: MisterMemoriaService,
  ) {}

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

  /** A parte "Pessoas": o presidente vê os gerentes e presidentes da empresa; o gerente recebe só a própria linha. */
  @Get('pessoas')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  pessoas(@CurrentUser() user: AuthUser) {
    return this.vinculo.pessoas(user);
  }

  /** Desliga o WhatsApp de uma pessoa: o próprio, ou — só o presidente — o de outra pessoa da empresa dele. */
  @Delete('pessoas/:colaboradorId')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  desligarPessoa(@CurrentUser() user: AuthUser, @Param('colaboradorId') colaboradorId: string) {
    return this.vinculo.desligarPessoa(user, colaboradorId);
  }

  /** Para onde vai cada aviso (mig 419): a escolha da empresa ou o padrão. Só o presidente. */
  @Get('avisos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  avisosDaTela(@CurrentUser() user: AuthUser) {
    return this.avisos.daTela(user.tenantId);
  }

  /** O histórico dos avisos (F1.4 parte B): a situação, para onde foram e a trilha. Só o presidente. */
  @Get('avisos/historico')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  historicoDosAvisos(
    @CurrentUser() user: AuthUser,
    @Query('situacao') situacao?: string,
    @Query('busca') busca?: string,
    @Query('grupo') grupo?: string,
    @Query('dias') dias?: string,
  ) {
    return this.historico.historico(user.tenantId, { situacao, busca, grupo, dias });
  }

  /** Salva os avisos que mudaram (cada um inteiro). Só o presidente; toda recusa antes da gravação. */
  @Patch('avisos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  salvarAvisos(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.avisos.salvar(user, dto);
  }

  /** O horário de cada relatório (mig 420): a escolha da empresa ou o padrão (desligado), e o último envio. Só o presidente. */
  @Get('relatorios')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  relatoriosDaTela(@CurrentUser() user: AuthUser) {
    return this.relatorios.daTela(user.tenantId);
  }

  /** Salva os relatórios que mudaram (cada um inteiro). Só o presidente; toda recusa antes da gravação. */
  @Patch('relatorios')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  salvarRelatorios(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.relatorios.salvar(user, dto);
  }

  /** Os ajustes da conversa (mig 440): ligar a leitura de documentos por foto e o modo do boleto. Só o presidente. */
  @Get('conversa')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  conversaDaTela(@CurrentUser() user: AuthUser) {
    return this.conversa.daTela(user.tenantId);
  }

  /** Salva os ajustes da conversa (o ausente mantém o salvo). Só o presidente; toda recusa antes da gravação. */
  @Patch('conversa')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  salvarConversa(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.conversa.salvar(user, dto);
  }

  // ── Versão 4, M4b (mig 449): "O que o Mister sabe" — só o presidente, só na nuvem, com o módulo ligado ──

  /** O que o Mister sabe da empresa e de cada pessoa que ainda vale, com o uso de letras. */
  @Get('memoria')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  memoriaDaTela(@CurrentUser() user: AuthUser) {
    return this.memoria.daTela(user.tenantId);
  }

  /** Anota: `sobre` = "empresa" ou o id de uma pessoa da empresa; `texto` = uma frase (o servidor confere). */
  @Post('memoria')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  async anotar(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    const d = (dto ?? {}) as { sobre?: unknown; texto?: unknown };
    const sobre = d.sobre === 'empresa' ? null : typeof d.sobre === 'string' ? d.sobre : undefined;
    if (sobre === undefined) return MisterMemoriaService.paraATela({ ok: false, erro: 'Diga sobre quem é a anotação: a empresa ou uma pessoa.' });
    if (sobre && !/^[0-9a-f-]{36}$/i.test(sobre)) return MisterMemoriaService.paraATela({ ok: false, erro: 'Essa pessoa não é desta empresa.' });
    return MisterMemoriaService.paraATela(await this.memoria.anotar(this.quem(user), sobre, d.texto));
  }

  /** Troca o texto de uma anotação. */
  @Patch('memoria/:id')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  async trocarMemoria(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: unknown) {
    return MisterMemoriaService.paraATela(await this.memoria.trocar(this.quem(user), { id }, ((dto ?? {}) as { texto?: unknown }).texto));
  }

  /** Esquece uma anotação (não dá para desfazer). */
  @Delete('memoria/:id')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  async esquecerMemoria(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.memoria.esquecer(this.quem(user), { id });
    if (!r.ok && r.erro === 'Essa anotação não existe mais.') MisterMemoriaService.naoAchada();
    return MisterMemoriaService.paraATela(r);
  }

  /** Quem mexe pela tela: o presidente (a rota barra os outros). */
  private quem(user: AuthUser) {
    return { tenantId: user.tenantId, colaboradorId: user.colaboradorId, presidente: true, origem: 'presidente' as const };
  }
}

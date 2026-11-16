import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { DistribuicaoService } from './distribuicao.service';
import { DistCtx, DistUser, DistribuicaoGuard, PerfilDist, PerfilDistGuard } from './distribuicao.guard';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { IbptService } from '../fiscal/ibpt/ibpt.service';
import { IntegracaoTokenService } from '../integracao-api/integracao-token.service';
import { OrzuniLigacaoService } from '../orzuni/orzuni-ligacao.service';
import { PrecosNa99Service } from './precos-na-99.service';
import { ConferirAppsService } from './conferir-apps.service';
import { MisterConsoleService } from '../mister/mister-console.service';
import { MisterAvisosHistoricoService } from '../mister/mister-avisos-historico.service';
import { DependenciasService } from '../dependencias/dependencias.service';
import { MisterQualidadeService } from '../mister/mister-qualidade.service';
import { MisterAvaliacaoService } from '../mister/mister-avaliacao.service';
import { MisterSegurancaService } from '../mister/mister-seguranca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição (Fase 1). Realm próprio: login, perfil, auditoria.
@Controller('distribuicao')
@CloudOnly()
export class DistribuicaoController {
  constructor(
    private readonly service: DistribuicaoService,
    private readonly ibpt: IbptService,
    private readonly integracao: IntegracaoTokenService,
    private readonly orzuni: OrzuniLigacaoService,
    private readonly precos99: PrecosNa99Service,
    private readonly conferirApps: ConferirAppsService,
    private readonly mister: MisterConsoleService,
    private readonly avisosDoMister: MisterAvisosHistoricoService,
    private readonly dependencias: DependenciasService,
    private readonly qualidadeDoMister: MisterQualidadeService,
    private readonly avaliacaoDoMister: MisterAvaliacaoService,
    private readonly segurancaDoMister: MisterSegurancaService,
  ) {}

  // iFood pelo Orzuni (R2a; mig 370) — só Diretoria. A chave `orz_live_` da loja entra aqui UMA vez e é trocada
  // pelo segredo da ligação, guardado cifrado; nenhum dos dois volta nesta resposta nem vai para o log.
  @Get('orzuni')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  painelOrzuni(@Query('tenantId') tenantId: string) {
    return this.orzuni.painel(tenantId);
  }

  @Post('orzuni/ligacoes')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  async registrarLigacaoOrzuni(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.orzuni.registrar(dto, u);
    await this.service.auditar(u, 'ligou_loja_ao_orzuni', r.id, {
      tenantId: dto?.tenantId,
      loja: r.loja,
      prefixo: r.prefixo,
      trocouAnterior: r.trocouAnterior,
    });
    return r;
  }

  @Post('orzuni/ligacoes/:id/revogar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async revogarLigacaoOrzuni(@DistUser() u: DistCtx, @Param('id') id: string, @Body() dto: any) {
    const r = await this.orzuni.revogar(id, dto?.motivo, u);
    if (!r.jaRevogada) await this.service.auditar(u, 'desligou_loja_do_orzuni', id, { tenantId: r.tenantId, prefixo: r.prefixo });
    return r;
  }

  @Post('orzuni/liberacao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async liberacaoOrzuni(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.orzuni.liberacao(dto, u);
    await this.service.auditar(u, r.liberado ? 'ligou_ifood_pelo_orzuni' : 'desligou_ifood_pelo_orzuni', r.tenantId, {});
    return r;
  }

  // Preço e pausa na 99 (R3 F2; mig 401) — só Diretoria: o direito `precos_na_99` da empresa, ligado só com todos os
  // servidores de loja dela na versão com a mig 401.
  @Get('precos-na-99')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  painelPrecosNa99(@Query('tenantId') tenantId: string) {
    return this.precos99.painel(tenantId);
  }

  @Post('precos-na-99/liberacao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async liberacaoPrecosNa99(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.precos99.liberacao(dto, u);
    await this.service.auditar(u, r.liberado ? 'ligou_precos_na_99' : 'desligou_precos_na_99', r.tenantId, {});
    return r;
  }

  // "Conferir com os apps" (R3 F4a; mig 405) — só Diretoria: o direito `conferir_apps` da empresa (nasce desligado).
  @Get('conferir-apps')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  painelConferirApps(@Query('tenantId') tenantId: string) {
    return this.conferirApps.painel(tenantId);
  }

  @Post('conferir-apps/liberacao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async liberacaoConferirApps(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.conferirApps.liberacao(dto, u);
    await this.service.auditar(u, r.liberado ? 'ligou_conferir_apps' : 'desligou_conferir_apps', r.tenantId, {});
    return r;
  }

  // O Mister (mig 417) — só Diretoria: o número de WhatsApp da distribuição, a chave geral e as empresas com o módulo.
  // O painel não traz chave de IA, telefone de gestor nem conversa — só situação e volume.
  @Get('mister')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  painelDoMister() {
    return this.mister.painel();
  }

  @Get('mister/empresas')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  empresasDoMister(@Query('busca') busca?: string) {
    return this.mister.empresas(busca);
  }

  @Post('mister/numero/conectar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async conectarNumeroDoMister(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.mister.conectar(dto, u);
    await this.service.auditar(u, 'conectou_numero_mister', undefined, { forma: r.numero.forma, final: String(r.numero.numero ?? '').slice(-4), avisos: r.avisos.length });
    return r;
  }

  @Post('mister/numero/desconectar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async desconectarNumeroDoMister(@DistUser() u: DistCtx) {
    const r = await this.mister.desconectar(u);
    await this.service.auditar(u, 'desconectou_numero_mister', undefined, {});
    return r;
  }

  @Post('mister/liberacao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async liberacaoDoMister(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.mister.liberacao(dto, u);
    await this.service.auditar(u, r.ligado ? 'ligou_mister' : 'desligou_mister', undefined, {});
    return r;
  }

  // Os modelos de mensagem do Mister na Meta (avisos e resumos fora das 24 horas): a situação lida ao vivo e o pedido de
  // aprovação. O texto de cada modelo é do código (`mister-modelos.ts`); o console só pede.
  @Get('mister/modelos')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  modelosDoMister() {
    return this.mister.modelos();
  }

  @Post('mister/modelos/pedir')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async pedirModelosDoMister(@DistUser() u: DistCtx) {
    const r = await this.mister.pedirModelos();
    await this.service.auditar(u, 'pediu_modelos_mister', undefined, { pedidos: r.pedidos, recusas: r.recusas.map((x) => x.nome) });
    return r;
  }

  // Os avisos para o suporte da DMS (F1.4 parte B): os de destino "Suporte da DMS" de todas as empresas — só a empresa, a
  // loja e o aviso. Diretoria e Técnico.
  @Get('mister/avisos')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  avisosParaOSuporte(@Query('situacao') situacao?: string, @Query('busca') busca?: string) {
    return this.avisosDoMister.paraOSuporte({ situacao, busca });
  }

  // As dependências (F3, parte 2; mig 423): cada integração em uso com a situação lida nas fontes oficiais. Diretoria e
  // Técnico, como a aba Avisos. "Ler agora" lê as fontes na hora (a rotina lê todo dia às 06:07).
  @Get('dependencias')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  dependenciasNoConsole() {
    return this.dependencias.lista();
  }

  @Post('dependencias/ler-agora')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  async lerDependenciasAgora(@DistUser() u: DistCtx) {
    const r = await this.dependencias.vigiar();
    await this.service.auditar(u, 'leu_dependencias', undefined, { fontes: r.map((x) => `${x.fonte}:${x.leu ? (x.mudou ? 'mudou' : 'igual') : 'falhou'}`) });
    return { lidas: r };
  }

  @Post('dependencias/:fonte/decisao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  async decidirDependencia(@DistUser() u: DistCtx, @Param('fonte') fonte: string, @Body() dto: any) {
    const r = await this.dependencias.decidir(fonte, dto?.decisao, dto?.nota, u?.nome ?? null);
    await this.service.auditar(u, 'decidiu_dependencia', undefined, { fonte: r.fonte, decisao: r.decisao });
    return r;
  }

  // A qualidade do Mister (F5, parte 1 — a linha de base): só números das perguntas de todas as empresas (respondidas,
  // tempo, custo, consultas, motivos de não responder) — nunca o texto. Só a Diretoria, como a aba Mister.
  @Get('mister/qualidade')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  qualidadeDoMisterNoConsole(@Query('dias') dias?: string) {
    return this.qualidadeDoMister.resumo(dias);
  }

  // M2a (mig 432): "Virou tarefa" / "Não se aplica" num padrão do "O que melhorar", e "Desfazer a decisão". Só a Diretoria;
  // nada muda no Mister por aqui — a decisão só organiza a lista. A auditoria do console guarda quem, o padrão e a decisão.
  @Post('mister/qualidade/decisao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async decidirPadraoDoMister(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.qualidadeDoMister.decidir(dto, u?.nome ?? null);
    await this.service.auditar(u, 'decidiu_padrao_do_mister', undefined, { chave: r.chave, decisao: r.decisao, tarefa: r.tarefa });
    return r;
  }

  @Post('mister/qualidade/desfazer')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async desfazerDecisaoDoMister(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.qualidadeDoMister.desfazer(dto?.chave);
    await this.service.auditar(u, 'desfez_decisao_do_mister', undefined, { chave: dto?.chave });
    return r;
  }

  // A segurança do Mister (o Sentinela, parte 1): o que as proteções barraram ou recusaram, só contagens — nunca o
  // telefone, o texto ou o código. Só a Diretoria, como a aba Mister.
  @Get('mister/seguranca')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  segurancaDoMisterNoConsole(@Query('dias') dias?: string) {
    return this.segurancaDoMister.resumo(dias);
  }

  // A avaliação de regressão do Mister (F5.3, mig 424): as perguntas fixas numa loja de teste com dados inventados, com a
  // chave da DMS, conferidas por regra. Só a Diretoria; rodar gasta a chave da DMS, então só pelo botão e com limite.
  @Get('mister/avaliacoes')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  avaliacoesDoMister() {
    return this.avaliacaoDoMister.lista();
  }

  @Get('mister/avaliacoes/:id')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  avaliacaoDoMisterDetalhe(@Param('id') id: string) {
    return this.avaliacaoDoMister.detalhe(id);
  }

  @Post('mister/avaliacoes')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async rodarAvaliacaoDoMister(@DistUser() u: DistCtx) {
    const r = await this.avaliacaoDoMister.rodar(u?.nome ?? null);
    await this.service.auditar(u, 'rodou_avaliacao_do_mister', undefined, { avaliacao: r.id, perguntas: r.total });
    return r;
  }

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  login(@Body() dto: any, @Req() req: any) {
    return this.service.login(dto?.email, dto?.senha, dto?.codigo, req?.ip);
  }

  // MFA (F9.5) — cadastro do 2º fator (usuário logado da distribuição).
  @Post('mfa/iniciar')
  @UseGuards(DistribuicaoGuard)
  mfaIniciar(@DistUser() u: DistCtx) {
    return this.service.mfaIniciar(u);
  }

  @Post('mfa/confirmar')
  @UseGuards(DistribuicaoGuard)
  mfaConfirmar(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.mfaConfirmar(u, dto?.codigo);
  }

  // Cria o 1º usuário (diretoria) com a tabela vazia. Header x-bootstrap-secret =
  // DIST_BOOTSTRAP_SECRET (env). Some assim que existir 1 usuário.
  @Post('bootstrap')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  bootstrap(@Body() dto: any, @Headers('x-bootstrap-secret') seg: string) {
    return this.service.bootstrap(dto, seg ?? '');
  }

  @Get('me')
  @UseGuards(DistribuicaoGuard)
  me(@DistUser() u: DistCtx) {
    return u;
  }

  // Gestão de usuários — só Diretoria.
  @Get('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  usuarios() {
    return this.service.listar();
  }

  @Post('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  criarUsuario(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.criar(dto, u);
  }

  // Frota — todos os perfis veem (lojas, versão do edge, online, licença).
  @Get('frota')
  @UseGuards(DistribuicaoGuard)
  frota() {
    return this.service.frota();
  }

  // F3b — trava de instalação (anti-clone): liga/desliga por loja (Diretoria + Técnico).
  // Desligar = "liberar" a loja p/ reinstalar o edge em máquina nova sem o 2º fator.
  @Post('licencas/:tenantId/trava')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  trava(@DistUser() u: DistCtx, @Param('tenantId') id: string, @Body() dto: any) {
    return this.service.trava(id, dto ?? {}, u);
  }

  // Desvincula a máquina desta loja (device_fingerprint=null) — escape do anti-clone
  // "equipamento já vinculado a outra empresa" ao repor/reaproveitar um PC.
  @Post('licencas/:tenantId/liberar-maquina')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  liberarMaquina(@DistUser() u: DistCtx, @Param('tenantId') id: string) {
    return this.service.liberarMaquina(id, u);
  }

  // F9 — Acesso de SUPORTE a uma loja (Diretoria + Técnico). Emite um token curto,
  // escopado (só config, cat='suporte') e AUDITADO na trilha da própria loja.
  @Post('suporte/iniciar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  iniciarSuporte(@DistUser() u: DistCtx, @Body() dto: any, @Req() req: any) {
    return this.service.iniciarSuporte(u, dto?.tenantId, dto?.motivo, req?.ip);
  }

  @Post('suporte/encerrar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  encerrarSuporte(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.encerrarSuporte(u, dto?.sessaoId);
  }

  // Telemetria — Diretoria + Técnico (Financeiro não vê logs técnicos).
  @Get('telemetria')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  telemetria() {
    return this.service.telemetria();
  }

  @Post('telemetria/:id/resolver')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  resolverTelemetria(@DistUser() u: DistCtx, @Param('id') id: string) {
    return this.service.resolverTelemetria(id, u);
  }

  // Licenças — ver: Diretoria+Técnico+Financeiro. Agir: Diretoria+Financeiro.
  @Get('licencas')
  @UseGuards(DistribuicaoGuard)
  licencas() {
    return this.service.licencas();
  }

  @Post('licencas/:tenantId/revogar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  revogar(@DistUser() u: DistCtx, @Param('tenantId') id: string) {
    return this.service.revogarLicenca(id, u);
  }

  @Post('licencas/:tenantId/liberar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  liberar(@DistUser() u: DistCtx, @Param('tenantId') id: string, @Body() dto: any) {
    return this.service.liberarLicenca(id, dto?.dias ?? 30, u);
  }

  @Post('licencas/:tenantId/plano')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  plano(@DistUser() u: DistCtx, @Param('tenantId') id: string, @Body() dto: any) {
    return this.service.mudarPlano(id, String(dto?.plano ?? ''), u);
  }

  // Releases (publicar/listar) — Diretoria. O edge lê o último no update-check.
  @Get('releases')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  releases() {
    return this.service.releases();
  }

  @Post('releases')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  publicarRelease(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.publicarRelease(dto, u);
  }

  // Tabela do IBPT (Lei 12.741) — aba Atualizações. Situação por UF (vigente, próxima, dias para
  // vencer) e o envio do arquivo baixado no site do IBPT: o ZIP como veio, ou os CSVs de UF.
  @Get('ibpt')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  ibptStatus() {
    return this.ibpt.status();
  }

  @Post('ibpt')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  @UseInterceptors(FilesInterceptor('arquivos', 40, { limits: { fileSize: 40 * 1024 * 1024 } }))
  async enviarIbpt(@DistUser() u: DistCtx, @UploadedFiles() arquivos: any[]) {
    const r = await this.ibpt.importar(
      (arquivos ?? []).map((a) => ({ nome: String(a.originalname ?? ''), dados: a.buffer as Buffer })),
      u?.nome ?? u?.sub ?? null,
    );
    await this.service.auditar(u, 'importou_tabela_ibpt', null, {
      tabelas: r.importadas.map((i: any) => `${i.uf} ${i.versao} (${i.vigenciaInicio} a ${i.vigenciaFim})`),
    });
    return r;
  }

  // Distribuição escalonada de um release: percentual, lojas piloto, pausar, recolher.
  @Post('releases/:id/distribuicao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  ajustarRelease(@DistUser() u: DistCtx, @Param('id') id: string, @Body() dto: any) {
    return this.service.ajustarRelease(id, dto, u);
  }

  // Rollback remoto — Diretoria+Técnico (o edge executa no próximo ciclo).
  @Post('licencas/:tenantId/rollback')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  rollbackRemoto(@DistUser() u: DistCtx, @Param('tenantId') id: string) {
    return this.service.comandoRemoto(id, 'rollback', u);
  }

  // Auditoria — Diretoria (histórico das ações da distribuição).
  @Get('auditoria')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  auditoria() {
    return this.service.listarAuditoria();
  }

  // Pedidos de integração — Diretoria + Técnico (quem conecta no portal do canal).
  @Get('pedidos-integracao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  pedidosIntegracao() {
    return this.service.pedidosIntegracao();
  }

  @Post('pedidos-integracao/:id/resolver')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  resolverPedidoIntegracao(@DistUser() u: DistCtx, @Param('id') id: string, @Body() dto: any) {
    const acao =
      dto?.acao === 'recusado' ? 'recusado' : dto?.acao === 'removido' ? 'removido' : 'conectado';
    return this.service.resolverPedidoIntegracao(id, acao, u, { merchantId: dto?.merchantId });
  }

  // Tokens de integração POR LOJA (trilha C, C1a) — só Diretoria. No piloto a distribuição emite
  // o token com a autorização do presidente e o grava direto no cofre do Liame: o token aparece
  // UMA vez, nesta resposta (sem cache), e o banco guarda só o hash. Auditoria dupla: a da
  // distribuição (aqui) e a da empresa (no serviço), para a loja ver no log dela.
  @Get('integracoes/tokens')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  tokensIntegracao(@Query('tenantId') tenantId: string) {
    return this.integracao.painelEmpresa(tenantId);
  }

  @Post('integracoes/tokens')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Header('Cache-Control', 'no-store')
  async emitirTokenIntegracao(@DistUser() u: DistCtx, @Body() dto: any) {
    const r = await this.integracao.emitir(dto, u);
    await this.service.auditar(u, 'emitiu_token_integracao', r.id, {
      tenantId: dto?.tenantId,
      loja: r.loja?.nome ?? 'Empresa inteira',
      cliente: r.cliente,
      prefixo: r.prefixo,
      escopos: r.escopos,
      autorizadoPor: r.autorizadoPor,
    });
    return r;
  }

  @Post('integracoes/tokens/:id/revogar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  async revogarTokenIntegracao(@DistUser() u: DistCtx, @Param('id') id: string, @Body() dto: any) {
    const r = await this.integracao.revogarPeloConsole(id, dto?.motivo, u);
    if (!r.jaRevogado) {
      await this.service.auditar(u, 'revogou_token_integracao', id, {
        tenantId: r.tenantId,
        prefixo: r.prefixo,
        motivo: dto?.motivo,
      });
    }
    return r;
  }
}

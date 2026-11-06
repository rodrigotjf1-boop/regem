import { Body, Controller, Get, Logger, Param, Post, Put, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { Pedido99Service, RespostaAo99 } from './pedido-99.service';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { TerminalAtual } from '../../auth/terminal-atual.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService, RespostaDaDisputa } from './disputa-ifood.service';
import { ChatIfoodService, lerAjusteIfood } from './chat-ifood.service';
import { FilaEAvisosService, lerAjusteDaFila, MINUTOS_DO_AVISO } from './fila-e-avisos.service';
import { ChegadaService } from '../chegada/chegada.service';
import { lerAjusteCheguei, MINUTOS_DE_NOVO } from '../chegada/chegada';
import { PedidoRepetidoService } from '../pedido-repetido/pedido-repetido.service';
import { lerAjusteRepetido } from '../pedido-repetido/pedido-repetido';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { lerAjusteAlterado, SONS_DO_ALTERADO } from '../pedido-alterado/pedido-alterado';
import { AjustesDaPonteService } from '../ponte-chat/ajustes-da-ponte.service';
import { ehServidorLocal } from '../../common/modo';
import { ChatDoCasoService } from './chat-do-caso.service';

// Chamados de atendimento (handoff). Operados por quem está no balcão/gestão.
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
export class AtendimentoController {
  constructor(
    private readonly service: AtendimentoService,
    private readonly disputa: DisputaIfoodService,
    private readonly pedido99: Pedido99Service,
    private readonly chatIfood: ChatIfoodService,
    private readonly filaEAvisos: FilaEAvisosService,
    private readonly chegada: ChegadaService,
    // Pedido igual em até 30 min (mig 360): o grupo "Pedido repetido" dos ajustes.
    private readonly repetido: PedidoRepetidoService,
    // Pedido alterado (mig 362): o som do KDS, no grupo "Pedido alterado" dos ajustes.
    private readonly producao: ProducaoPedidoService,
    // A ponte do chat do iFood e da 99 (mig 366, parte A2): o grupo "iFood e 99 · chat pela ponte" e a faixa da fila.
    private readonly ponte: AjustesDaPonteService,
    // O chat do iFood e da 99 dentro do caso (Etapa 2): a conversa do pedido e a resposta da equipe pela ponte.
    private readonly chat: ChatDoCasoService,
  ) {}

  // O CHAT DO iFOOD E DA 99 DENTRO DO CASO (ponte do chat, Etapa 2): a conversa do pedido, com o estado de cada envio. Lê
  // quem atende a fila; no servidor da loja, vem da nuvem (V37).
  @Get(':id/chat')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  chatDoCaso(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.conversa(user, id);
  }

  // "CONVERSAS AGORA" (protótipo v3): as conversas do chat do iFood e da 99 que o robô (ou os avisos) atende, sem caso
  // aberto, na última hora — e as do WhatsApp com o robô, só para quem atende a caixa do WhatsApp (o serviço confere).
  // As mensagens moram na nuvem: no servidor da loja o serviço pede a ela, com quem está na tela de lá (V37).
  @Get('conversas-agora')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  conversasAgora(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.chat.conversasAgora(user.tenantId, unidade, user);
  }

  // "Assumir a conversa": o caso nasce com quem assumiu e o robô fica quieto. Só quem responde no chat (a gestão, como
  // `POST :id/chat`): assumir sem poder responder calaria o robô e deixaria o cliente sem ninguém. No WhatsApp, só quem
  // atende a caixa do WhatsApp (permissão `bot` — o serviço confere). No servidor da loja, a nuvem assume (V37).
  @Post('conversas-agora/assumir')
  @Roles('presidente', 'gerente', 'supervisao')
  assumirConversa(@CurrentUser() user: AuthUser, @Body() dto: { canal?: unknown; chave?: unknown; nome?: unknown }) {
    return this.chat.assumir(user, dto);
  }

  // A resposta da equipe no chat da plataforma: entra na fila de saída e a ponte do PC da loja digita. Responde a gestão,
  // como no WhatsApp do caso.
  @Post(':id/chat')
  @Roles('presidente', 'gerente', 'supervisao')
  responderNoChat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { texto?: unknown }) {
    return this.chat.responder(user, id, dto);
  }

  // A configuração do CHAT OFICIAL DO iFOOD (o widget da distribuição e as lojas do iFood da empresa). Sem o widget
  // cadastrado pela distribuição, `disponivel: false` — a tela não mostra o botão.
  @Get('chat-ifood')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  chatDoIfood(@CurrentUser() user: AuthUser) {
    return this.chatIfood.config(user.tenantId);
  }

  // Resposta ao pedido de CANCELAMENTO ou REEMBOLSO do cliente da 99 (aceitar ou recusar com o motivo da lista). Só
  // gerente e presidente — a senha diz quem respondeu.
  @Post(':id/pedido99')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  responderPedido99(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RespostaAo99) {
    return this.pedido99.responder(user, id, dto);
  }

  // Os ajustes do atendimento: "Fila e avisos" (mig 353 — avisar o gerente se ninguém pegar o caso; dizer ao cliente a
  // posição na fila; ficam na `robo_config`) e a 99 (decidir o cancelamento na fila; o tempo e o motivo da recusa
  // automática do reembolso; ficam na integração). Os dois moram só na nuvem — no servidor da loja a tela mostra "só pela
  // nuvem".
  // "Retirada · cliente chegou" (mig 354): o "Cheguei" mora no `cardapio_config` da LOJA EM USO (sem linha dela, a da
  // empresa) — sincroniza com o servidor da loja, que lê o aviso e o "avisar de novo" de lá.
  @Get('ajustes')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  async ajustes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    const [da99, fila, doIfood, cheguei, repetido, som, roboMuda, ponte, roboCobraPix] = await Promise.all([
      this.pedido99.ajustes(user.tenantId),
      this.filaEAvisos.ajustes(user.tenantId),
      this.chatIfood.ajustes(user.tenantId),
      this.chegada.ajustes(user.tenantId, unidade),
      this.repetido.ajustes(user.tenantId, unidade),
      this.producao.somDoAlterado(user.tenantId, unidade),
      // "O robô faz mudanças simples" (mig 363): no mesmo grupo "Pedido alterado", como no protótipo; da empresa.
      this.filaEAvisos.roboMudaPedido(user.tenantId),
      // A ponte do chat do iFood e da 99 (mig 366): os ajustes da empresa e as pontes da loja em uso.
      this.ponte.ajustes(user.tenantId, unidade),
      // "O robô cobra no Pix o item posto em pedido já pago" (mig 373): no grupo "Pedido alterado"; da empresa.
      this.filaEAvisos.roboCobraAdicionalPix(user.tenantId),
    ]);
    const alterado = { som, sons: SONS_DO_ALTERADO, roboMuda, roboCobraPix };
    return { ...da99, fila, minutosDoAviso: MINUTOS_DO_AVISO, ...doIfood, cheguei, minutosDeNovoCheguei: MINUTOS_DE_NOVO, repetido, alterado, ponte };
  }

  // Cada grupo pelo seu dono, só o que veio. A fila, o iFood e o "Cheguei" são conferidos ANTES de gravar qualquer
  // coisa: um salvar com vários grupos não grava um e recusa o outro.
  @Put('ajustes')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  async salvarAjustes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: any) {
    if (dto?.fila !== undefined) lerAjusteDaFila(dto.fila);
    if (dto?.ifood !== undefined) lerAjusteIfood(dto.ifood);
    const cheguei = dto?.cheguei !== undefined ? lerAjusteCheguei(dto.cheguei) : null;
    const repetido = dto?.repetido !== undefined ? lerAjusteRepetido(dto.repetido) : null;
    const alterado = dto?.alterado !== undefined ? lerAjusteAlterado(dto.alterado) : null;
    // A ponte: o texto e o papel dos PCs (lê as pontes da loja) — conferidos antes de gravar qualquer grupo.
    if (dto?.ponte !== undefined) await this.ponte.conferir(user, unidade, dto.ponte);
    if (dto?.ajuste99 !== undefined) await this.pedido99.salvarAjustes(user, dto);
    if (dto?.ponte !== undefined) await this.ponte.salvar(user, unidade, dto.ponte);
    if (dto?.fila !== undefined) await this.filaEAvisos.salvar(user, dto.fila);
    if (dto?.ifood !== undefined) await this.chatIfood.salvarAjustes(user, dto.ifood);
    if (cheguei) await this.chegada.salvarAjustes(user, unidade, cheguei);
    if (repetido) await this.repetido.salvarAjustes(user, unidade, repetido);
    if (alterado?.som !== undefined)
      await this.producao.salvarSomDoAlterado(user.tenantId, unidade, alterado.som, { id: user.colaboradorId, perfil: user.categoria });
    if (alterado?.roboMuda !== undefined) await this.filaEAvisos.salvarRoboMudaPedido(user, alterado.roboMuda);
    if (alterado?.roboCobraPix !== undefined) await this.filaEAvisos.salvarRoboCobraAdicionalPix(user, alterado.roboCobraPix);
    return this.ajustes(user, unidade);
  }

  // Resposta à DISPUTA do iFood (aceitar, recusar ou propor). Quem decide é a senha: só gerente e presidente (decisão
  // do dono, 01/11/2026) — qualquer pessoa da equipe abre o diálogo, a senha diz quem respondeu.
  @Post(':id/disputa')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  responderDisputa(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RespostaDaDisputa) {
    return this.disputa.responder(user, id, dto);
  }

  // A foto `n` que o cliente mandou na disputa (o iFood só entrega com a credencial da loja).
  @Get(':id/foto/:n')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  async fotoDaDisputa(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('n') n: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.disputa.foto(user.tenantId, id, Number(n) || 0);
    res.setHeader('Content-Type', f.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(f.bytes);
  }

  @Get()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  // A FILA da central de atendimento (Onda 1): os casos abertos da loja em uso, na ordem da fila, e as contagens.
  @Get('fila')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  async fila(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    // Com os avisos da disputa (ajuste do iFood): o app e o computador de quem é gerente avisam por eles.
    // E a FAIXA da ponte do chat (mig 366, só nuvem): no servidor da loja, a última que a nuvem mandou — renovada em
    // segundo plano, sem a fila esperar a internet (`ponteDaNuvem`).
    // E o ALERTA do Pix do adicional (mig 373, só nuvem): o robô pôs item num pedido já pago e espera o Pix — "segure o
    // pedido". Fora da fila (não é caso); null = não li (o servidor da loja ainda sem a resposta da nuvem).
    const [fila, avisos, ponte, adicionaisPix] = await Promise.all([
      this.service.fila(user, unidade),
      this.chatIfood.avisos(user.tenantId),
      ehServidorLocal()
        ? Promise.resolve(this.chat.ponteDaNuvem(user.tenantId, unidade))
        : this.ponte.situacao(user.tenantId, unidade).catch((e: any) => {
            // A fila sai mesmo assim (a faixa some); o motivo fica no log (V11).
            new Logger('Atendimento').warn(`[ponte-chat] situação da ponte: ${e?.message ?? e}`);
            return null;
          }),
      ehServidorLocal()
        ? Promise.resolve(this.chat.adicionaisDaNuvem(user.tenantId, unidade))
        : this.chat.adicionaisDaEmpresa(user.tenantId, unidade).catch((e: any) => {
            new Logger('Atendimento').warn(`alerta do Pix do adicional: ${e?.message ?? e}`);
            return null;
          }),
    ]);
    return { ...fila, avisos, ponte, adicionaisPix };
  }

  // Os casos resolvidos hoje (a situação "Resolvidos hoje" da tela).
  @Get('fila/resolvidos')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  resolvidos(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.service.resolvidosHoje(user, unidade);
  }

  // As pessoas ativas da loja (só id e nome) — a lista do "Passar o caso".
  @Get('equipe')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  equipe(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.service.equipe(user, unidade);
  }

  @Post(':id/pegar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  pegar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.pegar(user, id);
  }

  // `para` = colaborador ativo da equipe; vazio = de volta para a fila.
  @Post(':id/passar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  passar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { para?: string | null }) {
    return this.service.passar(user, id, dto);
  }

  // `aguardando` true = esperando o cliente; false = volta para a fila (ou para quem tem o caso).
  @Post(':id/aguardar')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  aguardar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { aguardando?: unknown }) {
    return this.service.aguardar(user, id, dto);
  }

  @Post(':id/resolver')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  resolver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resolver(user.tenantId, id, user.colaboradorId);
  }

  // Veredito de um pedido de cancelamento feito pelo cliente: aceita (cancela o
  // pedido de fato — exige senha de gestor) ou recusa (só encerra o chamado). Aceitando, o destino dos insumos é o
  // mesmo do cancelamento do painel (ERR-339): `reaproveitado` (padrão true) e, na perda, `perdaItens`.
  @Post(':id/cancelamento')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  decidirCancelamento(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { aceita?: boolean; senha?: string; motivo?: string; reaproveitado?: boolean; perdaItens?: unknown },
    @TerminalAtual() terminalId: string | null, // o comprovante do cancelamento sai na impressora deste PC
  ) {
    return this.service.decidirCancelamento(user, id, dto, terminalId);
  }

  // "Mudar o endereço e avisar o entregador" (PR 3b-2): o caso urgente do pedido que já saiu. `taxa` = 'manter' (a do
  // pedido) ou 'nova' (a da área nova, que o Regem calculou) — nunca um valor digitado.
  @Post(':id/endereco-depois-que-saiu')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  mudarEnderecoDepoisQueSaiu(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { taxa?: unknown }) {
    return this.service.mudarEnderecoDepoisQueSaiu(user, id, dto);
  }
}

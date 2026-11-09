import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
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
import { AvaliacaoIfoodService } from './avaliacao-ifood.service';
import { GestorWhatsappService } from './gestor-whatsapp.service';
import { CopilotoService } from './copiloto.service';
import { NumerosDoAtendimentoService } from './numeros.service';
import { InstagramService } from '../instagram/instagram.service';
import { MessengerService } from '../messenger/messenger.service';
import { lerAjusteGestorWa } from './gestor-whatsapp';
import { FRASE_FORA_PADRAO, MINUTOS_ANTES_DA_EQUIPE, MINUTOS_DEPOIS_DA_EQUIPE, TEXTO_FORA_MAX, lerAjusteDaEquipe } from './horario-da-equipe';
import { CANAIS_DO_PERFIL, JEITO_MAX, PERFIS_DO_ATENDENTE, PERFIS_FORA_DO_HORARIO, ROTULO_DO_CANAL, lerPerfisDoAtendente } from '../cardapio/perfis-do-atendente';
import {
  ASSUNTOS_DO_ATENDENTE,
  MODOS_DO_ASSUNTO,
  TEXTO_DO_ASSUNTO_MAX,
  TEXTO_PADRAO_DO_RECADO,
  TEXTO_PADRAO_NAO,
  lerAssuntosDoAtendente,
} from '../cardapio/assuntos-do-atendente';

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
    // A avaliação do iFood no caso (06/11/2026): a resposta da loja, pública no iFood.
    @Optional() private readonly avaliacao?: AvaliacaoIfoodService,
    // Gerente no WhatsApp (mig 375): o grupo dos ajustes, ligar e desligar o WhatsApp de cada gestor.
    @Optional() private readonly gestorWa?: GestorWhatsappService,
    // O copiloto (mig 376): a sugestão de resposta no caso e o grupo "Copiloto" dos ajustes.
    @Optional() private readonly copiloto?: CopilotoService,
    // Os números do atendimento (item 8): o placar, as reclamações e o "O que aconteceu?" do caso.
    @Optional() private readonly numerosSvc?: NumerosDoAtendimentoService,
    // O Instagram Direct (mig 377): o grupo "Instagram Direct" dos ajustes (a conta e "Mensagens do Direct na fila").
    @Optional() private readonly instagram?: InstagramService,
    // O Messenger do Facebook (mig 386): o grupo "Messenger do Facebook" dos ajustes (a página, a fila, o robô e o cardápio).
    @Optional() private readonly messenger?: MessengerService,
  ) {}

  // O COPILOTO (mig 376; protótipo versão 5): se o botão aparece (ligado na empresa E disponível na distribuição) e a
  // sugestão de resposta do caso. Quem atende o caso pede (os quatro níveis, como o "Enviar"); só na nuvem — a chave do
  // modelo mora lá. A sugestão só volta para a caixa de escrever: nada é enviado.
  @Get('copiloto')
  @CloudOnly()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  estadoDoCopiloto(@CurrentUser() user: AuthUser) {
    return this.copiloto ? this.copiloto.estado(user.tenantId) : { ligado: false, disponivel: false };
  }

  @Post(':id/sugestao')
  @CloudOnly()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  sugerirResposta(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    if (!this.copiloto) throw new BadGatewayException('O copiloto não está disponível neste servidor.');
    return this.copiloto.sugerir(user, id, dto);
  }

  // NÚMEROS DO ATENDIMENTO (item 8; protótipo versão 6): o placar por canal, as reclamações por motivo e por produto e
  // quanto custou — da loja em uso (o presidente em "todas as lojas" vê a soma). Só gerente e presidente: tem valor em R$.
  // No servidor da loja, a conta vem da nuvem (o chat do iFood e da 99 mora lá — V37).
  @Get('numeros')
  @Roles('presidente', 'gerente')
  numerosDoAtendimento(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Query('periodo') periodo?: string) {
    return this.exigirNumeros().numeros(user.tenantId, unidade, periodo);
  }

  @Get('numeros/casos')
  @Roles('presidente', 'gerente')
  casosDoNumero(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Query() q: { periodo?: string; motivo?: string; produto?: string }) {
    return this.exigirNumeros().casos(user.tenantId, unidade, q ?? {});
  }

  // "O que aconteceu?" no caso (o passo opcional do Resolver e o "Marcar o motivo" dos números): o que está marcado e os
  // produtos do pedido; e gravar. Quem resolve o caso marca (os quatro níveis).
  @Get(':id/o-que-aconteceu')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  oQueAconteceu(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exigirNumeros().doCaso(user.tenantId, id);
  }

  @Put(':id/o-que-aconteceu')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  marcarOQueAconteceu(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    return this.exigirNumeros().salvar(user, id, dto);
  }

  private exigirNumeros(): NumerosDoAtendimentoService {
    if (!this.numerosSvc) throw new BadGatewayException('Os números do atendimento não estão disponíveis neste servidor.');
    return this.numerosSvc;
  }

  // GERENTE NO WHATSAPP (mig 375, parte 5a): o grupo da tela (o ajuste, a via da loja, o modelo da Meta e quem recebe —
  // de cada pessoa só o final do número), o código para o gestor ligar o PRÓPRIO WhatsApp e o desligar. Só na nuvem (os
  // webhooks do WhatsApp moram lá), só gerente e presidente — quem recebe os avisos.
  @Get('whatsapp-do-gestor')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  whatsappDoGestor(@CurrentUser() user: AuthUser) {
    return this.gestorWaOuErro().grupo(user);
  }

  @Post('whatsapp-do-gestor/ligar')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  ligarWhatsappDoGestor(@CurrentUser() user: AuthUser) {
    return this.gestorWaOuErro().ligar(user);
  }

  @Delete('whatsapp-do-gestor/:colaboradorId')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  async desligarWhatsappDoGestor(@CurrentUser() user: AuthUser, @Param('colaboradorId', ParseUUIDPipe) colaboradorId: string) {
    await this.gestorWaOuErro().desligar(user, colaboradorId);
    return this.gestorWaOuErro().grupo(user);
  }

  private gestorWaOuErro(): GestorWhatsappService {
    if (!this.gestorWa) throw new BadGatewayException('Gerente no WhatsApp indisponível neste servidor.');
    return this.gestorWa;
  }

  // A RESPOSTA À AVALIAÇÃO do iFood (06/11/2026): a gestão responde, como no chat do caso. Fica pública no iFood; uma só.
  @Post(':id/avaliacao')
  @Roles('presidente', 'gerente', 'supervisao')
  responderAvaliacao(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { texto?: unknown }) {
    if (!this.avaliacao) throw new BadGatewayException('A resposta de avaliações não está disponível agora.');
    return this.avaliacao.responder(user, id, dto ?? {});
  }

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
  // "Horário da equipe" (mig 379): `equipe` (da empresa, na `robo_config`) e `equipeOpcoes` (as escolhas e o texto padrão).
  // "Perfil do atendente virtual" (mig 380): `perfis` (sempre WhatsApp, Direct, — F5 — o chat do iFood e da 99 e — F6 — os
  // comentários do Instagram, com os padrões) e `perfisOpcoes`. "Instagram Direct" (`instagram`): + `comentarios` (F6, mig
  // 384 — `permitido`, `roboResponde`, `naFila`). A ponte: `ponte.roboModo` (F5, mig 383 — quem responde no chat: regras ou atendente).
  // "Assuntos que não são pedido" (mig 381): `assuntos` (sempre fornecedor, vaga e parceria, com os padrões) e
  // `assuntosOpcoes` (os assuntos, os modos, o limite do texto e os textos padrão).
  // "Messenger do Facebook" (`messenger`, mig 386): `disponivel`, `roboDisponivel`, `cardapios`, `conta` (a página — nunca o
  // acesso) e `escolhaPendente`; o perfil do canal `messenger` vem em `perfis`.
  @Get('ajustes')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  async ajustes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    const [da99, fila, doIfood, cheguei, repetido, som, roboMuda, ponte, roboCobraPix, gestorWa, copiloto, instagram, equipe, perfis, assuntos, messenger] = await Promise.all([
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
      // "Gerente no WhatsApp" (mig 375): o ajuste da empresa e quem recebe.
      this.gestorWa ? this.gestorWa.grupo(user) : Promise.resolve(null),
      // "Copiloto" (mig 376): ligado na empresa e disponível na distribuição.
      this.copiloto ? this.copiloto.estado(user.tenantId) : Promise.resolve(null),
      // "Instagram Direct" (mig 377): se a distribuição liberou e a conta conectada (nunca o acesso).
      this.instagram ? this.instagram.ajuste(user.tenantId) : Promise.resolve(null),
      // "Horário da equipe" (mig 379): sempre ou no horário da loja, a folga e o que o robô diz fora do horário; da empresa.
      this.filaEAvisos.ajusteDaEquipe(user.tenantId),
      // "Perfil do atendente virtual" (mig 380): o perfil, o de fora do horário e o jeito da loja de cada canal; da empresa.
      this.filaEAvisos.perfisDoAtendente(user.tenantId),
      // "Assuntos que não são pedido" (mig 381): o que o robô faz com fornecedor, vaga e parceria, e o que diz; da empresa.
      this.filaEAvisos.assuntosDoAtendente(user.tenantId),
      // "Messenger do Facebook" (mig 386): se a distribuição liberou e a página conectada (nunca o acesso).
      this.messenger ? this.messenger.ajuste(user.tenantId) : Promise.resolve(null),
    ]);
    const alterado = { som, sons: SONS_DO_ALTERADO, roboMuda, roboCobraPix };
    return {
      ...da99,
      equipe,
      equipeOpcoes: { antesMin: MINUTOS_ANTES_DA_EQUIPE, depoisMin: MINUTOS_DEPOIS_DA_EQUIPE, textoForaPadrao: FRASE_FORA_PADRAO, textoForaMax: TEXTO_FORA_MAX },
      perfis,
      // `rotulos` (F5): o nome de cada canal na tela — o `chat` é "Chat do iFood e da 99"; `comentarios` (F6), "Comentários do Instagram".
      perfisOpcoes: { canais: CANAIS_DO_PERFIL, rotulos: ROTULO_DO_CANAL, perfis: PERFIS_DO_ATENDENTE, foraDoHorario: PERFIS_FORA_DO_HORARIO, jeitoMax: JEITO_MAX },
      assuntos,
      assuntosOpcoes: {
        assuntos: ASSUNTOS_DO_ATENDENTE,
        modos: MODOS_DO_ASSUNTO,
        textoMax: TEXTO_DO_ASSUNTO_MAX,
        textoPadrao: TEXTO_PADRAO_DO_RECADO,
        textoPadraoNao: TEXTO_PADRAO_NAO,
      },
      fila,
      minutosDoAviso: MINUTOS_DO_AVISO,
      ...doIfood,
      cheguei,
      minutosDeNovoCheguei: MINUTOS_DE_NOVO,
      repetido,
      alterado,
      ponte,
      gestorWa,
      copiloto,
      instagram,
      messenger,
    };
  }

  // Cada grupo pelo seu dono, só o que veio. A fila, o iFood e o "Cheguei" são conferidos ANTES de gravar qualquer
  // coisa: um salvar com vários grupos não grava um e recusa o outro.
  @Put('ajustes')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  async salvarAjustes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: any) {
    if (dto?.fila !== undefined) lerAjusteDaFila(dto.fila);
    // "Horário da equipe" (mig 379): cada escolha só entre as opções e o texto até 300 letras — conferido antes de gravar
    // qualquer grupo (V86); o que não veio fica (V16).
    if (dto?.equipe !== undefined) lerAjusteDaEquipe(dto.equipe);
    // "Perfil do atendente virtual" (mig 380): canal, perfil e o jeito até 300 letras — conferidos antes de gravar
    // qualquer grupo (V86); o que não veio fica (V16).
    if (dto?.perfis !== undefined) lerPerfisDoAtendente(dto.perfis);
    // "Assuntos que não são pedido" (mig 381): assunto, o que o robô faz e o texto até 300 letras — conferidos antes de
    // gravar qualquer grupo (V86); o que não veio fica (V16).
    if (dto?.assuntos !== undefined) lerAssuntosDoAtendente(dto.assuntos);
    if (dto?.ifood !== undefined) lerAjusteIfood(dto.ifood);
    const cheguei = dto?.cheguei !== undefined ? lerAjusteCheguei(dto.cheguei) : null;
    const repetido = dto?.repetido !== undefined ? lerAjusteRepetido(dto.repetido) : null;
    const alterado = dto?.alterado !== undefined ? lerAjusteAlterado(dto.alterado) : null;
    const gestorWa = dto?.gestorWa !== undefined ? lerAjusteGestorWa(dto.gestorWa) : null;
    // O copiloto (mig 376): liga/desliga só com booleano (V15), conferido antes de gravar qualquer grupo.
    if (dto?.copiloto !== undefined && typeof dto.copiloto?.ligado !== 'boolean')
      throw new BadRequestException('Copiloto: escolha ligado ou desligado.');
    // "Instagram Direct" (migs 377/378): a fila, o robô e o cardápio do robô — conferidos (com o banco) antes de gravar
    // qualquer grupo (V86); só booleano nos liga/desliga (V15); o que não veio fica (V16).
    const instagram = dto?.instagram !== undefined && this.instagram ? await this.instagram.conferirAjuste(user.tenantId, dto.instagram) : null;
    // "Messenger do Facebook" (mig 386): a fila, o robô e o cardápio do robô — conferidos (com o banco) antes de gravar
    // qualquer grupo (V86); `exigirBooleano` nos liga/desliga (V15); o que não veio fica (V16).
    const messenger = dto?.messenger !== undefined && this.messenger ? await this.messenger.conferirAjuste(user.tenantId, dto.messenger) : null;
    // A ponte: o texto e o papel dos PCs (lê as pontes da loja) — conferidos antes de gravar qualquer grupo.
    if (dto?.ponte !== undefined) await this.ponte.conferir(user, unidade, dto.ponte);
    if (dto?.ajuste99 !== undefined) await this.pedido99.salvarAjustes(user, dto);
    if (dto?.ponte !== undefined) await this.ponte.salvar(user, unidade, dto.ponte);
    if (dto?.fila !== undefined) await this.filaEAvisos.salvar(user, dto.fila);
    if (dto?.equipe !== undefined) await this.filaEAvisos.salvarEquipe(user, dto.equipe);
    if (dto?.perfis !== undefined) await this.filaEAvisos.salvarPerfis(user, dto.perfis);
    if (dto?.assuntos !== undefined) await this.filaEAvisos.salvarAssuntos(user, dto.assuntos);
    if (dto?.ifood !== undefined) await this.chatIfood.salvarAjustes(user, dto.ifood);
    if (cheguei) await this.chegada.salvarAjustes(user, unidade, cheguei);
    if (repetido) await this.repetido.salvarAjustes(user, unidade, repetido);
    if (alterado?.som !== undefined)
      await this.producao.salvarSomDoAlterado(user.tenantId, unidade, alterado.som, { id: user.colaboradorId, perfil: user.categoria });
    if (alterado?.roboMuda !== undefined) await this.filaEAvisos.salvarRoboMudaPedido(user, alterado.roboMuda);
    if (alterado?.roboCobraPix !== undefined) await this.filaEAvisos.salvarRoboCobraAdicionalPix(user, alterado.roboCobraPix);
    if (gestorWa) await this.gestorWa?.salvar(user, gestorWa);
    if (dto?.copiloto !== undefined) await this.copiloto?.salvar(user, dto.copiloto.ligado);
    if (instagram) await this.instagram?.salvarAjuste(user, instagram);
    if (messenger) await this.messenger?.salvarAjuste(user, messenger);
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
    // O recado para o responsável (mig 381) só vai à gestão (e a quem está com ele): o serviço filtra pelo perfil.
    return this.service.listar(user.tenantId, 'aberto', user);
  }

  // A FILA da central de atendimento (Onda 1): os casos abertos da loja em uso, na ordem da fila, e as contagens.
  // HORÁRIO DA EQUIPE (mig 379): o recado que espera a abertura só vem com `?comRecados=1` (a tela nova pede; o app e as
  // telas antigas não recebem — não tocam de madrugada); a resposta traz `equipe` (a faixa "Fora do horário da equipe").
  @Get('fila')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  async fila(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Query('comRecados') comRecados?: string) {
    // Com os avisos da disputa (ajuste do iFood): o app e o computador de quem é gerente avisam por eles.
    // E a FAIXA da ponte do chat (mig 366, só nuvem): no servidor da loja, a última que a nuvem mandou — renovada em
    // segundo plano, sem a fila esperar a internet (`ponteDaNuvem`).
    // E o ALERTA do Pix do adicional (mig 373, só nuvem): o robô pôs item num pedido já pago e espera o Pix — "segure o
    // pedido". Fora da fila (não é caso); null = não li (o servidor da loja ainda sem a resposta da nuvem).
    const [fila, avisos, ponte, adicionaisPix] = await Promise.all([
      this.service.fila(user, unidade, { comRecados: comRecados === '1' || comRecados === 'true' }),
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
  resolver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto?: { oQueAconteceu?: unknown }) {
    return this.service.resolver(user.tenantId, id, user.colaboradorId, dto ?? null, user.nome ?? null);
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

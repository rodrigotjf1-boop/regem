import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { segredoDoRoboOk } from '../../common/segredo-robo';
import {
  chaveDoTeste,
  ehChaveDeTeste,
  ehChaveDoChat,
  ehChaveDoComentario,
  ehChaveDoDirect,
  ehChaveDoMessenger,
  idDaChaveDeTeste,
} from '../../common/conversa-do-robo';
import { AUDIO_NO_TESTE, gravarMensagem, linhaDaTravaNoTeste, testeDaChave } from '../atendimento/teste-do-atendente';
import { responderNoChatDaPlataforma } from '../ponte-chat/atendente-no-chat';
import { opcoesNoChat, travaDaPlataforma } from '../ponte-chat/texto-do-chat';
import { InstagramService } from '../instagram/instagram.service';
import { comOrigemDoDirect } from '../instagram/instagram';
import { MessengerService } from '../messenger/messenger.service';
import { comOrigemDoMessenger } from '../messenger/messenger';
import { WhatsappService } from './whatsapp.service';
import { WhatsappCloudService, cabeEmBotoes, opcoesValidas } from './whatsapp-cloud.service';
import { EstadoPausa, estadoDaPausa } from './robo-pausa';
import { idDoEnvio, marcarDoRobo } from './mensagens-do-robo';
import { fimDaResposta } from './resposta-em-andamento';
import { linkDoCardapioDaLoja, separarLinkDoCardapio, soLinksDaLoja } from './links-do-robo';
import {
  escolherProduto,
  fotoServe,
  legendaDoProduto,
  linkComProduto,
  idDaUltimaDoCliente,
  pedeFoto,
  perguntaDoCliente,
  produtoDoLink,
  produtosDaLoja,
} from './foto-do-produto';
import { buscarUrlPublica } from '../../common/ssrf-guard';
import {
  Reacao,
  baloesLigados,
  emBaloes,
  paraOWhatsapp,
  pausaAntesDoBalao,
  semFormatacao,
  separarOpcoesSoltas,
  separarPrint,
  separarReacao,
  urlDoPrint,
  type PassoDoPrint,
} from './formato-da-resposta';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Opcao = { id?: string; titulo: string; descricao?: string };
/** O que a rota do robô devolve: saiu (e por qual forma) ou foi segurada (o motivo). Sempre 200. */
export type RespostaDoRobo = { ok: boolean; enviado: boolean; motivo?: string; enviados?: string[] };
export type PedidoDeResposta = {
  instancia?: string; // Evolution
  phoneNumberId?: string; // API oficial
  para?: string;
  texto?: string;
  opcoes?: Opcao[];
  /** Evolution não tem botão confiável: 'numerado' (padrão) ou 'enquete'. */
  opcoesComo?: 'numerado' | 'enquete';
  /** Rótulo do botão que abre a lista (API oficial, 4 a 10 opções). */
  botaoLista?: string;
  /** Nota de voz (OGG/Opus na API oficial; qualquer formato na Evolution, que converte). */
  audio?: { base64?: string; mime?: string };
  /**
   * O id da mensagem do cliente a que esta resposta responde (o fluxo 2.3 do n8n manda — 17/11/2026): a reação da linha
   * `REACAO:` e o "digitando…" entre os balões. Sem ele, na API oficial vale a última mensagem do cliente gravada; na
   * Evolution não há reação.
   */
  responderA?: string;
  /** Evolution: o jid da conversa como ela mandou (pode ser `@lid`) — a reação vai a ele. */
  jid?: string;
};

const soDigitos = (v: unknown) => String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

/** O id de mensagem que dá para usar (wamid da Meta ou `key.id` da Evolution). */
const idDeMensagem = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return /^[A-Za-z0-9._:=+/-]{6,200}$/.test(t) ? t : null;
};

/**
 * O que o robô mandou, pronto para o canal (17/11/2026 — `formato-da-resposta.ts`): as linhas de controle saem (`REACAO:`
 * vira a reação; `OPCOES:` fora da última linha vira as opções, quando o n8n não mandou nenhuma), o texto ganha o formato
 * do canal e o título das opções fica sem formatação (botão e lista não mostram negrito).
 */
export function lerResposta(
  p: PedidoDeResposta | undefined,
  formatar: (t: unknown) => string,
): { texto: string; opcoes: Opcao[]; reacao: Reacao | null; print: PassoDoPrint | null } {
  const { texto: semReacao, reacao } = separarReacao(p?.texto);
  // A linha `PRINT: <passo>` (D3) sai do texto em TODO canal; só o WhatsApp a usa (com o ajuste da loja ligado).
  const { texto: semPrint, print } = separarPrint(semReacao);
  const soltas = separarOpcoesSoltas(semPrint);
  const pedidas = Array.isArray(p?.opcoes) ? (p?.opcoes as Opcao[]) : [];
  const opcoes = (pedidas.length ? pedidas : soltas.opcoes).map((o: any) =>
    o && typeof o === 'object' ? { ...o, titulo: semFormatacao(o.titulo), ...(o.descricao ? { descricao: semFormatacao(o.descricao) } : {}) } : o,
  );
  return { texto: formatar(soltas.texto).trim(), opcoes: opcoesValidas(opcoes), reacao, print };
}

/**
 * A resposta para um canal SEM formatação e sem reação (Direct, Messenger, chat do iFood e da 99, comentário): o texto
 * sem negrito; só a reação, sem texto nem opções = o emoji como texto.
 */
function semFormatacaoNoCanal(p: PedidoDeResposta | undefined): { bruto: string; opcoes: Opcao[] } {
  const lida = lerResposta(p, semFormatacao);
  return { bruto: lida.texto || (lida.reacao && !lida.opcoes.length ? lida.reacao : ''), opcoes: lida.opcoes };
}

/**
 * O AVISO DE QUE CHAMOU ALGUÉM (30/10/2026, ligando o robô na loja piloto): o robô chama o atendente pela ferramenta e,
 * segundos depois, manda "já chamei um atendente" — mas o chamado aberto já cala o robô (robo-pausa.ts) e o aviso era
 * segurado; o cliente ficava sem resposta. Sai UMA resposta por chamado, até 90 s depois de ele abrir, e só enquanto
 * quem cala é o chamado (atendente que já respondeu ou "Pausar" manual vencem). Depois disso, calado como sempre.
 */
export const JANELA_DO_AVISO_MS = 90_000;
const avisados = new Map<string, number>(); // id do chamado → até quando lembrar

export function avisoDoChamadoLiberado(estado: EstadoPausa | null, agora = Date.now()): boolean {
  if (!estado?.pausado || estado.motivo !== 'chamado' || !estado.chamado) return false;
  const idade = agora - estado.chamado.criadoEm.getTime();
  if (idade < -5_000 || idade > JANELA_DO_AVISO_MS) return false; // -5 s: relógio do banco um pouco à frente
  for (const [id, ate] of avisados) if (ate <= agora) avisados.delete(id);
  if (avisados.has(estado.chamado.id)) return false;
  avisados.set(estado.chamado.id, agora + 10 * 60_000);
  return true;
}

/** Só para teste. */
export function esquecerAvisosDeChamado(): void {
  avisados.clear();
}

/** "Escolha:\n\n1) Ver cardápio\n2) Falar com atendente\n\nResponda com o número." — o menu do número sem botão. */
export function menuNumerado(texto: string, opcoes: Opcao[]): string {
  const linhas = opcoesValidas(opcoes).map((o, i) => `${i + 1}) ${o.titulo}${o.descricao ? ` — ${o.descricao}` : ''}`);
  const cabeca = String(texto ?? '').trim();
  return `${cabeca ? `${cabeca}\n\n` : ''}${linhas.join('\n')}\n\nResponda com o número da opção.`;
}

// A RESPOSTA DO ROBÔ — uma porta só para as duas vias (Fase 2 do robô, 29/10/2026). O n8n diz O QUE quer mandar (texto,
// opções, voz); aqui se decide COMO, pelo provedor da loja:
//  • API oficial: até 3 opções = botões; 4 a 10 = lista; mais = menu numerado em texto; voz = nota de voz (OGG/Opus).
//  • Evolution (QR): opções = menu numerado (padrão) ou enquete; voz = nota de voz (ela converte).
// E as travas que valem para TODA resposta do robô: robô ligado e cardápio ativo, provedor certo e conversa NÃO pausada
// (atendente assumiu, chamado aberto — robo-pausa.ts). Resposta segurada volta `enviado: false` com o motivo (200).
@Injectable()
export class RoboRespostaService {
  private readonly logger = new Logger('RoboResposta');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
    // O robô no Direct do Instagram (mig 378). Opcional: os testes do WhatsApp montam sem ele.
    @Optional() private readonly instagram?: InstagramService,
    // Avisa a tela Atendimento do caso que a resposta do atendente no chat da plataforma abriu (F5). Opcional: os testes montam sem.
    @Optional() private readonly events?: EventEmitter2,
    // O robô no Messenger do Facebook (mig 386). Opcional, como o do Direct.
    @Optional() private readonly messenger?: MessengerService,
  ) {}

  async responder(segredo: string, p: PedidoDeResposta): Promise<RespostaDoRobo> {
    if (!segredoDoRoboOk(segredo)) throw new UnauthorizedException('Não autorizado.');
    return this.responderDoRegem(p);
  }

  /**
   * A MESMA porta, chamada pelo próprio Regem (a mensagem pronta da pausa dos pedidos, F3 — `pausa-no-atendimento.ts`):
   * sem a senha (quem chama está aqui dentro), com o mesmo roteamento por canal e as mesmas travas (robô ligado, conversa
   * não assumida por uma pessoa).
   */
  async responderDoRegem(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    // A conversa de TESTE do atendente (chave `teste:` na instância ou no `para`, mig 382) ANTES de tudo: a resposta fica
    // na conversa de teste e NADA sai para cliente nenhum (nem as travas de robô ligado/conversa pausada valem aqui).
    if (ehChaveDeTeste(p?.instancia) || ehChaveDeTeste(p?.para)) return this.responderNoTeste(p);
    // O CHAT DO iFOOD E DA 99 (chave `chat:`, F5 — mig 383) ANTES de qualquer conta de telefone: tirando o `chat:`, sobram
    // os dígitos do uuid, que virariam um número de WhatsApp.
    if (ehChaveDoChat(p?.instancia) || ehChaveDoChat(p?.para)) return this.responderNoChat(p);
    // O COMENTÁRIO de um post do Instagram (chave `cm:`, F6 — mig 384) ANTES de qualquer conta de telefone: tirando o `cm:`,
    // sobram os dígitos do id do comentário, que virariam um número de WhatsApp.
    if (ehChaveDoComentario(p?.instancia) || ehChaveDoComentario(p?.para)) return this.responderNoComentario(p);
    // O MESSENGER do Facebook (chave `fb:` na instância e no `para`, mig 386) ANTES de qualquer conta de telefone: tirando o
    // `fb:`, sobram dígitos que virariam um número de WhatsApp.
    if (ehChaveDoMessenger(p?.instancia) || ehChaveDoMessenger(p?.para)) return this.responderNoMessenger(p);
    // O Direct do Instagram (chave `ig:` na instância e no `para`) ANTES de qualquer conta de telefone: tirando o `ig:`,
    // sobram dígitos que virariam um número de WhatsApp.
    if (ehChaveDoDirect(p?.instancia) || ehChaveDoDirect(p?.para)) return this.responderNoDirect(p);
    const via: 'cloud' | 'evolution' = String(p?.phoneNumberId ?? '').trim() ? 'cloud' : 'evolution';
    const loja = await this.evolution.lojaDoRobo(p?.instancia, p?.phoneNumberId);
    if (!loja) throw new NotFoundException('Número/instância não vinculado a uma loja.');
    const [cfg] = await this.db.select().from(cardapioConfig).where(eq(cardapioConfig.tenantId, loja.tenantId));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    // A loja trocou de provedor no meio da conversa: o fluxo da outra via não fala por ela.
    if ((cfg.provedor ?? 'evolution') !== via) throw new BadRequestException(`Loja está no provedor '${cfg.provedor}'.`);

    const para = soDigitos(p?.para);
    if (!para) throw new BadRequestException('Número inválido.');
    // .f25 (17/11/2026): as linhas de controle saem e o texto ganha a formatação do WhatsApp (formato-da-resposta.ts) —
    // antes do filtro de links, que confere os endereços no texto já arrumado.
    const lida = lerResposta(p, paraOWhatsapp);
    const bruto = lida.texto;
    const reacao = lida.reacao;
    // Só o link do cardápio da loja sai (o modelo já escreveu o endereço da loja em outros sistemas — links-do-robo.ts).
    const { texto, trocados } = cfg.token
      ? soLinksDaLoja(bruto, linkDoCardapioDaLoja(cfg.token), [cfg.site, cfg.instagram ? 'instagram.com' : null])
      : { texto: bruto, trocados: 0 };
    if (trocados) this.logger.warn(`resposta do robô: ${trocados} link(s) de fora trocado(s) pelo do cardápio (${via})`);
    const opcoes = lida.opcoes;
    const audio = String(p?.audio?.base64 ?? '').trim();
    // A RESPOSTA EM ANDAMENTO (16/11/2026 — `resposta-em-andamento.ts`): esta resposta encerra a da conversa, em todo
    // caminho de saída. A que não sai (vazia, robô desligado, conversa com uma pessoa) solta o que o cliente mandou
    // enquanto ela era preparada; a que sairia, mas ficou velha (o cliente escreveu depois que ela começou), é descartada e
    // tudo vai de novo ao robô — o cliente recebe UMA resposta, que considera tudo.
    if (!texto && !opcoes.length && !audio && !reacao) {
      fimDaResposta(loja.tenantId, para, false);
      throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    }

    if (!cfg.roboAtivo || !cfg.ativo) {
      fimDaResposta(loja.tenantId, para, false);
      return { ok: true, enviado: false, motivo: 'robo_desligado' };
    }
    if (await this.pausada(cfg, para)) {
      fimDaResposta(loja.tenantId, para, false);
      this.logger.log(`resposta do robô segurada: conversa pausada (${via}) de=***${para.slice(-4)}`);
      return { ok: true, enviado: false, motivo: 'conversa_pausada' };
    }
    if (fimDaResposta(loja.tenantId, para, true) === 'descartar') {
      this.logger.log(`resposta do robô descartada: o cliente escreveu enquanto ela era preparada (${via}) de=***${para.slice(-4)} — vai de novo ao robô com tudo`);
      return { ok: true, enviado: false, motivo: 'resposta_superada' };
    }

    const enviados: string[] = [];
    // O id de cada mensagem que SAIU (o wamid na API oficial, o `key.id` na Evolution): a marca da fala do robô, para a
    // caixa de conversas oferecer "Corrigir" nela (mig 385). Anotada no `finally`: o que já saiu fica marcado mesmo se o
    // envio seguinte falhar; a anotação nunca derruba a resposta (mensagens-do-robo.ts).
    const ids: (string | null)[] = [];
    // Os BALÕES (17/11/2026, `ROBO_BALOES=1` — nasce desligado): a resposta longa com parágrafos sai em até 3 mensagens, com
    // o "digitando…" antes de cada uma. Não com a voz nem com o botão do link (uma mensagem só, como antes).
    const partes = baloesLigados() && !audio ? emBaloes(texto) : [texto];
    try {
      // A REAÇÃO (a linha `REACAO:`) vai antes do texto. Não deu para reagir e não há mais nada: o emoji vai como texto.
      if (reacao) {
        if (await this.reagir(via, loja.tenantId, para, p, reacao)) enviados.push('reacao');
        else if (!texto && !opcoes.length && !audio) {
          ids.push(idDoEnvio(await this.enviarTexto(via, loja.tenantId, para, reacao)));
          enviados.push('texto');
        }
      }
      // O PRINT DE AJUDA (D3, a linha `PRINT: <passo>`): a imagem pronta do passo vai ANTES do texto, só com "Mandar print
      // de ajuda" ligado na loja (`robo_config.print_ajuda`, nasce desligado). Não saiu: o texto vai mesmo assim.
      if (lida.print && (await this.printLigado(loja.tenantId))) {
        if (await this.mandarPrint(via, loja.tenantId, para, lida.print, ids)) enviados.push('print');
      }
      if (audio) {
        const r =
          via === 'cloud'
            ? await this.cloud.enviarVoz(loja.tenantId, para, audio, p?.audio?.mime || 'audio/ogg')
            : await this.evolution.enviarAudio(loja.tenantId, para, audio);
        ids.push(idDoEnvio(r));
        enviados.push('voz');
      }
      // API oficial com o link do cardápio no texto: o link vai num BOTÃO "Ver cardápio" (pedido do dono, 30/10). A
      // mensagem de botão de link não leva botões de resposta junto: as opções ficam de fora (o cliente escreve).
      const comLink = via === 'cloud' && cfg.token ? separarLinkDoCardapio(texto, linkDoCardapioDaLoja(cfg.token)) : null;
      if (comLink) {
        // Link direto de um produto (`?produto=`, F2): o botão abre aquele item — "Ver no cardápio" — e a FOTO dele vai
        // em cima (F5, decisão do dono: "sempre que falar de 1 produto"). O produto é conferido pelo Regem (ERR-335):
        // o id que a IA escreve é chute. Sem foto que sirva, vai sem.
        // O link do cardápio todo também vira o do produto quando o cliente pediu a FOTO de um produto pelo nome.
        const deProduto = /[?&]produto=/.test(comLink.url);
        let { corpo, url } = comLink;
        let rotulo = deProduto ? 'Ver no cardápio' : 'Ver cardápio';
        let foto: string | null = null;
        const c = await this.produtoConferido(loja.tenantId, cfg.token as string, para, comLink, deProduto).catch((e: any) => {
          this.logger.warn(`produto do link não conferido (vai o link da IA, sem foto): ${e?.message ?? e}`);
          return null;
        });
        if (c) ({ corpo, url, rotulo, foto } = c);
        const r: any = await this.cloud.enviarLink(loja.tenantId, para, corpo, url, rotulo, foto);
        ids.push(idDoEnvio(r));
        enviados.push(r?.comFoto ? 'botao_link_com_foto' : 'botao_link');
      } else if (opcoes.length) {
        // Com balões, os de antes vão como texto e o último leva as opções.
        const ultimo = await this.baloesAntesDoUltimo(via, loja.tenantId, para, p, partes, ids, enviados);
        if (via === 'cloud' && opcoes.length <= 10) {
          ids.push(idDoEnvio(await this.cloud.enviarOpcoes(loja.tenantId, para, ultimo, opcoes, p?.botaoLista)));
          enviados.push(cabeEmBotoes(opcoes) ? 'botoes' : 'lista');
        } else if (via === 'evolution' && p?.opcoesComo === 'enquete' && opcoes.length >= 2 && opcoes.length <= 12) {
          ids.push(idDoEnvio(await this.evolution.enviarEnquete(loja.tenantId, para, ultimo, opcoes.map((o) => o.titulo))));
          enviados.push('enquete');
        } else {
          ids.push(idDoEnvio(await this.enviarTexto(via, loja.tenantId, para, menuNumerado(ultimo, opcoes))));
          enviados.push('menu_numerado');
        }
      } else if (texto) {
        const ultimo = await this.baloesAntesDoUltimo(via, loja.tenantId, para, p, partes, ids, enviados);
        ids.push(idDoEnvio(await this.enviarTexto(via, loja.tenantId, para, ultimo)));
        enviados.push('texto');
      }
    } finally {
      await marcarDoRobo(this.db, loja.tenantId, para, ids, this.logger);
    }
    return { ok: true, enviado: true, enviados };
  }

  /**
   * A MESMA mídia, pedida pelo próprio Regem (a leitura da foto do cliente — `cardapio/foto-do-cliente.service.ts`): quem
   * chama está aqui dentro, então usa a senha do robô desta nuvem (sem ela configurada, o robô nem funciona: recusa).
   */
  midiaDoRegem(q: { instancia?: string; phoneNumberId?: string; mediaId?: string; mensagemId?: string; jid?: string }): Promise<{ buffer: Buffer; mime: string }> {
    return this.midia(String(process.env.BOT_RESOLVER_SECRET ?? '').trim(), q);
  }

  /**
   * A MÍDIA que o cliente mandou (o áudio para transcrever), nas duas vias: API oficial pelo `mediaId` (o proxy que já
   * existia); Evolution pelo id da mensagem e o jid da conversa. Devolve o arquivo — o n8n nunca recebe credencial.
   */
  async midia(
    segredo: string,
    q: { instancia?: string; phoneNumberId?: string; mediaId?: string; mensagemId?: string; jid?: string },
  ): Promise<{ buffer: Buffer; mime: string }> {
    if (!segredoDoRoboOk(segredo)) throw new UnauthorizedException('Não autorizado.');
    if (String(q?.phoneNumberId ?? '').trim()) return this.cloud.baixarMidia(segredo, String(q.phoneNumberId), String(q.mediaId ?? ''));
    const loja = await this.evolution.lojaDoRobo(q?.instancia, undefined);
    if (!loja) throw new NotFoundException('Instância não vinculada a uma loja.');
    const id = String(q?.mensagemId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new BadRequestException('mensagemId inválido.');
    const r: any = await this.evolution.midia(loja.tenantId, id, String(q?.jid ?? ''), false);
    const m = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(String(r?.dataUrl ?? ''));
    if (!m) throw new BadRequestException('Mídia sem conteúdo.');
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 20 * 1024 * 1024) throw new BadRequestException('Mídia maior que 20 MB.');
    return { buffer, mime: m[1] || 'application/octet-stream' };
  }

  /** Para o teste trocar a busca da foto (sem rede). */
  private buscarFoto?: typeof buscarUrlPublica;

  /**
   * O produto do link conferido (foto-do-produto.ts): o que o cliente pediu ver, ou o do link da IA se existe, ou o
   * citado; a foto da primeira cópia (mesmo nome) que serve. Sem produto da loja: o link do cardápio, sem foto. Link do
   * cardápio todo: só muda se o cliente pediu a foto de um produto. `null` = vai como a IA mandou.
   */
  private async produtoConferido(tenantId: string, token: string, para: string, link: { corpo: string; url: string }, deProduto: boolean) {
    // A pergunta que não deu para ler não derruba a conferência do link (a foto do produto do link continua).
    const pergunta = await perguntaDoCliente(this.db, tenantId, para).catch((e: any) => {
      this.logger.warn(`pergunta do cliente não lida (confere só o link): ${e?.message ?? e}`);
      return null;
    });
    if (!deProduto && !pedeFoto(pergunta)) return null; // o link do cardápio, sem pedido de foto: nada a conferir
    const produtos = await produtosDaLoja(this.db, tenantId);
    const e = escolherProduto({ idDoLink: produtoDoLink(link.url), produtos, pergunta, resposta: link.corpo, linkDeProduto: deProduto });
    if (!e.ids.length) {
      if (!e.trocou) return null;
      this.logger.warn(`foto do robô: link de produto que a loja não tem — vai o cardápio (${e.motivo}) de=***${para.slice(-4)}`);
      return { corpo: legendaDoProduto(null, false), url: linkDoCardapioDaLoja(token), rotulo: 'Ver cardápio', foto: null };
    }
    let escolhido = e.ids[0];
    let foto: string | null = null;
    for (const id of e.ids) {
      const imagem = String(produtos.find((p) => p.id === id)?.imagem ?? '').trim();
      if (/^https:\/\//i.test(imagem) && (await fotoServe(imagem, this.buscarFoto))) {
        escolhido = id;
        foto = imagem;
        break;
      }
    }
    if (e.trocou) this.logger.warn(`foto do robô: produto conferido pelo Regem (${e.motivo}) de=***${para.slice(-4)}`);
    return {
      corpo: e.legenda ? legendaDoProduto(e.nome, !!foto) : link.corpo,
      url: e.trocou ? linkComProduto(link.url, linkDoCardapioDaLoja(token), escolhido) : link.url,
      rotulo: 'Ver no cardápio',
      foto,
    };
  }

  /**
   * A resposta do robô no DIRECT do Instagram (mig 378). A conta, o robô ligado e o cardápio são conferidos na hora
   * (InstagramService.alvoDoRobo). Como nas outras vias, só o link do cardápio da loja sai — e com a origem do Direct
   * (`utm_source=instagram`); as opções viram lista numerada (o Instagram não tem os botões do WhatsApp); voz não sai no
   * Direct (o Instagram não aceita o áudio que o robô gera). Segurada = `enviado: false` com o motivo (200).
   */
  private async responderNoDirect(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    if (!this.instagram) throw new NotFoundException('Instagram indisponível.');
    const alvo = await this.instagram.alvoDoRobo(p?.instancia, p?.para);
    if (!alvo.ligado) return { ok: true, enviado: false, motivo: alvo.motivo };
    const link = linkDoCardapioDaLoja(alvo.cardapio.token);
    const { bruto, opcoes } = semFormatacaoNoCanal(p);
    const temAudio = !!String(p?.audio?.base64 ?? '').trim();
    if (!bruto && !opcoes.length && !temAudio) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    const { texto: daLoja, trocados } = soLinksDaLoja(bruto, link, [alvo.cardapio.site, alvo.cardapio.instagram ? 'instagram.com' : null]);
    if (trocados) this.logger.warn(`resposta do robô: ${trocados} link(s) de fora trocado(s) pelo do cardápio (instagram)`);
    const texto = comOrigemDoDirect(opcoes.length ? menuNumerado(daLoja, opcoes) : daLoja, link).trim();
    if (!texto) return { ok: true, enviado: false, motivo: 'sem_voz_no_direct' };
    return this.instagram.enviarDoRobo(alvo, texto);
  }

  /**
   * A resposta do robô no MESSENGER do Facebook (chave `fb:`, mig 386), como no Direct: a página, o robô ligado e o cardápio
   * conferidos na hora (MessengerService.alvoDoRobo — V87); só o link do cardápio da loja sai, com a origem do Messenger
   * (`utm_source=facebook&utm_medium=messenger`); as opções viram lista numerada; voz não sai no Messenger. Segurada =
   * `enviado: false` com o motivo (200). As partes de até 2.000 caracteres e a janela de 24 h são do serviço.
   */
  private async responderNoMessenger(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    if (!this.messenger) throw new NotFoundException('Messenger indisponível.');
    const alvo = await this.messenger.alvoDoRobo(p?.instancia, p?.para);
    if (!alvo.ligado) return { ok: true, enviado: false, motivo: alvo.motivo };
    const link = linkDoCardapioDaLoja(alvo.cardapio.token);
    const { bruto, opcoes } = semFormatacaoNoCanal(p);
    const temAudio = !!String(p?.audio?.base64 ?? '').trim();
    if (!bruto && !opcoes.length && !temAudio) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    const { texto: daLoja, trocados } = soLinksDaLoja(bruto, link, [alvo.cardapio.site, alvo.cardapio.instagram ? 'instagram.com' : null]);
    if (trocados) this.logger.warn(`resposta do robô: ${trocados} link(s) de fora trocado(s) pelo do cardápio (messenger)`);
    const texto = comOrigemDoMessenger(opcoes.length ? menuNumerado(daLoja, opcoes) : daLoja, link).trim();
    if (!texto) return { ok: true, enviado: false, motivo: 'sem_voz_no_messenger' };
    return this.messenger.enviarDoRobo(alvo, texto);
  }

  /**
   * A resposta do robô no COMENTÁRIO de um post do Instagram (chave `cm:`, F6 — mig 384): publica no post (uma resposta por
   * comentário), pela trava do comentário — numa linha, até 300 letras, sem link nem contato (`instagram/comentarios.ts`).
   * As opções não existem no comentário (o texto sai sem elas); voz não sai. O resto (a conversa pela linha do comentário,
   * o robô ligado na hora — V87 —, a reserva da resposta) é `instagram/comentarios.service.ts`.
   */
  private async responderNoComentario(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    if (!this.instagram) throw new NotFoundException('Instagram indisponível.');
    const { bruto, opcoes } = semFormatacaoNoCanal(p);
    const temAudio = !!String(p?.audio?.base64 ?? '').trim();
    if (!bruto && !opcoes.length && !temAudio) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    return this.instagram.comentarios.responderDoRobo([p?.instancia, p?.para], bruto, temAudio);
  }

  /**
   * A resposta do ATENDENTE VIRTUAL no chat do iFood e da 99 (chave `chat:`, F5 — mig 383). As opções viram uma lista
   * numerada na mesma linha (o chat não tem botão); voz não sai (no chat da plataforma não há áudio). O resto — a conversa
   * pela linha da fala, o "quieto" com o caso aberto, quem envia pelo canal, o limite por hora e a TRAVA DA PLATAFORMA (nada
   * de telefone, WhatsApp, Instagram, e-mail ou link; até 3 mensagens de 300 letras) — é `atendente-no-chat.ts`. Nenhum link
   * sai no chat: nem o do cardápio (a trava barra; as instruções do chat já dizem para não mandar).
   */
  private async responderNoChat(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    const { bruto, opcoes } = semFormatacaoNoCanal(p);
    const temAudio = !!String(p?.audio?.base64 ?? '').trim();
    if (!bruto && !opcoes.length && !temAudio) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    const texto = opcoesNoChat(bruto, opcoes);
    if (!texto) return { ok: true, enviado: false, motivo: 'sem_voz_no_chat' };
    return responderNoChatDaPlataforma(this.db, (e, d) => this.events?.emit(e, d), [p?.instancia, p?.para], texto, this.logger);
  }

  /**
   * A resposta do robô na conversa de TESTE do atendente (mig 382): grava na conversa de teste (autor 'robo', o texto e as
   * opções) e responde `{ ok: true, enviado: true }` — nada sai pelo WhatsApp nem pelo Direct. O texto passa pelo MESMO
   * filtro de links das vias de verdade (só o link do cardápio da loja; no Direct, com a origem do Direct), para o gerente
   * ver o que o cliente receberia. Áudio não se aplica: sem texto, fica "[o robô mandaria um áudio]". A chave da instância e a
   * do `para`, quando as duas são de teste, têm de ser a MESMA conversa; conversa que não existe (ou apagada) = 404.
   */
  private async responderNoTeste(p: PedidoDeResposta): Promise<RespostaDoRobo> {
    const ids = [p?.instancia, p?.para].filter(ehChaveDeTeste).map(idDaChaveDeTeste);
    if (ids.some((id) => !id) || new Set(ids).size !== 1) throw new BadRequestException('Conversa de teste inválida.');
    const teste = await testeDaChave(this.db, chaveDoTeste(ids[0] as string));
    if (!teste) throw new NotFoundException('Conversa de teste não encontrada.');
    // O MESMO formato do caminho de verdade (17/11/2026 — V74): no WhatsApp, a formatação dele e a reação (uma linha
    // 'sistema' diz que o atendente reagiu); nos outros canais, sem formatação e o emoji como texto.
    const noWhatsapp = teste.canal === 'whatsapp';
    const lida = noWhatsapp ? lerResposta(p, paraOWhatsapp) : null;
    const { bruto, opcoes } = lida ? { bruto: lida.texto, opcoes: lida.opcoes } : semFormatacaoNoCanal(p);
    const temAudio = !!String(p?.audio?.base64 ?? '').trim();
    if (!bruto && !opcoes.length && !temAudio && !lida?.reacao) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');
    if (lida?.reacao) {
      await gravarMensagem(this.db, teste, { autor: 'sistema', texto: `O atendente reagiu com ${lida.reacao} à mensagem do cliente.` });
      if (!bruto && !opcoes.length && !temAudio) return { ok: true, enviado: true };
    }
    // O teste do CHAT DO iFOOD (F5, mig 383): a MESMA trava do caminho de verdade (`travaDaPlataforma`, V74) — as opções
    // numeradas na linha, as partes que sairiam (uma linha de robô por parte); barrada, o texto do robô fica (para o gerente
    // ver o que ele escreveu) e uma linha 'sistema' diz o motivo e o que iria no lugar.
    if (teste.canal === 'chat') {
      const noChat = opcoesNoChat(bruto, opcoes);
      if (!noChat) {
        const linha = linhaDaTravaNoTeste('audio');
        await gravarMensagem(this.db, teste, { autor: 'sistema', texto: linha.texto, simulado: linha.simulado });
        return { ok: true, enviado: true };
      }
      const trava = travaDaPlataforma(noChat);
      if (!trava.ok) {
        await gravarMensagem(this.db, teste, { autor: 'robo', texto: noChat });
        const linha = linhaDaTravaNoTeste(trava.motivo);
        await gravarMensagem(this.db, teste, { autor: 'sistema', texto: linha.texto, simulado: linha.simulado });
        return { ok: true, enviado: true };
      }
      for (const parte of trava.partes) await gravarMensagem(this.db, teste, { autor: 'robo', texto: parte });
      return { ok: true, enviado: true };
    }
    let texto = bruto;
    if (bruto && teste.cardapio?.token) {
      const link = linkDoCardapioDaLoja(teste.cardapio.token);
      texto = soLinksDaLoja(bruto, link, [teste.cardapio.site, teste.cardapio.instagram ? 'instagram.com' : null]).texto;
      if (teste.canal === 'direct') texto = comOrigemDoDirect(texto, link).trim();
    }
    if (!texto && temAudio) texto = AUDIO_NO_TESTE;
    // Os balões, como sairiam no WhatsApp (`ROBO_BALOES=1`): uma linha do robô por balão, as opções no último.
    const partes = noWhatsapp && baloesLigados() && !temAudio ? emBaloes(texto) : [texto];
    for (let i = 0; i < partes.length - 1; i++) await gravarMensagem(this.db, teste, { autor: 'robo', texto: partes[i] });
    await gravarMensagem(this.db, teste, { autor: 'robo', texto: partes[partes.length - 1] ?? '', opcoes });
    return { ok: true, enviado: true };
  }

  /** Para o teste não esperar de verdade entre os balões. */
  private esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * Os balões antes do último vão como texto, cada um seguido do "digitando…" e da pausa pelo tamanho do próximo
   * (`pausaAntesDoBalao`); devolve o último, que o chamador manda (sozinho ou com as opções). Um balão só = nada sai aqui.
   */
  private async baloesAntesDoUltimo(
    via: 'cloud' | 'evolution',
    tenantId: string,
    para: string,
    p: PedidoDeResposta,
    partes: string[],
    ids: (string | null)[],
    enviados: string[],
  ): Promise<string> {
    for (let i = 0; i < partes.length - 1; i++) {
      ids.push(idDoEnvio(await this.enviarTexto(via, tenantId, para, partes[i])));
      enviados.push('texto');
      const ms = pausaAntesDoBalao(partes[i + 1]);
      if (via === 'cloud') {
        const wamid = await this.idDaMensagemDoCliente(tenantId, para, p);
        if (wamid) this.cloud.mostrarDigitando(String(p?.phoneNumberId ?? ''), wamid);
      } else this.evolution.mostrarDigitando(String(p?.instancia ?? ''), para, ms);
      await this.esperar(ms);
    }
    return partes[partes.length - 1] ?? '';
  }

  /** A mensagem do cliente a que o robô reage: a que o n8n disse (`responderA`) ou, na API oficial, a última gravada. */
  private async idDaMensagemDoCliente(tenantId: string, para: string, p: PedidoDeResposta): Promise<string | null> {
    const pedida = idDeMensagem(p?.responderA);
    if (pedida) return pedida;
    return idDaUltimaDoCliente(this.db, tenantId, para).catch((e: any) => {
      this.logger.warn(`última mensagem do cliente não lida (sem reação/"digitando"): ${e?.message ?? e}`);
      return null;
    });
  }

  /** Reage à mensagem do cliente. Devolve se reagiu; a recusa vai para o log e nunca derruba a resposta. */
  private async reagir(via: 'cloud' | 'evolution', tenantId: string, para: string, p: PedidoDeResposta, emoji: Reacao): Promise<boolean> {
    try {
      if (via === 'cloud') {
        const wamid = await this.idDaMensagemDoCliente(tenantId, para, p);
        if (!wamid) return false;
        await this.cloud.enviarReacao(tenantId, para, wamid, emoji);
      } else {
        const id = idDeMensagem(p?.responderA);
        if (!id) return false;
        await this.evolution.enviarReacao(tenantId, para, id, p?.jid, emoji);
      }
      return true;
    } catch (e: any) {
      this.logger.warn(`reação do robô não saiu (${via}) de=***${para.slice(-4)}: ${e?.message ?? e}`);
      return false;
    }
  }

  /** "Mandar print de ajuda" ligado na loja (mig 442; sem linha, sem a coluna ou consulta que falha = desligado). */
  private async printLigado(tenantId: string): Promise<boolean> {
    try {
      const r: any = await this.db.execute(
        sql`select coalesce((to_jsonb(rc) ->> 'print_ajuda')::boolean, false) as ligado from robo_config rc where rc.tenant_id = ${tenantId}::uuid`,
      );
      return (r?.rows ?? r)?.[0]?.ligado === true;
    } catch (e: any) {
      this.logger.warn(`print de ajuda: o ajuste não foi lido (segue sem o print): ${e?.message ?? e}`);
      return false;
    }
  }

  /** Manda a imagem do passo; a recusa vai para o log e a resposta segue (o texto já diz o que olhar). */
  private async mandarPrint(via: 'cloud' | 'evolution', tenantId: string, para: string, passo: PassoDoPrint, ids: (string | null)[]): Promise<boolean> {
    try {
      const r = via === 'cloud' ? await this.cloud.enviarImagem(tenantId, para, urlDoPrint(passo)) : await this.evolution.enviarImagem(tenantId, para, urlDoPrint(passo));
      ids.push(idDoEnvio(r));
      return true;
    } catch (e: any) {
      this.logger.warn(`print de ajuda não saiu (${via}, ${passo}) de=***${para.slice(-4)}: ${e?.message ?? e}`);
      return false;
    }
  }

  private enviarTexto(via: 'cloud' | 'evolution', tenantId: string, para: string, texto: string) {
    return via === 'cloud' ? this.cloud.enviarTexto(tenantId, para, texto) : this.evolution.enviar(tenantId, para, texto);
  }

  // Pausa antiga (vetor) ou a da regra nova; consulta que falha = responde (como antes) e o motivo vai para o log.
  private async pausada(cfg: any, para: string): Promise<boolean> {
    const antigos = (Array.isArray(cfg.roboPausados) ? cfg.roboPausados : []).map(soDigitos);
    if (antigos.includes(para)) return true;
    try {
      const estado = await estadoDaPausa(this.db, cfg.tenantId, para);
      if (avisoDoChamadoLiberado(estado)) {
        this.logger.log(`resposta do robô liberada: aviso do chamado que ele acabou de abrir de=***${para.slice(-4)}`);
        return false;
      }
      return estado.pausado;
    } catch (e: any) {
      this.logger.warn(`pausa não consultada (o robô responde): ${e?.message ?? e}`);
      return false;
    }
  }
}

import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { segredoDoRoboOk } from '../../common/segredo-robo';
import { WhatsappService } from './whatsapp.service';
import { WhatsappCloudService, opcoesValidas } from './whatsapp-cloud.service';
import { EstadoPausa, estadoDaPausa } from './robo-pausa';
import { linkDoCardapioDaLoja, separarLinkDoCardapio, soLinksDaLoja } from './links-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Opcao = { id?: string; titulo: string; descricao?: string };
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
};

const soDigitos = (v: unknown) => String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

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
  ) {}

  async responder(segredo: string, p: PedidoDeResposta) {
    if (!segredoDoRoboOk(segredo)) throw new UnauthorizedException('Não autorizado.');
    const via: 'cloud' | 'evolution' = String(p?.phoneNumberId ?? '').trim() ? 'cloud' : 'evolution';
    const loja = await this.evolution.lojaDoRobo(p?.instancia, p?.phoneNumberId);
    if (!loja) throw new NotFoundException('Número/instância não vinculado a uma loja.');
    const [cfg] = await this.db.select().from(cardapioConfig).where(eq(cardapioConfig.tenantId, loja.tenantId));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    // A loja trocou de provedor no meio da conversa: o fluxo da outra via não fala por ela.
    if ((cfg.provedor ?? 'evolution') !== via) throw new BadRequestException(`Loja está no provedor '${cfg.provedor}'.`);

    const para = soDigitos(p?.para);
    if (!para) throw new BadRequestException('Número inválido.');
    // Só o link do cardápio da loja sai (o modelo já escreveu o endereço da loja em outros sistemas — links-do-robo.ts).
    const bruto = String(p?.texto ?? '').trim();
    const { texto, trocados } = cfg.token
      ? soLinksDaLoja(bruto, linkDoCardapioDaLoja(cfg.token), [cfg.site, cfg.instagram ? 'instagram.com' : null])
      : { texto: bruto, trocados: 0 };
    if (trocados) this.logger.warn(`resposta do robô: ${trocados} link(s) de fora trocado(s) pelo do cardápio (${via})`);
    const opcoes = opcoesValidas(p?.opcoes ?? []);
    const audio = String(p?.audio?.base64 ?? '').trim();
    if (!texto && !opcoes.length && !audio) throw new BadRequestException('Nada para enviar (texto, opções ou áudio).');

    if (!cfg.roboAtivo || !cfg.ativo) return { ok: true, enviado: false, motivo: 'robo_desligado' };
    if (await this.pausada(cfg, para)) {
      this.logger.log(`resposta do robô segurada: conversa pausada (${via}) de=***${para.slice(-4)}`);
      return { ok: true, enviado: false, motivo: 'conversa_pausada' };
    }

    const enviados: string[] = [];
    if (audio) {
      if (via === 'cloud') await this.cloud.enviarVoz(loja.tenantId, para, audio, p?.audio?.mime || 'audio/ogg');
      else await this.evolution.enviarAudio(loja.tenantId, para, audio);
      enviados.push('voz');
    }
    // API oficial com o link do cardápio no texto: o link vai num BOTÃO "Ver cardápio" (pedido do dono, 30/10). A
    // mensagem de botão de link não leva botões de resposta junto: as opções ficam de fora (o cliente escreve).
    const comLink = via === 'cloud' && cfg.token ? separarLinkDoCardapio(texto, linkDoCardapioDaLoja(cfg.token)) : null;
    if (comLink) {
      // Link direto de um produto (`?produto=`, F2): o botão abre aquele item — "Ver no cardápio".
      const rotulo = /[?&]produto=/.test(comLink.url) ? 'Ver no cardápio' : 'Ver cardápio';
      await this.cloud.enviarLink(loja.tenantId, para, comLink.corpo, comLink.url, rotulo);
      enviados.push('botao_link');
    } else if (opcoes.length) {
      if (via === 'cloud' && opcoes.length <= 10) {
        await this.cloud.enviarOpcoes(loja.tenantId, para, texto, opcoes, p?.botaoLista);
        enviados.push(opcoes.length <= 3 ? 'botoes' : 'lista');
      } else if (via === 'evolution' && p?.opcoesComo === 'enquete' && opcoes.length >= 2 && opcoes.length <= 12) {
        await this.evolution.enviarEnquete(loja.tenantId, para, texto, opcoes.map((o) => o.titulo));
        enviados.push('enquete');
      } else {
        await this.enviarTexto(via, loja.tenantId, para, menuNumerado(texto, opcoes));
        enviados.push('menu_numerado');
      }
    } else if (texto) {
      await this.enviarTexto(via, loja.tenantId, para, texto);
      enviados.push('texto');
    }
    return { ok: true, enviado: true, enviados };
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

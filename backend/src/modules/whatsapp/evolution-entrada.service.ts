import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { registrarSaida, registrarVolta } from '../../common/consentimento-marketing';
import { WhatsappService } from './whatsapp.service';
import { MsgNormalizada } from './whatsapp-cloud.service';
import { estadoDaPausa, pausarPeloAtendente } from './robo-pausa';
import { foiEnviadoPeloRegem } from './evolution-envios';
import { entregarJuntando } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTRADA PELA EVOLUTION PASSANDO PELO REGEM (Fase 2 do robô, 29/10/2026 — com EVOLUTION_PELO_REGEM, que o dono
// liga quando o fluxo novo do n8n estiver importado). Antes a Evolution mandava direto ao n8n e cada travinha (pausa,
// SAIR, robô ligado, mensagem repetida) dependia do fluxo lembrar de consultar. Agora são as MESMAS travas da API oficial:
//  1. mensagem repetida (a Evolution reenvia) → ignora;
//  2. `fromMe` que NÃO foi o Regem que mandou = alguém respondeu pelo celular/WhatsApp Web da loja → o robô pausa nesta
//     conversa pelo tempo da loja (o "humano assumiu" sem clicar em nada). Conferido depois de 4 s: o id do envio do
//     próprio Regem pode chegar depois do aviso;
//  3. SAIR/PARAR → lista de exclusão das ofertas + confirmação; VOLTAR desfaz (como na API oficial, ERR-317: "cancelar"
//     NÃO é saída);
//  4. robô desligado ou conversa pausada (atendente, chamado aberto) → não vai ao robô;
//  5. o resto vai ao robô (n8n) no formato único, assinado.

const RECEBIDAS_MS = 10 * 60 * 1000;
const ESPERA_FROM_ME_MS = 4000;
const SAIR = /^(sair|parar|stop|descadastrar|sair das ofertas|parar ofertas|n[aã]o quero receber)\.?$/;
const VOLTAR = /^(voltar|voltei|receber)\.?$/;

const soDigitos = (v: unknown) => String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');

/** O que a mensagem da Evolution é, para o robô: tipo, texto (legenda, voto da enquete, opção tocada) e a opção. */
export function lerMensagemEvolution(data: any): { tipo: string; texto: string; opcaoId: string | null } {
  const m = data?.message ?? {};
  const voto = m?.pollUpdateMessage?.vote?.selectedOptions ?? data?.pollUpdates?.[0]?.vote?.selectedOptions;
  if (Array.isArray(voto) && voto.length)
    return { tipo: 'poll', texto: voto.map((o: any) => String(o?.name ?? o ?? '')).filter(Boolean).join(', '), opcaoId: null };
  if (m.conversation != null) return { tipo: 'text', texto: String(m.conversation), opcaoId: null };
  if (m.extendedTextMessage?.text != null) return { tipo: 'text', texto: String(m.extendedTextMessage.text), opcaoId: null };
  if (m.buttonsResponseMessage)
    return {
      tipo: 'interactive',
      texto: String(m.buttonsResponseMessage.selectedDisplayText ?? ''),
      opcaoId: m.buttonsResponseMessage.selectedButtonId ?? null,
    };
  if (m.listResponseMessage)
    return {
      tipo: 'interactive',
      texto: String(m.listResponseMessage.title ?? ''),
      opcaoId: m.listResponseMessage.singleSelectReply?.selectedRowId ?? null,
    };
  if (m.audioMessage) return { tipo: 'audio', texto: '', opcaoId: null };
  if (m.imageMessage) return { tipo: 'image', texto: String(m.imageMessage.caption ?? ''), opcaoId: null };
  if (m.videoMessage) return { tipo: 'video', texto: String(m.videoMessage.caption ?? ''), opcaoId: null };
  if (m.documentMessage) return { tipo: 'document', texto: String(m.documentMessage.caption ?? ''), opcaoId: null };
  if (m.stickerMessage) return { tipo: 'sticker', texto: '', opcaoId: null };
  if (m.locationMessage)
    return { tipo: 'location', texto: `[localização] ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`, opcaoId: null };
  return { tipo: String(data?.messageType ?? 'desconhecido'), texto: '', opcaoId: null };
}

/** O telefone do cliente: o do jid; conversa por @lid usa o `remoteJidAlt` (o número real). Grupo/status = ''. */
export function telefoneDaConversa(key: any): string {
  const jid = String(key?.remoteJid ?? '');
  if (!jid || jid.endsWith('@g.us') || jid.includes('broadcast') || jid.startsWith('status@')) return '';
  if (jid.endsWith('@lid')) {
    const alt = String(key?.remoteJidAlt ?? key?.senderPn ?? '');
    return alt.endsWith('@s.whatsapp.net') ? soDigitos(alt) : '';
  }
  return soDigitos(jid);
}

@Injectable()
export class EvolutionEntradaService {
  private readonly logger = new Logger('EvolutionEntrada');
  private readonly recebidas = new Map<string, number>(); // instância:id → até quando lembrar

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly evolution: WhatsappService,
  ) {}

  /** Mensagem já vista nesta janela (a Evolution reenvia quando demora)? Marca como vista. */
  private repetida(chave: string): boolean {
    const agora = Date.now();
    const ate = this.recebidas.get(chave);
    if (ate && ate > agora) return true;
    this.recebidas.set(chave, agora + RECEBIDAS_MS);
    if (this.recebidas.size > 20_000) for (const [k, v] of this.recebidas) if (v <= agora) this.recebidas.delete(k);
    return false;
  }

  /** Um aviso da Evolution (já com a assinatura da instância conferida). Nunca lança. */
  async processar(corpo: any, instancia: string): Promise<void> {
    try {
      const evento = String(corpo?.event ?? '').toLowerCase().replace(/_/g, '.');
      if (evento !== 'messages.upsert') return;
      const lista = Array.isArray(corpo?.data) ? corpo.data : [corpo?.data];
      for (const data of lista) if (data?.key) await this.mensagem(data, instancia);
    } catch (e: any) {
      this.logger.warn(`aviso da Evolution (${instancia}) não processado: ${e?.message ?? e}`);
    }
  }

  private async mensagem(data: any, instancia: string): Promise<void> {
    const key = data.key;
    const id = String(key?.id ?? '');
    const de = telefoneDaConversa(key);
    if (!id || !de) return;
    if (this.repetida(`${instancia}:${id}`)) return;

    const [cfg] = await this.db.select().from(cardapioConfig).where(eq(cardapioConfig.evolutionInstancia, instancia));
    if (!cfg) {
      this.logger.warn(`instância ${instancia} não vinculada a nenhuma loja.`);
      return;
    }
    // Loja na API oficial: o aviso da Evolution sobrou de uma migração — o cliente levaria resposta em dobro.
    if ((cfg.provedor ?? 'evolution') !== 'evolution') return;

    if (key.fromMe) {
      // Pode ser o próprio Regem (robô, caixa, campanha) — o id dele chega na resposta do envio, às vezes depois.
      setTimeout(() => {
        if (foiEnviadoPeloRegem(id)) return;
        pausarPeloAtendente(this.db, { tenantId: cfg.tenantId, telefone: de, motivo: 'app' })
          .then(() => this.logger.log(`atendente respondeu pelo celular: robô pausado para ${mascarar(de)}`))
          .catch((e: any) => this.logger.warn(`pausa (resposta pelo celular) não gravada: ${e?.message ?? e}`));
      }, ESPERA_FROM_ME_MS);
      return;
    }

    const lida = lerMensagemEvolution(data);
    const txt = lida.texto.trim().toLowerCase();
    if (SAIR.test(txt)) {
      await registrarSaida(this.db, { tenantId: cfg.tenantId, telefone: de, origem: 'whatsapp', motivo: 'palavra_chave' })
        .then(() =>
          this.evolution.enviar(
            cfg.tenantId,
            de,
            'Pronto ✅ Você não vai mais receber ofertas e campanhas nossas. Se foi engano e quiser voltar a receber, responda VOLTAR.',
          ),
        )
        .catch((e: any) => this.logger.warn(`opt-out (SAIR) de ${mascarar(de)} não gravado: ${e?.message ?? e}`));
      return;
    }
    if (VOLTAR.test(txt)) {
      await registrarVolta(this.db, { tenantId: cfg.tenantId, telefone: de, origem: 'whatsapp' })
        .then(() => this.evolution.enviar(cfg.tenantId, de, 'Feito! Você voltou a receber nossas ofertas e novidades 🎉'))
        .catch((e: any) => this.logger.warn(`volta (VOLTAR) de ${mascarar(de)} não gravada: ${e?.message ?? e}`));
      return;
    }

    if (!cfg.roboAtivo || !cfg.ativo) return;
    const antigos = (Array.isArray(cfg.roboPausados) ? (cfg.roboPausados as any[]) : []).map(soDigitos);
    let pausada = antigos.includes(de);
    if (!pausada) {
      try {
        pausada = (await estadoDaPausa(this.db, cfg.tenantId, de)).pausado;
      } catch (e: any) {
        this.logger.warn(`pausa não consultada (o robô responde): ${e?.message ?? e}`);
      }
    }
    if (pausada) {
      this.logger.log(`sem encaminhar (conversa pausada) de=${mascarar(de)}`);
      return;
    }

    const msg: MsgNormalizada = {
      provedor: 'evolution',
      tenantId: cfg.tenantId,
      cardapioToken: cfg.token ?? null,
      phoneNumberId: null,
      instancia,
      jid: String(key.remoteJid ?? ''),
      loja: { nome: cfg.nomePublico ?? null, aberto: !!cfg.aberto },
      de,
      nome: data.pushName ?? null,
      tipo: lida.tipo,
      texto: lida.texto,
      mensagemId: id,
      timestamp: Number(data.messageTimestamp ?? 0),
      midiaId: ['audio', 'image', 'video', 'document', 'sticker'].includes(lida.tipo) ? id : null,
      opcaoId: lida.opcaoId,
      roboSaudacao: cfg.roboSaudacao ?? null,
      roboAusencia: cfg.roboAusencia ?? null,
      roboPrompt: cfg.roboPrompt ?? null,
      roboMensagens: Array.isArray(cfg.roboMensagens) ? (cfg.roboMensagens as any[]) : [],
    };
    this.evolution.mostrarDigitando(instancia, de); // "digitando…" enquanto o robô pensa (dispara e segue)
    await entregarJuntando(msg);
  }
}

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
// API OFICIAL do WhatsApp (Meta Cloud API) — via paralela ao Evolution.
// Nada aqui toca o whatsapp.service (Evolution): a loja escolhe o provedor em
// cardapio_config.provedor e migra quando quiser, sem derrubar quem já está no ar.
//
// Config (secrets no servidor):
//   WA_CLOUD_TOKEN             — token do Usuário do Sistema (não expira)
//   N8N_BOT_CLOUD_WEBHOOK_URL  — webhook do workflow "Bot Regem (Cloud)" no n8n.
//                                Vazio = recebimento fica só no log (modo inerte).
const GRAPH = 'https://graph.facebook.com/v25.0';
// Teto do proxy de midia. A Meta aceita ate 16MB; 20MB deixa folga e evita que um
// arquivo inesperado vire pico de memoria no processo da API.
const MAX_MIDIA = 20 * 1024 * 1024;
// A URL temporaria devolvida pela Meta so pode apontar para a CDN dela. Sem esta
// checagem, uma resposta adulterada transformaria o proxy num SSRF: o servidor
// buscaria uma URL arbitraria COM o Bearer no header.
const HOSTS_MIDIA = ['fbsbx.com', 'fbcdn.net', 'facebook.com', 'whatsapp.net'];

// Só os dígitos, para comparar telefone vindo em qualquer formato.
function soDigitos(v: any): string {
  return String(v ?? '').replace(/\D/g, '');
}

// Telefone mascarado para log — não guardamos o número do cliente (LGPD).
function mascarar(tel?: string): string {
  const s = String(tel ?? '');
  return s.length > 4 ? `***${s.slice(-4)}` : '***';
}

// Compara o segredo do bot em tempo CONSTANTE (evita timing attack). Mesmo critério
// do resolver do Evolution: falha se o esperado não está setado ou os tamanhos diferem.
function segredoBotOk(recebido: string, esperado: string): boolean {
  if (!esperado) return false;
  const a = Buffer.from(String(recebido ?? ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type MsgNormalizada = {
  provedor: 'cloud';
  tenantId: string;
  cardapioToken: string | null;
  phoneNumberId: string;
  loja: { nome: string | null; aberto: boolean };
  de: string;
  nome: string | null;
  tipo: string;
  texto: string;
  mensagemId: string;
  timestamp: number;
  midiaId: string | null;
  roboSaudacao: string | null;
  roboPrompt: string | null;
};

@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger('WhatsappCloud');
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private token(): string {
    const t = process.env.WA_CLOUD_TOKEN ?? '';
    if (!t) throw new BadRequestException('WA_CLOUD_TOKEN não configurado no servidor.');
    return t;
  }

  // Resolve a LOJA pelo Phone Number ID da Meta. É a chave multi-tenant deste lado:
  // a URL de callback do webhook é uma só para todas as lojas, então quem diz de quem
  // é a mensagem é o metadata.phone_number_id do payload.
  private async lojaPorPhoneId(phoneNumberId: string) {
    if (!phoneNumberId) return null;
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.waCloudPhoneId, phoneNumberId));
    return cfg ?? null;
  }

  // Extrai o texto de qualquer tipo de mensagem que a Meta entrega. Tipos sem texto
  // (imagem sem legenda, áudio) voltam string vazia — o workflow decide o que fazer.
  private textoDe(m: any): string {
    if (m?.text?.body) return String(m.text.body);
    if (m?.button?.text) return String(m.button.text);
    if (m?.interactive?.button_reply?.title) return String(m.interactive.button_reply.title);
    if (m?.interactive?.list_reply?.title) return String(m.interactive.list_reply.title);
    for (const k of ['image', 'video', 'document', 'audio']) {
      if (m?.[k]?.caption) return String(m[k].caption);
    }
    return '';
  }

  // Id da mídia, quando houver — o workflow usa para baixar (ex.: transcrever áudio).
  private midiaDe(m: any): string | null {
    for (const k of ['image', 'video', 'document', 'audio', 'sticker']) {
      if (m?.[k]?.id) return String(m[k].id);
    }
    return null;
  }

  // Processa UM evento do webhook. Resolve a loja, aplica os portões (provedor certo,
  // robô ativo, conversa não pausada) e encaminha ao n8n no formato normalizado.
  // Nunca lança: erro aqui não pode virar retry/desativação do webhook na Meta.
  async processar(body: any): Promise<void> {
    for (const entry of body?.entry ?? []) {
      for (const ch of entry?.changes ?? []) {
        const v = ch?.value ?? {};
        const phoneNumberId = String(v?.metadata?.phone_number_id ?? '');

        for (const s of v?.statuses ?? []) {
          this.logger.log(`status phone=${phoneNumberId} ${s?.status} id=${s?.id}`);
        }

        const mensagens = v?.messages ?? [];
        if (!mensagens.length) continue;

        const cfg = await this.lojaPorPhoneId(phoneNumberId);
        if (!cfg) {
          // Número da Meta que não pertence a nenhuma loja: pode ser um número de
          // teste ou uma loja que ainda não foi vinculada. Não é erro — só não temos
          // para quem entregar.
          this.logger.warn(`phone_number_id ${phoneNumberId} não vinculado a nenhuma loja.`);
          continue;
        }

        // PORTÃO 1 — provedor. Se a loja está no Evolution, ignorar: senão o cliente
        // levaria resposta em dobro durante uma migração meio-feita.
        if (cfg.provedor !== 'cloud') {
          this.logger.warn(`loja ${cfg.tenantId} está em '${cfg.provedor}', evento da Cloud ignorado.`);
          continue;
        }

        // PORTÃO 2 — robô/loja ativos (amarra no enforcement de módulos ativáveis).
        const ativo = !!cfg.roboAtivo && !!cfg.ativo;

        const pausados = new Set(
          (Array.isArray(cfg.roboPausados) ? (cfg.roboPausados as any[]) : []).map(soDigitos),
        );
        const contatos: any[] = v?.contacts ?? [];

        for (const m of mensagens) {
          const de = soDigitos(m?.from);
          const nome = contatos.find((c) => soDigitos(c?.wa_id) === de)?.profile?.name ?? null;
          this.logger.log(
            `msg loja=${cfg.tenantId} de=${mascarar(de)} tipo=${m?.type} id=${m?.id}`,
          );

          // PORTÃO 3 — humano assumiu esta conversa: o robô não responde.
          if (!ativo || pausados.has(de)) {
            this.logger.log(
              `sem encaminhar (${!ativo ? 'robô inativo' : 'conversa pausada'}) de=${mascarar(de)}`,
            );
            continue;
          }

          const msg: MsgNormalizada = {
            provedor: 'cloud',
            tenantId: cfg.tenantId,
            cardapioToken: cfg.token ?? null,
            phoneNumberId,
            loja: { nome: cfg.nomePublico ?? null, aberto: !!cfg.aberto },
            de,
            nome,
            tipo: String(m?.type ?? 'text'),
            texto: this.textoDe(m),
            mensagemId: String(m?.id ?? ''),
            timestamp: Number(m?.timestamp ?? 0),
            midiaId: this.midiaDe(m),
            roboSaudacao: cfg.roboSaudacao ?? null,
            roboPrompt: cfg.roboPrompt ?? null,
          };
          await this.encaminhar(msg);
        }
      }
    }
  }

  // Entrega a mensagem normalizada ao workflow do n8n. Sem a env configurada, o
  // recebimento fica inerte (só log) — é o estado até o workflow existir.
  private async encaminhar(msg: MsgNormalizada): Promise<void> {
    const url = (process.env.N8N_BOT_CLOUD_WEBHOOK_URL ?? '').trim();
    if (!url) {
      this.logger.debug('N8N_BOT_CLOUD_WEBHOOK_URL vazio — mensagem não encaminhada.');
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      if (!res.ok) {
        this.logger.error(`n8n respondeu ${res.status} ao receber a mensagem.`);
      }
    } catch (e: any) {
      this.logger.error(`falha ao encaminhar para o n8n: ${e?.message ?? e}`);
    }
  }

  // Envia texto livre pela Cloud API. Só funciona dentro da janela de 24h; fora dela
  // a Meta exige template (será a Fase de avisos de pedido).
  async enviarTexto(tenantId: string, numero: string, texto: string) {
    const t = String(texto ?? '').trim();
    if (!t) throw new BadRequestException('Mensagem vazia.');
    const para = soDigitos(numero);
    if (!para) throw new BadRequestException('Número inválido.');

    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    if (!cfg.waCloudPhoneId)
      throw new BadRequestException('Esta loja não tem número da API oficial vinculado.');

    const res = await fetch(`${GRAPH}/${cfg.waCloudPhoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: para,
        type: 'text',
        text: { body: t },
      }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const corpo = res ? await res.text().catch(() => '') : '';
      // A mensagem de erro da Meta é o que diagnostica (janela fechada, sem cartão,
      // token sem escopo) — sem ela o suporte fica no escuro.
      throw new BadRequestException(
        `Falha ao enviar pela Cloud API (${res?.status ?? 'sem resposta'}): ${corpo.slice(0, 200)}`,
      );
    }
    const json: any = await res.json().catch(() => ({}));
    return { ok: true, id: json?.messages?.[0]?.id ?? null };
  }

  // Envio chamado pelo WORKFLOW DO N8N para responder o cliente. Autenticado pelo
  // mesmo BOT_RESOLVER_SECRET do resolver do Evolution — o n8n nunca toca o banco.
  //
  // A loja é identificada pelo phoneNumberId, que o próprio workflow recebeu no
  // payload normalizado e só devolve. Sem roteamento por provedor aqui: o workflow
  // da Cloud é separado do workflow do Evolution, então quem chega aqui já é Cloud.
  async enviarPeloBot(secret: string, phoneNumberId: string, numero: string, texto: string) {
    if (!segredoBotOk(secret, process.env.BOT_RESOLVER_SECRET ?? ''))
      throw new BadRequestException('Não autorizado.');

    const cfg = await this.lojaPorPhoneId(String(phoneNumberId ?? ''));
    if (!cfg) throw new NotFoundException('Número não vinculado a uma loja.');
    // Trava de coerência: se a loja voltou para o Evolution no meio da conversa, o
    // workflow da Cloud não pode continuar respondendo por ela.
    if (cfg.provedor !== 'cloud')
      throw new BadRequestException(`Loja está no provedor '${cfg.provedor}'.`);

    return this.enviarTexto(cfg.tenantId, numero, texto);
  }

  // Baixa uma midia (audio, imagem, documento) da Meta e devolve o binario.
  //
  // Existe para o n8n conseguir transcrever audio SEM receber o WA_CLOUD_TOKEN: o
  // workflow chama este endpoint com o secret do bot, e o token fica no servidor.
  // O token da Meta e a credencial-mestre da WABA (envia como qualquer loja, cria e
  // apaga templates) — e no Cenario B passa a alcancar as WABAs dos lojistas.
  async baixarMidia(secret: string, phoneNumberId: string, mediaId: string) {
    if (!segredoBotOk(secret, process.env.BOT_RESOLVER_SECRET ?? ''))
      throw new BadRequestException('Não autorizado.');

    // Estrito de propósito: o id vai concatenado na URL da Graph API.
    const id = String(mediaId ?? '').trim();
    if (!/^[0-9]{5,32}$/.test(id)) throw new BadRequestException('mediaId inválido.');

    const cfg = await this.lojaPorPhoneId(String(phoneNumberId ?? '').trim());
    if (!cfg) throw new NotFoundException('Número não vinculado a uma loja.');
    if (cfg.provedor !== 'cloud')
      throw new BadRequestException(`Loja está no provedor '${cfg.provedor}'.`);

    const auth = { Authorization: `Bearer ${this.token()}` };

    // 1) Metadados: a Meta devolve uma URL temporária, não o arquivo.
    const metaRes = await fetch(`${GRAPH}/${id}`, { headers: auth }).catch(() => null);
    if (!metaRes || !metaRes.ok) {
      const corpo = metaRes ? await metaRes.text().catch(() => '') : '';
      throw new BadRequestException(
        `Falha ao consultar a mídia (${metaRes?.status ?? 'sem resposta'}): ${corpo.slice(0, 160)}`,
      );
    }
    const meta: any = await metaRes.json().catch(() => ({}));
    const url = String(meta?.url ?? '');
    const mime = String(meta?.mime_type ?? 'application/octet-stream');
    if (Number(meta?.file_size ?? 0) > MAX_MIDIA)
      throw new BadRequestException('Mídia maior que o limite aceito.');

    let host = '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') throw new Error('http');
      host = u.hostname;
    } catch {
      throw new BadRequestException('URL de mídia inválida.');
    }
    if (!HOSTS_MIDIA.some((h) => host === h || host.endsWith(`.${h}`)))
      throw new BadRequestException('URL de mídia fora do domínio da Meta.');

    // 2) O binário. A URL temporária TAMBÉM exige o Bearer — é o tropeço clássico
    // de quem tenta baixar a mídia direto pelo link.
    const binRes = await fetch(url, { headers: auth }).catch(() => null);
    if (!binRes || !binRes.ok)
      throw new BadRequestException(`Falha ao baixar a mídia (${binRes?.status ?? 'sem resposta'}).`);

    const buffer = Buffer.from(await binRes.arrayBuffer());
    if (buffer.length > MAX_MIDIA) throw new BadRequestException('Mídia maior que o limite aceito.');
    this.logger.log(`midia entregue id=${id} tipo=${mime} bytes=${buffer.length}`);
    return { buffer, mime };
  }
}

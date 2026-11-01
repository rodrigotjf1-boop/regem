import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig, pedidoExterno } from '../../db/schema';
import { gerarCardapioPdf } from './cardapio-pdf';
import { fetchExterno } from '../../common/fetch-externo';
import {
  CABECALHO_ASSINATURA_EVOLUTION,
  assinaturaDaInstancia,
  segredoDoRoboOk,
} from '../../common/segredo-robo';
import { lembrarEnvio } from './evolution-envios';
import { anotarNaMemoria, chaveDaMemoria } from './robo-do-outro-lado';
import { pedidosParaORobo } from './pedidos-do-robo';
import {
  estadoDaPausa,
  minutosDaPausa,
  pausaDaConversa,
  pausarConversa,
  pausasDaLojaOuVazio,
  retomarConversa,
} from './robo-pausa';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Onboarding do WhatsApp da loja via Evolution API (v2):
//   POST /instance/create · GET /instance/connect/{name} (QR) ·
//   GET /instance/connectionState/{name} · POST /webhook/set/{name}
// Config global (secrets no servidor):
//   EVOLUTION_API_URL, EVOLUTION_API_KEY, N8N_BOT_WEBHOOK_URL
const EVENTS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'];

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('Whatsapp');
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private cfg() {
    const url = (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, '');
    const key = process.env.EVOLUTION_API_KEY ?? '';
    if (!url || !key)
      throw new BadRequestException('Evolution não configurado no servidor (EVOLUTION_API_URL/KEY).');
    return { url, key };
  }

  private async req(path: string, init: RequestInit = {}) {
    const { url, key } = this.cfg();
    const res = await fetchExterno(`${url}${path}`, {
      ...init,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    // Tudo o que o Regem manda sai daqui: guarda o id para o `fromMe` do webhook não parecer o atendente
    // respondendo pelo celular (evolution-envios.ts). Lê uma cópia — quem chamou ainda lê a resposta.
    if (res?.ok && path.startsWith('/message/send')) {
      await res
        .clone()
        .json()
        .then((j: any) => {
          lembrarEnvio(j?.key?.id);
          // A resposta do Regem entra na conversa recente (o detector do robô do outro lado mede a rapidez por ela).
          const instancia = decodeURIComponent(path.split('/')[3] ?? '');
          const numero = String(j?.key?.remoteJid ?? '').split('@')[0];
          anotarNaMemoria(chaveDaMemoria(instancia, numero), { direcao: 'saida', texto: null, tipo: 'text', em: new Date() });
        })
        .catch(() => {});
    }
    return res;
  }

  /**
   * "Digitando…" no celular do cliente enquanto o robô pensa. Evolution 2.3.x: `POST /chat/sendPresence/{instância}`
   * `{ number, presence: 'composing', delay }` — ela SEGURA a resposta até o fim do `delay` e depois manda "pausado"; a
   * mensagem do robô que chegar antes já tira o "digitando". Dispara e segue: nunca lança e não segura a entrada.
   */
  mostrarDigitando(instancia: string, numero: string, ms = 10_000): void {
    if (!instancia || !numero) return;
    void this.req(`/chat/sendPresence/${encodeURIComponent(instancia)}`, {
      method: 'POST',
      body: JSON.stringify({ number: numero, presence: 'composing', delay: ms }),
      signal: AbortSignal.timeout(ms + 5_000),
    }).catch(() => undefined);
  }

  /**
   * Para onde a instância manda as mensagens dos clientes. Com `EVOLUTION_PELO_REGEM=true` (o dono liga quando o fluxo
   * novo do n8n estiver importado): para o Regem, que aplica as travas e repassa ao robô — com a assinatura da instância
   * no cabeçalho. Sem a chave: direto ao n8n, como sempre.
   */
  private webhookDaInstancia(instancia: string): { url: string; headers?: Record<string, string> } | null {
    if (String(process.env.EVOLUTION_PELO_REGEM ?? '').toLowerCase() === 'true') {
      const base = (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
      const assinatura = assinaturaDaInstancia(instancia);
      if (!assinatura) {
        this.logger.warn('EVOLUTION_PELO_REGEM ligado sem BOT_RESOLVER_SECRET — webhook da instância não configurado.');
        return null;
      }
      return { url: `${base}/publico/whatsapp/evolution/webhook`, headers: { [CABECALHO_ASSINATURA_EVOLUTION]: assinatura } };
    }
    const n8n = process.env.N8N_BOT_WEBHOOK_URL ?? '';
    return n8n ? { url: n8n } : null;
  }

  // Nome da instância = slug da loja + sufixo do token (único e estável).
  private async instanciaDe(tenantId: string): Promise<{ cfg: any; instancia: string }> {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    let instancia = cfg.evolutionInstancia;
    if (!instancia) {
      const slug = (cfg.nomePublico ?? 'loja')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 24) || 'loja';
      instancia = `${slug}-${(cfg.token ?? '').slice(0, 6)}`;
    }
    return { cfg, instancia };
  }

  // Isolamento multi-tenant: uma instância do Evolution pertence a UMA loja só.
  // Sem isto, uma loja poderia "vincular" a instância de outra e ler as conversas
  // dela. Vale tanto no vincular manual quanto na criação automática.
  private async garantirInstanciaLivre(tenantId: string, instancia: string) {
    const donos = await this.db
      .select({ tenantId: cardapioConfig.tenantId })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.evolutionInstancia, instancia));
    if (donos.some((d) => d.tenantId !== tenantId))
      throw new BadRequestException('Esta conexão de WhatsApp já pertence a outra loja.');
  }

  // Busca o QR do Evolution com RETRY. O Evolution (Baileys) NÃO devolve o base64 no
  // 1º /instance/connect logo após criar a instância — o QR é gerado de forma
  // ASSÍNCRONA (chega segundos depois). Sem retry, o 1º connect vinha vazio e o front
  // mostrava "não foi possível gerar o QR". Tentamos algumas vezes com intervalo até o
  // QR aparecer; se a instância já estiver 'open' (pareada), não há QR e não é erro.
  private async pegarQr(instancia: string, tentativas = 6, intervaloMs = 1500) {
    for (let i = 0; i < tentativas; i++) {
      const res = await this.req(`/instance/connect/${instancia}`, { method: 'GET' }).catch(() => null);
      const j: any = res ? await res.json().catch(() => ({})) : {};
      const base64: string | undefined = j?.base64 ?? j?.qrcode?.base64;
      if (base64) {
        const qr = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
        return { qr, pairingCode: j?.pairingCode ?? j?.code ?? null, jaConectado: false };
      }
      if (j?.instance?.state === 'open' || j?.state === 'open') {
        return { qr: null, pairingCode: null, jaConectado: true };
      }
      if (i < tentativas - 1) await new Promise((r) => setTimeout(r, intervaloMs));
    }
    return { qr: null, pairingCode: null, jaConectado: false };
  }

  // Conecta (cria a instância se preciso, aponta o webhook pro n8n) e devolve o QR.
  async conectar(tenantId: string) {
    const { cfg, instancia } = await this.instanciaDe(tenantId);
    await this.garantirInstanciaLivre(tenantId, instancia);
    const webhook = this.webhookDaInstancia(instancia);

    // Cria a instância (idempotente: se já existe, o Evolution devolve erro que ignoramos).
    await this.req('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: instancia,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        ...(webhook
          ? { webhook: { enabled: true, ...webhook, byEvents: false, base64: false, events: EVENTS } }
          : {}),
      }),
    }).catch(() => {});

    // Garante o webhook (para instância já existente — "Reconectar" reaponta, inclusive quando a chave
    // EVOLUTION_PELO_REGEM muda).
    if (webhook) {
      await this.req(`/webhook/set/${instancia}`, {
        method: 'POST',
        body: JSON.stringify({ webhook: { enabled: true, ...webhook, byEvents: false, base64: false, events: EVENTS } }),
      }).catch(() => {});
    }

    // Persiste a instância no cardápio (chave do bot multi-tenant).
    if (cfg.evolutionInstancia !== instancia) {
      await this.db
        .update(cardapioConfig)
        .set({ evolutionInstancia: instancia, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, cfg.id));
    }

    // Busca o QR para parear (com retry — o Evolution gera o QR de forma assíncrona).
    const { qr, pairingCode, jaConectado } = await this.pegarQr(instancia);
    return { instancia, qr, pairingCode, jaConectado };
  }

  // Estado da conexão (open | connecting | close) + número, se pareado.
  async status(tenantId: string) {
    const { cfg, instancia } = await this.instanciaDe(tenantId);
    if (!cfg.evolutionInstancia) return { conectado: false, estado: 'nao_criada', instancia: null };
    const res = await this.req(`/instance/connectionState/${instancia}`, { method: 'GET' });
    if (!res.ok) return { conectado: false, estado: 'desconhecido', instancia };
    const j: any = await res.json().catch(() => ({}));
    const estado = j?.instance?.state ?? j?.state ?? 'desconhecido';
    return { conectado: estado === 'open', estado, instancia };
  }

  // Desconecta (logout do WhatsApp; a instância permanece p/ reparear).
  async desconectar(tenantId: string) {
    const { instancia } = await this.instanciaDe(tenantId);
    await this.req(`/instance/logout/${instancia}`, { method: 'DELETE' }).catch(() => {});
    return { ok: true };
  }

  // ===== Número de MARKETING (F5b) — 2º WhatsApp p/ campanhas (só ENVIO, sem bot) =====
  // Instância separada (sufixo -mkt) que isola o risco de ban do número principal.
  private async instanciaMkt(tenantId: string): Promise<{ cfg: any; instancia: string }> {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    let instancia = cfg.marketingInstancia;
    if (!instancia) {
      const slug =
        (cfg.nomePublico ?? 'loja')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 20) || 'loja';
      instancia = `${slug}-mkt-${(cfg.token ?? '').slice(0, 6)}`;
    }
    return { cfg, instancia };
  }

  // Conecta o número de marketing e devolve o QR. NÃO seta webhook (é só envio).
  async conectarMarketing(tenantId: string) {
    const { cfg, instancia } = await this.instanciaMkt(tenantId);
    await this.req('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    }).catch(() => {});
    if (cfg.marketingInstancia !== instancia) {
      await this.db
        .update(cardapioConfig)
        .set({ marketingInstancia: instancia, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, cfg.id));
    }
    const { qr, pairingCode, jaConectado } = await this.pegarQr(instancia);
    return { instancia, qr, pairingCode, jaConectado };
  }

  async statusMarketing(tenantId: string) {
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg?.marketingInstancia) return { conectado: false, estado: 'nao_criada', instancia: null };
    const res = await this.req(`/instance/connectionState/${cfg.marketingInstancia}`, { method: 'GET' });
    if (!res.ok) return { conectado: false, estado: 'desconhecido', instancia: cfg.marketingInstancia };
    const j: any = await res.json().catch(() => ({}));
    const estado = j?.instance?.state ?? j?.state ?? 'desconhecido';
    return { conectado: estado === 'open', estado, instancia: cfg.marketingInstancia };
  }

  async desconectarMarketing(tenantId: string) {
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (cfg?.marketingInstancia)
      await this.req(`/instance/logout/${cfg.marketingInstancia}`, { method: 'DELETE' }).catch(() => {});
    return { ok: true };
  }

  // Envia por uma instância EXPLÍCITA, validando POSSE (a da loja ou a de marketing
  // DESTE tenant) — nunca envia por instância de outra loja. Usado pelas campanhas.
  async enviarPorInstancia(tenantId: string, instancia: string, numero: string, texto: string) {
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    const permitidas = [cfg?.evolutionInstancia, cfg?.marketingInstancia].filter(Boolean);
    if (!instancia || !permitidas.includes(instancia))
      throw new BadRequestException('Instância não pertence à loja.');
    const t = String(texto ?? '').trim();
    if (!t) throw new BadRequestException('Mensagem vazia.');
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const res = await this.req(`/message/sendText/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({ number, text: t }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true };
  }

  // Envia uma mensagem de campanha pelo número escolhido ('loja' | 'marketing').
  async enviarCampanha(tenantId: string, instanciaTipo: string, numero: string, texto: string) {
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    const instancia = instanciaTipo === 'marketing' ? cfg?.marketingInstancia : cfg?.evolutionInstancia;
    if (!instancia)
      throw new BadRequestException(
        instanciaTipo === 'marketing' ? 'Número de marketing não conectado.' : 'WhatsApp da loja não conectado.',
      );
    return this.enviarPorInstancia(tenantId, instancia, numero, texto);
  }

  // Envia IMAGEM (por URL pública) por uma instância EXPLÍCITA da loja — usado pelas
  // campanhas com criativo. Valida POSSE igual ao enviarPorInstancia. O Evolution
  // busca a imagem pela URL; a legenda (caption) leva o texto + link da campanha.
  async enviarMidiaPorInstancia(
    tenantId: string,
    instancia: string,
    numero: string,
    mediaUrl: string,
    caption: string,
    mediatype: 'image' | 'video' = 'image',
  ) {
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    const permitidas = [cfg?.evolutionInstancia, cfg?.marketingInstancia].filter(Boolean);
    if (!instancia || !permitidas.includes(instancia))
      throw new BadRequestException('Instância não pertence à loja.');
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    if (!mediaUrl) throw new BadRequestException('Imagem ausente.');
    const res = await this.req(`/message/sendMedia/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({ number, mediatype, media: mediaUrl, caption: String(caption ?? '').trim() }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar mídia (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true };
  }

  // Diagnóstico da conexão com o Evolution — variáveis setadas? servidor respondeu?
  // a MINHA instância existe e em que estado? Para o gestor conferir sem abrir
  // EasyPanel/n8n. Mostra só a instância DESTA loja: a lista completa do servidor
  // revelaria os nomes das lojas dos outros clientes.
  async diagnostico(tenantId: string) {
    const url = (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, '');
    const key = process.env.EVOLUTION_API_KEY ?? '';
    const out: any = {
      urlSet: !!url,
      keySet: !!key,
      url: url ? url.replace(/^https?:\/\//, '') : null, // sem esquema (não vaza credencial)
      evolutionOk: false,
      instancias: [] as any[],
      instanciaVinculada: null as string | null,
      // Sem destino (N8N_BOT_WEBHOOK_URL, ou EVOLUTION_PELO_REGEM com a senha do robô), a instância nasce SEM
      // webhook e o robô nunca recebe as mensagens. Só o sim/não — a URL não vai para o lojista.
      webhookConfigurado: !!this.webhookDaInstancia('diagnostico'),
      webhookAtivo: null as boolean | null,
      erro: null as string | null,
    };
    try {
      const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
      out.instanciaVinculada = cfg?.evolutionInstancia ?? null;
    } catch {
      /* segue */
    }
    if (!url || !key) {
      out.erro = 'Faltam EVOLUTION_API_URL e/ou EVOLUTION_API_KEY no servidor (regem-api → Environment).';
      return out;
    }
    try {
      const res = await this.req('/instance/fetchInstances', { method: 'GET' });
      if (!res.ok) {
        out.erro = `O Evolution respondeu ${res.status} — confira a URL e a chave (a global AUTHENTICATION_API_KEY).`;
        return out;
      }
      const j: any = await res.json().catch(() => []);
      const arr: any[] = Array.isArray(j) ? j : j?.instances ?? j?.data ?? [];
      out.evolutionOk = true;
      const { instancia: minha } = await this.instanciaDe(tenantId).catch(() => ({ instancia: '' }) as any);
      out.instancias = arr
        .map((x: any) => {
          const inst = x.instance ?? x;
          return {
            nome: inst.instanceName ?? inst.name ?? inst.instanceId ?? '?',
            estado: inst.status ?? inst.state ?? inst.connectionStatus ?? '?',
          };
        })
        .filter((i: any) => i.nome === minha || i.nome === out.instanciaVinculada);
      // O robô só recebe mensagens se a instância tiver webhook apontado para o n8n.
      if (out.instancias.length) {
        const w = await this.req(`/webhook/find/${out.instancias[0].nome}`, { method: 'GET' }).catch(() => null);
        if (w && w.ok) {
          const wj: any = await w.json().catch(() => ({}));
          out.webhookAtivo = !!(wj?.enabled ?? wj?.webhook?.enabled);
        }
      }
    } catch (e: any) {
      out.erro = `Não consegui falar com o Evolution: ${e?.message ?? e}`;
    }
    return out;
  }

  // Vincula uma instância JÁ EXISTENTE do Evolution (uma conexão antiga, criada
  // no manager do EasyPanel) sem criar uma nova — só grava o nome. Depois disso o
  // status/inbox passam a ler ESSA instância (com os chats já existentes).
  async vincular(tenantId: string, nome: string) {
    const instancia = String(nome ?? '').trim();
    if (!instancia) throw new BadRequestException('Informe o nome da instância do Evolution.');
    await this.garantirInstanciaLivre(tenantId, instancia);
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    await this.db
      .update(cardapioConfig)
      .set({ evolutionInstancia: instancia, updatedAt: new Date() })
      .where(eq(cardapioConfig.id, cfg.id));
    // Confere o estado da instância informada (valida o nome + a conexão).
    const res = await this.req(`/instance/connectionState/${instancia}`, { method: 'GET' }).catch(() => null);
    const j: any = res && res.ok ? await res.json().catch(() => ({})) : {};
    const estado = j?.instance?.state ?? j?.state ?? 'desconhecido';
    return { ok: true, instancia, conectado: estado === 'open', estado };
  }

  // ===== Inbox: caixa de entrada do WhatsApp sobre a mesma instância Evolution =====
  // O WhatsApp Web NÃO pode ser embutido (iframe bloqueado); então lemos/enviamos
  // mensagens pela API da Evolution e montamos a nossa própria tela de conversas.
  // OBS: os formatos de resposta variam por versão da Evolution — parse defensivo
  // + log de diagnóstico para ajustar contra a instância real.

  // Pausa/retoma o robô SÓ para um número (o humano assume a conversa). Regras em robo-pausa.ts (mig 342):
  // `minutos` = por quanto tempo (nulo = o tempo da loja; 0 = até alguém retomar). O resolver do bot consulta e
  // devolve `pausado` p/ o n8n pular a resposta automática.
  async pausarConversa(
    tenantId: string,
    numero: string,
    pausar: boolean,
    opcoes: { minutos?: number | null; por?: string | null } = {},
  ) {
    const n = this.soNumero(numero);
    if (!n) throw new BadRequestException('Número inválido.');
    if (pausar) {
      const minutos = opcoes.minutos ?? (await minutosDaPausa(this.db, tenantId));
      await pausarConversa(this.db, { tenantId, telefone: n, minutos, motivo: 'manual', por: opcoes.por ?? null });
    } else {
      await retomarConversa(this.db, { tenantId, telefone: n, por: opcoes.por ?? null });
      await this.tirarDaPausaAntiga(tenantId, n);
    }
    const estado = await estadoDaPausa(this.db, tenantId, n);
    return { ok: true, numero: n, pausado: estado.pausado, pausadoAte: estado.ate };
  }

  // A pausa ANTIGA (vetor cardapio_config.robo_pausados, sem prazo) ainda vale até alguém retomar: o Retomar
  // também a limpa. Pausa nova não grava mais aqui (a linha sincroniza com a loja e era regravada inteira).
  private async tirarDaPausaAntiga(tenantId: string, n: string) {
    const [cfg] = await this.db
      .select({ id: cardapioConfig.id, roboPausados: cardapioConfig.roboPausados })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const atual: string[] = Array.isArray(cfg?.roboPausados) ? (cfg!.roboPausados as any) : [];
    if (!cfg || !atual.some((x) => this.soNumero(x) === n)) return;
    await this.db
      .update(cardapioConfig)
      .set({ roboPausados: atual.filter((x) => this.soNumero(x) !== n) as any, updatedAt: new Date() })
      .where(eq(cardapioConfig.id, cfg.id));
  }

  private pausadosSet(cfg: any): Set<string> {
    const arr: string[] = Array.isArray(cfg?.roboPausados) ? cfg.roboPausados : [];
    return new Set(arr.map((x) => this.soNumero(x)));
  }

  // Normaliza qualquer forma de "número" numa chave única: aceita telefone puro,
  // jid completo (`5521...@s.whatsapp.net`) e jid com sufixo de aparelho
  // (`5521...:12@s.whatsapp.net`) — sem isso o `:12` viraria dígito e não casava.
  private soNumero(v: any): string {
    return String(v ?? '')
      .split('@')[0]
      .split(':')[0]
      .replace(/\D/g, '');
  }

  // Tipo de mídia da mensagem (para o inbox mostrar miniatura). null = texto puro.
  private tipoMidia(m: any): 'imagem' | 'video' | 'audio' | 'documento' | 'figurinha' | null {
    const msg = m?.message ?? {};
    if (msg.imageMessage) return 'imagem';
    if (msg.stickerMessage) return 'figurinha';
    if (msg.videoMessage) return 'video';
    if (msg.audioMessage) return 'audio';
    if (msg.documentMessage) return 'documento';
    return null;
  }

  // Texto de uma mensagem (cobre os tipos mais comuns).
  private textoMsg(m: any): string {
    const msg = m?.message ?? {};
    return (
      msg.conversation ??
      msg.extendedTextMessage?.text ??
      msg.imageMessage?.caption ??
      msg.videoMessage?.caption ??
      msg.buttonsResponseMessage?.selectedDisplayText ??
      msg.listResponseMessage?.title ??
      m.body ??
      m.text ??
      (msg.imageMessage ? '📷 Imagem' : msg.audioMessage ? '🎤 Áudio' : msg.documentMessage ? '📄 Documento' : msg.stickerMessage ? '🏷️ Figurinha' : Object.keys(msg).length ? '[mídia]' : '')
    );
  }

  // Lista as conversas. Um MESMO contato pode ter 2 chats (o do telefone
  // `@s.whatsapp.net` com as mensagens que EU enviei, e o do `@lid` com as que o
  // cliente enviou). Juntamos os dois pelo TELEFONE real — que vem no `remoteJidAlt`
  // das mensagens do LID. Assim a conversa fica única e o número certo.
  async listarConversas(tenantId: string) {
    const { cfg, instancia } = await this.instanciaDe(tenantId);
    const pausados = this.pausadosSet(cfg); // pausa antiga (vetor), vale até alguém retomar
    const pausas = await pausasDaLojaOuVazio(this.db, tenantId, (m) => this.logger.warn(m));
    const res = await this.req(`/chat/findChats/${instancia}`, { method: 'POST', body: '{}' }).catch(() => null);
    if (!res || !res.ok) {
      this.logger.warn(`findChats ${res?.status ?? 'ERR'}`);
      return [];
    }
    const j: any = await res.json().catch(() => []);
    const arr: any[] = Array.isArray(j) ? j : j?.chats ?? j?.records ?? j?.data ?? [];

    const grupos = new Map<string, any>();
    for (const c of arr) {
      const jid = String(c.remoteJid ?? c.id ?? c.jid ?? '');
      if (!jid || jid.endsWith('@g.us') || jid.includes('broadcast') || jid.includes('status@')) continue;
      const last = c.lastMessage ?? c.last_message ?? {};
      // Telefone real: se for @lid, pega o remoteJidAlt (telefone) da última mensagem.
      let phoneJid = jid;
      if (jid.endsWith('@lid')) {
        const alt = last?.key?.remoteJidAlt;
        if (alt && String(alt).endsWith('@s.whatsapp.net')) phoneJid = String(alt);
      }
      const telefone = phoneJid.replace(/@.*/, '').replace(/\D/g, '');
      const chave = telefone || jid; // sem telefone resolvido, agrupa pelo próprio jid
      const g = grupos.get(chave) ?? {
        telefone,
        jids: new Set<string>(),
        nome: null as string | null,
        foto: null as string | null,
        naoLidas: 0,
        ultimaMensagem: null as string | null,
        timestamp: 0,
        ...pausaDaConversa(pausas, pausados, telefone),
      };
      g.jids.add(jid);
      const nomeC = c.pushName ?? c.name ?? c.contact?.pushName ?? c.verifiedName ?? null;
      if (nomeC && !g.nome) g.nome = nomeC; // prefere o chat que trouxer o nome (LID)
      if (!g.foto && c.profilePicUrl) g.foto = c.profilePicUrl;
      g.naoLidas += Number(c.unreadCount ?? c.unreadMessages ?? c.unread ?? 0) || 0;
      const ts =
        Number(last?.messageTimestamp ?? last?.timestamp ?? 0) ||
        (c.updatedAt ? Math.floor(new Date(c.updatedAt).getTime() / 1000) : 0);
      const texto = this.textoMsg(last);
      if (ts >= g.timestamp) {
        g.timestamp = ts;
        if (texto) g.ultimaMensagem = texto;
      }
      grupos.set(chave, g);
    }
    return Array.from(grupos.values())
      .map((g) => ({ ...g, jids: Array.from(g.jids) }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  // Mensagens da conversa — busca em TODOS os jids do contato (telefone + LID) e
  // junta em ordem cronológica. `jids` vem separado por vírgula.
  async mensagens(tenantId: string, jids: string) {
    const lista = String(jids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lista.length) return [];
    const { instancia } = await this.instanciaDe(tenantId);
    const todas: any[] = [];
    const vistos = new Set<string>();
    for (const jid of lista) {
      const res = await this.req(`/chat/findMessages/${instancia}`, {
        method: 'POST',
        body: JSON.stringify({ where: { key: { remoteJid: jid } }, limit: 60 }),
      }).catch(() => null);
      if (!res || !res.ok) {
        this.logger.warn(`findMessages ${res?.status ?? 'ERR'}`);
        continue;
      }
      const j: any = await res.json().catch(() => []);
      const arr: any[] = Array.isArray(j) ? j : j?.messages?.records ?? j?.records ?? j?.messages ?? j?.data ?? [];
      for (const m of arr) {
        const id = m.key?.id ?? m.id ?? String(m.messageTimestamp ?? '');
        if (vistos.has(id)) continue;
        vistos.add(id);
        const texto = this.textoMsg(m);
        const midia = this.tipoMidia(m);
        if (!texto && !midia) continue;
        todas.push({
          id,
          fromMe: !!(m.key?.fromMe ?? m.fromMe),
          texto,
          // Miniatura sob demanda no inbox: `midiaKey` reconstrói o pedido de
          // base64 ao Evolution só quando o usuário decide carregar a foto.
          midia,
          midiaKey: midia
            ? { id: m.key?.id ?? id, remoteJid: m.key?.remoteJid ?? jid, fromMe: !!(m.key?.fromMe ?? m.fromMe) }
            : null,
          timestamp: Number(m.messageTimestamp ?? m.timestamp ?? 0) || 0,
        });
      }
    }
    return todas.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Envia uma mensagem de texto (o humano assume a conversa do robô).
  async enviar(tenantId: string, numero: string, texto: string) {
    const t = String(texto ?? '').trim();
    if (!t) throw new BadRequestException('Mensagem vazia.');
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const res = await this.req(`/message/sendText/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({ number, text: t }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true };
  }

  /**
   * ENQUETE (QR/Evolution não tem botão confiável — os de Baileys estão quebrados na 2.3.7): o cliente toca na opção e o
   * voto volta no webhook com o NOME da opção. De 2 a 12 opções, uma escolha só. Nome da opção até 100 caracteres.
   */
  async enviarEnquete(tenantId: string, numero: string, pergunta: string, opcoes: string[]) {
    const nome = String(pergunta ?? '').trim().slice(0, 255) || 'Escolha uma opção:';
    const values = (Array.isArray(opcoes) ? opcoes : []).map((o) => String(o ?? '').trim().slice(0, 100)).filter(Boolean);
    if (values.length < 2 || values.length > 12) throw new BadRequestException('A enquete leva de 2 a 12 opções.');
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const res = await this.req(`/message/sendPoll/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({ number, name: nome, selectableCount: 1, values }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar a enquete (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true };
  }

  /**
   * NOTA DE VOZ: a Evolution converte o áudio (mp3, wav, ogg) para OGG/Opus e manda como nota de voz (ptt), com
   * "gravando áudio…" antes. Base64 sem o prefixo `data:`.
   */
  async enviarAudio(tenantId: string, numero: string, base64: string) {
    const audio = String(base64 ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!audio) throw new BadRequestException('Áudio vazio.');
    if (Buffer.byteLength(audio, 'base64') > 5 * 1024 * 1024) throw new BadRequestException('Áudio maior que 5 MB.');
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const res = await this.req(`/message/sendWhatsAppAudio/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({ number, audio, encoding: true, delay: 1200 }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar o áudio (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true };
  }

  /** A loja do robô pela chave que o n8n recebeu (phoneNumberId da API oficial ou instância da Evolution). */
  async lojaDoRobo(instancia?: string, phoneNumberId?: string): Promise<{ tenantId: string } | null> {
    return this.lojaPorChaveBot(instancia, phoneNumberId);
  }

  // Baixa a mídia de UMA mensagem sob demanda (miniatura no inbox). Usa o mesmo
  // endpoint que o robô usa para áudio (getBase64FromMediaMessage). Devolve um
  // data URL pronto para <img src>. Só quando o usuário decide carregar a foto —
  // por padrão o inbox não baixa (economia de dados, igual ao WhatsApp).
  async midia(tenantId: string, id: string, jid?: string, fromMe?: boolean) {
    if (!id) throw new BadRequestException('Mídia inválida.');
    const { instancia } = await this.instanciaDe(tenantId);
    const body = JSON.stringify({
      message: { key: { id, remoteJid: jid || undefined, fromMe: !!fromMe } },
      convertToMp4: false,
    });
    const res = await this.req(`/chat/getBase64FromMediaMessage/${instancia}`, {
      method: 'POST',
      body,
    }).catch(() => null);
    if (!res || !res.ok) {
      const t = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao baixar a mídia (${res?.status ?? 'sem resposta'}): ${t.slice(0, 120)}`);
    }
    const j: any = await res.json().catch(() => ({}));
    const base64: string = j?.base64 ?? j?.media ?? '';
    if (!base64) throw new BadRequestException('Mídia sem conteúdo.');
    const mimetype: string = j?.mimetype ?? j?.mediaType ?? 'image/jpeg';
    return { dataUrl: base64.startsWith('data:') ? base64 : `data:${mimetype};base64,${base64}` };
  }

  // ===== Enviar cardápio em PDF (botão do inbox) =====
  // Cardápios ativos do tenant. Normalmente um só; com mais de uma unidade pode
  // haver vários — aí o inbox pergunta de qual antes de enviar.
  async listarCardapios(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select cc.id, cc.nome_publico as "nome", u.nome as "unidadeNome"
        from cardapio_config cc
        left join unidade u on u.id = cc.unidade_id
       where cc.tenant_id = ${tenantId} and coalesce(cc.ativo, true) = true
       order by (cc.unidade_id is null) desc, u.nome
    `);
    return (r?.rows ?? r).map((x: any) => ({
      id: x.id,
      nome: x.nome || x.unidadeNome || 'Cardápio',
      unidadeNome: x.unidadeNome ?? null,
    }));
  }

  // Monta o PDF resumido (categorias × itens) e envia como documento pelo WhatsApp (Evolution). A loja da API oficial
  // usa o mesmo PDF pelo `WhatsappProvedorService.enviarCardapio` (Bloco 6).
  async enviarCardapio(tenantId: string, numero: string, cardapioId?: string) {
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const { pdf, arquivo, legenda, itens } = await this.pdfDoCardapio(tenantId, cardapioId);
    const base64 = pdf.toString('base64');

    // Evolution v2: envia documento (base64). Alguns builds aceitam `fileName`,
    // outros `filename` — mandamos os dois para não depender da versão.
    const res = await this.req(`/message/sendMedia/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({
        number,
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: base64,
        fileName: arquivo,
        filename: arquivo,
        caption: legenda,
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar o cardápio (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true, itens };
  }

  /**
   * O PDF resumido do cardápio (categorias × itens, com foto, descrição e preço) — o mesmo para as duas vias do WhatsApp
   * (a Evolution manda em base64; a API oficial sobe à Meta). O nome do arquivo e a legenda vêm junto.
   */
  async pdfDoCardapio(tenantId: string, cardapioId?: string): Promise<{ pdf: Buffer; arquivo: string; legenda: string; itens: number }> {
    // A loja/cardápio: o escolhido (validado no tenant) ou o único ativo.
    const cfgRow: any = await this.db.execute(sql`
      select id, nome_publico as "nome", logo_ref as "logo"
        from cardapio_config
       where tenant_id = ${tenantId}
         ${cardapioId ? sql`and id = ${cardapioId}` : sql``}
       order by (unidade_id is null) desc
       limit 1
    `);
    const cfg = (cfgRow?.rows ?? cfgRow)?.[0];
    if (!cfg) throw new NotFoundException('Cardápio não encontrado.');

    // Categorias ativas + itens do cardápio digital (nome/descrição/foto/preço).
    const catRows: any = await this.db.execute(sql`
      select id, nome from categoria_produto
       where tenant_id = ${tenantId} and coalesce(ativo, true) = true and deleted_at is null
       order by ordem, nome
    `);
    const categorias: any[] = [];
    for (const c of catRows?.rows ?? catRows) {
      const prods: any = await this.db.execute(sql`
        select nome, descricao, preco_venda as "precoVenda",
               preco_promocional as "precoPromocional", imagem_ref as "imagemUrl"
          from produto
         where tenant_id = ${tenantId} and categoria_id = ${c.id}
           and coalesce(ativo, true) = true
         order by nome
      `);
      const itens = (prods?.rows ?? prods).map((p: any) => ({ ...p }));
      if (itens.length) categorias.push({ nome: c.nome, itens });
    }
    // Produtos SEM categoria (ou em categoria inativa) ficavam de fora — vão numa
    // seção "Outros" no fim, para o cardápio não sair incompleto.
    const semCat: any = await this.db.execute(sql`
      select p.nome, p.descricao, p.preco_venda as "precoVenda",
             p.preco_promocional as "precoPromocional", p.imagem_ref as "imagemUrl"
        from produto p
       where p.tenant_id = ${tenantId} and coalesce(p.ativo, true) = true
         and (p.categoria_id is null or not exists (
           select 1 from categoria_produto c
            where c.id = p.categoria_id and coalesce(c.ativo, true) = true and c.deleted_at is null
         ))
       order by p.nome
    `);
    const outros = (semCat?.rows ?? semCat).map((p: any) => ({ ...p }));
    if (outros.length) categorias.push({ nome: 'Outros', itens: outros });

    if (!categorias.length)
      throw new BadRequestException('O cardápio não tem itens ativos para enviar.');

    const pdf = await gerarCardapioPdf(
      { nome: cfg.nome || 'Cardápio', logoUrl: cfg.logo },
      categorias,
    );
    const arquivo = `cardapio-${(cfg.nome || 'loja').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}.pdf`;
    return { pdf, arquivo, legenda: `Cardápio · ${cfg.nome || ''}`.trim(), itens: categorias.reduce((n, c) => n + c.itens.length, 0) };
  }

  // Envia um documento (PDF) já montado por WhatsApp. Reuso genérico do sendMedia
  // (ex.: espelho de ponto para o RH — Épico #2).
  async enviarDocumento(
    tenantId: string,
    numero: string,
    base64: string,
    fileName: string,
    caption = '',
  ) {
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');
    const res = await this.req(`/message/sendMedia/${instancia}`, {
      method: 'POST',
      body: JSON.stringify({
        number,
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: base64,
        fileName,
        filename: fileName,
        caption,
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(
        `Falha ao enviar o documento (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`,
      );
    }
    return { ok: true };
  }

  // ===== Resolver multi-tenant (o n8n chama por instância; protegido por secret) =====
  // Texto legível do status de um pedido (o robô repassa ao cliente).
  private textoStatusPedido(p: { status: string; statusPagamento: string | null; tipo: string | null }): string {
    const entrega = p.tipo === 'entrega';
    if (p.status === 'cancelado')
      return `Seu pedido foi cancelado${p.statusPagamento === 'aguardando' ? ' por falta de pagamento no prazo' : ''}.`;
    if (p.status === 'novo')
      return p.statusPagamento === 'aguardando'
        ? 'Seu pedido está aguardando a confirmação do pagamento PIX. Assim que o pagamento cair, ele entra em preparo.'
        : 'Recebemos seu pedido! Ele entra em preparo já já.';
    if (p.status === 'confirmado') return 'Seu pedido está EM PRODUÇÃO. 👨‍🍳';
    if (p.status === 'pronto')
      return entrega ? 'Seu pedido está PRONTO e logo sai para entrega.' : 'Seu pedido está PRONTO para retirada. 🎉';
    if (p.status === 'despachado')
      return entrega ? 'Seu pedido SAIU PARA ENTREGA. 🛵' : 'Seu pedido está aguardando retirada no balcão.';
    if (p.status === 'concluido')
      return entrega ? 'Seu pedido foi ENTREGUE. Bom apetite! 😋' : 'Seu pedido foi CONCLUÍDO. Bom apetite! 😋';
    return 'Seu pedido está em andamento.';
  }

  // Robô: status de um pedido por NÚMERO (senha) + telefone. Autentica igual ao
  // resolver (instância + BOT_RESOLVER_SECRET). Devolve um texto pronto pro cliente.
  // Resolve a loja pela CHAVE DO PROVEDOR: instancia do Evolution ou Phone Number ID
  // da Meta. Loja migrada para a Cloud API nao tem instancia, e loja no Evolution nao
  // tem phone id — um dos dois basta, e o chamador manda o que tiver.
  private async lojaPorChaveBot(instancia?: string, phoneNumberId?: string) {
    const pid = String(phoneNumberId ?? '').trim();
    if (pid) {
      const [c] = await this.db
        .select({ tenantId: cardapioConfig.tenantId })
        .from(cardapioConfig)
        .where(eq(cardapioConfig.waCloudPhoneId, pid));
      if (c) return c;
    }
    const inst = String(instancia ?? '').trim();
    if (inst) {
      const [c] = await this.db
        .select({ tenantId: cardapioConfig.tenantId })
        .from(cardapioConfig)
        .where(eq(cardapioConfig.evolutionInstancia, inst));
      if (c) return c;
    }
    return null;
  }

  async statusPedidoBot(
    instancia: string,
    secret: string,
    telefone?: string,
    numero?: string,
    phoneNumberId?: string,
  ) {
    if (!segredoDoRoboOk(secret)) throw new BadRequestException('Não autorizado.');
    const cfg = await this.lojaPorChaveBot(instancia, phoneNumberId);
    if (!cfg) throw new NotFoundException('Número/instância não vinculado a uma loja.');
    const num = String(numero ?? '').replace(/\D/g, '');
    if (!num)
      return { encontrado: false, texto: 'Não identifiquei o número do pedido. Pode me informar o número da senha?' };
    // O cliente pode informar o Nº do Regem (pedido_externo.numero, sequencial) OU o
    // código externo do cardápio (display_id). Casa qualquer um dos dois.
    const numInt = Number(num);
    const rows = await this.db
      .select({
        status: pedidoExterno.status,
        statusPagamento: pedidoExterno.statusPagamento,
        tipo: pedidoExterno.tipo,
        telefone: pedidoExterno.clienteTelefone,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, cfg.tenantId),
          or(
            eq(pedidoExterno.displayId, num),
            Number.isFinite(numInt) ? eq(pedidoExterno.numero, numInt) : undefined,
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(5);
    // Telefone (se veio) desempata quando a mesma senha se repete entre dias.
    const tel = this.soNumero(telefone);
    const alvo = (tel && rows.find((r) => this.soNumero(r.telefone ?? '') === tel)) || rows[0];
    if (!alvo)
      return { encontrado: false, texto: `Não achei o pedido Nº ${num}. Confere o número da senha?` };
    return {
      encontrado: true,
      numero: num,
      status: alvo.status,
      statusPagamento: alvo.statusPagamento,
      texto: this.textoStatusPedido(alvo),
    };
  }

  // Público (robô): pedidos RECENTES por telefone — autenticado pelo secret do bot
  // (não exige clienteToken; o WhatsApp já prova a posse do número). Casa pelos últimos
  // 8 dígitos. Alimenta o contexto da IA ("Pedidos recentes deste cliente").
  async pedidosPorTelefoneBot(
    instancia: string,
    secret: string,
    telefone?: string,
    phoneNumberId?: string,
  ) {
    if (!segredoDoRoboOk(secret)) throw new BadRequestException('Não autorizado.');
    const cfg = await this.lojaPorChaveBot(instancia, phoneNumberId);
    if (!cfg) throw new NotFoundException('Número/instância não vinculado a uma loja.');
    const tail = this.soNumero(telefone).slice(-8);
    if (tail.length < 8) return [];
    const rows = await this.db
      .select({
        numero: pedidoExterno.numero,
        displayId: pedidoExterno.displayId,
        status: pedidoExterno.status,
        statusPagamento: pedidoExterno.statusPagamento,
        tipo: pedidoExterno.tipo,
        total: pedidoExterno.total,
        entregadorNome: pedidoExterno.entregadorNome,
        criadoEm: pedidoExterno.criadoEm,
      })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, cfg.tenantId),
          or(
            ilike(pedidoExterno.clienteTelefone, `%${tail}%`),
            ilike(pedidoExterno.clienteTelefone2, `%${tail}%`),
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(5);
    return pedidosParaORobo(rows.map((r) => ({ ...r, statusTexto: this.textoStatusPedido(r) })));
  }

  async resolver(instancia: string, secret: string, numero?: string) {
    if (!segredoDoRoboOk(secret)) throw new BadRequestException('Não autorizado.');
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.evolutionInstancia, instancia));
    if (!cfg) throw new NotFoundException('Instância não vinculada a uma loja.');
    // Robô pausado para ESTE número? (o n8n manda &numero=... e pula a resposta se true)
    // Aceita telefone puro OU o jid inteiro — o n8n não precisa acertar o formato.
    const n = this.soNumero(numero);
    // Pausa (atendente assumiu, chamado aberto, Pausar manual — robo-pausa.ts) ou a pausa antiga do vetor.
    // Se a consulta falhar, o robô responde (como antes da pausa existir) e o motivo vai para o log.
    const estado = n
      ? await estadoDaPausa(this.db, cfg.tenantId, n).catch((e: any) => {
          this.logger.warn(`resolver: pausa não consultada (o robô responde): ${e?.message ?? e}`);
          return null;
        })
      : null;
    const pausado = !!estado?.pausado || (!!n && this.pausadosSet(cfg).has(n));
    return {
      tenantId: cfg.tenantId,
      cardapioToken: cfg.token,
      ativo: !!cfg.roboAtivo && !!cfg.ativo,
      pausado, // true = humano assumiu esta conversa; n8n NÃO deve responder
      pausadoAte: estado?.pausado ? estado.ate : null,
      roboSaudacao: cfg.roboSaudacao ?? null,
      roboAusencia: cfg.roboAusencia ?? null,
      roboPrompt: cfg.roboPrompt ?? null,
      roboMensagens: Array.isArray(cfg.roboMensagens) ? cfg.roboMensagens : [],
      nome: cfg.nomePublico ?? null,
    };
  }
}

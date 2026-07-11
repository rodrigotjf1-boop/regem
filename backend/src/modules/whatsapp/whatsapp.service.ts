import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';

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
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    return res;
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

  // Conecta (cria a instância se preciso, aponta o webhook pro n8n) e devolve o QR.
  async conectar(tenantId: string) {
    const { cfg, instancia } = await this.instanciaDe(tenantId);
    const webhookUrl = process.env.N8N_BOT_WEBHOOK_URL ?? '';

    // Cria a instância (idempotente: se já existe, o Evolution devolve erro que ignoramos).
    await this.req('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: instancia,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        ...(webhookUrl
          ? { webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVENTS } }
          : {}),
      }),
    }).catch(() => {});

    // Garante o webhook (para instância já existente).
    if (webhookUrl) {
      await this.req(`/webhook/set/${instancia}`, {
        method: 'POST',
        body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, events: EVENTS } }),
      }).catch(() => {});
    }

    // Persiste a instância no cardápio (chave do bot multi-tenant).
    if (cfg.evolutionInstancia !== instancia) {
      await this.db
        .update(cardapioConfig)
        .set({ evolutionInstancia: instancia, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, cfg.id));
    }

    // Busca o QR para parear.
    const res = await this.req(`/instance/connect/${instancia}`, { method: 'GET' });
    const j: any = await res.json().catch(() => ({}));
    const base64: string | undefined = j?.base64 ?? j?.qrcode?.base64;
    const qr = base64 ? (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`) : null;
    return { instancia, qr, pairingCode: j?.pairingCode ?? j?.code ?? null };
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

  // ===== Resolver multi-tenant (o n8n chama por instância; protegido por secret) =====
  async resolver(instancia: string, secret: string) {
    const esperado = process.env.BOT_RESOLVER_SECRET ?? '';
    if (!esperado || secret !== esperado) throw new BadRequestException('Não autorizado.');
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.evolutionInstancia, instancia));
    if (!cfg) throw new NotFoundException('Instância não vinculada a uma loja.');
    return {
      tenantId: cfg.tenantId,
      cardapioToken: cfg.token,
      ativo: !!cfg.roboAtivo && !!cfg.ativo,
      roboSaudacao: cfg.roboSaudacao ?? null,
      roboPrompt: cfg.roboPrompt ?? null,
      nome: cfg.nomePublico ?? null,
    };
  }
}

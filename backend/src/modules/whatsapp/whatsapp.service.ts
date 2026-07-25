import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { gerarCardapioPdf } from './cardapio-pdf';

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

  // Conecta (cria a instância se preciso, aponta o webhook pro n8n) e devolve o QR.
  async conectar(tenantId: string) {
    const { cfg, instancia } = await this.instanciaDe(tenantId);
    await this.garantirInstanciaLivre(tenantId, instancia);
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
      // Sem N8N_BOT_WEBHOOK_URL no servidor, a instância nasce SEM webhook e o robô
      // nunca recebe as mensagens. Só o sim/não — a URL do n8n não vai para o lojista.
      webhookConfigurado: !!process.env.N8N_BOT_WEBHOOK_URL,
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

  // Pausa/retoma o robô SÓ para um número (o humano assume a conversa). O resolver
  // do bot consulta e devolve `pausado` p/ o n8n pular a resposta automática.
  async pausarConversa(tenantId: string, numero: string, pausar: boolean) {
    const n = this.soNumero(numero);
    if (!n) throw new BadRequestException('Número inválido.');
    const [cfg] = await this.db.select().from(cardapioConfig).where(and(eq(cardapioConfig.tenantId, tenantId)));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    const atual: string[] = Array.isArray(cfg.roboPausados) ? (cfg.roboPausados as any) : [];
    const set = new Set(atual.map((x) => String(x).replace(/\D/g, '')));
    if (pausar) set.add(n);
    else set.delete(n);
    await this.db
      .update(cardapioConfig)
      .set({ roboPausados: Array.from(set) as any, updatedAt: new Date() })
      .where(eq(cardapioConfig.id, cfg.id));
    return { ok: true, numero: n, pausado: pausar };
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
    const pausados = this.pausadosSet(cfg);
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
        pausada: !!telefone && pausados.has(telefone),
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

  // Monta o PDF resumido (categorias × itens) e envia como documento pelo WhatsApp.
  async enviarCardapio(tenantId: string, numero: string, cardapioId?: string) {
    const { instancia } = await this.instanciaDe(tenantId);
    const number = this.soNumero(numero);
    if (!number) throw new BadRequestException('Número inválido.');

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
    const base64 = pdf.toString('base64');
    const arquivo = `cardapio-${(cfg.nome || 'loja').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}.pdf`;

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
        caption: `Cardápio · ${cfg.nome || ''}`.trim(),
      }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(`Falha ao enviar o cardápio (${res?.status ?? 'sem resposta'}): ${body.slice(0, 150)}`);
    }
    return { ok: true, itens: categorias.reduce((n, c) => n + c.itens.length, 0) };
  }

  // ===== Resolver multi-tenant (o n8n chama por instância; protegido por secret) =====
  async resolver(instancia: string, secret: string, numero?: string) {
    const esperado = process.env.BOT_RESOLVER_SECRET ?? '';
    if (!esperado || secret !== esperado) throw new BadRequestException('Não autorizado.');
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.evolutionInstancia, instancia));
    if (!cfg) throw new NotFoundException('Instância não vinculada a uma loja.');
    // Robô pausado para ESTE número? (o n8n manda &numero=... e pula a resposta se true)
    // Aceita telefone puro OU o jid inteiro — o n8n não precisa acertar o formato.
    const n = this.soNumero(numero);
    const pausado = n ? this.pausadosSet(cfg).has(n) : false;
    return {
      tenantId: cfg.tenantId,
      cardapioToken: cfg.token,
      ativo: !!cfg.roboAtivo && !!cfg.ativo,
      pausado, // true = humano assumiu esta conversa; n8n NÃO deve responder
      roboSaudacao: cfg.roboSaudacao ?? null,
      roboPrompt: cfg.roboPrompt ?? null,
      nome: cfg.nomePublico ?? null,
    };
  }
}

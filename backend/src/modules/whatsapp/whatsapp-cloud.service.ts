import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig, empresa, marketingOptout, whatsappMensagem, whatsappNumero, whatsappTemplate } from '../../db/schema';

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

// Biblioteca de modelos do Regem (auto-submetidos à WABA da loja no onboarding). Textos
// dentro das regras da Meta (texto antes/depois da variável). {{1}} = nome do cliente.
// {loja}/{cidade} = IDENTIFICAÇÃO da loja — viram texto LITERAL no envio (puxado de
// nomePublico/empresa.nome + endCidade em Configurações → Loja), não são variáveis da Meta.
// Botões: url (Peça agora rastreado) / copy_code (cupom) / optout.
const CATALOGO_REGEM: Array<{ nome: string; cabecalho: string; corpo: string; botoes: any[] }> = [
  { nome: 'promo_frete_gratis', cabecalho: 'Frete grátis hoje', corpo: 'Olá {{1}}! Aqui é a {loja}{cidade}. Hoje tem FRETE GRÁTIS pra você — aproveite e peça o seu pelo link abaixo. 🛵', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'copy_code', texto: 'Copiar cupom' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
  { nome: 'cupom_desconto', cabecalho: 'Um presente pra você', corpo: 'Oi {{1}}, aqui é a {loja}{cidade}! Preparamos um desconto especial pra você hoje. Aproveite antes que acabe — use seu cupom no pedido. 🎁', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'copy_code', texto: 'Copiar cupom' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
  { nome: 'recuperacao_cliente', cabecalho: 'Sentimos sua falta', corpo: 'Oi {{1}}, faz um tempo que você não pede na {loja}! Que tal matar a saudade hoje? Tem novidade te esperando. 😊', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
  { nome: 'cliente_vip', cabecalho: 'Você é VIP', corpo: 'Oi {{1}}, você é cliente especial pra {loja}! Como forma de agradecer, preparamos um mimo exclusivo pra você. Dá uma olhada! 🏆', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
  { nome: 'aniversario', cabecalho: 'Feliz aniversário', corpo: 'Parabéns, {{1}}! A {loja} preparou um presente especial pra você comemorar com a gente. Aproveite seu dia! 🎉', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'copy_code', texto: 'Copiar cupom' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
  { nome: 'novidade_cardapio', cabecalho: 'Novidade no cardápio', corpo: 'Oi {{1}}, chegou novidade no cardápio da {loja}! Dá uma olhada nas nossas delícias e peça o seu. 🍔', botoes: [{ tipo: 'url', texto: 'Peça agora' }, { tipo: 'optout', texto: 'Sair das ofertas' }] },
];

// Biblioteca de UTILIDADE (acompanhamento de pedido) — auto-submetida à WABA do número
// PRINCIPAL quando ele conecta na API oficial. Categoria UTILITY (custa fração do
// marketing). Cada modelo tem um `evento` = o status que o dispara. {{1}} = nome do
// cliente (o corpo nunca começa/termina com variável — regra da Meta). O de "saiu para
// entrega" leva o botão de rastreio (url .../r/{{1}} = envioId, medido).
// atendimento_humano: como template só aceita 3 botões, o menu de 6 opções vai NUMERADO
// no corpo (janela fechada); com janela aberta o n8n manda a LISTA interativa (até 10).
const CATALOGO_UTILIDADE: Array<{
  nome: string;
  evento: string;
  cabecalho: string;
  corpo: string;
  botoes: any[];
}> = [
  // Estágio "confirmado" = a loja aceitou e o pedido ENTROU EM PRODUÇÃO (fica no lugar
  // de um "recebido" — quando confirma, a cozinha já começou).
  { nome: 'pedido_em_producao', evento: 'confirmado', cabecalho: 'Pedido em produção', corpo: 'Oi {{1}}! Recebemos seu pedido na {loja} e ele já está em produção. 👨‍🍳 Qualquer novidade a gente te avisa por aqui.', botoes: [] },
  { nome: 'pedido_pronto_retirada', evento: 'pronto_retirada', cabecalho: 'Pedido pronto', corpo: 'Oi {{1}}, seu pedido na {loja} está PRONTO para retirada! 🎉 Pode vir buscar quando quiser.', botoes: [] },
  { nome: 'pedido_saiu_entrega', evento: 'saiu_entrega', cabecalho: 'Saiu para entrega', corpo: 'Oi {{1}}, seu pedido saiu para entrega! 🛵 Acompanhe a chegada em tempo real pelo botão abaixo.', botoes: [{ tipo: 'rastreio', texto: 'Acompanhar entrega' }] },
  { nome: 'pedido_entregue', evento: 'entregue', cabecalho: 'Pedido entregue', corpo: 'Oi {{1}}, seu pedido foi entregue! Bom apetite e muito obrigado por pedir na {loja}. 💛', botoes: [] },
  { nome: 'pedido_cancelado', evento: 'cancelado', cabecalho: 'Pedido cancelado', corpo: 'Oi {{1}}, seu pedido na {loja} foi cancelado. Se ficou alguma dúvida ou não reconhece isso, é só responder aqui que a gente ajuda.', botoes: [] },
  { nome: 'pedido_atrasado', evento: 'atrasado', cabecalho: 'Pedido atrasando', corpo: 'Oi {{1}}, seu pedido na {loja} está levando um pouco mais de tempo que o previsto. Pedimos desculpas pelo atraso — já estamos correndo para concluir e te entregar o quanto antes! 🙏', botoes: [] },
  { nome: 'atendimento_humano', evento: 'atendimento', cabecalho: 'Como podemos ajudar', corpo: 'Oi {{1}}! Antes de te encaminhar para o atendimento, me conta o que você precisa? Responda com o número:\n1 Alterar endereço\n2 Alterar pedido\n3 Item faltando\n4 Item errado\n5 Cancelar pedido\n6 Sobre o pedido', botoes: [] },
];

// Injeta a identificação da loja ({loja}/{cidade}) nos textos do catálogo. {cidade} vira
// " de <cidade>" quando há cidade; some quando não há (evita frase quebrada).
function identificarLoja(txt: string, loja: string, cidade: string): string {
  return String(txt ?? '')
    .replace(/\{cidade\}/g, cidade ? ` de ${cidade}` : '')
    .replace(/\{loja\}/g, loja || 'nossa loja')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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

  // Grava a mensagem no historico. Idempotente pelo indice unico (tenant, wamid):
  // a Meta REENVIA o webhook quando nao recebe 200 a tempo, e sem isso a mesma
  // mensagem apareceria duplicada no painel.
  //
  // Nunca derruba o fluxo: perder uma linha de historico e ruim, mas deixar de
  // responder o cliente por causa disso e pior.
  private async gravar(linha: {
    tenantId: string;
    telefone: string;
    direcao: 'entrada' | 'saida';
    tipo?: string;
    texto?: string | null;
    midiaId?: string | null;
    wamid?: string | null;
    status?: string | null;
    nomeContato?: string | null;
  }) {
    try {
      await this.db
        .insert(whatsappMensagem)
        .values({
          tenantId: linha.tenantId,
          telefone: linha.telefone,
          direcao: linha.direcao,
          tipo: linha.tipo ?? 'text',
          texto: linha.texto ?? null,
          midiaId: linha.midiaId ?? null,
          wamid: linha.wamid ?? null,
          status: linha.status ?? null,
          nomeContato: linha.nomeContato ?? null,
        })
        .onConflictDoNothing();
    } catch (e: any) {
      this.logger.error(`falha ao gravar historico: ${e?.message ?? e}`);
    }
  }

  // Pausa o robô para UMA conversa (coexistência: o lojista respondeu pelo app). Idempotente:
  // acrescenta o telefone em cardapio_config.robo_pausados sem duplicar. Best-effort.
  private async pausarRoboConversa(tenantId: string, telefone: string): Promise<void> {
    try {
      const tel = soDigitos(telefone);
      if (!tel) return;
      const [cfg] = await this.db
        .select({ id: cardapioConfig.id, roboPausados: cardapioConfig.roboPausados })
        .from(cardapioConfig)
        .where(eq(cardapioConfig.tenantId, tenantId));
      if (!cfg) return;
      const atual = Array.isArray(cfg.roboPausados) ? (cfg.roboPausados as any[]).map(String) : [];
      if (atual.map(soDigitos).includes(tel)) return; // já pausado
      atual.push(tel);
      await this.db
        .update(cardapioConfig)
        .set({ roboPausados: atual, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, cfg.id));
      this.logger.log(`coexistência: robô pausado para ${mascarar(tel)} (dono respondeu pelo app).`);
    } catch {
      /* best-effort: pausar é melhoria, nunca pode derrubar o webhook */
    }
  }

  // Processa UM evento do webhook. Resolve a loja, aplica os portões (provedor certo,
  // robô ativo, conversa não pausada) e encaminha ao n8n no formato normalizado.
  // Nunca lança: erro aqui não pode virar retry/desativação do webhook na Meta.
  async processar(body: any): Promise<void> {
    for (const entry of body?.entry ?? []) {
      for (const ch of entry?.changes ?? []) {
        const v = ch?.value ?? {};
        const phoneNumberId = String(v?.metadata?.phone_number_id ?? '');

        for (const st of v?.statuses ?? []) {
          this.logger.log(`status phone=${phoneNumberId} ${st?.status} id=${st?.id}`);
          // Marca no historico o que aconteceu com a mensagem que ENVIAMOS
          // (entregue, lida, falhou) — e o que o painel mostra ao atendente.
          if (st?.id && st?.status) {
            try {
              await this.db
                .update(whatsappMensagem)
                .set({ status: String(st.status) })
                .where(eq(whatsappMensagem.wamid, String(st.id)));
            } catch {
              /* status e informativo: nunca vale derrubar o processamento */
            }
          }
        }

        // COEXISTÊNCIA — ecos das mensagens que o LOJISTA envia pelo app/WhatsApp Web
        // (smb_message_echoes). NÃO é mensagem do cliente: registra como SAÍDA no inbox
        // (o atendente vê o que foi dito à mão) e PAUSA o robô naquela conversa — o dono
        // assumiu, então o robô não responde por cima. Retomar é manual (como já é hoje).
        const echoes = v?.message_echoes ?? [];
        if (echoes.length) {
          const cfgE = await this.lojaPorPhoneId(phoneNumberId);
          if (cfgE && cfgE.provedor === 'cloud') {
            for (const e of echoes) {
              const cliente = soDigitos(e?.to);
              if (!cliente) continue;
              await this.gravar({
                tenantId: cfgE.tenantId,
                telefone: cliente,
                direcao: 'saida',
                tipo: String(e?.type ?? 'text'),
                texto: this.textoDe(e),
                midiaId: this.midiaDe(e),
                wamid: String(e?.id ?? '') || null,
                status: 'sent',
              });
              await this.pausarRoboConversa(cfgE.tenantId, cliente);
            }
          }
          continue;
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

          // Grava ANTES dos portoes do robo, de proposito: o painel precisa mostrar
          // o que o cliente disse mesmo com o robo desligado ou com a conversa
          // pausada — alias, principalmente nesses casos, que e quando o humano
          // esta atendendo.
          await this.gravar({
            tenantId: cfg.tenantId,
            telefone: de,
            direcao: 'entrada',
            tipo: String(m?.type ?? 'text'),
            texto: this.textoDe(m),
            midiaId: this.midiaDe(m),
            wamid: String(m?.id ?? '') || null,
            nomeContato: nome,
          });

          // Opt-out por palavra-chave: cliente responde SAIR/PARAR → entra na lista de
          // exclusão de marketing (LGPD) + AVISO de confirmação. VOLTAR desfaz. Não
          // encaminha ao robô (continue), pra não misturar com o atendimento.
          const txt = this.textoDe(m).trim().toLowerCase();
          if (/^(sair|parar|cancelar|stop|descadastrar|sair das ofertas|parar ofertas|n[aã]o quero receber)\.?$/.test(txt)) {
            try {
              await this.db
                .insert(marketingOptout)
                .values({ tenantId: cfg.tenantId, telefone: de, motivo: 'palavra_chave' })
                .onConflictDoNothing();
              await this.enviarTexto(
                cfg.tenantId,
                de,
                'Pronto ✅ Você não vai mais receber ofertas e campanhas nossas. Se foi engano e quiser voltar a receber, responda VOLTAR.',
              );
            } catch {
              /* opt-out best-effort */
            }
            continue;
          }
          if (/^(voltar|voltei|receber)\.?$/.test(txt)) {
            try {
              await this.db
                .delete(marketingOptout)
                .where(and(eq(marketingOptout.tenantId, cfg.tenantId), eq(marketingOptout.telefone, de)));
              await this.enviarTexto(cfg.tenantId, de, 'Feito! Você voltou a receber nossas ofertas e novidades 🎉');
            } catch {
              /* best-effort */
            }
            continue;
          }

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
    const wamid = json?.messages?.[0]?.id ?? null;
    await this.gravar({
      tenantId,
      telefone: para,
      direcao: 'saida',
      tipo: 'text',
      texto: t,
      wamid,
      status: json?.messages?.[0]?.message_status ?? 'accepted',
    });
    return { ok: true, id: wamid };
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

  // ===== Espelho do painel (F2b) =====
  // Reproduz EXATAMENTE o contrato que o Evolution devolve, para o /delivery nao
  // precisar saber de qual provedor a loja e.

  // Quantas linhas varremos para montar a lista de conversas. Um limite alto
  // simplifica (agrupa em memoria, sem SQL exotico) e cobre com folga o volume de
  // uma loja; conversas mais antigas que isso saem da lista, nao do historico.
  private static readonly JANELA_CONVERSAS = 500;

  async listarConversas(tenantId: string) {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const pausados = new Set(
      (Array.isArray(cfg?.roboPausados) ? (cfg!.roboPausados as any[]) : []).map(soDigitos),
    );

    const linhas = await this.db
      .select()
      .from(whatsappMensagem)
      .where(eq(whatsappMensagem.tenantId, tenantId))
      .orderBy(desc(whatsappMensagem.criadoEm))
      .limit(WhatsappCloudService.JANELA_CONVERSAS);

    const grupos = new Map<string, any>();
    for (const l of linhas) {
      const tel = soDigitos(l.telefone);
      if (!tel) continue;
      const ts = Math.floor(new Date(l.criadoEm as any).getTime() / 1000);
      const g = grupos.get(tel) ?? {
        telefone: tel,
        // O front devolve `jids` para pedir as mensagens. Na Cloud nao existe jid;
        // o telefone faz esse papel, e o contrato fica igual ao do Evolution.
        jids: [tel],
        nome: null as string | null,
        foto: null as string | null, // a Meta nao entrega foto de perfil
        naoLidas: 0,
        ultimaMensagem: null as string | null,
        timestamp: 0,
        pausada: pausados.has(tel),
        _ultimaSaida: 0,
      };
      if (!g.nome && l.nomeContato) g.nome = l.nomeContato;
      if (ts > g.timestamp) {
        g.timestamp = ts;
        g.ultimaMensagem = l.texto ?? (l.tipo !== 'text' ? `[${l.tipo}]` : null);
      }
      if (l.direcao === 'saida' && ts > g._ultimaSaida) g._ultimaSaida = ts;
      grupos.set(tel, g);
    }

    // "Nao lidas" = mensagens do cliente depois da ultima resposta nossa. Nao e o
    // contador do WhatsApp, mas responde a pergunta que o atendente faz: quem esta
    // esperando resposta.
    for (const l of linhas) {
      const tel = soDigitos(l.telefone);
      const g = grupos.get(tel);
      if (!g || l.direcao !== 'entrada') continue;
      const ts = Math.floor(new Date(l.criadoEm as any).getTime() / 1000);
      if (ts > g._ultimaSaida) g.naoLidas += 1;
    }

    return Array.from(grupos.values())
      .map(({ _ultimaSaida, ...g }) => g)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  async mensagens(tenantId: string, telefones: string) {
    const lista = String(telefones ?? '')
      .split(',')
      .map((x) => soDigitos(x))
      .filter(Boolean);
    if (!lista.length) return [];
    const linhas = await this.db
      .select()
      .from(whatsappMensagem)
      .where(
        and(eq(whatsappMensagem.tenantId, tenantId), inArray(whatsappMensagem.telefone, lista)),
      )
      .orderBy(desc(whatsappMensagem.criadoEm))
      .limit(60);

    return linhas
      .map((l) => ({
        id: l.wamid ?? l.id,
        fromMe: l.direcao === 'saida',
        texto: l.texto ?? '',
        midia: l.tipo === 'text' ? null : l.tipo,
        // Miniatura ainda nao ligada na Cloud: o proxy de midia existe (#379), mas o
        // inbox pede a foto pelo formato do Evolution. Fica para uma proxima.
        midiaKey: null,
        status: l.status ?? null,
        timestamp: Math.floor(new Date(l.criadoEm as any).getTime() / 1000),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ===== Envio por TEMPLATE (F2d) =====
  // Fora da janela de 24h a Meta NAO aceita texto livre: so modelo aprovado. E o
  // que faz o "seu pedido saiu para entrega" existir.
  //
  // A categoria do modelo define o preco (utilidade custa uma fracao de marketing),
  // e quem decide isso e a aprovacao na Meta, nao esta chamada.
  async enviarTemplate(
    tenantId: string,
    numero: string,
    nome: string,
    idioma: string,
    params: string[],
    opts?: { envioId?: string; cupom?: string | null; phoneId?: string; rastreio?: string | null },
  ) {
    const para = soDigitos(numero);
    if (!para) throw new BadRequestException('Número inválido.');
    const tpl = String(nome ?? '').trim();
    if (!tpl) throw new BadRequestException('Nome do modelo não informado.');

    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    // Envia pelo phone_id informado (papel marketing na Oficial) ou o principal da loja.
    const phoneEnvio = String(opts?.phoneId ?? '').trim() || cfg.waCloudPhoneId;
    if (!phoneEnvio)
      throw new BadRequestException('Esta loja não tem número da API oficial vinculado.');

    // Carrega o modelo local p/ montar botões (URL rastreada = opts.envioId; copiar
    // cupom = opts.cupom) e o carrossel no ENVIO.
    const [tplRow] = await this.db
      .select()
      .from(whatsappTemplate)
      .where(and(eq(whatsappTemplate.tenantId, tenantId), eq(whatsappTemplate.nome, tpl)));
    const envioId = opts?.envioId || 'x';
    const cupom = opts?.cupom || 'CUPOM';
    const rastreio = opts?.rastreio || 'x';
    const paramBotao = (b: any, idx: number) => {
      // url = redirect de campanha (envioId); rastreio = página /r/{token} do delivery.
      if (b?.tipo === 'url')
        return { type: 'button', sub_type: 'url', index: String(idx), parameters: [{ type: 'text', text: envioId }] };
      if (b?.tipo === 'rastreio')
        return { type: 'button', sub_type: 'url', index: String(idx), parameters: [{ type: 'text', text: rastreio }] };
      if (b?.tipo === 'copy_code')
        return { type: 'button', sub_type: 'copy_code', index: String(idx), parameters: [{ type: 'coupon_code', coupon_code: cupom }] };
      return null; // quick_reply/optout não levam parâmetro no envio
    };

    const componentes: any[] = params.length
      ? [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t ?? '') })) }]
      : [];

    if (tplRow?.formato === 'carrossel') {
      const cards = (tplRow.cards as any[] | null) ?? [];
      componentes.push({
        type: 'carousel',
        cards: cards.map((card, ci) => {
          const comps: any[] = [
            { type: 'header', parameters: [{ type: 'image', image: { link: String(card?.imagemRef ?? '') } }] },
          ];
          (card?.botoes ?? []).forEach((b: any, bi: number) => {
            const p = paramBotao(b, bi);
            if (p) comps.push(p);
          });
          return { card_index: ci, components: comps };
        }),
      });
    } else {
      (tplRow?.botoes as any[] | null)?.forEach((b, idx) => {
        const p = paramBotao(b, idx);
        if (p) componentes.push(p);
      });
    }

    const res = await fetch(`${GRAPH}/${phoneEnvio}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: para,
        type: 'template',
        template: {
          name: tpl,
          language: { code: idioma || 'pt_BR' },
          ...(componentes.length ? { components: componentes } : {}),
        },
      }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const corpo = res ? await res.text().catch(() => '') : '';
      // As duas falhas mais comuns aqui sao "modelo nao aprovado" e "sem meio de
      // pagamento na conta" — a mensagem da Meta e o que diz qual das duas foi.
      throw new BadRequestException(
        `Falha ao enviar o modelo (${res?.status ?? 'sem resposta'}): ${corpo.slice(0, 220)}`,
      );
    }
    const json: any = await res.json().catch(() => ({}));
    const wamid = json?.messages?.[0]?.id ?? null;
    await this.gravar({
      tenantId,
      telefone: para,
      direcao: 'saida',
      tipo: 'template',
      texto: `[modelo ${tpl}] ${params.join(' · ')}`.trim(),
      wamid,
      status: json?.messages?.[0]?.message_status ?? 'accepted',
    });
    return { ok: true, id: wamid };
  }

  // Chamado pelo workflow de avisos no n8n (mesma autenticacao do bot).
  async enviarTemplatePeloBot(
    secret: string,
    phoneNumberId: string,
    numero: string,
    nome: string,
    idioma: string,
    params: string[],
    rastreio?: string | null,
  ) {
    if (!segredoBotOk(secret, process.env.BOT_RESOLVER_SECRET ?? ''))
      throw new BadRequestException('Não autorizado.');
    const cfg = await this.lojaPorPhoneId(String(phoneNumberId ?? '').trim());
    if (!cfg) throw new NotFoundException('Número não vinculado a uma loja.');
    if (cfg.provedor !== 'cloud')
      throw new BadRequestException(`Loja está no provedor '${cfg.provedor}'.`);
    // `rastreio` = token do /r/{token} (botão "Acompanhar entrega" do saiu_entrega).
    return this.enviarTemplate(cfg.tenantId, numero, nome, idioma, params ?? [], { rastreio: rastreio ?? null });
  }

  // Modelos da conta, com o status de aprovacao. E a base para a tela escolher o
  // modelo de um aviso ou de uma campanha — e para o lojista ver o que ja aprovou.
  async listarTemplates(tenantId: string) {
    const waba = await this.wabaDe(tenantId); // papel-aware (Marketing → Principal → cfg → env)
    const url = `${GRAPH}/${waba}/message_templates?fields=name,status,category,language&limit=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token()}` },
    }).catch(() => null);
    if (!res || !res.ok) {
      const corpo = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(
        `Falha ao listar modelos (${res?.status ?? 'sem resposta'}): ${corpo.slice(0, 180)}`,
      );
    }
    const json: any = await res.json().catch(() => ({}));
    return (json?.data ?? []).map((t: any) => ({
      nome: t?.name,
      status: t?.status,
      categoria: t?.category,
      idioma: t?.language,
    }));
  }

  // ===== Gestão LOCAL de templates (Opção B: criar/submeter pelo Regem, mig 227) =====

  private async wabaDe(tenantId: string, preferir: 'marketing' | 'principal' = 'marketing'): Promise<string> {
    // Templates vivem na WABA que vai ENVIAR. No modelo de 2 papéis, o Marketing pode ser
    // uma WABA PRÓPRIA (a loja conecta só o Marketing como Oficial e o Principal fica no
    // Grátis). Por padrão prioriza a WABA do MARKETING; para modelos de UTILIDADE (avisos
    // de status), `preferir='principal'` — eles saem do número PRINCIPAL, então têm que ser
    // aprovados na WABA dele. Cai para o outro papel → cardapio_config → env.
    const nums = await this.db
      .select({ papel: whatsappNumero.papel, wabaId: whatsappNumero.wabaId })
      .from(whatsappNumero)
      .where(
        and(
          eq(whatsappNumero.tenantId, tenantId),
          eq(whatsappNumero.provedor, 'cloud'),
          isNull(whatsappNumero.unidadeId),
        ),
      );
    const mkt = nums.find((n) => n.papel === 'marketing' && n.wabaId)?.wabaId;
    const prin = nums.find((n) => n.papel === 'principal' && n.wabaId)?.wabaId;
    const [cfg] = await this.db
      .select({ w: cardapioConfig.waCloudWabaId })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const ordem = preferir === 'principal' ? [prin, mkt] : [mkt, prin];
    const waba = ordem.find(Boolean) || cfg?.w || process.env.WA_CLOUD_WABA_ID || '';
    if (!waba) throw new BadRequestException('Conta do WhatsApp Business (WABA) não vinculada a esta loja.');
    return waba;
  }

  // Normaliza o nome técnico exigido pela Meta (minúsculas, dígitos, underscore).
  private normalizarNome(nome: string): string {
    return String(nome ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'modelo';
  }

  async templatesLocais(tenantId: string) {
    return this.db
      .select()
      .from(whatsappTemplate)
      .where(eq(whatsappTemplate.tenantId, tenantId))
      .orderBy(desc(whatsappTemplate.criadoEm));
  }

  private redirectBase(): string {
    return (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
  }

  // Base pública do app do cliente (cardápio/rastreio) — o /r/{token} do delivery.
  private rastreioBase(): string {
    return (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
  }

  // Valida o corpo contra as REGRAS DA META (as que causam rejeição automática).
  // Devolve a mensagem de erro (pt-BR) ou null se ok. Usada no submit (trava) e
  // espelhada no front (aviso imediato).
  private validarCorpoTemplate(txt: string, onde = 'texto'): string | null {
    const t = String(txt ?? '').trim();
    if (t.length < 3) return `O ${onde} está muito curto.`;
    if (/^\{\{\s*\d+\s*\}\}/.test(t))
      return `O ${onde} não pode COMEÇAR com uma variável ({{1}}) — regra da Meta. Coloque um texto antes (ex.: "Olá {{1}}…").`;
    if (/\{\{\s*\d+\s*\}\}\s*$/.test(t))
      return `O ${onde} não pode TERMINAR com uma variável — regra da Meta. Coloque um texto depois.`;
    if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(t))
      return `Duas variáveis não podem ficar coladas ({{1}} {{2}}) — separe com texto.`;
    const nums = (t.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((v) => Number(v.replace(/\D/g, '')));
    const uniq = [...new Set(nums)].sort((a, b) => a - b);
    if (uniq.some((n, i) => n !== i + 1))
      return `As variáveis devem ser numeradas em sequência a partir de {{1}}, sem pular (encontrei ${uniq.map((n) => `{{${n}}}`).join(', ')}).`;
    return null;
  }

  // Converte nossos botões p/ o formato da Meta na CRIAÇÃO do template. O botão URL
  // "Peça agora" usa o redirect rastreado (.../r/{{1}}) → clique medido + leva ao link
  // da campanha. copy_code = copiar cupom. quick_reply/optout = resposta rápida.
  private montarBotoesTemplate(botoes: any[] | null | undefined): any[] {
    const out: any[] = [];
    for (const b of botoes ?? []) {
      const texto = String(b?.texto ?? '').slice(0, 25);
      if (b?.tipo === 'url') {
        const base = `${this.redirectBase()}/publico/campanha/r`;
        out.push({ type: 'URL', text: texto || 'Peça agora', url: `${base}/{{1}}`, example: [`${base}/exemplo`] });
      } else if (b?.tipo === 'rastreio') {
        // Botão de rastreio do delivery: URL dinâmica {app}/r/{{1}} = token de rastreio.
        const base = `${this.rastreioBase()}/r`;
        out.push({ type: 'URL', text: texto || 'Acompanhar entrega', url: `${base}/{{1}}`, example: [`${base}/exemplo`] });
      } else if (b?.tipo === 'copy_code') {
        out.push({ type: 'COPY_CODE', example: 'PROMO10' });
      } else if (b?.tipo === 'optout') {
        // Texto padronizado p/ o clique cair no opt-out automático do webhook.
        out.push({ type: 'QUICK_REPLY', text: 'Sair das ofertas' });
      } else {
        out.push({ type: 'QUICK_REPLY', text: texto || 'Responder' });
      }
    }
    return out.slice(0, 10);
  }

  // Upload resumable de uma imagem (URL pública) → header_handle exigido p/ criar
  // template com HEADER/carrossel de IMAGEM. Usa o App ID + token do System User.
  private async uploadMidiaHandle(imagemUrl: string): Promise<string> {
    const appId = process.env.WA_CLOUD_APP_ID ?? '';
    if (!appId) throw new BadRequestException('WA_CLOUD_APP_ID não configurado (necessário p/ enviar imagem à Meta).');
    if (!imagemUrl) throw new BadRequestException('Card sem imagem.');
    const img = await fetch(imagemUrl).catch(() => null);
    if (!img || !img.ok) throw new BadRequestException('Não consegui baixar a imagem do card.');
    const buf = Buffer.from(await img.arrayBuffer());
    const mime = img.headers.get('content-type') || 'image/jpeg';
    const s = await fetch(
      `${GRAPH}/${appId}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(mime)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.token()}` } },
    ).catch(() => null);
    const sj: any = s ? await s.json().catch(() => ({})) : {};
    if (!sj?.id) throw new BadRequestException(`Falha ao abrir upload na Meta: ${JSON.stringify(sj).slice(0, 160)}`);
    const u = await fetch(`${GRAPH}/${sj.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${this.token()}`, file_offset: '0' },
      body: buf as any,
    }).catch(() => null);
    const uj: any = u ? await u.json().catch(() => ({})) : {};
    if (!uj?.h) throw new BadRequestException(`Falha no upload da imagem à Meta: ${JSON.stringify(uj).slice(0, 160)}`);
    return uj.h;
  }

  // Cria/edita um template em RASCUNHO no banco (ainda não vai à Meta).
  async salvarTemplate(
    tenantId: string,
    dto: {
      id?: string;
      nome?: string;
      categoria?: string;
      idioma?: string;
      cabecalho?: string | null;
      corpo?: string;
      rodape?: string | null;
      exemplo?: string[] | null;
      botoes?: any[] | null;
      formato?: string;
      cards?: any[] | null;
    },
  ) {
    const formato = dto.formato === 'carrossel' ? 'carrossel' : 'padrao';
    const corpo = String(dto.corpo ?? '').trim();
    if (corpo.length < 3) throw new BadRequestException('Corpo do modelo muito curto.');
    if (formato === 'carrossel' && (!dto.cards || dto.cards.length < 2))
      throw new BadRequestException('Carrossel exige pelo menos 2 cards.');
    const categoria = ['UTILITY', 'AUTHENTICATION'].includes(String(dto.categoria))
      ? String(dto.categoria)
      : 'MARKETING';
    const patch = {
      nome: this.normalizarNome(dto.nome || 'modelo'),
      categoria,
      idioma: dto.idioma || 'pt_BR',
      cabecalho: dto.cabecalho?.trim() || null,
      corpo,
      rodape: dto.rodape?.trim() || null,
      exemplo: dto.exemplo && dto.exemplo.length ? dto.exemplo : null,
      botoes: dto.botoes && dto.botoes.length ? dto.botoes : null,
      formato,
      cards: formato === 'carrossel' && dto.cards?.length ? dto.cards : null,
      status: 'rascunho',
      atualizadoEm: new Date(),
    };
    if (dto.id) {
      const [row] = await this.db
        .update(whatsappTemplate)
        .set(patch)
        .where(and(eq(whatsappTemplate.id, dto.id), eq(whatsappTemplate.tenantId, tenantId)))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(whatsappTemplate)
      .values({ tenantId, ...patch })
      .returning();
    return row;
  }

  // Submete o template à Meta para aprovação. Guarda o meta_id e marca 'pendente'.
  // Cabeçalho TEXT da Meta: NÃO pode ter emojis, quebras de linha, asteriscos nem
  // caracteres de formatação (*, _, ~, `) — senão a Meta recusa o modelo. Sanitiza e
  // limita a 60 chars. (Emojis no corpo são permitidos; no cabeçalho, não.)
  private sanitizarCabecalho(txt: string): string {
    return String(txt ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 60);
  }

  async submeterTemplate(tenantId: string, id: string) {
    const [tpl] = await this.db
      .select()
      .from(whatsappTemplate)
      .where(and(eq(whatsappTemplate.id, id), eq(whatsappTemplate.tenantId, tenantId)));
    if (!tpl) throw new NotFoundException('Modelo não encontrado.');
    // UTILIDADE (avisos de status) vive na WABA do PRINCIPAL; marketing, na do Marketing.
    const waba = await this.wabaDe(tenantId, tpl.categoria === 'UTILITY' ? 'principal' : 'marketing');

    // Trava as regras da Meta ANTES de enviar (evita rejeição + dá mensagem clara em pt).
    const errCorpo = this.validarCorpoTemplate(tpl.corpo, tpl.formato === 'carrossel' ? 'texto do topo' : 'corpo');
    if (errCorpo) throw new BadRequestException(errCorpo);
    if (tpl.formato === 'carrossel') {
      ((tpl.cards as any[] | null) ?? []).forEach((card, i) => {
        const e = this.validarCorpoTemplate(String(card?.corpo ?? ''), `texto do card ${i + 1}`);
        if (e) throw new BadRequestException(e);
      });
    }

    const exemploCorpo = (txt: string) => {
      const n = (String(txt ?? '').match(/\{\{\d+\}\}/g) ?? []).length;
      if (!n) return undefined;
      const ex = (tpl.exemplo as string[] | null) ?? [];
      return { body_text: [Array.from({ length: n }, (_, i) => ex[i] || 'exemplo')] };
    };
    const componentes: any[] = [];
    if (tpl.formato === 'carrossel') {
      // Balão (BODY) + CAROUSEL com os cards (cada card: imagem + corpo + botões).
      const body: any = { type: 'BODY', text: tpl.corpo };
      const exB = exemploCorpo(tpl.corpo);
      if (exB) body.example = exB;
      componentes.push(body);
      const cards = (tpl.cards as any[] | null) ?? [];
      const cardsMeta: any[] = [];
      for (const card of cards) {
        const handle = await this.uploadMidiaHandle(String(card?.imagemRef ?? ''));
        const comps: any[] = [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
          { type: 'BODY', text: String(card?.corpo ?? '') },
        ];
        const btns = this.montarBotoesTemplate(card?.botoes);
        if (btns.length) comps.push({ type: 'BUTTONS', buttons: btns });
        cardsMeta.push({ components: comps });
      }
      componentes.push({ type: 'CAROUSEL', cards: cardsMeta });
    } else {
      const cab = this.sanitizarCabecalho(tpl.cabecalho ?? '');
      if (cab) componentes.push({ type: 'HEADER', format: 'TEXT', text: cab });
      const body: any = { type: 'BODY', text: tpl.corpo };
      const exB = exemploCorpo(tpl.corpo);
      if (exB) body.example = exB;
      componentes.push(body);
      if (tpl.rodape) componentes.push({ type: 'FOOTER', text: tpl.rodape });
      const btns = this.montarBotoesTemplate(tpl.botoes as any[]);
      if (btns.length) componentes.push({ type: 'BUTTONS', buttons: btns });
    }

    const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tpl.nome, language: tpl.idioma, category: tpl.categoria, components: componentes }),
    }).catch(() => null);
    const json: any = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      const msg = json?.error?.error_user_msg || json?.error?.message || 'falha ao submeter';
      await this.db
        .update(whatsappTemplate)
        .set({ status: 'rejeitado', motivoRejeicao: String(msg).slice(0, 300), atualizadoEm: new Date() })
        .where(eq(whatsappTemplate.id, id));
      throw new BadRequestException(`Meta recusou o modelo: ${String(msg).slice(0, 220)}`);
    }
    const [row] = await this.db
      .update(whatsappTemplate)
      .set({ status: 'pendente', metaId: json?.id ?? null, motivoRejeicao: null, atualizadoEm: new Date() })
      .where(eq(whatsappTemplate.id, id))
      .returning();
    return row;
  }

  // Sincroniza o STATUS dos templates com a Meta (aprovado/rejeitado/pausado).
  async sincronizarTemplates(tenantId: string) {
    const remotos = await this.listarTemplates(tenantId); // [{nome,status,categoria,idioma}]
    const mapa = new Map((remotos as any[]).map((t) => [`${t.nome}|${t.idioma}`, t.status]));
    const locais = await this.templatesLocais(tenantId);
    const de: Record<string, string> = { APPROVED: 'aprovado', PENDING: 'pendente', REJECTED: 'rejeitado', PAUSED: 'pausado' };
    for (const l of locais) {
      const st = mapa.get(`${l.nome}|${l.idioma}`);
      if (st && de[st] && de[st] !== l.status) {
        await this.db
          .update(whatsappTemplate)
          .set({ status: de[st], atualizadoEm: new Date() })
          .where(eq(whatsappTemplate.id, l.id));
      }
    }
    return this.templatesLocais(tenantId);
  }

  async removerTemplate(tenantId: string, id: string) {
    await this.db
      .delete(whatsappTemplate)
      .where(and(eq(whatsappTemplate.id, id), eq(whatsappTemplate.tenantId, tenantId)));
    return { ok: true };
  }

  // Semeia a BIBLIOTECA REGEM na WABA da loja: cria (se não existir) e submete cada
  // modelo base. Best-effort por item — um falho não impede os outros. Usado no
  // onboarding (Embedded Signup) e no botão "Reenviar modelos da Regem".
  // Desempenho dos modelos na Meta (Template Analytics API): enviados/entregues/lidos/
  // cliques (por botão) + custo, por período. Traz pro Regem o que hoje só se vê no Meta
  // Business. Best-effort: se a Meta falhar/estiver sem dados, devolve vazio (a UI degrada).
  async templateAnalytics(
    tenantId: string,
    opts: { desde?: string; ate?: string; templateIds?: string[] } = {},
  ): Promise<{ porTemplate: Record<string, any>; periodo: { desde: string; ate: string } }> {
    const hoje = new Date();
    const ate = opts.ate ? new Date(opts.ate) : hoje;
    const desde = opts.desde ? new Date(opts.desde) : new Date(hoje.getTime() - 30 * 86400000);
    const periodo = { desde: desde.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) };
    const vazio = { porTemplate: {} as Record<string, any>, periodo };
    let waba: string;
    try {
      waba = await this.wabaDe(tenantId);
    } catch {
      return vazio;
    }
    // Mapa metaId → nome (só os que já têm metaId, ou seja, foram submetidos).
    const locais = await this.db
      .select({ nome: whatsappTemplate.nome, metaId: whatsappTemplate.metaId })
      .from(whatsappTemplate)
      .where(eq(whatsappTemplate.tenantId, tenantId));
    const nomePorMeta = new Map<string, string>();
    for (const l of locais) if (l.metaId) nomePorMeta.set(String(l.metaId), l.nome);
    let metaIds = (opts.templateIds ?? []).filter(Boolean);
    if (!metaIds.length) metaIds = [...nomePorMeta.keys()];
    metaIds = metaIds.slice(0, 10); // limite da Meta
    if (!metaIds.length) return vazio;
    // Habilita insights na WABA (idempotente, best-effort — exigido antes de consultar).
    await fetch(`${GRAPH}/${waba}?is_enabled_for_insights=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token()}` },
    }).catch(() => null);
    const start = Math.floor(desde.getTime() / 1000);
    const end = Math.floor(ate.getTime() / 1000);
    const ids = encodeURIComponent(JSON.stringify(metaIds));
    const mts = encodeURIComponent(JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED', 'COST']));
    const url = `${GRAPH}/${waba}/template_analytics?start=${start}&end=${end}&granularity=DAILY&template_ids=${ids}&metric_types=${mts}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token()}` } }).catch(() => null);
    if (!res || !res.ok) return vazio;
    const json: any = await res.json().catch(() => ({}));
    const porTemplate: Record<string, any> = {};
    for (const bloco of json?.data ?? []) {
      for (const dp of bloco?.data_points ?? []) {
        const nome = nomePorMeta.get(String(dp.template_id)) ?? String(dp.template_id);
        const acc = porTemplate[nome] ?? { enviados: 0, entregues: 0, lidos: 0, cliques: 0, custo: 0 };
        acc.enviados += Number(dp.sent) || 0;
        acc.entregues += Number(dp.delivered) || 0;
        acc.lidos += Number(dp.read) || 0;
        for (const c of dp.clicked ?? []) acc.cliques += Number(c.count) || 0;
        for (const c of dp.cost ?? []) if (c?.type === 'amount_spent') acc.custo += Number(c.value) || 0;
        porTemplate[nome] = acc;
      }
    }
    return { porTemplate, periodo };
  }

  async seedModelosRegem(tenantId: string) {
    const resultados: any[] = [];
    // Identificação da loja p/ os textos (Configurações → Loja): nome público + cidade.
    const [cfgLoja] = await this.db
      .select({ nomePublico: cardapioConfig.nomePublico, cidade: cardapioConfig.endCidade })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const [emp] = await this.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, tenantId));
    const loja = String(cfgLoja?.nomePublico || emp?.nome || 'nossa loja').trim();
    const cidade = String(cfgLoja?.cidade || '').trim();
    for (const base of CATALOGO_REGEM) {
      try {
        const [ja] = await this.db
          .select({ id: whatsappTemplate.id, status: whatsappTemplate.status })
          .from(whatsappTemplate)
          .where(
            and(eq(whatsappTemplate.tenantId, tenantId), eq(whatsappTemplate.nome, base.nome), eq(whatsappTemplate.idioma, 'pt_BR')),
          );
        // Já existe (QUALQUER status, inclusive REJEITADO) → NÃO reenvia. Reenviar um
        // rejeitado idêntico só toma outra reprovação; o reenvio de um rejeitado é MANUAL
        // por modelo (o lojista edita e clica "enviar p/ aprovação"). O seed só CRIA os
        // que ainda não existem → é seguro clicar/rodar de novo (não duplica nem reenvia).
        if (ja) {
          resultados.push({ nome: base.nome, status: ja.status, pulado: true });
          continue;
        }
        const [row] = await this.db
          .insert(whatsappTemplate)
          .values({
            tenantId,
            nome: base.nome,
            categoria: 'MARKETING',
            idioma: 'pt_BR',
            cabecalho: identificarLoja(base.cabecalho, loja, cidade),
            corpo: identificarLoja(base.corpo, loja, cidade),
            botoes: base.botoes,
            formato: 'padrao',
            status: 'rascunho',
          })
          .returning();
        await this.submeterTemplate(tenantId, row.id);
        resultados.push({ nome: base.nome, status: 'pendente', novo: true });
      } catch (e: any) {
        resultados.push({ nome: base.nome, erro: String(e?.message ?? e).slice(0, 160) });
      }
    }
    return { total: CATALOGO_REGEM.length, resultados };
  }

  // Semeia a biblioteca de UTILIDADE (avisos de status) na WABA do PRINCIPAL. Mesma
  // disciplina do seed de marketing: cria só o que não existe (idempotente, seguro
  // rodar de novo) e submete cada um. Chamado quando o PRINCIPAL conecta na API oficial.
  async seedUtilidade(tenantId: string) {
    const resultados: any[] = [];
    const [cfgLoja] = await this.db
      .select({ nomePublico: cardapioConfig.nomePublico, cidade: cardapioConfig.endCidade })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const [emp] = await this.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, tenantId));
    const loja = String(cfgLoja?.nomePublico || emp?.nome || 'nossa loja').trim();
    const cidade = String(cfgLoja?.cidade || '').trim();
    for (const base of CATALOGO_UTILIDADE) {
      try {
        const [ja] = await this.db
          .select({ id: whatsappTemplate.id, status: whatsappTemplate.status })
          .from(whatsappTemplate)
          .where(
            and(eq(whatsappTemplate.tenantId, tenantId), eq(whatsappTemplate.nome, base.nome), eq(whatsappTemplate.idioma, 'pt_BR')),
          );
        if (ja) {
          resultados.push({ nome: base.nome, status: ja.status, pulado: true });
          continue;
        }
        const [row] = await this.db
          .insert(whatsappTemplate)
          .values({
            tenantId,
            nome: base.nome,
            categoria: 'UTILITY',
            idioma: 'pt_BR',
            evento: base.evento,
            cabecalho: identificarLoja(base.cabecalho, loja, cidade),
            corpo: identificarLoja(base.corpo, loja, cidade),
            botoes: base.botoes.length ? base.botoes : null,
            formato: 'padrao',
            status: 'rascunho',
          })
          .returning();
        await this.submeterTemplate(tenantId, row.id);
        resultados.push({ nome: base.nome, status: 'pendente', novo: true });
      } catch (e: any) {
        resultados.push({ nome: base.nome, erro: String(e?.message ?? e).slice(0, 160) });
      }
    }
    return { total: CATALOGO_UTILIDADE.length, resultados };
  }

  // App ID + Configuration ID do Embedded Signup (do env) para o front montar o popup.
  // Não são segredos (aparecem no JS do cliente de qualquer forma).
  embeddedConfig() {
    return {
      appId: process.env.WA_CLOUD_APP_ID ?? '',
      configId: process.env.WA_CLOUD_CONFIG_ID ?? '',
      graphVersion: 'v25.0',
    };
  }

  // ===== Retenção do histórico de conversas (item 11, mig 234) =====
  // wa_retencao_dias: 0/null = manter tudo; N = manter só os últimos N dias.
  async historicoConfig(tenantId: string) {
    const [cfg] = await this.db
      .select({ retencaoDias: cardapioConfig.waRetencaoDias })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId))
      .limit(1);
    return { retencaoDias: Number(cfg?.retencaoDias) || 0 };
  }

  async salvarHistoricoConfig(tenantId: string, retencaoDias: number) {
    const v = Math.max(0, Math.floor(Number(retencaoDias) || 0));
    await this.db
      .update(cardapioConfig)
      .set({ waRetencaoDias: v || null, updatedAt: new Date() })
      .where(eq(cardapioConfig.tenantId, tenantId));
    return { ok: true, retencaoDias: v };
  }

  // Expurgo do histórico Cloud conforme a retenção de cada loja (só nuvem). A cada 6h
  // apaga whatsapp_mensagem além do prazo (wa_retencao_dias > 0). Best-effort.
  @Interval(6 * 60 * 60 * 1000)
  async expurgarHistorico() {
    if (process.env.EDGE_MODE === '1') return;
    try {
      await this.db.execute(sql`
        delete from whatsapp_mensagem m
        using cardapio_config c
        where c.tenant_id = m.tenant_id
          and coalesce(c.wa_retencao_dias, 0) > 0
          and m.criado_em < now() - (c.wa_retencao_dias || ' days')::interval`);
    } catch {
      /* expurgo best-effort */
    }
  }

  // ===== Embedded Signup (Fase 3 frente 2) — cada loja conecta o PRÓPRIO WABA =====
  // O popup da Meta devolve (no front) o `code` + o phone_number_id + o WABA da loja.
  // Aqui a gente: (1) troca o code por token (confirma o vínculo), (2) assina nosso app
  // na WABA da loja (p/ os webhooks fluírem), (3) grava phone_id/WABA no modelo. A
  // COBRANÇA fica na conta do próprio lojista (ele cadastra o meio de pagamento no fluxo).
  // Coexistência: o número já está registrado (roda no app WhatsApp Business do lojista),
  // então o evento devolve só o WABA — buscamos o phone_number_id na própria conta.
  private async primeiroPhoneIdDaWaba(wabaId: string): Promise<string> {
    const res = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${this.token()}` },
    }).catch(() => null);
    if (!res || !res.ok) return '';
    const j: any = await res.json().catch(() => ({}));
    return String(j?.data?.[0]?.id ?? '').trim();
  }

  async finalizarEmbeddedSignup(
    tenantId: string,
    dto: { code?: string; phoneNumberId?: string; wabaId?: string; papel?: string; coexistence?: boolean },
  ) {
    const papel = dto.papel === 'marketing' ? 'marketing' : 'principal';
    let phoneId = String(dto.phoneNumberId ?? '').trim();
    const wabaId = String(dto.wabaId ?? '').trim();
    if (!wabaId)
      throw new BadRequestException('O cadastro não concluiu (faltou a conta WABA).');
    // No fluxo de COEXISTÊNCIA o evento não traz o phone_number_id — resolve pela WABA.
    if (!phoneId) {
      phoneId = await this.primeiroPhoneIdDaWaba(wabaId);
      if (!phoneId)
        throw new BadRequestException('O cadastro não concluiu (não encontrei o número na conta WABA).');
    }

    // 1) Troca o code por token — confirma o vínculo. best-effort (não bloqueia).
    const appId = process.env.WA_CLOUD_APP_ID ?? '';
    const appSecret = process.env.WA_CLOUD_APP_SECRET ?? '';
    if (dto.code && appId && appSecret) {
      await fetch(
        `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(dto.code)}`,
      ).catch(() => null);
    }

    // 2) Assina o nosso app na WABA da loja (System User token) — sem isso os webhooks
    // da loja não chegam na nossa URL de callback.
    await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token()}` },
    }).catch(() => null);

    // 3) Número de exibição (best-effort).
    let numero: string | null = null;
    try {
      const v: any = await this.verificarNumero(phoneId);
      numero = v?.numero ?? null;
    } catch {
      /* segue sem o número de exibição */
    }

    // 4) Grava no modelo (papel/cloud). No PRINCIPAL espelha em cardapio_config (webhook/
    // envio legado leem de lá) e semeia a biblioteca. No MARKETING grava só a linha do
    // papel (não mexe no provedor da loja nem no atendimento).
    const [ex] = await this.db
      .select({ id: whatsappNumero.id })
      .from(whatsappNumero)
      .where(
        and(eq(whatsappNumero.tenantId, tenantId), eq(whatsappNumero.papel, papel), isNull(whatsappNumero.unidadeId)),
      );
    const patch: any = { provedor: 'cloud', phoneId, wabaId, numero, status: 'conectado', atualizadoEm: new Date() };
    if (ex) await this.db.update(whatsappNumero).set(patch).where(eq(whatsappNumero.id, ex.id));
    else await this.db.insert(whatsappNumero).values({ tenantId, papel, ...patch });

    if (papel === 'principal') {
      const [cfg] = await this.db.select().from(cardapioConfig).where(eq(cardapioConfig.tenantId, tenantId));
      if (cfg)
        await this.db
          .update(cardapioConfig)
          .set({ provedor: 'cloud', waCloudPhoneId: phoneId, waCloudWabaId: wabaId, waCloudNumero: numero, updatedAt: new Date() })
          .where(eq(cardapioConfig.id, cfg.id));
    }
    // Semeia a biblioteca certa na WABA recém-conectada, conforme o papel: MARKETING →
    // catálogo de ofertas; PRINCIPAL → catálogo de UTILIDADE (avisos de status do pedido).
    // Idempotente + 2º plano (não bloqueia o retorno do onboarding).
    if (papel === 'principal') void this.seedUtilidade(tenantId).catch(() => {});
    else void this.seedModelosRegem(tenantId).catch(() => {});

    return { ok: true, papel, phoneNumberId: phoneId, wabaId, numero, coexistence: !!dto.coexistence };
  }

  // ===== Conferencia do numero antes de vincular (Fase 3) =====
  // Sem isto, um Phone Number ID digitado errado e aceito em silencio e a loja so
  // descobre quando a primeira mensagem nao chega. Aqui o gestor VE de qual numero
  // se trata antes de confirmar.
  //
  // Nao exige que a loja ja esteja vinculada — e justamente a checagem que antecede
  // o vinculo. So precisa que o nosso token alcance aquele numero, o que vale para a
  // nossa WABA hoje e para a do lojista depois do cadastro incorporado.
  async verificarNumero(phoneNumberId: string) {
    const id = String(phoneNumberId ?? '').trim();
    if (!/^[0-9]{5,32}$/.test(id))
      throw new BadRequestException('Identificação do número (Phone Number ID) inválida.');

    const campos = 'display_phone_number,verified_name,quality_rating,code_verification_status';
    const res = await fetch(`${GRAPH}/${id}?fields=${campos}`, {
      headers: { Authorization: `Bearer ${this.token()}` },
    }).catch(() => null);
    if (!res || !res.ok) {
      const corpo = res ? await res.text().catch(() => '') : '';
      throw new BadRequestException(
        `Não consegui conferir esse número na Meta (${res?.status ?? 'sem resposta'}): ${corpo.slice(0, 180)}`,
      );
    }
    const j: any = await res.json().catch(() => ({}));

    // Se ja pertence a OUTRA loja, avisa aqui — o indice unico da mig 214 barraria
    // depois, mas com um erro de banco em vez de uma frase util.
    const donos = await this.db
      .select({ tenantId: cardapioConfig.tenantId, nome: cardapioConfig.nomePublico })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.waCloudPhoneId, id));

    return {
      phoneNumberId: id,
      numero: j?.display_phone_number ?? null,
      nomeExibicao: j?.verified_name ?? null,
      qualidade: j?.quality_rating ?? null,
      verificado: j?.code_verification_status === 'VERIFIED',
      jaVinculadoA: donos[0]?.nome ?? null,
    };
  }
}

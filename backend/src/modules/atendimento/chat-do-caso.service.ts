import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PonteChatService } from '../ponte-chat/ponte-chat.service';
import { TEXTO_MAX, temContatoProibido } from '../ponte-chat/texto-do-chat';
import { ehCanalDaPonte } from '../ponte-chat/lideranca';
import { chaveSql } from '../ponte-chat/casos-do-chat';
import { WhatsappProvedorService } from '../whatsapp/whatsapp-provedor.service';
import { pausarPeloAtendente } from '../whatsapp/robo-pausa';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { podeAcessar } from '../../auth/permissoes';
// O alerta do Pix do adicional (mig 373): só a leitura da tabela — o Atendimento não importa o módulo do cardápio.
import { type AlertaDoAdicional, alertasDoAdicionalPix } from '../cardapio/adicional-pix-alertas';
// O Direct do Instagram em "Conversas agora" (mig 378): só a leitura das mensagens e o caso do Direct.
import { DESCRICAO_DO_TIPO, chaveDoCliente, idDaChave, nomeDoCliente } from '../instagram/instagram';
import { QUEM_RESPONDE } from '../instagram/instagram.service';
// O Messenger do Facebook em "Conversas agora" e no "Assumir" (mig 386): pelo serviço do Messenger (opcional).
import { MessengerService } from '../messenger/messenger.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD E DA 99 DENTRO DO CASO (ponte do chat, Etapa 2 — protótipo `mockups/regem-central-atendimento.html` v3,
// bloco "Chat do iFood com …"): a conversa do pedido, nas duas direções, e a resposta da equipe, que entra na FILA DE
// SAÍDA da ponte (`chat_plataforma_msg`, mig 366) — a ponte do PC da loja digita no chat da plataforma. Vale no caso
// "Mensagem no chat" e também na disputa do iFood e no pedido da 99 (o chat do mesmo pedido).
// As mensagens moram só na NUVEM (mig 366 @cloud-only): no servidor da loja, ler e responder vão à nuvem pelo token do
// servidor (V37) — "não li" aparece diferente de "vazio".

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quem vê (e assume) as conversas do WHATSAPP em "Conversas agora": quem atende a caixa de conversas do WhatsApp —
 * presidente, ou gerente/supervisão com a permissão `bot` (as mesmas travas de `WhatsappCaixaController`).
 */
export function veOWhatsapp(u: { categoria?: string | null; permissoes?: any } | null | undefined): boolean {
  if (!u) return false;
  if (u.categoria === 'presidente') return true;
  return (u.categoria === 'gerente' || u.categoria === 'supervisao') && podeAcessar(u.permissoes, 'bot');
}
const CHAVE_DO_WHATSAPP = /^tel:\d{8,15}$/;
const mascararTelefone = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');
/** Quem vê e assume o Direct do Instagram em "Conversas agora": quem responde no Direct (a gestão — instagram.service). */
export function veODirect(u: { categoria?: string | null } | null | undefined): boolean {
  return !!u?.categoria && (QUEM_RESPONDE as readonly string[]).includes(u.categoria);
}
const LIMITE_DA_CONVERSA = 100;
const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

export type MensagemDoChat = {
  id: string;
  direcao: 'entrada' | 'saida';
  autor: 'cliente' | 'loja' | 'robo' | 'equipe' | 'aviso';
  texto: string;
  estado: string;
  erro: string | null;
  motivo: string | null;
  quem: string | null;
  em: string;
  enviadoEm: string | null;
  /** A fala do ATENDENTE VIRTUAL (F5, mig 383): a tela oferece "Corrigir" só nela. */
  roboIa: boolean;
};

export type ConversaDoChat = {
  /** Este caso tem chat de plataforma (iFood/99 com o pedido)? */
  disponivel: boolean;
  canal: 'ifood' | '99food' | null;
  /** A ponte está ligada nos ajustes da empresa e algum PC responde pelo canal agora (o envio sai na hora). */
  ponte: { ligada: boolean; responde: boolean };
  mensagens: MensagemDoChat[];
};

type Caso = {
  id: string;
  status: string;
  canal: 'ifood' | '99food' | null;
  unidadeId: string | null;
  pedidoId: string | null;
  pedidoExterno: string | null;
  pedidoNumero: string | null;
  cliente: string | null;
};

@Injectable()
export class ChatDoCasoService {
  private readonly logger = new Logger('ChatDoCaso');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly ponte: PonteChatService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // As conversas do WhatsApp (Evolution ou API oficial) para "Conversas agora". Opcional: os testes montam sem ele.
    @Optional() private readonly whatsapp?: WhatsappProvedorService,
    // O Messenger do Facebook (mig 386) em "Conversas agora" e no "Assumir". Opcional: os testes montam sem ele.
    @Optional() private readonly messenger?: MessengerService,
  ) {}

  /** O caso e o pedido dele na plataforma (o id do canal do chat; sem ele, o número). 404 se não é da empresa. */
  private async caso(tenantId: string, id: string): Promise<Caso> {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const [c] = linhas(
      await this.db.execute(sql`
        select c.id, c.status, coalesce(c.canal, p.canal) as canal, c.unidade_id as "unidadeId", c.pedido_id as "pedidoId",
               coalesce(c.detalhe #>> '{chat,pedidoExterno}', p.external_id) as "pedidoExterno",
               coalesce(c.detalhe #>> '{chat,pedidoNumero}', p.display_id, c.pedido_numero) as "pedidoNumero",
               coalesce(c.cliente, p.cliente_nome) as cliente
          from atendimento_chamado c
          left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
         where c.tenant_id = ${tenantId}::uuid and c.id = ${id}::uuid`),
    );
    if (!c) throw new NotFoundException('Caso não encontrado.');
    return { ...c, canal: ehCanalDaPonte(c.canal) ? c.canal : null };
  }

  /** O caso tem conversa de plataforma: iFood ou 99, ligado a um pedido (pelo id, pelo id na plataforma ou pelo número). */
  private temChat(c: Caso): boolean {
    return !!c.canal && !!(c.pedidoId || c.pedidoExterno || c.pedidoNumero);
  }

  // ───────────────────────── a conversa ─────────────────────────

  async conversa(user: AuthUser, id: string): Promise<ConversaDoChat> {
    if (ehServidorLocal()) return this.pelaNuvem('GET', `chat-da-loja?chamado=${encodeURIComponent(String(id ?? ''))}`);
    return this.conversaDaEmpresa(user.tenantId, id);
  }

  /** Na nuvem: as mensagens do pedido (as últimas 100, em ordem), quem da equipe escreveu e a situação da ponte. */
  async conversaDaEmpresa(tenantId: string, id: string): Promise<ConversaDoChat> {
    const c = await this.caso(tenantId, id);
    if (!this.temChat(c)) return { disponivel: false, canal: c.canal, ponte: { ligada: false, responde: false }, mensagens: [] };
    const [ligada, responde, msgs] = await Promise.all([
      this.ponte.ligada(tenantId),
      this.ponte.quemRespondePeloCanal(tenantId, c.unidadeId, c.canal as 'ifood' | '99food').then((x) => !!x),
      this.db.execute(sql`
        select m.id, m.direcao, m.autor, m.texto, m.estado, m.erro, m.motivo, col.nome as quem,
               m.criado_em as em, m.enviado_em as "enviadoEm",
               -- a fala do atendente virtual (mig 383) pelo to_jsonb: num banco sem a 383 a conversa não cai (nenhuma é)
               coalesce((to_jsonb(m) ->> 'robo_ia')::boolean, false) as "roboIa"
          from chat_plataforma_msg m
          left join colaborador col on col.id = m.autor_id and col.tenant_id = m.tenant_id
         where m.tenant_id = ${tenantId}::uuid and m.canal = ${c.canal}
           and ((${c.pedidoId}::uuid is not null and m.pedido_id = ${c.pedidoId}::uuid)
             or (${c.pedidoExterno}::text is not null and m.pedido_externo = ${c.pedidoExterno}::text)
             or (${c.pedidoId}::uuid is null and ${c.pedidoExterno}::text is null and m.pedido_numero = ${c.pedidoNumero}::text))
         order by m.criado_em desc, m.id desc
         limit ${LIMITE_DA_CONVERSA}`),
    ]);
    return { disponivel: true, canal: c.canal, ponte: { ligada, responde }, mensagens: linhas(msgs).reverse() };
  }

  // ───────────────────────── a resposta da equipe ─────────────────────────

  async responder(user: AuthUser, id: string, dto: { texto?: unknown } | null | undefined) {
    if (ehServidorLocal()) {
      const r = await this.pelaNuvem('POST', 'chat-da-loja', {
        chamadoId: id,
        texto: dto?.texto,
        atorId: user.colaboradorId ?? null,
        atorPerfil: user.categoria,
      });
      // O caso já é de quem respondeu aqui também (a nuvem fez o mesmo; o sincronismo traz em seguida).
      if (user.colaboradorId && UUID_RE.test(String(id)))
        await this.db.execute(sql`
          update atendimento_chamado set responsavel_id = ${user.colaboradorId}::uuid, pego_em = now()
           where tenant_id = ${user.tenantId}::uuid and id = ${id}::uuid and status = 'aberto' and responsavel_id is null`);
      this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id, motivo: 'respondeu_no_chat' });
      return r;
    }
    return this.responderNaEmpresa(user.tenantId, id, dto?.texto, { id: user.colaboradorId ?? null, perfil: user.categoria }, 'web');
  }

  /** A resposta que veio do servidor da loja (quem respondeu já foi conferido lá; aqui só se é da empresa). */
  async responderVindoDaLoja(tenantId: string, dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown; atorPerfil?: unknown }) {
    let atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    if (atorId) {
      const ok = linhas(await this.db.execute(sql`select 1 from colaborador where id = ${atorId}::uuid and tenant_id = ${tenantId}::uuid`));
      if (!ok.length) atorId = null;
    }
    const perfil = typeof dto?.atorPerfil === 'string' ? dto.atorPerfil.slice(0, 20) : 'execucao';
    return this.responderNaEmpresa(tenantId, String(dto?.chamadoId ?? ''), dto?.texto, { id: atorId, perfil }, 'servidor_loja');
  }

  /**
   * Na nuvem: a mensagem da equipe entra na fila de saída da ponte ("pendente"; a ponte que responde pelo canal pega e
   * digita no chat). Toda recusa vem ANTES de gravar (V86): texto vazio ou longo, contato proibido (telefone, WhatsApp,
   * Instagram, link — regra da plataforma), caso sem chat, caso resolvido, ponte desligada. Responder pega o caso para
   * quem respondeu, se ninguém tinha (como no WhatsApp). A auditoria guarda quem, o canal e o tamanho — não o texto.
   */
  async responderNaEmpresa(
    tenantId: string,
    id: string,
    textoBruto: unknown,
    ator: { id: string | null; perfil: string },
    origem: 'web' | 'servidor_loja',
  ) {
    const texto = typeof textoBruto === 'string' ? textoBruto.trim() : '';
    if (!texto) throw new BadRequestException('Escreva a mensagem.');
    if (texto.length > TEXTO_MAX) throw new BadRequestException(`No chat da plataforma cabem até ${TEXTO_MAX} letras.`);
    const c = await this.caso(tenantId, id);
    if (!this.temChat(c)) throw new BadRequestException('Este caso não tem chat do iFood nem da 99.');
    const plataforma = c.canal === 'ifood' ? 'O iFood' : 'A 99';
    if (temContatoProibido(texto))
      throw new BadRequestException(`${plataforma} proíbe telefone, WhatsApp, Instagram e link no chat. Tire isso da mensagem para enviar.`);
    if (c.status !== 'aberto') throw new ConflictException('Este caso já foi resolvido.');
    if (!(await this.ponte.ligada(tenantId)))
      throw new ConflictException(
        `A ponte do chat está desligada. Responda pelo ${c.canal === 'ifood' ? 'Gestor de Pedidos do iFood' : 'portal da 99'}.`,
      );
    const msg = await this.db.transaction(async (tx) => {
      const [m] = linhas(
        await tx.execute(sql`
          insert into chat_plataforma_msg
            (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, autor_id, texto, estado)
          values (${tenantId}::uuid, ${c.unidadeId}::uuid, ${c.canal}, ${c.pedidoId}::uuid, ${c.pedidoExterno}, ${c.pedidoNumero},
                  ${c.cliente}, 'saida', 'equipe', ${ator.id}::uuid, ${texto}, 'pendente')
          returning id, criado_em as "criadoEm"`),
      );
      if (ator.id)
        await tx.execute(sql`
          update atendimento_chamado set responsavel_id = ${ator.id}::uuid, pego_em = now()
           where tenant_id = ${tenantId}::uuid and id = ${c.id}::uuid and status = 'aberto' and responsavel_id is null`);
      return m;
    });
    await this.auditoria
      ?.registrar({
        tenantId,
        unidadeId: c.unidadeId,
        atorId: ator.id,
        atorPerfil: ator.perfil,
        tipo: 'atendimento',
        acao: 'respondeu_no_chat_da_plataforma',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: c.id,
        detalhe: { canal: c.canal, mensagemId: msg.id, letras: texto.length },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria da resposta no chat (caso ${c.id}): ${e?.message ?? e}`));
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_no_chat' });
    return { ok: true, id: msg.id, estado: 'pendente', criadoEm: msg.criadoEm };
  }

  // ───────────────────────── Conversas agora ─────────────────────────

  /**
   * "CONVERSAS AGORA" (protótipo v3): as conversas do chat do iFood e da 99 com movimento na ÚLTIMA HORA e SEM caso aberto
   * — quem está nelas é o robô (ou só os avisos automáticos). Da loja em uso (e as sem loja). Cada uma com o cliente, o
   * pedido e as últimas 8 mensagens; e se o robô do chat está ligado (a tela diz "com o robô" só quando está). Só na
   * nuvem: as mensagens moram lá.
   *
   * E as do WHATSAPP (protótipo v3: "dos três canais"), para quem atende a caixa do WhatsApp (`veOWhatsapp`) e com o robô
   * do WhatsApp ligado: as conversas da última hora em que o robô está — sem pausa (ninguém assumiu) e sem caso aberto
   * do número (a MESMA regra de "robô calado" da caixa: `robo-pausa.ts`). Pela via da loja (Evolution ou API oficial),
   * como a caixa; as mensagens a tela pede ao abrir (a rota da caixa). `whatsapp.lida = false` = não deu para ler.
   */
  async conversasAgora(tenantId: string, unidade: string | null, quem?: { categoria?: string | null; permissoes?: any }) {
    // No servidor da loja as mensagens não existem: a nuvem responde, com quem está na tela de lá (V37).
    if (ehServidorLocal()) {
      const q = new URLSearchParams();
      if (unidade && UUID_RE.test(unidade)) q.set('unidade', unidade);
      if (quem?.categoria) q.set('categoria', String(quem.categoria));
      q.set('bot', String(podeAcessar(quem?.permissoes, 'bot')));
      return this.pelaNuvem('GET', `conversas-da-loja?${q.toString()}`);
    }
    // O Messenger (mig 386): quem vê o Direct (a gestão) vê o Messenger — `messenger.lida = false` = não deu para ler.
    const [conversas, robo, whatsapp, direct, messenger] = await Promise.all([
      this.db.execute(this.sqlDasConversasAgora(tenantId, unidade)),
      this.db.execute(sql`select chat_robo_responde from robo_config where tenant_id = ${tenantId}::uuid`),
      veOWhatsapp(quem) ? this.conversasDoWhatsapp(tenantId) : Promise.resolve(null),
      veODirect(quem) ? this.conversasDoDirect(tenantId) : Promise.resolve(null),
      veODirect(quem) && this.messenger ? this.messenger.conversasAgora(tenantId) : Promise.resolve(null),
    ]);
    const roboResponde = linhas(robo)[0]?.chat_robo_responde === true;
    const todas = [
      ...linhas(conversas).map((c) => ({ ...c, comRobo: roboResponde })),
      ...(whatsapp?.conversas ?? []),
      ...(direct?.conversas ?? []),
      ...(messenger?.conversas ?? []),
    ];
    todas.sort((a, b) => new Date(b.ultima).getTime() - new Date(a.ultima).getTime());
    return {
      conversas: todas,
      roboResponde,
      whatsapp: whatsapp ? { ligado: whatsapp.ligado, lida: whatsapp.lida } : null,
      instagram: direct ? { ligado: direct.ligado, lida: direct.lida } : null,
      messenger: messenger ? { ligado: messenger.ligado, lida: messenger.lida } : null,
    };
  }

  /**
   * O DIRECT do Instagram com o robô agora (mig 378; protótipo v8): com o robô do Direct ligado, as conversas com
   * mensagem na última hora e SEM caso aberto — o robô está nelas. Com as últimas 8 mensagens (moram aqui, na nuvem) e o
   * perfil do cliente (nome e @). Da empresa (o Instagram é da empresa, não de uma loja).
   * NUNCA derruba "Conversas agora" (os outros canais seguem): sem a tabela só da nuvem (377) ou sem a coluna da 378 neste
   * banco, o Direct não está ligado; outra falha vem como "não li" (`lida: false` — V37), nunca como "nenhuma" (ERR-393).
   */
  private async conversasDoDirect(tenantId: string): Promise<{ ligado: boolean; lida: boolean; conversas: any[] }> {
    try {
      return await this.lerConversasDoDirect(tenantId);
    } catch (e: any) {
      if (e?.code === '42P01' || e?.code === '42703') return { ligado: false, lida: true, conversas: [] };
      this.logger.warn(`o Direct em "Conversas agora" (empresa ${tenantId}): ${e?.message ?? e}`);
      return { ligado: true, lida: false, conversas: [] };
    }
  }

  private async lerConversasDoDirect(tenantId: string): Promise<{ ligado: boolean; lida: boolean; conversas: any[] }> {
    const [conta] = linhas(await this.db.execute(sql`select robo_responde from instagram_conta where tenant_id = ${tenantId}::uuid`));
    if (conta?.robo_responde !== true) return { ligado: false, lida: true, conversas: [] };
    const r = linhas(
      await this.db.execute(sql`
        with ativas as (
          select m.igsid, max(m.criado_em) as ultima
            from instagram_mensagem m
           where m.tenant_id = ${tenantId}::uuid and m.criado_em > now() - interval '60 minutes'
             and not exists (select 1 from atendimento_chamado a
                              where a.tenant_id = ${tenantId}::uuid and a.tipo = 'instagram' and a.status = 'aberto'
                                and a.detalhe #>> '{instagram,igsid}' = m.igsid)
           group by m.igsid
           order by 2 desc
           limit 50
        )
        select a.igsid, a.ultima, ct.nome, ct.usuario, ct.segue_a_loja as segue,
               (select jsonb_agg(jsonb_build_object('id', x.id, 'direcao', x.direcao, 'autor', x.autor, 'texto', x.texto, 'tipo', x.tipo,
                                                    'estado', x.estado, 'motivo', null, 'em', x.criado_em) order by x.criado_em, x.id)
                  from (select y.* from instagram_mensagem y
                         where y.tenant_id = ${tenantId}::uuid and y.igsid = a.igsid and y.estado <> 'apagada'
                         order by y.criado_em desc, y.id desc limit 8) x) as mensagens
          from ativas a
          left join instagram_contato ct on ct.tenant_id = ${tenantId}::uuid and ct.igsid = a.igsid
         order by a.ultima desc`),
    );
    const conversas = r.map((c) => ({
      canal: 'instagram',
      chave: chaveDoCliente(String(c.igsid)),
      ultima: new Date(c.ultima).toISOString(),
      cliente: c.nome || c.usuario ? nomeDoCliente({ nome: c.nome, usuario: c.usuario }) : null,
      usuario: c.usuario ? `@${String(c.usuario).replace(/^@/, '')}` : null,
      segue: c.segue === true ? true : c.segue === false ? false : null,
      pedidoId: null,
      pedidoNumero: null,
      pedidoStatus: null,
      mensagens: (Array.isArray(c.mensagens) ? c.mensagens : []).map(({ tipo, ...m }: any) => ({ ...m, texto: String(m?.texto || (DESCRICAO_DO_TIPO as any)[tipo] || '') })),
      comRobo: true,
    }));
    return { ligado: true, lida: true, conversas };
  }

  /** As conversas do WhatsApp com o robô agora (última hora, sem pausa e sem caso aberto), pela via da loja. */
  private async conversasDoWhatsapp(tenantId: string): Promise<{ ligado: boolean; lida: boolean; conversas: any[] }> {
    if (!this.whatsapp) return { ligado: false, lida: true, conversas: [] };
    const [cfg] = linhas(
      await this.db.execute(sql`
        select coalesce(bool_or(robo_ativo and ativo), false) as ligado from cardapio_config where tenant_id = ${tenantId}::uuid`),
    );
    if (cfg?.ligado !== true) return { ligado: false, lida: true, conversas: [] };
    let lista: any[];
    try {
      lista = await this.whatsapp.conversas(tenantId);
    } catch (e: any) {
      this.logger.warn(`conversas do WhatsApp para "Conversas agora" (empresa ${tenantId}): ${e?.message ?? e}`);
      return { ligado: true, lida: false, conversas: [] };
    }
    const desde = Date.now() / 1000 - 3600;
    const conversas = (Array.isArray(lista) ? lista : [])
      .filter((c) => {
        const tel = String(c?.telefone ?? '').replace(/\D/g, '');
        return tel.length >= 8 && Number(c?.timestamp) >= desde && c?.pausada !== true && !c?.chamado;
      })
      .slice(0, 50)
      .map((c) => {
        const tel = String(c.telefone).replace(/\D/g, '').slice(0, 15);
        const nome = typeof c.nome === 'string' && c.nome.trim() ? c.nome.trim().slice(0, 120) : null;
        return {
          canal: 'whatsapp',
          chave: `tel:${tel}`,
          ultima: new Date(Number(c.timestamp) * 1000).toISOString(),
          cliente: nome,
          telefone: tel,
          jids: (Array.isArray(c.jids) && c.jids.length ? c.jids : [tel]).map(String).slice(0, 5),
          ultimaMensagem: typeof c.ultimaMensagem === 'string' ? c.ultimaMensagem.slice(0, 300) : null,
          pedidoId: null,
          pedidoNumero: null,
          pedidoStatus: null,
          mensagens: [],
          comRobo: true,
        };
      });
    return { ligado: true, lida: true, conversas };
  }

  /**
   * A consulta das "Conversas agora" (à parte para o teste do plano). UMA leitura das mensagens do último dia da empresa
   * (índice da 367: roda a cada 15 s com a tela aberta, nunca o histórico inteiro); a conversa é achada pela MESMA chave
   * dos casos (`chaveSql` = `chaveDaConversa`); as conversas com caso aberto ficam de fora ANTES de juntar as mensagens.
   */
  sqlDasConversasAgora(tenantId: string, unidade: string | null) {
    return sql`
      with dia as (
        select m.id, m.canal, m.direcao, m.autor, m.texto, m.estado, m.motivo, m.criado_em, m.cliente_nome, m.pedido_id,
               m.pedido_numero, ${chaveSql('m')} as chave
          from chat_plataforma_msg m
         where m.tenant_id = ${tenantId}::uuid and m.criado_em > now() - interval '1 day'
           and (${unidade}::uuid is null or m.unidade_id is null or m.unidade_id = ${unidade}::uuid)
      ), ativas as (
        select g.*
          from (select canal, chave, max(criado_em) as ultima,
                       (array_agg(cliente_nome order by criado_em desc) filter (where cliente_nome is not null))[1] as cliente,
                       (array_agg(pedido_id order by criado_em desc) filter (where pedido_id is not null))[1] as pedido_id,
                       (array_agg(pedido_numero order by criado_em desc) filter (where pedido_numero is not null))[1] as pedido_numero
                  from dia where chave is not null
                 group by canal, chave) g
         where g.ultima > now() - interval '60 minutes'
           and not exists (select 1 from atendimento_chamado c
                            where c.tenant_id = ${tenantId}::uuid and c.tipo = 'chat' and c.status = 'aberto'
                              and c.canal = g.canal and c.detalhe #>> '{chat,chave}' = g.chave)
         order by g.ultima desc
         limit 50
      ), ultimas as (
        select x.canal, x.chave,
               jsonb_agg(jsonb_build_object('id', x.id, 'direcao', x.direcao, 'autor', x.autor, 'texto', x.texto,
                                            'estado', x.estado, 'motivo', x.motivo, 'em', x.criado_em)
                         order by x.criado_em, x.id) as mensagens
          from (select d.*, row_number() over (partition by d.canal, d.chave order by d.criado_em desc, d.id desc) as n
                  from dia d join ativas a on a.canal = d.canal and a.chave = d.chave) x
         where x.n <= 8
         group by x.canal, x.chave
      )
      select a.canal, a.chave, a.ultima, a.cliente, a.pedido_id as "pedidoId",
             coalesce(pe.display_id, a.pedido_numero) as "pedidoNumero", pe.status as "pedidoStatus", u.mensagens
        from ativas a
        join ultimas u on u.canal = a.canal and u.chave = a.chave
        left join pedido_externo pe on pe.id = a.pedido_id and pe.tenant_id = ${tenantId}::uuid
       order by a.ultima desc`;
  }

  /**
   * "ASSUMIR A CONVERSA": o caso "Mensagem no chat" nasce JÁ com quem assumiu (o robô fica quieto com o caso aberto). Com a
   * trava da empresa (a mesma dos casos do chat): se a conversa já tem caso aberto — sem ninguém, ele fica com quem
   * assumiu; com outra pessoa, 409 com o nome.
   */
  async assumir(
    user: AuthUser,
    dto: { canal?: unknown; chave?: unknown; nome?: unknown } | null | undefined,
    origem: 'web' | 'servidor_loja' = 'web',
  ) {
    const eu = user.colaboradorId;
    if (!eu) throw new ForbiddenException('Entre com o seu usuário para assumir a conversa.');
    // No servidor da loja: a nuvem assume, com quem assumiu e a permissão dele conferidos aqui (V37).
    if (ehServidorLocal())
      return this.pelaNuvem('POST', 'conversas-da-loja/assumir', {
        canal: dto?.canal,
        chave: dto?.chave,
        nome: dto?.nome,
        atorId: eu,
        atorPerfil: user.categoria,
        bot: podeAcessar(user.permissoes, 'bot'),
      });
    const canal = dto?.canal;
    const chave = typeof dto?.chave === 'string' ? dto.chave : '';
    if (canal === 'whatsapp') return this.assumirNoWhatsapp(user, eu, chave, dto?.nome, origem);
    if (canal === 'instagram') return this.assumirNoDirect(user, eu, chave, origem);
    // O Messenger do Facebook (mig 386): quem responde no Messenger (a gestão), na trava da página — `MessengerService.assumir`.
    if (canal === 'messenger') {
      if (!this.messenger) throw new NotFoundException('A página do Facebook da loja não está conectada.');
      return this.messenger.assumir(user, eu, chave, origem);
    }
    if (!ehCanalDaPonte(canal) || !/^(ext|id|num):.{1,120}$/.test(chave)) throw new BadRequestException('Conversa inválida.');
    const r = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from robo_config where tenant_id = ${user.tenantId}::uuid for update`);
      const [aberto] = linhas(
        await tx.execute(sql`
          select c.id, c.responsavel_id, col.nome from atendimento_chamado c
            left join colaborador col on col.id = c.responsavel_id and col.tenant_id = c.tenant_id
           where c.tenant_id = ${user.tenantId}::uuid and c.tipo = 'chat' and c.status = 'aberto'
             and c.canal = ${canal} and c.detalhe #>> '{chat,chave}' = ${chave}
           order by c.criado_em desc limit 1`),
      );
      if (aberto) {
        if (aberto.responsavel_id && aberto.responsavel_id !== eu) throw new ConflictException(`${aberto.nome ?? 'Outra pessoa'} já está com esta conversa.`);
        if (!aberto.responsavel_id)
          await tx.execute(sql`update atendimento_chamado set responsavel_id = ${eu}::uuid, pego_em = now() where id = ${aberto.id}::uuid`);
        return { id: aberto.id as string, novo: null };
      }
      const [c] = linhas(
        await tx.execute(sql`
          select (array_agg(m.cliente_nome order by m.criado_em desc) filter (where m.cliente_nome is not null))[1] as cliente,
                 (array_agg(m.pedido_id order by m.criado_em desc) filter (where m.pedido_id is not null))[1] as pedido_id,
                 (array_agg(m.pedido_externo order by m.criado_em desc) filter (where m.pedido_externo is not null))[1] as pedido_externo,
                 (array_agg(m.pedido_numero order by m.criado_em desc) filter (where m.pedido_numero is not null))[1] as pedido_numero,
                 (array_agg(m.unidade_id order by m.criado_em desc) filter (where m.unidade_id is not null))[1] as unidade_id,
                 (array_agg(m.texto order by m.criado_em desc) filter (where m.direcao = 'entrada' and m.autor = 'cliente'))[1] as fala,
                 max(m.criado_em) as ultima, count(*)::int as n
            from chat_plataforma_msg m
           where m.tenant_id = ${user.tenantId}::uuid and m.canal = ${canal} and ${chaveSql('m')} = ${chave}
             and m.criado_em > now() - interval '1 day'`),
      );
      if (!c?.n) throw new NotFoundException('Esta conversa não está mais no chat.');
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, cliente, pedido_numero, pedido_id, mensagem, prioridade, canal,
                                           responsavel_id, pego_em, detalhe)
          values (${user.tenantId}::uuid, ${c.unidade_id}::uuid, 'chat', ${c.cliente}, ${c.pedido_numero}, ${c.pedido_id}::uuid,
                  ${c.fala ?? 'Conversa assumida do robô'}, 'normal', ${canal}, ${eu}::uuid, now(),
                  jsonb_build_object('chat', jsonb_build_object('chave', ${chave}::text, 'pedidoExterno', ${c.pedido_externo}::text,
                                                                'pedidoNumero', ${c.pedido_numero}::text, 'ultimaEm', ${c.ultima}::timestamptz),
                                     'assumida', true))
          returning *`),
      );
      return { id: novo.id as string, novo };
    });
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: eu,
        atorPerfil: user.categoria,
        tipo: 'atendimento',
        acao: 'assumiu_conversa_do_chat',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: r.id,
        detalhe: { canal, chave },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria do "assumir a conversa" (${r.id}): ${e?.message ?? e}`));
    if (r.novo) this.events.emit('atendimento.novo', { tenantId: user.tenantId, chamado: r.novo });
    else this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: r.id, motivo: 'assumiu_a_conversa' });
    return { ok: true, id: r.id };
  }

  /**
   * "ASSUMIR A CONVERSA" DO DIRECT do Instagram (mig 378): quem responde no Direct (`veODirect`, a gestão). Na trava da
   * CONTA do Instagram — a mesma do aviso de mensagem e do robô: uma mensagem nova que chega junto não abre outro caso —: a
   * conversa já tem caso aberto — sem ninguém, fica com quem assumiu; com outra pessoa, 409 com o nome —; senão nasce o
   * caso do Direct já com a pessoa (as mensagens das últimas 12 h passam a ser dele). O caso aberto com alguém cala o robô
   * (instagram.ts › quemRespondeNoDirect); resolver devolve a conversa ao robô.
   */
  private async assumirNoDirect(user: AuthUser, eu: string, chave: string, origem: 'web' | 'servidor_loja' = 'web') {
    if (!veODirect(user)) throw new ForbiddenException('Quem assume a conversa do Direct é a gerência ou a supervisão.');
    const igsid = idDaChave(chave);
    if (!igsid) throw new BadRequestException('Conversa inválida.');
    const r = await this.db.transaction(async (tx) => {
      const [conta] = linhas(await tx.execute(sql`select id from instagram_conta where tenant_id = ${user.tenantId}::uuid for update`));
      if (!conta) throw new NotFoundException('O Instagram da loja não está conectado.');
      const [aberto] = linhas(
        await tx.execute(sql`
          select c.id, c.responsavel_id, col.nome from atendimento_chamado c
            left join colaborador col on col.id = c.responsavel_id and col.tenant_id = c.tenant_id
           where c.tenant_id = ${user.tenantId}::uuid and c.tipo = 'instagram' and c.status = 'aberto'
             and c.detalhe #>> '{instagram,igsid}' = ${igsid}
           order by c.criado_em desc limit 1`),
      );
      if (aberto) {
        if (aberto.responsavel_id && aberto.responsavel_id !== eu) throw new ConflictException(`${aberto.nome ?? 'Outra pessoa'} já está com esta conversa.`);
        if (!aberto.responsavel_id)
          await tx.execute(sql`update atendimento_chamado set responsavel_id = ${eu}::uuid, pego_em = now() where id = ${aberto.id}::uuid`);
        return { id: aberto.id as string, novo: null };
      }
      const [c] = linhas(
        await tx.execute(sql`
          select (array_agg(m.texto order by m.criado_em desc) filter (where m.autor = 'cliente' and m.texto is not null))[1] as fala,
                 max(m.criado_em) as ultima, count(*)::int as n,
                 (select row_to_json(ct) from (select nome, usuario from instagram_contato
                                                where tenant_id = ${user.tenantId}::uuid and igsid = ${igsid}) ct) as contato
            from instagram_mensagem m
           where m.tenant_id = ${user.tenantId}::uuid and m.igsid = ${igsid} and m.criado_em > now() - interval '1 day'`),
      );
      if (!c?.n) throw new NotFoundException('Esta conversa não está mais no Direct.');
      const detalhe = {
        plataforma: 'instagram',
        instagram: { igsid, usuario: c.contato?.usuario ?? null, nome: c.contato?.nome ?? null, ultimaEm: new Date(c.ultima).toISOString() },
        assumida: true,
      };
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, responsavel_id, pego_em, detalhe)
          values (${user.tenantId}::uuid, null, 'instagram', 'instagram', ${nomeDoCliente(c.contato)}, ${c.fala ?? 'Conversa do Direct assumida do robô'},
                  'normal', ${eu}::uuid, now(), ${JSON.stringify(detalhe)}::jsonb)
          returning *`),
      );
      await tx.execute(sql`
        update instagram_mensagem set chamado_id = ${novo.id}::uuid
         where tenant_id = ${user.tenantId}::uuid and igsid = ${igsid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
      return { id: novo.id as string, novo };
    });
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: eu,
        atorPerfil: user.categoria,
        tipo: 'atendimento',
        acao: 'assumiu_conversa_do_chat',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: r.id,
        detalhe: { canal: 'instagram' },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria do "assumir a conversa" (${r.id}): ${e?.message ?? e}`));
    if (r.novo) this.events.emit('atendimento.novo', { tenantId: user.tenantId, chamado: r.novo });
    else this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: r.id, motivo: 'assumiu_a_conversa' });
    return { ok: true, id: r.id };
  }

  /**
   * "ASSUMIR A CONVERSA" DO WHATSAPP: quem atende a caixa do WhatsApp (`veOWhatsapp`). Com a trava da empresa (duas
   * pessoas ao mesmo tempo: uma fica com ela, a outra recebe 409): o número já tem caso aberto — sem ninguém, fica com
   * quem assumiu; com outra pessoa, 409 com o nome —; senão nasce o caso "Quer falar com alguém" já com a pessoa. O caso
   * aberto cala o robô (robo-pausa.ts) e a pausa "atendente" segura pelo tempo da loja, como quando a equipe responde
   * pela caixa. A auditoria guarda o número mascarado.
   */
  private async assumirNoWhatsapp(user: AuthUser, eu: string, chave: string, nome: unknown, origem: 'web' | 'servidor_loja' = 'web') {
    if (!veOWhatsapp(user)) throw new ForbiddenException('Quem assume a conversa do WhatsApp é quem atende a caixa do WhatsApp.');
    if (!CHAVE_DO_WHATSAPP.test(chave)) throw new BadRequestException('Conversa inválida.');
    const tel = chave.slice(4);
    const k = chaveTelefone(tel);
    if (!k) throw new BadRequestException('Conversa inválida.');
    const cliente = typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, 120) : null;
    const r = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from robo_config where tenant_id = ${user.tenantId}::uuid for update`);
      const [aberto] = linhas(
        await tx.execute(sql`
          select c.id, c.responsavel_id, col.nome from atendimento_chamado c
            left join colaborador col on col.id = c.responsavel_id and col.tenant_id = c.tenant_id
           where c.tenant_id = ${user.tenantId}::uuid and c.status = 'aberto'
             and ${sqlChaveTelefone(sql`c.telefone`)} = ${k}
           order by c.criado_em desc limit 1`),
      );
      if (aberto) {
        if (aberto.responsavel_id && aberto.responsavel_id !== eu) throw new ConflictException(`${aberto.nome ?? 'Outra pessoa'} já está com esta conversa.`);
        if (!aberto.responsavel_id)
          await tx.execute(sql`update atendimento_chamado set responsavel_id = ${eu}::uuid, pego_em = now() where id = ${aberto.id}::uuid`);
        return { id: aberto.id as string, novo: null };
      }
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, tipo, cliente, telefone, mensagem, prioridade, canal, responsavel_id, pego_em, detalhe)
          values (${user.tenantId}::uuid, 'humano', ${cliente}, ${tel}, 'Conversa do WhatsApp assumida do robô', 'normal', 'whatsapp',
                  ${eu}::uuid, now(), jsonb_build_object('assumida', true))
          returning *`),
      );
      return { id: novo.id as string, novo };
    });
    await pausarPeloAtendente(this.db, { tenantId: user.tenantId, telefone: tel, motivo: 'atendente', por: eu }).catch((e: any) =>
      this.logger.warn(`"assumir a conversa" do WhatsApp (${r.id}): pausa do robô não gravada (o caso aberto já cala): ${e?.message ?? e}`),
    );
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: eu,
        atorPerfil: user.categoria,
        tipo: 'atendimento',
        acao: 'assumiu_conversa_do_chat',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: r.id,
        detalhe: { canal: 'whatsapp', telefone: mascararTelefone(tel) },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria do "assumir a conversa" (${r.id}): ${e?.message ?? e}`));
    if (r.novo) this.events.emit('atendimento.novo', { tenantId: user.tenantId, chamado: r.novo });
    else this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: r.id, motivo: 'assumiu_a_conversa' });
    return { ok: true, id: r.id };
  }

  // ───────────────────────── "Conversas agora" e a faixa no servidor da loja (V37) ─────────────────────────

  /**
   * A SITUAÇÃO DA PONTE para a fila do servidor da loja (a faixa da tela Atendimento): ela mora na nuvem e a fila da loja
   * não pode esperar a internet. Guarda a última resposta por empresa e loja e a renova EM SEGUNDO PLANO quando passa de
   * 15 s (uma busca por vez); devolve na hora o que tem — nada na primeira leitura —, e nada se a última é de mais de
   * 2 min (sem internet a faixa some em vez de mostrar uma situação velha). Só no servidor da loja.
   */
  private readonly ponteDaLoja = new Map<string, { em: number; valor: any; buscando: boolean }>();
  ponteDaNuvem(tenantId: string, unidade: string | null): any | null {
    const k = `${tenantId}|${unidade ?? ''}`;
    const agora = Date.now();
    const atual = this.ponteDaLoja.get(k);
    if ((!atual || agora - atual.em > 15_000) && !atual?.buscando) {
      const entrada = atual ?? { em: 0, valor: null, buscando: false };
      entrada.buscando = true;
      this.ponteDaLoja.set(k, entrada);
      const q = unidade && UUID_RE.test(unidade) ? `?unidade=${unidade}` : '';
      this.pelaNuvem('GET', `ponte-da-loja${q}`, undefined, 8000)
        .then((v) => Object.assign(entrada, { em: Date.now(), valor: v && typeof v.ligada === 'boolean' ? v : null }))
        .catch((e: any) => this.logger.warn(`faixa da ponte no servidor da loja: ${e?.message ?? e}`))
        .finally(() => (entrada.buscando = false));
    }
    return atual && atual.em && agora - atual.em <= 120_000 ? atual.valor : null;
  }

  /**
   * O ALERTA DO PIX DO ADICIONAL para a fila do servidor da loja (mig 373, só nuvem — V37): o robô pôs um item num pedido
   * já pago e espera o Pix ("segure o pedido"). Como a faixa da ponte: a última resposta da nuvem, renovada em segundo
   * plano a cada 10 s (o Pix vale 5 min); null = não li (sem internet há mais de 2 min, ou a primeira leitura).
   */
  private readonly adicionaisDaLoja = new Map<string, { em: number; valor: any; buscando: boolean }>();
  adicionaisDaNuvem(tenantId: string, unidade: string | null): AlertaDoAdicional[] | null {
    const k = `${tenantId}|${unidade ?? ''}`;
    const agora = Date.now();
    const atual = this.adicionaisDaLoja.get(k);
    if ((!atual || agora - atual.em > 10_000) && !atual?.buscando) {
      const entrada = atual ?? { em: 0, valor: null, buscando: false };
      entrada.buscando = true;
      this.adicionaisDaLoja.set(k, entrada);
      const q = unidade && UUID_RE.test(unidade) ? `?unidade=${unidade}` : '';
      this.pelaNuvem('GET', `adicionais-pix-da-loja${q}`, undefined, 8000)
        .then((v) => Object.assign(entrada, { em: Date.now(), valor: Array.isArray(v) ? v : null }))
        .catch((e: any) => this.logger.warn(`alerta do Pix do adicional no servidor da loja: ${e?.message ?? e}`))
        .finally(() => (entrada.buscando = false));
    }
    return atual && atual.em && agora - atual.em <= 120_000 ? atual.valor : null;
  }

  /** Na nuvem: os alertas do Pix do adicional da empresa (a fila daqui e o servidor da loja). */
  adicionaisDaEmpresa(tenantId: string, unidade: string | null): Promise<AlertaDoAdicional[]> {
    return alertasDoAdicionalPix(this.db, tenantId, unidade);
  }

  /** Na nuvem, para o servidor da loja: as "Conversas agora" de quem está na tela de lá (o login foi conferido lá). */
  conversasVindoDaLoja(tenantId: string, q: { unidade?: unknown; categoria?: unknown; bot?: unknown }) {
    const unidade = typeof q?.unidade === 'string' && UUID_RE.test(q.unidade) ? q.unidade : null;
    const categoria = typeof q?.categoria === 'string' ? q.categoria.slice(0, 20) : null;
    return this.conversasAgora(tenantId, unidade, { categoria, permissoes: { bot: q?.bot === 'true' || q?.bot === true } });
  }

  /**
   * Na nuvem, o "Assumir a conversa" vindo do servidor da loja: quem assumiu precisa ser colaborador desta empresa e da
   * gestão (a mesma trava da rota); o resto, as mesmas regras de `assumir` (inclusive a caixa do WhatsApp).
   */
  async assumirVindoDaLoja(tenantId: string, dto: { canal?: unknown; chave?: unknown; nome?: unknown; atorId?: unknown; atorPerfil?: unknown; bot?: unknown }) {
    const atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    const perfil = typeof dto?.atorPerfil === 'string' ? dto.atorPerfil : '';
    if (!atorId || !['presidente', 'gerente', 'supervisao'].includes(perfil))
      throw new ForbiddenException('Quem assume a conversa é a gerência ou a supervisão.');
    const ok = linhas(await this.db.execute(sql`select 1 from colaborador where id = ${atorId}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!ok.length) throw new ForbiddenException('Entre com o seu usuário para assumir a conversa.');
    const user = { tenantId, colaboradorId: atorId, categoria: perfil, permissoes: { bot: dto?.bot === true } } as any;
    return this.assumir(user, { canal: dto?.canal, chave: dto?.chave, nome: dto?.nome }, 'servidor_loja');
  }

  // ───────────────────────── servidor da loja → nuvem ─────────────────────────

  private async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, prazoMs = 20_000): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: o chat do iFood e da 99 mora lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(prazoMs),
      });
    } catch (e: any) {
      this.logger.warn(`chat do caso (${metodo} ${caminho.split('?')[0]}): a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo em instantes.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      if (res.status === 409) throw new ConflictException(msg);
      if (res.status === 404) throw new NotFoundException(msg);
      if (res.status === 403) throw new ForbiddenException(msg);
      if (res.status === 400) throw new BadRequestException(msg);
      throw new BadGatewayException(msg);
    }
    return j;
  }
}

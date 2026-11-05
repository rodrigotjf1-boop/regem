import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
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

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD E DA 99 DENTRO DO CASO (ponte do chat, Etapa 2 — protótipo `mockups/regem-central-atendimento.html` v3,
// bloco "Chat do iFood com …"): a conversa do pedido, nas duas direções, e a resposta da equipe, que entra na FILA DE
// SAÍDA da ponte (`chat_plataforma_msg`, mig 366) — a ponte do PC da loja digita no chat da plataforma. Vale no caso
// "Mensagem no chat" e também na disputa do iFood e no pedido da 99 (o chat do mesmo pedido).
// As mensagens moram só na NUVEM (mig 366 @cloud-only): no servidor da loja, ler e responder vão à nuvem pelo token do
// servidor (V37) — "não li" aparece diferente de "vazio".

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
               m.criado_em as em, m.enviado_em as "enviadoEm"
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

  // ───────────────────────── servidor da loja → nuvem ─────────────────────────

  private async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: o chat do iFood e da 99 mora lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(20_000),
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
      if (res.status === 400) throw new BadRequestException(msg);
      throw new BadGatewayException(msg);
    }
    return j;
  }
}

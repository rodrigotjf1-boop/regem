import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PonteChatService } from '../ponte-chat/ponte-chat.service';
import { TEXTO_MAX, temContatoProibido } from '../ponte-chat/texto-do-chat';
import { modoEntrega, nomeDoCanal } from './modo-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENTREGADOR CONVERSA COM O CLIENTE PELO CHAT DO iFOOD E DA 99 (pedido do dono, 09/11/2026: "o entregador vai ter a
// opção no pedido de clicar em um chat, e ao digitar e enviar a ponte vai guiar a mensagem do entregador até o cliente
// via chat do marketplace — tanto para 99 e para iFood — caso não consiga contato pelo telefone"). A mensagem entra na
// MESMA fila de saída da ponte que a equipe usa no Atendimento (`chat_plataforma_msg`, mig 366): autor 'equipe' com o id
// do entregador — sem migration; o robô do chat reconhece o entregador pelo `entregador_id` do pedido e fica quieto
// enquanto ele conversa (`ponte-chat.service.ts`, `MIN_CONVERSA_DO_ENTREGADOR`). A resposta do cliente chega pela ponte e
// aparece aqui (e no caso da tela Atendimento, como qualquer fala do chat).
// Só o entregador DO pedido, com o pedido a caminho, na ENTREGA DA LOJA do iFood ou da 99. As regras da plataforma valem
// igual às da equipe: sem telefone, WhatsApp, Instagram nem link no texto.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O que vai na frente do texto do entregador: o cliente sabe que quem escreve é o entregador, não a loja. */
export const PREFIXO_DO_ENTREGADOR = 'Entregador: ';
const LIMITE_DA_CONVERSA = 100;
const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

export type MensagemParaOEntregador = {
  id: string;
  /** Quem falou, do ponto de vista do entregador: o cliente, ele mesmo ou a loja (equipe, robô, aviso automático). */
  de: 'cliente' | 'voce' | 'loja';
  texto: string;
  /** Na saída: pendente/enviando/enviada/falhou/cancelada; na entrada: recebida. */
  estado: string;
  em: string;
};

export type ConversaDoEntregador = {
  canal: 'ifood' | '99food';
  /** A ponte está ligada na loja e algum PC envia pelo canal agora (a mensagem sai na hora). */
  ponte: { ligada: boolean; responde: boolean };
  mensagens: MensagemParaOEntregador[];
};

@Injectable()
export class ChatDoEntregadorService {
  private readonly logger = new Logger('ChatDoEntregador');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // A situação da ponte (ligada? algum PC envia pelo canal?). Opcional: os testes montam sem ela (= desligada).
    @Optional() private readonly ponte?: PonteChatService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** O pedido do entregador que pode ter chat: dele, do iFood ou da 99, entrega da loja. Recusas antes de qualquer gravação. */
  private async pedidoDoEntregador(user: AuthUser, id: string): Promise<any> {
    if (!/entregador/i.test(user.funcaoNome ?? '')) throw new ForbiddenException('Apenas entregadores.');
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Pedido não encontrado.');
    const [p] = linhas(
      await this.db.execute(sql`
        select id, canal, tipo, raw, status, entregador_id, unidade_id, external_id, display_id, cliente_nome
          from pedido_externo
         where tenant_id = ${user.tenantId}::uuid and id = ${id}::uuid`),
    );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (p.entregador_id !== user.colaboradorId) throw new ForbiddenException('Este pedido não está atribuído a você.');
    if (p.canal !== 'ifood' && p.canal !== '99food')
      throw new BadRequestException('Este pedido não é do iFood nem da 99: fale com o cliente pelo telefone.');
    if (modoEntrega(p) !== 'propria_canal')
      throw new BadRequestException(`Este pedido é entregue pelo entregador do ${nomeDoCanal(p.canal)}.`);
    return p;
  }

  /** Algum PC da ponte envia pelo canal para a loja do pedido? A mesma regra do robô: a ponte da loja ou a sem loja. */
  private async situacaoDaPonte(tenantId: string, unidade: string | null, canal: 'ifood' | '99food') {
    if (!this.ponte) return { ligada: false, responde: false };
    const ligada = await this.ponte.ligada(tenantId);
    if (!ligada) return { ligada, responde: false };
    const responde =
      !!(await this.ponte.quemRespondePeloCanal(tenantId, unidade, canal)) ||
      (unidade !== null && !!(await this.ponte.quemRespondePeloCanal(tenantId, null, canal)));
    return { ligada, responde };
  }

  /** A conversa do chat da plataforma deste pedido (as últimas 100 mensagens, em ordem) e a situação da ponte. */
  async conversa(user: AuthUser, id: string): Promise<ConversaDoEntregador> {
    const p = await this.pedidoDoEntregador(user, id);
    const [ponte, msgs] = await Promise.all([
      this.situacaoDaPonte(user.tenantId, p.unidade_id ?? null, p.canal),
      this.db.execute(sql`
        select m.id, m.direcao, m.autor, m.autor_id, m.texto, m.estado, m.criado_em
          from chat_plataforma_msg m
         where m.tenant_id = ${user.tenantId}::uuid and m.canal = ${p.canal}
           and (m.pedido_id = ${p.id}::uuid or (${p.external_id}::text is not null and m.pedido_externo = ${p.external_id}::text))
         order by m.criado_em desc, m.id desc
         limit ${LIMITE_DA_CONVERSA}`),
    ]);
    const mensagens = linhas(msgs)
      .reverse()
      .map(
        (m): MensagemParaOEntregador => ({
          id: String(m.id),
          de: m.direcao === 'entrada' && m.autor === 'cliente' ? 'cliente' : m.autor_id === user.colaboradorId ? 'voce' : 'loja',
          // O "Entregador: " que vai ao cliente não aparece na tela dele.
          texto:
            m.autor_id === user.colaboradorId && String(m.texto).startsWith(PREFIXO_DO_ENTREGADOR)
              ? String(m.texto).slice(PREFIXO_DO_ENTREGADOR.length)
              : String(m.texto),
          estado: String(m.estado),
          em: new Date(m.criado_em).toISOString(),
        }),
      );
    return { canal: p.canal, ponte, mensagens };
  }

  /**
   * O entregador escreve ao cliente: a mensagem entra na fila de saída da ponte ("pendente") e o PC da loja digita no chat
   * da plataforma. `idCliente` = o id que o APP gerou para a mensagem: o reenvio depois de uma falha de rede não manda
   * duas (V24). Toda recusa vem antes de gravar (V86).
   */
  async enviar(user: AuthUser, id: string, dto: { texto?: unknown; idCliente?: unknown } | null | undefined) {
    const bruto = typeof dto?.texto === 'string' ? dto.texto.trim() : '';
    if (!bruto) throw new BadRequestException('Escreva a mensagem.');
    const cabe = TEXTO_MAX - PREFIXO_DO_ENTREGADOR.length;
    if (bruto.length > cabe) throw new BadRequestException(`No chat da plataforma cabem até ${cabe} letras.`);
    const idCliente = typeof dto?.idCliente === 'string' && UUID_RE.test(dto.idCliente) ? dto.idCliente : null;
    const p = await this.pedidoDoEntregador(user, id);
    const plataforma = p.canal === 'ifood' ? 'O iFood' : 'A 99';
    if (temContatoProibido(bruto))
      throw new BadRequestException(`${plataforma} proíbe telefone, WhatsApp, Instagram e link no chat. Tire isso da mensagem para enviar.`);
    if (p.status !== 'despachado') throw new BadRequestException('O pedido não está a caminho do cliente.');
    const ponte = await this.situacaoDaPonte(user.tenantId, p.unidade_id ?? null, p.canal);
    if (!ponte.ligada)
      throw new ConflictException('O chat com o cliente pela plataforma não está ligado nesta loja. Ligue para o cliente ou peça ajuda à loja.');
    const texto = `${PREFIXO_DO_ENTREGADOR}${bruto}`;
    const [m] = linhas(
      await this.db.execute(sql`
        insert into chat_plataforma_msg
          (id, tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, autor_id, texto, estado)
        values (coalesce(${idCliente}::uuid, gen_random_uuid()), ${user.tenantId}::uuid, ${p.unidade_id}::uuid, ${p.canal},
                ${p.id}::uuid, ${p.external_id}, ${p.display_id}, ${p.cliente_nome}, 'saida', 'equipe',
                ${user.colaboradorId}::uuid, ${texto}, 'pendente')
        on conflict (id) do nothing
        returning id, criado_em`),
    );
    if (!m) {
      // O mesmo id de novo (o app reenviou): devolve a que já está na fila — só se for DESTE entregador.
      const [ja] = linhas(
        await this.db.execute(sql`
          select id, estado, criado_em from chat_plataforma_msg
           where id = ${idCliente}::uuid and tenant_id = ${user.tenantId}::uuid and autor_id = ${user.colaboradorId}::uuid`),
      );
      if (!ja) throw new ConflictException('Não foi possível enviar: tente de novo.');
      return { ok: true, id: String(ja.id), estado: String(ja.estado), repetida: true, saiAgora: ponte.responde };
    }
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        unidadeId: p.unidade_id ?? null,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'atendimento',
        acao: 'entregador_escreveu_no_chat',
        entidadeTipo: 'pedido_externo',
        entidadeId: p.id,
        // Quem, o canal e o tamanho — não o texto (como a resposta da equipe).
        detalhe: { canal: p.canal, mensagemId: m.id, letras: bruto.length },
        origem: 'app_entregador',
      })
      .catch((e: any) => this.logger.warn(`auditoria do chat do entregador (pedido ${p.id}): ${e?.message ?? e}`));
    return { ok: true, id: String(m.id), estado: 'pendente', saiAgora: ponte.responde };
  }

  /**
   * A última fala do CLIENTE no chat de cada pedido (para o app marcar "o cliente respondeu" na lista) — uma consulta só.
   * Só do iFood e da 99.
   */
  async ultimasDoCliente(tenantId: string, pedidos: { id: string; canal: unknown }[]): Promise<Map<string, { texto: string; em: string }>> {
    const mapa = new Map<string, { texto: string; em: string }>();
    const ids = pedidos.filter((p) => p.canal === 'ifood' || p.canal === '99food').map((p) => p.id);
    if (!ids.length) return mapa;
    const r = linhas(
      await this.db.execute(sql`
        select distinct on (m.pedido_id) m.pedido_id, m.texto, m.criado_em
          from chat_plataforma_msg m
         where m.tenant_id = ${tenantId}::uuid
           and m.pedido_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
           and m.direcao = 'entrada' and m.autor = 'cliente'
         order by m.pedido_id, m.criado_em desc`),
    );
    for (const row of r) mapa.set(String(row.pedido_id), { texto: String(row.texto), em: new Date(row.criado_em).toISOString() });
    return mapa;
  }
}

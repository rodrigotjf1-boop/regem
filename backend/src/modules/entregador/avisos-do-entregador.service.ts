import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DeliveryService } from '../delivery/delivery.service';
import { uuidDeChave } from '../../common/id-deterministico';
import {
  HORAS_DO_AVISO_ABERTO,
  RESPOSTAS_DO_AVISO,
  ROTULO_DO_MOTIVO,
  ehRespostaAoCliente,
  ehRespostaDoAviso,
  textoDaResposta,
} from '../../common/aviso-ao-entregador';
import { EntregadorService } from './entregador.service';
import { ChatDoEntregadorService } from './chat-do-entregador.service';
import { modoEntrega } from './modo-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS NO APP DO ENTREGADOR (mig 391; pedido do dono, 10/11/2026): o que o robô percebeu (o cliente perguntando
// pelo pedido, reclamando da demora) e o que o atendimento encaminhou (faltou item, faltou troco, recado). O app pede
// os avisos abertos dele a cada volta e toca a notificação; no aviso, o entregador fala com o cliente (ligar, chat,
// WhatsApp dele) ou responde com um toque — "estou a caminho", "cheguei", "tive um imprevisto" —, que sai pelo canal do
// pedido: o chat do iFood/99 pela ponte; o WhatsApp da loja no cardápio digital. O caso do Atendimento mostra o que ele
// fez. Só a NUVEM (o app fala com ela; a tabela é @cloud-only).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

@Injectable()
export class AvisosDoEntregadorService {
  private readonly logger = new Logger('AvisosDoEntregador');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly entregador: EntregadorService,
    private readonly chat: ChatDoEntregadorService,
    private readonly delivery: DeliveryService,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private conferirEntregador(user: AuthUser) {
    if (!/entregador/i.test(user.funcaoNome ?? '')) throw new ForbiddenException('Apenas entregadores.');
  }

  /** Os avisos ABERTOS do entregador (sem resposta, das últimas 4 h), os mais novos primeiro, cada um com o pedido. */
  async meus(user: AuthUser) {
    this.conferirEntregador(user);
    const avisos = linhas(
      await this.db.execute(sql`
        select a.id, a.pedido_id, a.origem, a.motivo, a.texto, a.criado_em, a.visto_em, q.nome as enviado_por
          from entregador_aviso a
          left join colaborador q on q.id = a.enviado_por and q.tenant_id = a.tenant_id
         where a.tenant_id = ${user.tenantId}::uuid and a.colaborador_id = ${user.colaboradorId}::uuid
           and a.respondido_em is null
           and a.criado_em > now() - make_interval(hours => ${HORAS_DO_AVISO_ABERTO})
         order by a.criado_em desc
         limit 20`),
    );
    const pedidos = await this.entregador.resumosDosPedidos(user.tenantId, [...new Set(avisos.map((a) => String(a.pedido_id)))]);
    return avisos
      .filter((a) => pedidos.has(String(a.pedido_id)))
      .map((a) => {
        const pedido = pedidos.get(String(a.pedido_id));
        return {
          id: String(a.id),
          origem: a.origem as 'robo' | 'atendimento',
          motivo: a.motivo as string,
          rotulo: ROTULO_DO_MOTIVO[a.motivo as keyof typeof ROTULO_DO_MOTIVO] ?? a.motivo,
          texto: a.texto ?? null,
          enviadoPor: a.enviado_por ?? null,
          em: new Date(a.criado_em).toISOString(),
          vistoEm: a.visto_em ? new Date(a.visto_em).toISOString() : null,
          // O pedido já foi entregue: "a caminho" vira "voltando com o que faltou".
          depoisDaEntrega: ['entregue', 'concluido'].includes(String(pedido?.status)),
          pedido,
        };
      });
  }

  /** O entregador abriu o aviso (o caso do Atendimento mostra "visto"). */
  async visto(user: AuthUser, id: string) {
    this.conferirEntregador(user);
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Aviso não encontrado.');
    const [a] = linhas(
      await this.db.execute(sql`
        update entregador_aviso set visto_em = coalesce(visto_em, now())
         where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and colaborador_id = ${user.colaboradorId}::uuid
        returning chamado_id`),
    );
    if (!a) throw new NotFoundException('Aviso não encontrado.');
    if (a.chamado_id) this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: a.chamado_id, motivo: 'entregador_viu_o_aviso' });
    return { ok: true };
  }

  /**
   * A resposta do entregador. "a_caminho" | "cheguei" | "imprevisto" mandam o texto ao cliente pelo canal do pedido (o
   * chat do iFood/99 pela ponte; o WhatsApp da loja no cardápio) e dizem se saiu — sem sair, o app oferece o WhatsApp do
   * entregador com o MESMO texto. "ligou" | "mensagem" | "ok" só registram o que ele fez. Uma resposta por aviso: a
   * segunda devolve a primeira (o reenvio depois de uma queda de rede não manda duas mensagens — a do chat também tem
   * id fixo por aviso). O caso do Atendimento que mandou o aviso é avisado.
   */
  async responder(user: AuthUser, id: string, dto: { acao?: unknown } | null | undefined) {
    this.conferirEntregador(user);
    const acao = dto?.acao;
    if (!ehRespostaDoAviso(acao)) throw new BadRequestException(`Resposta inválida: ${RESPOSTAS_DO_AVISO.join(', ')}.`);
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Aviso não encontrado.');
    const [a] = linhas(
      await this.db.execute(sql`
        select a.id, a.pedido_id, a.chamado_id, a.respondido_em, a.resposta, a.resposta_saiu,
               p.canal, p.tipo, p.raw, p.status, p.display_id, p.numero, p.unidade_id
          from entregador_aviso a
          join pedido_externo p on p.id = a.pedido_id and p.tenant_id = a.tenant_id
         where a.id = ${id}::uuid and a.tenant_id = ${user.tenantId}::uuid and a.colaborador_id = ${user.colaboradorId}::uuid`),
    );
    if (!a) throw new NotFoundException('Aviso não encontrado.');
    if (a.respondido_em) return { ok: true, jaRespondido: true, resposta: a.resposta, saiu: a.resposta_saiu ?? null, por: null, texto: null };

    let saiu: boolean | null = null;
    let por: 'chat' | 'whatsapp_loja' | null = null;
    let motivo: string | undefined;
    let texto: string | null = null;
    if (ehRespostaAoCliente(acao)) {
      const depoisDaEntrega = ['entregue', 'concluido'].includes(String(a.status));
      const cod = String(a.display_id ?? a.numero ?? '').trim();
      texto = textoDaResposta(acao, { ref: cod ? ` #${cod}` : '', depoisDaEntrega }).texto;
      const modo = modoEntrega({ tipo: a.tipo, canal: a.canal, raw: a.raw });
      if ((a.canal === 'ifood' || a.canal === '99food') && modo === 'propria_canal') {
        try {
          await this.chat.enviar(user, String(a.pedido_id), { texto, idCliente: uuidDeChave('aviso-entregador', String(a.id), acao) }, { depoisDaEntrega });
          saiu = true;
          por = 'chat';
        } catch (e: any) {
          saiu = false;
          motivo = String(e?.message ?? e).slice(0, 200);
        }
      } else if (DeliveryService.podeAvisarPeloWhatsapp(a.canal)) {
        const r = await this.delivery.mensagemDoEntregadorAoCliente(user.tenantId, String(a.pedido_id), acao, depoisDaEntrega);
        saiu = r.saiu;
        por = r.saiu ? 'whatsapp_loja' : null;
        motivo = r.motivo;
      } else {
        saiu = false;
        motivo = 'este canal não recebe mensagem da loja';
      }
    }
    const [gravou] = linhas(
      await this.db.execute(sql`
        update entregador_aviso set respondido_em = now(), resposta = ${acao}, resposta_saiu = ${saiu}
         where id = ${id}::uuid and respondido_em is null
        returning id`),
    );
    if (!gravou) return { ok: true, jaRespondido: true, resposta: acao, saiu, por, texto };
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        unidadeId: a.unidade_id ?? null,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'delivery',
        acao: 'entregador_respondeu_aviso',
        entidadeTipo: 'pedido_externo',
        entidadeId: String(a.pedido_id),
        detalhe: { avisoId: String(a.id), resposta: acao, saiu, por },
        origem: 'app_entregador',
      })
      .catch((e: any) => this.logger.warn(`auditoria da resposta do entregador (aviso ${a.id}): ${e?.message ?? e}`));
    if (a.chamado_id) this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: a.chamado_id, motivo: 'entregador_respondeu' });
    return { ok: true, saiu, por, ...(motivo ? { motivo } : {}), texto };
  }
}

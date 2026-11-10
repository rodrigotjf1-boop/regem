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
import {
  HORAS_DEPOIS_DA_ENTREGA,
  MOTIVOS_DO_AVISO,
  ROTULO_DO_MOTIVO,
  avisarEntregador,
  ehMotivoDoAviso,
} from '../../common/aviso-ao-entregador';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "AVISAR O ENTREGADOR" PELO CASO DO ATENDIMENTO (mig 391; pedido do dono, 10/11/2026: "caso a reclamação precise do
// atendimento, é tratada lá; caso o atendimento entenda que deve encaminhar ao entregador, envia a notificação do
// pedido ao entregador, que chega no app dele"). A equipe escolhe o motivo (o cliente perguntando pelo pedido,
// reclamando da demora, faltou item, faltou troco, outro) e escreve o recado; o entregador do pedido recebe no app e o
// caso mostra o que ele fez (viu, a caminho, cheguei, imprevisto…). Vale com o pedido a caminho, entregue ou concluído
// há até 12 h (o "faltou bebida" chega depois da entrega). Os avisos moram só na NUVEM (mig 391 @cloud-only): no
// servidor da loja, ler e mandar vão à nuvem pelo token do servidor (V37).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTA_MAX = 300;
const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

export type AvisoNoCaso = {
  id: string;
  origem: 'robo' | 'atendimento';
  motivo: string;
  rotulo: string;
  texto: string | null;
  enviadoPor: string | null;
  em: string;
  vistoEm: string | null;
  respondidoEm: string | null;
  resposta: string | null;
  respostaSaiu: boolean | null;
};

export type EntregadorDoCaso = {
  /** O caso tem um pedido com entregador da loja (pelo app). */
  entregador: { id: string; nome: string | null } | null;
  /** Dá para avisar agora? Senão, `porQueNao` diz o motivo para a tela. */
  podeAvisar: boolean;
  porQueNao: string | null;
  motivos: { valor: string; rotulo: string }[];
  /** Os avisos deste pedido (do robô e da equipe), os mais novos primeiro. */
  avisos: AvisoNoCaso[];
};

@Injectable()
export class AvisarOEntregadorService {
  private readonly logger = new Logger('AvisarOEntregador');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** O caso e o pedido dele (com quem entrega e a situação). 404 se o caso não é da empresa. */
  private async caso(tenantId: string, id: string): Promise<any> {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const [c] = linhas(
      await this.db.execute(sql`
        select c.id, c.status, c.unidade_id as "unidadeId", c.pedido_id as "pedidoId",
               p.status as "pedidoStatus", p.tipo as "pedidoTipo", p.entregador_id as "entregadorId",
               coalesce(e.nome, p.entregador_nome) as "entregadorNome",
               (p.status = 'concluido'
                and coalesce(p.concluido_em, p.entregue_em) <= now() - make_interval(hours => ${HORAS_DEPOIS_DA_ENTREGA})) as "concluidoHaMuito"
          from atendimento_chamado c
          left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
          left join colaborador e on e.id = p.entregador_id and e.tenant_id = c.tenant_id
         where c.tenant_id = ${tenantId}::uuid and c.id = ${id}::uuid`),
    );
    if (!c) throw new NotFoundException('Caso não encontrado.');
    return c;
  }

  private porQueNao(c: any): string | null {
    if (!c.pedidoId) return 'O caso não está ligado a um pedido.';
    if (!c.entregadorId) return 'O pedido não está com um entregador pelo app.';
    if (c.pedidoTipo === 'retirada') return 'Pedido de retirada: não há entregador.';
    if (c.pedidoStatus === 'cancelado') return 'O pedido foi cancelado.';
    if (!['despachado', 'entregue', 'concluido'].includes(String(c.pedidoStatus))) return 'O pedido ainda não saiu para a entrega.';
    if (c.concluidoHaMuito) return `O pedido foi concluído há mais de ${HORAS_DEPOIS_DA_ENTREGA} h.`;
    return null;
  }

  // ───────────────────────── ler ─────────────────────────

  async situacao(user: AuthUser, id: string): Promise<EntregadorDoCaso> {
    if (ehServidorLocal()) return this.pelaNuvem('GET', `entregador-da-loja?chamado=${encodeURIComponent(String(id ?? ''))}`);
    return this.situacaoNaEmpresa(user.tenantId, id);
  }

  async situacaoNaEmpresa(tenantId: string, id: string): Promise<EntregadorDoCaso> {
    const c = await this.caso(tenantId, id);
    const motivos = MOTIVOS_DO_AVISO.map((valor) => ({ valor, rotulo: ROTULO_DO_MOTIVO[valor] }));
    if (!c.pedidoId || !c.entregadorId)
      return { entregador: null, podeAvisar: false, porQueNao: this.porQueNao(c), motivos, avisos: [] };
    const avisos = linhas(
      await this.db.execute(sql`
        select a.id, a.origem, a.motivo, a.texto, q.nome as "enviadoPor", a.criado_em as em, a.visto_em as "vistoEm",
               a.respondido_em as "respondidoEm", a.resposta, a.resposta_saiu as "respostaSaiu"
          from entregador_aviso a
          left join colaborador q on q.id = a.enviado_por and q.tenant_id = a.tenant_id
         where a.tenant_id = ${tenantId}::uuid and a.pedido_id = ${c.pedidoId}::uuid
         order by a.criado_em desc
         limit 20`),
    ).map(
      (a): AvisoNoCaso => ({
        id: String(a.id),
        origem: a.origem,
        motivo: a.motivo,
        rotulo: ROTULO_DO_MOTIVO[a.motivo as keyof typeof ROTULO_DO_MOTIVO] ?? a.motivo,
        texto: a.texto ?? null,
        enviadoPor: a.enviadoPor ?? null,
        em: new Date(a.em).toISOString(),
        vistoEm: a.vistoEm ? new Date(a.vistoEm).toISOString() : null,
        respondidoEm: a.respondidoEm ? new Date(a.respondidoEm).toISOString() : null,
        resposta: a.resposta ?? null,
        respostaSaiu: a.respostaSaiu ?? null,
      }),
    );
    const porQueNao = c.status !== 'aberto' ? 'O caso já foi resolvido.' : this.porQueNao(c);
    return {
      entregador: { id: String(c.entregadorId), nome: c.entregadorNome ?? null },
      podeAvisar: !porQueNao,
      porQueNao,
      motivos,
      avisos,
    };
  }

  // ───────────────────────── avisar ─────────────────────────

  async avisar(user: AuthUser, id: string, dto: { motivo?: unknown; nota?: unknown } | null | undefined) {
    if (ehServidorLocal())
      return this.pelaNuvem('POST', 'entregador-da-loja', {
        chamadoId: id,
        motivo: dto?.motivo,
        nota: dto?.nota,
        atorId: user.colaboradorId ?? null,
        atorPerfil: user.categoria,
      });
    return this.avisarNaEmpresa(user.tenantId, id, dto, { id: user.colaboradorId ?? null, perfil: user.categoria }, 'web');
  }

  /** O aviso que veio do servidor da loja (quem mandou já foi conferido lá; aqui só se é da empresa). */
  async avisarVindoDaLoja(tenantId: string, dto: { chamadoId?: unknown; motivo?: unknown; nota?: unknown; atorId?: unknown; atorPerfil?: unknown }) {
    let atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    if (atorId) {
      const ok = linhas(await this.db.execute(sql`select 1 from colaborador where id = ${atorId}::uuid and tenant_id = ${tenantId}::uuid`));
      if (!ok.length) atorId = null;
    }
    const perfil = typeof dto?.atorPerfil === 'string' ? dto.atorPerfil.slice(0, 20) : 'execucao';
    return this.avisarNaEmpresa(tenantId, String(dto?.chamadoId ?? ''), dto, { id: atorId, perfil }, 'servidor_loja');
  }

  /**
   * Na nuvem: grava o aviso para o entregador do pedido. Toda recusa vem ANTES de gravar (V86): motivo fora da lista,
   * recado longo, caso resolvido, sem pedido/entregador, pedido fora do tempo. A auditoria guarda quem, o motivo e o
   * tamanho do recado — não o texto.
   */
  async avisarNaEmpresa(
    tenantId: string,
    id: string,
    dto: { motivo?: unknown; nota?: unknown } | null | undefined,
    ator: { id: string | null; perfil: string },
    origem: 'web' | 'servidor_loja',
  ) {
    const motivo = dto?.motivo;
    if (!ehMotivoDoAviso(motivo)) throw new BadRequestException(`Escolha o motivo do aviso: ${MOTIVOS_DO_AVISO.join(', ')}.`);
    const nota = typeof dto?.nota === 'string' ? dto.nota.trim() : '';
    if (nota.length > NOTA_MAX) throw new BadRequestException(`O recado ao entregador cabe em ${NOTA_MAX} letras.`);
    const c = await this.caso(tenantId, id);
    if (c.status !== 'aberto') throw new ConflictException('Este caso já foi resolvido.');
    const porQueNao = this.porQueNao(c);
    if (porQueNao) throw new ConflictException(porQueNao);
    const r = await avisarEntregador(this.db, {
      tenantId,
      pedidoId: String(c.pedidoId),
      origem: 'atendimento',
      motivo,
      texto: nota || null,
      chamadoId: c.id,
      enviadoPor: ator.id,
    });
    if (r.estado !== 'avisado') throw new ConflictException('Não deu para avisar o entregador deste pedido agora.');
    await this.auditoria
      ?.registrar({
        tenantId,
        unidadeId: c.unidadeId ?? null,
        atorId: ator.id,
        atorPerfil: ator.perfil,
        tipo: 'atendimento',
        acao: 'avisou_o_entregador',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: c.id,
        detalhe: { pedidoId: c.pedidoId, motivo, avisoId: r.id, letras: nota.length },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria do aviso ao entregador (caso ${c.id}): ${e?.message ?? e}`));
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'avisou_o_entregador' });
    return { ok: true, id: r.id };
  }

  // ───────────────────────── a nuvem, do servidor da loja ─────────────────────────

  private async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, prazoMs = 20_000): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: os avisos ao entregador moram lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(prazoMs),
      });
    } catch (e: any) {
      this.logger.warn(`aviso ao entregador (${metodo} ${caminho.split('?')[0]}): a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
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

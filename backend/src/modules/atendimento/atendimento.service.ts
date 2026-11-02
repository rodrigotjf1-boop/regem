import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado } from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { lerItensDaPerda } from '../vendas/itens-da-perda';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { instanteDe } from '../../common/fuso-sql';
import { hojeISO } from '../../common/data';
import { exigirBooleano } from '../../common/exigir';
import {
  DadosDoChamado,
  JANELA_DO_MESMO_CHAMADO_H,
  Prioridade,
  abrirChamado,
  abrirChamadoPeloRobo,
  juntarMensagem,
} from './abrir-chamado';
import { canalDoCaso, posicoes, situacaoDo } from './fila';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantos casos a fila devolve de uma vez. As contagens da tela vêm do banco, não desta lista. */
export const LIMITE_DA_FILA = 300;

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { Prioridade };

/** A prioridade pedida: só `prioridade: 'urgente'` ou `urgente: true` mudam o padrão. Todo o resto é 'normal'. */
export function prioridadeDe(dto: { prioridade?: unknown; urgente?: unknown } | null | undefined): Prioridade {
  if (dto?.prioridade === 'urgente') return 'urgente';
  return dto?.urgente === true || dto?.urgente === 'true' ? 'urgente' : 'normal';
}

// A abertura de chamado mora em `abrir-chamado.ts` (o WhatsApp também abre — Bloco 4); estes nomes continuam valendo daqui.
export { juntarMensagem, JANELA_DO_MESMO_CHAMADO_H };

@Injectable()
export class AtendimentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly delivery: DeliveryService,
    // Quem passou o caso para quem fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // Abre um chamado (handoff do robô → humano). Dispara alerta em tempo real.
  async abrir(tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
    return abrirChamado(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
  }

  /**
   * Chamado aberto PELO ROBÔ. Se o mesmo cliente (pela chave do telefone: com/sem 55 e nono dígito) já tem um chamado
   * aberto nas últimas 12 h, é o mesmo pedido de ajuda: não abre outro (a IA às vezes chama duas vezes na mesma
   * resposta). O que chega é somado ao aberto: a mensagem nova vai junto, e `urgente` SOBE a prioridade (nunca desce) —
   * aí a tela é avisada de novo, porque mudou o que a equipe precisa ver.
   * Exceção: um pedido de CANCELAMENTO ou MUDANÇA ligado a um pedido, quando o aberto é de outro tipo, abre o seu
   * próprio chamado — o botão "Aceitar cancelamento" depende do tipo e do pedido do chamado.
   * Sem telefone, abre sempre (não há como saber se é o mesmo cliente). Duas chamadas no mesmo instante ainda podem abrir
   * dois — nenhum índice impede; o pior caso é um chamado a mais no painel.
   */
  async abrirPeloRobo(tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
    return abrirChamadoPeloRobo(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
  }

  // Urgente primeiro (cliente irritado espera menos); dentro de cada grupo, o mais novo em cima — como sempre foi.
  listar(tenantId: string, status = 'aberto') {
    return this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.status, status)))
      .orderBy(sql`(${atendimentoChamado.prioridade} = 'urgente') desc`, desc(atendimentoChamado.criadoEm))
      .limit(100);
  }

  async resolver(tenantId: string, id: string, atorId: string) {
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({ status: 'resolvido', resolvidoPorId: atorId, resolvidoEm: new Date(), aguardandoDesde: null })
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, id)))
      .returning();
    if (!row) throw new NotFoundException('Chamado não encontrado');
    this.avisar(tenantId, id, 'resolveu');
    return { ok: true };
  }

  // ===================== A FILA (central de atendimento, Onda 1) =====================

  /** Avisa as telas (tempo real): o caso mudou — elas relêem a fila. */
  private avisar(tenantId: string, id: string, motivo: string) {
    this.events.emit('atendimento.mudou', { tenantId, id, motivo });
  }

  /**
   * A FILA da central: os casos ABERTOS da loja em uso (e os sem loja — o robô do WhatsApp atende a empresa toda), na
   * ordem da fila (prazo vencendo, urgente, quem espera há mais tempo), com a posição de quem espera uma pessoa e o
   * pedido ligado (situação e o número na plataforma). As CONTAGENS vêm do banco, não da lista (que tem limite — V39).
   */
  async fila(user: AuthUser, unidadeAtual: string | null) {
    const loja = sqlUnidadeOuRede('c.unidade_id', unidadeAtual);
    const r: any = await this.db.execute(sql`
      select c.id, c.tipo, c.canal, c.cliente, c.telefone, c.mensagem, c.prioridade, c.status, c.decisao,
             c.pedido_id as "pedidoId", c.pedido_numero as "pedidoNumero", c.unidade_id as "unidadeId",
             c.responsavel_id as "responsavelId", c.pego_em as "pegoEm", c.aguardando_desde as "aguardandoDesde",
             c.prazo_em as "prazoEm", c.criado_em as "criadoEm",
             r.nome as "responsavelNome",
             p.canal as "pedidoCanal", p.status as "pedidoStatus", p.display_id as "pedidoNaPlataforma",
             p.cliente_nome as "pedidoCliente"
        from atendimento_chamado c
        left join colaborador r on r.id = c.responsavel_id and r.tenant_id = c.tenant_id
        left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
       where c.tenant_id = ${user.tenantId} and c.status = 'aberto' ${loja}
       order by (c.prazo_em is null), c.prazo_em, (c.prioridade = 'urgente') desc, c.criado_em
       limit ${LIMITE_DA_FILA}`);
    const casos = posicoes((r.rows ?? r) as any[]).map((c) => ({ ...c, canal: canalDoCaso(c), situacao: situacaoDo(c) }));
    // `eu`: quem pediu a fila — a tela marca "Comigo" e "você" sem ler o token (na nuvem a sessão é um cookie httpOnly).
    return { casos, contagens: await this.contagens(user, loja), limite: LIMITE_DA_FILA, eu: user.colaboradorId ?? null };
  }

  /** Os casos resolvidos HOJE (dia da operação, não da sessão do banco — ERR-120), os mais recentes primeiro. */
  async resolvidosHoje(user: AuthUser, unidadeAtual: string | null) {
    const loja = sqlUnidadeOuRede('c.unidade_id', unidadeAtual);
    const r: any = await this.db.execute(sql`
      select c.id, c.tipo, c.canal, c.cliente, c.telefone, c.mensagem, c.prioridade, c.status, c.decisao,
             c.pedido_id as "pedidoId", c.pedido_numero as "pedidoNumero", c.criado_em as "criadoEm",
             c.resolvido_em as "resolvidoEm", q.nome as "resolvidoPorNome",
             p.canal as "pedidoCanal", p.status as "pedidoStatus", p.display_id as "pedidoNaPlataforma"
        from atendimento_chamado c
        left join colaborador q on q.id = c.resolvido_por_id and q.tenant_id = c.tenant_id
        left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
       where c.tenant_id = ${user.tenantId} and c.status = 'resolvido' ${loja}
         and c.resolvido_em >= ${instanteDe(hojeISO())}
       order by c.resolvido_em desc
       limit ${LIMITE_DA_FILA}`);
    return ((r.rows ?? r) as any[]).map((c) => ({ ...c, canal: canalDoCaso(c), situacao: 'resolvido' as const }));
  }

  /**
   * A EQUIPE para "Passar o caso": as pessoas ATIVAS da loja em uso (e as sem loja), só id e nome — o mínimo, para quem
   * atende sem a permissão do cadastro de colaboradores. O presidente na rede vê todas. Em ordem de nome.
   */
  async equipe(user: AuthUser, unidadeAtual: string | null) {
    const r: any = await this.db.execute(sql`
      select c.id, c.nome from colaborador c
       where c.tenant_id = ${user.tenantId} and c.status = 'ativo' and c.deleted_at is null
             ${sqlUnidadeOuRede('c.unidade_id', unidadeAtual)}
       order by c.nome
       limit ${LIMITE_DA_FILA}`);
    return ((r.rows ?? r) as Array<{ id: string; nome: string }>).map((p) => ({ ...p, eu: p.id === user.colaboradorId }));
  }

  private async contagens(user: AuthUser, loja: ReturnType<typeof sqlUnidadeOuRede>) {
    const desdeHoje = instanteDe(hojeISO());
    const r: any = await this.db.execute(sql`
      select count(*) filter (where c.status = 'aberto')::int as abertos,
             count(*) filter (where c.status = 'aberto' and c.prazo_em is not null)::int as "comPrazo",
             count(*) filter (where c.status = 'aberto' and c.prazo_em is null and c.responsavel_id is null
                                and c.aguardando_desde is null)::int as "naFila",
             count(*) filter (where c.status = 'aberto' and c.responsavel_id = ${user.colaboradorId ?? null})::int as comigo,
             count(*) filter (where c.status = 'aberto' and c.aguardando_desde is not null)::int as aguardando,
             count(*) filter (where c.status = 'resolvido')::int as "resolvidosHoje"
        from atendimento_chamado c
       where c.tenant_id = ${user.tenantId} ${loja}
         and (c.status = 'aberto' or c.resolvido_em >= ${desdeHoje})`);
    return (r.rows ?? r)[0];
  }

  /** Por que o caso não mudou: sumiu (404), já foi resolvido (409) ou outra pessoa pegou (409, com o nome). */
  private async motivoDeNaoMexer(tenantId: string, id: string) {
    const r: any = await this.db.execute(sql`
      select c.status, r.nome from atendimento_chamado c
        left join colaborador r on r.id = c.responsavel_id and r.tenant_id = c.tenant_id
       where c.tenant_id = ${tenantId} and c.id = ${id}`);
    const c = (r.rows ?? r)[0];
    if (!c) return new NotFoundException('Caso não encontrado.');
    if (c.status !== 'aberto') return new ConflictException('Este caso já foi resolvido.');
    return new ConflictException(`${c.nome ?? 'Outra pessoa'} já pegou este caso.`);
  }

  /**
   * PEGAR o caso para mim. Só o que está aberto e sem ninguém (ou já meu — repetir não muda a hora em que peguei). Duas
   * pessoas no mesmo instante: a gravação é condicional, só uma pega; a outra recebe "Fulano já pegou este caso".
   */
  async pegar(user: AuthUser, id: string) {
    const eu = user.colaboradorId;
    if (!eu) throw new ForbiddenException('Entre com o seu usuário para pegar o caso.');
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({
        responsavelId: eu,
        pegoEm: sql`case when ${atendimentoChamado.responsavelId} = ${eu} then ${atendimentoChamado.pegoEm} else now() end` as any,
      })
      .where(
        and(
          eq(atendimentoChamado.tenantId, user.tenantId),
          eq(atendimentoChamado.id, id),
          eq(atendimentoChamado.status, 'aberto'),
          or(isNull(atendimentoChamado.responsavelId), eq(atendimentoChamado.responsavelId, eu)),
        ),
      )
      .returning();
    if (!row) throw await this.motivoDeNaoMexer(user.tenantId, id);
    this.avisar(user.tenantId, id, 'pegou');
    return { ok: true, id, responsavelId: eu };
  }

  /**
   * PASSAR o caso para outra pessoa da equipe (ativa) ou de volta para a fila (`para` vazio). A execução só passa o que
   * é dela ou está sem ninguém; a gestão passa qualquer um. Gravação condicional: se o caso mudou de mãos enquanto a
   * pessoa escolhia, nada muda (409). Fica na auditoria (de quem → para quem).
   */
  async passar(user: AuthUser, id: string, dto: { para?: string | null } | null | undefined) {
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const para = dto?.para ? String(dto.para) : null;
    if (para && !UUID_RE.test(para)) throw new BadRequestException('Escolha para quem passar o caso.');
    const [caso] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!caso) throw new NotFoundException('Caso não encontrado.');
    if (caso.status !== 'aberto') throw new ConflictException('Este caso já foi resolvido.');
    if (user.categoria === 'execucao' && caso.responsavelId && caso.responsavelId !== user.colaboradorId)
      throw new ForbiddenException('Só a gestão passa o caso de outra pessoa.');
    if (para) {
      const ok: any = await this.db.execute(sql`
        select 1 from colaborador
         where id = ${para} and tenant_id = ${user.tenantId} and status = 'ativo' and deleted_at is null`);
      if (!(ok.rows ?? ok).length) throw new BadRequestException('Essa pessoa não está ativa na equipe.');
    }
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({ responsavelId: para, pegoEm: para ? new Date() : null })
      .where(
        and(
          eq(atendimentoChamado.tenantId, user.tenantId),
          eq(atendimentoChamado.id, id),
          eq(atendimentoChamado.status, 'aberto'),
          caso.responsavelId ? eq(atendimentoChamado.responsavelId, caso.responsavelId) : isNull(atendimentoChamado.responsavelId),
        ),
      )
      .returning();
    if (!row) throw new ConflictException('O caso mudou enquanto você passava. Abra de novo e tente.');
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: caso.unidadeId ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'atendimento',
      acao: para ? 'passou_caso' : 'devolveu_caso_para_fila',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: id,
      detalhe: { de: caso.responsavelId ?? null, para },
      origem: 'web',
    });
    this.avisar(user.tenantId, id, 'passou');
    return { ok: true, id, responsavelId: para };
  }

  /**
   * "AGUARDANDO O CLIENTE" (ou não). Quem marca fica com o caso, se ninguém tinha. Quando o cliente responde no WhatsApp,
   * o caso volta sozinho para a fila (`clienteRespondeu`, na entrada da mensagem).
   */
  async aguardar(user: AuthUser, id: string, dto: { aguardando?: unknown } | null | undefined) {
    const aguardando = exigirBooleano(dto?.aguardando, 'aguardando');
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const eu = user.colaboradorId ?? null;
    const set: Record<string, unknown> = aguardando
      ? {
          aguardandoDesde: new Date(),
          responsavelId: sql`coalesce(${atendimentoChamado.responsavelId}, ${eu}::uuid)`,
          pegoEm: sql`coalesce(${atendimentoChamado.pegoEm}, now())`,
        }
      : { aguardandoDesde: null };
    const [row] = await this.db
      .update(atendimentoChamado)
      .set(set as any)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id), eq(atendimentoChamado.status, 'aberto')))
      .returning();
    if (!row) throw await this.motivoDeNaoMexer(user.tenantId, id);
    this.avisar(user.tenantId, id, aguardando ? 'aguardando' : 'voltou_para_fila');
    return { ok: true, id, aguardando };
  }

  // Veredito do cancelamento pedido pelo cliente. `aceita` cancela o pedido de
  // fato (delegando ao Delivery, que exige senha de gestor); senão só encerra o
  // chamado marcando a decisão como recusada.
  async decidirCancelamento(
    user: AuthUser,
    id: string,
    dto: { aceita?: boolean; senha?: string; motivo?: string; reaproveitado?: boolean; perdaItens?: unknown },
    terminalId: string | null = null,
  ) {
    const [row] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!row) throw new NotFoundException('Chamado não encontrado');
    if (row.tipo !== 'cancelamento') {
      throw new BadRequestException('Este chamado não é um pedido de cancelamento.');
    }

    let comprovante: { enfileirados: number; aviso: string | null } | undefined;
    if (dto.aceita) {
      if (!row.pedidoId) throw new BadRequestException('Chamado sem pedido vinculado.');
      // Delega ao Delivery (valida a senha do gestor, estorna financeiro/fidelidade, imprime o comprovante). O destino
      // dos insumos vem da tela, como no cancelamento do painel (ERR-339): antes ia `true` fixo — todo cancelamento pelo
      // chamado gravava "reaproveitado" e escondia o "Registrar perda" depois.
      const cancelado: any = await this.delivery.cancelar(
        user.tenantId,
        user.colaboradorId,
        user.categoria,
        row.pedidoId,
        String(dto.motivo ?? '').trim() || 'Cancelamento solicitado pelo cliente',
        dto.senha,
        dto.reaproveitado !== false,
        terminalId,
        lerItensDaPerda(dto.perdaItens),
      );
      comprovante = cancelado?.comprovante;
    }

    await this.db
      .update(atendimentoChamado)
      .set({
        status: 'resolvido',
        decisao: dto.aceita ? 'aceito' : 'recusado',
        resolvidoPorId: user.colaboradorId,
        resolvidoEm: new Date(),
        aguardandoDesde: null,
      })
      .where(eq(atendimentoChamado.id, id));
    this.avisar(user.tenantId, id, 'resolveu');
    return { ok: true, decisao: dto.aceita ? 'aceito' : 'recusado', ...(comprovante ? { comprovante } : {}) };
  }
}

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
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Food99Service } from '../integracoes/food99/food99.service';
import {
  Ajuste99,
  HORAS_PERMITIDAS,
  PedidoDoCliente99,
  motivoDaRecusaAutomatica,
} from '../integracoes/food99/food99-pedido-cliente';
import { autorizarPorPinDoUsuario, autorizarPorSenhaDeGestor, NIVEIS_DA_PLATAFORMA } from '../../common/autorizacao-gestor';
import { ehServidorLocal } from '../../common/modo';
import { exigirBooleano } from '../../common/exigir';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DA LOJA AO PEDIDO DE CANCELAMENTO OU REEMBOLSO DO CLIENTE DA 99 (central de atendimento, Onda 1, PR 3). Só
// gerente e presidente respondem (decisão do dono, 01/11/2026), com a senha de quem decide. A recusa leva o motivo da LISTA
// que veio no aviso (doc oficial: Handle Cancellation/Refund Requests) — foto na recusa não existe na integração. Quem fala
// com a 99 é a NUVEM; no servidor da loja, a senha é conferida aqui e o pedido vai à nuvem (V37).
// A ROTINA da nuvem (a cada minuto): cancelamento sem resposta no prazo = a 99 recusou sozinha (regra dela, 5 min) — o caso
// fecha assim; reembolso sem resposta no tempo do ajuste = o REGEM recusa com o motivo do ajuste (decisão do dono, 02/11).

export type RespostaAo99 = { aceita?: unknown; motivo?: string; motivoId?: string; explicacao?: string; senha?: string; pin?: string };

type Caso99 = { id: string; unidadeId: string | null; status: string; tipo: string; prazoEm: Date | null; detalhe: any };

/**
 * Confere a resposta contra o que a 99 mandou NESTE pedido. Regra pura: o que a 99 não aceitaria é recusado aqui, com o
 * motivo, antes de ir até ela. Devolve o que mandar e o resumo para o caso.
 */
export function montarRespostaAo99(p: PedidoDoCliente99, r: RespostaAo99) {
  const aceita = exigirBooleano(r.aceita, 'aceita');
  const explicacao = String(r.explicacao ?? '').trim().slice(0, 200) || null;
  if (aceita) return { aceita, motivo: null as string | null, recusa: undefined, resumo: { acao: 'aceitar' } };
  if (p.tipo === 'cancelamento') {
    const motivo = String(r.motivo ?? '');
    if (p.motivosDeRecusa.length && !p.motivosDeRecusa.includes(motivo)) throw new BadRequestException('Escolha o motivo da recusa na lista da 99.');
    if (!motivo) throw new BadRequestException('Escolha o motivo da recusa.');
    return { aceita, motivo, recusa: undefined, resumo: { acao: 'recusar', motivo } };
  }
  const base = p.motivosDoReembolso.find((m) => m.id === String(r.motivoId ?? ''));
  if (!base) throw new BadRequestException('Escolha o motivo da recusa na lista da 99.');
  return {
    aceita,
    motivo: base.motivo,
    recusa: { baseId: base.id, base: base.motivo, explicacao },
    resumo: { acao: 'recusar', motivo: base.motivo, motivoId: base.id, explicacao },
  };
}

@Injectable()
export class Pedido99Service {
  private readonly logger = new Logger('Pedido99');
  private rodando = false;
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly food99: Food99Service,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async carregar(tenantId: string, id: string): Promise<Caso99> {
    const r: any = await this.db.execute(sql`
      select id, unidade_id as "unidadeId", status, tipo, prazo_em as "prazoEm", detalhe
        from atendimento_chamado where tenant_id = ${tenantId} and id = ${id} and canal = '99food'`);
    const c = (r.rows ?? r)[0];
    if (!c || !['cancelamento_99', 'reembolso_99'].includes(c.tipo) || !c.detalhe?.pedido99) throw new NotFoundException('Pedido da 99 não encontrado.');
    return c;
  }

  private conferirAberto(c: Caso99) {
    if (c.detalhe?.resposta || c.status !== 'aberto') throw new ConflictException('Este pedido da 99 já foi respondido.');
    if (c.detalhe?.recusaAutomatica) throw new ConflictException('O Regem já está recusando este reembolso (o tempo do ajuste acabou).');
    if (c.tipo === 'cancelamento_99' && c.prazoEm && new Date(c.prazoEm).getTime() <= Date.now())
      throw new ConflictException('O prazo da 99 acabou: ela já recusou o cancelamento sozinha.');
  }

  /** A tela responde: confere a senha de gerente/presidente e responde (aqui ou pela nuvem). */
  async responder(user: AuthUser, id: string, dto: RespostaAo99) {
    const c = await this.carregar(user.tenantId, id);
    this.conferirAberto(c);
    montarRespostaAo99(c.detalhe.pedido99, dto ?? {}); // confere antes de pedir a senha
    // No computador, a senha de quem decide; no app (mig 353), o PIN de quem está nele.
    const quem = dto?.pin
      ? await autorizarPorPinDoUsuario(this.db, user.tenantId, user.colaboradorId, dto.pin, NIVEIS_DA_PLATAFORMA)
      : await autorizarPorSenhaDeGestor(this.db, user.tenantId, dto?.senha, NIVEIS_DA_PLATAFORMA);
    if (ehServidorLocal()) return this.responderPelaNuvem(user, c, dto, quem);
    return this.enviar(user.tenantId, c, dto, quem, user.colaboradorId ?? null, user.categoria ?? null);
  }

  /** Na NUVEM, vindo do servidor da loja (a senha já foi conferida lá). */
  async responderVindoDaLoja(tenantId: string, dto: RespostaAo99 & { chamadoId?: string; liberadorId?: string; liberadorNome?: string; atorId?: string }) {
    const c = await this.carregar(tenantId, String(dto?.chamadoId ?? ''));
    this.conferirAberto(c);
    const quem = { id: String(dto?.liberadorId ?? ''), nome: String(dto?.liberadorNome ?? 'Gestor da loja') };
    return this.enviar(tenantId, c, dto, quem, dto?.atorId ?? null, null, 'servidor_local');
  }

  private async enviar(tenantId: string, c: Caso99, dto: RespostaAo99, quem: { id: string; nome: string }, atorId: string | null, atorPerfil: string | null, origem = 'web') {
    const p: PedidoDoCliente99 = c.detalhe.pedido99;
    const m = montarRespostaAo99(p, dto ?? {});
    const ig = await this.food99.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('A 99 não está conectada nesta empresa.');
    const r =
      p.tipo === 'cancelamento'
        ? await this.food99.responderCancelamento(ig, p.pedidoExterno, p.applyId, m.aceita, m.motivo ?? undefined)
        : await this.food99.responderReembolso(ig, p.pedidoExterno, p.applyId, m.aceita, m.recusa);
    if (!r.ok) throw new BadGatewayException(`A 99 não aceitou a resposta${r.errmsg ? `: ${r.errmsg}` : ' agora. Tente de novo.'}`);
    const resposta = { ...m.resumo, por: quem.nome, porId: quem.id || null, em: new Date().toISOString() };
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(resposta)}::jsonb),
             status = 'resolvido', decisao = ${m.aceita ? 'aceito' : 'recusado'},
             resolvido_por_id = ${quem.id || null}, resolvido_em = now(), prazo_em = null, aguardando_desde = null
       where tenant_id = ${tenantId} and id = ${c.id}`);
    await this.auditoria?.registrar({
      tenantId,
      unidadeId: c.unidadeId ?? null,
      atorId,
      atorPerfil,
      tipo: 'atendimento',
      acao: 'respondeu_pedido_99',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: c.id,
      detalhe: { tipo: p.tipo, ...m.resumo, liberadoPor: quem.id || null, pedido99: p.pedidoExterno },
      origem,
    });
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_pedido_99' });
    return { ok: true, resposta };
  }

  private async responderPelaNuvem(user: AuthUser, c: Caso99, dto: RespostaAo99, quem: { id: string; nome: string }) {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: a resposta à 99 sai de lá.');
    const { senha: _senha, pin: _pin, ...semSenha } = dto ?? {};
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/pedido99-da-loja`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': token },
        body: JSON.stringify({ ...semSenha, chamadoId: c.id, liberadorId: quem.id, liberadorNome: quem.nome, atorId: user.colaboradorId ?? null }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`resposta à 99 ${c.id}: a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      if (res.status === 409) throw new ConflictException(msg);
      if (res.status === 404) throw new NotFoundException(msg);
      if (res.status === 400) throw new BadRequestException(msg);
      throw new BadGatewayException(msg);
    }
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(j?.resposta ?? {})}::jsonb),
             status = 'resolvido', resolvido_em = now(), prazo_em = null, aguardando_desde = null
       where tenant_id = ${user.tenantId} and id = ${c.id}`);
    this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: c.id, motivo: 'respondeu_pedido_99' });
    return { ok: true, resposta: j?.resposta ?? null };
  }

  // ===================== Ajustes (Delivery › Configurações › Atendimento) =====================

  async ajustes(tenantId: string) {
    const ig = await this.food99.integracaoDoTenant(tenantId);
    return { conectado99: !!ig, ajuste99: ig ? this.food99.ajusteDoAtendimento(ig) : null, horasPermitidas: HORAS_PERMITIDAS };
  }

  /** Salva o que veio (o que não veio fica — V16); liga/desliga só com true/false (V15). Fica na auditoria. */
  async salvarAjustes(user: AuthUser, dto: { ajuste99?: Partial<Record<keyof Ajuste99, unknown>> } | null | undefined) {
    const a = dto?.ajuste99 ?? {};
    const parcial: Partial<Ajuste99> = {};
    if (a.decidirCancelamento !== undefined) parcial.decidirCancelamento = exigirBooleano(a.decidirCancelamento, 'decidirCancelamento');
    if (a.reembolsoRecusarEmHoras !== undefined) {
      const h = Number(a.reembolsoRecusarEmHoras);
      if (!(HORAS_PERMITIDAS as readonly number[]).includes(h)) throw new BadRequestException(`Escolha ${HORAS_PERMITIDAS.join(', ')} horas.`);
      parcial.reembolsoRecusarEmHoras = h;
    }
    if (a.reembolsoMotivo !== undefined) parcial.reembolsoMotivo = String(a.reembolsoMotivo ?? '').trim().slice(0, 120) || 'Other';
    if (a.reembolsoExplicacao !== undefined) parcial.reembolsoExplicacao = String(a.reembolsoExplicacao ?? '').trim().slice(0, 200);
    const antes = await this.ajustes(user.tenantId);
    const novo = await this.food99.salvarAjusteDoAtendimento(user.tenantId, parcial);
    if (!novo) throw new BadRequestException('A 99 não está conectada nesta empresa.');
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId ?? null,
      atorPerfil: user.categoria ?? null,
      tipo: 'atendimento',
      acao: 'ajustou_atendimento_99',
      entidadeTipo: 'integracao',
      detalhe: { de: antes.ajuste99, para: novo },
      origem: 'web',
    });
    return { conectado99: true, ajuste99: novo, horasPermitidas: HORAS_PERMITIDAS };
  }

  // ===================== A rotina da nuvem =====================

  @Interval(60_000)
  async tick() {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.fecharCancelamentosVencidos();
      await this.recusarReembolsosVencidos();
      await this.fecharReembolsosSemMotivoVencidos();
    } catch (e: any) {
      this.logger.warn(`rotina dos pedidos da 99: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Cancelamento sem resposta no prazo: a 99 recusou sozinha (regra dela). Uma consulta para todas as lojas. */
  async fecharCancelamentosVencidos(): Promise<number> {
    const r: any = await this.db.execute(sql`
      update atendimento_chamado
         set status = 'resolvido', decisao = 'recusado_pela_99', resolvido_em = now(), prazo_em = null, aguardando_desde = null,
             detalhe = coalesce(detalhe, '{}'::jsonb)
                       || jsonb_build_object('encerramento', jsonb_build_object('status', 'RECUSADO_PELA_99', 'em', now()))
       where canal = '99food' and tipo = 'cancelamento_99' and status = 'aberto' and prazo_em <= now()
       returning tenant_id as "tenantId", id`);
    const linhas = (r.rows ?? r) as Array<{ tenantId: string; id: string }>;
    for (const l of linhas) this.events.emit('atendimento.mudou', { tenantId: l.tenantId, id: l.id, motivo: 'recusado_pela_99' });
    return linhas.length;
  }

  /**
   * Reembolso que o Regem não pôde recusar (a 99 não mandou a lista de motivos) e que ninguém respondeu nas 24 h da 99: a
   * 99 reembolsou sozinha (regra dela). Fecha o caso para não ficar aberto para sempre.
   */
  async fecharReembolsosSemMotivoVencidos(): Promise<number> {
    const r: any = await this.db.execute(sql`
      update atendimento_chamado
         set status = 'resolvido', decisao = 'reembolsado_pela_99', resolvido_em = now(), prazo_em = null, aguardando_desde = null,
             detalhe = detalhe || jsonb_build_object('encerramento', jsonb_build_object('status', 'REEMBOLSADO_PELA_99', 'em', now()))
       where canal = '99food' and tipo = 'reembolso_99' and status = 'aberto' and prazo_em <= now()
         and coalesce(detalhe, '{}'::jsonb) ? 'semMotivoParaRecusar' and not (detalhe ? 'resposta')
       returning tenant_id as "tenantId", id`);
    const linhas = (r.rows ?? r) as Array<{ tenantId: string; id: string }>;
    for (const l of linhas) this.events.emit('atendimento.mudou', { tenantId: l.tenantId, id: l.id, motivo: 'reembolsado_pela_99' });
    return linhas.length;
  }

  /**
   * Reembolso sem resposta no tempo do ajuste: o Regem recusa com o motivo do ajuste (da lista deste pedido). Marca "estou
   * recusando" ANTES de chamar a 99 (V42: o efeito para fora tem dono e registro); falhou, desmarca e tenta no minuto
   * seguinte (a 99 só reembolsa sozinha em 24 h; o ajuste vai até 20 h).
   */
  async recusarReembolsosVencidos(): Promise<number> {
    const r: any = await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('recusaAutomatica', jsonb_build_object('em', now()))
       where id in (select id from atendimento_chamado
                     where canal = '99food' and tipo = 'reembolso_99' and status = 'aberto' and prazo_em <= now()
                       and not (coalesce(detalhe, '{}'::jsonb) ? 'recusaAutomatica') and not (coalesce(detalhe, '{}'::jsonb) ? 'resposta')
                       and not (coalesce(detalhe, '{}'::jsonb) ? 'semMotivoParaRecusar')
                     order by prazo_em limit 50)
       returning tenant_id as "tenantId", id, unidade_id as "unidadeId", detalhe`);
    let feitos = 0;
    for (const c of (r.rows ?? r) as any[]) {
      const p: PedidoDoCliente99 = c.detalhe?.pedido99;
      const desmarcar = () =>
        this.db.execute(sql`update atendimento_chamado set detalhe = detalhe - 'recusaAutomatica' where id = ${c.id} and status = 'aberto'`);
      try {
        const ig = await this.food99.integracaoDoTenant(c.tenantId);
        if (!ig || !p) {
          await desmarcar();
          continue;
        }
        const ajuste = this.food99.ajusteDoAtendimento(ig);
        const motivo = motivoDaRecusaAutomatica(p.motivosDoReembolso ?? [], ajuste);
        if (!motivo) {
          // Sem a lista, a recusa não vale para a 99: o caso fica para uma pessoa (aceitar aqui ou recusar pelo app da
          // 99). Troca a marca por "sem motivo" — com a marca de "recusando", ninguém conseguiria responder — e o prazo
          // passa a ser o da 99 (24 h depois do pedido, quando ela reembolsa sozinha).
          this.logger.warn(`reembolso 99 ${p.pedidoExterno}: a 99 não mandou motivos de recusa — fica para uma pessoa`);
          await this.db.execute(sql`
            update atendimento_chamado
               set detalhe = (detalhe - 'recusaAutomatica') || '{"semMotivoParaRecusar": true}'::jsonb,
                   prazo_em = greatest(criado_em + interval '24 hours', now())
             where id = ${c.id} and status = 'aberto'`);
          this.events.emit('atendimento.mudou', { tenantId: c.tenantId, id: c.id, motivo: 'reembolso_99_sem_motivo' });
          continue;
        }
        const res = await this.food99.responderReembolso(ig, p.pedidoExterno, p.applyId, false, {
          baseId: motivo.id,
          base: motivo.motivo,
          explicacao: ajuste.reembolsoExplicacao || null,
        });
        if (!res.ok) {
          this.logger.warn(`reembolso 99 ${p.pedidoExterno}: a 99 recusou a recusa automática (errno ${res.errno}) — tenta de novo`);
          await desmarcar();
          continue;
        }
        const resposta = { acao: 'recusar', motivo: motivo.motivo, motivoId: motivo.id, explicacao: ajuste.reembolsoExplicacao || null, automatico: true, em: new Date().toISOString() };
        await this.db.execute(sql`
          update atendimento_chamado
             set detalhe = detalhe || jsonb_build_object('resposta', ${JSON.stringify(resposta)}::jsonb),
                 status = 'resolvido', decisao = 'recusado_automatico', resolvido_em = now(), prazo_em = null, aguardando_desde = null
           where id = ${c.id}`);
        await this.auditoria?.registrar({
          tenantId: c.tenantId,
          unidadeId: c.unidadeId ?? null,
          atorTipo: 'sistema',
          tipo: 'atendimento',
          acao: 'recusou_reembolso_99_automatico',
          entidadeTipo: 'atendimento_chamado',
          entidadeId: c.id,
          detalhe: { motivo: motivo.motivo, motivoId: motivo.id, pedido99: p.pedidoExterno },
          origem: 'sistema',
        } as any);
        this.events.emit('atendimento.mudou', { tenantId: c.tenantId, id: c.id, motivo: 'recusou_reembolso_99' });
        feitos++;
      } catch (e: any) {
        this.logger.warn(`reembolso 99 ${c.id}: ${e?.message ?? e} — tenta de novo`);
        await desmarcar().catch(() => undefined);
      }
    }
    return feitos;
  }
}

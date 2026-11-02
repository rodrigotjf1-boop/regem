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
import { AuditoriaService } from '../auditoria/auditoria.service';
import { IfoodService } from '../integracoes/ifood/ifood.service';
import { autorizarPorSenhaDeGestor, NIVEIS_DA_PLATAFORMA } from '../../common/autorizacao-gestor';
import { ehServidorLocal } from '../../common/modo';
import type { DisputaIfood } from '../integracoes/ifood/ifood-disputa';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DA LOJA À DISPUTA DO iFOOD (central de atendimento, Onda 1, PR 2). Só gerente e presidente respondem (decisão
// do dono, 01/11/2026), com a senha de quem decide — o computador da loja é de uso comum. A resposta é UMA por disputa
// (o iFood recusa a segunda) e segue a documentação oficial (V20): aceitar com um dos motivos que o iFood mandou nesta
// disputa; recusar com um dos motivos da lista do iFood; propor só o que o iFood ofereceu (devolver parte do valor ou
// crédito até o limite; mais tempo nos minutos e motivos permitidos). Quem fala com o iFood é a NUVEM (a credencial fica lá):
// no servidor da loja, a senha é conferida aqui e o pedido vai à nuvem pelo token do servidor (V37).

/** Os motivos de recusa que o iFood aceita (`negotiationReasons`, doc oficial). */
export const MOTIVOS_DE_RECUSA_IFOOD = [
  'HIGH_STORE_DEMAND',
  'UNKNOWN_ISSUE',
  'CUSTOMER_SATISFACTION',
  'INVENTORY_CHECK',
  'SYSTEM_ISSUE',
  'WRONG_ORDER',
  'PRODUCT_QUALITY',
  'LATE_DELIVERY',
  'CUSTOMER_REQUEST',
] as const;

export type RespostaDaDisputa = {
  acao?: 'aceitar' | 'recusar' | 'propor';
  motivo?: string;
  detalhe?: string;
  tipo?: 'REFUND' | 'BENEFIT' | 'ADDITIONAL_TIME';
  centavos?: number;
  minutos?: number;
  senha?: string;
};

type PedidoAoIfood = { acao: 'accept' | 'reject' | 'alternative'; corpo: Record<string, unknown>; resumo: Record<string, unknown> };

/**
 * Confere a resposta contra o que o iFood mandou NESTA disputa e monta o pedido da API. Regra pura (os testes conferem
 * cada recusa sozinha): o que o iFood não aceitaria é recusado aqui, com o motivo, antes de gastar a única resposta.
 */
export function montarRespostaAoIfood(d: DisputaIfood, r: RespostaDaDisputa): PedidoAoIfood {
  const detalhe = String(r.detalhe ?? '').trim().slice(0, 200) || undefined;
  if (r.acao === 'aceitar') {
    const motivos = d.motivosParaAceitar ?? [];
    const motivo = String(r.motivo ?? '');
    if (motivos.length && !motivos.includes(motivo)) throw new BadRequestException('Escolha um dos motivos que o iFood aceita nesta disputa.');
    const corpo: Record<string, unknown> = motivo ? { reason: motivo } : {};
    if (detalhe) corpo.detailReason = detalhe;
    return { acao: 'accept', corpo, resumo: { acao: 'aceitar', motivo: motivo || null, detalhe: detalhe ?? null } };
  }
  if (r.acao === 'recusar') {
    const motivo = String(r.motivo ?? '');
    if (!(MOTIVOS_DE_RECUSA_IFOOD as readonly string[]).includes(motivo)) throw new BadRequestException('Escolha o motivo da recusa na lista do iFood.');
    return { acao: 'reject', corpo: { reason: motivo }, resumo: { acao: 'recusar', motivo } };
  }
  if (r.acao === 'propor') {
    const alt = (d.alternativas ?? []).find((a) => a.tipo === r.tipo);
    if (!alt) throw new BadRequestException('O iFood não oferece esta proposta nesta disputa.');
    if (alt.tipo === 'REFUND' || alt.tipo === 'BENEFIT') {
      const v = Math.round(Number(r.centavos));
      if (!Number.isFinite(v) || v <= 0) throw new BadRequestException('Informe o valor da proposta.');
      if (alt.maxCentavos != null && v > alt.maxCentavos)
        throw new BadRequestException(`O iFood aceita no máximo ${(alt.maxCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} nesta disputa.`);
      return {
        acao: 'alternative',
        corpo: { type: alt.tipo, metadata: { amount: { value: String(v), currency: 'BRL' } } },
        resumo: { acao: 'propor', tipo: alt.tipo, centavos: v },
      };
    }
    if (alt.tipo === 'ADDITIONAL_TIME') {
      const min = Math.round(Number(r.minutos));
      if (!alt.minutos.includes(min)) throw new BadRequestException(`Escolha ${alt.minutos.join(', ')} minutos.`);
      const motivo = String(r.motivo ?? '');
      if (alt.motivos.length && !alt.motivos.includes(motivo)) throw new BadRequestException('Escolha o motivo do atraso na lista do iFood.');
      return {
        acao: 'alternative',
        corpo: { type: 'ADDITIONAL_TIME', metadata: { additionalTimeInMinutes: min, ...(motivo ? { reason: motivo } : {}) } },
        resumo: { acao: 'propor', tipo: 'ADDITIONAL_TIME', minutos: min, motivo: motivo || null },
      };
    }
    throw new BadRequestException('Proposta desconhecida.');
  }
  throw new BadRequestException('Escolha aceitar, recusar ou propor.');
}

/** A decisão gravada no caso, conforme a resposta. */
const DECISAO = { aceitar: 'aceito', recusar: 'recusado', propor: 'proposta' } as const;

@Injectable()
export class DisputaIfoodService {
  private readonly logger = new Logger('DisputaIfood');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ifood: IfoodService,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async carregar(tenantId: string, id: string) {
    const r: any = await this.db.execute(sql`
      select id, unidade_id as "unidadeId", status, tipo, canal, externo_id as "externoId", prazo_em as "prazoEm", detalhe
        from atendimento_chamado where tenant_id = ${tenantId} and id = ${id}`);
    const c = (r.rows ?? r)[0];
    if (!c || c.tipo !== 'disputa' || c.canal !== 'ifood' || !c.detalhe?.disputa) throw new NotFoundException('Disputa não encontrada.');
    return c as { id: string; unidadeId: string | null; status: string; externoId: string; prazoEm: Date | null; detalhe: any };
  }

  /** O que impede responder: já respondida, já encerrada ou prazo vencido. */
  private conferirAberta(c: { status: string; prazoEm: Date | null; detalhe: any }) {
    if (c.detalhe?.resposta) throw new ConflictException('Esta disputa já foi respondida.');
    if (c.status !== 'aberto' || c.detalhe?.encerramento) throw new ConflictException('O iFood já encerrou esta disputa.');
    if (c.prazoEm && new Date(c.prazoEm).getTime() <= Date.now()) throw new ConflictException('O prazo do iFood acabou: ele já decidiu sozinho.');
  }

  /** A tela responde (computador ou app): confere a senha de gerente/presidente e responde (aqui ou pela nuvem). */
  async responder(user: AuthUser, id: string, dto: RespostaDaDisputa) {
    const c = await this.carregar(user.tenantId, id);
    this.conferirAberta(c);
    const pedido = montarRespostaAoIfood(c.detalhe.disputa, dto ?? {});
    const quem = await autorizarPorSenhaDeGestor(this.db, user.tenantId, dto?.senha, NIVEIS_DA_PLATAFORMA);
    if (ehServidorLocal()) return this.responderPelaNuvem(user, c, dto, quem);
    return this.enviar(user.tenantId, c, pedido, quem, user.colaboradorId ?? null, user.categoria ?? null);
  }

  /** Na NUVEM, vindo do servidor da loja (a senha já foi conferida lá; o token do servidor autentica). */
  async responderVindoDaLoja(tenantId: string, dto: RespostaDaDisputa & { chamadoId?: string; liberadorId?: string; liberadorNome?: string; atorId?: string }) {
    const c = await this.carregar(tenantId, String(dto?.chamadoId ?? ''));
    this.conferirAberta(c);
    const pedido = montarRespostaAoIfood(c.detalhe.disputa, dto ?? {});
    const quem = { id: String(dto?.liberadorId ?? ''), nome: String(dto?.liberadorNome ?? 'Gestor da loja') };
    return this.enviar(tenantId, c, pedido, quem, dto?.atorId ?? null, null, 'servidor_local');
  }

  private async enviar(
    tenantId: string,
    c: { id: string; unidadeId: string | null; externoId: string },
    pedido: PedidoAoIfood,
    quem: { id: string; nome: string },
    atorId: string | null,
    atorPerfil: string | null,
    origem = 'web',
  ) {
    const ig = await this.ifood.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('O iFood não está conectado nesta empresa.');
    const r = await this.ifood.responderDisputa(ig, c.externoId, pedido.acao, pedido.corpo);
    if (!r.ok) {
      if (r.status === 422 || r.codigo === 'DISPUTE_ALREADY_ANSWERED') throw new ConflictException('O iFood já recebeu uma resposta para esta disputa.');
      if (r.status === 404) throw new NotFoundException('O iFood não encontrou esta disputa (ela pode ter vencido).');
      if (r.status === 400) throw new BadRequestException(`O iFood recusou a resposta${r.mensagem ? `: ${r.mensagem}` : '.'}`);
      throw new BadGatewayException('O iFood não respondeu agora. Tente de novo.');
    }
    const resposta = { ...pedido.resumo, por: quem.nome, porId: quem.id || null, em: new Date().toISOString() };
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(resposta)}::jsonb),
             status = 'resolvido', decisao = ${DECISAO[pedido.resumo.acao as keyof typeof DECISAO]},
             resolvido_por_id = ${quem.id || null}, resolvido_em = now(), prazo_em = null, aguardando_desde = null
       where tenant_id = ${tenantId} and id = ${c.id}`);
    await this.auditoria?.registrar({
      tenantId,
      unidadeId: c.unidadeId ?? null,
      atorId,
      atorPerfil,
      tipo: 'atendimento',
      acao: 'respondeu_disputa_ifood',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: c.id,
      detalhe: { ...pedido.resumo, liberadoPor: quem.id || null, disputa: c.externoId },
      origem,
    });
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_disputa' });
    return { ok: true, resposta };
  }

  /** No servidor da loja: a resposta vai à nuvem (que tem a credencial do iFood) pelo token do servidor. */
  private async responderPelaNuvem(user: AuthUser, c: { id: string }, dto: RespostaDaDisputa, quem: { id: string; nome: string }) {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: a resposta ao iFood sai de lá.');
    const { senha: _senha, ...semSenha } = dto ?? {};
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/disputa-da-loja`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': token },
        body: JSON.stringify({ ...semSenha, chamadoId: c.id, liberadorId: quem.id, liberadorNome: quem.nome, atorId: user.colaboradorId ?? null }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`resposta à disputa ${c.id}: a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo — a disputa ainda está no prazo.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      if (res.status === 409) throw new ConflictException(msg);
      if (res.status === 404) throw new NotFoundException(msg);
      if (res.status === 400) throw new BadRequestException(msg);
      throw new BadGatewayException(msg);
    }
    // A resposta já vale aqui também (a nuvem resolveu o caso; o sincronismo traz a mesma coisa em seguida).
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(j?.resposta ?? {})}::jsonb),
             status = 'resolvido', resolvido_em = now(), prazo_em = null, aguardando_desde = null
       where tenant_id = ${user.tenantId} and id = ${c.id}`);
    this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: c.id, motivo: 'respondeu_disputa' });
    return { ok: true, resposta: j?.resposta ?? null };
  }

  /** A foto `n` que o cliente mandou: na nuvem, pelo iFood; no servidor da loja, pela nuvem. */
  async foto(tenantId: string, id: string, n: number): Promise<{ tipo: string; bytes: Buffer }> {
    if (ehServidorLocal()) return this.fotoPelaNuvem(id, n);
    const c = await this.carregar(tenantId, id);
    const f = (c.detalhe.disputa.fotos ?? [])[n];
    if (!f) throw new NotFoundException('Foto não encontrada.');
    const ig = await this.ifood.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('O iFood não está conectado nesta empresa.');
    const foto = await this.ifood.fotoDaDisputa(ig, f.url);
    if (!foto) throw new BadGatewayException('O iFood não entregou a foto agora.');
    return foto;
  }

  private async fotoPelaNuvem(id: string, n: number): Promise<{ tipo: string; bytes: Buffer }> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: a foto vem de lá.');
    const res = await fetch(`${nuvem}/atendimento/foto-da-loja?chamado=${encodeURIComponent(id)}&n=${n}`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res?.ok) throw new BadGatewayException('A nuvem não entregou a foto agora.');
    const tipo = String(res.headers.get('content-type') ?? '');
    if (!tipo.startsWith('image/')) throw new BadGatewayException('A nuvem não entregou a foto agora.');
    return { tipo, bytes: Buffer.from(await res.arrayBuffer()) };
  }
}

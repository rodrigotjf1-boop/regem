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
import { ehServidorLocal } from '../../common/modo';
import { RESPOSTA_MAX } from '../integracoes/ifood/ifood-avaliacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O texto da resposta como vai ao iFood: sem espaço sobrando, até o máximo dele (o mínimo o iFood confere — 400). */
export function textoDaResposta(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\s+\n/g, '\n').trim() : '';
  if (!t) throw new BadRequestException('Escreva a resposta da loja.');
  if (t.length > RESPOSTA_MAX) throw new BadRequestException(`A resposta tem ${t.length} caracteres; o iFood aceita no máximo ${RESPOSTA_MAX}.`);
  return t;
}

/**
 * A RESPOSTA À AVALIAÇÃO do iFood pela central (checkpoint item 4 — 06/11/2026; protótipo, caso "Avaliação"). Quem responde:
 * a gestão (presidente, gerente, supervisão), como no chat — a regra da rota. A resposta fica PÚBLICA no iFood e é UMA: o
 * iFood recusa a segunda e a da avaliação já publicada (409/422). O texto de 10 a 300 caracteres o iFood confere (a tela
 * avisa antes, sem barrar — a recusa do iFood chega com a mensagem dele). No servidor da loja, vai pela nuvem (a credencial
 * do iFood mora lá — V37).
 */
@Injectable()
export class AvaliacaoIfoodService {
  private readonly logger = new Logger('AvaliacaoIfood');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ifood: IfoodService,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async carregar(tenantId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new NotFoundException('Avaliação não encontrada.');
    const r: any = await this.db.execute(sql`
      select id, unidade_id as "unidadeId", status, tipo, canal, detalhe
        from atendimento_chamado where tenant_id = ${tenantId} and id = ${id}`);
    const c = (r.rows ?? r)[0];
    if (!c || c.tipo !== 'avaliacao' || c.canal !== 'ifood' || !c.detalhe?.avaliacao?.id) throw new NotFoundException('Avaliação não encontrada.');
    return c as { id: string; unidadeId: string | null; status: string; detalhe: any };
  }

  private conferirAberta(c: { status: string; detalhe: any }) {
    if (c.detalhe?.resposta) throw new ConflictException('Esta avaliação já foi respondida.');
    if (c.status === 'resolvido') throw new ConflictException('Esta avaliação já foi encerrada no iFood (respondida pelo Portal do Parceiro, publicada ou descartada).');
  }

  private async nomeDe(tenantId: string, colaboradorId: string | null): Promise<string> {
    if (!colaboradorId) return 'Equipe da loja';
    const r: any = await this.db.execute(sql`select nome from colaborador where tenant_id = ${tenantId} and id = ${colaboradorId}`);
    return String((r.rows ?? r)[0]?.nome ?? 'Equipe da loja');
  }

  /** A tela responde (computador ou app): aqui na nuvem, ou pela nuvem no servidor da loja. */
  async responder(user: AuthUser, id: string, dto: { texto?: unknown }) {
    const texto = textoDaResposta(dto?.texto);
    const c = await this.carregar(user.tenantId, id);
    this.conferirAberta(c);
    const nome = await this.nomeDe(user.tenantId, user.colaboradorId ?? null);
    if (ehServidorLocal()) return this.responderPelaNuvem(user, c, texto, nome);
    return this.enviar(user.tenantId, c, texto, { id: user.colaboradorId ?? null, nome, perfil: user.categoria ?? null });
  }

  /** Na NUVEM, vindo do servidor da loja (quem respondeu foi conferido lá; o token do servidor autentica). */
  async responderVindoDaLoja(tenantId: string, dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown; atorNome?: unknown }) {
    const texto = textoDaResposta(dto?.texto);
    const c = await this.carregar(tenantId, String(dto?.chamadoId ?? ''));
    this.conferirAberta(c);
    const atorId = typeof dto?.atorId === 'string' && /^[0-9a-f-]{36}$/i.test(dto.atorId) ? dto.atorId : null;
    const nome = typeof dto?.atorNome === 'string' && dto.atorNome.trim() ? dto.atorNome.trim().slice(0, 120) : 'Equipe da loja';
    return this.enviar(tenantId, c, texto, { id: atorId, nome, perfil: null }, 'servidor_local');
  }

  private async enviar(
    tenantId: string,
    c: { id: string; unidadeId: string | null; detalhe: any },
    texto: string,
    quem: { id: string | null; nome: string; perfil: string | null },
    origem = 'web',
  ) {
    const ig = await this.ifood.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('O iFood não está conectado nesta empresa.');
    const reviewId = String(c.detalhe.avaliacao.id);
    const r = await this.ifood.responderAvaliacao(ig, reviewId, texto);
    if (!r.ok) {
      if (r.status === 409 || r.status === 422)
        throw new ConflictException('O iFood não aceita mais resposta nesta avaliação (ela já foi respondida ou publicada).');
      if (r.status === 404) throw new NotFoundException('O iFood não encontrou esta avaliação.');
      if (r.status === 400) throw new BadRequestException(`O iFood recusou a resposta${r.mensagem ? `: ${r.mensagem}` : '.'} A resposta vai de 10 a 300 caracteres.`);
      if (r.status === 401 || r.status === 403) throw new BadGatewayException('O iFood não liberou a resposta de avaliações para esta loja ainda.');
      throw new BadGatewayException('O iFood não respondeu agora. Tente de novo.');
    }
    const resposta = { texto, por: quem.nome, porId: quem.id, em: new Date().toISOString() };
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(resposta)}::jsonb),
             status = 'resolvido', decisao = 'respondida', resolvido_por_id = ${quem.id}, resolvido_em = now(), aguardando_desde = null
       where tenant_id = ${tenantId} and id = ${c.id}`);
    await this.auditoria?.registrar({
      tenantId,
      unidadeId: c.unidadeId ?? null,
      atorId: quem.id,
      atorPerfil: quem.perfil,
      tipo: 'atendimento',
      acao: 'respondeu_avaliacao_ifood',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: c.id,
      detalhe: { avaliacao: reviewId, nota: c.detalhe.avaliacao.nota ?? null, caracteres: texto.length },
      origem,
    });
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_avaliacao' });
    return { ok: true, resposta };
  }

  /** No servidor da loja: a resposta vai à nuvem (que tem a credencial do iFood) pelo token do servidor. */
  private async responderPelaNuvem(user: AuthUser, c: { id: string }, texto: string, nome: string) {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: a resposta ao iFood sai de lá.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/avaliacao-da-loja`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': token },
        body: JSON.stringify({ chamadoId: c.id, texto, atorId: user.colaboradorId ?? null, atorNome: nome }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`resposta à avaliação ${c.id}: a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
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
    // A resposta já vale aqui também (a nuvem resolveu o caso; o sincronismo traz a mesma coisa em seguida).
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('resposta', ${JSON.stringify(j?.resposta ?? {})}::jsonb),
             status = 'resolvido', decisao = 'respondida', resolvido_em = now(), aguardando_desde = null
       where tenant_id = ${user.tenantId} and id = ${c.id}`);
    this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: c.id, motivo: 'respondeu_avaliacao' });
    return { ok: true, resposta: j?.resposta ?? null };
  }
}

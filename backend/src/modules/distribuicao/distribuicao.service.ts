import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PerfilDist = 'diretoria' | 'tecnico' | 'financeiro';
const PERFIS: PerfilDist[] = ['diretoria', 'tecnico', 'financeiro'];

// Console da distribuição (Fase 1): realm de auth SEPARADO das lojas. Token assinado
// com `escopo: 'distribuicao'` e secret próprio (DIST_JWT_SECRET, cai no JWT_SECRET em
// dev) — um token de loja nunca passa aqui e vice-versa.
@Injectable()
export class DistribuicaoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly jwt: JwtService,
  ) {}

  private segredo(): string {
    return process.env.DIST_JWT_SECRET || process.env.JWT_SECRET || '';
  }

  async login(email: string, senha: string, ip?: string) {
    const e = String(email ?? '').trim().toLowerCase();
    const r: any = await this.db.execute(sql`
      select id, nome, email, senha_hash as "senhaHash", perfil, ativo
      from usuario_distribuicao where lower(email) = ${e} limit 1`);
    const u = (r.rows ?? r)[0];
    if (!u || !u.ativo || !(await bcrypt.compare(String(senha ?? ''), u.senhaHash))) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const access_token = this.jwt.sign(
      { sub: u.id, escopo: 'distribuicao', perfil: u.perfil, nome: u.nome },
      { secret: this.segredo(), expiresIn: '12h' },
    );
    await this.auditar(u, 'login', null, {}, ip);
    return { access_token, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil } };
  }

  async porId(id: string) {
    const r: any = await this.db.execute(sql`
      select id, nome, email, perfil, ativo from usuario_distribuicao
      where id = ${id} and ativo = true limit 1`);
    return (r.rows ?? r)[0] ?? null;
  }

  // Cria o PRIMEIRO usuário (diretoria) quando a tabela está vazia. Protegido por
  // DIST_BOOTSTRAP_SECRET (env). Depois, novos usuários saem do próprio console.
  async bootstrap(dto: any, segredo: string) {
    const esperado = (process.env.DIST_BOOTSTRAP_SECRET ?? '').trim();
    if (!esperado || segredo !== esperado) throw new ForbiddenException('Bootstrap não autorizado.');
    const r: any = await this.db.execute(sql`select count(*)::int as n from usuario_distribuicao`);
    if (Number((r.rows ?? r)[0]?.n) > 0) {
      throw new ConflictException('Já existe usuário da distribuição — bootstrap indisponível.');
    }
    return this.criar({ ...dto, perfil: 'diretoria' }, null);
  }

  async criar(dto: any, autor: any | null) {
    const nome = String(dto?.nome ?? '').trim();
    const email = String(dto?.email ?? '').trim().toLowerCase();
    const perfil: PerfilDist = PERFIS.includes(dto?.perfil) ? dto.perfil : 'tecnico';
    const senha = String(dto?.senha ?? '');
    if (nome.length < 2 || !email.includes('@') || senha.length < 8) {
      throw new BadRequestException('Nome, e-mail e senha (mín. 8) são obrigatórios.');
    }
    const ex: any = (await this.db.execute(sql`select id from usuario_distribuicao where lower(email)=${email} limit 1`));
    if ((ex.rows ?? ex)[0]) throw new ConflictException('E-mail já cadastrado.');
    const hash = await bcrypt.hash(senha, 12);
    const r: any = await this.db.execute(sql`
      insert into usuario_distribuicao (nome, email, senha_hash, perfil)
      values (${nome}, ${email}, ${hash}, ${perfil})
      returning id, nome, email, perfil, ativo`);
    const novo = (r.rows ?? r)[0];
    if (autor) await this.auditar(autor, 'criou_usuario', novo.id, { email, perfil });
    return novo;
  }

  async listar() {
    const r: any = await this.db.execute(sql`
      select id, nome, email, perfil, ativo, criado_em as "criadoEm"
      from usuario_distribuicao order by criado_em desc`);
    return r.rows ?? r;
  }

  async listarAuditoria() {
    const r: any = await this.db.execute(sql`
      select usuario_nome as "usuario", perfil, acao, alvo, detalhe, ip, criado_em as "criadoEm"
      from distribuicao_auditoria order by criado_em desc limit 200`);
    return r.rows ?? r;
  }

  // ===== Fase 2: Frota + Telemetria (cross-tenant, visão da distribuição) =====

  // Frota: cada loja (empresa) + o ÚLTIMO heartbeat do edge (versão/estado/online) +
  // status de licença/assinatura + nº de erros de telemetria em aberto.
  async frota() {
    const r: any = await this.db.execute(sql`
      select e.id, e.nome, e.cnpj, e.plano, e.status,
             e.trial_ate as "trialAte", e.assinatura_status as "assinaturaStatus",
             h.versao as "edgeVersao", h.recebido_em as "ultimoHeartbeat",
             h.estado as "edgeEstado", h.clientes, h.disco_livre_mb as "discoLivreMb", h.erro as "edgeErro",
             -- Último login de QUALQUER pessoa da loja: mostra atividade mesmo em
             -- lojas sem edge (modo nuvem), onde o "último sinal" nunca chega.
             (select max(a.created_at) from audit_log a where a.tenant_id = e.id and a.acao = 'login') as "ultimoLogin",
             (select count(*) from telemetria_evento t where t.tenant_id = e.id and t.resolvido = false)::int as "errosAbertos"
      from empresa e
      left join lateral (
        select * from edge_heartbeat hb where hb.tenant_id = e.id order by hb.recebido_em desc limit 1
      ) h on true
      order by e.nome`);
    return r.rows ?? r;
  }

  // Telemetria cross-tenant (erros das lojas). NOTA LGPD: mensagem/stack são técnicos;
  // uma redação de PII pode entrar num hardening futuro.
  async telemetria() {
    const r: any = await this.db.execute(sql`
      select t.id, t.origem, t.nivel, t.tipo, t.mensagem, t.ocorrencias, t.versao,
             t.primeiro_em as "primeiroEm", t.ultimo_em as "ultimoEm", t.resolvido,
             e.nome as "loja"
      from telemetria_evento t left join empresa e on e.id = t.tenant_id
      order by t.resolvido asc, t.ultimo_em desc limit 300`);
    return r.rows ?? r;
  }

  async resolverTelemetria(id: string, autor: any) {
    await this.db.execute(sql`update telemetria_evento set resolvido = true where id = ${id}`);
    await this.auditar(autor, 'resolveu_telemetria', id);
    return { ok: true };
  }

  // ===== Fase 3: Licenças (revogar/liberar/mudar plano) =====
  // Lista as lojas com status de licença + versão do edge (p/ filtros no console).
  async licencas() {
    const r: any = await this.db.execute(sql`
      select e.id, e.nome, e.cnpj, e.plano, e.status, e.trial_ate as "trialAte",
             e.assinatura_status as "assinaturaStatus",
             h.versao as "edgeVersao", h.recebido_em as "ultimoHeartbeat"
      from empresa e
      left join lateral (
        select versao, recebido_em from edge_heartbeat hb where hb.tenant_id = e.id order by hb.recebido_em desc limit 1
      ) h on true
      order by e.nome`);
    return r.rows ?? r;
  }

  // Revoga: bloqueia a conta (o LicenseInterceptor corta escrita/sync). Reversível.
  async revogarLicenca(tenantId: string, autor: any) {
    await this.db.execute(sql`update empresa set status = 'bloqueado' where id = ${tenantId}`);
    await this.auditar(autor, 'revogou_licenca', tenantId);
    return { ok: true };
  }

  // Libera/renova: reativa + estende o trial por N dias (a partir do maior entre agora
  // e o fim atual). Serve p/ soltar uma loja bloqueada ou dar mais prazo.
  async liberarLicenca(tenantId: string, dias: number, autor: any) {
    const d = Math.max(1, Math.min(3650, Number(dias) || 30));
    await this.db.execute(sql`
      update empresa
      set status = 'ativo',
          trial_ate = greatest(coalesce(trial_ate, now()), now()) + make_interval(0, 0, 0, ${d})
      where id = ${tenantId}`);
    await this.auditar(autor, 'liberou_licenca', tenantId, { dias: d });
    return { ok: true };
  }

  async mudarPlano(tenantId: string, plano: string, autor: any) {
    const permitidos = ['basico', 'balcao', 'completo'];
    if (!permitidos.includes(plano)) throw new BadRequestException('Plano inválido.');
    await this.db.execute(sql`update empresa set plano = ${plano} where id = ${tenantId}`);
    await this.auditar(autor, 'mudou_plano', tenantId, { plano });
    return { ok: true };
  }

  // ===== Fase 4: publicar release + comandos remotos =====

  // Publica um release (o edge lê daqui no update-check em vez do env do EasyPanel).
  async publicarRelease(dto: any, autor: any) {
    const versao = String(dto?.versao ?? '').trim();
    const url = String(dto?.url ?? '').trim();
    const sha256 = String(dto?.sha256 ?? '').trim().toLowerCase();
    const notas = dto?.notas ? String(dto.notas).slice(0, 1000) : null;
    if (!versao || !/^https?:\/\//.test(url) || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new BadRequestException('Informe versão, URL (https) e SHA-256 válidos.');
    }
    await this.db.execute(sql`
      insert into edge_release (versao, url, sha256, notas, publicado_por)
      values (${versao}, ${url}, ${sha256}, ${notas}, ${autor?.nome ?? null})`);
    await this.auditar(autor, 'publicou_release', versao, { url });
    return { ok: true, versao };
  }

  async releases() {
    const r: any = await this.db.execute(sql`
      select versao, url, sha256, notas, publicado_por as "publicadoPor", publicado_em as "publicadoEm"
      from edge_release order by publicado_em desc limit 30`);
    return r.rows ?? r;
  }

  // Enfileira um comando remoto p/ o edge de uma loja (o daemon busca e executa).
  async comandoRemoto(tenantId: string, comando: string, autor: any) {
    if (!['rollback', 'reprocessar'].includes(comando)) throw new BadRequestException('Comando inválido.');
    await this.db.execute(sql`
      insert into edge_comando (tenant_id, comando, solicitado_por)
      values (${tenantId}, ${comando}, ${autor?.nome ?? null})`);
    await this.auditar(autor, `comando_${comando}`, tenantId);
    return { ok: true };
  }

  // ===== Pedidos de integração (loja pede → distribuição conecta no portal) =====
  // A loja salva o token (ex.: Anota Aí); vira um "pedido de integração" no config
  // da integração. A distribuição finaliza a conexão no Portal de Integração do canal.
  async pedidosIntegracao() {
    const r: any = await this.db.execute(sql`
      select i.id as "integracaoId", i.tenant_id as "tenantId", i.canal, i.token,
             e.nome as loja, e.cnpj,
             i.config->'pedidoIntegracao'->>'status' as status,
             i.config->'pedidoIntegracao'->>'solicitadoEm' as "solicitadoEm",
             i.config->'pedidoIntegracao'->>'conectadoPor' as "conectadoPor",
             i.config->'pedidoIntegracao'->>'conectadoEm' as "conectadoEm"
      from integracao i join empresa e on e.id = i.tenant_id
      where i.config ? 'pedidoIntegracao'
      order by (i.config->'pedidoIntegracao'->>'status' = 'pendente') desc,
               i.config->'pedidoIntegracao'->>'solicitadoEm' desc nulls last
      limit 300`);
    return r.rows ?? r;
  }

  // Marca o pedido como conectado (ou recusado). `acao`: 'conectado' | 'recusado'.
  async resolverPedidoIntegracao(integracaoId: string, acao: 'conectado' | 'recusado', autor: any) {
    const status = acao === 'recusado' ? 'recusado' : 'conectado';
    await this.db.execute(sql`
      update integracao set config = jsonb_set(
        jsonb_set(
          jsonb_set(config, '{pedidoIntegracao,status}', ${JSON.stringify(status)}::jsonb),
          '{pedidoIntegracao,conectadoPor}', to_jsonb(${autor?.nome ?? null}::text)
        ),
        '{pedidoIntegracao,conectadoEm}', to_jsonb(now()::text)
      )
      where id = ${integracaoId} and config ? 'pedidoIntegracao'`);
    await this.auditar(autor, `integracao_${status}`, integracaoId);
    return { ok: true };
  }

  // Auditoria imutável (append-only). Nunca deve quebrar a ação principal.
  async auditar(autor: any, acao: string, alvo?: string | null, detalhe: any = {}, ip?: string) {
    try {
      await this.db.execute(sql`
        insert into distribuicao_auditoria (usuario_id, usuario_nome, perfil, acao, alvo, detalhe, ip)
        values (${autor?.id ?? autor?.sub ?? null}, ${autor?.nome ?? null}, ${autor?.perfil ?? null},
                ${acao}, ${alvo ?? null}, ${JSON.stringify(detalhe ?? {})}::jsonb, ${ip ?? null})`);
    } catch {
      /* auditoria best-effort */
    }
  }
}

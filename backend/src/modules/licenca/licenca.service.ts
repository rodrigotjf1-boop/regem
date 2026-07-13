import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ativacao, colaborador, edgeHeartbeat, empresa, equipamento, funcao, revenda } from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { assinarLease } from './lease';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// Trial completo = todos os módulos ativáveis (o cadastro dá 3 meses do completo).
const TRIAL_MODULOS = ['kds', 'ponto', 'app_colaborador', 'cashback', 'fidelidade', 'integracoes', 'bot'];

@Injectable()
export class LicencaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly equip: EquipamentoService,
  ) {}

  // ===== Revenda (portal) =====
  listarRevendas() {
    return this.db.select().from(revenda).orderBy(desc(revenda.criadoEm));
  }
  async criarRevenda(nome: string) {
    if (!nome?.trim()) throw new BadRequestException('Informe o nome.');
    const [r] = await this.db.insert(revenda).values({ nome: nome.trim() }).returning();
    return r;
  }

  // Emite um token de ativação para uma loja (a revenda escolhe ramo/plano/módulos).
  // Devolve o token EM CLARO uma única vez (guardamos só o hash).
  async emitirToken(dto: any) {
    if (!dto?.tenantId) throw new BadRequestException('Informe a loja (tenantId).');
    const token = randomBytes(18).toString('base64url'); // ~24 chars
    const validadeAte =
      dto.trial || dto.validadeDias
        ? new Date(Date.now() + (Number(dto.validadeDias) || (dto.trial ? 7 : 0)) * 86400000)
        : null;
    const [row] = await this.db
      .insert(ativacao)
      .values({
        revendaId: dto.revendaId ?? null,
        tenantId: dto.tenantId,
        tokenHash: hash(token),
        ramo: dto.ramo ?? 'food_service',
        plano: dto.plano ?? 'basico',
        modulos: Array.isArray(dto.modulos) ? dto.modulos : [],
        trial: !!dto.trial,
        validadeAte,
        status: 'emitido',
      })
      .returning();
    return { id: row.id, token }; // token só aparece aqui
  }

  async atualizarModulos(id: string, modulos: string[], plano?: string) {
    const [row] = await this.db
      .update(ativacao)
      .set({ modulos: Array.isArray(modulos) ? modulos : [], plano: plano ?? undefined, atualizadoEm: new Date() })
      .where(eq(ativacao.id, id))
      .returning();
    if (!row) throw new NotFoundException('Ativação não encontrada.');
    return row;
  }

  async mudarStatus(id: string, status: 'suspenso' | 'ativado' | 'revogado') {
    const [row] = await this.db
      .update(ativacao)
      .set({ status, atualizadoEm: new Date() })
      .where(eq(ativacao.id, id))
      .returning();
    if (!row) throw new NotFoundException('Ativação não encontrada.');
    return row;
  }

  // Rebind: libera o device (troca de PC) → a próxima ativação prende no novo.
  async rebind(id: string) {
    await this.db
      .update(ativacao)
      .set({ deviceFingerprint: null, status: 'emitido', atualizadoEm: new Date() })
      .where(eq(ativacao.id, id));
    return { ok: true };
  }

  // Painel de frota: ativações + último heartbeat.
  async frota() {
    const rows = await this.db.select().from(ativacao).orderBy(desc(ativacao.criadoEm)).limit(500);
    const out: any[] = [];
    for (const a of rows) {
      const [hb] = await this.db
        .select()
        .from(edgeHeartbeat)
        .where(eq(edgeHeartbeat.ativacaoId, a.id))
        .orderBy(desc(edgeHeartbeat.recebidoEm))
        .limit(1);
      out.push({
        id: a.id,
        tenantId: a.tenantId,
        ramo: a.ramo,
        plano: a.plano,
        modulos: a.modulos,
        status: a.status,
        trial: a.trial,
        validadeAte: a.validadeAte,
        vinculado: !!a.deviceFingerprint,
        versao: hb?.versao ?? null,
        ultimoSync: hb?.ultimoSync ?? null,
        online: hb ? Date.now() - new Date(hb.recebidoEm).getTime() < 5 * 60000 : false,
        heartbeatEm: hb?.recebidoEm ?? null,
      });
    }
    return out;
  }

  // ===== Provisionamento (edge) =====
  // Ativa por token + fingerprint do device. Prende na 1ª ativação (anti-clonagem).
  async ativar(token: string, fingerprint: string) {
    if (!token || !fingerprint) throw new BadRequestException('Token e device são obrigatórios.');
    const [a] = await this.db.select().from(ativacao).where(eq(ativacao.tokenHash, hash(token)));
    if (!a) throw new NotFoundException('Token inválido.');
    if (a.status === 'revogado') throw new ForbiddenException('Licença revogada.');
    if (a.deviceFingerprint && a.deviceFingerprint !== fingerprint)
      throw new ForbiddenException('Token já ativado em outro equipamento.');
    const [row] = await this.db
      .update(ativacao)
      .set({
        deviceFingerprint: fingerprint,
        status: 'ativado',
        ativadoEm: a.ativadoEm ?? new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(ativacao.id, a.id))
      .returning();
    return { ativacaoId: row.id, lease: this.leaseDe(row) };
  }

  // Auto-instalação SELF-SERVICE (G-4): o instalador manda a conta C&O + o
  // fingerprint do aparelho; a nuvem confere trial + anti-clonagem e devolve o
  // token de sync (cria/reusa o equipamento servidor_local) e o lease. Sem humano.
  async instalarSelfService(dto: { email?: string; senha?: string; fingerprint?: string; unidadeId?: string }) {
    const email = String(dto.email ?? '').trim();
    const fingerprint = String(dto.fingerprint ?? '').trim();
    if (!email || !dto.senha || !fingerprint) {
      throw new BadRequestException('E-mail, senha e device são obrigatórios.');
    }
    // 1) Autentica a conta C&O.
    const [u] = await this.db
      .select({
        id: colaborador.id,
        tenantId: colaborador.tenantId,
        senhaHash: colaborador.senhaHash,
        categoria: funcao.categoria,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .where(eq(colaborador.email, email))
      .limit(1);
    if (!u?.senhaHash || !(await bcrypt.compare(dto.senha, u.senhaHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    if (!['presidente', 'gerente'].includes(u.categoria ?? '')) {
      throw new ForbiddenException('Apenas o C&O ou gerente pode ativar o servidor local.');
    }
    const tenantId = u.tenantId;

    // 2) Trial/assinatura precisa estar ativa.
    const st = await this.statusConta(tenantId);
    if (!st.ativa) throw new ForbiddenException('Conta sem teste/assinatura ativa. Assine para ativar.');

    // 3) Anti-clonagem: o fingerprint não pode pertencer a OUTRA empresa.
    const [outro] = await this.db
      .select({ tenantId: ativacao.tenantId })
      .from(ativacao)
      .where(eq(ativacao.deviceFingerprint, fingerprint))
      .limit(1);
    if (outro && outro.tenantId !== tenantId) {
      throw new ForbiddenException('Este equipamento já está vinculado a outra empresa.');
    }

    // 4) Equipamento servidor_local: reusa o existente ou cria (gera o sync token).
    let syncToken: string;
    const [eqExiste] = await this.db
      .select({ token: equipamento.token })
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'servidor_local')))
      .limit(1);
    if (eqExiste?.token) {
      syncToken = eqExiste.token;
    } else {
      const novo: any = await this.equip.criar(tenantId, u.id, u.categoria ?? 'presidente', {
        tipo: 'servidor_local',
        nome: 'Servidor local',
        unidadeId: dto.unidadeId,
      } as any);
      syncToken = novo.token;
    }

    // 5) Ativação (1 por empresa): status ativado + fingerprint + validade do trial.
    const [emp] = await this.db
      .select({ trialAte: empresa.trialAte })
      .from(empresa)
      .where(eq(empresa.id, tenantId))
      .limit(1);
    const validadeAte = emp?.trialAte ?? null;
    const [aExiste] = await this.db.select().from(ativacao).where(eq(ativacao.tenantId, tenantId)).limit(1);
    let row: any;
    if (aExiste) {
      [row] = await this.db
        .update(ativacao)
        .set({
          deviceFingerprint: fingerprint,
          status: 'ativado',
          plano: 'completo',
          modulos: TRIAL_MODULOS,
          validadeAte,
          ativadoEm: aExiste.ativadoEm ?? new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(ativacao.id, aExiste.id))
        .returning();
    } else {
      [row] = await this.db
        .insert(ativacao)
        .values({
          tenantId,
          tokenHash: hash(`self-${fingerprint}-${Date.now()}`),
          ramo: 'food_service',
          plano: 'completo',
          modulos: TRIAL_MODULOS,
          trial: true,
          validadeAte,
          status: 'ativado',
          deviceFingerprint: fingerprint,
          ativadoEm: new Date(),
        })
        .returning();
    }

    return { syncToken, lease: this.leaseDe(row), ativo: true };
  }

  // Renova o lease (o edge chama no sync). Suspenso/revogado → sem lease.
  async renovarLease(tenantId: string) {
    const [a] = await this.db
      .select()
      .from(ativacao)
      .where(and(eq(ativacao.tenantId, tenantId), eq(ativacao.status, 'ativado')))
      .limit(1);
    if (!a) return { ativo: false, motivo: 'sem_licenca_ativa' };
    if (a.validadeAte && new Date(a.validadeAte) < new Date()) return { ativo: false, motivo: 'expirada' };
    return { ativo: true, lease: this.leaseDe(a) };
  }

  private leaseDe(a: any): string {
    return assinarLease({
      tenantId: a.tenantId,
      ramo: a.ramo,
      plano: a.plano,
      modulos: (a.modulos as string[]) ?? [],
      exp: a.validadeAte ? new Date(a.validadeAte).getTime() : null,
    });
  }

  // ===== Heartbeat (telemetria) =====
  async heartbeat(tenantId: string, dto: any) {
    const [a] = await this.db
      .select({ id: ativacao.id })
      .from(ativacao)
      .where(eq(ativacao.tenantId, tenantId))
      .limit(1);
    await this.db.insert(edgeHeartbeat).values({
      ativacaoId: a?.id ?? null,
      tenantId,
      versao: dto?.versao ?? null,
      estado: dto?.estado ?? null,
      ultimoSync: dto?.ultimoSync ? new Date(dto.ultimoSync) : null,
      discoLivreMb: dto?.discoLivreMb != null ? Number(dto.discoLivreMb) : null,
      clientes: dto?.clientes != null ? Number(dto.clientes) : null,
      erro: dto?.erro ?? null,
    });
    return { ok: true };
  }

  // Status da CONTA na nuvem (trial/assinatura) — base do bloqueio duro (G-1).
  // trial_ate NULL = conta sem limite (legado/assinatura ativa) -> sempre ativa.
  async statusConta(tenantId: string) {
    const [e] = await this.db
      .select({ trialAte: empresa.trialAte, plano: empresa.plano, status: empresa.status })
      .from(empresa)
      .where(eq(empresa.id, tenantId))
      .limit(1);
    if (!e) return { ativa: false, tipo: 'sem_conta', plano: null };
    if (e.status === 'bloqueado') return { ativa: false, tipo: 'bloqueado', plano: e.plano };
    if (!e.trialAte) return { ativa: true, tipo: 'ativa', plano: e.plano };
    const ate = new Date(e.trialAte).getTime();
    const agora = Date.now();
    if (ate >= agora) {
      return {
        ativa: true,
        tipo: 'trial',
        plano: e.plano,
        ate: new Date(ate).toISOString(),
        dias: Math.ceil((ate - agora) / 86400000),
      };
    }
    return { ativa: false, tipo: 'trial_expirado', plano: e.plano, ate: new Date(ate).toISOString() };
  }

  // Status da licença no EDGE (servidor local): lê o sync_state que o daemon
  // mantém (lic_ativa 1/0). Sem registro ainda (antes do 1º ciclo) = libera.
  async statusEdge() {
    try {
      const r: any = await this.db.execute(
        sql`select valor from sync_state where chave = 'lic_ativa' limit 1`,
      );
      const rows = r.rows ?? r;
      const v = rows?.[0]?.valor;
      if (v == null) return { ativa: true, tipo: 'edge_sem_status' };
      return v === '1' ? { ativa: true, tipo: 'ativa' } : { ativa: false, tipo: 'edge_bloqueado' };
    } catch {
      return { ativa: true, tipo: 'edge_erro' }; // fail-open
    }
  }

  // Entitlements atuais de uma loja (para enforcement de módulos).
  async entitlements(tenantId: string) {
    const [a] = await this.db
      .select()
      .from(ativacao)
      .where(and(eq(ativacao.tenantId, tenantId), eq(ativacao.status, 'ativado')))
      .limit(1);
    if (!a) return { ativo: false, ramo: null, plano: null, modulos: [] as string[] };
    const expirada = a.validadeAte && new Date(a.validadeAte) < new Date();
    return {
      ativo: !expirada,
      ramo: a.ramo,
      plano: a.plano,
      modulos: (a.modulos as string[]) ?? [],
    };
  }
}

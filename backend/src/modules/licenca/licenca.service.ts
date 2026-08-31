import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
// stripe usa `export =` — com o tsconfig do projeto (sem esModuleInterop), o
// `import Stripe from 'stripe'` compila para `stripe_1.default` e quebra em runtime.
import Stripe = require('stripe');
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  ativacao,
  colaborador,
  edgeHeartbeat,
  empresa,
  equipamento,
  funcao,
  reautorizacaoEdge,
  revenda,
  unidade,
} from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { assinarLease, licencaConfigurada } from './lease';
import { precisaReautorizar, gerarCodigoReauth, hashCodigoReauth } from './reauth-instalacao';
import { verificarTotp, gerarSegredoBase32, otpauthUri } from '../distribuicao/totp';
import { enviarCodigoVerificacao } from '../../common/mailer';
import { PLANOS } from './planos';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// Trial completo = todos os módulos ativáveis (o cadastro dá 3 meses do completo).
const TRIAL_MODULOS = ['kds', 'ponto', 'app_colaborador', 'cashback', 'fidelidade', 'integracoes', 'bot'];

@Injectable()
export class LicencaService {
  private readonly logger = new Logger(LicencaService.name);
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

  // ===== F3b — controle da trava de instalação (console de distribuição) =====
  // Liga/desliga a trava (reauth_ativo) e escolhe o 2º fator (e-mail/TOTP). TOTP só é
  // aceito como método se já houver segredo enrolado — senão a loja se trancaria fora.
  async reauthConfig(ativacaoId: string, dto: { ativo?: boolean; metodo?: string }) {
    const metodo = dto.metodo === 'totp' ? 'totp' : 'email';
    const [a] = await this.db
      .select({ totp: ativacao.reauthTotpSecret })
      .from(ativacao)
      .where(eq(ativacao.id, ativacaoId))
      .limit(1);
    if (!a) throw new NotFoundException('Ativação não encontrada.');
    if (metodo === 'totp' && !a.totp) {
      throw new BadRequestException('Configure o app autenticador (QR) antes de escolher esse método.');
    }
    const [row] = await this.db
      .update(ativacao)
      .set({ reauthAtivo: !!dto.ativo, reauthMetodo: metodo, atualizadoEm: new Date() })
      .where(eq(ativacao.id, ativacaoId))
      .returning({ reauthAtivo: ativacao.reauthAtivo, reauthMetodo: ativacao.reauthMetodo });
    this.logger.warn(`Trava de instalação ${row.reauthAtivo ? 'LIGADA' : 'desligada'} (método ${row.reauthMetodo}) — ativação ${ativacaoId}.`);
    return { ok: true, ...row };
  }

  // TOTP: gera o segredo e devolve o QR (otpauth). Grava o segredo já, mas ele fica
  // INERTE até confirmar — o método só vira 'totp' após validar um código do app.
  // O segredo mora só na nuvem (ativacao, cloud-only); nunca desce pro edge.
  async reauthTotpIniciar(ativacaoId: string) {
    const [a] = await this.db
      .select({ tenantId: ativacao.tenantId })
      .from(ativacao)
      .where(eq(ativacao.id, ativacaoId))
      .limit(1);
    if (!a?.tenantId) throw new NotFoundException('Ativação não encontrada.');
    const secret = gerarSegredoBase32();
    await this.db
      .update(ativacao)
      .set({ reauthTotpSecret: secret, atualizadoEm: new Date() })
      .where(eq(ativacao.id, ativacaoId));
    const conta = `loja-${String(a.tenantId).slice(0, 8)}`;
    return { otpauthUri: otpauthUri(secret, conta, 'Regem Edge'), secret };
  }

  // Confirma o TOTP: valida um código contra o segredo e LIGA o método (e a trava).
  async reauthTotpConfirmar(ativacaoId: string, codigo: string) {
    const [a] = await this.db
      .select({ totp: ativacao.reauthTotpSecret })
      .from(ativacao)
      .where(eq(ativacao.id, ativacaoId))
      .limit(1);
    if (!a) throw new NotFoundException('Ativação não encontrada.');
    if (!a.totp) throw new BadRequestException('Gere o QR primeiro.');
    if (!verificarTotp(a.totp, codigo)) {
      throw new UnauthorizedException('Código inválido. Confira o app autenticador e tente de novo.');
    }
    await this.db
      .update(ativacao)
      .set({ reauthMetodo: 'totp', reauthAtivo: true, atualizadoEm: new Date() })
      .where(eq(ativacao.id, ativacaoId));
    return { ok: true };
  }

  // Trilha dos pedidos de move desta loja (auditoria no console).
  async reauthMoves(ativacaoId: string) {
    const [a] = await this.db
      .select({ tenantId: ativacao.tenantId })
      .from(ativacao)
      .where(eq(ativacao.id, ativacaoId))
      .limit(1);
    if (!a?.tenantId) throw new NotFoundException('Ativação não encontrada.');
    return this.db
      .select({
        id: reautorizacaoEdge.id,
        metodo: reautorizacaoEdge.metodo,
        status: reautorizacaoEdge.status,
        fingerprintNovo: reautorizacaoEdge.fingerprintNovo,
        criadoEm: reautorizacaoEdge.criadoEm,
        confirmadoEm: reautorizacaoEdge.confirmadoEm,
      })
      .from(reautorizacaoEdge)
      .where(eq(reautorizacaoEdge.tenantId, a.tenantId))
      .orderBy(desc(reautorizacaoEdge.criadoEm))
      .limit(20);
  }

  // Painel de frota: ativações + último heartbeat.
  async frota() {
    // 1 query SET-BASED (LATERAL) — antes era N+1 (500 ativações × 2 queries: heartbeat +
    // último login), violando "1 request + query set-based". Traz também a saúde dos
    // serviços (F1) + a unidade, pra o /frota do lojista mostrar QUAL serviço caiu.
    const r: any = await this.db.execute(sql`
      select a.id, a.tenant_id as "tenantId", a.ramo, a.plano, a.modulos, a.status,
             a.trial, a.validade_ate as "validadeAte",
             a.reauth_ativo as "reauthAtivo", a.reauth_metodo as "reauthMetodo",
             (a.reauth_totp_secret is not null) as "reauthTemTotp",
             (a.device_fingerprint is not null) as "vinculado",
             h.versao, h.ultimo_sync as "ultimoSync", h.recebido_em as "heartbeatEm",
             h.saude, h.unidade_id as "unidadeId", h.estado as "edgeEstado",
             (h.recebido_em is not null and h.recebido_em > now() - interval '5 minutes') as "online",
             (select max(al.created_at) from audit_log al
                where al.tenant_id = a.tenant_id and al.acao = 'login') as "ultimoLogin"
      from ativacao a
      left join lateral (
        select * from edge_heartbeat hb
        where hb.ativacao_id = a.id order by hb.recebido_em desc limit 1
      ) h on true
      order by a.criado_em desc
      limit 500`);
    return r.rows ?? r;
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

    // Em qual LOJA este servidor local está sendo instalado (Fase 5)?
    // Cada unidade tem cardápio, setores e configuração próprios — e o sincronismo
    // é por unidade. Com uma só, resolve sozinho; com mais de uma, devolvemos a
    // lista para o instalador perguntar, em vez de exigir que a pessoa saiba o
    // UUID de cor.
    const unidades = await this.db
      .select({ id: unidade.id, nome: unidade.nome, tipo: unidade.tipo })
      .from(unidade)
      .where(and(eq(unidade.tenantId, tenantId), isNull(unidade.deletedAt)))
      .orderBy(sql`(tipo = 'matriz') desc`, unidade.createdAt);
    let unidadeId = dto.unidadeId ?? null;
    if (unidadeId && !unidades.some((x) => x.id === unidadeId)) {
      throw new BadRequestException('Esta unidade não pertence à sua empresa.');
    }
    if (!unidadeId) {
      if (unidades.length > 1) {
        throw new BadRequestException({
          message: 'Escolha em qual unidade este servidor está sendo instalado.',
          escolhaUnidade: true,
          unidades,
        });
      }
      unidadeId = unidades[0]?.id ?? null; // uma só: nem pergunta
    }

    // Falha CEDO (antes de criar equipamento/ativação) se a nuvem não tem as
    // chaves de licença — senão a assinatura do lease estoura um 500 opaco. A
    // causa fica no LOG do servidor (p/ tratamento); o instalador recebe um erro
    // genérico, já que ao usuário final essa config interna não importa.
    if (!licencaConfigurada()) {
      this.logger.error(
        'Provisionamento self-service abortado: LICENSE_PRIVATE_KEY_B64/LICENSE_PUBLIC_KEY_B64 ausentes na regem-api. ' +
          'Gere o par (node scripts/gen-license-keys.mjs) e configure as envs de licença + LICENSE_KID, depois faça o deploy.',
      );
      throw new ServiceUnavailableException(
        'Ativação temporariamente indisponível. Tente novamente em instantes.',
      );
    }

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

    // 3b) CONTROLE DE INSTALAÇÃO (F3, anti-clone). Carrega a ativação da loja ANTES de
    // reativar/rebindar: com a trava LIGADA (reauth_ativo) e um fingerprint de OUTRA
    // máquina, BLOQUEIA e exige o 2º fator — o clone com senha vazada não passa, e o token
    // da máquina antiga NÃO é reativado (ela segue sendo a autorizada até aprovarem o move).
    // Mesma máquina (MachineGuid estável entre reinstalações) = fingerprint IGUAL → segue
    // liso (reinstalação, sem re-auth). O move legítimo se resolve em /reautorizar/*.
    const [aExiste] = await this.db
      .select()
      .from(ativacao)
      .where(eq(ativacao.tenantId, tenantId))
      .limit(1);
    if (precisaReautorizar(aExiste, fingerprint)) {
      const metodos = ['email', ...(aExiste!.reauthTotpSecret ? ['totp'] : [])];
      throw new ForbiddenException({
        message:
          'Esta loja já tem um servidor local em outra máquina. Confirme a mudança com ' +
          'o código (e-mail ou app autenticador) para movê-lo para cá.',
        reauthRequired: true,
        metodos,
        metodoPreferido: aExiste!.reauthMetodo ?? 'email',
      });
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
      // Reativa o equipamento reusado. Se ele estiver inativo/revogado (ex.: revogado
      // antes, ou sobra de uma instalação anterior), o SyncTokenGuard exige ativo=true e
      // rejeita o token com 401 "Token de sync inválido" — o provisionamento "dava certo"
      // e devolvia um token MORTO, então o edge nunca sincronizava e o login local (que
      // depende do pull) ficava sem usuários. Reinstalar tem que curar isso.
      await this.db
        .update(equipamento)
        .set({ ativo: true, revogadoEm: null })
        .where(
          and(
            eq(equipamento.tenantId, tenantId),
            eq(equipamento.tipo, 'servidor_local'),
          ),
        );
    } else {
      const novo: any = await this.equip.criar(tenantId, u.id, u.categoria ?? 'presidente', {
        tipo: 'servidor_local',
        nome: 'Servidor local',
        unidadeId,
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

    // Devolve a unidade resolvida: o instalador grava em EDGE_UNIDADE_ID, que é
    // o escopo do sincronismo deste servidor local.
    return { syncToken, unidadeId, lease: this.leaseDe(row), ativo: true };
  }

  // ===== RE-AUTORIZAÇÃO DE INSTALAÇÃO (F3a-2) =====
  // Mover o edge p/ uma MÁQUINA NOVA (fingerprint diferente) com a trava ligada. 2 etapas:
  // solicitar (cria o pedido + manda o código) e confirmar (valida + MOVE, matando a antiga).

  // Autentica a conta C&O (mesmo critério do instalar) — a senha é a 1ª camada; o código é a 2ª.
  private async autenticarCO(email: string, senha: string) {
    const [u] = await this.db
      .select({
        id: colaborador.id,
        nome: colaborador.nome,
        tenantId: colaborador.tenantId,
        senhaHash: colaborador.senhaHash,
        categoria: funcao.categoria,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .where(eq(colaborador.email, email.trim()))
      .limit(1);
    if (!u?.senhaHash || !(await bcrypt.compare(senha, u.senhaHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }
    if (!['presidente', 'gerente'].includes(u.categoria ?? '')) {
      throw new ForbiddenException('Apenas o C&O ou gerente pode re-autorizar.');
    }
    return u;
  }

  // Etapa 1: cria o pedido. E-mail → gera + envia o código (e ALERTA o dono da tentativa);
  // TOTP → o usuário lê do app (nada a enviar). Devolve o método + o destino mascarado.
  async reautorizarSolicitar(dto: { email?: string; senha?: string; fingerprint?: string; metodo?: string }) {
    const email = String(dto.email ?? '').trim();
    const fingerprint = String(dto.fingerprint ?? '').trim();
    if (!email || !dto.senha || !fingerprint) {
      throw new BadRequestException('E-mail, senha e device são obrigatórios.');
    }
    const u = await this.autenticarCO(email, dto.senha);
    const tenantId = u.tenantId;
    const [a] = await this.db.select().from(ativacao).where(eq(ativacao.tenantId, tenantId)).limit(1);
    if (!a) throw new NotFoundException('Esta loja ainda não tem instalação. Faça a primeira instalação.');
    const metodo = dto.metodo === 'totp' && a.reauthTotpSecret ? 'totp' : 'email';
    let codigo: string | null = null;
    let codigoHash: string | null = null;
    let expiraEm: Date | null = null;
    if (metodo === 'email') {
      codigo = gerarCodigoReauth();
      codigoHash = hashCodigoReauth(codigo);
      expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    }
    const [eqSrv] = await this.db
      .select({ unidadeId: equipamento.unidadeId })
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'servidor_local')))
      .limit(1);
    await this.db.insert(reautorizacaoEdge).values({
      tenantId,
      unidadeId: eqSrv?.unidadeId ?? null,
      fingerprintNovo: fingerprint,
      metodo,
      codigoHash,
      expiraEm,
      status: 'pendente',
    });
    if (metodo === 'email') {
      enviarCodigoVerificacao(email, u.nome ?? '', codigo!).catch(() => {});
    }
    this.logger.warn(`Re-auth SOLICITADA: loja ${tenantId}, método ${metodo}, máquina nova ${fingerprint.slice(0, 12)}…`);
    return { metodo, destino: metodo === 'email' ? this.mascararEmail(email) : 'app autenticador' };
  }

  // Etapa 2: valida o código (e-mail ou TOTP) e MOVE — rotaciona o token (a máquina antiga
  // cai em 401 na hora, porque o SyncTokenGuard olha o TOKEN, não o fingerprint) + rebinda
  // o fingerprint da nova + reativa. Devolve o novo syncToken (o instalador segue com ele).
  async reautorizarConfirmar(dto: { email?: string; senha?: string; fingerprint?: string; codigo?: string }) {
    const email = String(dto.email ?? '').trim();
    const fingerprint = String(dto.fingerprint ?? '').trim();
    const codigo = String(dto.codigo ?? '').trim();
    if (!email || !dto.senha || !fingerprint || !codigo) {
      throw new BadRequestException('E-mail, senha, device e código são obrigatórios.');
    }
    const u = await this.autenticarCO(email, dto.senha);
    const tenantId = u.tenantId;
    const [pend] = await this.db
      .select()
      .from(reautorizacaoEdge)
      .where(
        and(
          eq(reautorizacaoEdge.tenantId, tenantId),
          eq(reautorizacaoEdge.fingerprintNovo, fingerprint),
          eq(reautorizacaoEdge.status, 'pendente'),
        ),
      )
      .orderBy(desc(reautorizacaoEdge.criadoEm))
      .limit(1);
    if (!pend) throw new BadRequestException('Nenhum pedido de re-autorização pendente. Reinicie a instalação.');
    if (pend.tentativas >= 5) {
      await this.db.update(reautorizacaoEdge).set({ status: 'expirada' }).where(eq(reautorizacaoEdge.id, pend.id));
      throw new ForbiddenException('Muitas tentativas. Solicite um novo código.');
    }
    const [a] = await this.db.select().from(ativacao).where(eq(ativacao.tenantId, tenantId)).limit(1);
    let ok = false;
    if (pend.metodo === 'totp' && a?.reauthTotpSecret) {
      ok = verificarTotp(a.reauthTotpSecret, codigo);
    } else {
      if (pend.expiraEm && new Date(pend.expiraEm) < new Date()) {
        throw new BadRequestException('Código expirado. Solicite um novo.');
      }
      ok = !!pend.codigoHash && pend.codigoHash === hashCodigoReauth(codigo);
    }
    if (!ok) {
      await this.db
        .update(reautorizacaoEdge)
        .set({ tentativas: pend.tentativas + 1 })
        .where(eq(reautorizacaoEdge.id, pend.id));
      throw new UnauthorizedException('Código inválido.');
    }
    // APROVADO → MOVE. Rotaciona o token (mata a antiga em 401) ANTES de rebindar.
    const novoToken = randomBytes(24).toString('hex');
    const [eqSrv] = await this.db
      .update(equipamento)
      .set({ token: novoToken, ativo: true, revogadoEm: null })
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'servidor_local')))
      .returning({ unidadeId: equipamento.unidadeId });
    const [row] = await this.db
      .update(ativacao)
      .set({ deviceFingerprint: fingerprint, status: 'ativado', atualizadoEm: new Date() })
      .where(eq(ativacao.id, a!.id))
      .returning();
    await this.db
      .update(reautorizacaoEdge)
      .set({ status: 'aprovada', confirmadoEm: new Date() })
      .where(eq(reautorizacaoEdge.id, pend.id));
    this.logger.warn(`Re-auth APROVADA: loja ${tenantId} movida p/ ${fingerprint.slice(0, 12)}… — token rotacionado.`);
    return { syncToken: novoToken, unidadeId: eqSrv?.unidadeId ?? null, lease: this.leaseDe(row), ativo: true };
  }

  private mascararEmail(email: string): string {
    const [nome, dom] = email.split('@');
    if (!dom) return '***';
    return `${nome.slice(0, 2)}${'*'.repeat(Math.max(1, nome.length - 2))}@${dom}`;
  }

  // Renova o lease (o edge chama no sync, mandando o fingerprint). Suspenso/revogado,
  // conta BLOQUEADA pela distribuição, expirada ou fingerprint divergente → sem lease.
  async renovarLease(tenantId: string, fingerprint?: string, fingerprintLegacy?: string) {
    // Revogação central da distribuição (empresa bloqueada) corta o lease do edge —
    // o servidor local para depois da janela de graça. É o "clone inerte" definitivo.
    const emp: any = await this.db.execute(sql`select status from empresa where id = ${tenantId} limit 1`);
    if ((emp.rows ?? emp)[0]?.status === 'bloqueado') return { ativo: false, motivo: 'revogada' };
    const [a] = await this.db
      .select()
      .from(ativacao)
      .where(and(eq(ativacao.tenantId, tenantId), eq(ativacao.status, 'ativado')))
      .limit(1);
    if (!a) return { ativo: false, motivo: 'sem_licenca_ativa' };
    if (a.validadeAte && new Date(a.validadeAte) < new Date()) return { ativo: false, motivo: 'expirada' };
    // Anti-clonagem NA RENOVAÇÃO: o fingerprint tem que casar com o preso na ativação.
    // Migração transparente do esquema fraco (COMPUTERNAME) p/ o forte (hash do
    // MachineGuid): aceita o NOVO ou o LEGADO; se casou pelo legado, RE-VINCULA no forte.
    const novo = String(fingerprint ?? '').trim();
    const legacy = String(fingerprintLegacy ?? '').trim();
    const bound = a.deviceFingerprint ?? '';
    if (bound && (novo || legacy)) {
      const casaNovo = !!novo && bound.toLowerCase() === novo.toLowerCase();
      const casaLegacy = !!legacy && bound.toLowerCase() === legacy.toLowerCase();
      if (!casaNovo && !casaLegacy) return { ativo: false, motivo: 'fingerprint_divergente' };
      if (casaLegacy && !casaNovo && novo) {
        await this.db.update(ativacao).set({ deviceFingerprint: novo }).where(eq(ativacao.id, a.id));
        (a as any).deviceFingerprint = novo;
      }
    }
    return { ativo: true, lease: this.leaseDe(a) };
  }

  private leaseDe(a: any): string {
    return assinarLease({
      tenantId: a.tenantId,
      ramo: a.ramo,
      plano: a.plano,
      modulos: (a.modulos as string[]) ?? [],
      exp: a.validadeAte ? new Date(a.validadeAte).getTime() : null,
      fp: a.deviceFingerprint ?? null,
    });
  }

  // ===== Heartbeat (telemetria) =====
  async heartbeat(tenantId: string, unidadeId: string | null, dto: any) {
    const [a] = await this.db
      .select({ id: ativacao.id })
      .from(ativacao)
      .where(eq(ativacao.tenantId, tenantId))
      .limit(1);
    await this.db.insert(edgeHeartbeat).values({
      ativacaoId: a?.id ?? null,
      tenantId,
      // Unidade do EDGE derivada do TOKEN (não-spoofável); dto é fallback p/ edge antigo.
      unidadeId: unidadeId ?? dto?.unidadeId ?? null,
      versao: dto?.versao ?? null,
      estado: dto?.estado ?? null,
      ultimoSync: dto?.ultimoSync ? new Date(dto.ultimoSync) : null,
      discoLivreMb: dto?.discoLivreMb != null ? Number(dto.discoLivreMb) : null,
      clientes: dto?.clientes != null ? Number(dto.clientes) : null,
      fingerprint: dto?.fingerprint ?? null, // base do controle de instalação (F3)
      saude: dto?.saude ?? null, // status dos 5 serviços + uptime + restore + impressora
      erro: dto?.erro ?? null,
    });
    return { ok: true };
  }

  // Status da CONTA na nuvem (trial/assinatura) — base do bloqueio duro (G-1).
  // trial_ate NULL = conta sem limite (legado); data = "válido até" (trial ou fim
  // do período pago). O rótulo muda se há assinatura Stripe ativa.
  async statusConta(tenantId: string) {
    const [e] = await this.db
      .select({
        trialAte: empresa.trialAte,
        plano: empresa.plano,
        status: empresa.status,
        assinaturaStatus: empresa.assinaturaStatus,
      })
      .from(empresa)
      .where(eq(empresa.id, tenantId))
      .limit(1);
    if (!e) return { ativa: false, tipo: 'sem_conta', plano: null };
    if (e.status === 'bloqueado') return { ativa: false, tipo: 'bloqueado', plano: e.plano };
    const assinante = ['active', 'trialing', 'past_due'].includes(e.assinaturaStatus ?? '');
    if (!e.trialAte) return { ativa: true, tipo: assinante ? 'assinatura' : 'ativa', plano: e.plano };
    const ate = new Date(e.trialAte).getTime();
    const agora = Date.now();
    if (ate >= agora) {
      return {
        ativa: true,
        tipo: assinante ? 'assinatura' : 'trial',
        plano: e.plano,
        ate: new Date(ate).toISOString(),
        dias: Math.ceil((ate - agora) / 86400000),
      };
    }
    return {
      ativa: false,
      tipo: assinante ? 'assinatura_vencida' : 'trial_expirado',
      plano: e.plano,
      ate: new Date(ate).toISOString(),
    };
  }

  // ===== Assinatura (Stripe · G-6b) =====
  private stripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new ServiceUnavailableException('Pagamento não configurado (STRIPE_SECRET_KEY).');
    return new Stripe(key);
  }

  // Cria a sessão de Checkout (assinatura recorrente) e devolve a URL do Stripe.
  async criarCheckout(tenantId: string, chave: string, ciclo: string) {
    const plano = PLANOS.find((p) => p.chave === chave);
    if (!plano || !['mensal', 'semestral', 'anual'].includes(ciclo)) {
      throw new BadRequestException('Plano ou ciclo inválido.');
    }
    const stripe = this.stripe();
    const [emp] = await this.db
      .select({ nome: empresa.nome, cnpj: empresa.cnpj, cust: empresa.stripeCustomerId })
      .from(empresa)
      .where(eq(empresa.id, tenantId))
      .limit(1);
    if (!emp) throw new NotFoundException('Empresa não encontrada.');

    try {
      let customerId = emp.cust;
      if (!customerId) {
        const c = await stripe.customers.create({
          name: emp.nome,
          metadata: { tenantId, cnpj: emp.cnpj ?? '' },
        });
        customerId = c.id;
        await this.db.update(empresa).set({ stripeCustomerId: customerId }).where(eq(empresa.id, tenantId));
      }

      // O preço é resolvido pelo lookup_key (ex.: completo_mensal) criado no seed.
      const prices = await stripe.prices.list({ lookup_keys: [`${chave}_${ciclo}`], active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) {
        throw new ServiceUnavailableException(
          `Preço "${chave}_${ciclo}" não existe no Stripe. Rode o seed com a MESMA chave do regem-api.`,
        );
      }

      const base = process.env.APP_URL || 'https://app.dmsregem.com';
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${base}/planos?assinatura=ok`,
        cancel_url: `${base}/planos?assinatura=cancel`,
        allow_promotion_codes: true,
        metadata: { tenantId, chave, ciclo },
        subscription_data: { metadata: { tenantId, chave, ciclo } },
      });
      return { url: session.url };
    } catch (e: any) {
      if (e instanceof HttpException) throw e; // 503/404 já tratados acima
      // Erro vindo do Stripe → devolve a mensagem real (em vez de 500 mudo) e loga.
      const msg = e?.raw?.message || e?.message || 'erro desconhecido no Stripe';
      // eslint-disable-next-line no-console
      console.error('[stripe checkout] ', e?.type || '', msg);
      throw new BadRequestException(`Falha no pagamento (Stripe): ${msg}`);
    }
  }

  // Aplica o estado de uma assinatura na empresa (trial_ate = fim do período).
  private async aplicarAssinatura(tenantId: string, sub: Stripe.Subscription, plano?: string) {
    const manter = ['active', 'trialing', 'past_due'].includes(sub.status);
    // current_period_end migrou para o item da assinatura em versões novas da API.
    const anySub = sub as any;
    const fimUnix = anySub.current_period_end ?? anySub.items?.data?.[0]?.current_period_end ?? null;
    const ate = fimUnix ? new Date(fimUnix * 1000) : null;
    await this.db
      .update(empresa)
      .set({
        stripeSubscriptionId: sub.id,
        assinaturaStatus: sub.status,
        ...(plano ? { plano } : {}),
        // válido até o fim do período pago; se não mantém, expira agora.
        trialAte: manter && ate ? ate : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(empresa.id, tenantId));
  }

  // Webhook do Stripe (corpo cru + assinatura). Converte trial em assinatura.
  async stripeWebhook(rawBody: Buffer, sig: string) {
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whsec) throw new ServiceUnavailableException('Webhook não configurado (STRIPE_WEBHOOK_SECRET).');
    const stripe = this.stripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, whsec);
    } catch {
      throw new BadRequestException('Assinatura do webhook inválida.');
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const tenantId = s.metadata?.tenantId;
      if (tenantId && s.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(s.subscription));
        await this.aplicarAssinatura(tenantId, sub, s.metadata?.chave);
      }
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_failed'
    ) {
      const obj: any = event.data.object;
      const subId = obj.subscription || obj.id;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(String(subId));
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) await this.aplicarAssinatura(tenantId, sub, sub.metadata?.chave);
      }
    }
    return { received: true };
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

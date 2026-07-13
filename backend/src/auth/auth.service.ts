import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  empresa,
  funcao,
  colaborador,
  unidade,
  setor,
  perfilAcesso,
} from '../db/schema';
import { AuditoriaService } from '../modules/auditoria/auditoria.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { AuthUser } from './auth-user';
import { PERFIS_PADRAO, perfilPadrao, type Permissoes } from './permissoes';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lockout de PIN: após N falhas em JANELA minutos (na mesma unidade), bloqueia.
const PIN_MAX_FALHAS = 10;
const PIN_JANELA_MIN = 15;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Onboarding em transação: empresa -> função Presidente -> colaborador admin.
  async register(dto: RegisterDto) {
    // E-mail é único global (uq_colaborador_email). Checa antes para dar uma
    // mensagem clara em vez de estourar 500 na violação de unicidade.
    const [existe] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(eq(colaborador.email, dto.email))
      .limit(1);
    if (existe) {
      throw new ConflictException('Este e-mail já tem uma conta. Faça login.');
    }
    const senhaHash = await bcrypt.hash(dto.senha, 10);

    const result = await this.db.transaction(async (tx) => {
      // G-1: todo cadastro novo ganha 3 meses (90 dias) do sistema COMPLETO.
      const [emp] = await tx
        .insert(empresa)
        .values({
          nome: dto.empresaNome,
          plano: 'completo',
          trialAte: new Date(Date.now() + 90 * 86400000),
        })
        .returning();

      const [fun] = await tx
        .insert(funcao)
        .values({ tenantId: emp.id, nome: 'Presidente', categoria: 'presidente' })
        .returning();

      // Semeia os 4 perfis de acesso do novo tenant (mesmos padrões da migration).
      const perfis = await tx
        .insert(perfilAcesso)
        .values(
          PERFIS_PADRAO.map((p) => ({
            tenantId: emp.id,
            nome: p.nome,
            nivel: p.nivel,
            loginWeb: p.loginWeb,
            permissoes: p.permissoes,
          })),
        )
        .returning();
      const perfilPres = perfis.find((p) => p.nivel === 'presidente');

      const [colab] = await tx
        .insert(colaborador)
        .values({
          tenantId: emp.id,
          nome: dto.nome,
          email: dto.email,
          senhaHash,
          funcaoId: fun.id,
          perfilAcessoId: perfilPres?.id,
        })
        .returning();

      return {
        emp,
        colab,
        categoria: fun.categoria,
        permissoes: perfilPres?.permissoes as Permissoes,
      };
    });

    return this.assinar({
      colaboradorId: result.colab.id,
      tenantId: result.emp.id,
      categoria: result.categoria,
      permissoes: result.permissoes,
    });
  }

  async login(dto: LoginDto) {
    const [row] = await this.db
      .select({
        id: colaborador.id,
        tenantId: colaborador.tenantId,
        funcaoId: colaborador.funcaoId,
        senhaHash: colaborador.senhaHash,
        status: colaborador.status,
        funcaoCategoria: funcao.categoria,
        perfilNivel: perfilAcesso.nivel,
        loginWeb: perfilAcesso.loginWeb,
        permissoes: perfilAcesso.permissoes,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(eq(colaborador.email, dto.email));

    // Nível + permissões do perfil (fallback pelo padrão se ainda sem perfil).
    const nivel = row?.perfilNivel ?? row?.funcaoCategoria ?? 'execucao';
    const pad = perfilPadrao(nivel);
    const loginWeb = row?.perfilNivel ? row.loginWeb : pad.loginWeb;
    const permissoes = (row?.permissoes as Permissoes) ?? pad.permissoes;

    if (
      !row ||
      !row.senhaHash ||
      !(await bcrypt.compare(dto.senha, row.senhaHash))
    ) {
      // Falha auditável só quando o e-mail existe (temos o tenant p/ atribuir).
      if (row) {
        await this.auditoria.registrar({
          tenantId: row.tenantId,
          atorId: row.id,
          atorPerfil: nivel,
          tipo: 'auth',
          acao: 'login_falhou',
          entidadeTipo: 'colaborador',
          entidadeId: row.id,
          origem: 'web',
        });
      }
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Bloqueio de acesso e método de login (RBAC no servidor, não no front).
    if (row.status === 'bloqueado') {
      throw new ForbiddenException('Acesso bloqueado. Fale com o presidente/C&O.');
    }
    if (!loginWeb) {
      throw new ForbiddenException(
        'Este perfil não acessa pelo e-mail/senha — use o PIN no terminal/app.',
      );
    }

    const esc = await this.escopo(row.funcaoId);
    await this.auditoria.registrar({
      tenantId: row.tenantId,
      atorId: row.id,
      atorPerfil: nivel,
      tipo: 'auth',
      acao: 'login',
      entidadeTipo: 'colaborador',
      entidadeId: row.id,
      origem: 'web',
    });
    return this.assinar({
      colaboradorId: row.id,
      tenantId: row.tenantId,
      categoria: nivel,
      setorId: esc.setorId,
      unidadeId: esc.unidadeId,
      permissoes,
    });
  }

  // Login por PIN em terminal compartilhado. A unidade resolve o tenant;
  // procura o colaborador do tenant cujo pin_hash confere.
  async pinLogin(dto: PinLoginDto) {
    const [uni] = await this.db
      .select({ tenantId: unidade.tenantId })
      .from(unidade)
      .where(eq(unidade.id, dto.unidadeId));
    if (!uni) throw new UnauthorizedException('Unidade inválida');

    // Lockout: bloqueia após muitas falhas recentes na mesma unidade.
    if (await this.pinBloqueado(dto.unidadeId)) {
      throw new ForbiddenException(
        `Muitas tentativas de PIN. Tente novamente em ${PIN_JANELA_MIN} minutos.`,
      );
    }

    const candidatos = await this.db
      .select({
        id: colaborador.id,
        tenantId: colaborador.tenantId,
        funcaoId: colaborador.funcaoId,
        pinHash: colaborador.pinHash,
        status: colaborador.status,
        funcaoCategoria: funcao.categoria,
        perfilNivel: perfilAcesso.nivel,
        permissoes: perfilAcesso.permissoes,
        nome: colaborador.nome,
        matricula: colaborador.matricula,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(
        and(
          eq(colaborador.tenantId, uni.tenantId),
          isNotNull(colaborador.pinHash),
        ),
      );

    for (const c of candidatos) {
      if (c.pinHash && (await bcrypt.compare(dto.pin, c.pinHash))) {
        if (c.status === 'bloqueado') {
          throw new ForbiddenException('Acesso bloqueado. Fale com o presidente/C&O.');
        }
        const nivel = c.perfilNivel ?? c.funcaoCategoria ?? 'execucao';
        const permissoes =
          (c.permissoes as Permissoes) ?? perfilPadrao(nivel).permissoes;
        const esc = await this.escopo(c.funcaoId);
        const base = this.assinar({
          colaboradorId: c.id,
          tenantId: c.tenantId,
          categoria: nivel,
          setorId: esc.setorId,
          unidadeId: esc.unidadeId,
          permissoes,
        });
        return { ...base, nome: c.nome, matricula: c.matricula ?? null };
      }
    }

    // Falha: registra na auditoria (alimenta o lockout e a trilha).
    await this.auditoria.registrar({
      tenantId: uni.tenantId,
      unidadeId: dto.unidadeId,
      tipo: 'auth',
      acao: 'pin_falhou',
      entidadeTipo: 'unidade',
      entidadeId: dto.unidadeId,
      origem: 'terminal',
    });
    throw new UnauthorizedException('PIN inválido');
  }

  // Conta as falhas de PIN recentes da unidade (janela de lockout).
  private async pinBloqueado(unidadeId: string): Promise<boolean> {
    const r: any = await this.db.execute(sql`
      select count(*)::int as n from audit_log
      where acao = 'pin_falhou' and unidade_id = ${unidadeId}
        and created_at > now() - interval '${sql.raw(String(PIN_JANELA_MIN))} minutes'
    `);
    return Number((r.rows ?? r)[0].n) >= PIN_MAX_FALHAS;
  }

  // Self-service: o próprio colaborador troca a senha (confere a atual).
  async trocarPropriaSenha(
    user: AuthUser,
    dto: { senhaAtual: string; novaSenha: string },
  ) {
    const nova = (dto.novaSenha ?? '').trim();
    if (nova.length < 6)
      throw new UnauthorizedException('A nova senha deve ter ao menos 6 caracteres.');
    const [row] = await this.db
      .select({ senhaHash: colaborador.senhaHash })
      .from(colaborador)
      .where(eq(colaborador.id, user.colaboradorId));
    if (
      !row?.senhaHash ||
      !(await bcrypt.compare(dto.senhaAtual ?? '', row.senhaHash))
    ) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }
    const senhaHash = await bcrypt.hash(nova, 10);
    await this.db
      .update(colaborador)
      .set({ senhaHash, updatedAt: new Date() })
      .where(eq(colaborador.id, user.colaboradorId));
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'auth',
      acao: 'senha_alterada',
      entidadeTipo: 'colaborador',
      entidadeId: user.colaboradorId,
      origem: 'web',
    });
    return { ok: true };
  }

  private assinar(user: AuthUser) {
    const access_token = this.jwt.sign({
      sub: user.colaboradorId,
      tenant: user.tenantId,
      cat: user.categoria,
      setor: user.setorId ?? null,
      uni: user.unidadeId ?? null,
      perm: user.permissoes ?? null,
    });
    return { access_token, user };
  }

  // Escopo do colaborador (setor via função; unidade via setor). Presidente/sem função = sem escopo.
  private async escopo(
    funcaoId: string | null,
  ): Promise<{ setorId: string | null; unidadeId: string | null }> {
    if (!funcaoId) return { setorId: null, unidadeId: null };
    const [f] = await this.db
      .select({ setorId: funcao.setorId })
      .from(funcao)
      .where(eq(funcao.id, funcaoId));
    const setorId = f?.setorId ?? null;
    if (!setorId) return { setorId: null, unidadeId: null };
    const [s] = await this.db
      .select({ unidadeId: setor.unidadeId })
      .from(setor)
      .where(eq(setor.id, setorId));
    return { setorId, unidadeId: s?.unidadeId ?? null };
  }
}

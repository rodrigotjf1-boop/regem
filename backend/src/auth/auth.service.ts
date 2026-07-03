import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { empresa, funcao, colaborador, unidade, setor } from '../db/schema';
import { AuditoriaService } from '../modules/auditoria/auditoria.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { AuthUser } from './auth-user';

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
    const senhaHash = await bcrypt.hash(dto.senha, 10);

    const result = await this.db.transaction(async (tx) => {
      const [emp] = await tx
        .insert(empresa)
        .values({ nome: dto.empresaNome })
        .returning();

      const [fun] = await tx
        .insert(funcao)
        .values({ tenantId: emp.id, nome: 'Presidente', categoria: 'presidente' })
        .returning();

      const [colab] = await tx
        .insert(colaborador)
        .values({
          tenantId: emp.id,
          nome: dto.nome,
          email: dto.email,
          senhaHash,
          funcaoId: fun.id,
        })
        .returning();

      return { emp, colab, categoria: fun.categoria };
    });

    return this.assinar({
      colaboradorId: result.colab.id,
      tenantId: result.emp.id,
      categoria: result.categoria,
    });
  }

  async login(dto: LoginDto) {
    const [row] = await this.db
      .select({
        id: colaborador.id,
        tenantId: colaborador.tenantId,
        funcaoId: colaborador.funcaoId,
        senhaHash: colaborador.senhaHash,
        categoria: funcao.categoria,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .where(eq(colaborador.email, dto.email));

    if (
      !row ||
      !row.senhaHash ||
      !(await bcrypt.compare(dto.senha, row.senhaHash))
    ) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const esc = await this.escopo(row.funcaoId);
    return this.assinar({
      colaboradorId: row.id,
      tenantId: row.tenantId,
      categoria: row.categoria ?? 'execucao',
      setorId: esc.setorId,
      unidadeId: esc.unidadeId,
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
        categoria: funcao.categoria,
        nome: colaborador.nome,
        matricula: colaborador.matricula,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .where(
        and(
          eq(colaborador.tenantId, uni.tenantId),
          isNotNull(colaborador.pinHash),
        ),
      );

    for (const c of candidatos) {
      if (c.pinHash && (await bcrypt.compare(dto.pin, c.pinHash))) {
        const esc = await this.escopo(c.funcaoId);
        const base = this.assinar({
          colaboradorId: c.id,
          tenantId: c.tenantId,
          categoria: c.categoria ?? 'execucao',
          setorId: esc.setorId,
          unidadeId: esc.unidadeId,
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

  private assinar(user: AuthUser) {
    const access_token = this.jwt.sign({
      sub: user.colaboradorId,
      tenant: user.tenantId,
      cat: user.categoria,
      setor: user.setorId ?? null,
      uni: user.unidadeId ?? null,
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

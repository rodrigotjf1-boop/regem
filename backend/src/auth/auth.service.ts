import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNotNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { empresa, funcao, colaborador, unidade } from '../db/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { AuthUser } from './auth-user';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly jwt: JwtService,
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

    return this.assinar({
      colaboradorId: row.id,
      tenantId: row.tenantId,
      categoria: row.categoria ?? 'execucao',
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

    const candidatos = await this.db
      .select({
        id: colaborador.id,
        tenantId: colaborador.tenantId,
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
        const base = this.assinar({
          colaboradorId: c.id,
          tenantId: c.tenantId,
          categoria: c.categoria ?? 'execucao',
        });
        return { ...base, nome: c.nome, matricula: c.matricula ?? null };
      }
    }
    throw new UnauthorizedException('PIN inválido');
  }

  private assinar(user: AuthUser) {
    const access_token = this.jwt.sign({
      sub: user.colaboradorId,
      tenant: user.tenantId,
      cat: user.categoria,
    });
    return { access_token, user };
  }
}

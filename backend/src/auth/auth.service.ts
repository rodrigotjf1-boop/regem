import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { empresa, funcao, colaborador } from '../db/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
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

  private assinar(user: AuthUser) {
    const access_token = this.jwt.sign({
      sub: user.colaboradorId,
      tenant: user.tenantId,
      cat: user.categoria,
    });
    return { access_token, user };
  }
}

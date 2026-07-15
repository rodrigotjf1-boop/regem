import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { colaborador, funcao, perfilAcesso } from '../db/schema';
import type { Permissoes } from './permissoes';

// TTL do cache de revalidação: janela máxima entre uma mudança no banco
// (bloqueio/rebaixamento/permissão) e ela valer nas requisições.
const CACHE_MS = 30_000;

// Valida o Bearer token e injeta req.user. Além de conferir a assinatura do JWT,
// REVALIDA o colaborador no banco (com cache curto): se foi bloqueado ou teve o
// perfil/permissões alterados, vale na hora — sem esperar o token expirar (12h).
// Efeito colateral bom: mudança de permissão NÃO exige relogar.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  private cache = new Map<
    string,
    { exp: number; status: string; categoria: string; permissoes?: Permissoes }
  >();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string | undefined;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    let payload: any;
    try {
      payload = this.jwt.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    // Base vinda do token (fallback se o banco estiver indisponível).
    req.user = {
      colaboradorId: payload.sub,
      tenantId: payload.tenant,
      categoria: payload.cat,
      setorId: payload.setor ?? null,
      unidadeId: payload.uni ?? null,
      permissoes: payload.perm ?? undefined,
    };

    // Revalidação autoritativa contra o banco (cacheada por CACHE_MS).
    try {
      const fresh = await this.estado(payload.sub);
      if (fresh) {
        if (fresh.status === 'bloqueado') {
          throw new UnauthorizedException('Acesso bloqueado. Fale com o presidente/C&O.');
        }
        req.user.categoria = fresh.categoria;
        req.user.permissoes = fresh.permissoes;
      }
    } catch (e) {
      // Bloqueio é decisão de segurança — propaga. Erro de banco (indisponível)
      // não derruba a sessão: segue com os dados do token.
      if (e instanceof UnauthorizedException) throw e;
    }
    return true;
  }

  private async estado(colaboradorId: string) {
    const c = this.cache.get(colaboradorId);
    if (c && c.exp > Date.now()) return c;
    const [row] = await this.db
      .select({
        status: colaborador.status,
        perfilNivel: perfilAcesso.nivel,
        funcaoCategoria: funcao.categoria,
        permissoes: perfilAcesso.permissoes,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(eq(colaborador.id, colaboradorId));
    if (!row) return null;
    const val = {
      exp: Date.now() + CACHE_MS,
      status: (row.status ?? 'ativo') as string,
      categoria: (row.perfilNivel ?? row.funcaoCategoria ?? 'execucao') as string,
      permissoes: (row.permissoes ?? undefined) as Permissoes | undefined,
    };
    this.cache.set(colaboradorId, val);
    return val;
  }
}

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
import { colaborador, funcao, perfilAcesso, suporteSessao, empresa } from '../db/schema';
import { perfilPadrao, PACOTE_SUPORTE, type Permissoes } from './permissoes';
import { lerCookieSessao } from './cookie-sessao';

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
    // Header Bearer tem prioridade (edge/integrações/API); sem ele, cai no cookie
    // httpOnly (nuvem, Fase B). Um dos dois carrega o JWT.
    const header = req.headers['authorization'] as string | undefined;
    const raw = header?.startsWith('Bearer ') ? header.slice(7) : lerCookieSessao(req);
    if (!raw) {
      throw new UnauthorizedException('Token ausente');
    }
    let payload: any;
    try {
      payload = this.jwt.verify(raw);
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    // ===== F9 — token de SUPORTE (técnico da distribuição) =====
    // cat='suporte': permissões vêm SEMPRE do servidor (PACOTE_SUPORTE fixo, nunca
    // do token) e a sessão é revalidada (encerrada/expirada/loja bloqueou → 401).
    if (payload.cat === 'suporte') {
      const sess = await this.estadoSuporte(payload.sessao);
      if (!sess.valida) {
        throw new UnauthorizedException('Sessão de suporte encerrada, expirada ou revogada pela loja.');
      }
      req.user = {
        colaboradorId: payload.sub, // 'sup:<tecnicoId>'
        tenantId: payload.tenant,
        categoria: 'suporte',
        setorId: null,
        unidadeId: null,
        permissoes: PACOTE_SUPORTE, // fixo, do servidor
        suporte: { sessaoId: payload.sessao, tecnicoId: payload.impBy, nome: payload.nome },
      };
      return true;
    }

    // Base vinda do token (fallback se o banco estiver indisponível).
    req.user = {
      colaboradorId: payload.sub,
      tenantId: payload.tenant,
      categoria: payload.cat,
      setorId: payload.setor ?? null,
      unidadeId: payload.uni ?? null,
      permissoes: payload.perm ?? undefined,
      // Campos só-exibição (para o /auth/me alimentar os gates de UI no modo cookie,
      // onde o front não decodifica mais o JWT). Não são usados em decisão de segurança.
      nome: payload.nome,
      func: payload.func,
      perfil: payload.perfil,
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

  private suporteCache = new Map<string, { exp: number; valida: boolean }>();

  // Revalida a sessão de suporte (cache 30s): ativa? não expirada? loja não bloqueou?
  private async estadoSuporte(sessaoId?: string) {
    if (!sessaoId) return { valida: false };
    const c = this.suporteCache.get(sessaoId);
    if (c && c.exp > Date.now()) return c;
    const [row] = await this.db
      .select({
        encerradaEm: suporteSessao.encerradaEm,
        expiraEm: suporteSessao.expiraEm,
        bloq: empresa.suporteBloqueado,
      })
      .from(suporteSessao)
      .leftJoin(empresa, eq(empresa.id, suporteSessao.tenantId))
      .where(eq(suporteSessao.id, sessaoId));
    const valida =
      !!row && !row.encerradaEm && new Date(row.expiraEm as any) > new Date() && !row.bloq;
    const val = { exp: Date.now() + CACHE_MS, valida };
    this.suporteCache.set(sessaoId, val);
    return val;
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
    const categoria = (row.perfilNivel ?? row.funcaoCategoria ?? 'execucao') as string;
    const val = {
      exp: Date.now() + CACHE_MS,
      status: (row.status ?? 'ativo') as string,
      categoria,
      // Sem perfil associado (ex.: colaborador sem função ainda), usa o padrão do
      // nível — MESMO fallback do login. Sem isto a revalidação zerava as
      // permissões (undefined) e o colaborador era barrado em tudo, mesmo com o
      // token trazendo o pacote certo.
      permissoes: (row.permissoes ?? perfilPadrao(categoria).permissoes) as Permissoes,
    };
    this.cache.set(colaboradorId, val);
    return val;
  }
}

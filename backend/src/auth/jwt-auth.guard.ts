import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { rotaDoTerminalDePonto, SESSAO_SO_DO_PONTO } from './sessao-do-ponto';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { colaborador, funcao, perfilAcesso, setor, suporteSessao, empresa } from '../db/schema';
import { cabecalhoDoBilhete, consumirBilhete } from './bilhete-do-mister';
import { perfilPadrao, PACOTE_SUPORTE, PACOTE_SUPORTE_TOTAL, type Permissoes } from './permissoes';
import { lerCookieSessao } from './cookie-sessao';
import { sessaoEncerrada } from './sessao-encerrada';
import { sessaoCortada } from './sessao-corte';

// TTL do cache de revalidação: janela máxima entre uma mudança no banco
// (bloqueio/rebaixamento/permissão) e ela valer nas requisições.
const CACHE_MS = 30_000;

// Valida o Bearer token e injeta req.user. Além de conferir a assinatura do JWT,
// REVALIDA o colaborador no banco (com cache curto): se foi bloqueado, EXCLUÍDO ou teve o
// perfil/permissões alterados, vale na hora — sem esperar o token expirar (12h).
// Efeito colateral bom: mudança de permissão NÃO exige relogar.
//
// Excluir em Cadastros é exclusão lógica (`deleted_at`): a linha continua lá, com `status`
// "ativo". Olhando só o status, quem era excluído e já estava logado seguia com acesso até o
// token vencer — o login recusava, a sessão aberta não (ERR-192).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  private cache = new Map<
    string,
    { exp: number; status: string; excluido: boolean; categoria: string; permissoes?: Permissoes }
  >();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // Mister, versão 10, C3: a leitura de uma tela pelo Mister, com o bilhete de UMA chamada (`bilhete-do-mister.ts`). Com
    // o cabeçalho, só o bilhete decide — nunca cai no cookie ou no Bearer.
    const bilhete = cabecalhoDoBilhete(req);
    if (bilhete !== undefined) return this.peloBilhete(req, bilhete);
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
    // "Sair" encerrou esta sessão (R3-01, mig 457): a cópia do cookie ou do token feita antes não vale mais — a mesma
    // conferência no tempo real (`RealtimeGateway`, V97).
    if (await sessaoEncerrada(this.db, payload)) {
      throw new UnauthorizedException('Sessão encerrada. Entre de novo.');
    }
    // "Perdi o celular" (Mister v6, M6c, mig 473): todo token da pessoa emitido antes do corte deixa de valer, em todos os
    // aparelhos — a mesma conferência no tempo real (V97). À parte da leitura da pessoa abaixo: sem a tabela (o servidor da
    // loja antes da atualização), o bloqueio e a exclusão seguem conferidos.
    if (await sessaoCortada(this.db, payload)) {
      throw new UnauthorizedException('Sessão encerrada em todos os aparelhos. Entre de novo com a sua senha.');
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
        // Pacote imposto pelo servidor: mínimo (só config) OU total, conforme a loja
        // concedeu (empresa.suporte_acesso_total). Nunca vem do token.
        permissoes: sess.acessoTotal ? PACOTE_SUPORTE_TOTAL : PACOTE_SUPORTE,
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
      // Contrato AuthUser: o campo é `funcaoNome`. O token carrega em `func`
      // (compacto); sem esta linha `user.funcaoNome` fica undefined e todo
      // consumidor server-side (ex.: EntregadorService.ehEntregador) falha.
      funcaoNome: payload.func ?? null,
      perfil: payload.perfil,
    };

    // APP "REGEM ATENDIMENTO" (mig 353): a sessão que nasceu no PIN do celular pareado vale SÓ com esse celular. O app
    // manda o id dele em toda chamada, e o `TerminalSegredoInterceptor` confere o segredo e a revogação. Sem isto, o token
    // copiado do celular serviria em qualquer lugar, e revogar o aparelho em Equipamentos não fecharia a sessão.
    if (payload.ap) {
      const h = req.headers['x-terminal-id'];
      if ((Array.isArray(h) ? h[0] : h) !== payload.ap)
        throw new UnauthorizedException('Esta sessão é do app de atendimento: entre pelo celular pareado.');
      req.user.aparelhoId = payload.ap;
    }

    // A SESSÃO DO TERMINAL DE PONTO (A-03, `sessao-do-ponto.ts`): na nuvem, o PIN de quem não tem o acesso online gera
    // uma sessão que só serve para enviar a foto e marcar o ponto. Sem isto, o PIN contornava a trava do login por senha
    // (`pode_nuvem`) e abria a API inteira com o perfil da pessoa.
    if (payload.so === SESSAO_SO_DO_PONTO && !rotaDoTerminalDePonto(req)) {
      throw new ForbiddenException(
        'Esta sessão é só do terminal de ponto. Para o resto, entre pelo servidor da loja ou peça ao presidente o acesso online.',
      );
    }

    // Revalidação autoritativa contra o banco (cacheada por CACHE_MS).
    try {
      const fresh = await this.estado(payload.sub);
      if (fresh) {
        if (fresh.excluido) {
          throw new UnauthorizedException('Acesso encerrado. Fale com o presidente/C&O.');
        }
        if (fresh.status === 'bloqueado') {
          throw new UnauthorizedException('Acesso bloqueado. Fale com o presidente/C&O.');
        }
        req.user.categoria = fresh.categoria;
        req.user.permissoes = fresh.permissoes;
      }
    } catch (e) {
      // Bloqueio e exclusão são decisão de segurança — propagam. Erro de banco (indisponível)
      // não derruba a sessão: segue com os dados do token.
      if (e instanceof UnauthorizedException) throw e;
    }
    return true;
  }

  /**
   * O bilhete do Mister (C3): gasta o bilhete (uma chamada, GET, o caminho exato, 30 s) e monta a pessoa lida no banco
   * AGORA, sem o cache — excluída, bloqueada ou de outra empresa não lê. Perfil, setor, loja e permissões saem como no
   * login (`AuthService.login` + `escopo`): a loja do colaborador; sem ela, a do setor da função.
   */
  private async peloBilhete(req: any, id: string): Promise<boolean> {
    const b = consumirBilhete(id, req.method, req.originalUrl ?? req.url);
    if (!b) throw new UnauthorizedException('Bilhete inválido ou vencido.');
    const [row] = await this.db
      .select({
        nome: colaborador.nome,
        status: colaborador.status,
        deletedAt: colaborador.deletedAt,
        unidadeId: colaborador.unidadeId,
        funcaoNome: funcao.nome,
        funcaoCategoria: funcao.categoria,
        setorId: funcao.setorId,
        setorUnidadeId: setor.unidadeId,
        perfilNivel: perfilAcesso.nivel,
        permissoes: perfilAcesso.permissoes,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(setor, eq(funcao.setorId, setor.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(and(eq(colaborador.id, b.colaboradorId), eq(colaborador.tenantId, b.tenantId)));
    if (!row || row.deletedAt || row.status === 'bloqueado') throw new UnauthorizedException('Acesso encerrado.');
    const categoria = (row.perfilNivel ?? row.funcaoCategoria ?? 'execucao') as string;
    req.user = {
      colaboradorId: b.colaboradorId,
      tenantId: b.tenantId,
      categoria,
      setorId: row.setorId ?? null,
      unidadeId: row.unidadeId ?? row.setorUnidadeId ?? null,
      permissoes: (row.permissoes ?? perfilPadrao(categoria).permissoes) as Permissoes,
      nome: row.nome ?? null,
      funcaoNome: row.funcaoNome ?? null,
      origem: 'mister',
    };
    return true;
  }

  private suporteCache = new Map<string, { exp: number; valida: boolean; acessoTotal?: boolean }>();

  // Revalida a sessão de suporte (cache 30s): ativa? não expirada? loja não bloqueou?
  private async estadoSuporte(sessaoId?: string) {
    if (!sessaoId) return { valida: false, acessoTotal: false };
    const c = this.suporteCache.get(sessaoId);
    if (c && c.exp > Date.now()) return c;
    const [row] = await this.db
      .select({
        encerradaEm: suporteSessao.encerradaEm,
        expiraEm: suporteSessao.expiraEm,
        bloq: empresa.suporteBloqueado,
        total: empresa.suporteAcessoTotal,
      })
      .from(suporteSessao)
      .leftJoin(empresa, eq(empresa.id, suporteSessao.tenantId))
      .where(eq(suporteSessao.id, sessaoId));
    const valida =
      !!row && !row.encerradaEm && new Date(row.expiraEm as any) > new Date() && !row.bloq;
    const val = { exp: Date.now() + CACHE_MS, valida, acessoTotal: !!row?.total };
    this.suporteCache.set(sessaoId, val);
    return val;
  }

  private async estado(colaboradorId: string) {
    const c = this.cache.get(colaboradorId);
    if (c && c.exp > Date.now()) return c;
    const [row] = await this.db
      .select({
        status: colaborador.status,
        deletedAt: colaborador.deletedAt,
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
      excluido: !!row.deletedAt,
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

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  colaborador,
  colaboradorFuncao,
  funcao,
  perfilAcesso,
  unidade,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { NIL_UUID } from '../../auth/unidade-atual.decorator';
import { CreateColaboradorDto } from './dto/create-colaborador.dto';

// Colunas públicas: nunca expõe senha_hash / pin_hash.
const publicCols = {
  id: colaborador.id,
  tenantId: colaborador.tenantId,
  nome: colaborador.nome,
  fotoRef: colaborador.fotoRef,
  funcaoId: colaborador.funcaoId,
  unidadeId: colaborador.unidadeId,
  vinculo: colaborador.vinculo,
  jornadaTipo: colaborador.jornadaTipo,
  email: colaborador.email,
  usuario: colaborador.usuario, // apelido de login (mig 141)
  status: colaborador.status,
  perfilAcessoId: colaborador.perfilAcessoId,
  appHabilitado: colaborador.appHabilitado,
  // Desligamento (mig 135) — para o UI mostrar/filtrar quem saiu ou está em aviso.
  desligamentoTipo: colaborador.desligamentoTipo,
  desligamentoData: colaborador.desligamentoData,
  avisoFim: colaborador.avisoFim,
  desligadoEm: colaborador.desligadoEm,
  createdAt: colaborador.createdAt,
  updatedAt: colaborador.updatedAt,
};

// Hierarquia de acesso. Regra de quem pode CRIAR quem:
//  - alvo presidente/C&O: só um presidente cria outro (sociedades/multi-admin);
//  - demais: o ator precisa estar num nível ESTRITAMENTE acima do alvo
//    (gerente cria supervisão/execução, mas NÃO outro gerente nem presidente).
const NIVEL: Record<string, number> = { presidente: 4, gerente: 3, supervisao: 2, execucao: 1 };
function podeCriarNivel(ator: string, alvo: string): boolean {
  if (alvo === 'presidente') return ator === 'presidente';
  return (NIVEL[ator] ?? 0) > (NIVEL[alvo] ?? 0);
}
// (mig 141) Não há mais restrição de nível para ter login: quem opera o Regem
// precisa entrar com o próprio nome. Quem acessa a web é decidido pelo perfil
// de acesso (`perfil_acesso.login_web`), não pela categoria da função.

@Injectable()
export class ColaboradorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // O login casa por e-mail (sem filtro de tenant), então o e-mail precisa ser
  // único no sistema. Rejeita se já usado por outro colaborador.
  private async emailLivre(email: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(and(eq(colaborador.email, email), isNull(colaborador.deletedAt)));
    if (rows.some((r) => r.id !== exceptId))
      throw new BadRequestException('Este e-mail já está em uso por outro colaborador.');
  }

  // Apelido de login (mig 141): letras/números/._- , único DENTRO da empresa.
  // Normaliza para minúsculas — "Joao" e "joao" são a mesma pessoa entrando.
  private async usuarioLivre(
    tenantId: string,
    bruto?: string | null,
    exceptId?: string,
  ): Promise<string | undefined> {
    const u = String(bruto ?? '').trim().toLowerCase();
    if (!u) return undefined;
    if (!/^[a-z0-9._-]{3,32}$/.test(u))
      throw new BadRequestException(
        'Usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado (sem espaço nem acento).',
      );
    const rows = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.tenantId, tenantId),
          eq(sql`lower(${colaborador.usuario})`, u),
          isNull(colaborador.deletedAt),
        ),
      );
    if (rows.some((r) => r.id !== exceptId))
      throw new BadRequestException('Este usuário já está em uso nesta empresa.');
    return u;
  }

  // Resolve o perfil de acesso: o informado (validado no tenant) ou o do nível
  // da função principal (perfil.nivel = funcao.categoria). Null se não achar.
  private async resolverPerfil(
    tenantId: string,
    perfilAcessoId?: string,
    funcaoId?: string,
  ): Promise<string | null> {
    if (perfilAcessoId) {
      const [p] = await this.db
        .select({ id: perfilAcesso.id })
        .from(perfilAcesso)
        .where(and(eq(perfilAcesso.id, perfilAcessoId), eq(perfilAcesso.tenantId, tenantId)));
      if (!p) throw new BadRequestException('Perfil de acesso inválido.');
      return p.id;
    }
    if (!funcaoId) return null;
    const [f] = await this.db
      .select({ categoria: funcao.categoria })
      .from(funcao)
      .where(eq(funcao.id, funcaoId));
    if (!f) return null;
    const [p] = await this.db
      .select({ id: perfilAcesso.id })
      .from(perfilAcesso)
      .where(
        and(eq(perfilAcesso.tenantId, tenantId), eq(perfilAcesso.nivel, f.categoria as string)),
      );
    return p?.id ?? null;
  }

  // Presidente/C&O: associa perfil, libera o app e bloqueia/desbloqueia o acesso.
  async atualizarAcesso(
    ator: AuthUser,
    id: string,
    dto: { perfilAcessoId?: string; appHabilitado?: boolean; status?: string },
  ) {
    const [alvo] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, ator.tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!alvo) throw new NotFoundException('Colaborador não encontrado.');
    if (id === ator.colaboradorId && dto.status === 'bloqueado') {
      throw new BadRequestException('Você não pode bloquear o seu próprio acesso.');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.perfilAcessoId !== undefined) {
      patch.perfilAcessoId = await this.resolverPerfil(ator.tenantId, dto.perfilAcessoId);
    }
    if (dto.appHabilitado !== undefined) patch.appHabilitado = !!dto.appHabilitado;
    if (dto.status !== undefined) {
      if (!['ativo', 'bloqueado'].includes(dto.status))
        throw new BadRequestException('Status inválido (ativo | bloqueado).');
      patch.status = dto.status;
    }

    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, ator.tenantId)))
      .returning(publicCols);

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'acesso_atualizado',
      entidadeTipo: 'colaborador',
      entidadeId: id,
      detalhe: { perfilAcessoId: dto.perfilAcessoId, status: dto.status, appHabilitado: dto.appHabilitado },
    });
    return row;
  }

  // Unidade padrão do tenant (matriz) — sem isto o colaborador nasce com
  // unidade_id null e SOME da lista, que filtra por loja: parece que o cadastro
  // não foi salvo (e o usuário cadastra de novo). Mesmo padrão do delivery.
  private async unidadePadrao(tenantId: string): Promise<string | null> {
    const r: any = await this.db.execute(sql`
      select id from unidade
      where tenant_id = ${tenantId} and deleted_at is null
      order by (tipo = 'matriz') desc, created_at asc
      limit 1
    `);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }

  // Em qual loja o novo colaborador entra: a informada (validada no tenant), a do
  // gestor que está cadastrando, ou a matriz. Nunca null.
  private async resolverUnidade(
    tenantId: string,
    pedida?: string | null,
  ): Promise<string | null> {
    if (pedida && pedida !== NIL_UUID) {
      const [u] = await this.db
        .select({ id: unidade.id })
        .from(unidade)
        .where(
          and(
            eq(unidade.id, pedida),
            eq(unidade.tenantId, tenantId),
            isNull(unidade.deletedAt),
          ),
        );
      if (u) return u.id;
    }
    return this.unidadePadrao(tenantId);
  }

  async create(
    tenantId: string,
    dto: CreateColaboradorDto,
    atorCategoria = 'presidente',
    unidadeAtual?: string | null,
  ) {
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 12) : undefined;
    const email = dto.email?.trim().toLowerCase() || undefined;
    if (email) await this.emailLivre(email);

    // Só aceita funções deste tenant (evita vínculo cross-tenant).
    const pedidas = [
      ...new Set([...(dto.funcaoIds ?? []), dto.funcaoId].filter(Boolean)),
    ] as string[];
    const validas = pedidas.length
      ? (
          await this.db
            .select({ id: funcao.id })
            .from(funcao)
            .where(
              and(
                eq(funcao.tenantId, tenantId),
                inArray(funcao.id, pedidas),
                isNull(funcao.deletedAt),
              ),
            )
        ).map((f) => f.id)
      : [];
    const principal = dto.funcaoId && validas.includes(dto.funcaoId)
      ? dto.funcaoId
      : validas[0];

    // RBAC de criação: o nível-alvo vem da categoria da função principal.
    let alvoCategoria = 'execucao';
    if (principal) {
      const [f] = await this.db
        .select({ categoria: funcao.categoria })
        .from(funcao)
        .where(eq(funcao.id, principal));
      alvoCategoria = (f?.categoria as string) ?? 'execucao';
    }
    if (!podeCriarNivel(atorCategoria, alvoCategoria)) {
      throw new ForbiddenException(
        alvoCategoria === 'presidente'
          ? 'Só um presidente pode cadastrar outro presidente/C&O.'
          : `Seu perfil não pode cadastrar um colaborador de nível "${alvoCategoria}".`,
      );
    }

    // Credencial de acesso (mig 141): QUALQUER nível pode ter login — o atendente
    // opera o PDV/delivery o turno inteiro e precisa entrar com o próprio nome,
    // senão tudo que ele faz fica registrado em quem abriu o navegador. Quem não
    // tem e-mail entra pelo `usuario` (apelido), único dentro da empresa.
    const usuario = await this.usuarioLivre(tenantId, dto.usuario);
    let senhaHash: string | undefined;
    if (dto.senha) {
      if (!email && !usuario)
        throw new BadRequestException('Informe um usuário (apelido) ou e-mail para o login por senha.');
      senhaHash = await bcrypt.hash(dto.senha, 12);
    }

    // Perfil de acesso: usa o informado ou resolve pelo nível da função principal.
    const perfilAcessoId =
      (await this.resolverPerfil(tenantId, dto.perfilAcessoId, principal)) ??
      undefined;

    const [row] = await this.db
      .insert(colaborador)
      .values({
        tenantId,
        nome: dto.nome,
        fotoRef: dto.fotoRef,
        funcaoId: principal,
        usuario,
        unidadeId: await this.resolverUnidade(tenantId, dto.unidadeId ?? unidadeAtual),
        vinculo: dto.vinculo ?? 'clt',
        jornadaTipo: dto.jornadaTipo ?? 'outro',
        email,
        pinHash,
        senhaHash,
        perfilAcessoId,
      })
      .returning(publicCols);

    if (validas.length) {
      await this.db
        .insert(colaboradorFuncao)
        .values(
          validas.map((funcaoId) => ({
            tenantId,
            colaboradorId: row.id,
            funcaoId,
          })),
        )
        .onConflictDoNothing();
    }
    return { ...row, funcaoIds: validas };
  }

  // Edição geral (Cadastros): dados básicos + funções (N:N) + PIN opcional.
  async update(tenantId: string, id: string, dto: CreateColaboradorDto) {
    const [atual] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');

    const pedidas = [
      ...new Set([...(dto.funcaoIds ?? []), dto.funcaoId].filter(Boolean)),
    ] as string[];
    const validas = pedidas.length
      ? (
          await this.db
            .select({ id: funcao.id })
            .from(funcao)
            .where(
              and(
                eq(funcao.tenantId, tenantId),
                inArray(funcao.id, pedidas),
                isNull(funcao.deletedAt),
              ),
            )
        ).map((f) => f.id)
      : [];
    const principal =
      dto.funcaoId && validas.includes(dto.funcaoId) ? dto.funcaoId : validas[0];

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.fotoRef !== undefined) patch.fotoRef = dto.fotoRef;
    if (dto.vinculo !== undefined) patch.vinculo = dto.vinculo;
    if (dto.jornadaTipo !== undefined) patch.jornadaTipo = dto.jornadaTipo;
    if (principal !== undefined) patch.funcaoId = principal;
    if (dto.email !== undefined) {
      const email = dto.email?.trim().toLowerCase() || null;
      if (email) await this.emailLivre(email, id);
      patch.email = email;
    }
    if (dto.usuario !== undefined) {
      patch.usuario = (await this.usuarioLivre(tenantId, dto.usuario, id)) ?? null;
    }
    if (dto.senha) patch.senhaHash = await bcrypt.hash(dto.senha, 12);
    if (dto.pin) patch.pinHash = await bcrypt.hash(dto.pin, 12);

    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, tenantId)))
      .returning(publicCols);

    // Substitui os vínculos de função quando o campo é enviado.
    if (dto.funcaoIds !== undefined || dto.funcaoId !== undefined) {
      await this.db
        .delete(colaboradorFuncao)
        .where(eq(colaboradorFuncao.colaboradorId, id));
      if (validas.length) {
        await this.db
          .insert(colaboradorFuncao)
          .values(
            validas.map((funcaoId) => ({ tenantId, colaboradorId: id, funcaoId })),
          )
          .onConflictDoNothing();
      }
    }
    return { ...row, funcaoIds: validas };
  }

  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(colaborador)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, tenantId),
          isNull(colaborador.deletedAt),
        ),
      )
      .returning({ id: colaborador.id });
    if (!row) throw new NotFoundException('Colaborador não encontrado.');
    return { ok: true };
  }

  async findAll(tenantId: string, unidadeId?: string | null) {
    const rows = await this.db
      .select(publicCols)
      .from(colaborador)
      .where(
        and(
          eq(colaborador.tenantId, tenantId),
          isNull(colaborador.deletedAt),
          ...(unidadeId ? [eq(colaborador.unidadeId, unidadeId)] : []),
        ),
      );
    // Anexa as funções (N:N) de cada colaborador.
    const links = await this.db
      .select({
        colaboradorId: colaboradorFuncao.colaboradorId,
        funcaoId: colaboradorFuncao.funcaoId,
      })
      .from(colaboradorFuncao)
      .where(eq(colaboradorFuncao.tenantId, tenantId));
    const porColab = new Map<string, string[]>();
    for (const l of links) {
      const arr = porColab.get(l.colaboradorId) ?? [];
      arr.push(l.funcaoId);
      porColab.set(l.colaboradorId, arr);
    }
    return rows.map((r) => ({ ...r, funcaoIds: porColab.get(r.id) ?? [] }));
  }

  // Reset de senha pelo gestor (recuperação sem e-mail): define e-mail (opcional)
  // + nova senha do colaborador. Ação sensível → auditada.
  async definirSenha(
    ator: AuthUser,
    id: string,
    dto: { email?: string; senha: string },
  ) {
    const senha = (dto.senha ?? '').trim();
    if (senha.length < 6)
      throw new BadRequestException('A senha deve ter ao menos 6 caracteres.');
    const [alvo] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, ator.tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!alvo) throw new NotFoundException('Colaborador não encontrado.');

    const senhaHash = await bcrypt.hash(senha, 12);
    const patch: any = { senhaHash, updatedAt: new Date() };
    if (dto.email?.trim()) patch.email = dto.email.trim().toLowerCase();
    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, ator.tenantId)))
      .returning(publicCols);

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'auth',
      acao: 'senha_redefinida',
      entidadeTipo: 'colaborador',
      entidadeId: id,
      origem: 'web',
    });
    return row;
  }
}

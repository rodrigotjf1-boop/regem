import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  empresa,
  funcao,
  colaborador,
  unidade,
  setor,
  perfilAcesso,
  cadastroPendente,
} from '../db/schema';
import { AuditoriaService } from '../modules/auditoria/auditoria.service';
import { consultarCnpjReceita } from '../common/receita-cnpj';
import { enviarCodigoVerificacao } from '../common/mailer';

// Dados do cadastro guardados no pendente até a verificação do e-mail (mig 193).
type CadastroPayload = {
  empresaNome: string;
  cnpj: string;
  nome: string;
  email: string;
  usuario: string;
  senhaHash: string;
  endereco?: string | null;
};
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { AuthUser } from './auth-user';
import { PERFIS_PADRAO, perfilPadrao, type Permissoes } from './permissoes';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lockout de PIN: após N falhas em JANELA minutos (na mesma unidade), bloqueia.
const PIN_MAX_FALHAS = 10;
// Janela curta (recupera rápido) para reduzir DoS interno: um funcionário
// errando PINs de propósito só trava o terminal por poucos minutos.
// Este lockout é a defesa PRIMÁRIA contra brute-force de PIN — conta só falhas e
// é por unidade, então não se contorna trocando de IP (VPN/botnet). O @Throttle
// por IP no controller é apenas teto volumétrico: sozinho ele seria burlado por
// um atacante distribuído e, apertado demais, barra a troca de turno legítima.
const PIN_JANELA_MIN = 5;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Onboarding em transação: empresa -> função Presidente -> colaborador admin.
  // Valida CNPJ pelos dígitos verificadores (14 dígitos, não todos iguais).
  private cnpjValido(c: string): boolean {
    if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
    const dv = (base: string) => {
      let soma = 0;
      let pos = base.length - 7;
      for (const ch of base) {
        soma += Number(ch) * pos--;
        if (pos < 2) pos = 9;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = dv(c.slice(0, 12));
    const d2 = dv(c.slice(0, 12) + String(d1));
    return c.slice(12) === `${d1}${d2}`;
  }

  // ===== Cadastro self-service em 2 passos (verificar e-mail ANTES de criar) =====
  // Passo 1: valida tudo, gera código de 6 dígitos e guarda um CADASTRO PENDENTE
  // (sem criar conta). A conta real só nasce no passo 2 (verificarCadastro), então
  // e-mail inválido/de terceiro não cria nada nem "queima" o CNPJ (anti-burla).
  async registrarInicio(dto: RegisterDto) {
    const cnpj = String(dto.cnpj ?? '').replace(/\D/g, '');
    if (!this.cnpjValido(cnpj)) {
      throw new BadRequestException('CNPJ inválido. Confira os 14 dígitos.');
    }
    const email = String(dto.email ?? '').trim().toLowerCase();
    // Dedup contra contas REAIS (empresa.cnpj / colaborador.email são únicos).
    const [cnpjExiste] = await this.db
      .select({ id: empresa.id })
      .from(empresa)
      .where(eq(empresa.cnpj, cnpj))
      .limit(1);
    if (cnpjExiste) {
      throw new ConflictException(
        'Este CNPJ já tem uma conta no Regem. Faça login ou fale com a distribuição.',
      );
    }
    const [emailExiste] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(eq(colaborador.email, email))
      .limit(1);
    if (emailExiste) {
      throw new ConflictException('Este e-mail já tem uma conta. Faça login.');
    }
    // Existência na Receita (BrasilAPI). Só bloqueia no 404/BAIXADA; indisponibilidade
    // não trava o cadastro (fallback suave).
    const receita = await consultarCnpjReceita(cnpj);
    if (receita.estado === 'nao_existe') {
      throw new BadRequestException('CNPJ não encontrado na Receita Federal. Confira o número.');
    }
    if ((receita.situacao ?? '').toUpperCase() === 'BAIXADA') {
      throw new BadRequestException('Este CNPJ consta como BAIXADO (encerrado) na Receita Federal.');
    }
    // Limpa qualquer pendência antiga do mesmo e-mail/CNPJ (reenvio/refazer limpo).
    await this.db
      .delete(cadastroPendente)
      .where(or(eq(cadastroPendente.email, email), eq(cadastroPendente.cnpj, cnpj)));

    const senhaHash = await bcrypt.hash(dto.senha, 12); // senha nunca em claro nem no payload
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codigoHash = await bcrypt.hash(codigo, 10);
    const payload = {
      empresaNome: dto.empresaNome,
      cnpj,
      nome: dto.nome,
      email,
      usuario: dto.usuario.trim().toLowerCase(),
      senhaHash,
      endereco: dto.endereco?.trim() || null,
    };
    await this.db.insert(cadastroPendente).values({
      email,
      cnpj,
      codigoHash,
      payload,
      expiraEm: new Date(Date.now() + 15 * 60 * 1000),
      reenviadoEm: new Date(),
    });
    await enviarCodigoVerificacao(email, dto.nome, codigo); // dev sem RESEND_API_KEY: loga o código
    return { precisaVerificar: true as const, email };
  }

  // Passo 2: confere o código e SÓ ENTÃO cria a conta (empresa/unidade/presidente).
  async verificarCadastro(email: string, codigo: string) {
    const em = String(email ?? '').trim().toLowerCase();
    const cod = String(codigo ?? '').replace(/\D/g, '');
    const [pend] = await this.db
      .select()
      .from(cadastroPendente)
      .where(eq(cadastroPendente.email, em))
      .limit(1);
    if (!pend) {
      throw new BadRequestException('Cadastro não encontrado. Refaça o cadastro.');
    }
    if (new Date(pend.expiraEm).getTime() < Date.now()) {
      await this.db.delete(cadastroPendente).where(eq(cadastroPendente.id, pend.id));
      throw new BadRequestException('Código expirado. Refaça o cadastro.');
    }
    if ((pend.tentativas ?? 0) >= 5) {
      await this.db.delete(cadastroPendente).where(eq(cadastroPendente.id, pend.id));
      throw new BadRequestException('Muitas tentativas. Refaça o cadastro.');
    }
    const ok = await bcrypt.compare(cod, pend.codigoHash);
    if (!ok) {
      await this.db
        .update(cadastroPendente)
        .set({ tentativas: (pend.tentativas ?? 0) + 1 })
        .where(eq(cadastroPendente.id, pend.id));
      throw new BadRequestException('Código incorreto.');
    }
    const p = pend.payload as CadastroPayload;
    // Re-checa dedup (CNPJ/e-mail podem ter sido tomados entre o passo 1 e o 2).
    const [cnpjExiste] = await this.db
      .select({ id: empresa.id })
      .from(empresa)
      .where(eq(empresa.cnpj, p.cnpj))
      .limit(1);
    const [emailExiste] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(eq(colaborador.email, p.email))
      .limit(1);
    if (cnpjExiste || emailExiste) {
      await this.db.delete(cadastroPendente).where(eq(cadastroPendente.id, pend.id));
      throw new ConflictException('CNPJ ou e-mail já cadastrado. Faça login.');
    }
    const sessao = await this.criarContaVerificada(p);
    await this.db.delete(cadastroPendente).where(eq(cadastroPendente.id, pend.id));
    return sessao;
  }

  // Reenvia o código (rate-limit 1/min). Não revela se o e-mail tem pendência.
  async reenviarCodigo(email: string) {
    const em = String(email ?? '').trim().toLowerCase();
    const [pend] = await this.db
      .select()
      .from(cadastroPendente)
      .where(eq(cadastroPendente.email, em))
      .limit(1);
    if (!pend) return { ok: true };
    if (pend.reenviadoEm && Date.now() - new Date(pend.reenviadoEm).getTime() < 60_000) {
      throw new BadRequestException('Aguarde um minuto para reenviar o código.');
    }
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codigoHash = await bcrypt.hash(codigo, 10);
    await this.db
      .update(cadastroPendente)
      .set({
        codigoHash,
        tentativas: 0,
        expiraEm: new Date(Date.now() + 15 * 60 * 1000),
        reenviadoEm: new Date(),
      })
      .where(eq(cadastroPendente.id, pend.id));
    const nome = (pend.payload as CadastroPayload)?.nome ?? '';
    await enviarCodigoVerificacao(em, nome, codigo);
    return { ok: true };
  }

  // Cria a conta a partir do cadastro verificado e devolve a sessão assinada.
  private async criarContaVerificada(p: CadastroPayload) {
    const result = await this.db.transaction(async (tx) => {
      // G-1: todo cadastro novo ganha 3 meses (90 dias) do sistema COMPLETO.
      const [emp] = await tx
        .insert(empresa)
        .values({
          nome: p.empresaNome,
          cnpj: p.cnpj,
          plano: 'completo',
          trialAte: new Date(Date.now() + 90 * 86400000),
        })
        .returning();

      // Unidade MATRIZ: a "loja" principal do tenant. Sem ela o primeiro login no
      // edge não tinha o que puxar (o sync desce `unidade`). Endereço é opcional.
      await tx.insert(unidade).values({
        tenantId: emp.id,
        nome: p.empresaNome,
        tipo: 'matriz',
        endereco: p.endereco?.trim() || null,
      });

      const [fun] = await tx
        .insert(funcao)
        .values({ tenantId: emp.id, nome: 'Presidente', categoria: 'presidente' })
        .returning();

      // Semeia os 4 perfis de acesso do novo tenant (mesmos padrões da migration).
      const perfis = await tx
        .insert(perfilAcesso)
        .values(
          PERFIS_PADRAO.map((pf) => ({
            tenantId: emp.id,
            nome: pf.nome,
            nivel: pf.nivel,
            loginWeb: pf.loginWeb,
            permissoes: pf.permissoes,
          })),
        )
        .returning();
      const perfilPres = perfis.find((pf) => pf.nivel === 'presidente');

      const [colab] = await tx
        .insert(colaborador)
        .values({
          tenantId: emp.id,
          nome: p.nome,
          email: p.email,
          usuario: p.usuario.trim().toLowerCase(), // login do dono (presidente)
          senhaHash: p.senhaHash,
          funcaoId: fun.id,
          perfilAcessoId: perfilPres?.id,
          podeNuvem: true, // o dono (presidente) acessa a nuvem desde o cadastro
        })
        .returning();

      return {
        emp,
        colab,
        categoria: fun.categoria,
        funcaoNome: fun.nome,
        permissoes: perfilPres?.permissoes as Permissoes,
      };
    });

    return this.assinar({
      colaboradorId: result.colab.id,
      tenantId: result.emp.id,
      categoria: result.categoria,
      permissoes: result.permissoes,
      nome: result.colab.nome,
      funcaoNome: result.funcaoNome,
    });
  }

  async login(dto: LoginDto) {
    // Aceita e-mail (gestão) OU usuário/apelido (mig 141 — quem não tem e-mail).
    const ident = String(dto.identificador ?? dto.email ?? '').trim().toLowerCase();
    if (!ident) throw new UnauthorizedException('Credenciais inválidas');
    const porEmail = ident.includes('@');
    // O usuário é único só DENTRO da empresa: fora de um workspace, um apelido
    // repetido em duas lojas seria ambíguo — aí exigimos o tenant.
    const alvo = porEmail
      ? eq(sql`lower(${colaborador.email})`, ident)
      : and(
          eq(sql`lower(${colaborador.usuario})`, ident),
          ...(dto.tenantId ? [eq(colaborador.tenantId, dto.tenantId)] : []),
        );

    const achados = await this.db
      .select({
        id: colaborador.id,
        nome: colaborador.nome,
        tenantId: colaborador.tenantId,
        funcaoId: colaborador.funcaoId,
        unidadeId: colaborador.unidadeId,
        senhaHash: colaborador.senhaHash,
        status: colaborador.status,
        podeNuvem: colaborador.podeNuvem,
        funcaoCategoria: funcao.categoria,
        funcaoNome: funcao.nome,
        perfilNivel: perfilAcesso.nivel,
        loginWeb: perfilAcesso.loginWeb,
        permissoes: perfilAcesso.permissoes,
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(and(alvo, isNull(colaborador.deletedAt)));

    // Apelido repetido em empresas diferentes sem workspace informado: recusa em
    // vez de escolher um por acaso (senão a senha de um testaria contra o outro).
    if (!porEmail && achados.length > 1) {
      throw new UnauthorizedException(
        'Este usuário existe em mais de uma empresa. Entre pelo workspace da sua loja.',
      );
    }
    const [row] = achados;

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

    // RBAC de modo (S2): o MODO NUVEM (app online) só recebe quem o presidente
    // liberou (`pode_nuvem`). No SERVIDOR LOCAL (edge, EDGE_MODE=true) qualquer
    // perfil entra — a operação da loja é local. O presidente sempre passa (dono).
    const isEdge = process.env.EDGE_MODE === 'true';
    if (!isEdge && nivel !== 'presidente' && !row.podeNuvem) {
      await this.auditoria.registrar({
        tenantId: row.tenantId,
        atorId: row.id,
        atorPerfil: nivel,
        tipo: 'auth',
        acao: 'login_bloqueado_nuvem',
        entidadeTipo: 'colaborador',
        entidadeId: row.id,
        origem: 'web',
      });
      throw new ForbiddenException(
        'Seu acesso é pelo servidor local da loja. Peça ao presidente para liberar o acesso online.',
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
      // Isolamento por loja: a unidade do colaborador manda; cai na cadeia
      // função→setor só quando o colaborador não tem unidade fixa. Presidente
      // (sem unidade) continua null = vê/alterna a rede toda.
      unidadeId: row.unidadeId ?? esc.unidadeId,
      permissoes,
      nome: row.nome,
      funcaoNome: row.funcaoNome,
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
        unidadeId: colaborador.unidadeId,
        pinHash: colaborador.pinHash,
        status: colaborador.status,
        funcaoCategoria: funcao.categoria,
        funcaoNome: funcao.nome,
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
          unidadeId: c.unidadeId ?? esc.unidadeId,
          permissoes,
          nome: c.nome,
          funcaoNome: c.funcaoNome,
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
    const senhaHash = await bcrypt.hash(nova, 12);
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
      nome: user.nome ?? null, // menu inferior: nome do responsável
      func: user.funcaoNome ?? null, // e o rótulo da função (ex.: "Gerente")
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

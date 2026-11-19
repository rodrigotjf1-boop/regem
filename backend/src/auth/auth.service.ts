import { ehServidorLocal } from '../common/modo';
import { SESSAO_SO_DO_PONTO } from './sessao-do-ponto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { encerrarSessao } from './sessao-encerrada';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { JanelaPorChave } from '../common/janela-por-chave';
import { FilaCheia, UmPorVez } from '../common/um-por-vez';
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
import { PERFIS_PADRAO, perfilPadrao, podeAcessar, type Permissoes } from './permissoes';

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
// As conferências de PIN da mesma loja (ou do mesmo aparelho) rodam UMA DE CADA VEZ: a trava acima lê as falhas, compara
// e só depois grava a falha — em paralelo, todas liam antes de qualquer gravação e passavam juntas do teto (segunda
// rodada da avaliação de segurança, B-02). Quantas cabem na fila; além disso, 429 na hora.
const PIN_FILA = 8;

// O código do cadastro (e-mail): 5 tentativas por código, e no máximo 6 códigos por hora para o mesmo e-mail — cada
// código novo zera as tentativas e manda um e-mail a quem talvez não tenha pedido.
const CODIGO_MAX_TENTATIVAS = 5;
const CODIGOS_POR_EMAIL_POR_HORA = 6;

const muitasDeUmaVez = (frase: string) => new HttpException(frase, HttpStatus.TOO_MANY_REQUESTS);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    // Avisa o tempo real que uma sessão saiu (derruba os sockets dela). Opcional: os testes montam o serviço sem ele.
    @Optional() private readonly eventos?: EventEmitter2,
  ) {}

  private readonly log = new Logger('Auth');
  private readonly pinUmPorVez = new UmPorVez(PIN_FILA);
  private readonly codigosPorEmail = new JanelaPorChave(CODIGOS_POR_EMAIL_POR_HORA, 60 * 60 * 1000);

  /** Mais um código para este e-mail? Passou do teto da hora: 429, sem gerar nem mandar. */
  private contarCodigoDoEmail(email: string): void {
    if (!this.codigosPorEmail.contar(email))
      throw muitasDeUmaVez('Muitos códigos pedidos para este e-mail. Tente de novo em uma hora.');
  }

  // O login de um e-mail que não existe comparava com nada e respondia mais rápido do que o de um que existe: o tempo
  // da resposta dizia se o e-mail tem conta. Agora compara com um hash de mentira (gerado uma vez, na primeira falta).
  private hashDeMentira?: Promise<string>;
  private senhaDeMentira(): Promise<string> {
    return (this.hashDeMentira ??= bcrypt.hash(randomBytes(24).toString('hex'), 12));
  }

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
    // O teto de códigos por e-mail (refazer o cadastro também gera código novo e zera as tentativas).
    this.contarCodigoDoEmail(email);
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
    // A tentativa é RESERVADA antes de comparar, na mesma instrução que confere o teto (B-02). Ler, comparar e só então
    // gravar "tentativas + 1" deixava dez pedidos em paralelo lerem o mesmo zero: dez palpites num código de cinco.
    const [reservada] = await this.db
      .update(cadastroPendente)
      .set({ tentativas: sql`${cadastroPendente.tentativas} + 1` })
      .where(and(eq(cadastroPendente.id, pend.id), sql`${cadastroPendente.tentativas} < ${CODIGO_MAX_TENTATIVAS}`))
      .returning({ codigoHash: cadastroPendente.codigoHash, payload: cadastroPendente.payload });
    if (!reservada) {
      await this.db.delete(cadastroPendente).where(eq(cadastroPendente.id, pend.id));
      throw new BadRequestException('Muitas tentativas. Refaça o cadastro.');
    }
    // o código da linha reservada (um reenvio no meio do caminho troca o código: vale o que estava na reserva)
    const ok = await bcrypt.compare(cod, reservada.codigoHash);
    if (!ok) throw new BadRequestException('Código incorreto.');
    const p = reservada.payload as CadastroPayload;
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
    // O pendente é gasto DENTRO da transação que cria a conta: duas confirmações certas ao mesmo tempo criam uma conta
    // só (a segunda espera a primeira, não acha mais o pendente e sai), e a conta que não nasceu devolve o pendente.
    return this.criarContaVerificada(p, pend.id);
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
    const cedo = () => new BadRequestException('Aguarde um minuto para reenviar o código.');
    // a leitura só poupa o trabalho de gerar o código; quem decide é a gravação abaixo
    if (pend.reenviadoEm && Date.now() - new Date(pend.reenviadoEm).getTime() < 60_000) throw cedo();
    // o teto da hora ANTES de trocar o código: recusado aqui, o código que a pessoa já tem segue valendo
    this.contarCodigoDoEmail(em);
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codigoHash = await bcrypt.hash(codigo, 10);
    // O intervalo de um minuto é conferido NA GRAVAÇÃO (B-02): três reenvios em paralelo liam o mesmo "já passou um
    // minuto" e mandavam três códigos, cada um zerando as tentativas. Só o que grava manda.
    const [renovado] = await this.db
      .update(cadastroPendente)
      .set({
        codigoHash,
        tentativas: 0,
        expiraEm: new Date(Date.now() + 15 * 60 * 1000),
        reenviadoEm: sql`now()`,
      })
      .where(
        and(
          eq(cadastroPendente.id, pend.id),
          sql`(${cadastroPendente.reenviadoEm} is null or ${cadastroPendente.reenviadoEm} < now() - interval '60 seconds')`,
        ),
      )
      .returning({ id: cadastroPendente.id });
    if (!renovado) throw cedo();
    const nome = (pend.payload as CadastroPayload)?.nome ?? '';
    await enviarCodigoVerificacao(em, nome, codigo);
    return { ok: true };
  }

  // Cria a conta a partir do cadastro verificado e devolve a sessão assinada.
  private async criarContaVerificada(p: CadastroPayload, pendenteId: string) {
    const result = await this.db.transaction(async (tx) => {
      // Gasta o pendente primeiro (a linha fica presa até o fim desta transação): quem chegar junto espera e não o acha.
      const gasto = await tx
        .delete(cadastroPendente)
        .where(eq(cadastroPendente.id, pendenteId))
        .returning({ id: cadastroPendente.id });
      if (!gasto.length) throw new ConflictException('Este cadastro já foi concluído. Faça login.');
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

    // A comparação roda SEMPRE (com um hash de mentira quando não há conta ou senha): sem ela, a resposta mais rápida
    // dizia que o e-mail não tem conta.
    const senhaConfere = await bcrypt.compare(String(dto.senha ?? ''), row?.senhaHash ?? (await this.senhaDeMentira()));
    if (!row || !row.senhaHash || !senhaConfere) {
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
    const isEdge = ehServidorLocal();
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
    return this.pinNaFila(`loja:${dto.unidadeId}`, () => this.pinLoginNaVez(dto, uni.tenantId));
  }

  /** Uma conferência de PIN de cada vez por loja ou aparelho (ver `PIN_FILA`); a fila cheia responde 429 na hora. */
  private async pinNaFila<T>(chave: string, conferir: () => Promise<T>): Promise<T> {
    try {
      return await this.pinUmPorVez.rodar(chave, conferir);
    } catch (e) {
      if (e instanceof FilaCheia) throw muitasDeUmaVez('Muitas tentativas de PIN ao mesmo tempo. Tente de novo.');
      throw e;
    }
  }

  private async pinLoginNaVez(dto: PinLoginDto, tenantId: string) {
    const uni = { tenantId };
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
          // Excluído não entra por PIN (o login por senha já recusava — ERR-192).
          isNull(colaborador.deletedAt),
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
        // A sessão do PIN é SEMPRE a do terminal de ponto: só marca o ponto e envia a foto, na nuvem e no servidor da
        // loja, para qualquer nível (A-03 e a segunda rodada; ver `sessao-do-ponto.ts`).
        const base = this.assinar(
          {
            colaboradorId: c.id,
            tenantId: c.tenantId,
            categoria: nivel,
            setorId: esc.setorId,
            unidadeId: c.unidadeId ?? esc.unidadeId,
            permissoes,
            nome: c.nome,
            funcaoNome: c.funcaoNome,
          },
          { so: SESSAO_SO_DO_PONTO },
        );
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

  /**
   * O PIN NO CELULAR DO APP "REGEM ATENDIMENTO" (mig 353): a empresa vem do APARELHO pareado — o app não manda empresa
   * nem loja. Cada pessoa entra com o PIN dela (o mesmo do ponto; o aparelho pode ser de uso comum). Excluído, bloqueado,
   * sem acesso ao atendimento ou de outra loja não entra (ERR-192). A trava de tentativas conta POR APARELHO (10 falhas em
   * 5 min), como a do terminal de ponto conta por loja. Devolve a sessão (JWT) presa a este celular (`ap`).
   */
  async pinLoginNoAparelho(ap: { id: string; tenantId: string; unidadeId: string | null }, pin: string) {
    if (!/^\d{4,6}$/.test(String(pin ?? ''))) throw new UnauthorizedException('PIN deve ter de 4 a 6 dígitos.');
    return this.pinNaFila(`aparelho:${ap.id}`, () => this.pinLoginNoAparelhoNaVez(ap, pin));
  }

  private async pinLoginNoAparelhoNaVez(ap: { id: string; tenantId: string; unidadeId: string | null }, pin: string) {
    const falhas: any = await this.db.execute(sql`
      select count(*)::int as n from audit_log
       where acao = 'pin_falhou' and entidade_tipo = 'equipamento' and entidade_id = ${ap.id}::uuid
         and created_at > now() - interval '${sql.raw(String(PIN_JANELA_MIN))} minutes'`);
    if (Number((falhas.rows ?? falhas)[0].n) >= PIN_MAX_FALHAS)
      throw new ForbiddenException(`Muitas tentativas de PIN neste celular. Tente novamente em ${PIN_JANELA_MIN} minutos.`);
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
      })
      .from(colaborador)
      .leftJoin(funcao, eq(colaborador.funcaoId, funcao.id))
      .leftJoin(perfilAcesso, eq(colaborador.perfilAcessoId, perfilAcesso.id))
      .where(and(eq(colaborador.tenantId, ap.tenantId), isNotNull(colaborador.pinHash), isNull(colaborador.deletedAt)));
    for (const c of candidatos) {
      if (!c.pinHash || !(await bcrypt.compare(String(pin), c.pinHash))) continue;
      if (c.status === 'bloqueado') throw new ForbiddenException('Acesso bloqueado. Fale com o presidente.');
      // Só quem está ATIVO (o desligamento — mig 135 — também fecha esta porta: V48).
      if (c.status !== 'ativo') throw new ForbiddenException('Acesso encerrado. Fale com o presidente.');
      const nivel = c.perfilNivel ?? c.funcaoCategoria ?? 'execucao';
      const permissoes = (c.permissoes as Permissoes) ?? perfilPadrao(nivel).permissoes;
      // O app é a fila do atendimento: entra quem a vê no computador (a mesma permissão da tela Atendimento).
      if (nivel !== 'presidente' && !podeAcessar(permissoes, 'pedidos'))
        throw new ForbiddenException('O seu perfil não tem acesso ao atendimento. Fale com o gerente.');
      const esc = await this.escopo(c.funcaoId);
      // A loja: a regra do computador (UnidadeAtual) — quem tem loja fica na dela, e o celular de OUTRA loja não a abre;
      // o presidente (sem loja) fica na loja do celular. Quem não é presidente e não tem loja segue sem enxergar nenhuma.
      const daPessoa = c.unidadeId ?? esc.unidadeId ?? null;
      if (daPessoa && ap.unidadeId && daPessoa !== ap.unidadeId)
        throw new ForbiddenException('Este celular é de outra loja. Entre num celular da sua loja.');
      const loja = daPessoa ?? (nivel === 'presidente' ? ap.unidadeId : null);
      // `ap` no token: a sessão só vale com este celular (JwtAuthGuard).
      const base = this.assinar(
        {
          colaboradorId: c.id,
          tenantId: c.tenantId,
          categoria: nivel,
          setorId: esc.setorId,
          unidadeId: loja,
          permissoes,
          nome: c.nome,
          funcaoNome: c.funcaoNome,
        },
        { ap: ap.id },
      );
      await this.auditoria.registrar({
        tenantId: ap.tenantId,
        unidadeId: ap.unidadeId,
        atorId: c.id,
        atorPerfil: nivel,
        tipo: 'auth',
        acao: 'entrou_no_app_atendimento',
        entidadeTipo: 'equipamento',
        entidadeId: ap.id,
        origem: 'terminal',
      });
      return { ...base, nome: c.nome, categoria: nivel, permissoes, colaboradorId: c.id, unidadeId: loja };
    }
    await this.auditoria.registrar({
      tenantId: ap.tenantId,
      unidadeId: ap.unidadeId,
      tipo: 'auth',
      acao: 'pin_falhou',
      entidadeTipo: 'equipamento',
      entidadeId: ap.id,
      origem: 'terminal',
    });
    throw new UnauthorizedException('PIN inválido.');
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

  // `extra`: marcas a mais no token — `ap`, o celular do app de atendimento (mig 353), e `so`, a sessão do terminal de ponto.
  // `jti`: o número desta sessão — é o que "Sair" encerra no servidor (R3-01, mig 457); vem depois do `extra` para nada o
  // sobrescrever.
  private assinar(user: AuthUser, extra: Record<string, unknown> = {}) {
    const access_token = this.jwt.sign({
      ...extra,
      jti: randomUUID(),
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

  /**
   * SAIR (R3-01, 3ª rodada de segurança; ERR-534; mig 457): encerra no SERVIDOR a sessão do token que veio (o cookie da
   * nuvem ou o Bearer do servidor da loja) — antes, sair só apagava a cópia do navegador, e uma cópia feita antes seguia
   * valendo até vencer (12 h). Só encerra token com a assinatura certa e dentro da validade (o vencido não abre nada); o
   * de suporte tem o encerramento dele. Idempotente e nunca falha para quem chama: a saída do navegador acontece de
   * qualquer jeito (o controlador apaga o cookie antes). Derruba também os sockets do tempo real desta sessão.
   */
  async sair(raw: string | undefined): Promise<{ encerrada: boolean }> {
    if (!raw) return { encerrada: false };
    let payload: any;
    try {
      payload = this.jwt.verify(raw);
    } catch {
      return { encerrada: false };
    }
    if (payload?.cat === 'suporte') return { encerrada: false };
    let encerrada = false;
    try {
      encerrada = await encerrarSessao(this.db, payload);
    } catch (e: any) {
      // A memória deste processo já recusa a sessão; só a gravação no banco falhou (os outros processos não saberão).
      this.log.warn(`sair: a sessão não foi gravada como encerrada (${e?.code ?? e?.message ?? e})`);
      encerrada = true;
    }
    if (!encerrada) return { encerrada };
    this.eventos?.emit('sessao.encerrada', { jti: payload.jti });
    await this.auditoria
      .registrar({
        tenantId: payload.tenant,
        atorId: payload.sub,
        atorPerfil: payload.cat,
        tipo: 'auth',
        acao: 'sessao_encerrada',
        entidadeTipo: 'colaborador',
        entidadeId: payload.sub,
        origem: ehServidorLocal() ? 'edge' : 'web',
      })
      .catch(() => undefined);
    return { encerrada };
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

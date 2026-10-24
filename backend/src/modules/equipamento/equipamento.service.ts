import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { edgeAtivo } from '../../common/edge-ativo';
import { conferirProximoKds } from '../../common/fluxo-kds';
import { garantirImpressoraDaLoja } from '../../common/impressora-da-loja';
import { ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { soltarAvisosParados } from '../gogem/aviso-gogem';
import { DIAS_SEM_SINAL_PARA_REVOGAR, revogarServidoresSubstituidos } from '../licenca/servidor-da-loja';
import { JANELA_PRESENCA_MS, PresencaService, TIPOS_PRESENTES } from './presenca.service';
import { redeDaSaude } from '../edge/rede-local';
import { tamanhosDaTela } from '../tela-senhas/tela-senhas.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O "último uso" do terminal é regravado no máximo a cada 5 min. O app aberto avisa a presença a cada
 * 30 s (`POST /edge/presenca`), com o terminal; gravar a cada chamada seria uma escrita — e uma linha
 * de sincronismo — por requisição de cada caixa. O "agora" mora na presença; o uso, no banco.
 */
export const USO_GRAVAR_A_CADA_MS = 5 * 60_000;

/** O que a lista leva de cada PC que falou com o servidor da loja (terminal e estação). */
export type PresencaPublica = {
  vistoEm: string;
  ip: string | null;
  endereco: string | null;
  maquina: string | null;
  versao: string | null;
};

/** Quem se identifica pelo `X-Integrador` hoje. Valor fora da lista é ignorado. */
export const INTEGRADORES = new Set(['gogem']);
/** "Reativar" vale até quantos dias depois da revogação (ERR-236). A tela usa o mesmo número. */
export const DIAS_PARA_REATIVAR = 30;
/** O "visto" do integrador é regravado no máximo de hora em hora — o GoGeM chama a cada poucos minutos. */
const INTEGRADOR_VISTO_MINUTOS = 60;

/** Quem fez a alteração, para a auditoria (vem do usuário logado, no controller). */
export type AtorEquipamento = { id: string; perfil: string };

/**
 * Por onde veio a ação quando não há usuário logado — o ícone do servidor da loja (fase 4 do pedido de 22–23/10/2026,
 * "o ícone é livre"): a auditoria leva o tipo do ator, a origem e o computador/usuário do Windows no detalhe.
 */
export type ViaDaAcao = { atorTipo: string; origem: string; detalhe: Record<string, unknown> };

/** A forma da via de produção de uma impressora (mig 335), conferida: só as duas que existem. */
function formaDaVia(v: unknown): 'itens' | 'completo' {
  if (v === 'itens' || v === 'completo') return v;
  throw new BadRequestException('Forma de impressão inválida: escolha "só os itens desta impressora" ou "pedido completo".');
}

@Injectable()
export class EquipamentoService {
  private readonly logger = new Logger('Equipamento');
  /** Recusa de marca já logada (por equipamento): o GoGeM mal configurado não enche o log. */
  private readonly recusaDeIntegradorLogada = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    // Opcional: os testes montam o serviço só com o banco e a auditoria.
    @Optional() private readonly presenca?: PresencaService,
  ) {}

  // F10 — com edge ATIVO, o servidor local é a fonte da verdade da config de
  // impressão: a nuvem não sobrescreve (impressora/roteamento/KDS). Edite no edge.
  private async garantirConfigLocal(tenantId: string, tipo?: string) {
    if (await edgeAtivo(this.db, tenantId)) {
      // A tela de senhas segue a mesma regra (ela mostra a cozinha do servidor da loja), com o nome dela no aviso.
      const oQue = tipo === 'tela_senhas' ? 'A tela de senhas desta loja é configurada' : 'Configuração de impressão gerenciada';
      throw new ForbiddenException(`${oQue} pelo servidor local (edge) desta loja. Edite direto no servidor local.`);
    }
  }

  // Consulta simples p/ o front decidir se mostra a config em modo somente-leitura.
  edgeAtivo(tenantId: string) {
    return edgeAtivo(this.db, tenantId).then((ativo) => ({ ativo }));
  }

  private novoToken() {
    return randomBytes(24).toString('hex');
  }

  // Toda mudança no cadastro de equipamentos fica na auditoria com `entidade_tipo = 'equipamento'`
  // — é por aí que a tela de Equipamentos monta o histórico (`historico`).
  private auditar(
    tenantId: string,
    ator: AtorEquipamento | undefined,
    acao: string,
    alvo: { id: string; unidadeId?: string | null },
    detalhe: Record<string, unknown>,
  ) {
    return this.auditoria.registrar({
      tenantId,
      unidadeId: alvo.unidadeId ?? null,
      atorId: ator?.id ?? null,
      atorPerfil: ator?.perfil ?? null,
      tipo: 'config',
      acao,
      entidadeTipo: 'equipamento',
      entidadeId: alvo.id,
      detalhe,
    });
  }

  /** Quem mexeu nos equipamentos (os 100 registros mais recentes). */
  historico(tenantId: string) {
    return this.auditoria.listarPorEntidade(tenantId, 'equipamento', 100);
  }

  /** Nome de outro equipamento da empresa (impressora de destino, próximo KDS) para o histórico. */
  private async nomeDe(tenantId: string, id?: string | null): Promise<string | null> {
    if (!id) return null;
    const [r] = await this.db
      .select({ nome: equipamento.nome })
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)));
    return r?.nome ?? id;
  }

  /** Nome de um setor DA EMPRESA (null se não existe nela, ou se não veio id). */
  private async nomeDoSetor(tenantId: string, id?: string | null): Promise<string | null> {
    if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
    const r: any = await this.db.execute(sql`select nome from setor where id = ${String(id)}::uuid and tenant_id = ${tenantId} and deleted_at is null`);
    return (r.rows ?? r)[0]?.nome ?? null;
  }

  /** Para onde a impressora manda: `ip:porta` na rede, ou o nome dela no Windows. */
  private destinoImpressora(r: { conexao?: string | null; host?: string | null; porta?: number | null; dispositivo?: string | null }) {
    return r.conexao === 'local' ? (r.dispositivo ?? null) : r.host ? `${r.host}${r.porta ? `:${r.porta}` : ''}` : null;
  }

  // ===== Pareamento do PC (mig 142) =====
  // O PC se identificava só pelo id no localStorage: qualquer usuário logado
  // podia trocar o valor no navegador e assumir OUTRO terminal da empresa, com o
  // caixa e a unidade dele. Agora o gestor gera um CÓDIGO curto de uso único, o
  // PC troca esse código por um SEGREDO, e é o segredo que identifica dali em
  // diante. Guardamos só o hash — o valor em claro aparece uma vez para o PC.
  private hash(v: string) {
    return createHash('sha256').update(v).digest('hex');
  }

  // Código de 6 dígitos, fácil de ditar por telefone no suporte.
  async gerarCodigo(tenantId: string, id: string, atorId: string | null, atorPerfil: string | null, via?: ViaDaAcao) {
    const [alvo] = await this.db
      .select({ id: equipamento.id, nome: equipamento.nome, tipo: equipamento.tipo })
      .from(equipamento)
      .where(and(eq(equipamento.id, id), eq(equipamento.tenantId, tenantId)));
    if (!alvo) throw new NotFoundException('Equipamento não encontrado.');
    // A estação e a tela de senhas pareiam no servidor da loja: o código gerado na nuvem não chega a ele a tempo.
    if (alvo.tipo === 'estacao_impressao' || alvo.tipo === 'tela_senhas') await this.garantirConfigLocal(tenantId, alvo.tipo);

    // Evita 0 à esquerda sumindo e colisão com código já pendente de outro PC.
    let codigo = '';
    for (let i = 0; i < 5; i++) {
      codigo = String(100000 + Math.floor(randomInt(900000)));
      const [existe] = await this.db
        .select({ id: equipamento.id })
        .from(equipamento)
        .where(eq(equipamento.pareamentoCodigo, codigo));
      if (!existe) break;
      codigo = '';
    }
    if (!codigo) throw new BadRequestException('Não consegui gerar um código agora. Tente de novo.');

    const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 min é bastante
    await this.db
      .update(equipamento)
      .set({ pareamentoCodigo: codigo, pareamentoExpiraEm: expira })
      .where(eq(equipamento.id, id));

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'config',
      acao: 'terminal_codigo_gerado',
      entidadeTipo: 'equipamento',
      entidadeId: id,
      detalhe: { nome: alvo.nome, ...via?.detalhe },
      ...(via ? { atorTipo: via.atorTipo, origem: via.origem } : {}),
    });
    return { codigo, expiraEm: expira, nome: alvo.nome };
  }

  // O PC troca o código pelo segredo. Público (o PC ainda não tem credencial),
  // por isso o código é curto, de uso único e expira. Convive com o `parear()`
  // por token, que continua valendo para quem já configurou assim.
  // "Trocar máquina" (Fase 4/DR): reseta o binding do dispositivo — segredo,
  // fingerprint e anti-rollback — e gera um NOVO código de pareamento. A máquina
  // nova pareia do zero; a antiga fica inerte (segredo revogado).
  async trocarMaquina(tenantId: string, id: string, atorId: string, atorPerfil: string) {
    const [alvo] = await this.db
      .select({ id: equipamento.id, nome: equipamento.nome })
      .from(equipamento)
      .where(and(eq(equipamento.id, id), eq(equipamento.tenantId, tenantId)));
    if (!alvo) throw new NotFoundException('Equipamento não encontrado.');
    let codigo = '';
    for (let i = 0; i < 5; i++) {
      codigo = String(100000 + Math.floor(randomInt(900000)));
      const [existe] = await this.db
        .select({ id: equipamento.id })
        .from(equipamento)
        .where(eq(equipamento.pareamentoCodigo, codigo));
      if (!existe) break;
      codigo = '';
    }
    if (!codigo) throw new BadRequestException('Não consegui gerar um código agora. Tente de novo.');
    await this.db
      .update(equipamento)
      .set({
        segredoHash: null,
        fingerprint: null,
        lastPushTs: null,
        pareadoEm: null,
        revogadoEm: null,
        pareamentoCodigo: codigo,
        pareamentoExpiraEm: new Date(Date.now() + 15 * 60 * 1000),
      })
      .where(eq(equipamento.id, id));
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'config',
      acao: 'terminal_trocado',
      entidadeTipo: 'equipamento',
      entidadeId: id,
      detalhe: { nome: alvo.nome },
    });
    return { ok: true, codigo, nome: alvo.nome };
  }

  // `tipo` (opcional): o aparelho diz o que ele é. Código de OUTRO tipo é recusado SEM ser gasto — o código do PDV
  // digitado por engano na TV não pode trocar o segredo do PDV (ele ficaria sem pareamento). Quem não manda, como
  // sempre.
  async parearPorCodigo(codigo: string, fingerprint?: string, tipo?: string) {
    const c = String(codigo ?? '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(c)) throw new BadRequestException('Código inválido.');
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(eq(equipamento.pareamentoCodigo, c));
    if (!row) throw new BadRequestException('Código não encontrado. Gere um novo no Regem.');
    if (row.pareamentoExpiraEm && row.pareamentoExpiraEm.getTime() < Date.now())
      throw new BadRequestException('Código expirado. Gere um novo no Regem.');
    if (row.revogadoEm) throw new BadRequestException('Este equipamento foi revogado.');
    if (tipo && row.tipo !== tipo)
      throw new BadRequestException(
        tipo === 'tela_senhas'
          ? 'Este código é de outro equipamento, não de uma tela de senhas. Gere o código na tela de senhas, em Equipamentos.'
          : 'Este código é de outro tipo de equipamento. Gere o código no equipamento certo.',
      );

    const segredo = randomBytes(32).toString('hex');
    await this.db
      .update(equipamento)
      .set({
        segredoHash: this.hash(segredo),
        pareadoEm: new Date(),
        pareamentoCodigo: null, // uso único
        pareamentoExpiraEm: null,
        // Amarra o token ao hardware que pareou (anti-clone). Enforcement por
        // requisição fica p/ 1.3b; aqui capturamos o binding.
        fingerprint: fingerprint ? String(fingerprint).slice(0, 200) : row.fingerprint,
      })
      .where(eq(equipamento.id, row.id));

    await this.auditoria.registrar({
      tenantId: row.tenantId,
      tipo: 'config',
      acao: 'terminal_pareado',
      entidadeTipo: 'equipamento',
      entidadeId: row.id,
      origem: 'terminal',
      detalhe: { nome: row.nome },
    });
    return {
      terminalId: row.id,
      segredo, // única vez que sai em claro
      nome: row.nome,
      tipo: row.tipo,
      unidadeId: row.unidadeId,
    };
  }

  // Confere o segredo que o PC manda no header. Devolve o equipamento ou null.
  async validarSegredo(tenantId: string, terminalId: string, segredo?: string | null) {
    if (!terminalId) return null;
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(
        and(
          eq(equipamento.id, terminalId),
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.ativo, true),
        ),
      );
    if (!row || row.revogadoEm) return null;
    // Compatibilidade: PC pareado ANTES da mig 142 ainda não tem segredo — segue
    // valendo até parear de novo, senão o cliente fica sem PDV no dia do deploy.
    if (!row.segredoHash) return row;
    if (!segredo || this.hash(segredo) !== row.segredoHash) return null;
    const usadoEm = row.ultimoUsoEm ? new Date(row.ultimoUsoEm as any).getTime() : 0;
    if (!usadoEm || Date.now() - usadoEm >= USO_GRAVAR_A_CADA_MS) {
      await this.db
        .update(equipamento)
        .set({ ultimoUsoEm: new Date() })
        .where(eq(equipamento.id, row.id));
    }
    return row;
  }

  /**
   * Estação de impressão (mig 324): confere o segredo do PC que imprime as impressoras ligadas
   * nele. Só o tipo `estacao_impressao`, ativo, não revogado e COM segredo — não existe estação de
   * antes do pareamento, então não há a tolerância do `validarSegredo` para PC sem segredo.
   * Não grava "último uso" a cada chamada: a estação consulta a fila a cada ~25 s e cada gravação
   * renovaria o `updated_at` de uma linha que sincroniza (o mesmo vaivém do ERR-235).
   * Devolve o equipamento ou null.
   */
  async validarEstacao(estacaoId: string, segredo?: string | null) {
    if (!estacaoId || !/^[0-9a-f-]{36}$/i.test(estacaoId) || !segredo) return null;
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(
        and(
          eq(equipamento.id, estacaoId),
          eq(equipamento.tipo, 'estacao_impressao'),
          eq(equipamento.ativo, true),
        ),
      );
    if (!row || row.revogadoEm || !row.segredoHash) return null;
    const recebido = Buffer.from(this.hash(String(segredo)), 'hex');
    const guardado = Buffer.from(row.segredoHash, 'hex');
    if (recebido.length !== guardado.length || !timingSafeEqual(recebido, guardado)) return null;
    return row;
  }

  /**
   * Tela de senhas (mig 337): a TV se identifica pelo id + o segredo que recebeu no pareamento, sem login. Só o tipo
   * `tela_senhas`, ativo, não revogado e COM segredo. Como a estação, não grava "último uso" a cada leitura: a TV lê
   * a cada aviso e a cada 30 s, e cada gravação renovaria o `updated_at` de uma linha que sincroniza (ERR-235).
   * Devolve o equipamento ou null.
   */
  async validarTela(telaId: string, segredo?: string | null) {
    if (!telaId || !/^[0-9a-f-]{36}$/i.test(telaId) || !segredo) return null;
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.id, telaId), eq(equipamento.tipo, 'tela_senhas'), eq(equipamento.ativo, true)));
    if (!row || row.revogadoEm || !row.segredoHash) return null;
    const recebido = Buffer.from(this.hash(String(segredo)), 'hex');
    const guardado = Buffer.from(row.segredoHash, 'hex');
    if (recebido.length !== guardado.length || !timingSafeEqual(recebido, guardado)) return null;
    return row;
  }


  // Cadastra um device. O token é exibido UMA vez (não volta em listagens).
  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateEquipamentoDto,
  ) {
    // F10 — impressora/KDS são config de impressão: com edge ativo, cria no edge. A estação de
    // impressão também: ela pareia e imprime pelo servidor da loja (mig 324).
    // A tela de senhas também (mig 337): ela mostra a cozinha do servidor da loja e pareia nele.
    if (['impressora', 'kds', 'estacao_impressao', 'tela_senhas'].includes(dto.tipo)) await this.garantirConfigLocal(tenantId, dto.tipo);
    if (dto.tipo === 'pdv')
      await garantirImpressoraDaLoja(this.db, tenantId, dto.impressoraPadraoId ?? null, dto.unidadeId ?? null);
    // "Ligada em" (mig 324): a mesma conferência do salvar impressora.
    if (dto.tipo === 'impressora' && dto.estacaoId) await this.conferirEstacao(tenantId, dto.estacaoId, dto.unidadeId ?? null);
    const token = this.novoToken();
    const [row] = await this.db
      .insert(equipamento)
      .values({
        tenantId,
        estacaoId: dto.tipo === 'impressora' ? dto.estacaoId ?? null : undefined,
        unidadeId: dto.unidadeId,
        tipo: dto.tipo,
        nome: dto.nome,
        token,
        mac: dto.mac,
        escopo: dto.escopo ?? 'producao',
        papel: dto.papel,
        // Papel múltiplo (mig 167): usa os flags se vierem; senão deriva do papel
        // (compat com clientes antigos que só mandam `papel`).
        fazCupom:
          dto.tipo === 'impressora'
            ? (dto.fazCupom ?? dto.papel === 'cupom')
            : undefined,
        fazProducao:
          dto.tipo === 'impressora'
            ? (dto.fazProducao ?? (dto.papel === 'producao' || dto.papel == null))
            : undefined,
        setorId: dto.setorId,
        // Impressora: conexão rede (IP:porta) ou local (USB/Windows por nome).
        conexao: dto.tipo === 'impressora' ? (dto.conexao === 'local' ? 'local' : 'rede') : undefined,
        host: dto.tipo === 'impressora' && dto.conexao === 'local' ? null : dto.host,
        porta: dto.tipo === 'impressora' && dto.conexao === 'local' ? null : dto.porta,
        dispositivo: dto.tipo === 'impressora' && dto.conexao === 'local' ? dto.dispositivo : undefined,
        largura: dto.tipo === 'impressora' ? dto.largura ?? 80 : undefined,
        codepage: dto.tipo === 'impressora' ? dto.codepage ?? null : undefined, // acentos (mig 269)
        setoresAtendidos:
          dto.tipo === 'impressora' && Array.isArray(dto.setoresAtendidos)
            ? dto.setoresAtendidos
            : undefined,
        padrao: dto.tipo === 'impressora' ? !!dto.padrao : undefined,
        // Forma da via de produção (mig 335); o DTO já recusou o que não é 'itens' nem 'completo'.
        formaProducao: dto.tipo === 'impressora' && dto.formaProducao ? formaDaVia(dto.formaProducao) : undefined,
        impressoraPadraoId:
          dto.tipo === 'pdv' ? dto.impressoraPadraoId ?? null : undefined,
        // Sub-PDV salão (mig 133): ponto de lançamento atrelado a um PDV main.
        pdvMainId: dto.tipo === 'salao' ? dto.pdvMainId ?? null : undefined,
        // KDS — impressão guiada por etapa (mig 129).
        imprimeAoAvancar: dto.tipo === 'kds' ? !!dto.imprimeAoAvancar : undefined,
        imprimeNoStatus:
          dto.tipo === 'kds'
            ? ['recebido', 'preparo', 'pronto', 'entregue'].includes(dto.imprimeNoStatus ?? '')
              ? (dto.imprimeNoStatus as string)
              : 'pronto'
            : undefined,
        impressoraDestinoId: dto.tipo === 'kds' ? dto.impressoraDestinoId ?? null : undefined,
      })
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'modulos',
      acao: 'cadastrou_equipamento',
      entidadeTipo: 'equipamento',
      entidadeId: row.id,
      detalhe: { tipo: row.tipo, nome: row.nome },
    });
    // token só aqui — para configurar o device.
    return { ...this.publico(row), token };
  }

  async listar(tenantId: string) {
    const rows = await this.db
      .select()
      .from(equipamento)
      .where(eq(equipamento.tenantId, tenantId))
      .orderBy(desc(equipamento.createdAt));
    let lista: any[] = rows.map((r) => this.publico(r));
    if (rows.some((r) => r.tipo === 'estacao_impressao')) {
      const sinais = await this.sinaisDasEstacoes(tenantId);
      lista = lista.map((e: any) => (e.tipo === 'estacao_impressao' ? { ...e, estacao: sinais.get(e.id) ?? null } : e));
    }
    if (!ehServidorLocal() && rows.some((r) => r.tipo === 'servidor_local')) {
      const sinais = await this.sinaisDosServidores(tenantId);
      lista = lista.map((e: any) => (e.tipo === 'servidor_local' ? { ...e, servidor: sinais.get(e.id) ?? null } : e));
    }
    // Quem está ligado AGORA (conexão PC ↔ servidor, parte 1): terminal com o app aberto e estação.
    const temPresenca = (tipo: string) => (TIPOS_PRESENTES as readonly string[]).includes(tipo);
    if (rows.some((r) => temPresenca(r.tipo))) {
      const presentes = await this.presencas(tenantId);
      lista = lista.map((e: any) => (temPresenca(e.tipo) ? { ...e, presenca: presentes.get(e.id) ?? null } : e));
    }
    return lista;
  }

  /**
   * A presença de cada terminal e estação: no servidor da loja, a da memória (eles falam com ele); na
   * nuvem de uma loja com servidor, o resumo que o servidor manda na saúde da batida (só de batidas
   * dos últimos 10 min). Vale a mais recente. Best-effort: sem nada, a lista sai sem presença.
   */
  private async presencas(tenantId: string): Promise<Map<string, PresencaPublica>> {
    const mapa = new Map<string, PresencaPublica>();
    const guardar = (id: string, p: PresencaPublica) => {
      const atual = mapa.get(id);
      if (!atual || Date.parse(p.vistoEm) > Date.parse(atual.vistoEm)) mapa.set(id, p);
    };
    const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    if (ehServidorLocal()) {
      for (const p of this.presenca?.doTenant(tenantId) ?? []) {
        guardar(p.id, { vistoEm: p.vistoEm, ip: p.ip, endereco: p.endereco, maquina: p.maquina, versao: p.versao });
      }
      return mapa;
    }
    try {
      const r: any = await this.db.execute(sql`
        select saude from edge_status where tenant_id = ${tenantId} and recebido_em >= now() - interval '10 minutes'`);
      const agora = Date.now();
      for (const x of r.rows ?? r) {
        const sd = typeof x.saude === 'string' ? JSON.parse(x.saude) : x.saude;
        for (const p of Array.isArray(sd?.presenca?.pcs) ? sd.presenca.pcs : []) {
          const visto = Date.parse(String(p?.vistoEm ?? ''));
          if (!p?.id || !Number.isFinite(visto) || agora - visto > JANELA_PRESENCA_MS) continue;
          guardar(String(p.id), {
            vistoEm: new Date(visto).toISOString(),
            ip: texto(p.ip, 64),
            endereco: texto(p.endereco, 120),
            maquina: texto(p.maquina, 120),
            versao: texto(p.versao, 40),
          });
        }
      }
    } catch { /* sem edge_status */ }
    return mapa;
  }

  // O sinal real de cada servidor da loja: a última saúde que ele mandou (`edge_status`, uma linha por
  // servidor). `ultimo_ping` do servidor nunca é gravado — a lista o dava como "nunca conectou",
  // mesmo o servidor em uso (ERR-236). Só na nuvem (a tabela é dela). Best-effort.
  private async sinaisDosServidores(tenantId: string) {
    const sinais = new Map<
      string,
      { vistoEm: string | null; versao: string | null; estado: string | null; rede: { ip: string | null; maquina: string | null } | null }
    >();
    try {
      const r: any = await this.db.execute(sql`
        select equipamento_id as id, recebido_em as "vistoEm", versao, estado, saude -> 'rede' as rede
          from edge_status where tenant_id = ${tenantId}`);
      for (const x of r.rows ?? r) {
        // O endereço do servidor na rede (conexão PC ↔ servidor): o grupo "Servidor da loja" em Equipamentos.
        const rede = redeDaSaude(typeof x.rede === 'string' ? JSON.parse(x.rede) : x.rede);
        sinais.set(String(x.id), {
          vistoEm: x.vistoEm ? new Date(x.vistoEm).toISOString() : null,
          versao: x.versao ?? null,
          estado: x.estado ?? null,
          rede: rede ? { ip: rede.ip, maquina: rede.maquina } : null,
        });
      }
    } catch { /* sem edge_status */ }
    return sinais;
  }

  /**
   * O IP do servidor da loja na rede, para a estação de impressão que o perdeu (conexão PC ↔ servidor,
   * parte 2): o roteador deu outro IP ao servidor e o nome regem.local não resolve naquele PC. A nuvem
   * sabe o IP pela saúde que o servidor manda a cada minuto (`edge_status.saude.rede`). Vale o servidor
   * da loja da estação (ou o sem loja — V4), ativo e não revogado; entre eles, o da própria loja e depois
   * o visto por último. A estação só usa o IP depois de conferir ali o certificado DA LOJA: esta resposta
   * sozinha não a faz confiar em ninguém. Só na nuvem (a tabela é dela). Sem sinal: `ip: null`.
   */
  async servidorParaEstacao(tenantId: string, unidadeId: string | null) {
    const vazio = { ip: null as string | null, maquina: null as string | null, vistoEm: null as string | null };
    try {
      const r: any = await this.db.execute(sql`
        select s.recebido_em as "vistoEm", s.saude -> 'rede' as rede
          from edge_status s
          join equipamento e on e.id = s.equipamento_id and e.tenant_id = s.tenant_id
         where s.tenant_id = ${tenantId}
           and e.tipo = 'servidor_local' and e.ativo and e.revogado_em is null
           and (${unidadeId}::uuid is null or e.unidade_id is null or e.unidade_id = ${unidadeId}::uuid)
         order by (e.unidade_id is not distinct from ${unidadeId}::uuid) desc, s.recebido_em desc
         limit 1`);
      const x = (r.rows ?? r)[0];
      const rede = x ? redeDaSaude(typeof x.rede === 'string' ? JSON.parse(x.rede) : x.rede) : null;
      if (!rede?.ip) return vazio;
      return { ip: rede.ip, maquina: rede.maquina, vistoEm: x.vistoEm ? new Date(x.vistoEm).toISOString() : null };
    } catch {
      return vazio; // sem edge_status
    }
  }

  // O último sinal de cada estação de impressão (mig 325): o desta base (a estação bate aqui) e, na
  // nuvem de uma loja com servidor local, o que o servidor manda na saúde (a estação bate nele). Vale
  // o mais recente. Best-effort: sem a tabela, a lista sai sem o sinal.
  private async sinaisDasEstacoes(tenantId: string) {
    type Sinal = { vistoEm: string | null; versao: string | null; maquina: string | null; impressoras: string[] };
    const sinais = new Map<string, Sinal>();
    const guardar = (id: string, s: Sinal) => {
      const atual = sinais.get(id);
      if (!atual || (s.vistoEm && (!atual.vistoEm || new Date(s.vistoEm) > new Date(atual.vistoEm)))) {
        sinais.set(id, { ...s, impressoras: s.impressoras.length ? s.impressoras : atual?.impressoras ?? [] });
      }
    };
    try {
      const r: any = await this.db.execute(sql`
        select equipamento_id as id, versao, maquina, impressoras, visto_em as "vistoEm"
          from estacao_status where tenant_id = ${tenantId}`);
      for (const x of r.rows ?? r) {
        guardar(String(x.id), {
          vistoEm: x.vistoEm ? new Date(x.vistoEm).toISOString() : null,
          versao: x.versao ?? null,
          maquina: x.maquina ?? null,
          impressoras: Array.isArray(x.impressoras) ? x.impressoras : [],
        });
      }
    } catch { /* banco sem a mig 325 */ }
    if (!ehServidorLocal()) {
      try {
        const r: any = await this.db.execute(sql`
          select saude from edge_status where tenant_id = ${tenantId} and recebido_em >= now() - interval '10 minutes'`);
        for (const x of r.rows ?? r) {
          const sd = typeof x.saude === 'string' ? JSON.parse(x.saude) : x.saude;
          for (const e of Array.isArray(sd?.estacoes) ? sd.estacoes : []) {
            if (e?.id) guardar(String(e.id), { vistoEm: e.vistoEm ?? null, versao: e.versao ?? null, maquina: e.maquina ?? null, impressoras: [] });
          }
        }
      } catch { /* sem edge_status */ }
    }
    return sinais;
  }

  // Define/limpa a impressora de cupom amarrada a um terminal de PDV.
  async setImpressoraTerminal(
    tenantId: string,
    id: string,
    impressoraId: string | null,
    ator?: AtorEquipamento,
  ) {
    const [term] = await this.db
      .select({ unidadeId: equipamento.unidadeId, antes: equipamento.impressoraPadraoId })
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)));
    await garantirImpressoraDaLoja(this.db, tenantId, impressoraId, term?.unidadeId ?? null);
    const [row] = await this.db
      .update(equipamento)
      .set({ impressoraPadraoId: impressoraId || null })
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.id, id),
          eq(equipamento.tipo, 'pdv'),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Terminal não encontrado');
    const [antes, depois] = [term?.antes ?? null, row.impressoraPadraoId ?? null];
    if (antes !== depois) {
      // o nome das impressoras, para o histórico se ler sozinho
      await this.auditar(tenantId, ator, 'alterou_impressora_do_terminal', row, {
        nome: row.nome,
        impressoraAntes: await this.nomeDe(tenantId, antes),
        impressoraDepois: await this.nomeDe(tenantId, depois),
      });
    }
    return this.publico(row);
  }

  // "Configurar" de QUALQUER equipamento: o nome e, por tipo, o que dá para trocar depois do
  // cadastro — KDS: setor e escopo; sub-PDV do salão: o PDV principal. Campo ausente mantém (V16).
  // O tipo, a unidade e o token não mudam por aqui. A impressora (conexão, papel, vias…) continua em
  // `salvarImpressora`; a impressora de cupom do PDV, a impressão por etapa e o próximo KDS, nas
  // rotas próprias. Antes só a impressora tinha edição: os outros não tinham como trocar o nome.
  async atualizar(tenantId: string, id: string, dto: any, ator?: AtorEquipamento) {
    const [atual] = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)));
    if (!atual) throw new NotFoundException('Equipamento não encontrado');
    if (!atual.ativo) throw new BadRequestException('Equipamento revogado não é editado.');
    // Com servidor local ativo, impressora, KDS e tela de senhas são configurados nele (mesma trava do cadastro).
    if (atual.tipo === 'impressora' || atual.tipo === 'kds' || atual.tipo === 'tela_senhas') await this.garantirConfigLocal(tenantId, atual.tipo);

    const set: { nome?: string; escopo?: string; setorId?: string | null; pdvMainId?: string; proximoKdsId?: null } = {};
    const mudou: Record<string, { de: unknown; para: unknown }> = {};
    if (dto?.nome !== undefined) {
      const nome = String(dto.nome ?? '').trim();
      if (!nome) throw new BadRequestException('Informe o nome do equipamento.');
      if (nome.length > 80) throw new BadRequestException('O nome tem no máximo 80 caracteres.');
      if (nome !== atual.nome) {
        set.nome = nome;
        mudou.nome = { de: atual.nome, para: nome };
      }
    }
    if (atual.tipo === 'kds' && dto?.escopo !== undefined) {
      if (!['producao', 'entrega', 'avisos', 'despacho'].includes(dto.escopo)) throw new BadRequestException('Escopo do KDS inválido.');
      if (dto.escopo !== atual.escopo) {
        set.escopo = dto.escopo;
        mudou.escopo = { de: atual.escopo, para: dto.escopo };
        // O despacho é a última etapa (Cozinha em estações, entrega 2): não manda o pedido para outro KDS.
        if (dto.escopo === 'despacho' && atual.proximoKdsId) {
          set.proximoKdsId = null;
          mudou.proximoKds = { de: await this.nomeDe(tenantId, atual.proximoKdsId), para: null };
        }
      }
    }
    if (atual.tipo === 'kds' && dto?.setorId !== undefined) {
      const setorId: string | null = dto.setorId || null;
      // O setor é conferido contra a empresa: o id não é aceito cru do pedido.
      const nomeSetor = await this.nomeDoSetor(tenantId, setorId);
      if (setorId && !nomeSetor) throw new BadRequestException('Setor não encontrado.');
      if (setorId !== (atual.setorId ?? null)) {
        set.setorId = setorId;
        mudou.setor = { de: await this.nomeDoSetor(tenantId, atual.setorId), para: nomeSetor };
      }
    }
    if (atual.tipo === 'salao' && dto?.pdvMainId !== undefined) {
      const pdvMainId: string | null = dto.pdvMainId || null;
      if (!pdvMainId) throw new BadRequestException('Escolha o PDV principal.');
      const [main] = await this.db
        .select({ id: equipamento.id, nome: equipamento.nome, unidadeId: equipamento.unidadeId })
        .from(equipamento)
        .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, pdvMainId), eq(equipamento.tipo, 'pdv'), eq(equipamento.ativo, true)));
      if (!main) throw new BadRequestException('PDV principal não encontrado.');
      if (main.unidadeId && atual.unidadeId && main.unidadeId !== atual.unidadeId)
        throw new BadRequestException('O PDV principal é de outra loja.');
      if (pdvMainId !== (atual.pdvMainId ?? null)) {
        set.pdvMainId = pdvMainId;
        mudou.pdvPrincipal = { de: await this.nomeDe(tenantId, atual.pdvMainId), para: main.nome };
      }
    }
    if (!Object.keys(set).length) return this.publico(atual);

    const [row] = await this.db
      .update(equipamento)
      .set(set)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)))
      .returning();
    await this.auditar(tenantId, ator, 'editou_equipamento', row, { nome: row.nome, tipo: row.tipo, mudou });
    return this.publico(row);
  }

  async revogar(tenantId: string, id: string, atorId: string | null, atorPerfil: string | null, via?: ViaDaAcao) {
    const [row] = await this.db
      .update(equipamento)
      // Também derruba o pareamento (mig 142): sem isso o PC revogado continuaria
      // se identificando com o segredo que já tem guardado.
      .set({ ativo: false, segredoHash: null, revogadoEm: new Date(), pareamentoCodigo: null })
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)))
      .returning();
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'modulos',
      acao: 'revogou_equipamento',
      entidadeTipo: 'equipamento',
      entidadeId: row.id,
      detalhe: { nome: row.nome, ...via?.detalhe },
      ...(via ? { atorTipo: via.atorTipo, origem: via.origem } : {}),
    });
    return this.publico(row);
  }

  /**
   * "Reativar" (ERR-236): desfaz uma revogação RECENTE. Em 14/10/2026 o dono revogou o servidor da loja
   * e o terminal em uso com um clique cada, e só voltaram por SQL. Vale até 30 dias depois da
   * revogação; auditado. A volta precisa passar pela regra que protege a revogação no servidor da
   * loja (ERR-235: só um pareamento posterior desfaz a revogação), então:
   *  • servidor da loja: volta na hora — a chave dele é a mesma. Recusa se a loja já tem outro
   *    servidor da loja dando sinal (ficariam dois). Ele não desce para a loja; a regra não se aplica.
   *  • PDV, salão e estação de impressão: o segredo foi apagado ao revogar → volta com um código novo
   *    (15 min) para o PC parear de novo; o código é o que deixa a volta passar no servidor da loja.
   *  • impressora, KDS e os demais: voltam com `pareado_em = agora` (a volta é uma decisão posterior à
   *    revogação). Com servidor da loja ativo, impressora, KDS e estação se reativam nele (F10).
   */
  async reativar(tenantId: string, id: string, atorId: string | null, atorPerfil: string | null, via?: ViaDaAcao) {
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id)));
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    if (row.ativo) throw new BadRequestException('Este equipamento já está em uso.');
    if (row.revogadoEm && Date.now() - new Date(row.revogadoEm).getTime() > DIAS_PARA_REATIVAR * 86400000)
      throw new BadRequestException(`Revogado há mais de ${DIAS_PARA_REATIVAR} dias: cadastre o equipamento de novo.`);
    if (['impressora', 'kds', 'estacao_impressao', 'tela_senhas'].includes(row.tipo)) await this.garantirConfigLocal(tenantId, row.tipo);
    if (row.tipo === 'servidor_local' && !row.integrador) {
      let outro: { nome: string } | undefined;
      try {
        const r: any = await this.db.execute(sql`
          select e.nome from equipamento e join edge_status s on s.equipamento_id = e.id
           where e.tenant_id = ${tenantId} and e.tipo = 'servidor_local' and e.ativo and e.integrador is null
             and e.id <> ${id}
             and (${row.unidadeId}::uuid is null or e.unidade_id is null or e.unidade_id = ${row.unidadeId}::uuid)
             and s.recebido_em >= now() - interval '10 minutes'
           limit 1`);
        outro = (r.rows ?? r)[0];
      } catch { /* sem edge_status: não há como saber de outro servidor vivo */ }
      if (outro) throw new ConflictException(`A loja já tem outro servidor da loja em uso ("${outro.nome}"). Reativar este deixaria dois.`);
    }

    const comCodigo = ['pdv', 'salao', 'estacao_impressao', 'tela_senhas'].includes(row.tipo);
    let codigo: string | null = null;
    if (comCodigo) {
      for (let i = 0; i < 5 && !codigo; i++) {
        const c = String(100000 + Math.floor(randomInt(900000)));
        const [existe] = await this.db.select({ id: equipamento.id }).from(equipamento).where(eq(equipamento.pareamentoCodigo, c));
        if (!existe) codigo = c;
      }
      if (!codigo) throw new BadRequestException('Não consegui gerar um código agora. Tente de novo.');
    }
    const expiraEm = codigo ? new Date(Date.now() + 15 * 60 * 1000) : null;
    const [volta] = await this.db
      .update(equipamento)
      .set({
        ativo: true,
        revogadoEm: null,
        ...(codigo ? { pareamentoCodigo: codigo, pareamentoExpiraEm: expiraEm } : row.tipo !== 'servidor_local' ? { pareadoEm: new Date() } : {}),
      })
      // Só o que continua revogado: dois cliques ao mesmo tempo reativam uma vez.
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.ativo, false)))
      .returning();
    if (!volta) throw new ConflictException('Este equipamento acabou de ser reativado. Atualize a tela.');
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'modulos',
      acao: 'reativou_equipamento',
      entidadeTipo: 'equipamento',
      entidadeId: volta.id,
      detalhe: { nome: volta.nome, tipo: volta.tipo, revogadoEm: row.revogadoEm ?? null, comCodigo, ...via?.detalhe },
      ...(via ? { atorTipo: via.atorTipo, origem: via.origem } : {}),
    });
    return { ...this.publico(volta), codigo, expiraEm };
  }

  /**
   * Servidor da loja SUBSTITUÍDO sai sozinho (decisão do dono, 25/09/2026): a loja troca de máquina,
   * ou reinstala com um `.exe` novo, e o `servidor_local` antigo ficava com o token ativo para sempre
   * (o piloto chegou a 6). Todo dia, revoga o que está há 10 dias sem sinal de vida E tem substituto
   * vivo na mesma loja (ou na rede) — nunca a credencial do GoGeM, nunca o único servidor de uma loja
   * parada. As regras estão em `revogarServidoresSubstituidos`.
   *
   * Onde roda (ERR-075): só na NUVEM — é lá que moram as credenciais `servidor_local` e o relatório
   * de status de cada servidor (`edge_status`); no servidor da loja o `servidor_local` nem existe.
   * Nunca lança: o job não pode derrubar nada.
   */
  @Cron('0 4 * * *') // 04:00 todos os dias
  async revogarServidoresSubstituidos(dias = DIAS_SEM_SINAL_PARA_REVOGAR, soEmpresas?: string[]) {
    if (ehServidorLocal()) return { revogados: 0 };
    let revogados: Awaited<ReturnType<typeof revogarServidoresSubstituidos>> = [];
    try {
      revogados = await revogarServidoresSubstituidos(this.db, dias, soEmpresas);
    } catch (e: any) {
      this.logger.error(`revogação de servidores substituídos não rodou: ${e?.message ?? e}`);
      return { revogados: 0 };
    }
    for (const r of revogados) {
      this.logger.warn(
        `servidor da loja "${r.nome}" (${r.id}, empresa ${r.tenant_id}) revogado: ${dias}+ dias sem sinal de vida, ` +
          `substituído por ${r.substituto}`,
      );
      await this.auditoria
        .registrar({
          tenantId: r.tenant_id,
          unidadeId: r.unidade_id,
          atorId: null,
          atorPerfil: 'servico',
          tipo: 'modulos',
          acao: 'revogou_equipamento',
          origem: 'automatico',
          entidadeTipo: 'equipamento',
          entidadeId: r.id,
          detalhe: {
            nome: r.nome,
            motivo: `servidor da loja substituído: ${dias} dias sem sinal de vida`,
            ultimoSinal: r.ultimo_sinal,
            substituto: r.substituto,
          },
        })
        .catch((e: any) => this.logger.warn(`auditoria da revogação de ${r.id} falhou: ${e?.message ?? e}`));
    }
    if (revogados.length) this.logger.log(`servidores substituídos revogados: ${revogados.length}`);
    return { revogados: revogados.length };
  }

  // Handshake do WebSocket: valida o token do device (só se ativo).
  async validarToken(token: string) {
    if (!token) return null;
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.token, token), eq(equipamento.ativo, true)));
    return row ?? null;
  }

  /**
   * O integrador se identificou (`X-Integrador`, GoGeM #137) chamando com o token DESTE
   * equipamento: ele é a credencial da integração (mig 290, ERR-108). O GoGeM aceita UM token por
   * empresa — o dele —, e é por esta marca que o aviso de cancelamento e o "Publicar no GoGeM"
   * escolhem o token, em vez de "um servidor_local qualquer" (5 de 6 davam 401).
   *
   * Só grava quando a marca muda, ou para renovar o "visto" de hora em hora: o GoGeM chama a cada
   * poucos minutos, e a decisão sai da linha que a autenticação já carregou. Servidor de LOJA (já
   * sincronizou) nunca vira credencial de integração pelo cabeçalho. Quem chama é o guard, na
   * nuvem: este método NUNCA lança — uma falha aqui não pode derrubar a chamada do GoGeM (V3).
   */
  async notarIntegrador(dev: any, cabecalho: unknown): Promise<void> {
    try {
      const integrador = String(cabecalho ?? '').trim().toLowerCase();
      if (!INTEGRADORES.has(integrador) || dev?.tipo !== 'servidor_local') return;
      if (dev.lastPushSeq != null || dev.lastPushTs != null) {
        const ultimo = this.recusaDeIntegradorLogada.get(dev.id) ?? 0;
        if (Date.now() - ultimo > INTEGRADOR_VISTO_MINUTOS * 60_000) {
          this.recusaDeIntegradorLogada.set(dev.id, Date.now());
          this.logger.warn(
            `X-Integrador: ${integrador} ignorado — o equipamento ${dev.id} (empresa ${dev.tenantId}) já ` +
              'sincronizou como servidor de loja; credencial de loja não vira credencial de integração.',
          );
        }
        return;
      }
      const vistoEm = dev.integradorVistoEm ? new Date(dev.integradorVistoEm).getTime() : 0;
      if (dev.integrador === integrador) {
        if (Date.now() - vistoEm < INTEGRADOR_VISTO_MINUTOS * 60_000) return;
        await this.db.execute(sql`update equipamento set integrador_visto_em = now() where id = ${dev.id}::uuid`);
        return;
      }
      // Marca. Com chamadas simultâneas, só a que de fato virou a marca audita e solta a fila.
      const r: any = await this.db.execute(sql`
        update equipamento set integrador = ${integrador}, integrador_visto_em = now()
         where id = ${dev.id}::uuid and integrador is distinct from ${integrador}
        returning id`);
      if (!(r.rows ?? r).length) return;
      const soltos = await soltarAvisosParados(this.db, dev.tenantId, integrador);
      this.logger.log(
        `equipamento ${dev.id} (empresa ${dev.tenantId}) marcado como credencial de ${integrador}` +
          (soltos ? ` — ${soltos} aviso(s) parado(s) de volta à fila` : ''),
      );
      await this.auditoria
        .registrar({
          tenantId: dev.tenantId,
          atorId: null,
          atorPerfil: 'servico',
          tipo: 'integracao',
          acao: 'marcou_credencial_integracao',
          entidadeTipo: 'equipamento',
          entidadeId: dev.id,
          detalhe: { integrador, nome: dev.nome, antes: dev.integrador ?? null, avisosSoltos: soltos },
        })
        .catch((e: any) => this.logger.warn(`auditoria da marca de ${integrador} falhou: ${e?.message ?? e}`));
    } catch (e: any) {
      this.logger.warn(`marca de integrador não gravada (equipamento ${dev?.id}): ${e?.message ?? e}`);
    }
  }

  async registrarPing(id: string) {
    await this.db
      .update(equipamento)
      .set({ ultimoPing: new Date() })
      .where(eq(equipamento.id, id));
  }

  // Pareamento de um terminal de PDV: valida o token (device tipo 'pdv', ativo, do
  // tenant) e devolve a identidade que o PC guarda localmente (id + nome + unidade).
  async parear(tenantId: string, token: string, ator?: AtorEquipamento) {
    const t = (token ?? '').trim();
    if (!t) throw new NotFoundException('Informe o token do terminal.');
    const [row] = await this.db
      .select()
      .from(equipamento)
      .where(
        and(
          eq(equipamento.token, t),
          eq(equipamento.tenantId, tenantId),
          // PDV de balcão OU ponto de salão (sub-PDV, mig 133).
          inArray(equipamento.tipo, ['pdv', 'salao']),
          eq(equipamento.ativo, true),
        ),
      );
    if (!row)
      throw new NotFoundException(
        'Terminal não encontrado ou inativo. Confira o token com o gestor.',
      );
    await this.registrarPing(row.id);
    await this.auditar(tenantId, ator, 'terminal_pareado', row, { nome: row.nome, tipo: row.tipo, por: 'token' });
    return { id: row.id, nome: row.nome, unidadeId: row.unidadeId, tipo: row.tipo, pdvMainId: row.pdvMainId ?? null };
  }

  // Resolve o terminal de PDV (ativo, do tenant) e devolve sua unidade — usado pelo
  // caixa/venda para amarrar a sessão ao terminal. null quando o id é inválido.
  async terminalUnidade(
    tenantId: string,
    terminalId?: string | null,
  ): Promise<string | null> {
    if (!terminalId) return null;
    const [row] = await this.db
      .select({ unidadeId: equipamento.unidadeId })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.id, terminalId),
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'pdv'),
          eq(equipamento.ativo, true),
        ),
      );
    return row?.unidadeId ?? null;
  }

  // REP-Software lógico: garante um equipamento padrão por (tenant, unidade)
  // para marcações web/gestor que não vêm de um terminal físico.
  async resolverPadrao(tenantId: string, unidadeId?: string) {
    const cond = and(
      eq(equipamento.tenantId, tenantId),
      eq(equipamento.tipo, 'terminal_ponto'),
      eq(equipamento.padrao, true),
      unidadeId
        ? eq(equipamento.unidadeId, unidadeId)
        : isNull(equipamento.unidadeId),
    );
    const [existe] = await this.db.select().from(equipamento).where(cond);
    if (existe) return existe;
    const [row] = await this.db
      .insert(equipamento)
      .values({
        tenantId,
        unidadeId: unidadeId ?? null,
        tipo: 'terminal_ponto',
        nome: 'REP-Software',
        token: this.novoToken(),
        padrao: true,
      })
      .returning();
    return row;
  }

  // KDS — impressão guiada por etapa (mig 129): liga/desliga, escolhe a etapa que
  // dispara e a impressora que recebe o ticket. Só vale para equipamento tipo 'kds'.
  async setImpressaoEtapa(
    tenantId: string,
    id: string,
    dto: { imprimeAoAvancar?: boolean; imprimeNoStatus?: string; impressoraDestinoId?: string | null },
    ator?: AtorEquipamento,
  ) {
    await this.garantirConfigLocal(tenantId);
    const status = ['recebido', 'preparo', 'pronto', 'entregue'].includes(dto?.imprimeNoStatus ?? '')
      ? (dto.imprimeNoStatus as string)
      : 'pronto';
    const [row] = await this.db
      .update(equipamento)
      .set({
        imprimeAoAvancar: !!dto?.imprimeAoAvancar,
        imprimeNoStatus: status,
        impressoraDestinoId: dto?.impressoraDestinoId || null,
      })
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.id, id),
          eq(equipamento.tipo, 'kds'),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('KDS não encontrado.');
    await this.auditar(tenantId, ator, 'alterou_impressao_por_etapa', row, {
      nome: row.nome,
      imprimeAoAvancar: row.imprimeAoAvancar,
      imprimeNoStatus: row.imprimeNoStatus,
      impressoraDestino: await this.nomeDe(tenantId, row.impressoraDestinoId),
    });
    return this.publico(row);
  }

  // Fase E — próximo KDS da cadeia: quando o cartão fica PRONTO, passa para ele (Cozinha em estações, entrega 2). null =
  // termina aqui. As mesmas regras da gaveta "Configurar este KDS" (`common/fluxo-kds`): KDS ligado da mesma loja, sem
  // círculo, e o despacho não manda para outro KDS. Antes só se recusava o "aponta para si mesmo".
  async setProximoKds(tenantId: string, id: string, proximoKdsId: string | null, ator?: AtorEquipamento) {
    await this.garantirConfigLocal(tenantId);
    if (proximoKdsId === id) throw new BadRequestException('Um KDS não pode apontar para si mesmo.');
    if (proximoKdsId) {
      const [kds] = await this.db
        .select({ id: equipamento.id, unidadeId: equipamento.unidadeId, escopo: equipamento.escopo })
        .from(equipamento)
        .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'kds')));
      if (!kds) throw new NotFoundException('KDS não encontrado.');
      if (kds.escopo === 'despacho') throw new BadRequestException('O KDS de despacho é a última etapa: ele não manda o pedido para outro KDS.');
      await conferirProximoKds(this.db, tenantId, { id: kds.id, unidadeId: kds.unidadeId ?? null }, proximoKdsId);
    }
    const [row] = await this.db
      .update(equipamento)
      .set({ proximoKdsId: proximoKdsId || null })
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'kds')))
      .returning();
    if (!row) throw new NotFoundException('KDS não encontrado.');
    await this.auditar(tenantId, ator, 'alterou_proximo_kds', row, {
      nome: row.nome,
      proximoKds: await this.nomeDe(tenantId, row.proximoKdsId),
    });
    return this.publico(row);
  }

  // Papel múltiplo da impressora (mig 167): só liga/desliga cupom/produção.
  async setPapeisImpressora(
    tenantId: string,
    id: string,
    dto: { fazCupom?: boolean; fazProducao?: boolean },
    ator?: AtorEquipamento,
  ) {
    await this.garantirConfigLocal(tenantId);
    const set: { fazCupom?: boolean; fazProducao?: boolean } = {};
    if (dto.fazCupom != null) set.fazCupom = !!dto.fazCupom;
    if (dto.fazProducao != null) set.fazProducao = !!dto.fazProducao;
    if (!Object.keys(set).length) throw new BadRequestException('Nada para alterar.');
    const [row] = await this.db
      .update(equipamento)
      .set(set)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.id, id),
          eq(equipamento.tipo, 'impressora'),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Impressora não encontrada.');
    await this.auditar(tenantId, ator, 'alterou_papeis_impressora', row, { nome: row.nome, ...set });
    return this.publico(row);
  }

  private publico(r: any) {
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId,
      tipo: r.tipo,
      nome: r.nome,
      mac: r.mac,
      escopo: r.escopo,
      papel: r.papel,
      fazCupom: !!r.fazCupom, // papel múltiplo (mig 167)
      fazProducao: !!r.fazProducao,
      fazEtiqueta: !!r.fazEtiqueta, // impressora de etiqueta de validade (mig 179)
      linguagemEtiqueta: r.linguagemEtiqueta ?? 'escpos', // escpos | zpl | epl (mig 180)
      conexao: r.conexao ?? 'rede',
      host: r.host,
      porta: r.porta,
      dispositivo: r.dispositivo ?? null,
      agenteMaquina: r.agenteMaquina ?? null, // máquina do agente dona da USB (mig 267)
      estacaoId: r.estacaoId ?? null, // estação de impressão que imprime esta impressora (mig 324)
      // Estação e tela de senhas: já trocaram o código pelo segredo? Separa "nunca pareou" de "pareou e está fora".
      ...(r.tipo === 'estacao_impressao' || r.tipo === 'tela_senhas' ? { pareado: !!r.segredoHash } : {}),
      // Tela de senhas (mig 337): o tamanho das letras desta TV, com o padrão no que falta.
      ...(r.tipo === 'tela_senhas' ? { telaTamanhos: tamanhosDaTela(r.telaTamanhos) } : {}),
      codepage: r.codepage ?? null, // acentos: cp860 | cp850 | null (mig 269)
      setorId: r.setorId,
      largura: r.largura,
      setoresAtendidos: r.setoresAtendidos ?? [],
      vias: r.vias,
      viasCliente: r.viasCliente ?? null, // vias por tipo (mig 168)
      viasProducao: r.viasProducao ?? null,
      formaProducao: r.formaProducao ?? 'itens', // 'itens' | 'completo' (mig 335)
      padrao: r.padrao,
      impressoraPadraoId: r.impressoraPadraoId ?? null,
      // KDS — impressão guiada por etapa (mig 129).
      imprimeAoAvancar: !!r.imprimeAoAvancar,
      imprimeNoStatus: r.imprimeNoStatus ?? 'pronto',
      impressoraDestinoId: r.impressoraDestinoId ?? null,
      proximoKdsId: r.proximoKdsId ?? null, // KDS — próximo na cadeia (mig 159)
      pdvMainId: r.pdvMainId ?? null, // sub-PDV salão (mig 133)
      // Credencial de integração (mig 290): a tela mostra "Integração GoGeM". O token dele não é
      // de servidor de loja — apagar o equipamento, ou usar o token numa instalação, para a integração.
      integrador: r.integrador ?? null,
      integradorVistoEm: r.integradorVistoEm ?? null,
      ativo: r.ativo,
      ultimoPing: r.ultimoPing,
      // Último uso real do terminal (cada pedido com a credencial do PC; mig 142). A lista não o
      // mostrava e o PDV em uso aparecia "nunca conectou" — ERR-236.
      ultimoUsoEm: r.ultimoUsoEm ?? null,
      revogadoEm: r.revogadoEm ?? null, // "Reativar" vale por 30 dias depois da revogação
      createdAt: r.createdAt,
    };
  }

  // ===== Impressoras (cadastro manual: direcionamento + vias) =====
  async listarImpressoras(tenantId: string) {
    const rows = await this.db
      .select()
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'impressora')))
      .orderBy(desc(equipamento.createdAt));
    return rows.map((r) => this.publico(r));
  }

  // Cria ou edita uma impressora. papel: 'cupom' (caixa) | 'producao' (cozinha).
  //
  // Na EDIÇÃO, campo AUSENTE mantém o que está gravado (V16). Duas telas editam a mesma impressora
  // com campos diferentes: "Equipamentos" (acentos, papel, setores atendidos, padrão, o que
  // imprime) e "Impressoras e cupons" (direcionamento, conexão, vias). Antes cada salvar regravava
  // TODOS os campos — o de uma tela zerava, com os valores padrão, o que a outra tinha configurado.
  async salvarImpressora(tenantId: string, dto: any, ator?: AtorEquipamento) {
    await this.garantirConfigLocal(tenantId);
    let atual: any = null;
    if (dto.id) {
      [atual] = await this.db
        .select()
        .from(equipamento)
        .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, dto.id), eq(equipamento.tipo, 'impressora')));
      if (!atual) throw new NotFoundException('Impressora não encontrada');
    }
    const veio = (k: string) => dto[k] !== undefined;
    /** O valor do pedido quando o campo veio; senão o gravado (edição) ou o padrão (cadastro). */
    const ou = <T>(k: string, doPedido: () => T, padrao: T): T => (veio(k) ? doPedido() : atual ? (atual[k] as T) : padrao);

    const conexao: 'local' | 'rede' = ou('conexao', () => (dto.conexao === 'local' ? 'local' : 'rede'), 'rede');
    const local = conexao === 'local';
    // Papel múltiplo (mig 167/179): usa os flags; se não vierem, deriva do papel legado; sem nenhum
    // dos dois, fica como está. 'etiqueta' (mig 179) é exclusivo — não faz cupom nem produção.
    const temPapel = veio('papel');
    const isEtiq = dto.fazEtiqueta != null ? !!dto.fazEtiqueta : temPapel ? dto.papel === 'etiqueta' : !!atual?.fazEtiqueta;
    const fazEtiqueta = isEtiq;
    const fazCupom = isEtiq
      ? false
      : dto.fazCupom != null
        ? !!dto.fazCupom
        : temPapel || !atual
          ? dto.papel !== 'producao'
          : !!atual.fazCupom;
    const fazProducao = isEtiq
      ? false
      : dto.fazProducao != null
        ? !!dto.fazProducao
        : temPapel || !atual
          ? dto.papel === 'producao'
          : !!atual.fazProducao;
    const vals = {
      nome: ou('nome', () => String(dto.nome ?? '').trim(), '') || atual?.nome || 'Impressora',
      // `papel` só por compat/exibição; o roteamento lê os flags faz*.
      papel: fazEtiqueta ? 'etiqueta' : fazProducao && !fazCupom ? 'producao' : 'cupom',
      fazCupom,
      fazProducao,
      fazEtiqueta,
      // Modelo/linguagem da etiquetadora (mig 180). Só relevante quando fazEtiqueta.
      linguagemEtiqueta: ou('linguagemEtiqueta', () => (['zpl', 'epl', 'escpos'].includes(dto.linguagemEtiqueta) ? dto.linguagemEtiqueta : 'escpos'), 'escpos'),
      // Acentos (mig 269): página de código da impressora; vazio = sem acento (seguro).
      codepage: ou<string | null>('codepage', () => (['cp860', 'cp850'].includes(dto.codepage) ? dto.codepage : null), null),
      setorId: ou<string | null>('setorId', () => dto.setorId || null, null),
      conexao,
      // Rede → host:porta; Local → nome da impressora no Windows (limpa o outro par).
      host: local ? null : ou<string | null>('host', () => dto.host?.trim() || null, null),
      porta: local ? null : ou<number | null>('porta', () => (dto.porta != null ? Number(dto.porta) || null : null), null),
      dispositivo: local ? ou<string | null>('dispositivo', () => dto.dispositivo?.trim() || null, null) : null,
      largura: ou('largura', () => (Number(dto.largura) === 58 ? 58 : 80), 80),
      setoresAtendidos: ou<string[]>('setoresAtendidos', () => (Array.isArray(dto.setoresAtendidos) ? dto.setoresAtendidos : []), []),
      padrao: ou('padrao', () => !!dto.padrao, false),
      vias: ou('vias', () => Math.max(1, Number(dto.vias) || 1), 1),
      // Vias por tipo (mig 168): null = herda `vias`. Só grava se veio número > 0.
      viasCliente: ou<number | null>('viasCliente', () => (dto.viasCliente != null && Number(dto.viasCliente) > 0 ? Number(dto.viasCliente) : null), null),
      viasProducao: ou<number | null>('viasProducao', () => (dto.viasProducao != null && Number(dto.viasProducao) > 0 ? Number(dto.viasProducao) : null), null),
      // Forma da via de produção (mig 335): 'itens' (só os desta impressora) ou 'completo' (o pedido inteiro, os desta em
      // destaque). Ausente mantém (V16); valor desconhecido é recusado — nunca vira o padrão em silêncio.
      formaProducao: ou<string>('formaProducao', () => formaDaVia(dto.formaProducao), 'itens'),
      ativo: ou('ativo', () => (dto.ativo != null ? !!dto.ativo : true), true),
      // "Ligada em" (mig 324): a estação de impressão que imprime esta impressora; null = o
      // servidor da loja. Ausente na edição mantém o gravado (V16).
      estacaoId: ou<string | null>('estacaoId', () => (dto.estacaoId ? String(dto.estacaoId) : null), null),
    };
    if (veio('estacaoId') && vals.estacaoId) {
      await this.conferirEstacao(tenantId, vals.estacaoId, dto.id ? atual?.unidadeId : dto.unidadeId ?? null);
    }
    if (dto.id) {
      const [row] = await this.db
        .update(equipamento)
        .set({
          ...vals,
          // Trocou o nome no Windows (ou virou rede) → a máquina aprendida não vale mais (mig 267).
          agenteMaquina: sql`case when ${equipamento.dispositivo} is distinct from ${vals.dispositivo}
                                  then null else ${equipamento.agenteMaquina} end`,
        })
        .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, dto.id), eq(equipamento.tipo, 'impressora')))
        .returning();
      if (!row) throw new NotFoundException('Impressora não encontrada');
      await this.auditar(tenantId, ator, 'editou_impressora', row, this.resumoImpressora(row));
      return this.publico(row);
    }
    const [row] = await this.db
      .insert(equipamento)
      .values({ tenantId, unidadeId: dto.unidadeId ?? null, tipo: 'impressora', token: this.novoToken(), escopo: 'producao', ...vals })
      .returning();
    await this.auditar(tenantId, ator, 'cadastrou_impressora', row, this.resumoImpressora(row));
    return this.publico(row);
  }

  // A estação escolhida em "Ligada em" tem de existir nesta empresa, estar ativa e ser da mesma
  // loja da impressora (ou de nenhuma): a impressão sairia num PC que a fila dessa loja não alcança.
  private async conferirEstacao(tenantId: string, estacaoId: string, unidadeDaImpressora: string | null) {
    if (!/^[0-9a-f-]{36}$/i.test(estacaoId)) throw new BadRequestException('Estação de impressão inválida.');
    const [est] = await this.db
      .select({ id: equipamento.id, unidadeId: equipamento.unidadeId, ativo: equipamento.ativo, revogadoEm: equipamento.revogadoEm })
      .from(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, estacaoId), eq(equipamento.tipo, 'estacao_impressao')));
    if (!est) throw new BadRequestException('Estação de impressão não encontrada.');
    if (!est.ativo || est.revogadoEm) throw new BadRequestException('Esta estação de impressão foi desativada ou revogada.');
    if (est.unidadeId && unidadeDaImpressora && est.unidadeId !== unidadeDaImpressora) {
      throw new BadRequestException('A estação de impressão é de outra loja.');
    }
  }

  /** O que a auditoria guarda de uma impressora: como ela ficou depois da mudança. */
  private resumoImpressora(r: any) {
    return {
      nome: r.nome,
      papel: r.papel,
      conexao: r.conexao ?? 'rede',
      destino: this.destinoImpressora(r),
      estacaoId: r.estacaoId ?? null,
      largura: r.largura,
      vias: r.vias,
      padrao: !!r.padrao,
      ativo: !!r.ativo,
      formaProducao: r.formaProducao ?? 'itens',
    };
  }

  async removerImpressora(tenantId: string, id: string, ator?: AtorEquipamento) {
    await this.garantirConfigLocal(tenantId);
    const [row] = await this.db
      .delete(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'impressora')))
      .returning();
    if (!row) throw new NotFoundException('Impressora não encontrada');
    await this.auditar(tenantId, ator, 'excluiu_impressora', row, this.resumoImpressora(row));
    return { ok: true };
  }
}

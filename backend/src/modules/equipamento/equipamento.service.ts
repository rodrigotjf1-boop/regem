import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomInt } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';
import { edgeAtivo } from '../../common/edge-ativo';
import { garantirImpressoraDaLoja } from '../../common/impressora-da-loja';
import { ForbiddenException } from '@nestjs/common';
import { soltarAvisosParados } from '../gogem/aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quem se identifica pelo `X-Integrador` hoje. Valor fora da lista é ignorado. */
const INTEGRADORES = new Set(['gogem']);
/** O "visto" do integrador é regravado no máximo de hora em hora — o GoGeM chama a cada poucos minutos. */
const INTEGRADOR_VISTO_MINUTOS = 60;

@Injectable()
export class EquipamentoService {
  private readonly logger = new Logger('Equipamento');
  /** Recusa de marca já logada (por equipamento): o GoGeM mal configurado não enche o log. */
  private readonly recusaDeIntegradorLogada = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // F10 — com edge ATIVO, o servidor local é a fonte da verdade da config de
  // impressão: a nuvem não sobrescreve (impressora/roteamento/KDS). Edite no edge.
  private async garantirConfigLocal(tenantId: string) {
    if (await edgeAtivo(this.db, tenantId)) {
      throw new ForbiddenException(
        'Configuração de impressão gerenciada pelo servidor local (edge) desta loja. Edite direto no servidor local.',
      );
    }
  }

  // Consulta simples p/ o front decidir se mostra a config em modo somente-leitura.
  edgeAtivo(tenantId: string) {
    return edgeAtivo(this.db, tenantId).then((ativo) => ({ ativo }));
  }

  private novoToken() {
    return randomBytes(24).toString('hex');
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
  async gerarCodigo(tenantId: string, id: string, atorId: string, atorPerfil: string) {
    const [alvo] = await this.db
      .select({ id: equipamento.id, nome: equipamento.nome })
      .from(equipamento)
      .where(and(eq(equipamento.id, id), eq(equipamento.tenantId, tenantId)));
    if (!alvo) throw new NotFoundException('Equipamento não encontrado.');

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
      detalhe: { nome: alvo.nome },
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

  async parearPorCodigo(codigo: string, fingerprint?: string) {
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
    await this.db
      .update(equipamento)
      .set({ ultimoUsoEm: new Date() })
      .where(eq(equipamento.id, row.id));
    return row;
  }


  // Cadastra um device. O token é exibido UMA vez (não volta em listagens).
  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateEquipamentoDto,
  ) {
    // F10 — impressora/KDS são config de impressão: com edge ativo, cria no edge.
    if (dto.tipo === 'impressora' || dto.tipo === 'kds') await this.garantirConfigLocal(tenantId);
    if (dto.tipo === 'pdv')
      await garantirImpressoraDaLoja(this.db, tenantId, dto.impressoraPadraoId ?? null, dto.unidadeId ?? null);
    const token = this.novoToken();
    const [row] = await this.db
      .insert(equipamento)
      .values({
        tenantId,
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
    return rows.map((r) => this.publico(r));
  }

  // Define/limpa a impressora de cupom amarrada a um terminal de PDV.
  async setImpressoraTerminal(
    tenantId: string,
    id: string,
    impressoraId: string | null,
  ) {
    const [term] = await this.db
      .select({ unidadeId: equipamento.unidadeId })
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
    return this.publico(row);
  }

  async revogar(tenantId: string, id: string, atorId: string, atorPerfil: string) {
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
      detalhe: { nome: row.nome },
    });
    return this.publico(row);
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
  async parear(tenantId: string, token: string) {
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
    return this.publico(row);
  }

  // Fase E — próximo KDS da cadeia (ao avançar o card migra para ele). null = fim.
  async setProximoKds(tenantId: string, id: string, proximoKdsId: string | null) {
    await this.garantirConfigLocal(tenantId);
    if (proximoKdsId === id) throw new BadRequestException('Um KDS não pode apontar para si mesmo.');
    const [row] = await this.db
      .update(equipamento)
      .set({ proximoKdsId: proximoKdsId || null })
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'kds')))
      .returning();
    if (!row) throw new NotFoundException('KDS não encontrado.');
    return this.publico(row);
  }

  // Papel múltiplo da impressora (mig 167): só liga/desliga cupom/produção.
  async setPapeisImpressora(
    tenantId: string,
    id: string,
    dto: { fazCupom?: boolean; fazProducao?: boolean },
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
      codepage: r.codepage ?? null, // acentos: cp860 | cp850 | null (mig 269)
      setorId: r.setorId,
      largura: r.largura,
      setoresAtendidos: r.setoresAtendidos ?? [],
      vias: r.vias,
      viasCliente: r.viasCliente ?? null, // vias por tipo (mig 168)
      viasProducao: r.viasProducao ?? null,
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
  async salvarImpressora(tenantId: string, dto: any) {
    await this.garantirConfigLocal(tenantId);
    const local = dto.conexao === 'local';
    // Papel múltiplo (mig 167/179): usa os flags; se não vierem, deriva do papel legado.
    // 'etiqueta' (mig 179) é exclusivo — a impressora de etiqueta não faz cupom/produção.
    const isEtiq = dto.fazEtiqueta != null ? !!dto.fazEtiqueta : dto.papel === 'etiqueta';
    const fazEtiqueta = isEtiq;
    const fazCupom = dto.fazCupom != null ? !!dto.fazCupom : !isEtiq && dto.papel !== 'producao';
    const fazProducao = dto.fazProducao != null ? !!dto.fazProducao : !isEtiq && dto.papel === 'producao';
    const vals = {
      nome: (dto.nome ?? '').trim() || 'Impressora',
      // `papel` só por compat/exibição; o roteamento lê os flags faz*.
      papel: fazEtiqueta ? 'etiqueta' : fazProducao && !fazCupom ? 'producao' : 'cupom',
      fazCupom,
      fazProducao,
      fazEtiqueta,
      // Modelo/linguagem da etiquetadora (mig 180). Só relevante quando fazEtiqueta.
      linguagemEtiqueta: ['zpl', 'epl', 'escpos'].includes(dto.linguagemEtiqueta)
        ? dto.linguagemEtiqueta
        : 'escpos',
      // Acentos (mig 269): página de código da impressora; vazio = sem acento (seguro).
      codepage: ['cp860', 'cp850'].includes(dto.codepage) ? dto.codepage : null,
      setorId: dto.setorId || null,
      conexao: local ? 'local' : 'rede',
      // Rede → host:porta; Local → nome da impressora no Windows (limpa o outro par).
      host: local ? null : dto.host?.trim() || null,
      porta: local ? null : dto.porta != null ? Number(dto.porta) || null : null,
      dispositivo: local ? dto.dispositivo?.trim() || null : null,
      largura: Number(dto.largura) === 58 ? 58 : 80,
      setoresAtendidos: Array.isArray(dto.setoresAtendidos) ? dto.setoresAtendidos : [],
      padrao: !!dto.padrao,
      vias: Math.max(1, Number(dto.vias) || 1),
      // Vias por tipo (mig 168): null = herda `vias`. Só grava se veio número > 0.
      viasCliente: dto.viasCliente != null && Number(dto.viasCliente) > 0 ? Number(dto.viasCliente) : null,
      viasProducao: dto.viasProducao != null && Number(dto.viasProducao) > 0 ? Number(dto.viasProducao) : null,
      ativo: dto.ativo != null ? !!dto.ativo : true,
    };
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
      return this.publico(row);
    }
    const [row] = await this.db
      .insert(equipamento)
      .values({ tenantId, unidadeId: dto.unidadeId ?? null, tipo: 'impressora', token: this.novoToken(), escopo: 'producao', ...vals })
      .returning();
    return this.publico(row);
  }

  async removerImpressora(tenantId: string, id: string) {
    await this.garantirConfigLocal(tenantId);
    const [row] = await this.db
      .delete(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'impressora')))
      .returning();
    if (!row) throw new NotFoundException('Impressora não encontrada');
    return { ok: true };
  }
}

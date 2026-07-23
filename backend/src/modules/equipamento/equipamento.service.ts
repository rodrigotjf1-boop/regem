import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class EquipamentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private novoToken() {
    return randomBytes(24).toString('hex');
  }

  // Cadastra um device. O token é exibido UMA vez (não volta em listagens).
  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateEquipamentoDto,
  ) {
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
        setorId: dto.setorId,
        // Impressora: conexão rede (IP:porta) ou local (USB/Windows por nome).
        conexao: dto.tipo === 'impressora' ? (dto.conexao === 'local' ? 'local' : 'rede') : undefined,
        host: dto.tipo === 'impressora' && dto.conexao === 'local' ? null : dto.host,
        porta: dto.tipo === 'impressora' && dto.conexao === 'local' ? null : dto.porta,
        dispositivo: dto.tipo === 'impressora' && dto.conexao === 'local' ? dto.dispositivo : undefined,
        largura: dto.tipo === 'impressora' ? dto.largura ?? 80 : undefined,
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
      .set({ ativo: false })
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
      conexao: r.conexao ?? 'rede',
      host: r.host,
      porta: r.porta,
      dispositivo: r.dispositivo ?? null,
      setorId: r.setorId,
      largura: r.largura,
      setoresAtendidos: r.setoresAtendidos ?? [],
      vias: r.vias,
      padrao: r.padrao,
      impressoraPadraoId: r.impressoraPadraoId ?? null,
      // KDS — impressão guiada por etapa (mig 129).
      imprimeAoAvancar: !!r.imprimeAoAvancar,
      imprimeNoStatus: r.imprimeNoStatus ?? 'pronto',
      impressoraDestinoId: r.impressoraDestinoId ?? null,
      pdvMainId: r.pdvMainId ?? null, // sub-PDV salão (mig 133)
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
    const local = dto.conexao === 'local';
    const vals = {
      nome: (dto.nome ?? '').trim() || 'Impressora',
      papel: dto.papel === 'producao' ? 'producao' : 'cupom',
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
      ativo: dto.ativo != null ? !!dto.ativo : true,
    };
    if (dto.id) {
      const [row] = await this.db
        .update(equipamento)
        .set(vals)
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
    const [row] = await this.db
      .delete(equipamento)
      .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.id, id), eq(equipamento.tipo, 'impressora')))
      .returning();
    if (!row) throw new NotFoundException('Impressora não encontrada');
    return { ok: true };
  }
}

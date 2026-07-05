import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  fiscalConfig,
  notaFiscal,
  comanda,
  comandaItem,
  produto,
  equipamento,
  impressaoJob,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gerarCNF, montarChave, montarQrCode } from './chave';
import { montarNfceXml, NfceItem } from './nfce-xml.builder';
import {
  FiscalTransmitter,
  SefazMockTransmitter,
  SefazDiretoTransmitter,
} from './transmitter';

/* eslint-disable @typescript-eslint/no-explicit-any */

// URL de consulta do QR (varia por UF/ambiente). Default SP — ajustar por UF ao
// plugar. tpAmb: 1 produção, 2 homologação.
function urlConsultaQr(uf: string, ambiente: string): string {
  const homolog =
    'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx';
  const prod =
    'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx';
  return ambiente === '1' ? prod : homolog;
}

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Seleciona o transmissor: com certificado configurado → SEFAZ direto (plug);
  // sem certificado → homologação simulada (pipeline testável).
  private transmitter(config: any): FiscalTransmitter {
    return config?.certRef
      ? new SefazDiretoTransmitter()
      : new SefazMockTransmitter();
  }

  // ===== Config fiscal por unidade =====
  async getConfig(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(fiscalConfig)
      .where(
        and(
          eq(fiscalConfig.tenantId, tenantId),
          unidadeId
            ? eq(fiscalConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    // Nunca devolve o CSC/token cru para o front (segredo).
    if (!row) return { ativo: false, ambiente: '2', regime: 'simples' };
    return { ...row, cscToken: row.cscToken ? '••••••' : null };
  }

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const [existente] = await this.db
      .select({ id: fiscalConfig.id })
      .from(fiscalConfig)
      .where(
        and(
          eq(fiscalConfig.tenantId, tenantId),
          unidadeId
            ? eq(fiscalConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : undefined,
      ambiente: dto.ambiente,
      regime: dto.regime,
      crt: dto.crt != null ? Number(dto.crt) : undefined,
      serie: dto.serie != null ? Number(dto.serie) : undefined,
      cnpj: dto.cnpj,
      razaoSocial: dto.razaoSocial,
      nomeFantasia: dto.nomeFantasia,
      ie: dto.ie,
      uf: dto.uf,
      codigoUf: dto.codigoUf != null ? Number(dto.codigoUf) : undefined,
      codigoMunicipio:
        dto.codigoMunicipio != null ? Number(dto.codigoMunicipio) : undefined,
      endereco: dto.endereco,
      cscId: dto.cscId,
      certRef: dto.certRef,
    };
    // CSC só sobrescreve se veio um valor real (não o mascarado).
    if (dto.cscToken && dto.cscToken !== '••••••') vals.cscToken = dto.cscToken;
    Object.keys(vals).forEach((k) => vals[k] === undefined && delete vals[k]);

    if (existente) {
      await this.db
        .update(fiscalConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(fiscalConfig.id, existente.id));
    } else {
      await this.db.insert(fiscalConfig).values({ tenantId, unidadeId, ...vals });
    }
    return this.getConfig(tenantId, unidadeId);
  }

  // Reserva atômica do próximo número da série (dois PDVs não duplicam).
  private async reservarNumero(
    tx: any,
    tenantId: string,
    unidadeId: string | null,
  ): Promise<{ numero: number; config: any }> {
    const cur: any = await tx.execute(sql`
      select * from fiscal_config
      where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
      for update
    `);
    const cfg = (cur.rows ?? cur)[0];
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (!cfg.ativo) throw new BadRequestException('Emissão fiscal desativada nesta unidade.');
    const numero = Number(cfg.proximo_numero);
    await tx.execute(sql`
      update fiscal_config set proximo_numero = ${numero + 1}, updated_at = now()
      where id = ${cfg.id}
    `);
    // normaliza camelCase p/ o builder
    return {
      numero,
      config: {
        ...cfg,
        codigoUf: cfg.codigo_uf,
        codigoMunicipio: cfg.codigo_municipio,
        razaoSocial: cfg.razao_social,
        nomeFantasia: cfg.nome_fantasia,
        cscId: cfg.csc_id,
        cscToken: cfg.csc_token,
        certRef: cfg.cert_ref,
      },
    };
  }

  // Emite a NFC-e de uma comanda fechada (idempotente por comanda).
  async emitir(tenantId: string, atorId: string | null, comandaId: string) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');

    const [ja] = await this.db
      .select()
      .from(notaFiscal)
      .where(
        and(
          eq(notaFiscal.comandaId, comandaId),
          inArray(notaFiscal.status, ['autorizada', 'contingencia']),
        ),
      );
    if (ja) return ja; // já emitida

    const itensDb = await this.db
      .select({
        codigo: produto.codigo,
        descricao: comandaItem.descricao,
        quantidade: comandaItem.quantidade,
        precoUnitario: comandaItem.precoUnitario,
        ncm: produto.ncm,
        cfop: produto.cfop,
        cest: produto.cest,
        origem: produto.origem,
        csosn: produto.csosn,
        cstIcms: produto.cstIcms,
        unidadeTrib: produto.unidadeTrib,
        aliqIcms: produto.aliqIcms,
        gtin: produto.gtin,
        cstPis: produto.cstPis,
        aliqPis: produto.aliqPis,
        cstCofins: produto.cstCofins,
        aliqCofins: produto.aliqCofins,
      })
      .from(comandaItem)
      .leftJoin(produto, eq(produto.id, comandaItem.produtoId))
      .where(eq(comandaItem.comandaId, comandaId));
    if (!itensDb.length) throw new BadRequestException('Comanda sem itens.');
    // NCM é obrigatório para emitir. Barra a emissão com mensagem clara.
    const semNcm = itensDb.filter((it) => !it.ncm).map((it) => it.descricao);
    if (semNcm.length)
      throw new BadRequestException(
        `Produto(s) sem NCM (obrigatório p/ NFC-e): ${semNcm.slice(0, 3).join(', ')}`,
      );

    const itens: NfceItem[] = itensDb.map((it, i) => ({
      codigo: it.codigo || String(i + 1),
      descricao: it.descricao,
      ncm: it.ncm ?? undefined,
      cfop: it.cfop ?? undefined,
      cest: it.cest ?? undefined,
      origem: it.origem ?? '0',
      csosn: it.csosn ?? '102',
      cstIcms: it.cstIcms ?? undefined,
      unidadeTrib: it.unidadeTrib ?? 'UN',
      quantidade: Number(it.quantidade),
      precoUnitario: Number(it.precoUnitario),
      aliqIcms: it.aliqIcms != null ? Number(it.aliqIcms) : undefined,
      gtin: it.gtin ?? undefined,
      cstPis: it.cstPis ?? undefined,
      aliqPis: it.aliqPis != null ? Number(it.aliqPis) : undefined,
      cstCofins: it.cstCofins ?? undefined,
      aliqCofins: it.aliqCofins != null ? Number(it.aliqCofins) : undefined,
    }));

    // Reserva número + monta chave/XML/QR dentro de uma transação.
    const preparado = await this.db.transaction(async (tx) => {
      const { numero, config } = await this.reservarNumero(tx, tenantId, c.unidadeId);
      const agora = new Date();
      const cNF = gerarCNF();
      const chave = montarChave({
        codigoUf: Number(config.codigoUf) || 35,
        ano2: String(agora.getFullYear()).slice(-2),
        mes2: String(agora.getMonth() + 1).padStart(2, '0'),
        cnpj: config.cnpj || '00000000000000',
        modelo: '65',
        serie: Number(config.serie) || 1,
        numero,
        tpEmis: 1,
        cNF,
      });
      const { qrCode } = montarQrCode({
        chave,
        tpAmb: config.ambiente || '2',
        cscId: config.cscId || '',
        cscToken: config.cscToken || '',
        urlConsulta: urlConsultaQr(config.uf || 'SP', config.ambiente || '2'),
      });
      const dhEmi = agora.toISOString().replace(/\.\d{3}Z$/, '-03:00');
      const xml = montarNfceXml({ config, numero, chave, cNF, dhEmi, itens, forma: c.forma, qrCode });
      const valorTotal = itens.reduce((s, it) => s + it.quantidade * it.precoUnitario, 0);

      const [nota] = await tx
        .insert(notaFiscal)
        .values({
          tenantId,
          unidadeId: c.unidadeId,
          comandaId,
          modelo: '65',
          serie: Number(config.serie) || 1,
          numero,
          chave,
          ambiente: config.ambiente || '2',
          status: 'pendente',
          qrcode: qrCode,
          xml,
          valorTotal: String(valorTotal.toFixed(2)),
          emitidaPorId: atorId,
        })
        .returning();
      return { nota, config, xml, chave };
    });

    // Transmite (fora da transação). Mock autoriza; direto exige certificado.
    let ret;
    try {
      ret = await this.transmitter(preparado.config).autorizar(
        preparado.xml,
        preparado.chave,
        preparado.config,
      );
    } catch (e: any) {
      await this.db
        .update(notaFiscal)
        .set({ status: 'rejeitada', motivo: e?.message?.slice(0, 400) ?? 'falha' })
        .where(eq(notaFiscal.id, preparado.nota.id));
      throw new BadRequestException(e?.message ?? 'Falha na transmissão fiscal.');
    }

    const status = ret.status === 'autorizada' ? 'autorizada' : ret.status;
    const [nota] = await this.db
      .update(notaFiscal)
      .set({
        status,
        protocolo: ret.protocolo,
        motivo: ret.motivo,
        xml: ret.xmlAutorizado ?? preparado.xml,
        emitidaEm: new Date(),
      })
      .where(eq(notaFiscal.id, preparado.nota.id))
      .returning();

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'emitiu_nfce',
      entidadeTipo: 'nota_fiscal',
      entidadeId: nota.id,
      detalhe: { chave: nota.chave, status: nota.status, numero: nota.numero },
    });

    if (nota.status === 'autorizada') {
      await this.imprimirDanfe(tenantId, nota, itens);
    }
    return nota;
  }

  // Emite só se o fiscal estiver ativo na unidade (chamado automaticamente pela
  // venda). Nunca derruba a venda: erros viram nota rejeitada + log.
  async emitirSeAtivo(tenantId: string, atorId: string | null, comandaId: string, unidadeId?: string | null) {
    const cfg = await this.configRaw(tenantId, unidadeId ?? null);
    if (!cfg?.ativo) return null;
    try {
      return await this.emitir(tenantId, atorId, comandaId);
    } catch {
      return null; // já registra nota 'rejeitada' internamente quando aplicável
    }
  }

  async cancelar(
    tenantId: string,
    atorId: string,
    notaId: string,
    justificativa: string,
  ) {
    if (!justificativa || justificativa.trim().length < 15)
      throw new BadRequestException('Justificativa deve ter ao menos 15 caracteres.');
    const [nota] = await this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, notaId), eq(notaFiscal.tenantId, tenantId)));
    if (!nota) throw new NotFoundException('Nota não encontrada');
    if (nota.status !== 'autorizada')
      throw new BadRequestException('Só cancela nota autorizada.');

    const config = await this.configRaw(tenantId, nota.unidadeId);
    const ret = await this.transmitter(config).cancelar(
      nota.chave!,
      nota.protocolo!,
      justificativa,
      config,
    );
    if (ret.status !== 'cancelada')
      throw new BadRequestException(ret.motivo || 'Cancelamento rejeitado.');

    const [row] = await this.db
      .update(notaFiscal)
      .set({
        status: 'cancelada',
        canceladaEm: new Date(),
        canceladaPorId: atorId,
        justificativaCancelamento: justificativa,
        motivo: ret.motivo,
      })
      .where(eq(notaFiscal.id, notaId))
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'cancelou_nfce',
      entidadeTipo: 'nota_fiscal',
      entidadeId: notaId,
      detalhe: { chave: nota.chave, justificativa },
    });
    return row;
  }

  private async configRaw(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(fiscalConfig)
      .where(
        and(
          eq(fiscalConfig.tenantId, tenantId),
          unidadeId
            ? eq(fiscalConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return row;
  }

  async listarNotas(tenantId: string, limite = 50) {
    return this.db
      .select({
        id: notaFiscal.id,
        numero: notaFiscal.numero,
        serie: notaFiscal.serie,
        chave: notaFiscal.chave,
        status: notaFiscal.status,
        ambiente: notaFiscal.ambiente,
        valorTotal: notaFiscal.valorTotal,
        motivo: notaFiscal.motivo,
        emitidaEm: notaFiscal.emitidaEm,
        comandaId: notaFiscal.comandaId,
      })
      .from(notaFiscal)
      .where(eq(notaFiscal.tenantId, tenantId))
      .orderBy(sql`created_at desc`)
      .limit(limite);
  }

  getNota(tenantId: string, id: string) {
    return this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, id), eq(notaFiscal.tenantId, tenantId)))
      .then((r) => r[0] ?? null);
  }

  // DANFE NFC-e (cupom) → impressoras de papel 'cupom'.
  private async imprimirDanfe(tenantId: string, nota: any, itens: NfceItem[]) {
    const printers = await this.db
      .select({ id: equipamento.id })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'impressora'),
          eq(equipamento.papel, 'cupom'),
          eq(equipamento.ativo, true),
        ),
      );
    if (!printers.length) return;
    const money = (n: number) =>
      Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const l: string[] = ['DANFE NFC-e', `Serie ${nota.serie} No ${nota.numero}`];
    if (nota.ambiente === '2') l.push('*** HOMOLOGACAO - SEM VALOR FISCAL ***');
    l.push('--------------------------------');
    for (const it of itens) {
      l.push(`${it.quantidade}x ${it.descricao}`);
      l.push(`   ${money(it.quantidade * it.precoUnitario)}`);
    }
    l.push('--------------------------------');
    l.push(`TOTAL: ${money(Number(nota.valorTotal))}`);
    l.push(`Chave: ${nota.chave}`);
    l.push(`Protocolo: ${nota.protocolo ?? '-'}`);
    l.push(`Consulte pela chave. QRCode:`);
    l.push(nota.qrcode ?? '');
    for (const p of printers) {
      await this.db.insert(impressaoJob).values({
        tenantId,
        unidadeId: nota.unidadeId,
        equipamentoId: p.id,
        pedidoId: null,
        via: 'fiscal',
        conteudo: l.join('\n'),
      });
    }
  }
}

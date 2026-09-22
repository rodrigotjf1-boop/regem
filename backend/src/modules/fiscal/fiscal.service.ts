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
import { edgeAtivo } from '../../common/edge-ativo';
import { enfileirarComandoEdge } from '../../common/edge-comando';
import { gerarCNF, montarChave, montarQrCode } from './chave';
import { montarNfceXml, NfceItem } from './nfce-xml.builder';
import { FiscalTransmitter, escolherTransmissor } from './transmitter';
import { camposFaltando, urlConsultaQr } from './emitente';
import { competenciaChave, dhEmiSefaz } from './fuso-fiscal';
import { idFiscalSerie } from '../../common/id-deterministico';
import { ehServidorLocal } from '../../common/modo';
import {
  credencialParaEmissao,
  obterCredencial,
  resumoPublico,
  salvarCertificado,
  salvarCsc,
} from './credencial';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Seleciona o transmissor. A regra (e o porquê) estão em `transmitter.ts`: sem
  // certificado, a emissão é RECUSADA — nunca "autorizada" por simulação.
  private transmitter(config: any): FiscalTransmitter {
    return escolherTransmissor(config);
  }

  // ONDE este processo roda — é o que define a série da nota. Único critério à prova de
  // partição: o servidor local e a nuvem nunca compartilham contador (docs/cupom-fiscal.md,
  // decisões D2/D3). Com um contador só, o link caído fazia os dois lados andarem a mesma
  // sequência às cegas e emitirem duas notas com o MESMO número.
  private origemEmissao(): 'loja' | 'nuvem' {
    return ehServidorLocal() ? 'loja' : 'nuvem';
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
    // O CSC e o certificado moram em `fiscal_credencial`, cifrados (mig 279). As colunas
    // antigas desta tabela nao sao mais usadas e nunca saem daqui.
    const { cscToken: _c, certRef: _r, ...publico } = row as any;
    return publico;
  }

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const [existente] = await this.db
      .select({ id: fiscalConfig.id, serie: fiscalConfig.serie, serieNuvem: fiscalConfig.serieNuvem })
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
      serieNuvem: dto.serieNuvem != null ? Number(dto.serieNuvem) : undefined,
      cnpj: dto.cnpj,
      razaoSocial: dto.razaoSocial,
      nomeFantasia: dto.nomeFantasia,
      ie: dto.ie,
      uf: dto.uf,
      codigoUf: dto.codigoUf != null ? Number(dto.codigoUf) : undefined,
      codigoMunicipio:
        dto.codigoMunicipio != null ? Number(dto.codigoMunicipio) : undefined,
      endereco: dto.endereco,
      municipio: dto.municipio,
      bairro: dto.bairro,
      numero: dto.numero,
      cep: dto.cep,
      // URL pública de consulta do QR da UF (não é segredo). Fica aqui até existir a
      // tabela por UF no código — ver docs/cupom-fiscal.md, pendência P12.
      urlQrcodeProd: dto.urlQrcodeProd,
      urlQrcodeHomolog: dto.urlQrcodeHomolog,
      complemento: dto.complemento,
      // CSC e certificado NAO entram mais por aqui: rotas proprias, que guardam cifrado
      // (PUT /fiscal/credencial/*). Aceitar aqui gravaria o segredo em texto puro numa tabela
      // que desce para todas as lojas.
    };
    // Duas origens na mesma série seria o contador compartilhado de novo, com outro nome.
    // Compara o valor EFETIVO (o que veio no corpo ou, se ausente, o que já está gravado):
    // mandar só um dos dois campos também pode colidir.
    const serieFinal = vals.serie ?? existente?.serie ?? 1;
    const serieNuvemFinal = vals.serieNuvem ?? existente?.serieNuvem ?? 2;
    if (serieFinal === serieNuvemFinal)
      throw new BadRequestException('A série da loja e a da nuvem têm de ser diferentes.');
    if ([serieFinal, serieNuvemFinal].some((s) => s < 1 || s > 999))
      throw new BadRequestException('Série fiscal: use de 1 a 999 (a série 0 é vedada).');
    // CSC só sobrescreve se veio um valor real (não o mascarado).
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

  // ===== Credenciais (certificado A1 e CSC) — sempre cifradas (mig 279) =====
  // As rotas que ESCREVEM são só-nuvem: a cópia-mestra mora lá, cifrada com a chave da nuvem;
  // o servidor local recebe a dele pelo canal autenticado do sync (etapa seguinte do P2).

  async getCredencial(tenantId: string, unidadeId: string | null) {
    return resumoPublico(await obterCredencial(this.db, tenantId, unidadeId));
  }

  async setCertificado(tenantId: string, atorId: string, unidadeId: string | null, dto: any) {
    const r = await salvarCertificado(this.db, tenantId, unidadeId, dto);
    // Auditoria com o que IDENTIFICA o certificado, nunca com o arquivo nem a senha.
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'cadastrou_certificado',
      entidadeTipo: 'fiscal_credencial',
      entidadeId: null,
      detalhe: { unidadeId, titular: r.titular, cnpj: r.cnpj, serial: r.serial, validoAte: r.validoAte },
    });
    return this.getCredencial(tenantId, unidadeId);
  }

  async setCsc(tenantId: string, atorId: string, unidadeId: string | null, dto: any) {
    const r = await salvarCsc(this.db, tenantId, unidadeId, dto);
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'cadastrou_csc',
      entidadeTipo: 'fiscal_credencial',
      entidadeId: null,
      // Só o ambiente e o ID (que vai impresso no QR). O CSC em si, nunca.
      detalhe: { unidadeId, ambiente: r.ambiente, cscId: r.id },
    });
    return this.getCredencial(tenantId, unidadeId);
  }

  // Reserva atômica do próximo número DA SÉRIE DESTA ORIGEM.
  //
  // Duas garantias:
  //  • a trava (`for update`) é no contador da própria origem — dois PDVs da mesma loja
  //    nunca tiram o mesmo número, e a nuvem não espera pela loja (nem o contrário);
  //  • o número nunca volta atrás: é `max(contador, maior número já emitido na série + 1)`.
  //    O contador sozinho não sobrevive a uma reinstalação ou a uma restauração, e repetir
  //    número significa repetir CHAVE DE ACESSO — rejeição por duplicidade e venda sem
  //    documento. O índice único `uq_nota_fiscal_numero` (mig 278) é a última trava.
  private async reservarNumero(
    tx: any,
    tenantId: string,
    unidadeId: string | null,
  ): Promise<{ numero: number; serie: number; config: any }> {
    const cur: any = await tx.execute(sql`
      select * from fiscal_config
      where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
    `);
    const cfg = (cur.rows ?? cur)[0];
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (!cfg.ativo) throw new BadRequestException('Emissão fiscal desativada nesta unidade.');

    const origem = this.origemEmissao();
    // A série 0 é reservada a "série única" no texto nacional e vedada em ES/AL.
    const serie = Number(origem === 'loja' ? cfg.serie : cfg.serie_nuvem) || (origem === 'loja' ? 1 : 2);
    if (serie < 1 || serie > 999)
      throw new BadRequestException(`Série fiscal inválida (${serie}): use de 1 a 999.`);

    // O id vem da chave de negócio: nuvem e loja materializam a MESMA linha.
    const id = idFiscalSerie(tenantId, unidadeId, origem);
    await tx.execute(sql`
      insert into fiscal_serie (id, tenant_id, unidade_id, origem, serie, proximo_numero)
      values (${id}, ${tenantId}, ${unidadeId ?? null}, ${origem}, ${serie}, 1)
      on conflict do nothing`);
    const r: any = await tx.execute(sql`select * from fiscal_serie where id = ${id} for update`);
    const linha = (r.rows ?? r)[0];
    if (!linha)
      throw new BadRequestException(
        `Série ${serie} já está em uso por outra origem nesta loja. Configure uma série própria para "${origem}".`,
      );

    const m: any = await tx.execute(sql`
      select coalesce(max(numero), 0) as maior from nota_fiscal
       where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
         and serie = ${serie}`);
    const maior = Number((m.rows ?? m)[0]?.maior ?? 0);
    // Série trocada na configuração: o contador da série anterior não vale para a nova.
    const base = Number(linha.serie) === serie ? Number(linha.proximo_numero) || 1 : 1;
    const numero = Math.max(base, maior + 1);
    await tx.execute(sql`
      update fiscal_serie set serie = ${serie}, proximo_numero = ${numero + 1}, updated_at = now()
      where id = ${id}`);

    // normaliza camelCase p/ o builder
    return {
      numero,
      serie,
      config: {
        ...cfg,
        codigoUf: cfg.codigo_uf,
        codigoMunicipio: cfg.codigo_municipio,
        razaoSocial: cfg.razao_social,
        nomeFantasia: cfg.nome_fantasia,
        cscId: cfg.csc_id,
        cscToken: cfg.csc_token,
        certRef: cfg.cert_ref,
        urlQrcodeProd: cfg.url_qrcode_prod,
        urlQrcodeHomolog: cfg.url_qrcode_homolog,
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

    // PRÉ-VOO ANTES DE RESERVAR O NÚMERO.
    // Número reservado é número gasto: se a emissão falhar depois disso, fica um BURACO na
    // sequência — e buraco não inutilizado até o 10º dia do mês seguinte é presumido pelo
    // Fisco como "documento emitido em contingência e não transmitido" (Ajuste SINIEF
    // 19/16, cl. 11ª, §5º). Então tudo que dá para conferir antes, confere-se antes.
    const cfgRaw = await this.configRaw(tenantId, c.unidadeId);
    if (!cfgRaw) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (!cfgRaw.ativo) throw new BadRequestException('Emissão fiscal desativada nesta unidade.');
    // CSC do AMBIENTE da config + se há certificado, vindos da credencial cifrada (mig 279).
    const credencial = await obterCredencial(this.db, tenantId, c.unidadeId ?? null);
    const cfgPre: any = {
      ...cfgRaw,
      ...credencialParaEmissao(credencial, String(cfgRaw.ambiente ?? '2')),
    };
    const faltandoPre = camposFaltando(cfgPre);
    if (faltandoPre.length)
      throw new BadRequestException(
        `Configuração fiscal incompleta — falta: ${faltandoPre.join(', ')}.`,
      );
    this.transmitter(cfgPre); // sem certificado/transmissão: recusa aqui, sem gastar número

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

    // Frete e desconto da NOTA. Ficam no pedido de canal (a comanda só guarda itens),
    // então busca pelo vínculo comanda → pedido_externo. Sem pedido (venda de balcão),
    // os dois são 0 e o XML sai como antes.
    const { frete, desconto } = await this.valoresFiscaisDoPedido(tenantId, comandaId);

    // Reserva número + monta chave/XML/QR dentro de uma transação.
    const preparado = await this.db.transaction(async (tx) => {
      const { numero, serie, config } = await this.reservarNumero(tx, tenantId, c.unidadeId);
      // A config lida sob trava vem da tabela; o CSC e o certificado vêm da credencial
      // (a coluna antiga `csc_token` foi esvaziada na mig 279 e não é mais lida).
      Object.assign(config, credencialParaEmissao(credencial, String(config.ambiente ?? '2')));

      // PRÉ-VOO: emitente incompleto não emite. Antes, cada campo que faltava tinha um
      // padrão (CNPJ zerado, logradouro "N/D", município de São Paulo) e a nota saía assim
      // mesmo, gravada como emitida. Documento fiscal não se completa por conta própria.
      const faltando = camposFaltando(config);
      if (faltando.length)
        throw new BadRequestException(
          `Configuração fiscal incompleta — falta: ${faltando.join(', ')}.`,
        );

      const agora = new Date();
      // Data-hora e competência no fuso da UF do emitente (ver fuso-fiscal.ts): o código
      // antigo declarava UTC como horário de Brasília e emitia 3 horas no futuro.
      const { ano2, mes2 } = competenciaChave(agora, config.uf);
      const dhEmi = dhEmiSefaz(agora, config.uf);
      const cNF = gerarCNF();
      const chave = montarChave({
        codigoUf: Number(config.codigoUf),
        ano2,
        mes2,
        cnpj: config.cnpj,
        modelo: '65',
        serie,
        numero,
        tpEmis: 1,
        cNF,
      });
      const { qrCode } = montarQrCode({
        chave,
        tpAmb: config.ambiente || '2',
        cscId: config.cscId,
        cscToken: config.cscToken,
        urlConsulta: urlConsultaQr(config)!,
      });
      const xml = montarNfceXml({
        config, serie, numero, chave, cNF, dhEmi, itens, forma: c.forma, qrCode, frete, desconto,
      });
      // O valor da nota é o vNF (produtos − desconto + frete), não a soma dos itens —
      // senão a listagem de notas diverge do que a SEFAZ autorizou.
      const vProd = itens.reduce((s, it) => s + it.quantidade * it.precoUnitario, 0);
      const valorTotal = vProd - Math.min(desconto, vProd) + frete;

      const [nota] = await tx
        .insert(notaFiscal)
        .values({
          tenantId,
          unidadeId: c.unidadeId,
          comandaId,
          modelo: '65',
          serie,
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
        // Marca a nota que NÃO passou pela SEFAZ. Sem isto, simulada e real ficam
        // indistinguíveis na listagem, no cupom e na auditoria.
        simulada: !!ret.simulado,
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
      await this.imprimirDanfe(tenantId, nota, itens, { frete, desconto });
    }
    return nota;
  }

  // Frete e desconto que a NOTA deve declarar, lidos do pedido de canal da comanda.
  //
  //  • frete    → taxa de entrega SÓ quando a loja é dona do valor. Com a logística do
  //               marketplace, a entrega é serviço DELE cobrado do cliente: não é
  //               operação da loja e não vai na nota dela.
  //  • desconto → só o bancado pela LOJA. O bancado pelo marketplace NÃO é desconto
  //               fiscal: a loja recebe o valor cheio no repasse, então a base é cheia.
  //               Desconto de FRETE também fica fora — a taxa já chega líquida dele
  //               (o 99food grava a taxa após a promoção), e abater de novo criaria
  //               uma nota com valor menor do que o cliente pagou.
  private async valoresFiscaisDoPedido(tenantId: string, comandaId: string) {
    const vazio = { frete: 0, desconto: 0 };
    try {
      const r: any = await this.db.execute(sql`
        select coalesce(case when taxa_entrega_dono = 'loja'
                             then taxa_entrega else 0 end, 0) as frete,
               case when descontos is null then coalesce(desconto_loja, 0)
                    else coalesce((select sum((d->>'valor')::numeric)
                                     -- array malformado não pode impedir a emissão
                                     from jsonb_array_elements(case when jsonb_typeof(descontos) = 'array'
                                                                    then descontos else '[]'::jsonb end) d
                                    where coalesce(d->>'quemBanca','indefinido') <> 'marketplace'
                                      and coalesce(d->>'alvo','') <> 'DELIVERY_FEE'), 0)
               end as desconto
          from pedido_externo
         where tenant_id = ${tenantId} and comanda_id = ${comandaId}
           and status not in ('cancelado')
         limit 1`);
      const row = (r.rows ?? r)[0];
      if (!row) return vazio;
      return {
        frete: Math.max(0, Number(row.frete) || 0),
        desconto: Math.max(0, Number(row.desconto) || 0),
      };
    } catch {
      // Base sem as colunas da mig 241 (edge ainda não atualizado): emite como antes,
      // sem frete nem desconto. Nunca deixar a nota parar de sair por causa disso.
      return vazio;
    }
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
    let ret;
    try {
      ret = await this.transmitter(config).cancelar(
        nota.chave!,
        nota.protocolo!,
        justificativa,
        config,
      );
    } catch (e: any) {
      // Sem transmissão real, o cancelamento não acontece — e a nota NÃO pode ser marcada
      // como cancelada no nosso banco, senão diverge do que a SEFAZ tem.
      throw new BadRequestException(e?.message ?? 'Falha ao cancelar na SEFAZ.');
    }
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
        simulada: notaFiscal.simulada, // a listagem precisa distinguir o que não é fiscal
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

  // DANFE NFC-e → UMA impressora: a que imprimiu o cupom desta venda; sem ela, uma impressora de
  // cupom da LOJA da nota (a marcada como padrão primeiro).
  // Antes: TODAS as impressoras com o `papel` antigo 'cupom' DA EMPRESA — numa rede com duas
  // lojas cada nota saía nas duas, e numa loja com dois caixas, nos dois. `faz_cupom` (mig 167)
  // é o campo que o cadastro mantém hoje.
  private async imprimirDanfe(
    tenantId: string,
    nota: any,
    itens: NfceItem[],
    extras?: { frete: number; desconto: number },
  ) {
    const money = (n: number) =>
      Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const l: string[] = ['DANFE NFC-e', `Serie ${nota.serie} No ${nota.numero}`];
    // A tarja olhava SÓ o ambiente. Nota simulada em ambiente de produção saía com cara de
    // cupom fiscal válido — é exatamente o caso que não pode existir.
    if (nota.ambiente === '2' || nota.simulada)
      l.push('*** SEM VALOR FISCAL ***');
    l.push('--------------------------------');
    for (const it of itens) {
      l.push(`${it.quantidade}x ${it.descricao}`);
      l.push(`   ${money(it.quantidade * it.precoUnitario)}`);
    }
    l.push('--------------------------------');
    // Desconto e entrega aparecem no cupom porque agora estão na nota — sem isso o
    // cliente vê um total que não bate com a soma dos itens impressos.
    if (extras?.desconto) l.push(`DESCONTO: -${money(extras.desconto)}`);
    if (extras?.frete) l.push(`ENTREGA: ${money(extras.frete)}`);
    l.push(`TOTAL: ${money(Number(nota.valorTotal))}`);
    l.push(`Chave: ${nota.chave}`);
    l.push(`Protocolo: ${nota.protocolo ?? '-'}`);
    l.push('Consulte pela chave ou pelo QR Code:');
    // O QR Code DESENHADO (o conversor transforma '@QR:' em QR). Antes saía o endereço como
    // texto — o cliente não tinha como escanear para consultar a nota.
    if (nota.qrcode) l.push(`@QR:${nota.qrcode}`);
    const conteudo = l.join('\n');

    // Loja com servidor local ATIVO: a impressora está na rede dela e a fila da nuvem não é lida
    // por ninguém ali. A DANFE vai por COMANDO para o servidor da loja (mig 269), que escolhe a
    // impressora local com a mesma regra abaixo. Antes a nota emitida na nuvem para essa loja
    // nunca saía no papel. No próprio servidor local `edgeAtivo` é sempre false.
    if (await edgeAtivo(this.db, tenantId, nota.unidadeId ?? null)) {
      await enfileirarComandoEdge(this.db, tenantId, 'imprimir_danfe', {
        unidadeId: nota.unidadeId ?? null,
        dados: { conteudo, comandaId: nota.comandaId ?? null },
        solicitadoPor: 'fiscal',
      }).catch(() => { /* a nota está emitida; a impressão é best-effort */ });
      return;
    }
    const r: any = await this.db.execute(sql`
      select coalesce(
        (select j.equipamento_id from impressao_job j
           join equipamento e on e.id = j.equipamento_id and e.ativo
          where j.tenant_id = ${tenantId} and j.comanda_id = ${nota.comandaId ?? null}
            and j.via = 'cliente'
          order by j.criado_em desc limit 1),
        (select e.id from equipamento e
          where e.tenant_id = ${tenantId} and e.tipo = 'impressora' and e.ativo and e.faz_cupom
            and (${nota.unidadeId ?? null}::uuid is null or e.unidade_id = ${nota.unidadeId ?? null}::uuid
                 or e.unidade_id is null)
          order by e.padrao desc, (e.unidade_id is null), e.created_at
          limit 1)
      ) as id`);
    const alvo = ((r.rows ?? r)[0]?.id as string | null) ?? null;
    if (!alvo) return;
    await this.db.insert(impressaoJob).values({
      tenantId,
      unidadeId: nota.unidadeId,
      equipamentoId: alvo,
      pedidoId: null,
      comandaId: nota.comandaId ?? null, // liga à venda (reimpressão / não duplicar)
      via: 'fiscal',
      conteudo,
    });
  }
}

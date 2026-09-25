import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
import { uuidDeChave } from '../../common/id-deterministico';
import { gerarCNF, montarChave, montarQrCode, montarQrCodeV3, montarQrCodeV3Offline } from './chave';
import {
  ContingenciaIndisponivel,
  EscopoContingencia,
  FalhaDaLoja,
  JUSTIFICATIVA_PADRAO,
  SilencioDoCiclo,
  autorizador,
  horasAteOPrazo,
  justificativaValida,
  motivoDaFalha,
  pontoDeEmissao,
  prazoVencido,
  silencioDaSefaz,
} from './contingencia';
import { montarNfceXml, NfceItem } from './nfce-xml.builder';
import { DanfeItem, montarDanfeTexto } from './danfe-texto';
import { MODOS_TAXA_SERVICO, TaxaServicoBloqueada, linhaTaxaServico } from './taxa-servico';
import { CadastroFiscalIncompativel } from './regras-uf';
import { problemasDoCertificado } from './certificado';
import {
  ErroNfceTotem,
  JUSTIFICATIVA_VENDA_DESFEITA,
  NfceDoTotem,
  NfceEmitidaTotem,
  PRAZO_AUTORIZACAO_TOTEM_MS,
  classificarFalhaNfce,
  nfceEmitidaParaTotem,
  nfceNaoEmitida,
} from './nfce-totem';
import { DOMParser } from '@xmldom/xmldom';
import {
  DecisaoFiscal,
  EmissaoBloqueada,
  PedidoFiscal,
  decidirEmissao,
  documentoUtilizavel,
  pedidoFiscalDeJson,
  valoresFiscaisDoPedido,
} from './destinatario';
import { FiscalTransmitter, escolherTransmissor } from './transmitter';
import { camposFaltando, urlConsultaChave, urlConsultaQr } from './emitente';
import { competenciaChave, dhEmiSefaz } from './fuso-fiscal';
import { idFiscalSerie } from '../../common/id-deterministico';
import { ehServidorLocal } from '../../common/modo';
import {
  credencialParaEmissao,
  obterCredencial,
  resumoPublico,
  salvarCertificado,
  salvarCsc,
  testarAssinatura,
  certificadoParaAssinar,
} from './credencial';
import { consultarStatusServico } from './sefaz/status-servico';
import { SefazInalcancavel, SefazRecusouChamada } from './sefaz/soap';
import { UfSemAutorizador, qrVersaoNfce } from './sefaz/webservices';
import { assinarNfe } from './assinatura';
import { responsavelTecnico } from './responsavel-tecnico';
import { SituacaoNaSefaz, consultarSituacaoNfce } from './sefaz/consulta-protocolo';
import { inutilizarNfce, montarInutNFe } from './sefaz/inutilizacao';
import {
  PRAZO_CANCELAMENTO_MINUTOS,
  PRAZO_CANC_SUBST_HORAS,
  TP_EVENTO_CANCELAMENTO,
  TP_EVENTO_CANC_SUBST,
  enviarEvento,
  enviarEventoCancSubst,
  montarEventoCancSubst,
  montarEventoCancelamento,
} from './sefaz/evento-cancelamento';
import { fiscalEvento } from '../../db/schema';
import { assinarInutNFe, assinarEvento } from './assinatura';
import { fiscalInutilizacao } from '../../db/schema';
import { hojeISO } from '../../common/data';
import { montarNfeProc } from './sefaz/autorizacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Pendura na falha o RESUMO da nota que ela deixou (status, cStat, número) — é o que diz se a
 * SEFAZ rejeitou, denegou ou calou. Só o resumo: o XML leva o CPF do cliente, e o filtro global
 * loga os 5xx. Não enumerável, para não parar em nenhuma serialização por acidente.
 */
function comNota(falha: Error, nota: any): Error {
  if (nota && !(falha as any).nota)
    Object.defineProperty(falha, 'nota', {
      value: {
        id: nota.id, status: nota.status, cstat: nota.cstat ?? null, numero: nota.numero, serie: nota.serie,
      },
      enumerable: false,
    });
  return falha;
}

/** Texto de um elemento (por nome local) dentro de `no` — para ler a nota gravada. */
function textoXml(no: any, nome: string): string | null {
  const achados = no?.getElementsByTagNameNS?.('*', nome);
  return achados && achados.length ? String(achados[0].textContent ?? '').trim() : null;
}

/** O que a transmissão das notas de UMA loja precisa — montado uma vez por ciclo da contingência. */
interface PreparoDaTransmissao {
  config: any;
  transmissor: FiscalTransmitter;
}

@Injectable()
export class FiscalService {
  private readonly log = new Logger(FiscalService.name);

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
    // O que fazer no pedido não presencial SEM o documento do cliente. Valor fora da lista
    // não pode virar "presencial" em silêncio: a loja pensaria ter desligado a emissão.
    if (dto.deliverySemCpf != null && !['presencial', 'nao_emitir'].includes(String(dto.deliverySemCpf)))
      throw new BadRequestException('Opção inválida para pedido sem CPF (use "presencial" ou "nao_emitir").');

    // Taxa de serviço: um dos três modos, ou vazio para "ainda não escolhido". Valor fora da
    // lista não vira escolha nenhuma em silêncio (V15/V16).
    if (dto.taxaServicoNfce != null && dto.taxaServicoNfce !== '' && !MODOS_TAXA_SERVICO.includes(dto.taxaServicoNfce))
      throw new BadRequestException(`Modo de taxa de serviço inválido (use ${MODOS_TAXA_SERVICO.join(', ')}).`);

    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : undefined,
      taxaServicoNfce: dto.taxaServicoNfce === '' ? null : dto.taxaServicoNfce != null ? String(dto.taxaServicoNfce) : undefined,
      // Piso de identificação do consumidor. Vazio volta ao padrão da UF — a regra nacional é
      // "R$ 10.000,00 ou outro valor definido pela UF", então isto nunca é literal no código.
      limiteIdentificacao:
        dto.limiteIdentificacao === null || dto.limiteIdentificacao === ''
          ? null
          : dto.limiteIdentificacao != null
            ? String(Number(dto.limiteIdentificacao))
            : undefined,
      deliverySemCpf: dto.deliverySemCpf != null ? String(dto.deliverySemCpf) : undefined,
      contingenciaViaEstabelecimento:
        dto.contingenciaViaEstabelecimento != null ? !!dto.contingenciaViaEstabelecimento : undefined,
      // Informação ao Fisco (FECP no RJ). Vazio = apagar; ausente = manter (V16).
      infoFisco: dto.infoFisco === '' ? null : dto.infoFisco != null ? String(dto.infoFisco).slice(0, 2000) : undefined,
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
      urlChaveProd: dto.urlChaveProd,
      urlChaveHomolog: dto.urlChaveHomolog,
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

  // Assina uma NFC-e de exemplo com o certificado GUARDADO e confere — sem SEFAZ, sem gravar.
  testarCertificado(tenantId: string, unidadeId: string | null) {
    return testarAssinatura(this.db, tenantId, unidadeId);
  }

  // "A SEFAZ está no ar e me aceita?" — consulta de STATUS com o certificado guardado.
  // Não emite, não gasta número, não grava nada. Prova o caminho inteiro até a autorização:
  // endereço da UF, certificado no TLS, verificação do servidor pela raiz ICP-Brasil, SOAP.
  async statusSefaz(tenantId: string, unidadeId: string | null) {
    try {
      return await this.statusSefazBruto(tenantId, unidadeId);
    } catch (e: any) {
      // Cada causa com o código certo: a tela e o log precisam distinguir.
      if (e instanceof UfSemAutorizador) throw new BadRequestException(e.message);
      if (e instanceof SefazInalcancavel) throw new ServiceUnavailableException(e.message);
      if (e instanceof SefazRecusouChamada) throw new BadGatewayException(e.message);
      throw e;
    }
  }

  /** A consulta de status com o erro da SEFAZ como veio: a fila da contingência precisa saber se foi SILÊNCIO. */
  private async statusSefazBruto(tenantId: string, unidadeId: string | null, cfgPronta?: any) {
    const cfg: any = cfgPronta ?? (await this.configRaw(tenantId, unidadeId));
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (!cfg.uf || !cfg.codigoUf)
      throw new BadRequestException('Informe a UF e o código IBGE da UF na configuração fiscal.');
    const cert = certificadoParaAssinar(await obterCredencial(this.db, tenantId, unidadeId));
    return consultarStatusServico({
      uf: cfg.uf, codigoUf: cfg.codigoUf, ambiente: String(cfg.ambiente ?? '2'), cert,
    });
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
    exigirAtivo = true, // a nota de TESTE de homologação não depende da emissão automática
  ): Promise<{ numero: number; serie: number; config: any }> {
    // Da loja, ou a da empresa (mesma regra do configRaw — V4).
    const cur: any = await tx.execute(sql`
      select * from fiscal_config
      where tenant_id = ${tenantId}
        and (unidade_id is not distinct from ${unidadeId ?? null} or unidade_id is null)
      order by (unidade_id is null) limit 1
    `);
    const cfg = (cur.rows ?? cur)[0];
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (exigirAtivo && !cfg.ativo)
      throw new BadRequestException('Emissão fiscal desativada nesta unidade.');

    const origem = this.origemEmissao();
    // A série 0 é reservada a "série única" no texto nacional e vedada em ES/AL.
    const serie = Number(origem === 'loja' ? cfg.serie : cfg.serie_nuvem) || (origem === 'loja' ? 1 : 2);
    if (serie < 1 || serie > 999)
      throw new BadRequestException(`Série fiscal inválida (${serie}): use de 1 a 999.`);

    // Série usada em HOMOLOGAÇÃO não vai para PRODUÇÃO. O contador é por série, não por
    // ambiente: a produção começaria no número seguinte ao último teste, e os números dos
    // testes seriam, para o Fisco, um buraco na sequência de produção (que a lei manda
    // inutilizar). Série nova em produção começa do 1, limpa.
    if (String(cfg.ambiente) === '1') {
      const h: any = await tx.execute(sql`
        select 1 from nota_fiscal
         where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
           and serie = ${serie} and ambiente = '2' limit 1`);
      if ((h.rows ?? h).length)
        throw new BadRequestException(
          `A série ${serie} foi usada em homologação — em produção use outra série (ex.: ${serie + 1}).`,
        );
    }

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
        urlChaveProd: cfg.url_chave_prod,
        urlChaveHomolog: cfg.url_chave_homolog,
        infoFisco: cfg.info_fisco,
      },
    };
  }

  // Emite a NFC-e de uma comanda fechada (idempotente por comanda).
  //
  // `opts.imprimirNaLoja = false` (K6): quem chamou vai imprimir o DANFE por conta própria —
  // hoje o TOTEM, que tem impressora térmica ao lado e entrega o cupom na mão do cliente sem
  // ele passar pelo balcão. Sem esta chave o mesmo documento sairia duas vezes: uma no totem e
  // outra na impressora do caixa. O texto do DANFE volta em `danfeTexto` para quem imprimir.
  //
  // As outras três opções são do caminho do TOTEM (`emitirParaTotem`), que tem o cliente
  // esperando na frente e precisa de uma resposta em segundos — os demais caminhos não as usam:
  //  • `prazoAutorizacaoMs`: prazo TOTAL da autorização; estourou, é silêncio → contingência;
  //  • `pendenteViraContingencia`: nota anterior desta venda sem resposta não é consultada (a
  //    consulta pode levar os mesmos 30 s): vai direto para a contingência, com número NOVO;
  //  • `respostaIncertaEhSilencio`: HTTP 5xx sem SOAP Fault não prova que a SEFAZ não processou
  //    a nota — no totem, dizer "não emitida" sem certeza desfaria uma venda que pode ter nota.
  async emitir(
    tenantId: string,
    atorId: string | null,
    comandaId: string,
    opts: {
      imprimirNaLoja?: boolean;
      prazoAutorizacaoMs?: number;
      pendenteViraContingencia?: boolean;
      respostaIncertaEhSilencio?: boolean;
    } = {},
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');

    // Com mais de uma nota na venda (a pendente e a de contingência que a substituiu), vale a
    // que tem documento: a pendente só é olhada quando não há outra.
    const [ja] = await this.db
      .select()
      .from(notaFiscal)
      .where(
        and(
          eq(notaFiscal.comandaId, comandaId),
          inArray(notaFiscal.status, ['autorizada', 'contingencia', 'pendente']),
        ),
      )
      .orderBy(sql`(status = 'pendente')`, sql`created_at desc`)
      .limit(1);
    let pendenteSemResposta: any = null;
    if (ja?.status === 'pendente' && opts.pendenteViraContingencia) {
      pendenteSemResposta = ja;
    } else if (ja?.status === 'pendente') {
      // Situação DESCONHECIDA: a nota foi enviada e a SEFAZ não confirmou (caiu a conexão,
      // estourou o tempo). Emitir de novo às cegas geraria DUAS notas para a mesma venda — se
      // a primeira tiver sido autorizada. Então PERGUNTA-SE à SEFAZ o que aconteceu, que é a
      // única resposta possível; só depois se decide.
      const r = await this.resolverNaSefaz(ja, atorId).catch((e) => ({ erro: e as Error }) as any);
      if (r?.erro)
        throw new BadRequestException(
          `A NFC-e nº ${ja.numero} desta venda foi enviada e a SEFAZ não confirmou o resultado, ` +
            `e a consulta falhou: ${r.erro.message}. Tente de novo em instantes.`,
        );
      if (r.status === 'autorizada' || r.status === 'cancelada' || r.status === 'denegada') {
        const [atual] = await this.db.select().from(notaFiscal).where(eq(notaFiscal.id, ja.id));
        if (r.status === 'autorizada') return atual; // já tinha documento: nada a emitir
        throw new BadRequestException(
          `A NFC-e nº ${ja.numero} desta venda está ${r.status} na SEFAZ (${r.motivo}).`,
        );
      }
      if (r.status === 'pendente')
        throw new BadRequestException(
          `A NFC-e nº ${ja.numero} desta venda continua sem resposta conclusiva da SEFAZ ` +
            `(${r.motivo}). Consulte de novo em alguns minutos antes de emitir outra.`,
        );
      // r.status === 'rejeitada' (217 — a SEFAZ nunca a registrou): segue e emite de novo.
    } else if (ja) return ja; // já emitida

    const itens = await this.itensFiscaisDaComanda(tenantId, c);

    // Frete, desconto e DESTINATÁRIO da nota. Ficam no pedido de canal (a comanda só guarda
    // itens), então busca pelo vínculo comanda → pedido_externo. Sem pedido (venda de balcão),
    // a nota sai presencial — mas o CPF da comanda, se o cliente pediu no caixa, vai junto.
    const { taxaEntrega, desconto, pedido } = await this.dadosFiscaisDoPedido(tenantId, comandaId);
    if (pedido && !pedido.documentoCliente) pedido.documentoCliente = c.cpf ?? null;

    // O DANFE sai por UM caminho só, qualquer que seja o jeito como a nota nasceu (autorizada
    // ou em contingência): o texto vai SEMPRE junto da nota — é o que o totem imprime —, e a
    // impressora da loja só entra quando ninguém mais se ofereceu para imprimir. Antes os dois
    // caminhos de contingência chamavam a impressão direto: no totem, o cliente ficava sem o
    // cupom e a nota saía no balcão.
    const entregarDanfe = async (nota: any, uf: string | null | undefined, consumidor: string | null) => {
      const extras = { frete: taxaEntrega, desconto, consumidor, uf: uf ?? null };
      nota.danfeTexto = montarDanfeTexto(nota, itens, extras);
      if (opts.imprimirNaLoja !== false) await this.imprimirDanfe(tenantId, nota, itens, extras);
    };

    const base = {
      tenantId, atorId, unidadeId: c.unidadeId ?? null, comandaId, itens, forma: c.forma,
      taxaEntrega, desconto, exigirAtivo: true,
      pedido: pedido ?? (c.cpf ? { tipo: 'balcao', documentoCliente: c.cpf, clienteNome: c.cliente } : null),
      prazoAutorizacaoMs: opts.prazoAutorizacaoMs,
      respostaIncertaEhSilencio: opts.respostaIncertaEhSilencio,
    };

    // JÁ EM CONTINGÊNCIA: não se tenta a SEFAZ. Era justamente a espera por ela que travava o
    // caixa — repetir a tentativa a cada venda devolveria o problema que a contingência resolve.
    const modo = await this.modoContingencia(tenantId, c.unidadeId ?? null);
    if (modo) {
      const rc = await this.emitirNucleo({ ...base, contingencia: modo });
      await entregarDanfe(rc.nota, rc.uf, rc.decisao?.dest?.documento ?? null);
      return rc.nota;
    }

    // A nota anterior desta venda ficou sem resposta e quem chamou não pode esperar a consulta
    // (o totem): para a venda, é o mesmo SILÊNCIO de uma SEFAZ que calou agora.
    const r: { nota: any; falha: Error | null; decisao?: DecisaoFiscal; uf?: string | null } =
      pendenteSemResposta
        ? {
            nota: pendenteSemResposta,
            falha: new ServiceUnavailableException(
              `A NFC-e nº ${pendenteSemResposta.numero} desta venda foi enviada e a SEFAZ não confirmou o resultado.`,
            ),
          }
        : await this.emitirNucleo(base);

    // SILÊNCIO da SEFAZ (nota `pendente`): não se sabe o que aconteceu com ela, e reaproveitar
    // o número dela em contingência é VEDADO (Ajuste 19/16, cl. 11ª, §2º, I). Então a venda sai
    // numa nota NOVA, em contingência, e a pendente segue o seu caminho: o job consulta e, se
    // não constar, ela é inutilizada; se constar autorizada, vira cancelamento por substituição.
    if (silencioDaSefaz(r.nota.status)) {
      const estado = await this.entrarEmContingencia(
        tenantId, c.unidadeId ?? null, r.nota.motivo ?? 'Sem resposta da SEFAZ', atorId,
      ).catch((e) => { this.log.error(`não foi possível entrar em contingência: ${e?.message ?? e}`); return null; });
      if (estado?.ativa && estado.dh_cont) {
        try {
          const rc = await this.emitirNucleo({
            ...base,
            contingencia: { dhCont: new Date(estado.dh_cont), xJust: justificativaValida(estado.justificativa) },
          });
          await entregarDanfe(rc.nota, rc.uf, rc.decisao?.dest?.documento ?? null);
          return rc.nota;
        } catch (e: any) {
          // Contingência indisponível (sem certificado, UF em QR v2): não se inventa saída —
          // o erro ORIGINAL é o que o caixa precisa ver, com este anexado.
          this.log.error(`contingência indisponível: ${e?.message ?? e}`);
        }
      }
    }

    // Na venda, o que não autorizou é ERRO para quem chamou (a tela do delivery mostra; a venda
    // automática registra). A nota fica gravada com o motivo, do mesmo jeito — e vai pendurada
    // no erro, para quem precisa dizer COMO falhou (o totem: rejeitada, denegada, sem resposta).
    if (r.falha) throw comNota(r.falha, r.nota);
    if (r.nota.status === 'autorizada') {
      // No cupom impresso a taxa é a taxa — o caminho fiscal dela (frete ou despesa acessória)
      // é assunto do XML, não do cliente que está com o papel na mão.
      await entregarDanfe(r.nota, r.uf, r.decisao?.dest?.documento ?? null);
    }
    return r.nota;
  }

  /**
   * Os itens da NFC-e de uma comanda: os da venda (com o cadastro fiscal do produto) e a linha
   * da taxa de serviço, quando a loja escolheu que ela vai na nota. UM lugar só — a emissão e o
   * DANFE remontado para a repetição do totem usam exatamente os mesmos, senão o papel da
   * segunda vez sairia diferente do da primeira.
   */
  private async itensFiscaisDaComanda(tenantId: string, c: any): Promise<NfceItem[]> {
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
      .where(eq(comandaItem.comandaId, c.id));
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

    // TAXA DE SERVIÇO (garçom). A comanda cobra `subtotal × (1 + %)`; se a loja escolheu que
    // ela vai na nota, entra como LINHA própria com exatamente o que foi cobrado a mais — senão
    // o total da nota não bate com o pagamento. Sem escolha feita, a nota é recusada: se ela
    // vai tributada ou não é decisão do contador, não nossa (ver `taxa-servico.ts`).
    const pctServico = Number(c.taxaServicoPct) || 0;
    if (pctServico > 0) {
      const cfgTaxa: any = await this.configRaw(tenantId, c.unidadeId ?? null);
      try {
        const linha = linhaTaxaServico({
          pct: pctServico,
          itens,
          modo: cfgTaxa?.taxaServicoNfce,
          crt: cfgTaxa?.crt,
          uf: cfgTaxa?.uf,
        });
        if (linha) itens.push(linha);
      } catch (e) {
        if (e instanceof TaxaServicoBloqueada) throw new BadRequestException(e.message);
        throw e;
      }
    }
    return itens;
  }

  /**
   * NFC-e de TESTE, só em HOMOLOGAÇÃO: um item de R$ 1,00, sem comanda, sem impressão. Serve para
   * a primeira conversa de verdade com a SEFAZ sem inventar venda. Devolve o resultado inteiro
   * (autorizada, rejeitada com o motivo, ou sem resposta) — em vez de lançar —, porque o objetivo
   * é justamente ler o que a SEFAZ respondeu.
   */
  async emitirTesteHomologacao(tenantId: string, atorId: string | null, unidadeIdPedida: string | null) {
    const unidadeId = await this.resolverUnidadeEmissao(tenantId, unidadeIdPedida);
    const cfg: any = await this.configRaw(tenantId, unidadeId);
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (String(cfg.ambiente) !== '2')
      throw new BadRequestException(
        'A nota de teste só existe em HOMOLOGAÇÃO. Mude o ambiente para "Homologação (teste)" antes.',
      );
    const itens: NfceItem[] = [
      {
        codigo: 'TESTE',
        descricao: 'PRODUTO DE TESTE', // em homologação o builder troca pela frase obrigatória
        ncm: '21069090',
        cfop: '5102',
        origem: '0',
        csosn: '102',
        unidadeTrib: 'UN',
        quantidade: 1,
        precoUnitario: 1,
      },
    ];
    const r = await this.emitirNucleo({
      tenantId, atorId, unidadeId, comandaId: null, itens, forma: 'dinheiro',
      taxaEntrega: 0, desconto: 0, exigirAtivo: false, pedido: null,
    });
    const n: any = r.nota;
    return {
      status: n.status,
      motivo: n.motivo,
      serie: n.serie,
      numero: n.numero,
      chave: n.chave,
      protocolo: n.protocolo ?? null,
      ambiente: n.ambiente,
    };
  }

  // ===== P18 — A NOTA QUE FICOU "PENDENTE" =====
  //
  // `pendente` quer dizer: foi enviada e NÃO sabemos o que virou. É o único estado que não se
  // resolve sozinho — e enquanto ele durar, aquele número fica travado (índice da mig 281) e a
  // venda não pode emitir outra nota. Quem desfaz o nó é a consulta pela chave.

  // Carência antes de ACREDITAR num "não consta" (217). A autorização é síncrona, mas o nosso
  // tempo pode estourar enquanto a SEFAZ ainda processa: perguntar no segundo seguinte pode
  // ouvir "não existe" de uma nota que está nascendo. Os outros desfechos (autorizada,
  // cancelada, denegada) são definitivos a qualquer momento — só o 217 espera.
  private static readonly CARENCIA_INEXISTENTE_MS = 2 * 60_000;
  private static readonly MAX_TENTATIVAS_CONSULTA = 12;

  // RECUO ENTRE CONSULTAS — minutos de espera conforme o número de tentativas já feitas.
  //
  // Não é educação com o servidor dos outros: é limite publicado. MOC 7.0, Anexo I, rejeição
  // 656 (Consumo Indevido): "NF-e consultada mais de 10 vezes em 1 hora: contribuinte ficará
  // com o WS de Consulta Protocolo recebendo a rejeição 656 por até 1 hora PARA TODAS AS
  // REQUISIÇÕES" (identificado por CNPJ + IP). Um intervalo fixo de 5 minutos dá 12 consultas
  // por hora na mesma chave — passa do limite e derruba a consulta da empresa inteira, bem na
  // hora em que ela mais precisa resolver pendências.
  //
  // Com esta escada, a mesma nota é consultada no máximo 3 vezes na primeira hora (aos 2, 12 e
  // 42 minutos), e vai rareando. O botão da tela usa a MESMA conta — senão bastaria clicar.
  private static readonly RECUO_MINUTOS = [10, 30, 120, 360, 720, 1440];

  private static recuoMinutos(tentativas: number): number {
    const i = Math.max(0, Math.min(FiscalService.RECUO_MINUTOS.length - 1, Number(tentativas ?? 0)));
    return FiscalService.RECUO_MINUTOS[i];
  }

  /** Quando esta nota pode ser consultada de novo (null = pode agora). */
  private esperaConsulta(nota: any): number {
    if (!nota?.consultadaEm) return 0;
    const desde = Date.now() - new Date(nota.consultadaEm).getTime();
    const espera = FiscalService.recuoMinutos(Number(nota.tentativasConsulta ?? 0)) * 60_000;
    return Math.max(0, espera - desde);
  }

  /** Consulta UMA nota na SEFAZ e grava o desfecho. Idempotente: repetir não muda o resultado. */
  async consultarNota(tenantId: string, notaId: string, atorId: string | null) {
    const [nota] = await this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, notaId), eq(notaFiscal.tenantId, tenantId)));
    if (!nota) throw new NotFoundException('Nota não encontrada');
    // O limite da SEFAZ é por NOTA (rejeição 656), e vale para o botão tanto quanto para o job:
    // clicar sem parar bloquearia a consulta da empresa toda por uma hora.
    const espera = this.esperaConsulta(nota);
    if (espera > 0 && nota.status === 'pendente') {
      const min = Math.ceil(espera / 60_000);
      throw new BadRequestException(
        `Esta nota foi consultada há pouco. A SEFAZ limita consultas da mesma nota (rejeição 656), ` +
          `então a próxima pode ser feita em ${min} minuto(s).`,
      );
    }
    return this.resolverNaSefaz(nota, atorId);
  }

  private async resolverNaSefaz(nota: any, atorId: string | null) {
    if (!nota.chave) throw new BadRequestException('Nota sem chave de acesso: não há o que consultar.');
    if (nota.simulada) throw new BadRequestException('Nota simulada não existe na SEFAZ.');
    const cfg: any = await this.configRaw(nota.tenantId, nota.unidadeId);
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    const cert = certificadoParaAssinar(await obterCredencial(this.db, nota.tenantId, nota.unidadeId));

    let situacao: SituacaoNaSefaz;
    try {
      situacao = await consultarSituacaoNfce({
        uf: cfg.uf,
        // O ambiente é o DA NOTA, não o da configuração: trocar o ambiente depois não pode
        // fazer a gente consultar a nota antiga na base errada (lá ela "não consta").
        ambiente: String(nota.ambiente ?? cfg.ambiente ?? '2'),
        chave: nota.chave,
        cert,
      });
    } catch (e: any) {
      if (e instanceof UfSemAutorizador) throw new BadRequestException(e.message);
      if (e instanceof SefazInalcancavel) throw new ServiceUnavailableException(e.message);
      if (e instanceof SefazRecusouChamada) throw new BadGatewayException(e.message);
      throw e;
    }
    return this.aplicarSituacao(nota, situacao, atorId);
  }

  /** Traduz o que a SEFAZ disse para o estado da nota — e só grava se ela AINDA estiver pendente. */
  private async aplicarSituacao(nota: any, sit: SituacaoNaSefaz, atorId: string | null) {
    const agora = new Date();
    const motivo = `${sit.cStat} - ${sit.xMotivo}`.slice(0, 400);
    const idadeMs = agora.getTime() - new Date(nota.createdAt ?? agora).getTime();
    let campos: Record<string, unknown>;

    if (sit.situacao === 'autorizada') {
      campos = {
        status: 'autorizada',
        cstat: sit.cStat,
        protocolo: sit.protocolo,
        motivo,
        // O documento que vale é o nfeProc (nota + protocolo). O que estava guardado era a
        // NFe assinada que foi enviada; agora ela ganha o protocolo que faltava.
        xml: nota.xml && !nota.xml.includes('<nfeProc') ? montarNfeProc(nota.xml, sit.protNFe) : nota.xml,
        emitidaEm: sit.dhRecbto ? new Date(sit.dhRecbto) : agora,
      };
    } else if (sit.situacao === 'cancelada') {
      campos = { status: 'cancelada', cstat: sit.cStat, protocolo: sit.protocolo, motivo, canceladaEm: agora };
    } else if (sit.situacao === 'denegada') {
      // Denegada EXISTE na base da SEFAZ: o número está consumido e nunca volta para a fila.
      // Por isso não vira 'rejeitada' — é o estado que a mantém fora do reaproveitamento.
      campos = { status: 'denegada', cstat: sit.cStat, protocolo: sit.protocolo, motivo };
    } else if (sit.situacao === 'inexistente' && idadeMs >= FiscalService.CARENCIA_INEXISTENTE_MS) {
      // A SEFAZ nunca registrou esta nota: a venda ficou sem documento e o número está livre.
      campos = { status: 'rejeitada', cstat: sit.cStat, motivo };
    } else if (nota.status === 'rejeitada') {
      // Já encerrada: a re-consulta existe só para flagrar a autorização tardia. Qualquer outra
      // resposta apenas conta a tentativa (e faz o recuo crescer).
      campos = { tentativasConsulta: Number(nota.tentativasConsulta ?? 0) + 1 };
    } else {
      // Indefinido — ou 217 cedo demais para acreditar. Continua pendente, conta a tentativa.
      campos = {
        consultadaEm: agora,
        tentativasConsulta: Number(nota.tentativasConsulta ?? 0) + 1,
        motivo:
          sit.situacao === 'inexistente'
            ? `${motivo} (ainda dentro da carência — pode estar sendo processada)`.slice(0, 400)
            : motivo,
      };
    }

    // A nota "rejeitada por 217" NÃO é caso encerrado: a SEFAZ pode ter registrado depois, e é
    // isso que cria a duplicidade que o evento 110112 desfaz. Então ela também pode virar
    // autorizada — mas só nesse sentido. Rejeitada por OUTRO motivo (schema, regra) está
    // encerrada, e nenhuma consulta a reabre.
    //
    // Nota AUTORIZADA só muda num sentido: para CANCELADA, quando a SEFAZ diz que o evento foi
    // registrado (o pedido de cancelamento saiu e a resposta se perdeu). Sem isto a consulta
    // "via" o cancelamento e o nosso banco continuava dizendo que a nota vale.
    const podeMudar =
      nota.status === 'pendente'
        ? sql`status = 'pendente'`
        : nota.status === 'autorizada' && sit.situacao === 'cancelada'
          ? sql`status = 'autorizada'`
          : sql`status = 'rejeitada' and cstat = '217'`;
    const mudaStatus = typeof campos.status === 'string';
    const [atualizada] = await this.db
      .update(notaFiscal)
      .set({ ...campos, consultadaEm: agora })
      .where(and(eq(notaFiscal.id, nota.id), mudaStatus ? podeMudar : sql`true`))
      .returning();

    // Outro processo (ou outra aba) resolveu antes: o desfecho dele vale, não o nosso.
    if (!atualizada) {
      const [atual] = await this.db.select().from(notaFiscal).where(eq(notaFiscal.id, nota.id));
      return this.resumoDaNota(atual, sit);
    }

    if (atualizada.status !== 'pendente')
      await this.auditoria.registrar({
        tenantId: nota.tenantId,
        atorId,
        atorPerfil: '',
        tipo: 'fiscal',
        acao: 'consultou_nfce',
        entidadeTipo: 'nota_fiscal',
        entidadeId: nota.id,
        detalhe: { chave: nota.chave, numero: nota.numero, serie: nota.serie, situacao: atualizada.status, cstat: sit.cStat },
      });
    // A pendente de uma venda DESFEITA apareceu autorizada: é documento de venda que não existe
    // mais — o cancelamento que ficou agendado sai agora, dentro dos 30 minutos.
    if (atualizada.status === 'autorizada' && nota.status !== 'autorizada')
      await this.executarCancelamentosAgendados({ notaId: nota.id }).catch((e: any) =>
        this.log.error(`nota ${nota.id}: cancelamento agendado não saiu: ${e?.message ?? e}`),
      );
    return this.resumoDaNota(atualizada, sit);
  }

  private resumoDaNota(n: any, sit?: SituacaoNaSefaz) {
    return {
      id: n?.id,
      status: n?.status,
      cstat: n?.cstat ?? sit?.cStat ?? null,
      motivo: n?.motivo ?? null,
      protocolo: n?.protocolo ?? null,
      serie: n?.serie ?? null,
      numero: n?.numero ?? null,
      chave: n?.chave ?? null,
    };
  }

  /**
   * Job: resolve as notas pendentes DESTA instalação. Roda na loja e na nuvem — de propósito,
   * ao contrário da maioria dos crons (ver ERR-075): cada lado emite as suas notas e só ele
   * tem como resolvê-las. O recorte é a ORIGEM da série (`fiscal_serie`), então um lado nunca
   * mexe na pendência do outro.
   */
  @Cron('*/5 * * * *')
  async reconciliarPendentes(limite = 20) {
    const origem = this.origemEmissao();
    const r: any = await this.db.execute(sql`
      select n.* from nota_fiscal n
        join fiscal_serie s
          on s.tenant_id = n.tenant_id
         and s.unidade_id is not distinct from n.unidade_id
         and s.serie = n.serie
         and s.origem = ${origem}
       where (n.status = 'pendente'
              -- A nota dada como inexistente continua sendo vigiada enquanto o prazo do
              -- cancelamento por substituição correr (168 h): se ela aparecer autorizada, a
              -- venda tem DUAS notas e só dá para desfazer dentro dessa janela.
              or (n.status = 'rejeitada' and n.cstat = '217'
                  and n.created_at > now() - interval '168 hours'))
         and coalesce(n.simulada, false) = false
         and n.chave is not null
         and n.created_at < now() - interval '2 minutes'
         and n.tentativas_consulta < ${FiscalService.MAX_TENTATIVAS_CONSULTA}
         and (n.consultada_em is null
              or n.consultada_em < now() - (case
                   when n.tentativas_consulta <= 1 then interval '10 minutes'
                   when n.tentativas_consulta = 2 then interval '30 minutes'
                   when n.tentativas_consulta = 3 then interval '2 hours'
                   when n.tentativas_consulta = 4 then interval '6 hours'
                   when n.tentativas_consulta = 5 then interval '12 hours'
                   else interval '24 hours' end))
       order by n.created_at
       limit ${limite}`);
    const pendentes = (r.rows ?? r) as any[];
    const resolvidas: any[] = [];
    for (const linha of pendentes) {
      // Uma nota que não resolve (SEFAZ fora do ar, certificado vencido) não pode impedir as
      // outras: o motivo vai para o log e o laço segue.
      try {
        const nota = { ...linha, tenantId: linha.tenant_id, unidadeId: linha.unidade_id, createdAt: linha.created_at, tentativasConsulta: linha.tentativas_consulta };
        const res = await this.resolverNaSefaz(nota, null);
        if (res.status !== 'pendente') resolvidas.push(res);
      } catch (e: any) {
        this.log.warn(`nota ${linha.id} (nº ${linha.numero}/${linha.serie}) não resolvida: ${e?.message ?? e}`);
      }
    }
    if (pendentes.length)
      this.log.log(`pendentes ${origem}: ${resolvidas.length} de ${pendentes.length} resolvida(s)`);
    return { consultadas: pendentes.length, resolvidas: resolvidas.length, detalhe: resolvidas };
  }


  // ===== CONTINGÊNCIA OFF-LINE (P21) =====
  //
  // O caixa não pode parar porque a SEFAZ não respondeu. Quando ela fica MUDA, a loja passa a
  // emitir com `tpEmis=9`: a nota é assinada e o cupom sai na hora, com um QR assinado pelo
  // próprio certificado; a autorização vem depois, até o fim do primeiro dia útil subsequente.
  //
  // Três travas que a norma impõe e que estão distribuídas por este bloco:
  //  • entra por SILÊNCIO, nunca por rejeição (rejeição é a SEFAZ dizendo não — e no RJ um
  //    documento emitido com IE irregular é inidôneo INCLUSIVE em contingência);
  //  • o número de contingência **não se inutiliza** (Ajuste 19/16, cl. 11ª, §2º, II): a nota
  //    fica na fila até ser autorizada, e rejeição na transmissão NÃO a tira de lá;
  //  • o estado é por PONTO DE EMISSÃO — a loja pode estar sem internet enquanto a nuvem emite
  //    normalmente, e cada uma tem a sua série.

  private idContingencia(tenantId: string, unidadeId: string | null): string {
    return uuidDeChave(tenantId, unidadeId, this.origemEmissao(), 'contingencia');
  }

  /** O estado deste ponto de emissão. `null` = nunca entrou em contingência. */
  private async estadoContingencia(tenantId: string, unidadeId: string | null): Promise<any | null> {
    try {
      const r: any = await this.db.execute(sql`
        select * from fiscal_contingencia where id = ${this.idContingencia(tenantId, unidadeId)}::uuid`);
      return (r.rows ?? r)[0] ?? null;
    } catch (e: any) {
      // Loja com o edge anterior à mig 286: sem a tabela, não há contingência — e a venda
      // segue pelo caminho de sempre, em vez de quebrar por causa de um recurso novo.
      this.log.warn(`estado de contingência indisponível: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Entra em contingência (ou reafirma que está). Idempotente: a `dhCont` é a da ENTRADA. */
  private async entrarEmContingencia(
    tenantId: string,
    unidadeId: string | null,
    motivoTecnico: string,
    atorId: string | null,
  ): Promise<any> {
    const id = this.idContingencia(tenantId, unidadeId);
    const origem = this.origemEmissao();
    const r: any = await this.db.execute(sql`
      insert into fiscal_contingencia
        (id, tenant_id, unidade_id, origem, ativa, dh_cont, justificativa, motivo_tecnico, entrou_em, saiu_em)
      values (${id}::uuid, ${tenantId}::uuid, ${unidadeId ?? null}::uuid, ${origem}, true, now(),
              ${JUSTIFICATIVA_PADRAO}, ${String(motivoTecnico ?? '').slice(0, 400)}, now(), null)
      on conflict (id) do update set
        ativa = true,
        -- Já estava em contingência? A data de ENTRADA não se mexe: é ela que vai no XML.
        dh_cont = coalesce(case when fiscal_contingencia.ativa then fiscal_contingencia.dh_cont end, now()),
        entrou_em = coalesce(case when fiscal_contingencia.ativa then fiscal_contingencia.entrou_em end, now()),
        justificativa = coalesce(fiscal_contingencia.justificativa, excluded.justificativa),
        motivo_tecnico = excluded.motivo_tecnico,
        saiu_em = null
      returning *`);
    const linha = (r.rows ?? r)[0];
    if (!linha?.ativa || !linha?.dh_cont) return linha;
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'entrou_em_contingencia',
      entidadeTipo: 'fiscal_contingencia', entidadeId: linha.id,
      detalhe: { origem, motivo: motivoTecnico, dhCont: linha.dh_cont },
    });
    this.log.warn(`CONTINGÊNCIA LIGADA (${origem}): ${motivoTecnico}`);
    return linha;
  }

  /** Sai da contingência. As notas já emitidas continuam na fila até serem autorizadas. */
  private async sairDaContingencia(tenantId: string, unidadeId: string | null, motivo: string) {
    const id = this.idContingencia(tenantId, unidadeId);
    await this.db.execute(sql`
      update fiscal_contingencia
         set ativa = false, saiu_em = now(), motivo_tecnico = ${motivo.slice(0, 400)}
       where id = ${id}::uuid and ativa = true`);
    await this.auditoria.registrar({
      tenantId, atorId: null, atorPerfil: '', tipo: 'fiscal', acao: 'saiu_da_contingencia',
      entidadeTipo: 'fiscal_contingencia', entidadeId: id, detalhe: { motivo },
    });
    this.log.log(`contingência desligada (${this.origemEmissao()}): ${motivo}`);
  }

  /** O que o `emitirNucleo` precisa para emitir em contingência — ou `null` se não está nela. */
  private async modoContingencia(
    tenantId: string,
    unidadeId: string | null,
  ): Promise<{ dhCont: Date; xJust: string } | null> {
    const e = await this.estadoContingencia(tenantId, unidadeId);
    if (!e?.ativa || !e.dh_cont) return null;
    return { dhCont: new Date(e.dh_cont), xJust: justificativaValida(e.justificativa) };
  }


  // Um ciclo não começa por cima do outro: com muitas lojas e a SEFAZ muda, ele pode passar dos
  // 5 minutos, e dois ciclos juntos transmitiriam as mesmas notas ao mesmo tempo. O botão
  // "transmitir agora" trava por empresa — duas pessoas da mesma loja apertando ao mesmo tempo.
  private contingenciaRodando = false;
  private readonly contingenciaPorEmpresa = new Set<string>();

  /**
   * O ciclo da contingência, a cada 5 minutos: **sair** quando a SEFAZ voltar e **transmitir**
   * o que foi emitido enquanto ela esteve fora — de TODAS as lojas deste ponto de emissão.
   *
   * A transmissão não é acessório: não transmitir a NFC-e de contingência é multa de **5% do
   * valor da operação** no RJ (RICMS, art. 62-C, III), e transmitir fora do prazo, 100 UFIR-RJ
   * por obrigação (XIII). O prazo é o fim do primeiro dia útil subsequente à EMISSÃO.
   */
  @Cron('*/5 * * * *')
  async rodarContingencia(limite = 20) {
    if (this.contingenciaRodando) return { verificados: 0, transmitidas: 0, emAndamento: true };
    this.contingenciaRodando = true;
    try {
      return await this.cicloContingencia(limite, null);
    } finally {
      this.contingenciaRodando = false;
    }
  }

  /**
   * O botão "transmitir agora": o mesmo ciclo, só com a fila da PRÓPRIA empresa (e da loja em
   * uso, havendo uma). Ele rodava a fila da nuvem inteira — as notas de todas as lojas — e
   * devolvia a contagem de todas (ERR-105).
   */
  async transmitirContingencia(escopo: EscopoContingencia, limite = 20) {
    const empresas = [...new Set((escopo?.tenantIds ?? []).filter(Boolean))];
    if (!empresas.length) return { verificados: 0, transmitidas: 0 };
    // O job já está passando pela fila (e chega a esta loja), ou alguém da empresa apertou antes.
    if (this.contingenciaRodando || empresas.some((t) => this.contingenciaPorEmpresa.has(t)))
      return { verificados: 0, transmitidas: 0, emAndamento: true };
    empresas.forEach((t) => this.contingenciaPorEmpresa.add(t));
    try {
      return await this.cicloContingencia(limite, { tenantIds: empresas, unidadeId: escopo.unidadeId ?? null });
    } finally {
      empresas.forEach((t) => this.contingenciaPorEmpresa.delete(t));
    }
  }

  /**
   * Sem escopo, TODAS as lojas deste ponto de emissão (é o job). Com escopo, só as empresas dele —
   * e, havendo loja em uso, as notas dela e as da rede (sem loja).
   *
   * Na nuvem a fila tem notas de muitas lojas, e o erro de uma não pode parar as outras (ERR-105):
   * silêncio tira do ciclo a loja (e, com duas lojas mudas, a SEFAZ daquela UF — `SilencioDoCiclo`);
   * problema da loja (certificado, credencial, configuração) tira só ela; erro de uma nota fica
   * nela, e a fila segue.
   */
  private async cicloContingencia(limite: number, escopo: EscopoContingencia | null) {
    const origem = this.origemEmissao();
    const empresas = escopo ? sql.join(escopo.tenantIds.map((t) => sql`${t}::uuid`), sql`, `) : null;
    const unidade = escopo?.unidadeId ?? null;
    let ativos: any[] = [];
    try {
      const r: any = await this.db.execute(sql`
        select * from fiscal_contingencia
         where origem = ${origem} and ativa = true
           and ${empresas ? sql`tenant_id in (${empresas})` : sql`true`}
           and ${unidade ? sql`(unidade_id = ${unidade}::uuid or unidade_id is null)` : sql`true`}`);
      ativos = (r.rows ?? r) as any[];
    } catch {
      return { verificados: 0, transmitidas: 0 }; // loja com o edge anterior à mig 286
    }

    // ── 1) A SEFAZ voltou? ──────────────────────────────────────────────────────────────
    // A pergunta é a consulta de STATUS: não emite, não gasta número, não grava nada. Com a SEFAZ
    // de uma UF muda, cada loja esperaria os 30 s dela — duas lojas sem resposta bastam.
    const mudasNoStatus = new SilencioDoCiclo();
    for (const e of ativos) {
      const loja = pontoDeEmissao(e.tenant_id, e.unidade_id);
      try {
        const cfg: any = await this.configRaw(e.tenant_id, e.unidade_id ?? null);
        const quem = autorizador(cfg?.codigoUf, cfg?.ambiente);
        // Pulada, ela também conta como verificada (o `finally`): a SEFAZ dela é a que calou.
        if (mudasNoStatus.pular(loja, quem)) continue;
        try {
          const st = await this.statusSefazBruto(e.tenant_id, e.unidade_id ?? null, cfg);
          if (st.emOperacao)
            await this.sairDaContingencia(e.tenant_id, e.unidade_id ?? null, `SEFAZ em operacao (${st.cStat})`);
        } catch (err: any) {
          if (err instanceof SefazInalcancavel) mudasNoStatus.registrar(loja, quem);
          throw err;
        }
      } catch (err: any) {
        this.log.warn(`contingência segue ligada (${origem}, empresa ${e.tenant_id}): ${err?.message ?? err}`);
      } finally {
        await this.db
          .execute(sql`update fiscal_contingencia set ultima_verificacao = now() where id = ${e.id}::uuid`)
          .catch(() => undefined);
      }
    }

    // ── 2) A fila ───────────────────────────────────────────────────────────────────────
    // Roda mesmo com a contingência ainda ligada: a SEFAZ pode ter voltado entre um ciclo e
    // outro, e cada nota transmitida a menos é uma multa a mais.
    //
    // A ordem é por VEZ: a nota mais antiga de cada loja, depois a segunda de cada uma… Na ordem
    // de chegada pura, as notas travadas de uma loja (que nunca saem da fila) ocupavam o lote
    // inteiro, e as das outras lojas não entravam nunca.
    const fila: any = await this.db.execute(sql`
      with fila as (
        select n.id, n.created_at,
               row_number() over (partition by n.tenant_id, n.unidade_id order by n.created_at, n.numero) as vez
          from nota_fiscal n
          join fiscal_serie s
            on s.tenant_id = n.tenant_id
           and s.unidade_id is not distinct from n.unidade_id
           and s.serie = n.serie
           and s.origem = ${origem}
         where n.status = 'contingencia'
           and n.chave is not null
           and coalesce(n.simulada, false) = false
           and ${empresas ? sql`n.tenant_id in (${empresas})` : sql`true`}
           and ${unidade ? sql`(n.unidade_id = ${unidade}::uuid or n.unidade_id is null)` : sql`true`}
      ),
      escolhidas as (
        select id, vez, created_at from fila order by vez, created_at limit ${limite}
      )
      select n.* from escolhidas e join nota_fiscal n on n.id = e.id
       order by e.vez, e.created_at`);
    const notas = (fila.rows ?? fila) as any[];
    const mudas = new SilencioDoCiclo();
    // Configuração, credencial e certificado: uma vez por loja no ciclo — abrir o certificado
    // custa, e o problema de uma loja vale para todas as notas dela.
    const lojas = new Map<string, PreparoDaTransmissao | FalhaDaLoja>();
    let transmitidas = 0;
    let adiadas = 0;
    for (const linha of notas) {
      const loja = pontoDeEmissao(linha.tenant_id, linha.unidade_id);
      const quem = autorizador(String(linha.chave ?? '').slice(0, 2), linha.ambiente);
      if (mudas.pular(loja, quem)) {
        adiadas++;
        continue;
      }
      let preparo = lojas.get(loja);
      if (!preparo) {
        preparo = await this.prepararTransmissao(linha.tenant_id, linha.unidade_id ?? null).catch(
          (e: FalhaDaLoja) => e,
        );
        lojas.set(loja, preparo);
        if (preparo instanceof FalhaDaLoja) {
          // Uma vez por loja: as outras notas dela esperam o conserto, sem repetir o mesmo erro.
          const causa: any = preparo.causa;
          this.log.error(
            `contingência ${origem}: a fila da empresa ${linha.tenant_id} não sai — ${preparo.message}` +
              (causa && causa.message !== preparo.message ? ` (${causa.message ?? causa})` : ''),
          );
          await this.anotarFalhaDaContingencia(linha, preparo);
          continue;
        }
      }
      if (preparo instanceof FalhaDaLoja) {
        adiadas++;
        continue;
      }
      try {
        if (await this.transmitirDaContingencia(linha, preparo)) transmitidas++;
      } catch (e: any) {
        if (e instanceof SefazInalcancavel) {
          mudas.registrar(loja, quem);
          this.log.warn(
            `contingência ${origem}: a SEFAZ não respondeu à NFC-e ${linha.numero}/${linha.serie} ` +
              `(empresa ${linha.tenant_id}) — a loja fica para o próximo ciclo: ${e.message}`,
          );
        } else {
          // Erro desta nota: fica nela, e a fila segue para as outras — inclusive as da mesma loja.
          this.log.error(
            `contingência ${origem}: NFC-e ${linha.numero}/${linha.serie} (empresa ${linha.tenant_id}) ` +
              `não transmitida: ${e?.message ?? e}`,
          );
        }
        await this.anotarFalhaDaContingencia(linha, e);
      }
    }
    if (notas.length) {
      const foraDoAr = mudas.foraDoAr();
      this.log.log(
        `contingência ${origem}: ${transmitidas} de ${notas.length} transmitida(s)` +
          (adiadas ? `, ${adiadas} para o próximo ciclo` : '') +
          (foraDoAr.length ? ` — SEFAZ sem resposta: ${foraDoAr.join(', ')}` : ''),
      );
    }
    return { verificados: ativos.length, transmitidas };
  }

  /**
   * O que é da LOJA na transmissão — configuração, credencial, certificado e transmissor. Tudo o
   * que falha aqui vale para todas as notas dela e para nenhuma das outras lojas: sai como
   * `FalhaDaLoja`, com o texto que a loja lê na fila.
   */
  private async prepararTransmissao(tenantId: string, unidadeId: string | null): Promise<PreparoDaTransmissao> {
    let config: any;
    try {
      const cfgRaw: any = await this.configRaw(tenantId, unidadeId);
      if (!cfgRaw) throw new FalhaDaLoja('a configuração fiscal da loja não foi encontrada');
      const credencial = await obterCredencial(this.db, tenantId, unidadeId);
      // O `certRef` vem da CREDENCIAL cifrada (mig 279), não da linha de `fiscal_config` — ler
      // do lugar errado deixa o transmissor sem certificado e a fila parada em silêncio.
      config = { ...cfgRaw, ...credencialParaEmissao(credencial, String(cfgRaw.ambiente ?? '2')) };
      config.cert = config.certRef ? certificadoParaAssinar(credencial) : null;
      // Certificado vencido derruba o TLS, e o erro chegava aqui como "a SEFAZ não respondeu" —
      // a loja ia esperar a SEFAZ voltar enquanto o prazo da fila corria (ERR-099).
      const probsCert = config.cert ? problemasDoCertificado(config.cert, cfgRaw.cnpj) : [];
      if (probsCert.length)
        throw new FalhaDaLoja(
          `o certificado digital da loja não serve (${probsCert.join(' ')}) — a fila da contingência ` +
            'só é transmitida depois de cadastrado o certificado válido',
        );
    } catch (e: any) {
      if (e instanceof FalhaDaLoja) throw e;
      // Texto escrito para o usuário (o certificado que não abre, o CSC) vai para a fila como
      // está; defeito nosso (banco, código) fica no log, e a loja lê um aviso.
      throw new FalhaDaLoja(
        e instanceof HttpException ? e.message : 'não consegui preparar a transmissão (o detalhe ficou no log do servidor)',
        e,
      );
    }
    try {
      return { config, transmissor: this.transmitter(config) };
    } catch (e: any) {
      // Sem certificado, ou a UF sem autorizador confirmado: textos escritos para a loja, mas o
      // "nenhuma nota foi emitida" do fim é da emissão — a de contingência JÁ foi emitida.
      const texto = String(e?.message ?? 'transmissor indisponível').replace(/\s*Nenhuma nota foi emitida\.?\s*$/i, '');
      throw new FalhaDaLoja(texto, e);
    }
  }

  /**
   * A nota não saiu por um ERRO — não por rejeição da SEFAZ: o motivo fica nela, à vista na fila
   * da loja, e a tentativa conta. Nunca lança: é o registro de uma falha, não pode virar outra.
   */
  private async anotarFalhaDaContingencia(linha: any, erro: unknown): Promise<void> {
    await this.db
      .execute(sql`
        update nota_fiscal
           set motivo = ${motivoDaFalha(erro)},
               tentativas_transmissao = tentativas_transmissao + 1
         where id = ${linha.id}::uuid and status = 'contingencia'`)
      .catch((e: any) =>
        this.log.warn(`NFC-e ${linha.numero}/${linha.serie}: o motivo da falha não foi gravado: ${e?.message ?? e}`),
      );
  }

  /**
   * Transmite UMA nota emitida em contingência. O XML é o que já está gravado — assinado, com
   * a MESMA chave e o mesmo `cNF` (MOC 7.0, Anexo IV, §3: "deve-se manter a mesma chave de
   * acesso, inclusive com a manutenção do mesmo código numérico original").
   *
   * ⚠️ Rejeição **não** tira a nota da fila: número emitido em contingência não pode ser
   * inutilizado (Ajuste 19/16, cl. 11ª, §2º, II), então ele tem de ser transmitido de um jeito
   * ou de outro — corrigindo o que a SEFAZ apontou e reenviando com a MESMA numeração.
   */
  private async transmitirDaContingencia(linha: any, preparo: PreparoDaTransmissao): Promise<boolean> {
    const tenantId = linha.tenant_id;
    const unidadeId = linha.unidade_id ?? null;
    const { config, transmissor } = preparo;
    const ret = await transmissor.autorizar(linha.xml, linha.chave, config);
    const vencido = prazoVencido(new Date(linha.created_at), new Date());

    if (ret.status === 'autorizada') {
      await this.db.execute(sql`
        update nota_fiscal
           set status = 'autorizada', protocolo = ${ret.protocolo ?? null}, cstat = ${ret.cStat ?? null},
               motivo = ${ret.motivo}, xml = ${ret.xmlAutorizado ?? linha.xml}, emitida_em = now(),
               tentativas_transmissao = tentativas_transmissao + 1
         where id = ${linha.id}::uuid`);
      if (vencido)
        this.log.warn(
          `NFC-e ${linha.numero}/${linha.serie} autorizada FORA DO PRAZO da contingência ` +
            `(emitida em ${new Date(linha.created_at).toISOString()}).`,
        );
      // Venda desfeita enquanto a nota esperava na fila (o totem não imprimiu o cupom): agora que
      // ela é documento, o cancelamento agendado sai — os 30 minutos contam desta autorização.
      await this.executarCancelamentosAgendados({ notaId: linha.id }).catch((e: any) =>
        this.log.error(`NFC-e ${linha.numero}/${linha.serie}: cancelamento agendado não saiu: ${e?.message ?? e}`),
      );
      return true;
    }
    if (ret.status === 'denegada') {
      // Denegada consome o número e encerra o assunto: não há o que retransmitir.
      await this.db.execute(sql`
        update nota_fiscal
           set status = 'denegada', cstat = ${ret.cStat ?? null}, protocolo = ${ret.protocolo ?? null},
               motivo = ${ret.motivo}, tentativas_transmissao = tentativas_transmissao + 1
         where id = ${linha.id}::uuid`);
      return true;
    }
    // Duplicidade (204): a nota já está na base da SEFAZ — provavelmente de uma transmissão
    // anterior cuja resposta não chegou até nós. Quem diz o que ela é lá é a CONSULTA.
    if (String(ret.cStat ?? '') === '204') {
      const nota = {
        ...linha, tenantId, unidadeId,
        createdAt: linha.created_at, tentativasConsulta: linha.tentativas_consulta,
      };
      await this.resolverNaSefaz(nota, null).catch(() => undefined);
      return true;
    }
    // Rejeitada ou sem resposta: FICA na fila (ver o aviso acima), com o motivo à vista.
    await this.db.execute(sql`
      update nota_fiscal
         set cstat = ${ret.cStat ?? null},
             motivo = ${`Contingencia nao transmitida: ${ret.motivo}`.slice(0, 400)},
             tentativas_transmissao = tentativas_transmissao + 1
       where id = ${linha.id}::uuid`);
    if (vencido)
      this.log.error(
        `NFC-e ${linha.numero}/${linha.serie} em contingência PASSOU DO PRAZO e continua sem ` +
          `autorização: ${ret.motivo}. Corrija e reenvie com a MESMA numeração.`,
      );
    return false;
  }

  /**
   * O que a loja precisa ver numa tela só: estou em contingência? desde quando? e quais notas
   * ainda não foram autorizadas, com quanto tempo resta de prazo.
   */
  async painelContingencia(tenantId: string, unidadeId?: string | null) {
    const e = await this.estadoContingencia(tenantId, unidadeId ?? null);
    return {
      ativa: !!e?.ativa,
      origem: this.origemEmissao(),
      desde: e?.dh_cont ?? null,
      motivo: e?.motivo_tecnico ?? null,
      ultimaVerificacao: e?.ultima_verificacao ?? null,
      notasEmitidas: Number(e?.notas_emitidas ?? 0),
      fila: await this.filaContingencia(tenantId, unidadeId),
    };
  }

  /** A fila da contingência com o prazo de cada nota — é o que a loja precisa ver. */
  async filaContingencia(tenantId: string, unidadeId?: string | null) {
    const r: any = await this.db.execute(sql`
      select id, serie, numero, chave, created_at, motivo, tentativas_transmissao
        from nota_fiscal
       where tenant_id = ${tenantId}
         and ${unidadeId ? sql`unidade_id is not distinct from ${unidadeId}` : sql`true`}
         and status = 'contingencia'
       order by created_at
       limit 200`);
    const agora = new Date();
    return ((r.rows ?? r) as any[]).map((n) => ({
      id: n.id,
      serie: n.serie,
      numero: n.numero,
      chave: n.chave,
      emitidaEm: n.created_at,
      motivo: n.motivo,
      tentativas: n.tentativas_transmissao,
      horasRestantes: horasAteOPrazo(new Date(n.created_at), agora),
      vencida: prazoVencido(new Date(n.created_at), agora),
    }));
  }

  // ===== P20 — DUAS NOTAS PARA A MESMA VENDA =====
  //
  // Acontece assim (MOC 7.0, §3.5, que dá nome ao caso): a primeira nota foi enviada, a SEFAZ
  // não respondeu, a consulta disse "não consta", emitimos a segunda para o cliente levar — e a
  // primeira aparece autorizada depois. As duas acobertam a mesma venda, e a lei dá 168 horas
  // para desfazer: cancelar a que NÃO acobertou, referenciando a que substituiu (evento 110112,
  // Ajuste SINIEF 19/16, cl. 15ª-A). Passado o prazo, a SEFAZ recusa e a duplicidade fica.

  /**
   * Vendas com mais de uma NFC-e autorizada. A mais NOVA é a que o cliente levou (foi emitida
   * porque a outra não tinha resposta), então a candidata a cancelamento é a mais ANTIGA.
   */
  async duplicidades(tenantId: string, unidadeId?: string | null) {
    const r: any = await this.db.execute(sql`
      with autorizadas as (
        select id, comanda_id, serie, numero, chave, protocolo, emitida_em, created_at,
               row_number() over (partition by comanda_id order by created_at, numero) as ordem,
               count(*) over (partition by comanda_id) as quantas
          from nota_fiscal
         where tenant_id = ${tenantId}
           and ${unidadeId ? sql`unidade_id is not distinct from ${unidadeId}` : sql`true`}
           and comanda_id is not null
           and status = 'autorizada'
           and coalesce(simulada, false) = false
      )
      select a.id, a.comanda_id as "comandaId", a.serie, a.numero, a.chave, a.protocolo,
             a.emitida_em as "emitidaEm",
             s.id as "substitutaId", s.serie as "substitutaSerie", s.numero as "substitutaNumero",
             s.chave as "substitutaChave",
             -- Quanto ainda resta do prazo de 168 h, contado da AUTORIZAÇÃO da nota a cancelar.
             round(extract(epoch from (
               a.emitida_em + interval '168 hours' - now())) / 3600.0, 1) as "horasRestantes"
        from autorizadas a
        join autorizadas s on s.comanda_id = a.comanda_id and s.ordem = a.ordem + 1
       where a.quantas > 1 and a.ordem = 1
         and not exists (
           select 1 from fiscal_evento e
            where e.tenant_id = ${tenantId} and e.chave = a.chave
              and e.tp_evento = ${TP_EVENTO_CANC_SUBST} and e.status <> 'rejeitado')
       order by a.emitida_em`);
    return (r.rows ?? r) as any[];
  }

  /**
   * Cancela a nota duplicada REFERENCIANDO a que a substituiu (evento 110112). Irreversível —
   * e com prazo: 168 horas contadas da autorização da nota cancelada.
   */
  async cancelarPorSubstituicao(
    tenantId: string,
    atorId: string | null,
    notaId: string,
    justificativa?: string,
  ) {
    const [nota] = await this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, notaId), eq(notaFiscal.tenantId, tenantId)));
    if (!nota) throw new NotFoundException('Nota não encontrada');
    if (nota.status !== 'autorizada')
      throw new BadRequestException('Só se cancela nota autorizada.');
    if (!nota.chave || !nota.protocolo)
      throw new BadRequestException('A nota não tem chave e protocolo — nada a cancelar na SEFAZ.');
    if (!nota.comandaId)
      throw new BadRequestException('Cancelamento por substituição exige a venda: esta nota não tem comanda.');

    // A substituta é a nota que acobertou a venda: a MESMA comanda, autorizada, emitida depois.
    const [substituta] = await this.db
      .select()
      .from(notaFiscal)
      .where(
        and(
          eq(notaFiscal.tenantId, tenantId),
          eq(notaFiscal.comandaId, nota.comandaId),
          eq(notaFiscal.status, 'autorizada'),
          sql`id <> ${nota.id}`,
          sql`created_at >= ${nota.createdAt}`,
        ),
      )
      .orderBy(sql`created_at`)
      .limit(1);
    if (!substituta?.chave)
      throw new BadRequestException(
        'Não achei a NFC-e substituta desta venda. O cancelamento por substituição exige informar ' +
          'a nota que acobertou a operação — se não existe outra, o caso é de cancelamento comum.',
      );

    // Prazo: a SEFAZ rejeita fora das 168 h ("Prazo de cancelamento superior ao previsto").
    const autorizadaEm = nota.emitidaEm ? new Date(nota.emitidaEm) : new Date(nota.createdAt);
    const horas = (Date.now() - autorizadaEm.getTime()) / 3_600_000;
    if (horas > PRAZO_CANC_SUBST_HORAS)
      throw new BadRequestException(
        `O prazo do cancelamento por substituição é de ${PRAZO_CANC_SUBST_HORAS} horas da autorização, ` +
          `e já se passaram ${Math.floor(horas)}. A SEFAZ vai recusar — este caso é de conversa com a contabilidade.`,
      );

    const cfg: any = await this.configRaw(tenantId, nota.unidadeId);
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    const cert = certificadoParaAssinar(await obterCredencial(this.db, tenantId, nota.unidadeId));
    const ambiente = String(nota.ambiente ?? cfg.ambiente ?? '2');
    const just =
      String(justificativa ?? '').trim() ||
      `NFC-e emitida em duplicidade - operacao acobertada pela NFC-e ${substituta.serie}/${substituta.numero}`;

    const evento = montarEventoCancSubst({
      ambiente,
      codigoUf: cfg.codigoUf,
      cnpj: cfg.cnpj,
      chave: nota.chave,
      protocolo: nota.protocolo,
      chaveSubstituta: substituta.chave,
      justificativa: just,
      // Mesma regra do dhEmi: hora do fuso da UF do emitente, nunca UTC.
      dhEvento: dhEmiSefaz(new Date(), cfg.uf),
    });
    const assinado = assinarEvento(evento, cert);

    // Grava antes de enviar: se a resposta se perder, fica o registro de que o evento saiu.
    const [registro] = await this.db
      .insert(fiscalEvento)
      .values({
        tenantId, unidadeId: nota.unidadeId, notaId: nota.id, chave: nota.chave,
        tpEvento: TP_EVENTO_CANC_SUBST, nSeq: 1, justificativa: just,
        chaveRef: substituta.chave, status: 'pendente', ambiente, xml: assinado,
        solicitadoPorId: atorId,
      })
      .returning();

    let campos: Record<string, unknown>;
    try {
      const r = await enviarEventoCancSubst({ uf: cfg.uf, ambiente, eventoAssinado: assinado, cert });
      campos =
        r.situacao === 'registrado'
          ? { status: 'registrado', cstat: r.cStat, motivo: r.xMotivo, protocolo: r.protocolo, xml: r.procEventoNFe, registradoEm: new Date() }
          : { status: 'rejeitado', cstat: r.cStat, motivo: `${r.cStat} - ${r.xMotivo}`.slice(0, 400) };
    } catch (e: any) {
      if (e instanceof SefazInalcancavel) {
        await this.db
          .update(fiscalEvento)
          .set({ motivo: `Sem resposta da SEFAZ — situação desconhecida. ${e.message}`.slice(0, 400), updatedAt: new Date() })
          .where(eq(fiscalEvento.id, registro.id));
        throw new ServiceUnavailableException(e.message);
      }
      campos = { status: 'rejeitado', motivo: String(e?.message ?? 'falha').slice(0, 400) };
    }

    const [final] = await this.db
      .update(fiscalEvento)
      .set({ ...campos, updatedAt: new Date() })
      .where(eq(fiscalEvento.id, registro.id))
      .returning();

    // A nota só vira 'cancelada' quando a SEFAZ registrou o evento — nunca por otimismo.
    if (final.status === 'registrado')
      await this.db
        .update(notaFiscal)
        .set({
          status: 'cancelada',
          canceladaEm: new Date(),
          canceladaPorId: atorId,
          justificativaCancelamento: just,
          motivo: `${final.cstat} - ${final.motivo}`.slice(0, 400),
        })
        .where(and(eq(notaFiscal.id, nota.id), eq(notaFiscal.status, 'autorizada')));

    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'cancelou_por_substituicao',
      entidadeTipo: 'nota_fiscal', entidadeId: nota.id,
      detalhe: {
        chave: nota.chave, numero: nota.numero, serie: nota.serie,
        substituta: substituta.chave, status: final.status, motivo: final.motivo, justificativa: just,
      },
    });
    if (final.status !== 'registrado')
      throw new BadRequestException(`Cancelamento por substituição recusado pela SEFAZ: ${final.motivo}`);
    return { status: final.status, protocolo: final.protocolo, motivo: final.motivo, substituta: substituta.chave };
  }

  // ===== P19 — O NÚMERO QUE NÃO VIROU NOTA =====
  //
  // Número reservado e não autorizado deixa BURACO na sequência, e buraco tem prazo: o Ajuste
  // SINIEF 19/16, cl. 16ª, manda pedir a inutilização até o 10º dia do mês seguinte; a cl. 11ª,
  // §5º diz o que acontece se não pedir — a partir do 11º dia, a numeração faltante é presumida
  // como "documentos emitidos em contingência e não transmitidos", ou seja, venda sem nota.
  //
  // E não existe reaproveitar: o MOC 7.0 (Anexo III, nota 2) diz que manter número e série "NUNCA
  // para os casos em que a NF-e foi normalmente emitida mas o contribuinte não obteve êxito na
  // consulta sobre o resultado da autorização". Para essas, manda inutilizar.

  /** Números sem documento válido numa série — o que precisa ser inutilizado, em faixas. */
  async lacunas(tenantId: string, unidadeId: string | null, serie?: number) {
    const r: any = await this.db.execute(sql`
      with faixa as (
        select serie, max(numero) as ate
          from nota_fiscal
         where tenant_id = ${tenantId}
           and unidade_id is not distinct from ${unidadeId ?? null}
           and modelo = '65' and numero is not null
           ${serie ? sql`and serie = ${serie}` : sql``}
         group by serie
      ),
      todos as (
        select f.serie, generate_series(1, f.ate) as numero from faixa f
      ),
      validas as (
        -- Qualquer coisa que NÃO seja rejeitada ocupa o número: autorizada, cancelada, denegada
        -- e também a PENDENTE (enquanto não se sabe o que a SEFAZ fez, não se inutiliza).
        select serie, numero from nota_fiscal
         where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
           and modelo = '65' and status <> 'rejeitada'
      ),
      ja as (
        select serie, numero_inicial, numero_final from fiscal_inutilizacao
         where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
           and status <> 'rejeitada'
      )
      select t.serie, t.numero
        from todos t
       where not exists (select 1 from validas v where v.serie = t.serie and v.numero = t.numero)
         and not exists (select 1 from ja j
                          where j.serie = t.serie and t.numero between j.numero_inicial and j.numero_final)
       order by t.serie, t.numero`);
    const linhas = (r.rows ?? r) as { serie: number; numero: number }[];

    // Números soltos viram FAIXAS: um pedido por faixa, não um por número.
    const porSerie = new Map<number, { inicio: number; fim: number }[]>();
    for (const l of linhas) {
      const serieN = Number(l.serie);
      const numero = Number(l.numero);
      const lista = porSerie.get(serieN) ?? [];
      const ultima = lista[lista.length - 1];
      if (ultima && numero === ultima.fim + 1) ultima.fim = numero;
      else lista.push({ inicio: numero, fim: numero });
      porSerie.set(serieN, lista);
    }
    return [...porSerie.entries()].map(([s, faixas]) => ({
      serie: s,
      total: faixas.reduce((n, f) => n + (f.fim - f.inicio + 1), 0),
      faixas: faixas.map((f) => ({ ...f, quantidade: f.fim - f.inicio + 1 })),
    }));
  }

  /**
   * Pede à SEFAZ a inutilização de uma faixa. IRREVERSÍVEL: homologada, aqueles números nunca
   * mais podem virar nota. Por isso a faixa é conferida contra o banco antes de sair daqui.
   */
  async inutilizarFaixa(
    tenantId: string,
    atorId: string | null,
    dto: { unidadeId?: string | null; serie: number; numeroInicial: number; numeroFinal: number; justificativa: string },
  ) {
    const unidadeId = await this.resolverUnidadeEmissao(tenantId, dto.unidadeId ?? null);
    const serie = Number(dto.serie);
    const ini = Number(dto.numeroInicial);
    const fim = Number(dto.numeroFinal);
    const justificativa = String(dto.justificativa ?? '').trim();
    if (!Number.isInteger(serie) || serie < 0 || serie > 999)
      throw new BadRequestException('Série inválida.');
    if (!Number.isInteger(ini) || !Number.isInteger(fim) || ini < 1 || fim < ini)
      throw new BadRequestException('Faixa inválida: informe número inicial e final, do menor para o maior.');
    if (justificativa.length < 15)
      throw new BadRequestException('A justificativa precisa de ao menos 15 caracteres (exigência da SEFAZ).');

    const cfg: any = await this.configRaw(tenantId, unidadeId);
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');

    // 1) Nenhum número da faixa pode ter documento válido. Inutilizar por cima de nota
    //    autorizada é perda de documento fiscal, e não há como desfazer.
    const ocupados: any = await this.db.execute(sql`
      select numero, status from nota_fiscal
       where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
         and modelo = '65' and serie = ${serie} and numero between ${ini} and ${fim}
         and status <> 'rejeitada'
       order by numero limit 5`);
    const comNota = (ocupados.rows ?? ocupados) as { numero: number; status: string }[];
    if (comNota.length)
      throw new BadRequestException(
        `A faixa tem nota que ocupa o número: ${comNota
          .map((n) => `${n.numero} (${n.status})`)
          .join(', ')}. Inutilização é definitiva — corrija a faixa.`,
      );

    // 2) Nem pode repetir pedido: a SEFAZ devolve 563 ("já existe pedido de inutilização").
    const jaPedido: any = await this.db.execute(sql`
      select numero_inicial, numero_final, status from fiscal_inutilizacao
       where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
         and serie = ${serie} and status <> 'rejeitada'
         and numero_inicial <= ${fim} and numero_final >= ${ini}
       limit 1`);
    const conflito = (jaPedido.rows ?? jaPedido)[0];
    if (conflito)
      throw new BadRequestException(
        `A faixa ${conflito.numero_inicial}–${conflito.numero_final} desta série já tem pedido (${conflito.status}).`,
      );

    // 3) O ANO do pedido é o da numeração — o das notas daquela faixa, não o de hoje (uma lacuna
    //    de dezembro é inutilizada em janeiro, e o Id levaria o ano errado).
    const anoNota: any = await this.db.execute(sql`
      select to_char(max(created_at), 'YY') as ano from nota_fiscal
       where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
         and modelo = '65' and serie = ${serie} and numero between ${ini} and ${fim}`);
    const ano2 = (anoNota.rows ?? anoNota)[0]?.ano ?? hojeISO().slice(2, 4);

    const credencial = await obterCredencial(this.db, tenantId, unidadeId);
    const cert = certificadoParaAssinar(credencial);
    const ambiente = String(cfg.ambiente ?? '2');

    const pedido = montarInutNFe({
      ambiente,
      codigoUf: cfg.codigoUf,
      ano2,
      cnpj: cfg.cnpj,
      modelo: '65',
      serie,
      numeroInicial: ini,
      numeroFinal: fim,
      justificativa,
    });
    const assinado = assinarInutNFe(pedido, cert);

    // Grava ANTES de enviar: se a resposta se perder no caminho, fica o registro de que o pedido
    // saiu — e o próximo pedido igual é barrado aqui em vez de levar 563 da SEFAZ.
    const [registro] = await this.db
      .insert(fiscalInutilizacao)
      .values({
        tenantId, unidadeId, ano: Number(`20${ano2}`), modelo: '65', serie,
        numeroInicial: ini, numeroFinal: fim, justificativa,
        status: 'pendente', ambiente, xml: assinado, solicitadoPorId: atorId,
      })
      .returning();

    let campos: Record<string, unknown>;
    try {
      const r = await inutilizarNfce({ uf: cfg.uf, ambiente, pedidoAssinado: assinado, cert });
      campos =
        r.situacao === 'homologada'
          ? { status: 'homologada', cstat: r.cStat, motivo: r.xMotivo, protocolo: r.protocolo, xml: r.procInutNFe, homologadaEm: new Date() }
          : { status: 'rejeitada', cstat: r.cStat, motivo: `${r.cStat} - ${r.xMotivo}`.slice(0, 400) };
    } catch (e: any) {
      // Sem resposta: NÃO se marca como rejeitada (a SEFAZ pode ter homologado). Fica pendente,
      // e um pedido novo para a mesma faixa continua barrado.
      if (e instanceof SefazInalcancavel) {
        await this.db
          .update(fiscalInutilizacao)
          .set({ motivo: `Sem resposta da SEFAZ — situação desconhecida. ${e.message}`.slice(0, 400), updatedAt: new Date() })
          .where(eq(fiscalInutilizacao.id, registro.id));
        throw new ServiceUnavailableException(e.message);
      }
      campos = { status: 'rejeitada', motivo: String(e?.message ?? 'falha').slice(0, 400) };
    }

    const [final] = await this.db
      .update(fiscalInutilizacao)
      .set({ ...campos, updatedAt: new Date() })
      .where(eq(fiscalInutilizacao.id, registro.id))
      .returning();

    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'inutilizou_numeracao',
      entidadeTipo: 'fiscal_inutilizacao', entidadeId: final.id,
      detalhe: { serie, numeroInicial: ini, numeroFinal: fim, status: final.status, motivo: final.motivo, justificativa },
    });
    if (final.status === 'rejeitada') throw new BadRequestException(`Inutilização rejeitada pela SEFAZ: ${final.motivo}`);
    return final;
  }

  /** Histórico dos pedidos de inutilização — é comprovante, fica à mão. */
  async listarInutilizacoes(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(fiscalInutilizacao)
      .where(
        and(
          eq(fiscalInutilizacao.tenantId, tenantId),
          unidadeId ? sql`unidade_id is not distinct from ${unidadeId}` : sql`true`,
        ),
      )
      .orderBy(sql`created_at desc`)
      .limit(100);
  }

  // A nota de teste precisa cair na MESMA sequência das vendas. A série é por estabelecimento, e
  // numa rede de uma loja só a venda carrega a loja: sem isto, a nota de teste (sem loja) teria um
  // contador próprio da série 51 e repetiria números das vendas.
  private async resolverUnidadeEmissao(tenantId: string, unidadeId: string | null): Promise<string | null> {
    if (unidadeId) return unidadeId;
    const r: any = await this.db.execute(
      sql`select id from unidade where tenant_id = ${tenantId} order by created_at limit 2`,
    );
    const lojas = (r.rows ?? r) as { id: string }[];
    if (lojas.length === 1) return lojas[0].id;
    if (!lojas.length) return null;
    throw new BadRequestException('A empresa tem mais de uma loja: escolha em qual emitir a nota de teste.');
  }

  // O CAMINHO DA EMISSÃO, comum à venda e à nota de teste:
  //   pré-voo (tudo que dá para conferir ANTES de gastar número) → reserva o número → monta,
  //   ASSINA e grava como 'pendente' → transmite → grava o resultado.
  // Nunca devolve "autorizada" sem a SEFAZ ter autorizado. Uma falha vem em `falha` (com a nota
  // já gravada com o motivo), para cada chamador decidir se lança ou mostra.
  private async emitirNucleo(p: {
    tenantId: string;
    atorId: string | null;
    unidadeId: string | null;
    comandaId: string | null;
    itens: NfceItem[];
    forma: string | null;
    taxaEntrega: number;
    desconto: number;
    exigirAtivo: boolean;
    pedido: PedidoFiscal | null;
    /**
     * CONTINGÊNCIA OFF-LINE: a nota sai com `tpEmis=9`, é assinada, IMPRESSA e gravada como
     * `contingencia` — sem tocar a SEFAZ. A transmissão vem depois, pelo job, dentro do prazo
     * do primeiro dia útil subsequente.
     */
    contingencia?: { dhCont: Date; xJust: string } | null;
    /** Prazo TOTAL da autorização (só o totem passa — ver `emitir`). */
    prazoAutorizacaoMs?: number;
    /** HTTP 5xx sem SOAP Fault conta como silêncio (só o totem — ver `emitir`). */
    respostaIncertaEhSilencio?: boolean;
  }): Promise<{ nota: any; falha: Error | null; decisao?: DecisaoFiscal; uf?: string | null }> {
    const { tenantId, atorId, unidadeId, comandaId, itens, desconto } = p;

    // PRÉ-VOO ANTES DE RESERVAR O NÚMERO.
    // Número reservado é número gasto: se a emissão falhar depois disso, fica um BURACO na
    // sequência — e buraco não inutilizado até o 10º dia do mês seguinte é presumido pelo
    // Fisco como "documento emitido em contingência e não transmitido" (Ajuste SINIEF
    // 19/16, cl. 11ª, §5º). Então tudo que dá para conferir antes, confere-se antes.
    const cfgRaw = await this.configRaw(tenantId, unidadeId);
    if (!cfgRaw) throw new BadRequestException('Configure o fiscal desta unidade.');
    if (p.exigirAtivo && !cfgRaw.ativo)
      throw new BadRequestException('Emissão fiscal desativada nesta unidade.');
    const credencial = await obterCredencial(this.db, tenantId, unidadeId);
    const qrVersao = qrVersaoNfce(String(cfgRaw.uf ?? ''));
    const cfgPre: any = {
      ...cfgRaw,
      ...credencialParaEmissao(credencial, String(cfgRaw.ambiente ?? '2')),
      qrVersao,
    };
    const faltandoPre = camposFaltando(cfgPre);
    if (faltandoPre.length)
      throw new BadRequestException(`Configuração fiscal incompleta — falta: ${faltandoPre.join(', ')}.`);
    // Como esta operação se declara à SEFAZ: presencial ou entrega a domicílio, com ou sem
    // destinatário, com ou sem intermediador. Fica no PRÉ-VOO porque cada decisão errada aqui é
    // uma rejeição certa — e rejeição descoberta depois da reserva deixa buraco na numeração.
    const vProdPre = itens.reduce((s, it) => s + it.quantidade * it.precoUnitario, 0);
    const valorTotal = vProdPre - Math.min(desconto, vProdPre) + Math.max(0, p.taxaEntrega || 0);
    let decisao: DecisaoFiscal;
    try {
      decisao = decidirEmissao({ pedido: p.pedido, config: cfgPre, taxaEntrega: p.taxaEntrega, valorTotal });
    } catch (e) {
      if (e instanceof EmissaoBloqueada) throw new BadRequestException(e.message);
      throw e;
    }

    // Sem transmissão possível (sem certificado, UF sem autorizador…): recusa aqui.
    const transmissor = this.transmitter(cfgPre);
    // Com certificado, ele é aberto AGORA — senha errada ou chave trocada param aqui, sem número.
    const cert = cfgPre.certRef ? certificadoParaAssinar(credencial) : null;
    // E ele tem de SERVIR: dentro da validade e da mesma empresa. Vencido, a SEFAZ derruba a
    // conexão no aperto de mão TLS e o Node vê isso como rede caída (ECONNRESET) — virava
    // SILÊNCIO, e a venda saía em CONTINGÊNCIA com o QR assinado por um certificado vencido:
    // cupom de uma nota que nunca vai autorizar, com número que não se inutiliza (ERR-099).
    if (cert) {
      const probs = problemasDoCertificado(cert, cfgPre.cnpj);
      if (probs.length)
        throw new BadRequestException(
          `O certificado digital da loja não serve para emitir: ${probs.join(' ')} ` +
            'Cadastre o certificado válido na Configuração fiscal. Nenhuma nota foi emitida.',
        );
    }
    // Na contingência o QR leva uma ASSINATURA feita com o mesmo A1 que assina a nota (Manual do
    // DANFE NFC-e v6.0, §4.4.2) — é ela que prova a autenticidade de um cupom que a SEFAZ ainda
    // não viu. Sem certificado não há QR, e sem QR não há cupom: recusa aqui, antes de gastar
    // número — com classe própria, porque "a SEFAZ calou e não há contingência" não é o mesmo
    // que erro de configuração para quem precisa decidir o que fazer com a venda (o totem).
    if (p.contingencia && (!cert || qrVersao !== 3))
      throw new ContingenciaIndisponivel(
        qrVersao !== 3
          ? 'Contingência off-line exige QR Code versão 3 nesta UF — o QR v2 off-line não está implementado.'
          : 'Contingência off-line exige o certificado A1 da loja para assinar o QR Code.',
      );

    const preparado = await this.db.transaction(async (tx) => {
      const { numero, serie, config } = await this.reservarNumero(tx, tenantId, unidadeId, p.exigirAtivo);
      Object.assign(config, credencialParaEmissao(credencial, String(config.ambiente ?? '2')), { qrVersao });
      const faltando = camposFaltando(config);
      if (faltando.length)
        throw new BadRequestException(`Configuração fiscal incompleta — falta: ${faltando.join(', ')}.`);

      const agora = new Date();
      // Data-hora e competência no fuso da UF do emitente (ver fuso-fiscal.ts).
      const { ano2, mes2 } = competenciaChave(agora, config.uf);
      const dhEmi = dhEmiSefaz(agora, config.uf);
      const cNF = gerarCNF();
      // O tpEmis é o 35º dígito da chave: contingência muda a CHAVE, não só o `ide`.
      const tpEmis = p.contingencia ? 9 : 1;
      const chave = montarChave({
        codigoUf: Number(config.codigoUf), ano2, mes2, cnpj: config.cnpj, modelo: '65',
        serie, numero, tpEmis, cNF,
      });
      const tpAmb = config.ambiente || '2';
      // Contingência: o QR leva dia, valor, destinatário e a assinatura (conferida no pré-voo).
      const { qrCode } = p.contingencia
        ? montarQrCodeV3Offline({
            chave, tpAmb, dhEmi, vNF: valorTotal,
            destDocumento: decisao.dest?.documento ?? null,
            chavePrivadaPem: cert!.chavePrivadaPem,
            urlConsulta: urlConsultaQr(config)!,
          })
        : qrVersao === 3
          ? montarQrCodeV3({ chave, tpAmb, urlConsulta: urlConsultaQr(config)! })
          : montarQrCode({
              chave, tpAmb, cscId: config.cscId, cscToken: config.cscToken, urlConsulta: urlConsultaQr(config)!,
            });
      const xmlSemAssinatura = montarNfceXml({
        config, serie, numero, chave, cNF, dhEmi, itens, forma: p.forma, qrCode, desconto,
        frete: decisao.frete,
        outras: decisao.outras,
        indPres: decisao.indPres,
        dest: decisao.dest,
        transportador: decisao.transportador,
        intermediador: decisao.intermediador,
        // `dhCont` vai no fuso da UF do emitente, como o `dhEmi` — a mesma regra do B28-30
        // (a data de entrada não pode ser maior que a da recepção, com 5 min de tolerância).
        contingencia: p.contingencia
          ? { dhCont: dhEmiSefaz(p.contingencia.dhCont, config.uf), xJust: p.contingencia.xJust }
          : null,
        urlChave: urlConsultaChave(config)!,
        respTec: responsavelTecnico(),
      });
      // Assina ANTES de gravar: o que fica no banco é exatamente o que foi (ou vai ser) enviado.
      const xml = cert ? assinarNfe(xmlSemAssinatura, cert) : xmlSemAssinatura;
      const [nota] = await tx
        .insert(notaFiscal)
        .values({
          tenantId, unidadeId, comandaId, modelo: '65', serie, numero, chave,
          // Contingência nasce como `contingencia` e NUNCA é transmitida na hora: o cupom sai
          // agora, a SEFAZ vem depois. Qualquer outro caso nasce `pendente` até a resposta.
          ambiente: tpAmb, status: p.contingencia ? 'contingencia' : 'pendente', qrcode: qrCode, xml,
          valorTotal: String(valorTotal.toFixed(2)), emitidaPorId: atorId,
          // Como a nota saiu, para a auditoria e para o contador.
          indPres: String(decisao.indPres),
          semDocumentoCliente: decisao.semDocumentoCliente,
        })
        .returning();
      return { nota, config: { ...config, cert }, xml };
    }).catch((e) => {
      // Cadastro fiscal do produto fora das listas (regras-uf): a transação já desfez a reserva
      // do número. Para quem chamou é erro de CADASTRO — 400 com o produto —, não 500 (LIC-023).
      if (e instanceof CadastroFiscalIncompativel) throw new BadRequestException(e.message);
      throw e;
    });

    // EM CONTINGÊNCIA NÃO SE TRANSMITE AGORA: o cupom é impresso e a nota entra na fila. Era
    // exatamente a espera pela SEFAZ que travava o caixa — tentar aqui recriaria o problema.
    if (p.contingencia) {
      await this.auditoria.registrar({
        tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'emitiu_nfce_contingencia',
        entidadeTipo: 'nota_fiscal', entidadeId: preparado.nota.id,
        detalhe: {
          chave: preparado.nota.chave, numero: preparado.nota.numero,
          serie: preparado.nota.serie, dhCont: p.contingencia.dhCont.toISOString(),
        },
      });
      await this.db
        .execute(sql`update fiscal_contingencia set notas_emitidas = notas_emitidas + 1
                      where id = ${this.idContingencia(tenantId, unidadeId)}::uuid`)
        .catch(() => { /* o contador é informativo; não pode derrubar a venda */ });
      return { nota: preparado.nota, falha: null, decisao, uf: cfgRaw.uf ?? null };
    }

    // Transmite (fora da transação — a SEFAZ pode demorar e não se segura trava esperando rede).
    let falha: Error | null = null;
    let atualizacao: Record<string, unknown>;
    try {
      const ret = await transmissor.autorizar(
        preparado.xml,
        preparado.nota.chave ?? '',
        p.prazoAutorizacaoMs ? { ...preparado.config, prazoAutorizacaoMs: p.prazoAutorizacaoMs } : preparado.config,
      );
      // Aviso da SEFAZ ao emissor (grupo cMsg/xMsg). Vem junto da AUTORIZAÇÃO — é o caso do
      // `cStat 120` — e some se ninguém o ler. Entra no motivo (que é o campo que o lojista vê
      // na tela da nota) e sai no log, porque nota autorizada ninguém vai conferir depois.
      if (ret.mensagem)
        this.log.warn(
          `SEFAZ avisou na nota ${preparado.nota.numero}/${preparado.nota.serie} ` +
            `(cMsg ${ret.mensagem.codigo}): ${ret.mensagem.texto}`,
        );
      const motivoComAviso = ret.mensagem
        ? `${ret.motivo} · Aviso da SEFAZ (${ret.mensagem.codigo}): ${ret.mensagem.texto}`.slice(0, 400)
        : ret.motivo;
      atualizacao = {
        status: ret.status,
        simulada: !!ret.simulado,
        protocolo: ret.protocolo ?? null,
        motivo: motivoComAviso,
        cstat: ret.cStat ?? null,
        xml: ret.xmlAutorizado ?? preparado.xml,
        emitidaEm: ret.status === 'autorizada' ? new Date() : null,
      };
      if (ret.status === 'rejeitada') falha = new BadRequestException(`NFC-e rejeitada pela SEFAZ: ${ret.motivo}`);
      // DENEGADA: a SEFAZ registrou a nota como negada. A venda não tem documento fiscal E o
      // número está consumido — não se reaproveita nem se inutiliza. Gravar isto como
      // "rejeitada" faria o número aparecer como lacuna, e o lojista pediria à SEFAZ a
      // inutilização de uma numeração que ela já tem (ver ERR-094).
      if (ret.status === 'denegada')
        falha = new BadRequestException(
          `NFC-e DENEGADA pela SEFAZ: ${ret.motivo}. O número ${preparado.nota.numero} da série ` +
            `${preparado.nota.serie} fica consumido — regularize a situação fiscal da loja antes de emitir de novo.`,
        );
      if (ret.status === 'pendente')
        falha = new ServiceUnavailableException(`A SEFAZ recebeu a NFC-e e ainda não decidiu: ${ret.motivo}`);
    } catch (e: any) {
      // HTTP 5xx SEM SOAP Fault (gateway, balanceador): a SEFAZ pode ter processado a nota antes
      // de a resposta se perder. Para o totem — que desfaz a venda quando ouve "não emitida" —
      // isso é silêncio, não recusa. Os outros caminhos seguem como sempre (ver `emitir`).
      const incerta =
        p.respostaIncertaEhSilencio && e instanceof SefazRecusouChamada && Number(e.status ?? 0) >= 500;
      if (e instanceof SefazInalcancavel || incerta) {
        // Enviada e sem resposta: pode ter sido autorizada ou não. Fica 'pendente' — e a venda
        // não pode emitir de novo às cegas (ver `emitir`).
        atualizacao = { status: 'pendente', motivo: `Sem resposta da SEFAZ — situação desconhecida. ${e.message}`.slice(0, 400) };
        falha = new ServiceUnavailableException(e.message);
      } else {
        // A SEFAZ recusou a CHAMADA (ou erro antes do envio): a nota não foi processada.
        atualizacao = { status: 'rejeitada', motivo: String(e?.message ?? 'falha').slice(0, 400) };
        falha =
          e instanceof SefazRecusouChamada
            ? new BadGatewayException(e.message)
            : new BadRequestException(e?.message ?? 'Falha na transmissão fiscal.');
      }
    }
    const [nota] = await this.db
      .update(notaFiscal)
      .set(atualizacao)
      .where(eq(notaFiscal.id, preparado.nota.id))
      .returning();

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: comandaId ? 'emitiu_nfce' : 'emitiu_nfce_teste',
      entidadeTipo: 'nota_fiscal',
      entidadeId: nota.id,
      detalhe: { chave: nota.chave, status: nota.status, numero: nota.numero, serie: nota.serie, motivo: nota.motivo },
    });
    return { nota, falha, decisao, uf: cfgRaw.uf ?? null };
  }

  /**
   * O pedido de canal da comanda, do jeito que a NFC-e precisa dele: taxa de entrega, desconto
   * e quem é o destinatário. A linha vem como JSON (`to_jsonb`) porque numa loja com o edge
   * desatualizado as colunas novas não existem — e é melhor ler o que existe do que a consulta
   * inteira falhar e a nota sair sem valor nenhum.
   *
   * O `merchant_id` da integração do canal é a identificação da LOJA no app do intermediador
   * (`idCadIntTran` do grupo infIntermed). Vem de `integracao`, não do pedido.
   */
  private async dadosFiscaisDoPedido(tenantId: string, comandaId: string) {
    const vazio = { taxaEntrega: 0, desconto: 0, pedido: null as PedidoFiscal | null };
    try {
      const r: any = await this.db.execute(sql`
        select to_jsonb(pe) as pedido,
               (select i.merchant_id from integracao i
                 where i.tenant_id = pe.tenant_id and i.canal = pe.canal
                   and (i.unidade_id = pe.unidade_id or i.unidade_id is null)
                 order by i.unidade_id nulls last limit 1) as merchant_id
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid and pe.comanda_id = ${comandaId}::uuid
           and pe.status not in ('cancelado')
         limit 1`);
      const row = (r.rows ?? r)[0];
      if (!row?.pedido) return vazio;
      const { taxaEntrega, desconto } = valoresFiscaisDoPedido(row.pedido);
      const pedido = pedidoFiscalDeJson(row.pedido, row.merchant_id);
      // CPF guardado no cadastro do cliente: quem já pediu nota uma vez não digita de novo.
      if (pedido && !documentoUtilizavel(pedido.documentoCliente) && row.pedido.cliente_id) {
        const c: any = await this.db.execute(sql`
          select cpf from cliente where id = ${row.pedido.cliente_id}::uuid and tenant_id = ${tenantId}::uuid limit 1`);
        pedido.documentoCliente = (c.rows ?? c)[0]?.cpf ?? null;
      }
      return { taxaEntrega, desconto, pedido };
    } catch (e: any) {
      // Nunca deixar a nota parar de sair por causa desta leitura — mas dizer por quê, senão a
      // nota sai muda, sem taxa e sem destinatário, e ninguém descobre o motivo (ERR-072).
      this.log.warn(`Pedido da comanda ${comandaId} não pôde ser lido para a NFC-e: ${e?.message ?? e}`);
      return vazio;
    }
  }

  // Emite só se o fiscal estiver ativo na unidade (chamado automaticamente pela
  // venda). Nunca derruba a venda: erros viram nota rejeitada + log.
  async emitirSeAtivo(
    tenantId: string,
    atorId: string | null,
    comandaId: string,
    unidadeId?: string | null,
    opts: { imprimirNaLoja?: boolean; terminalId?: string | null } = {},
  ) {
    const cfg = await this.configRaw(tenantId, unidadeId ?? null);
    if (!cfg?.ativo) return null;
    // Terminal marcado para NÃO emitir (presidente/gerência decide, mig 288): a venda segue
    // com o comprovante "CUPOM NAO FISCAL". Numa troca de sistema é assim que a loja opera — um
    // caixa emitindo pelo sistema antigo, outro pelo novo — sem a mesma venda sair duas vezes.
    if (opts.terminalId && (await this.terminalNaoEmite(tenantId, opts.terminalId))) return null;
    try {
      return await this.emitir(tenantId, atorId, comandaId, opts);
    } catch {
      return null; // já registra nota 'rejeitada' internamente quando aplicável
    }
  }

  // ===== A NOTA DA VENDA DO TOTEM =====
  //
  // O `emitirSeAtivo` acima é de quem NÃO pode travar a venda por causa do fiscal (PDV, balcão,
  // delivery): falhou, devolve `null` e a venda segue. O totem é o contrário — a compra só termina
  // com o cupom fiscal na mão do cliente — e precisa saber COMO falhou para estornar o pagamento.
  // O contrato está em `nfce-totem.ts`.

  /** Deste aparelho sai NFC-e? Fiscal ativo na loja E o terminal não foi desmarcado (mig 288). */
  async totemEmiteNfce(tenantId: string, unidadeId: string | null, terminalId?: string | null): Promise<boolean> {
    const cfg = await this.configRaw(tenantId, unidadeId ?? null);
    if (!cfg?.ativo) return false;
    return !(terminalId && (await this.terminalNaoEmite(tenantId, terminalId)));
  }

  /**
   * Emite a NFC-e da venda do totem e diz, no contrato do totem, o que aconteceu. Nunca lança:
   * a resposta é sempre um dos quatro casos (`null`, autorizada, contingência, não emitida).
   *
   * A autorização tem prazo TOTAL de `PRAZO_AUTORIZACAO_TOTEM_MS`: estourou, é silêncio e entra
   * a contingência que já existe. Se nem ela sai, a nota que foi à SEFAZ sem resposta fica
   * marcada para ser CANCELADA caso apareça autorizada — a venda vai ser desfeita, e documento
   * válido de venda desfeita é o que não pode sobrar.
   */
  async emitirParaTotem(
    tenantId: string,
    comandaId: string,
    unidadeId: string | null,
    terminalId?: string | null,
  ): Promise<{ nfce: NfceDoTotem; erro?: ErroNfceTotem }> {
    let cfg: any;
    try {
      cfg = await this.configRaw(tenantId, unidadeId ?? null);
      if (!cfg?.ativo) return { nfce: null };
      if (terminalId && (await this.terminalNaoEmite(tenantId, terminalId))) return { nfce: null };
    } catch (e: any) {
      // Nem a configuração deu para ler: sem saber se a loja emite, não se promete cupom fiscal.
      const erro = classificarFalhaNfce(e);
      this.log.error(`NFC-e do totem (comanda ${comandaId}) — configuração ilegível: ${erro.motivo}`);
      return { nfce: nfceNaoEmitida(erro), erro };
    }
    try {
      const nota: any = await this.emitir(tenantId, null, comandaId, {
        imprimirNaLoja: false, // quem imprime é o totem (K6)
        prazoAutorizacaoMs: PRAZO_AUTORIZACAO_TOTEM_MS,
        pendenteViraContingencia: true,
        respostaIncertaEhSilencio: true,
      });
      if (nota?.status !== 'autorizada' && nota?.status !== 'contingencia')
        throw new Error(`A emissão terminou sem documento (status ${nota?.status ?? 'desconhecido'}).`);
      if (!nota.danfeTexto) nota.danfeTexto = await this.danfeDaNotaGravada(tenantId, nota, cfg?.uf ?? null);
      return { nfce: nfceEmitidaParaTotem(nota, this.viaEstabelecimentoNaConfig(cfg)) };
    } catch (e: any) {
      const erro = classificarFalhaNfce(e);
      // V11: o motivo real fica no log da loja — o totem leva a mesma frase para o relatório.
      this.log.warn(
        `NFC-e do totem não emitida (comanda ${comandaId}): ${erro.etapa}` +
          `${erro.codigo ? ` ${erro.codigo}` : ''} — ${erro.motivo}`,
      );
      if (erro.etapa === 'sem_contingencia') {
        const n = (e as any)?.nota;
        if (n?.id)
          await this.agendarCancelamentoDaNota(tenantId, n.id, JUSTIFICATIVA_VENDA_DESFEITA).catch((x) =>
            this.log.error(`nota ${n.id} sem resposta e sem cancelamento agendado: ${x?.message ?? x}`),
          );
      }
      return { nfce: nfceNaoEmitida(erro), erro };
    }
  }

  /**
   * A nota que vale da venda, remontada para o totem — é o que a REPETIÇÃO da liberação devolve
   * quando a primeira resposta se perdeu na rede. O DANFE é remontado pela mesma montagem da
   * emissão (ver `danfeDaNotaGravada`): é o mesmo papel que teria saído na primeira vez.
   */
  async nfceDaComandaParaTotem(tenantId: string, comandaId: string): Promise<NfceEmitidaTotem | null> {
    const [nota] = await this.db
      .select()
      .from(notaFiscal)
      .where(
        and(
          eq(notaFiscal.tenantId, tenantId),
          eq(notaFiscal.comandaId, comandaId),
          inArray(notaFiscal.status, ['autorizada', 'contingencia']),
        ),
      )
      .orderBy(sql`created_at desc`)
      .limit(1);
    if (!nota) return null;
    const cfg: any = await this.configRaw(tenantId, nota.unidadeId ?? null);
    (nota as any).danfeTexto = await this.danfeDaNotaGravada(tenantId, nota, cfg?.uf ?? null);
    return nfceEmitidaParaTotem(nota, this.viaEstabelecimentoNaConfig(cfg));
  }

  private viaEstabelecimentoNaConfig(cfg: any): boolean {
    return cfg?.contingenciaViaEstabelecimento === true || cfg?.contingencia_via_estabelecimento === true;
  }

  /**
   * O DANFE de uma nota JÁ GRAVADA, para a repetição do totem: tem de sair IGUAL ao da primeira
   * vez, então é montado do mesmo jeito — itens da comanda pela mesma função da emissão, frete e
   * desconto do pedido. (Do XML sairia diferente em homologação: lá o 1º item leva o texto
   * obrigatório "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO".) O consumidor vem do XML — é o
   * que foi declarado à SEFAZ. Se a venda não der para remontar (comanda apagada, cadastro
   * mudado), o XML é a reserva: o totem não pode ficar sem o cupom.
   */
  private async danfeDaNotaGravada(tenantId: string, nota: any, uf: string | null): Promise<string> {
    const doc = new DOMParser().parseFromString(String(nota?.xml ?? ''), 'text/xml');
    const dest = doc.getElementsByTagNameNS('*', 'dest')[0] ?? null;
    const consumidor = dest ? (textoXml(dest, 'CPF') ?? textoXml(dest, 'CNPJ')) : null;
    try {
      const [c] = await this.db
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, nota.comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new Error('comanda da nota não encontrada');
      const itens = await this.itensFiscaisDaComanda(tenantId, c);
      const { taxaEntrega, desconto } = await this.dadosFiscaisDoPedido(tenantId, c.id);
      return montarDanfeTexto(nota, itens, { frete: taxaEntrega, desconto, consumidor, uf });
    } catch (e: any) {
      this.log.warn(`DANFE da NFC-e ${nota?.numero}/${nota?.serie} remontado pelo XML: ${e?.message ?? e}`);
      return this.danfeDoXml(nota, uf);
    }
  }

  /** O DANFE lido só do XML: itens, frete (ou a taxa em `vOutro`), desconto e destinatário. */
  private danfeDoXml(nota: any, uf: string | null): string {
    const doc = new DOMParser().parseFromString(String(nota?.xml ?? ''), 'text/xml');
    const dets = doc.getElementsByTagNameNS('*', 'det');
    const itens: DanfeItem[] = [];
    for (let i = 0; i < dets.length; i++) {
      itens.push({
        descricao: textoXml(dets[i], 'xProd') ?? '',
        quantidade: Number(textoXml(dets[i], 'qCom') ?? 0),
        precoUnitario: Number(textoXml(dets[i], 'vUnCom') ?? 0),
      });
    }
    const tot = doc.getElementsByTagNameNS('*', 'ICMSTot')[0] ?? null;
    const dest = doc.getElementsByTagNameNS('*', 'dest')[0] ?? null;
    return montarDanfeTexto(nota, itens, {
      frete: Number(textoXml(tot, 'vFrete') ?? 0) + Number(textoXml(tot, 'vOutro') ?? 0),
      desconto: Number(textoXml(tot, 'vDesc') ?? 0),
      consumidor: dest ? (textoXml(dest, 'CPF') ?? textoXml(dest, 'CNPJ')) : null,
      uf,
    });
  }

  /**
   * CANCELAMENTO COMUM da NFC-e (evento 110111) — venda errada, desistência, item trocado.
   *
   * O prazo é de 30 minutos da autorização (Ajuste SINIEF 19/16, cl. 15ª — teto nacional, que a
   * UF pode reduzir). Conferimos ANTES de enviar: fora dele a SEFAZ devolve 501 e a explicação ao
   * lojista seria pior. O evento é gravado antes do envio (se a resposta se perder, fica o registro
   * de que saiu), e a nota só vira `cancelada` quando a SEFAZ REGISTRA o evento — nunca por
   * otimismo, senão o nosso banco diverge do que o Fisco tem.
   */
  async cancelar(
    tenantId: string,
    atorId: string | null,
    notaId: string,
    justificativa: string,
    opts: { prazoMs?: number } = {},
  ) {
    const just = String(justificativa ?? '').trim();
    if (just.length < 15 || just.length > 255)
      throw new BadRequestException('A justificativa precisa ter de 15 a 255 caracteres.');
    const [nota] = await this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, notaId), eq(notaFiscal.tenantId, tenantId)));
    if (!nota) throw new NotFoundException('Nota não encontrada');
    if (nota.status !== 'autorizada')
      throw new BadRequestException('Só se cancela nota autorizada.');

    // Nota SIMULADA nunca passou pela SEFAZ: não há o que cancelar lá. Segue o transmissor
    // simulado, que só existe em homologação com FISCAL_SIMULADO ligado.
    if (nota.simulada) {
      const row = await this.cancelarSimulada(tenantId, atorId, nota, just);
      await this.fecharCancelamentoAgendado(nota, 'dispensado', 'Nota simulada: cancelada no transmissor simulado.');
      return row;
    }

    if (!nota.chave || !nota.protocolo)
      throw new BadRequestException('A nota não tem chave e protocolo — nada a cancelar na SEFAZ.');

    const autorizadaEm = nota.emitidaEm ? new Date(nota.emitidaEm) : new Date(nota.createdAt);
    const minutos = (Date.now() - autorizadaEm.getTime()) / 60_000;
    if (minutos > PRAZO_CANCELAMENTO_MINUTOS) {
      const msg =
        `O cancelamento da NFC-e vale até ${PRAZO_CANCELAMENTO_MINUTOS} minutos da autorização, e já se ` +
        `passaram ${Math.floor(minutos)}. A SEFAZ recusaria (501). Fora do prazo o caminho é da própria ` +
        'SEFAZ — no RJ, o Sistema de Reabertura de Prazo para Cancelamento, e só se a mercadoria não saiu.';
      // Pedido agendado que perdeu o prazo sai da fila com o motivo à vista — senão ficaria
      // "aguardando" para sempre e ninguém saberia que a nota continua valendo.
      await this.fecharCancelamentoAgendado(nota, 'rejeitado', msg);
      throw new BadRequestException(msg);
    }

    // Os pedidos de cancelamento desta nota que já existem. O índice único (mig 284) só aceita
    // um vivo por nota: o AGENDADO é aproveitado; o PENDENTE (enviado e sem resposta) não se
    // repete às cegas — se o primeiro foi registrado, a SEFAZ responderia duplicidade. Quem
    // resolve o pendente é a CONSULTA, e o job faz isso sozinho, no ritmo que a SEFAZ permite.
    const eventos = await this.db
      .select()
      .from(fiscalEvento)
      .where(
        and(
          eq(fiscalEvento.tenantId, tenantId),
          eq(fiscalEvento.chave, nota.chave),
          eq(fiscalEvento.tpEvento, TP_EVENTO_CANCELAMENTO),
          sql`status <> 'rejeitado'`,
        ),
      );
    const jaRegistrado = eventos.find((e) => e.status === 'registrado');
    if (jaRegistrado) {
      // A SEFAZ já registrou o cancelamento; só o nosso status ficou para trás.
      const [row] = await this.db
        .update(notaFiscal)
        .set({
          status: 'cancelada', canceladaEm: jaRegistrado.registradoEm ?? new Date(),
          justificativaCancelamento: jaRegistrado.justificativa ?? just,
          motivo: `${jaRegistrado.cstat ?? ''} - ${jaRegistrado.motivo ?? 'Cancelamento registrado'}`.slice(0, 400),
        })
        .where(and(eq(notaFiscal.id, nota.id), eq(notaFiscal.status, 'autorizada')))
        .returning();
      return row ?? nota;
    }
    if (eventos.some((e) => e.status === 'pendente'))
      throw new ServiceUnavailableException(
        'Já existe um pedido de cancelamento desta nota sem resposta da SEFAZ. O sistema confere a ' +
          'situação sozinho em alguns minutos — não é preciso pedir de novo.',
      );

    const cfg: any = await this.configRaw(tenantId, nota.unidadeId);
    if (!cfg) throw new BadRequestException('Configure o fiscal desta unidade.');
    const cert = certificadoParaAssinar(await obterCredencial(this.db, tenantId, nota.unidadeId));
    // Certificado vencido não conversa com a SEFAZ (o TLS cai e parece rede — ver ERR-099):
    // dizer isso agora é melhor que um "a SEFAZ não respondeu" que não é verdade.
    const probsCert = problemasDoCertificado(cert, cfg.cnpj);
    if (probsCert.length)
      throw new BadRequestException(
        `O certificado digital da loja não serve para cancelar: ${probsCert.join(' ')} Cadastre o certificado válido.`,
      );
    const ambiente = String(nota.ambiente ?? cfg.ambiente ?? '2');

    const evento = montarEventoCancelamento({
      ambiente,
      codigoUf: cfg.codigoUf,
      cnpj: cfg.cnpj,
      chave: nota.chave,
      protocolo: nota.protocolo,
      justificativa: just,
      // Mesma regra do dhEmi: hora do fuso da UF do emitente, nunca UTC.
      dhEvento: dhEmiSefaz(new Date(), cfg.uf),
    });
    const assinado = assinarEvento(evento, cert);

    // Grava ANTES de enviar: se a resposta se perder, fica o registro de que o pedido saiu.
    const emAndamento = () =>
      new ServiceUnavailableException('O cancelamento desta nota já está em andamento. Aguarde a resposta da SEFAZ.');
    const agendado = eventos.find((e) => e.status === 'agendado' || e.status === 'dispensado');
    let registro: any;
    if (agendado) {
      [registro] = await this.db
        .update(fiscalEvento)
        .set({
          status: 'pendente', justificativa: just, ambiente, xml: assinado,
          solicitadoPorId: atorId ?? agendado.solicitadoPorId ?? null, motivo: null, updatedAt: new Date(),
        })
        .where(and(eq(fiscalEvento.id, agendado.id), eq(fiscalEvento.status, agendado.status)))
        .returning();
      if (!registro) throw emAndamento(); // outro processo pegou o mesmo pedido agora
    } else {
      try {
        [registro] = await this.db
          .insert(fiscalEvento)
          .values({
            tenantId, unidadeId: nota.unidadeId, notaId: nota.id, chave: nota.chave,
            tpEvento: TP_EVENTO_CANCELAMENTO, nSeq: 1, justificativa: just,
            status: 'pendente', ambiente, xml: assinado, solicitadoPorId: atorId,
          })
          .returning();
      } catch (e: any) {
        if (e?.code === '23505') throw emAndamento();
        throw e;
      }
    }

    let campos: Record<string, unknown>;
    try {
      const r = await enviarEvento({ uf: cfg.uf, ambiente, eventoAssinado: assinado, cert, prazoMs: opts.prazoMs });
      campos =
        r.situacao === 'registrado'
          ? { status: 'registrado', cstat: r.cStat, motivo: r.xMotivo, protocolo: r.protocolo, xml: r.procEventoNFe, registradoEm: new Date() }
          : { status: 'rejeitado', cstat: r.cStat, motivo: `${r.cStat} - ${r.xMotivo}`.slice(0, 400) };
    } catch (e: any) {
      if (e instanceof SefazInalcancavel) {
        // Sem resposta: o cancelamento PODE ter sido registrado. Quem responde é a CONSULTA da
        // nota (101/135/155 = cancelada) — o job `rodarCancelamentosAgendados` faz isso sozinho.
        await this.db
          .update(fiscalEvento)
          .set({ motivo: `Sem resposta da SEFAZ — situação desconhecida. ${e.message}`.slice(0, 400), updatedAt: new Date() })
          .where(eq(fiscalEvento.id, registro.id));
        throw new ServiceUnavailableException(
          `A SEFAZ não respondeu ao cancelamento. O sistema confere a nota sozinho em alguns minutos. ${e.message}`,
        );
      }
      campos = { status: 'rejeitado', motivo: String(e?.message ?? 'falha').slice(0, 400) };
    }

    const [final] = await this.db
      .update(fiscalEvento)
      .set({ ...campos, updatedAt: new Date() })
      .where(eq(fiscalEvento.id, registro.id))
      .returning();

    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'cancelou_nfce',
      entidadeTipo: 'nota_fiscal', entidadeId: nota.id,
      detalhe: { chave: nota.chave, evento: final.status, cstat: final.cstat, justificativa: just },
    });

    if (final.status !== 'registrado')
      throw new BadRequestException(`Cancelamento recusado pela SEFAZ: ${final.motivo}`);

    const [row] = await this.db
      .update(notaFiscal)
      .set({
        status: 'cancelada',
        canceladaEm: new Date(),
        canceladaPorId: atorId,
        justificativaCancelamento: just,
        motivo: `${final.cstat} - ${final.motivo}`.slice(0, 400),
      })
      .where(and(eq(notaFiscal.id, nota.id), eq(notaFiscal.status, 'autorizada')))
      .returning();
    return row;
  }

  /** Nota simulada: cancela pelo transmissor simulado (só existe em homologação). */
  private async cancelarSimulada(tenantId: string, atorId: string | null, nota: any, just: string) {
    const config = await this.configRaw(tenantId, nota.unidadeId);
    let ret;
    try {
      ret = await this.transmitter(config).cancelar(nota.chave!, nota.protocolo!, just, config);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Falha ao cancelar.');
    }
    if (ret.status !== 'cancelada')
      throw new BadRequestException(ret.motivo || 'Cancelamento rejeitado.');
    const [row] = await this.db
      .update(notaFiscal)
      .set({
        status: 'cancelada', canceladaEm: new Date(), canceladaPorId: atorId,
        justificativaCancelamento: just, motivo: ret.motivo,
      })
      .where(eq(notaFiscal.id, nota.id))
      .returning();
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil: '', tipo: 'fiscal', acao: 'cancelou_nfce_simulada',
      entidadeTipo: 'nota_fiscal', entidadeId: nota.id, detalhe: { chave: nota.chave, justificativa: just },
    });
    return row;
  }

  // ===== CANCELAMENTO AGENDADO — a venda foi desfeita, a nota não pode continuar valendo =====
  //
  // Caso do totem: o DANFE não saiu no papel (ou a nota ficou sem resposta e a venda foi
  // desfeita), o cliente recebe o dinheiro de volta — e documento fiscal de venda desfeita não
  // pode sobrar. Autorizada, cancela-se já (110111, 30 min). Mas duas não se cancelam AGORA:
  //  • a de CONTINGÊNCIA ainda não foi autorizada e NÃO pode ser inutilizada (Ajuste SINIEF 19/16,
  //    cl. 11ª, §2º, II) — cancela-se assim que a fila da contingência a autorizar;
  //  • a PENDENTE (foi à SEFAZ sem resposta) — cancela-se se a consulta a achar autorizada.
  //
  // O pedido fica em `fiscal_evento` com status `agendado` (sem migration: o status é texto, e o
  // índice único da mig 284 só aceita um pedido vivo por nota — o agendado é PROMOVIDO a
  // pendente no envio, nunca duplicado). Estados do pedido: agendado → pendente → registrado |
  // rejeitado; `dispensado` = não precisou sair (a nota nunca valeu, ou já estava cancelada).

  /** Agenda o cancelamento de UMA nota. Idempotente: se já há pedido vivo, não cria outro. */
  async agendarCancelamentoDaNota(tenantId: string, notaId: string, justificativa: string): Promise<string | null> {
    const [n] = await this.db
      .select()
      .from(notaFiscal)
      .where(and(eq(notaFiscal.id, notaId), eq(notaFiscal.tenantId, tenantId)));
    if (!n?.chave) return null;
    // Cancelada já está; denegada e rejeitada de verdade nunca valeram. Só a rejeitada por "não
    // consta" (217) ainda pode aparecer autorizada — é vigiada por 168 h (ver `reconciliarPendentes`).
    if (n.status === 'cancelada' || n.status === 'denegada') return null;
    if (n.status === 'rejeitada' && n.cstat !== '217') return null;
    const r: any = await this.db.execute(sql`
      insert into fiscal_evento (tenant_id, unidade_id, nota_id, chave, tp_evento, n_seq, justificativa, status, ambiente)
      select ${tenantId}::uuid, ${n.unidadeId ?? null}::uuid, ${n.id}::uuid, ${n.chave}, ${TP_EVENTO_CANCELAMENTO},
             1, ${justificativa}, 'agendado', ${String(n.ambiente ?? '2')}
       where not exists (
         select 1 from fiscal_evento e
          where e.tenant_id = ${tenantId}::uuid and e.chave = ${n.chave}
            and e.tp_evento = ${TP_EVENTO_CANCELAMENTO} and e.status <> 'rejeitado')
      on conflict do nothing
      returning id`);
    const id = ((r.rows ?? r)[0]?.id as string | undefined) ?? null;
    if (id)
      await this.auditoria.registrar({
        tenantId, atorId: null, atorPerfil: 'servico', tipo: 'fiscal', acao: 'agendou_cancelamento_nfce',
        entidadeTipo: 'nota_fiscal', entidadeId: n.id,
        detalhe: { chave: n.chave, numero: n.numero, serie: n.serie, status: n.status, justificativa },
      });
    return id;
  }

  /**
   * Agenda o cancelamento de TODAS as notas da venda que valem (ou podem vir a valer). Vem ANTES
   * de desfazer a venda: se o processo cair no meio, o pedido já está gravado e o job o executa.
   */
  async agendarCancelamentosDaVenda(tenantId: string, comandaId: string, justificativa: string) {
    const notas = await this.db
      .select({ id: notaFiscal.id })
      .from(notaFiscal)
      .where(and(eq(notaFiscal.tenantId, tenantId), eq(notaFiscal.comandaId, comandaId)));
    for (const n of notas) await this.agendarCancelamentoDaNota(tenantId, n.id, justificativa);
    return notas.length;
  }

  /**
   * Venda desfeita: agenda (de novo, sem duplicar) e cancela JÁ as notas autorizadas. As de
   * contingência e as pendentes ficam agendadas para quando forem autorizadas. Devolve o que
   * aconteceu, no contrato do totem.
   */
  async cancelarNotasDaVendaDesfeita(
    tenantId: string,
    comandaId: string,
    justificativa: string,
    opts: { prazoMs?: number } = {},
  ): Promise<{ notaCancelada: boolean; cancelamentoPendente: boolean }> {
    await this.agendarCancelamentosDaVenda(tenantId, comandaId, justificativa);
    const autorizadas = await this.db
      .select({ id: notaFiscal.id })
      .from(notaFiscal)
      .where(
        and(
          eq(notaFiscal.tenantId, tenantId),
          eq(notaFiscal.comandaId, comandaId),
          eq(notaFiscal.status, 'autorizada'),
        ),
      );
    for (const n of autorizadas)
      await this.executarCancelamentosAgendados({ notaId: n.id, prazoMs: opts.prazoMs });
    return this.situacaoCancelamentoDaVenda(tenantId, comandaId);
  }

  /** Alguma nota da venda foi cancelada? Há cancelamento ainda por sair (agendado ou sem resposta)? */
  async situacaoCancelamentoDaVenda(
    tenantId: string,
    comandaId: string,
  ): Promise<{ notaCancelada: boolean; cancelamentoPendente: boolean }> {
    const r: any = await this.db.execute(sql`
      select
        exists (select 1 from nota_fiscal n
                 where n.tenant_id = ${tenantId}::uuid and n.comanda_id = ${comandaId}::uuid
                   and n.status = 'cancelada') as cancelada,
        exists (select 1 from fiscal_evento e
                  join nota_fiscal n on n.id = e.nota_id and n.tenant_id = e.tenant_id
                 where n.tenant_id = ${tenantId}::uuid and n.comanda_id = ${comandaId}::uuid
                   and e.tp_evento = ${TP_EVENTO_CANCELAMENTO}
                   and e.status in ('agendado', 'pendente')) as pendente`);
    const l = (r.rows ?? r)[0] ?? {};
    return { notaCancelada: l.cancelada === true, cancelamentoPendente: l.pendente === true };
  }

  /** Fecha o pedido AGENDADO de uma nota sem enviá-lo (não precisou, ou perdeu o prazo). */
  private async fecharCancelamentoAgendado(nota: any, status: 'dispensado' | 'rejeitado', motivo: string) {
    if (!nota?.chave) return;
    await this.db
      .update(fiscalEvento)
      .set({ status, motivo: motivo.slice(0, 400), updatedAt: new Date() })
      .where(
        and(
          eq(fiscalEvento.tenantId, nota.tenantId ?? nota.tenant_id),
          eq(fiscalEvento.chave, nota.chave),
          eq(fiscalEvento.tpEvento, TP_EVENTO_CANCELAMENTO),
          eq(fiscalEvento.status, 'agendado'),
        ),
      )
      .catch((e: any) => this.log.warn(`pedido agendado da nota ${nota.id} não foi fechado: ${e?.message ?? e}`));
  }

  /**
   * Executa os cancelamentos AGENDADOS cujas notas já podem ser canceladas. Só os das notas
   * DESTA instalação (a série diz a origem): a loja cancela as dela, a nuvem as dela.
   */
  async executarCancelamentosAgendados(opts: { notaId?: string; limite?: number; prazoMs?: number } = {}) {
    const origem = this.origemEmissao();
    const r: any = await this.db.execute(sql`
      select e.id as evento_id, e.justificativa as evento_justificativa, n.*
        from fiscal_evento e
        join nota_fiscal n on n.id = e.nota_id and n.tenant_id = e.tenant_id
        join fiscal_serie s
          on s.tenant_id = n.tenant_id
         and s.unidade_id is not distinct from n.unidade_id
         and s.serie = n.serie
         and s.origem = ${origem}
       where e.tp_evento = ${TP_EVENTO_CANCELAMENTO} and e.status = 'agendado'
         and ${opts.notaId ? sql`n.id = ${opts.notaId}::uuid` : sql`true`}
       order by e.created_at
       limit ${opts.limite ?? 20}`);
    const linhas = (r.rows ?? r) as any[];
    const resultado = { cancelados: 0, aguardando: 0, dispensados: 0, falhas: 0 };
    for (const l of linhas) {
      const nota = { ...l, tenantId: l.tenant_id, unidadeId: l.unidade_id };
      const idadeH = (Date.now() - new Date(l.created_at).getTime()) / 3_600_000;
      try {
        if (l.status === 'cancelada') {
          await this.fecharCancelamentoAgendado(nota, 'dispensado', 'A nota já estava cancelada.');
          resultado.dispensados++;
        } else if (
          l.status === 'contingencia' ||
          l.status === 'pendente' ||
          (l.status === 'rejeitada' && l.cstat === '217' && idadeH < 168)
        ) {
          resultado.aguardando++; // ainda não é documento — o pedido espera a autorização
        } else if (l.status !== 'autorizada') {
          await this.fecharCancelamentoAgendado(
            nota, 'dispensado', `A nota não foi autorizada (${l.status}) — não há documento a cancelar.`,
          );
          resultado.dispensados++;
        } else {
          await this.cancelar(l.tenant_id, null, l.id, l.evento_justificativa ?? JUSTIFICATIVA_VENDA_DESFEITA, {
            prazoMs: opts.prazoMs,
          });
          resultado.cancelados++;
        }
      } catch (e: any) {
        // Sem resposta, recusa ou prazo vencido: o motivo fica no pedido (e no log), e o laço
        // segue — uma nota com problema não pode impedir o cancelamento das outras.
        resultado.falhas++;
        this.log.warn(`cancelamento agendado da NFC-e ${l.numero}/${l.serie} não saiu: ${e?.message ?? e}`);
      }
    }
    return resultado;
  }

  /**
   * Pedidos de cancelamento ENVIADOS e sem resposta: a consulta da nota diz se o evento foi
   * registrado (a nota aparece cancelada) ou não (segue autorizada → o pedido volta a ser
   * agendado e sai de novo, se ainda houver prazo). Uma consulta por pedido a cada 6 minutos, no
   * máximo: a SEFAZ bloqueia quem consulta a mesma nota mais de 10 vezes por hora (rejeição 656).
   */
  private async resolverCancelamentosSemResposta(limite = 10) {
    const origem = this.origemEmissao();
    const r: any = await this.db.execute(sql`
      select e.id as evento_id, e.justificativa as evento_justificativa, n.*
        from fiscal_evento e
        join nota_fiscal n on n.id = e.nota_id and n.tenant_id = e.tenant_id
        join fiscal_serie s
          on s.tenant_id = n.tenant_id
         and s.unidade_id is not distinct from n.unidade_id
         and s.serie = n.serie
         and s.origem = ${origem}
       where e.tp_evento = ${TP_EVENTO_CANCELAMENTO} and e.status = 'pendente'
         and e.updated_at < now() - interval '6 minutes'
         and e.created_at > now() - interval '3 hours'
         and coalesce(n.simulada, false) = false
       order by e.updated_at
       limit ${limite}`);
    for (const l of (r.rows ?? r) as any[]) {
      try {
        const nota = {
          ...l, tenantId: l.tenant_id, unidadeId: l.unidade_id, createdAt: l.created_at,
          tentativasConsulta: l.tentativas_consulta, emitidaEm: l.emitida_em,
        };
        const res: any = await this.resolverNaSefaz(nota, null);
        if (res?.status === 'cancelada') {
          await this.db
            .update(fiscalEvento)
            .set({ status: 'registrado', cstat: res.cstat ?? null, motivo: res.motivo ?? null, registradoEm: new Date(), updatedAt: new Date() })
            .where(and(eq(fiscalEvento.id, l.evento_id), eq(fiscalEvento.status, 'pendente')));
        } else if (res?.status === 'autorizada') {
          // A SEFAZ não registrou o pedido: ele sai da frente (rejeitado não conta no índice
          // único) e volta a ser AGENDADO — o executor manda de novo, se o prazo ainda deixar.
          await this.db
            .update(fiscalEvento)
            .set({
              status: 'rejeitado', updatedAt: new Date(),
              motivo: 'Sem resposta da SEFAZ, e a consulta mostrou a nota ainda autorizada: o pedido não foi registrado.',
            })
            .where(and(eq(fiscalEvento.id, l.evento_id), eq(fiscalEvento.status, 'pendente')));
          await this.agendarCancelamentoDaNota(l.tenant_id, l.id, l.evento_justificativa ?? JUSTIFICATIVA_VENDA_DESFEITA);
        } else {
          await this.db.update(fiscalEvento).set({ updatedAt: new Date() }).where(eq(fiscalEvento.id, l.evento_id));
        }
      } catch (e: any) {
        await this.db
          .update(fiscalEvento)
          .set({ updatedAt: new Date() })
          .where(eq(fiscalEvento.id, l.evento_id))
          .catch(() => undefined);
        this.log.warn(`cancelamento sem resposta da NFC-e ${l.numero}/${l.serie} segue indefinido: ${e?.message ?? e}`);
      }
    }
  }

  /**
   * A cada 2 minutos: resolve os pedidos sem resposta e manda os agendados que já podem sair. O
   * prazo do cancelamento comum é de 30 minutos da autorização — um job de 5 minutos gastaria um
   * sexto dele esperando. Roda na loja e na nuvem, cada uma com as notas da própria série.
   */
  @Cron('*/2 * * * *')
  async rodarCancelamentosAgendados() {
    try {
      await this.resolverCancelamentosSemResposta();
      return await this.executarCancelamentosAgendados();
    } catch (e: any) {
      // Instalação sem a mig 284 (`fiscal_evento`), ou banco fora: o job não pode derrubar nada.
      this.log.warn(`cancelamentos agendados não rodaram: ${e?.message ?? e}`);
      return null;
    }
  }

  // Configuração que vale para esta LOJA: a própria, ou — sem ela — a da EMPRESA (regra V4,
  // "da loja OU sem loja"). A tela grava no nível da empresa quando a rede tem uma loja só,
  // mas a comanda pertence à loja: com a busca estrita, toda venda recebia "Configure o fiscal
  // desta unidade" mesmo com tudo configurado.
  private async configRaw(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(fiscalConfig)
      .where(
        and(
          eq(fiscalConfig.tenantId, tenantId),
          unidadeId
            ? sql`(unidade_id = ${unidadeId} or unidade_id is null)`
            : sql`unidade_id is null`,
        ),
      )
      .orderBy(sql`(unidade_id is null)`)
      .limit(1);
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
  // ===== QUAIS TERMINAIS EMITEM NFC-e (mig 288) =====
  //
  // `equipamento.emite_nfce`: NULO ou TRUE = segue a loja; FALSE = este terminal não emite. A
  // decisão é de PRESIDENTE ou GERÊNCIA (as rotas exigem) e cada mudança fica na auditoria com
  // o antes e o depois — é uma decisão com peso fiscal, e alguém vai perguntar quem a tomou.

  private async terminalNaoEmite(tenantId: string, terminalId: string): Promise<boolean> {
    try {
      const r: any = await this.db.execute(sql`
        select emite_nfce from equipamento
         where id = ${terminalId}::uuid and tenant_id = ${tenantId}::uuid limit 1`);
      return (r.rows ?? r)[0]?.emite_nfce === false;
    } catch (e: any) {
      // Loja com o edge anterior à mig 288: sem a coluna, vale a regra da loja (emite).
      this.log.warn(`emite_nfce do terminal indisponível: ${e?.message ?? e}`);
      return false;
    }
  }

  /** PDVs e totens, com o que cada um faz hoje. */
  async listarTerminaisFiscais(tenantId: string, unidadeId?: string | null) {
    const r: any = await this.db.execute(sql`
      select id, nome, tipo, unidade_id as "unidadeId", ativo,
             coalesce(emite_nfce, true) as "emiteNfce"
        from equipamento
       where tenant_id = ${tenantId}::uuid
         and tipo in ('pdv', 'totem')
         and ${unidadeId ? sql`(unidade_id = ${unidadeId}::uuid or unidade_id is null)` : sql`true`}
       order by tipo, nome`);
    return (r.rows ?? r) as any[];
  }

  async definirTerminalFiscal(
    tenantId: string,
    atorId: string | null,
    atorPerfil: string,
    terminalId: string,
    emiteNfce: boolean,
  ) {
    const [antes] = ((await this.db.execute(sql`
      select id, nome, tipo, emite_nfce from equipamento
       where id = ${terminalId}::uuid and tenant_id = ${tenantId}::uuid
         and tipo in ('pdv', 'totem')`)) as any).rows ?? [];
    if (!antes) throw new NotFoundException('Terminal não encontrado (só PDV e totem emitem NFC-e).');
    await this.db.execute(sql`
      update equipamento set emite_nfce = ${emiteNfce}
       where id = ${terminalId}::uuid and tenant_id = ${tenantId}::uuid`);
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil, tipo: 'fiscal',
      acao: emiteNfce ? 'terminal_passou_a_emitir_nfce' : 'terminal_deixou_de_emitir_nfce',
      entidadeTipo: 'equipamento', entidadeId: terminalId,
      detalhe: { nome: antes.nome, tipo: antes.tipo, antes: antes.emite_nfce ?? null, depois: emiteNfce },
    });
    return { id: terminalId, nome: antes.nome, emiteNfce };
  }

  /** A loja pediu a 2ª via de papel na contingência? Padrão: não (guarda eletrônica do XML). */
  private async imprimeViaEstabelecimento(tenantId: string, unidadeId: string | null): Promise<boolean> {
    const cfg: any = await this.configRaw(tenantId, unidadeId).catch(() => null);
    return cfg?.contingenciaViaEstabelecimento === true || cfg?.contingencia_via_estabelecimento === true;
  }

  /**
   * A DANFE é BEST-EFFORT, e isso não é descuido: quando se chega aqui o documento fiscal já
   * existe (autorizado ou emitido em contingência). Deixar a impressão derrubar a chamada faria
   * a venda devolver erro para uma nota que está de pé — e o caixa tentaria emitir de novo.
   * O motivo real vai para o log; sem ele, o cupom simplesmente não sairia e ninguém saberia.
   */
  private async imprimirDanfe(
    tenantId: string,
    nota: any,
    itens: NfceItem[],
    extras?: { frete: number; desconto: number; consumidor?: string | null; contingencia?: boolean; uf?: string | null },
  ) {
    try {
      await this.montarEEnfileirarDanfe(tenantId, nota, itens, extras);
    } catch (e: any) {
      this.log.warn(
        `DANFE da NFC-e ${nota?.numero}/${nota?.serie} não foi enfileirada: ${e?.message ?? e}`,
      );
    }
  }

  private async montarEEnfileirarDanfe(
    tenantId: string,
    nota: any,
    itens: NfceItem[],
    extras?: { frete: number; desconto: number; consumidor?: string | null; contingencia?: boolean; uf?: string | null },
  ) {
    // O texto mora em `danfe-texto.ts`: o totem imprime o MESMO documento (K6) e não pode
    // haver duas versões do DANFE no projeto.
    const uf =
      (extras as any)?.uf ?? (await this.configRaw(tenantId, nota.unidadeId ?? null).catch(() => null))?.uf ?? null;
    const conteudo = montarDanfeTexto(nota, itens, { ...(extras ?? {}), uf });

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
    // SEGUNDA VIA na contingência — OPCIONAL, e desligada por padrão (mig 287).
    //
    // O MOC 7.0 (Anexo IV, §4) pede a "VIA DO ESTABELECIMENTO" guardada até a nota ser
    // transmitida e autorizada, MAS dá a alternativa que nós já cumprimos por desenho:
    // "poderá optar pela guarda eletrônica, em local seguro, do respectivo arquivo XML da
    // NFC-e… possibilitar a impressão do respectivo DANFE NFC-e para apresentação ao fisco
    // quando solicitado". O XML assinado fica em `nota_fiscal.xml` desde a emissão, sobe para a
    // nuvem e volta — e a tela reimprime a DANFE de qualquer nota.
    //
    // Restaurante não arquiva cupom em papel: imprimir a segunda via em toda venda seria papel
    // que ninguém guarda e fila dobrada justamente quando a loja está sem internet. Quem
    // precisar do papel — UF que exija, ou termo do livro modelo 6 ainda não lavrado — liga o
    // interruptor na configuração fiscal.
    // A contingência se lê pelo STATUS da nota — o mesmo critério do texto do DANFE (K6). Um
    // sinal à parte nos `extras` já se perdeu uma vez no caminho, e a 2ª via sumia calada.
    if (nota.status === 'contingencia' && (await this.imprimeViaEstabelecimento(tenantId, nota.unidadeId ?? null)))
      await this.db.insert(impressaoJob).values({
        tenantId,
        unidadeId: nota.unidadeId,
        equipamentoId: alvo,
        pedidoId: null,
        comandaId: nota.comandaId ?? null,
        via: 'fiscal',
        conteudo: `${conteudo}
--------------------------------
VIA DO ESTABELECIMENTO`,
      });
  }
}

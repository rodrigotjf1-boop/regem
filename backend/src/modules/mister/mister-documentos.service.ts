import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { hojeISO, somarDias } from '../../common/data';
import {
  DadosDoLancamento,
  FRASE_DA_LEITURA_CORTADA,
  FRASES_DO_DOCUMENTO,
  MAX_TOKENS_DO_DOCUMENTO,
  MODELO_DO_DOCUMENTO_PADRAO,
  ModoDoBoleto,
  RECURSO_DO_DOCUMENTO,
  OrigemDoCampo,
  decidirDocumento,
  cupomNaInstalacao,
  documentosNaInstalacao,
  instrucoesDoDocumento,
  lerLeituraDaFoto,
  lerRespostaDoQueFaltou,
} from '../../common/documento-por-foto';
import { MAX_BYTES_DA_FOTO, mimeDaFoto } from '../../common/foto-do-cliente';
import { NotaNoMister, destinosDosItens } from '../../common/nota-por-foto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { MidiaDoMister, MisterEntradaService, QuemMandou, QuemTocou } from './mister-entrada.service';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterNotasService } from './mister-notas.service';
import { PdfDoDocumento, gerarPdfDoDocumento, nomeDoPdf } from './documento-pdf';
import { MisterNumeroService } from './mister-numero.service';
import { Resposta } from './mister.regras';

/** Quanto tempo o documento que espera o valor ou o vencimento aceita a resposta em texto. */
const COMPLETAR_EM_MIN = 30;
const DIAS_DA_LISTA = [7, 30, 90] as const;
/** Para achar o boleto pelo nome dito (M3g): minúsculas, sem acento. */
const semAcento = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const LIMITE_DA_LISTA = 200;

/** Um documento na parte "Documentos" (Mister na loja). A situação "pago" e "cancelado" vem da conta a pagar ligada. */
export interface DocumentoNaTela {
  id: string;
  tipo: string;
  beneficiario: string | null;
  fornecedor: string | null;
  valorCentavos: number | null;
  vencimento: string | null;
  situacao: 'confirmar' | 'falta' | 'recusado' | 'lancado' | 'desfeito' | 'pago' | 'cancelado';
  motivo: string | null;
  origem: { valor: OrigemDoCampo | null; vencimento: OrigemDoCampo | null };
  linhaDigitavel: string | null;
  quem: string | null;
  telefoneFinal: string | null;
  criadoEm: string;
  respondidoEm: string | null;
  tituloId: string | null;
  podeDesfazer: boolean;
  /** Só da nota do fornecedor (M3b.3): o número, as parcelas e cada item com o destino — a mesma linha da conversa. */
  nota: {
    numero: string | null;
    parcelas: number;
    noEstoque: number;
    itens: ReturnType<typeof destinosDosItens>;
    recebimentoId: string | null;
    /** Versão 6, M6h: o cupom fiscal de compra e a resposta ao "Como deseja lançar?". */
    especie: 'nota' | 'cupom';
    comoLancar: 'despesa' | 'estoque' | null;
  } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const PREFIXO_DO_BOTAO = 'doc:';
const PRAZO_DA_IA_MS = 40_000;
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O resumo da nota para a tela: sem as sugestões nem os ids dos insumos (só o que a gaveta mostra). */
function resumoDaNota(n: NotaNoMister, recebimentoId: string | null): NonNullable<DocumentoNaTela['nota']> {
  return {
    numero: n.numero ?? null,
    parcelas: Math.max(1, Array.isArray(n.duplicatas) ? n.duplicatas.length : 0),
    noEstoque: n.itens.filter((x) => x.estado === 'ligado').length,
    itens: destinosDosItens(n),
    recebimentoId: recebimentoId ?? null,
    especie: n.especie === 'cupom' ? 'cupom' : 'nota',
    comoLancar: n.comoLancar ?? null,
  };
}

/** `pago` = "Já paguei" do aviso de vencimento (M3a parte 4); `reabrir` = o "Desfazer" dele; `pdf` = "Ver o PDF" (4b). */
type AcaoDoBotao = 'lancar' | 'outra' | 'desfazer' | 'pago' | 'reabrir' | 'pdf';
/** "doc:<ação>:<id do documento>". */
export function lerBotaoDoDocumento(botaoId: unknown): { acao: AcaoDoBotao; documentoId: string } | null {
  const m = /^doc:(lancar|outra|desfazer|pago|reabrir|pdf):(.+)$/.exec(String(botaoId ?? ''));
  return m && UUID.test(m[2]) ? { acao: m[1] as AcaoDoBotao, documentoId: m[2] } : null;
}
const botao = (acao: AcaoDoBotao, id: string, titulo: string) => ({ id: `${PREFIXO_DO_BOTAO}${acao}:${id}`, titulo });
/** Os botões do lançamento feito: "Desfazer" e "Ver o PDF" (4b). */
const botoesDoLancado = (id: string) => [botao('desfazer', id, 'Desfazer'), botao('pdf', id, 'Ver o PDF')];

/**
 * OS DOCUMENTOS POR FOTO DO MISTER (M3a, mig 439 — versão 3 do protótipo aprovada em 17/11/2026, conversas 11 a 13).
 *
 * O presidente manda a foto (ou o PDF) de um boleto ou conta pelo WhatsApp do Mister. Daqui: baixar (a credencial da
 * distribuição), a IA ler (o modelo mais forte, pela porta ÚNICA da IA da empresa, com o medidor no recurso
 * `mister_documento`), o código conferir (`decidirDocumento` → `lerBoleto`) e:
 *   · lançar sozinho (o boleto bancário conferido, de fornecedor cadastrado) — com "Desfazer";
 *   · perguntar "Lanço?" (conta de consumo, sem código, fornecedor novo) — "Lançar" / "Mandar outra foto";
 *   · pedir outra foto, ou dizer que não é documento, ou que a nota é da próxima parte.
 * A conta a pagar sai pelo MESMO `FinanceiroService.criar` da tela (com `origem: 'mister'`), e o "Desfazer" é o MESMO
 * `cancelar` (só a conta ainda em aberto). Uma leitura por foto (a entrada já não repete a mensagem; o índice no `wamid`
 * também segura). A foto não é guardada.
 *
 * NASCE DESLIGADO: só com `MISTER_DOCUMENTOS=1` na nuvem (o dono liga). Desligado, a foto segue como antes ("só leio
 * texto"). Por enquanto só o presidente lança (como a autorização das propostas).
 */
@Injectable()
export class MisterDocumentosService implements OnModuleInit {
  private readonly logger = new Logger('MisterDocumentos');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly ia: IaEmpresaService,
    private readonly financeiro: FinanceiroService,
    private readonly conversa: MisterConversaConfigService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // M3b: a nota do fornecedor (a leitura dos itens, as perguntas e o lançamento pelo recebimento) mora à parte.
    @Optional() private readonly notas?: MisterNotasService,
  ) {}

  /** A foto, o texto que completa e os botões chegam pela entrada do WhatsApp, que mora no módulo de baixo. */
  onModuleInit(): void {
    this.entrada?.registrarDocumento((quem, midia, wamid) => this.receber(quem, midia, wamid));
    this.entrada?.registrarTextoDoDocumento((quem, texto) => this.completarPeloTexto(quem, texto));
    this.entrada?.registrarBotao(PREFIXO_DO_BOTAO, (botaoId, quem) => this.responderBotao(botaoId, quem));
  }

  /** A leitura de documentos está ligada nesta nuvem? (A regra mora em `documentosNaInstalacao`: a tela lê a mesma.) */
  ligado(): boolean {
    return documentosNaInstalacao();
  }

  modelo(): string {
    return String(process.env.MISTER_DOCUMENTOS_MODELO ?? '').trim() || MODELO_DO_DOCUMENTO_PADRAO;
  }

  /** O jeito de lançar o boleto conferido: o ajuste da empresa em "Avisos e relatórios › Conversa" (mig 440). */
  protected async modoDoBoleto(tenantId: string): Promise<ModoDoBoleto> {
    return (await this.conversa.daEmpresa(tenantId)).documentosModo;
  }

  // ───────────────────────────── a foto ──────────────────────────

  async receber(quem: QuemMandou, midia: MidiaDoMister, wamid: string | null): Promise<boolean> {
    if (!this.ligado()) return false;
    const tipo = midia.tipo === 'imagem' ? mimeDaFoto(midia.mime) : String(midia.mime ?? '').toLowerCase().startsWith('application/pdf') ? 'application/pdf' : null;
    // Figurinha, áudio, planilha: não é com os documentos (segue como antes).
    if (!tipo) return false;
    // A empresa desligou "Lançar boletos e notas por foto": a foto segue como antes ("só leio texto").
    if (!(await this.conversa.daEmpresa(quem.tenantId)).documentosLigado) return false;
    if (quem.nivel !== 'presidente') {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.soPresidente });
      return true;
    }
    if (!(await this.ia.temAcesso(quem.tenantId))) {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.semIa });
      return true;
    }
    const arquivo = await this.numero.baixarMidia(midia.id);
    if (!arquivo || !arquivo.buffer.length || arquivo.buffer.length > MAX_BYTES_DA_FOTO) {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto('ilegivel') });
      return true;
    }

    let texto: string;
    let cortada = false;
    const bloco =
      tipo === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: tipo, data: arquivo.buffer.toString('base64') } };
    try {
      const r = await this.ia.pedir(quem.tenantId, {
        recurso: RECURSO_DO_DOCUMENTO,
        modelo: this.modelo(),
        maxTokens: MAX_TOKENS_DO_DOCUMENTO,
        system: instrucoesDoDocumento(cupomNaInstalacao()),
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Leia este documento.' }] }],
        prazoMs: PRAZO_DA_IA_MS,
      });
      texto = r.texto;
      cortada = r.parou === 'max_tokens';
    } catch (e: any) {
      this.logger.warn(`documento de ${quem.tenantId.slice(0, 8)}: a IA não leu (${e instanceof FalhaDaIa ? e.motivo : e?.message ?? e})`);
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.semIa });
      return true;
    }
    if (cortada) {
      this.logger.warn(`documento de ${quem.tenantId.slice(0, 8)}: a leitura parou no teto de ${MAX_TOKENS_DO_DOCUMENTO} tokens`);
      await this.registrar(quem, wamid, { tipo: 'outro', situacao: 'recusado', motivo: 'leitura_cortada' });
      await this.falar(quem.telefone, { texto: FRASE_DA_LEITURA_CORTADA });
      return true;
    }

    const leitura = lerLeituraDaFoto(texto);
    if (!leitura) {
      await this.registrar(quem, wamid, { tipo: 'outro', situacao: 'recusado', motivo: 'leitura_fora_do_formato' });
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto('ilegivel') });
      return true;
    }
    const fornecedor = await this.fornecedorDe(quem.tenantId, leitura.cnpj, leitura.beneficiario);
    const decisao = decidirDocumento(leitura, !!fornecedor, await this.modoDoBoleto(quem.tenantId));

    switch (decisao.acao) {
      case 'nota':
        // M3b: com as notas ligadas, a leitura dos itens e a conversa (sempre pergunta antes de lançar).
        if (this.notas?.ligadas()) {
          await this.notas.receber(quem, wamid, bloco, this.modelo());
          return true;
        }
        await this.registrar(quem, wamid, { tipo: 'nota', situacao: 'recusado', motivo: 'nota' });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.nota });
        return true;
      case 'nao_e_documento':
        await this.registrar(quem, wamid, { tipo: 'outro', situacao: 'recusado', motivo: 'nao_e_documento' });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.naoEDocumento });
        return true;
      case 'outra_foto':
        await this.registrar(quem, wamid, { tipo: leitura.tipo, situacao: 'recusado', motivo: decisao.porque });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto(decisao.porque) });
        return true;
      case 'perguntar':
        await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'falta', motivo: decisao.falta.join(','), dados: decisao.dados, fornecedorId: fornecedor });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.perguntar(decisao.falta) });
        return true;
      case 'confirmar': {
        const id = await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'confirmar', motivo: decisao.porque, dados: decisao.dados, fornecedorId: fornecedor });
        if (!id) return true;
        await this.falar(quem.telefone, {
          texto: FRASES_DO_DOCUMENTO.confirmar(decisao.dados, decisao.porque),
          botoes: [botao('lancar', id, 'Lançar'), botao('outra', id, 'Mandar outra foto')],
        });
        return true;
      }
      case 'lancar': {
        const id = await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'confirmar', motivo: 'sozinho', dados: decisao.dados, fornecedorId: fornecedor });
        if (!id) return true;
        const titulo = await this.lancar(id, quem.tenantId, quem.colaboradorId, quem.unidadeId);
        if (!titulo) {
          // Não lançou (a conta a pagar foi recusada): fica para a pessoa decidir.
          await this.falar(quem.telefone, {
            texto: FRASES_DO_DOCUMENTO.confirmar(decisao.dados, 'modo'),
            botoes: [botao('lancar', id, 'Lançar'), botao('outra', id, 'Mandar outra foto')],
          });
          return true;
        }
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.lancado(decisao.dados), botoes: botoesDoLancado(id) });
        return true;
      }
    }
  }

  // ───────────────────────────── os botões ──────────────────────────

  async responderBotao(botaoId: string, quem: QuemTocou): Promise<boolean> {
    // M3b: a escolha do insumo de um item da nota ("doc:ni:…") é do serviço das notas.
    if (String(botaoId ?? '').startsWith('doc:ni:')) return this.notas ? this.notas.escolher(botaoId, quem) : false;
    // Versão 6, M6h: o "Como deseja lançar?" do cupom fiscal ("doc:cl:…") também é do serviço das notas.
    if (String(botaoId ?? '').startsWith('doc:cl:')) return this.notas ? this.notas.comoLancar(botaoId, quem) : false;
    // P4 de "Pedidos e recebimento": "Receber o pedido" / "Não é deste pedido" e "Lançar no estoque" / "Só marcar recebido".
    if (String(botaoId ?? '').startsWith('doc:pd:')) return this.notas ? this.notas.pedidoDaNota(botaoId, quem) : false;
    // L2b: o "Lançar assim" da nota cuja soma não fecha ("doc:ns:…").
    if (String(botaoId ?? '').startsWith('doc:ns:')) return this.notas ? this.notas.lancarAssim(botaoId, quem) : false;
    // Versão 9, O1: o "Aceitar as sugestões" da nota ligada pela IA ("doc:ia:…").
    if (String(botaoId ?? '').startsWith('doc:ia:')) return this.notas ? this.notas.aceitarSugestoes(botaoId, quem) : false;
    // M3g: o "Desfazer" da correção do vencimento.
    if (String(botaoId ?? '').startsWith('doc:volta:')) return this.desfazerCorrecao(String(botaoId), quem);
    const b = lerBotaoDoDocumento(botaoId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!b || !empresas.length) return false;
    const d = await this.documentoDoBotao(b.documentoId, empresas);
    if (!d) return false;
    const v = quem.vinculos.find((x) => x.tenantId === d.tenantId)!;
    if (v.nivel !== 'presidente') {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.soPresidente });
      return true;
    }

    // M3b: a nota do fornecedor só tem "Lançar" e "Cancelar"; o resto (desfazer, pagar, PDF) é do boleto.
    if (d.tipo === 'nota') {
      // M6h: o "Desfazer" do cupom lançado como só despesa (o pagamento estornado e a conta cancelada).
      if (b.acao === 'desfazer' && this.notas && d.especie === 'cupom' && d.comoLancar === 'despesa') {
        const r = await this.notas.desfazerCupom(d, v.colaboradorId);
        await this.falar(quem.telefone, {
          texto: r === 'feito' ? 'Desfeito: a despesa do cupom saiu das contas.' : r === 'nao_da' ? FRASES_DO_DOCUMENTO.naoDaParaDesfazer : FRASES_DO_DOCUMENTO.jaRespondido,
        });
        return true;
      }
      if (b.acao === 'lancar' && this.notas) {
        await this.falar(quem.telefone, await this.notas.lancar(d.id, d.tenantId, v.colaboradorId, d.unidadeId ?? null));
        return true;
      }
      if (b.acao === 'outra') {
        const [mudou] = linhas(
          await this.db.execute(sql`
            update mister_documento set situacao = 'recusado', motivo = 'cancelado', respondido_em = now(), atualizado_em = clock_timestamp()
             where id = ${d.id}::uuid and situacao in ('confirmar', 'falta') returning id`),
        );
        await this.falar(quem.telefone, { texto: mudou ? 'Certo: não lancei a nota.' : FRASES_DO_DOCUMENTO.jaRespondido });
        return true;
      }
      await this.falar(quem.telefone, { texto: `A nota entrou pelo ${d.peloPedido ? 'Estoque › Pedidos' : 'Estoque › Recebimento'}: o que mudar nela é por lá.` });
      return true;
    }

    if (b.acao === 'lancar') {
      if (d.situacao !== 'confirmar') {
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.jaRespondido });
        return true;
      }
      const titulo = await this.lancar(d.id, d.tenantId, v.colaboradorId, d.unidadeId ?? null);
      if (!titulo) {
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.jaRespondido });
        return true;
      }
      const [dados] = linhas(await this.db.execute(sql`select dados from mister_documento where id = ${d.id}::uuid`));
      await this.falar(quem.telefone, {
        texto: `Lancei nas contas a pagar${dados?.dados?.vencimento ? `, para ${String(dados.dados.vencimento).slice(8, 10)}/${String(dados.dados.vencimento).slice(5, 7)}` : ''}.`,
        botoes: botoesDoLancado(d.id),
      });
      return true;
    }

    // "Ver o PDF" (4b): o boleto lançado em PDF, mandado pelo número do Mister (o toque abriu a janela de 24 horas).
    if (b.acao === 'pdf') {
      const arquivo = await this.pdf(d.tenantId, d.id);
      if (!arquivo) {
        await this.falar(quem.telefone, { texto: 'O PDF é do boleto lançado: este documento não foi lançado.' });
        return true;
      }
      try {
        await this.numero.enviarDocumento(quem.telefone, arquivo.pdf, arquivo.nome, arquivo.legenda);
        await this.auditar(d.tenantId, v.colaboradorId, 'mister_documento_pdf', d.id, { arquivo: arquivo.nome });
      } catch (e: any) {
        this.logger.warn(`documento ${d.id}: o PDF não saiu — ${e?.message ?? e}`);
        await this.falar(quem.telefone, { texto: 'Não consegui mandar o PDF agora. Tente de novo em instantes.' });
      }
      return true;
    }

    if (b.acao === 'outra') {
      const [mudou] = linhas(
        await this.db.execute(sql`
          update mister_documento set situacao = 'recusado', motivo = 'outra_foto', respondido_em = now(), atualizado_em = clock_timestamp()
           where id = ${d.id}::uuid and situacao = 'confirmar' returning id`),
      );
      await this.falar(quem.telefone, { texto: mudou ? 'Certo: manda a outra foto, com o documento inteiro, de perto e com luz.' : FRASES_DO_DOCUMENTO.jaRespondido });
      return true;
    }

    // "Já paguei" e o "Desfazer" dele (M3a parte 4): o MESMO pagar e o MESMO estornar da tela das contas a pagar, que
    // fazem uma vez só (a troca condicional da situação — ERR-506).
    if (b.acao === 'pago') {
      await this.falar(quem.telefone, await this.marcarPago(d, v.colaboradorId));
      return true;
    }
    if (b.acao === 'reabrir') {
      await this.falar(quem.telefone, await this.reabrir(d, v.colaboradorId));
      return true;
    }

    // Desfazer: o mesmo caminho do botão da tela.
    const r = await this.desfazer(d, v.colaboradorId, 'presidente');
    await this.falar(quem.telefone, {
      texto: r === 'feito' ? FRASES_DO_DOCUMENTO.desfeito : r === 'nao_da' || d.situacao === 'desfeito' ? FRASES_DO_DOCUMENTO.naoDaParaDesfazer : FRASES_DO_DOCUMENTO.jaRespondido,
    });
    return true;
  }

  // ───────────────────────────── o texto que completa ──────────────────────────

  /**
   * A conversa 13: o documento que esperava o valor ou o vencimento recebe o que a pessoa escreveu ("vence dia 30, 480
   * reais"). Só o último documento ESPERANDO desta pessoa, dos últimos 30 minutos, e só quando o texto traz o que faltou
   * (senão é pergunta ao Mister, como sempre). Completo, pergunta "Lanço assim?" — nunca lança sozinho o que foi dito.
   */
  async completarPeloTexto(quem: QuemMandou, texto: string): Promise<boolean> {
    if (!this.ligado() || quem.nivel !== 'presidente') return false;
    // L2b: a resposta à dúvida da leitura (a linha, o total ou o item que faltou).
    if (this.notas?.ligadas() && (await this.notas.responderLeitura(quem, texto))) return true;
    // M3b: a resposta ao "1 CX tem quantos kg?" da nota que espera o fator.
    if (this.notas?.ligadas() && (await this.notas.responderFator(quem, texto))) return true;
    let d: any;
    try {
      [d] = linhas(
        await this.db.execute(sql`
          select id::text as id, tipo, motivo, valor_centavos as "valorCentavos", vencimento::text as vencimento, beneficiario,
                 linha_digitavel as linha, codigo_barras as codigo, dados
            from mister_documento
           where tenant_id = ${quem.tenantId}::uuid and colaborador_id = ${quem.colaboradorId}::uuid and situacao = 'falta'
             and tipo <> 'nota'
             and criado_em > clock_timestamp() - make_interval(mins => ${COMPLETAR_EM_MIN})
           order by criado_em desc
           limit 1`),
      );
    } catch (e: any) {
      if (e?.code === '42P01' || e?.cause?.code === '42P01') return false;
      throw e;
    }
    if (!d) return false;
    const falta = String(d.motivo ?? '')
      .split(',')
      .filter((f): f is 'valor' | 'vencimento' => f === 'valor' || f === 'vencimento');
    const dito = falta.length ? lerRespostaDoQueFaltou(texto, falta) : null;
    if (!dito) return false;

    const valor = dito.valorCentavos ?? (d.valorCentavos != null ? Number(d.valorCentavos) : null);
    const vencimento = dito.vencimento ?? d.vencimento ?? null;
    const origem = {
      valor: (dito.valorCentavos != null ? 'pessoa' : (d.dados?.origem?.valor ?? null)) as OrigemDoCampo | null,
      vencimento: (dito.vencimento ? 'pessoa' : (d.dados?.origem?.vencimento ?? null)) as OrigemDoCampo | null,
    };
    const resta = (['valor', 'vencimento'] as const).filter((f) => (f === 'valor' ? valor == null : vencimento == null));
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_documento
           set valor_centavos = ${valor}, vencimento = ${vencimento}::date,
               situacao = ${resta.length ? 'falta' : 'confirmar'}, motivo = ${resta.length ? resta.join(',') : 'informado'},
               dados = dados || ${JSON.stringify({ origem, vencimento })}::jsonb, atualizado_em = clock_timestamp()
         where id = ${d.id}::uuid and situacao = 'falta'
        returning id`),
    );
    // Outra mensagem completou no mesmo instante: ela responde; esta não vira pergunta.
    if (!mudou) return true;
    if (resta.length) {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.perguntar([...resta]) });
      return true;
    }
    const dados: DadosDoLancamento = {
      tipo: d.tipo === 'conta' ? 'conta' : 'boleto',
      valorCentavos: valor,
      vencimento,
      beneficiario: d.beneficiario ?? null,
      cnpj: d.dados?.cnpj ?? null,
      boleto: d.linha ? ({ ok: true, linhaDigitavel: d.linha, codigoDeBarras: d.codigo } as any) : null,
      origem,
    };
    await this.falar(quem.telefone, {
      texto: FRASES_DO_DOCUMENTO.confirmar(dados, 'informado'),
      botoes: [botao('lancar', d.id, 'Lançar'), botao('outra', d.id, 'Mandar outra foto')],
    });
    return true;
  }

  // ───────────────────────────── a tela ("Documentos") ──────────────────────────

  /** Os documentos da empresa no período (7, 30 ou 90 dias; os mais novos primeiro, até 200). Só o presidente (a rota). */
  async listar(tenantId: string, diasPedidos?: unknown): Promise<{ dias: number; limite: number; documentos: DocumentoNaTela[] }> {
    const dias = DIAS_DA_LISTA.find((x) => String(x) === String(diasPedidos ?? '')) ?? 30;
    let lidas: any[] = [];
    try {
      lidas = linhas(
        await this.db.execute(sql`
          select d.id::text as id, d.tipo, d.beneficiario, f.nome as fornecedor, d.valor_centavos as "valorCentavos",
                 d.vencimento::text as vencimento, d.situacao, d.motivo, d.dados, d.linha_digitavel as "linhaDigitavel",
                 c.nome as quem, d.telefone_final as "telefoneFinal", d.criado_em as "criadoEm", d.respondido_em as "respondidoEm",
                 d.titulo_id::text as "tituloId", t.status as "tituloStatus", d.recebimento_id::text as "recebimentoId"
            from mister_documento d
            left join colaborador c on c.id = d.colaborador_id and c.tenant_id = d.tenant_id
            left join fornecedor f on f.id = d.fornecedor_id and f.tenant_id = d.tenant_id
            left join titulo_financeiro t on t.id = d.titulo_id and t.tenant_id = d.tenant_id
           where d.tenant_id = ${tenantId}::uuid and d.criado_em > now() - make_interval(days => ${dias})
           order by d.criado_em desc
           limit ${LIMITE_DA_LISTA}`),
      );
    } catch (e: any) {
      if (!(e?.code === '42P01' || e?.cause?.code === '42P01')) throw e;
    }
    return {
      dias,
      limite: LIMITE_DA_LISTA,
      documentos: lidas.map((l) => {
        const situacao: DocumentoNaTela['situacao'] =
          l.situacao === 'lancado' && l.tituloStatus === 'pago' ? 'pago' : l.situacao === 'lancado' && l.tituloStatus === 'cancelado' ? 'cancelado' : l.situacao;
        return {
          id: l.id,
          tipo: l.tipo,
          beneficiario: l.beneficiario ?? null,
          fornecedor: l.fornecedor ?? null,
          valorCentavos: l.valorCentavos != null ? Number(l.valorCentavos) : null,
          vencimento: l.vencimento ?? null,
          situacao,
          motivo: l.motivo ?? null,
          origem: { valor: l.dados?.origem?.valor ?? null, vencimento: l.dados?.origem?.vencimento ?? null },
          linhaDigitavel: l.linhaDigitavel ?? null,
          quem: l.quem ? String(l.quem).split(' ')[0] : null,
          telefoneFinal: l.telefoneFinal ?? null,
          criadoEm: new Date(l.criadoEm).toISOString(),
          respondidoEm: l.respondidoEm ? new Date(l.respondidoEm).toISOString() : null,
          tituloId: l.tituloId ?? null,
          // A nota (M3b) entrou pelo recebimento: o "Desfazer" do boleto não vale para ela.
          podeDesfazer:
            l.situacao === 'lancado' &&
            (l.tipo !== 'nota'
              ? l.tituloStatus === 'aberto'
              : // M6h: o cupom do "Só despesa" (a conta já paga, sem entrada no estoque)
                l.dados?.nota?.especie === 'cupom' && l.dados?.nota?.comoLancar === 'despesa' && (l.tituloStatus === 'pago' || l.tituloStatus === 'aberto')),
          nota: l.tipo === 'nota' && Array.isArray(l.dados?.nota?.itens) ? resumoDaNota(l.dados.nota, l.recebimentoId) : null,
        };
      }),
    };
  }

  // ───────────────────────────── M3g: corrigir o que o Mister lançou ─────────────────────────────

  /**
   * M3g — corrigir o VENCIMENTO de um boleto (ou conta) lançado pelo Mister (conversa 22: "o boleto da Distribuidora vence
   * dia 28, não 25"). Só o presidente; só o documento lançado com a conta ainda em aberto; pelo MESMO
   * `FinanceiroService.atualizar` da tela (a conta inteira, só o vencimento muda). O documento guarda o de antes, para o
   * "Desfazer". O aviso de vencimento segue a conta: avisa pela data nova. O VALOR nunca se corrige por aqui (é dinheiro):
   * isso é na tela de Contas a pagar.
   */
  async corrigirVencimento(
    e: { tenantId: string; colaboradorId: string; nivel: string },
    boleto: unknown,
    vencimento: unknown,
  ): Promise<{ dados: Record<string, unknown>; botoes: { id: string; titulo: string }[] } | { erro: string }> {
    if (e.nivel !== 'presidente') return { erro: FRASES_DO_DOCUMENTO.soPresidente };
    const novo = String(vencimento ?? '').trim();
    const hoje = hojeISO();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(novo) || Number.isNaN(Date.parse(`${novo}T12:00:00Z`)) || new Date(`${novo}T12:00:00Z`).toISOString().slice(0, 10) !== novo)
      return { erro: 'O vencimento precisa ser uma data (AAAA-MM-DD) que existe no calendário.' };
    if (novo < somarDias(hoje, -30) || novo > somarDias(hoje, 366)) return { erro: 'O vencimento novo precisa estar entre 30 dias atrás e um ano à frente.' };
    const palavras = semAcento(boleto)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['boleto', 'conta', 'da', 'do', 'de'].includes(w));
    if (!palavras.length) return { erro: 'Diga de quem é o boleto (o nome que aparece nele).' };
    const lancados = linhas(
      await this.db.execute(sql`
        select d.id::text as id, d.beneficiario, f.nome as fornecedor, d.vencimento::text as vencimento, d.valor_centavos as "valorCentavos",
               d.dados -> 'origem' ->> 'vencimento' as "origemDoVencimento", d.titulo_id::text as "tituloId"
          from mister_documento d
          join titulo_financeiro t on t.id = d.titulo_id and t.tenant_id = d.tenant_id and t.status = 'aberto'
          left join fornecedor f on f.id = d.fornecedor_id and f.tenant_id = d.tenant_id
         where d.tenant_id = ${e.tenantId}::uuid and d.situacao = 'lancado' and d.tipo in ('boleto', 'conta')
         order by d.criado_em desc
         limit 200`),
    );
    const casam = lancados.filter((d) => {
      const nome = semAcento(`${d.beneficiario ?? ''} ${d.fornecedor ?? ''}`);
      return palavras.every((w) => nome.includes(w));
    });
    const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const reaisDe = (c: unknown) => (Number(c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (!casam.length) return { erro: 'Não achei boleto lançado pelo Mister, ainda em aberto, com esse nome.' };
    if (casam.length > 1)
      return {
        dados: {
          precisaEscolher: casam.slice(0, 5).map((d) => `${d.beneficiario ?? d.fornecedor ?? 'sem nome'} · ${reaisDe(d.valorCentavos)} · vence ${d.vencimento ? dm(d.vencimento) : 'sem data'}`),
          siga: 'Pergunte qual destes boletos, com o nome e o valor como vieram.',
        },
        botoes: [],
      };
    const d = casam[0];
    if (d.vencimento === novo) return { erro: `O vencimento desse boleto já é ${dm(novo)}.` };
    const antes = String(d.vencimento ?? '');
    await this.mudarVencimento(e.tenantId, e.colaboradorId, d.tituloId, novo);
    await this.db.execute(sql`
      update mister_documento set vencimento = ${novo}::date, atualizado_em = clock_timestamp(),
             dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object('correcao', jsonb_build_object('de', ${antes || null}::text, 'para', ${novo}::text))
       where id = ${d.id}::uuid and tenant_id = ${e.tenantId}::uuid`);
    const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    return {
      dados: {
        corrigido: true,
        boleto: d.beneficiario ?? d.fornecedor,
        de: antes ? dm(antes) : null,
        para: `${dm(novo)} (${DIAS_DA_SEMANA[new Date(`${novo}T12:00:00Z`).getUTCDay()]})`,
        ...(d.origemDoVencimento === 'codigo' && antes
          ? { codigoDeBarrasDiz: dm(antes), siga: `Diga que o código de barras diz ${dm(antes)}: se o fornecedor prorrogou, é para guardar o boleto novo para pagar.` }
          : {}),
        avisos: 'O aviso de vencimento segue a data nova.',
        desfazer: 'Vai o botão "Desfazer" logo na sua resposta (pela API oficial).',
      },
      botoes: antes ? [{ id: `${PREFIXO_DO_BOTAO}volta:${d.id}:${antes}`, titulo: 'Desfazer' }] : [],
    };
  }

  /** A conta inteira pelo MESMO serviço da tela, só com o vencimento novo. */
  private async mudarVencimento(tenantId: string, atorId: string, tituloId: string, vencimento: string): Promise<void> {
    const [t] = linhas(
      await this.db.execute(sql`
        select tipo, descricao, categoria, fornecedor_id::text as "fornecedorId", valor::text as valor, recorrencia, foto_ref as "fotoRef"
          from titulo_financeiro where id = ${tituloId}::uuid and tenant_id = ${tenantId}::uuid`),
    );
    // O valor vai como está gravado (o texto do banco): a correção do vencimento não mexe nem na forma do valor.
    await this.financeiro.atualizar(
      tenantId,
      atorId,
      'presidente',
      tituloId,
      { tipo: t.tipo, descricao: t.descricao, categoria: t.categoria ?? undefined, fornecedorId: t.fornecedorId ?? undefined, valor: t.valor, vencimento, recorrencia: t.recorrencia ?? undefined, fotoRef: t.fotoRef ?? undefined } as any,
      null,
    );
  }

  /** O "Desfazer" da correção ("doc:volta:<documento>:<data de antes>"): só se o vencimento ainda for o corrigido. */
  private async desfazerCorrecao(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const m = /^doc:volta:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(botaoId);
    if (!m || !UUID.test(m[1])) return false;
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!empresas.length) return false;
    const d = await this.documentoDoBotao(m[1], empresas);
    if (!d) return false;
    const v = quem.vinculos.find((x) => x.tenantId === d.tenantId)!;
    if (v.nivel !== 'presidente') {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.soPresidente });
      return true;
    }
    const [atual] = linhas(
      await this.db.execute(sql`
        select d.vencimento::text as vencimento, d.dados -> 'correcao' ->> 'para' as para, d.titulo_id::text as "tituloId", t.status
          from mister_documento d join titulo_financeiro t on t.id = d.titulo_id and t.tenant_id = d.tenant_id
         where d.id = ${d.id}::uuid and d.tenant_id = ${d.tenantId}::uuid`),
    );
    if (!atual || atual.status !== 'aberto' || !atual.para || atual.vencimento !== atual.para) {
      await this.falar(quem.telefone, { texto: 'Este vencimento já mudou de novo (ou a conta não está mais em aberto): não desfiz.' });
      return true;
    }
    await this.mudarVencimento(d.tenantId, v.colaboradorId, atual.tituloId, m[2]);
    await this.db.execute(sql`
      update mister_documento set vencimento = ${m[2]}::date, atualizado_em = clock_timestamp(), dados = dados - 'correcao'
       where id = ${d.id}::uuid and tenant_id = ${d.tenantId}::uuid`);
    await this.falar(quem.telefone, { texto: `Desfeito: o vencimento voltou para ${m[2].slice(8, 10)}/${m[2].slice(5, 7)}.` });
    return true;
  }

  /** "Desfazer o lançamento" pela tela: o mesmo caminho do botão da conversa. Devolve o documento como a tela mostra. */
  async desfazerPelaTela(tenantId: string, atorId: string, atorPerfil: string, documentoId: string): Promise<{ resultado: 'feito' | 'nao_da' | 'ja_respondido' }> {
    if (!UUID.test(String(documentoId ?? ''))) throw new NotFoundException('Documento não encontrado.');
    const d = await this.documentoDoBotao(documentoId, [tenantId]);
    if (!d) throw new NotFoundException('Documento não encontrado.');
    // M6h: o cupom lançado como só despesa se desfaz pela tela também (a conta paga: o estorno e o cancelamento).
    const cupomDespesa = d.tipo === 'nota' && d.especie === 'cupom' && d.comoLancar === 'despesa';
    if (d.tipo === 'nota' && !cupomDespesa)
      throw new BadRequestException(`A nota entrou pelo ${d.peloPedido ? 'Estoque › Pedidos' : 'Estoque › Recebimento'}: o que mudar nela é por lá.`);
    const r = cupomDespesa && this.notas ? await this.notas.desfazerCupom(d, atorId, atorPerfil) : await this.desfazer(d, atorId, atorPerfil);
    if (r === 'nao_da') throw new BadRequestException(FRASES_DO_DOCUMENTO.naoDaParaDesfazer);
    if (r === 'ja_respondido') throw new BadRequestException(d.situacao === 'desfeito' ? 'Este lançamento já foi desfeito.' : 'Este documento não foi lançado.');
    return { resultado: r };
  }

  /**
   * O PDF do boleto lançado (4b): os dados do documento, da conta a pagar e do cadastro — nada da IA além do que já foi
   * conferido. Só do documento lançado (com a conta). Devolve o arquivo, o nome e a legenda, ou null.
   */
  async pdf(tenantId: string, documentoId: string): Promise<{ pdf: Buffer; nome: string; legenda: string } | null> {
    if (!UUID.test(String(documentoId ?? ''))) return null;
    const [l] = linhas(
      await this.db.execute(sql`
        select d.tipo, d.beneficiario, d.valor_centavos as "valorCentavos", d.vencimento::text as vencimento, d.linha_digitavel as "linhaDigitavel",
               d.codigo_barras as "codigoDeBarras", d.dados, d.criado_em as "criadoEm", d.situacao, emp.nome as empresa, c.nome as quem,
               f.nome as fornecedor, t.status as "tituloStatus"
          from mister_documento d
          join empresa emp on emp.id = d.tenant_id
          left join colaborador c on c.id = d.colaborador_id and c.tenant_id = d.tenant_id
          left join fornecedor f on f.id = d.fornecedor_id and f.tenant_id = d.tenant_id
          left join titulo_financeiro t on t.id = d.titulo_id and t.tenant_id = d.tenant_id
         where d.id = ${documentoId}::uuid and d.tenant_id = ${tenantId}::uuid and d.situacao = 'lancado' and d.titulo_id is not null
           and d.tipo in ('boleto', 'conta')`),
    );
    if (!l) return null;
    const dados: PdfDoDocumento = {
      empresa: String(l.empresa ?? ''),
      quem: l.quem ? String(l.quem).split(' ')[0] : null,
      criadoEm: new Date(l.criadoEm).toISOString(),
      tipo: l.tipo === 'conta' ? 'conta' : 'boleto',
      beneficiario: l.beneficiario ?? null,
      fornecedor: l.fornecedor ?? null,
      valorCentavos: l.valorCentavos != null ? Number(l.valorCentavos) : null,
      vencimento: l.vencimento ?? null,
      linhaDigitavel: l.linhaDigitavel ?? null,
      codigoDeBarras: l.codigoDeBarras ?? null,
      pix: typeof l.dados?.pix === 'string' ? l.dados.pix : null,
      origem: { valor: l.dados?.origem?.valor ?? null, vencimento: l.dados?.origem?.vencimento ?? null },
      situacao: l.tituloStatus === 'pago' ? 'pago' : l.tituloStatus === 'cancelado' ? 'cancelado na tela' : 'em aberto nas contas a pagar',
    };
    const nome = nomeDoPdf(dados);
    return { pdf: await gerarPdfDoDocumento(dados), nome, legenda: `${dados.tipo === 'conta' ? 'Conta' : 'Boleto'} · ${dados.beneficiario ?? 'lançado por foto'}` };
  }

  /** "Já paguei": dá baixa na conta a pagar do documento hoje, com o "Desfazer". O aviso de vencimento fecha na volta. */
  private async marcarPago(d: { id: string; tenantId: string; situacao: string; tituloId: string | null }, atorId: string): Promise<Resposta> {
    if (d.situacao !== 'lancado' || !d.tituloId) return { texto: 'Este boleto não está nas contas a pagar.' };
    try {
      await this.financeiro.pagar(d.tenantId, atorId, 'presidente', d.tituloId, {} as any, null);
    } catch (e: any) {
      if (e instanceof BadRequestException) return { texto: 'Esta conta já estava paga, ou foi cancelada na tela.' };
      if (e instanceof NotFoundException) return { texto: 'Este boleto não está mais nas contas a pagar.' };
      this.logger.warn(`documento ${d.id}: o "Já paguei" falhou — ${e?.message ?? e}`);
      return { texto: 'Não consegui dar baixa agora. Tente de novo em instantes.' };
    }
    await this.auditar(d.tenantId, atorId, 'mister_documento_pago', d.id, { titulo: d.tituloId });
    const hoje = hojeISO();
    return {
      texto: `Marquei como pago hoje, ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}. Saiu da lista de vencimentos.`,
      botoes: [botao('reabrir', d.id, 'Desfazer')],
    };
  }

  /** O "Desfazer" do "Já paguei": estorna o pagamento (a conta volta a aberta e à lista de vencimentos). */
  private async reabrir(d: { id: string; tenantId: string; tituloId: string | null }, atorId: string): Promise<Resposta> {
    if (!d.tituloId) return { texto: 'Este boleto não está nas contas a pagar.' };
    try {
      await this.financeiro.estornar(d.tenantId, atorId, 'presidente', d.tituloId, null);
    } catch (e: any) {
      if (e instanceof BadRequestException || e instanceof NotFoundException) return { texto: 'Esta conta não está paga: não há o que desfazer.' };
      this.logger.warn(`documento ${d.id}: o "Desfazer" do pagamento falhou — ${e?.message ?? e}`);
      return { texto: 'Não consegui desfazer agora. Tente de novo em instantes.' };
    }
    await this.auditar(d.tenantId, atorId, 'mister_documento_reaberto', d.id, { titulo: d.tituloId });
    return { texto: 'Desfeito: o boleto voltou para as contas a pagar, em aberto.' };
  }

  /**
   * Desfaz o lançamento: só o documento lançado, e só com a conta a pagar ainda em aberto — pelo MESMO cancelamento da
   * tela do Financeiro (que recusa a conta paga). Depois, a passagem condicional "lancado" → "desfeito".
   */
  private async desfazer(d: { id: string; tenantId: string; situacao: string; tituloId: string | null }, atorId: string, atorPerfil: string): Promise<'feito' | 'nao_da' | 'ja_respondido'> {
    if (d.situacao !== 'lancado' || !d.tituloId) return 'ja_respondido';
    try {
      await this.financeiro.cancelar(d.tenantId, atorId, atorPerfil, d.tituloId, null);
    } catch {
      return 'nao_da';
    }
    await this.db.execute(sql`
      update mister_documento set situacao = 'desfeito', respondido_em = now(), atualizado_em = clock_timestamp()
       where id = ${d.id}::uuid and situacao = 'lancado'`);
    await this.auditar(d.tenantId, atorId, 'mister_documento_desfeito', d.id, { titulo: d.tituloId });
    return 'feito';
  }

  // ───────────────────────────── por dentro ──────────────────────────

  /**
   * O documento do botão, só entre as empresas de quem tocou. A situação lida aqui é só para a resposta: quem garante o
   * "uma vez" é a passagem condicional do `lancar` (e o teste segura duas leituras juntas para provar isso).
   */
  protected async documentoDoBotao(documentoId: string, empresas: string[]): Promise<any | null> {
    const [d] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", situacao, tipo, titulo_id::text as "tituloId",
               dados->'nota'->>'especie' as especie, dados->'nota'->>'comoLancar' as "comoLancar",
               dados->'nota'->'pedido'->>'resposta' = 'receber' as "peloPedido"
          from mister_documento
         where id = ${documentoId}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
    );
    return d ?? null;
  }

  /**
   * Lança o documento como conta a pagar, uma vez: primeiro a passagem condicional "confirmar" → "lancado" (o toque
   * repetido e o de outro aparelho não passam), depois a conta pelo serviço da tela. Se a conta for recusada, o documento
   * volta a "confirmar". Devolve o id da conta, ou null.
   */
  private async lancar(documentoId: string, tenantId: string, colaboradorId: string, unidadeId: string | null): Promise<string | null> {
    const [d] = linhas(
      await this.db.execute(sql`
        update mister_documento set situacao = 'lancado', respondido_em = now(), atualizado_em = clock_timestamp()
         where id = ${documentoId}::uuid and tenant_id = ${tenantId}::uuid and situacao = 'confirmar'
        returning tipo, valor_centavos as "valorCentavos", vencimento::text as vencimento, beneficiario, fornecedor_id::text as "fornecedorId"`),
    );
    if (!d || d.valorCentavos == null) return null;
    try {
      const t: any = await this.financeiro.criar(
        tenantId,
        colaboradorId,
        'presidente',
        {
          tipo: 'pagar',
          descricao: `${d.tipo === 'conta' ? 'Conta' : 'Boleto'} · ${d.beneficiario ?? 'lançado por foto'}`.slice(0, 200),
          valor: Number(d.valorCentavos) / 100,
          vencimento: d.vencimento ?? undefined,
          fornecedorId: d.fornecedorId ?? undefined,
        } as any,
        unidadeId,
        { origem: 'mister' },
      );
      await this.db.execute(sql`update mister_documento set titulo_id = ${t.id}::uuid, atualizado_em = clock_timestamp() where id = ${documentoId}::uuid`);
      await this.auditar(tenantId, colaboradorId, 'mister_documento_lancado', documentoId, { titulo: t.id, valor: Number(d.valorCentavos) / 100 });
      return t.id;
    } catch (e: any) {
      this.logger.warn(`documento ${documentoId}: a conta a pagar foi recusada — ${e?.message ?? e}`);
      await this.db.execute(sql`update mister_documento set situacao = 'confirmar', respondido_em = null where id = ${documentoId}::uuid and situacao = 'lancado' and titulo_id is null`);
      return null;
    }
  }

  /** Grava o documento (uma vez por foto). Devolve o id, ou null quando a mesma foto já tinha sido lida. */
  private async registrar(
    quem: QuemMandou,
    wamid: string | null,
    r: { tipo: string; situacao: string; motivo: string; dados?: DadosDoLancamento; fornecedorId?: string | null },
  ): Promise<string | null> {
    const d = r.dados;
    const [linha] = linhas(
      await this.db.execute(sql`
        insert into mister_documento (tenant_id, unidade_id, colaborador_id, telefone_final, wamid, tipo, situacao, motivo,
                                      valor_centavos, vencimento, beneficiario, fornecedor_id, linha_digitavel, codigo_barras, dados)
        values (${quem.tenantId}::uuid, ${quem.unidadeId}::uuid, ${quem.colaboradorId}::uuid, ${quem.telefone.slice(-4)}, ${wamid},
                ${r.tipo}, ${r.situacao}, ${r.motivo}, ${d?.valorCentavos ?? null}, ${d?.vencimento ?? null}::date, ${d?.beneficiario ?? null},
                ${r.fornecedorId ?? null}::uuid, ${d?.boleto?.linhaDigitavel ?? null}, ${d?.boleto?.codigoDeBarras ?? null},
                ${JSON.stringify(d ? { origem: d.origem, vencimento: d.vencimento, cnpj: d.cnpj, ...(d.pix ? { pix: d.pix } : {}) } : {})}::jsonb)
        on conflict (wamid) where wamid is not null do nothing
        returning id::text as id`),
    );
    return linha?.id ?? null;
  }

  /** O fornecedor cadastrado do beneficiário: pelo CNPJ, ou pelo nome igual (sem caixa e sem espaços a mais). */
  private async fornecedorDe(tenantId: string, cnpj: string | null, nome: string | null): Promise<string | null> {
    const doc = String(cnpj ?? '').replace(/\D/g, '') || null;
    const nomeLimpo = String(nome ?? '').trim().replace(/\s+/g, ' ').toLowerCase() || null;
    if (!doc && !nomeLimpo) return null;
    // No `sql` do Drizzle a barra vai dobrada ('\\D'), senão o Postgres recebe 'D'.
    const [f] = linhas(
      await this.db.execute(sql`
        select id::text as id, (regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${doc ?? ''}) as "peloCnpj"
          from fornecedor
         where tenant_id = ${tenantId}::uuid and deleted_at is null
           and ((${doc}::text is not null and regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${doc}::text)
             or (${nomeLimpo}::text is not null and lower(regexp_replace(trim(nome), '\\s+', ' ', 'g')) = ${nomeLimpo}::text))
         order by 2 desc, created_at
         limit 1`),
    );
    return f?.id ?? null;
  }

  private async falar(telefone: string, resposta: Resposta): Promise<void> {
    try {
      await this.numero.enviar(telefone, resposta);
    } catch (e: any) {
      this.logger.warn(`a resposta do documento não saiu para ***${telefone.slice(-4)} — ${e?.message ?? e}`);
    }
  }

  private async auditar(tenantId: string, atorId: string, acao: string, documentoId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil: 'presidente', tipo: 'mister', acao, entidadeTipo: 'mister_documento', entidadeId: documentoId, detalhe } as any)
      .catch(() => undefined);
  }
}

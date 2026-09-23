import { cnpjValido, cpfValido } from '../../common/validadores-br';
import { NfceDestinatario, NfceIntermediador, NfceTransportador } from './nfce-xml.builder';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUEM É O DESTINATÁRIO DA NFC-e, E COMO A OPERAÇÃO SE DECLARA.
//
// Esta é a parte da emissão que não é técnica, é jurídica: a mesma venda pode sair como
// "operação presencial" ou "entrega a domicílio", e a diferença muda cinco campos do XML e
// cinco regras de validação da SEFAZ. Todas as decisões abaixo saem de norma, não de costume:
//
//  • **Ajuste SINIEF 9/26** (efeitos desde 03/08/2026) reescreveu a alínea "c" do inciso VII da
//    cláusula 4ª do Ajuste 19/16: o gatilho da identificação do consumidor deixou de ser
//    "entregas em domicílio" e passou a ser **"operações não presenciais"**, "hipótese em que
//    deverá constar a informação do respectivo endereço". Delivery, marketplace, site e
//    WhatsApp entram todos aí.
//  • **W16-40 → 750**: acima do limite de valor, o documento do destinatário é obrigatório. O
//    texto vigente da regra diz "R$ 10.000,00 **ou outro valor definido pela UF**" — por isso
//    limite é configuração, nunca constante (no RJ são R$ 2.000).
//  • **B25b-20 → 717**: a NFC-e só admite indPres 1, 4 e 5.
//  • **E01-20 → 787 · E05-20 → 788 · X03-20 → 786**: com indPres=4, destinatário, endereço e
//    transportador viram obrigatórios.
//  • **X02-10 → 753 · X03-10 → 754**: fora do indPres=4, frete e transportador são proibidos.
//  • **B25c-10 → 434**: o indicador de intermediador é obrigatório (marketplace ou não).
//
// O que NÃO dá para resolver aqui — pedido não presencial sem CPF do cliente — é escolha da
// loja (`fiscal_config.delivery_sem_cpf`), e o padrão é o menos danoso: emitir declarando
// operação presencial, sem frete e sem transportador, com a taxa de entrega em "outras despesas
// acessórias". Venda sem nota nenhuma é infração; nota sem o CPF que o cliente não deu, não.

/**
 * Piso a partir do qual o destinatário precisa ser identificado, por UF.
 *
 * ⚠️ Só entra nesta tabela UF com a norma conferida. Habilitar um estado novo exige levantar o
 * valor dele ANTES da primeira emissão — não existe "deve ser igual ao vizinho".
 */
export const LIMITE_IDENTIFICACAO_UF: Record<string, number> = {
  CE: 200,
  BA: 500,
  AL: 500,
  PB: 500,
  MT: 1000,
  RJ: 2000, // RICMS/RJ, Livro VI, Anexo I, art. 50, VI
  TO: 3000,
  PE: 5000,
};

/**
 * Default nacional da regra W16-40 — que NENHUMA UF levantada usa (ver docs/cupom-fiscal.md §3).
 * Fica aqui só como referência do texto da norma.
 */
export const LIMITE_IDENTIFICACAO_NACIONAL = 10000;

/**
 * UF fora da tabela: vale o piso mais restritivo conhecido, não os R$ 10.000 da norma.
 * Errar para baixo pede um CPF que talvez não fosse exigido; errar para cima produz rejeição
 * 750 — e rejeição gasta número. Habilitar um estado novo exige levantar o valor dele antes da
 * primeira emissão; até lá, o conservador é o certo.
 */
export const LIMITE_IDENTIFICACAO_PADRAO = Math.min(...Object.values(LIMITE_IDENTIFICACAO_UF));

export function limiteIdentificacao(uf: string, configurado?: any): number {
  const n = Number(configurado);
  if (Number.isFinite(n) && n > 0) return n; // a loja/distribuição manda mais que a tabela
  return LIMITE_IDENTIFICACAO_UF[String(uf ?? '').toUpperCase()] ?? LIMITE_IDENTIFICACAO_PADRAO;
}

/**
 * CNPJ de cada plataforma intermediadora, por canal.
 *
 * ⚠️ VAZIO DE PROPÓSITO. Este número vai dentro de um documento fiscal: ele tem de vir da nota
 * fiscal de serviço que a plataforma emite contra a loja (ou do contrato/repasse), não de
 * memória nem de busca na internet. Enquanto o canal não estiver aqui, a emissão do pedido dele
 * é RECUSADA com mensagem explícita — declarar `indIntermed=0` num pedido de marketplace seria
 * informar à SEFAZ que a venda foi direta, que é falso.
 */
export const CNPJ_INTERMEDIADOR: Record<string, string> = {};

/** Canais que são plataforma de terceiro. O cardápio do Regem é plataforma PRÓPRIA da loja. */
export const CANAIS_MARKETPLACE = new Set(['ifood', '99food', 'ubereats', 'rappi', 'keeta']);

export interface PedidoFiscal {
  canal?: string | null;
  tipo?: string | null; // entrega | retirada | balcao
  documentoCliente?: string | null; // CPF/CNPJ que o cliente informou para a nota
  clienteNome?: string | null;
  enderecoRua?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoMunicipioIbge?: number | string | null;
  enderecoUf?: string | null;
  enderecoCep?: string | null;
  merchantId?: string | null; // identificação da LOJA no app do intermediador
}

export interface DecisaoFiscal {
  indPres: 1 | 4;
  dest: NfceDestinatario | null;
  transportador: NfceTransportador | null;
  intermediador: NfceIntermediador | null;
  frete: number; // só em indPres=4
  outras: number; // a taxa de entrega quando a nota sai presencial
  semDocumentoCliente: boolean; // venda não presencial emitida sem o CPF do consumidor
}

/** Erro de decisão: a venda existe, mas a nota não pode ser montada como está. */
export class EmissaoBloqueada extends Error {}

const soDig = (s: any) => String(s ?? '').replace(/\D/g, '');

/** Documento utilizável: existe e os dígitos verificadores fecham. Typo não vira rejeição 237. */
export function documentoUtilizavel(bruto: any): string | null {
  const d = soDig(bruto);
  if (d.length === 11 && cpfValido(d)) return d;
  if (d.length === 14 && cnpjValido(d)) return d;
  return null;
}

export function decidirEmissao(p: {
  pedido: PedidoFiscal | null;
  config: any; // fiscal_config + emitente
  taxaEntrega: number; // já filtrada: só quando a loja é dona do valor
  valorTotal: number; // produtos − desconto + taxa, o que o cliente pagou
}): DecisaoFiscal {
  const { pedido, config } = p;
  const taxa = Math.max(0, Number(p.taxaEntrega) || 0);
  const documento = documentoUtilizavel(pedido?.documentoCliente);
  const canal = String(pedido?.canal ?? '').toLowerCase();
  const naoPresencial = !!pedido && String(pedido.tipo ?? '') === 'entrega';

  // ── Intermediador (B25c-10 → 434) ───────────────────────────────────────────────────────
  let intermediador: NfceIntermediador | null = null;
  if (pedido && CANAIS_MARKETPLACE.has(canal)) {
    const cnpj = CNPJ_INTERMEDIADOR[canal];
    const idCad = String(pedido.merchantId ?? '').trim();
    if (!cnpj)
      throw new EmissaoBloqueada(
        `Falta o CNPJ do intermediador do canal ${canal} para emitir a NFC-e deste pedido. ` +
          'Ele consta na nota fiscal de serviço que a plataforma emite contra a loja.',
      );
    if (!idCad)
      throw new EmissaoBloqueada(
        `Falta a identificação da loja no app do ${canal} (merchant) para emitir a NFC-e deste pedido.`,
      );
    intermediador = { cnpj, idCadIntTran: idCad };
  }

  // ── Limite de valor (W16-40 → 750) ──────────────────────────────────────────────────────
  const limite = limiteIdentificacao(config?.uf, config?.limiteIdentificacao);
  if (!documento && Number(p.valorTotal) > limite)
    throw new EmissaoBloqueada(
      `Venda de ${Number(p.valorTotal).toFixed(2)} acima do limite de ${limite.toFixed(2)} para ` +
        'NFC-e sem identificação do consumidor: informe o CPF ou CNPJ do cliente.',
    );

  // ── Endereço da entrega ─────────────────────────────────────────────────────────────────
  // `enderDest` exige município e UF, que o pedido nem sempre traz. O delivery é intramunicipal
  // na prática (a NFC-e só vale dentro do estado), então o município do EMITENTE é a melhor
  // aproximação — e o pedido, quando informa o seu, vence.
  const rua = String(pedido?.enderecoRua ?? '').trim();
  const bairro = String(pedido?.enderecoBairro ?? '').trim();
  const endereco =
    rua && bairro
      ? {
          logradouro: rua,
          numero: String(pedido?.enderecoNumero ?? '').trim() || 'S/N',
          complemento: pedido?.enderecoComplemento ?? null,
          bairro,
          codigoMunicipio: soDig(pedido?.enderecoMunicipioIbge) || soDig(config?.codigoMunicipio),
          municipio: String(pedido?.enderecoCidade ?? '').trim() || String(config?.municipio ?? ''),
          uf: String(pedido?.enderecoUf ?? '').trim() || String(config?.uf ?? ''),
          cep: pedido?.enderecoCep ?? null,
        }
      : null;

  const dest: NfceDestinatario | null = documento
    ? { documento, nome: String(pedido?.clienteNome ?? '').trim() || null, endereco }
    : null;

  // ── Entrega a domicílio (indPres=4) ─────────────────────────────────────────────────────
  // Só se o conjunto INTEIRO existe. Faltando qualquer peça, a nota seria rejeitada — e nota
  // rejeitada gasta número.
  if (naoPresencial && dest && endereco) {
    return {
      indPres: 4,
      dest,
      // O manual da NFC-e da SEFAZ-RJ: "quando o transporte for feito pela própria empresa, os
      // dados da empresa devem constar no campo dados do transportador, independentemente se
      // quem realiza o transporte é um motoboy, ciclista etc.".
      transportador: {
        documento: config?.cnpj ?? null,
        nome: String(config?.razaoSocial ?? '') || 'EMITENTE',
        ie: config?.ie ?? null,
        municipio: config?.municipio ?? null,
        uf: config?.uf ?? null,
      },
      intermediador,
      frete: taxa,
      outras: 0,
      semDocumentoCliente: false,
    };
  }

  // ── Não presencial SEM o documento do cliente: o que a loja escolheu ────────────────────
  if (naoPresencial && String(config?.deliverySemCpf ?? 'presencial') === 'nao_emitir')
    throw new EmissaoBloqueada(
      'Pedido de entrega sem CPF do cliente e a loja optou por não emitir NFC-e nesse caso.',
    );

  return {
    indPres: 1,
    dest, // pode existir mesmo na nota presencial — é o CPF na nota do balcão
    transportador: null, // 754: fora da entrega a domicílio, é proibido
    intermediador,
    frete: 0, // 753: idem
    outras: taxa, // a taxa vira despesa acessória, para o total bater com o que o cliente pagou
    semDocumentoCliente: naoPresencial && !documento,
  };
}

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Frete e desconto que a NOTA deve declarar, a partir da linha do pedido de canal.
 *
 *  • taxa de entrega → só quando a LOJA é dona do valor. Com a logística do marketplace, a
 *    entrega é serviço DELE cobrado do cliente: não é operação da loja e não entra na nota dela.
 *  • desconto → só o bancado pela LOJA. O bancado pelo marketplace não é desconto fiscal (a loja
 *    recebe o valor cheio no repasse, então a base é cheia). Desconto de FRETE também fica fora:
 *    a taxa já chega líquida dele, e abater de novo criaria nota menor do que o cliente pagou.
 *
 * Recebe o pedido como JSON (`to_jsonb`) de propósito: numa loja com o edge desatualizado as
 * colunas novas simplesmente não vêm, e ler o que existe é melhor do que a consulta inteira
 * falhar e a nota sair sem valor nenhum.
 */
export function valoresFiscaisDoPedido(p: any | null): { taxaEntrega: number; desconto: number } {
  if (!p) return { taxaEntrega: 0, desconto: 0 };
  const taxa = String(p.taxa_entrega_dono ?? '') === 'loja' ? num(p.taxa_entrega) : 0;
  const desconto =
    p.descontos == null
      ? num(p.desconto_loja)
      : Array.isArray(p.descontos)
        ? p.descontos
            .filter(
              (d: any) =>
                String(d?.quemBanca ?? 'indefinido') !== 'marketplace' &&
                String(d?.alvo ?? '') !== 'DELIVERY_FEE',
            )
            .reduce((s: number, d: any) => s + num(d?.valor), 0)
        : 0;
  return { taxaEntrega: Math.max(0, taxa), desconto: Math.max(0, desconto) };
}

/** A linha crua do `pedido_externo` (to_jsonb) no formato que a decisão entende. */
export function pedidoFiscalDeJson(p: any | null, merchantId?: string | null): PedidoFiscal | null {
  if (!p) return null;
  return {
    canal: p.canal ?? null,
    tipo: p.tipo ?? null,
    documentoCliente: p.documento_cliente ?? null,
    clienteNome: p.cliente_nome ?? null,
    enderecoRua: p.endereco_rua ?? null,
    enderecoNumero: p.endereco_numero ?? null,
    enderecoComplemento: p.endereco_referencia ?? null,
    enderecoBairro: p.endereco_bairro ?? null,
    enderecoCidade: p.endereco_cidade ?? null,
    enderecoMunicipioIbge: p.endereco_municipio_ibge ?? null,
    enderecoUf: p.endereco_uf ?? null,
    enderecoCep: p.endereco_cep ?? null,
    merchantId: merchantId ?? null,
  };
}

/** CPF/CNPJ com máscara, para o cupom que vai para a mão do cliente. */
export function formatarDocumento(doc: string): string {
  const d = soDig(doc);
  if (d.length === 11) return `CPF ${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14)
    return `CNPJ ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

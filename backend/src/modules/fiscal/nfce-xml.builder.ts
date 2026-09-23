/* eslint-disable @typescript-eslint/no-explicit-any */
// Builder do XML da NFC-e 4.00 (infNFe, sem assinatura — a assinatura é o "plug"
// do certificado). Estrutura simplificada nos grupos de tributos (Simples/CSOSN
// + PIS/COFINS não tributados); os valores fiscais reais devem ser validados em
// HOMOLOGAÇÃO com o certificado antes de produção.

import { ratearReais } from '../../common/rateio';
import { cnpjValido, cpfValido } from '../../common/validadores-br';

const esc = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const n2 = (v: any) => Number(v || 0).toFixed(2);
const n4 = (v: any) => Number(v || 0).toFixed(4);
const soDig = (s: any) => String(s ?? '').replace(/\D/g, '');

const TPAG: Record<string, string> = {
  dinheiro: '01',
  cartao: '03',
  credito: '03',
  debito: '04',
  pix: '17',
  transferencia: '18',
};

export interface NfceItem {
  codigo: string;
  descricao: string;
  // Rateio do desconto/frete do PEDIDO nesta linha. Não vêm do chamador: o builder
  // calcula (ver `montarNfceXml`), porque a soma tem de fechar com o total.
  vDesc?: number;
  vFrete?: number;
  vOutro?: number;
  ncm?: string;
  cfop?: string;
  cest?: string;
  origem?: string;
  csosn?: string;
  cstIcms?: string;
  unidadeTrib?: string;
  quantidade: number;
  precoUnitario: number;
  aliqIcms?: number;
  gtin?: string;
  cstPis?: string;
  aliqPis?: number;
  cstCofins?: string;
  aliqCofins?: number;
}

/**
 * DESTINATÁRIO da NFC-e. Obrigatório em operação NÃO PRESENCIAL (Ajuste SINIEF 9/26, efeitos
 * desde 03/08/2026: o gatilho deixou de ser "entrega em domicílio" e passou a ser "operações não
 * presenciais") e acima do limite de valor da UF (W16-40: "R$ 10.000,00 OU OUTRO VALOR DEFINIDO
 * PELA UF" — no RJ, R$ 2.000).
 */
export interface NfceDestinatario {
  documento: string; // CPF ou CNPJ, só dígitos — o que define a tag é o tamanho
  nome?: string | null;
  endereco?: {
    logradouro: string;
    numero: string;
    complemento?: string | null;
    bairro: string;
    codigoMunicipio: number | string; // IBGE
    municipio: string;
    uf: string;
    cep?: string | null;
  } | null;
}

/** Quem leva a mercadoria. A entrega a domicílio EXIGE este grupo (rejeição 786). */
export interface NfceTransportador {
  documento?: string | null; // CNPJ (ou CPF) de quem transporta
  nome: string;
  ie?: string | null;
  endereco?: string | null;
  municipio?: string | null;
  uf?: string | null;
}

/** Marketplace/plataforma de terceiros (grupo infIntermed). iFood, 99Food… */
export interface NfceIntermediador {
  cnpj: string;
  idCadIntTran: string; // identificação da LOJA no app do intermediador
}

export interface NfceInput {
  config: any; // fiscal_config
  serie: number; // série do ponto de emissão (fiscal_serie), não a da config
  numero: number;
  chave: string; // 44 díg (sem "NFe")
  cNF: string;
  dhEmi: string; // ISO com timezone
  itens: NfceItem[];
  forma?: string | null;
  qrCode: string;
  // URL de "consulta pela chave de acesso" da UF (vai no <urlChave>). É DIFERENTE da URL
  // do QR Code — no RJ, a nota real imprime www.fazenda.rj.gov.br/nfce/consulta.
  urlChave: string;
  // Responsável técnico pelo sistema emissor (grupo <infRespTec>, NT 2018.005). É a
  // DISTRIBUIÇÃO (Regem), não a loja — vem da configuração do servidor. Sem ele o grupo não sai;
  // se a UF exigir, a SEFAZ rejeita com 972 e é aí que ele passa a ser obrigatório para nós.
  respTec?: { cnpj: string; contato: string; email: string; fone: string } | null;
  // Valores do PEDIDO (não do item). O builder rateia entre os itens; ver a nota
  // sobre as regras W14/W16 em `montarNfceXml`.
  desconto?: number; // desconto bancado pela LOJA (o do marketplace não é desconto na nota)
  frete?: number; // taxa de entrega QUANDO é da loja (receita dela, compõe a operação)
  /**
   * Outras despesas acessórias (W15/I17a). É por aqui que a taxa de entrega entra quando a nota
   * NÃO é de entrega a domicílio — o caso do pedido sem CPF, que sai declarado como presencial.
   * Como frete ela seria rejeição 753; como item novo, precisaria de um NCM que ela não tem
   * (NCM "00" fora de item de serviço é rejeição 471, e a NFC-e não tem item de serviço).
   * "Despesa acessória cobrada do adquirente" é exatamente o que ela é, e compõe o vNF (W16-10).
   */
  outras?: number;
  /**
   * 1 = operação presencial (balcão) · 4 = entrega a domicílio.
   * A NFC-e aceita 1, 4 e 5 ("presencial fora do estabelecimento") — qualquer outro é rejeição
   * 717 (regra B25b-20). Nós usamos 1 e 4; o 5 é venda ambulante, que não é o nosso caso.
   * O `4` puxa um bloco inteiro de obrigações: destinatário (E01-20 → 787), endereço
   * (E05-20 → 788) e transportador (X03-20 → 786). E o transporte só existe com `4`: frete com
   * `modFrete<>9` fora dele é rejeição **753** (X02-10), e transportador, **754** (X03-10).
   */
  indPres?: 1 | 4;
  dest?: NfceDestinatario | null;
  transportador?: NfceTransportador | null;
  /**
   * Pedido veio de plataforma de terceiro? O campo `indIntermed` é OBRIGATÓRIO sempre que
   * `indPres` for 1, 2, 3, 4 ou 9 (regra B25c-10, produção desde 04/04/2022) — e como a NFC-e só
   * aceita 1 e 4, ele é obrigatório SEMPRE. Sem intermediador vai `0`; com, vai `1` + o grupo.
   */
  intermediador?: NfceIntermediador | null;
  /**
   * CONTINGÊNCIA OFF-LINE (`tpEmis=9`): a nota é gerada, assinada e impressa **sem** autorização
   * prévia da SEFAZ, e transmitida depois — até o fim do primeiro dia útil seguinte
   * (MOC 7.0, Anexo IV). Quem entra em contingência tem de dizer QUANDO entrou (`dhCont`) e
   * POR QUÊ (`xJust`): sem os dois é rejeição **557** (regra B28-20); com `tpEmis=1`, informá-los
   * é rejeição **556** (B28-10). A UF pode não aceitar esta contingência (**712**, B22-20) e a
   * NFC-e não aceita as outras modalidades (**714**, B22-34).
   */
  contingencia?: { dhCont: string; xJust: string } | null;
}

// PIS/COFINS: CST tributável (01/02) com alíquota → grupo Aliq; senão não-tributado.
function grupoPisCofins(tag: string, cst?: string, aliq?: number, vBC?: number): string {
  const tributavel = ['01', '02'].includes(cst || '') && Number(aliq) > 0;
  if (tributavel) {
    const p = Number(aliq);
    const v = Number(((Number(vBC) * p) / 100).toFixed(2));
    const grp = tag === 'PIS' ? 'PISAliq' : 'COFINSAliq';
    return `<${tag}><${grp}><CST>${cst}</CST><vBC>${n2(vBC)}</vBC><p${tag}>${n2(p)}</p${tag}><v${tag}>${n2(v)}</v${tag}></${grp}></${tag}>`;
  }
  const grp = tag === 'PIS' ? 'PISNT' : 'COFINSNT';
  return `<${tag}><${grp}><CST>${cst || '07'}</CST></${grp}></${tag}>`;
}

/**
 * Grupo do destinatário. A tag do documento é escolhida pelo TAMANHO (14 = CNPJ, 11 = CPF) —
 * o leiaute é uma escolha entre CNPJ, CPF e idEstrangeiro, nunca os três.
 *
 * `indIEDest` é obrigatório dentro do grupo e vai sempre `9` (não contribuinte): NFC-e COM
 * inscrição estadual do destinatário é rejeição 729.
 */
function grupoDest(d?: NfceDestinatario | null): string {
  if (!d?.documento) return '';
  const doc = soDig(d.documento);
  const tag = doc.length === 14 ? 'CNPJ' : 'CPF';
  // A SEFAZ confere o dígito verificador (E02-10 → 238 para o CNPJ, E03-10 → 237 para o CPF).
  // Um CPF digitado errado no caixa não pode chegar até lá: seria número de nota queimado.
  // Quem chama trata o documento inválido ANTES, decidindo se pede de novo ou emite sem ele.
  if (!(tag === 'CNPJ' ? cnpjValido(doc) : cpfValido(doc)))
    throw new Error('Documento do destinatario invalido (rejeicao 237/238).');
  const e = d.endereco;
  const ender = e
    ? `<enderDest>` +
      `<xLgr>${esc(e.logradouro)}</xLgr><nro>${esc(e.numero)}</nro>` +
      (String(e.complemento ?? '').trim() ? `<xCpl>${esc(e.complemento)}</xCpl>` : '') +
      `<xBairro>${esc(e.bairro)}</xBairro>` +
      `<cMun>${soDig(e.codigoMunicipio)}</cMun><xMun>${esc(e.municipio)}</xMun>` +
      `<UF>${esc(e.uf)}</UF>` +
      (soDig(e.cep).length === 8 ? `<CEP>${soDig(e.cep)}</CEP>` : '') +
      `</enderDest>`
    : '';
  return (
    `<dest><${tag}>${doc}</${tag}>` +
    (String(d.nome ?? '').trim() ? `<xNome>${esc(d.nome)}</xNome>` : '') +
    ender +
    `<indIEDest>9</indIEDest>` +
    `</dest>`
  );
}

/**
 * Transporte. Na entrega a domicílio o transportador é obrigatório — e o manual da SEFAZ-RJ é
 * explícito: *"quando o transporte for feito pela própria empresa, os dados da empresa devem
 * constar no campo dados do transportador, independentemente se quem realiza o transporte é um
 * motoboy, ciclista etc."*
 */
function grupoTransp(vFrete: number, t?: NfceTransportador | null): string {
  // modFrete 9 = sem ocorrência de transporte; 0 = por conta do remetente (a loja cobra e contrata).
  const modFrete = vFrete > 0 ? '0' : '9';
  if (!t?.nome) return `<transp><modFrete>${modFrete}</modFrete></transp>`;
  const doc = soDig(t.documento);
  const tag = doc.length === 14 ? 'CNPJ' : 'CPF';
  return (
    `<transp><modFrete>${modFrete}</modFrete><transporta>` +
    (doc ? `<${tag}>${doc}</${tag}>` : '') +
    `<xNome>${esc(t.nome)}</xNome>` +
    (String(t.ie ?? '').trim() ? `<IE>${esc(t.ie)}</IE>` : '') +
    (String(t.endereco ?? '').trim() ? `<xEnder>${esc(t.endereco)}</xEnder>` : '') +
    (String(t.municipio ?? '').trim() ? `<xMun>${esc(t.municipio)}</xMun>` : '') +
    (String(t.uf ?? '').trim() ? `<UF>${esc(t.uf)}</UF>` : '') +
    `</transporta></transp>`
  );
}

function detItem(it: NfceItem, i: number, crt: number): string {
  const vProd = Number(it.quantidade) * Number(it.precoUnitario);
  const vDesc = Number(it.vDesc) || 0;
  const vFrete = Number(it.vFrete) || 0;
  const vOutro = Number(it.vOutro) || 0;
  // Base de PIS/COFINS é o valor LÍQUIDO da linha: desconto reduz, frete compõe.
  // Usar o vProd cheio inflaria o imposto de quem tributa (CST 01/02).
  const vBC = Math.max(0, vProd - vDesc + vFrete + vOutro);
  const origem = it.origem ?? '0';
  const gtin = soDig(it.gtin) || 'SEM GTIN';
  // ICMS: Simples (CRT=1) → CSOSN; Normal → CST básico.
  const icms =
    crt === 1
      ? `<ICMS><ICMSSN102><orig>${origem}</orig><CSOSN>${it.csosn || '102'}</CSOSN></ICMSSN102></ICMS>`
      : `<ICMS><ICMS40><orig>${origem}</orig><CST>${it.cstIcms || '40'}</CST></ICMS40></ICMS>`;
  return (
    `<det nItem="${i + 1}">` +
    `<prod>` +
    `<cProd>${esc(it.codigo || i + 1)}</cProd>` +
    `<cEAN>${gtin}</cEAN>` +
    `<xProd>${esc(it.descricao)}</xProd>` +
    `<NCM>${soDig(it.ncm) || '00000000'}</NCM>` +
    (it.cest ? `<CEST>${soDig(it.cest)}</CEST>` : '') +
    `<CFOP>${soDig(it.cfop) || '5102'}</CFOP>` +
    `<uCom>${esc(it.unidadeTrib || 'UN')}</uCom>` +
    `<qCom>${n4(it.quantidade)}</qCom>` +
    `<vUnCom>${n4(it.precoUnitario)}</vUnCom>` +
    `<vProd>${n2(vProd)}</vProd>` +
    `<cEANTrib>${gtin}</cEANTrib>` +
    `<uTrib>${esc(it.unidadeTrib || 'UN')}</uTrib>` +
    `<qTrib>${n4(it.quantidade)}</qTrib>` +
    `<vUnTrib>${n4(it.precoUnitario)}</vUnTrib>` +
    // Ordem fixada pelo layout NF-e 4.00: vFrete, vSeg, vDesc, vOutro — depois indTot.
    // Só saem quando > 0 (campos opcionais; emitir "0.00" é ruído no XML).
    (vFrete > 0 ? `<vFrete>${n2(vFrete)}</vFrete>` : '') +
    (vDesc > 0 ? `<vDesc>${n2(vDesc)}</vDesc>` : '') +
    (vOutro > 0 ? `<vOutro>${n2(vOutro)}</vOutro>` : '') +
    `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto>` +
    icms +
    grupoPisCofins('PIS', it.cstPis, it.aliqPis, vBC) +
    grupoPisCofins('COFINS', it.cstCofins, it.aliqCofins, vBC) +
    `</imposto>` +
    `</det>`
  );
}

// Monta o <NFe><infNFe ...>…</infNFe></NFe> (sem <Signature>).
// Em HOMOLOGAÇÃO a descrição do PRIMEIRO item tem de ser exatamente esta (regra I04-10 —
// rejeição 373). É o que marca, dentro do próprio documento, que ele não vale como fiscal.
export const DESCRICAO_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

export function montarNfceXml(inp: NfceInput): string {
  const c = inp.config;
  const homologacao = String(c.ambiente ?? '2') !== '1';
  const crt = Number(c.crt) || 1;
  const vProdItens = inp.itens.map(
    (it) => Number(it.quantidade) * Number(it.precoUnitario),
  );
  const vProd = vProdItens.reduce((s, v) => s + v, 0);

  // ===== Desconto e frete do PEDIDO → rateados nos itens =====
  // A SEFAZ valida que `total/ICMSTot/vDesc` é o SOMATÓRIO dos `det/prod/vDesc`
  // (regra W16-10) e o mesmo para vFrete (W14-10) e para vOutro (W15-10). Declarar só no total rejeita a
  // nota. Por isso o rateio é em CENTAVOS: em float a soma não fecha.
  // O desconto é limitado ao valor dos produtos — vNF negativo também é rejeitado.
  const vDescTotal = Math.min(Math.max(0, Number(inp.desconto) || 0), vProd);
  const vFreteTotal = Math.max(0, Number(inp.frete) || 0);
  const vOutroTotal = Math.max(0, Number(inp.outras) || 0);

  // ===== Coerência do bloco "entrega a domicílio" =====
  // Cada uma destas quatro é uma rejeição da SEFAZ, e todas nascem do mesmo lugar: `indPres=4`
  // não é um rótulo, é um contrato. Quem declara entrega tem de dizer PARA QUEM, ONDE e POR
  // QUEM ela vai. Verificamos aqui, antes de gastar número de nota, em vez de descobrir no
  // retorno — número queimado só se recupera por inutilização.
  const indPres = inp.indPres === 4 ? 4 : 1;
  // Contingência: ou vêm os DOIS campos, ou a nota é normal. Meio grupo é rejeição 557.
  const contingencia = inp.contingencia?.dhCont && String(inp.contingencia.xJust ?? '').trim()
    ? { dhCont: inp.contingencia.dhCont, xJust: String(inp.contingencia.xJust).trim() }
    : null;
  if (inp.contingencia && !contingencia)
    throw new Error('Contingencia exige data/hora de entrada e justificativa (rejeicao 557).');
  if (contingencia && (contingencia.xJust.length < 15 || contingencia.xJust.length > 256))
    throw new Error('A justificativa de entrada em contingencia precisa ter de 15 a 256 caracteres.');
  const tpEmis = contingencia ? 9 : 1;
  // O `tpEmis` é o 35º dígito da CHAVE (índice 34: cUF2 + AAMM4 + CNPJ14 + mod2 + série3 +
  // número9 = 34 antes dele). Chave montada como normal e `ide` dizendo contingência — ou o
  // contrário — é uma nota que não fecha consigo mesma, e a SEFAZ devolve chave divergente.
  if (String(inp.chave ?? '').length === 44 && Number(String(inp.chave)[34]) !== tpEmis)
    throw new Error(
      `A chave de acesso foi montada com tpEmis=${String(inp.chave)[34]} e esta nota é ${contingencia ? 'de contingencia (9)' : 'normal (1)'}.`,
    );
  if (indPres === 4) {
    if (!inp.dest?.documento) throw new Error('Entrega a domicilio exige o documento do destinatario (rejeicao 787).');
    if (!inp.dest?.endereco) throw new Error('Entrega a domicilio exige o endereco do destinatario (rejeicao 788).');
    if (!inp.transportador?.nome) throw new Error('Entrega a domicilio exige os dados do transportador (rejeicao 786).');
  } else if (inp.transportador?.nome) {
    // X03-10: transportador em NFC-e que não é entrega a domicílio é rejeição 754. O simétrico
    // da 786 — e tão fácil de cair nele quanto, porque o pedido tem entregador mesmo quando a
    // nota sai como presencial (pedido sem CPF).
    throw new Error('Transportador so pode ser declarado em operacao de entrega (indPres=4) — rejeicao 754.');
  } else if (vFreteTotal > 0) {
    // X02-10 → 753: "NFC-e com Frete" quando `modFrete<>9` e `indPres<>4`. Se a taxa de entrega
    // precisa entrar numa nota presencial (pedido sem CPF do cliente), ela vai como ITEM da
    // venda, nunca como frete — o total tem de bater com o que o cliente pagou.
    throw new Error('Frete so pode ser declarado em operacao de entrega (indPres=4) — rejeicao 753.');
  }

  // Intermediador: ou o grupo sai INTEIRO e o `indIntermed` vai 1, ou o pedido não é de
  // marketplace e vai 0. Dado pela metade não vira 0 em silêncio — seria declarar à SEFAZ que
  // a venda foi direta quando não foi.
  const xmlIntermed = grupoIntermed(inp.intermediador);
  if (inp.intermediador && !xmlIntermed)
    throw new Error('Pedido de marketplace sem CNPJ do intermediador ou sem a identificacao da loja no app.');
  const descPorItem = ratearReais(vProdItens, vDescTotal);
  const fretePorItem = ratearReais(vProdItens, vFreteTotal);
  const outroPorItem = ratearReais(vProdItens, vOutroTotal);

  const dets = inp.itens
    .map((it, i) =>
      detItem(
        {
          ...it,
          descricao: homologacao && i === 0 ? DESCRICAO_HOMOLOGACAO : it.descricao,
          vDesc: descPorItem[i],
          vFrete: fretePorItem[i],
          vOutro: outroPorItem[i],
        },
        i,
        crt,
      ),
    )
    .join('');
  // vNF = produtos − desconto + frete (os demais componentes são 0 neste layout).
  const vNF = vProd - vDescTotal + vFreteTotal + vOutroTotal;
  const tPag = TPAG[String(inp.forma || 'dinheiro')] || '99';

  const ide =
    `<ide>` +
    `<cUF>${soDig(c.codigoUf)}</cUF>` +
    `<cNF>${inp.cNF}</cNF>` +
    `<natOp>Venda</natOp>` +
    `<mod>65</mod>` +
    // A série vem de quem reservou o número (`fiscal_serie`, por origem), não da config:
    // a nuvem e a loja usam séries diferentes e a chave tem de bater com o `ide`.
    `<serie>${Number(inp.serie)}</serie>` +
    `<nNF>${inp.numero}</nNF>` +
    `<dhEmi>${inp.dhEmi}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${soDig(c.codigoMunicipio)}</cMunFG>` +
    `<tpImp>4</tpImp>` + // 4 = DANFE NFC-e
    // O tpEmis é o 35º dígito da CHAVE: quem monta a chave e quem monta o `ide` têm de
    // concordar, senão a SEFAZ devolve "chave de acesso difere da informada".
    `<tpEmis>${tpEmis}</tpEmis>` +
    `<cDV>${inp.chave.slice(-1)}</cDV>` +
    `<tpAmb>${c.ambiente ?? '2'}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>${indPres}</indPres>` +
    // B25c-10: `indIntermed` é OBRIGATÓRIO quando `indPres` é 1, 2, 3, 4 ou 9 (com tpNF=1 e
    // finNFe=1, que é sempre o nosso caso) — e nós só emitimos 1 e 4, então SEMPRE sai. Faltando,
    // é rejeição 434, em produção desde 04/04/2022. O espelho é a B25c-20: com `indPres` fora
    // dessa lista o campo é PROIBIDO (rejeição 435) — o que só passaria a importar se um dia
    // emitíssemos `indPres=5`.
    `<indIntermed>${xmlIntermed ? '1' : '0'}</indIntermed>` +
    `<procEmi>0</procEmi>` +
    `<verProc>Regem-1.0</verProc>` +
    // Últimos elementos do grupo, nesta ordem (leiaute 4.00).
    (contingencia ? `<dhCont>${esc(contingencia.dhCont)}</dhCont><xJust>${esc(contingencia.xJust)}</xJust>` : '') +
    `</ide>`;

  const emit =
    `<emit>` +
    `<CNPJ>${soDig(c.cnpj)}</CNPJ>` +
    `<xNome>${esc(c.razaoSocial || 'EMITENTE')}</xNome>` +
    (c.nomeFantasia ? `<xFant>${esc(c.nomeFantasia)}</xFant>` : '') +
    // Ordem fixada pelo leiaute 4.00: xLgr, nro, xCpl, xBairro, cMun, xMun, UF, CEP…
    // `xBairro` é OBRIGATÓRIO e não era emitido. `xMun` é o nome do MUNICÍPIO — levava a
    // UF, que é o campo seguinte. Nada aqui tem padrão: `emitente.camposFaltando()` barra
    // a emissão antes de chegar neste ponto (documento fiscal não se completa por conta
    // própria).
    `<enderEmit>` +
    `<xLgr>${esc(c.endereco)}</xLgr>` +
    `<nro>${esc(c.numero)}</nro>` +
    // xCpl ("LOJA 02") era recebido da configuração e nunca escrito — o endereço da nota
    // saía diferente do cadastrado na SEFAZ.
    (String(c.complemento ?? '').trim() ? `<xCpl>${esc(c.complemento)}</xCpl>` : '') +
    `<xBairro>${esc(c.bairro)}</xBairro>` +
    `<cMun>${soDig(c.codigoMunicipio)}</cMun>` +
    `<xMun>${esc(c.municipio)}</xMun>` +
    `<UF>${esc(c.uf)}</UF>` +
    // CEP é OBRIGATÓRIO no emitente (TEnderEmi, 1-1) e vem ANTES de cPais. Sai sempre: sem
    // ele a SEFAZ rejeita com 225 apontando o `cPais` — o elemento que apareceu no lugar do
    // que faltava (ERR-086). Quem garante que existe é o pré-voo.
    `<CEP>${soDig(c.cep).padStart(8, '0')}</CEP>` +
    `<cPais>1058</cPais><xPais>BRASIL</xPais>` +
    `</enderEmit>` +
    `<IE>${soDig(c.ie) || 'ISENTO'}</IE>` +
    `<CRT>${crt}</CRT>` +
    `</emit>`;

  const total =
    `<total><ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${n2(vProd)}</vProd>` +
    `<vFrete>${n2(vFreteTotal)}</vFrete><vSeg>0.00</vSeg><vDesc>${n2(vDescTotal)}</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>${n2(vOutroTotal)}</vOutro>` +
    `<vNF>${n2(vNF)}</vNF>` +
    `</ICMSTot></total>`;

  // vPag TEM de fechar com o vNF (regra YA09) — com desconto/frete na nota, pagar o
  // valor dos produtos deixaria a nota inconsistente.
  const pag =
    `<pag><detPag><indPag>0</indPag><tPag>${tPag}</tPag><vPag>${n2(vNF)}</vPag></detPag></pag>`;

  const infNFe =
    `<infNFe versao="4.00" Id="NFe${inp.chave}">` +
    ide +
    emit +
    // Ordem do leiaute: ide, emit, dest, det…, total, transp, pag, infIntermed, infAdic, infRespTec.
    grupoDest(inp.dest) +
    dets +
    total +
    grupoTransp(vFreteTotal, inp.transportador) +
    pag +
    xmlIntermed +
    `<infAdic><infCpl>Documento emitido por Regem</infCpl></infAdic>` +
    grupoRespTec(inp.respTec) +
    `</infNFe>`;

  // NFC-e: o QR Code e a URL de consulta vão num grupo PRÓPRIO, fora do <infNFe> — por isso
  // não entram na assinatura, que vem depois dele. O builder recebia o QR e NÃO o escrevia:
  // a nota sairia sem QR Code, que é rejeição. CDATA porque o QR tem '&', '?' e '|'.
  const infNFeSupl =
    `<infNFeSupl><qrCode><![CDATA[${inp.qrCode}]]></qrCode>` +
    `<urlChave>${esc(inp.urlChave)}</urlChave></infNFeSupl>`;

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}${infNFeSupl}</NFe>`;
}

/**
 * Marketplace: CNPJ do intermediador + a identificação da LOJA no app dele (`idCadIntTran`),
 * que é o que permite à fiscalização casar a nota com o repasse da plataforma. Ambos são
 * obrigatórios dentro do grupo — por isso, sem os dois, o grupo não sai e o `indIntermed`
 * do `ide` já terá saído como 0. Quem decide se o pedido é de marketplace é o serviço.
 */
function grupoIntermed(m?: NfceIntermediador | null): string {
  const cnpj = soDig(m?.cnpj);
  const id = String(m?.idCadIntTran ?? '').trim();
  if (cnpj.length !== 14 || !id) return '';
  return `<infIntermed><CNPJ>${cnpj}</CNPJ><idCadIntTran>${esc(id)}</idCadIntTran></infIntermed>`;
}

// <infRespTec>: vem DEPOIS de <infAdic> no leiaute. Só sai com os quatro campos preenchidos —
// grupo pela metade é rejeição de schema.
function grupoRespTec(r: NfceInput['respTec']): string {
  const cnpj = soDig(r?.cnpj);
  const fone = soDig(r?.fone);
  if (!r || cnpj.length !== 14 || !r.contato || !r.email || fone.length < 6) return '';
  return (
    `<infRespTec><CNPJ>${cnpj}</CNPJ><xContato>${esc(r.contato)}</xContato>` +
    `<email>${esc(r.email)}</email><fone>${fone}</fone></infRespTec>`
  );
}

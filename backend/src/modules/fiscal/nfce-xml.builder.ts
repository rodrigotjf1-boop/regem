/* eslint-disable @typescript-eslint/no-explicit-any */
// Builder do XML da NFC-e 4.00 (infNFe, sem assinatura — a assinatura é o "plug"
// do certificado). Estrutura simplificada nos grupos de tributos (Simples/CSOSN
// + PIS/COFINS não tributados); os valores fiscais reais devem ser validados em
// HOMOLOGAÇÃO com o certificado antes de produção.

import { ratearReais } from '../../common/rateio';

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
  // Valores do PEDIDO (não do item). O builder rateia entre os itens; ver a nota
  // sobre as regras W14/W16 em `montarNfceXml`.
  desconto?: number; // desconto bancado pela LOJA (o do marketplace não é desconto na nota)
  frete?: number; // taxa de entrega QUANDO é da loja (receita dela, compõe a operação)
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

function detItem(it: NfceItem, i: number, crt: number): string {
  const vProd = Number(it.quantidade) * Number(it.precoUnitario);
  const vDesc = Number(it.vDesc) || 0;
  const vFrete = Number(it.vFrete) || 0;
  // Base de PIS/COFINS é o valor LÍQUIDO da linha: desconto reduz, frete compõe.
  // Usar o vProd cheio inflaria o imposto de quem tributa (CST 01/02).
  const vBC = Math.max(0, vProd - vDesc + vFrete);
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
export function montarNfceXml(inp: NfceInput): string {
  const c = inp.config;
  const crt = Number(c.crt) || 1;
  const vProdItens = inp.itens.map(
    (it) => Number(it.quantidade) * Number(it.precoUnitario),
  );
  const vProd = vProdItens.reduce((s, v) => s + v, 0);

  // ===== Desconto e frete do PEDIDO → rateados nos itens =====
  // A SEFAZ valida que `total/ICMSTot/vDesc` é o SOMATÓRIO dos `det/prod/vDesc`
  // (regra W16-10) e o mesmo para vFrete (W14-10). Declarar só no total rejeita a
  // nota. Por isso o rateio é em CENTAVOS: em float a soma não fecha.
  // O desconto é limitado ao valor dos produtos — vNF negativo também é rejeitado.
  const vDescTotal = Math.min(Math.max(0, Number(inp.desconto) || 0), vProd);
  const vFreteTotal = Math.max(0, Number(inp.frete) || 0);
  const descPorItem = ratearReais(vProdItens, vDescTotal);
  const fretePorItem = ratearReais(vProdItens, vFreteTotal);

  const dets = inp.itens
    .map((it, i) =>
      detItem({ ...it, vDesc: descPorItem[i], vFrete: fretePorItem[i] }, i, crt),
    )
    .join('');
  // vNF = produtos − desconto + frete (os demais componentes são 0 neste layout).
  const vNF = vProd - vDescTotal + vFreteTotal;
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
    `<tpEmis>1</tpEmis>` +
    `<cDV>${inp.chave.slice(-1)}</cDV>` +
    `<tpAmb>${c.ambiente ?? '2'}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>Regem-1.0</verProc>` +
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
    `<xBairro>${esc(c.bairro)}</xBairro>` +
    `<cMun>${soDig(c.codigoMunicipio)}</cMun>` +
    `<xMun>${esc(c.municipio)}</xMun>` +
    `<UF>${esc(c.uf)}</UF>` +
    (soDig(c.cep) ? `<CEP>${soDig(c.cep).padStart(8, '0')}</CEP>` : '') +
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
    `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
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
    dets +
    total +
    // modFrete 9 = sem ocorrência de transporte; 0 = frete por conta do remetente
    // (a loja cobra a entrega e a contrata) — declarar 9 com vFrete > 0 é rejeição.
    `<transp><modFrete>${vFreteTotal > 0 ? '0' : '9'}</modFrete></transp>` +
    pag +
    `<infAdic><infCpl>Documento emitido por Regem</infCpl></infAdic>` +
    `</infNFe>`;

  // NFC-e: o QR Code e a URL de consulta vão num grupo PRÓPRIO, fora do <infNFe> — por isso
  // não entram na assinatura, que vem depois dele. O builder recebia o QR e NÃO o escrevia:
  // a nota sairia sem QR Code, que é rejeição. CDATA porque o QR tem '&', '?' e '|'.
  const infNFeSupl =
    `<infNFeSupl><qrCode><![CDATA[${inp.qrCode}]]></qrCode>` +
    `<urlChave>${esc(inp.urlChave)}</urlChave></infNFeSupl>`;

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}${infNFeSupl}</NFe>`;
}

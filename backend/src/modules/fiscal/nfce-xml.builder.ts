/* eslint-disable @typescript-eslint/no-explicit-any */
// Builder do XML da NFC-e 4.00 (infNFe, sem assinatura — a assinatura é o "plug"
// do certificado). Estrutura simplificada nos grupos de tributos (Simples/CSOSN
// + PIS/COFINS não tributados); os valores fiscais reais devem ser validados em
// HOMOLOGAÇÃO com o certificado antes de produção.

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
  numero: number;
  chave: string; // 44 díg (sem "NFe")
  cNF: string;
  dhEmi: string; // ISO com timezone
  itens: NfceItem[];
  forma?: string | null;
  qrCode: string;
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
    `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto>` +
    icms +
    grupoPisCofins('PIS', it.cstPis, it.aliqPis, vProd) +
    grupoPisCofins('COFINS', it.cstCofins, it.aliqCofins, vProd) +
    `</imposto>` +
    `</det>`
  );
}

// Monta o <NFe><infNFe ...>…</infNFe></NFe> (sem <Signature>).
export function montarNfceXml(inp: NfceInput): string {
  const c = inp.config;
  const crt = Number(c.crt) || 1;
  const vTotal = inp.itens.reduce(
    (s, it) => s + Number(it.quantidade) * Number(it.precoUnitario),
    0,
  );
  const dets = inp.itens.map((it, i) => detItem(it, i, crt)).join('');
  const tPag = TPAG[String(inp.forma || 'dinheiro')] || '99';

  const ide =
    `<ide>` +
    `<cUF>${c.codigoUf ?? 35}</cUF>` +
    `<cNF>${inp.cNF}</cNF>` +
    `<natOp>Venda</natOp>` +
    `<mod>65</mod>` +
    `<serie>${c.serie ?? 1}</serie>` +
    `<nNF>${inp.numero}</nNF>` +
    `<dhEmi>${inp.dhEmi}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${c.codigoMunicipio ?? 3550308}</cMunFG>` +
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
    `<enderEmit>` +
    `<xLgr>${esc(c.endereco || 'N/D')}</xLgr>` +
    `<nro>SN</nro>` +
    `<xMun>${esc(c.uf || 'N/D')}</xMun>` +
    `<UF>${esc(c.uf || 'SP')}</UF>` +
    `<cMun>${c.codigoMunicipio ?? 3550308}</cMun>` +
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
    `<vProd>${n2(vTotal)}</vProd>` +
    `<vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro>` +
    `<vNF>${n2(vTotal)}</vNF>` +
    `</ICMSTot></total>`;

  const pag =
    `<pag><detPag><indPag>0</indPag><tPag>${tPag}</tPag><vPag>${n2(vTotal)}</vPag></detPag></pag>`;

  const infNFe =
    `<infNFe versao="4.00" Id="NFe${inp.chave}">` +
    ide +
    emit +
    dets +
    total +
    `<transp><modFrete>9</modFrete></transp>` +
    pag +
    `<infAdic><infCpl>Documento emitido por Regem</infCpl></infAdic>` +
    `</infNFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`;
}

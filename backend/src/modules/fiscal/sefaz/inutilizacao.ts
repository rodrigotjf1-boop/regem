import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { CertificadoCliente, campo, chamarSefaz } from './soap';
import { urlServicoNfce } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// INUTILIZAÇÃO DE NUMERAÇÃO (NFeInutilizacao4 / `nfeInutilizacaoNF`).
//
// Número de NFC-e que não virou documento autorizado deixa um buraco na sequência — e buraco
// tem prazo: o Ajuste SINIEF 19/16, cl. 16ª, manda pedir a inutilização **até o 10º dia do mês
// seguinte**; a cl. 11ª, §5º diz o que acontece se não pedir: "constatada, a partir do 11º dia
// do mês subsequente, quebra da ordem sequencial (…) sem que tenha havido a inutilização,
// considerar-se-á que a numeração correspondente a esse intervalo se refere a documentos
// emitidos em contingência e não transmitidos" — na prática, presunção de venda sem nota.
//
// E não há a saída fácil de reaproveitar o número. MOC 7.0, Anexo III, nota 2 (literal): "a
// manutenção do número e série somente se aplica para os casos de rejeição da NF-e que foi
// emitida em contingência, e NUNCA para os casos em que a NF-e foi normalmente emitida mas o
// contribuinte não obteve êxito na consulta sobre o resultado da autorização". Para essas, o
// mesmo manual manda: "inutilizar a numeração das NF-e Pendentes de Retorno que não foram
// autorizadas ou denegadas".
//
// ⚠️ É IRREVERSÍVEL: homologada, aquela faixa nunca mais pode virar nota. Quem chama tem de
// garantir que não há documento válido dentro dela.

export type ResultadoInutilizacao =
  | { situacao: 'homologada'; cStat: string; xMotivo: string; protocolo: string; dhRecbto: string | null; procInutNFe: string }
  | { situacao: 'rejeitada'; cStat: string; xMotivo: string };

const HOMOLOGADA = '102'; // "Inutilização de número homologado"

const soDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const zero = (n: number | string, tam: number) => soDig(n).padStart(tam, '0').slice(-tam);

/**
 * Id do pedido: "ID" + cUF(2) + ano(2) + CNPJ(14) + mod(2) + série(3) + nNFIni(9) + nNFFin(9).
 * São 41 dígitos — o schema exige exatamente `ID[0-9]{41}`.
 */
export function idInutilizacao(p: {
  codigoUf: number | string;
  ano2: string;
  cnpj: string;
  modelo?: string;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
}): string {
  return (
    'ID' +
    zero(p.codigoUf, 2) +
    zero(p.ano2, 2) +
    zero(p.cnpj, 14) +
    zero(p.modelo ?? '65', 2) +
    zero(p.serie, 3) +
    zero(p.numeroInicial, 9) +
    zero(p.numeroFinal, 9)
  );
}

export function montarInutNFe(p: {
  ambiente: string;
  codigoUf: number | string;
  ano2: string;
  cnpj: string;
  modelo?: string;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
}): string {
  const just = String(p.justificativa ?? '').trim();
  // A SEFAZ exige de 15 a 255 caracteres. Recusar aqui é melhor do que levar rejeição.
  if (just.length < 15 || just.length > 255)
    throw new Error('A justificativa da inutilização precisa ter de 15 a 255 caracteres.');
  if (p.numeroFinal < p.numeroInicial) throw new Error('Faixa inválida: o número final é menor que o inicial.');
  const id = idInutilizacao(p);
  const amb = String(p.ambiente) === '1' ? '1' : '2';
  return (
    `<inutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<infInut Id="${id}">` +
    `<tpAmb>${amb}</tpAmb><xServ>INUTILIZAR</xServ>` +
    `<cUF>${zero(p.codigoUf, 2)}</cUF><ano>${zero(p.ano2, 2)}</ano>` +
    `<CNPJ>${soDig(p.cnpj)}</CNPJ><mod>${zero(p.modelo ?? '65', 2)}</mod>` +
    `<serie>${Number(p.serie)}</serie>` +
    `<nNFIni>${Number(p.numeroInicial)}</nNFIni><nNFFin>${Number(p.numeroFinal)}</nNFFin>` +
    `<xJust>${just.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</xJust>` +
    `</infInut></inutNFe>`
  );
}

function elemento(xml: string, nome: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lista = doc.getElementsByTagNameNS('*', nome);
  return lista && lista.length ? new XMLSerializer().serializeToString(lista[0]) : null;
}

/** O comprovante a guardar: pedido assinado + retorno protocolado. */
export function montarProcInutNFe(pedidoAssinado: string, retorno: string): string {
  const pedido = pedidoAssinado.replace(/^\s*<\?xml[^>]*\?>/, '');
  const ret = retorno.replace(/^\s*<\?xml[^>]*\?>/, '');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<ProcInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${pedido}${ret}</ProcInutNFe>`
  );
}

export function lerRetornoInutilizacao(retorno: string, pedidoAssinado: string): ResultadoInutilizacao {
  const cStat = campo(retorno, 'cStat') ?? '';
  const xMotivo = campo(retorno, 'xMotivo') ?? '';
  if (cStat !== HOMOLOGADA) return { situacao: 'rejeitada', cStat, xMotivo };
  return {
    situacao: 'homologada',
    cStat,
    xMotivo,
    protocolo: campo(retorno, 'nProt') ?? '',
    dhRecbto: campo(retorno, 'dhRecbto'),
    procInutNFe: montarProcInutNFe(pedidoAssinado, elemento(retorno, 'retInutNFe') ?? retorno),
  };
}

export async function inutilizarNfce(p: {
  uf: string;
  ambiente: string;
  pedidoAssinado: string;
  cert: CertificadoCliente;
  ca?: string[]; // só para teste
  url?: string; // só para teste
}): Promise<ResultadoInutilizacao> {
  const pedido = p.pedidoAssinado.replace(/^\s*<\?xml[^>]*\?>/, '');
  if (!pedido.startsWith('<inutNFe') || !/<Signature[\s>]/.test(pedido))
    throw new Error('O pedido de inutilização precisa estar ASSINADO.');
  const ambiente = String(p.ambiente) === '1' ? '1' : '2';
  const url = p.url ?? urlServicoNfce(p.uf, ambiente, 'NFeInutilizacao4');
  const retorno = await chamarSefaz({
    url,
    servico: 'NFeInutilizacao4',
    corpoXml: pedido,
    cert: p.cert,
    ca: p.ca,
  });
  return lerRetornoInutilizacao(retorno, pedido);
}

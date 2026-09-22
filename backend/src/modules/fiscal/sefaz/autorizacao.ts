import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { CertificadoCliente, campo, chamarSefaz } from './soap';
import { urlServicoNfce } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUTORIZAÇÃO DA NFC-e (NFeAutorizacao4), SÍNCRONA.
//
// A NFC-e só aceita resposta síncrona: lote com UMA nota e indSinc=1 (NT 2025.001 — pedir
// assíncrona é rejeição 452). A SEFAZ devolve o resultado do lote e, dentro dele, o da nota:
//
//   <retEnviNFe> cStat do LOTE: 104 "Lote processado" → vale o <protNFe>;
//                               outro código → o lote inteiro foi recusado (schema, emitente…)
//     <protNFe><infProt> cStat da NOTA: 100/150/120 = autorizada; outro = rejeitada
//
// Autorizada, o que se guarda é o nfeProc = <NFe> assinada + <protNFe> — é ESTE o documento
// fiscal (guarda de 5 anos), não o XML enviado.

export type ResultadoAutorizacao =
  | { situacao: 'autorizada'; cStat: string; xMotivo: string; protocolo: string; dhRecbto: string | null; nfeProc: string }
  | { situacao: 'rejeitada'; cStat: string; xMotivo: string; nivel: 'nota' | 'lote' }
  | { situacao: 'pendente'; cStat: string; xMotivo: string; recibo: string | null };

const AUTORIZADO = new Set(['100', '120', '150']);

function protNFeDe(retorno: string): string | null {
  const doc = new DOMParser().parseFromString(retorno, 'text/xml');
  const lista = doc.getElementsByTagNameNS('*', 'protNFe');
  return lista && lista.length ? new XMLSerializer().serializeToString(lista[0]) : null;
}

/** Monta o nfeProc (NFe assinada + protocolo). */
export function montarNfeProc(nfeAssinada: string, protNFe: string): string {
  const nfe = nfeAssinada.replace(/^\s*<\?xml[^>]*\?>/, '');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${nfe}${protNFe}</nfeProc>`
  );
}

/** Lê a resposta da autorização. Separado da chamada para ser testado com respostas reais. */
export function lerRetornoAutorizacao(retorno: string, nfeAssinada: string): ResultadoAutorizacao {
  const cStatLote = campo(retorno, 'cStat') ?? '';
  const xMotivoLote = campo(retorno, 'xMotivo') ?? '';

  if (cStatLote === '103') {
    // "Lote recebido": resposta assíncrona. Não deveria acontecer com indSinc=1 na NFC-e; se
    // vier, a nota NÃO está autorizada nem rejeitada — está em processamento.
    return { situacao: 'pendente', cStat: cStatLote, xMotivo: xMotivoLote, recibo: campo(retorno, 'nRec') };
  }
  if (cStatLote !== '104') return { situacao: 'rejeitada', cStat: cStatLote, xMotivo: xMotivoLote, nivel: 'lote' };

  const prot = protNFeDe(retorno);
  if (!prot) return { situacao: 'rejeitada', cStat: cStatLote, xMotivo: 'Lote processado sem <protNFe>', nivel: 'lote' };
  const cStat = campo(prot, 'cStat') ?? '';
  const xMotivo = campo(prot, 'xMotivo') ?? '';
  if (!AUTORIZADO.has(cStat)) return { situacao: 'rejeitada', cStat, xMotivo, nivel: 'nota' };
  return {
    situacao: 'autorizada',
    cStat,
    xMotivo,
    protocolo: campo(prot, 'nProt') ?? '',
    dhRecbto: campo(prot, 'dhRecbto'),
    nfeProc: montarNfeProc(nfeAssinada, prot),
  };
}

export async function autorizarNfce(p: {
  uf: string;
  ambiente: string;
  xmlAssinado: string;
  cert: CertificadoCliente;
  idLote?: string;
  ca?: string[]; // só para teste
  url?: string; // só para teste
}): Promise<ResultadoAutorizacao> {
  const nfe = p.xmlAssinado.replace(/^\s*<\?xml[^>]*\?>/, '');
  if (!nfe.startsWith('<NFe') || !/<Signature[\s>]/.test(nfe))
    throw new Error('Só se transmite NFC-e ASSINADA (elemento <NFe> com <Signature>).');
  // idLote: até 15 dígitos, escolhido pelo emissor. O instante em milissegundos serve.
  const idLote = (p.idLote ?? String(Date.now())).replace(/\D/g, '').slice(-15) || '1';
  const corpo =
    `<enviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${idLote}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`;
  const url = p.url ?? urlServicoNfce(p.uf, p.ambiente, 'NFeAutorizacao4');
  const retorno = await chamarSefaz({ url, servico: 'NFeAutorizacao4', corpoXml: corpo, cert: p.cert, ca: p.ca });
  return lerRetornoAutorizacao(retorno, nfe);
}

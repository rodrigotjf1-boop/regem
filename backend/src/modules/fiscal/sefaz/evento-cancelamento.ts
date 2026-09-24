import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { CertificadoCliente, campo, chamarSefaz } from './soap';
import { urlServicoNfce } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CANCELAMENTO POR SUBSTITUIÇÃO (evento 110112, RecepcaoEvento4) — exclusivo da NFC-e.
//
// O problema que ele resolve tem nome no manual (MOC 7.0, §3.5): "a emissão em duplicidade
// ocorre quando um contribuinte solicita a autorização de uso de uma NFC-e (NFC-e 1), porém,
// por algum motivo, não obtém a resposta a esta solicitação. Para acobertar a operação e
// fornecer o DANFE NFC-e para o consumidor, emite uma outra NFC-e (NFC-e 2)… Ao se
// restabelecer a comunicação, verifica-se que a 'NFC-e 1' havia sido regularmente autorizada".
//
// É exatamente o nosso caso: a consulta disse "não consta" (217), emitimos a segunda, e a
// primeira aparece autorizada depois. Ficam DUAS notas para a mesma venda. A saída legal é
// cancelar a que NÃO acobertou a operação, REFERENCIANDO a que a substituiu — em no máximo
// **168 horas** da autorização (MOC, regra 2P12-18; Ajuste SINIEF 19/16, cl. 15ª-A). Passado o
// prazo, a rejeição é "Prazo de cancelamento superior ao previsto na Legislação" e a loja fica
// com a duplicidade nos livros.
//
// Campos exclusivos deste evento (e que faltando viram rejeição): `cOrgaoAutor` (UF da chave),
// `tpAutor` = 1 (empresa emitente), `verAplic` e `chNFeRef` (a chave da nota SUBSTITUTA).

// CANCELAMENTO COMUM (evento 110111). O caso do dia a dia: venda errada, desistência, item
// trocado. Leiaute oficial (`e110111_v1.00.xsd`, pacote Evento_Canc_PL_v1.01 da NT 2018.004):
// o `detEvento` leva SÓ `descEvento` ("Cancelamento"), `nProt` e `xJust` — os quatro campos
// exclusivos do 110112 (`cOrgaoAutor`, `tpAutor`, `verAplic`, `chNFeRef`) não existem aqui.
//
// Prazo: o Ajuste SINIEF 19/16 (cl. 15ª) dá **30 minutos** da autorização para a NFC-e, "podendo
// ser reduzido a critério de cada unidade federada" — 30 é o TETO nacional. Fora do prazo a
// SEFAZ devolve **501** ("Prazo de cancelamento superior ao previsto na Legislação"). No RJ o
// prazo é 30 minutos e só vale se a mercadoria não circulou; passado isso existe o "Sistema de
// Reabertura de Prazo para Cancelamento" no portal da SEFAZ-RJ.
export const TP_EVENTO_CANCELAMENTO = '110111';
export const DESC_EVENTO_CANCELAMENTO = 'Cancelamento';
export const PRAZO_CANCELAMENTO_MINUTOS = 30;

export const TP_EVENTO_CANC_SUBST = '110112';
// Sem acento: o valor é FIXO no schema, e "substituição" não passaria.
export const DESC_EVENTO_CANC_SUBST = 'Cancelamento por substituicao';
export const PRAZO_CANC_SUBST_HORAS = 168;

export type ResultadoEvento =
  | { situacao: 'registrado'; cStat: string; xMotivo: string; protocolo: string; dhRegEvento: string | null; procEventoNFe: string }
  | { situacao: 'rejeitado'; cStat: string; xMotivo: string };

// 135 = registrado e vinculado à NF-e; 155 = cancelamento homologado fora de prazo (a UF pode
// aceitar). 136 ("registrado mas NÃO vinculado") não serve: o cancelamento não pegou na nota.
const REGISTRADO = new Set(['135', '155']);

const soDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string));

/** Id do evento: "ID" + tpEvento(6) + chave(44) + nSeqEvento(2) = 52 dígitos. */
export function idEvento(tpEvento: string, chave: string, nSeq = 1): string {
  const ch = soDig(chave);
  if (ch.length !== 44) throw new Error('Chave de acesso inválida para o evento (precisa de 44 dígitos).');
  return `ID${tpEvento}${ch}${String(nSeq).padStart(2, '0')}`;
}

export function montarEventoCancSubst(p: {
  ambiente: string;
  codigoUf: number | string;
  cnpj: string;
  chave: string; // a nota que será CANCELADA
  protocolo: string; // o protocolo de autorização dela
  chaveSubstituta: string; // a nota que acobertou a venda
  justificativa: string;
  dhEvento: string; // já no fuso da UF (mesma regra do dhEmi)
  verAplic?: string;
  nSeqEvento?: number;
}): string {
  const just = String(p.justificativa ?? '').trim();
  if (just.length < 15 || just.length > 255)
    throw new Error('A justificativa do cancelamento precisa ter de 15 a 255 caracteres.');
  const chave = soDig(p.chave);
  const chaveRef = soDig(p.chaveSubstituta);
  if (chaveRef.length !== 44) throw new Error('Chave da NFC-e substituta inválida (precisa de 44 dígitos).');
  if (chaveRef === chave) throw new Error('A nota substituta não pode ser a própria nota cancelada.');
  const protocolo = soDig(p.protocolo);
  if (protocolo.length < 15) throw new Error('Protocolo de autorização inválido para o cancelamento.');

  const amb = String(p.ambiente) === '1' ? '1' : '2';
  const cOrgao = soDig(p.codigoUf).padStart(2, '0');
  const nSeq = p.nSeqEvento ?? 1;
  const id = idEvento(TP_EVENTO_CANC_SUBST, chave, nSeq);

  return (
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${String(Date.now()).replace(/\D/g, '').slice(-15)}</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>${cOrgao}</cOrgao><tpAmb>${amb}</tpAmb><CNPJ>${soDig(p.cnpj)}</CNPJ>` +
    `<chNFe>${chave}</chNFe><dhEvento>${p.dhEvento}</dhEvento>` +
    `<tpEvento>${TP_EVENTO_CANC_SUBST}</tpEvento><nSeqEvento>${nSeq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${DESC_EVENTO_CANC_SUBST}</descEvento>` +
    `<cOrgaoAutor>${cOrgao}</cOrgaoAutor><tpAutor>1</tpAutor>` +
    `<verAplic>${esc(p.verAplic ?? 'Regem-1.0')}</verAplic>` +
    `<nProt>${protocolo}</nProt><xJust>${esc(just)}</xJust><chNFeRef>${chaveRef}</chNFeRef>` +
    `</detEvento></infEvento></evento></envEvento>`
  );
}

export function montarEventoCancelamento(p: {
  ambiente: string;
  codigoUf: number | string;
  cnpj: string;
  chave: string; // a nota que será cancelada
  protocolo: string; // o protocolo de autorização dela
  justificativa: string;
  dhEvento: string; // já no fuso da UF (mesma regra do dhEmi)
  nSeqEvento?: number;
}): string {
  const just = String(p.justificativa ?? '').trim();
  if (just.length < 15 || just.length > 255)
    throw new Error('A justificativa do cancelamento precisa ter de 15 a 255 caracteres.');
  const chave = soDig(p.chave);
  const protocolo = soDig(p.protocolo);
  if (protocolo.length < 15) throw new Error('Protocolo de autorização inválido para o cancelamento.');

  const amb = String(p.ambiente) === '1' ? '1' : '2';
  const cOrgao = soDig(p.codigoUf).padStart(2, '0');
  const nSeq = p.nSeqEvento ?? 1;
  const id = idEvento(TP_EVENTO_CANCELAMENTO, chave, nSeq);

  return (
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${String(Date.now()).replace(/\D/g, '').slice(-15)}</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>${cOrgao}</cOrgao><tpAmb>${amb}</tpAmb><CNPJ>${soDig(p.cnpj)}</CNPJ>` +
    `<chNFe>${chave}</chNFe><dhEvento>${p.dhEvento}</dhEvento>` +
    `<tpEvento>${TP_EVENTO_CANCELAMENTO}</tpEvento><nSeqEvento>${nSeq}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${DESC_EVENTO_CANCELAMENTO}</descEvento>` +
    `<nProt>${protocolo}</nProt><xJust>${esc(just)}</xJust>` +
    `</detEvento></infEvento></evento></envEvento>`
  );
}

function elemento(xml: string, nome: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lista = doc.getElementsByTagNameNS('*', nome);
  return lista && lista.length ? new XMLSerializer().serializeToString(lista[0]) : null;
}

/** O comprovante do evento: o evento assinado + o retorno protocolado. */
export function montarProcEvento(eventoAssinado: string, retEvento: string): string {
  const ev = elemento(eventoAssinado, 'evento') ?? eventoAssinado;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">${ev}${retEvento}</procEventoNFe>`
  );
}

export function lerRetornoEvento(retorno: string, eventoAssinado: string): ResultadoEvento {
  // A resposta tem dois níveis, como a autorização: o do LOTE e o do EVENTO.
  const retEvento = elemento(retorno, 'retEvento');
  const cStatLote = campo(retorno, 'cStat') ?? '';
  if (!retEvento)
    return { situacao: 'rejeitado', cStat: cStatLote, xMotivo: campo(retorno, 'xMotivo') ?? 'Lote de evento recusado.' };

  const cStat = campo(retEvento, 'cStat') ?? '';
  const xMotivo = campo(retEvento, 'xMotivo') ?? '';
  if (!REGISTRADO.has(cStat)) return { situacao: 'rejeitado', cStat, xMotivo };
  return {
    situacao: 'registrado',
    cStat,
    xMotivo,
    protocolo: campo(retEvento, 'nProt') ?? '',
    dhRegEvento: campo(retEvento, 'dhRegEvento'),
    procEventoNFe: montarProcEvento(eventoAssinado, retEvento),
  };
}

/** Envia QUALQUER evento já assinado ao RecepcaoEvento4 e lê os dois níveis da resposta. */
export async function enviarEvento(p: {
  uf: string;
  ambiente: string;
  eventoAssinado: string;
  cert: CertificadoCliente;
  ca?: string[]; // só para teste
  url?: string; // só para teste
  /** Prazo TOTAL da chamada (ver `ChamadaSefaz.prazoTotalMs`). Sem ele, valem os 30 s de sempre. */
  prazoMs?: number;
}): Promise<ResultadoEvento> {
  return enviarEventoCancSubst(p);
}

export async function enviarEventoCancSubst(p: {
  uf: string;
  ambiente: string;
  eventoAssinado: string;
  cert: CertificadoCliente;
  ca?: string[]; // só para teste
  url?: string; // só para teste
  prazoMs?: number;
}): Promise<ResultadoEvento> {
  const xml = p.eventoAssinado.replace(/^\s*<\?xml[^>]*\?>/, '');
  if (!/<Signature[\s>]/.test(xml)) throw new Error('O evento precisa estar ASSINADO.');
  const ambiente = String(p.ambiente) === '1' ? '1' : '2';
  const url = p.url ?? urlServicoNfce(p.uf, ambiente, 'RecepcaoEvento4');
  const retorno = await chamarSefaz({
    url, servico: 'RecepcaoEvento4', corpoXml: xml, cert: p.cert, ca: p.ca,
    ...(p.prazoMs ? { timeoutMs: p.prazoMs, prazoTotalMs: p.prazoMs } : {}),
  });
  return lerRetornoEvento(retorno, xml);
}

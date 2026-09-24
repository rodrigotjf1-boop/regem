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
//     <protNFe><infProt> cStat da NOTA: 100/150/120 = autorizada; 110/301/302 = DENEGADA;
//                                       outro = rejeitada
//
// Autorizada, o que se guarda é o nfeProc = <NFe> assinada + <protNFe> — é ESTE o documento
// fiscal (guarda de 5 anos), não o XML enviado.
//
// ⚠️ **DENEGADA NÃO É REJEITADA, E A DIFERENÇA É O NÚMERO.** A denegada É GRAVADA na base da
// SEFAZ (a regra 2B08-40 devolve 205 "NF-e está denegada na base de dados" a quem tentar de
// novo): o número está CONSUMIDO para sempre — não se reaproveita e não se inutiliza (pedir
// inutilização de numeração já usada é recusado). A rejeitada nunca entrou na base: o número
// continua livre e, como a nossa numeração só anda para a frente (D9), vira lacuna a inutilizar.
// Tratar uma como a outra manda o lojista pedir inutilização de um número que a SEFAZ já tem.
//
// A irregularidade do emitente pode vir das DUAS formas, e isso é da UF, não nosso:
//   1C17-38 (55/65) → **781** "Emissor não habilitado para emissão da NF-e/NFC-e" — REJEIÇÃO;
//   1C17-40 (55/65) → **301** "Uso Denegado: Irregularidade fiscal do emitente" — DENEGAÇÃO.
// Por isso os dois caminhos existem aqui; não há como escolher um e ignorar o outro.

/**
 * Mensagem da SEFAZ para o emissor (`cMsg`/`xMsg` dentro de `infProt`, grupo opcional do
 * leiaute 4.00 — conferido no XSD oficial `leiauteNFe_v4.00.xsd`, tipo `TProtNFe`).
 *
 * É por aqui que a SEFAZ avisa alguma coisa sobre uma nota que foi AUTORIZADA — o caso do
 * `cStat 120` ("autorizado com alerta"). Quem não lê este grupo recebe o 120, trata como
 * sucesso e joga fora o aviso; quem trata o 120 como erro é pior ainda: cai em contingência e
 * emite de novo uma nota que já existe.
 */
export interface MensagemSefaz {
  codigo: string; // cMsg — até 4 dígitos
  texto: string; // xMsg — até 200 caracteres
}

export type ResultadoAutorizacao =
  | { situacao: 'autorizada'; cStat: string; xMotivo: string; protocolo: string; dhRecbto: string | null; nfeProc: string; mensagem?: MensagemSefaz }
  | { situacao: 'denegada'; cStat: string; xMotivo: string; protocolo: string | null; mensagem?: MensagemSefaz }
  | { situacao: 'rejeitada'; cStat: string; xMotivo: string; nivel: 'nota' | 'lote'; mensagem?: MensagemSefaz }
  | { situacao: 'pendente'; cStat: string; xMotivo: string; recibo: string | null };

const AUTORIZADO = new Set(['100', '120', '150']);
// 110 "Uso Denegado" · 301/302 irregularidade fiscal do emitente/destinatário.
const DENEGADO = new Set(['110', '301', '302']);

/** Lê o grupo `cMsg`/`xMsg` de um `protNFe`/`infProt`. Ausente é o normal. */
export function lerMensagemSefaz(prot: string | null | undefined): MensagemSefaz | undefined {
  if (!prot) return undefined;
  const codigo = campo(prot, 'cMsg');
  const texto = campo(prot, 'xMsg');
  if (!codigo && !texto) return undefined;
  return { codigo: codigo ?? '', texto: texto ?? '' };
}

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
  const mensagem = lerMensagemSefaz(prot);
  // Denegada antes de rejeitada: as duas "não autorizam", mas só a denegada consome o número.
  if (DENEGADO.has(cStat))
    return { situacao: 'denegada', cStat, xMotivo, protocolo: campo(prot, 'nProt') ?? null, mensagem };
  if (!AUTORIZADO.has(cStat)) return { situacao: 'rejeitada', cStat, xMotivo, nivel: 'nota', mensagem };
  return {
    situacao: 'autorizada',
    cStat,
    xMotivo,
    protocolo: campo(prot, 'nProt') ?? '',
    dhRecbto: campo(prot, 'dhRecbto'),
    nfeProc: montarNfeProc(nfeAssinada, prot),
    mensagem,
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
  /** Prazo TOTAL da chamada (ver `ChamadaSefaz.prazoTotalMs`). Sem ele, valem os 30 s de sempre. */
  prazoMs?: number;
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
  const retorno = await chamarSefaz({
    url, servico: 'NFeAutorizacao4', corpoXml: corpo, cert: p.cert, ca: p.ca,
    ...(p.prazoMs ? { timeoutMs: p.prazoMs, prazoTotalMs: p.prazoMs } : {}),
  });
  return lerRetornoAutorizacao(retorno, nfe);
}

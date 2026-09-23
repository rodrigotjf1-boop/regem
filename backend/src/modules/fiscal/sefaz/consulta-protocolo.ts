import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { CertificadoCliente, campo, chamarSefaz } from './soap';
import { urlServicoNfce } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONSULTA DA SITUAÇÃO DA NFC-e PELA CHAVE (NFeConsultaProtocolo4 / `nfeConsultaNF`).
//
// É a única resposta possível para a pergunta "a nota que eu enviei e não sei o que virou está
// autorizada na SEFAZ?". Funciona mesmo quando a conexão caiu ANTES de recebermos qualquer
// recibo — o que descarta a consulta por recibo (NFeRetAutorizacao4), que precisa de um número
// que nesse caso nunca chegou até nós.
//
// O que a resposta significa, e por que cada caso importa:
//
//   100/150 → AUTORIZADA lá. A venda tem documento fiscal; o número está consumido.
//   101/135/151/155 → CANCELADA (existiu e foi cancelada). Número consumido.
//   110/301/302 → DENEGADA. A nota existe na base como negada: o número também está
//                 consumido e NUNCA pode ser reaproveitado.
//   217 → "NF-e não consta na base de dados da SEFAZ": ela nunca foi registrada. Só aqui o
//         número volta a ser utilizável (é o que destrava o P19).
//   qualquer outra → INDEFINIDO: não se decide nada. Manter pendente e tentar de novo é
//                    sempre melhor do que adivinhar errado nos dois sentidos (emitir duas
//                    notas para a mesma venda, ou dar a venda por documentada sem estar).

export type SituacaoNaSefaz =
  | { situacao: 'autorizada'; cStat: string; xMotivo: string; protocolo: string; dhRecbto: string | null; protNFe: string }
  | { situacao: 'cancelada'; cStat: string; xMotivo: string; protocolo: string | null }
  | { situacao: 'denegada'; cStat: string; xMotivo: string; protocolo: string | null }
  | { situacao: 'inexistente'; cStat: string; xMotivo: string }
  | { situacao: 'indefinido'; cStat: string; xMotivo: string };

const AUTORIZADA = new Set(['100', '150']);
const CANCELADA = new Set(['101', '135', '151', '155']);
const DENEGADA = new Set(['110', '301', '302']);
const NAO_CONSTA = '217';

function elemento(xml: string, nome: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lista = doc.getElementsByTagNameNS('*', nome);
  return lista && lista.length ? new XMLSerializer().serializeToString(lista[0]) : null;
}

/** Lê o `retConsSitNFe` e diz o que a nota É na SEFAZ. Não decide nada sobre o nosso banco. */
export function lerSituacao(retorno: string): SituacaoNaSefaz {
  const cStatRaiz = campo(retorno, 'cStat') ?? '';
  const xMotivoRaiz = campo(retorno, 'xMotivo') ?? '';

  // O protocolo manda: ele é o registro da nota. O cStat da raiz diz como foi a CONSULTA.
  const prot = elemento(retorno, 'protNFe');
  const cStatProt = prot ? campo(prot, 'cStat') ?? '' : '';
  const xMotivoProt = prot ? campo(prot, 'xMotivo') ?? '' : '';
  const protocolo = prot ? campo(prot, 'nProt') : null;

  // Cancelamento vem como evento (110111) no retorno, e não muda o protNFe original.
  const evento = elemento(retorno, 'retCancNFe') ?? elemento(retorno, 'procEventoNFe');
  const cStatEvento = evento ? campo(evento, 'cStat') ?? '' : '';

  if (CANCELADA.has(cStatRaiz) || CANCELADA.has(cStatEvento))
    return {
      situacao: 'cancelada',
      cStat: CANCELADA.has(cStatRaiz) ? cStatRaiz : cStatEvento,
      xMotivo: CANCELADA.has(cStatRaiz) ? xMotivoRaiz : `Cancelamento registrado. ${xMotivoRaiz}`.trim(),
      protocolo,
    };

  if (prot && DENEGADA.has(cStatProt))
    return { situacao: 'denegada', cStat: cStatProt, xMotivo: xMotivoProt, protocolo };
  if (DENEGADA.has(cStatRaiz)) return { situacao: 'denegada', cStat: cStatRaiz, xMotivo: xMotivoRaiz, protocolo };

  if (prot && AUTORIZADA.has(cStatProt) && protocolo)
    return {
      situacao: 'autorizada',
      cStat: cStatProt,
      xMotivo: xMotivoProt,
      protocolo,
      dhRecbto: campo(prot, 'dhRecbto'),
      protNFe: prot,
    };

  if (cStatRaiz === NAO_CONSTA) return { situacao: 'inexistente', cStat: cStatRaiz, xMotivo: xMotivoRaiz };

  // Inclui o caso "raiz diz 100 mas veio sem protNFe": sem protocolo não se grava autorizada.
  return { situacao: 'indefinido', cStat: cStatRaiz, xMotivo: xMotivoRaiz || 'Resposta da SEFAZ sem situação conclusiva.' };
}

export function montarConsSitNFe(chave: string, ambiente: string): string {
  const ch = String(chave ?? '').replace(/\D/g, '');
  if (ch.length !== 44) throw new Error('Chave de acesso inválida para consulta (precisa de 44 dígitos).');
  const amb = String(ambiente) === '1' ? '1' : '2';
  return (
    `<consSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<tpAmb>${amb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${ch}</chNFe></consSitNFe>`
  );
}

export async function consultarSituacaoNfce(p: {
  uf: string;
  ambiente: string;
  chave: string;
  cert: CertificadoCliente;
  ca?: string[]; // só para teste
  url?: string; // só para teste
}): Promise<SituacaoNaSefaz> {
  const ambiente = String(p.ambiente) === '1' ? '1' : '2';
  const url = p.url ?? urlServicoNfce(p.uf, ambiente, 'NFeConsultaProtocolo4');
  const retorno = await chamarSefaz({
    url,
    servico: 'NFeConsultaProtocolo4',
    corpoXml: montarConsSitNFe(p.chave, ambiente),
    cert: p.cert,
    ca: p.ca,
  });
  return lerSituacao(retorno);
}

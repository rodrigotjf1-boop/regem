import { createHash, createSign, randomInt } from 'crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Utilidades da chave de acesso NFC-e (44 dígitos) e do QR Code (NT NFC-e).
// Determinístico e testável — não depende do certificado.

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

// DV por módulo 11 (pesos 2..9 da direita p/ esquerda). Resto 0/1 → DV 0.
export function dvModulo11(chave43: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = 11 - resto;
  return dv >= 10 ? 0 : dv;
}

// Código numérico aleatório (cNF) de 8 dígitos.
export function gerarCNF(): string {
  return String(randomInt(0, 100000000)).padStart(8, '0');
}

// Monta a chave de 44 dígitos: cUF+AAMM+CNPJ+mod+serie+nNF+tpEmis+cNF+cDV.
export function montarChave(p: {
  codigoUf: number;
  ano2: string; // AA
  mes2: string; // MM
  cnpj: string;
  modelo: string; // 65
  serie: number;
  numero: number;
  tpEmis: number; // 1 = normal
  cNF: string; // 8 díg
}): string {
  const base =
    String(p.codigoUf).padStart(2, '0') +
    p.ano2 +
    p.mes2 +
    soDigitos(p.cnpj).padStart(14, '0') +
    p.modelo.padStart(2, '0') +
    String(p.serie).padStart(3, '0') +
    String(p.numero).padStart(9, '0') +
    String(p.tpEmis) +
    p.cNF;
  const dv = dvModulo11(base);
  return base + String(dv);
}

// QR Code NFC-e (NT 2015/002 — versão 2, emissão online):
// p=chave|versao|tpAmb|cIdToken|cHashQRCode  (hash SHA-1 hex maiúsculo do
// "chave|versao|tpAmb|cIdToken" + CSC). urlConsulta é o front do estado.
export function montarQrCode(p: {
  chave: string;
  tpAmb: string; // 1|2
  cscId: string;
  cscToken: string;
  urlConsulta: string; // ex.: https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode
  versao?: string;
}): { qrCode: string } {
  const versao = p.versao ?? '2';
  const semHash = `${p.chave}|${versao}|${p.tpAmb}|${p.cscId}`;
  const hash = createHash('sha1')
    .update(semHash + p.cscToken)
    .digest('hex')
    .toUpperCase();
  const dados = `${semHash}|${hash}`;
  const sep = p.urlConsulta.includes('?') ? '&' : '?';
  // A URL de "consulta por chave" (urlChave) é OUTRO endereço, próprio de cada UF — vem da
  // configuração, não daqui. Antes esta função devolvia a URL do QR no lugar dela.
  return { qrCode: `${p.urlConsulta}${sep}p=${dados}` };
}

// QR Code VERSÃO 3 — emissão ONLINE (NT 2025.001; Manual do DANFE NFC-e v6.0, §4.4.1, Tabela 6):
//   <url>?p=<chave de 44>|3|<tpAmb>
// Sem CSC e sem hash: a autenticidade da nota online vem da assinatura do XML. (A v3 OFFLINE é
// outra — leva dia, valor, destinatário e uma assinatura RSA-SHA1 — e entra com a contingência.)
export function montarQrCodeV3(p: { chave: string; tpAmb: string; urlConsulta: string }): { qrCode: string } {
  if (!/^\d{44}$/.test(p.chave)) throw new Error('QR Code v3: chave de acesso precisa ter 44 dígitos.');
  const tpAmb = String(p.tpAmb) === '1' ? '1' : '2';
  const sep = p.urlConsulta.includes('?') ? '&' : '?';
  return { qrCode: `${p.urlConsulta}${sep}p=${p.chave}|3|${tpAmb}` };
}

/**
 * QR Code VERSÃO 3 — emissão em CONTINGÊNCIA OFF-LINE (`tpEmis=9`).
 *
 * Manual do DANFE NFC-e e QR Code **v6.0, §4.4.2, Tabela 7** — oito parâmetros:
 *
 *   1 chave (44) · 2 versão ("3") · 3 tpAmb · 4 DIA da emissão (2 dígitos) · 5 vNF
 *   6 tipo de identificação do destinatário (1=CNPJ, 2=CPF, 3=idEstrangeiro)
 *   7 identificação do destinatário · 8 ASSINATURA
 *
 * Sem destinatário, os parâmetros 6 e 7 ficam **vazios** — "informar apenas o separador".
 * A assinatura é RSA **SHA-1** em Base64 sobre a concatenação dos parâmetros 1 a 7 **com os
 * separadores**, feita com o MESMO certificado que assina a NFC-e. É ela que substitui o CSC:
 * na v3 não existe hash com segredo combinado — a autenticidade do QR vem do certificado.
 *
 * Regras atendidas: ZX02-324/326 (parâmetros 6 e 7 na off-line), ZX02-330 (assinatura PROIBIDA
 * fora da contingência), ZX02-334 (obrigatória nela) e ZX02-338 → **583** "Valor da assinatura
 * do qrCode difere do valor calculado".
 */
export function montarQrCodeV3Offline(p: {
  chave: string;
  tpAmb: string; // 1|2
  dhEmi: string; // ISO com fuso, como vai no XML — daqui sai só o DIA
  vNF: number | string; // valor total da nota (W16)
  destTipo?: '1' | '2' | '3' | null;
  destDocumento?: string | null;
  chavePrivadaPem: string; // o mesmo A1 que assina a NFC-e
  urlConsulta: string;
}): { qrCode: string; assinatura: string } {
  if (!/^[0-9]{44}$/.test(p.chave)) throw new Error('QR Code v3 off-line: chave de acesso precisa ter 44 dígitos.');
  const tpAmb = String(p.tpAmb) === '1' ? '1' : '2';
  // O dia sai do TEXTO da data (que já está no fuso da UF). Converter para Date aqui traria o
  // fuso da máquina de volta e, perto da virada, o dia sairia errado — ver `fuso-fiscal.ts`.
  const dia = String(p.dhEmi ?? '').slice(8, 10);
  if (!/^[0-9]{2}$/.test(dia)) throw new Error('QR Code v3 off-line: data de emissão inválida.');
  const valor = Number(p.vNF || 0).toFixed(2);
  const doc = String(p.destDocumento ?? '').replace(/[^0-9]/g, '');
  const tipo = doc ? (p.destTipo ?? (doc.length === 14 ? '1' : '2')) : '';
  const dados = [p.chave, '3', tpAmb, dia, valor, tipo, doc].join('|');
  const assinatura = createSign('RSA-SHA1').update(dados, 'utf8').sign(p.chavePrivadaPem, 'base64');
  const sep = p.urlConsulta.includes('?') ? '&' : '?';
  return { qrCode: `${p.urlConsulta}${sep}p=${dados}|${assinatura}`, assinatura };
}

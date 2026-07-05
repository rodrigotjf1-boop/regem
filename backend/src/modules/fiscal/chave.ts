import { createHash, randomInt } from 'crypto';

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
}): { qrCode: string; urlChave: string } {
  const versao = p.versao ?? '2';
  const semHash = `${p.chave}|${versao}|${p.tpAmb}|${p.cscId}`;
  const hash = createHash('sha1')
    .update(semHash + p.cscToken)
    .digest('hex')
    .toUpperCase();
  const dados = `${semHash}|${hash}`;
  const sep = p.urlConsulta.includes('?') ? '&' : '?';
  return { qrCode: `${p.urlConsulta}${sep}p=${dados}`, urlChave: p.urlConsulta };
}

// LER O BOLETO SEM IA (M3a do Mister, versão 3 do protótipo aprovada em 17/11/2026).
//
// O valor e o vencimento do boleto estão DENTRO do código de barras, e os dígitos verificadores confirmam a leitura. O
// Mister lê o código (da linha digitável na foto, ou do que a pessoa digitou) por aqui, sem modelo de IA: a IA só lê o que
// o código não traz (o nome do beneficiário). Se um dígito não confere, a leitura é recusada com o motivo — nunca se lança
// um boleto com o número errado.
//
// Dois formatos (FEBRABAN):
//  · BANCÁRIO (cobrança): código de barras de 44 dígitos, linha digitável de 47.
//      código: banco(3) moeda(1) DV geral(1) fator de vencimento(4) valor(10) campo livre(25)
//      linha:  campo 1 = banco+moeda+livre[0..5] + DV · campo 2 = livre[5..15] + DV · campo 3 = livre[15..25] + DV
//              · campo 4 = DV geral · campo 5 = fator + valor
//      DV dos campos: módulo 10. DV geral: módulo 11 com pesos 2 a 9; resultado 0 ou maior que 9 vira 1.
//  · ARRECADAÇÃO (contas de consumo e tributos: luz, gás, água, telefone, prefeitura): começa com 8; código de 44, linha
//      de 48 (4 blocos de 11 + DV). Posição 2 = segmento; 3 = identificador do valor (6 e 7: módulo 10; 8 e 9: módulo
//      11; 6 e 8 trazem o valor efetivo, 7 e 9 só referência); 4 = DV geral; 5–15 = valor (11). O vencimento NÃO está no
//      código: vem da foto ou da pessoa. Módulo 11 daqui: resto 0 ou 1 dá 0, resto 10 dá 1 (layout FEBRABAN, conferido
//      no texto oficial em 17/11/2026).
//
// Fator de vencimento: dias desde 07/10/1997 (fator 1000 = 03/07/2000). Em 22/02/2025 o fator chegou a 9999 e voltou para
// 1000; por isso o mesmo fator vale dois dias, e fica o mais perto de "hoje". Fator 0000 = sem vencimento.

export type TipoDeBoleto = 'bancario' | 'arrecadacao';

export interface BoletoLido {
  ok: true;
  tipo: TipoDeBoleto;
  /** Os 44 dígitos do código de barras. */
  codigoDeBarras: string;
  /** A linha digitável formatada como sai impressa. */
  linhaDigitavel: string;
  /** Em centavos; `null` quando o código não traz valor (zero, ou só referência na arrecadação). */
  valorCentavos: number | null;
  /** AAAA-MM-DD; `null` sem fator (bancário) e sempre na arrecadação. */
  vencimento: string | null;
  /** Bancário: o código do banco (3 dígitos). */
  banco?: string;
  /** Arrecadação: o segmento (1 prefeituras, 2 saneamento, 3 energia e gás, 4 telecomunicações, 5 governo, 6 demais, 7 multas). */
  segmento?: number;
}

export interface BoletoRecusado {
  ok: false;
  motivo: 'tamanho' | 'digito' | 'formato';
  /** Para a pessoa: o que não conferiu. */
  explicacao: string;
}

export type LeituraDoBoleto = BoletoLido | BoletoRecusado;

const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** Módulo 10: pesos 2 e 1 da direita para a esquerda, soma dos algarismos de cada produto; resto 0 dá 0. */
export function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    const p = Number(numero[i]) * peso;
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/** Soma do módulo 11: pesos 2 a 9 da direita para a esquerda, recomeçando em 2. */
function somaModulo11(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma;
}

/** Módulo 11 do boleto bancário (DV geral): 11 − resto; 0 ou maior que 9 vira 1. */
export function modulo11Bancario(numero: string): number {
  const dv = 11 - (somaModulo11(numero) % 11);
  return dv === 0 || dv > 9 ? 1 : dv;
}

/** Módulo 11 da arrecadação: resto 0 ou 1 dá 0; resto 10 dá 1; senão 11 − resto. */
export function modulo11Arrecadacao(numero: string): number {
  const resto = somaModulo11(numero) % 11;
  if (resto === 0 || resto === 1) return 0;
  if (resto === 10) return 1;
  return 11 - resto;
}

const UM_DIA = 86_400_000;
const BASE_ANTIGA = Date.UTC(1997, 9, 7); // fator 1000 = 03/07/2000
const BASE_NOVA = Date.UTC(2025, 1, 22); // fator 1000 de novo, desde 22/02/2025

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** O vencimento do fator, no ciclo mais perto de `hoje` (AAAA-MM-DD). Fator 0 = sem vencimento. */
export function vencimentoDoFator(fator: number, hoje: Date = new Date()): string | null {
  if (!Number.isInteger(fator) || fator <= 0) return null;
  const agora = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  const candidatos = [BASE_ANTIGA + fator * UM_DIA];
  if (fator >= 1000) candidatos.push(BASE_NOVA + (fator - 1000) * UM_DIA);
  candidatos.sort((a, b) => Math.abs(a - agora) - Math.abs(b - agora));
  return iso(candidatos[0]);
}

const recusa = (motivo: BoletoRecusado['motivo'], explicacao: string): BoletoRecusado => ({ ok: false, motivo, explicacao });

function formatarLinhaBancaria(l: string): string {
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

function formatarLinhaArrecadacao(l: string): string {
  return [0, 12, 24, 36].map((i) => `${l.slice(i, i + 11)}-${l[i + 11]}`).join(' ');
}

function lerBancario(codigo: string, hoje: Date): LeituraDoBoleto {
  if (codigo[3] !== '9') return recusa('formato', 'O código da moeda não é o do real (9).');
  const semDv = codigo.slice(0, 4) + codigo.slice(5);
  if (modulo11Bancario(semDv) !== Number(codigo[4])) return recusa('digito', 'O dígito verificador geral não confere: algum número foi lido errado.');
  const livre = codigo.slice(19);
  const c1 = codigo.slice(0, 4) + livre.slice(0, 5);
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  const linha = `${c1}${modulo10(c1)}${c2}${modulo10(c2)}${c3}${modulo10(c3)}${codigo[4]}${codigo.slice(5, 19)}`;
  const valor = Number(codigo.slice(9, 19));
  return {
    ok: true,
    tipo: 'bancario',
    codigoDeBarras: codigo,
    linhaDigitavel: formatarLinhaBancaria(linha),
    valorCentavos: valor > 0 ? valor : null,
    vencimento: vencimentoDoFator(Number(codigo.slice(5, 9)), hoje),
    banco: codigo.slice(0, 3),
  };
}

function moduloDaArrecadacao(identificador: string): ((n: string) => number) | null {
  if (identificador === '6' || identificador === '7') return modulo10;
  if (identificador === '8' || identificador === '9') return modulo11Arrecadacao;
  return null;
}

function lerArrecadacao(codigo: string): LeituraDoBoleto {
  const mod = moduloDaArrecadacao(codigo[2]);
  if (!mod) return recusa('formato', 'O identificador de valor da conta não é conhecido (esperado 6, 7, 8 ou 9).');
  const semDv = codigo.slice(0, 3) + codigo.slice(4);
  if (mod(semDv) !== Number(codigo[3])) return recusa('digito', 'O dígito verificador geral não confere: algum número foi lido errado.');
  const blocos = [0, 11, 22, 33].map((i) => codigo.slice(i, i + 11));
  const linha = blocos.map((b) => `${b}${mod(b)}`).join('');
  const efetivo = codigo[2] === '6' || codigo[2] === '8';
  const valor = Number(codigo.slice(4, 15));
  return {
    ok: true,
    tipo: 'arrecadacao',
    codigoDeBarras: codigo,
    linhaDigitavel: formatarLinhaArrecadacao(linha),
    valorCentavos: efetivo && valor > 0 ? valor : null,
    vencimento: null,
    segmento: Number(codigo[1]),
  };
}

/** Da linha digitável bancária (47) ao código de barras (44), conferindo os três DVs dos campos. */
function codigoDaLinhaBancaria(l: string): string | BoletoRecusado {
  const campos: [string, string][] = [
    [l.slice(0, 9), l[9]],
    [l.slice(10, 20), l[20]],
    [l.slice(21, 31), l[31]],
  ];
  for (let i = 0; i < campos.length; i++) {
    if (modulo10(campos[i][0]) !== Number(campos[i][1])) {
      return recusa('digito', `O dígito do campo ${i + 1} da linha digitável não confere: algum número foi lido errado.`);
    }
  }
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

/** Da linha de arrecadação (48) ao código (44), conferindo o DV de cada bloco. */
function codigoDaLinhaArrecadacao(l: string): string | BoletoRecusado {
  const mod = moduloDaArrecadacao(l[2]);
  if (!mod) return recusa('formato', 'O identificador de valor da conta não é conhecido (esperado 6, 7, 8 ou 9).');
  let codigo = '';
  for (let i = 0; i < 4; i++) {
    const bloco = l.slice(i * 12, i * 12 + 11);
    if (mod(bloco) !== Number(l[i * 12 + 11])) {
      return recusa('digito', `O dígito do bloco ${i + 1} da linha digitável não confere: algum número foi lido errado.`);
    }
    codigo += bloco;
  }
  return codigo;
}

/**
 * Lê um boleto pelo número: a linha digitável (47 ou 48 dígitos) ou o código de barras (44), com ou sem pontos e espaços.
 * Confere todos os dígitos verificadores; devolve o valor, o vencimento (quando o código traz) e as duas formas do número.
 */
export function lerBoleto(entrada: unknown, hoje: Date = new Date()): LeituraDoBoleto {
  const d = soDigitos(entrada);
  if (d.length === 47) {
    const codigo = codigoDaLinhaBancaria(d);
    return typeof codigo === 'string' ? lerBancario(codigo, hoje) : codigo;
  }
  if (d.length === 48) {
    if (d[0] !== '8') return recusa('formato', 'Linha de 48 dígitos é de conta de consumo e começa com 8.');
    const codigo = codigoDaLinhaArrecadacao(d);
    return typeof codigo === 'string' ? lerArrecadacao(codigo) : codigo;
  }
  if (d.length === 44) return d[0] === '8' ? lerArrecadacao(d) : lerBancario(d, hoje);
  return recusa('tamanho', `O número tem ${d.length} dígitos; a linha digitável tem 47 ou 48 e o código de barras, 44.`);
}

// ─────────────────────────────── Pix copia e cola (BR Code) ───────────────────────────────

export interface PixLido {
  ok: true;
  /** O texto inteiro, como se cola no app do banco. */
  copiaECola: string;
  valorCentavos: number | null;
  nome: string | null;
  cidade: string | null;
  /** Pix estático: a chave. Pix dinâmico (cobrança): o endereço do recebedor, sem a chave. */
  chave: string | null;
  url: string | null;
  txid: string | null;
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), como o Manual de Padrões do Pix do Banco Central pede. */
export function crc16Pix(texto: string): string {
  let crc = 0xffff;
  for (const ch of Buffer.from(texto, 'utf8')) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function campos(tlv: string): Map<string, string> | null {
  const m = new Map<string, string>();
  let i = 0;
  while (i < tlv.length) {
    const id = tlv.slice(i, i + 2);
    const tam = Number(tlv.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(tam) || i + 4 + tam > tlv.length) return null;
    m.set(id, tlv.slice(i + 4, i + 4 + tam));
    i += 4 + tam;
  }
  return m;
}

/**
 * Confere e lê um Pix copia e cola (o texto do QR Code do Pix): o CRC do fim tem de bater com o resto, e o código tem de
 * ser do Pix (br.gov.bcb.pix). Devolve `null` se não for um Pix válido — nunca se oferece um Pix que não confere.
 */
export function lerPixCopiaECola(entrada: unknown): PixLido | null {
  const t = String(entrada ?? '').trim();
  if (t.length < 30 || !t.startsWith('000201')) return null;
  const fim = t.lastIndexOf('6304');
  if (fim < 0 || fim + 8 !== t.length) return null;
  if (crc16Pix(t.slice(0, fim + 4)) !== t.slice(fim + 4).toUpperCase()) return null;
  const c = campos(t.slice(0, fim));
  if (!c) return null;
  const conta = c.get('26');
  const dadosConta = conta ? campos(conta) : null;
  if (!dadosConta || (dadosConta.get('00') ?? '').toLowerCase() !== 'br.gov.bcb.pix') return null;
  const valor = c.get('54');
  const adicionais = c.get('62') ? campos(c.get('62') as string) : null;
  const txid = adicionais?.get('05') ?? null;
  return {
    ok: true,
    copiaECola: t,
    valorCentavos: valor && /^\d+(\.\d{1,2})?$/.test(valor) ? Math.round(Number(valor) * 100) : null,
    nome: c.get('59') ?? null,
    cidade: c.get('60') ?? null,
    chave: dadosConta.get('01') ?? null,
    url: dadosConta.get('25') ?? null,
    txid: txid && txid !== '***' ? txid : null,
  };
}

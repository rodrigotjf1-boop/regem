import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// CIFRA DE SEGREDOS GUARDADOS NO BANCO (certificado A1, senha dele, CSC da NFC-e…).
//
// AES-256-GCM com a chave `SEGREDOS_CHAVE` (32 bytes em base64) do ambiente DESTA máquina:
// a nuvem tem a sua (variável no EasyPanel), cada servidor local terá a sua (no .env.local,
// que o próprio instalador protege com DPAPI e o `carregarEnvSeguro()` decifra no boot).
// Consequência desejada: um valor cifrado num lado não abre no outro — uma loja
// comprometida não expõe o segredo das demais.
//
// GCM porque autentica: um byte alterado no banco faz a leitura FALHAR, em vez de devolver
// lixo que seria usado como senha ou como chave.
//
// Regras que isto garante:
//   • sem chave, NADA é guardado nem lido — erro claro, nunca "guarda em texto puro";
//   • a mensagem de erro nunca contém o segredo nem a chave;
//   • formato versionado ("v1:"), para trocar de algoritmo sem migrar às cegas.

const VERSAO = 'v1';
const ALG = 'aes-256-gcm';

export class ChaveSegredosAusente extends Error {
  constructor() {
    super(
      'Chave de proteção de segredos não configurada neste servidor (SEGREDOS_CHAVE). ' +
        'Nada foi guardado — configure a chave e tente de novo.',
    );
    this.name = 'ChaveSegredosAusente';
  }
}

function chave(): Buffer {
  const b64 = String(process.env.SEGREDOS_CHAVE ?? '').trim();
  if (!b64) throw new ChaveSegredosAusente();
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) {
    throw new Error(
      `SEGREDOS_CHAVE inválida: precisa ter 32 bytes em base64 (tem ${k.length}). ` +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return k;
}

/** Há chave configurada neste servidor? (para a tela avisar antes de o usuário tentar) */
export function chaveSegredosDisponivel(): boolean {
  try {
    chave();
    return true;
  } catch {
    return false;
  }
}

/** Cifra texto ou bytes. Devolve "v1:<base64 de iv|tag|dados>". */
export function cifrar(valor: string | Buffer): string {
  const k = chave();
  const iv = randomBytes(12); // 96 bits: o tamanho recomendado para GCM
  const c = createCipheriv(ALG, k, iv);
  const dados = Buffer.concat([c.update(Buffer.isBuffer(valor) ? valor : Buffer.from(valor, 'utf8')), c.final()]);
  const tag = c.getAuthTag();
  return `${VERSAO}:${Buffer.concat([iv, tag, dados]).toString('base64')}`;
}

/** Decifra para bytes. Falha (sem vazar nada) se a chave for outra ou o valor tiver sido alterado. */
export function decifrarBytes(cifrado: string): Buffer {
  const [versao, corpo] = String(cifrado ?? '').split(':', 2);
  if (versao !== VERSAO || !corpo) throw new Error('Segredo guardado em formato desconhecido.');
  const k = chave();
  const buf = Buffer.from(corpo, 'base64');
  if (buf.length < 12 + 16) throw new Error('Segredo guardado está corrompido.');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const dados = buf.subarray(28);
  try {
    const d = createDecipheriv(ALG, k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(dados), d.final()]);
  } catch {
    // Chave diferente (ex.: banco de outra máquina) ou valor adulterado. A mensagem é
    // propositalmente genérica: não ajuda quem estiver tentando adivinhar.
    throw new Error('Não foi possível abrir o segredo guardado (chave diferente ou dado alterado).');
  }
}

/** Decifra para texto UTF-8. */
export function decifrar(cifrado: string): string {
  return decifrarBytes(cifrado).toString('utf8');
}

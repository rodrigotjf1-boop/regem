import { randomBytes, timingSafeEqual } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

// A CHAVE DO ÍCONE DO SERVIDOR (fase 4 do pedido de 22–23/10/2026). O sistema do servidor da loja a gera no primeiro
// uso, na pasta dele (`C:\regem-edge\backend\bandeja.key`); o ícone (`RegemServidor.exe`) a lê da mesma pasta e a manda
// em `x-bandeja-chave`. É o modelo do "Regem neste PC" da estação (`painel.key`): quem tem o arquivo está NESTE
// computador. O dono decidiu que o ícone é livre (23/10): ver e agir sem senha, só no próprio servidor.

/** Onde fica a chave: na pasta em que o sistema roda (o instalador põe o serviço em `C:\regem-edge\backend`). */
export function arquivoDaChave(): string {
  return process.env.BANDEJA_CHAVE_ARQ || join(process.cwd(), 'bandeja.key');
}

/** A chave atual; sem arquivo (primeira vez, ou apagado por uma troca de pacote), gera outra. */
export function chaveDaBandeja(arquivo: string = arquivoDaChave()): string {
  try {
    const k = readFileSync(arquivo, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(k)) return k;
  } catch {
    /* primeira vez */
  }
  const k = randomBytes(24).toString('hex');
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, k);
  return k;
}

/** A chave que veio confere com a do arquivo (comparação em tempo constante). */
export function chaveConfere(recebida: unknown, arquivo: string = arquivoDaChave()): boolean {
  const r = Buffer.from(typeof recebida === 'string' ? recebida.trim() : '');
  const k = Buffer.from(chaveDaBandeja(arquivo));
  return r.length === k.length && timingSafeEqual(r, k);
}

/**
 * A conexão veio do PRÓPRIO computador? Vale o endereço da conexão (`req.socket.remoteAddress`), nunca o `req.ip`: com
 * `trust proxy` ligado, o `req.ip` sai do cabeçalho X-Forwarded-For, que qualquer PC da rede escreve como quiser.
 */
export function doProprioComputador(remoto: unknown): boolean {
  const s = String(remoto ?? '').trim().toLowerCase();
  return s === '127.0.0.1' || s === '::1' || s === '::ffff:127.0.0.1';
}

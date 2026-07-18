import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Fase 1 (proteção de segredos) — decifra no BOOT os valores do `.env.local` que
 * foram cifrados com DPAPI (`edge/proteger-env.ps1`, prefixo `enc:`), ANTES do Nest
 * ler o env. É NO-OP quando não há nenhum `enc:` (nuvem e edges sem criptografia),
 * então é seguro rodar sempre. Só faz sentido no Windows/edge; erro de decifra
 * derruba o boot de propósito (não dá para subir com segredo quebrado).
 */
export function carregarEnvSeguro(): void {
  const arq = join(process.cwd(), '.env.local');
  if (!existsSync(arq)) return;

  let linhas: string[];
  try {
    linhas = readFileSync(arq, 'utf8').split(/\r?\n/);
  } catch {
    return;
  }

  const encs: { chave: string; blob: string }[] = [];
  for (const l of linhas) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*enc:(.+)$/);
    if (m) encs.push({ chave: m[1], blob: m[2].trim() });
  }
  if (!encs.length) return; // nada cifrado → segue a vida (comportamento atual)

  const ps1 = join(process.cwd(), 'edge', 'decrypt-dpapi.ps1');
  const tmp = join(tmpdir(), `regem-dpapi-${randomUUID().slice(0, 8)}.txt`);
  try {
    writeFileSync(tmp, encs.map((e) => e.blob).join('\n'), 'utf8');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-BlobFile', tmp],
      { encoding: 'utf8' },
    );
    const vals = out.split(/\r?\n/);
    encs.forEach((e, i) => {
      const v = vals[i];
      if (v != null && v !== '') process.env[e.chave] = v; // sobrepõe o `enc:` cru
    });
  } catch (err: any) {
    throw new Error(
      `Falha ao decifrar segredos do .env (DPAPI): ${err?.message ?? err}. ` +
        'Rode no mesmo serviço/máquina que cifrou (proteger-env.ps1), ou reinstale.',
    );
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* já removido */
    }
  }
}

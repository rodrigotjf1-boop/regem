// Carrega o .env.local para process.env E DECIFRA os valores DPAPI (prefixo `enc:`),
// espelhando src/secure-env.ts do backend. Os daemons standalone (.mjs) rodam FORA do
// boot do Nest, então precisam decifrar por conta própria — senão usam o `enc:` cru
// como connection string e o pg cai no usuário do SO (erro 28P01
// "password authentication failed for user \"<MAQUINA>$\"").
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// metaUrl = import.meta.url do daemon (fica em backend/edge/*.mjs → .env.local em ../).
export function carregarEnvLocal(metaUrl) {
  const arq = fileURLToPath(new URL('../.env.local', metaUrl));
  if (!existsSync(arq)) return;
  const linhas = readFileSync(arq, 'utf8').split(/\r?\n/);

  // 1) Carrega tudo em texto (não sobrescreve env já definida no ambiente do serviço).
  for (const l of linhas) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }

  // 2) Decifra os valores `enc:` (DPAPI) — só faz sentido no Windows/edge; NO-OP se não
  //    houver nenhum (nuvem/edge sem criptografia). Erro de decifra derruba o processo
  //    de propósito (não subir com segredo quebrado), igual ao secure-env.ts.
  const encs = [];
  for (const l of linhas) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*enc:(.+)$/);
    if (m) encs.push({ chave: m[1], blob: m[2].trim() });
  }
  if (!encs.length) return;

  const ps1 = join(dirname(arq), 'edge', 'decrypt-dpapi.ps1');
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
  } catch (err) {
    throw new Error(
      `Falha ao decifrar segredos do .env (DPAPI): ${err?.message ?? err}. ` +
        'Rode no mesmo serviço/máquina que cifrou (proteger-env.ps1), ou reinstale.',
    );
  } finally {
    try { unlinkSync(tmp); } catch { /* já removido */ }
  }
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Integridade do bundle (Fase 2): confere os arquivos do dist contra o
// `dist-manifest.json` gerado no EMPACOTAMENTO do edge (package.mjs). Só age quando
// o manifesto existe (instalação empacotada da loja) — no dev/nuvem não há manifesto
// e é no-op. TOLERANTE: registra divergências (adulteração/troca de arquivo), não
// derruba o app. Defesa em profundidade — detecta modificação naive do código no PC.
export function verificarIntegridade(): { ok: boolean; divergencias: string[] } {
  const manifestoPath = join(process.cwd(), 'dist-manifest.json');
  if (!existsSync(manifestoPath)) return { ok: true, divergencias: [] };
  let manifesto: Record<string, string>;
  try {
    manifesto = JSON.parse(readFileSync(manifestoPath, 'utf8'));
  } catch {
    return { ok: true, divergencias: [] };
  }
  const divergencias: string[] = [];
  for (const [rel, esperado] of Object.entries(manifesto)) {
    try {
      const h = createHash('sha256').update(readFileSync(join(process.cwd(), rel))).digest('hex');
      if (h !== esperado) divergencias.push(rel);
    } catch {
      divergencias.push(rel + ' (ausente)');
    }
  }
  if (divergencias.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[integridade] ${divergencias.length} arquivo(s) do bundle divergem do manifesto — possível adulteração: ` +
        divergencias.slice(0, 5).join(', ') +
        (divergencias.length > 5 ? '…' : ''),
    );
  }
  return { ok: divergencias.length === 0, divergencias };
}

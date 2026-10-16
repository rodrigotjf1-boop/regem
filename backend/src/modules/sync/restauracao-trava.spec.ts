import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ERR-234 (14/10/2026): a restauração por arquivo do servidor da loja travou por 2 h. O download era
// ligado ao descompactador com `.pipe()`, que NÃO repassa o erro da origem; o pega-tudo de erros do
// daemon o engolia, e o `for await` do descompactador esperava para sempre — o ciclo nunca acabava,
// nenhuma batida saía e a marca "restaurando" ficava presa. Aqui: (1) o comportamento do Node, em
// cenário isolado (prova do porquê da regra); (2) o sync-daemon usa `pipeline` e limpa a marca ao
// iniciar.

jest.setTimeout(30_000);

const DAEMON = join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs');

describe('restauração por arquivo não trava quando o download cai (ERR-234)', () => {
  it('no Node: com .pipe() o descompactador fica pendurado; com pipeline o erro chega', () => {
    const p = spawnSync(process.execPath, [join(__dirname, 'restauracao-trava.cenarios.mjs')], { encoding: 'utf8', timeout: 25_000 });
    if (p.status !== 0) throw new Error(`cenário falhou: ${p.stderr || p.error}`);
    const r = JSON.parse(p.stdout.trim().split('\n').pop()!);
    expect(r.pipe).toBe('pendurado');
    expect(r.pipeline).toMatch(/^erro: /);
  });

  const fonte = readFileSync(DAEMON, 'utf8').replace(/\r\n/g, '\n');

  it('o sync-daemon liga o download ao descompactador com pipeline, nunca .pipe()', () => {
    expect(fonte).toContain('pipeline(Readable.fromWeb(res.body), gunzip');
    expect(fonte).not.toMatch(/Readable\.fromWeb\([^)]*\)\.pipe\(/);
  });

  it('ao iniciar, o sync-daemon limpa a marca "restaurando" de uma restauração interrompida', () => {
    const boot = fonte.slice(fonte.indexOf("try { await ensureState(); }"));
    expect(boot).toMatch(/getState\('restaurando', '0'\)\) === '1'\) \{\s*await setState\('restaurando', '0'\)/);
  });
});

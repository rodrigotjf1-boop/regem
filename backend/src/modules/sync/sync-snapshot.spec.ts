import { PassThrough } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { SyncService } from './sync.service';

// F1 (Trilha A) — o /sync/snapshot streama TODO o transacional da loja como NDJSON gzip
// (corpo opaco), na ordem: {"__t":tabela} por tabela → linhas → {"__fim":true}. Teste-
// fumaça: gunzipa a saída e confere a estrutura (marcadores + linha + __fim) e que cada
// tabela de TABELAS_RESTORE foi consultada.

describe('SyncService.snapshot — F1 (Trilha A)', () => {
  it('streama NDJSON gzip com __t por tabela + linha + __fim', async () => {
    let chamada = 0;
    const db = {
      // 1ª consulta devolve 1 linha; as demais vazio (encerra a paginação de cada tabela).
      execute: async () => ({
        rows:
          chamada++ === 0
            ? [{ id: '11111111-1111-1111-1111-111111111111', tenant_id: 't1', x: 1 }]
            : [],
      }),
    };
    const svc = new SyncService(db as any);
    (svc as any).colunasDe = async () => new Set(['id', 'tenant_id', 'created_at', 'updated_at']);
    (svc as any).mirrorDias = async () => 60;

    const chunks: Buffer[] = [];
    const res: any = new PassThrough();
    res.setHeader = () => {};
    res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    const fim = new Promise((r) => res.on('end', r));

    await svc.snapshot('t1', res);
    await fim;

    const ndjson = gunzipSync(Buffer.concat(chunks)).toString('utf8');
    const objs = ndjson
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    // Tem pelo menos um marcador de tabela, a linha e o fechamento __fim.
    expect(objs.some((o) => typeof o.__t === 'string')).toBe(true);
    expect(objs.some((o) => o.id === '11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(objs[objs.length - 1].__fim).toBe(true);
    // Consultou várias tabelas (TABELAS_RESTORE tem >1).
    const tabelas = new Set(objs.filter((o) => o.__t).map((o) => o.__t));
    expect(tabelas.size).toBeGreaterThan(1);
  });
});

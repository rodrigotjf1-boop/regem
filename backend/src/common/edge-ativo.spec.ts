import { edgeAtivo } from './edge-ativo';

// F2: edgeAtivo é a fonte única de "a loja tem edge vivo agora?". Testa o contrato
// observável (true/false pela existência de heartbeat na janela) + a guarda EDGE_MODE
// e a passagem da unidade à query (correlação por loja). DB falso.
function fakeDb(rows: any[], capturar?: (q: any) => void) {
  return {
    execute: async (q: any) => {
      capturar?.(q);
      return { rows };
    },
  };
}

describe('edgeAtivo — F2 (por unidade)', () => {
  const ORIG = process.env.EDGE_MODE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIG;
  });

  it('true quando existe heartbeat na janela', async () => {
    delete process.env.EDGE_MODE;
    expect(await edgeAtivo(fakeDb([{ ok: 1 }]) as any, 't1')).toBe(true);
  });

  it('false quando não há heartbeat', async () => {
    delete process.env.EDGE_MODE;
    expect(await edgeAtivo(fakeDb([]) as any, 't1')).toBe(false);
  });

  it('false no próprio edge (EDGE_MODE=true) sem nem consultar', async () => {
    process.env.EDGE_MODE = 'true';
    let consultou = false;
    const db = fakeDb([{ ok: 1 }], () => (consultou = true));
    expect(await edgeAtivo(db as any, 't1', 'u1')).toBe(false);
    expect(consultou).toBe(false);
  });

  it('false sem tenant', async () => {
    delete process.env.EDGE_MODE;
    expect(await edgeAtivo(fakeDb([{ ok: 1 }]) as any, '')).toBe(false);
  });

  // Achata a sql`` do drizzle recursivamente (chunks aninhados: o filtro por unidade é
  // uma sql`` embutida, então precisa recursar p/ ver o texto "unidade_id").
  function achatar(q: any): string {
    if (!q) return '';
    if (typeof q === 'string') return q;
    if (Array.isArray(q.value)) return q.value.join('');
    if (Array.isArray(q.queryChunks)) return q.queryChunks.map(achatar).join(' ');
    return '';
  }

  it('COM unidadeId a query correlaciona por unidade (unidade_id no SQL)', async () => {
    delete process.env.EDGE_MODE;
    let q: any;
    await edgeAtivo(fakeDb([], (x) => (q = x)) as any, 't1', 'u1');
    expect(achatar(q)).toContain('unidade_id');
  });

  it('SEM unidadeId a query NÃO filtra por unidade (tenant-wide)', async () => {
    delete process.env.EDGE_MODE;
    let q: any;
    await edgeAtivo(fakeDb([], (x) => (q = x)) as any, 't1');
    expect(achatar(q)).not.toContain('unidade_id');
  });
});

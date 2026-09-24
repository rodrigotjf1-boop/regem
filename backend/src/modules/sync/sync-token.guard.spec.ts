import { SyncTokenGuard } from './sync-token.guard';

// R1 — quem o token de dispositivo autentica, e onde.
//  • 'servidor_local' vale em qualquer lugar (é o edge falando com a nuvem);
//  • 'totem' SÓ vale no servidor local — na nuvem o mesmo token é recusado, então um
//    aparelho público comprometido não alcança a API da nuvem;
//  • totem sem loja é recusado (senão a venda nasce "da rede" — registro interno V17).
// Sem banco: o EquipamentoService é falso e devolve a linha do aparelho.
// `token: null` = requisição SEM o header (passar `undefined` acionaria o valor padrão).
function ctx(url = '/api/v1/vendas/externa-pdv', token: string | null = 'tok') {
  const req: any = { headers: token ? { 'x-sync-token': token } : {}, url, originalUrl: url };
  return {
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any,
    req,
  };
}

function guardCom(dev: any) {
  return new SyncTokenGuard({ validarToken: async () => dev } as any);
}

describe('SyncTokenGuard — tipos aceitos (R1)', () => {
  const ORIG = process.env.EDGE_MODE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIG;
  });

  const servidor = { id: 'e1', tenantId: 't1', unidadeId: 'u1', tipo: 'servidor_local' };
  const totem = { id: 'e2', tenantId: 't1', unidadeId: 'u1', tipo: 'totem' };

  it('servidor_local passa na NUVEM', async () => {
    delete process.env.EDGE_MODE;
    const { ctx: c, req } = ctx();
    await expect(guardCom(servidor).canActivate(c)).resolves.toBe(true);
    expect(req.sync).toEqual({
      tenantId: 't1',
      unidadeId: 'u1',
      equipamentoId: 'e1',
      token: 'tok',
    });
  });

  it('servidor_local passa no EDGE', async () => {
    process.env.EDGE_MODE = 'true';
    const { ctx: c } = ctx();
    await expect(guardCom(servidor).canActivate(c)).resolves.toBe(true);
  });

  it('totem é RECUSADO na nuvem', async () => {
    delete process.env.EDGE_MODE;
    const { ctx: c } = ctx();
    await expect(guardCom(totem).canActivate(c)).rejects.toThrow('Token de sync inválido.');
  });

  it('totem passa no EDGE e leva tenant/loja do aparelho', async () => {
    process.env.EDGE_MODE = 'true';
    const { ctx: c, req } = ctx();
    await expect(guardCom(totem).canActivate(c)).resolves.toBe(true);
    expect(req.sync).toEqual({
      tenantId: 't1',
      unidadeId: 'u1',
      equipamentoId: 'e2',
      token: 'tok',
    });
  });

  it('totem SEM loja é recusado (V17) mesmo no edge', async () => {
    process.env.EDGE_MODE = 'true';
    const { ctx: c } = ctx();
    await expect(
      guardCom({ ...totem, unidadeId: null }).canActivate(c),
    ).rejects.toThrow('Totem sem loja definida');
  });

  it('EDGE_MODE=1 também vale (compatibilidade do instalador)', async () => {
    process.env.EDGE_MODE = '1';
    const { ctx: c } = ctx();
    await expect(guardCom(totem).canActivate(c)).resolves.toBe(true);
  });

  it('outros tipos (pdv/kds/impressora) seguem recusados no edge', async () => {
    process.env.EDGE_MODE = 'true';
    for (const tipo of ['pdv', 'kds', 'impressora', 'salao']) {
      const { ctx: c } = ctx();
      await expect(guardCom({ ...totem, tipo }).canActivate(c)).rejects.toThrow(
        'Token de sync inválido.',
      );
    }
  });

  it('token ausente é recusado antes de consultar o banco', async () => {
    const { ctx: c } = ctx('/api/v1/sync/catalogo', null);
    const guard = new SyncTokenGuard({
      validarToken: async () => {
        throw new Error('não deveria consultar o banco');
      },
    } as any);
    await expect(guard.canActivate(c)).rejects.toThrow('Token de sync ausente.');
  });

  it('token desconhecido é recusado', async () => {
    process.env.EDGE_MODE = 'true';
    const { ctx: c } = ctx();
    await expect(guardCom(null).canActivate(c)).rejects.toThrow('Token de sync inválido.');
  });
});

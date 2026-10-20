import { JANELA_PRESENCA_MS, PresencaService, enderecoDoHost, ipDoPc } from './presenca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PRESENÇA DOS PCs (conexão PC ↔ servidor, parte 1). O "último uso" só marcava operação: um caixa
// ligado e parado aparecia como "nunca usado", e o dono revogou um PC que estava conectado (18/10).
// A presença é o "agora": só no servidor da loja, em memória, com um resumo por minuto para a nuvem.

describe('presença dos PCs da loja', () => {
  const original = process.env.EDGE_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = original;
  });

  function servico() {
    const gravados: string[] = [];
    const db: any = {
      execute: async (q: any) => {
        // o valor gravado é o 2º parâmetro do insert (chave fixa 'presenca' no texto)
        const params = q?.queryChunks?.filter((c: any) => typeof c === 'string') ?? [];
        gravados.push(JSON.stringify(params));
        return { rows: [] };
      },
    };
    return { svc: new PresencaService(db), gravados };
  }
  const base = { tenantId: 't1', tipo: 'pdv' as const, ip: '192.168.0.23', endereco: 'regem.local', maquina: null, versao: null };

  it('na nuvem não anota nada (lá a presença chega pela saúde da batida)', () => {
    delete process.env.EDGE_MODE;
    const { svc } = servico();
    svc.notar({ ...base, id: 'pdv-1' });
    expect(svc.doTenant('t1')).toEqual([]);
  });

  it('no servidor da loja: o mais recente primeiro, só da empresa, só dentro da janela', () => {
    process.env.EDGE_MODE = 'true';
    const { svc } = servico();
    const agora = Date.parse('2026-10-20T03:00:00Z');
    svc.notar({ ...base, id: 'velho' }, new Date(agora - JANELA_PRESENCA_MS - 1000));
    svc.notar({ ...base, id: 'pdv-1' }, new Date(agora - 40_000));
    svc.notar({ ...base, id: 'est-1', tipo: 'estacao_impressao', maquina: 'CX-DELIVERY', versao: '1.30.4' }, new Date(agora - 5_000));
    svc.notar({ ...base, id: 'outra', tenantId: 't2' }, new Date(agora - 5_000));
    expect(svc.doTenant('t1', agora).map((p) => p.id)).toEqual(['est-1', 'pdv-1']);
    expect(svc.doTenant('t2', agora).map((p) => p.id)).toEqual(['outra']);
  });

  it('PCs conectados = IPs diferentes vistos nos últimos 3 min (terminal e estação do mesmo PC contam 1)', () => {
    process.env.EDGE_MODE = 'true';
    const { svc } = servico();
    const agora = Date.parse('2026-10-20T03:00:00Z');
    svc.notar({ ...base, id: 'pdv-1' }, new Date(agora - 20_000));
    svc.notar({ ...base, id: 'est-1', tipo: 'estacao_impressao' }, new Date(agora - 50_000));
    svc.notar({ ...base, id: 'pdv-2', ip: '192.168.0.21' }, new Date(agora - 60_000));
    svc.notar({ ...base, id: 'pdv-3', ip: '192.168.0.30' }, new Date(agora - 5 * 60_000));
    expect(svc.pcsConectados('t1', 3 * 60_000, agora)).toBe(2);
  });

  it('o resumo para a nuvem: grava os da janela e esquece os velhos; sem a tabela, não rejeita', async () => {
    process.env.EDGE_MODE = 'true';
    const { svc, gravados } = servico();
    const agora = Date.parse('2026-10-20T03:00:00Z');
    svc.notar({ ...base, id: 'velho' }, new Date(agora - JANELA_PRESENCA_MS - 1000));
    svc.notar({ ...base, id: 'pdv-1' }, new Date(agora - 10_000));
    await svc.gravarResumo(agora);
    expect(gravados).toHaveLength(1);
    expect(svc.doTenant('t1', agora + 1).map((p) => p.id)).toEqual(['pdv-1']);
    const quebrado = new PresencaService({ execute: async () => { throw new Error('relação "sync_state" não existe'); } } as any);
    await expect(quebrado.gravarResumo(agora)).resolves.toBeUndefined();
  });
});

describe('o IP do PC e o endereço que ele usou', () => {
  it('o IP como o Express entrega', () => {
    expect(ipDoPc('::ffff:192.168.0.23')).toBe('192.168.0.23');
    expect(ipDoPc('192.168.0.23')).toBe('192.168.0.23');
    expect(ipDoPc('fe80::1')).toBe('fe80::1');
    expect(ipDoPc('<script>')).toBeNull();
    expect(ipDoPc(undefined)).toBeNull();
  });

  it('por onde o PC chega: o nome ou o IP, sem a porta', () => {
    expect(enderecoDoHost('regem.local:3002')).toBe('regem.local');
    expect(enderecoDoHost('192.168.0.10:3002')).toBe('192.168.0.10');
    expect(enderecoDoHost('REGEM.LOCAL')).toBe('regem.local');
    expect(enderecoDoHost('[::1]:3002')).toBe('::1');
    expect(enderecoDoHost('evil.com/<x>')).toBeNull();
    expect(enderecoDoHost('')).toBeNull();
  });
});

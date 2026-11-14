import { Logger } from '@nestjs/common';
import { IfoodService, SAUDE_REAFIRMA_MS } from './ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A saúde do canal do iFood (aviso do Mister "iFood ou 99 desconectado"). A resposta de erro da busca de pedidos (401, 403,
// 500…) vira lista vazia para o poller — que então "funcionou" —, então é a PRÓPRIA busca que anota "sem resposta desde"
// na integração. A gravação nunca pode parar a entrada de pedidos.

describe('iFood — a busca de pedidos anota a saúde do canal', () => {
  const ig: any = { id: 'ig-1', tenantId: 't', unidadeId: null, merchantId: 'm', clientId: 'c', clientSecret: 's', token: null, config: {} };
  let servico: IfoodService;
  let anotar: jest.SpyInstance;
  let req: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    servico = new IfoodService({ execute: async () => ({ rows: [] }) } as any);
    anotar = jest.spyOn(servico, 'anotarSaude');
    req = jest.spyOn(servico as any, 'req');
  });
  afterEach(() => jest.restoreAllMocks());

  const resposta = (status: number, corpo: unknown = []) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo, text: async () => '' });

  it('204 e 200 limpam; a resposta de erro marca com o código (e segue devolvendo lista vazia ao poller)', async () => {
    req.mockResolvedValueOnce(resposta(204));
    expect(await servico.polling(ig)).toEqual([]);
    expect(anotar).toHaveBeenLastCalledWith('ig-1', false);
    req.mockResolvedValueOnce(resposta(200, [{ id: 'e1' }]));
    expect(await servico.polling(ig)).toEqual([{ id: 'e1' }]);
    expect(anotar).toHaveBeenLastCalledWith('ig-1', false);
    req.mockResolvedValueOnce(resposta(401));
    expect(await servico.polling(ig)).toEqual([]);
    expect(anotar).toHaveBeenLastCalledWith('ig-1', true, 'http_401');
  });

  it('sem token e sem resposta (rede) marcam com o motivo e o erro segue para o poller', async () => {
    req.mockRejectedValueOnce(new Error('sem token iFood'));
    await expect(servico.polling(ig)).rejects.toThrow('sem token iFood');
    expect(anotar).toHaveBeenLastCalledWith('ig-1', true, 'sem_token');
    req.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { name: 'TypeError' }));
    await expect(servico.polling(ig)).rejects.toThrow('fetch failed');
    expect(anotar).toHaveBeenLastCalledWith('ig-1', true, 'sem_resposta');
  });
});

describe('iFood — a anotação da saúde no banco', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('vai ao banco só quando o estado muda — e reafirma a cada 10 min (a marca pode ter sido ressuscitada por outra gravação)', async () => {
    const execute = jest.fn(async () => ({ rows: [] }));
    const s = new IfoodService({ execute } as any);
    const t0 = Date.parse('2026-11-14T15:00:00Z');
    await s.anotarSaude('ig-1', true, 'http_401', t0);
    await s.anotarSaude('ig-1', true, 'http_401', t0 + 30_000);
    expect(execute).toHaveBeenCalledTimes(1);
    await s.anotarSaude('ig-1', false, null, t0 + 60_000);
    await s.anotarSaude('ig-1', false, null, t0 + 90_000);
    expect(execute).toHaveBeenCalledTimes(2);
    await s.anotarSaude('ig-1', false, null, t0 + 60_000 + SAUDE_REAFIRMA_MS);
    expect(execute).toHaveBeenCalledTimes(3);
    // Outra integração tem o seu próprio estado.
    await s.anotarSaude('ig-2', false, null, t0 + 90_000);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it('banco fora: não lança (a entrada de pedidos não para) e tenta de novo na volta seguinte', async () => {
    const execute = jest.fn(async () => {
      throw new Error('conexão perdida');
    });
    const s = new IfoodService({ execute } as any);
    await expect(s.anotarSaude('ig-1', true, 'sem_resposta')).resolves.toBeUndefined();
    await expect(s.anotarSaude('ig-1', true, 'sem_resposta')).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

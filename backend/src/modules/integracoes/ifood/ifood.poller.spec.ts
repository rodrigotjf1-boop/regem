import { Logger } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { IfoodPoller } from './ifood.poller';

/* eslint-disable @typescript-eslint/no-explicit-any */
// ERR-244: a volta em que o iFood não respondeu a tempo virava ERRO na telemetria (console da
// distribuição), embora a seguinte, 30 s depois, lesse os eventos normalmente — o que não foi lido
// não é reconhecido e volta no próximo polling. Agora é aviso com o motivo; o erro de verdade segue.

describe('IfoodPoller — falha passageira do iFood', () => {
  const ig = { id: 'ig-1', tenantId: 'loja-1', unidadeId: null, merchantId: 'm-1' };
  let erro: jest.SpyInstance;
  let aviso: jest.SpyInstance;
  let linha: jest.SpyInstance;
  const edge = process.env.EDGE_MODE;

  beforeEach(() => {
    delete process.env.EDGE_MODE;
    erro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    linha = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (edge === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edge;
  });

  const montar = (polling: jest.Mock) =>
    new IfoodPoller(
      { integracoesAtivas: async () => [ig], polling, reconciliarCancels: async () => 0 } as any,
      {} as any,
    );

  it('o iFood demorou numa volta e respondeu na seguinte: aviso e "voltou", nenhum erro', async () => {
    const polling = jest.fn().mockRejectedValueOnce(AppError.externalTimeout()).mockResolvedValueOnce([]);
    const poller = montar(polling);
    await poller.tick();
    await poller.tick();
    expect(polling).toHaveBeenCalledTimes(2);
    expect(erro).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledWith(
      'poller iFood loja loja-1: falha passageira (1ª seguida; tenta de novo na próxima volta) — O serviço externo demorou a responder. (tempo esgotado)',
    );
    expect(linha.mock.calls.map((c) => c[0])).toContainEqual(expect.stringMatching(/^poller iFood loja loja-1: voltou a responder depois de 1 falha\(s\) seguida\(s\)/));
  });

  it('erro que não é de rede (banco, código) continua ERRO na hora, com o stack', async () => {
    const falha = new Error('column "x" does not exist');
    const poller = montar(jest.fn().mockRejectedValue(falha));
    await poller.tick();
    expect(erro).toHaveBeenCalledWith('poller iFood loja loja-1: column "x" does not exist', falha.stack);
    expect(aviso).not.toHaveBeenCalled();
  });
});

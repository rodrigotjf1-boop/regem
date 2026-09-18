import { Logger } from '@nestjs/common';
import { TelemetriaExceptionFilter } from './telemetria-exception.filter';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Todo 500 tem de deixar RASTRO LOCAL: a resposta é mascarada e a telemetria só existe com o
// sink da nuvem armado. Reproduzido (set/2026): três 500 no servidor local e zero linhas no log.
describe('TelemetriaExceptionFilter — log local do 5xx', () => {
  const host = (req: any) => {
    const res: any = { headersSent: false, status: jest.fn(() => res), json: jest.fn(() => res) };
    return {
      res,
      h: {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as any,
    };
  };

  it('500 inesperado: responde mascarado E registra método, rota, requestId e a causa real', () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const f = new TelemetriaExceptionFilter({} as any);
    const { h, res } = host({ method: 'GET', originalUrl: '/api/v1/impressao/avisos-roteamento', requestId: 'req-123' });
    f.catch(Object.assign(new Error('coluna u.ativo não existe'), { code: '42703' }), h);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('Ocorreu um erro interno.');
    const linha = String(spy.mock.calls[0]?.[0] ?? '');
    expect(linha).toContain('GET /api/v1/impressao/avisos-roteamento');
    expect(linha).toContain('req-123');
    expect(linha).toContain('coluna u.ativo não existe');
    spy.mockRestore();
  });

  it('4xx de rotina não polui o log', () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { BadRequestException } = jest.requireActual('@nestjs/common');
    const f = new TelemetriaExceptionFilter({} as any);
    f.catch(new BadRequestException('Informe o e-mail.'), host({ method: 'POST', url: '/x' }).h);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

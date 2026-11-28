import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DistribuicaoGuard } from './distribuicao.guard';
import { segredoDaDistribuicao } from './segredo-da-distribuicao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Rodada 7, MIS-G-01 (ERR-659): a chave do console da distribuição nunca é a das lojas.
describe('a chave do console da distribuição (MIS-G-01)', () => {
  const LOJAS = 'segredo-das-lojas-com-mais-de-16';
  const PROPRIA = 'segredo-proprio-do-console-com-32-letras';

  it('com DIST_JWT_SECRET próprio, é ela; faltando ou igual à das lojas, uma chave derivada (nunca a das lojas)', () => {
    expect(segredoDaDistribuicao({ JWT_SECRET: LOJAS, DIST_JWT_SECRET: PROPRIA } as any)).toBe(PROPRIA);
    const derivada = segredoDaDistribuicao({ JWT_SECRET: LOJAS } as any);
    expect(derivada).toMatch(/^[0-9a-f]{64}$/);
    expect(derivada).not.toBe(LOJAS);
    expect(segredoDaDistribuicao({ JWT_SECRET: LOJAS, DIST_JWT_SECRET: LOJAS } as any)).toBe(derivada);
    expect(segredoDaDistribuicao({} as any)).toBe('');
  });

  describe('o guarda', () => {
    const antes = { lojas: process.env.JWT_SECRET, propria: process.env.DIST_JWT_SECRET };
    beforeAll(() => {
      process.env.JWT_SECRET = LOJAS;
      delete process.env.DIST_JWT_SECRET;
    });
    afterAll(() => {
      if (antes.lojas === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = antes.lojas;
      if (antes.propria !== undefined) process.env.DIST_JWT_SECRET = antes.propria;
    });
    const jwt = new JwtService({});
    const service = { porId: async (id: string) => (id === 'u1' ? { id: 'u1', nome: 'Rita', perfil: 'diretoria' } : null) } as any;
    const guarda = new DistribuicaoGuard(jwt, service);
    const pedido = (token: string) => {
      const req: any = { headers: { authorization: `Bearer ${token}` } };
      return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
    };
    const corpo = { sub: 'u1', escopo: 'distribuicao', perfil: 'diretoria', nome: 'Rita' };

    it('o token do console assinado com a chave das LOJAS não passa', async () => {
      const { ctx } = pedido(jwt.sign(corpo, { secret: LOJAS }));
      await expect(guarda.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('o token assinado com a chave do console passa e carrega quem é', async () => {
      const { req, ctx } = pedido(jwt.sign(corpo, { secret: segredoDaDistribuicao() }));
      expect(await guarda.canActivate(ctx)).toBe(true);
      expect(req.distUser).toEqual({ sub: 'u1', nome: 'Rita', perfil: 'diretoria' });
    });
  });
});

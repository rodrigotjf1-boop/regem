import { createHash, randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  ESCOPOS_INTEGRACAO,
  validarEscopos,
} from './escopos';
import {
  formatoTokenIntegracao,
  gerarTokenIntegracao,
  hashTokenIntegracao,
} from './token-integracao';
import { Escopos, IntegracaoTokenGuard } from './integracao-token.guard';
import { BASE_TIPO_PROBLEMA, ProblemaException, problemaDe } from './problema';
import {
  LIMITE_INTEGRACAO_POR_MINUTO,
  bearerDe,
  contarChamadaIntegracao,
  registrarTokenIntegracaoValidado,
  rotaDaIntegracao,
  tokenIntegracaoJaValidado,
} from '../../common/integracao-limite';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TOKEN DE INTEGRAÇÃO POR LOJA (trilha C, C1a) — as regras que não precisam de banco: formato,
// hash, escopos, limite por token, o guard (401/403/429) e o corpo `problem+json`. O caminho
// completo, contra o Postgres e por HTTP, está em `integracao-api.http.spec.ts`.

describe('token de integração — formato e hash', () => {
  it('rgm_it_ + 43 caracteres base64url; o banco guarda o SHA-256 e um prefixo de 12', () => {
    const a = gerarTokenIntegracao();
    const b = gerarTokenIntegracao();
    expect(a.token).toMatch(/^rgm_it_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash('sha256').update(a.token).digest('hex'));
    expect(hashTokenIntegracao(a.token)).toBe(a.hash);
    expect(a.prefixo).toBe(a.token.slice(0, 12));
    expect(a.prefixo.startsWith('rgm_it_')).toBe(true);
  });

  it.each([
    [undefined],
    [''],
    ['rgm_it_curto'],
    ['rgm_xx_' + 'a'.repeat(43)],
    ['rgm_it_' + 'a'.repeat(42) + '!'],
    ['rgm_it_' + 'a'.repeat(44)],
  ])('formato inválido é recusado sem ir ao banco: %p', (t) => {
    expect(formatoTokenIntegracao(t)).toBe(false);
  });
});

describe('escopos', () => {
  it('vazio ou ausente → 400', () => {
    expect(() => validarEscopos([])).toThrow(BadRequestException);
    expect(() => validarEscopos(undefined)).toThrow(BadRequestException);
    expect(() => validarEscopos('pedidos.ler')).toThrow(BadRequestException);
  });

  it('desconhecido → 400 com o nome dele (nunca vira um escopo padrão)', () => {
    expect(() => validarEscopos(['pedidos.ler', 'tudo'])).toThrow(/tudo/);
  });

  it('sem repetição e na ordem do contrato', () => {
    expect(validarEscopos(['cupons.ler', 'pedidos.ler', 'cupons.ler'])).toEqual(['pedidos.ler', 'cupons.ler']);
  });

  it('são os 7 do contrato do Liame + os 2 do RegemCast — a mesma lista do check da mig 302', () => {
    expect([...ESCOPOS_INTEGRACAO]).toEqual([
      'pedidos.ler',
      'clientes.telefone.ler',
      'custos.ler',
      'clientes.anonimizacao.ler',
      'cupons.ler',
      'cupons.uso.ler',
      'cupons.criar',
      'clientes.ler',
      'vendas.99food.ler',
    ]);
  });
});

describe('limite por token (60/min) e isenção do limite por IP', () => {
  it('a 61ª chamada do mesmo token no minuto passa do limite, com Retry-After', () => {
    const id = randomUUID(); // chave própria deste teste (LIC-124)
    for (let i = 0; i < LIMITE_INTEGRACAO_POR_MINUTO; i++) expect(contarChamadaIntegracao(id).ok).toBe(true);
    const r = contarChamadaIntegracao(id);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeg).toBeGreaterThanOrEqual(1);
    expect(r.retryAfterSeg).toBeLessThanOrEqual(60);
    // Outro token tem o balde dele.
    expect(contarChamadaIntegracao(randomUUID()).ok).toBe(true);
  });

  it('só a rota de integração com token JÁ validado sai do limite por IP', async () => {
    const guard = new CfThrottlerGuard({} as any, {} as any, {} as any);
    const ctx = (url: string, auth?: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, headers: auth ? { authorization: auth } : {} }) }),
      }) as any;
    const { token } = gerarTokenIntegracao();
    const pular = (c: any) => (guard as any).shouldSkip(c);
    expect(await pular(ctx('/api/v1/integracao/loja', `Bearer ${token}`))).toBe(false); // ainda não validado
    registrarTokenIntegracaoValidado(token);
    expect(await pular(ctx('/api/v1/integracao/loja', `Bearer ${token}`))).toBe(true);
    expect(await pular(ctx('/api/v1/integracao/loja', `Bearer ${gerarTokenIntegracao().token}`))).toBe(false);
    // O mesmo token numa rota que não é de integração segue no limite por IP.
    expect(await pular(ctx('/api/v1/vendas', `Bearer ${token}`))).toBe(false);
    expect(await pular(ctx('/api/v1/integracoes/ifood/webhook', `Bearer ${token}`))).toBe(false);
  });

  it('reconhece a rota e o cabeçalho', () => {
    expect(rotaDaIntegracao('/api/v1/integracao/loja')).toBe(true);
    expect(rotaDaIntegracao('/api/v1/integracao?x=1')).toBe(true);
    expect(rotaDaIntegracao('/api/v1/integracoes/gogem')).toBe(false);
    expect(bearerDe({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(bearerDe({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(bearerDe({ headers: {} })).toBeNull();
  });
});

describe('IntegracaoTokenGuard', () => {
  class Rotas {
    @Escopos('pedidos.ler')
    pedidos() {}
    loja() {}
  }
  const ctxDe = (handler: any, auth?: string) => {
    const req: any = { headers: auth ? { authorization: auth } : {}, ip: '10.0.0.1' };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => handler,
        getClass: () => Rotas,
      } as any,
    };
  };
  const valido = (escopos: string[]) => ({
    tokenId: randomUUID(),
    tenantId: randomUUID(),
    unidadeId: randomUUID(),
    lojaUnica: true,
    escopos,
    cliente: 'liame',
    autorizadoPor: randomUUID(),
    prefixo: 'rgm_it_abcde',
  });
  const guardCom = (resultado: any) => {
    const svc = { validar: jest.fn(async () => resultado), marcarUso: jest.fn() };
    return { svc, guard: new IntegracaoTokenGuard(svc as any, new Reflector()) };
  };

  it('sem token ou com formato errado → 401 sem consultar o banco', async () => {
    const { svc, guard } = guardCom(valido(['pedidos.ler']));
    for (const auth of [undefined, 'Bearer nada', `Basic ${gerarTokenIntegracao().token}`]) {
      const { ctx } = ctxDe(Rotas.prototype.loja, auth);
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({ tipo: 'token-invalido' });
    }
    expect(svc.validar).not.toHaveBeenCalled();
  });

  it('token que o banco não reconhece (revogado, vencido, loja apagada…) → 401', async () => {
    const { guard } = guardCom(null);
    const { ctx } = ctxDe(Rotas.prototype.loja, `Bearer ${gerarTokenIntegracao().token}`);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ tipo: 'token-invalido' });
  });

  it('token validado antes e revogado depois volta ao limite por IP na mesma chamada', async () => {
    // Sem isto, o token revogado seguiria isento do limite por IP até a marca vencer (10 min),
    // fora também do limite do token (que só conta token válido) — cada chamada indo ao banco.
    const { token } = gerarTokenIntegracao();
    registrarTokenIntegracaoValidado(token);
    expect(tokenIntegracaoJaValidado(token)).toBe(true);
    const { guard } = guardCom(null);
    const { ctx } = ctxDe(Rotas.prototype.loja, `Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ tipo: 'token-invalido' });
    expect(tokenIntegracaoJaValidado(token)).toBe(false);
  });

  it('escopo que a rota exige e o token não tem → 403', async () => {
    const { guard } = guardCom(valido(['cupons.ler']));
    const { ctx } = ctxDe(Rotas.prototype.pedidos, `Bearer ${gerarTokenIntegracao().token}`);
    const erro: any = await guard.canActivate(ctx).catch((e) => e);
    expect(erro).toBeInstanceOf(ProblemaException);
    expect(erro.getStatus()).toBe(403);
    expect(erro.tipo).toBe('escopo-insuficiente');
    expect(erro.message).toContain('pedidos.ler');
  });

  it('com o escopo (ou rota sem escopo) passa e monta o contexto da loja do token', async () => {
    const t = valido(['pedidos.ler']);
    const { svc, guard } = guardCom(t);
    const { ctx, req } = ctxDe(Rotas.prototype.pedidos, `Bearer ${gerarTokenIntegracao().token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.integracao).toEqual(t);
    expect(svc.marcarUso).toHaveBeenCalledWith(t.tokenId, '10.0.0.1');
    const { ctx: c2 } = ctxDe(Rotas.prototype.loja, `Bearer ${gerarTokenIntegracao().token}`);
    await expect(guard.canActivate(c2)).resolves.toBe(true);
  });

  it('passou do limite do token → 429 com Retry-After, antes de olhar o escopo', async () => {
    const t = valido([]); // sem escopo nenhum: se o limite viesse depois, seria 403 para sempre
    const { guard } = guardCom(t);
    for (let i = 0; i < LIMITE_INTEGRACAO_POR_MINUTO; i++) contarChamadaIntegracao(t.tokenId);
    const { ctx } = ctxDe(Rotas.prototype.pedidos, `Bearer ${gerarTokenIntegracao().token}`);
    const erro: any = await guard.canActivate(ctx).catch((e) => e);
    expect(erro.getStatus()).toBe(429);
    expect(erro.tipo).toBe('limite-de-chamadas');
    expect(erro.retryAfterSeg).toBeGreaterThanOrEqual(1);
  });
});

describe('erros em application/problem+json (RFC 9457)', () => {
  it('type, title, status, detail e request_id', () => {
    const { status, corpo } = problemaDe(new ProblemaException(401, 'token-invalido', 'sem token'), 'req-1');
    expect(status).toBe(401);
    expect(corpo).toEqual({
      type: `${BASE_TIPO_PROBLEMA}token-invalido`,
      title: 'Token inválido',
      status: 401,
      detail: 'sem token',
      request_id: 'req-1',
    });
  });

  it('o que vem de fora do controller também sai no formato (404 do CloudOnly, 429 por IP, 400)', () => {
    expect(problemaDe(new NotFoundException()).corpo.type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
    expect(problemaDe(new ThrottlerException()).corpo.type).toBe(`${BASE_TIPO_PROBLEMA}limite-de-chamadas`);
    expect(problemaDe(new BadRequestException('x')).corpo).toMatchObject({ status: 400, detail: 'x' });
  });

  it('5xx mascara a mensagem (nunca vaza SQL nem detalhe interno)', () => {
    const { status, corpo } = problemaDe(new Error('relation "x" does not exist'));
    expect(status).toBe(500);
    expect(corpo.type).toBe(`${BASE_TIPO_PROBLEMA}erro-interno`);
    expect(corpo.detail).not.toContain('relation');
    expect(problemaDe(new HttpException('segredo', 503)).corpo.detail).not.toContain('segredo');
  });
});

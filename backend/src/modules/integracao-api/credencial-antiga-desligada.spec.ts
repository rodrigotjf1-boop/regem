import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { credencialAntigaDesligada, CREDENCIAL_RETIRADA } from '../../common/retirada-credencial';
import { AutorizacaoLojaService, TROCA_DE_01_10_RETIRADA } from './autorizacao-loja.service';
import { CredencialDoTotemGuard } from './credencial-totem.guard';
import { IntegracaoTokenGuard } from './integracao-token.guard';
import { EMISSAO_RETIRADA, IntegracaoTokenService } from './integracao-token.service';
import { LigacaoIntegracaoService, TROCA_AUTOMATICA_RETIRADA } from './ligacao-integracao.service';
import { ProblemaException } from './problema';
import { formatoTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O DESLIGAMENTO DA CREDENCIAL ANTIGA (Hub DMS F6, plano "Fim das portas antigas", P-4; decisão do dono em 17/11/2026,
// sem o prazo de 90 dias porque não há parceiro de fora e todas as integrações em uso já estão no clique). Com
// `INTEGRACAO_ANTIGA_DESLIGADA=true`, o token colado e o caminho antigo do totem na nuvem são recusados, e nada mais cria
// ou troca token colado. Sem a variável, tudo como antes (cada caso abaixo prova os dois lados).

const TOKEN = `rgm_it_${'A'.repeat(43)}`;
/** Banco que não pode ser tocado: o desligamento recusa antes de qualquer consulta. */
const bancoIntocavel = new Proxy({}, { get: () => () => { throw new Error('o banco não devia ser consultado'); } });
const auditoriaIntocavel = { registrar: async () => { throw new Error('a auditoria não devia ser chamada'); } } as any;

function contexto(req: any, res: any = { setHeader: () => undefined, headersSent: false }) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

async function recusa(promessa: Promise<unknown>): Promise<HttpException> {
  try {
    await promessa;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('devia ter sido recusado');
}

describe('a credencial antiga desligada (P-4)', () => {
  const antes = { desligada: process.env.INTEGRACAO_ANTIGA_DESLIGADA, edge: process.env.EDGE_MODE, dmsId: process.env.DMS_ID_EMISSOR };
  const desligar = () => (process.env.INTEGRACAO_ANTIGA_DESLIGADA = 'true');
  afterEach(() => {
    for (const [nome, valor] of [['INTEGRACAO_ANTIGA_DESLIGADA', antes.desligada], ['EDGE_MODE', antes.edge], ['DMS_ID_EMISSOR', antes.dmsId]] as const) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });
  beforeEach(() => {
    delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
    delete process.env.EDGE_MODE;
  });

  it('a chave: só "true" (sem diferença de maiúsculas e espaços) liga; vazio, ausente ou outro valor, não', () => {
    expect(credencialAntigaDesligada({})).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: '' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: '1' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: 'sim' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: 'false' })).toBe(false);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: 'true' })).toBe(true);
    expect(credencialAntigaDesligada({ INTEGRACAO_ANTIGA_DESLIGADA: ' TRUE ' })).toBe(true);
  });

  describe('a porta de integração (token colado `rgm_it_`)', () => {
    function guarda() {
      const tokens = { validar: jest.fn(async () => null) };
      return { g: new IntegracaoTokenGuard(tokens as any, new Reflector()), tokens };
    }
    const pedido = () => ({ headers: { authorization: `Bearer ${TOKEN}` }, method: 'GET', originalUrl: '/api/v1/integracao/loja' });

    it('desligada: 401 token-invalido com a frase do clique e o desafio do Bearer, sem ir ao banco', async () => {
      expect(formatoTokenIntegracao(TOKEN)).toBe(true);
      desligar();
      const { g, tokens } = guarda();
      const cab: Record<string, string> = {};
      const e = await recusa(g.canActivate(contexto(pedido(), { setHeader: (n: string, v: string) => (cab[n] = v), headersSent: false })));
      expect(e).toBeInstanceOf(ProblemaException);
      expect([e.getStatus(), (e as ProblemaException).tipo, e.message]).toEqual([401, 'token-invalido', CREDENCIAL_RETIRADA]);
      expect(cab['WWW-Authenticate']).toMatch(/^Bearer/);
      expect(tokens.validar).not.toHaveBeenCalled();
    });

    it('sem a chave: o token vai ao banco como sempre (aqui não existe: 401 de token inválido, com outra frase)', async () => {
      const { g, tokens } = guarda();
      const e = await recusa(g.canActivate(contexto(pedido())));
      expect(tokens.validar).toHaveBeenCalledTimes(1);
      expect([e.getStatus(), e.message === CREDENCIAL_RETIRADA]).toEqual([401, false]);
    });
  });

  describe('as rotas do totem (GoGeM)', () => {
    function guarda() {
      const g = new CredencialDoTotemGuard({} as any, bancoIntocavel as any);
      const antigo = jest.spyOn((g as any).antigo, 'canActivate').mockImplementation(async () => true);
      return { g, antigo };
    }
    const comSyncToken = () => ({ headers: { 'x-sync-token': 'token-do-equipamento', 'x-integrador': 'gogem' } });
    const comToken = () => ({ headers: { authorization: `Bearer ${TOKEN}` } });

    it('na nuvem, desligada: o caminho antigo (`X-Sync-Token`) é recusado sem chegar ao guarda antigo', async () => {
      desligar();
      const { g, antigo } = guarda();
      const e = await recusa(g.canActivate(contexto(comSyncToken())));
      expect([e.getStatus(), (e as ProblemaException).tipo, e.message]).toEqual([401, 'token-invalido', CREDENCIAL_RETIRADA]);
      expect(antigo).not.toHaveBeenCalled();
    });

    it('na nuvem, desligada: o token colado do totem é recusado sem ir ao banco', async () => {
      desligar();
      const { g } = guarda();
      const e = await recusa(g.canActivate(contexto(comToken())));
      expect([e.getStatus(), e.message]).toEqual([401, CREDENCIAL_RETIRADA]);
    });

    it('no SERVIDOR DA LOJA, desligada: o `X-Sync-Token` segue valendo (o totem fala com o servidor pela rede da loja)', async () => {
      desligar();
      process.env.EDGE_MODE = 'true';
      const { g, antigo } = guarda();
      await expect(g.canActivate(contexto(comSyncToken()))).resolves.toBe(true);
      expect(antigo).toHaveBeenCalledTimes(1);
    });

    it('na nuvem, sem a chave: o caminho antigo segue para o guarda antigo, como sempre', async () => {
      const { g, antigo } = guarda();
      await expect(g.canActivate(contexto(comSyncToken()))).resolves.toBe(true);
      expect(antigo).toHaveBeenCalledTimes(1);
    });
  });

  describe('nada mais cria ou troca token colado', () => {
    it('a troca da página de 01/10: desligada = 404 com a frase do clique; sem a chave, a conferência de sempre', async () => {
      const s = new AutorizacaoLojaService(bancoIntocavel as any, auditoriaIntocavel, {} as any);
      desligar();
      const e = await recusa(s.trocar({ client_id: 'liame', client_secret: 'x', code: 'y' }));
      expect([e.getStatus(), (e as ProblemaException).tipo, e.message]).toEqual([404, 'nao-encontrado', TROCA_DE_01_10_RETIRADA]);
      delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
      const antes = await recusa(s.trocar({ client_id: 'quem-nao-existe', client_secret: 'x' }));
      expect([antes.getStatus(), (antes as ProblemaException).tipo]).toEqual([401, 'cliente-invalido']);
    });

    it('a troca automática do token colado pela ligação: desligada = 404; sem a chave, a conferência de sempre', async () => {
      const s = new LigacaoIntegracaoService(bancoIntocavel as any, auditoriaIntocavel);
      desligar();
      const e = await recusa(s.trocar(TOKEN, 'aplicativo', {}));
      expect([e.getStatus(), (e as ProblemaException).tipo, e.message]).toEqual([404, 'nao-encontrado', TROCA_AUTOMATICA_RETIRADA]);
      delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
      const antes = await recusa(s.trocar('fora-do-formato', 'aplicativo', {}));
      expect([antes.getStatus(), (antes as ProblemaException).tipo]).toEqual([401, 'ligacao-invalida']);
    });

    it('a emissão pelo console da distribuição: desligada = recusa com a frase; sem a chave, a conferência de sempre', async () => {
      const s = new IntegracaoTokenService(bancoIntocavel as any, auditoriaIntocavel);
      desligar();
      const e = await recusa(s.emitir({ tenantId: 'qualquer', cliente: 'liame' }, { sub: 'operador' }));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe(EMISSAO_RETIRADA);
      delete process.env.INTEGRACAO_ANTIGA_DESLIGADA;
      const antes = await recusa(s.emitir({ tenantId: 'nao-e-uuid' }, { sub: 'operador' }));
      expect([antes.getStatus(), antes.message === EMISSAO_RETIRADA]).toEqual([400, false]);
    });
  });
});

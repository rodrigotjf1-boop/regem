import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FilaImpressaoGuard } from './fila-impressao.guard';
import { SyncTokenGuard } from '../sync/sync-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL DA ESTAÇÃO DE IMPRESSÃO (mig 324) SÓ ABRE A FILA DE IMPRESSÃO.
// A lição do GoGeM (ERR-232): credencial de integração que reaproveitava o token do servidor da
// loja abria o sincronismo inteiro. A estação tem credencial própria (X-Estacao-Id +
// X-Estacao-Segredo), aceita por UMA guarda, que só existe nas rotas da fila. Este teste é a lista
// fechada: rota nova com essa guarda tem de entrar aqui de propósito.

function contexto(headers: Record<string, string>, url = '/api/v1/impressao/pendentes') {
  const req: any = { headers, originalUrl: url, url };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => undefined, getClass: () => undefined } as any };
}

const estacao = { id: 'e-estacao', tenantId: 't1', unidadeId: 'u1', tipo: 'estacao_impressao' };
const servidorDaLoja = { id: 'e-loja', tenantId: 't1', unidadeId: 'u1', tipo: 'servidor_local', integrador: null, lastPushSeq: 1 };

function guarda(opc: { estacao?: any; token?: any } = {}) {
  const chamadas = { validarEstacao: 0, validarToken: 0 };
  const g = new FilaImpressaoGuard({
    validarEstacao: async () => {
      chamadas.validarEstacao++;
      return opc.estacao ?? null;
    },
    validarToken: async () => {
      chamadas.validarToken++;
      return opc.token ?? null;
    },
    notarIntegrador: async () => undefined,
  } as any);
  return { g, chamadas };
}

describe('FilaImpressaoGuard', () => {
  it('estação válida: entra com a empresa e a loja DELA, marcada como estação', async () => {
    const { g, chamadas } = guarda({ estacao });
    const { req, ctx } = contexto({ 'x-estacao-id': 'e-estacao', 'x-estacao-segredo': 's' });
    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.fila).toEqual({ tenantId: 't1', unidadeId: 'u1', equipamentoId: 'e-estacao', estacaoId: 'e-estacao' });
    expect(chamadas.validarToken).toBe(0);
  });

  it('com o cabeçalho da estação, inválida é 401 — nunca cai no token antigo, mesmo que ele venha junto', async () => {
    const { g, chamadas } = guarda({ token: servidorDaLoja });
    const { ctx } = contexto({ 'x-estacao-id': 'e-estacao', 'x-estacao-segredo': 'errado', 'x-sync-token': 'tok' });
    await expect(g.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(chamadas.validarToken).toBe(0);
  });

  it('sem o cabeçalho da estação: vale o token de sempre (servidor da loja), sem marca de estação', async () => {
    const { g, chamadas } = guarda({ token: servidorDaLoja });
    const { req, ctx } = contexto({ 'x-sync-token': 'tok' });
    expect(await g.canActivate(ctx)).toBe(true);
    expect(req.fila).toEqual({ tenantId: 't1', unidadeId: 'u1', equipamentoId: 'e-loja', estacaoId: null });
    expect(chamadas.validarEstacao).toBe(0);
  });

  it('o segredo da estação não autentica no guarda do sincronismo', async () => {
    const sync = new SyncTokenGuard({ validarToken: async () => estacao, notarIntegrador: async () => undefined } as any);
    const { ctx } = contexto({ 'x-estacao-id': 'e-estacao', 'x-estacao-segredo': 's' }, '/api/v1/sync/pull');
    await expect(sync.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('lista fechada: a guarda da estação só existe nas rotas da fila', () => {
  // Todos os controllers do backend, lidos do disco: controller novo entra sozinho na varredura.
  const raiz = join(__dirname, '..');
  const arquivos: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, nome.name);
      if (nome.isDirectory()) andar(caminho);
      else if (nome.name.endsWith('.controller.ts')) arquivos.push(caminho);
    }
  };
  andar(raiz);

  it('varreu os controllers (guarda contra a varredura parar de achar arquivos)', () => {
    expect(arquivos.length).toBeGreaterThan(40);
  });

  it('só as 5 rotas da fila de impressão usam a FilaImpressaoGuard', () => {
    const usos: string[] = [];
    for (const arq of arquivos) {
      const mod = require(arq);
      for (const exp of Object.values(mod)) {
        if (typeof exp !== 'function' || Reflect.getMetadata(PATH_METADATA, exp) === undefined) continue;
        const daClasse: any[] = Reflect.getMetadata(GUARDS_METADATA, exp) ?? [];
        if (daClasse.includes(FilaImpressaoGuard)) usos.push(`${(exp as any).name}#(classe)`);
        for (const metodo of Object.getOwnPropertyNames((exp as any).prototype)) {
          const fn = (exp as any).prototype[metodo];
          if (typeof fn !== 'function') continue;
          const guardas: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
          if (guardas.includes(FilaImpressaoGuard)) usos.push(`${(exp as any).name}#${metodo}`);
        }
      }
    }
    expect(usos.sort()).toEqual([
      'ImpressaoController#devolver',
      'ImpressaoController#erro',
      'ImpressaoController#impresso',
      'ImpressaoController#pendentes',
      'ImpressaoController#pendentesEspera',
    ]);
  });
});

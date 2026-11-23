import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { CATALOGO_PERMISSOES, PACOTE_SUPORTE, perfilPadrao, podeAcessar } from '../../auth/permissoes';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { NoticiasRamoController } from './noticias-ramo.controller';
import { NoticiasRamoService, diaDoPedido } from './noticias-ramo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// As Notícias do ramo (fase N1): quem vê, o ramo, o dia pedido e a loja sem internet. A leitura da cópia no Postgres está em
// `pulso-pg.spec.ts`.
const TENANT = '11111111-1111-4111-8111-111111111111';
const BOLETIM = { dia: '2026-11-23', mensagem: null, indicadores: [], destaques: [], novidades: [], mais: [] };

/** O banco de mentira: devolve as respostas na ordem das consultas. */
function bancoFalso(...respostas: any[][]) {
  const execute = jest.fn(async () => ({ rows: respostas.shift() ?? [] }));
  return { db: { execute } as any, execute };
}

describe('Notícias do ramo', () => {
  const ambiente = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  const fetchDeVerdade = global.fetch;
  afterEach(() => {
    for (const [k, v] of Object.entries(ambiente)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    global.fetch = fetchDeVerdade;
    jest.restoreAllMocks();
  });

  it('a permissão: está no catálogo, nasce só com o presidente e o suporte padrão não recebe', () => {
    expect(CATALOGO_PERMISSOES.find((c) => c.chave === 'noticias_ramo')).toMatchObject({ grupo: 'Relatórios', tipo: 'bool' });
    expect(podeAcessar(perfilPadrao('presidente').permissoes, 'noticias_ramo')).toBe(true);
    for (const nivel of ['gerente', 'supervisao', 'execucao']) expect(podeAcessar(perfilPadrao(nivel).permissoes, 'noticias_ramo')).toBe(false);
    expect(podeAcessar(PACOTE_SUPORTE, 'noticias_ramo')).toBe(false);
    expect(podeAcessar({ noticias_ramo: true }, 'noticias_ramo')).toBe(true);
  });

  it('a rota: a da tela exige a permissão; a do servidor da loja só existe na nuvem; o módulo roda nos dois lados', () => {
    const ler = NoticiasRamoController.prototype.ler;
    const loja = NoticiasRamoController.prototype.doServidorDaLoja;
    expect(Reflect.getMetadata(REQUIRE_PERM, ler)).toMatchObject({ modulo: 'noticias_ramo' });
    expect(Reflect.getMetadata(CLOUD_ONLY, ler)).toBeUndefined();
    expect(Reflect.getMetadata(CLOUD_ONLY, loja)).toBe(true);
    expect(CLOUD_ONLY_MODULES as readonly string[]).not.toContain('NoticiasRamoModule');
  });

  it('o dia pedido: vazio é o mais recente; dia que não existe no calendário é recusado', () => {
    expect(diaDoPedido(undefined)).toBeNull();
    expect(diaDoPedido('')).toBeNull();
    expect(diaDoPedido('2026-11-23')).toBe('2026-11-23');
    for (const ruim of ['2026-02-31', '23/11/2026', 'abc', 20261123, ['2026-11-23']]) expect(() => diaDoPedido(ruim)).toThrow(BadRequestException);
  });

  it('empresa de outro ramo não lê o boletim, nem pela rota do servidor da loja', async () => {
    const a = bancoFalso([{ ramo: 'varejo' }]);
    await expect(new NoticiasRamoService(a.db).daTela(TENANT)).rejects.toThrow(NotFoundException);
    expect(a.execute).toHaveBeenCalledTimes(1);
    const b = bancoFalso([{ ramo: 'varejo' }]);
    await expect(new NoticiasRamoService(b.db).paraOServidorDaLoja(TENANT)).rejects.toThrow(NotFoundException);
    expect(b.execute).toHaveBeenCalledTimes(1);
  });

  describe('no servidor da loja', () => {
    const naLoja = () => {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = 'https://nuvem.teste/api/v1/';
      process.env.SYNC_TOKEN = 'token-do-sincronismo';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      return new NoticiasRamoService(bancoFalso([{ ramo: 'food_service' }]).db);
    };

    it('pede à nuvem com o token do sincronismo e o dia', async () => {
      const svc = naLoja();
      const f = jest.fn(async () => new Response(JSON.stringify({ semNuvem: false, dia: '2026-11-23', dias: ['2026-11-23'], boletim: BOLETIM }), { status: 200 }));
      global.fetch = f as any;
      expect(await svc.daTela(TENANT, '2026-11-23')).toEqual({ semNuvem: false, dia: '2026-11-23', dias: ['2026-11-23'], boletim: BOLETIM });
      const [url, init] = f.mock.calls[0] as unknown as [string, any];
      expect(url).toBe('https://nuvem.teste/api/v1/noticias-do-ramo/loja?dia=2026-11-23');
      expect(init.headers).toEqual({ 'x-sync-token': 'token-do-sincronismo' });
    });

    it('sem internet, a resposta diz semNuvem em vez de fingir que não há boletim', async () => {
      const svc = naLoja();
      global.fetch = jest.fn(async () => {
        throw new TypeError('fetch failed');
      }) as any;
      expect(await svc.daTela(TENANT)).toEqual({ semNuvem: true, dia: null, dias: [], boletim: null });
    });

    it('a nuvem com erro ou resposta torta também vira semNuvem; o 404 do ramo continua 404', async () => {
      let svc = naLoja();
      global.fetch = jest.fn(async () => new Response('x', { status: 502 })) as any;
      expect((await svc.daTela(TENANT)).semNuvem).toBe(true);
      svc = naLoja();
      global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any;
      expect((await svc.daTela(TENANT)).semNuvem).toBe(true);
      svc = naLoja();
      global.fetch = jest.fn(async () => new Response('{}', { status: 404 })) as any;
      await expect(svc.daTela(TENANT)).rejects.toThrow(NotFoundException);
    });
  });
});

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../../../app.module';
import { MAPA_DO_REGEM, MARCAS_DO_MAPA } from './mapa-do-regem';

// Versão 10, C2: o mapa do Regem (decisão V10-3 — a marca de cada função é da DMS, e função nova sem marca reprova o CI). O teste
// monta o app inteiro, como o `app-sobe.spec.ts`, lê as rotas de verdade pelo Swagger e compara com o mapa.

jest.setTimeout(180_000);

const COMO_RESOLVER =
  'Função da API sem marca no mapa do Mister: acrescente a linha em backend/src/modules/mister/mapa/mapa-do-regem.ts (a rota, a marca le|botao|pin|tela|interna e a frase). Função que saiu: tire a linha.';

describe('C2 · o mapa do Regem', () => {
  it('toda função da API tem marca no mapa, e o mapa não tem função que não existe', async () => {
    process.env.DATABASE_URL ??= process.env.TEST_PG_URL ?? 'postgresql://ninguem:ninguem@127.0.0.1:1/ninguem';
    process.env.JWT_SECRET ??= 'teste-mapa-do-regem';
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api/v1');
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    await app.close();
    const rotas = Object.entries(doc.paths).flatMap(([caminho, metodos]) => Object.keys(metodos as object).map((m) => `${m.toUpperCase()} ${caminho}`));
    const noMapa = new Set(MAPA_DO_REGEM.map((f) => f.rota));
    const daApi = new Set(rotas);
    const semMarca = rotas.filter((r) => !noMapa.has(r)).sort();
    const sobrando = [...noMapa].filter((r) => !daApi.has(r)).sort();
    expect({ semMarca, sobrando, comoResolver: semMarca.length || sobrando.length ? COMO_RESOLVER : '' }).toEqual({ semMarca: [], sobrando: [], comoResolver: '' });
  });

  it('cada linha: uma rota só, uma marca da lista e uma frase', () => {
    const vistas = new Set<string>();
    for (const f of MAPA_DO_REGEM) {
      expect([f.rota, vistas.has(f.rota)]).toEqual([f.rota, false]);
      vistas.add(f.rota);
      expect(f.rota).toMatch(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|SEARCH) \/api\/v1\//);
      expect(MARCAS_DO_MAPA).toContain(f.marca);
      expect(f.frase.trim().length).toBeGreaterThan(2);
    }
  });

  it('as áreas que o Mister nunca usa ficam internas (o público, a distribuição, o servidor da loja, o sync, o próprio Mister)', () => {
    for (const f of MAPA_DO_REGEM) {
      const area = f.rota.split(' ')[1].replace(/^\/api\/v1\//, '').split('/')[0];
      if (['publico', 'distribuicao', 'edge', 'sync', 'mister', 'auth'].includes(area)) expect([f.rota, f.marca]).toEqual([f.rota, 'interna']);
    }
  });
});

import { INestApplication, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../../../app.module';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { MAPA_DO_REGEM, MARCAS_DO_MAPA } from './mapa-do-regem';
import { TAREFAS_ABERTAS } from './tarefas-abertas';

// Versão 10, C2: o mapa do Regem (decisão V10-3 — a marca de cada função é da DMS, e função nova sem marca reprova o CI). O teste
// monta o app inteiro, como o `app-sobe.spec.ts`, lê as rotas de verdade pelo Swagger e compara com o mapa.
// C3: o Mister lê as funções marcadas `le` com o bilhete de uma chamada, e o bilhete só vale no `JwtAuthGuard`; por isso toda
// leitura `le` tem de passar por ele (a rota do totem, do servidor da loja ou de um aparelho tem a credencial dela: é `interna`).

jest.setTimeout(180_000);

const COMO_RESOLVER =
  'Função da API sem marca no mapa do Mister: acrescente a linha em backend/src/modules/mister/mapa/mapa-do-regem.ts (a rota, a marca le|botao|pin|tela|interna e a frase em português de quem usa; leitura que devolve cliente, conversa, candidato, contato ou endereço leva `pessoal: true`; leitura com credencial própria — servidor da loja, totem, aparelho — é `interna`). Função que saiu: tire a linha.';

const NOME_DO_METODO: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

/** Cada rota do app ("GET /api/v1/x/{id}") com os guardas da classe e do método. */
function rotasComGuardas(app: INestApplication): Map<string, unknown[]> {
  const fora = new Map<string, unknown[]>();
  const juntar = (...partes: string[]) => ('/' + partes.filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/\/$/, '').replace(/:(\w+)/g, '{$1}');
  for (const mod of app.get(ModulesContainer).values()) {
    for (const w of mod.controllers.values()) {
      const cls = w.metatype as any;
      if (!cls?.prototype) continue;
      const doCtrl = Reflect.getMetadata(PATH_METADATA, cls);
      const prefixos: string[] = Array.isArray(doCtrl) ? doCtrl : [doCtrl ?? ''];
      const daClasse: unknown[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
      for (const nome of Object.getOwnPropertyNames(cls.prototype)) {
        const fn = cls.prototype[nome];
        if (typeof fn !== 'function' || nome === 'constructor') continue;
        const caminho = Reflect.getMetadata(PATH_METADATA, fn);
        const metodo = NOME_DO_METODO[Reflect.getMetadata(METHOD_METADATA, fn) as number];
        if (caminho === undefined || !metodo) continue;
        const doMetodo: unknown[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
        for (const pre of prefixos) for (const c of Array.isArray(caminho) ? caminho : [caminho]) fora.set(`${metodo} ${juntar('api/v1', pre, c)}`, [...daClasse, ...doMetodo]);
      }
    }
  }
  return fora;
}

describe('C2 · o mapa do Regem', () => {
  let rotas: string[] = [];
  let guardas = new Map<string, unknown[]>();

  beforeAll(async () => {
    process.env.DATABASE_URL ??= process.env.TEST_PG_URL ?? 'postgresql://ninguem:ninguem@127.0.0.1:1/ninguem';
    process.env.JWT_SECRET ??= 'teste-mapa-do-regem';
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.setGlobalPrefix('api/v1');
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    guardas = rotasComGuardas(app);
    await app.close();
    rotas = Object.entries(doc.paths).flatMap(([caminho, metodos]) => Object.keys(metodos as object).map((m) => `${m.toUpperCase()} ${caminho}`));
  });

  it('toda função da API tem marca no mapa, e o mapa não tem função que não existe', () => {
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

  it('C3: "pessoal" só em leitura, as áreas de pessoas são todas "pessoal", e a consulta tem nomes simples', () => {
    for (const f of MAPA_DO_REGEM) {
      const area = f.rota.split(' ')[1].replace(/^\/api\/v1\//, '').split('/')[0];
      if (f.pessoal) expect([f.rota, f.marca]).toEqual([f.rota, 'le']);
      if (f.marca === 'le' && ['atendimento', 'whatsapp', 'clientes', 'vagas', 'ponto', 'colaboradores', 'colaborador', 'auditoria'].includes(area)) expect([f.rota, f.pessoal]).toEqual([f.rota, true]);
      for (const c of f.consulta ?? []) expect([f.rota, c]).toEqual([f.rota, expect.stringMatching(/^[A-Za-z_][\w.]{0,40}$/)]);
      if (f.consulta?.length) expect([f.rota, f.marca, !!f.pessoal]).toEqual([f.rota, 'le', false]);
    }
  });

  it('C4: toda tarefa aberta é escrita do mapa (botao ou pin), sem dado de pessoa, e passa pelo JwtAuthGuard', () => {
    for (const t of TAREFAS_ABERTAS) {
      const f = MAPA_DO_REGEM.find((x) => x.rota === t.rota);
      expect([t.rota, f?.marca, !!f?.pessoal]).toEqual([t.rota, expect.stringMatching(/^(botao|pin)$/), false]);
      expect([t.rota, (guardas.get(t.rota) ?? []).includes(JwtAuthGuard)]).toEqual([t.rota, true]);
    }
  });

  it('C3: toda leitura `le` passa pelo JwtAuthGuard (o bilhete do Mister só vale nele)', () => {
    const semOGuarda = MAPA_DO_REGEM.filter((f) => f.marca === 'le' && !(guardas.get(f.rota) ?? []).includes(JwtAuthGuard))
      .map((f) => f.rota)
      .sort();
    expect(semOGuarda).toEqual([]);
  });
});

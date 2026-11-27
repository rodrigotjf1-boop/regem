import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { OPTIONAL_DEPS_METADATA, PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';

// O APLICATIVO INTEIRO MONTA (ERR novo de 02/11/2026): um controlador novo com um guarda que depende de outro módulo
// (o SyncTokenGuard pede o EquipamentoService) compilava, passava em todos os testes — que montam os serviços à mão — e
// derrubava a API na hora de subir ("Nest can't resolve dependencies…"): o deploy ficaria fora do ar. Aqui o Nest resolve
// e instancia TODAS as dependências do AppModule, como o `gen-openapi.js` — sem `listen` (sem porta) e sem `init` (as
// rotinas de início não rodam).
jest.setTimeout(120_000);

const montar = () => {
  process.env.DATABASE_URL ??= process.env.TEST_PG_URL ?? 'postgresql://ninguem:ninguem@127.0.0.1:1/ninguem';
  process.env.JWT_SECRET ??= 'teste-app-sobe';
  return NestFactory.create(AppModule, { logger: false, abortOnError: false });
};

/** Os nomes dos parâmetros do construtor (o JS compilado mantém os nomes: `constructor(db, numero, …)`). */
function nomesDoConstrutor(cls: Function): string[] {
  const m = /constructor\s*\(([^)]*)\)/.exec(Function.prototype.toString.call(cls));
  return m ? m[1].split(',').map((p) => p.replace(/=.*$/s, '').trim()).filter(Boolean) : [];
}

describe('o aplicativo monta (todas as dependências resolvem)', () => {
  it('AppModule resolve o grafo de dependências', async () => {
    const app = await montar();
    expect(app).toBeDefined();
    await app.close();
  });

  // ERR-625: um ciclo de dependências marcadas @Optional (ferramentas → documentos → notas → ferramentas) não derruba nada —
  // o Nest fecha o ciclo injetando `undefined` num dos pontos, calado. O serviço das notas ficou sem as ferramentas, nunca
  // registrou o `documento_em_andamento`, e o Mister respondeu "o cupom pela conversa ainda não está disponível neste servidor"
  // a toda correção de nota em produção, enquanto os testes (que montam os serviços à mão) passavam. Aqui: toda dependência
  // @Optional que o módulo TEM (provida nele ou exportada por um módulo que ele importa) tem de chegar preenchida.
  it('nenhuma dependência @Optional que o módulo tem chega vazia (o ciclo que o Nest fecha calado)', async () => {
    const app = await montar();
    const furos: string[] = [];
    try {
      const container = (app as any).container;
      for (const mod of container.getModules().values()) {
        const visiveis = new Set<unknown>(mod.providers.keys());
        for (const imp of mod.imports ?? []) for (const t of imp?.exports ?? []) visiveis.add(t);
        for (const w of mod.providers.values()) {
          const cls = w.metatype;
          const inst = w.instance;
          if (!inst || typeof cls !== 'function' || w.inject || w.isAlias) continue;
          const opcionais: number[] = Reflect.getMetadata(OPTIONAL_DEPS_METADATA, cls) ?? [];
          if (!opcionais.length) continue;
          const tipos: unknown[] = Reflect.getMetadata(PARAMTYPES_METADATA, cls) ?? [];
          const proprios: { index: number; param: any }[] = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ?? [];
          const nomes = nomesDoConstrutor(cls);
          for (const i of opcionais) {
            const proprio = proprios.find((p) => p.index === i);
            let token: any = proprio ? proprio.param : tipos[i];
            if (token && typeof token === 'object' && typeof token.forwardRef === 'function') token = token.forwardRef();
            const nome = nomes[i];
            // O tipo que chegou INDEFINIDO no construtor é o import circular entre os arquivos: quando a classe foi carregada,
            // a da dependência ainda não existia — sem @Optional o Nest recusaria subir; com ele, injeta vazio para sempre.
            if (token === undefined) {
              furos.push(`${cls.name}.${nome ?? `#${i}`} (tipo indefinido no construtor: import circular — use forwardRef ou ModuleRef)`);
              continue;
            }
            if (!visiveis.has(token)) continue;
            if (nome && inst[nome] === undefined) furos.push(`${cls.name}.${nome} (${token?.name ?? String(token)})`);
          }
        }
      }
    } finally {
      await app.close();
    }
    expect(furos).toEqual([]);
  });
});

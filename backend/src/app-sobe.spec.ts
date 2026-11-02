import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// O APLICATIVO INTEIRO MONTA (ERR novo de 02/11/2026): um controlador novo com um guarda que depende de outro módulo
// (o SyncTokenGuard pede o EquipamentoService) compilava, passava em todos os testes — que montam os serviços à mão — e
// derrubava a API na hora de subir ("Nest can't resolve dependencies…"): o deploy ficaria fora do ar. Aqui o Nest resolve
// e instancia TODAS as dependências do AppModule, como o `gen-openapi.js` — sem `listen` (sem porta) e sem `init` (as
// rotinas de início não rodam).
jest.setTimeout(120_000);

describe('o aplicativo monta (todas as dependências resolvem)', () => {
  it('AppModule resolve o grafo de dependências', async () => {
    process.env.DATABASE_URL ??= process.env.TEST_PG_URL ?? 'postgresql://ninguem:ninguem@127.0.0.1:1/ninguem';
    process.env.JWT_SECRET ??= 'teste-app-sobe';
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    expect(app).toBeDefined();
    await app.close();
  });
});

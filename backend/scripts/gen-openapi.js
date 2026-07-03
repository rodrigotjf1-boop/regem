// Gera docs/openapi.json a partir do app COMPILADO (rodar `npm run build` antes,
// para o plugin do @nestjs/swagger ter anotado os DTOs). Precisa do backend/.env
// (DATABASE_URL) porque instancia o AppModule. Uso: npm run build && npm run openapi
const { writeFileSync } = require('fs');
const { resolve } = require('path');
const { NestFactory } = require('@nestjs/core');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require('../dist/app.module');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  const cfg = new DocumentBuilder()
    .setTitle('Regem API')
    .setDescription('Contrato da API do Regem (v1).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, cfg);
  const out = resolve(__dirname, '../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2));
  await app.close();
  console.log('OpenAPI escrito em', out);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

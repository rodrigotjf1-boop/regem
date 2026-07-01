import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS: em produção, defina CORS_ORIGIN (uma ou mais origens separadas por vírgula).
  // Sem a variável (dev), libera todas as origens.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors(
    corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : {},
  );

  // Prefixo versionado da API: /api/v1/*
  app.setGlobalPrefix('api/v1');

  // Validação/whitelist automática dos DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

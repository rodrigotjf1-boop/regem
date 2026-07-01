import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS liberado para o front-end (dev). Em produção, restringir a origem.
  app.enableCors();

  // Prefixo versionado da API: /api/v1/*
  app.setGlobalPrefix('api/v1');

  // Validação/whitelist automática dos DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

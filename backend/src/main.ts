import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // Fail-fast de segurança: sem segredo forte / sem CORS em produção, o app NÃO sobe
  // (melhor recusar a subir do que rodar com segredo indefinido ou CORS aberto).
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'JWT_SECRET ausente ou fraco (mín. 16 caracteres). Defina no ambiente antes de subir.',
    );
  }
  const isProd = process.env.NODE_ENV === 'production';
  const corsOrigin = process.env.CORS_ORIGIN;
  if (isProd && !corsOrigin) {
    throw new Error(
      'CORS_ORIGIN é obrigatório em produção (defina as origens permitidas, separadas por vírgula).',
    );
  }

  const app = await NestFactory.create(AppModule);

  // Cabeçalhos de segurança.
  app.use(helmet());

  // CORS: produção usa a lista de CORS_ORIGIN; em dev (sem a var) libera todas.
  app.enableCors(
    corsOrigin ? { origin: corsOrigin.split(',').map((o) => o.trim()) } : {},
  );

  // Prefixo versionado da API: /api/v1/*
  app.setGlobalPrefix('api/v1');

  // Validação/whitelist automática dos DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

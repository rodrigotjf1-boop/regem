import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { readFileSync } from 'fs';
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

  // Edge: HTTPS local com o cert do próprio servidor (SW + câmera na LAN sem
  // internet). Aponte EDGE_TLS_CERT/EDGE_TLS_KEY para os arquivos PEM.
  let httpsOptions: { key: Buffer; cert: Buffer } | undefined;
  if (process.env.EDGE_TLS_CERT && process.env.EDGE_TLS_KEY) {
    try {
      httpsOptions = {
        cert: readFileSync(process.env.EDGE_TLS_CERT),
        key: readFileSync(process.env.EDGE_TLS_KEY),
      };
    } catch (e) {
      console.error('EDGE_TLS_* configurado mas não pôde ler os certificados:', e);
    }
  }

  // rawBody: true mantém o corpo cru (req.rawBody) — necessário para verificar
  // a assinatura do webhook do Stripe.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });

  // Cabeçalhos de segurança.
  app.use(helmet());

  // CORS: '*' libera qualquer origem (edge/appliance na LAN — o app em :3001 chama
  // a API em :3002, e o host varia por loja); lista separada por vírgula em
  // produção nuvem; sem a var (dev) libera todas.
  app.enableCors(
    !corsOrigin
      ? {}
      : corsOrigin.trim() === '*'
        ? { origin: true }
        : { origin: corsOrigin.split(',').map((o) => o.trim()) },
  );

  // Prefixo versionado da API: /api/v1/*
  app.setGlobalPrefix('api/v1');

  // Validação/whitelist automática dos DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger em /api/v1/docs — em produção só com SWAGGER_ENABLED=true.
  if (!isProd || process.env.SWAGGER_ENABLED === 'true') {
    const cfg = new DocumentBuilder()
      .setTitle('Regem API')
      .setDescription('Contrato da API do Regem (v1).')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, cfg);
    SwaggerModule.setup('api/v1/docs', app, doc);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

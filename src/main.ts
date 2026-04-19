import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // ── Security ────────────────────────────────────
  app.use(helmet());
  app.use(compression());

  // ── CORS ────────────────────────────────────────
  app.enableCors({
    origin: config.get<string>('ALLOWED_ORIGINS', '').split(','),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // ── Global prefix & versioning ──────────────────
  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI });

  // ── Validation ──────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger (desabilitar em produção se quiser) ──
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Vetra API')
      .setDescription('ERP Agro — API core')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Autenticação')
      .addTag('farms', 'Fazendas')
      .addTag('fields', 'Talhões')
      .addTag('inputs', 'Insumos')
      .addTag('financial', 'Financeiro')
      .addTag('team', 'Equipe')
      .addTag('maps', 'Mapas e geoespacial')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  console.log(`🌱 Vetra API rodando em: http://localhost:${port}/${prefix}`);
  console.log(`📖 Swagger em: http://localhost:${port}/docs`);
}

bootstrap();

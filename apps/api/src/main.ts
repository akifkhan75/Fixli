import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { configureRealtime } from './realtime/redis-io.adapter';

import * as Sentry from '@sentry/node';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
    });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const isProd = process.env.NODE_ENV === 'production';

  // Behind a load balancer the client IP comes from X-Forwarded-For; needed for per-IP rate limits.
  app.set('trust proxy', 1);
  app.use(helmet());

  const origins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
    : ['http://localhost:8081', 'http://localhost:5173', 'http://localhost:5174'];
  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Media moves to presigned object-storage uploads in Phase 3; until then base64 photos/audio
  // are capped well below the old 50 MB.
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('api');

  // API docs are not public in production.
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Fixli API')
      .setDescription('Fixli backend API for connecting customers with skilled workers')
      .setVersion('2.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await configureRealtime(app);
  app.enableShutdownHooks();

  const port = process.env.PORT || 3002;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Fixli API listening on :${port}${isProd ? '' : ` (docs at /docs)`}`, 'Bootstrap');
}

bootstrap();

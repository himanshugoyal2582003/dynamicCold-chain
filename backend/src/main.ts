import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    for (const key of ['JWT_SECRET', 'IOT_INGEST_SECRET', 'AIML_SERVICE_TOKEN']) {
      const val = process.env[key]?.trim();
      if (!val || val.length < 16) {
        throw new Error(`${key} must be configured (min 16 chars) in production.`);
      }
    }
    if (!process.env.CORS_ORIGIN?.trim()) {
      throw new Error('CORS_ORIGIN must be explicitly configured in production.');
    }
  }

  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const rawOrigins = process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        (!isProd && /^http:\/\/(localhost|127\.0\.0\.1):(3000|3001|3002)$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`ColdChain NestJS Backend listening on http://localhost:${port}`);
}
bootstrap();

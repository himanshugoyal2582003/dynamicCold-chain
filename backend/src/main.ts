import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  const rawOrigins = process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001';
  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1):(3000|3001|3002)$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'x-access-token'],
    exposedHeaders: ['Authorization', 'x-auth-token'],
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`ColdChain NestJS Backend listening on http://localhost:${port}`);
}
bootstrap();

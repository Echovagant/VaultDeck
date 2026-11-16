import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { configureComposition } from './composition/root';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ trustProxy: false, bodyLimit: 16 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  app.enableShutdownHooks();
  configureComposition(app);

  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '127.0.0.1';
  await app.listen({ port, host });
}

void bootstrap();

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  // Rejects empty chat messages with 400 before any streaming starts.
  // NOTE: transform:true is required — without it the body stays a plain
  // object with no decorator metadata, and class-validator passes everything.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // OpenAPI docs. Served at /api/docs (JSON at /api/docs-json).
  // NOTE: setup path bypasses the global prefix, so 'api/docs' is spelled out.
  const config = new DocumentBuilder()
    .setTitle('Document Outline Agent')
    .setDescription('Agent-edited document outline: read/reset APIs (chat streams in Phase 4).')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`backend listening on http://localhost:${port}/api`);
}
void bootstrap();

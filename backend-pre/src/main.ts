import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // 全局校验:剥离未声明字段、按 DTO 类型转换、缺失校验直接 400。
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  await app.listen(env.port);
  // eslint-disable-next-line no-console
  console.log(`airacm backend listening on http://localhost:${env.port}`);
}

void bootstrap();

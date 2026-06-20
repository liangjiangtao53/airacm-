import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 安全响应头(公网必备)。
  app.use(helmet());
  // CORS:生产用 env 白名单,开发放开(见 config 校验)。
  app.enableCors({ origin: env.corsOrigins, credentials: true });

  // 全局校验:剥离未声明字段、拒绝多余字段、按 DTO 类型转换。
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 反代后取真实 IP(限流/日志依赖)。
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.enableShutdownHooks(); // 优雅关闭:释放数据库连接等。

  await app.listen(env.port);
  Logger.log(`airacm backend listening on :${env.port} [${env.nodeEnv}]`, 'Bootstrap');
}

void bootstrap();

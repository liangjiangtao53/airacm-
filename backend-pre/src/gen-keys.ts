import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AccessKeyService } from './modules/access-key';
import { env } from './config';

// CLI 批量生成认证卡密。每次执行默认生成 ACCESS_KEY_BATCH(20) 个,有效期 ACCESS_KEY_TTL_DAYS(30) 天。
// 用法: ts-node src/gen-keys.ts [数量] [有效期天数]
async function run(): Promise<void> {
  const count = process.argv[2] ? Number(process.argv[2]) : undefined;
  const ttlDays = process.argv[3] ? Number(process.argv[3]) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const svc = app.get(AccessKeyService);
    const { keys, expiresAt } = await svc.generate(env.defaultTenantId, count, ttlDays);
    // eslint-disable-next-line no-console
    console.log(`已生成 ${keys.length} 个卡密,有效期至 ${expiresAt.toISOString()}:`);
    // eslint-disable-next-line no-console
    keys.forEach((k, i) => console.log(`${String(i + 1).padStart(2, '0')}. ${k}`));
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

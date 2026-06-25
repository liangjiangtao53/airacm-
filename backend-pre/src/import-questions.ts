import 'reflect-metadata';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { QuestionService } from './modules/question';
import { QuestionUsage } from './entities';
import { env } from './config';

// CLI 批量导入题库,复用 QuestionService.importFile(按扩展名解析 + 统一校验)。
// 用法: ts-node src/import-questions.ts <xlsx|pdf路径> "<科目>" [study|exam|both]
async function run(): Promise<void> {
  const filePath = process.argv[2];
  const category = process.argv[3] ?? '';
  const usage = (process.argv[4] ?? 'study') as QuestionUsage;
  if (!filePath) {
    // eslint-disable-next-line no-console
    console.error('用法: ts-node src/import-questions.ts <xlsx|pdf路径> "<科目>" [study|exam|both]');
    process.exit(1);
  }
  const buffer = fs.readFileSync(filePath);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const svc = app.get(QuestionService);
    const admin = { userId: 'cli-import', tenantId: env.defaultTenantId, role: 'admin' as const };
    const res = await svc.importFile(admin, { buffer, originalname: filePath }, usage, category, undefined);
    // eslint-disable-next-line no-console
    console.log(`导入完成: 科目="${category}" 用途=${usage} 成功 ${res.imported} 题, 失败 ${res.failed.length} 行`);
    if (res.failed.length) {
      // eslint-disable-next-line no-console
      console.log('失败行(前 20):', JSON.stringify(res.failed.slice(0, 20), null, 2));
    }
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

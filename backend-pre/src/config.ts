import { TypeOrmModuleOptions } from '@nestjs/typeorm';

// 集中读取环境变量,提供类型化访问。所有默认值对齐 .env.example,保证开发态零配置可跑。
export const env = {
  port: parseInt(process.env.PORT ?? '8770', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod',
  // 单租户第一版:固定租户号,架构层预留行级 tenant_id(见 D4)。
  defaultTenantId: process.env.DEFAULT_TENANT_ID ?? 't1',
  sms: {
    devMode: (process.env.SMS_DEV_MODE ?? 'true') === 'true',
    devCode: process.env.SMS_DEV_CODE ?? '0000',
  },
  wechatPay: {
    enabled: (process.env.WECHAT_PAY_ENABLED ?? 'false') === 'true',
    mchId: process.env.WECHAT_MCH_ID ?? '',
    apiKey: process.env.WECHAT_API_KEY ?? 'dev-mch-key',
  },
};

export function buildDataSourceOptions(): TypeOrmModuleOptions {
  const dbType = process.env.DB_TYPE ?? 'better-sqlite3';
  if (dbType === 'postgres') {
    return {
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true, // 第一版用 synchronize;上线前换 migration。
    };
  }
  return {
    type: 'better-sqlite3',
    database: process.env.DB_DATABASE ?? 'airacm.sqlite',
    autoLoadEntities: true,
    synchronize: true,
  };
}

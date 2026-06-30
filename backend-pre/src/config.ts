import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { DataSourceOptions } from 'typeorm';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

// CORS:生产用白名单(逗号分隔),开发放开。
const corsOrigins: string[] | boolean = isProd
  ? (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  : true;

type DbType = 'mysql' | 'postgres' | 'better-sqlite3';

function dbPort(defaultPort: number): number {
  return parseInt(process.env.DB_PORT ?? String(defaultPort), 10);
}

// 支持 mysql/postgres(生产) 与 better-sqlite3(测试),通过 DB_TYPE 切换。
export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT) || 8770,
  corsOrigins,

  dbType: (process.env.DB_TYPE as DbType) || 'mysql',
  dbSync: process.env.DB_SYNC === 'true',
  databaseUrl: process.env.DATABASE_URL || '',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: dbPort(((process.env.DB_TYPE as DbType) || 'mysql') === 'mysql' ? 3306 : 5432),
  dbUser: process.env.DB_USER || 'airacm',
  dbPassword: process.env.DB_PASSWORD || '',
  dbDatabase: process.env.DB_DATABASE || 'airacm.sqlite',
  dbPoolMax: Number(process.env.DB_POOL_MAX) || 20,
  dbMigrationsRun: process.env.DB_MIGRATIONS_RUN !== 'false',
  throttleTtlMs: Number(process.env.THROTTLE_TTL_MS) || 60_000,
  throttleLimit: Number(process.env.THROTTLE_LIMIT) || 120,

  jwtSecret: process.env.JWT_SECRET || (isProd ? '' : 'dev-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  defaultTenantId: process.env.DEFAULT_TENANT_ID || 't1',
  questionImageDir: process.env.QUESTION_IMAGE_DIR || resolve(process.cwd(), 'uploads', 'question-images'),

  // 短信:dev 走万能码;生产接阿里云短信(Dysmsapi)。
  sms: {
    devMode: process.env.SMS_DEV_MODE !== 'false',
    devCode: process.env.SMS_DEV_CODE || '1234',
    accessKeyId: process.env.ALI_SMS_AK_ID || '',
    accessKeySecret: process.env.ALI_SMS_AK_SECRET || '',
    signName: process.env.ALI_SMS_SIGN || '',
    templateCode: process.env.ALI_SMS_TEMPLATE || '',
    endpoint: process.env.ALI_SMS_ENDPOINT || 'dysmsapi.aliyuncs.com',
    codeTtlSec: Number(process.env.SMS_CODE_TTL_SEC) || 300, // 验证码 5 分钟
    resendIntervalSec: Number(process.env.SMS_RESEND_SEC) || 60, // 同号 60s 内不重发
  },

  // 微信支付:商户资质未开通则 enabled=false,prepay 直接拒绝。
  wechatPay: {
    enabled: process.env.WECHAT_PAY_ENABLED === 'true',
    apiKey: process.env.WECHAT_API_KEY || '',
    mchId: process.env.WECHAT_MCH_ID || '',
  },

  // 认证卡密:每次生成数量与有效期(天),均可配置。
  accessKey: {
    batch: Number(process.env.ACCESS_KEY_BATCH) || 20,
    ttlDays: Number(process.env.ACCESS_KEY_TTL_DAYS) || 30,
  },

  // 引导超级管理员:seed 自动写入。生产务必改默认值。
  bootstrapAdmin: {
    phone: process.env.ADMIN_PHONE || '13259858973',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  },

  // 引导业务管理员:seed 自动写入。
  bootstrapBizAdmin: {
    phone: process.env.BIZ_ADMIN_PHONE || '13772066855',
    password: process.env.BIZ_ADMIN_PASSWORD || 'BizAdmin@12345',
  },
};

// 生产关键密钥强校验:缺失则启动即失败,避免线上裸奔。
if (isProd) {
  if (!env.jwtSecret) throw new Error('生产环境必须配置 JWT_SECRET');
  if (env.wechatPay.enabled && !env.wechatPay.apiKey) {
    throw new Error('微信支付已开通但缺少 WECHAT_API_KEY');
  }
  if (!env.sms.devMode && !env.sms.accessKeyId) {
    throw new Error('短信生产模式必须配置 ALI_SMS_AK_ID 等密钥');
  }
}

export function buildDataSourceOptions(): DataSourceOptions {
  if (env.dbType === 'better-sqlite3') {
    return {
      type: 'better-sqlite3',
      database: env.dbDatabase,
      synchronize: env.dbSync,
      entities: [__dirname + '/entities.{ts,js}'],
      migrations: [__dirname + '/migrations/*.{ts,js}'],
      migrationsRun: env.dbMigrationsRun,
    };
  }
  if (env.dbType === 'mysql') {
    return {
      type: 'mysql',
      host: env.dbHost,
      port: env.dbPort,
      username: env.dbUser,
      password: env.dbPassword,
      database: env.dbDatabase === 'airacm.sqlite' ? 'airacm' : env.dbDatabase,
      synchronize: env.dbSync,
      entities: [__dirname + '/entities.{ts,js}'],
      migrations: [__dirname + '/migrations/*.{ts,js}'],
      migrationsRun: env.dbMigrationsRun,
      charset: 'utf8mb4',
      timezone: 'Z',
      extra: {
        connectionLimit: env.dbPoolMax,
        connectTimeout: 5000,
      },
    };
  }
  return {
    type: 'postgres',
    url: env.databaseUrl,
    synchronize: env.dbSync,
    entities: [__dirname + '/entities.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    migrationsRun: env.dbMigrationsRun,
    // 连接池:pg 默认 max=10,高并发下易耗尽成瓶颈;调到 20(可经 DB_POOL_MAX 配置),
    // 并设连接获取/空闲超时,避免连接泄漏与慢查询堆积拖垮服务。
    poolSize: env.dbPoolMax,
    extra: {
      max: env.dbPoolMax,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    },
    // 超过 1s 的查询打日志,便于定位慢查询。
    maxQueryExecutionTime: 1000,
  };
}

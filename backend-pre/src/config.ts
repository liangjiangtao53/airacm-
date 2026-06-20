import * as dotenv from 'dotenv';
import { DataSourceOptions } from 'typeorm';

dotenv.config();

// 支持 postgres(生产) 与 better-sqlite3(测试) 双模式,通过 DB_TYPE 切换。
export const env = {
  port: Number(process.env.PORT) || 8770,
  dbType: (process.env.DB_TYPE as 'postgres' | 'better-sqlite3') || 'postgres',
  dbSync: process.env.DB_SYNC === 'true',
  databaseUrl: process.env.DATABASE_URL || '',
  dbDatabase: process.env.DB_DATABASE || 'airacm.sqlite',
  dbPoolMax: Number(process.env.DB_POOL_MAX) || 20,
  jwtSecret: process.env.JWT_SECRET || '',
  tenantId: process.env.DEFAULT_TENANT_ID || 't1',
  wechatApiKey: process.env.WECHAT_API_KEY || '',
};

export function buildDataSourceOptions(): DataSourceOptions {
  if (env.dbType === 'better-sqlite3') {
    return {
      type: 'better-sqlite3',
      database: env.dbDatabase,
      synchronize: env.dbSync,
      entities: [__dirname + '/entities.{ts,js}'],
    };
  }
  return {
    type: 'postgres',
    url: env.databaseUrl,
    synchronize: env.dbSync,
    entities: [__dirname + '/entities.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
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
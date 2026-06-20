import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

// TypeORM CLI 专用数据源(migration 生成/执行/回滚)。生产固定 postgres。
// 用法见 README:npm run migration:generate / migration:run。
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'airacm',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'airacm',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});

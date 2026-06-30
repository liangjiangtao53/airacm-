import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

const dbType = (process.env.DB_TYPE as 'mysql' | 'postgres' | undefined) || 'mysql';
const defaultPort = dbType === 'mysql' ? 3306 : 5432;

export default new DataSource({
  type: dbType,
  url: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? String(defaultPort), 10),
  username: process.env.DB_USER ?? 'airacm',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'airacm',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  charset: dbType === 'mysql' ? 'utf8mb4' : undefined,
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});

import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

const backendRoot = resolve(__dirname, '..');
dotenv.config({ path: [resolve(backendRoot, '.env'), resolve(backendRoot, '..', '.env')] });

const dbType = (process.env.DB_TYPE as 'mysql' | 'postgres' | undefined) || 'mysql';
const defaultPort = dbType === 'mysql' ? 3306 : 5432;
const database = process.env.DB_DATABASE || (dbType === 'mysql' ? 'airacm' : 'airacm');

export default new DataSource({
  type: dbType,
  url: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || defaultPort,
  username: process.env.DB_USER || 'airacm',
  password: process.env.DB_PASSWORD || '',
  database,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  charset: dbType === 'mysql' ? 'utf8mb4' : undefined,
  entities: ALL_ENTITIES,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});

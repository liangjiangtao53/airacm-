import { DataSource, Table } from 'typeorm';
import { AddAccessKeyAssigned1783940300000 } from '../src/migrations/1783940300000-AddAccessKeyAssigned';

describe('access key assigned migration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
  });

  afterEach(async () => dataSource.destroy());

  it('is idempotent, backfills false, and can be reverted repeatedly', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(new Table({
      name: 'access_key',
      columns: [
        { name: 'id', type: 'varchar', isPrimary: true },
        { name: 'tenantId', type: 'varchar' },
        { name: 'key', type: 'varchar' },
      ],
    }));
    await runner.query('INSERT INTO "access_key" ("id", "tenantId", "key") VALUES (?, ?, ?)', ['k1', 't1', 'ABC']);

    const migration = new AddAccessKeyAssigned1783940300000();
    await migration.up(runner);
    await migration.up(runner);
    expect(await runner.hasColumn('access_key', 'assigned')).toBe(true);
    expect(await runner.query('SELECT "assigned" FROM "access_key" WHERE "id" = ?', ['k1'])).toEqual([{ assigned: 0 }]);

    await migration.down(runner);
    await migration.down(runner);
    expect(await runner.hasColumn('access_key', 'assigned')).toBe(false);
    await runner.release();
  });
});

import { DataSource, Table } from 'typeorm';
import { AddWechatIdentityAndBindSession1783940000000 } from '../src/migrations/1783940000000-AddWechatIdentityAndBindSession';
import { AddExamDraftState1783940200000 } from '../src/migrations/1783940200000-AddExamDraftState';

describe('WeChat and exam migrations', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
  });

  afterEach(async () => dataSource.destroy());

  it('recreates a missing bind-session index after a partial migration', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(
      new Table({
        name: 'user',
        columns: [{ name: 'id', type: 'varchar', isPrimary: true }],
      }),
    );
    const migration = new AddWechatIdentityAndBindSession1783940000000();
    await migration.up(runner);
    await runner.dropIndex('wechat_bind_session', 'IDX_wechat_bind_session_expiry');

    await migration.up(runner);

    const table = await runner.getTable('wechat_bind_session');
    expect(table?.indices.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'UQ_wechat_bind_session_token_hash',
        'IDX_wechat_bind_session_expiry',
      ]),
    );
    await runner.release();
  });

  it('does not reactivate an abandoned attempt when rerun', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(
      new Table({
        name: 'exam_attempt',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tenantId', type: 'varchar' },
          { name: 'userId', type: 'varchar' },
          { name: 'status', type: 'varchar' },
          { name: 'deletedAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
        ],
      }),
    );
    await runner.query(
      `INSERT INTO "exam_attempt" ("id", "tenantId", "userId", "status", "createdAt") VALUES (?, ?, ?, ?, ?)`,
      ['old', 't1', 'u1', 'in_progress', '2026-07-13 10:00:00'],
    );
    const migration = new AddExamDraftState1783940200000();
    await migration.up(runner);
    await runner.query(
      `UPDATE "exam_attempt" SET "abandonedAt" = CURRENT_TIMESTAMP, "activeKey" = 'active' WHERE "id" = 'old'`,
    );
    await runner.query(
      `INSERT INTO "exam_attempt" ("id", "tenantId", "userId", "status", "createdAt", "activeKey") VALUES (?, ?, ?, ?, ?, ?)`,
      ['new', 't1', 'u1', 'in_progress', '2026-07-13 11:00:00', null],
    );

    await migration.up(runner);

    const rows = (await runner.query(
      `SELECT "id", "activeKey", "abandonedAt" FROM "exam_attempt" ORDER BY "id"`,
    )) as Array<{ id: string; activeKey: string | null; abandonedAt: string | null }>;
    expect(rows.find((row) => row.id === 'old')).toMatchObject({ activeKey: null });
    expect(rows.find((row) => row.id === 'new')).toMatchObject({ activeKey: 'active', abandonedAt: null });
    await runner.release();
  });
});

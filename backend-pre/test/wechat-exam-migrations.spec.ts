import { DataSource, Table } from 'typeorm';
import { AddWechatIdentityAndBindSession1783940000000 } from '../src/migrations/1783940000000-AddWechatIdentityAndBindSession';
import { BackfillWechatIdentity1783940100000 } from '../src/migrations/1783940100000-BackfillWechatIdentity';
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

  it('backfills legacy key identity and creates identity uniqueness indexes', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(
      new Table({
        name: 'user',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tenantId', type: 'varchar' },
          { name: 'phone', type: 'varchar' },
          { name: 'nickname', type: 'varchar' },
          { name: 'openid', type: 'varchar', isNullable: true },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'access_key',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tenantId', type: 'varchar' },
          { name: 'userId', type: 'varchar', isNullable: true },
        ],
      }),
    );
    await runner.query(
      `INSERT INTO "user" ("id", "tenantId", "phone", "nickname", "openid") VALUES (?, ?, ?, ?, ?)`,
      ['u1', 't1', '13800000000', 'student', 'key:k1'],
    );
    await runner.query(
      `INSERT INTO "access_key" ("id", "tenantId", "userId") VALUES (?, ?, ?)`,
      ['k1', 't1', 'u1'],
    );
    await new AddWechatIdentityAndBindSession1783940000000().up(runner);
    await new BackfillWechatIdentity1783940100000().up(runner);

    const user = (await runner.query(
      `SELECT "registrationSource", "wechatOpenid" FROM "user" WHERE "id" = ?`,
      ['u1'],
    ))[0] as { registrationSource: string; wechatOpenid: string | null };
    expect(user).toEqual({ registrationSource: 'key', wechatOpenid: null });
    const table = await runner.getTable('user');
    expect(table?.indices.map((index) => index.name)).toEqual(
      expect.arrayContaining(['UQ_user_tenant_wechat_openid', 'UQ_user_tenant_nickname']),
    );
    await runner.release();
  });

  it('snapshots legacy attempts and deterministically keeps the newest active id', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(
      new Table({
        name: 'question',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tenantId', type: 'varchar' },
          { name: 'category', type: 'varchar' },
          { name: 'type', type: 'varchar' },
          { name: 'stem', type: 'varchar' },
          { name: 'options', type: 'text' },
          { name: 'stemImageUrls', type: 'text', isNullable: true },
          { name: 'imageUrls', type: 'text', isNullable: true },
          { name: 'answer', type: 'varchar' },
          { name: 'analysis', type: 'text' },
        ],
      }),
    );
    await runner.createTable(
      new Table({
        name: 'exam_attempt',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'tenantId', type: 'varchar' },
          { name: 'userId', type: 'varchar' },
          { name: 'questionIds', type: 'text' },
          { name: 'status', type: 'varchar' },
          { name: 'deletedAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
        ],
      }),
    );
    await runner.query(
      `INSERT INTO "question" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['q1', 't1', 'M1 航空概论', 'single', 'stem', '[{"key":"A","text":"answer"}]', null, null, 'A', 'analysis'],
    );
    for (const id of ['attempt-a', 'attempt-b']) {
      await runner.query(
        `INSERT INTO "exam_attempt" ("id", "tenantId", "userId", "questionIds", "status", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
        [id, 't1', 'u1', '["q1"]', 'in_progress', '2026-07-13 10:00:00'],
      );
    }

    await new AddExamDraftState1783940200000().up(runner);

    const rows = (await runner.query(
      `SELECT "id", "questionSnapshots", "activeKey" FROM "exam_attempt" ORDER BY "id"`,
    )) as Array<{ id: string; questionSnapshots: string; activeKey: string | null }>;
    expect(JSON.parse(rows[0].questionSnapshots)[0]).toMatchObject({ id: 'q1', answer: 'A' });
    expect(rows.find((row) => row.id === 'attempt-b')?.activeKey).toBe('active');
    expect(rows.find((row) => row.id === 'attempt-a')?.activeKey).toBeNull();
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

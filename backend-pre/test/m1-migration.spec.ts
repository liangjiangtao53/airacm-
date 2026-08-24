import { DataSource, Table } from 'typeorm';
import { AddM1ChapterReplacement1787565000000 } from '../src/migrations/1787565000000-AddM1ChapterReplacement';

describe('M1 chapter replacement migration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
  });

  afterEach(async () => dataSource.destroy());

  it('repairs partial indexes and rolls multi-chapter progress back deterministically', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.createTable(new Table({
      name: 'question',
      columns: [
        { name: 'id', type: 'varchar', isPrimary: true },
        { name: 'tenantId', type: 'varchar' },
        { name: 'category', type: 'varchar' },
      ],
    }));
    await runner.query(`INSERT INTO "question" ("id", "tenantId", "category") VALUES (?, ?, ?)`, ['q1', 't1', 'M1 航空概论']);
    await runner.createTable(new Table({
      name: 'study_question_progress',
      columns: [
        { name: 'id', type: 'varchar', isPrimary: true },
        { name: 'tenantId', type: 'varchar' },
        { name: 'userId', type: 'varchar' },
        { name: 'category', type: 'varchar' },
        { name: 'courseId', type: 'varchar' },
        { name: 'questionId', type: 'varchar' },
        { name: 'lastStudiedAt', type: 'datetime' },
        { name: 'updatedAt', type: 'datetime' },
      ],
      indices: [{
        name: 'IDX_study_question_progress_scope',
        columnNames: ['tenantId', 'userId', 'category', 'courseId'],
        isUnique: true,
      }],
    }));
    await runner.createTable(new Table({
      name: 'question_import_batch',
      columns: [{ name: 'id', type: 'varchar', isPrimary: true }],
    }));

    const migration = new AddM1ChapterReplacement1787565000000();
    await migration.up(runner);
    await runner.dropIndex('question_category_generation', 'IDX_question_category_generation_scope');
    await runner.query(
      `INSERT INTO "question_category_generation" ("id", "tenantId", "category", "generation", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ['duplicate', 't1', 'M1 航空概论', 4],
    );
    await runner.dropIndex('study_question_progress', 'IDX_study_question_progress_scope');

    await migration.up(runner);

    const generationTable = await runner.getTable('question_category_generation');
    expect(generationTable?.indices.find((index) => index.name === 'IDX_question_category_generation_scope')?.isUnique).toBe(true);
    const generations = await runner.query(`SELECT "generation" FROM "question_category_generation"`);
    expect(generations).toEqual([{ generation: 4 }]);
    const progressTable = await runner.getTable('study_question_progress');
    expect(progressTable?.indices.find((index) => index.name === 'IDX_study_question_progress_scope')?.columnNames).toEqual([
      'tenantId', 'userId', 'category', 'courseId', 'chapterName',
    ]);

    await runner.query(
      `INSERT INTO "study_question_progress" ("id", "tenantId", "userId", "category", "courseId", "chapterName", "questionId", "lastStudiedAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p1', 't1', 'u1', 'M1 航空概论', '', '第1章', 'q1', '2026-08-24 10:00:00', '2026-08-24 10:00:00'],
    );
    await runner.query(
      `INSERT INTO "study_question_progress" ("id", "tenantId", "userId", "category", "courseId", "chapterName", "questionId", "lastStudiedAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p2', 't1', 'u1', 'M1 航空概论', '', '第2章', 'q1', '2026-08-24 11:00:00', '2026-08-24 11:00:00'],
    );

    await migration.down(runner);

    expect(await runner.hasColumn('study_question_progress', 'chapterName')).toBe(false);
    const legacyRows = await runner.query(`SELECT "id" FROM "study_question_progress"`);
    expect(legacyRows).toEqual([{ id: 'p2' }]);
    const legacyTable = await runner.getTable('study_question_progress');
    expect(legacyTable?.indices.find((index) => index.name === 'IDX_study_question_progress_scope')?.columnNames).toEqual([
      'tenantId', 'userId', 'category', 'courseId',
    ]);
    await runner.release();
  });
});

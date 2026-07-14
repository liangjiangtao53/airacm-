import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddExamDraftState1783940200000 implements MigrationInterface {
  name = 'AddExamDraftState1783940200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_attempt'))) return;
    const q = (name: string): string =>
      ['mysql', 'mariadb'].includes(queryRunner.connection.options.type)
        ? `\`${name}\``
        : `"${name}"`;
    const placeholder = (position: number): string =>
      queryRunner.connection.options.type === 'postgres' ? `$${position}` : '?';

    // Validate legacy references before adding columns so a direct migration cannot leave partial DDL.
    await this.assertQuestionReferences(queryRunner, q, placeholder);

    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';
    // M3 can snapshot 182 questions; MySQL TEXT (64 KiB) is not large enough for a full paper.
    const snapshotType =
      queryRunner.connection.options.type === 'mysql' ||
      queryRunner.connection.options.type === 'mariadb'
        ? 'longtext'
        : 'text';
    const columns: TableColumn[] = [
      new TableColumn({ name: 'questionSnapshots', type: snapshotType, isNullable: true }),
      new TableColumn({ name: 'draftVersion', type: 'integer', default: 0 }),
      new TableColumn({ name: 'draftHash', type: 'varchar', length: '64', default: "''" }),
      new TableColumn({ name: 'currentQuestionIndex', type: 'integer', default: 0 }),
      new TableColumn({ name: 'activeKey', type: 'varchar', length: '16', isNullable: true }),
      new TableColumn({ name: 'abandonedAt', type: tsType, isNullable: true }),
      new TableColumn({ name: 'updatedAt', type: tsType, default: 'CURRENT_TIMESTAMP' }),
    ];
    for (const column of columns) {
      if (!(await queryRunner.hasColumn('exam_attempt', column.name))) {
        await queryRunner.addColumn('exam_attempt', column);
      }
    }

    await this.backfillQuestionSnapshots(queryRunner, q, placeholder);
    // A rerun must rebuild the active marker from business state instead of preserving partial writes.
    await queryRunner.query(`UPDATE ${q('exam_attempt')} SET ${q('activeKey')} = NULL`);
    const active = (await queryRunner.query(
      `SELECT ${q('id')} AS ${q('id')}, ${q('tenantId')} AS ${q('tenantId')}, ${q('userId')} AS ${q('userId')}, ` +
        `${q('createdAt')} AS ${q('createdAt')} FROM ${q('exam_attempt')} WHERE ${q('status')} = 'in_progress' ` +
        `AND ${q('deletedAt')} IS NULL AND ${q('abandonedAt')} IS NULL ` +
        `ORDER BY ${q('createdAt')} DESC, ${q('id')} DESC`,
    )) as Array<{ id: string; tenantId: string; userId: string }>;
    const keep = new Set<string>();
    for (const row of active) {
      const key = `${row.tenantId}:${row.userId}`;
      if (!keep.has(key)) {
        keep.add(key);
        await queryRunner.query(
          `UPDATE ${q('exam_attempt')} SET ${q('activeKey')} = 'active' WHERE ${q('id')} = ${placeholder(1)}`,
          [row.id],
        );
      } else {
        await queryRunner.query(
          `UPDATE ${q('exam_attempt')} SET ${q('abandonedAt')} = CURRENT_TIMESTAMP, ${q('activeKey')} = NULL WHERE ${q('id')} = ${placeholder(1)}`,
          [row.id],
        );
      }
    }

    const table = await queryRunner.getTable('exam_attempt');
    if (!table?.indices.some((index) => index.name === 'UQ_exam_attempt_active_user')) {
      await queryRunner.createIndex(
        'exam_attempt',
        new TableIndex({
          name: 'UQ_exam_attempt_active_user',
          columnNames: ['tenantId', 'userId', 'activeKey'],
          isUnique: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_attempt'))) return;
    const table = await queryRunner.getTable('exam_attempt');
    if (table?.indices.some((index) => index.name === 'UQ_exam_attempt_active_user')) {
      await queryRunner.dropIndex('exam_attempt', 'UQ_exam_attempt_active_user');
    }
    for (const name of [
      'updatedAt',
      'abandonedAt',
      'activeKey',
      'currentQuestionIndex',
      'draftHash',
      'draftVersion',
      'questionSnapshots',
    ]) {
      if (await queryRunner.hasColumn('exam_attempt', name)) {
        await queryRunner.dropColumn('exam_attempt', name);
      }
    }
  }

  private async backfillQuestionSnapshots(
    queryRunner: QueryRunner,
    q: (name: string) => string,
    placeholder: (position: number) => string,
  ): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const attempts = (await queryRunner.query(
      `SELECT ${q('id')} AS ${q('id')}, ${q('tenantId')} AS ${q('tenantId')}, ` +
        `${q('questionIds')} AS ${q('questionIds')} FROM ${q('exam_attempt')} ` +
        `WHERE ${q('questionSnapshots')} IS NULL`,
    )) as Array<{ id: string; tenantId: string; questionIds: unknown }>;

    for (const attempt of attempts) {
      const questionIds = this.parseJson<string[]>(attempt.questionIds, []);
      if (questionIds.length === 0) {
        await queryRunner.query(
          `UPDATE ${q('exam_attempt')} SET ${q('questionSnapshots')} = ${placeholder(1)} WHERE ${q('id')} = ${placeholder(2)}`,
          ['[]', attempt.id],
        );
        continue;
      }
      const slots = questionIds.map((_, index) => placeholder(index + 2)).join(', ');
      const rows = (await queryRunner.query(
        `SELECT ${q('id')} AS ${q('id')}, ${q('category')} AS ${q('category')}, ` +
          `${q('type')} AS ${q('type')}, ${q('stem')} AS ${q('stem')}, ` +
          `${q('options')} AS ${q('options')}, ${q('stemImageUrls')} AS ${q('stemImageUrls')}, ` +
          `${q('imageUrls')} AS ${q('imageUrls')}, ${q('answer')} AS ${q('answer')}, ` +
          `${q('analysis')} AS ${q('analysis')} FROM ${q('question')} ` +
          `WHERE ${q('tenantId')} = ${placeholder(1)} AND ${q('id')} IN (${slots})`,
        [attempt.tenantId, ...questionIds],
      )) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      const missing = questionIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new Error(`考试快照迁移预检失败: attempt=${attempt.id}, missingQuestions=${missing.join(',')}`);
      }
      const snapshots = questionIds.map((id) => {
        const row = byId.get(id)!;
        return {
          id,
          category: String(row.category ?? ''),
          type: row.type === 'multiple' ? 'multiple' : 'single',
          stem: String(row.stem ?? ''),
          options: this.parseJson(row.options, []),
          stemImageUrls: this.parseJson(row.stemImageUrls, []),
          imageUrls: this.parseJson(row.imageUrls, []),
          answer: String(row.answer ?? ''),
          analysis: String(row.analysis ?? ''),
        };
      });
      await queryRunner.query(
        `UPDATE ${q('exam_attempt')} SET ${q('questionSnapshots')} = ${placeholder(1)} WHERE ${q('id')} = ${placeholder(2)}`,
        [JSON.stringify(snapshots), attempt.id],
      );
    }
  }

  private async assertQuestionReferences(
    queryRunner: QueryRunner,
    q: (name: string) => string,
    placeholder: (position: number) => string,
  ): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const attempts = (await queryRunner.query(
      `SELECT ${q('id')} AS ${q('id')}, ${q('tenantId')} AS ${q('tenantId')}, ` +
        `${q('questionIds')} AS ${q('questionIds')} FROM ${q('exam_attempt')}`,
    )) as Array<{ id: string; tenantId: string; questionIds: unknown }>;

    for (const attempt of attempts) {
      const questionIds = this.parseJson<string[]>(attempt.questionIds, []);
      if (questionIds.length === 0) continue;
      const slots = questionIds.map((_, index) => placeholder(index + 2)).join(', ');
      const rows = (await queryRunner.query(
        `SELECT ${q('id')} AS ${q('id')} FROM ${q('question')} ` +
          `WHERE ${q('tenantId')} = ${placeholder(1)} AND ${q('id')} IN (${slots})`,
        [attempt.tenantId, ...questionIds],
      )) as Array<{ id: string }>;
      const found = new Set(rows.map((row) => String(row.id)));
      const missing = questionIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new Error(
          `考试快照迁移预检失败: attempt=${attempt.id}, missingQuestions=${missing.join(',')}`,
        );
      }
    }
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (value == null || value === '') return fallback;
    if (typeof value !== 'string') return value as T;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

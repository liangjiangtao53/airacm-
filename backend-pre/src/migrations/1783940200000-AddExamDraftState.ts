import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddExamDraftState1783940200000 implements MigrationInterface {
  name = 'AddExamDraftState1783940200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_attempt'))) return;
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';
    const columns: TableColumn[] = [
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

    const q = (name: string): string =>
      ['mysql', 'mariadb'].includes(queryRunner.connection.options.type)
        ? `\`${name}\``
        : `"${name}"`;
    const placeholder = (position: number): string =>
      queryRunner.connection.options.type === 'postgres' ? `$${position}` : '?';
    // A rerun must rebuild the active marker from business state instead of preserving partial writes.
    await queryRunner.query(`UPDATE ${q('exam_attempt')} SET ${q('activeKey')} = NULL`);
    const active = (await queryRunner.query(
      `SELECT ${q('id')} AS id, ${q('tenantId')} AS tenantId, ${q('userId')} AS userId, ` +
        `${q('createdAt')} AS createdAt FROM ${q('exam_attempt')} WHERE ${q('status')} = 'in_progress' ` +
        `AND ${q('deletedAt')} IS NULL AND ${q('abandonedAt')} IS NULL ` +
        `ORDER BY ${q('createdAt')} DESC`,
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
    ]) {
      if (await queryRunner.hasColumn('exam_attempt', name)) {
        await queryRunner.dropColumn('exam_attempt', name);
      }
    }
  }
}

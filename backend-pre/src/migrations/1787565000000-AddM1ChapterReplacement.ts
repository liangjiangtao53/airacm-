import { randomUUID } from 'crypto';
import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddM1ChapterReplacement1787565000000 implements MigrationInterface {
  name = 'AddM1ChapterReplacement1787565000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';

    if (await queryRunner.hasTable('question')) {
      for (const column of [
        new TableColumn({ name: 'generation', type: 'int', isNullable: false, default: 1 }),
        new TableColumn({ name: 'chapterName', type: 'varchar', length: '100', isNullable: false, default: "''" }),
        new TableColumn({ name: 'chapterOrder', type: 'int', isNullable: false, default: 0 }),
        new TableColumn({ name: 'chapterQuestionOrder', type: 'int', isNullable: false, default: 0 }),
      ]) {
        if (!(await queryRunner.hasColumn('question', column.name))) await queryRunner.addColumn('question', column);
      }
      await this.ensureIndex(queryRunner, 'question', new TableIndex({
        name: 'IDX_question_tenant_category_chapter_order',
        columnNames: ['tenantId', 'category', 'generation', 'chapterOrder', 'chapterQuestionOrder'],
      }));
    }

    if (await queryRunner.hasTable('study_question_progress')) {
      if (!(await queryRunner.hasColumn('study_question_progress', 'chapterName'))) {
        await queryRunner.addColumn(
          'study_question_progress',
          new TableColumn({ name: 'chapterName', type: 'varchar', length: '100', isNullable: false, default: "''" }),
        );
      }
      // MySQL DDL 会隐式提交；重跑时独立校验索引，避免列已加但索引未换的半迁移状态。
      await this.ensureIndex(queryRunner, 'study_question_progress', new TableIndex({
        name: 'IDX_study_question_progress_scope',
        columnNames: ['tenantId', 'userId', 'category', 'courseId', 'chapterName'],
        isUnique: true,
      }));
    }

    if (await queryRunner.hasTable('question_import_batch')) {
      for (const column of [
        new TableColumn({ name: 'previewData', type: 'text', isNullable: true }),
        new TableColumn({ name: 'stagedFilePath', type: 'text', isNullable: true }),
        new TableColumn({ name: 'expiresAt', type: tsType, isNullable: true }),
        new TableColumn({ name: 'publishedAt', type: tsType, isNullable: true }),
        new TableColumn({ name: 'generation', type: 'int', isNullable: true }),
      ]) {
        if (!(await queryRunner.hasColumn('question_import_batch', column.name))) {
          await queryRunner.addColumn('question_import_batch', column);
        }
      }
    }

    if (!(await queryRunner.hasTable('question_category_generation'))) {
      await queryRunner.createTable(new Table({
        name: 'question_category_generation',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
          { name: 'category', type: 'varchar', length: '50', isNullable: false },
          { name: 'generation', type: 'int', isNullable: false, default: 1 },
          { name: 'updatedAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }));
    }

    if (await queryRunner.hasTable('question_category_generation')) {
      await this.dedupeGenerations(queryRunner);
      await this.ensureIndex(queryRunner, 'question_category_generation', new TableIndex({
        name: 'IDX_question_category_generation_scope',
        columnNames: ['tenantId', 'category'],
        isUnique: true,
      }));
      await this.backfillGenerations(queryRunner);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('question_category_generation')) await queryRunner.dropTable('question_category_generation');
    if (await queryRunner.hasTable('question_import_batch')) {
      for (const name of ['generation', 'publishedAt', 'expiresAt', 'stagedFilePath', 'previewData']) {
        if (await queryRunner.hasColumn('question_import_batch', name)) await queryRunner.dropColumn('question_import_batch', name);
      }
    }
    if (await queryRunner.hasTable('study_question_progress')) {
      if (await queryRunner.hasColumn('study_question_progress', 'chapterName')) {
        // 回滚到旧四列作用域前保留每个作用域最近的一条，避免唯一索引重建失败。
        await this.dedupeProgressForLegacyScope(queryRunner);
      }
      const table = await queryRunner.getTable('study_question_progress');
      const index = table?.indices.find((idx) => idx.name === 'IDX_study_question_progress_scope');
      if (index) await queryRunner.dropIndex('study_question_progress', index);
      if (await queryRunner.hasColumn('study_question_progress', 'chapterName')) {
        await queryRunner.dropColumn('study_question_progress', 'chapterName');
      }
      await this.ensureIndex(queryRunner, 'study_question_progress', new TableIndex({
        name: 'IDX_study_question_progress_scope',
        columnNames: ['tenantId', 'userId', 'category', 'courseId'],
        isUnique: true,
      }));
    }
    if (await queryRunner.hasTable('question')) {
      const table = await queryRunner.getTable('question');
      const index = table?.indices.find((idx) => idx.name === 'IDX_question_tenant_category_chapter_order');
      if (index) await queryRunner.dropIndex('question', index);
      for (const name of ['chapterQuestionOrder', 'chapterOrder', 'chapterName', 'generation']) {
        if (await queryRunner.hasColumn('question', name)) await queryRunner.dropColumn('question', name);
      }
    }
  }

  private async ensureIndex(queryRunner: QueryRunner, tableName: string, expected: TableIndex): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const current = table?.indices.find((index) => index.name === expected.name);
    const sameColumns = current?.columnNames.join('|') === expected.columnNames.join('|');
    if (current && (sameColumns === false || current.isUnique !== expected.isUnique)) {
      await queryRunner.dropIndex(tableName, current);
    }
    if (!current || sameColumns === false || current.isUnique !== expected.isUnique) {
      await queryRunner.createIndex(tableName, expected);
    }
  }

  private async dedupeGenerations(queryRunner: QueryRunner): Promise<void> {
    const quote = queryRunner.connection.options.type === 'postgres' ? '"' : '`';
    const rows = (await queryRunner.query(
      `SELECT ${quote}id${quote} AS id, ${quote}tenantId${quote} AS tenantId, ${quote}category${quote} AS category, ` +
      `${quote}generation${quote} AS generation FROM ${quote}question_category_generation${quote}`,
    )) as Array<{ id: string; tenantId: string; category: string; generation: number }>;
    const keep = new Map<string, { id: string; generation: number }>();
    const remove: string[] = [];
    for (const row of rows) {
      const key = JSON.stringify([row.tenantId, row.category]);
      const prior = keep.get(key);
      if (!prior) keep.set(key, { id: row.id, generation: Number(row.generation) || 1 });
      else {
        prior.generation = Math.max(prior.generation, Number(row.generation) || 1);
        remove.push(row.id);
      }
    }
    if (remove.length > 0) {
      await queryRunner.manager.createQueryBuilder().delete().from('question_category_generation')
        .where(`${quote}id${quote} IN (:...ids)`, { ids: remove }).execute();
    }
    for (const row of keep.values()) {
      await queryRunner.manager.createQueryBuilder().update('question_category_generation')
        .set({ generation: row.generation }).where(`${quote}id${quote} = :id`, { id: row.id }).execute();
    }
  }

  private async backfillGenerations(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const quote = queryRunner.connection.options.type === 'postgres' ? '"' : '`';
    const questionScopes = (await queryRunner.query(
      `SELECT DISTINCT ${quote}tenantId${quote} AS tenantId, ${quote}category${quote} AS category FROM ${quote}question${quote}`,
    )) as Array<{ tenantId: string; category: string }>;
    const existing = (await queryRunner.query(
      `SELECT ${quote}tenantId${quote} AS tenantId, ${quote}category${quote} AS category FROM ${quote}question_category_generation${quote}`,
    )) as Array<{ tenantId: string; category: string }>;
    const known = new Set(existing.map((row) => JSON.stringify([row.tenantId, row.category])));
    for (const row of questionScopes) {
      const key = JSON.stringify([row.tenantId, row.category ?? '']);
      if (known.has(key)) continue;
      await queryRunner.manager.createQueryBuilder().insert().into('question_category_generation').values({
        id: randomUUID(), tenantId: row.tenantId, category: row.category ?? '', generation: 1,
      }).execute();
      known.add(key);
    }
  }

  private async dedupeProgressForLegacyScope(queryRunner: QueryRunner): Promise<void> {
    const quote = queryRunner.connection.options.type === 'postgres' ? '"' : '`';
    const rows = (await queryRunner.query(
      `SELECT ${quote}id${quote} AS id, ${quote}tenantId${quote} AS tenantId, ${quote}userId${quote} AS userId, ` +
      `${quote}category${quote} AS category, ${quote}courseId${quote} AS courseId, ` +
      `${quote}lastStudiedAt${quote} AS lastStudiedAt, ${quote}updatedAt${quote} AS updatedAt ` +
      `FROM ${quote}study_question_progress${quote}`,
    )) as Array<Record<string, string | Date>>;
    const keep = new Map<string, { id: string; timestamp: number }>();
    const remove: string[] = [];
    for (const row of rows) {
      const key = JSON.stringify([row.tenantId, row.userId, row.category, row.courseId]);
      const timestamp = Math.max(new Date(row.lastStudiedAt).getTime() || 0, new Date(row.updatedAt).getTime() || 0);
      const prior = keep.get(key);
      if (!prior) keep.set(key, { id: String(row.id), timestamp });
      else if (timestamp > prior.timestamp || (timestamp === prior.timestamp && String(row.id) > prior.id)) {
        remove.push(prior.id);
        keep.set(key, { id: String(row.id), timestamp });
      } else remove.push(String(row.id));
    }
    if (remove.length > 0) {
      await queryRunner.manager.createQueryBuilder().delete().from('study_question_progress')
        .where(`${quote}id${quote} IN (:...ids)`, { ids: remove }).execute();
    }
  }
}

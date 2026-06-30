import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddWrongQuestionSource1782447900000 implements MigrationInterface {
  name = 'AddWrongQuestionSource1782447900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('wrong_question'))) return;
    const table = await queryRunner.getTable('wrong_question');
    if (!table) return;

    if (!table.columns.some((column) => column.name === 'source')) {
      await queryRunner.addColumn(
        'wrong_question',
        new TableColumn({
          name: 'source',
          type: 'varchar',
          length: '20',
          isNullable: false,
          default: "'exam'",
        }),
      );
    }

    const staleUnique = table.indices.find(
      (index) =>
        index.isUnique &&
        ['tenantId', 'userId', 'questionId'].every((name) => index.columnNames.includes(name)) &&
        index.columnNames.length === 3,
    );
    if (staleUnique) await queryRunner.dropIndex('wrong_question', staleUnique);

    const nextTable = await queryRunner.getTable('wrong_question');
    const hasSourceUnique = nextTable?.indices.some((index) => index.name === 'IDX_wrong_question_user_question_source');
    if (!hasSourceUnique) {
      if (queryRunner.connection.options.type === 'mysql') {
        // MySQL utf8mb4 下 4 个 varchar 全长唯一索引会超过 3072 字节;source 只需首字母区分 exam/study。
        await queryRunner.query(
          'CREATE UNIQUE INDEX `IDX_wrong_question_user_question_source` ON `wrong_question` (`tenantId`, `userId`, `questionId`, `source`(1))',
        );
      } else {
        await queryRunner.createIndex(
          'wrong_question',
          new TableIndex({
            name: 'IDX_wrong_question_user_question_source',
            columnNames: ['tenantId', 'userId', 'questionId', 'source'],
            isUnique: true,
          }),
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('wrong_question'))) return;
    const table = await queryRunner.getTable('wrong_question');
    const sourceUnique = table?.indices.find((index) => index.name === 'IDX_wrong_question_user_question_source');
    if (sourceUnique) await queryRunner.dropIndex('wrong_question', sourceUnique);

    const hasLegacyUnique = table?.indices.some(
      (index) =>
        index.isUnique &&
        ['tenantId', 'userId', 'questionId'].every((name) => index.columnNames.includes(name)) &&
        index.columnNames.length === 3,
    );
    if (!hasLegacyUnique) {
      await queryRunner.createIndex(
        'wrong_question',
        new TableIndex({
          name: 'IDX_wrong_question_user_question',
          columnNames: ['tenantId', 'userId', 'questionId'],
          isUnique: true,
        }),
      );
    }

    const latest = await queryRunner.getTable('wrong_question');
    if (latest?.columns.some((column) => column.name === 'source')) {
      await queryRunner.dropColumn('wrong_question', 'source');
    }
  }
}

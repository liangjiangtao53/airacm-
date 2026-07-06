import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddExamAttemptCategory1782448700000 implements MigrationInterface {
  name = 'AddExamAttemptCategory1782448700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_attempt'))) return;
    if (!(await queryRunner.hasColumn('exam_attempt', 'category'))) {
      await queryRunner.addColumn(
        'exam_attempt',
        new TableColumn({ name: 'category', type: 'varchar', isNullable: false, default: "''" }),
      );
    }
    const table = await queryRunner.getTable('exam_attempt');
    if (!table?.indices.some((index) => index.name === 'IDX_exam_attempt_tenant_user_category')) {
      await queryRunner.createIndex(
        'exam_attempt',
        new TableIndex({
          name: 'IDX_exam_attempt_tenant_user_category',
          columnNames: ['tenantId', 'userId', 'category'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_attempt'))) return;
    const table = await queryRunner.getTable('exam_attempt');
    if (table?.indices.some((index) => index.name === 'IDX_exam_attempt_tenant_user_category')) {
      await queryRunner.dropIndex('exam_attempt', 'IDX_exam_attempt_tenant_user_category');
    }
    if (await queryRunner.hasColumn('exam_attempt', 'category')) {
      await queryRunner.dropColumn('exam_attempt', 'category');
    }
  }
}

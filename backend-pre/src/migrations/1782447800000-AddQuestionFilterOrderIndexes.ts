import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddQuestionFilterOrderIndexes1782447800000 implements MigrationInterface {
  name = 'AddQuestionFilterOrderIndexes1782447800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    const existing = new Set(table?.indices.map((index) => index.name) ?? []);
    if (!existing.has('IDX_question_tenant_category_order')) {
      await queryRunner.createIndex(
        'question',
        new TableIndex({
          name: 'IDX_question_tenant_category_order',
          columnNames: ['tenantId', 'category', 'order'],
        }),
      );
    }
    if (!existing.has('IDX_question_tenant_course_order')) {
      await queryRunner.createIndex(
        'question',
        new TableIndex({
          name: 'IDX_question_tenant_course_order',
          columnNames: ['tenantId', 'courseId', 'order'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    const categoryIndex = table?.indices.find((index) => index.name === 'IDX_question_tenant_category_order');
    if (categoryIndex) await queryRunner.dropIndex('question', categoryIndex);
    const courseIndex = table?.indices.find((index) => index.name === 'IDX_question_tenant_course_order');
    if (courseIndex) await queryRunner.dropIndex('question', courseIndex);
  }
}

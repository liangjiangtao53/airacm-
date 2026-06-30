import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddQuestionListIndex1782447600000 implements MigrationInterface {
  name = 'AddQuestionListIndex1782447600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    if (table?.indices.some((index) => index.name === 'IDX_question_tenant_usage_order')) return;
    await queryRunner.createIndex(
      'question',
      new TableIndex({
        name: 'IDX_question_tenant_usage_order',
        columnNames: ['tenantId', 'usage', 'order'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    const index = table?.indices.find((item) => item.name === 'IDX_question_tenant_usage_order');
    if (index) await queryRunner.dropIndex('question', index);
  }
}

import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddQuestionTenantOrderIndex1782447700000 implements MigrationInterface {
  name = 'AddQuestionTenantOrderIndex1782447700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    if (table?.indices.some((index) => index.name === 'IDX_question_tenant_order')) return;
    await queryRunner.createIndex(
      'question',
      new TableIndex({
        name: 'IDX_question_tenant_order',
        columnNames: ['tenantId', 'order'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    const table = await queryRunner.getTable('question');
    const index = table?.indices.find((item) => item.name === 'IDX_question_tenant_order');
    if (index) await queryRunner.dropIndex('question', index);
  }
}

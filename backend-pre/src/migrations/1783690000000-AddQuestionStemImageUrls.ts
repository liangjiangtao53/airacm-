import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddQuestionStemImageUrls1783690000000 implements MigrationInterface {
  name = 'AddQuestionStemImageUrls1783690000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (await queryRunner.hasColumn('question', 'stemImageUrls')) return;
    await queryRunner.addColumn(
      'question',
      new TableColumn({
        name: 'stemImageUrls',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (!(await queryRunner.hasColumn('question', 'stemImageUrls'))) return;
    await queryRunner.dropColumn('question', 'stemImageUrls');
  }
}

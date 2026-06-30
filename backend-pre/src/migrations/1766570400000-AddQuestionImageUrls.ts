import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddQuestionImageUrls1766570400000 implements MigrationInterface {
  name = 'AddQuestionImageUrls1766570400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (await queryRunner.hasColumn('question', 'imageUrls')) return;
    await queryRunner.addColumn(
      'question',
      new TableColumn({
        name: 'imageUrls',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (!(await queryRunner.hasColumn('question', 'imageUrls'))) return;
    await queryRunner.dropColumn('question', 'imageUrls');
  }
}

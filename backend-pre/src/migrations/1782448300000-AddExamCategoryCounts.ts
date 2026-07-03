import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddExamCategoryCounts1782448300000 implements MigrationInterface {
  name = 'AddExamCategoryCounts1782448300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('exam_paper_rule'))) return;
    if (await queryRunner.hasColumn('exam_paper_rule', 'categoryCounts')) return;
    await queryRunner.addColumn(
      'exam_paper_rule',
      new TableColumn({ name: 'categoryCounts', type: 'text', isNullable: true }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('exam_paper_rule', 'categoryCounts')) {
      await queryRunner.dropColumn('exam_paper_rule', 'categoryCounts');
    }
  }
}

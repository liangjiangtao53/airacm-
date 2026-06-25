import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionImageUrls1766570400000 implements MigrationInterface {
  name = 'AddQuestionImageUrls1766570400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (await queryRunner.hasColumn('question', 'imageUrls')) return;
    await queryRunner.query('ALTER TABLE "question" ADD "imageUrls" text');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question'))) return;
    if (!(await queryRunner.hasColumn('question', 'imageUrls'))) return;
    await queryRunner.query('ALTER TABLE "question" DROP COLUMN "imageUrls"');
  }
}

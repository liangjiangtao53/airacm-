import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddStudyQuestionProgress1782448200000 implements MigrationInterface {
  name = 'AddStudyQuestionProgress1782448200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('study_question_progress')) return;
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';
    await queryRunner.createTable(
      new Table({
        name: 'study_question_progress',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
          { name: 'userId', type: 'varchar', length: '64', isNullable: false },
          { name: 'category', type: 'varchar', length: '50', isNullable: false },
          { name: 'courseId', type: 'varchar', length: '64', isNullable: false, default: "''" },
          { name: 'questionId', type: 'varchar', length: '64', isNullable: false },
          { name: 'lastStudiedAt', type: tsType, isNullable: false },
          { name: 'updatedAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );
    await queryRunner.createIndex(
      'study_question_progress',
      new TableIndex({
        name: 'IDX_study_question_progress_scope',
        columnNames: ['tenantId', 'userId', 'category', 'courseId'],
        isUnique: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('study_question_progress')) {
      await queryRunner.dropTable('study_question_progress');
    }
  }
}

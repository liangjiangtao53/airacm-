import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddQuestionPractice1782448100000 implements MigrationInterface {
  name = 'AddQuestionPractice1782448100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('question_practice')) return;
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';
    await queryRunner.createTable(
      new Table({
        name: 'question_practice',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
          { name: 'userId', type: 'varchar', length: '64', isNullable: false },
          { name: 'questionId', type: 'varchar', length: '64', isNullable: false },
          { name: 'seenCount', type: 'int', isNullable: false, default: 0 },
          { name: 'correctCount', type: 'int', isNullable: false, default: 0 },
          { name: 'wrongCount', type: 'int', isNullable: false, default: 0 },
          { name: 'lastSeenAt', type: tsType, isNullable: true },
          { name: 'lastCorrectAt', type: tsType, isNullable: true },
          { name: 'lastWrongAt', type: tsType, isNullable: true },
          { name: 'updatedAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );
    await queryRunner.createIndex(
      'question_practice',
      new TableIndex({
        name: 'IDX_question_practice_user_question',
        columnNames: ['tenantId', 'userId', 'questionId'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'question_practice',
      new TableIndex({
        name: 'IDX_question_practice_user_seen',
        columnNames: ['tenantId', 'userId', 'lastSeenAt'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('question_practice')) {
      await queryRunner.dropTable('question_practice');
    }
  }
}

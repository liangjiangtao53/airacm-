import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddExamPaperRule1782448000000 implements MigrationInterface {
  name = 'AddExamPaperRule1782448000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('exam_paper_rule')) return;
    await queryRunner.createTable(
      new Table({
        name: 'exam_paper_rule',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'tenantId', type: 'varchar', isNullable: false },
          { name: 'totalCount', type: 'int', isNullable: false, default: 100 },
          {
            name: 'createdAt',
            type: queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime',
            isNullable: false,
            default: queryRunner.connection.options.type === 'mysql' ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime',
            isNullable: false,
            default: queryRunner.connection.options.type === 'mysql' ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'exam_paper_rule',
      new TableIndex({
        name: 'IDX_exam_paper_rule_tenant',
        columnNames: ['tenantId'],
        isUnique: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('exam_paper_rule')) {
      await queryRunner.dropTable('exam_paper_rule');
    }
  }
}

import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddQuestionImportBatchAndOperationLog1782448400000 implements MigrationInterface {
  name = 'AddQuestionImportBatchAndOperationLog1782448400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';

    if ((await queryRunner.hasTable('question')) && !(await queryRunner.hasColumn('question', 'importBatchId'))) {
      await queryRunner.addColumn(
        'question',
        new TableColumn({ name: 'importBatchId', type: 'varchar', isNullable: true }),
      );
    }

    if (!(await queryRunner.hasTable('question_import_batch'))) {
      await queryRunner.createTable(
        new Table({
          name: 'question_import_batch',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
            { name: 'importedBy', type: 'varchar', length: '64', isNullable: false },
            { name: 'fileName', type: 'varchar', isNullable: false, default: "''" },
            { name: 'fileHash', type: 'varchar', length: '64', isNullable: false, default: "''" },
            { name: 'usage', type: 'varchar', isNullable: false, default: "'both'" },
            { name: 'category', type: 'varchar', isNullable: false, default: "''" },
            { name: 'courseId', type: 'varchar', isNullable: true },
            { name: 'totalRows', type: 'int', isNullable: false, default: 0 },
            { name: 'imported', type: 'int', isNullable: false, default: 0 },
            { name: 'failed', type: 'int', isNullable: false, default: 0 },
            { name: 'failures', type: 'text', isNullable: true },
            { name: 'status', type: 'varchar', isNullable: false, default: "'completed'" },
            { name: 'createdAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'question_import_batch',
        new TableIndex({
          name: 'IDX_question_import_batch_tenant_created',
          columnNames: ['tenantId', 'createdAt'],
        }),
      );
    }

    if (!(await queryRunner.hasTable('admin_operation_log'))) {
      await queryRunner.createTable(
        new Table({
          name: 'admin_operation_log',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
            { name: 'adminId', type: 'varchar', length: '64', isNullable: false },
            { name: 'action', type: 'varchar', length: '64', isNullable: false },
            { name: 'targetType', type: 'varchar', length: '64', isNullable: false },
            { name: 'targetId', type: 'varchar', isNullable: true },
            { name: 'detail', type: 'text', isNullable: true },
            { name: 'createdAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'admin_operation_log',
        new TableIndex({
          name: 'IDX_admin_operation_log_tenant_created',
          columnNames: ['tenantId', 'createdAt'],
        }),
      );
      await queryRunner.createIndex(
        'admin_operation_log',
        new TableIndex({
          name: 'IDX_admin_operation_log_tenant_action',
          columnNames: ['tenantId', 'action'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_operation_log')) {
      await queryRunner.dropTable('admin_operation_log');
    }
    if (await queryRunner.hasTable('question_import_batch')) {
      await queryRunner.dropTable('question_import_batch');
    }
    if ((await queryRunner.hasTable('question')) && (await queryRunner.hasColumn('question', 'importBatchId'))) {
      await queryRunner.dropColumn('question', 'importBatchId');
    }
  }
}

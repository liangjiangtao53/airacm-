import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddUserActivityLog1782448600000 implements MigrationInterface {
  name = 'AddUserActivityLog1782448600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';

    if ((await queryRunner.hasTable('user')) && !(await queryRunner.hasColumn('user', 'firstLoginAt'))) {
      await queryRunner.addColumn('user', new TableColumn({ name: 'firstLoginAt', type: tsType, isNullable: true }));
    }
    if ((await queryRunner.hasTable('user')) && !(await queryRunner.hasColumn('user', 'lastLoginAt'))) {
      await queryRunner.addColumn('user', new TableColumn({ name: 'lastLoginAt', type: tsType, isNullable: true }));
    }
    if ((await queryRunner.hasTable('access_key')) && !(await queryRunner.hasColumn('access_key', 'firstLoginAt'))) {
      await queryRunner.addColumn('access_key', new TableColumn({ name: 'firstLoginAt', type: tsType, isNullable: true }));
    }
    if ((await queryRunner.hasTable('access_key')) && !(await queryRunner.hasColumn('access_key', 'lastLoginAt'))) {
      await queryRunner.addColumn('access_key', new TableColumn({ name: 'lastLoginAt', type: tsType, isNullable: true }));
    }
    if (await queryRunner.hasTable('access_key')) {
      const table = await queryRunner.getTable('access_key');
      if (!table?.indices.some((index) => index.name === 'IDX_access_key_tenant_user')) {
        await queryRunner.createIndex(
          'access_key',
          new TableIndex({ name: 'IDX_access_key_tenant_user', columnNames: ['tenantId', 'userId'] }),
        );
      }
    }

    if (!(await queryRunner.hasTable('user_activity_log'))) {
      await queryRunner.createTable(
        new Table({
          name: 'user_activity_log',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64', isNullable: false },
            { name: 'userId', type: 'varchar', length: '64', isNullable: true },
            { name: 'accessKeyId', type: 'varchar', isNullable: true },
            { name: 'accessKeyLast4', type: 'varchar', length: '32', isNullable: true },
            { name: 'accessKeyMasked', type: 'varchar', length: '32', isNullable: true },
            { name: 'accessKeyHash', type: 'varchar', length: '64', isNullable: true },
            { name: 'action', type: 'varchar', length: '64', isNullable: false },
            { name: 'targetType', type: 'varchar', length: '64', isNullable: false },
            { name: 'targetId', type: 'varchar', isNullable: true },
            { name: 'detail', type: 'text', isNullable: true },
            { name: 'createdAt', type: tsType, isNullable: false, default: 'CURRENT_TIMESTAMP' },
          ],
        }),
      );
      await queryRunner.createIndex(
        'user_activity_log',
        new TableIndex({ name: 'IDX_user_activity_log_tenant_created', columnNames: ['tenantId', 'createdAt'] }),
      );
      await queryRunner.createIndex(
        'user_activity_log',
        new TableIndex({ name: 'IDX_user_activity_log_tenant_action_created', columnNames: ['tenantId', 'action', 'createdAt'] }),
      );
      await queryRunner.createIndex(
        'user_activity_log',
        new TableIndex({ name: 'IDX_user_activity_log_tenant_key_created', columnNames: ['tenantId', 'accessKeyId', 'createdAt'] }),
      );
      await queryRunner.createIndex(
        'user_activity_log',
        new TableIndex({ name: 'IDX_user_activity_log_tenant_key_hash_created', columnNames: ['tenantId', 'accessKeyHash', 'createdAt'] }),
      );
      await queryRunner.createIndex(
        'user_activity_log',
        new TableIndex({ name: 'IDX_user_activity_log_tenant_user_created', columnNames: ['tenantId', 'userId', 'createdAt'] }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('user_activity_log')) {
      await queryRunner.dropTable('user_activity_log');
    }
    if (await queryRunner.hasTable('access_key')) {
      const table = await queryRunner.getTable('access_key');
      if (table?.indices.some((index) => index.name === 'IDX_access_key_tenant_user')) {
        await queryRunner.dropIndex('access_key', 'IDX_access_key_tenant_user');
      }
    }
    if ((await queryRunner.hasTable('access_key')) && (await queryRunner.hasColumn('access_key', 'lastLoginAt'))) {
      await queryRunner.dropColumn('access_key', 'lastLoginAt');
    }
    if ((await queryRunner.hasTable('access_key')) && (await queryRunner.hasColumn('access_key', 'firstLoginAt'))) {
      await queryRunner.dropColumn('access_key', 'firstLoginAt');
    }
    if ((await queryRunner.hasTable('user')) && (await queryRunner.hasColumn('user', 'lastLoginAt'))) {
      await queryRunner.dropColumn('user', 'lastLoginAt');
    }
    if ((await queryRunner.hasTable('user')) && (await queryRunner.hasColumn('user', 'firstLoginAt'))) {
      await queryRunner.dropColumn('user', 'firstLoginAt');
    }
  }
}

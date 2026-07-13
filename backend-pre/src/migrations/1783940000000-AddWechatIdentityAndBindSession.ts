import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddWechatIdentityAndBindSession1783940000000 implements MigrationInterface {
  name = 'AddWechatIdentityAndBindSession1783940000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tsType = queryRunner.connection.options.type === 'postgres' ? 'timestamptz' : 'datetime';
    if (await queryRunner.hasTable('user')) {
      if (!(await queryRunner.hasColumn('user', 'registrationSource'))) {
        await queryRunner.addColumn(
          'user',
          new TableColumn({
            name: 'registrationSource',
            type: 'varchar',
            length: '16',
            default: "'register'",
          }),
        );
      }
      if (!(await queryRunner.hasColumn('user', 'wechatOpenid'))) {
        await queryRunner.addColumn(
          'user',
          new TableColumn({ name: 'wechatOpenid', type: 'varchar', length: '128', isNullable: true }),
        );
      }
    }

    if (!(await queryRunner.hasTable('wechat_bind_session'))) {
      await queryRunner.createTable(
        new Table({
          name: 'wechat_bind_session',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'tenantId', type: 'varchar', length: '64' },
            { name: 'tokenHash', type: 'varchar', length: '64' },
            { name: 'wechatOpenid', type: 'varchar', length: '128' },
            { name: 'expiresAt', type: tsType },
            { name: 'consumedAt', type: tsType, isNullable: true },
            { name: 'failedAttempts', type: 'integer', default: 0 },
            { name: 'createdAt', type: tsType, default: 'CURRENT_TIMESTAMP' },
          ],
        }),
      );
    }

    const bindSessionTable = await queryRunner.getTable('wechat_bind_session');
    if (!bindSessionTable?.indices.some((index) => index.name === 'UQ_wechat_bind_session_token_hash')) {
      await queryRunner.createIndex(
        'wechat_bind_session',
        new TableIndex({
          name: 'UQ_wechat_bind_session_token_hash',
          columnNames: ['tokenHash'],
          isUnique: true,
        }),
      );
    }
    if (!bindSessionTable?.indices.some((index) => index.name === 'IDX_wechat_bind_session_expiry')) {
      await queryRunner.createIndex(
        'wechat_bind_session',
        new TableIndex({ name: 'IDX_wechat_bind_session_expiry', columnNames: ['expiresAt'] }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('wechat_bind_session')) {
      await queryRunner.dropTable('wechat_bind_session');
    }
    if ((await queryRunner.hasTable('user')) && (await queryRunner.hasColumn('user', 'wechatOpenid'))) {
      await queryRunner.dropColumn('user', 'wechatOpenid');
    }
    if (
      (await queryRunner.hasTable('user')) &&
      (await queryRunner.hasColumn('user', 'registrationSource'))
    ) {
      await queryRunner.dropColumn('user', 'registrationSource');
    }
  }
}

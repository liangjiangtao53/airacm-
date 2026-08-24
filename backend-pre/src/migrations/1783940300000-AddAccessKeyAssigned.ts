import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAccessKeyAssigned1783940300000 implements MigrationInterface {
  name = 'AddAccessKeyAssigned1783940300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('access_key')) || (await queryRunner.hasColumn('access_key', 'assigned'))) return;
    const isPostgres = queryRunner.connection.options.type === 'postgres';
    await queryRunner.addColumn(
      'access_key',
      new TableColumn({
        name: 'assigned',
        type: isPostgres ? 'boolean' : 'tinyint',
        isNullable: false,
        default: isPostgres ? false : 0,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if ((await queryRunner.hasTable('access_key')) && (await queryRunner.hasColumn('access_key', 'assigned'))) {
      await queryRunner.dropColumn('access_key', 'assigned');
    }
  }
}

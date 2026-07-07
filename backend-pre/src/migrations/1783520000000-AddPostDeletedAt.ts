import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const TS_TYPE = process.env.DB_TYPE === 'postgres' ? 'timestamptz' : 'datetime';

export class AddPostDeletedAt1783520000000 implements MigrationInterface {
  name = 'AddPostDeletedAt1783520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if ((await queryRunner.hasTable('post')) && !(await queryRunner.hasColumn('post', 'deletedAt'))) {
      await queryRunner.addColumn('post', new TableColumn({ name: 'deletedAt', type: TS_TYPE, isNullable: true }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if ((await queryRunner.hasTable('post')) && (await queryRunner.hasColumn('post', 'deletedAt'))) {
      await queryRunner.dropColumn('post', 'deletedAt');
    }
  }
}

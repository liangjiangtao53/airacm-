import { randomUUID } from 'crypto';
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddQuestionCategory1782447000000 implements MigrationInterface {
  name = 'AddQuestionCategory1782447000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question_category'))) {
      await queryRunner.createTable(
        new Table({
          name: 'question_category',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            { name: 'tenantId', type: 'varchar', isNullable: false },
            { name: 'name', type: 'varchar', isNullable: false },
            { name: 'order', type: 'int', isNullable: false, default: 0 },
            { name: 'createdAt', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          ],
        }),
        true,
      );
      await queryRunner.createIndex(
        'question_category',
        new TableIndex({
          name: 'UQ_question_category_tenant_name',
          columnNames: ['tenantId', 'name'],
          isUnique: true,
        }),
      );
    }

    const defaults = [
      'M1 航空概论',
      'M2 航空器维修',
      'M3 飞机结构和系统',
      'M4 直升机结构和系统',
      'M5 航空涡轮发动机',
      'M6 航空活塞发动机',
      'M9 航空英语',
      'M9 new',
      '无人机',
    ];
    const idColumn = queryRunner.connection.driver.escape('id');
    const tenantColumn = queryRunner.connection.driver.escape('tenantId');
    const nameColumn = queryRunner.connection.driver.escape('name');
    const orderColumn = queryRunner.connection.driver.escape('order');
    for (const [order, name] of defaults.entries()) {
      const exists = await queryRunner.query(
        `SELECT ${idColumn} FROM question_category WHERE ${tenantColumn} = ? AND ${nameColumn} = ? LIMIT 1`,
        ['t1', name],
      );
      if (Array.isArray(exists) && exists.length > 0) continue;
      await queryRunner.query(
        `INSERT INTO question_category (${idColumn}, ${tenantColumn}, ${nameColumn}, ${orderColumn}) VALUES (?, ?, ?, ?)`,
        [randomUUID(), 't1', name, order],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('question_category'))) return;
    await queryRunner.dropTable('question_category');
  }
}

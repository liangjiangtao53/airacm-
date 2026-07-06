import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

const TS_TYPE = process.env.DB_TYPE === 'postgres' ? 'timestamptz' : 'datetime';

export class AddExamDeleteAndReplyLikes1782448800000 implements MigrationInterface {
  name = 'AddExamDeleteAndReplyLikes1782448800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('exam_attempt')) {
      if (!(await queryRunner.hasColumn('exam_attempt', 'deletedAt'))) {
        await queryRunner.addColumn(
          'exam_attempt',
          new TableColumn({ name: 'deletedAt', type: TS_TYPE, isNullable: true }),
        );
      }
    }

    if (await queryRunner.hasTable('post_reply')) {
      if (!(await queryRunner.hasColumn('post_reply', 'deletedAt'))) {
        await queryRunner.addColumn(
          'post_reply',
          new TableColumn({ name: 'deletedAt', type: TS_TYPE, isNullable: true }),
        );
      }
    }

    if (!(await queryRunner.hasTable('post_reply_like'))) {
      await queryRunner.createTable(
        new Table({
          name: 'post_reply_like',
          columns: [
            { name: 'id', type: 'varchar', isPrimary: true },
            { name: 'tenantId', type: 'varchar' },
            { name: 'replyId', type: 'varchar' },
            { name: 'userId', type: 'varchar' },
            { name: 'createdAt', type: TS_TYPE, isNullable: false },
          ],
        }),
      );
    }

    const table = await queryRunner.getTable('post_reply_like');
    if (table && !table.indices.some((index) => index.name === 'IDX_post_reply_like_unique')) {
      await queryRunner.createIndex(
        'post_reply_like',
        new TableIndex({
          name: 'IDX_post_reply_like_unique',
          columnNames: ['tenantId', 'replyId', 'userId'],
          isUnique: true,
        }),
      );
    }
    if (table && !table.indices.some((index) => index.name === 'IDX_post_reply_like_reply')) {
      await queryRunner.createIndex(
        'post_reply_like',
        new TableIndex({
          name: 'IDX_post_reply_like_reply',
          columnNames: ['tenantId', 'replyId'],
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('post_reply_like')) {
      await queryRunner.dropTable('post_reply_like');
    }
    if ((await queryRunner.hasTable('post_reply')) && (await queryRunner.hasColumn('post_reply', 'deletedAt'))) {
      await queryRunner.dropColumn('post_reply', 'deletedAt');
    }
    if ((await queryRunner.hasTable('exam_attempt')) && (await queryRunner.hasColumn('exam_attempt', 'deletedAt'))) {
      await queryRunner.dropColumn('exam_attempt', 'deletedAt');
    }
  }
}

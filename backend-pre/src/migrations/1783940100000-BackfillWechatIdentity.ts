import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

interface LegacyIdentityRow {
  id: string;
  tenantId: string;
  openid: string | null;
  accessKeyCount: string | number;
}

interface DuplicateNicknameRow {
  tenantId: string;
  nickname: string;
}

const REAL_OPENID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export class BackfillWechatIdentity1783940100000 implements MigrationInterface {
  name = 'BackfillWechatIdentity1783940100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user')) || !(await queryRunner.hasColumn('user', 'wechatOpenid'))) {
      return;
    }
    const q = (name: string): string =>
      ['mysql', 'mariadb'].includes(queryRunner.connection.options.type)
        ? `\`${name}\``
        : `"${name}"`;
    const rows = (await queryRunner.query(
      `SELECT u.${q('id')} AS ${q('id')}, u.${q('tenantId')} AS ${q('tenantId')}, u.${q('openid')} AS ${q('openid')}, ` +
        `(SELECT COUNT(*) FROM ${q('access_key')} k WHERE k.${q('tenantId')} = u.${q('tenantId')} ` +
        `AND k.${q('userId')} = u.${q('id')}) AS ${q('accessKeyCount')} FROM ${q('user')} u`,
    )) as LegacyIdentityRow[];

    const realRows = rows.filter((row) => this.isRealOpenid(row.openid));
    const malformedRows = rows.filter(
      (row) =>
        row.openid &&
        !row.openid.startsWith('key:') &&
        !row.openid.startsWith('dev-openid-') &&
        !REAL_OPENID_RE.test(row.openid),
    );
    const duplicateKeys = new Set<string>();
    const seen = new Set<string>();
    for (const row of realRows) {
      const key = `${row.tenantId.toLocaleLowerCase()}:${row.openid}`;
      if (seen.has(key)) duplicateKeys.add(key);
      seen.add(key);
    }
    const sourceConflicts = realRows.filter((row) => Number(row.accessKeyCount) > 0);
    const duplicateNicknames = (await queryRunner.query(
      `SELECT ${q('tenantId')} AS ${q('tenantId')}, ${q('nickname')} AS ${q('nickname')} ` +
        `FROM ${q('user')} GROUP BY ${q('tenantId')}, ${q('nickname')} HAVING COUNT(*) > 1`,
    )) as DuplicateNicknameRow[];
    if (duplicateKeys.size || malformedRows.length || sourceConflicts.length || duplicateNicknames.length) {
      throw new Error(
        `微信身份迁移预检失败: duplicateOpenids=${duplicateKeys.size}, malformedOpenids=${malformedRows.length}, sourceConflicts=${sourceConflicts.length}, duplicateNicknames=${duplicateNicknames.length}`,
      );
    }

    if (['mysql', 'mariadb'].includes(queryRunner.connection.options.type)) {
      await queryRunner.query(
        `ALTER TABLE ${q('user')} MODIFY ${q('wechatOpenid')} varchar(128) CHARACTER SET ascii COLLATE ascii_bin NULL`,
      );
    }

    await queryRunner.query(`UPDATE ${q('user')} SET ${q('registrationSource')} = 'register'`);
    const placeholder = (position: number): string =>
      queryRunner.connection.options.type === 'postgres' ? `$${position}` : '?';
    const keyRows = rows.filter(
      (row) => row.openid?.startsWith('key:') || Number(row.accessKeyCount) > 0,
    );
    for (const row of keyRows) {
      await queryRunner.query(
        `UPDATE ${q('user')} SET ${q('registrationSource')} = 'key' WHERE ${q('id')} = ${placeholder(1)}`,
        [row.id],
      );
    }
    for (const row of realRows) {
      await queryRunner.query(
        `UPDATE ${q('user')} SET ${q('registrationSource')} = 'wechat', ${q('wechatOpenid')} = ${placeholder(1)} WHERE ${q('id')} = ${placeholder(2)}`,
        [row.openid, row.id],
      );
    }

    const table = await queryRunner.getTable('user');
    if (!table?.indices.some((index) => index.name === 'UQ_user_tenant_wechat_openid')) {
      await queryRunner.createIndex(
        'user',
        new TableIndex({
          name: 'UQ_user_tenant_wechat_openid',
          columnNames: ['tenantId', 'wechatOpenid'],
          isUnique: true,
        }),
      );
    }
    if (!table?.indices.some((index) => index.name === 'UQ_user_tenant_nickname')) {
      await queryRunner.createIndex(
        'user',
        new TableIndex({
          name: 'UQ_user_tenant_nickname',
          columnNames: ['tenantId', 'nickname'],
          isUnique: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;
    const table = await queryRunner.getTable('user');
    if (table?.indices.some((index) => index.name === 'UQ_user_tenant_wechat_openid')) {
      await queryRunner.dropIndex('user', 'UQ_user_tenant_wechat_openid');
    }
    if (table?.indices.some((index) => index.name === 'UQ_user_tenant_nickname')) {
      await queryRunner.dropIndex('user', 'UQ_user_tenant_nickname');
    }
    if (await queryRunner.hasColumn('user', 'wechatOpenid')) {
      const q = (name: string): string =>
        ['mysql', 'mariadb'].includes(queryRunner.connection.options.type)
          ? `\`${name}\``
          : `"${name}"`;
      await queryRunner.query(`UPDATE ${q('user')} SET ${q('wechatOpenid')} = NULL`);
    }
  }

  private isRealOpenid(value: string | null): value is string {
    return Boolean(
      value &&
        !value.startsWith('key:') &&
        !value.startsWith('dev-openid-') &&
        REAL_OPENID_RE.test(value),
    );
  }
}

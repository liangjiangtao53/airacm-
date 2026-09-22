import 'reflect-metadata';

// 内存库 + dev 配置(必须在 import AppModule / config 前设好)。
process.env.DB_TYPE = 'better-sqlite3';
process.env.DB_DATABASE = ':memory:';
process.env.DB_SYNC = 'true';
process.env.SMS_DEV_MODE = 'true';
process.env.SMS_DEV_CODE = '1234';
process.env.APP_APK_PATH = '.tmp-test-app-upload.apk';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthUser, signToken } from '../src/common';
import { User, Wallet } from '../src/entities';

const TENANT = 't1';

describe('超管重置用户密码', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  let phoneSeq = 0;
  function uniquePhone(): string {
    return `137${String(10000000 + phoneSeq++).slice(-8)}`;
  }

  // 直接建库用户:passwordHash 为真实 bcrypt,可走 /auth/login 验证。
  async function makeLoginableUser(
    role: 'user' | 'admin' | 'super',
    password: string,
  ): Promise<{ id: string; phone: string; token: string }> {
    const sid = crypto.randomUUID();
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        tenantId: TENANT,
        phone: uniquePhone(),
        nickname: `用户${uniquePhone()}`,
        passwordHash: await bcrypt.hash(password, 10),
        role,
        openid: null,
        sessionId: sid,
      }),
    );
    await ds.getRepository(Wallet).save(
      ds.getRepository(Wallet).create({ tenantId: TENANT, userId: u.id, balance: 0 }),
    );
    const authUser: AuthUser = { userId: u.id, tenantId: TENANT, role };
    return { id: u.id, phone: u.phone, token: signToken(jwt, authUser, sid) };
  }

  async function login(phone: string, password: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ phone, password });
    return res.status;
  }

  it('超管可重置业务管理员密码:旧密码失效,新密码可登录', async () => {
    const sup = await makeLoginableUser('super', 'SuperOld1!');
    const biz = await makeLoginableUser('admin', 'BizOld1!');

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${biz.id}/reset-password`)
      .set('Authorization', `Bearer ${sup.token}`);
    expect(res.status).toBe(201);
    const newPassword: string = res.body.data.password;
    expect(typeof newPassword).toBe('string');
    expect(newPassword.length).toBeGreaterThanOrEqual(8);

    // 库里只存哈希,响应明文不落库
    const row = await ds.getRepository(User).findOneOrFail({ where: { id: biz.id } });
    expect(row.passwordHash).not.toBe(newPassword);
    expect(await bcrypt.compare(newPassword, row.passwordHash)).toBe(true);

    expect(await login(biz.phone, 'BizOld1!')).toBe(401); // 旧密码失效
    expect(await login(biz.phone, newPassword)).toBe(201); // 新密码可登录
    expect(await login(sup.phone, 'SuperOld1!')).toBe(201); // 超管自身不受影响
  });

  it('重置后目标管理员旧 token 立即失效(会话被踢)', async () => {
    const sup = await makeLoginableUser('super', 'SuperOld1!');
    const biz = await makeLoginableUser('admin', 'BizOld1!');

    // 重置前旧 token 可访问业务接口
    const before = await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${biz.token}`);
    expect(before.status).toBe(200);

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${biz.id}/reset-password`)
      .set('Authorization', `Bearer ${sup.token}`);
    expect(res.status).toBe(201);

    const after = await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${biz.token}`);
    expect(after.status).toBe(401); // sid 已轮换,旧会话被踢
  });

  it('业务管理员无权重置密码(类级 super 限制,返回 401)', async () => {
    const biz = await makeLoginableUser('admin', 'BizOld1!');
    const target = await makeLoginableUser('admin', 'Target1!');

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${target.id}/reset-password`)
      .set('Authorization', `Bearer ${biz.token}`);
    expect(res.status).toBe(401); // RolesGuard 对角色不符抛 401
  });

  it('不能重置超级管理员密码', async () => {
    const sup = await makeLoginableUser('super', 'SuperOld1!');
    const otherSuper = await makeLoginableUser('super', 'Other1!');

    const res = await request(app.getHttpServer())
      .post(`/admin/users/${otherSuper.id}/reset-password`)
      .set('Authorization', `Bearer ${sup.token}`);
    expect(res.status).toBe(403);
  });

  it('重置不存在的用户返回 404', async () => {
    const sup = await makeLoginableUser('super', 'SuperOld1!');

    const res = await request(app.getHttpServer())
      .post('/admin/users/00000000-0000-4000-8000-000000000000/reset-password')
      .set('Authorization', `Bearer ${sup.token}`);
    expect(res.status).toBe(404);
  });
});

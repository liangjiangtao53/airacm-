import 'reflect-metadata';

// 内存库 + dev 配置(必须在 import AppModule / config 前设好)。
process.env.DB_TYPE = 'better-sqlite3';
process.env.DB_DATABASE = ':memory:';
process.env.DB_SYNC = 'true'; // 测试用 synchronize 建表
process.env.WECHAT_PAY_ENABLED = 'true';
process.env.WECHAT_API_KEY = 'dev-mch-key';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthUser, signToken } from '../src/common';
import {
  Course,
  Lesson,
  RechargeCode,
  User,
  Wallet,
  WalletTxn,
  Entitlement,
  Chapter,
} from '../src/entities';
import { WalletService } from '../src/modules/wallet';
import { OrderService } from '../src/modules/order';
import { PaymentService } from '../src/modules/payment';
import { CourseService } from '../src/modules/course';

const TENANT = 't1';

// 5 条 CRITICAL 路径(会直接亏钱或泄露权益),来自工程评审测试要求。
describe('CRITICAL paths', () => {
  let app: INestApplication;
  let ds: DataSource;
  let wallet: WalletService;
  let orders: OrderService;
  let payment: PaymentService;
  let courses: CourseService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // 镜像生产:全局严格校验(过滤器/拦截器已由 AppModule 注册)。
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ds = moduleRef.get(DataSource);
    wallet = moduleRef.get(WalletService);
    orders = moduleRef.get(OrderService);
    payment = moduleRef.get(PaymentService);
    courses = moduleRef.get(CourseService);
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  // 每个用例独立数据,避免互相污染。
  async function freshUser(balance: number): Promise<AuthUser> {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        tenantId: TENANT,
        phone: `1${Math.floor(1e10 + Math.random() * 8e9)}`.slice(0, 11),
        passwordHash: 'x',
        openid: null,
      }),
    );
    await ds.getRepository(Wallet).save(
      ds.getRepository(Wallet).create({ tenantId: TENANT, userId: user.id, balance }),
    );
    return { userId: user.id, tenantId: TENANT, role: 'user' };
  }

  async function makeCourse(
    price: number,
    access: 'free' | 'paid' = 'paid',
  ): Promise<{ course: Course; lesson: Lesson }> {
    const course = await ds.getRepository(Course).save(
      ds.getRepository(Course).create({ tenantId: TENANT, title: '测试课', price }),
    );
    const chapter = await ds.getRepository(Chapter).save(
      ds.getRepository(Chapter).create({ tenantId: TENANT, courseId: course.id, title: '章', order: 0 }),
    );
    const lesson = await ds.getRepository(Lesson).save(
      ds.getRepository(Lesson).create({
        tenantId: TENANT,
        courseId: course.id,
        chapterId: chapter.id,
        title: '课时',
        access,
        order: 0,
      }),
    );
    return { course, lesson };
  }

  // 路径1:钱包原子扣费 — 并发双花:同用户并发扣,只扣一次、余额不为负。
  it('wallet atomic decrement: 并发双花只成功一次,余额不为负', async () => {
    const user = await freshUser(1400);
    const { course } = await makeCourse(1400);

    // 注:better-sqlite3 单连接下并发事务无法真正并行(生产 Postgres 走连接池)。
    // 这里断言的是「绝不双花」安全不变量:无论交错如何,至多成功一次、余额永不为负、权益≤1。
    const results = await Promise.allSettled([
      orders.createWalletOrder(user, course.id),
      orders.createWalletOrder(user, course.id),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(1); // 绝不双花

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBeGreaterThanOrEqual(0); // 余额不为负
    expect([0, 1400]).toContain(w.balance); // 要么扣一次要么没扣,绝无扣两次

    const ents = await ds.getRepository(Entitlement).count({
      where: { tenantId: TENANT, userId: user.userId, courseId: course.id },
    });
    const consumes = await ds.getRepository(WalletTxn).count({
      where: { tenantId: TENANT, walletId: w.id, type: 'consume' },
    });
    expect(ents).toBeLessThanOrEqual(1);
    expect(consumes).toBe(ents); // 扣费笔数与发权益数严格一致(不会扣了钱没发权益)
    expect(w.balance).toBe(ents === 1 ? 0 : 1400);
  });

  // 原子扣减的确定性证明:购课成功后重复购买被拒,绝不重复扣费。
  it('wallet: 已购课程重复购买被拒,不重复扣费', async () => {
    const user = await freshUser(2800);
    const { course } = await makeCourse(1400);
    await orders.createWalletOrder(user, course.id);
    await expect(orders.createWalletOrder(user, course.id)).rejects.toThrow('已购买');
    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(1400); // 只扣一次
    const ents = await ds.getRepository(Entitlement).count({
      where: { tenantId: TENANT, userId: user.userId, courseId: course.id },
    });
    expect(ents).toBe(1);
  });

  // 余额不足明确失败,不扣负。
  it('wallet: 余额不足购课失败', async () => {
    const user = await freshUser(100);
    const { course } = await makeCourse(1400);
    await expect(orders.createWalletOrder(user, course.id)).rejects.toThrow('余额不足');
    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(100);
  });

  // 路径2:激活码充值 — 并发/重复使用只生效一次。
  it('recharge code: 同码并发只入账一次', async () => {
    const user = await freshUser(0);
    await ds.getRepository(RechargeCode).save(
      ds.getRepository(RechargeCode).create({ tenantId: TENANT, code: 'ONCE-1', amount: 5000, status: 'unused' }),
    );

    // 同上:断言「同码只入账一次」安全不变量。
    const results = await Promise.allSettled([
      wallet.rechargeByCode(user, 'ONCE-1'),
      wallet.rechargeByCode(user, 'ONCE-1'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeLessThanOrEqual(1); // 同码绝不成功两次

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    const recharges = await ds.getRepository(WalletTxn).count({
      where: { tenantId: TENANT, walletId: w.id, type: 'recharge' },
    });
    expect(recharges).toBeLessThanOrEqual(1); // 绝不重复入账
    expect(w.balance).toBe(recharges * 5000); // 余额与入账笔数严格一致
  });

  // 确定性证明:同一激活码用过后再用被拒,余额不重复增加。
  it('recharge code: 用过的码再次使用被拒', async () => {
    const user = await freshUser(0);
    await ds.getRepository(RechargeCode).save(
      ds.getRepository(RechargeCode).create({ tenantId: TENANT, code: 'ONCE-2', amount: 5000, status: 'unused' }),
    );
    const first = await wallet.rechargeByCode(user, 'ONCE-2');
    expect(first.balance).toBe(5000);
    await expect(wallet.rechargeByCode(user, 'ONCE-2')).rejects.toThrow('已被使用');
    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(5000); // 不重复入账
  });

  // 路径3:微信回调幂等 — 同 transaction_id 重发只入账一次(基于预单对账)。
  it('wechat callback idempotent: 同 transaction_id 重发只入账一次', async () => {
    const user = await freshUser(0);
    const prepay = await payment.prepay(user, 8800);
    const body = signedCallback(prepay.outTradeNo, 'TXN-DUP-1', 8800);

    const r1 = await payment.handleCallback(body);
    const r2 = await payment.handleCallback(body);
    expect(r1.code).toBe('SUCCESS');
    expect(r2.code).toBe('SUCCESS');

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(8800); // 只入一次

    const txns = await ds.getRepository(WalletTxn).count({
      where: { tenantId: TENANT, walletId: w.id, type: 'recharge', refId: 'TXN-DUP-1' },
    });
    expect(txns).toBe(1);
  });

  // 路径4:微信回调验签 — 伪造签名拒绝。
  it('wechat callback sign: 伪造签名拒绝,不入账', async () => {
    const user = await freshUser(0);
    const prepay = await payment.prepay(user, 9900);
    const body = signedCallback(prepay.outTradeNo, 'TXN-FAKE-1', 9900);
    body.sign = 'DEADBEEF'; // 篡改签名

    const r = await payment.handleCallback(body);
    expect(r.code).toBe('FAIL');

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(0); // 未入账
  });

  // 对账:回调金额与预单不符 → 拒绝,不入账(防篡改/错单)。
  it('wechat callback reconcile: 金额与预单不符被拒,不入账', async () => {
    const user = await freshUser(0);
    const prepay = await payment.prepay(user, 5000);
    // 回调谎报 9999,但签名按 9999 算(攻击者改了金额并重算签名)。
    const body = signedCallback(prepay.outTradeNo, 'TXN-AMT-1', 9999);

    const r = await payment.handleCallback(body);
    expect(r.code).toBe('FAIL');
    expect(r.message).toContain('金额');

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(0);
  });

  // 回调无对应预单 → 拒绝(不凭空入账)。
  it('wechat callback orphan: 无预单的回调被拒', async () => {
    const body = signedCallback('NO-SUCH-ORDER', 'TXN-ORPHAN-1', 5000);
    const r = await payment.handleCallback(body);
    expect(r.code).toBe('FAIL');
    expect(r.message).toContain('订单');
  });

  // 路径5:课时鉴权 — 登录即可学全部(已去付费墙),免费/付费课时均放行,返回播放地址。
  it('lesson auth: 登录用户可学任意课时(含付费),返回播放地址', async () => {
    const user = await freshUser(0);
    const { lesson: paidLesson } = await makeCourse(1400, 'paid');
    const paid = await courses.lessonDetail(user, paidLesson.id);
    expect(paid.playUrl).toContain(paidLesson.id);

    const { lesson: freeLesson } = await makeCourse(1400, 'free');
    const ok = await courses.lessonDetail(user, freeLesson.id);
    expect(ok.playUrl).toContain(freeLesson.id);
  });

  // 安全:管理接口未登录被拒。
  it('admin guard: 无 token 访问管理接口 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/recharge-codes')
      .send({ count: 1, amount: 100 });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false); // 统一错误信封
  });

  // 安全:普通用户 token 访问管理接口被拒(角色越权)。
  it('admin guard: 普通用户访问管理接口 401', async () => {
    const user = await freshUser(0);
    const token = signToken(jwt, user);
    const res = await request(app.getHttpServer())
      .post('/admin/recharge-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ count: 1, amount: 100 });
    expect(res.status).toBe(401);
  });

  // 充值码仅超级管理员:admin 被拒,super 可发(码为加密随机防枚举)。
  it('admin guard: 充值码仅 super', async () => {
    const admin = await freshAdmin();
    const denied = await request(app.getHttpServer())
      .post('/admin/recharge-codes')
      .set('Authorization', `Bearer ${signToken(jwt, admin)}`)
      .send({ count: 3, amount: 5000 });
    expect(denied.status).toBe(401);

    const sup = await freshAdmin('super');
    const res = await request(app.getHttpServer())
      .post('/admin/recharge-codes')
      .set('Authorization', `Bearer ${signToken(jwt, sup)}`)
      .send({ count: 3, amount: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.data.codes).toHaveLength(3);
    expect(res.body.data.codes[0]).toMatch(/^[0-9A-F]{16}$/); // 16 位随机
  });

  // 统一错误信封:校验失败也是 { success:false, data:null, error }。
  it('error envelope: 非法入参返回统一错误信封', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ phone: 'bad', code: '0000', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(typeof res.body.error).toBe('string');
  });

  async function freshAdmin(role: 'admin' | 'super' = 'admin'): Promise<AuthUser> {
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        tenantId: TENANT,
        phone: `1${Math.floor(1e10 + Math.random() * 8e9)}`.slice(0, 11),
        passwordHash: 'x',
        role,
        openid: null,
      }),
    );
    return { userId: u.id, tenantId: TENANT, role };
  }

  // 复刻 payment 模块的 v2 签名算法,生成合法回调。
  function signedCallback(outTradeNo: string, transactionId: string, totalFee: number) {
    const params: Record<string, string | number> = {
      out_trade_no: outTradeNo,
      transaction_id: transactionId,
      total_fee: totalFee,
    };
    const keys = Object.keys(params)
      .filter((k) => params[k] !== '' && params[k] !== undefined)
      .sort();
    const base = keys.map((k) => `${k}=${params[k]}`).join('&') + `&key=${process.env.WECHAT_API_KEY}`;
    const sign = crypto.createHash('md5').update(base, 'utf8').digest('hex').toUpperCase();
    return { ...params, sign } as {
      out_trade_no: string;
      transaction_id: string;
      total_fee: number;
      sign: string;
    };
  }
});

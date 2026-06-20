import 'reflect-metadata';

// 内存库 + dev 配置(必须在 import AppModule / config 前设好)。
process.env.DB_TYPE = 'better-sqlite3';
process.env.DB_DATABASE = ':memory:';
process.env.WECHAT_PAY_ENABLED = 'true';
process.env.WECHAT_API_KEY = 'dev-mch-key';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthUser } from '../src/common';
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

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ds = moduleRef.get(DataSource);
    wallet = moduleRef.get(WalletService);
    orders = moduleRef.get(OrderService);
    payment = moduleRef.get(PaymentService);
    courses = moduleRef.get(CourseService);
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
    return { userId: user.id, tenantId: TENANT };
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

  // 路径3:微信回调幂等 — 同 transaction_id 重发只入账一次。
  it('wechat callback idempotent: 同 transaction_id 重发只入账一次', async () => {
    const user = await freshUser(0);
    const body = signedCallback(user, 'TXN-DUP-1', 8800);

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
    const body = signedCallback(user, 'TXN-FAKE-1', 9900);
    body.sign = 'DEADBEEF'; // 篡改签名

    const r = await payment.handleCallback(body);
    expect(r.code).toBe('FAIL');

    const w = await ds.getRepository(Wallet).findOneOrFail({
      where: { tenantId: TENANT, userId: user.userId },
    });
    expect(w.balance).toBe(0); // 未入账
  });

  // 路径5:课时后端鉴权 — 未购/越权访问被拒(不靠前端)。
  it('lesson auth: 未购课访问付费课时被拒,免费课时放行', async () => {
    const user = await freshUser(0);
    const { lesson: paidLesson } = await makeCourse(1400, 'paid');
    await expect(courses.lessonDetail(user, paidLesson.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const { lesson: freeLesson } = await makeCourse(1400, 'free');
    const ok = await courses.lessonDetail(user, freeLesson.id);
    expect(ok.playUrl).toContain(freeLesson.id);
  });

  // 复刻 payment 模块的 v2 签名算法,生成合法回调。
  function signedCallback(user: AuthUser, transactionId: string, totalFee: number) {
    const attach = JSON.stringify({ userId: user.userId, tenantId: user.tenantId });
    const params: Record<string, string | number> = {
      out_trade_no: `O-${transactionId}`,
      transaction_id: transactionId,
      total_fee: totalFee,
      attach,
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
      attach: string;
      sign: string;
    };
  }
});

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ALL_ENTITIES, AccessKey, Tenant, User, Wallet, WechatBindSession } from '../src/entities';
import { AuthModule, AuthService } from '../src/modules/auth';
import {
  WechatMiniProgramService,
} from '../src/modules/wechat-mini-program';
import { SessionModule } from '../src/session';
import { env } from '../src/config';

describe('WeChat login and binding', () => {
  let module: TestingModule;
  let auth: AuthService;
  let users: Repository<User>;
  let keys: Repository<AccessKey>;
  let wallets: Repository<Wallet>;
  let bindSessions: Repository<WechatBindSession>;
  let currentOpenid = 'wx-openid-used-key';

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: ALL_ENTITIES,
        }),
        JwtModule.register({ global: true, secret: env.jwtSecret }),
        SessionModule,
        AuthModule,
      ],
    })
      .overrideProvider(WechatMiniProgramService)
      .useValue({ exchangeCode: jest.fn(async () => ({ openid: currentOpenid })) })
      .compile();
    await module.init();
    auth = module.get(AuthService);
    users = module.get(getRepositoryToken(User));
    keys = module.get(getRepositoryToken(AccessKey));
    wallets = module.get(getRepositoryToken(Wallet));
    bindSessions = module.get(getRepositoryToken(WechatBindSession));
    await module.get<Repository<Tenant>>(getRepositoryToken(Tenant)).save({
      id: env.defaultTenantId,
      name: 'test',
      status: 'active',
    });
  });

  afterAll(async () => module.close());

  it('binds a used key to its existing user and rejects ticket replay', async () => {
    const user = await users.save(
      users.create({
        tenantId: env.defaultTenantId,
        phone: '13800000001',
        nickname: 'used-key-user',
        passwordHash: '',
        openid: 'key:used',
        registrationSource: 'key',
        role: 'user',
      }),
    );
    await wallets.save(wallets.create({ tenantId: env.defaultTenantId, userId: user.id, balance: 0 }));
    await keys.save(
      keys.create({
        tenantId: env.defaultTenantId,
        key: 'USEDKEY000000001',
        status: 'active',
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );

    const login = await auth.wechatLogin({ code: 'code-1' });
    expect(login.needBinding).toBe(true);
    if (!login.needBinding) throw new Error('binding ticket expected');
    const bound = await auth.bindWechatKey({
      bindingToken: login.bindingToken,
      key: 'USEDKEY000000001',
    });
    expect(bound.needProfile).toBe(false);
    expect((await users.findOneByOrFail({ id: user.id })).wechatOpenid).toBe(currentOpenid);
    await expect(
      auth.bindWechatKey({ bindingToken: login.bindingToken, key: 'USEDKEY000000001' }),
    ).rejects.toThrow('微信绑定已失效');

    const nextLogin = await auth.wechatLogin({ code: 'code-2' });
    expect(nextLogin.needBinding).toBe(false);
  });

  it('creates profile, wallet and ownership atomically for an unused key', async () => {
    currentOpenid = 'wx-openid-unused-key';
    await keys.save(
      keys.create({
        tenantId: env.defaultTenantId,
        key: 'UNUSEDKEY0000001',
        status: 'active',
        userId: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const login = await auth.wechatLogin({ code: 'code-3' });
    if (!login.needBinding) throw new Error('binding ticket expected');
    await expect(
      auth.bindWechatKey({ bindingToken: login.bindingToken, key: 'UNUSEDKEY0000001' }),
    ).resolves.toEqual({ needProfile: true });
    const bound = await auth.bindWechatKey({
      bindingToken: login.bindingToken,
      key: 'UNUSEDKEY0000001',
      phone: '13800000002',
      nickname: 'new-key-user',
    });
    expect(bound.needProfile).toBe(false);
    const user = await users.findOneByOrFail({ phone: '13800000002' });
    expect(user.wechatOpenid).toBe(currentOpenid);
    expect(user.registrationSource).toBe('key');
    expect(await wallets.exist({ where: { userId: user.id } })).toBe(true);
    expect((await keys.findOneByOrFail({ key: 'UNUSEDKEY0000001' })).userId).toBe(user.id);
  });

  it('binds an existing password account without creating another user', async () => {
    currentOpenid = 'wx-openid-password';
    const user = await users.save(
      users.create({
        tenantId: env.defaultTenantId,
        phone: '13800000003',
        nickname: 'password-user',
        passwordHash: await bcrypt.hash('Password@123', 4),
        openid: null,
        registrationSource: 'register',
        role: 'user',
      }),
    );
    const before = await users.count();
    const login = await auth.wechatLogin({ code: 'code-4' });
    if (!login.needBinding) throw new Error('binding ticket expected');
    const result = await auth.bindWechatPassword({
      bindingToken: login.bindingToken,
      phone: user.phone,
      password: 'Password@123',
    });
    expect(result.userId).toBe(user.id);
    expect(await users.count()).toBe(before);
    expect((await users.findOneByOrFail({ id: user.id })).wechatOpenid).toBe(currentOpenid);
    expect(await bindSessions.count({ where: { consumedAt: IsNull() } })).toBe(0);
  });

  it('rejects password binding for a passwordless key account with a domain error', async () => {
    currentOpenid = 'wx-openid-passwordless';
    const user = await users.save(
      users.create({
        tenantId: env.defaultTenantId,
        phone: '13800000004',
        nickname: 'passwordless-user',
        passwordHash: '',
        openid: 'key:passwordless',
        registrationSource: 'key',
        role: 'user',
      }),
    );
    await keys.save(
      keys.create({
        tenantId: env.defaultTenantId,
        key: 'PASSWORDLESSKEY1',
        status: 'active',
        userId: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const login = await auth.wechatLogin({ code: 'code-passwordless' });
    if (!login.needBinding) throw new Error('binding ticket expected');
    await expect(
      auth.bindWechatPassword({
        bindingToken: login.bindingToken,
        phone: user.phone,
        password: 'Password@123',
      }),
    ).rejects.toThrow('手机号或密码错误');
    expect((await users.findOneByOrFail({ id: user.id })).wechatOpenid).toBeNull();
  });

  it('validates the binding ticket before inspecting a key', async () => {
    await expect(
      auth.bindWechatKey({
        bindingToken: 'x'.repeat(43),
        key: 'USEDKEY000000001',
      }),
    ).rejects.toThrow('微信绑定已失效');
  });

  it('does not allow an admin account to bind as a mini-program student', async () => {
    currentOpenid = 'wx-openid-admin';
    const admin = await users.save(
      users.create({
        tenantId: env.defaultTenantId,
        phone: '13800000005',
        nickname: 'admin-user',
        passwordHash: await bcrypt.hash('Password@123', 4),
        openid: null,
        registrationSource: 'register',
        role: 'admin',
      }),
    );
    const login = await auth.wechatLogin({ code: 'code-admin' });
    if (!login.needBinding) throw new Error('binding ticket expected');
    await expect(
      auth.bindWechatPassword({
        bindingToken: login.bindingToken,
        phone: admin.phone,
        password: 'Password@123',
      }),
    ).rejects.toThrow('微信小程序仅支持学员账号');
    expect((await users.findOneByOrFail({ id: admin.id })).wechatOpenid).toBeNull();

    await keys.save(
      keys.create({
        tenantId: env.defaultTenantId,
        key: 'ADMINKEY00000001',
        status: 'active',
        userId: admin.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    currentOpenid = 'wx-openid-admin-key';
    const keyLogin = await auth.wechatLogin({ code: 'code-admin-key' });
    if (!keyLogin.needBinding) throw new Error('binding ticket expected');
    await expect(
      auth.bindWechatKey({
        bindingToken: keyLogin.bindingToken,
        key: 'ADMINKEY00000001',
      }),
    ).rejects.toThrow('卡密关联账号无效');
    expect((await users.findOneByOrFail({ id: admin.id })).wechatOpenid).toBeNull();
  });
});

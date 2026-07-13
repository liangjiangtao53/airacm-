import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AccessKey, Tenant, User, Wallet, WechatBindSession } from '../entities';
import {
  AuthUser,
  CurrentUser,
  JwtAuthGuard,
  PASSWORD_COMPLEXITY_MESSAGE,
  PASSWORD_COMPLEXITY_RE,
  signToken,
} from '../common';
import { SessionService } from '../session';
import { env } from '../config';
import { SmsModule, SmsService } from './sms';
import { UserActivityModule, UserActivityService } from './user-activity';
import { AccessKeyModule, AccessKeyService } from './access-key';
import { WechatMiniProgramModule, WechatMiniProgramService } from './wechat-mini-program';

// 中国大陆手机号。
const PHONE_RE = /^1[3-9]\d{9}$/;

class SendCodeDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;
}

class RegisterDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Length(4, 6, { message: '验证码长度不正确' })
  code!: string; // 短信验证码

  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(64, { message: '密码过长' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  nickname?: string;
}

class LoginDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MaxLength(64)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(64)
  oldPassword!: string;

  @IsString()
  @MinLength(10, { message: '新密码至少 10 位' })
  @MaxLength(64, { message: '新密码过长' })
  @Matches(PASSWORD_COMPLEXITY_RE, { message: PASSWORD_COMPLEXITY_MESSAGE })
  newPassword!: string;
}

class WechatLoginDto {
  @IsString()
  @Length(1, 128)
  code!: string; // 小程序 wx.login code,换 openid
}

class WechatBindingDto {
  @IsString()
  @Length(32, 256)
  bindingToken!: string;
}

class WechatPasswordBindingDto extends WechatBindingDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MaxLength(64)
  password!: string;
}

class WechatKeyBindingDto extends WechatBindingDto {
  @IsString()
  @Length(1, 128)
  key!: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 30, { message: '昵称长度需为 2-30 位' })
  nickname?: string;
}

type WechatLoginResult =
  | { needBinding: false; token: string; userId: string }
  | { needBinding: true; bindingToken: string; expiresAt: Date };

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(WechatBindSession)
    private readonly bindSessions: Repository<WechatBindSession>,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly session: SessionService,
    private readonly activity: UserActivityService,
    private readonly dataSource: DataSource,
    private readonly accessKeys: AccessKeyService,
    private readonly wechat: WechatMiniProgramService,
  ) {}

  private nextBindingCleanupAt = 0;

  // 发送注册验证码:已注册手机号直接拒绝,避免无谓短信与撞库探测。
  async sendCode(phone: string): Promise<{ sent: true }> {
    const existing = await this.users.findOne({
      where: { tenantId: env.defaultTenantId, phone },
    });
    if (existing) throw new BadRequestException('该手机号已注册');
    await this.sms.sendCode(phone);
    return { sent: true };
  }

  private async ensureTenant(tenantId: string): Promise<void> {
    const exists = await this.tenants.findOne({ where: { id: tenantId } });
    if (!exists) {
      await this.tenants.save(this.tenants.create({ id: tenantId, name: '默认机构', status: 'active' }));
    }
  }

  async register(dto: RegisterDto): Promise<{ token: string; userId: string }> {
    if (!this.sms.verify(dto.phone, dto.code)) {
      throw new BadRequestException('验证码错误或已过期');
    }
    const tenantId = env.defaultTenantId;
    await this.ensureTenant(tenantId);

    const existing = await this.users.findOne({ where: { tenantId, phone: dto.phone } });
    if (existing) {
      throw new BadRequestException('该手机号已注册');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.save(
      this.users.create({
        tenantId,
        phone: dto.phone,
        nickname: dto.nickname ?? `用户${dto.phone.slice(-4)}`,
        passwordHash,
        openid: null,
        registrationSource: 'register',
      }),
    );
    // 注册即开钱包(每用户一个,唯一约束 (tenantId,userId))。
    await this.wallets.save(this.wallets.create({ tenantId, userId: user.id, balance: 0 }));

    await this.activity.recordPasswordLogin(user);
    return { token: await this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    const user = await this.users.findOne({ where: { tenantId, phone: dto.phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('手机号或密码错误');
    }
    await this.activity.recordPasswordLogin(user);
    return { token: await this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  async changePassword(
    user: AuthUser,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const u = await this.users.findOne({ where: { tenantId: user.tenantId, id: user.userId } });
    if (!u || !u.passwordHash || !(await bcrypt.compare(oldPassword, u.passwordHash))) {
      throw new BadRequestException('原密码错误');
    }
    if (await bcrypt.compare(newPassword, u.passwordHash)) {
      throw new BadRequestException('新密码不能与原密码相同');
    }
    await this.users.update(u.id, { passwordHash: await bcrypt.hash(newPassword, 10) });
    return { ok: true };
  }

  // 微信登录只识别已绑定账号；未绑定时签发一次性票据，不再自动创建空账号。
  async wechatLogin(dto: WechatLoginDto): Promise<WechatLoginResult> {
    const tenantId = env.defaultTenantId;
    await this.ensureTenant(tenantId);
    const { openid } = await this.wechat.exchangeCode(dto.code);
    const user = await this.users.findOne({ where: { tenantId, wechatOpenid: openid } });
    if (user) {
      const expiresAt =
        user.registrationSource === 'key'
          ? await this.accessKeys.activeKeyExpiry(tenantId, user.id)
          : undefined;
      await this.activity.recordWechatLogin(user);
      return {
        needBinding: false,
        token: await this.issue(
          { userId: user.id, tenantId: user.tenantId, role: user.role },
          expiresAt,
        ),
        userId: user.id,
      };
    }
    return this.createBindingSession(tenantId, openid);
  }

  async bindWechatPassword(
    dto: WechatPasswordBindingDto,
  ): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    const tokenHash = this.hashBindingToken(dto.bindingToken);
    try {
      await this.claimBindingAttempt(tokenHash);
      const result = await this.dataSource.transaction(async (manager) => {
        let sessionQuery = manager
          .createQueryBuilder(WechatBindSession, 's')
          .where('s.tenantId = :tenantId', { tenantId })
          .andWhere('s.tokenHash = :tokenHash', { tokenHash });
        if (this.dataSource.options.type !== 'better-sqlite3') {
          sessionQuery = sessionQuery.setLock('pessimistic_write');
        }
        const binding = await sessionQuery.getOne();
        this.assertBindingSession(binding);

        let userQuery = manager
          .createQueryBuilder(User, 'u')
          .where('u.tenantId = :tenantId', { tenantId })
          .andWhere('u.phone = :phone', { phone: dto.phone });
        if (this.dataSource.options.type !== 'better-sqlite3') {
          userQuery = userQuery.setLock('pessimistic_write');
        }
        const existing = await userQuery.getOne();
        if (
          !existing ||
          !existing.passwordHash ||
          !(await bcrypt.compare(dto.password, existing.passwordHash))
        ) {
          throw new UnauthorizedException('手机号或密码错误');
        }
        if (existing.wechatOpenid && existing.wechatOpenid !== binding!.wechatOpenid) {
          throw new BadRequestException('该账号已绑定其他微信，请联系管理员');
        }
        let expiresAt: Date | undefined;
        if (existing.registrationSource === 'key') {
          const key = await manager
            .createQueryBuilder(AccessKey, 'k')
            .where('k.tenantId = :tenantId', { tenantId })
            .andWhere('k.userId = :userId', { userId: existing.id })
            .andWhere('k.status = :status', { status: 'active' })
            .andWhere('k.expiresAt > :now', { now: new Date() })
            .orderBy('k.expiresAt', 'DESC')
            .getOne();
          if (!key) throw new UnauthorizedException('卡密已过期或作废');
          expiresAt = key.expiresAt;
        }
        const sid = crypto.randomUUID();
        const user = { ...existing, wechatOpenid: binding!.wechatOpenid, sessionId: sid };
        const token = this.signWithSession(
          { userId: user.id, tenantId: user.tenantId, role: user.role },
          sid,
          expiresAt,
        );
        await manager.update(User, existing.id, {
          wechatOpenid: binding!.wechatOpenid,
          sessionId: sid,
        });
        await manager.update(WechatBindSession, binding!.id, { consumedAt: new Date() });
        return { user, token };
      });
      await this.activity.recordWechatLogin(result.user);
      return {
        token: result.token,
        userId: result.user.id,
      };
    } catch (error) {
      this.rethrowBindingError(error);
    }
  }

  async bindWechatKey(
    dto: WechatKeyBindingDto,
  ): Promise<
    | { needProfile: true }
    | { needProfile: false; token: string; userId: string; expiresAt: Date }
  > {
    const tenantId = env.defaultTenantId;
    const tokenHash = this.hashBindingToken(dto.bindingToken);
    try {
      await this.claimBindingAttempt(tokenHash);
      const needsProfile = await this.accessKeys.keyNeedsProfile(tenantId, dto.key);
      if (needsProfile && (!dto.phone || !dto.nickname)) return { needProfile: true };
      const result = await this.accessKeys.bindWechatByKey(
        tenantId,
        tokenHash,
        dto.key,
        needsProfile ? { phone: dto.phone!, nickname: dto.nickname! } : undefined,
      );
      await this.activity.recordWechatLogin(result.user);
      return {
        needProfile: false,
        token: result.token,
        userId: result.user.id,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      this.rethrowBindingError(error);
    }
  }

  private async createBindingSession(
    tenantId: string,
    wechatOpenid: string,
  ): Promise<{ needBinding: true; bindingToken: string; expiresAt: Date }> {
    await this.cleanupBindingSessions();
    const bindingToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await this.bindSessions.save(
      this.bindSessions.create({
        tenantId,
        tokenHash: this.hashBindingToken(bindingToken),
        wechatOpenid,
        expiresAt,
        consumedAt: null,
        failedAttempts: 0,
      }),
    );
    return { needBinding: true, bindingToken, expiresAt };
  }

  private async cleanupBindingSessions(): Promise<void> {
    const now = Date.now();
    if (now < this.nextBindingCleanupAt) return;
    this.nextBindingCleanupAt = now + 60_000;
    const stale = await this.bindSessions
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .where('s.expiresAt < :now OR s.consumedAt IS NOT NULL', { now: new Date(now) })
      .orderBy('s.expiresAt', 'ASC')
      .limit(100)
      .getRawMany<{ id: string }>();
    if (stale.length) await this.bindSessions.delete({ id: In(stale.map((row) => row.id)) });
  }

  private hashBindingToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private assertBindingSession(session: WechatBindSession | null): void {
    if (
      !session ||
      session.consumedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.failedAttempts > 5
    ) {
      throw new UnauthorizedException('微信绑定已失效，请重新登录');
    }
  }

  private rethrowBindingError(error: unknown): never {
    if (error instanceof QueryFailedError) {
      throw new BadRequestException('微信或账号已被绑定，请联系管理员');
    }
    throw error;
  }

  private async claimBindingAttempt(tokenHash: string): Promise<void> {
    const column =
      this.dataSource.options.type === 'mysql' || this.dataSource.options.type === 'mariadb'
        ? '`failedAttempts`'
        : '"failedAttempts"';
    const result = await this.bindSessions
      .createQueryBuilder()
      .update(WechatBindSession)
      .set({ failedAttempts: () => `${column} + 1` })
      .where('tokenHash = :tokenHash', { tokenHash })
      .andWhere('tenantId = :tenantId', { tenantId: env.defaultTenantId })
      .andWhere('consumedAt IS NULL')
      .andWhere('expiresAt > :now', { now: new Date() })
      .andWhere(`${column} < 5`)
      .execute();
    if ((result.affected ?? 0) !== 1) {
      throw new UnauthorizedException('微信绑定已失效，请重新登录');
    }
  }

  // 签发登录 token:同时刷新单点会话(sid),旧端 token 立即失效。
  private async issue(user: AuthUser, expiresAt?: Date): Promise<string> {
    const sid = await this.session.issue(user.userId);
    return this.signWithSession(user, sid, expiresAt);
  }

  private signWithSession(user: AuthUser, sid: string, expiresAt?: Date): string {
    if (expiresAt) {
      const expiresIn = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
      if (expiresIn <= 0) throw new UnauthorizedException('卡密已过期或作废');
      return this.jwt.sign(
        { sub: user.userId, tenantId: user.tenantId, role: user.role, sid },
        { secret: env.jwtSecret, expiresIn },
      );
    }
    return signToken(this.jwt, user, sid);
  }

  // 当前用户身份 + 昵称(首页/导航展示用)。昵称随用户表,token 里不冗余存。
  async profile(user: AuthUser): Promise<AuthUser & { nickname: string }> {
    const u = await this.users.findOne({ where: { tenantId: user.tenantId, id: user.userId } });
    return { ...user, nickname: u?.nickname ?? '' };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  // 发送注册短信验证码。保留更严限流防短信轰炸。
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('send-code')
  sendCode(@Body() dto: SendCodeDto) {
    return this.svc.sendCode(dto.phone);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.svc.register(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.svc.changePassword(user, dto.oldPassword, dto.newPassword);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('wechat/login')
  wechat(@Body() dto: WechatLoginDto) {
    return this.svc.wechatLogin(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('wechat/bind/password')
  bindWechatPassword(@Body() dto: WechatPasswordBindingDto) {
    return this.svc.bindWechatPassword(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('wechat/bind/key')
  bindWechatKey(@Body() dto: WechatKeyBindingDto) {
    return this.svc.bindWechatKey(dto);
  }

  // 当前登录用户身份 + 昵称(前端鉴权/角色判断/导航展示用)。
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.profile(user);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wallet, Tenant, WechatBindSession]),
    JwtModule.register({ secret: env.jwtSecret }),
    SmsModule,
    UserActivityModule,
    AccessKeyModule,
    WechatMiniProgramModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

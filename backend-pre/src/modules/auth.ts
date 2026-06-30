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
import { Repository } from 'typeorm';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { Tenant, User, Wallet } from '../entities';
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
  code!: string; // 小程序 wx.login code,换 openid
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly session: SessionService,
  ) {}

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
      }),
    );
    // 注册即开钱包(每用户一个,唯一约束 (tenantId,userId))。
    await this.wallets.save(this.wallets.create({ tenantId, userId: user.id, balance: 0 }));

    return { token: await this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    const user = await this.users.findOne({ where: { tenantId, phone: dto.phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('手机号或密码错误');
    }
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

  // 微信登录:code 换 openid。dev 桩用 code 直接当 openid;生产调微信 jscode2session。
  async wechatLogin(dto: WechatLoginDto): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    await this.ensureTenant(tenantId);
    const openid = `dev-openid-${dto.code}`;
    let user = await this.users.findOne({ where: { tenantId, openid } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          tenantId,
          phone: '',
          nickname: '微信用户',
          openid,
          passwordHash: '',
        }),
      );
      await this.wallets.save(this.wallets.create({ tenantId, userId: user.id, balance: 0 }));
    }
    return { token: await this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  // 签发登录 token:同时刷新单点会话(sid),旧端 token 立即失效。
  private async issue(user: AuthUser): Promise<string> {
    const sid = await this.session.issue(user.userId);
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
  @Post('wechat')
  wechat(@Body() dto: WechatLoginDto) {
    return this.svc.wechatLogin(dto);
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
    TypeOrmModule.forFeature([User, Wallet, Tenant]),
    JwtModule.register({ secret: env.jwtSecret }),
    SmsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
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
import { AuthUser, signToken } from '../common';
import { env } from '../config';

// 中国大陆手机号。
const PHONE_RE = /^1[3-9]\d{9}$/;

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
  ) {}

  // 第一版短信验证:dev 万能码;生产接服务商。
  private verifySmsCode(code: string): boolean {
    if (env.sms.devMode) return code === env.sms.devCode;
    return false; // 生产模式未接服务商前一律拒绝,避免假放行
  }

  private async ensureTenant(tenantId: string): Promise<void> {
    const exists = await this.tenants.findOne({ where: { id: tenantId } });
    if (!exists) {
      await this.tenants.save(this.tenants.create({ id: tenantId, name: '默认机构', status: 'active' }));
    }
  }

  async register(dto: RegisterDto): Promise<{ token: string; userId: string }> {
    if (!this.verifySmsCode(dto.code)) {
      throw new BadRequestException('验证码错误');
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

    return { token: this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    const user = await this.users.findOne({ where: { tenantId, phone: dto.phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('手机号或密码错误');
    }
    return { token: this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
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
    return { token: this.issue({ userId: user.id, tenantId, role: user.role }), userId: user.id };
  }

  private issue(user: AuthUser): string {
    return signToken(this.jwt, user);
  }
}

// 认证端点更严限流:防撞库/爆破,60s 内 10 次。
@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.svc.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @Post('wechat')
  wechat(@Body() dto: WechatLoginDto) {
    return this.svc.wechatLogin(dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wallet, Tenant]),
    JwtModule.register({ secret: env.jwtSecret }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

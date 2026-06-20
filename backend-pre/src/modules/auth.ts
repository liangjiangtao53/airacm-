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
import { IsOptional, IsString, Length, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { Tenant, User, Wallet } from '../entities';
import { AuthUser, signToken } from '../common';
import { env } from '../config';

class RegisterDto {
  @IsString()
  @Length(11, 11, { message: '手机号必须为 11 位' })
  phone!: string;

  @IsString()
  code!: string; // 短信验证码

  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  password!: string;

  @IsOptional()
  @IsString()
  nickname?: string;
}

class LoginDto {
  @IsString()
  phone!: string;

  @IsString()
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

    return { token: this.issue({ userId: user.id, tenantId }), userId: user.id };
  }

  async login(dto: LoginDto): Promise<{ token: string; userId: string }> {
    const tenantId = env.defaultTenantId;
    const user = await this.users.findOne({ where: { tenantId, phone: dto.phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('手机号或密码错误');
    }
    return { token: this.issue({ userId: user.id, tenantId }), userId: user.id };
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
    return { token: this.issue({ userId: user.id, tenantId }), userId: user.id };
  }

  private issue(user: AuthUser): string {
    return signToken(this.jwt, user);
  }
}

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

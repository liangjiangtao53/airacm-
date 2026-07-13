import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource, LessThan, Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { AccessKey, AdminOperationLog, User, Wallet, WechatBindSession } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard, JwtPayload } from '../common';
import { SessionService } from '../session';
import { env } from '../config';
import { UserActivityModule, UserActivityService } from './user-activity';

// 中国大陆手机号(与 auth 模块一致)。
const PHONE_RE = /^1[3-9]\d{9}$/;

class GenKeysDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  count?: number;

  // 有效期(天),不传用配置默认。
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  ttlDays?: number;
}

class UpdateKeyDto {
  // 从现在开始重新计算有效期天数。只改有效期，不改卡密本身，避免已发出的登录码失效。
  @IsInt()
  @Min(1)
  @Max(3650)
  ttlDays!: number;
}

class ListKeysQuery {
  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: 'active' | 'revoked' | 'expired';
}

class KeyLoginDto {
  @IsString()
  key!: string;
}

// 卡密用户首次登录补全资料:手机号 + 昵称(昵称全局唯一)。
class CompleteProfileDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @Length(2, 30, { message: '昵称长度需为 2-30 位' })
  nickname!: string;
}

const DAY_MS = 86_400_000;

@Injectable()
export class AccessKeyService {
  constructor(
    @InjectRepository(AccessKey) private readonly keys: Repository<AccessKey>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AdminOperationLog) private readonly operationLogs: Repository<AdminOperationLog>,
    private readonly jwt: JwtService,
    private readonly session: SessionService,
    private readonly dataSource: DataSource,
    private readonly activity: UserActivityService,
  ) {}

  private async logAdminOperation(
    admin: AuthUser,
    action: string,
    targetType: string,
    targetId: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.operationLogs.save(
      this.operationLogs.create({
        tenantId: admin.tenantId,
        adminId: admin.userId,
        action,
        targetType,
        targetId,
        detail,
      }),
    );
  }

  // 批量生成卡密。count/ttlDays 不传则用配置(默认 20 个 / 30 天)。
  async generate(
    tenantId: string,
    count?: number,
    ttlDays?: number,
    admin?: AuthUser,
  ): Promise<{ keys: string[]; expiresAt: Date }> {
    const n = count ?? env.accessKey.batch;
    const days = ttlDays ?? env.accessKey.ttlDays;
    const expiresAt = new Date(Date.now() + days * DAY_MS);

    const rows: AccessKey[] = [];
    const strings: string[] = [];
    for (let i = 0; i < n; i++) {
      const code = this.randomKey();
      strings.push(code);
      rows.push(this.keys.create({ tenantId, key: code, expiresAt, status: 'active' }));
    }
    await this.keys.save(rows);
    if (admin) {
      await this.logAdminOperation(admin, 'access_key_generate', 'access_key', null, {
        count: rows.length,
        ttlDays: days,
        expiresAt,
      });
    }
    return { keys: strings, expiresAt };
  }

  // 卡密登录。token 有效期 = 卡密剩余有效期。
  // 已补全资料(k.userId 存在)→ 正式登录,身份 = 关联 user.id,刷新单点会话;
  // 未补全 → 签发"待补全"token(pending),前端强制弹窗采集手机号/昵称后调 complete-profile。
  async keyLogin(
    tenantId: string,
    key: string,
  ): Promise<{ token: string; userId: string; expiresAt: Date; needProfile: boolean }> {
    const k = await this.keys.findOne({ where: { tenantId, key: key.trim() } });
    if (!k || k.status !== 'active') throw new UnauthorizedException('卡密无效');
    const expiresInSec = this.remainingSec(k.expiresAt);

    if (k.userId) {
      await this.activity.recordAccessKeyLogin(tenantId, k, k.userId, false);
      const sid = await this.session.issue(k.userId);
      const token = this.signUserToken(k.userId, tenantId, sid, expiresInSec);
      return { token, userId: k.userId, expiresAt: k.expiresAt, needProfile: false };
    }

    await this.activity.recordAccessKeyLogin(tenantId, k, null, true);
    const pending: JwtPayload = { sub: k.id, tenantId, role: 'user', pending: true };
    const token = this.jwt.sign(pending, { secret: env.jwtSecret, expiresIn: expiresInSec });
    return { token, userId: k.id, expiresAt: k.expiresAt, needProfile: true };
  }

  async activeKeyExpiry(tenantId: string, userId: string): Promise<Date> {
    const key = await this.keys
      .createQueryBuilder('k')
      .where('k.tenantId = :tenantId', { tenantId })
      .andWhere('k.userId = :userId', { userId })
      .andWhere('k.status = :status', { status: 'active' })
      .andWhere('k.expiresAt > :now', { now: new Date() })
      .orderBy('k.expiresAt', 'DESC')
      .getOne();
    if (!key) throw new UnauthorizedException('卡密已过期或作废');
    return key.expiresAt;
  }

  async keyNeedsProfile(tenantId: string, key: string): Promise<boolean> {
    const row = await this.keys.findOne({ where: { tenantId, key: key.trim() } });
    if (!row || row.status !== 'active') throw new UnauthorizedException('卡密无效');
    this.remainingSec(row.expiresAt);
    return !row.userId;
  }

  // 微信首次绑定复用卡密归属。原来卡密补全与微信身份无关；现在两者在同一事务中落库。
  async bindWechatByKey(
    tenantId: string,
    bindingTokenHash: string,
    key: string,
    profile?: { phone: string; nickname: string },
  ): Promise<{ user: User; expiresAt: Date; token: string }> {
    return this.dataSource.transaction(async (manager) => {
      let sessionQuery = manager
        .createQueryBuilder(WechatBindSession, 's')
        .where('s.tenantId = :tenantId', { tenantId })
        .andWhere('s.tokenHash = :bindingTokenHash', { bindingTokenHash });
      if (this.dataSource.options.type !== 'better-sqlite3') {
        sessionQuery = sessionQuery.setLock('pessimistic_write');
      }
      const bindSession = await sessionQuery.getOne();
      this.assertBindingSession(bindSession);

      let keyQuery = manager
        .createQueryBuilder(AccessKey, 'k')
        .where('k.tenantId = :tenantId', { tenantId })
        .andWhere('k.key = :key', { key: key.trim() });
      if (this.dataSource.options.type !== 'better-sqlite3') {
        keyQuery = keyQuery.setLock('pessimistic_write');
      }
      const accessKey = await keyQuery.getOne();
      if (!accessKey || accessKey.status !== 'active') {
        throw new UnauthorizedException('卡密无效');
      }
      const expiresInSec = this.remainingSec(accessKey.expiresAt);
      const sid = crypto.randomUUID();

      let user: User;
      if (accessKey.userId) {
        let userQuery = manager
          .createQueryBuilder(User, 'u')
          .where('u.tenantId = :tenantId', { tenantId })
          .andWhere('u.id = :userId', { userId: accessKey.userId });
        if (this.dataSource.options.type !== 'better-sqlite3') {
          userQuery = userQuery.setLock('pessimistic_write');
        }
        const existing = await userQuery.getOne();
        if (!existing) throw new UnauthorizedException('卡密关联账号不存在');
        if (existing.wechatOpenid && existing.wechatOpenid !== bindSession!.wechatOpenid) {
          throw new BadRequestException('该账号已绑定其他微信，请联系管理员');
        }
        await manager.update(User, existing.id, {
          wechatOpenid: bindSession!.wechatOpenid,
          sessionId: sid,
        });
        user = { ...existing, wechatOpenid: bindSession!.wechatOpenid, sessionId: sid };
      } else {
        if (!profile) throw new BadRequestException('请先补全手机号和昵称');
        const nickname = profile.nickname.trim();
        if (await manager.findOne(User, { where: { tenantId, nickname } })) {
          throw new BadRequestException('昵称已被使用，请换一个');
        }
        if (await manager.findOne(User, { where: { tenantId, phone: profile.phone } })) {
          throw new BadRequestException('该手机号已被占用');
        }
        user = await manager.save(
          manager.create(User, {
            tenantId,
            phone: profile.phone,
            nickname,
            role: 'user',
            passwordHash: '',
            openid: `key:${accessKey.id}`,
            wechatOpenid: bindSession!.wechatOpenid,
            registrationSource: 'key',
            sessionId: sid,
            firstLoginAt: new Date(),
            lastLoginAt: new Date(),
          }),
        );
        await manager.save(manager.create(Wallet, { tenantId, userId: user.id, balance: 0 }));
        await manager.update(AccessKey, accessKey.id, { userId: user.id });
      }
      const token = this.signUserToken(user.id, tenantId, sid, expiresInSec);
      await manager.update(WechatBindSession, bindSession!.id, { consumedAt: new Date() });
      return { user, expiresAt: accessKey.expiresAt, token };
    });
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

  // 卡密用户补全资料:建正式 User 行(无密码,role=user)+ 钱包,卡密回写 userId。
  // 昵称全局唯一;手机号不可与既有用户冲突。幂等:重复提交已补全卡密直接放行登录。
  async completeProfile(
    tenantId: string,
    keyId: string,
    phone: string,
    nickname: string,
  ): Promise<{ token: string; userId: string }> {
    const k = await this.keys.findOne({ where: { tenantId, id: keyId } });
    if (!k || k.status !== 'active') throw new UnauthorizedException('卡密无效');
    const expiresInSec = this.remainingSec(k.expiresAt);

    if (k.userId) {
      const sid = await this.session.issue(k.userId);
      return { token: this.signUserToken(k.userId, tenantId, sid, expiresInSec), userId: k.userId };
    }

    const nick = nickname.trim();
    if (await this.users.findOne({ where: { tenantId, nickname: nick } })) {
      throw new BadRequestException('昵称已被使用,请换一个');
    }
    if (await this.users.findOne({ where: { tenantId, phone } })) {
      throw new BadRequestException('该手机号已被占用');
    }

    const sid = crypto.randomUUID();
    const userId = await this.dataSource.transaction(async (m) => {
      const u = await m.save(
        m.create(User, {
          tenantId,
          phone,
          nickname: nick,
          role: 'user',
          passwordHash: '',
          openid: `key:${k.id}`, // 标记来源=卡密,用户列表据此区分
          registrationSource: 'key',
          sessionId: sid,
          firstLoginAt: k.firstLoginAt ?? new Date(),
          lastLoginAt: k.lastLoginAt ?? new Date(),
        }),
      );
      await m.save(m.create(Wallet, { tenantId, userId: u.id, balance: 0 }));
      await m.update(AccessKey, k.id, { userId: u.id });
      return u.id;
    });
    return { token: this.signUserToken(userId, tenantId, sid, expiresInSec), userId };
  }

  private remainingSec(expiresAt: Date): number {
    const ms = expiresAt.getTime() - Date.now();
    if (ms <= 0) throw new UnauthorizedException('卡密已过期');
    return Math.floor(ms / 1000);
  }

  private signUserToken(userId: string, tenantId: string, sid: string, expiresInSec: number): string {
    const payload: JwtPayload = { sub: userId, tenantId, role: 'user', sid };
    return this.jwt.sign(payload, { secret: env.jwtSecret, expiresIn: expiresInSec });
  }

  // 数据维护:卡密列表改为服务端分页,避免卡密量增长后后台一次拉取过多数据。
  async list(
    tenantId: string,
    q: ListKeysQuery = {},
  ): Promise<{ items: AccessKey[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 50));
    const qb = this.keys.createQueryBuilder('k').where('k.tenantId = :tenantId', { tenantId });
    if (q.keyword?.trim()) {
      qb.andWhere('k.key LIKE :keyword', { keyword: `%${q.keyword.trim()}%` });
    }
    const now = new Date();
    if (q.status === 'active') {
      qb.andWhere('k.status = :status', { status: 'active' }).andWhere('k.expiresAt >= :now', { now });
    } else if (q.status === 'revoked') {
      qb.andWhere('k.status = :status', { status: 'revoked' });
    } else if (q.status === 'expired') {
      qb.andWhere('k.expiresAt < :now', { now });
    }
    const [items, total] = await qb.orderBy('k.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items, total, page, pageSize };
  }

  // 作废一张卡密(立即失效,不可再登录)。
  async revoke(tenantId: string, id: string, admin?: AuthUser): Promise<{ ok: boolean }> {
    const k = await this.keys.findOne({ where: { tenantId, id } });
    if (!k) throw new NotFoundException('卡密不存在');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AccessKey, k.id, { status: 'revoked' });
      if (k.userId) {
        await manager.update(User, { tenantId, id: k.userId }, { sessionId: crypto.randomUUID() });
      }
    });
    if (admin) {
      await this.logAdminOperation(admin, 'access_key_revoke', 'access_key', id, {
        key: k.key.length <= 4 ? '****' : `****${k.key.slice(-4)}`,
        userId: k.userId,
      });
    }
    return { ok: true };
  }

  async deleteOne(tenantId: string, id: string, admin?: AuthUser): Promise<{ deleted: number }> {
    const k = await this.keys.findOne({ where: { tenantId, id } });
    if (!k) throw new NotFoundException('卡密不存在');
    if (k.status === 'active' && k.expiresAt.getTime() >= Date.now()) {
      throw new BadRequestException('有效卡密需要先作废或过期后才能删除');
    }
    await this.keys.delete(k.id);
    if (admin) {
      await this.logAdminOperation(admin, 'access_key_delete', 'access_key', id, {
        key: k.key.length <= 4 ? '****' : `****${k.key.slice(-4)}`,
        userId: k.userId,
        status: k.status,
        expiresAt: k.expiresAt,
      });
    }
    return { deleted: 1 };
  }

  async updateExpiresAt(tenantId: string, id: string, ttlDays: number, admin?: AuthUser): Promise<AccessKey> {
    const k = await this.keys.findOne({ where: { tenantId, id } });
    if (!k) throw new NotFoundException('卡密不存在');
    if (k.status === 'revoked') throw new BadRequestException('已作废卡密不能修改有效期');
    const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AccessKey, k.id, { expiresAt });
      if (k.userId) {
        await manager.update(User, { tenantId, id: k.userId }, { sessionId: crypto.randomUUID() });
      }
    });
    if (admin) {
      await this.logAdminOperation(admin, 'access_key_update_ttl', 'access_key', id, {
        key: k.key.length <= 4 ? '****' : `****${k.key.slice(-4)}`,
        ttlDays,
        expiresAt,
      });
    }
    return { ...k, expiresAt };
  }

  // 清理:删除已过期 + 已作废的卡密("删除用过/失效的")。
  async cleanup(tenantId: string, admin?: AuthUser): Promise<{ deleted: number }> {
    const r1 = await this.keys.delete({ tenantId, expiresAt: LessThan(new Date()) });
    const r2 = await this.keys.delete({ tenantId, status: 'revoked' });
    const deleted = (r1.affected ?? 0) + (r2.affected ?? 0);
    if (admin && deleted > 0) {
      await this.logAdminOperation(admin, 'access_key_cleanup', 'access_key', null, {
        expired: r1.affected ?? 0,
        revoked: r2.affected ?? 0,
        deleted,
      });
    }
    return { deleted };
  }

  private randomKey(): string {
    // 16 位大写十六进制,足够随机防枚举。
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }
}

// 卡密管理:仅超级管理员。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super')
@Controller('admin/access-keys')
export class AccessKeyAdminController {
  constructor(private readonly svc: AccessKeyService) {}

  @Post()
  generate(@CurrentUser() admin: AuthUser, @Body() dto: GenKeysDto) {
    return this.svc.generate(admin.tenantId, dto.count, dto.ttlDays, admin);
  }

  @Get()
  list(@CurrentUser() admin: AuthUser, @Query() q: ListKeysQuery) {
    return this.svc.list(admin.tenantId, q);
  }

  // 清理过期/作废卡密。静态路由置于 :id 之前。
  @Delete('cleanup')
  cleanup(@CurrentUser() admin: AuthUser) {
    return this.svc.cleanup(admin.tenantId, admin);
  }

  @Post(':id/revoke')
  revoke(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.svc.revoke(admin.tenantId, id, admin);
  }

  @Delete(':id')
  deleteOne(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.svc.deleteOne(admin.tenantId, id, admin);
  }

  @Post(':id')
  update(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: UpdateKeyDto) {
    return this.svc.updateExpiresAt(admin.tenantId, id, dto.ttlDays, admin);
  }
}

// 待补全资料守卫:只接受 keyLogin 签发的 pending token(不查单点会话,因 user 尚未创建)。
// 普通 JwtAuthGuard 会因 pending=true 拒绝,故补全接口专用此守卫。
@Injectable()
export class PendingAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('缺少登录凭证');
    try {
      const p = this.jwt.verify<JwtPayload>(header.slice('Bearer '.length).trim(), {
        secret: env.jwtSecret,
      });
      if (!p.pending) throw new UnauthorizedException('无效的补全凭证');
      req.user = { userId: p.sub, tenantId: p.tenantId, role: 'user' } satisfies AuthUser;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('登录已失效,请重新登录');
    }
  }
}

// 卡密登录 + 资料补全(无需正式登录态)。限流防枚举。
@Throttle({ default: { ttl: 60_000, limit: 10 } })
@Controller('auth')
export class KeyLoginController {
  constructor(private readonly svc: AccessKeyService) {}

  @Post('key-login')
  keyLogin(@Body() dto: KeyLoginDto) {
    return this.svc.keyLogin(env.defaultTenantId, dto.key);
  }

  // 补全资料:pending token 鉴权,req.user.userId = 卡密 id。
  @UseGuards(PendingAuthGuard)
  @Post('complete-profile')
  completeProfile(@CurrentUser() pending: AuthUser, @Body() dto: CompleteProfileDto) {
    return this.svc.completeProfile(pending.tenantId, pending.userId, dto.phone, dto.nickname);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessKey, Wallet, User, AdminOperationLog, WechatBindSession]),
    UserActivityModule,
  ],
  controllers: [AccessKeyAdminController, KeyLoginController],
  providers: [AccessKeyService, PendingAuthGuard],
  exports: [AccessKeyService],
})
export class AccessKeyModule {}

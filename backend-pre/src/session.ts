import { Global, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { User } from './entities';

// JWT 守卫调用 validate 时传入的最小载荷(避免 import common 造成循环依赖)。
interface SessionClaims {
  sub: string;
  role: string;
  sid?: string;
  pending?: boolean;
}

// 单点登录核心:user.sessionId 记录"当前唯一有效会话"。登录刷新它,守卫每请求比对。
// 仅 role=user(学员/卡密用户)强制单点;管理员(admin/super)不限,跳过查库,零开销。
@Injectable()
export class SessionService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  // 签发新会话:生成 sid 写入 user.sessionId,旧 token 的 sid 随即失效(被踢)。
  async issue(userId: string): Promise<string> {
    const sid = crypto.randomUUID();
    await this.users.update(userId, { sessionId: sid });
    return sid;
  }

  // 每请求校验。管理员放行;待补全 token 一律拒绝业务接口(补全接口走 PendingGuard 绕过)。
  async validate(claims: SessionClaims): Promise<void> {
    if (claims.role !== 'user') return;
    if (claims.pending) throw new UnauthorizedException('请先完善账号资料');
    const u = await this.users.findOne({
      where: { id: claims.sub },
      select: ['id', 'sessionId'],
    });
    if (!u || !claims.sid || u.sessionId !== claims.sid) {
      throw new UnauthorizedException('账号已在其他设备登录');
    }
  }
}

// @Global:JwtAuthGuard(common.ts)可在任意模块注入 SessionService,无需各模块自备 User 仓库。
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}

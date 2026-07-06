import { Injectable, Logger, Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Brackets, In, Like, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AccessKey, User, UserActivityAction, UserActivityLog } from '../entities';
import { AuthUser } from '../common';

export interface UserActivityQuery {
  action?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface UserActivityLogItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
  user: { id: string; phone: string; nickname: string; role: string } | null;
  accessKey: { id: string; key: string; status: string } | null;
}

@Injectable()
export class UserActivityService {
  private readonly logger = new Logger(UserActivityService.name);

  constructor(
    @InjectRepository(UserActivityLog) private readonly logs: Repository<UserActivityLog>,
    @InjectRepository(AccessKey) private readonly keys: Repository<AccessKey>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async recordPasswordLogin(user: User): Promise<void> {
    await this.runBestEffort('login_password', async () => {
      const now = new Date();
      await this.users.update(user.id, {
        firstLoginAt: user.firstLoginAt ?? now,
        lastLoginAt: now,
      });
      await this.logs.save(
        this.logs.create({
          tenantId: user.tenantId,
          userId: user.id,
          accessKeyId: null,
          accessKeyLast4: null,
          action: 'login_password',
          targetType: 'user',
          targetId: user.id,
          detail: { phone: user.phone, nickname: user.nickname },
        }),
      );
    });
  }

  async recordAccessKeyLogin(tenantId: string, key: AccessKey, userId: string | null, needProfile: boolean): Promise<void> {
    await this.runBestEffort('login_access_key', async () => {
      const now = new Date();
      await this.keys.update(key.id, {
        firstLoginAt: key.firstLoginAt ?? now,
        lastLoginAt: now,
      });
      if (userId) {
        const user = await this.users.findOne({ where: { tenantId, id: userId } });
        if (user) {
          await this.users.update(user.id, {
            firstLoginAt: user.firstLoginAt ?? now,
            lastLoginAt: now,
          });
        }
      }
      await this.logs.save(
        this.logs.create({
          tenantId,
          userId,
          accessKeyId: key.id,
          accessKeyLast4: this.last4(key.key),
          accessKeyMasked: this.maskKey(key.key),
          accessKeyHash: this.hashKey(key.key),
          action: 'login_access_key',
          targetType: 'access_key',
          targetId: key.id,
          detail: { key: this.maskKey(key.key), needProfile },
        }),
      );
    });
  }

  async record(user: AuthUser, action: UserActivityAction, targetType: string, targetId: string | null, detail: Record<string, unknown>): Promise<void> {
    await this.runBestEffort(action, async () => {
      const key = await this.keys.findOne({ where: { tenantId: user.tenantId, userId: user.userId } });
      await this.logs.save(
        this.logs.create({
          tenantId: user.tenantId,
          userId: user.userId,
          accessKeyId: key?.id ?? null,
          accessKeyLast4: key ? this.last4(key.key) : null,
          accessKeyMasked: key ? this.maskKey(key.key) : null,
          accessKeyHash: key ? this.hashKey(key.key) : null,
          action,
          targetType,
          targetId,
          detail: key ? { ...detail, key: this.maskKey(key.key) } : detail,
        }),
      );
    });
  }

  async list(tenantId: string, q: UserActivityQuery): Promise<{ items: UserActivityLogItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 50));
    const qb = this.logs.createQueryBuilder('l').where('l.tenantId = :tenantId', { tenantId });
    if (q.action?.trim()) {
      qb.andWhere('l.action = :action', { action: q.action.trim() });
    }

    const keyword = q.keyword?.trim();
    if (keyword) {
      const like = `%${keyword}%`;
      const keyHash = this.hashKey(keyword);
      const [matchedKeys, matchedUsers] = await Promise.all([
        this.keys.find({ where: { tenantId, key: Like(like) }, select: ['id'], take: 200 }),
        this.users.find({
          where: [
            { tenantId, phone: Like(like) },
            { tenantId, nickname: Like(like) },
          ],
          select: ['id'],
          take: 200,
        }),
      ]);
      const keyIds = matchedKeys.map((key) => key.id);
      const userIds = matchedUsers.map((user) => user.id);
      qb.andWhere(
        new Brackets((where) => {
          where.orWhere('l.accessKeyHash = :keyHash', { keyHash });
          if (keyIds.length > 0) where.orWhere('l.accessKeyId IN (:...keyIds)', { keyIds });
          if (userIds.length > 0) where.orWhere('l.userId IN (:...userIds)', { userIds });
        }),
      );
    }

    const [rows, total] = await qb.orderBy('l.createdAt', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    const userIds = Array.from(new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id))));
    const keyIds = Array.from(new Set(rows.map((row) => row.accessKeyId).filter((id): id is string => Boolean(id))));
    const [users, keys]: [User[], AccessKey[]] = await Promise.all([
      userIds.length > 0 ? this.users.find({ where: { tenantId, id: In(userIds) } }) : [],
      keyIds.length > 0 ? this.keys.find({ where: { tenantId, id: In(keyIds) } }) : [],
    ]);
    const userMap = new Map<string, User>(users.map((user): [string, User] => [user.id, user]));
    const keyMap = new Map<string, AccessKey>(keys.map((key): [string, AccessKey] => [key.id, key]));

    return {
      items: rows.map((row) => {
        const user = row.userId ? userMap.get(row.userId) : null;
        const key = row.accessKeyId ? keyMap.get(row.accessKeyId) : null;
        return {
          id: row.id,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          detail: row.detail,
          createdAt: row.createdAt,
          user: user ? { id: user.id, phone: user.phone, nickname: user.nickname, role: user.role } : null,
          accessKey: key
            ? { id: key.id, key: key.key, status: key.status }
            : row.accessKeyMasked
              ? { id: row.accessKeyId ?? '', key: row.accessKeyMasked, status: 'deleted' }
              : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  private maskKey(key: string): string {
    return key.length <= 4 ? '****' : `****${this.last4(key)}`;
  }

  private last4(key: string): string {
    return key.slice(-4);
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key.trim().toUpperCase()).digest('hex');
  }

  private async runBestEffort(action: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.logger.warn(`user activity log failed for ${action}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([UserActivityLog, AccessKey, User])],
  providers: [UserActivityService],
  exports: [UserActivityService],
})
export class UserActivityModule {}

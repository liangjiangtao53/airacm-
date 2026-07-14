import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post as HttpPost,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtService } from '@nestjs/jwt';
import { AdminOperationLog, ForumTopic, Post, PostReply, PostReplyLike, User } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, JwtPayload, Roles, RolesGuard } from '../common';
import { env } from '../config';
import { SessionService } from '../session';
import { WechatMiniProgramModule, WechatMiniProgramService } from './wechat-mini-program';

class CreatePostDto {
  @IsString()
  @IsNotEmpty({ message: '内容不能为空' })
  @MaxLength(1000, { message: '内容过长' })
  content!: string;

  @IsString()
  @IsNotEmpty({ message: '请选择主题' })
  topicId!: string;
}

class CreateReplyDto {
  @IsString()
  @IsNotEmpty({ message: '回复不能为空' })
  @MaxLength(500, { message: '回复过长' })
  content!: string;
}

class CreateTopicDto {
  @IsString()
  @IsNotEmpty({ message: '主题名不能为空' })
  @MaxLength(30, { message: '主题名过长' })
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

class UpdateTopicDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '主题名不能为空' })
  @MaxLength(30, { message: '主题名过长' })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

class ListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  // 按主题过滤;不传则全部主题。
  @IsOptional()
  @IsString()
  topicId?: string;
}

interface PostView {
  id: string;
  topicId: string | null;
  userId: string;
  nickname: string;
  content: string;
  createdAt: Date;
  replyCount: number;
  canDelete: boolean;
}

interface ReplyView {
  id: string;
  postId: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: Date;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
}

@Injectable()
export class ForumService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(PostReply) private readonly replies: Repository<PostReply>,
    @InjectRepository(PostReplyLike) private readonly replyLikes: Repository<PostReplyLike>,
    @InjectRepository(ForumTopic) private readonly topics: Repository<ForumTopic>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AdminOperationLog) private readonly operationLogs: Repository<AdminOperationLog>,
    private readonly wechat: WechatMiniProgramService,
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

  // 批量解析 userId→昵称,避免逐条查(N+1)。查不到(如已删用户/旧卡密帖)回退短 id。
  private async resolveNicknames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniq = [...new Set(ids)];
    if (!uniq.length) return map;
    const rows = await this.users.find({
      where: { tenantId, id: In(uniq) },
      select: ['id', 'nickname'],
    });
    rows.forEach((u) => map.set(u.id, u.nickname || `用户${u.id.slice(0, 4)}`));
    uniq.forEach((id) => map.has(id) || map.set(id, `用户${id.slice(0, 4)}`));
    return map;
  }

  // ===== 主题 =====
  listTopics(tenantId: string): Promise<ForumTopic[]> {
    return this.topics.find({ where: { tenantId }, order: { order: 'ASC', createdAt: 'ASC' } });
  }

  async createTopic(admin: AuthUser, name: string, order?: number): Promise<ForumTopic> {
    const topic = await this.topics.save(this.topics.create({ tenantId: admin.tenantId, name: name.trim(), order: order ?? 0 }));
    await this.logAdminOperation(admin, 'forum_topic_create', 'forum_topic', topic.id, {
      name: topic.name,
      order: topic.order,
    });
    return topic;
  }

  async updateTopic(admin: AuthUser, id: string, patch: UpdateTopicDto): Promise<ForumTopic> {
    const t = await this.topics.findOne({ where: { tenantId: admin.tenantId, id } });
    if (!t) throw new NotFoundException('主题不存在');
    const before = { name: t.name, order: t.order };
    if (patch.name !== undefined) t.name = patch.name.trim();
    if (patch.order !== undefined) t.order = patch.order;
    const topic = await this.topics.save(t);
    await this.logAdminOperation(admin, 'forum_topic_update', 'forum_topic', topic.id, {
      before,
      after: { name: topic.name, order: topic.order },
    });
    return topic;
  }

  // 删除主题:该主题下还有帖子则拒绝,避免帖子失去归属。
  async deleteTopic(admin: AuthUser, id: string): Promise<{ deleted: boolean }> {
    const t = await this.topics.findOne({ where: { tenantId: admin.tenantId, id } });
    if (!t) throw new NotFoundException('主题不存在');
    const used = await this.posts.count({ where: { tenantId: admin.tenantId, topicId: id, deletedAt: IsNull() } });
    if (used > 0) throw new BadRequestException(`该主题下还有 ${used} 个帖子,不能删除`);
    await this.topics.delete(t.id);
    await this.logAdminOperation(admin, 'forum_topic_delete', 'forum_topic', t.id, {
      name: t.name,
      order: t.order,
    });
    return { deleted: true };
  }

  // ===== 帖子 =====
  // 列表(新到旧),带回复数+昵称。可按 topicId 过滤。聚合查回复数与昵称,避免 N+1。
  async list(
    tenantId: string,
    q: ListQuery,
    user: AuthUser | null = null,
  ): Promise<{ items: PostView[]; total: number; page: number; pageSize: number }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = q.topicId
      ? { tenantId, topicId: q.topicId, deletedAt: IsNull() }
      : { tenantId, deletedAt: IsNull() };
    const [rows, total] = await this.posts.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const countMap = new Map<string, number>();
    if (rows.length) {
      const raw = await this.replies
        .createQueryBuilder('r')
        .select('r.postId', 'postId')
        .addSelect('COUNT(*)', 'c')
        .where('r.tenantId = :t', { t: tenantId })
        .andWhere('r.postId IN (:...ids)', { ids: rows.map((p) => p.id) })
        .andWhere('r.deletedAt IS NULL')
        .groupBy('r.postId')
        .getRawMany<{ postId: string; c: string }>();
      raw.forEach((x) => countMap.set(x.postId, Number(x.c)));
    }
    const nickMap = await this.resolveNicknames(tenantId, rows.map((p) => p.userId));
    const items = rows.map((p) => ({
      id: p.id,
      topicId: p.topicId,
      userId: p.userId,
      nickname: nickMap.get(p.userId) ?? `用户${p.userId.slice(0, 4)}`,
      content: p.content,
      createdAt: p.createdAt,
      replyCount: countMap.get(p.id) ?? 0,
      canDelete: user ? this.canDeletePost(user, p) : false,
    }));
    return { items, total, page, pageSize };
  }

  async create(user: AuthUser, content: string, topicId: string, clientPlatform?: string): Promise<PostView> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('内容不能为空');
    const topic = await this.topics.findOne({ where: { tenantId: user.tenantId, id: topicId } });
    if (!topic) throw new BadRequestException('主题不存在');
    await this.wechat.checkContent(trimmed, 3, await this.userWechatOpenid(user), {
      userId: user.userId,
      contentType: 'forum_post',
      clientPlatform,
    });
    const p = await this.posts.save(
      this.posts.create({ tenantId: user.tenantId, topicId, userId: user.userId, content: trimmed }),
    );
    const nick = await this.resolveNicknames(user.tenantId, [user.userId]);
    return {
      id: p.id,
      topicId: p.topicId,
      userId: p.userId,
      nickname: nick.get(p.userId) ?? `用户${p.userId.slice(0, 4)}`,
      content: p.content,
      createdAt: p.createdAt,
      replyCount: 0,
      canDelete: true,
    };
  }

  async listReplies(tenantId: string, postId: string, user: AuthUser | null = null): Promise<ReplyView[]> {
    const post = await this.posts.findOne({ where: { tenantId, id: postId, deletedAt: IsNull() } });
    if (!post) throw new NotFoundException('帖子不存在');
    const rows = await this.replies.find({
      where: { tenantId, postId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    const nickMap = await this.resolveNicknames(tenantId, rows.map((r) => r.userId));
    const replyIds = rows.map((r) => r.id);
    const likeCountMap = new Map<string, number>();
    const likedSet = new Set<string>();
    if (replyIds.length) {
      const counts = await this.replyLikes
        .createQueryBuilder('l')
        .select('l.replyId', 'replyId')
        .addSelect('COUNT(*)', 'c')
        .where('l.tenantId = :tenantId', { tenantId })
        .andWhere('l.replyId IN (:...replyIds)', { replyIds })
        .groupBy('l.replyId')
        .getRawMany<{ replyId: string; c: string }>();
      counts.forEach((row) => likeCountMap.set(row.replyId, Number(row.c)));
      if (user) {
        const mine = await this.replyLikes.find({
          where: { tenantId, userId: user.userId, replyId: In(replyIds) },
          select: ['replyId'],
        });
        mine.forEach((row) => likedSet.add(row.replyId));
      }
    }
    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      userId: r.userId,
      nickname: nickMap.get(r.userId) ?? `用户${r.userId.slice(0, 4)}`,
      content: r.content,
      createdAt: r.createdAt,
      likeCount: likeCountMap.get(r.id) ?? 0,
      likedByMe: likedSet.has(r.id),
      canDelete: user ? this.canDeleteReply(user, r) : false,
    }));
  }

  async addReply(user: AuthUser, postId: string, content: string, clientPlatform?: string): Promise<ReplyView> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('回复不能为空');
    const post = await this.posts.findOne({ where: { tenantId: user.tenantId, id: postId, deletedAt: IsNull() } });
    if (!post) throw new NotFoundException('帖子不存在');
    await this.wechat.checkContent(trimmed, 2, await this.userWechatOpenid(user), {
      userId: user.userId,
      contentType: 'forum_reply',
      clientPlatform,
    });
    const r = await this.replies.save(
      this.replies.create({ tenantId: user.tenantId, postId, userId: user.userId, content: trimmed }),
    );
    const nick = await this.resolveNicknames(user.tenantId, [user.userId]);
    return {
      id: r.id,
      postId: r.postId,
      userId: r.userId,
      nickname: nick.get(r.userId) ?? `用户${r.userId.slice(0, 4)}`,
      content: r.content,
      createdAt: r.createdAt,
      likeCount: 0,
      likedByMe: false,
      canDelete: true,
    };
  }

  private canDeleteReply(user: AuthUser, reply: Pick<PostReply, 'userId'>): boolean {
    return reply.userId === user.userId || user.role === 'admin' || user.role === 'super';
  }

  private async userWechatOpenid(user: AuthUser): Promise<string | null> {
    const row = await this.users.findOne({
      where: { tenantId: user.tenantId, id: user.userId },
      select: ['wechatOpenid'],
    });
    return row?.wechatOpenid ?? null;
  }

  private canDeletePost(user: AuthUser, post: Pick<Post, 'userId'>): boolean {
    return post.userId === user.userId || user.role === 'admin' || user.role === 'super';
  }

  // 帖子原来不能删除;这里按回复删除的方式做软删除,并隐藏/清理其下回复和点赞。
  async deletePost(user: AuthUser, postId: string): Promise<{ deleted: boolean }> {
    const post = await this.posts.findOne({
      where: { tenantId: user.tenantId, id: postId, deletedAt: IsNull() },
    });
    if (!post) throw new NotFoundException('帖子不存在');
    if (!this.canDeletePost(user, post)) throw new ForbiddenException('只能删除自己的帖子');
    const replyIds = await this.replies.find({ where: { tenantId: user.tenantId, postId: post.id }, select: ['id'] });
    await this.posts.update(post.id, { deletedAt: new Date() });
    await this.replies.update({ tenantId: user.tenantId, postId: post.id, deletedAt: IsNull() }, { deletedAt: new Date() });
    if (replyIds.length) {
      await this.replyLikes.delete({ tenantId: user.tenantId, replyId: In(replyIds.map((r) => r.id)) });
    }
    if (user.role === 'admin' || user.role === 'super') {
      await this.logAdminOperation(user, 'forum_post_delete', 'post', post.id, {
        ownerUserId: post.userId,
        topicId: post.topicId,
      });
    }
    return { deleted: true };
  }

  async deleteReply(user: AuthUser, replyId: string): Promise<{ deleted: boolean }> {
    const reply = await this.replies.findOne({
      where: { tenantId: user.tenantId, id: replyId, deletedAt: IsNull() },
    });
    if (!reply) throw new NotFoundException('回复不存在');
    if (!this.canDeleteReply(user, reply)) throw new ForbiddenException('只能删除自己的回复');
    await this.replies.update(reply.id, { deletedAt: new Date() });
    await this.replyLikes.delete({ tenantId: user.tenantId, replyId: reply.id });
    if (user.role === 'admin' || user.role === 'super') {
      await this.logAdminOperation(user, 'forum_reply_delete', 'post_reply', reply.id, {
        postId: reply.postId,
        ownerUserId: reply.userId,
      });
    }
    return { deleted: true };
  }

  async toggleReplyLike(user: AuthUser, replyId: string): Promise<{ liked: boolean; likeCount: number }> {
    const reply = await this.replies.findOne({
      where: { tenantId: user.tenantId, id: replyId, deletedAt: IsNull() },
      select: ['id'],
    });
    if (!reply) throw new NotFoundException('回复不存在');
    const existing = await this.replyLikes.findOne({
      where: { tenantId: user.tenantId, replyId, userId: user.userId },
    });
    if (existing) {
      await this.replyLikes.delete(existing.id);
      return { liked: false, likeCount: await this.replyLikes.count({ where: { tenantId: user.tenantId, replyId } }) };
    }
    try {
      await this.replyLikes.save(this.replyLikes.create({ tenantId: user.tenantId, replyId, userId: user.userId }));
    } catch (e) {
      if (!(e instanceof QueryFailedError)) throw e;
    }
    return { liked: true, likeCount: await this.replyLikes.count({ where: { tenantId: user.tenantId, replyId } }) };
  }
}

@Controller('forum')
export class ForumTopicController {
  constructor(private readonly svc: ForumService) {}

  @Get('topics')
  topics() {
    return this.svc.listTopics(env.defaultTenantId);
  }
}

// 主题维护:admin+super(super 自动满足 admin)。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/forum/topics')
export class ForumAdminController {
  constructor(private readonly svc: ForumService) {}

  @HttpPost()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTopicDto) {
    return this.svc.createTopic(user, dto.name, dto.order);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTopicDto) {
    return this.svc.updateTopic(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteTopic(user, id);
  }
}

@Controller('posts')
export class ForumController {
  constructor(
    private readonly svc: ForumService,
    private readonly jwt: JwtService,
    private readonly session: SessionService,
  ) {}

  private async optionalUser(req: { headers?: { authorization?: string } }): Promise<AuthUser | null> {
    const header = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const payload = this.jwt.verify<JwtPayload>(header.slice('Bearer '.length).trim(), { secret: env.jwtSecret });
      await this.session.validate(payload);
      return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role ?? 'user' };
    } catch {
      return null;
    }
  }

  @Get()
  async list(@Req() req: { headers?: { authorization?: string } }, @Query() q: ListQuery) {
    const user = await this.optionalUser(req);
    return this.svc.list(user?.tenantId ?? env.defaultTenantId, q, user);
  }

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePostDto,
    @Req() req: { headers?: { 'x-client-platform'?: string } },
  ) {
    return this.svc.create(user, dto.content, dto.topicId, req.headers?.['x-client-platform']);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  deletePost(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deletePost(user, id);
  }

  @Get(':id/replies')
  async replies(@Req() req: { headers?: { authorization?: string } }, @Param('id') id: string) {
    const user = await this.optionalUser(req);
    return this.svc.listReplies(user?.tenantId ?? env.defaultTenantId, id, user);
  }

  @HttpPost(':id/replies')
  @UseGuards(JwtAuthGuard)
  addReply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateReplyDto,
    @Req() req: { headers?: { 'x-client-platform'?: string } },
  ) {
    return this.svc.addReply(user, id, dto.content, req.headers?.['x-client-platform']);
  }

  @Delete('replies/:replyId')
  @UseGuards(JwtAuthGuard)
  deleteReply(@CurrentUser() user: AuthUser, @Param('replyId') replyId: string) {
    return this.svc.deleteReply(user, replyId);
  }

  @HttpPost('replies/:replyId/like')
  @UseGuards(JwtAuthGuard)
  toggleReplyLike(@CurrentUser() user: AuthUser, @Param('replyId') replyId: string) {
    return this.svc.toggleReplyLike(user, replyId);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, PostReply, PostReplyLike, ForumTopic, User, AdminOperationLog]),
    WechatMiniProgramModule,
  ],
  controllers: [ForumController, ForumTopicController, ForumAdminController],
  providers: [ForumService],
})
export class ForumModule {}

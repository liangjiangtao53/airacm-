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
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminOperationLog, ForumTopic, Post, PostReply, User } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { env } from '../config';

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
}

interface ReplyView {
  id: string;
  postId: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class ForumService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(PostReply) private readonly replies: Repository<PostReply>,
    @InjectRepository(ForumTopic) private readonly topics: Repository<ForumTopic>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AdminOperationLog) private readonly operationLogs: Repository<AdminOperationLog>,
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
    const used = await this.posts.count({ where: { tenantId: admin.tenantId, topicId: id } });
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
  ): Promise<{ items: PostView[]; total: number; page: number; pageSize: number }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = q.topicId
      ? { tenantId, topicId: q.topicId }
      : { tenantId };
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
    }));
    return { items, total, page, pageSize };
  }

  async create(user: AuthUser, content: string, topicId: string): Promise<PostView> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('内容不能为空');
    const topic = await this.topics.findOne({ where: { tenantId: user.tenantId, id: topicId } });
    if (!topic) throw new BadRequestException('主题不存在');
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
    };
  }

  async listReplies(tenantId: string, postId: string): Promise<ReplyView[]> {
    const post = await this.posts.findOne({ where: { tenantId, id: postId } });
    if (!post) throw new NotFoundException('帖子不存在');
    const rows = await this.replies.find({
      where: { tenantId, postId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    const nickMap = await this.resolveNicknames(tenantId, rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      userId: r.userId,
      nickname: nickMap.get(r.userId) ?? `用户${r.userId.slice(0, 4)}`,
      content: r.content,
      createdAt: r.createdAt,
    }));
  }

  async addReply(user: AuthUser, postId: string, content: string): Promise<ReplyView> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('回复不能为空');
    const post = await this.posts.findOne({ where: { tenantId: user.tenantId, id: postId } });
    if (!post) throw new NotFoundException('帖子不存在');
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
    };
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
  constructor(private readonly svc: ForumService) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.svc.list(env.defaultTenantId, q);
  }

  @HttpPost()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) {
    return this.svc.create(user, dto.content, dto.topicId);
  }

  @Get(':id/replies')
  replies(@Param('id') id: string) {
    return this.svc.listReplies(env.defaultTenantId, id);
  }

  @HttpPost(':id/replies')
  @UseGuards(JwtAuthGuard)
  addReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateReplyDto) {
    return this.svc.addReply(user, id, dto.content);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Post, PostReply, ForumTopic, User, AdminOperationLog])],
  controllers: [ForumController, ForumTopicController, ForumAdminController],
  providers: [ForumService],
})
export class ForumModule {}

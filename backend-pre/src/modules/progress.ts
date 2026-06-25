import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsIn, IsInt, IsString, Min } from 'class-validator';
import { Lesson, Progress } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';
import { cacheGet, cacheSet } from '../cache';

class UpsertProgressDto {
  @IsString()
  lessonId!: string;

  @IsInt()
  @Min(0)
  position!: number;

  @IsIn(['in_progress', 'done'])
  status!: 'in_progress' | 'done';
}

const LESSON_EXIST_TTL_MS = 60_000;

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Progress) private readonly progress: Repository<Progress>,
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
  ) {}

  // 上报学习进度(高频写)。优化:课时存在性走缓存省一次查询 + 数据库原生 upsert 一次写完成。
  async upsert(user: AuthUser, dto: UpsertProgressDto): Promise<{ ok: boolean }> {
    // 课时存在性走缓存:课时基本不变,高频上报下缓存命中可省掉这次查询。
    const now = Date.now();
    const lkey = `lessonexist:${user.tenantId}:${dto.lessonId}`;
    let exists = cacheGet<boolean>(lkey, now);
    if (exists === undefined) {
      exists = !!(await this.lessons.findOne({
        where: { tenantId: user.tenantId, id: dto.lessonId },
      }));
      cacheSet(lkey, exists, LESSON_EXIST_TTL_MS, now);
    }
    if (!exists) throw new NotFoundException('课时不存在');

    // 数据库原生 upsert(INSERT ... ON CONFLICT DO UPDATE):一次写,无"先查后写"竞态。
    await this.progress.upsert(
      {
        tenantId: user.tenantId,
        userId: user.userId,
        lessonId: dto.lessonId,
        position: dto.position,
        status: dto.status,
      },
      ['tenantId', 'userId', 'lessonId'],
    );
    return { ok: true };
  }

  async get(
    user: AuthUser,
    lessonId: string,
  ): Promise<{ position: number; status: string } | null> {
    const p = await this.progress.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, lessonId },
    });
    return p ? { position: p.position, status: p.status } : null;
  }
}

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly svc: ProgressService) {}

  @Post()
  async upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertProgressDto) {
    return this.svc.upsert(user, dto);
  }

  @Get(':lessonId')
  async get(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string) {
    return this.svc.get(user, lessonId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Progress, Lesson])],
  providers: [ProgressService],
  controllers: [ProgressController],
  exports: [ProgressService],
})
export class ProgressModule {}
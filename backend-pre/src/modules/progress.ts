import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Lesson, Progress, ProgressStatus } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';

class UpsertProgressDto {
  @IsString()
  lessonId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'done'])
  status?: ProgressStatus;
}

class ProgressQueryDto {
  @IsOptional()
  @IsString()
  courseId?: string;
}

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Progress) private readonly progress: Repository<Progress>,
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
  ) {}

  // 高频写第一版直接写;量大再异步批量(性能要求)。upsert 按 (tenantId,userId,lessonId) 唯一。
  async upsert(user: AuthUser, dto: UpsertProgressDto): Promise<Progress> {
    const lesson = await this.lessons.findOne({
      where: { tenantId: user.tenantId, id: dto.lessonId },
    });
    if (!lesson) throw new NotFoundException('课时不存在');

    let row = await this.progress.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, lessonId: dto.lessonId },
    });
    if (!row) {
      row = this.progress.create({
        tenantId: user.tenantId,
        userId: user.userId,
        lessonId: dto.lessonId,
        position: dto.position ?? 0,
        status: dto.status ?? 'in_progress',
      });
    } else {
      if (dto.position !== undefined) row.position = dto.position;
      if (dto.status !== undefined) row.status = dto.status;
    }
    return this.progress.save(row);
  }

  async list(user: AuthUser, query: ProgressQueryDto): Promise<Progress[]> {
    if (query.courseId) {
      // 按课程过滤:先取该课程课时 id,再批量查进度(避免 N+1)。
      const lessons = await this.lessons.find({
        where: { tenantId: user.tenantId, courseId: query.courseId },
      });
      const ids = lessons.map((l) => l.id);
      if (ids.length === 0) return [];
      return this.progress.find({
        where: { tenantId: user.tenantId, userId: user.userId, lessonId: In(ids) },
      });
    }
    return this.progress.find({
      where: { tenantId: user.tenantId, userId: user.userId },
      order: { updatedAt: 'DESC' },
    });
  }
}

@UseGuards(JwtAuthGuard)
@Controller('progress')
export class ProgressController {
  constructor(private readonly svc: ProgressService) {}

  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertProgressDto) {
    return this.svc.upsert(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ProgressQueryDto) {
    return this.svc.list(user, query);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Progress, Lesson])],
  controllers: [ProgressController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}

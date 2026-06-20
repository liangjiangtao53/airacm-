import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chapter, Course, Entitlement, Lesson } from '../entities';
import type { LessonAccess } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';

interface LessonView {
  id: string;
  title: string;
  type: string;
  access: LessonAccess;
  order: number;
  duration: number;
  locked: boolean; // 后端判定的访问态,前端仅作展示
}

interface ChapterView {
  id: string;
  title: string;
  order: number;
  lessons: LessonView[];
}

@Injectable()
export class CourseService {
  constructor(
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Chapter) private readonly chapters: Repository<Chapter>,
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
    @InjectRepository(Entitlement) private readonly entitlements: Repository<Entitlement>,
  ) {}

  async ownsCourse(user: AuthUser, courseId: string): Promise<boolean> {
    const e = await this.entitlements.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, courseId },
    });
    return !!e;
  }

  // 访问规则沿用 mock canOpenLesson,但在后端强制(D 约束 2):
  // free 永远开;paid/vip 需已购权益;password 需登录(控制器已守卫)。
  private canOpen(access: LessonAccess, owns: boolean): boolean {
    if (access === 'free') return true;
    if (access === 'paid' || access === 'vip') return owns;
    if (access === 'password') return true; // 登录即可,真实场景再校验课时密码
    return false;
  }

  async list(user: AuthUser): Promise<Course[]> {
    return this.courses.find({ where: { tenantId: user.tenantId }, order: { title: 'ASC' } });
  }

  // 详情:批量加载章节 + 课时,避免 N+1(性能要求)。
  async detail(
    user: AuthUser,
    courseId: string,
  ): Promise<{ course: Course; owned: boolean; chapters: ChapterView[] }> {
    const course = await this.courses.findOne({
      where: { tenantId: user.tenantId, id: courseId },
    });
    if (!course) throw new NotFoundException('课程不存在');

    const chapters = await this.chapters.find({
      where: { tenantId: user.tenantId, courseId },
      order: { order: 'ASC' },
    });
    const lessons = await this.lessons.find({
      where: { tenantId: user.tenantId, courseId },
      order: { order: 'ASC' },
    });
    const owned = await this.ownsCourse(user, courseId);

    const byChapter = new Map<string, LessonView[]>();
    for (const l of lessons) {
      const view: LessonView = {
        id: l.id,
        title: l.title,
        type: l.type,
        access: l.access,
        order: l.order,
        duration: l.duration,
        locked: !this.canOpen(l.access, owned),
      };
      const arr = byChapter.get(l.chapterId) ?? [];
      arr.push(view);
      byChapter.set(l.chapterId, arr);
    }

    const chapterViews: ChapterView[] = chapters.map((c) => ({
      id: c.id,
      title: c.title,
      order: c.order,
      lessons: byChapter.get(c.id) ?? [],
    }));

    return { course, owned, chapters: chapterViews };
  }

  // 单课时:后端独立鉴权,未购/越权拒绝。给客户端返回播放地址(此处桩,真实走签名 CDN URL)。
  async lessonDetail(
    user: AuthUser,
    lessonId: string,
  ): Promise<{ lesson: Lesson; playUrl: string }> {
    const lesson = await this.lessons.findOne({
      where: { tenantId: user.tenantId, id: lessonId },
    });
    if (!lesson) throw new NotFoundException('课时不存在');
    const owns = await this.ownsCourse(user, lesson.courseId);
    if (!this.canOpen(lesson.access, owns)) {
      throw new ForbiddenException('未购买该课程,无法学习此课时');
    }
    // 真实环境:签名的对象存储/CDN URL,带过期时间,绝不经应用服务器代理视频流。
    const playUrl = `https://cdn.example.com/lessons/${lesson.id}/play.m3u8?sign=dev`;
    return { lesson, playUrl };
  }
}

@UseGuards(JwtAuthGuard)
@Controller()
export class CourseController {
  constructor(private readonly svc: CourseService) {}

  @Get('courses')
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Get('courses/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.detail(user, id);
  }

  @Get('lessons/:id')
  lesson(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.lessonDetail(user, id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Course, Chapter, Lesson, Entitlement])],
  controllers: [CourseController],
  providers: [CourseService],
  exports: [CourseService],
})
export class CourseModule {}

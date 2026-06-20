import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import * as crypto from 'crypto';
import {
  Chapter,
  Course,
  Lesson,
  LessonAccess,
  LessonType,
  RechargeCode,
  User,
} from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { WalletModule, WalletService } from './wallet';

class GenCodesDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  count!: number;

  @IsInt()
  @Min(1)
  amount!: number; // 每张面额(分)
}

class ManualRechargeDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount!: number; // 分
}

class CreateCourseDto {
  @IsString()
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsInt()
  @Min(0)
  price!: number; // 分

  @IsOptional()
  @IsInt()
  @Min(0)
  originalPrice?: number;
}

class CreateChapterDto {
  @IsString()
  courseId!: string;

  @IsString()
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

class CreateLessonDto {
  @IsString()
  chapterId!: string;

  @IsString()
  @MaxLength(100)
  title!: string;

  @IsIn(['video', 'text'])
  type!: LessonType;

  @IsIn(['free', 'paid', 'vip', 'password'])
  access!: LessonAccess;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(RechargeCode) private readonly codes: Repository<RechargeCode>,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Chapter) private readonly chapters: Repository<Chapter>,
    @InjectRepository(Lesson) private readonly lessons: Repository<Lesson>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  // 批量生成激活码。码用加密随机,避免被枚举猜测。
  async generateCodes(admin: AuthUser, count: number, amount: number): Promise<{ codes: string[] }> {
    const rows: RechargeCode[] = [];
    const codeStrings: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = this.randomCode();
      codeStrings.push(code);
      rows.push(
        this.codes.create({ tenantId: admin.tenantId, code, amount, status: 'unused' }),
      );
    }
    await this.codes.save(rows);
    return { codes: codeStrings };
  }

  private randomCode(): string {
    // 16 位大写十六进制,足够随机防枚举。
    return crypto.randomBytes(8).toString('hex').toUpperCase();
  }

  // 后台手动充值:管理员直接给指定学员钱包入账(留痕到 wallet_txn,refId 标记 admin)。
  async manualRecharge(
    admin: AuthUser,
    userId: string,
    amount: number,
  ): Promise<{ balance: number }> {
    const target = await this.users.findOne({ where: { tenantId: admin.tenantId, id: userId } });
    if (!target) throw new NotFoundException('用户不存在');
    const refId = `admin:${admin.userId}:${Date.now()}`;
    const balance = await this.dataSource.transaction((m) =>
      this.wallet.creditWithin(m, { userId, tenantId: admin.tenantId, role: 'user' }, amount, refId),
    );
    return { balance };
  }

  async createCourse(admin: AuthUser, dto: CreateCourseDto): Promise<Course> {
    return this.courses.save(
      this.courses.create({
        tenantId: admin.tenantId,
        title: dto.title,
        summary: dto.summary ?? '',
        price: dto.price,
        originalPrice: dto.originalPrice ?? dto.price,
      }),
    );
  }

  async createChapter(admin: AuthUser, dto: CreateChapterDto): Promise<Chapter> {
    const course = await this.courses.findOne({
      where: { tenantId: admin.tenantId, id: dto.courseId },
    });
    if (!course) throw new NotFoundException('课程不存在');
    const chapter = await this.chapters.save(
      this.chapters.create({
        tenantId: admin.tenantId,
        courseId: dto.courseId,
        title: dto.title,
        order: dto.order ?? 0,
      }),
    );
    await this.courses.update(course.id, { chapterCount: course.chapterCount + 1 });
    return chapter;
  }

  async createLesson(admin: AuthUser, dto: CreateLessonDto): Promise<Lesson> {
    const chapter = await this.chapters.findOne({
      where: { tenantId: admin.tenantId, id: dto.chapterId },
    });
    if (!chapter) throw new NotFoundException('章节不存在');
    const lesson = await this.lessons.save(
      this.lessons.create({
        tenantId: admin.tenantId,
        chapterId: dto.chapterId,
        courseId: chapter.courseId,
        title: dto.title,
        type: dto.type,
        access: dto.access,
        order: dto.order ?? 0,
        duration: dto.duration ?? 0,
      }),
    );
    const course = await this.courses.findOne({
      where: { tenantId: admin.tenantId, id: chapter.courseId },
    });
    if (course) {
      await this.courses.update(course.id, { lessonCount: course.lessonCount + 1 });
    }
    return lesson;
  }
}

// 全部管理接口:登录 + admin 角色双重守卫。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Post('recharge-codes')
  genCodes(@CurrentUser() admin: AuthUser, @Body() dto: GenCodesDto) {
    return this.svc.generateCodes(admin, dto.count, dto.amount);
  }

  @Post('wallet/recharge')
  manualRecharge(@CurrentUser() admin: AuthUser, @Body() dto: ManualRechargeDto) {
    return this.svc.manualRecharge(admin, dto.userId, dto.amount);
  }

  @Post('courses')
  createCourse(@CurrentUser() admin: AuthUser, @Body() dto: CreateCourseDto) {
    return this.svc.createCourse(admin, dto);
  }

  @Post('chapters')
  createChapter(@CurrentUser() admin: AuthUser, @Body() dto: CreateChapterDto) {
    return this.svc.createChapter(admin, dto);
  }

  @Post('lessons')
  createLesson(@CurrentUser() admin: AuthUser, @Body() dto: CreateLessonDto) {
    return this.svc.createLesson(admin, dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([RechargeCode, Course, Chapter, Lesson, User]),
    WalletModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

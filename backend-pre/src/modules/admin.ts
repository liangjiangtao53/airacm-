import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import {
  Chapter,
  Course,
  Lesson,
  LessonAccess,
  LessonType,
  RechargeCode,
  User,
  Wallet,
} from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { WalletModule, WalletService } from './wallet';

// 中国大陆手机号(与 auth 模块一致)。
const PHONE_RE = /^1[3-9]\d{9}$/;

class GenCodesDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  count!: number;

  @IsInt()
  @Min(1)
  amount!: number; // 每张面额(分)
}

// 超管新增业务管理员:手机号 + 密码 + 昵称。
class CreateAdminDto {
  @IsString()
  @Matches(PHONE_RE, { message: '手机号格式不正确' })
  phone!: string;

  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(64, { message: '密码过长' })
  password!: string;

  @IsString()
  @MaxLength(30, { message: '昵称过长' })
  nickname!: string;
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

  // 超管新增业务管理员(role=admin):建用户+开钱包。手机号不可与现有用户冲突。
  async createAdmin(
    caller: AuthUser,
    phone: string,
    password: string,
    nickname: string,
  ): Promise<{ id: string; phone: string; nickname: string; role: string }> {
    const nick = nickname.trim();
    if (!nick) throw new BadRequestException('昵称不能为空');
    const dup = await this.users.findOne({ where: { tenantId: caller.tenantId, phone } });
    if (dup) throw new BadRequestException('该手机号已被占用');
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = await this.dataSource.transaction(async (m) => {
      const u = await m.save(
        m.create(User, {
          tenantId: caller.tenantId,
          phone,
          nickname: nick,
          passwordHash,
          role: 'admin',
          openid: null,
        }),
      );
      await m.save(m.create(Wallet, { tenantId: caller.tenantId, userId: u.id, balance: 0 }));
      return u.id;
    });
    return { id: userId, phone, nickname: nick, role: 'admin' };
  }

  // 用户列表:超管看全部(含业务管理员/超管),业务管理员只看普通用户。
  // source 区分来源:key=卡密补全 / wechat=微信 / register=手机号注册,供前端打标签。
  async listUsers(
    caller: AuthUser,
  ): Promise<
    Array<{
      id: string;
      phone: string;
      nickname: string;
      role: string;
      source: 'key' | 'wechat' | 'register';
      createdAt: Date;
    }>
  > {
    const where: Record<string, unknown> = { tenantId: caller.tenantId };
    if (caller.role !== 'super') where.role = 'user'; // 业务管理员看不到管理员/超管
    const rows = await this.users.find({ where, order: { createdAt: 'DESC' }, take: 1000 });
    return rows.map((u) => ({
      id: u.id,
      phone: u.phone,
      nickname: u.nickname,
      role: u.role,
      source: u.openid?.startsWith('key:') ? 'key' : u.openid ? 'wechat' : 'register',
      createdAt: u.createdAt,
    }));
  }

  // 删除用户:业务管理员只能删普通用户;超管可删普通用户与业务管理员,但不能删超管或自己。
  async deleteUser(caller: AuthUser, targetId: string): Promise<{ deleted: number }> {
    if (caller.userId === targetId) throw new BadRequestException('不能删除自己');
    const target = await this.users.findOne({
      where: { tenantId: caller.tenantId, id: targetId },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (caller.role !== 'super') {
      if (target.role !== 'user') throw new ForbiddenException('无权删除该用户');
    } else if (target.role === 'super') {
      throw new ForbiddenException('不能删除超级管理员');
    }
    await this.dataSource.transaction(async (m) => {
      await m.delete(Wallet, { tenantId: caller.tenantId, userId: targetId });
      await m.delete(User, { tenantId: caller.tenantId, id: targetId });
    });
    return { deleted: 1 };
  }
}

// 管理接口:类默认仅 super(充值码/手动充值/建课程);
// 用户管理方法级放宽到 admin(业务管理员也能管学员)。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Roles('admin')
  @Get('users')
  listUsers(@CurrentUser() admin: AuthUser) {
    return this.svc.listUsers(admin);
  }

  @Roles('admin')
  @Delete('users/:id')
  deleteUser(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.svc.deleteUser(admin, id);
  }

  // 新增业务管理员:仅超管(类级 @Roles('super'),方法不放宽)。
  @Post('admins')
  createAdmin(@CurrentUser() admin: AuthUser, @Body() dto: CreateAdminDto) {
    return this.svc.createAdmin(admin, dto.phone, dto.password, dto.nickname);
  }

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

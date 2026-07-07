import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ExamAttempt,
  AdminOperationLog,
  ExamPaperRule,
  Question,
  QuestionOption,
  QuestionPractice,
  StudyQuestionProgress,
  WrongQuestion,
  WrongQuestionSource,
} from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { PublicQuestion, QuestionPoolCacheModule, QuestionPoolCacheService } from './question-pool-cache';
import { UserActivityModule, UserActivityService } from './user-activity';

const DEFAULT_COUNT = 100;
const MAX_COUNT = 300;
const WRONG_QUESTION_RATIO = 0.2;
const DEFAULT_CATEGORY_COUNTS: Record<string, number> = {
  'M1 航空概论': 32,
  'M2 航空器维修': 50,
  'M3 飞机结构和系统': 182,
  'M5 航空涡轮发动机': 70,
  'M9 航空英语': 60,
};

class StartExamDto {
  @IsOptional()
  @IsString()
  courseId?: string;

  // 模拟考试必须按单科目组卷；start() 会校验必填。
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_COUNT)
  // Kept only for old clients; start() ignores it and uses the admin rule.
  count?: number;
}

class UpdateExamRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_COUNT)
  totalCount?: number;

  @IsOptional()
  @IsObject()
  categoryCounts?: Record<string, number>;
}

class SubmitExamDto {
  // {questionId: 'A' | 'AC'}。内层键值在 service 里规范化校验。
  @IsObject()
  answers!: Record<string, string>;
}

class StudyWrongDto {
  @IsString()
  questionId!: string;

  @IsString()
  answer!: string;
}

class StudyProgressDto {
  @IsString()
  questionId!: string;
}

class StudyStartDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  courseId?: string;
}

class MasterWrongDto {
  @IsOptional()
  @IsString()
  source?: WrongQuestionSource;
}

// 卷面题目(不含答案/解析)。
interface PaperQuestion {
  id: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
}

interface GradedItem {
  questionId: string;
  category: string;
  stem: string;
  options: QuestionOption[];
  imageUrls: string[];
  yourAnswer: string;
  correctAnswer: string;
  analysis: string;
  isCorrect: boolean;
}

// 错题本条目:题目详情(含答案/解析,供复习)+ 错题元数据。
interface WrongBookItem {
  questionId: string;
  category: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls: string[];
  answer: string;
  analysis: string;
  wrongCount: number;
  source: WrongQuestionSource;
  lastWrongAt: Date;
}

// 规范化答案:大写、仅留 A-H、去重、字母序。与导入时 answer 存储格式一致,保证可比对。
function normalize(raw: string): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-H]/g, '')
    .split('')
    .filter((c, i, a) => a.indexOf(c) === i)
    .sort()
    .join('');
}

@Injectable()
export class ExamService {
  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    @InjectRepository(ExamAttempt) private readonly attempts: Repository<ExamAttempt>,
    @InjectRepository(WrongQuestion) private readonly wrongBookRepo: Repository<WrongQuestion>,
    @InjectRepository(QuestionPractice) private readonly practices: Repository<QuestionPractice>,
    @InjectRepository(ExamPaperRule) private readonly rules: Repository<ExamPaperRule>,
    @InjectRepository(AdminOperationLog) private readonly operationLogs: Repository<AdminOperationLog>,
    @InjectRepository(StudyQuestionProgress) private readonly studyProgress: Repository<StudyQuestionProgress>,
    private readonly questionPool: QuestionPoolCacheService,
    private readonly activity: UserActivityService,
  ) {}

  async getRule(tenantId: string): Promise<{ totalCount: number; categoryCounts: Record<string, number> }> {
    const row = await this.rules.findOne({ where: { tenantId } });
    return {
      totalCount: row?.totalCount ?? DEFAULT_COUNT,
      categoryCounts: { ...DEFAULT_CATEGORY_COUNTS, ...(row?.categoryCounts ?? {}) },
    };
  }

  async updateRule(
    user: AuthUser,
    dto: UpdateExamRuleDto,
  ): Promise<{ totalCount: number; categoryCounts: Record<string, number> }> {
    const current = await this.getRule(user.tenantId);
    const totalCount = dto.totalCount === undefined ? current.totalCount : this.sanitizeCount(dto.totalCount);
    const categoryCounts = this.sanitizeCategoryCounts(dto.categoryCounts === undefined ? current.categoryCounts : dto.categoryCounts);
    // 原来只保存全局题数；现在同时保存按科目题数,老客户端仍可只传 totalCount。
    await this.rules.upsert({ tenantId: user.tenantId, totalCount, categoryCounts }, ['tenantId']);
    await this.operationLogs.save(
      this.operationLogs.create({
        tenantId: user.tenantId,
        adminId: user.userId,
        action: 'exam_rule_update',
        targetType: 'exam_paper_rule',
        targetId: user.tenantId,
        detail: { totalCount, categoryCounts },
      }),
    );
    return this.getRule(user.tenantId);
  }

  // 组卷:从 usage 含 exam 的题池随机抽 count 道,建作答记录,返回不含答案的卷面。
  async start(
    user: AuthUser,
    dto: StartExamDto,
  ): Promise<{ attemptId: string; total: number; questions: PaperQuestion[] }> {
    const rule = await this.getRule(user.tenantId);
    const category = dto.category?.trim();
    if (!category) throw new BadRequestException('请选择考试科目');
    const count = rule.categoryCounts[category];
    if (!count) throw new BadRequestException('该科目暂未配置考试题数');
    const picked = await this.pickExamQuestions(user, { courseId: dto.courseId, category }, count);
    if (picked.length < count) {
      throw new BadRequestException(`题库不足,当前仅 ${picked.length} 题,本模块考试需要 ${count} 题`);
    }
    if (picked.length === 0) throw new BadRequestException('暂无考试题目');
    const attempt = await this.attempts.save(
      this.attempts.create({
        tenantId: user.tenantId,
        userId: user.userId,
        courseId: dto.courseId ?? null,
        category,
        questionIds: picked.map((q) => q.id),
        answers: {},
        total: picked.length,
        status: 'in_progress',
      }),
    );
    await this.activity.record(user, 'exam_start', 'exam_attempt', attempt.id, {
      category,
      courseId: dto.courseId ?? null,
      total: picked.length,
    });
    return {
      attemptId: attempt.id,
      total: picked.length,
      questions: picked.map((q) => ({ id: q.id, type: q.type, stem: q.stem, options: q.options })),
    };
  }

  private async pickExamQuestions(
    user: AuthUser,
    dto: Pick<StartExamDto, 'courseId' | 'category'>,
    count: number,
  ): Promise<PublicQuestion[]> {
    // Start exam used to read the full question table on every request; use the boot-time pool cache instead.
    const pool = await this.questionPool.getQuestions(user.tenantId, {
      usage: 'exam',
      ...(dto.courseId ? { courseId: dto.courseId } : {}),
      ...(dto.category ? { category: dto.category } : {}),
      reloadIfEmpty: true,
    });
    const target = this.sanitizeCount(count);
    const wrongQuestionIds = await this.loadOpenStudyWrongQuestionIds(user, pool);
    const wrongSet = new Set(wrongQuestionIds);
    const wrongPool = pool.filter((q) => wrongSet.has(q.id));
    const wrongTarget = wrongPool.length > 0 ? Math.max(1, Math.floor(target * WRONG_QUESTION_RATIO)) : 0;
    const pickedWrong = this.shuffle(wrongPool).slice(0, Math.min(wrongTarget, target));
    const pickedIds = new Set(pickedWrong.map((q) => q.id));
    const randomPool = pool.filter((q) => !wrongSet.has(q.id));
    const pickedRandom = this.shuffle(randomPool).slice(0, Math.max(0, target - pickedWrong.length));
    pickedRandom.forEach((q) => pickedIds.add(q.id));
    const fallbackWrong = wrongPool.filter((q) => !pickedIds.has(q.id)).slice(0, Math.max(0, target - pickedWrong.length - pickedRandom.length));
    return this.shuffle([...pickedWrong, ...pickedRandom, ...fallbackWrong]);
  }

  // 交卷判分:按锁定的 questionIds 逐题比对,算分(百分制),落库,返回逐题对错 + 正确答案。
  async submit(
    user: AuthUser,
    attemptId: string,
    answers: Record<string, string>,
  ): Promise<{ score: number; correct: number; total: number; details: GradedItem[] }> {
    const attempt = await this.attempts.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, id: attemptId },
    });
    if (!attempt) throw new NotFoundException('考试记录不存在');
    if (attempt.status === 'submitted') throw new BadRequestException('该试卷已交卷');

    const qs = await this.questions.find({
      where: { tenantId: user.tenantId, id: In(attempt.questionIds) },
    });
    const byId = new Map(qs.map((q) => [q.id, q]));

    const normalized: Record<string, string> = {};
    const details: GradedItem[] = [];
    let correct = 0;
    // 按卷面顺序判分,保证复盘顺序稳定。
    for (const qid of attempt.questionIds) {
      const q = byId.get(qid);
      if (!q) continue; // 题被删:跳过,不计入对错
      const your = normalize(answers[qid] ?? '');
      normalized[qid] = your;
      const isCorrect = your === q.answer;
      if (isCorrect) {
        correct++;
      }
      details.push({
        questionId: qid,
        category: q.category,
        stem: q.stem,
        options: q.options,
        imageUrls: q.imageUrls ?? [],
        yourAnswer: your,
        correctAnswer: q.answer,
        analysis: q.analysis,
        isCorrect,
      });
    }
    const total = attempt.total;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;

    await this.attempts.update(attempt.id, {
      answers: normalized,
      correct,
      score,
      status: 'submitted',
      submittedAt: new Date(),
    });

    await this.syncQuestionPractice(user, details);
    await this.activity.record(user, 'exam_submit', 'exam_attempt', attempt.id, {
      total,
      correct,
      score,
    });

    return { score, correct, total, details };
  }

  private sanitizeCount(value: number): number {
    return Math.max(1, Math.min(MAX_COUNT, Math.trunc(value)));
  }

  private sanitizeCategoryCounts(raw: Record<string, number>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [category, value] of Object.entries(raw)) {
      if (!category.trim() || !Number.isFinite(Number(value))) continue;
      counts[category] = this.sanitizeCount(Number(value));
    }
    return counts;
  }

  private async loadOpenStudyWrongQuestionIds(user: AuthUser, pool: Array<Pick<Question, 'id'>>): Promise<string[]> {
    const ids = pool.map((q) => q.id);
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    const wrongs = await this.wrongBookRepo.find({
      where: { tenantId: user.tenantId, userId: user.userId, status: 'open', source: 'study' },
      select: ['questionId', 'wrongCount', 'lastWrongAt'],
      order: { wrongCount: 'DESC', lastWrongAt: 'DESC' },
    });
    return wrongs.map((w) => w.questionId).filter((id) => idSet.has(id));
  }

  private async syncQuestionPractice(user: AuthUser, details: GradedItem[]): Promise<void> {
    const now = new Date();
    for (const item of details) {
      await this.recordQuestionPractice(user, item.questionId, item.isCorrect, now);
    }
  }

  private async recordQuestionPractice(
    user: AuthUser,
    questionId: string,
    isCorrect: boolean,
    now: Date,
  ): Promise<void> {
    // 原来是先查再 save，并发提交同一题时可能丢计数；改为数据库原子累加。
    if (await this.bumpQuestionPractice(user, questionId, isCorrect, now)) return;
    try {
      await this.practices.save(
        this.practices.create({
          tenantId: user.tenantId,
          userId: user.userId,
          questionId,
          seenCount: 1,
          correctCount: isCorrect ? 1 : 0,
          wrongCount: isCorrect ? 0 : 1,
          lastSeenAt: now,
          lastCorrectAt: isCorrect ? now : null,
          lastWrongAt: isCorrect ? null : now,
        }),
      );
    } catch (e) {
      if (!(e instanceof QueryFailedError)) throw e;
      await this.bumpQuestionPractice(user, questionId, isCorrect, now);
    }
  }

  private async bumpQuestionPractice(
    user: AuthUser,
    questionId: string,
    isCorrect: boolean,
    now: Date,
  ): Promise<boolean> {
    const col = (name: string) => this.quotePracticeColumn(name);
    const result = await this.practices
      .createQueryBuilder()
      .update(QuestionPractice)
      .set({
        seenCount: () => `${col('seenCount')} + 1`,
        correctCount: () => (isCorrect ? `${col('correctCount')} + 1` : col('correctCount')),
        wrongCount: () => (isCorrect ? col('wrongCount') : `${col('wrongCount')} + 1`),
        lastSeenAt: now,
        ...(isCorrect ? { lastCorrectAt: now } : { lastWrongAt: now }),
      } as any)
      .where({ tenantId: user.tenantId, userId: user.userId, questionId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private quotePracticeColumn(name: string): string {
    const type = this.practices.manager.connection.options.type;
    return type === 'mysql' || type === 'mariadb' ? `\`${name}\`` : `"${name}"`;
  }

  // 录入/累加单条错题。首次插入若撞唯一索引(并发交卷),回退为计数更新,避免 500。
  private async recordWrong(
    user: AuthUser,
    questionId: string,
    source: WrongQuestionSource,
    now: Date,
  ): Promise<void> {
    const bump = async (): Promise<boolean> => {
      const row = await this.wrongBookRepo.findOne({
        where: { tenantId: user.tenantId, userId: user.userId, questionId, source },
      });
      if (!row) return false;
      await this.wrongBookRepo.update(row.id, {
        wrongCount: row.wrongCount + 1,
        status: 'open',
        lastWrongAt: now,
      });
      return true;
    };
    if (await bump()) return;
    try {
      await this.wrongBookRepo.save(
        this.wrongBookRepo.create({
          tenantId: user.tenantId,
          userId: user.userId,
          questionId,
          source,
          wrongCount: 1,
          status: 'open',
          lastWrongAt: now,
        }),
      );
    } catch (e) {
      // 并发已插入同一 (tenant,user,question,source):唯一冲突 → 回退为计数更新。
      if (e instanceof QueryFailedError) {
        await bump();
      } else {
        throw e;
      }
    }
  }

  // 顺序学习答错后录入错题本。服务端复核答案,避免客户端误报或伪造错题。
  async recordStudyWrong(user: AuthUser, questionId: string, answer: string): Promise<{ ok: true; recorded: boolean }> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id: questionId } });
    if (!q) throw new NotFoundException('题目不存在');
    const now = new Date();
    const isCorrect = normalize(answer) === q.answer;
    await this.saveStudyProgress(user, q, now);
    await this.recordQuestionPractice(user, questionId, isCorrect, now);
    if (isCorrect) return { ok: true, recorded: false };
    await this.recordWrong(user, questionId, 'study', now);
    return { ok: true, recorded: true };
  }

  async recordStudyProgress(user: AuthUser, questionId: string): Promise<{ ok: true }> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id: questionId } });
    if (!q) throw new NotFoundException('题目不存在');
    await this.saveStudyProgress(user, q, new Date());
    return { ok: true };
  }

  async recordStudyStart(user: AuthUser, dto: StudyStartDto): Promise<{ ok: true }> {
    await this.activity.record(user, 'study_progress', 'study_category', null, {
      category: dto.category?.trim() || null,
      courseId: dto.courseId?.trim() || null,
    });
    return { ok: true };
  }

  // 顺序学习进度只更新游标,不写错题和行为日志。
  private async saveStudyProgress(user: AuthUser, q: Question, now: Date): Promise<void> {
    await this.studyProgress.upsert(
      {
        tenantId: user.tenantId,
        userId: user.userId,
        category: q.category,
        courseId: q.courseId ?? '',
        questionId: q.id,
        lastStudiedAt: now,
      },
      ['tenantId', 'userId', 'category', 'courseId'],
    );
  }

  // 错题本列表:默认只看未掌握(open),带题目详情供复习。
  async wrongBook(user: AuthUser): Promise<WrongBookItem[]> {
    const rows = await this.wrongBookRepo.find({
      where: { tenantId: user.tenantId, userId: user.userId, status: 'open', source: 'study' },
      order: { lastWrongAt: 'DESC' },
      take: 200,
    });
    if (rows.length === 0) return [];
    const qs = await this.questions.find({
      where: { tenantId: user.tenantId, id: In(rows.map((r) => r.questionId)) },
    });
    const byId = new Map(qs.map((q) => [q.id, q]));
    const items: WrongBookItem[] = [];
    for (const r of rows) {
      const q = byId.get(r.questionId);
      if (!q) continue; // 题已删,跳过
      items.push({
        questionId: q.id,
        category: q.category,
        type: q.type,
        stem: q.stem,
        options: q.options,
        imageUrls: q.imageUrls ?? [],
        answer: q.answer,
        analysis: q.analysis,
        wrongCount: r.wrongCount,
        source: r.source,
        lastWrongAt: r.lastWrongAt,
      });
    }
    return items;
  }

  // 手动标记已掌握:从错题本移出。
  async master(user: AuthUser, questionId: string, source: WrongQuestionSource = 'study'): Promise<{ ok: boolean }> {
    const row = await this.wrongBookRepo.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, questionId, source },
    });
    if (!row) throw new NotFoundException('错题不存在');
    await this.wrongBookRepo.update(row.id, { status: 'mastered' });
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id: questionId } });
    await this.activity.record(user, 'wrong_question_master', 'wrong_question', null, {
      category: q?.category ?? null,
      courseId: q?.courseId ?? null,
      source,
    });
    return { ok: true };
  }

  // 历史成绩列表(摘要)。
  async history(user: AuthUser): Promise<ExamAttempt[]> {
    return this.attempts.find({
      where: { tenantId: user.tenantId, userId: user.userId, status: 'submitted', deletedAt: IsNull() },
      order: { submittedAt: 'DESC' },
      take: 50,
    });
  }

  async deleteAttempt(user: AuthUser, attemptId: string): Promise<{ deleted: boolean }> {
    const attempt = await this.attempts.findOne({
      where: {
        tenantId: user.tenantId,
        userId: user.userId,
        id: attemptId,
        status: 'submitted',
        deletedAt: IsNull(),
      },
    });
    if (!attempt) throw new NotFoundException('考试记录不存在');
    await this.attempts.update(attempt.id, { deletedAt: new Date() });
    await this.activity.record(user, 'exam_delete', 'exam_attempt', attempt.id, {
      category: attempt.category,
      total: attempt.total,
      score: attempt.score,
    });
    return { deleted: true };
  }

  // 考试回顾:根据已交卷记录重建逐题对错 + 正确答案 + 解析(用于复盘)。
  async review(
    user: AuthUser,
    attemptId: string,
  ): Promise<{ score: number; correct: number; total: number; submittedAt: Date | null; details: GradedItem[] }> {
    const attempt = await this.attempts.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, id: attemptId, deletedAt: IsNull() },
    });
    if (!attempt) throw new NotFoundException('考试记录不存在');
    if (attempt.status !== 'submitted') throw new BadRequestException('该试卷尚未交卷');

    const qs = await this.questions.find({
      where: { tenantId: user.tenantId, id: In(attempt.questionIds) },
    });
    const byId = new Map(qs.map((q) => [q.id, q]));
    const details: GradedItem[] = [];
    for (const qid of attempt.questionIds) {
      const q = byId.get(qid);
      if (!q) continue; // 题已删,跳过
      const your = attempt.answers[qid] ?? '';
      details.push({
        questionId: qid,
        category: q.category,
        stem: q.stem,
        options: q.options,
        imageUrls: q.imageUrls ?? [],
        yourAnswer: your,
        correctAnswer: q.answer,
        analysis: q.analysis,
        isCorrect: your === q.answer,
      });
    }
    return {
      score: attempt.score,
      correct: attempt.correct,
      total: attempt.total,
      submittedAt: attempt.submittedAt,
      details,
    };
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 按各科目(M1 等)比例跨专题抽样组卷:每个科目按其占比分配题数,
  // 四舍五入后多退少补到目标 count,最后整体打乱。
  private sampleByCategory(pool: Question[], count: number): Question[] {
    const groups = new Map<string, Question[]>();
    for (const q of pool) {
      const k = q.category || '(未分类)';
      const arr = groups.get(k) ?? [];
      arr.push(q);
      groups.set(k, arr);
    }
    const total = pool.length;
    const picked: Question[] = [];
    const leftovers: Question[] = [];
    for (const arr of groups.values()) {
      const shuffled = this.shuffle(arr);
      const alloc = Math.min(arr.length, Math.round((count * arr.length) / total));
      picked.push(...shuffled.slice(0, alloc));
      leftovers.push(...shuffled.slice(alloc));
    }
    if (picked.length < count) {
      picked.push(...this.shuffle(leftovers).slice(0, count - picked.length));
    }
    return this.shuffle(picked).slice(0, count);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('exams')
export class ExamController {
  constructor(private readonly svc: ExamService) {}

  @Post('start')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartExamDto) {
    return this.svc.start(user, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitExamDto) {
    return this.svc.submit(user, id, dto.answers);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.svc.history(user);
  }

  // 考试回顾(某次已交卷试卷的逐题复盘)。
  @Get(':id/review')
  review(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.review(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteAttempt(user, id);
  }

  // 错题本(只看未掌握)。
  @Get('wrong-book')
  wrongBook(@CurrentUser() user: AuthUser) {
    return this.svc.wrongBook(user);
  }

  @Post('study/start')
  studyStart(@CurrentUser() user: AuthUser, @Body() dto: StudyStartDto) {
    return this.svc.recordStudyStart(user, dto);
  }

  @Post('study/progress')
  studyProgress(@CurrentUser() user: AuthUser, @Body() dto: StudyProgressDto) {
    return this.svc.recordStudyProgress(user, dto.questionId);
  }

  // 顺序学习答错时录入错题本。
  @Post('wrong-book/study')
  recordStudyWrong(@CurrentUser() user: AuthUser, @Body() dto: StudyWrongDto) {
    return this.svc.recordStudyWrong(user, dto.questionId, dto.answer);
  }

  // 标记某题已掌握,移出错题本。
  @Post('wrong-book/:questionId/master')
  master(@CurrentUser() user: AuthUser, @Param('questionId') questionId: string, @Body() dto: MasterWrongDto) {
    return this.svc.master(user, questionId, dto.source);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/exam/rule')
export class ExamRuleAdminController {
  constructor(private readonly svc: ExamService) {}

  @Get()
  get(@CurrentUser() admin: AuthUser) {
    return this.svc.getRule(admin.tenantId);
  }

  @Patch()
  update(@CurrentUser() admin: AuthUser, @Body() dto: UpdateExamRuleDto) {
    return this.svc.updateRule(admin, dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Question, ExamAttempt, WrongQuestion, QuestionPractice, ExamPaperRule, StudyQuestionProgress, AdminOperationLog]),
    QuestionPoolCacheModule,
    UserActivityModule,
  ],
  controllers: [ExamController, ExamRuleAdminController],
  providers: [ExamService],
})
export class ExamModule {}

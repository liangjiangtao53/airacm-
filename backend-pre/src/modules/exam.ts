import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { ExamAttempt, Question, QuestionOption, WrongQuestion } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';

const DEFAULT_COUNT = 10;
const MAX_COUNT = 100;

class StartExamDto {
  @IsOptional()
  @IsString()
  courseId?: string;

  // 按科目组卷(可空=全科目混合)。
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_COUNT)
  count?: number;
}

class SubmitExamDto {
  // {questionId: 'A' | 'AC'}。内层键值在 service 里规范化校验。
  @IsObject()
  answers!: Record<string, string>;
}

// 卷面题目(不含答案/解析)。
interface PaperQuestion {
  id: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls: string[];
}

interface GradedItem {
  questionId: string;
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
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls: string[];
  answer: string;
  analysis: string;
  wrongCount: number;
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
  ) {}

  // 组卷:从 usage 含 exam 的题池随机抽 count 道,建作答记录,返回不含答案的卷面。
  async start(
    user: AuthUser,
    dto: StartExamDto,
  ): Promise<{ attemptId: string; total: number; questions: PaperQuestion[] }> {
    const where: Record<string, unknown> = { tenantId: user.tenantId, usage: In(['exam', 'both']) };
    if (dto.courseId) where.courseId = dto.courseId;
    if (dto.category) where.category = dto.category;

    const pool = await this.questions.find({ where });
    if (pool.length === 0) throw new BadRequestException('暂无考试题目');

    const count = dto.count ?? DEFAULT_COUNT;
    // 指定了科目→就从该科目随机抽;未指定→按各科目(M1 等)比例跨专题抽样。
    const picked = dto.category ? this.shuffle(pool).slice(0, count) : this.sampleByCategory(pool, count);
    const attempt = await this.attempts.save(
      this.attempts.create({
        tenantId: user.tenantId,
        userId: user.userId,
        courseId: dto.courseId ?? null,
        questionIds: picked.map((q) => q.id),
        answers: {},
        total: picked.length,
        status: 'in_progress',
      }),
    );
    return {
      attemptId: attempt.id,
      total: picked.length,
      questions: picked.map((q) => ({ id: q.id, type: q.type, stem: q.stem, options: q.options, imageUrls: q.imageUrls ?? [] })),
    };
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
    const wrongIds: string[] = [];
    const correctIds: string[] = [];
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
        correctIds.push(qid);
      } else {
        wrongIds.push(qid);
      }
      details.push({
        questionId: qid,
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

    await this.syncWrongBook(user, wrongIds, correctIds);

    return { score, correct, total, details };
  }

  // 同步错题本:答错的题录入/累加(置 open),答对且已在本中的题置 mastered。
  private async syncWrongBook(
    user: AuthUser,
    wrongIds: string[],
    correctIds: string[],
  ): Promise<void> {
    const now = new Date();
    for (const qid of wrongIds) {
      await this.recordWrong(user, qid, now);
    }
    if (correctIds.length > 0) {
      // 答对则标记已掌握(仅影响本中已有记录)。
      await this.wrongBookRepo.update(
        { tenantId: user.tenantId, userId: user.userId, questionId: In(correctIds), status: 'open' },
        { status: 'mastered' },
      );
    }
  }

  // 录入/累加单条错题。首次插入若撞唯一索引(并发交卷),回退为计数更新,避免 500。
  private async recordWrong(user: AuthUser, questionId: string, now: Date): Promise<void> {
    const bump = async (): Promise<boolean> => {
      const row = await this.wrongBookRepo.findOne({
        where: { tenantId: user.tenantId, userId: user.userId, questionId },
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
          wrongCount: 1,
          status: 'open',
          lastWrongAt: now,
        }),
      );
    } catch (e) {
      // 并发已插入同一 (tenant,user,question):唯一冲突 → 回退为计数更新。
      if (e instanceof QueryFailedError) {
        await bump();
      } else {
        throw e;
      }
    }
  }

  // 错题本列表:默认只看未掌握(open),带题目详情供复习。
  async wrongBook(user: AuthUser): Promise<WrongBookItem[]> {
    const rows = await this.wrongBookRepo.find({
      where: { tenantId: user.tenantId, userId: user.userId, status: 'open' },
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
        type: q.type,
        stem: q.stem,
        options: q.options,
        imageUrls: q.imageUrls ?? [],
        answer: q.answer,
        analysis: q.analysis,
        wrongCount: r.wrongCount,
        lastWrongAt: r.lastWrongAt,
      });
    }
    return items;
  }

  // 手动标记已掌握:从错题本移出。
  async master(user: AuthUser, questionId: string): Promise<{ ok: boolean }> {
    const row = await this.wrongBookRepo.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, questionId },
    });
    if (!row) throw new NotFoundException('错题不存在');
    await this.wrongBookRepo.update(row.id, { status: 'mastered' });
    return { ok: true };
  }

  // 历史成绩列表(摘要)。
  async history(user: AuthUser): Promise<ExamAttempt[]> {
    return this.attempts.find({
      where: { tenantId: user.tenantId, userId: user.userId, status: 'submitted' },
      order: { submittedAt: 'DESC' },
      take: 50,
    });
  }

  // 考试回顾:根据已交卷记录重建逐题对错 + 正确答案 + 解析(用于复盘)。
  async review(
    user: AuthUser,
    attemptId: string,
  ): Promise<{ score: number; correct: number; total: number; submittedAt: Date | null; details: GradedItem[] }> {
    const attempt = await this.attempts.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, id: attemptId },
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

  // 错题本(只看未掌握)。
  @Get('wrong-book')
  wrongBook(@CurrentUser() user: AuthUser) {
    return this.svc.wrongBook(user);
  }

  // 标记某题已掌握,移出错题本。
  @Post('wrong-book/:questionId/master')
  master(@CurrentUser() user: AuthUser, @Param('questionId') questionId: string) {
    return this.svc.master(user, questionId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Question, ExamAttempt, WrongQuestion])],
  controllers: [ExamController],
  providers: [ExamService],
})
export class ExamModule {}

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
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import type { Dirent } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'path';
import * as XLSX from 'xlsx';
import {
  AdminOperationLog,
  Comment,
  ExamAttempt,
  Question,
  QuestionCategoryEntity,
  QuestionCategoryGeneration,
  QuestionImportBatch,
  QuestionOption,
  QuestionPractice,
  QuestionUsage,
  QUESTION_CATEGORIES,
  StudyQuestionProgress,
  User,
  WrongQuestion,
} from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { env } from '../config';
import { AdaptiveQuestionState, orderAdaptiveQuestions } from './question-picking';
import { QuestionPoolCacheModule, QuestionPoolCacheService } from './question-pool-cache';
import { WechatMiniProgramModule, WechatMiniProgramService } from './wechat-mini-program';

// 上传文件最小形状(避免引入 @types/multer)。FileInterceptor 默认内存存储提供 buffer。
interface UploadedQuestionFile {
  buffer: Buffer;
  originalname: string;
}

const USAGES: QuestionUsage[] = ['study', 'exam', 'both'];
// 模板表头(下载用)。解析按表头名匹配,不依赖列序,兼容真实文件(序号/参考答案/3选项等)。
const TEMPLATE_HEADER = ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'] as const;
const PDF_IMPORT_HEADER = ['题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '选项G', '选项H', '答案', '解析'] as const;
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const STEM_HEADERS = ['题干', '题目', '问题'];
const ANSWER_HEADERS = ['参考答案', '答案', '正确答案'];
const ANALYSIS_HEADERS = ['解析', '原文解析', '答案解析', '说明', '备注'];
const OBSOLETE_QUESTION_CATEGORIES = ['M9 new'];
const M1_CATEGORY = 'M1 航空概论';
const M1_CONFIRM_PHRASE = '发布M1 1698题';
const M1_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const M1_POLICY = {
  category: M1_CATEGORY,
  usage: 'both' as QuestionUsage,
  chapters: [
    { name: '第1章', count: 331 },
    { name: '第2章', count: 287 },
    { name: '第3章', count: 245 },
    { name: '第4章', count: 400 },
    { name: '第5章', count: 180 },
    { name: '第6章', count: 150 },
    { name: '第7章', count: 105 },
  ],
  total: 1698,
  imageCells: 23,
} as const;

type PdfSection = 'stem' | 'option' | 'afterAnswer' | 'analysis';

interface PdfQuestionDraft {
  no: string;
  stemParts: string[];
  options: Partial<Record<(typeof OPTION_LETTERS)[number], string[]>>;
  answer: string;
  analysisParts: string[];
  section: PdfSection;
  optionKey?: (typeof OPTION_LETTERS)[number];
}

class ImportQuery {
  // 整批用途:导入时下拉选(仅学习/仅考试/两者)。
  @IsIn(USAGES)
  usage!: QuestionUsage;

  // 科目(QUESTION_CATEGORIES 之一)。可空(未分类)。
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  courseId?: string;
}

class ListQuery {
  @IsOptional()
  @IsIn(USAGES)
  usage?: QuestionUsage;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  chapter?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  // 题干关键词搜索(在当前 usage/科目范围内模糊匹配题干)。
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

class CreateCommentDto {
  @IsString()
  @IsNotEmpty({ message: '评论不能为空' })
  @MaxLength(500, { message: '评论过长' })
  content!: string;
}

// 管理端列题:按科目 + 题干关键词搜索,分页。category 可为任意值(含空串=未分类)。
class AdminListQuery {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class BatchDeleteDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

class DeleteConfirmQuery {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  chapter?: string;

  @IsOptional()
  @IsString()
  confirm?: string;
}

class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsIn(['single', 'multiple'])
  type?: 'single' | 'multiple';

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '题干不能为空' })
  stem?: string;

  @IsOptional()
  @IsArray()
  options?: QuestionOption[];

  @IsOptional()
  @IsString()
  answer?: string;

  @IsOptional()
  @IsString()
  analysis?: string;

  @IsOptional()
  @IsIn(USAGES)
  usage?: QuestionUsage;
}

class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: '类别名称不能为空' })
  @MaxLength(50, { message: '类别名称过长' })
  name!: string;
}

class RenameCategoryDto {
  @IsString()
  @IsNotEmpty({ message: '类别名称不能为空' })
  @MaxLength(50, { message: '类别名称过长' })
  name!: string;
}

interface ImportFailure {
  row: number; // Excel 行号(含表头,从 1 计)
  reason: string;
}

interface ExtractedImage {
  ext: string;
  buffer: Buffer;
  colIndex?: number;
}

class M1PublishDto {
  @IsString()
  confirm!: string;
}

interface ParsedImportFile {
  rows: unknown[][];
  rowImages: Map<number, ExtractedImage[]>;
  fileName: string;
  fileHash: string;
}

interface ParsedM1Chapter {
  name: string;
  order: number;
  rows: unknown[][];
  rowImages: Map<number, ExtractedImage[]>;
  plan: { toSave: ImportPlanRow[]; failed: ImportFailure[]; colMap: ImportColumnMap };
}

interface ParsedM1Workbook {
  fileName: string;
  fileHash: string;
  chapters: ParsedM1Chapter[];
  totalRows: number;
  imageCells: number;
  duplicateStems: number;
}

interface M1ChapterPreview {
  name: string;
  order: number;
  questionCount: number;
  imageCells: number;
  first: { stem: string; answer: string; options: QuestionOption[]; analysis: string; stemImageUrls: string[]; imageUrls: string[] };
  last: { stem: string; answer: string; options: QuestionOption[]; analysis: string; stemImageUrls: string[]; imageUrls: string[] };
  imageSamples: Array<{ questionOrder: number; stem: string; stemImageUrls: string[]; imageUrls: string[] }>;
}

interface M1PreviewData {
  batchId: string;
  category: typeof M1_CATEGORY;
  fileName: string;
  fileHash: string;
  totalRows: number;
  imageCells: number;
  duplicateStems: number;
  warnings: string[];
  chapters: M1ChapterPreview[];
  confirmPhrase: string;
  expiresAt: string;
  publishedGeneration?: number;
  publishedAt?: string;
}

interface ImportPlanRow {
  rowIndex: number;
  parsed: {
    stem: string;
    options: QuestionOption[];
    answer: string;
    analysis: string;
  };
}

interface ImportColumnMap {
  stem: number;
  answer: number;
  analysis: number;
  options: Array<{ key: string; idx: number }>;
}

interface QuestionPracticeSummary {
  seenCount: number;
  correctCount: number;
  wrongCount: number;
}

type PublicQuestionItem = Omit<Question, 'answer' | 'analysis' | 'importBatchId' | 'imageUrls'> & {
  imageUrls?: string[];
  practice: QuestionPracticeSummary;
};

@Injectable()
export class QuestionService {
  private readonly questionListCountCache = new Map<string, { total: number; expiresAt: number }>();
  private readonly questionListCountInFlight = new Map<string, Promise<number>>();
  private readonly questionListCountTtlMs = 30_000;

  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    @InjectRepository(QuestionCategoryEntity)
    private readonly categories: Repository<QuestionCategoryEntity>,
    @InjectRepository(QuestionCategoryGeneration)
    private readonly generations: Repository<QuestionCategoryGeneration>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ExamAttempt) private readonly attempts: Repository<ExamAttempt>,
    @InjectRepository(WrongQuestion) private readonly wrongBookRepo: Repository<WrongQuestion>,
    @InjectRepository(QuestionPractice) private readonly practices: Repository<QuestionPractice>,
    @InjectRepository(StudyQuestionProgress) private readonly studyProgress: Repository<StudyQuestionProgress>,
    @InjectRepository(QuestionImportBatch) private readonly importBatches: Repository<QuestionImportBatch>,
    @InjectRepository(AdminOperationLog) private readonly operationLogs: Repository<AdminOperationLog>,
    private readonly questionPool: QuestionPoolCacheService,
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

  private clearQuestionListCountCache(tenantId: string): void {
    for (const key of this.questionListCountCache.keys()) {
      if (key.startsWith(`${tenantId}|`)) this.questionListCountCache.delete(key);
    }
  }

  private async refreshQuestionCaches(tenantId: string): Promise<void> {
    this.clearQuestionListCountCache(tenantId);
    await this.questionPool.refreshTenant(tenantId);
  }

  private async cachedQuestionListTotal(cacheKey: string, loader: () => Promise<number>): Promise<number> {
    const now = Date.now();
    const cached = this.questionListCountCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.total;
    const inFlight = this.questionListCountInFlight.get(cacheKey);
    if (inFlight) return inFlight;
    const promise = loader()
      .then((total) => {
        this.questionListCountCache.set(cacheKey, { total, expiresAt: Date.now() + this.questionListCountTtlMs });
        return total;
      })
      .finally(() => {
        this.questionListCountInFlight.delete(cacheKey);
      });
    this.questionListCountInFlight.set(cacheKey, promise);
    return promise;
  }

  private questionListIndex(q: ListQuery): string {
    if (q.category !== undefined && q.chapter !== undefined) return 'IDX_question_tenant_category_chapter_order';
    if (q.category !== undefined) return 'IDX_question_tenant_category_order';
    if (q.courseId) return 'IDX_question_tenant_course_order';
    return 'IDX_question_tenant_order';
  }

  private normalizeCategoryName(name: string): string {
    return name.trim();
  }

  private assertOrdinaryMutationAllowed(category: string | undefined, action: string): void {
    if (category?.trim() === M1_CATEGORY) {
      throw new ConflictException(`M1 为整包管理科目，${action}请使用“校验并准备发布”流程`);
    }
  }

  private async currentGeneration(tenantId: string, category: string): Promise<number> {
    const row = await this.generations.findOne({ where: { tenantId, category }, select: ['generation'] });
    return row?.generation ?? 1;
  }

  private async ensureGenerationRow(tenantId: string, category: string): Promise<void> {
    if (await this.generations.exist({ where: { tenantId, category } })) return;
    try {
      await this.generations.save(this.generations.create({ tenantId, category, generation: 1 }));
    } catch (error) {
      if (!(await this.generations.exist({ where: { tenantId, category } }))) throw error;
    }
  }

  private async ensureDefaultCategories(tenantId: string): Promise<void> {
    const count = await this.categories.count({ where: { tenantId } });
    if (count > 0) {
      await this.removeObsoleteCategories(tenantId);
      return;
    }
    await this.categories.save(
      QUESTION_CATEGORIES.map((name, order) => this.categories.create({ tenantId, name, order })),
    );
  }

  private async ensureManagedM1Category(tenantId: string): Promise<void> {
    await this.ensureDefaultCategories(tenantId);
    if (await this.categories.exist({ where: { tenantId, name: M1_CATEGORY } })) return;
    const order = await this.categories.count({ where: { tenantId } });
    try {
      await this.categories.save(this.categories.create({ tenantId, name: M1_CATEGORY, order }));
    } catch (error) {
      if (!(await this.categories.exist({ where: { tenantId, name: M1_CATEGORY } }))) throw error;
    }
  }

  private async cleanupExpiredM1Batches(tenantId: string): Promise<void> {
    const [rows, expired, published] = await Promise.all([
      this.importBatches.find({
        where: { tenantId, category: M1_CATEGORY, status: 'previewed', expiresAt: LessThan(new Date()) },
        order: { expiresAt: 'ASC' },
        take: 50,
      }),
      this.importBatches.find({
        where: { tenantId, category: M1_CATEGORY, status: 'expired' },
        order: { expiresAt: 'DESC' },
        take: 50,
      }),
      this.importBatches.find({
        where: { tenantId, category: M1_CATEGORY, status: 'published' },
        order: { publishedAt: 'DESC' },
        take: 50,
      }),
    ]);
    for (const row of rows) {
      if (await this.expireM1Batch(row.id, tenantId)) await this.cleanupM1BatchArtifacts(row.id, false);
    }
    for (const row of expired) await this.cleanupM1BatchArtifacts(row.id, false);
    // 发布内容图片仍可能被历史考试快照引用，保留 content-*；这里只重试清理源文件和 preview-*。
    for (const row of published) await this.cleanupM1BatchArtifacts(row.id, true);
  }

  private async expireM1Batch(batchId: string, tenantId: string): Promise<boolean> {
    return this.questions.manager.transaction(async (manager) => {
      const supportsLocks = !['better-sqlite3', 'sqlite'].includes(String(manager.connection.options.type));
      const batch = await manager.findOne(QuestionImportBatch, {
        where: { id: batchId, tenantId, category: M1_CATEGORY },
        ...(supportsLocks ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      if (batch?.status !== 'previewed' || !batch.expiresAt || batch.expiresAt.getTime() > Date.now()) return false;
      batch.status = 'expired';
      await manager.save(QuestionImportBatch, batch);
      return true;
    });
  }

  private async activateM1PreviewBatch(tenantId: string, batch: QuestionImportBatch): Promise<string[]> {
    return this.questions.manager.transaction(async (manager) => {
      const supportsLocks = !['better-sqlite3', 'sqlite'].includes(String(manager.connection.options.type));
      await manager.findOne(QuestionCategoryGeneration, {
        where: { tenantId, category: M1_CATEGORY },
        ...(supportsLocks ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
      const rows = await manager.find(QuestionImportBatch, {
        where: { tenantId, category: M1_CATEGORY, status: 'previewed' },
        select: ['id'],
      });
      const ids = rows.map((row) => row.id);
      // 新批次在 generation 锁内插入，再淘汰旧批次；并发预检严格按获得锁的顺序只留下最后一个。
      await manager.save(QuestionImportBatch, batch);
      if (ids.length > 0) await manager.update(QuestionImportBatch, { id: In(ids) }, { status: 'expired' });
      return ids;
    });
  }

  private async cleanupM1BatchArtifacts(batchId: string, keepPublishedContent: boolean): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return;
    try {
      await rm(join(resolve(env.questionImportDir), batchId), { recursive: true, force: true });
      const imageDir = join(resolve(env.questionImageDir), batchId);
      if (!keepPublishedContent) {
        await rm(imageDir, { recursive: true, force: true });
        return;
      }
      const files = await readdir(imageDir, { withFileTypes: true }).catch((): Dirent[] => []);
      await Promise.all(
        files
          .filter((entry) => entry.isFile() && entry.name.startsWith('preview-'))
          .map((entry) => rm(join(imageDir, entry.name), { force: true })),
      );
    } catch {
      // 文件清理失败不回滚已提交的题库；下次预检会继续回收过期批次。
    }
  }

  async listCategoryNames(tenantId: string): Promise<string[]> {
    await this.ensureDefaultCategories(tenantId);
    const rows = await this.categories.find({ where: { tenantId }, order: { order: 'ASC', name: 'ASC' } });
    return rows.map((r) => r.name).filter((name) => !OBSOLETE_QUESTION_CATEGORIES.includes(name));
  }

  async listChapters(
    user: AuthUser,
    category: string,
  ): Promise<Array<{ name: string; order: number; questionCount: number; resumeQuestionId: string | null; resumePosition: number; lastStudiedAt: Date | null }>> {
    if (!category.trim()) throw new BadRequestException('category required');
    const generation = await this.currentGeneration(user.tenantId, category);
    const [questions, progressRows] = await Promise.all([
      this.questions.find({
        where: { tenantId: user.tenantId, category, generation },
        select: ['id', 'chapterName', 'chapterOrder', 'chapterQuestionOrder'],
        order: { chapterOrder: 'ASC', chapterQuestionOrder: 'ASC', order: 'ASC' },
      }),
      this.studyProgress.find({
        where: { tenantId: user.tenantId, userId: user.userId, category },
        select: ['chapterName', 'questionId', 'lastStudiedAt'],
      }),
    ]);
    const progress = new Map(progressRows.map((row) => [row.chapterName, row]));
    const grouped = new Map<string, { name: string; order: number; ids: string[] }>();
    for (const question of questions) {
      if (!question.chapterName) continue;
      const row = grouped.get(question.chapterName) ?? { name: question.chapterName, order: question.chapterOrder, ids: [] };
      row.ids.push(question.id);
      grouped.set(question.chapterName, row);
    }
    return [...grouped.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((chapter) => {
        const saved = progress.get(chapter.name);
        const index = saved ? chapter.ids.indexOf(saved.questionId) : -1;
        return {
          name: chapter.name,
          order: chapter.order,
          questionCount: chapter.ids.length,
          resumeQuestionId: index >= 0 ? saved!.questionId : null,
          resumePosition: index >= 0 ? index + 1 : 0,
          lastStudiedAt: index >= 0 ? saved!.lastStudiedAt : null,
        };
      });
  }

  async listManagedCategories(
    user: AuthUser,
  ): Promise<Array<{ id: string; name: string; count: number }>> {
    await this.ensureDefaultCategories(user.tenantId);
    const [rows, stats] = await Promise.all([
      this.categories.find({ where: { tenantId: user.tenantId }, order: { order: 'ASC', name: 'ASC' } }),
      this.statsByCategory(user),
    ]);
    const counts = new Map(stats.map((s) => [s.category === '(未分类)' ? '' : s.category, s.count]));
    return rows
      .filter((r) => !OBSOLETE_QUESTION_CATEGORIES.includes(r.name))
      .map((r) => ({ id: r.id, name: r.name, count: counts.get(r.name) ?? 0 }));
  }

  private async removeObsoleteCategories(tenantId: string): Promise<void> {
    for (const name of OBSOLETE_QUESTION_CATEGORIES) {
      const questionCount = await this.questions.count({ where: { tenantId, category: name } });
      if (questionCount === 0) await this.categories.delete({ tenantId, name });
    }
  }

  async createCategory(user: AuthUser, rawName: string): Promise<{ id: string; name: string; count: number }> {
    const name = this.normalizeCategoryName(rawName);
    if (!name) throw new BadRequestException('类别名称不能为空');
    if (name === '(未分类)' || name === M1_CATEGORY) throw new BadRequestException('该名称为系统保留名称');
    if (OBSOLETE_QUESTION_CATEGORIES.includes(name)) throw new BadRequestException('该类别已停用');
    await this.ensureDefaultCategories(user.tenantId);
    const dup = await this.categories.findOne({ where: { tenantId: user.tenantId, name } });
    if (dup) throw new BadRequestException('类别已存在');
    const order = await this.categories.count({ where: { tenantId: user.tenantId } });
    const row = await this.categories.save(this.categories.create({ tenantId: user.tenantId, name, order }));
    await this.logAdminOperation(user, 'question_category_create', 'question_category', row.id, { name, order });
    return { id: row.id, name: row.name, count: 0 };
  }

  async renameCategory(
    user: AuthUser,
    id: string,
    rawName: string,
  ): Promise<{ id: string; name: string; count: number }> {
    const name = this.normalizeCategoryName(rawName);
    if (!name) throw new BadRequestException('类别名称不能为空');
    if (name === '(未分类)' || name === M1_CATEGORY) throw new BadRequestException('该名称为系统保留名称');
    if (OBSOLETE_QUESTION_CATEGORIES.includes(name)) throw new BadRequestException('该类别已停用');
    const row = await this.categories.findOne({ where: { tenantId: user.tenantId, id } });
    if (!row) throw new NotFoundException('类别不存在');
    if (row.name === M1_CATEGORY) throw new ConflictException('M1 为整包管理科目，不能改名');
    if (row.name === name) return { id: row.id, name: row.name, count: 0 };
    const count = await this.questions.count({ where: { tenantId: user.tenantId, category: row.name } });
    if (count > 0) throw new BadRequestException('该类别下还有题目，请先删除题目后再修改类别');
    const dup = await this.categories.findOne({ where: { tenantId: user.tenantId, name } });
    if (dup && dup.id !== id) throw new BadRequestException('类别已存在');
    await this.categories.update(row.id, { name });
    await this.logAdminOperation(user, 'question_category_rename', 'question_category', row.id, {
      from: row.name,
      to: name,
    });
    return { id: row.id, name, count: 0 };
  }

  async deleteCategory(user: AuthUser, id: string): Promise<{ deleted: number }> {
    const row = await this.categories.findOne({ where: { tenantId: user.tenantId, id } });
    if (!row) throw new NotFoundException('类别不存在');
    if (row.name === M1_CATEGORY) throw new ConflictException('M1 为整包管理科目，不能删除');
    const count = await this.questions.count({ where: { tenantId: user.tenantId, category: row.name } });
    if (count > 0) throw new BadRequestException('该类别下还有题目，请先删除题目后再删除类别');
    const r = await this.categories.delete({ tenantId: user.tenantId, id });
    if ((r.affected ?? 0) > 0) {
      await this.logAdminOperation(user, 'question_category_delete', 'question_category', id, { name: row.name });
    }
    return { deleted: r.affected ?? 0 };
  }

  private async assertCategoryExists(tenantId: string, category: string | undefined): Promise<void> {
    if (!category) return;
    if (OBSOLETE_QUESTION_CATEGORIES.includes(category)) throw new BadRequestException('该类别已停用');
    await this.ensureDefaultCategories(tenantId);
    const exists = await this.categories.exist({ where: { tenantId, name: category } });
    if (!exists) throw new BadRequestException('类别不存在，请先在类别管理中新增');
  }

  // 批量解析 userId→昵称(防 N+1)。查不到回退短 id。
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

  // 按文件扩展名分流。Excel 保持原表头导入,PDF 转成同样的行结构后共用校验入库。
  async importFile(
    admin: AuthUser,
    file: UploadedQuestionFile | undefined,
    usage: QuestionUsage,
    category: string | undefined,
    courseId: string | undefined,
  ): Promise<{ imported: number; failed: ImportFailure[]; batchId: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传题库文件');
    this.assertOrdinaryMutationAllowed(category, '发布');
    await this.assertCategoryExists(admin.tenantId, category);
    const parsedFile = await this.parseImportFile(file);
    return this.importParsedRows(admin, parsedFile, usage, category, courseId);
  }

  // 解析 Excel 并批量入库。逐行校验,失败行收集返回,不静默吞错;成功行照常写入。
  async previewImportFile(
    admin: AuthUser,
    file: UploadedQuestionFile | undefined,
    usage: QuestionUsage,
    category: string | undefined,
    courseId: string | undefined,
  ): Promise<{
    totalRows: number;
    importable: number;
    failed: ImportFailure[];
    duplicateInFile: number;
    duplicateInDatabase: number;
  }> {
    this.assertOrdinaryMutationAllowed(category, '预览');
    await this.assertCategoryExists(admin.tenantId, category);
    const parsedFile = await this.parseImportFile(file);
    const plan = this.buildImportPlan(parsedFile.rows, parsedFile.rowImages);
    const stems = plan.toSave.map((row) => row.parsed.stem);
    return {
      totalRows: Math.max(parsedFile.rows.length - 1, 0),
      importable: plan.toSave.length,
      failed: plan.failed,
      duplicateInFile: this.countDuplicateStems(stems),
      duplicateInDatabase: await this.countExistingStems(admin.tenantId, category ?? '', stems),
    };
  }

  async previewM1Replacement(
    admin: AuthUser,
    file: UploadedQuestionFile | undefined,
  ): Promise<M1PreviewData> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传 M1 Excel 文件');
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('M1 整包发布仅支持 .xlsx 文件');
    }
    if (file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException('M1 Excel 不能超过 5MB');
    await this.ensureManagedM1Category(admin.tenantId);
    await this.cleanupExpiredM1Batches(admin.tenantId);
    // 原先预检批次未记录当时的题库代际，旧预检可能覆盖后来已发布的新题库。
    // 预检时固定代际，发布事务内再核对，确保预检结果只对当时的题库状态有效。
    await this.ensureGenerationRow(admin.tenantId, M1_CATEGORY);
    const generationAtPreview = await this.currentGeneration(admin.tenantId, M1_CATEGORY);
    const parsed = this.parseM1Workbook(file);
    const batchId = randomUUID();
    const batchDir = join(env.questionImportDir, batchId);
    let batchPersisted = false;
    try {
    await mkdir(batchDir, { recursive: true });
    const stagedFilePath = join(batchDir, 'source.xlsx');
    await writeFile(stagedFilePath, file.buffer);

    const chapters: M1ChapterPreview[] = [];
    for (const chapter of parsed.chapters) {
      const firstRow = chapter.plan.toSave[0];
      const lastRow = chapter.plan.toSave[chapter.plan.toSave.length - 1];
      const buildSample = async (row: ImportPlanRow) => {
        const buckets = this.splitRowImagesByUsage(chapter.rowImages.get(row.rowIndex) ?? [], chapter.plan.colMap);
        return {
          stem: row.parsed.stem,
          answer: row.parsed.answer,
          options: row.parsed.options,
          analysis: row.parsed.analysis,
          stemImageUrls: await this.saveQuestionImages(buckets.stem, batchId, 'preview'),
          imageUrls: await this.saveQuestionImages(buckets.analysis, batchId, 'preview'),
        };
      };
      chapters.push({
        name: chapter.name,
        order: chapter.order,
        questionCount: chapter.plan.toSave.length,
        imageCells: [...chapter.rowImages.values()].reduce((sum, images) => sum + images.length, 0),
        first: await buildSample(firstRow),
        last: await buildSample(lastRow),
        imageSamples: await Promise.all(
          chapter.plan.toSave
            .filter((row) => (chapter.rowImages.get(row.rowIndex) ?? []).length > 0)
            .slice(0, 4)
            .map(async (row) => {
              const buckets = this.splitRowImagesByUsage(chapter.rowImages.get(row.rowIndex) ?? [], chapter.plan.colMap);
              return {
                questionOrder: chapter.plan.toSave.indexOf(row) + 1,
                stem: row.parsed.stem,
                stemImageUrls: await this.saveQuestionImages(buckets.stem, batchId, 'preview'),
                imageUrls: await this.saveQuestionImages(buckets.analysis, batchId, 'preview'),
              };
            }),
        ),
      });
    }

    const expiresAt = new Date(Date.now() + M1_PREVIEW_TTL_MS);
    const warnings = parsed.duplicateStems > 0 ? [`检测到 ${parsed.duplicateStems} 个重复题干，按已确认规则全部保留`] : [];
    const preview: M1PreviewData = {
      batchId,
      category: M1_CATEGORY,
      fileName: basename(file.originalname),
      fileHash: parsed.fileHash,
      totalRows: parsed.totalRows,
      imageCells: parsed.imageCells,
      duplicateStems: parsed.duplicateStems,
      warnings,
      chapters,
      confirmPhrase: M1_CONFIRM_PHRASE,
      expiresAt: expiresAt.toISOString(),
    };
    const batch = this.importBatches.create({
        id: batchId,
        tenantId: admin.tenantId,
        importedBy: admin.userId,
        fileName: preview.fileName,
        fileHash: preview.fileHash,
        usage: M1_POLICY.usage,
        category: M1_CATEGORY,
        courseId: null,
        totalRows: preview.totalRows,
        imported: 0,
        failed: 0,
        failures: null,
        status: 'previewed',
        previewData: preview as unknown as Record<string, unknown>,
        stagedFilePath,
        expiresAt,
        publishedAt: null,
        generation: generationAtPreview,
      });
    let superseded: string[];
    try {
      superseded = await this.activateM1PreviewBatch(admin.tenantId, batch);
      batchPersisted = true;
    } catch (error) {
      await this.cleanupM1BatchArtifacts(batchId, false);
      throw error;
    }
    await Promise.all(superseded.map((id) => this.cleanupM1BatchArtifacts(id, false)));
    await this.logAdminOperation(admin, 'question_m1_preflight', 'question_import_batch', batchId, {
      fileName: preview.fileName,
      fileHash: preview.fileHash,
      totalRows: preview.totalRows,
      imageCells: preview.imageCells,
      duplicateStems: preview.duplicateStems,
      chapterCounts: Object.fromEntries(preview.chapters.map((chapter) => [chapter.name, chapter.questionCount])),
      expiresAt: preview.expiresAt,
    });
    return preview;
    } catch (error) {
      if (!batchPersisted) await this.cleanupM1BatchArtifacts(batchId, false);
      throw error;
    }
  }

  async publishM1Replacement(
    admin: AuthUser,
    batchId: string,
    confirm: string,
  ): Promise<{ batchId: string; category: string; imported: number; generation: number; publishedAt: string; idempotent: boolean }> {
    if (confirm !== M1_CONFIRM_PHRASE) throw new BadRequestException('发布确认语不匹配');
    const initial = await this.importBatches.findOne({ where: { id: batchId, tenantId: admin.tenantId, category: M1_CATEGORY } });
    if (!initial) throw new NotFoundException('预检批次不存在');
    if (initial.status === 'published' && initial.generation && initial.publishedAt) {
      await this.cleanupM1BatchArtifacts(batchId, true);
      return {
        batchId,
        category: M1_CATEGORY,
        imported: initial.imported,
        generation: initial.generation,
        publishedAt: initial.publishedAt.toISOString(),
        idempotent: true,
      };
    }
    if (initial.status !== 'previewed') throw new ConflictException('该预检批次当前不可发布');
    if (!initial.expiresAt || initial.expiresAt.getTime() <= Date.now()) {
      // 原先直接 save 事务外读到的旧实体，可能把并发已发布批次覆盖回 expired。
      if (await this.expireM1Batch(batchId, admin.tenantId)) {
        await this.cleanupM1BatchArtifacts(batchId, false);
        throw new GoneException('预检批次已过期，请重新上传校验');
      }
      const latest = await this.importBatches.findOne({ where: { id: batchId, tenantId: admin.tenantId } });
      if (latest?.status === 'published' && latest.generation && latest.publishedAt) {
        return {
          batchId,
          category: M1_CATEGORY,
          imported: latest.imported,
          generation: latest.generation,
          publishedAt: latest.publishedAt.toISOString(),
          idempotent: true,
        };
      }
      throw new ConflictException('预检批次状态已变化，请刷新');
    }
    const stagedPath = resolve(initial.stagedFilePath ?? '');
    const importRoot = resolve(env.questionImportDir);
    if (!stagedPath.startsWith(`${importRoot}${sep}`)) throw new BadRequestException('预检文件路径非法');
    let source: Buffer;
    try {
      source = await readFile(stagedPath);
    } catch {
      throw new GoneException('预检源文件已清理，请重新上传校验');
    }
    if (createHash('sha1').update(source).digest('hex') !== initial.fileHash) {
      throw new ConflictException('预检源文件校验失败，请重新上传');
    }
    const parsed = this.parseM1Workbook({ buffer: source, originalname: initial.fileName });
    const prepared = await this.prepareM1Questions(admin.tenantId, parsed, batchId);
    await this.ensureGenerationRow(admin.tenantId, M1_CATEGORY);

    let result:
      | { batchId: string; category: string; imported: number; generation: number; publishedAt: string; idempotent: boolean }
      | undefined;
    for (let attemptNo = 0; attemptNo < 2; attemptNo += 1) {
      try {
        result = await this.questions.manager.transaction(async (manager) =>
          this.publishM1Transaction(manager, admin, batchId, prepared),
        );
        break;
      } catch (error) {
        if (attemptNo === 0 && this.isDeadlock(error)) continue;
        if (error instanceof GoneException && (await this.expireM1Batch(batchId, admin.tenantId))) {
          await this.cleanupM1BatchArtifacts(batchId, false);
        }
        throw error;
      }
    }
    if (!result) throw new ConflictException('M1 发布未完成，请重试');
    await this.cleanupM1BatchArtifacts(batchId, true);
    await this.refreshQuestionCaches(admin.tenantId);
    return result;
  }

  private parseM1Workbook(file: UploadedQuestionFile): ParsedM1Workbook {
    this.assertSafeXlsxArchive(file.buffer);
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(file.buffer, { type: 'buffer', bookFiles: true, cellFormula: true, cellNF: true, cellText: true });
    } catch {
      throw new BadRequestException('M1 Excel 解析失败');
    }
    const visibleNames = wb.SheetNames.filter((_, index) => (wb.Workbook?.Sheets?.[index]?.Hidden ?? 0) === 0);
    const expectedNames = M1_POLICY.chapters.map((chapter) => chapter.name);
    if (visibleNames.length !== expectedNames.length || visibleNames.some((name, index) => name !== expectedNames[index])) {
      throw new BadRequestException(`M1 工作表必须按顺序为：${expectedNames.join('、')}`);
    }

    const chapters: ParsedM1Chapter[] = [];
    const allStems: string[] = [];
    let totalRows = 0;
    let imageCells = 0;
    for (let order = 0; order < visibleNames.length; order += 1) {
      const name = visibleNames[order];
      const sheet = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false, defval: '' });
      if (rows.length < 2) throw new BadRequestException(`${name} 没有题目数据`);
      const rowImages = this.extractWpsCellImages(wb, sheet);
      const plan = this.buildImportPlan(rows, rowImages);
      const expected = M1_POLICY.chapters[order];
      if (plan.failed.length > 0) {
        const first = plan.failed[0];
        throw new BadRequestException(`${name} 第 ${first.row} 行：${first.reason}`);
      }
      if (plan.toSave.length !== expected.count) {
        throw new BadRequestException(`${name} 题量应为 ${expected.count}，实际为 ${plan.toSave.length}`);
      }
      totalRows += plan.toSave.length;
      imageCells += [...rowImages.values()].reduce((sum, images) => sum + images.length, 0);
      allStems.push(...plan.toSave.map((row) => row.parsed.stem));
      chapters.push({ name, order, rows, rowImages, plan });
    }
    if (totalRows !== M1_POLICY.total) throw new BadRequestException(`M1 总题量应为 ${M1_POLICY.total}，实际为 ${totalRows}`);
    if (imageCells !== M1_POLICY.imageCells) {
      throw new BadRequestException(`M1 图片单元格应为 ${M1_POLICY.imageCells}，实际识别 ${imageCells}`);
    }
    return {
      fileName: basename(file.originalname),
      fileHash: createHash('sha1').update(file.buffer).digest('hex'),
      chapters,
      totalRows,
      imageCells,
      duplicateStems: this.countDuplicateStems(allStems),
    };
  }

  private assertSafeXlsxArchive(buffer: Buffer): void {
    const eocdSignature = 0x06054b50;
    const centralSignature = 0x02014b50;
    const minOffset = Math.max(0, buffer.length - 65_557);
    let eocd = -1;
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
      if (buffer.readUInt32LE(offset) === eocdSignature) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) throw new BadRequestException('M1 Excel 压缩结构无效');
    const entries = buffer.readUInt16LE(eocd + 10);
    const centralSize = buffer.readUInt32LE(eocd + 12);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new BadRequestException('M1 Excel 不支持 ZIP64 格式');
    }
    if (entries > 500 || centralOffset + centralSize > buffer.length) {
      throw new BadRequestException('M1 Excel 压缩内容过大');
    }
    let cursor = centralOffset;
    let totalUncompressed = 0;
    for (let index = 0; index < entries; index += 1) {
      if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== centralSignature) {
        throw new BadRequestException('M1 Excel 压缩目录无效');
      }
      const uncompressed = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      if (uncompressed === 0xffffffff || uncompressed > 10 * 1024 * 1024) {
        throw new BadRequestException('M1 Excel 单项内容过大');
      }
      totalUncompressed += uncompressed;
      if (totalUncompressed > 25 * 1024 * 1024) throw new BadRequestException('M1 Excel 解压后不能超过 25MB');
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    if (cursor > centralOffset + centralSize) throw new BadRequestException('M1 Excel 压缩目录越界');
  }

  private async prepareM1Questions(tenantId: string, parsed: ParsedM1Workbook, batchId: string): Promise<Question[]> {
    const rows: Question[] = [];
    let globalOrder = 0;
    for (const chapter of parsed.chapters) {
      for (let index = 0; index < chapter.plan.toSave.length; index += 1) {
        const row = chapter.plan.toSave[index];
        const buckets = this.splitRowImagesByUsage(chapter.rowImages.get(row.rowIndex) ?? [], chapter.plan.colMap);
        globalOrder += 1;
        rows.push(
          this.questions.create({
            tenantId,
            category: M1_CATEGORY,
            generation: 0,
            chapterName: chapter.name,
            chapterOrder: chapter.order,
            chapterQuestionOrder: index + 1,
            courseId: null,
            type: row.parsed.answer.length > 1 ? 'multiple' : 'single',
            stem: row.parsed.stem,
            stemImageUrls: await this.saveQuestionImages(buckets.stem, batchId),
            options: row.parsed.options,
            answer: row.parsed.answer,
            analysis: row.parsed.analysis,
            imageUrls: await this.saveQuestionImages(buckets.analysis, batchId),
            usage: M1_POLICY.usage,
            order: globalOrder,
            importBatchId: batchId,
          }),
        );
      }
    }
    return rows;
  }

  private async publishM1Transaction(
    manager: EntityManager,
    admin: AuthUser,
    batchId: string,
    prepared: Question[],
  ): Promise<{ batchId: string; category: string; imported: number; generation: number; publishedAt: string; idempotent: boolean }> {
    const supportsLocks = !['better-sqlite3', 'sqlite'].includes(String(manager.connection.options.type));
    const generation = await manager.findOne(QuestionCategoryGeneration, {
      where: { tenantId: admin.tenantId, category: M1_CATEGORY },
      ...(supportsLocks ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!generation) throw new ConflictException('M1 发布代际未初始化，请重试');
    const batch = await manager.findOne(QuestionImportBatch, {
      where: { id: batchId, tenantId: admin.tenantId, category: M1_CATEGORY },
      ...(supportsLocks ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!batch) throw new NotFoundException('预检批次不存在');
    if (batch.status === 'published' && batch.generation && batch.publishedAt) {
      return {
        batchId,
        category: M1_CATEGORY,
        imported: batch.imported,
        generation: batch.generation,
        publishedAt: batch.publishedAt.toISOString(),
        idempotent: true,
      };
    }
    if (batch.status !== 'previewed') throw new ConflictException('预检批次状态已变化，请刷新');
    if (!batch.expiresAt || batch.expiresAt.getTime() <= Date.now()) throw new GoneException('预检批次已过期，请重新上传校验');
    if (batch.generation !== generation.generation) {
      throw new ConflictException('M1 题库已更新，请重新预检后再发布');
    }

    const oldIds = (
      await manager.find(Question, { where: { tenantId: admin.tenantId, category: M1_CATEGORY }, select: ['id'] })
    ).map((row) => row.id);
    const abandoned = await manager.update(
      ExamAttempt,
      { tenantId: admin.tenantId, category: M1_CATEGORY, status: 'in_progress', activeKey: 'active' },
      { abandonedAt: new Date(), activeKey: null },
    );
    if (oldIds.length > 0) {
      await manager.delete(Comment, { tenantId: admin.tenantId, questionId: In(oldIds) });
      await manager.delete(QuestionPractice, { tenantId: admin.tenantId, questionId: In(oldIds) });
      await manager.delete(WrongQuestion, { tenantId: admin.tenantId, questionId: In(oldIds) });
    }
    await manager.delete(StudyQuestionProgress, { tenantId: admin.tenantId, category: M1_CATEGORY });
    await manager.delete(Question, { tenantId: admin.tenantId, category: M1_CATEGORY });

    const nextGeneration = generation.generation + 1;
    prepared.forEach((question) => {
      question.generation = nextGeneration;
    });
    await manager.save(Question, prepared, { chunk: 250 });
    generation.generation = nextGeneration;
    await manager.save(QuestionCategoryGeneration, generation);
    const publishedAt = new Date();
    batch.status = 'published';
    batch.imported = prepared.length;
    batch.failed = 0;
    batch.generation = nextGeneration;
    batch.publishedAt = publishedAt;
    batch.previewData = {
      ...(batch.previewData ?? {}),
      publishedGeneration: nextGeneration,
      publishedAt: publishedAt.toISOString(),
    };
    await manager.save(QuestionImportBatch, batch);
    await manager.save(
      AdminOperationLog,
      this.operationLogs.create({
        tenantId: admin.tenantId,
        adminId: admin.userId,
        action: 'question_m1_publish',
        targetType: 'question_import_batch',
        targetId: batchId,
        detail: {
          oldQuestions: oldIds.length,
          imported: prepared.length,
          abandonedAttempts: abandoned.affected ?? 0,
          generation: nextGeneration,
          chapterCounts: Object.fromEntries(M1_POLICY.chapters.map((chapter) => [chapter.name, chapter.count])),
        },
      }),
    );
    return {
      batchId,
      category: M1_CATEGORY,
      imported: prepared.length,
      generation: nextGeneration,
      publishedAt: publishedAt.toISOString(),
      idempotent: false,
    };
  }

  private isDeadlock(error: unknown): boolean {
    const value = error as { code?: string; errno?: number; driverError?: { code?: string; errno?: number } };
    return (
      value.code === 'ER_LOCK_DEADLOCK' ||
      value.errno === 1213 ||
      value.driverError?.code === 'ER_LOCK_DEADLOCK' ||
      value.driverError?.errno === 1213
    );
  }

  private async parseImportFile(file: UploadedQuestionFile | undefined): Promise<ParsedImportFile> {
    if (!file?.buffer?.length) throw new BadRequestException('question file required');
    const fileName = file.originalname;
    const fileHash = createHash('sha1').update(file.buffer).digest('hex');
    if (fileName.toLowerCase().endsWith('.pdf')) {
      return { rows: await this.parsePdfRows(file.buffer), rowImages: new Map(), fileName, fileHash };
    }

    let rows: unknown[][];
    let rowImages = new Map<number, ExtractedImage[]>();
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer', bookFiles: true, cellFormula: true });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error('empty workbook');
      rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      rowImages = this.extractWpsCellImages(wb, sheet);
    } catch {
      throw new BadRequestException('Excel parse failed');
    }
    if (rows.length < 2) throw new BadRequestException('Excel has no data rows');
    return { rows, rowImages, fileName, fileHash };
  }

  private buildImportPlan(
    rows: unknown[][],
    rowImages = new Map<number, ExtractedImage[]>(),
  ): { toSave: ImportPlanRow[]; failed: ImportFailure[]; colMap: ImportColumnMap } {
    const colMap = this.buildColMap(rows[0]);
    if (colMap.stem < 0) throw new BadRequestException('missing stem column');
    if (colMap.answer < 0) throw new BadRequestException('missing answer column');
    if (colMap.options.length < 2) throw new BadRequestException('missing option columns');

    const failed: ImportFailure[] = [];
    const toSave: ImportPlanRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const parsed = this.parseRow(rows[i], colMap, rowImages.get(i) ?? []);
      if ('error' in parsed) {
        failed.push({ row: i + 1, reason: parsed.error });
        continue;
      }
      toSave.push({ rowIndex: i, parsed });
    }
    return { toSave, failed, colMap };
  }

  private async importParsedRows(
    admin: AuthUser,
    parsedFile: ParsedImportFile,
    usage: QuestionUsage,
    category: string | undefined,
    courseId: string | undefined,
  ): Promise<{ imported: number; failed: ImportFailure[]; batchId: string }> {
    const plan = this.buildImportPlan(parsedFile.rows, parsedFile.rowImages);
    const batchId = randomUUID();
    const batch = this.importBatches.create({
      id: batchId,
      tenantId: admin.tenantId,
      importedBy: admin.userId,
      fileName: parsedFile.fileName,
      fileHash: parsedFile.fileHash,
      usage,
      category: category ?? '',
      courseId: courseId ?? null,
      totalRows: Math.max(parsedFile.rows.length - 1, 0),
      imported: plan.toSave.length,
      failed: plan.failed.length,
      failures: plan.failed,
      status: 'completed',
    });

    const toSave: Question[] = [];
    for (const row of plan.toSave) {
      const rowImageBuckets = this.splitRowImagesByUsage(parsedFile.rowImages.get(row.rowIndex) ?? [], plan.colMap);
      toSave.push(
        this.questions.create({
          tenantId: admin.tenantId,
          category: category ?? '',
          courseId: courseId ?? null,
          type: row.parsed.answer.length > 1 ? 'multiple' : 'single',
          stem: row.parsed.stem,
          stemImageUrls: await this.saveQuestionImages(rowImageBuckets.stem),
          options: row.parsed.options,
          answer: row.parsed.answer,
          analysis: row.parsed.analysis,
          imageUrls: await this.saveQuestionImages(rowImageBuckets.analysis),
          usage,
          order: row.rowIndex,
          importBatchId: batchId,
        }),
      );
    }
    await this.questions.manager.transaction(async (manager) => {
      await manager.save(QuestionImportBatch, batch);
      if (toSave.length) await manager.save(Question, toSave);
      await manager.save(
        AdminOperationLog,
        this.operationLogs.create({
          tenantId: admin.tenantId,
          adminId: admin.userId,
          action: 'question_import',
          targetType: 'question_import_batch',
          targetId: batchId,
          detail: {
            fileName: parsedFile.fileName,
            usage,
            category: category ?? '',
            courseId: courseId ?? null,
            imported: toSave.length,
            failed: plan.failed.length,
          },
        }),
      );
    });
    if (toSave.length) await this.refreshQuestionCaches(admin.tenantId);
    return { imported: toSave.length, failed: plan.failed, batchId };
  }

  private countDuplicateStems(stems: string[]): number {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const stem of stems) {
      if (seen.has(stem)) duplicated.add(stem);
      seen.add(stem);
    }
    return duplicated.size;
  }

  private async countExistingStems(tenantId: string, category: string, stems: string[]): Promise<number> {
    const unique = [...new Set(stems)];
    if (!unique.length) return 0;
    return this.questions.count({ where: { tenantId, category, stem: In(unique) } });
  }

  async importExcel(
    admin: AuthUser,
    file: UploadedQuestionFile | undefined,
    usage: QuestionUsage,
    category: string | undefined,
    courseId: string | undefined,
  ): Promise<{ imported: number; failed: ImportFailure[] }> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传 Excel 文件');

    let rows: unknown[][];
    let rowImages = new Map<number, ExtractedImage[]>();
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer', bookFiles: true, cellFormula: true });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error('空工作簿');
      rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
      rowImages = this.extractWpsCellImages(wb, sheet);
    } catch {
      throw new BadRequestException('Excel 解析失败,请用模板填写');
    }
    if (rows.length < 2) throw new BadRequestException('Excel 无数据行');

    return this.importRows(admin, rows, usage, category, courseId, rowImages);
  }

  private async importRows(
    admin: AuthUser,
    rows: unknown[][],
    usage: QuestionUsage,
    category: string | undefined,
    courseId: string | undefined,
    rowImages = new Map<number, ExtractedImage[]>(),
  ): Promise<{ imported: number; failed: ImportFailure[] }> {
    // 按表头名建列映射,不依赖列序,兼容序号列/参考答案/任意选项数。
    const colMap = this.buildColMap(rows[0]);
    if (colMap.stem < 0) throw new BadRequestException('未找到「题干」列');
    if (colMap.answer < 0) throw new BadRequestException('未找到「答案/参考答案」列');
    if (colMap.options.length < 2) throw new BadRequestException('未找到至少 2 个「选项X」列');

    const failed: ImportFailure[] = [];
    const toSave: Question[] = [];
    for (let i = 1; i < rows.length; i++) {
      const rowNo = i + 1;
      const parsed = this.parseRow(rows[i], colMap, rowImages.get(i) ?? []);
      if ('error' in parsed) {
        failed.push({ row: rowNo, reason: parsed.error });
        continue;
      }
      const rowImageBuckets = this.splitRowImagesByUsage(rowImages.get(i) ?? [], colMap);
      toSave.push(
        this.questions.create({
          tenantId: admin.tenantId,
          category: category ?? '',
          courseId: courseId ?? null,
          type: parsed.answer.length > 1 ? 'multiple' : 'single',
          stem: parsed.stem,
          stemImageUrls: await this.saveQuestionImages(rowImageBuckets.stem),
          options: parsed.options,
          answer: parsed.answer,
          analysis: parsed.analysis,
          imageUrls: await this.saveQuestionImages(rowImageBuckets.analysis),
          usage,
          order: i,
        }),
      );
    }
    if (toSave.length) {
      await this.questions.save(toSave);
      await this.refreshQuestionCaches(admin.tenantId);
    }
    return { imported: toSave.length, failed };
  }

  private async parsePdfRows(buffer: Buffer): Promise<unknown[][]> {
    let text = '';
    // PDF parsing is optional and heavy; load it only for PDF imports so API boot does not depend on canvas polyfills.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      text = result.text;
    } catch {
      throw new BadRequestException('PDF 解析失败,请确认文件不是扫描版或加密文件');
    } finally {
      await parser.destroy();
    }

    const rows: unknown[][] = [PDF_IMPORT_HEADER as unknown as string[]];
    const lines = text
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^-- \d+ of \d+ --$/.test(line) && !/^\d+$/.test(line));

    let current: PdfQuestionDraft | undefined;
    const questionStartRe = /^(\d{1,5})[.．]\s*(.*)$/;
    const optionRe = /^([A-H])[.．]\s*(.*)$/;
    const answerRe = /^(?:南航)?参考答案[:：]\s*([A-H、,，\s]+)$/i;
    const analysisRe = /^答案解析[:：]\s*(.*)$/;

    const append = (parts: string[], value: string): void => {
      const cleaned = value.replace(/\s+/g, ' ').trim();
      if (cleaned) parts.push(cleaned);
    };
    const flush = (): void => {
      if (!current) return;
      const stem = `${current.no}.${current.stemParts.join(' ')}`.trim();
      const options = OPTION_LETTERS.map((key) => current?.options[key]?.join(' ').trim() ?? '');
      const validOptionCount = options.filter(Boolean).length;
      if (stem && current.answer && validOptionCount >= 2) {
        rows.push([stem, ...options, current.answer, current.analysisParts.join(' ').trim()]);
      }
    };

    for (const line of lines) {
      const q = line.match(questionStartRe);
      if (q) {
        flush();
        current = {
          no: q[1],
          stemParts: [],
          options: {},
          answer: '',
          analysisParts: [],
          section: 'stem',
        };
        append(current.stemParts, q[2]);
        continue;
      }
      if (!current) continue;

      const option = line.match(optionRe);
      if (option && OPTION_LETTERS.includes(option[1] as (typeof OPTION_LETTERS)[number])) {
        const key = option[1] as (typeof OPTION_LETTERS)[number];
        current.optionKey = key;
        current.options[key] = current.options[key] ?? [];
        current.section = 'option';
        append(current.options[key], option[2]);
        continue;
      }

      const answer = line.match(answerRe);
      if (answer) {
        current.answer = answer[1].toUpperCase().replace(/[^A-H]/g, '');
        current.section = 'afterAnswer';
        current.optionKey = undefined;
        continue;
      }

      const analysis = line.match(analysisRe);
      if (analysis) {
        current.section = 'analysis';
        current.optionKey = undefined;
        append(current.analysisParts, analysis[1]);
        continue;
      }

      if (current.section === 'stem') append(current.stemParts, line);
      else if (current.section === 'option' && current.optionKey) append(current.options[current.optionKey] ?? [], line);
      else if (current.section === 'analysis') append(current.analysisParts, line);
    }
    flush();

    if (rows.length < 2) throw new BadRequestException('PDF 未识别到题目数据');
    return rows;
  }

  private extractWpsCellImages(wb: XLSX.WorkBook, sheet: XLSX.WorkSheet): Map<number, ExtractedImage[]> {
    const files = (wb as XLSX.WorkBook & { files?: Record<string, { content?: Buffer }> }).files;
    const cellImagesXml = files?.['xl/cellimages.xml']?.content?.toString('utf8') ?? '';
    const relsXml = files?.['xl/_rels/cellimages.xml.rels']?.content?.toString('utf8') ?? '';
    const byName = new Map<string, string>();
    const byRid = new Map<string, string>();

    for (const m of cellImagesXml.matchAll(/<etc:cellImage>[\s\S]*?<xdr:cNvPr[^>]*name="([^"]+)"[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"[\s\S]*?<\/etc:cellImage>/g)) {
      byName.set(m[1], m[2]);
    }
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      byRid.set(m[1], m[2].replace(/^\.\.\//, ''));
    }

    const result = new Map<number, ExtractedImage[]>();
    for (const [addr, cell] of Object.entries(sheet)) {
      if (addr.startsWith('!')) continue;
      const formula = String((cell as { f?: unknown; v?: unknown }).f ?? (cell as { v?: unknown }).v ?? '');
      const id = formula.match(/DISP(?:IMG|MIG)\("([^"]+)"/i)?.[1];
      if (!id) continue;
      const rid = byName.get(id);
      const target = rid ? byRid.get(rid) : undefined;
      if (!target) continue;
      const filePath = target.startsWith('xl/') ? target : `xl/${target}`;
      const image = files?.[filePath]?.content;
      if (!image?.length) continue;
      const { r: rowIndex, c: colIndex } = XLSX.utils.decode_cell(addr);
      const ext = extname(filePath).toLowerCase() || '.png';
      result.set(rowIndex, [...(result.get(rowIndex) ?? []), { ext, buffer: Buffer.from(image), colIndex }]);
    }
    return result;
  }

  private splitRowImagesByUsage(
    images: ExtractedImage[],
    colMap: ImportColumnMap,
  ): { stem: ExtractedImage[]; analysis: ExtractedImage[] } {
    const stem = images.filter((image) => image.colIndex === colMap.stem);
    return {
      stem,
      analysis: images.filter((image) => image.colIndex !== colMap.stem),
    };
  }

  private stripWpsImageFormula(value: string): string {
    return value.replace(/=?\s*DISP(?:IMG|MIG)\("([^"]+)"(?:\s*,\s*\d+)?\)/gi, '').trim();
  }

  private async saveQuestionImages(images: ExtractedImage[], batchId?: string, namespace = 'content'): Promise<string[]> {
    if (!images.length) return [];
    const targetDir = batchId ? join(env.questionImageDir, batchId) : env.questionImageDir;
    await mkdir(targetDir, { recursive: true });
    const urls: string[] = [];
    for (const image of images) {
      const hash = createHash('sha256').update(image.buffer).digest('hex');
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(image.ext) ? image.ext : '.png';
      // 批次图片使用内容确定性命名，并发发布同一批次只会覆盖同一文件，不制造孤儿副本。
      const filename = batchId ? `${namespace}-${hash}${safeExt}` : `${namespace}-${randomUUID()}-${hash.slice(0, 16)}${safeExt}`;
      await writeFile(join(targetDir, filename), image.buffer);
      urls.push(batchId ? `/question-images/${batchId}/${filename}` : `/question-images/${filename}`);
    }
    return urls;
  }

  // 表头 → 列索引。stem/answer/analysis 单列,options 为 {key,idx} 列表。未找到记 -1。
  private buildColMap(header: unknown[]): ImportColumnMap {
    const norm = (v: unknown): string => String(v ?? '').replace(/\s/g, '').trim();
    const map = { stem: -1, answer: -1, analysis: -1, options: [] as Array<{ key: string; idx: number }> };
    header.forEach((cell, idx) => {
      const h = norm(cell);
      if (!h) return;
      // 选项列:「选项A」或单字母「A」。
      const m = h.match(/^选项([A-H])$/) ?? h.match(/^([A-H])选项$/) ?? h.match(/^([A-H])$/);
      if (m && OPTION_LETTERS.includes(m[1] as (typeof OPTION_LETTERS)[number])) {
        map.options.push({ key: m[1], idx });
        return;
      }
      if (map.stem < 0 && STEM_HEADERS.includes(h)) map.stem = idx;
      else if (map.answer < 0 && ANSWER_HEADERS.includes(h)) map.answer = idx;
      else if (map.analysis < 0 && ANALYSIS_HEADERS.includes(h)) map.analysis = idx;
    });
    map.options.sort((a, b) => a.key.localeCompare(b.key));
    return map;
  }

  private parseRow(
    row: unknown[],
    colMap: ImportColumnMap,
    rowImages: ExtractedImage[] = [],
  ): { stem: string; options: QuestionOption[]; answer: string; analysis: string } | { error: string } {
    const cell = (idx: number): string => (idx < 0 ? '' : this.stripWpsImageFormula(String(row[idx] ?? '').trim()));
    const stem = cell(colMap.stem);
    const hasStemImage = rowImages.some((image) => image.colIndex === colMap.stem);
    if (!stem && !hasStemImage) return { error: '题干为空' };

    const options: QuestionOption[] = [];
    for (const o of colMap.options) {
      const text = cell(o.idx);
      if (text) options.push({ key: o.key, text });
    }
    if (options.length < 2) return { error: '至少需要 2 个选项' };

    const answer = cell(colMap.answer)
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .filter((c, i, a) => a.indexOf(c) === i) // 去重
      .sort()
      .join('');
    if (!answer) return { error: '答案为空或非法' };
    const validKeys = new Set(options.map((o) => o.key));
    for (const c of answer) {
      if (!validKeys.has(c)) return { error: `答案 ${c} 不在选项内` };
    }

    return { stem, options, answer, analysis: cell(colMap.analysis) };
  }

  // 学习刷题列表:默认不下发 answer/analysis/imageUrls,图片作为解析内容在查看答案后返回。
  async list(
    user: AuthUser,
    q: ListQuery,
  ): Promise<{
    items: PublicQuestionItem[];
    total: number;
    page: number;
    pageSize: number;
    startIndex?: number;
  }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    if (q.chapter !== undefined && !q.category) throw new BadRequestException('chapter requires category');
    {
      const baseQb = this.questions.createQueryBuilder('q').where('q.tenantId = :tenantId', {
        tenantId: user.tenantId,
      });
      // 学习视图(usage=study)同时包含 both；考试视图同理。
      if (q.usage) {
        const usages = q.usage === 'both' ? ['both'] : [q.usage, 'both'];
        baseQb.andWhere('q.usage IN (:...usages)', { usages });
      }
      if (q.category) baseQb.andWhere('q.category = :category', { category: q.category });
      if (q.category) {
        baseQb.andWhere('q.generation = :generation', {
          generation: await this.currentGeneration(user.tenantId, q.category),
        });
      }
      if (q.chapter !== undefined) baseQb.andWhere('q.chapterName = :chapter', { chapter: q.chapter });
      if (q.courseId) baseQb.andWhere('q.courseId = :courseId', { courseId: q.courseId });
      if (q.keyword?.trim()) baseQb.andWhere('q.stem LIKE :keyword', { keyword: `%${q.keyword.trim()}%` });

      const publicSelect = [
        'q.id',
        'q.tenantId',
        'q.category',
        'q.generation',
        'q.chapterName',
        'q.chapterOrder',
        'q.chapterQuestionOrder',
        'q.courseId',
        'q.type',
        'q.stem',
        'q.stemImageUrls',
        'q.options',
        'q.usage',
        'q.order',
        'q.createdAt',
      ];
      if (q.usage === 'study' && q.category && !q.keyword?.trim()) {
        // 顺序学习不再按 20 题分页；一次返回当前科目的完整顺序列表,由客户端一题一题切到底。
        const allRows = await this.questionPool.getQuestions(user.tenantId, {
          usage: 'study',
          category: q.category,
          ...(q.chapter !== undefined ? { chapter: q.chapter } : {}),
          ...(q.courseId ? { courseId: q.courseId } : {}),
          reloadIfEmpty: true,
        });
        const { rows, page: currentPage, startIndex } = await this.listSequentialStudyBatch(
          user,
          allRows,
          q.category,
          q.courseId ?? '',
          q.chapter ?? '',
          pageSize,
          q.page,
        );
        const items = await this.attachPracticeStats(
          user,
          rows.map(({ imageUrls: _img, ...row }) => row),
        );
        return {
          items,
          total: allRows.length,
          page: currentPage,
          pageSize,
          startIndex,
        };
      }

      const countCacheKey = [
        user.tenantId,
        q.usage ?? '',
        q.category ?? '',
        q.chapter ?? '',
        q.courseId ?? '',
        q.keyword?.trim() ?? '',
      ].join('|');
      const total = await this.cachedQuestionListTotal(countCacheKey, () => baseQb.clone().getCount());

      const rowsQb = baseQb
        .clone()
        // 列表页不下发 answer/analysis,也不从数据库读取这两个大字段,降低 App 高并发刷题列表压力。
        .select(publicSelect)
        .orderBy('q.chapterOrder', 'ASC')
        .addOrderBy('q.chapterQuestionOrder', 'ASC')
        .addOrderBy('q.order', 'ASC')
        .skip((page - 1) * pageSize)
        .take(pageSize);
      const dbType = this.questions.manager.connection.options.type;
      if (dbType === 'mysql' || dbType === 'mariadb') rowsQb.useIndex(this.questionListIndex(q));

      const rows = await rowsQb.getMany();
      const items = await this.attachPracticeStats(
        user,
        rows.map(({ answer: _a, analysis: _an, imageUrls: _img, ...rest }) => rest),
      );
      return { items, total, page, pageSize };
    }
  }

  private async attachPracticeStats<T extends { id: string }>(
    user: AuthUser,
    items: T[],
  ): Promise<Array<T & { practice: QuestionPracticeSummary }>> {
    if (items.length === 0) return [];
    const rows = await this.practices.find({
      where: { tenantId: user.tenantId, userId: user.userId, questionId: In(items.map((item) => item.id)) },
      select: ['questionId', 'seenCount', 'correctCount', 'wrongCount'],
    });
    const byQuestion = new Map(rows.map((row) => [row.questionId, row]));
    return items.map((item) => {
      const practice = byQuestion.get(item.id);
      return {
        ...item,
        practice: {
          seenCount: practice?.seenCount ?? 0,
          correctCount: practice?.correctCount ?? 0,
          wrongCount: practice?.wrongCount ?? 0,
        },
      };
    });
  }

  // 读取用户历史练习/考试/错题状态,用于专题学习按新题/原题/错题混合排序。
  private async loadAdaptiveQuestionState(user: AuthUser, pool: Array<Pick<Question, 'id'>>): Promise<AdaptiveQuestionState> {
    const ids = pool.map((q) => q.id);
    if (ids.length === 0) return { attempts: [], practices: [], wrongs: [] };
    const idSet = new Set(ids);
    const [attempts, practices, wrongs] = await Promise.all([
      this.attempts.find({
        where: { tenantId: user.tenantId, userId: user.userId, status: 'submitted' },
        select: ['questionIds', 'submittedAt', 'createdAt'],
        order: { submittedAt: 'DESC' },
        take: 50,
      }),
      this.practices.find({
        // Avoid a huge IN (...) per study request; filter the user's compact state in memory.
        where: { tenantId: user.tenantId, userId: user.userId },
        select: ['questionId', 'seenCount', 'lastSeenAt'],
      }),
      this.wrongBookRepo.find({
        where: { tenantId: user.tenantId, userId: user.userId, status: 'open' },
        select: ['questionId', 'wrongCount', 'status', 'lastWrongAt'],
      }),
    ]);
    return {
      attempts,
      practices: practices.filter((p) => idSet.has(p.questionId)),
      wrongs: wrongs.filter((w) => idSet.has(w.questionId)),
    };
  }

  // 查看答案:单独端点,返回正确答案 + 解析 + 解析配图。
  async answer(user: AuthUser, id: string): Promise<{ answer: string; analysis: string; imageUrls: string[] }> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id } });
    if (!q) throw new NotFoundException('题目不存在');
    // 纯考试题答案不可单独查看,否则考生可在考试中拉答案作弊(组卷已下发题 id)。
    // study/both 本就是练习题,答案可查。
    if (q.usage === 'exam') {
      throw new ForbiddenException('考试题答案不可查看');
    }
    return { answer: q.answer, analysis: q.analysis, imageUrls: q.imageUrls ?? [] };
  }

  // 顺序学习按最近一次学习位置续取,不参与新题/原题/错题混排。
  private async listSequentialStudyBatch<T extends Pick<Question, 'id'>>(
    user: AuthUser,
    allRows: T[],
    category: string,
    courseId: string,
    chapterName: string,
    pageSize: number,
    requestedPage?: number,
  ): Promise<{ rows: T[]; page: number; startIndex: number }> {
    if (allRows.length === 0) return { rows: [], page: 1, startIndex: 0 };
    const questionIndex = new Map(allRows.map((q, i) => [q.id, i]));
    const progress = await this.studyProgress.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, category, courseId, chapterName },
      select: ['questionId'],
    });
    const lastIndex = progress ? questionIndex.get(progress.questionId) : undefined;
    const resumeIndex = Math.min(allRows.length - 1, lastIndex === undefined ? 0 : lastIndex + 1);
    const maxPage = Math.max(1, Math.ceil(allRows.length / pageSize));
    const page =
      requestedPage === undefined
        ? Math.floor(resumeIndex / pageSize) + 1
        : Math.min(maxPage, Math.max(1, requestedPage));
    const pageStart = (page - 1) * pageSize;

    return {
      rows: allRows.slice(pageStart, pageStart + pageSize),
      page,
      startIndex: requestedPage === undefined ? resumeIndex - pageStart : 0,
    };
  }

  // 评论列表(带作者昵称)。学习/考试复盘/错题本共用同一 questionId 评论串。
  async listComments(
    user: AuthUser,
    questionId: string,
  ): Promise<Array<{ id: string; userId: string; nickname: string; content: string; createdAt: Date; canDelete: boolean }>> {
    const rows = await this.comments.find({
      where: { tenantId: user.tenantId, questionId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const nickMap = await this.resolveNicknames(user.tenantId, rows.map((c) => c.userId));
    return rows.map((c) => ({
      id: c.id,
      userId: c.userId,
      nickname: nickMap.get(c.userId) ?? `用户${c.userId.slice(0, 4)}`,
      content: c.content,
      createdAt: c.createdAt,
      canDelete: this.canDeleteComment(user, c),
    }));
  }

  async addComment(
    user: AuthUser,
    questionId: string,
    content: string,
    clientPlatform?: string,
  ): Promise<{ id: string; userId: string; nickname: string; content: string; createdAt: Date; canDelete: boolean }> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('评论不能为空');
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id: questionId } });
    if (!q) throw new NotFoundException('题目不存在');
    const author = await this.users.findOne({
      where: { tenantId: user.tenantId, id: user.userId },
      select: ['wechatOpenid'],
    });
    await this.wechat.checkContent(trimmed, 2, author?.wechatOpenid ?? null, {
      userId: user.userId,
      contentType: 'question_comment',
      clientPlatform,
    });
    await this.ensureGenerationRow(user.tenantId, q.category);
    const c = await this.questions.manager.transaction(async (manager) => {
      const supportsLocks = !['better-sqlite3', 'sqlite'].includes(String(manager.connection.options.type));
      await manager.findOne(QuestionCategoryGeneration, {
        where: { tenantId: user.tenantId, category: q.category },
        ...(supportsLocks ? { lock: { mode: 'pessimistic_read' as const } } : {}),
      });
      const current = await manager.findOne(Question, { where: { tenantId: user.tenantId, id: questionId } });
      if (!current) throw new ConflictException('题库已更新，请刷新后再评论');
      return manager.save(
        Comment,
        this.comments.create({
          tenantId: user.tenantId,
          questionId,
          userId: user.userId,
          content: trimmed,
        }),
      );
    });
    const nick = await this.resolveNicknames(user.tenantId, [user.userId]);
    return {
      id: c.id,
      userId: c.userId,
      nickname: nick.get(c.userId) ?? `用户${c.userId.slice(0, 4)}`,
      content: c.content,
      createdAt: c.createdAt,
      canDelete: true,
    };
  }

  private canDeleteComment(user: AuthUser, comment: Pick<Comment, 'userId'>): boolean {
    return comment.userId === user.userId || user.role === 'admin' || user.role === 'super';
  }

  async deleteComment(user: AuthUser, commentId: string): Promise<{ deleted: boolean }> {
    const comment = await this.comments.findOne({ where: { tenantId: user.tenantId, id: commentId } });
    if (!comment) throw new NotFoundException('评论不存在');
    if (!this.canDeleteComment(user, comment)) throw new ForbiddenException('只能删除自己的评论');
    await this.comments.delete({ tenantId: user.tenantId, id: comment.id });
    if (user.role === 'admin' || user.role === 'super') {
      await this.logAdminOperation(user, 'question_comment_delete', 'comment', comment.id, {
        questionId: comment.questionId,
        ownerUserId: comment.userId,
      });
    }
    return { deleted: true };
  }

  // 数据维护:各科目题目数(含未分类)。
  async statsByCategory(user: AuthUser): Promise<Array<{ category: string; count: number }>> {
    const rows = await this.questions
      .createQueryBuilder('q')
      .select('q.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('q.tenantId = :t', { t: user.tenantId })
      .groupBy('q.category')
      .getRawMany<{ category: string; count: string }>();
    return rows.map((r) => ({ category: r.category || '(未分类)', count: Number(r.count) }));
  }

  // 按科目批量删除(连带评论)。category='' 表示删未分类。须显式传 category,防误清全库。
  async deleteImpactByCategory(
    user: AuthUser,
    category: string,
  ): Promise<{ category: string; questionCount: number; commentCount: number; requiredConfirm: string }> {
    const ids = (
      await this.questions.find({ where: { tenantId: user.tenantId, category }, select: ['id'] })
    ).map((q) => q.id);
    const commentCount = ids.length
      ? await this.comments.count({ where: { tenantId: user.tenantId, questionId: In(ids) } })
      : 0;
    return {
      category,
      questionCount: ids.length,
      commentCount,
      requiredConfirm: category || '__EMPTY__',
    };
  }

  async purgeByCategory(user: AuthUser, category: string, confirm?: string): Promise<{ deleted: number }> {
    this.assertOrdinaryMutationAllowed(category, '清空');
    const requiredConfirm = category || '__EMPTY__';
    if (confirm !== requiredConfirm) throw new BadRequestException('delete confirmation mismatch');
    const ids = (
      await this.questions.find({ where: { tenantId: user.tenantId, category }, select: ['id'] })
    ).map((q) => q.id);
    if (!ids.length) return { deleted: 0 };
    await this.comments.delete({ tenantId: user.tenantId, questionId: In(ids) });
    await this.questions.delete({ tenantId: user.tenantId, category });
    await this.refreshQuestionCaches(user.tenantId);
    await this.logAdminOperation(user, 'question_purge_category', 'question_category', category || null, {
      category,
      deleted: ids.length,
    });
    return { deleted: ids.length };
  }

  // 删除单题(连带评论)。
  async deleteOne(user: AuthUser, id: string): Promise<{ deleted: number }> {
    const question = await this.questions.findOne({ where: { tenantId: user.tenantId, id }, select: ['category'] });
    if (!question) return { deleted: 0 };
    this.assertOrdinaryMutationAllowed(question.category, '删除单题');
    await this.comments.delete({ tenantId: user.tenantId, questionId: id });
    const r = await this.questions.delete({ tenantId: user.tenantId, id });
    if ((r.affected ?? 0) > 0) await this.refreshQuestionCaches(user.tenantId);
    if ((r.affected ?? 0) > 0) {
      await this.logAdminOperation(user, 'question_delete_one', 'question', id, { deleted: r.affected ?? 0 });
    }
    return { deleted: r.affected ?? 0 };
  }

  // 原来后台只支持删题；这里补单题修改，便于导入后修正题干、选项、答案和解析。
  async updateOne(user: AuthUser, id: string, dto: UpdateQuestionDto): Promise<Question> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id } });
    if (!q) throw new NotFoundException('题目不存在');
    this.assertOrdinaryMutationAllowed(q.category, '编辑单题');
    this.assertOrdinaryMutationAllowed(dto.category, '移动题目');

    const patch: Partial<Question> = {};
    if (dto.category !== undefined) {
      const category = dto.category.trim();
      await this.assertCategoryExists(user.tenantId, category);
      patch.category = category;
    }
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.stem !== undefined) {
      const stem = dto.stem.trim();
      if (!stem) throw new BadRequestException('题干不能为空');
      patch.stem = stem;
    }
    if (dto.options !== undefined) {
      const options = this.normalizeOptions(dto.options);
      if (options.length < 2) throw new BadRequestException('至少需要 2 个选项');
      patch.options = options;
    }
    if (dto.answer !== undefined) {
      const options = patch.options ?? q.options;
      const answer = this.normalizeAnswer(dto.answer, options);
      const type = patch.type ?? q.type;
      if (type === 'single' && answer.length !== 1) {
        throw new BadRequestException('单选题只能有 1 个正确答案');
      }
      patch.answer = answer;
    }
    if (dto.answer === undefined && (patch.options || patch.type)) {
      const answer = this.normalizeAnswer(q.answer, patch.options ?? q.options);
      const type = patch.type ?? q.type;
      if (type === 'single' && answer.length !== 1) {
        throw new BadRequestException('单选题只能有 1 个正确答案');
      }
    }
    if (dto.analysis !== undefined) patch.analysis = dto.analysis.trim();
    if (dto.usage !== undefined) patch.usage = dto.usage;

    Object.assign(q, patch);
    const saved = await this.questions.save(q);
    this.clearQuestionListCountCache(user.tenantId);
    await this.logAdminOperation(user, 'question_update_one', 'question', id, { fields: Object.keys(patch) });
    return saved;
  }

  private normalizeOptions(options: QuestionOption[]): QuestionOption[] {
    const seen = new Set<string>();
    return options
      .map((o) => ({
        key: String(o?.key ?? '').trim().toUpperCase(),
        text: String(o?.text ?? '').trim(),
      }))
      .filter((o) => o.key && o.text)
      .map((o) => {
        if (!/^[A-H]$/.test(o.key)) throw new BadRequestException('选项编号只能是 A-H');
        if (seen.has(o.key)) throw new BadRequestException(`选项 ${o.key} 重复`);
        seen.add(o.key);
        return o;
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  private normalizeAnswer(answer: string, options: QuestionOption[]): string {
    const validKeys = new Set(options.map((o) => o.key));
    const normalized = answer
      .toUpperCase()
      .replace(/[^A-H]/g, '')
      .split('')
      .filter((c, i, a) => a.indexOf(c) === i)
      .sort()
      .join('');
    if (!normalized) throw new BadRequestException('答案不能为空或非法');
    for (const c of normalized) {
      if (!validKeys.has(c)) throw new BadRequestException(`答案 ${c} 不在选项内`);
    }
    return normalized;
  }

  // 管理端列题:按科目精确 + 题干关键词模糊,分页。含答案/解析(管理可见,不下发学员)。
  async adminList(
    user: AuthUser,
    opts: { category?: string; keyword?: string; page?: number; pageSize?: number },
  ): Promise<{ items: Question[]; total: number; page: number; pageSize: number }> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const qb = this.questions
      .createQueryBuilder('q')
      .where('q.tenantId = :t', { t: user.tenantId });
    if (opts.category !== undefined) qb.andWhere('q.category = :c', { c: opts.category });
    if (opts.keyword) qb.andWhere('q.stem LIKE :kw', { kw: `%${opts.keyword}%` });
    const [items, total] = await qb
      .orderBy('q.order', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  // 批量删题(连带评论)。
  async deleteMany(user: AuthUser, ids: string[]): Promise<{ deleted: number }> {
    if (!ids.length) return { deleted: 0 };
    const managedCount = await this.questions.count({ where: { tenantId: user.tenantId, id: In(ids), category: M1_CATEGORY } });
    if (managedCount > 0) this.assertOrdinaryMutationAllowed(M1_CATEGORY, '批量删除');
    await this.comments.delete({ tenantId: user.tenantId, questionId: In(ids) });
    const r = await this.questions.delete({ tenantId: user.tenantId, id: In(ids) });
    if ((r.affected ?? 0) > 0) await this.refreshQuestionCaches(user.tenantId);
    if ((r.affected ?? 0) > 0) {
      await this.logAdminOperation(user, 'question_delete_many', 'question', null, {
        requested: ids.length,
        deleted: r.affected ?? 0,
      });
    }
    return { deleted: r.affected ?? 0 };
  }

  // 生成导入模板(表头 + 1 行示例),返回 xlsx buffer。
  buildTemplate(): Buffer {
    const example = ['1+1=?', '1', '2', '3', '4', 'B', '基础算术'];
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER as unknown as string[], example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '题目');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}

// 管理端:导入 + 模板下载。admin 守卫。
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/questions')
export class QuestionAdminController {
  constructor(private readonly svc: QuestionService) {}

  @Post('m1/preflight')
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  previewM1(@CurrentUser() admin: AuthUser, @UploadedFile() file: UploadedQuestionFile) {
    return this.svc.previewM1Replacement(admin, file);
  }

  @Post('m1/:batchId/publish')
  publishM1(
    @CurrentUser() admin: AuthUser,
    @Param('batchId') batchId: string,
    @Body() dto: M1PublishDto,
  ) {
    return this.svc.publishM1Replacement(admin, batchId, dto.confirm);
  }

  @Post('import')
  // 题库文件可能包含大量图片,与 nginx 的导入上传上限保持一致。
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 150 * 1024 * 1024 } }))
  import(
    @CurrentUser() admin: AuthUser,
    @UploadedFile() file: UploadedQuestionFile,
    @Query() q: ImportQuery,
  ) {
    return this.svc.importFile(admin, file, q.usage, q.category, q.courseId);
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 150 * 1024 * 1024 } }))
  previewImport(
    @CurrentUser() admin: AuthUser,
    @UploadedFile() file: UploadedQuestionFile,
    @Query() q: ImportQuery,
  ) {
    return this.svc.previewImportFile(admin, file, q.usage, q.category, q.courseId);
  }

  @Get('template')
  template(@Res() res: Response): void {
    const buf = this.svc.buildTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="question-template.xlsx"',
    });
    res.send(buf);
  }

  // 数据维护:各科目题目统计。
  @Get('stats')
  stats(@CurrentUser() admin: AuthUser) {
    return this.svc.statsByCategory(admin);
  }

  @Get('categories')
  categories(@CurrentUser() admin: AuthUser) {
    return this.svc.listManagedCategories(admin);
  }

  @Post('categories')
  createCategory(@CurrentUser() admin: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.svc.createCategory(admin, dto.name);
  }

  @Post('categories/:id')
  renameCategory(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: RenameCategoryDto) {
    return this.svc.renameCategory(admin, id, dto.name);
  }

  @Delete('categories/:id')
  deleteCategory(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.svc.deleteCategory(admin, id);
  }

  // 管理端列题:按科目 + 关键词搜索(进入科目删单个/多个用)。
  @Get('list')
  adminList(@CurrentUser() admin: AuthUser, @Query() q: AdminListQuery) {
    return this.svc.adminList(admin, q);
  }

  // 批量删题。
  @Post('batch-delete')
  batchDelete(@CurrentUser() admin: AuthUser, @Body() dto: BatchDeleteDto) {
    return this.svc.deleteMany(admin, dto.ids);
  }

  @Get('delete-impact')
  deleteImpact(@CurrentUser() admin: AuthUser, @Query('category') category?: string) {
    if (category === undefined) throw new BadRequestException('category required');
    return this.svc.deleteImpactByCategory(admin, category);
  }

  // 按科目批量删除(须传 category,'' 删未分类)。
  @Delete()
  purge(@CurrentUser() admin: AuthUser, @Query() q: DeleteConfirmQuery) {
    const category = q.category;
    if (category === undefined) throw new BadRequestException('请指定 category');
    return this.svc.purgeByCategory(admin, category, q.confirm);
  }

  @Patch(':id')
  updateOne(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() dto: UpdateQuestionDto) {
    return this.svc.updateOne(admin, id, dto);
  }

  @Delete(':id')
  deleteOne(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.svc.deleteOne(admin, id);
  }
}

// 学习端:刷题 + 查看答案 + 评论。需登录。
@UseGuards(JwtAuthGuard)
@Controller('questions')
export class QuestionController {
  constructor(private readonly svc: QuestionService) {}

  // 科目列表(固定枚举),前端下拉用。静态路由,置于 :id 之前避免被参数路由吞掉。
  @Get('categories')
  categories(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.svc.listCategoryNames(user.tenantId);
  }

  @Get('chapters')
  chapters(@CurrentUser() user: AuthUser, @Query('category') category?: string) {
    if (category === undefined) throw new BadRequestException('category required');
    return this.svc.listChapters(user, category);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.svc.list(user, q);
  }

  @Get(':id/answer')
  answer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.answer(user, id);
  }

  @Get(':id/comments')
  comments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listComments(user, id);
  }

  @Post(':id/comments')
  addComment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @Req() req: { headers?: { 'x-client-platform'?: string } },
  ) {
    return this.svc.addComment(user, id, dto.content, req.headers?.['x-client-platform']);
  }

  @Delete('comments/:commentId')
  deleteComment(@CurrentUser() user: AuthUser, @Param('commentId') commentId: string) {
    return this.svc.deleteComment(user, commentId);
  }
}

@Controller('question-images')
export class QuestionImageController {
  @Get(':batchId/:file')
  batchImage(@Param('batchId') batchId: string, @Param('file') file: string, @Res() res: Response): void {
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new BadRequestException('图片批次非法');
    const safeName = basename(file);
    if (safeName !== file || !/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp)$/i.test(safeName)) {
      throw new BadRequestException('图片路径非法');
    }
    const root = resolve(env.questionImageDir);
    const target = resolve(root, batchId, safeName);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) throw new BadRequestException('图片路径非法');
    this.sendImage(target, res);
  }

  @Get(':file')
  image(@Param('file') file: string, @Res() res: Response): void {
    const safeName = basename(file);
    if (safeName !== file || !/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp)$/i.test(safeName)) {
      throw new BadRequestException('图片路径非法');
    }
    this.sendImage(join(env.questionImageDir, safeName), res);
  }

  private sendImage(path: string, res: Response): void {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).send('Not found');
    });
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Question,
      QuestionCategoryEntity,
      QuestionCategoryGeneration,
      Comment,
      User,
      ExamAttempt,
      WrongQuestion,
      QuestionPractice,
      StudyQuestionProgress,
      QuestionImportBatch,
      AdminOperationLog,
    ]),
    QuestionPoolCacheModule,
    WechatMiniProgramModule,
  ],
  controllers: [QuestionAdminController, QuestionController, QuestionImageController],
  providers: [QuestionService],
})
export class QuestionModule {}

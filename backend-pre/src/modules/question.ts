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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import * as XLSX from 'xlsx';
import {
  Comment,
  Question,
  QuestionCategoryEntity,
  QuestionOption,
  QuestionUsage,
  QUESTION_CATEGORIES,
  User,
} from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common';
import { env } from '../config';

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
const ANALYSIS_HEADERS = ['解析', '答案解析', '说明', '备注'];

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
}

@Injectable()
export class QuestionService {
  private readonly questionListCountCache = new Map<string, { total: number; expiresAt: number }>();
  private readonly questionListCountInFlight = new Map<string, Promise<number>>();
  private readonly questionListCountTtlMs = 30_000;

  constructor(
    @InjectRepository(Question) private readonly questions: Repository<Question>,
    @InjectRepository(QuestionCategoryEntity)
    private readonly categories: Repository<QuestionCategoryEntity>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private clearQuestionListCountCache(tenantId: string): void {
    for (const key of this.questionListCountCache.keys()) {
      if (key.startsWith(`${tenantId}|`)) this.questionListCountCache.delete(key);
    }
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
    if (q.category !== undefined) return 'IDX_question_tenant_category_order';
    if (q.courseId) return 'IDX_question_tenant_course_order';
    return 'IDX_question_tenant_order';
  }

  private normalizeCategoryName(name: string): string {
    return name.trim();
  }

  private async ensureDefaultCategories(tenantId: string): Promise<void> {
    const count = await this.categories.count({ where: { tenantId } });
    if (count > 0) return;
    await this.categories.save(
      QUESTION_CATEGORIES.map((name, order) => this.categories.create({ tenantId, name, order })),
    );
  }

  async listCategoryNames(tenantId: string): Promise<string[]> {
    await this.ensureDefaultCategories(tenantId);
    const rows = await this.categories.find({ where: { tenantId }, order: { order: 'ASC', name: 'ASC' } });
    return rows.map((r) => r.name);
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
    return rows.map((r) => ({ id: r.id, name: r.name, count: counts.get(r.name) ?? 0 }));
  }

  async createCategory(user: AuthUser, rawName: string): Promise<{ id: string; name: string; count: number }> {
    const name = this.normalizeCategoryName(rawName);
    if (!name) throw new BadRequestException('类别名称不能为空');
    if (name === '(未分类)') throw new BadRequestException('该名称为系统保留名称');
    await this.ensureDefaultCategories(user.tenantId);
    const dup = await this.categories.findOne({ where: { tenantId: user.tenantId, name } });
    if (dup) throw new BadRequestException('类别已存在');
    const order = await this.categories.count({ where: { tenantId: user.tenantId } });
    const row = await this.categories.save(this.categories.create({ tenantId: user.tenantId, name, order }));
    return { id: row.id, name: row.name, count: 0 };
  }

  async renameCategory(
    user: AuthUser,
    id: string,
    rawName: string,
  ): Promise<{ id: string; name: string; count: number }> {
    const name = this.normalizeCategoryName(rawName);
    if (!name) throw new BadRequestException('类别名称不能为空');
    if (name === '(未分类)') throw new BadRequestException('该名称为系统保留名称');
    const row = await this.categories.findOne({ where: { tenantId: user.tenantId, id } });
    if (!row) throw new NotFoundException('类别不存在');
    if (row.name === name) return { id: row.id, name: row.name, count: 0 };
    const count = await this.questions.count({ where: { tenantId: user.tenantId, category: row.name } });
    if (count > 0) throw new BadRequestException('该类别下还有题目，请先删除题目后再修改类别');
    const dup = await this.categories.findOne({ where: { tenantId: user.tenantId, name } });
    if (dup && dup.id !== id) throw new BadRequestException('类别已存在');
    await this.categories.update(row.id, { name });
    return { id: row.id, name, count: 0 };
  }

  async deleteCategory(user: AuthUser, id: string): Promise<{ deleted: number }> {
    const row = await this.categories.findOne({ where: { tenantId: user.tenantId, id } });
    if (!row) throw new NotFoundException('类别不存在');
    const count = await this.questions.count({ where: { tenantId: user.tenantId, category: row.name } });
    if (count > 0) throw new BadRequestException('该类别下还有题目，请先删除题目后再删除类别');
    const r = await this.categories.delete({ tenantId: user.tenantId, id });
    return { deleted: r.affected ?? 0 };
  }

  private async assertCategoryExists(tenantId: string, category: string | undefined): Promise<void> {
    if (!category) return;
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
  ): Promise<{ imported: number; failed: ImportFailure[] }> {
    if (!file?.buffer?.length) throw new BadRequestException('请上传题库文件');
    await this.assertCategoryExists(admin.tenantId, category);
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.pdf')) {
      const rows = await this.parsePdfRows(file.buffer);
      return this.importRows(admin, rows, usage, category, courseId);
    }
    return this.importExcel(admin, file, usage, category, courseId);
  }

  // 解析 Excel 并批量入库。逐行校验,失败行收集返回,不静默吞错;成功行照常写入。
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
      const parsed = this.parseRow(rows[i], colMap);
      if ('error' in parsed) {
        failed.push({ row: rowNo, reason: parsed.error });
        continue;
      }
      toSave.push(
        this.questions.create({
          tenantId: admin.tenantId,
          category: category ?? '',
          courseId: courseId ?? null,
          type: parsed.answer.length > 1 ? 'multiple' : 'single',
          stem: parsed.stem,
          options: parsed.options,
          answer: parsed.answer,
          analysis: parsed.analysis,
          imageUrls: await this.saveQuestionImages(rowImages.get(i) ?? []),
          usage,
          order: i,
        }),
      );
    }
    if (toSave.length) {
      await this.questions.save(toSave);
      this.clearQuestionListCountCache(admin.tenantId);
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
      const id = formula.match(/DISPIMG\("([^"]+)"/)?.[1];
      if (!id) continue;
      const rid = byName.get(id);
      const target = rid ? byRid.get(rid) : undefined;
      if (!target) continue;
      const filePath = target.startsWith('xl/') ? target : `xl/${target}`;
      const image = files?.[filePath]?.content;
      if (!image?.length) continue;
      const rowIndex = XLSX.utils.decode_cell(addr).r;
      const ext = extname(filePath).toLowerCase() || '.png';
      result.set(rowIndex, [...(result.get(rowIndex) ?? []), { ext, buffer: Buffer.from(image) }]);
    }
    return result;
  }

  private async saveQuestionImages(images: ExtractedImage[]): Promise<string[]> {
    if (!images.length) return [];
    await mkdir(env.questionImageDir, { recursive: true });
    const urls: string[] = [];
    for (const image of images) {
      const hash = createHash('sha1').update(image.buffer).digest('hex').slice(0, 16);
      const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(image.ext) ? image.ext : '.png';
      const filename = `${Date.now()}-${hash}${safeExt}`;
      await writeFile(join(env.questionImageDir, filename), image.buffer);
      urls.push(`/question-images/${filename}`);
    }
    return urls;
  }

  // 表头 → 列索引。stem/answer/analysis 单列,options 为 {key,idx} 列表。未找到记 -1。
  private buildColMap(header: unknown[]): {
    stem: number;
    answer: number;
    analysis: number;
    options: Array<{ key: string; idx: number }>;
  } {
    const norm = (v: unknown): string => String(v ?? '').replace(/\s/g, '').trim();
    const map = { stem: -1, answer: -1, analysis: -1, options: [] as Array<{ key: string; idx: number }> };
    header.forEach((cell, idx) => {
      const h = norm(cell);
      if (!h) return;
      // 选项列:「选项A」或单字母「A」。
      const m = h.match(/^选项([A-H])$/) ?? h.match(/^([A-H])$/);
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
    colMap: ReturnType<QuestionService['buildColMap']>,
  ): { stem: string; options: QuestionOption[]; answer: string; analysis: string } | { error: string } {
    const cell = (idx: number): string => (idx < 0 ? '' : String(row[idx] ?? '').trim());
    const stem = cell(colMap.stem);
    if (!stem) return { error: '题干为空' };

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

  // 学习刷题列表:默认不下发 answer/analysis(点"查看答案"再单独请求)。
  async list(
    user: AuthUser,
    q: ListQuery,
  ): Promise<{ items: Array<Omit<Question, 'answer' | 'analysis'>>; total: number; page: number; pageSize: number }> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
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
      if (q.courseId) baseQb.andWhere('q.courseId = :courseId', { courseId: q.courseId });
      if (q.keyword?.trim()) baseQb.andWhere('q.stem LIKE :keyword', { keyword: `%${q.keyword.trim()}%` });

      const rowsQb = baseQb
        .clone()
        // 列表页不下发 answer/analysis,也不从数据库读取这两个大字段,降低 App 高并发刷题列表压力。
        .select([
          'q.id',
          'q.tenantId',
          'q.category',
          'q.courseId',
          'q.type',
          'q.stem',
          'q.options',
          'q.imageUrls',
          'q.usage',
          'q.order',
          'q.createdAt',
        ])
        .orderBy('q.order', 'ASC')
        .skip((page - 1) * pageSize)
        .take(pageSize);
      const dbType = this.questions.manager.connection.options.type;
      if (dbType === 'mysql' || dbType === 'mariadb') rowsQb.useIndex(this.questionListIndex(q));

      const countCacheKey = [
        user.tenantId,
        q.usage ?? '',
        q.category ?? '',
        q.courseId ?? '',
        q.keyword?.trim() ?? '',
      ].join('|');
      const [rows, total] = await Promise.all([
        rowsQb.getMany(),
        this.cachedQuestionListTotal(countCacheKey, () => baseQb.clone().getCount()),
      ]);
      const items = rows.map(({ answer: _a, analysis: _an, ...rest }) => rest);
      return { items, total, page, pageSize };
    }
  }

  // 查看答案:单独端点,返回正确答案 + 解析。
  async answer(user: AuthUser, id: string): Promise<{ answer: string; analysis: string }> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id } });
    if (!q) throw new NotFoundException('题目不存在');
    // 纯考试题答案不可单独查看,否则考生可在考试中拉答案作弊(组卷已下发题 id)。
    // study/both 本就是练习题,答案可查。
    if (q.usage === 'exam') {
      throw new ForbiddenException('考试题答案不可查看');
    }
    return { answer: q.answer, analysis: q.analysis };
  }

  // 评论列表(带作者昵称)。学习/考试复盘/错题本共用同一 questionId 评论串。
  async listComments(
    user: AuthUser,
    questionId: string,
  ): Promise<Array<{ id: string; userId: string; nickname: string; content: string; createdAt: Date }>> {
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
    }));
  }

  async addComment(
    user: AuthUser,
    questionId: string,
    content: string,
  ): Promise<{ id: string; userId: string; nickname: string; content: string; createdAt: Date }> {
    const trimmed = content.trim();
    if (!trimmed) throw new BadRequestException('评论不能为空');
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id: questionId } });
    if (!q) throw new NotFoundException('题目不存在');
    const c = await this.comments.save(
      this.comments.create({
        tenantId: user.tenantId,
        questionId,
        userId: user.userId,
        content: trimmed,
      }),
    );
    const nick = await this.resolveNicknames(user.tenantId, [user.userId]);
    return {
      id: c.id,
      userId: c.userId,
      nickname: nick.get(c.userId) ?? `用户${c.userId.slice(0, 4)}`,
      content: c.content,
      createdAt: c.createdAt,
    };
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
  async purgeByCategory(user: AuthUser, category: string): Promise<{ deleted: number }> {
    const ids = (
      await this.questions.find({ where: { tenantId: user.tenantId, category }, select: ['id'] })
    ).map((q) => q.id);
    if (!ids.length) return { deleted: 0 };
    await this.comments.delete({ tenantId: user.tenantId, questionId: In(ids) });
    await this.questions.delete({ tenantId: user.tenantId, category });
    this.clearQuestionListCountCache(user.tenantId);
    return { deleted: ids.length };
  }

  // 删除单题(连带评论)。
  async deleteOne(user: AuthUser, id: string): Promise<{ deleted: number }> {
    await this.comments.delete({ tenantId: user.tenantId, questionId: id });
    const r = await this.questions.delete({ tenantId: user.tenantId, id });
    if ((r.affected ?? 0) > 0) this.clearQuestionListCountCache(user.tenantId);
    return { deleted: r.affected ?? 0 };
  }

  // 原来后台只支持删题；这里补单题修改，便于导入后修正题干、选项、答案和解析。
  async updateOne(user: AuthUser, id: string, dto: UpdateQuestionDto): Promise<Question> {
    const q = await this.questions.findOne({ where: { tenantId: user.tenantId, id } });
    if (!q) throw new NotFoundException('题目不存在');

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
    await this.comments.delete({ tenantId: user.tenantId, questionId: In(ids) });
    const r = await this.questions.delete({ tenantId: user.tenantId, id: In(ids) });
    if ((r.affected ?? 0) > 0) this.clearQuestionListCountCache(user.tenantId);
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

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  import(
    @CurrentUser() admin: AuthUser,
    @UploadedFile() file: UploadedQuestionFile,
    @Query() q: ImportQuery,
  ) {
    return this.svc.importFile(admin, file, q.usage, q.category, q.courseId);
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

  // 按科目批量删除(须传 category,'' 删未分类)。
  @Delete()
  purge(@CurrentUser() admin: AuthUser, @Query('category') category?: string) {
    if (category === undefined) throw new BadRequestException('请指定 category');
    return this.svc.purgeByCategory(admin, category);
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
  ) {
    return this.svc.addComment(user, id, dto.content);
  }
}

@Controller('question-images')
export class QuestionImageController {
  @Get(':file')
  image(@Param('file') file: string, @Res() res: Response): void {
    const safeName = basename(file);
    if (safeName !== file || !/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp)$/i.test(safeName)) {
      throw new BadRequestException('图片路径非法');
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(join(env.questionImageDir, safeName), (err) => {
      if (err && !res.headersSent) res.status(404).send('Not found');
    });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Question, QuestionCategoryEntity, Comment, User])],
  controllers: [QuestionAdminController, QuestionController, QuestionImageController],
  providers: [QuestionService],
})
export class QuestionModule {}

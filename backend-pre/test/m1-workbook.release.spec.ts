import 'reflect-metadata';

process.env.DB_TYPE = 'better-sqlite3';
process.env.DB_DATABASE = ':memory:';
process.env.DB_SYNC = 'true';
process.env.DB_MIGRATIONS_RUN = 'false';
process.env.SMS_DEV_MODE = 'true';
process.env.QUESTION_IMAGE_DIR = '.tmp-m1-release/question-images';
process.env.QUESTION_IMPORT_DIR = '.tmp-m1-release/question-imports';

import { existsSync } from 'fs';
import { readFile, readdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AppModule } from '../src/app.module';
import { AuthUser } from '../src/common';
import {
  Comment,
  ExamAttempt,
  Question,
  QuestionCategoryEntity,
  QuestionCategoryGeneration,
  QuestionImportBatch,
  QuestionPractice,
  StudyQuestionProgress,
  WrongQuestion,
} from '../src/entities';
import { ExamService } from '../src/modules/exam';
import { QuestionService } from '../src/modules/question';

const workbookPath = resolve(__dirname, '../../docs/M1 20260803.xlsx');
describe('M1 20260803.xlsx release validation', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: QuestionService;
  let exam: ExamService;
  const admin: AuthUser = { tenantId: 't1', userId: 'admin-m1-release', role: 'admin' };
  const learner: AuthUser = { tenantId: 't1', userId: 'learner-m1-release', role: 'user' };

  beforeAll(async () => {
    if (!existsSync(workbookPath)) throw new Error(`Missing release workbook: ${workbookPath}`);
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ds = moduleRef.get(DataSource);
    service = moduleRef.get(QuestionService);
    exam = moduleRef.get(ExamService);
  });

  afterAll(async () => {
    await app.close();
    await rm(resolve(process.cwd(), '.tmp-m1-release'), { recursive: true, force: true });
  });

  it('rejects missing, unsupported, oversized, corrupt, and structurally invalid workbooks', async () => {
    await expect(service.previewM1Replacement(admin, undefined)).rejects.toThrow('请上传 M1 Excel 文件');
    await expect(
      service.previewM1Replacement(admin, { buffer: Buffer.from('xlsx'), originalname: 'M1.xls' }),
    ).rejects.toThrow('仅支持 .xlsx 文件');
    await expect(
      service.previewM1Replacement(admin, {
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        originalname: 'M1.xlsx',
      }),
    ).rejects.toThrow('不能超过 5MB');
    await expect(
      service.previewM1Replacement(admin, { buffer: Buffer.from('not-a-zip'), originalname: 'M1.xlsx' }),
    ).rejects.toThrow('压缩结构无效');

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['题干', 'A', 'B', '答案'], ['错误样例', '甲', '乙', 'A']]),
      '错误章节',
    );
    const wrongSheets = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(
      service.previewM1Replacement(admin, { buffer: wrongSheets, originalname: 'M1.xlsx' }),
    ).rejects.toThrow('工作表必须按顺序');
  });

  it('extracts standard Excel drawing images at their anchored row and column', () => {
    const sheet = {} as XLSX.WorkSheet;
    const image = Buffer.from('standard-drawing-image');
    const wb = {
      SheetNames: ['题库'],
      Sheets: { 题库: sheet },
      files: {
        'xl/worksheets/_rels/sheet1.xml.rels': { content: Buffer.from(
          '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml" /></Relationships>',
        ) },
        'xl/drawings/drawing1.xml': { content: Buffer.from(
          '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>12</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rImg1" /></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
        ) },
        'xl/drawings/_rels/drawing1.xml.rels': { content: Buffer.from(
          '<Relationships><Relationship Target="../media/image1.jpg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Id="rImg1" /></Relationships>',
        ) },
        'xl/media/image1.jpg': { content: image },
      },
    } as unknown as XLSX.WorkBook;

    const extracted = (service as any).extractWorkbookImages(wb, sheet) as Map<number, Array<{ colIndex: number; buffer: Buffer }>>;
    expect(extracted.get(4)).toHaveLength(1);
    expect(extracted.get(4)?.[0].colIndex).toBe(12);
    expect(extracted.get(4)?.[0].buffer.equals(image)).toBe(true);
  });

  it('parses the 2370-question consolidated M1 layout into 23 ordered chapters', () => {
    const policy = [
      ['1.1', 10], ['1.2', 14], ['1.3', 13], ['2.1', 11], ['2.2', 8], ['2.3', 26], ['2.4', 4],
      ['3.1', 96], ['3.2', 156], ['3.3', 309], ['3.4', 105], ['4.1', 367], ['4.2', 207],
      ['4.3', 214], ['4.4', 122], ['4.5', 3], ['5.1', 96], ['5.2', 106], ['6.1', 118],
      ['6.2', 157], ['6.3', 135], ['7.1', 58], ['7.2', 35],
    ] as const;
    const rows: unknown[][] = [['章节', '题目', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '解析图片']];
    let sequence = 0;
    for (const [chapter, count] of policy) {
      for (let index = 0; index < count; index += 1) {
        sequence += 1;
        const singleOption = sequence <= 2;
        rows.push([
          chapter,
          `题目-${sequence}`,
          singleOption ? '' : 'A',
          singleOption ? '' : 'B',
          singleOption ? '' : 'C',
          'D',
          singleOption ? 'D' : 'A',
          `解析-${sequence}`,
          '',
        ]);
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['统计']]), '章节统计');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '题库');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['图片查看']]), '图片查看');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const images = new Map<number, Array<{ ext: string; buffer: Buffer; colIndex: number }>>();
    for (let rowIndex = 1; rowIndex <= 51; rowIndex += 1) {
      images.set(rowIndex, [{ ext: '.jpg', buffer: Buffer.from(`image-${rowIndex}`), colIndex: 8 }]);
    }
    const extractor = jest.spyOn(service as any, 'extractWorkbookImages').mockReturnValue(images);
    try {
      const parsed = (service as any).parseM1Workbook({ buffer, originalname: 'M1-2025.xlsx' });
      expect(parsed.totalRows).toBe(2370);
      expect(parsed.imageCells).toBe(51);
      expect(parsed.singleOptionQuestions).toBe(2);
      expect(parsed.chapters.map((chapter: any) => [chapter.name, chapter.plan.toSave.length])).toEqual(policy);
    } finally {
      extractor.mockRestore();
    }
  });

  it('preflights all seven sheets and atomically replaces the managed M1 scope', async () => {
    const buffer = await readFile(workbookPath);
    const old = await ds.getRepository(Question).save(
      ds.getRepository(Question).create({
        tenantId: 't1',
        category: 'M1 航空概论',
        generation: 1,
        chapterName: '',
        chapterOrder: 0,
        chapterQuestionOrder: 0,
        courseId: null,
        type: 'single',
        stem: 'OLD-M1',
        stemImageUrls: null,
        options: [{ key: 'A', text: '旧题' }, { key: 'B', text: '新题' }],
        answer: 'A',
        analysis: 'old',
        imageUrls: null,
        usage: 'both',
        order: 1,
        importBatchId: null,
      }),
    );
    await ds.getRepository(Comment).save({ tenantId: 't1', userId: learner.userId, questionId: old.id, content: 'old' });
    await ds.getRepository(QuestionPractice).save({
      tenantId: 't1', userId: learner.userId, questionId: old.id, seenCount: 1, correctCount: 0, wrongCount: 1,
      lastSeenAt: new Date(), lastCorrectAt: null, lastWrongAt: new Date(),
    });
    await ds.getRepository(WrongQuestion).save({
      tenantId: 't1', userId: learner.userId, questionId: old.id, source: 'study', wrongCount: 1,
      status: 'open', lastWrongAt: new Date(),
    });
    await ds.getRepository(StudyQuestionProgress).save({
      tenantId: 't1', userId: learner.userId, category: 'M1 航空概论', courseId: '', chapterName: '',
      questionId: old.id, lastStudiedAt: new Date(),
    });
    const snapshots = [{
      id: old.id, category: old.category, type: old.type, stem: old.stem, stemImageUrls: [], options: old.options,
      answer: old.answer, analysis: old.analysis, imageUrls: [],
    }];
    const submitted = await ds.getRepository(ExamAttempt).save({
      tenantId: 't1', userId: learner.userId, courseId: null, category: 'M1 航空概论', questionIds: [old.id],
      questionSnapshots: snapshots, answers: { [old.id]: 'A' }, total: 1, correct: 1, score: 100, status: 'submitted',
      draftVersion: 0, draftHash: '', currentQuestionIndex: 0, activeKey: null, abandonedAt: null,
      submittedAt: new Date(), deletedAt: null,
    });
    const active = await ds.getRepository(ExamAttempt).save({
      tenantId: 't1', userId: 'active-user', courseId: null, category: 'M1 航空概论', questionIds: [old.id],
      questionSnapshots: snapshots, answers: {}, total: 1, correct: 0, score: 0, status: 'in_progress',
      draftVersion: 0, draftHash: '', currentQuestionIndex: 0, activeKey: 'active', abandonedAt: null,
      submittedAt: null, deletedAt: null,
    });
    const legacyActive = await ds.getRepository(ExamAttempt).save({
      tenantId: 't1', userId: 'legacy-active-user', courseId: null, category: 'M1 航空概论', questionIds: [old.id],
      questionSnapshots: snapshots, answers: {}, total: 1, correct: 0, score: 0, status: 'in_progress',
      draftVersion: 0, draftHash: '', currentQuestionIndex: 0, activeKey: null, abandonedAt: null,
      submittedAt: null, deletedAt: null,
    });

    const preview = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    expect(preview.totalRows).toBe(1698);
    expect(preview.imageCells).toBe(23);
    expect(preview.chapters.map((chapter) => [chapter.name, chapter.questionCount])).toEqual([
      ['第1章', 331], ['第2章', 287], ['第3章', 245], ['第4章', 400], ['第5章', 180], ['第6章', 150], ['第7章', 105],
    ]);
    expect(preview.chapters.reduce((sum, chapter) => sum + chapter.imageSamples.length, 0)).toBeGreaterThan(0);

    const published = await service.publishM1Replacement(admin, preview.batchId, preview.confirmPhrase);
    expect(published).toMatchObject({ imported: 1698, generation: 2, idempotent: false });
    await expect(service.publishM1Replacement(admin, preview.batchId, preview.confirmPhrase)).resolves.toMatchObject({ idempotent: true });
    expect(await ds.getRepository(Question).count({ where: { tenantId: 't1', category: 'M1 航空概论' } })).toBe(1698);
    const chapters = await service.listChapters(learner, 'M1 航空概论');
    expect(chapters.map((chapter) => chapter.questionCount)).toEqual([331, 287, 245, 400, 180, 150, 105]);
    expect(await ds.getRepository(Comment).count()).toBe(0);
    expect(await ds.getRepository(QuestionPractice).count()).toBe(0);
    expect(await ds.getRepository(WrongQuestion).count()).toBe(0);
    expect(await ds.getRepository(StudyQuestionProgress).count()).toBe(0);
    expect((await ds.getRepository(ExamAttempt).findOneByOrFail({ id: submitted.id })).status).toBe('submitted');
    const abandoned = await ds.getRepository(ExamAttempt).findOneByOrFail({ id: active.id });
    expect(abandoned.activeKey).toBeNull();
    expect(abandoned.abandonedAt).toBeTruthy();
    expect((await ds.getRepository(ExamAttempt).findOneByOrFail({ id: legacyActive.id })).abandonedAt).toBeTruthy();
    const imageFiles = await readdir(resolve(process.cwd(), '.tmp-m1-release/question-images', preview.batchId));
    expect(imageFiles.some((name) => name.startsWith('preview-'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), '.tmp-m1-release/question-imports', preview.batchId, 'source.xlsx'))).toBe(false);
  }, 120_000);

  it('filters questions by chapter, keeps independent chapter progress, and rejects stale-generation writes', async () => {
    const firstChapter = await service.list(learner, {
      usage: 'study', category: 'M1 航空概论', chapter: '第1章', page: 1, pageSize: 10,
    } as any);
    const secondChapter = await service.list(learner, {
      usage: 'study', category: 'M1 航空概论', chapter: '第2章', page: 1, pageSize: 10,
    } as any);
    expect(firstChapter.total).toBe(331);
    expect(secondChapter.total).toBe(287);
    expect(firstChapter.items.every((question) => question.chapterName === '第1章')).toBe(true);
    expect(secondChapter.items.every((question) => question.chapterName === '第2章')).toBe(true);

    await exam.recordStudyProgress(learner, firstChapter.items[0].id);
    await exam.recordStudyProgress(learner, secondChapter.items[0].id);
    const chapters = await service.listChapters(learner, 'M1 航空概论');
    expect(chapters.find((chapter) => chapter.name === '第1章')?.resumePosition).toBe(1);
    expect(chapters.find((chapter) => chapter.name === '第2章')?.resumePosition).toBe(1);
    expect(await ds.getRepository(StudyQuestionProgress).count({
      where: { tenantId: learner.tenantId, userId: learner.userId, category: 'M1 航空概论' },
    })).toBe(2);

    const generationRepo = ds.getRepository(QuestionCategoryGeneration);
    const generation = await generationRepo.findOneByOrFail({ tenantId: learner.tenantId, category: 'M1 航空概论' });
    await generationRepo.update(generation.id, { generation: generation.generation + 1 });
    try {
      await expect(exam.recordStudyProgress(learner, firstChapter.items[0].id)).rejects.toThrow(
        '题库已更新，请重新加载当前章节',
      );
    } finally {
      await generationRepo.update(generation.id, { generation: generation.generation });
    }
  });

  it('rejects M1 through ordinary mutation endpoints', async () => {
    const buffer = await readFile(workbookPath);
    await expect(
      service.importFile(admin, { buffer, originalname: 'M1 20260803.xlsx' }, 'both', 'M1 航空概论', undefined),
    ).rejects.toThrow('M1 为整包管理科目');
    const category = await ds.getRepository(QuestionCategoryEntity).findOneByOrFail({ tenantId: 't1', name: 'M1 航空概论' });
    await expect(service.renameCategory(admin, category.id, 'M1 临时')).rejects.toThrow('不能改名');
    await expect(service.deleteCategory(admin, category.id)).rejects.toThrow('不能删除');
    const other = await ds.getRepository(Question).save(ds.getRepository(Question).create({
      tenantId: 't1', category: 'M2 航空器维修', generation: 1, chapterName: '', chapterOrder: 0,
      chapterQuestionOrder: 0, courseId: null, type: 'single', stem: '普通题', stemImageUrls: null,
      options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }], answer: 'A', analysis: '', imageUrls: null,
      usage: 'both', order: 1, importBatchId: null,
    }));
    await expect(service.updateOne(admin, other.id, { category: ' M1 航空概论 ' })).rejects.toThrow('M1 为整包管理科目');
  });

  it('keeps only the newest active M1 preview for a tenant', async () => {
    const buffer = await readFile(workbookPath);
    const first = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    const second = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    const batches = await ds.getRepository(QuestionImportBatch).findBy([{ id: first.batchId }, { id: second.batchId }]);
    expect(Object.fromEntries(batches.map((batch) => [batch.id, batch.status]))).toMatchObject({
      [first.batchId]: 'expired',
      [second.batchId]: 'previewed',
    });
    expect(existsSync(resolve(process.cwd(), '.tmp-m1-release/question-imports', first.batchId))).toBe(false);
  }, 120_000);

  it('rejects a bad confirmation and a preview whose staged source was removed', async () => {
    const buffer = await readFile(workbookPath);
    const preview = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    await expect(service.publishM1Replacement(admin, preview.batchId, '错误确认语')).rejects.toThrow('发布确认语不匹配');

    const batch = await ds.getRepository(QuestionImportBatch).findOneByOrFail({ id: preview.batchId });
    expect(batch.stagedFilePath).toBeTruthy();
    await rm(resolve(batch.stagedFilePath!), { force: true });
    await expect(service.publishM1Replacement(admin, preview.batchId, preview.confirmPhrase)).rejects.toThrow(
      '预检源文件已清理，请重新上传校验',
    );
  }, 120_000);

  it('expires an overdue preview and cleans its staged artifacts', async () => {
    const buffer = await readFile(workbookPath);
    const preview = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    await ds.getRepository(QuestionImportBatch).update(preview.batchId, { expiresAt: new Date(Date.now() - 1_000) });

    await expect(service.publishM1Replacement(admin, preview.batchId, preview.confirmPhrase)).rejects.toThrow(
      '预检批次已过期，请重新上传校验',
    );
    expect(existsSync(resolve(process.cwd(), '.tmp-m1-release/question-imports', preview.batchId))).toBe(false);
    expect((await ds.getRepository(QuestionImportBatch).findOneByOrFail({ id: preview.batchId })).status).toBe('expired');
  }, 120_000);

  it('rejects a preview whose base generation is stale', async () => {
    const buffer = await readFile(workbookPath);
    const stale = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    await ds.getRepository(QuestionCategoryGeneration).update(
      { tenantId: 't1', category: 'M1 航空概论' },
      { generation: 3 },
    );
    try {
      await expect(service.publishM1Replacement(admin, stale.batchId, stale.confirmPhrase)).rejects.toThrow(
        'M1 题库已更新，请重新预检后再发布',
      );

      const generation = await ds.getRepository(QuestionCategoryGeneration).findOneByOrFail({
        tenantId: 't1',
        category: 'M1 航空概论',
      });
      expect(generation.generation).toBe(3);
      expect(await ds.getRepository(Question).count({ where: { tenantId: 't1', category: 'M1 航空概论' } })).toBe(1698);
    } finally {
      await ds.getRepository(QuestionCategoryGeneration).update(
        { tenantId: 't1', category: 'M1 航空概论' },
        { generation: 2 },
      );
    }
  }, 120_000);
});

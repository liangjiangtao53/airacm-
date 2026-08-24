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
import { QuestionService } from '../src/modules/question';

const workbookPath = resolve(__dirname, '../../docs/M1 20260803.xlsx');
describe('M1 20260803.xlsx release validation', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: QuestionService;
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
  });

  afterAll(async () => {
    await app.close();
    await rm(resolve(process.cwd(), '.tmp-m1-release'), { recursive: true, force: true });
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
    const imageFiles = await readdir(resolve(process.cwd(), '.tmp-m1-release/question-images', preview.batchId));
    expect(imageFiles.some((name) => name.startsWith('preview-'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), '.tmp-m1-release/question-imports', preview.batchId, 'source.xlsx'))).toBe(false);
  }, 120_000);

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

  it('rejects a preview whose base generation is stale', async () => {
    const buffer = await readFile(workbookPath);
    const stale = await service.previewM1Replacement(admin, { buffer, originalname: 'M1 20260803.xlsx' });
    await ds.getRepository(QuestionCategoryGeneration).update(
      { tenantId: 't1', category: 'M1 航空概论' },
      { generation: 3 },
    );
    await expect(service.publishM1Replacement(admin, stale.batchId, stale.confirmPhrase)).rejects.toThrow(
      'M1 题库已更新，请重新预检后再发布',
    );

    const generation = await ds.getRepository(QuestionCategoryGeneration).findOneByOrFail({
      tenantId: 't1',
      category: 'M1 航空概论',
    });
    expect(generation.generation).toBe(3);
    expect(await ds.getRepository(Question).count({ where: { tenantId: 't1', category: 'M1 航空概论' } })).toBe(1698);
  }, 120_000);
});

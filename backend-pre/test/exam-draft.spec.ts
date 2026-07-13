import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { ALL_ENTITIES, ExamPaperRule, Question, QuestionPractice, User } from '../src/entities';
import { ExamModule, ExamService } from '../src/modules/exam';
import { QuestionPoolCacheService } from '../src/modules/question-pool-cache';
import { SessionModule } from '../src/session';
import { env } from '../src/config';

describe('exam draft lifecycle', () => {
  let module: TestingModule;
  let service: ExamService;
  let questions: Repository<Question>;
  const user = { userId: 'draft-user', tenantId: 't1', role: 'user' as const };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          dropSchema: true,
          synchronize: true,
          entities: ALL_ENTITIES,
        }),
        JwtModule.register({ global: true, secret: env.jwtSecret }),
        SessionModule,
        ExamModule,
      ],
    }).compile();
    await module.init();
    service = module.get(ExamService);
    questions = module.get(getRepositoryToken(Question));
    await module.get<Repository<User>>(getRepositoryToken(User)).save({
      id: user.userId,
      tenantId: user.tenantId,
      phone: '13800000009',
      nickname: 'draft-user',
      passwordHash: '',
      openid: null,
      wechatOpenid: null,
      registrationSource: 'register',
      role: 'user',
    });
    await module.get<Repository<ExamPaperRule>>(getRepositoryToken(ExamPaperRule)).save({
      tenantId: user.tenantId,
      totalCount: 2,
      categoryCounts: { 'M1 航空概论': 2 },
    });
    await questions.save([
      questions.create({
        tenantId: user.tenantId,
        category: 'M1 航空概论',
        courseId: null,
        type: 'single',
        stem: 'question one',
        stemImageUrls: null,
        options: [{ key: 'A', text: 'right' }, { key: 'B', text: 'wrong' }],
        answer: 'A',
        analysis: 'analysis one',
        imageUrls: null,
        usage: 'exam',
        order: 1,
      }),
      questions.create({
        tenantId: user.tenantId,
        category: 'M1 航空概论',
        courseId: null,
        type: 'single',
        stem: 'question two',
        stemImageUrls: null,
        options: [{ key: 'A', text: 'wrong' }, { key: 'B', text: 'right' }],
        answer: 'B',
        analysis: 'analysis two',
        imageUrls: null,
        usage: 'exam',
        order: 2,
      }),
    ]);
    await module.get(QuestionPoolCacheService).refreshTenant(user.tenantId);
  });

  afterAll(async () => module?.close());

  it('restores one active paper and protects draft versions and submit retries', async () => {
    const first = await service.start(user, { category: 'M1 航空概论' });
    const resumed = await service.start(user, { category: 'M1 航空概论' });
    expect(resumed.attemptId).toBe(first.attemptId);
    expect(resumed.resumed).toBe(true);

    const answer = Object.fromEntries(first.questions.map((question) => [question.id, 'A']));
    await expect(
      service.saveDraft(user, first.attemptId, {
        version: 1,
        currentQuestionIndex: 1,
        answers: answer,
      }),
    ).resolves.toMatchObject({ draftVersion: 1, unchanged: false });
    await expect(
      service.saveDraft(user, first.attemptId, {
        version: 1,
        currentQuestionIndex: 1,
        answers: answer,
      }),
    ).resolves.toMatchObject({ draftVersion: 1, unchanged: true });
    await expect(
      service.saveDraft(user, first.attemptId, {
        version: 1,
        currentQuestionIndex: 0,
        answers: answer,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const submitted = await service.submit(user, first.attemptId, answer);
    const retried = await service.submit(user, first.attemptId, {});
    expect(retried).toEqual(submitted);
    const practices = await module
      .get<Repository<QuestionPractice>>(getRepositoryToken(QuestionPractice))
      .find({ where: { tenantId: user.tenantId, userId: user.userId } });
    expect(practices).toHaveLength(2);
    expect(practices.every((practice) => practice.seenCount === 1)).toBe(true);
    await expect(
      service.saveDraft(user, first.attemptId, {
        version: 2,
        currentQuestionIndex: 1,
        answers: answer,
      }),
    ).rejects.toThrow('进行中的考试不存在');
    expect(await service.active(user)).toBeNull();
  });

  it('abandons an active paper before creating a replacement', async () => {
    const first = await service.start(user, { category: 'M1 航空概论' });
    await expect(service.abandon(user, first.attemptId)).resolves.toEqual({ abandoned: true });
    const replacement = await service.start(user, { category: 'M1 航空概论' });
    expect(replacement.attemptId).not.toBe(first.attemptId);
  });
});

import 'reflect-metadata';

// 内存库 + dev 配置(必须在 import AppModule / config 前设好)。
process.env.DB_TYPE = 'better-sqlite3';
process.env.DB_DATABASE = ':memory:';
process.env.DB_SYNC = 'true';
process.env.SMS_DEV_MODE = 'true';
process.env.SMS_DEV_CODE = '1234';
process.env.APP_APK_PATH = '.tmp-test-app-upload.apk';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { AppModule } from '../src/app.module';
import { AuthUser, signToken } from '../src/common';
import { AccessKey, Question, QuestionPractice, QuestionUsage, User, Wallet, WrongQuestion } from '../src/entities';
import { SmsService } from '../src/modules/sms';

const TENANT = 't1';

// 构造导入用 xlsx Buffer(表头 + 数据行)。
function buildXlsx(rows: unknown[][]): Buffer {
  const header = ['题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'];
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '题目');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('新功能:短信注册 / 题库导入 / 越权修复', () => {
  let app: INestApplication;
  let ds: DataSource;
  let jwt: JwtService;
  let sms: SmsService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    ds = moduleRef.get(DataSource);
    jwt = moduleRef.get(JwtService);
    sms = moduleRef.get(SmsService);
  });

  afterAll(async () => {
    await app.close();
    await fs.promises.rm(process.env.APP_APK_PATH!, { force: true });
  });

  let phoneSeq = 0;
  function uniquePhone(): string {
    // 13xxxxxxxxx,序号递增保证唯一且不撞库。
    return `139${String(10000000 + phoneSeq++).slice(-8)}`;
  }

  async function makeUser(
    role: 'user' | 'admin' | 'super',
  ): Promise<{ user: AuthUser; token: string }> {
    // 单点登录:role=user 的 token 必须带 sid 且与 user.sessionId 一致,否则守卫 401。
    const sid = crypto.randomUUID();
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        tenantId: TENANT,
        phone: uniquePhone(),
        passwordHash: 'x',
        role,
        openid: null,
        sessionId: sid,
      }),
    );
    await ds.getRepository(Wallet).save(
      ds.getRepository(Wallet).create({ tenantId: TENANT, userId: u.id, balance: 0 }),
    );
    const authUser: AuthUser = { userId: u.id, tenantId: TENANT, role };
    return { user: authUser, token: signToken(jwt, authUser, sid) };
  }

  // ===== SmsService 单元 =====
  describe('SmsService', () => {
    it('dev 模式发码后可校验,且一次性消费', async () => {
      const phone = uniquePhone();
      await sms.sendCode(phone);
      expect(sms.verify(phone, '0000')).toBe(false); // 错码
      expect(sms.verify(phone, '1234')).toBe(true); // 正确
      expect(sms.verify(phone, '1234')).toBe(false); // 已消费,不可重用
    });

    it('同号 60s 内重发被拒(防轰炸)', async () => {
      const phone = uniquePhone();
      await sms.sendCode(phone);
      await expect(sms.sendCode(phone)).rejects.toThrow();
    });
  });

  // ===== 注册流程 =====
  describe('POST /auth/send-code + /auth/register', () => {
    it('发码 → 用正确验证码注册成功,返回 token', async () => {
      const phone = uniquePhone();
      const sent = await request(app.getHttpServer()).post('/auth/send-code').send({ phone });
      expect(sent.status).toBe(201);
      expect(sent.body.data.sent).toBe(true);

      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone, code: '1234', password: 'passw0rd123' });
      expect(reg.status).toBe(201);
      expect(reg.body.data.token).toBeTruthy();
    });

    it('验证码错误注册被拒', async () => {
      const phone = uniquePhone();
      await sms.sendCode(phone); // 种码 1234
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone, code: '9999', password: 'passw0rd123' });
      expect(reg.status).toBe(400);
    });

    it('已注册手机号发码被拒', async () => {
      const phone = uniquePhone();
      await sms.sendCode(phone);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone, code: '1234', password: 'passw0rd123' });
      const again = await request(app.getHttpServer()).post('/auth/send-code').send({ phone });
      expect(again.status).toBe(400);
    });
  });

  describe('POST /auth/password', () => {
    it('修改密码必须校验原密码,并要求新密码复杂', async () => {
      const phone = uniquePhone();
      const oldPassword = 'OldPass@123';
      const newPassword = 'NewPass@456';
      const sid = crypto.randomUUID();
      const u = await ds.getRepository(User).save(
        ds.getRepository(User).create({
          tenantId: TENANT,
          phone,
          nickname: '改密管理员',
          passwordHash: await bcrypt.hash(oldPassword, 10),
          role: 'admin',
          openid: null,
          sessionId: sid,
        }),
      );
      const authUser: AuthUser = { userId: u.id, tenantId: TENANT, role: 'admin' };
      const token = signToken(jwt, authUser, sid);

      const wrongOld = await request(app.getHttpServer())
        .post('/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'WrongPass@123', newPassword });
      expect(wrongOld.status).toBe(400);

      const weakNew = await request(app.getHttpServer())
        .post('/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword, newPassword: 'simple12345' });
      expect(weakNew.status).toBe(400);

      const changed = await request(app.getHttpServer())
        .post('/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword, newPassword });
      expect(changed.status).toBe(201);
      expect(changed.body.data.ok).toBe(true);

      const oldLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ phone, password: oldPassword });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ phone, password: newPassword });
      expect(newLogin.status).toBe(201);
      expect(newLogin.body.data.token).toBeTruthy();
    });
  });

  // ===== 越权修复:类级 @Roles('admin') 必须生效 =====
  describe('RolesGuard 类级守卫', () => {
    it('普通用户访问题库导入接口 401', async () => {
      const { token } = await makeUser('user');
      const res = await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('无 token 访问题库导入 401', async () => {
      const res = await request(app.getHttpServer()).post('/admin/questions/import?usage=study');
      expect(res.status).toBe(401);
    });
  });

  // ===== 题库 Excel 导入 + 学习刷题 + 评论 =====
  describe('题库导入与学习', () => {
    it('admin 导入:合法行入库、非法行收集,整批打 usage 标记', async () => {
      const { token } = await makeUser('admin');
      const xlsx = buildXlsx([
        ['1+1=?', '1', '2', '3', '4', 'B', '基础'],
        ['多选题', '甲', '乙', '丙', '丁', 'AC', '解析'],
        ['缺答案', '甲', '乙', '', '', '', ''], // 非法:答案为空
      ]);
      const res = await request(app.getHttpServer())
        .post('/admin/questions/import?usage=both')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', xlsx, 'q.xlsx');
      expect(res.status).toBe(201);
      expect(res.body.data.imported).toBe(2);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.failed[0].row).toBe(4); // 含表头第 4 行

      const saved = await ds.getRepository(Question).find({ where: { tenantId: TENANT, usage: 'both' } });
      expect(saved).toHaveLength(2);
      const multi = saved.find((q) => q.answer === 'AC');
      expect(multi?.type).toBe('multiple'); // 多字母答案识别为多选
    });

    it('学习列表默认不下发答案,查看答案单独取', async () => {
      const admin = await makeUser('admin');
      await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', buildXlsx([['学习题', '对', '错', '', '', 'A', '因为对']]), 'q.xlsx');

      const user = await makeUser('user');
      const list = await request(app.getHttpServer())
        .get('/questions?usage=study')
        .set('Authorization', `Bearer ${user.token}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find((q: { stem: string }) => q.stem === '学习题');
      expect(item).toBeTruthy();
      expect(item.answer).toBeUndefined(); // 列表不含答案
      expect(item.analysis).toBeUndefined();

      const ans = await request(app.getHttpServer())
        .get(`/questions/${item.id}/answer`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(ans.status).toBe(200);
      expect(ans.body.data.answer).toBe('A');
      expect(ans.body.data.analysis).toBe('因为对');
    });

    it('学习端可对题目评论并读取', async () => {
      const admin = await makeUser('admin');
      await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', buildXlsx([['评论题', '甲', '乙', '', '', 'A', '']]), 'q.xlsx');
      const q = await ds.getRepository(Question).findOneOrFail({ where: { tenantId: TENANT, stem: '评论题' } });

      const user = await makeUser('user');
      const post = await request(app.getHttpServer())
        .post(`/questions/${q.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ content: '这题不错' });
      expect(post.status).toBe(201);

      const list = await request(app.getHttpServer())
        .get(`/questions/${q.id}/comments`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].content).toBe('这题不错');
    });
  });

  // ===== 考试组卷 + 判分 =====
  describe('考试答题判分', () => {
    const COURSE = 'exam-course-1';
    const correctByStem: Record<string, string> = { E1: 'A', E2: 'B', E3: 'AC' };

    beforeAll(async () => {
      const repo = ds.getRepository(Question);
      const mk = (stem: string, answer: string, usage: QuestionUsage) =>
        repo.create({
          tenantId: TENANT,
          courseId: COURSE,
          type: answer.length > 1 ? 'multiple' : 'single',
          stem,
          options: [
            { key: 'A', text: '甲' },
            { key: 'B', text: '乙' },
            { key: 'C', text: '丙' },
            { key: 'D', text: '丁' },
          ],
          answer,
          analysis: `${stem} 解析`,
          usage,
          order: 0,
        });
      await repo.save([mk('E1', 'A', 'exam'), mk('E2', 'B', 'exam'), mk('E3', 'AC', 'both')]);
    });

    function pickAnswers(
      questions: Array<{ id: string; stem: string }>,
      map: (stem: string) => string,
    ): Record<string, string> {
      const a: Record<string, string> = {};
      questions.forEach((q) => (a[q.id] = map(q.stem)));
      return a;
    }

    it('组卷返回不含答案的卷面,全对得 100', async () => {
      const { token } = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(3);
      expect(start.body.data.questions[0].answer).toBeUndefined(); // 卷面不泄露答案

      const answers = pickAnswers(start.body.data.questions, (s) => correctByStem[s]);
      const sub = await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers });
      expect(sub.status).toBe(201);
      expect(sub.body.data.score).toBe(100);
      expect(sub.body.data.correct).toBe(3);
      expect(sub.body.data.details.every((d: { isCorrect: boolean }) => d.isCorrect)).toBe(true);
    });

    it('admin can set exam rule, users cannot, and client count is ignored', async () => {
      const admin = await makeUser('admin');
      const user = await makeUser('user');

      const denied = await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ totalCount: 2 });
      expect(denied.status).toBe(401);

      const saved = await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 2 });
      expect(saved.status).toBe(200);
      expect(saved.body.data.totalCount).toBe(2);

      const current = await request(app.getHttpServer())
        .get('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(current.body.data.totalCount).toBe(2);

      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE, count: 1 });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(2);

      await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 100 });
    });

    it('全错得 0,且不可重复交卷', async () => {
      const { token } = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE });
      const attemptId = start.body.data.attemptId;
      const wrong = pickAnswers(start.body.data.questions, () => 'D'); // 全选 D,均错

      const sub = await request(app.getHttpServer())
        .post(`/exams/${attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: wrong });
      expect(sub.body.data.score).toBe(0);

      const again = await request(app.getHttpServer())
        .post(`/exams/${attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: wrong });
      expect(again.status).toBe(400); // 已交卷
    });

    it('历史记录含已交卷成绩', async () => {
      const { token } = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE });
      await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: pickAnswers(start.body.data.questions, (s) => correctByStem[s]) });

      const hist = await request(app.getHttpServer())
        .get('/exams/history')
        .set('Authorization', `Bearer ${token}`);
      expect(hist.status).toBe(200);
      expect(hist.body.data).toHaveLength(1);
      expect(hist.body.data[0].score).toBe(100);
    });
  });

  describe('adaptive question picking', () => {
    async function seedQuestions(prefix: string, count: number, usage: QuestionUsage, category: string, courseId: string | null) {
      const repo = ds.getRepository(Question);
      return repo.save(
        Array.from({ length: count }, (_, i) =>
          repo.create({
            tenantId: TENANT,
            courseId,
            category,
            type: 'single',
            stem: `${prefix}-${i + 1}`,
            options: [
              { key: 'A', text: 'A' },
              { key: 'B', text: 'B' },
            ],
            answer: 'A',
            analysis: `${prefix} analysis`,
            usage,
            order: i + 1,
          }),
        ),
      );
    }

    function countByPrefix(rows: Array<{ stem: string }>, prefix: string): number {
      return rows.filter((q) => q.stem.startsWith(prefix)).length;
    }

    it('exam start mixes new, review, and wrong questions instead of pure random', async () => {
      const admin = await makeUser('admin');
      const user = await makeUser('user');
      const category = `ADAPTIVE-EXAM-${phoneSeq++}`;
      const courseId = `adaptive-course-${phoneSeq++}`;
      const fresh = await seedQuestions('EXAM-NEW', 12, 'exam', category, courseId);
      const review = await seedQuestions('EXAM-REVIEW', 5, 'exam', category, courseId);
      const wrong = await seedQuestions('EXAM-WRONG', 3, 'exam', category, courseId);
      const now = new Date();

      await ds.getRepository(QuestionPractice).save(
        review.map((q) =>
          ds.getRepository(QuestionPractice).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: q.id,
            seenCount: 1,
            correctCount: 1,
            wrongCount: 0,
            lastSeenAt: now,
            lastCorrectAt: now,
            lastWrongAt: null,
          }),
        ),
      );
      await ds.getRepository(WrongQuestion).save(
        wrong.map((q, i) =>
          ds.getRepository(WrongQuestion).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: q.id,
            source: 'exam',
            wrongCount: i + 1,
            status: 'open',
            lastWrongAt: now,
          }),
        ),
      );

      await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 10 });
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ category });
      await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 100 });

      const questions = start.body.data.questions as Array<{ stem: string }>;
      expect(start.status).toBe(201);
      expect(questions).toHaveLength(10);
      expect(countByPrefix(questions, 'EXAM-NEW')).toBe(6);
      expect(countByPrefix(questions, 'EXAM-REVIEW')).toBe(3);
      expect(countByPrefix(questions, 'EXAM-WRONG')).toBe(1);
      expect(fresh).toHaveLength(12);
    });

    it('study list uses the same mix but stays inside the selected category', async () => {
      const user = await makeUser('user');
      const category = `ADAPTIVE-STUDY-${phoneSeq++}`;
      const otherCategory = `ADAPTIVE-STUDY-OTHER-${phoneSeq++}`;
      await seedQuestions('STUDY-NEW', 12, 'study', category, null);
      const review = await seedQuestions('STUDY-REVIEW', 5, 'study', category, null);
      const wrong = await seedQuestions('STUDY-WRONG', 3, 'study', category, null);
      await seedQuestions('STUDY-OTHER', 5, 'study', otherCategory, null);
      const now = new Date();

      await ds.getRepository(QuestionPractice).save(
        review.map((q) =>
          ds.getRepository(QuestionPractice).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: q.id,
            seenCount: 1,
            correctCount: 1,
            wrongCount: 0,
            lastSeenAt: now,
            lastCorrectAt: now,
            lastWrongAt: null,
          }),
        ),
      );
      await ds.getRepository(WrongQuestion).save(
        wrong.map((q, i) =>
          ds.getRepository(WrongQuestion).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: q.id,
            source: 'study',
            wrongCount: i + 1,
            status: 'open',
            lastWrongAt: now,
          }),
        ),
      );

      const res = await request(app.getHttpServer())
        .get(`/questions?usage=study&category=${encodeURIComponent(category)}&pageSize=10`)
        .set('Authorization', `Bearer ${user.token}`);

      const items = res.body.data.items as Array<{ stem: string; category: string }>;
      expect(res.status).toBe(200);
      expect(items).toHaveLength(10);
      expect(items.every((q) => q.category === category)).toBe(true);
      expect(countByPrefix(items, 'STUDY-NEW')).toBe(6);
      expect(countByPrefix(items, 'STUDY-REVIEW')).toBe(3);
      expect(countByPrefix(items, 'STUDY-WRONG')).toBe(1);
      expect(countByPrefix(items, 'STUDY-OTHER')).toBe(0);
    });

    it('study answer tracking accumulates repeated answers on one practice row', async () => {
      const user = await makeUser('user');
      const category = `ADAPTIVE-TRACK-${phoneSeq++}`;
      const [q] = await seedQuestions('STUDY-TRACK', 1, 'study', category, null);

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/exams/wrong-book/study')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ questionId: q.id, answer: 'A' }),
        request(app.getHttpServer())
          .post('/exams/wrong-book/study')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ questionId: q.id, answer: 'A' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const rows = await ds.getRepository(QuestionPractice).find({
        where: { tenantId: TENANT, userId: user.user.userId, questionId: q.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].seenCount).toBe(2);
      expect(rows[0].correctCount).toBe(2);
      expect(rows[0].wrongCount).toBe(0);
      expect(rows[0].lastSeenAt).toBeTruthy();
      expect(rows[0].lastCorrectAt).toBeTruthy();
      expect(rows[0].lastWrongAt).toBeNull();
    });
  });

  // ===== 错题本 =====
  describe('错题本', () => {
    const COURSE = 'wrong-course-1';
    const correctByStem: Record<string, string> = { W1: 'A', W2: 'B' };

    beforeAll(async () => {
      const repo = ds.getRepository(Question);
      const mk = (stem: string, answer: string) =>
        repo.create({
          tenantId: TENANT,
          courseId: COURSE,
          type: 'single',
          stem,
          options: [
            { key: 'A', text: '甲' },
            { key: 'B', text: '乙' },
          ],
          answer,
          analysis: `${stem} 解析`,
          usage: 'exam',
          order: 0,
        });
      await repo.save([mk('W1', 'A'), mk('W2', 'B')]);
    });

    async function startCourseExam(token: string) {
      const r = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE });
      return r.body.data as { attemptId: string; questions: Array<{ id: string; stem: string }> };
    }

    it('答错进错题本,标记掌握移出,答对自动移出', async () => {
      const { token } = await makeUser('user');

      // 全错 → 两题都进错题本
      const paper = await startCourseExam(token);
      const wrong: Record<string, string> = {};
      paper.questions.forEach((q) => (wrong[q.id] = 'A' === correctByStem[q.stem] ? 'B' : 'A'));
      await request(app.getHttpServer())
        .post(`/exams/${paper.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: wrong });

      let book = await request(app.getHttpServer())
        .get('/exams/wrong-book')
        .set('Authorization', `Bearer ${token}`);
      expect(book.status).toBe(200);
      expect(book.body.data).toHaveLength(2);
      expect(book.body.data[0].answer).toBeDefined(); // 错题本含答案供复习

      // 标记其一已掌握 → 剩 1
      const masterId = book.body.data[0].questionId;
      const m = await request(app.getHttpServer())
        .post(`/exams/wrong-book/${masterId}/master`)
        .set('Authorization', `Bearer ${token}`);
      expect(m.status).toBe(201);
      book = await request(app.getHttpServer())
        .get('/exams/wrong-book')
        .set('Authorization', `Bearer ${token}`);
      expect(book.body.data).toHaveLength(1);

      // 再考全对 → 剩余 open 题答对自动 mastered → 错题本清空
      const paper2 = await startCourseExam(token);
      const right: Record<string, string> = {};
      paper2.questions.forEach((q) => (right[q.id] = correctByStem[q.stem]));
      await request(app.getHttpServer())
        .post(`/exams/${paper2.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: right });
      book = await request(app.getHttpServer())
        .get('/exams/wrong-book')
        .set('Authorization', `Bearer ${token}`);
      expect(book.body.data).toHaveLength(0);
    });

    it('错题可评论(考试题复用 /questions/:id/comments)', async () => {
      const { token } = await makeUser('user');
      const paper = await startCourseExam(token);
      const wrong: Record<string, string> = {};
      paper.questions.forEach((q) => (wrong[q.id] = 'A' === correctByStem[q.stem] ? 'B' : 'A'));
      await request(app.getHttpServer())
        .post(`/exams/${paper.attemptId}/submit`)
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: wrong });
      const qid = paper.questions[0].id;

      const post = await request(app.getHttpServer())
        .post(`/questions/${qid}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '这题我又错了' });
      expect(post.status).toBe(201);
      const list = await request(app.getHttpServer())
        .get(`/questions/${qid}/comments`)
        .set('Authorization', `Bearer ${token}`);
      expect(list.body.data.some((c: { content: string }) => c.content === '这题我又错了')).toBe(true);
    });
  });

  // ===== 安全/校验:考试答案防泄露 + 评论非空 =====
  describe('考试答案防作弊与评论校验', () => {
    async function mkQuestion(usage: QuestionUsage): Promise<string> {
      const repo = ds.getRepository(Question);
      const q = await repo.save(
        repo.create({
          tenantId: TENANT,
          courseId: null,
          type: 'single',
          stem: `Q-${usage}-${phoneSeq++}`,
          options: [
            { key: 'A', text: '甲' },
            { key: 'B', text: '乙' },
          ],
          answer: 'A',
          analysis: '解析',
          usage,
          order: 0,
        }),
      );
      return q.id;
    }

    it('纯考试题答案不可单独查看(防作弊)', async () => {
      const { token } = await makeUser('user');
      const id = await mkQuestion('exam');
      const res = await request(app.getHttpServer())
        .get(`/questions/${id}/answer`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('study/both 题答案可查看', async () => {
      const { token } = await makeUser('user');
      for (const usage of ['study', 'both'] as QuestionUsage[]) {
        const id = await mkQuestion(usage);
        const res = await request(app.getHttpServer())
          .get(`/questions/${id}/answer`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.data.answer).toBe('A');
      }
    });

    it('纯空白评论被拒', async () => {
      const { token } = await makeUser('user');
      const id = await mkQuestion('study');
      const res = await request(app.getHttpServer())
        .post(`/questions/${id}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '   ' });
      expect(res.status).toBe(400);
    });
  });

  // ===== 科目分类 + 表头驱动导入(兼容真实文件布局) =====
  describe('科目与表头驱动导入', () => {
    // 真实文件布局:序号|题干|选项A|选项B|选项C|参考答案(无选项D、无解析)。
    function realLayoutXlsx(): Buffer {
      const ws = XLSX.utils.aoa_to_sheet([
        ['序号', '题干', '选项A', '选项B', '选项C', '参考答案'],
        [1, 'If you see discoloration, replace the part.', '染色', '变色,更换', '有颜色', 'B'],
        [2, 'If you find a crack, do the repair.', '凹坑', '划痕', '裂纹,修理', 'C'],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    }

    it('按表头名解析真实布局并归档到科目', async () => {
      const { token } = await makeUser('admin');
      const res = await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study&category=' + encodeURIComponent('M9 航空英语'))
        .set('Authorization', `Bearer ${token}`)
        .attach('file', realLayoutXlsx(), '3257.xlsx');
      expect(res.status).toBe(201);
      expect(res.body.data.imported).toBe(2);
      expect(res.body.data.failed).toHaveLength(0);

      const user = await makeUser('user');
      const list = await request(app.getHttpServer())
        .get('/questions?usage=study&category=' + encodeURIComponent('M9 航空英语'))
        .set('Authorization', `Bearer ${user.token}`);
      const item = list.body.data.items.find((q: { stem: string }) => q.stem.startsWith('If you see'));
      expect(item).toBeTruthy();
      expect(item.category).toBe('M9 航空英语');
      expect(item.options).toHaveLength(3); // 3 选项正确解析
    });

    it('非法科目被拒', async () => {
      const { token } = await makeUser('admin');
      const res = await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study&category=' + encodeURIComponent('不存在的科目'))
        .set('Authorization', `Bearer ${token}`)
        .attach('file', realLayoutXlsx(), 'x.xlsx');
      expect(res.status).toBe(400);
    });

    it('GET /questions/categories 返回 9 个科目', async () => {
      const { token } = await makeUser('user');
      const res = await request(app.getHttpServer())
        .get('/questions/categories')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toContain('M9 航空英语');
      expect(res.body.data).toContain('M9 new');
      expect(res.body.data).toContain('无人机');
      expect(res.body.data).toHaveLength(9);
    });
  });

  // ===== App 安装包上传 =====
  describe('App 安装包管理', () => {
    it('admin 可上传 APK,状态接口返回当前下载文件', async () => {
      const { token } = await makeUser('admin');
      const apk = Buffer.from('test apk bytes');
      const upload = await request(app.getHttpServer())
        .post('/admin/app/apk')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', apk, 'airacm-android.apk');
      expect(upload.status).toBe(201);
      expect(upload.body.data.exists).toBe(true);
      expect(upload.body.data.size).toBe(apk.length);
      expect(upload.body.data.url).toBe('/downloads/app/airacm-android.apk');

      const status = await request(app.getHttpServer())
        .get('/admin/app/apk')
        .set('Authorization', `Bearer ${token}`);
      expect(status.status).toBe(200);
      expect(status.body.data.exists).toBe(true);
      expect(status.body.data.size).toBe(apk.length);
    });

    it('admin 上传非 APK 会被拒绝', async () => {
      const { token } = await makeUser('admin');
      const res = await request(app.getHttpServer())
        .post('/admin/app/apk')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not apk'), 'readme.txt');
      expect(res.status).toBe(400);
    });
  });

  // ===== 认证卡密 =====
  describe('认证卡密', () => {
    it('管理员批量生成(默认 20 个),卡密登录后可学习', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({});
      expect(gen.status).toBe(201);
      expect(gen.body.data.keys).toHaveLength(20); // 默认配置 20
      expect(gen.body.data.expiresAt).toBeTruthy();

      const key = gen.body.data.keys[0];
      // 首次卡密登录:返回待补全 token(needProfile),业务接口被拒。
      const login = await request(app.getHttpServer()).post('/auth/key-login').send({ key });
      expect(login.status).toBe(201);
      expect(login.body.data.needProfile).toBe(true);
      const pendingToken = login.body.data.token;

      const blocked = await request(app.getHttpServer())
        .get('/questions?usage=study')
        .set('Authorization', `Bearer ${pendingToken}`);
      expect(blocked.status).toBe(401); // 未补全不放行

      // 补全手机号+昵称后换正式 token。
      const profile = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${pendingToken}`)
        .send({ phone: uniquePhone(), nickname: '卡密学员' + Date.now() });
      expect(profile.status).toBe(201);
      const token = profile.body.data.token;

      // 正式 token 可访问学习端点。
      const study = await request(app.getHttpServer())
        .get('/questions?usage=study')
        .set('Authorization', `Bearer ${token}`);
      expect(study.status).toBe(200);

      // 补全时自动建钱包,访问 /wallet 不 404。
      const wallet = await request(app.getHttpServer())
        .get('/wallet')
        .set('Authorization', `Bearer ${token}`);
      expect(wallet.status).toBe(200);
      expect(wallet.body.data.balance).toBe(0);

      // 卡密用户出现在用户列表(source=key)。
      const users = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(users.status).toBe(200);
      expect(users.body.data.some((u: { source?: string }) => u.source === 'key')).toBe(true);
    });

    it('自定义数量与有效期', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 5, ttlDays: 7 });
      expect(gen.body.data.keys).toHaveLength(5);
    });

    it('超级管理员可以修改卡密有效期', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 1, ttlDays: 30 });
      const list = await request(app.getHttpServer())
        .get('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`);
      const target = list.body.data.find((k: { key: string }) => k.key === gen.body.data.keys[0]);
      const updated = await request(app.getHttpServer())
        .post(`/admin/access-keys/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ttlDays: 90 });
      expect(updated.status).toBe(201);
      const remainingDays = Math.round((new Date(updated.body.data.expiresAt).getTime() - Date.now()) / 86_400_000);
      expect(remainingDays).toBeGreaterThanOrEqual(89);
      expect(remainingDays).toBeLessThanOrEqual(90);
    });

    it('普通用户不能生成卡密', async () => {
      const { token } = await makeUser('user');
      const res = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('无效卡密 / 过期卡密登录被拒', async () => {
      const bad = await request(app.getHttpServer())
        .post('/auth/key-login')
        .send({ key: 'NOTEXIST123456' });
      expect(bad.status).toBe(401);

      const repo = ds.getRepository(AccessKey);
      const expired = await repo.save(
        repo.create({
          tenantId: TENANT,
          key: 'EXPIREDKEY000001',
          expiresAt: new Date(Date.now() - 1000),
          status: 'active',
        }),
      );
      const res = await request(app.getHttpServer())
        .post('/auth/key-login')
        .send({ key: expired.key });
      expect(res.status).toBe(401);
    });

    it('单点登录:同一卡密二次登录踢掉首端,旧 token 失效', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 1 });
      const key = gen.body.data.keys[0];

      // 首次登录 + 补全,拿正式 token A。
      const first = await request(app.getHttpServer()).post('/auth/key-login').send({ key });
      const profile = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${first.body.data.token}`)
        .send({ phone: uniquePhone(), nickname: '单点测试' + Date.now() });
      const tokenA = profile.body.data.token;
      expect(
        (await request(app.getHttpServer()).get('/wallet').set('Authorization', `Bearer ${tokenA}`))
          .status,
      ).toBe(200);

      // 同卡密二次登录(已补全→直接正式登录)刷新 sid,得 token B。
      const second = await request(app.getHttpServer()).post('/auth/key-login').send({ key });
      expect(second.body.data.needProfile).toBe(false);
      const tokenB = second.body.data.token;

      // 旧 token A 被踢:401;新 token B 有效:200。
      expect(
        (await request(app.getHttpServer()).get('/wallet').set('Authorization', `Bearer ${tokenA}`))
          .status,
      ).toBe(401);
      expect(
        (await request(app.getHttpServer()).get('/wallet').set('Authorization', `Bearer ${tokenB}`))
          .status,
      ).toBe(200);
    });

    it('昵称重复补全被拒', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 2 });
      const dupNick = '重名昵称' + Date.now();

      const p1 = await request(app.getHttpServer()).post('/auth/key-login').send({ key: gen.body.data.keys[0] });
      await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${p1.body.data.token}`)
        .send({ phone: uniquePhone(), nickname: dupNick });

      const p2 = await request(app.getHttpServer()).post('/auth/key-login').send({ key: gen.body.data.keys[1] });
      const dup = await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${p2.body.data.token}`)
        .send({ phone: uniquePhone(), nickname: dupNick });
      expect(dup.status).toBe(400);
    });
  });

  // ===== 管理员数据维护 =====
  describe('管理员数据维护', () => {
    const CAT = 'M3 飞机结构和系统';
    function xlsx(): Buffer {
      const ws = XLSX.utils.aoa_to_sheet([
        ['题干', '选项A', '选项B', '答案'],
        ['维护题1', '甲', '乙', 'A'],
        ['维护题2', '甲', '乙', 'B'],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 's');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    }

    it('按科目统计与删除题目(连带评论)', async () => {
      const admin = await makeUser('admin');
      await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study&category=' + encodeURIComponent(CAT))
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', xlsx(), 'm.xlsx');

      const stats = await request(app.getHttpServer())
        .get('/admin/questions/stats')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(stats.status).toBe(200);
      const row = stats.body.data.find((r: { category: string }) => r.category === CAT);
      expect(row.count).toBeGreaterThanOrEqual(2);

      const del = await request(app.getHttpServer())
        .delete('/admin/questions?category=' + encodeURIComponent(CAT))
        .set('Authorization', `Bearer ${admin.token}`);
      expect(del.status).toBe(200);
      expect(del.body.data.deleted).toBeGreaterThanOrEqual(2);
    });

    it('普通用户无法访问维护接口', async () => {
      const { token } = await makeUser('user');
      const a = await request(app.getHttpServer())
        .get('/admin/questions/stats')
        .set('Authorization', `Bearer ${token}`);
      expect(a.status).toBe(401);
      const b = await request(app.getHttpServer())
        .delete('/admin/access-keys/cleanup')
        .set('Authorization', `Bearer ${token}`);
      expect(b.status).toBe(401);
    });

    it('作废卡密后不可登录,清理删除失效卡密', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 2 });
      const list = await request(app.getHttpServer())
        .get('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`);
      const target = list.body.data.find((k: { key: string }) => k.key === gen.body.data.keys[0]);

      const rv = await request(app.getHttpServer())
        .post(`/admin/access-keys/${target.id}/revoke`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(rv.status).toBe(201);

      const login = await request(app.getHttpServer())
        .post('/auth/key-login')
        .send({ key: target.key });
      expect(login.status).toBe(401); // 已作废

      const cleanup = await request(app.getHttpServer())
        .delete('/admin/access-keys/cleanup')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(cleanup.status).toBe(200);
      expect(cleanup.body.data.deleted).toBeGreaterThanOrEqual(1);
    });
  });

  // ===== 角色分层:超管 / 业务管理员 / 普通用户 =====
  describe('角色分层与用户管理', () => {
    it('超管看到全部用户(含管理员/超管),业务管理员只看普通用户', async () => {
      const sup = await makeUser('super');
      await makeUser('admin');
      await makeUser('user');

      const all = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${sup.token}`);
      expect(all.status).toBe(200);
      const roles = new Set(all.body.data.map((u: { role: string }) => u.role));
      expect(roles.has('super')).toBe(true);
      expect(roles.has('admin')).toBe(true);

      const biz = await makeUser('admin');
      const bizView = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${biz.token}`);
      expect(bizView.status).toBe(200); // 业务管理员可访问(super 全通?不,admin 满足 @Roles('admin'))
      expect(bizView.body.data.every((u: { role: string }) => u.role === 'user')).toBe(true);
    });

    it('业务管理员不能删管理员/超管,只能删普通用户', async () => {
      const biz = await makeUser('admin');
      const normal = await makeUser('user');
      const otherAdmin = await makeUser('admin');

      const okDel = await request(app.getHttpServer())
        .delete(`/admin/users/${normal.user.userId}`)
        .set('Authorization', `Bearer ${biz.token}`);
      expect(okDel.status).toBe(200);

      const denied = await request(app.getHttpServer())
        .delete(`/admin/users/${otherAdmin.user.userId}`)
        .set('Authorization', `Bearer ${biz.token}`);
      expect(denied.status).toBe(403);
    });

    it('超管可删业务管理员,但不能删超管或自己', async () => {
      const sup = await makeUser('super');
      const biz = await makeUser('admin');
      const otherSuper = await makeUser('super');

      const delBiz = await request(app.getHttpServer())
        .delete(`/admin/users/${biz.user.userId}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(delBiz.status).toBe(200);

      const delSuper = await request(app.getHttpServer())
        .delete(`/admin/users/${otherSuper.user.userId}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(delSuper.status).toBe(403);

      const delSelf = await request(app.getHttpServer())
        .delete(`/admin/users/${sup.user.userId}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(delSelf.status).toBe(400);
    });

    it('普通用户不能访问用户管理', async () => {
      const { token } = await makeUser('user');
      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });
});

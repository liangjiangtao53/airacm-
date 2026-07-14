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
import {
  AccessKey,
  AdminOperationLog,
  ExamPaperRule,
  Question,
  QuestionImportBatch,
  QuestionPractice,
  QuestionUsage,
  StudyQuestionProgress,
  User,
  UserActivityLog,
  Wallet,
  WrongQuestion,
} from '../src/entities';
import { QuestionService } from '../src/modules/question';
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
  let questionSvc: QuestionService;

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
    questionSvc = moduleRef.get(QuestionService);
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
    const phone = uniquePhone();
    const u = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        tenantId: TENANT,
        phone,
        nickname: `test-${phone}`,
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
      expect(res.body.data.batchId).toBeTruthy();
      const batch = await ds.getRepository(QuestionImportBatch).findOneOrFail({
        where: { tenantId: TENANT, id: res.body.data.batchId },
      });
      expect(batch.imported).toBe(2);
      expect(batch.failed).toBe(1);
      const importLog = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'question_import', targetId: batch.id },
      });
      expect(importLog).toBeTruthy();
      expect(res.body.data.failed[0].row).toBe(4); // 含表头第 4 行

      const saved = await ds.getRepository(Question).find({ where: { tenantId: TENANT, usage: 'both' } });
      expect(saved).toHaveLength(2);
      expect(saved.every((q) => q.importBatchId === batch.id)).toBe(true);
      const multi = saved.find((q) => q.answer === 'AC');
      expect(multi?.type).toBe('multiple'); // 多字母答案识别为多选
    });

    it('WPS stem cell images stay in the stem and DISPIMG formulas are stripped', () => {
      const svc = questionSvc as unknown as {
        extractWpsCellImages: (wb: XLSX.WorkBook, sheet: XLSX.WorkSheet) => Map<number, Array<{ colIndex?: number }>>;
        parseRow: (
          row: unknown[],
          colMap: { stem: number; answer: number; analysis: number; options: Array<{ key: string; idx: number }> },
          images: Array<{ colIndex?: number }>,
        ) => { stem: string; analysis: string } | { error: string };
        splitRowImagesByUsage: (
          images: Array<{ colIndex?: number }>,
          colMap: { stem: number; answer: number; analysis: number; options: Array<{ key: string; idx: number }> },
        ) => { stem: unknown[]; analysis: unknown[] };
      };
      const wb = {
        files: {
          'xl/cellimages.xml': {
            content: Buffer.from(
              '<etc:cellImage><xdr:cNvPr name="ID_STEM"/><a:blip r:embed="rId1"/></etc:cellImage>' +
                '<etc:cellImage><xdr:cNvPr name="ID_ANALYSIS"/><a:blip r:embed="rId2"/></etc:cellImage>',
            ),
          },
          'xl/_rels/cellimages.xml.rels': {
            content: Buffer.from(
              '<Relationship Id="rId1" Target="../media/stem.png"/><Relationship Id="rId2" Target="../media/analysis.png"/>',
            ),
          },
          'xl/media/stem.png': { content: Buffer.from('stem') },
          'xl/media/analysis.png': { content: Buffer.from('analysis') },
        },
      } as unknown as XLSX.WorkBook;
      const sheet = {
        A2: { f: '=DISPIMG("ID_STEM",1)' },
        G2: { f: '=DISPIMG("ID_ANALYSIS",1)' },
      } as unknown as XLSX.WorkSheet;
      const images = svc.extractWpsCellImages(wb, sheet).get(1) ?? [];
      const colMap = {
        stem: 0,
        answer: 5,
        analysis: 6,
        options: [
          { key: 'A', idx: 1 },
          { key: 'B', idx: 2 },
        ],
      };
      const parsed = svc.parseRow(['=DISPIMG("ID_STEM",1)', '选项A', '选项B', '', '', 'A', '=DISPIMG("ID_ANALYSIS",1)'], colMap, images);
      const buckets = svc.splitRowImagesByUsage(images, colMap);

      expect(images.map((image) => image.colIndex).sort()).toEqual([0, 6]);
      expect(parsed).toMatchObject({ stem: '', analysis: '' });
      expect(buckets.stem).toHaveLength(1);
      expect(buckets.analysis).toHaveLength(1);
    });

    it('学习列表默认不下发答案,查看答案单独取', async () => {
      const admin = await makeUser('admin');
      await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', buildXlsx([['学习题', '对', '错', '', '', 'A', '因为对']]), 'q.xlsx');
      await ds
        .getRepository(Question)
        .update({ tenantId: TENANT, stem: '学习题' }, { stemImageUrls: ['/question-images/stem.png'], imageUrls: ['/uploads/analysis.png'] });

      const user = await makeUser('user');
      const list = await request(app.getHttpServer())
        .get('/questions?usage=study')
        .set('Authorization', `Bearer ${user.token}`);
      expect(list.status).toBe(200);
      const item = list.body.data.items.find((q: { stem: string }) => q.stem === '学习题');
      expect(item).toBeTruthy();
      expect(item.answer).toBeUndefined(); // 列表不含答案
      expect(item.analysis).toBeUndefined();
      expect(item.stemImageUrls).toEqual(['/question-images/stem.png']);
      expect(item.imageUrls).toBeUndefined();

      const ans = await request(app.getHttpServer())
        .get(`/questions/${item.id}/answer`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(ans.status).toBe(200);
      expect(ans.body.data.answer).toBe('A');
      expect(ans.body.data.analysis).toBe('因为对');
      expect(ans.body.data.imageUrls).toEqual(['/uploads/analysis.png']);
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
      expect(list.body.data[0].canDelete).toBe(true);
    });

    it('题目评论只允许本人或管理员删除', async () => {
      const admin = await makeUser('admin');
      await request(app.getHttpServer())
        .post('/admin/questions/import?usage=study')
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', buildXlsx([['评论删除题', '甲', '乙', '', '', 'A', '']]), 'q.xlsx');
      const q = await ds.getRepository(Question).findOneOrFail({ where: { tenantId: TENANT, stem: '评论删除题' } });

      const owner = await makeUser('user');
      const other = await makeUser('user');
      const created = await request(app.getHttpServer())
        .post(`/questions/${q.id}/comments`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ content: '待删除评论' });
      expect(created.status).toBe(201);

      const otherList = await request(app.getHttpServer())
        .get(`/questions/${q.id}/comments`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(otherList.body.data[0].canDelete).toBe(false);

      const denied = await request(app.getHttpServer())
        .delete(`/questions/comments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(denied.status).toBe(403);

      const adminRemoved = await request(app.getHttpServer())
        .delete(`/questions/comments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(adminRemoved.status).toBe(200);

      const empty = await request(app.getHttpServer())
        .get(`/questions/${q.id}/comments`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(empty.body.data).toHaveLength(0);
    });
  });

  // ===== 考试组卷 + 判分 =====
  describe('考试答题判分', () => {
    const COURSE = 'exam-course-1';
    const CATEGORY = 'M1 航空概论';
    const correctByStem: Record<string, string> = { E1: 'A', E2: 'B', E3: 'AC' };

    beforeAll(async () => {
      const repo = ds.getRepository(Question);
      const mk = (stem: string, answer: string, usage: QuestionUsage) =>
        repo.create({
          tenantId: TENANT,
          courseId: COURSE,
          category: CATEGORY,
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
          imageUrls: [`/uploads/${stem}.png`],
          usage,
          order: 0,
        });
      await repo.save([mk('E1', 'A', 'exam'), mk('E2', 'B', 'exam'), mk('E3', 'AC', 'both')]);
      await ds.getRepository(ExamPaperRule).upsert({ tenantId: TENANT, totalCount: 100, categoryCounts: { [CATEGORY]: 3 } }, ['tenantId']);
    });

    function pickAnswers(
      questions: Array<{ id: string; stem: string }>,
      map: (stem: string) => string,
    ): Record<string, string> {
      const a: Record<string, string> = {};
      questions.forEach((q) => (a[q.id] = map(q.stem)));
      return a;
    }

    it('不选科目不能开始模拟考试', async () => {
      const user = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE });
      expect(start.status).toBe(400);
    });

    it('组卷返回不含答案的卷面,全对得 100', async () => {
      const user = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE, category: CATEGORY });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(3);
      expect(start.body.data.questions[0].answer).toBeUndefined(); // 卷面不泄露答案
      expect(start.body.data.questions[0].imageUrls).toBeUndefined(); // 解析配图不在答题卷面下发

      const answers = pickAnswers(start.body.data.questions, (s) => correctByStem[s]);
      const sub = await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/submit`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ answers });
      expect(sub.status).toBe(201);
      expect(sub.body.data.score).toBe(100);
      expect(sub.body.data.correct).toBe(3);
      expect(sub.body.data.details.every((d: { isCorrect: boolean }) => d.isCorrect)).toBe(true);
      expect(sub.body.data.details.every((d: { imageUrls?: string[] }) => (d.imageUrls ?? []).length === 1)).toBe(true);
      const examLogs = await ds.getRepository(UserActivityLog).find({
        where: { tenantId: TENANT, userId: user.user.userId, targetId: start.body.data.attemptId },
      });
      expect(examLogs.map((log) => log.action)).toEqual(expect.arrayContaining(['exam_start', 'exam_submit']));
    });

    it('交卷只答部分题时仍按整张卷子判分并返回全部题目', async () => {
      const user = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE, category: CATEGORY });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(3);

      const first = start.body.data.questions[0] as { id: string; stem: string };
      const sub = await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/submit`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ answers: { [first.id]: correctByStem[first.stem] } });
      expect(sub.status).toBe(201);
      expect(sub.body.data.score).toBe(33);
      expect(sub.body.data.correct).toBe(1);
      expect(sub.body.data.total).toBe(3);
      expect(sub.body.data.details).toHaveLength(3);
      expect(sub.body.data.details.filter((d: { yourAnswer: string }) => d.yourAnswer === '')).toHaveLength(2);
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
        .send({ totalCount: 2, categoryCounts: { [CATEGORY]: 2 } });
      expect(saved.status).toBe(200);
      expect(saved.body.data.totalCount).toBe(2);
      expect(saved.body.data.categoryCounts[CATEGORY]).toBe(2);

      const current = await request(app.getHttpServer())
        .get('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(current.body.data.totalCount).toBe(2);
      expect(current.body.data.categoryCounts['M3 飞机结构和系统']).toBe(182);

      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE, category: CATEGORY, count: 1 });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(2);

      await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 100 });
    });

    it('题库不足配置题数时不能生成缩水考试', async () => {
      const user = await makeUser('user');
      const category = `INSUFFICIENT-EXAM-${phoneSeq++}`;
      const courseId = `insufficient-course-${phoneSeq++}`;
      await ds.getRepository(Question).save(
        ds.getRepository(Question).create({
          tenantId: TENANT,
          courseId,
          category,
          type: 'single',
          stem: `INSUFFICIENT-Q-${phoneSeq++}`,
          options: [
            { key: 'A', text: 'A' },
            { key: 'B', text: 'B' },
          ],
          answer: 'A',
          analysis: 'analysis',
          usage: 'exam',
          order: 0,
        }),
      );
      await ds.getRepository(ExamPaperRule).upsert({ tenantId: TENANT, totalCount: 100, categoryCounts: { [CATEGORY]: 2, [category]: 2 } }, ['tenantId']);

      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId, category });
      expect(start.status).toBe(400);
      expect(start.body.error).toContain('题库不足');
    });

    it('全错得 0,重复交卷幂等返回原成绩', async () => {
      const { token } = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE, category: CATEGORY });
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
      expect(again.status).toBe(201);
      expect(again.body.data).toEqual(sub.body.data);
    });

    it('历史记录含已交卷成绩', async () => {
      const { token } = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE, category: CATEGORY });
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

    it('用户可以单独删除自己的考试回顾记录', async () => {
      const user = await makeUser('user');
      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId: COURSE, category: CATEGORY });
      await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/submit`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ answers: pickAnswers(start.body.data.questions, (s) => correctByStem[s]) });

      const removed = await request(app.getHttpServer())
        .delete(`/exams/${start.body.data.attemptId}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(removed.status).toBe(200);
      expect(removed.body.data.deleted).toBe(true);

      const hist = await request(app.getHttpServer())
        .get('/exams/history')
        .set('Authorization', `Bearer ${user.token}`);
      expect(hist.body.data).toHaveLength(0);

      const review = await request(app.getHttpServer())
        .get(`/exams/${start.body.data.attemptId}/review`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(review.status).toBe(404);

      const logs = await ds.getRepository(UserActivityLog).find({
        where: { tenantId: TENANT, userId: user.user.userId, action: 'exam_delete' },
      });
      expect(logs).toHaveLength(1);
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

    it('exam start uses category counts and mixes random pool questions with exam wrong questions', async () => {
      const admin = await makeUser('admin');
      const user = await makeUser('user');
      const category = `RANDOM-WRONG-EXAM-${phoneSeq++}`;
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
            source: 'study',
            wrongCount: i + 1,
            status: 'open',
            lastWrongAt: now,
          }),
        ),
      );

      await request(app.getHttpServer())
        .patch('/admin/exam/rule')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ totalCount: 100, categoryCounts: { [category]: 10 } });
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
      expect(countByPrefix(questions, 'EXAM-WRONG')).toBe(2);
      expect(countByPrefix(questions, 'EXAM-NEW') + countByPrefix(questions, 'EXAM-REVIEW')).toBe(8);
      expect(fresh).toHaveLength(12);
    });

    it('study list returns a sequential page, keeps total count, and resumes from the saved index', async () => {
      const user = await makeUser('user');
      const category = `SEQUENTIAL-STUDY-${phoneSeq++}`;
      const otherCategory = `SEQUENTIAL-STUDY-OTHER-${phoneSeq++}`;
      const rows = await seedQuestions('STUDY-SEQ', 25, 'study', category, null);
      await seedQuestions('STUDY-OTHER', 5, 'study', otherCategory, null);
      const now = new Date();
      await ds.getRepository(QuestionPractice).save(
        [
          ds.getRepository(QuestionPractice).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: rows[0].id,
            seenCount: 2,
            correctCount: 1,
            wrongCount: 1,
            lastSeenAt: now,
            lastCorrectAt: now,
            lastWrongAt: now,
          }),
          ds.getRepository(QuestionPractice).create({
            tenantId: TENANT,
            userId: user.user.userId,
            questionId: rows[24].id,
            seenCount: 1,
            correctCount: 1,
            wrongCount: 0,
            lastSeenAt: now,
            lastCorrectAt: now,
            lastWrongAt: null,
          }),
        ],
      );

      const res = await request(app.getHttpServer())
        .get(`/questions?usage=study&category=${encodeURIComponent(category)}&pageSize=10`)
        .set('Authorization', `Bearer ${user.token}`);

      const items = res.body.data.items as Array<{
        stem: string;
        category: string;
        practice: { seenCount: number; correctCount: number; wrongCount: number };
      }>;
      expect(res.status).toBe(200);
      expect(items).toHaveLength(10);
      expect(res.body.data.total).toBe(25);
      expect(res.body.data.pageSize).toBe(10);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.startIndex).toBe(0);
      expect(items.every((q) => q.category === category)).toBe(true);
      expect(items.map((q) => q.stem)).toEqual(Array.from({ length: 10 }, (_, i) => `STUDY-SEQ-${i + 1}`));
      expect(items[0].practice).toEqual({ seenCount: 2, correctCount: 1, wrongCount: 1 });
      expect(items[1].practice).toEqual({ seenCount: 0, correctCount: 0, wrongCount: 0 });
      expect(countByPrefix(items, 'STUDY-OTHER')).toBe(0);

      const progress = await request(app.getHttpServer())
        .post('/exams/study/progress')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ questionId: rows[19].id });
      expect(progress.status).toBe(201);
      const savedProgress = await ds.getRepository(StudyQuestionProgress).findOne({
        where: { tenantId: TENANT, userId: user.user.userId, category, courseId: '' },
      });
      expect(savedProgress?.questionId).toBe(rows[19].id);
      const studyWrongAfterProgressOnly = await ds.getRepository(WrongQuestion).count({
        where: { tenantId: TENANT, userId: user.user.userId, source: 'study' },
      });
      expect(studyWrongAfterProgressOnly).toBe(0);

      const resumed = await request(app.getHttpServer())
        .get(`/questions?usage=study&category=${encodeURIComponent(category)}&pageSize=10`)
        .set('Authorization', `Bearer ${user.token}`);
      const resumedItems = resumed.body.data.items as Array<{ stem: string; category: string }>;
      expect(resumed.status).toBe(200);
      expect(resumed.body.data.page).toBe(3);
      expect(resumed.body.data.pageSize).toBe(10);
      expect(resumed.body.data.startIndex).toBe(0);
      expect(resumedItems.map((q) => q.stem)).toEqual(Array.from({ length: 5 }, (_, i) => `STUDY-SEQ-${i + 21}`));

      const explicitPage = await request(app.getHttpServer())
        .get(`/questions?usage=study&category=${encodeURIComponent(category)}&page=2&pageSize=10`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(explicitPage.status).toBe(200);
      expect(explicitPage.body.data.page).toBe(2);
      expect(explicitPage.body.data.pageSize).toBe(10);
      expect(explicitPage.body.data.startIndex).toBe(0);
      expect((explicitPage.body.data.items as Array<{ stem: string }>).map((q) => q.stem)).toEqual(
        Array.from({ length: 10 }, (_, i) => `STUDY-SEQ-${i + 11}`),
      );

      await ds.getRepository(StudyQuestionProgress).upsert(
        {
          tenantId: TENANT,
          userId: user.user.userId,
          category,
          courseId: '',
          questionId: rows[24].id,
          lastStudiedAt: new Date(now.getTime() + 1000),
        },
        ['tenantId', 'userId', 'category', 'courseId'],
      );

      const done = await request(app.getHttpServer())
        .get(`/questions?usage=study&category=${encodeURIComponent(category)}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(done.status).toBe(200);
      expect(done.body.data.items).toHaveLength(5);
      expect(done.body.data.page).toBe(2);
      expect(done.body.data.pageSize).toBe(20);
      expect(done.body.data.startIndex).toBe(4);
      expect((done.body.data.items as Array<{ stem: string }>).map((q) => q.stem)).toEqual(
        Array.from({ length: 5 }, (_, i) => `STUDY-SEQ-${i + 21}`),
      );
    });

    it('question pool cache refreshes after import and delete', async () => {
      const admin = await makeUser('admin');
      const user = await makeUser('user');
      const category = 'M1 航空概论';
      const courseId = `cache-course-${phoneSeq++}`;
      const stem = `CACHE-EXAM-${phoneSeq++}`;

      const imported = await request(app.getHttpServer())
        .post(`/admin/questions/import?usage=exam&courseId=${encodeURIComponent(courseId)}&category=${encodeURIComponent(category)}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('file', buildXlsx([[stem, 'A', 'B', '', '', 'A', 'cache analysis']]), 'cache.xlsx');
      expect(imported.status).toBe(201);
      expect(imported.body.data.imported).toBe(1);
      await ds.getRepository(ExamPaperRule).upsert({ tenantId: TENANT, totalCount: 100, categoryCounts: { [category]: 1 } }, ['tenantId']);

      const start = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId, category });
      expect(start.status).toBe(201);
      expect(start.body.data.questions).toHaveLength(1);
      expect(start.body.data.questions[0].stem).toBe(stem);
      await request(app.getHttpServer())
        .post(`/exams/${start.body.data.attemptId}/abandon`)
        .set('Authorization', `Bearer ${user.token}`);

      const q = await ds.getRepository(Question).findOneOrFail({ where: { tenantId: TENANT, stem } });
      const deleted = await request(app.getHttpServer())
        .delete(`/admin/questions/${q.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.deleted).toBe(1);

      const afterDelete = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ courseId, category });
      expect(afterDelete.status).toBe(400);
    });

    it('admin import preview validates rows without saving questions', async () => {
      const { token } = await makeUser('admin');
      const category = '';
      await ds.getRepository(Question).save(
        ds.getRepository(Question).create({
          tenantId: TENANT,
          category,
          courseId: null,
          type: 'single',
          stem: 'PREVIEW-DUP',
          options: [
            { key: 'A', text: 'A' },
            { key: 'B', text: 'B' },
          ],
          answer: 'A',
          analysis: '',
          usage: 'study',
          order: 1,
        }),
      );
      const before = await ds.getRepository(Question).count({ where: { tenantId: TENANT, category } });
      const res = await request(app.getHttpServer())
        .post('/admin/questions/import/preview?usage=study')
        .set('Authorization', `Bearer ${token}`)
        .attach(
          'file',
          buildXlsx([
            ['PREVIEW-DUP', 'A', 'B', '', '', 'A', ''],
            ['PREVIEW-DUP', 'A', 'B', '', '', 'A', ''],
            ['PREVIEW-BAD', 'A', 'B', '', '', '', ''],
          ]),
          'preview.xlsx',
        );
      expect(res.status).toBe(201);
      expect(res.body.data.totalRows).toBe(3);
      expect(res.body.data.importable).toBe(2);
      expect(res.body.data.failed).toHaveLength(1);
      expect(res.body.data.duplicateInFile).toBe(1);
      expect(res.body.data.duplicateInDatabase).toBe(1);
      const after = await ds.getRepository(Question).count({ where: { tenantId: TENANT, category } });
      expect(after).toBe(before);
    });

    it('study answer tracking returns the current user question stats', async () => {
      const user = await makeUser('user');
      const category = `ADAPTIVE-TRACK-${phoneSeq++}`;
      const [q] = await seedQuestions('STUDY-TRACK', 1, 'study', category, null);

      const started = await request(app.getHttpServer())
        .post('/exams/study/start')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ category });
      expect(started.status).toBe(201);

      const first = await request(app.getHttpServer())
        .post('/exams/wrong-book/study')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ questionId: q.id, answer: 'B' });

      expect(first.status).toBe(201);
      expect(first.body.data.recorded).toBe(true);
      expect(first.body.data.practice).toEqual({ seenCount: 1, correctCount: 0, wrongCount: 1 });

      const second = await request(app.getHttpServer())
        .post('/exams/wrong-book/study')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ questionId: q.id, answer: 'A' });

      expect(second.status).toBe(201);
      expect(second.body.data.recorded).toBe(false);
      expect(second.body.data.practice).toEqual({ seenCount: 2, correctCount: 1, wrongCount: 1 });
      const rows = await ds.getRepository(QuestionPractice).find({
        where: { tenantId: TENANT, userId: user.user.userId, questionId: q.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].seenCount).toBe(2);
      expect(rows[0].correctCount).toBe(1);
      expect(rows[0].wrongCount).toBe(1);
      expect(rows[0].lastSeenAt).toBeTruthy();
      expect(rows[0].lastCorrectAt).toBeTruthy();
      expect(rows[0].lastWrongAt).toBeTruthy();
      const progress = await ds.getRepository(StudyQuestionProgress).findOne({
        where: { tenantId: TENANT, userId: user.user.userId, category, courseId: '' },
      });
      expect(progress?.questionId).toBe(q.id);
      const activityLogs = await ds.getRepository(UserActivityLog).find({
        where: { tenantId: TENANT, userId: user.user.userId, action: 'study_progress', targetType: 'study_category' },
      });
      expect(activityLogs).toHaveLength(1);
      expect(activityLogs.every((log) => log.targetId === null)).toBe(true);
      expect(activityLogs[0].detail).toMatchObject({ category });
    });
  });

  // ===== 错题本 =====
  describe('错题本', () => {
    const COURSE = 'wrong-course-1';
    const CATEGORY = 'M1 航空概论';
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
          category: CATEGORY,
          order: 0,
        });
      await repo.save([mk('W1', 'A'), mk('W2', 'B')]);
    });

    async function startCourseExam(token: string) {
      const r = await request(app.getHttpServer())
        .post('/exams/start')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: COURSE, category: CATEGORY });
      return r.body.data as { attemptId: string; questions: Array<{ id: string; stem: string }> };
    }

    it('只收集顺序学习错题,模拟考试错题留在考试回顾', async () => {
      const { token } = await makeUser('user');

      // 模拟考试全错不会进入错题本。
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
      expect(book.body.data).toHaveLength(0);

      const studyWrong = await request(app.getHttpServer())
        .post('/exams/wrong-book/study')
        .set('Authorization', `Bearer ${token}`)
        .send({ questionId: paper.questions[0].id, answer: wrong[paper.questions[0].id] });
      expect(studyWrong.status).toBe(201);

      book = await request(app.getHttpServer())
        .get('/exams/wrong-book')
        .set('Authorization', `Bearer ${token}`);
      expect(book.body.data).toHaveLength(1);
      expect(book.body.data[0].source).toBe('study');
      expect(book.body.data[0].category).toBe(CATEGORY);
      expect(book.body.data[0].answer).toBeDefined(); // 错题本含答案供复习

      const masterId = book.body.data[0].questionId;
      const m = await request(app.getHttpServer())
        .post(`/exams/wrong-book/${masterId}/master`)
        .set('Authorization', `Bearer ${token}`);
      expect(m.status).toBe(201);
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

    it('GET /questions/categories 返回 8 个正式科目', async () => {
      const { token } = await makeUser('user');
      const res = await request(app.getHttpServer())
        .get('/questions/categories')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toContain('M9 航空英语');
      expect(res.body.data).not.toContain('M9 new');
      expect(res.body.data).toContain('无人机');
      expect(res.body.data).toHaveLength(8);
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
      const loginKey = await ds.getRepository(AccessKey).findOneOrFail({ where: { tenantId: TENANT, key } });
      expect(loginKey.firstLoginAt).toBeTruthy();
      expect(loginKey.lastLoginAt).toBeTruthy();
      const pendingLog = await ds.getRepository(UserActivityLog).findOne({
        where: { tenantId: TENANT, accessKeyId: loginKey.id, action: 'login_access_key' },
      });
      expect(pendingLog).toBeTruthy();

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
      const completedKey = await ds.getRepository(AccessKey).findOneOrFail({ where: { tenantId: TENANT, key } });
      const completedUser = await ds.getRepository(User).findOneOrFail({ where: { tenantId: TENANT, id: completedKey.userId! } });
      expect(completedUser.firstLoginAt).toBeTruthy();
      expect(completedUser.lastLoginAt).toBeTruthy();

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

    it('用户行为日志仅超管可查看,并可按卡号搜索登录记录', async () => {
      const sup = await makeUser('super');
      const biz = await makeUser('admin');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${sup.token}`)
        .send({ count: 1 });
      const key = gen.body.data.keys[0] as string;
      const first = await request(app.getHttpServer()).post('/auth/key-login').send({ key });
      await request(app.getHttpServer())
        .post('/auth/complete-profile')
        .set('Authorization', `Bearer ${first.body.data.token}`)
        .send({ phone: uniquePhone(), nickname: '日志学员' + Date.now() });

      const denied = await request(app.getHttpServer())
        .get('/admin/user-activity-logs')
        .set('Authorization', `Bearer ${biz.token}`);
      expect(denied.status).toBe(401);

      const logs = await request(app.getHttpServer())
        .get(`/admin/user-activity-logs?actions=login_access_key,wallet_recharge_code&keyword=${encodeURIComponent(key.slice(0, 8))}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(logs.status).toBe(200);
      expect(logs.body.data.total).toBeGreaterThanOrEqual(1);
      expect(logs.body.data.items.some((log: { accessKey?: { key?: string }; createdAt?: string }) => log.accessKey?.key === `****${key.slice(-4)}` && !!log.createdAt)).toBe(true);

      const keyRow = await ds.getRepository(AccessKey).findOneOrFail({ where: { tenantId: TENANT, key } });
      await request(app.getHttpServer())
        .post(`/admin/access-keys/${keyRow.id}/revoke`)
        .set('Authorization', `Bearer ${sup.token}`);
      await request(app.getHttpServer())
        .delete(`/admin/access-keys/${keyRow.id}`)
        .set('Authorization', `Bearer ${sup.token}`);
      const afterDelete = await request(app.getHttpServer())
        .get(`/admin/user-activity-logs?action=login_access_key&keyword=${encodeURIComponent(key)}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(afterDelete.status).toBe(200);
      expect(
        afterDelete.body.data.items.some((log: { accessKey?: { key?: string; status?: string } }) => log.accessKey?.key === `****${key.slice(-4)}` && log.accessKey.status === 'deleted'),
      ).toBe(true);
    });

    it('激活码充值成功后记录用户行为日志', async () => {
      const sup = await makeUser('super');
      const user = await makeUser('user');
      const gen = await request(app.getHttpServer())
        .post('/admin/recharge-codes')
        .set('Authorization', `Bearer ${sup.token}`)
        .send({ count: 1, amount: 600 });
      expect(gen.status).toBe(201);

      const recharge = await request(app.getHttpServer())
        .post('/wallet/recharge')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ code: gen.body.data.codes[0] });
      expect(recharge.status).toBe(201);
      expect(recharge.body.data.amount).toBe(600);

      const logs = await request(app.getHttpServer())
        .get('/admin/user-activity-logs?actions=wallet_recharge_code')
        .set('Authorization', `Bearer ${sup.token}`);
      expect(logs.status).toBe(200);
      expect(logs.body.data.items.some((log: { action: string; user?: { id?: string }; detail?: { amount?: number } }) => (
        log.action === 'wallet_recharge_code' && log.user?.id === user.user.userId && log.detail?.amount === 600
      ))).toBe(true);
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
      const target = list.body.data.items.find((k: { key: string }) => k.key === gen.body.data.keys[0]);
      const updated = await request(app.getHttpServer())
        .post(`/admin/access-keys/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ttlDays: 90 });
      expect(updated.status).toBe(201);
      const remainingDays = Math.round((new Date(updated.body.data.expiresAt).getTime() - Date.now()) / 86_400_000);
      expect(remainingDays).toBeGreaterThanOrEqual(89);
      expect(remainingDays).toBeLessThanOrEqual(90);
    });

    it('卡密列表支持分页搜索状态筛选,作废后可单条删除', async () => {
      const admin = await makeUser('super');
      const gen = await request(app.getHttpServer())
        .post('/admin/access-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ count: 3, ttlDays: 30 });
      const key = gen.body.data.keys[0] as string;

      const searched = await request(app.getHttpServer())
        .get(`/admin/access-keys?page=1&pageSize=2&status=active&keyword=${encodeURIComponent(key.slice(0, 8))}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(searched.status).toBe(200);
      expect(searched.body.data.page).toBe(1);
      expect(searched.body.data.pageSize).toBe(2);
      expect(searched.body.data.total).toBeGreaterThanOrEqual(1);
      const target = searched.body.data.items.find((k: { key: string }) => k.key === key);
      expect(target).toBeTruthy();

      const activeDelete = await request(app.getHttpServer())
        .delete(`/admin/access-keys/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(activeDelete.status).toBe(400);

      const rv = await request(app.getHttpServer())
        .post(`/admin/access-keys/${target.id}/revoke`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(rv.status).toBe(201);

      const deleted = await request(app.getHttpServer())
        .delete(`/admin/access-keys/${target.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.deleted).toBe(1);
      await expect(ds.getRepository(AccessKey).findOneOrFail({ where: { tenantId: TENANT, id: target.id } })).rejects.toThrow();
      const deleteLog = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'access_key_delete', targetId: target.id },
      });
      expect(deleteLog).toBeTruthy();
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

      const denied = await request(app.getHttpServer())
        .delete('/admin/questions?category=' + encodeURIComponent(CAT))
        .set('Authorization', `Bearer ${admin.token}`);
      expect(denied.status).toBe(400);

      const impact = await request(app.getHttpServer())
        .get('/admin/questions/delete-impact?category=' + encodeURIComponent(CAT))
        .set('Authorization', `Bearer ${admin.token}`);
      expect(impact.status).toBe(200);
      expect(impact.body.data.questionCount).toBeGreaterThanOrEqual(2);

      const del = await request(app.getHttpServer())
        .delete(
          '/admin/questions?category=' +
            encodeURIComponent(CAT) +
            '&confirm=' +
            encodeURIComponent(impact.body.data.requiredConfirm),
        )
        .set('Authorization', `Bearer ${admin.token}`);
      expect(del.status).toBe(200);
      expect(del.body.data.deleted).toBeGreaterThanOrEqual(2);
      const purgeLog = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'question_purge_category', targetId: CAT },
      });
      expect(purgeLog).toBeTruthy();
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
      const target = list.body.data.items.find((k: { key: string }) => k.key === gen.body.data.keys[0]);

      const rv = await request(app.getHttpServer())
        .post(`/admin/access-keys/${target.id}/revoke`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(rv.status).toBe(201);

      const revokeLog = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'access_key_revoke', targetId: target.id },
      });
      expect(revokeLog).toBeTruthy();
      const revokeDetail = revokeLog?.detail as { key?: string };
      expect(revokeDetail.key).not.toBe(target.key);
      expect(revokeDetail.key).toBe(`****${target.key.slice(-4)}`);

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

    it('作废卡密或解绑微信后立即撤销学员现有会话', async () => {
      const admin = await makeUser('super');
      const keyed = await makeUser('user');
      const key = await ds.getRepository(AccessKey).save(
        ds.getRepository(AccessKey).create({
          tenantId: TENANT,
          key: `SESSION${Date.now()}`,
          status: 'active',
          userId: keyed.user.userId,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      expect(
        (await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${keyed.token}`)).status,
      ).toBe(200);
      await request(app.getHttpServer())
        .post(`/admin/access-keys/${key.id}/revoke`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(
        (await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${keyed.token}`)).status,
      ).toBe(401);

      const wechat = await makeUser('user');
      await ds.getRepository(User).update(wechat.user.userId, { wechatOpenid: 'wx-session-revoke' });
      await request(app.getHttpServer())
        .delete(`/admin/users/${wechat.user.userId}/wechat-binding`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(
        (await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${wechat.token}`)).status,
      ).toBe(401);
    });

    it('操作日志仅超管可查看,并返回操作账号与时间', async () => {
      const sup = await makeUser('super');
      const biz = await makeUser('admin');

      const denied = await request(app.getHttpServer())
        .get('/admin/operation-logs')
        .set('Authorization', `Bearer ${biz.token}`);
      expect(denied.status).toBe(401);

      const gen = await request(app.getHttpServer())
        .post('/admin/recharge-codes')
        .set('Authorization', `Bearer ${sup.token}`)
        .send({ count: 1, amount: 100 });
      expect(gen.status).toBe(201);

      const logs = await request(app.getHttpServer())
        .get('/admin/operation-logs?actions=recharge_code_generate,forum_topic_create')
        .set('Authorization', `Bearer ${sup.token}`);
      expect(logs.status).toBe(200);
      expect(logs.body.data.total).toBeGreaterThanOrEqual(1);
      expect(logs.body.data.items[0].action).toBe('recharge_code_generate');
      expect(logs.body.data.items[0].admin.id).toBe(sup.user.userId);
      expect(logs.body.data.items[0].admin.role).toBe('super');
      expect(logs.body.data.items[0].createdAt).toBeTruthy();
    });

    it('论坛主题增删改进入后台操作日志,并支持多选操作筛选', async () => {
      const sup = await makeUser('super');
      const suffix = Date.now();

      const created = await request(app.getHttpServer())
        .post('/admin/forum/topics')
        .set('Authorization', `Bearer ${sup.token}`)
        .send({ name: `主题${suffix}`, order: 1 });
      expect(created.status).toBe(201);

      const updated = await request(app.getHttpServer())
        .patch(`/admin/forum/topics/${created.body.data.id}`)
        .set('Authorization', `Bearer ${sup.token}`)
        .send({ name: `主题${suffix}-改`, order: 2 });
      expect(updated.status).toBe(200);

      const removed = await request(app.getHttpServer())
        .delete(`/admin/forum/topics/${created.body.data.id}`)
        .set('Authorization', `Bearer ${sup.token}`);
      expect(removed.status).toBe(200);

      const logs = await request(app.getHttpServer())
        .get('/admin/operation-logs?actions=forum_topic_create,forum_topic_update,forum_topic_delete&page=1&pageSize=10')
        .set('Authorization', `Bearer ${sup.token}`);
      expect(logs.status).toBe(200);
      const actions = logs.body.data.items.map((log: { action: string }) => log.action);
      expect(actions).toEqual(expect.arrayContaining(['forum_topic_create', 'forum_topic_update', 'forum_topic_delete']));
      expect(logs.body.data.page).toBe(1);
      expect(logs.body.data.pageSize).toBe(10);
    });
  });

  describe('forum replies', () => {
    async function createTopicAndPost(ownerToken: string, adminToken: string) {
      const suffix = crypto.randomUUID().slice(0, 8);
      const topic = await request(app.getHttpServer())
        .post('/admin/forum/topics')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `topic-${suffix}`, order: 1 });
      expect(topic.status).toBe(201);
      const post = await request(app.getHttpServer())
        .post('/posts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ topicId: topic.body.data.id, content: `post-${suffix}` });
      expect(post.status).toBe(201);
      return { postId: post.body.data.id };
    }

    it('帖子只允许本人或管理员删除', async () => {
      const admin = await makeUser('admin');
      const owner = await makeUser('user');
      const other = await makeUser('user');
      const { postId } = await createTopicAndPost(owner.token, admin.token);

      const ownerList = await request(app.getHttpServer())
        .get('/posts')
        .set('Authorization', `Bearer ${owner.token}`);
      expect(ownerList.status).toBe(200);
      expect(ownerList.body.data.items.find((p: { id: string }) => p.id === postId)?.canDelete).toBe(true);

      const otherList = await request(app.getHttpServer())
        .get('/posts')
        .set('Authorization', `Bearer ${other.token}`);
      expect(otherList.status).toBe(200);
      expect(otherList.body.data.items.find((p: { id: string }) => p.id === postId)?.canDelete).toBe(false);

      const denied = await request(app.getHttpServer())
        .delete(`/posts/${postId}`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(denied.status).toBe(403);

      const removed = await request(app.getHttpServer())
        .delete(`/posts/${postId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(removed.status).toBe(200);

      const after = await request(app.getHttpServer())
        .get('/posts')
        .set('Authorization', `Bearer ${owner.token}`);
      expect(after.body.data.items.some((p: { id: string }) => p.id === postId)).toBe(false);

      const log = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'forum_post_delete', targetId: postId },
      });
      expect(log).toBeTruthy();
    });

    it('回复支持点赞切换，且只允许本人或管理员删除', async () => {
      const admin = await makeUser('admin');
      const owner = await makeUser('user');
      const other = await makeUser('user');
      const { postId } = await createTopicAndPost(owner.token, admin.token);

      const reply = await request(app.getHttpServer())
        .post(`/posts/${postId}/replies`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ content: 'reply-1' });
      expect(reply.status).toBe(201);

      const liked = await request(app.getHttpServer())
        .post(`/posts/replies/${reply.body.data.id}/like`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(liked.status).toBe(201);
      expect(liked.body.data).toMatchObject({ liked: true, likeCount: 1 });

      const list = await request(app.getHttpServer())
        .get(`/posts/${postId}/replies`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(list.status).toBe(200);
      expect(list.body.data[0].likedByMe).toBe(true);
      expect(list.body.data[0].likeCount).toBe(1);
      expect(list.body.data[0].canDelete).toBe(false);

      const publicList = await request(app.getHttpServer()).get(`/posts/${postId}/replies`);
      expect(publicList.status).toBe(200);
      expect(publicList.body.data[0]).toMatchObject({ likedByMe: false, canDelete: false, likeCount: 1 });

      const denied = await request(app.getHttpServer())
        .delete(`/posts/replies/${reply.body.data.id}`)
        .set('Authorization', `Bearer ${other.token}`);
      expect(denied.status).toBe(403);

      const removed = await request(app.getHttpServer())
        .delete(`/posts/replies/${reply.body.data.id}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(removed.status).toBe(200);

      const empty = await request(app.getHttpServer())
        .get(`/posts/${postId}/replies`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(empty.body.data).toHaveLength(0);
    });

    it('业务管理员可以删除任何回复', async () => {
      const admin = await makeUser('admin');
      const owner = await makeUser('user');
      const { postId } = await createTopicAndPost(owner.token, admin.token);
      const reply = await request(app.getHttpServer())
        .post(`/posts/${postId}/replies`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ content: 'reply-admin-delete' });

      const removed = await request(app.getHttpServer())
        .delete(`/posts/replies/${reply.body.data.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(removed.status).toBe(200);

      const log = await ds.getRepository(AdminOperationLog).findOne({
        where: { tenantId: TENANT, action: 'forum_reply_delete', targetId: reply.body.data.id },
      });
      expect(log).toBeTruthy();
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

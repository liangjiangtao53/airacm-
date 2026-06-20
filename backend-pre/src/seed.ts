import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  ALL_ENTITIES,
  Chapter,
  Course,
  Lesson,
  LessonAccess,
  RechargeCode,
  Tenant,
} from './entities';
import { buildDataSourceOptions, env } from './config';

// 开发种子:1 机构 + 4 门课(每课多章多课时)+ 一批激活码。可重复执行(先清后插)。
const COURSE_SEED: Array<{
  title: string;
  summary: string;
  priceYuan: number;
  originalYuan: number;
  chapters: number;
  lessonsPerChapter: number;
  accessCycle: LessonAccess[];
}> = [
  {
    title: 'STE 简明技术英语规则',
    summary: '机务维修文件读写的 STE 规范精讲',
    priceYuan: 58,
    originalYuan: 98,
    chapters: 4,
    lessonsPerChapter: 3,
    accessCycle: ['free', 'paid', 'paid', 'password', 'vip'],
  },
  {
    title: 'POH 飞行手册规范',
    summary: 'POH 结构与查阅要点',
    priceYuan: 20,
    originalYuan: 40,
    chapters: 5,
    lessonsPerChapter: 2,
    accessCycle: ['free', 'paid', 'paid', 'paid', 'vip'],
  },
  {
    title: 'CAP 适航规范导读',
    summary: 'CAP 适航条款与应用',
    priceYuan: 14,
    originalYuan: 28,
    chapters: 3,
    lessonsPerChapter: 3,
    accessCycle: ['free', 'paid', 'paid', 'vip'],
  },
  {
    title: '航空维修资料检索',
    summary: '维修资料体系与高效检索',
    priceYuan: 24,
    originalYuan: 48,
    chapters: 5,
    lessonsPerChapter: 2,
    accessCycle: ['free', 'paid', 'password', 'paid', 'vip'],
  },
];

async function run(): Promise<void> {
  const ds = new DataSource({
    ...(buildDataSourceOptions() as object),
    entities: ALL_ENTITIES,
  } as any);
  await ds.initialize();

  const tenantId = env.defaultTenantId;
  await ds.getRepository(Tenant).save({ id: tenantId, name: '默认机构', status: 'active' });

  // 清旧课程数据(幂等)。
  await ds.getRepository(Lesson).delete({ tenantId });
  await ds.getRepository(Chapter).delete({ tenantId });
  await ds.getRepository(Course).delete({ tenantId });

  for (const c of COURSE_SEED) {
    const course = await ds.getRepository(Course).save({
      tenantId,
      title: c.title,
      summary: c.summary,
      price: c.priceYuan * 100,
      originalPrice: c.originalYuan * 100,
      chapterCount: c.chapters,
      lessonCount: c.chapters * c.lessonsPerChapter,
    });

    let lessonOrder = 0;
    for (let ci = 0; ci < c.chapters; ci++) {
      const chapter = await ds.getRepository(Chapter).save({
        tenantId,
        courseId: course.id,
        title: `第 ${ci + 1} 章`,
        order: ci,
      });
      for (let li = 0; li < c.lessonsPerChapter; li++) {
        // 第 1 课时永远 free(试听),其余按 cycle 取(对齐 mock buildLessons)。
        const access: LessonAccess =
          lessonOrder === 0 ? 'free' : c.accessCycle[lessonOrder % c.accessCycle.length];
        await ds.getRepository(Lesson).save({
          tenantId,
          chapterId: chapter.id,
          courseId: course.id,
          title: `${c.title} · 课时 ${lessonOrder + 1}`,
          type: 'video',
          access,
          order: lessonOrder,
          duration: 300 + lessonOrder * 30,
        });
        lessonOrder++;
      }
    }
  }

  // 激活码:5 张 100 元、5 张 50 元(分)。
  const codeRepo = ds.getRepository(RechargeCode);
  await codeRepo.delete({ tenantId });
  const codes: Array<Partial<RechargeCode>> = [];
  for (let i = 1; i <= 5; i++) {
    codes.push({ tenantId, code: `CODE100-${i}`, amount: 100 * 100, status: 'unused' });
    codes.push({ tenantId, code: `CODE50-${i}`, amount: 50 * 100, status: 'unused' });
  }
  await codeRepo.save(codes);

  // eslint-disable-next-line no-console
  console.log(`seed done: tenant=${tenantId}, courses=${COURSE_SEED.length}, codes=${codes.length}`);
  await ds.destroy();
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

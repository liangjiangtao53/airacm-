'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, type Course } from '@/lib/api';

interface LessonView {
  id: string;
  title: string;
  locked: boolean;
  duration: number;
}
interface ChapterView {
  id: string;
  title: string;
  order: number;
  lessons: LessonView[];
}

export default function CoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    api
      .courses()
      .then(setCourses)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回首页
      </a>
      <h1 className="mb-6 mt-1 text-3xl font-semibold tracking-tight text-ink">课程列表</h1>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
      {courses.length === 0 && !err && (
        <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
          暂无课程。管理员可在后台创建。
        </p>
      )}
      <div className="space-y-4">
        {courses.map((c) => (
          <CourseCard
            key={c.id}
            course={c}
            open={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
          />
        ))}
      </div>
    </main>
  );
}

function CourseCard({
  course,
  open,
  onToggle,
}: {
  course: Course;
  open: boolean;
  onToggle: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterView[] | null>(null);

  useEffect(() => {
    if (open && chapters === null) {
      api
        .course(course.id)
        .then((d) => setChapters((d.chapters as ChapterView[]) ?? []))
        .catch(() => setChapters([]));
    }
  }, [open, chapters, course.id]);

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl shadow-sm ring-1 ring-white/55">
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-4 p-6 text-left">
        <div>
          <h2 className="font-semibold text-ink">{course.title}</h2>
          <p className="mt-1 text-sm text-ink/55">{course.summary || '暂无简介'}</p>
          <p className="mt-2 text-xs text-ink/45">{course.lessonCount} 课时</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-ink/40">{open ? '收起 ▲' : '展开 ▼'}</p>
        </div>
      </button>

      {open && (
        <div className="border-t border-ink/5 px-6 py-4">
          {chapters === null ? (
            <p className="text-sm text-ink/40">加载目录...</p>
          ) : (
            <div className="space-y-4">
              {chapters.map((ch) => (
                <div key={ch.id}>
                  <p className="mb-2 text-sm font-medium text-ink/80">{ch.title}</p>
                  <ul className="space-y-1">
                    {ch.lessons.map((l) =>
                      l.locked ? (
                        <li
                          key={l.id}
                          className="flex items-center justify-between rounded-lg bg-mist px-3 py-2 text-sm text-ink/40"
                        >
                          <span>{l.title}</span>
                          <span className="text-xs">🔒 需购买</span>
                        </li>
                      ) : (
                        <li key={l.id}>
                          <a
                            href={`/learn/${l.id}`}
                            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink/75 hover:bg-sky/5 hover:text-sky"
                          >
                            <span>{l.title}</span>
                            <span className="text-xs text-ink/40">{Math.round(l.duration / 60)} 分钟</span>
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

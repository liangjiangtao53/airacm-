'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type Lesson } from '@/lib/api';

type LessonFull = Lesson & { playUrl?: string; content?: string };

export default function LearnPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [lesson, setLesson] = useState<LessonFull | null>(null);
  const [err, setErr] = useState('');
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.lesson(id).then(setLesson).catch((e) => {
      const m = (e as Error).message;
      if (m.includes('403') || m.includes('权限') || m.includes('购买')) setLocked(true);
      else setErr(m);
    });
  }, [id]);

  async function markDone() {
    try {
      await api.upsertProgress(id, lesson ? lesson.duration : 0, 'done');
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (locked) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="rounded-2xl bg-white p-12 ring-1 ring-ink/5">
          <p className="text-lg font-medium text-ink">该课时需购买课程后学习</p>
          <a href="/courses" className="mt-5 inline-block rounded-lg bg-steel px-6 py-2.5 font-medium text-white hover:bg-ink">
            去购买
          </a>
        </div>
      </main>
    );
  }
  if (err) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>
      </main>
    );
  }
  if (!lesson) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <button onClick={() => history.back()} className="text-sm text-ink/50 hover:text-ink">
        返回
      </button>
      <h1 className="mb-5 mt-1 text-2xl font-semibold tracking-tight text-ink">{lesson.title}</h1>

      {lesson.type === 'video' ? (
        lesson.playUrl ? (
          <video src={lesson.playUrl} controls className="w-full rounded-2xl bg-black" />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-ink text-white/60">
            视频播放占位
          </div>
        )
      ) : (
        <article className="rounded-2xl bg-white p-7 leading-relaxed text-ink/80 ring-1 ring-ink/5">
          {lesson.content || '图文内容待后端返回。'}
        </article>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button onClick={markDone} disabled={done} className="rounded-lg bg-sky px-6 py-2.5 font-medium text-white hover:bg-steel disabled:opacity-60">
          {done ? '已完成' : '标记完成'}
        </button>
        <span className="text-sm text-ink/45">时长约 {Math.round((lesson.duration || 0) / 60)} 分钟</span>
      </div>
    </main>
  );
}
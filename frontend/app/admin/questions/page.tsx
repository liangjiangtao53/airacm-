'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CategoryManager from '@/components/CategoryManager';
import { api } from '@/lib/api';

function AdminQuestionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get('category') ?? '';
  const currentLabel = category || '(未分类)';
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<Array<{ category: string; count: number }>>([]);
  const [err, setErr] = useState('');

  async function refreshStats() {
    setStats(await api.questionStats());
  }

  useEffect(() => {
    api
      .me()
      .then((u) => {
        if (u.role !== 'admin' && u.role !== 'super') {
          router.push('/');
          return;
        }
        setReady(true);
        refreshStats().catch((e) => setErr((e as Error).message));
      })
      .catch(() => router.push('/login'));
  }, [router]);

  if (!ready) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">校验权限...</main>;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <a href="/admin" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回管理后台
      </a>
      <div className="mb-5 mt-2">
        <p className="text-sm text-ink/45">题库资料</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{currentLabel}</h1>
      </div>

      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      <nav className="mb-5 flex gap-2 overflow-x-auto rounded-xl bg-white/55 p-2 ring-1 ring-white/60">
        {stats.map((s) => {
          const realCat = s.category === '(未分类)' ? '' : s.category;
          const active = realCat === category;
          return (
            <a
              key={s.category}
              href={`/admin/questions?category=${encodeURIComponent(realCat)}`}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? 'bg-steel font-medium text-white'
                  : 'text-ink/60 hover:bg-mist hover:text-ink'
              }`}
            >
              {s.category}
              <span className={active ? 'ml-1 text-white/70' : 'ml-1 text-ink/35'}>{s.count}</span>
            </a>
          );
        })}
      </nav>

      <CategoryManager key={category} category={category} onChanged={refreshStats} />
    </main>
  );
}

export default function AdminQuestionsPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-ink/50">加载中...</main>}>
      <AdminQuestionsContent />
    </Suspense>
  );
}

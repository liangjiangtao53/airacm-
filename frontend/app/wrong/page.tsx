'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, getToken, type WrongBookItem } from '@/lib/api';
import Comments from '@/components/Comments';

export default function WrongBookPage() {
  const router = useRouter();
  const [items, setItems] = useState<WrongBookItem[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    api
      .wrongBook()
      .then(setItems)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  function remove(questionId: string) {
    setItems((l) => l.filter((i) => i.questionId !== questionId));
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回首页
      </a>
      <h1 className="mb-1 mt-1 text-3xl font-semibold tracking-tight text-ink">错题本</h1>
      <p className="mb-6 text-sm text-ink/55">
        考试答错的题自动收集到这里。先自己作答,再查看答案核对;掌握后标记移出。
      </p>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
      {items.length === 0 && !err && (
        <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
          错题本是空的。去考试练练吧。
        </p>
      )}
      <div className="space-y-4">
        {items.map((q, i) => (
          <WrongCard key={q.questionId} q={q} index={i + 1} onMaster={() => remove(q.questionId)} />
        ))}
      </div>
    </main>
  );
}

function WrongCard({
  q,
  index,
  onMaster,
}: {
  q: WrongBookItem;
  index: number;
  onMaster: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [showComments, setShowComments] = useState(false);

  function toggle(key: string) {
    if (revealed) return;
    if (q.type === 'single') setPicked([key]);
    else setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  async function master() {
    try {
      await api.masterWrong(q.questionId);
      onMaster();
    } catch {
      /* 失败可重试 */
    }
  }

  const correctSet = new Set(q.answer.split(''));
  const pickedKey = [...picked].sort().join('');
  const isRight = revealed && pickedKey === q.answer;

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink/60">
            {index} · {q.type === 'single' ? '单选' : '多选'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{q.stem}</p>
            <QuestionImages urls={q.imageUrls} />
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-500">
          错 {q.wrongCount} 次
        </span>
      </div>

      <div className="space-y-2">
        {q.options.map((o) => {
          const chosen = picked.includes(o.key);
          const correct = revealed && correctSet.has(o.key);
          const cls = revealed
            ? correct
              ? 'border-sky/50 bg-sky/5 text-ink'
              : chosen
                ? 'border-red-300 bg-red-50 text-red-600'
                : 'border-ink/10 text-ink/60'
            : chosen
              ? 'border-steel bg-steel/5 text-ink'
              : 'border-ink/10 text-ink/70 hover:border-steel/40';
          return (
            <button
              key={o.key}
              onClick={() => toggle(o.key)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${cls}`}
            >
              <span className="font-mono text-sm">{o.key}</span>
              <span className="text-sm">{o.text}</span>
              {revealed && correct && <span className="ml-auto text-xs text-sky">正确答案</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="rounded-lg bg-sky px-5 py-2 text-sm font-medium text-white hover:bg-steel"
          >
            查看答案
          </button>
        ) : (
          <>
            <span className={`text-sm font-medium ${isRight ? 'text-sky' : 'text-red-500'}`}>
              {picked.length ? (isRight ? '回答正确' : '回答错误') : '正确答案'} · {q.answer}
            </span>
            <button
              onClick={master}
              className="rounded-lg border border-sky/40 px-4 py-1.5 text-sm font-medium text-sky hover:bg-sky/5"
            >
              已掌握
            </button>
          </>
        )}
        <button onClick={() => setShowComments((s) => !s)} className="text-sm text-ink/50 hover:text-ink">
          {showComments ? '收起评论' : '评论'}
        </button>
      </div>

      {revealed && q.analysis && (
        <p className="mt-3 rounded-lg bg-mist px-4 py-2 text-sm text-ink/65">解析:{q.analysis}</p>
      )}

      {showComments && <Comments questionId={q.questionId} />}
    </section>
  );
}

function QuestionImages({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {urls.map((url) => (
        <img
          key={url}
          src={assetUrl(url)}
          alt="题目配图"
          className="max-h-[520px] max-w-full rounded-lg border border-ink/10 object-contain"
        />
      ))}
    </div>
  );
}

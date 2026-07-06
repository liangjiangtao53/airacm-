'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, getToken, type WrongBookItem } from '@/lib/api';
import Comments from '@/components/Comments';

export default function WrongBookPage() {
  const router = useRouter();
  const [items, setItems] = useState<WrongBookItem[]>([]);
  const [category, setCategory] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const categories = Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort();
  const filteredItems = items.filter((item) => !category || item.category === category);

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

  function remove(questionId: string, source: WrongBookItem['source']) {
    setItems((l) => l.filter((i) => !(i.questionId === questionId && i.source === source)));
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
        顺序学习答错的题会进入错题本；模拟考试错题请在考试回顾里查看。
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-sky"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部模块</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink/45">{filteredItems.length} 题</span>
      </div>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
      {filteredItems.length === 0 && !err && (
        <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
          暂无顺序学习错题。
        </p>
      )}
      <div className="space-y-4">
        {filteredItems.map((q, i) => (
          <WrongCard key={`${q.source}:${q.questionId}`} q={q} index={i + 1} onMaster={() => remove(q.questionId, q.source)} />
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
  const [revealed, setRevealed] = useState(false);
  const [showComments, setShowComments] = useState(false);

  async function master() {
    try {
      await api.masterWrong(q.questionId, q.source);
      onMaster();
    } catch {
      /* 失败可重试 */
    }
  }

  const correctSet = new Set(q.answer.split(''));

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink/60">
            {index} · {q.type === 'single' ? '单选' : '多选'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{q.stem}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-500">
          错 {q.wrongCount} 次
        </span>
      </div>

      {revealed && <div className="space-y-2">
        {q.options.map((o) => {
          const correct = correctSet.has(o.key);
          const cls = correct ? 'border-green-300 bg-green-50 text-green-700' : 'border-ink/10 text-ink/60';
          return (
            <div
              key={o.key}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${cls}`}
            >
              <span className="font-mono text-sm">{o.key}</span>
              <span className="text-sm">{o.text}</span>
              {correct && <span className="ml-auto text-xs text-green-600">正确答案</span>}
            </div>
          );
        })}
      </div>}

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
            <span className="text-sm font-medium text-green-600">正确答案 · {q.answer}</span>
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

      {revealed && (q.analysis || q.imageUrls?.length) && (
        <div className="mt-3 rounded-lg bg-mist px-4 py-2 text-sm text-ink/65">
          {q.analysis && <p>解析:{q.analysis}</p>}
          <QuestionImages urls={q.imageUrls} />
        </div>
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
          alt="解析配图"
          className="max-h-[520px] max-w-full rounded-lg border border-ink/10 object-contain"
        />
      ))}
    </div>
  );
}

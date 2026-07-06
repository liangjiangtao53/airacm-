'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, getToken, type ExamAttemptSummary, type GradedItem } from '@/lib/api';

export default function ExamReviewPage() {
  const router = useRouter();
  const [attempts, setAttempts] = useState<ExamAttemptSummary[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    api
      .examHistory()
      .then(setAttempts)
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
      <h1 className="mb-1 mt-1 text-3xl font-semibold tracking-tight text-ink">考试回顾</h1>
      <p className="mb-6 text-sm text-ink/55">历次已交卷考试,点开逐题复盘。</p>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
      {attempts.length === 0 && !err && (
        <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
          还没有考试记录。去「在线考试」考一场吧。
        </p>
      )}
      <div className="space-y-3">
        {attempts.map((a, i) => (
          <AttemptCard key={a.id} a={a} index={attempts.length - i} />
        ))}
      </div>
    </main>
  );
}

function AttemptCard({ a, index }: { a: ExamAttemptSummary; index: number }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<GradedItem[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && details === null) {
      try {
        const r = await api.examReview(a.id);
        setDetails(r.details);
      } catch {
        setDetails([]);
      }
    }
  }

  const when = a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '';

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl shadow-sm ring-1 ring-white/55">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-4 p-5 text-left">
        <div>
          <p className="font-medium text-ink">第 {index} 次考试</p>
          <p className="mt-0.5 text-xs text-ink/45">{when}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-semibold text-sky">{a.score}</p>
            <p className="text-xs text-ink/45">
              {a.correct}/{a.total} 题
            </p>
          </div>
          <span className="text-xs text-ink/40">{open ? '收起 ▲' : '复盘 ▼'}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-ink/5 px-5 py-4">
          {details === null ? (
            <p className="text-sm text-ink/40">加载复盘...</p>
          ) : (
            details.map((d, i) => (
              <div key={d.questionId} className="rounded-lg bg-mist/60 p-3">
                <div className="mb-2 flex items-start gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      d.isCorrect ? 'bg-sky/10 text-sky' : 'bg-red-50 text-red-500'
                    }`}
                  >
                    {i + 1} · {d.isCorrect ? '正确' : '错误'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{d.stem}</p>
                  </div>
                </div>

                {/* 逐项选项:正确答案高亮,误选标红 */}
                <ul className="mb-2 space-y-1">
                  {d.options.map((o) => {
                    const isAnswer = d.correctAnswer.includes(o.key);
                    const isYours = d.yourAnswer.includes(o.key);
                    return (
                      <li
                        key={o.key}
                        className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                          isAnswer
                            ? 'bg-green-50 text-green-700'
                            : isYours
                              ? 'bg-red-50 text-red-500'
                              : 'text-ink/65'
                        }`}
                      >
                        <span className="font-mono font-medium">{o.key}</span>
                        <span className="flex-1">{o.text}</span>
                        {isAnswer && <span className="shrink-0">✓ 正确答案</span>}
                        {isYours && !isAnswer && <span className="shrink-0">你的选择</span>}
                      </li>
                    );
                  })}
                </ul>

                <p className="text-xs text-ink/60">
                  你的答案:<span className="font-mono">{d.yourAnswer || '(未答)'}</span> · 正确答案:
                  <span className="font-mono text-green-600">{d.correctAnswer}</span>
                </p>
                {(d.analysis || d.imageUrls?.length) && (
                  <div className="mt-1 text-xs text-ink/55">
                    {d.analysis && <p>解析:{d.analysis}</p>}
                    <QuestionImages urls={d.imageUrls} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function QuestionImages({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {urls.map((url) => (
        <img
          key={url}
          src={assetUrl(url)}
          alt="解析配图"
          className="max-h-[420px] max-w-full rounded-md border border-ink/10 object-contain"
        />
      ))}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, getToken, type ExamResult, type GradedItem, type PaperQuestion } from '@/lib/api';
import Comments from '@/components/Comments';

type Phase = 'idle' | 'taking' | 'result';

const EXAM_CATEGORY_COUNTS: Record<string, number> = {
  'M1 航空概论': 32,
  'M2 航空器维修': 50,
  'M3 飞机结构和系统': 182,
  'M5 航空涡轮发动机': 70,
  'M9 航空英语': 60,
};

export default function ExamPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [attemptId, setAttemptId] = useState('');
  const [questions, setQuestions] = useState<PaperQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [unansweredCursor, setUnansweredCursor] = useState(-1);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    api
      .categories()
      .then((list) => {
        const examCategories = list.filter((name) => EXAM_CATEGORY_COUNTS[name]);
        setCategories(examCategories);
        setCategory((current) => current || examCategories[0] || '');
      })
      .catch(() => undefined);
  }, [router]);

  async function start() {
    setErr('');
    if (!category) {
      setErr('请选择考试科目');
      return;
    }
    setBusy(true);
    try {
      const r = await api.startExam(undefined, category);
      setAttemptId(r.attemptId);
      setQuestions(r.questions);
      setAnswers({});
      setUnansweredCursor(-1);
      setResult(null);
      setPhase('taking');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick(q: PaperQuestion, key: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === 'single') return { ...prev, [q.id]: [key] };
      return { ...prev, [q.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
    });
  }

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      questions.forEach((q) => (payload[q.id] = [...(answers[q.id] ?? [])].sort().join('')));
      const r = await api.submitExam(attemptId, payload);
      setResult(r);
      setPhase('result');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const unfinishedCount = Math.max(0, questions.length - answeredCount);

  function jumpToNextUnanswered() {
    for (let step = 1; step <= questions.length; step++) {
      const idx = (unansweredCursor + step) % questions.length;
      const q = questions[idx];
      if ((answers[q.id] ?? []).length === 0) {
        setUnansweredCursor(idx);
        document.getElementById(`exam-q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回首页
      </a>
      <h1 className="mb-6 mt-1 text-3xl font-semibold tracking-tight text-ink">在线考试</h1>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      {phase === 'idle' && (
        <div className="rounded-2xl bg-white/60 backdrop-blur-xl p-7 shadow-sm ring-1 ring-white/55">
          <p className="mb-4 text-ink/70">从题库随机组卷,提交后自动判分。</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink/60">科目</label>
              <select
                className="rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {category && (
                <p className="mt-1 text-xs text-ink/45">本次考试 {EXAM_CATEGORY_COUNTS[category]} 题，考完为止</p>
              )}
            </div>
            <button
              onClick={start}
              disabled={busy}
              className="rounded-lg bg-steel px-6 py-2 font-medium text-white hover:bg-ink disabled:opacity-50"
            >
              开始考试
            </button>
          </div>
        </div>
      )}

      {phase === 'taking' && (
        <div className="space-y-4">
          <p className="text-sm text-ink/55">
            共 {questions.length} 题 · 已答 {answeredCount}
          </p>
          <div className="flex flex-wrap gap-2 text-sm font-medium">
            <span className="rounded-full bg-green-50 px-3 py-1 text-green-700">已完成 {answeredCount}</span>
            <button onClick={jumpToNextUnanswered} className="rounded-full bg-red-50 px-3 py-1 text-red-600">
              未答题 {unfinishedCount}
            </button>
          </div>
          {questions.map((q, i) => (
            <section id={`exam-q-${q.id}`} key={q.id} className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
              <div className="mb-3 flex items-start gap-2">
                <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink/60">
                  {i + 1} · {q.type === 'single' ? '单选' : '多选'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{q.stem}</p>
                  <QuestionImages urls={q.stemImageUrls} alt="题干配图" />
                </div>
              </div>
              <div className="space-y-2">
                {q.options.map((o) => {
                  const chosen = (answers[q.id] ?? []).includes(o.key);
                  return (
                    <button
                      key={o.key}
                      onClick={() => pick(q, o.key)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                        chosen ? 'border-steel bg-steel/5 text-ink' : 'border-ink/10 text-ink/70 hover:border-steel/40'
                      }`}
                    >
                      <span className="font-mono text-sm">{o.key}</span>
                      <span className="text-sm">{o.text}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-lg bg-sky py-3 font-medium text-white hover:bg-steel disabled:opacity-50"
          >
            交卷
          </button>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-steel to-ink p-7 text-center text-white">
            <p className="text-sm text-white/70">本次成绩</p>
            <p className="mt-1 text-5xl font-semibold">{result.score}</p>
            <p className="mt-2 text-sm text-white/70">
              答对 {result.correct} / {result.total} 题
            </p>
          </div>
          {result.details.map((d, i) => (
            <ResultCard key={d.questionId} d={d} index={i + 1} />
          ))}
          <button
            onClick={() => setPhase('idle')}
            className="w-full rounded-lg bg-steel py-3 font-medium text-white hover:bg-ink"
          >
            再考一次
          </button>
        </div>
      )}
    </main>
  );
}

// 复盘单题:对错标记 + 答案解析 + 可展开评论。
function ResultCard({ d, index }: { d: GradedItem; index: number }) {
  const [showComments, setShowComments] = useState(false);
  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <div className="mb-3 flex items-start gap-2">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            d.isCorrect ? 'bg-sky/10 text-sky' : 'bg-red-50 text-red-500'
          }`}
        >
          {index} · {d.isCorrect ? '正确' : '错误'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{d.stem}</p>
          <QuestionImages urls={d.stemImageUrls} alt="题干配图" />
        </div>
      </div>
      <p className="text-sm text-ink/70">
        你的答案:<span className="font-mono">{d.yourAnswer || '(未答)'}</span> · 正确答案:
        <span className="font-mono text-green-600">{d.correctAnswer}</span>
      </p>
      {(d.analysis || d.imageUrls?.length) && (
        <div className="mt-2 rounded-lg bg-mist px-4 py-2 text-sm text-ink/65">
          {d.analysis && <p>解析:{d.analysis}</p>}
          <QuestionImages urls={d.imageUrls} alt="解析配图" />
        </div>
      )}
      <button
        onClick={() => setShowComments((s) => !s)}
        className="mt-3 text-sm text-ink/50 hover:text-ink"
      >
        {showComments ? '收起评论' : '评论'}
      </button>
      {showComments && <Comments questionId={d.questionId} />}
    </section>
  );
}

function QuestionImages({ urls, alt }: { urls?: string[]; alt: string }) {
  if (!urls?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {urls.map((url) => (
        <img
          key={url}
          src={assetUrl(url)}
          alt={alt}
          className="max-h-[520px] max-w-full rounded-lg border border-ink/10 object-contain"
        />
      ))}
    </div>
  );
}

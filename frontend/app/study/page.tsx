'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, assetUrl, getToken, type QuestionItem } from '@/lib/api';
import Comments from '@/components/Comments';

const PAGE_SIZES = [10, 20, 30];

export default function StudyPage() {
  const router = useRouter();
  const [items, setItems] = useState<QuestionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState(''); // 搜索输入(即时)
  const [searchKw, setSearchKw] = useState(''); // 防抖后真正用于查询的关键词
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jumpTo, setJumpTo] = useState('1');
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // 搜索防抖 350ms,避免每个字符都打接口。
  useEffect(() => {
    const t = setTimeout(() => setSearchKw(keyword.trim()), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  // 科目枚举加载后,默认选中第一个科目(去掉"全部科目"聚合项)。
  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    api
      .categories()
      .then((cs) => {
        setCategories(cs);
        if (cs.length) setCategory((cur) => cur || cs[0]);
      })
      .catch(() => undefined);
  }, [router]);

  // 切换科目/每页条数/搜索词时回到第 1 页。
  useEffect(() => {
    setPage(1);
  }, [category, pageSize, searchKw]);

  useEffect(() => {
    if (!getToken() || !category) return;
    setLoading(true);
    api
      .questions({ usage: 'study', category, keyword: searchKw || undefined, page, pageSize })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [category, searchKw, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setJumpTo(String(page));
  }, [page]);

  function commitJump() {
    const next = Math.min(totalPages, Math.max(1, Number(jumpTo) || 1));
    setPage(next);
    setJumpTo(String(next));
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回首页
      </a>
      <h1 className="mb-4 mt-1 text-3xl font-semibold tracking-tight text-ink">专题学习</h1>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <section className="rounded-2xl border border-sky/30 bg-sky/10 p-4">
          <p className="text-base font-semibold text-ink">顺序学习</p>
          <p className="mt-1 text-sm text-ink/55">按科目顺序刷题,答错后进入错题本。</p>
        </section>
        <a
          href="/exam"
          className="rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ring-white/55 transition hover:-translate-y-0.5 hover:ring-sky/30"
        >
          <p className="text-base font-semibold text-ink">模拟考试</p>
          <p className="mt-1 text-sm text-ink/55">进入模拟考试,开始考试部分保持不变。</p>
        </a>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {/* 左侧顺序轴:垂直科目导航,点击切换 */}
        <nav className="sm:sticky sm:top-10 sm:h-fit sm:w-52 sm:shrink-0">
          <ul className="flex gap-2 overflow-x-auto pb-2 sm:flex-col sm:gap-1 sm:overflow-visible sm:pb-0">
            {categories.map((c) => {
              const active = c === category;
              return (
                <li key={c} className="shrink-0">
                  <button
                    onClick={() => setCategory(c)}
                    className={`w-full whitespace-nowrap rounded-lg border-l-2 px-3 py-2 text-left text-sm transition sm:whitespace-normal ${
                      active
                        ? 'border-sky bg-sky/10 font-semibold text-ink'
                        : 'border-transparent text-ink/55 hover:bg-mist hover:text-ink'
                    }`}
                  >
                    {c}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 右侧题目列表 */}
        <div className="min-w-0 flex-1">
          {/* 题干搜索:在当前科目内模糊匹配 */}
          <div className="relative mb-4">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索题干关键词…"
              className="w-full rounded-lg border border-ink/15 bg-white/60 px-3 py-2 pr-9 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
            />
            {keyword && (
              <button
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
                aria-label="清空搜索"
              >
                ✕
              </button>
            )}
          </div>

          {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
          {loading && <p className="mb-4 text-sm text-ink/40">加载中...</p>}
          {!loading && items.length === 0 && !err && (
            <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
              {searchKw ? `没有匹配「${searchKw}」的题目。` : '该科目暂无题目。管理员可在后台导入 Excel 题库。'}
            </p>
          )}
          <div className="space-y-4">
            {items.map((q, i) => (
              <QuestionCard key={q.id} q={q} index={(page - 1) * pageSize + i + 1} />
            ))}
          </div>

          {/* 分页栏 */}
          {total > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 text-sm text-ink/60">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-ink/15 px-2 py-1 outline-none focus:border-sky"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}条/页
                  </option>
                ))}
              </select>
              <span>共 {total} 条</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-ink/15 px-2 py-1 hover:bg-mist disabled:opacity-40"
                >
                  ‹
                </button>
                <span className="px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md border border-ink/15 px-2 py-1 hover:bg-mist disabled:opacity-40"
                >
                  ›
                </button>
              </div>
              <span className="flex items-center gap-1">
                前往
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={jumpTo}
                  onChange={(e) => setJumpTo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    commitJump();
                  }}
                  className="w-14 rounded-md border border-ink/15 px-2 py-1 text-center outline-none focus:border-sky"
                />
                页
                <button
                  onClick={commitJump}
                  className="rounded-md border border-sky/35 px-2 py-1 font-medium text-sky hover:bg-sky/5"
                >
                  跳转
                </button>
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function QuestionCard({ q, index }: { q: QuestionItem; index: number }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ answer: string; analysis: string } | null>(null);
  const [showComments, setShowComments] = useState(false);

  function toggle(key: string) {
    if (answer) return; // 已揭晓答案后锁定
    if (q.type === 'single') {
      setPicked([key]);
    } else {
      setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
    }
  }

  async function reveal() {
    try {
      const result = await api.questionAnswer(q.id);
      setAnswer(result);
      const pickedKey = [...picked].sort().join('');
      if (pickedKey && pickedKey !== result.answer) {
        await api.recordStudyWrong(q.id, pickedKey);
      }
    } catch {
      /* 静默:答案获取失败不致命,用户可重试 */
    }
  }

  const correctSet = new Set(answer?.answer.split('') ?? []);
  const pickedKey = [...picked].sort().join('');
  const isRight = answer && pickedKey === answer.answer;

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <div className="mb-3 flex items-start gap-2">
        <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink/60">
          {index} · {q.type === 'single' ? '单选' : '多选'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{q.stem}</p>
          <QuestionImages urls={q.imageUrls} />
        </div>
      </div>

      <div className="space-y-2">
        {q.options.map((o) => {
          const chosen = picked.includes(o.key);
          const correct = answer && correctSet.has(o.key);
          const cls = answer
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
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {!answer ? (
          <button
            onClick={reveal}
            className="rounded-lg bg-sky px-5 py-2 text-sm font-medium text-white hover:bg-steel"
          >
            查看答案
          </button>
        ) : (
          <span className={`text-sm font-medium ${isRight ? 'text-sky' : 'text-red-500'}`}>
            {picked.length ? (isRight ? '回答正确' : '回答错误') : '正确答案'} · {answer.answer}
          </span>
        )}
        <button
          onClick={() => setShowComments((s) => !s)}
          className="text-sm text-ink/50 hover:text-ink"
        >
          {showComments ? '收起评论' : '评论'}
        </button>
      </div>

      {answer?.analysis && (
        <p className="mt-3 rounded-lg bg-mist px-4 py-3 text-sm text-ink/70">解析:{answer.analysis}</p>
      )}

      {showComments && <Comments questionId={q.id} />}
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

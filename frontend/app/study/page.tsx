'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, assetUrl, getToken, type QuestionChapter, type QuestionItem } from '@/lib/api';
import Comments from '@/components/Comments';

export default function StudyPage() {
  const router = useRouter();
  const [items, setItems] = useState<QuestionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [chapters, setChapters] = useState<QuestionChapter[]>([]);
  const [chapter, setChapter] = useState('');
  const [chapterReady, setChapterReady] = useState(false);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterErr, setChapterErr] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [keyword, setKeyword] = useState(''); // 搜索输入(即时)
  const [searchKw, setSearchKw] = useState(''); // 防抖后真正用于查询的关键词
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [manualPage, setManualPage] = useState<number | null>(null);
  const [jumpTo, setJumpTo] = useState('1');
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);
  const [answeredResults, setAnsweredResults] = useState<Record<string, boolean>>({});
  const startedStudyCategories = useRef(new Set<string>());
  const requestedChapter = useRef('');
  const requestedPage = useRef(0);
  const chapterRequest = useRef(0);
  const questionRequest = useRef(0);
  const correctCount = Object.values(answeredResults).filter(Boolean).length;
  const wrongCount = Object.values(answeredResults).filter((ok) => !ok).length;
  const accuracy = correctCount + wrongCount > 0 ? Math.round((correctCount / (correctCount + wrongCount)) * 100) : 0;

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
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get('category') ?? '';
        requestedChapter.current = params.get('chapter') ?? '';
        const fromPage = Number(params.get('page'));
        requestedPage.current = Number.isInteger(fromPage) && fromPage > 0 ? fromPage : 0;
        if (cs.length) setCategory((cur) => cur || (cs.includes(fromUrl) ? fromUrl : cs[0]));
      })
      .catch(() => undefined);
  }, [router]);

  const loadChapters = useCallback(async (targetCategory: string) => {
    if (!targetCategory) return;
    const requestId = ++chapterRequest.current;
    questionRequest.current += 1;
    setItems([]);
    setTotal(0);
    setChapterLoading(true);
    setChapterErr('');
    setChapterReady(false);
    try {
      const rows = await api.chapters(targetCategory);
      if (requestId !== chapterRequest.current) return;
      setChapters(rows);
      if (rows.length === 0) {
        if (targetCategory === 'M1 航空概论') {
          setChapter('');
          setChapterErr('M1 章节暂不可用，请重新加载。');
          return;
        }
        setChapter('');
        setChapterReady(true);
        return;
      }
      const desired = requestedChapter.current;
      const selected = rows.find((item) => item.name === desired) ?? rows[0];
      if (desired && desired !== selected.name) setRecoveryNotice(`章节链接已失效，已定位到${selected.name}。`);
      setChapter(selected.name);
      requestedChapter.current = selected.name;
      setChapterReady(true);
    } catch (error) {
      if (requestId !== chapterRequest.current) return;
      setChapters([]);
      setChapter('');
      setChapterErr((error as Error).message);
    } finally {
      if (requestId === chapterRequest.current) setChapterLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!category) return;
    void loadChapters(category);
  }, [category, loadChapters]);

  // 普通切换回到第 1 页；从链接恢复时保留链接里的页码，避免章节加载把它覆盖掉。
  useEffect(() => {
    if (requestedPage.current > 0) {
      if (!chapterReady) return;
      const restoredPage = requestedPage.current;
      requestedPage.current = 0;
      setManualPage(restoredPage);
      setPage(restoredPage);
      setAnsweredResults({});
      return;
    }
    setManualPage(null);
    setPage(1);
    setAnsweredResults({});
  }, [category, chapter, chapterReady, pageSize, searchKw]);

  useEffect(() => {
    if (!getToken() || !category || !chapterReady) return;
    if (chapters.length > 0 && !chapter) return;
    if (!startedStudyCategories.current.has(category)) {
      startedStudyCategories.current.add(category);
      void api.startStudy(category).catch(() => undefined);
    }
    setLoading(true);
    setErr('');
    const requestId = ++questionRequest.current;
    api
      .questions({
        usage: 'study',
        category,
        chapter: chapter || undefined,
        keyword: searchKw || undefined,
        page: manualPage ?? page,
        pageSize,
      })
      .then((r) => {
        if (requestId !== questionRequest.current) return;
        setItems(r.items);
        setTotal(r.total);
        setPage(r.page);
        setPageSize(r.pageSize);
      })
      .catch((e) => {
        if (requestId !== questionRequest.current) return;
        const error = e as Error;
        setErr(error.message);
        if (error instanceof ApiError && error.code === 'QUESTION_SET_UPDATED') {
          setRecoveryNotice('题库已更新，已为你重新加载可继续学习的位置。');
          void loadChapters(category);
        }
      })
      .finally(() => {
        if (requestId === questionRequest.current) setLoading(false);
      });
  }, [category, chapter, chapterReady, chapters.length, searchKw, manualPage, page, pageSize, loadChapters]);

  useEffect(() => {
    if (!category || !chapterReady) return;
    const url = new URL(window.location.href);
    url.searchParams.set('category', category);
    if (chapter) url.searchParams.set('chapter', chapter);
    else url.searchParams.delete('chapter');
    url.searchParams.set('page', String(page));
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [category, chapter, chapterReady, page]);

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const nextCategory = params.get('category') ?? '';
      requestedChapter.current = params.get('chapter') ?? '';
      const nextPage = Number(params.get('page'));
      requestedPage.current = Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 0;
      if (categories.includes(nextCategory) && nextCategory !== category) {
        chapterRequest.current += 1;
        questionRequest.current += 1;
        setChapterReady(false);
        setChapters([]);
        setChapter('');
        setItems([]);
        setTotal(0);
        setCategory(nextCategory);
      }
      if (nextCategory === category) void loadChapters(category);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [categories, category, loadChapters]);

  function changeCategory(next: string) {
    chapterRequest.current += 1;
    questionRequest.current += 1;
    requestedChapter.current = '';
    setRecoveryNotice('');
    setChapterReady(false);
    setChapters([]);
    setChapter('');
    setItems([]);
    setTotal(0);
    setCategory(next);
    const url = new URL(window.location.href);
    url.searchParams.set('category', next);
    url.searchParams.delete('chapter');
    url.searchParams.delete('page');
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function changeChapter(next: string) {
    questionRequest.current += 1;
    setItems([]);
    setTotal(0);
    requestedChapter.current = next;
    setRecoveryNotice('');
    setChapter(next);
    const url = new URL(window.location.href);
    url.searchParams.set('category', category);
    url.searchParams.set('chapter', next);
    url.searchParams.delete('page');
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setJumpTo(String(page));
  }, [page]);

  async function recordBatchProgress() {
    if (searchKw || items.length === 0) return;
    await api.recordStudyProgress(items[items.length - 1].id).catch(() => undefined);
  }

  async function commitJump() {
    const next = Math.min(totalPages, Math.max(1, Number(jumpTo) || 1));
    if (next === page) return;
    if (next > page) {
      await recordBatchProgress();
    }
    setManualPage(next);
    setJumpTo(String(next));
  }

  async function changePage(next: number) {
    const target = Math.min(totalPages, Math.max(1, next));
    if (target === page) return;
    if (target > page) {
      await recordBatchProgress();
    }
    setManualPage(target);
  }

  function recordAnswered(questionId: string, isCorrect: boolean) {
    setAnsweredResults((prev) => (prev[questionId] !== undefined ? prev : { ...prev, [questionId]: isCorrect }));
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回首页
      </a>
      <div className="mb-4 mt-1 flex flex-col items-start gap-3">
        <button
          type="button"
          onClick={() => setShowCorrectAnswer((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            showCorrectAnswer
              ? 'border-sky bg-sky text-white'
              : 'border-ink/15 bg-white/70 text-ink/65 hover:border-sky/35 hover:text-ink'
          }`}
        >
          正确答案
        </button>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">专题学习</h1>
      </div>

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

      <div className="mb-5 space-y-3 sm:hidden">
        <label className="block text-base font-medium text-ink">
          科目
          <select
            value={category}
            onChange={(event) => changeCategory(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-design-border bg-white px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        {chapters.length > 0 && (
          <label className="block text-base font-medium text-ink">
            章节
            <select
              value={chapter}
              onChange={(event) => changeChapter(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-design-border bg-white px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {chapters.map((item) => (
                <option key={item.name} value={item.name}>{item.name}（{item.questionCount}题）</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        {/* 左侧顺序轴:垂直科目导航,点击切换 */}
        <nav aria-label="学习科目与章节" className="hidden sm:sticky sm:top-10 sm:block sm:h-fit sm:w-56 sm:shrink-0">
          <p className="mb-2 text-sm font-semibold text-ink/65">学习科目</p>
          <ul className="flex flex-col gap-1">
            {categories.map((c) => {
              const active = c === category;
              return (
                <li key={c}>
                  <button
                    onClick={() => changeCategory(c)}
                    className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-base transition ${
                      active
                        ? 'border-brand bg-brand-tint font-semibold text-ink'
                        : 'border-transparent text-ink/65 hover:bg-mist hover:text-ink'
                    }`}
                  >
                    {c}
                  </button>
                  {active && chapters.length > 0 && (
                    <div className="mb-3 mt-2 pl-3">
                      <p className="mb-1 text-sm font-semibold text-ink/65">章节</p>
                      <ul className="space-y-1">
                        {chapters.map((item) => {
                          const selected = item.name === chapter;
                          return (
                            <li key={item.name}>
                              <button
                                type="button"
                                aria-current={selected ? 'true' : undefined}
                                onClick={() => changeChapter(item.name)}
                                className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-base outline-none focus:ring-2 focus:ring-brand/30 ${
                                  selected ? 'border-brand bg-brand-tint text-brand-deep' : 'border-transparent text-ink/65 hover:bg-mist'
                                }`}
                              >
                                <span className="block font-medium">{item.name}</span>
                                <span className="text-sm text-ink/55">
                                  {item.questionCount} 题{item.resumePosition > 0 ? ` · 上次第 ${item.resumePosition} 题` : ''}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 右侧题目列表 */}
        <div className="min-w-0 flex-1">
          {chapterLoading && <p className="mb-4 text-base text-ink/55" aria-live="polite">正在加载章节…</p>}
          {chapterErr && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700" role="alert">
              <p>{chapterErr}</p>
              <button type="button" onClick={() => void loadChapters(category)} className="mt-2 min-h-11 font-semibold text-red-700 underline">
                重新加载
              </button>
            </div>
          )}
          {recoveryNotice && (
            <p className="mb-4 rounded-lg border border-brand/25 bg-brand-tint px-4 py-3 text-base text-brand-deep" role="status">
              {recoveryNotice}
            </p>
          )}
          {chapter && (
            <header className="mb-4 border-b border-design-border pb-3">
              <p className="text-sm text-ink/55">{category} / {chapter}</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">{chapter}</h2>
              {chapters.find((item) => item.name === chapter)?.resumePosition ? (
                <p className="mt-1 text-sm text-ink/65">
                  上次学到第 {chapters.find((item) => item.name === chapter)?.resumePosition} / 共 {chapters.find((item) => item.name === chapter)?.questionCount} 题
                </p>
              ) : null}
            </header>
          )}
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
          {total > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-ink/10 bg-white/65 px-4 py-3 text-sm text-ink/70">
              <span>
                答对: <b className="text-sky">{correctCount}</b> 题
              </span>
              <span>
                答错: <b className="text-red-500">{wrongCount}</b> 题
              </span>
              <span>正确率: {accuracy}%</span>
              <span>共 {total} 题</span>
            </div>
          )}
          {loading && <p className="mb-4 text-base text-ink/55" aria-live="polite">正在加载题目…</p>}
          {!loading && items.length === 0 && !err && (
            <p className="rounded-2xl bg-white/60 backdrop-blur-xl p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55">
              {searchKw ? `本章没有匹配「${searchKw}」的题目。` : chapter ? '本章暂无题目，请返回章节列表选择其他章节。' : '该科目暂无题目。'}
            </p>
          )}
          <div className="space-y-4">
            {items.map((q, i) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={(page - 1) * pageSize + i + 1}
                showCorrectAnswer={showCorrectAnswer}
                onAnswered={recordAnswered}
                onQuestionSetUpdated={() => {
                  questionRequest.current += 1;
                  setItems([]);
                  setTotal(0);
                  setRecoveryNotice('题库已更新，已为你重新加载可继续学习的位置。');
                  void loadChapters(category);
                }}
              />
            ))}
          </div>

          {/* 分页栏 */}
          {total > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 text-sm text-ink/60">
              <span>共 {total} 条</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void changePage(page - 1)}
                  disabled={page <= 1}
                  className="rounded-md border border-ink/15 px-2 py-1 hover:bg-mist disabled:opacity-40"
                >
                  ‹
                </button>
                <span className="px-2">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => void changePage(page + 1)}
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
                    void commitJump();
                  }}
                  className="w-14 rounded-md border border-ink/15 px-2 py-1 text-center outline-none focus:border-sky"
                />
                页
                <button
                  onClick={() => void commitJump()}
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

function QuestionCard({
  q,
  index,
  showCorrectAnswer,
  onAnswered,
  onQuestionSetUpdated,
}: {
  q: QuestionItem;
  index: number;
  showCorrectAnswer: boolean;
  onAnswered: (questionId: string, isCorrect: boolean) => void;
  onQuestionSetUpdated: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ answer: string; analysis: string; imageUrls?: string[] } | null>(null);
  const [autoRevealed, setAutoRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [showComments, setShowComments] = useState(false);

  const reveal = useCallback(async (nextPicked = picked, recordPractice = true, autoDisplay = false) => {
    const handleError = (error: unknown) => {
      if (error instanceof ApiError && (error.code === 'QUESTION_SET_UPDATED' || error.code === 'NOT_FOUND')) {
        onQuestionSetUpdated();
        return;
      }
      setRevealError((error as Error).message || '答案加载失败，请重试');
    };
    if (answer) {
      try {
        if (!autoDisplay) {
          setAutoRevealed(false);
          if (recordPractice) {
            const pickedKey = [...nextPicked].sort().join('');
            if (pickedKey) onAnswered(q.id, pickedKey === answer.answer);
            await api.recordStudyWrong(q.id, pickedKey || answer.answer);
          }
        }
      } catch (error) {
        handleError(error);
      }
      return;
    }
    if (revealing) return;
    setRevealing(true);
    setRevealError('');
    try {
      const result = await api.questionAnswer(q.id);
      setAnswer(result);
      setAutoRevealed(autoDisplay);
      if (!recordPractice) return;
      const pickedKey = [...nextPicked].sort().join('');
      if (pickedKey) onAnswered(q.id, pickedKey === result.answer);
      await api.recordStudyWrong(q.id, pickedKey || result.answer);
    } catch (error) {
      handleError(error);
    } finally {
      setRevealing(false);
    }
  }, [answer, onAnswered, onQuestionSetUpdated, picked, q.id, revealing]);

  useEffect(() => {
    if (!showCorrectAnswer || answer || revealing) return;
    void reveal([], false, true);
  }, [answer, q.id, reveal, revealing, showCorrectAnswer]);

  function toggle(key: string) {
    if (answer) return; // 已揭晓答案后锁定
    if (q.type === 'single') {
      setPicked([key]);
      void reveal([key]);
    } else {
      setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
    }
  }

  const correctSet = new Set(answer?.answer.split('') ?? []);
  const pickedKey = [...picked].sort().join('');
  const isRight = answer && pickedKey === answer.answer;
  const shouldShowAnswer = Boolean(answer && (!autoRevealed || showCorrectAnswer));
  const visibleAnswer = shouldShowAnswer ? answer : null;

  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <div className="mb-3 flex items-start gap-2">
        <span className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-ink/60">
          {index} · {q.type === 'single' ? '单选' : '多选'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{q.stem}</p>
          <QuestionImages urls={q.stemImageUrls} alt="题干配图" />
        </div>
      </div>

      <div className="space-y-2">
        {q.options.map((o) => {
          const chosen = picked.includes(o.key);
          const correct = shouldShowAnswer && correctSet.has(o.key);
          const cls = shouldShowAnswer
            ? correct
              ? 'border-green-300 bg-green-50 text-green-700'
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
              <span className="flex-1 text-sm">{o.text}</span>
              {correct && <span className="shrink-0 text-xs text-green-600">正确答案</span>}
              {chosen && shouldShowAnswer && !correct && <span className="shrink-0 text-xs text-red-500">你的选择</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        {!shouldShowAnswer ? (
          <button
            onClick={() => reveal()}
            disabled={revealing}
            className="rounded-lg bg-sky px-5 py-2 text-sm font-medium text-white hover:bg-steel"
          >
            {revealing ? '判定中...' : '查看答案'}
          </button>
        ) : (
          <span className={`text-sm font-medium ${isRight ? 'text-green-600' : 'text-red-500'}`}>
            {picked.length ? (isRight ? '回答正确' : '回答错误') : '正确答案'} · {visibleAnswer?.answer}
          </span>
        )}
        <button
          onClick={() => setShowComments((s) => !s)}
          className="text-sm text-ink/50 hover:text-ink"
        >
          {showComments ? '收起评论' : '评论'}
        </button>
      </div>

      {revealError && <p className="mt-2 text-sm text-red-600" role="alert">{revealError}</p>}

      {visibleAnswer && (visibleAnswer.analysis || visibleAnswer.imageUrls?.length) && (
        <div className="mt-3 rounded-lg bg-mist px-4 py-3 text-sm text-ink/70">
          {visibleAnswer.analysis && <p>解析:{visibleAnswer.analysis}</p>}
          <QuestionImages urls={visibleAnswer.imageUrls} alt="解析配图" />
        </div>
      )}

      {showComments && <Comments questionId={q.id} />}
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

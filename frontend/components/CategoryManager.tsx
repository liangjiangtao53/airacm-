'use client';

import { useEffect, useState } from 'react';
import { api, type AdminQuestionItem } from '@/lib/api';

const PAGE_SIZE = 20;

// 进入某科目:搜索题干、勾选单个/多个删除、按页浏览。删除后通过 onChanged 通知父级刷新统计。
export default function CategoryManager({
  category,
  onChanged,
}: {
  category: string;
  onChanged: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<AdminQuestionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load(p: number, kw: string) {
    setLoading(true);
    setErr('');
    try {
      const r = await api.adminListQuestions({ category, keyword: kw, page: p, pageSize: PAGE_SIZE });
      setItems(r.items);
      setTotal(r.total);
      setPage(r.page);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 切换科目时重置并重载。
  useEffect(() => {
    setKeyword('');
    setSel(new Set());
    load(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const allOnPage = items.length > 0 && items.every((i) => sel.has(i.id));
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (allOnPage) items.forEach((i) => n.delete(i.id));
      else items.forEach((i) => n.add(i.id));
      return n;
    });
  }

  async function delIds(ids: string[]) {
    try {
      await api.batchDeleteQuestions(ids);
      setSel((s) => {
        const n = new Set(s);
        ids.forEach((id) => n.delete(id));
        return n;
      });
      await load(page, keyword);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mt-3 rounded-lg border border-ink/10 bg-white/50 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(1, keyword)}
          placeholder="搜索题干关键词…"
          className="flex-1 rounded-lg border border-ink/15 px-3 py-1.5 text-sm outline-none focus:border-sky"
        />
        <button
          onClick={() => load(1, keyword)}
          className="rounded-lg bg-steel px-4 py-1.5 text-sm font-medium text-white hover:bg-ink"
        >
          搜索
        </button>
        <button
          onClick={() => {
            if (sel.size && window.confirm(`删除选中的 ${sel.size} 题?不可恢复。`)) delIds([...sel]);
          }}
          disabled={sel.size === 0}
          className="rounded-lg border border-red-300 px-4 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-40"
        >
          删除选中({sel.size})
        </button>
      </div>

      {err && <p className="mb-2 rounded bg-red-50 px-3 py-1.5 text-sm text-red-600">{err}</p>}

      <div className="mb-2 flex items-center justify-between text-xs text-ink/50">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allOnPage} onChange={toggleAll} />
          本页全选
        </label>
        <span>共 {total} 题</span>
      </div>

      {loading ? (
        <p className="py-4 text-center text-sm text-ink/40">加载中…</p>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink/40">无匹配题目</p>
      ) : (
        <ul className="space-y-1">
          {items.map((q) => (
            <li key={q.id} className="flex items-start gap-2 rounded-lg bg-mist px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={sel.has(q.id)}
                onChange={() => toggle(q.id)}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="text-ink/80">{q.stem}</span>
                <span className="ml-2 text-xs text-ink/40">
                  [{q.type === 'single' ? '单选' : '多选'} · 答案 {q.answer}]
                </span>
              </span>
              <button
                onClick={() => window.confirm('删除该题?') && delIds([q.id])}
                className="shrink-0 text-xs text-red-500 hover:underline"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => load(page - 1, keyword)}
            disabled={page <= 1}
            className="rounded px-3 py-1 text-ink/60 hover:bg-mist disabled:opacity-30"
          >
            上一页
          </button>
          <span className="text-ink/50">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => load(page + 1, keyword)}
            disabled={page >= totalPages}
            className="rounded px-3 py-1 text-ink/60 hover:bg-mist disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

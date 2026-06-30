'use client';

import { useEffect, useState } from 'react';
import { api, type AdminQuestionItem, type QuestionUsage } from '@/lib/api';

const PAGE_SIZE = 20;
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const field =
  'w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/20';

type EditDraft = {
  type: AdminQuestionItem['type'];
  stem: string;
  answer: string;
  analysis: string;
  usage: QuestionUsage;
  options: Record<string, string>;
};

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
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

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

  function startEdit(q: AdminQuestionItem) {
    const options: Record<string, string> = {};
    OPTION_KEYS.forEach((key) => {
      options[key] = q.options.find((o) => o.key === key)?.text ?? '';
    });
    setEditingId(q.id);
    setDraft({
      type: q.type,
      stem: q.stem,
      answer: q.answer,
      analysis: q.analysis ?? '',
      usage: q.usage,
      options,
    });
    setErr('');
  }

  function cancelEdit() {
    setEditingId('');
    setDraft(null);
  }

  async function saveEdit() {
    if (!draft || !editingId) return;
    const options = OPTION_KEYS
      .map((key) => ({ key, text: draft.options[key]?.trim() ?? '' }))
      .filter((o) => o.text);
    if (!draft.stem.trim()) {
      setErr('题干不能为空');
      return;
    }
    if (options.length < 2) {
      setErr('至少需要 2 个选项');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const updated = await api.updateQuestion(editingId, {
        category,
        type: draft.type,
        stem: draft.stem,
        options,
        answer: draft.answer,
        analysis: draft.analysis,
        usage: draft.usage,
      });
      setItems((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      cancelEdit();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
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

      {draft && (
        <div className="mb-3 rounded-lg border border-sky/20 bg-sky/5 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">修改题目</h4>
            <div className="flex gap-2">
              <button
                onClick={cancelEdit}
                className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/65 hover:bg-white"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="rounded-lg bg-steel px-4 py-1.5 text-sm font-medium text-white hover:bg-ink disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            <textarea
              value={draft.stem}
              onChange={(e) => setDraft({ ...draft, stem: e.target.value })}
              rows={3}
              className={field}
              placeholder="题干"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as AdminQuestionItem['type'] })}
                className={field}
              >
                <option value="single">单选</option>
                <option value="multiple">多选</option>
              </select>
              <select
                value={draft.usage}
                onChange={(e) => setDraft({ ...draft, usage: e.target.value as QuestionUsage })}
                className={field}
              >
                <option value="both">考试+学习</option>
                <option value="study">仅学习</option>
                <option value="exam">仅考试</option>
              </select>
              <input
                value={draft.answer}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value.toUpperCase() })}
                className={field}
                placeholder="答案,如 A 或 AC"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OPTION_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center font-mono text-sm text-ink/50">{key}</span>
                  <input
                    value={draft.options[key] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        options: { ...draft.options, [key]: e.target.value },
                      })
                    }
                    className={field}
                    placeholder={`选项 ${key}`}
                  />
                </label>
              ))}
            </div>
            <textarea
              value={draft.analysis}
              onChange={(e) => setDraft({ ...draft, analysis: e.target.value })}
              rows={2}
              className={field}
              placeholder="解析"
            />
          </div>
        </div>
      )}

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
                  [{q.type === 'single' ? '单选' : '多选'} · {q.usage === 'exam' ? '仅考试' : q.usage === 'study' ? '仅学习' : '考试+学习'} · 答案 {q.answer}]
                </span>
                <span className="mt-1 block truncate text-xs text-ink/40">
                  {q.options.map((o) => `${o.key}.${o.text}`).join('  ')}
                </span>
              </span>
              <button
                onClick={() => startEdit(q)}
                className="shrink-0 text-xs font-medium text-sky hover:underline"
              >
                修改
              </button>
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

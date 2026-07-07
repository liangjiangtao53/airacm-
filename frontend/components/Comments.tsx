'use client';

import { useEffect, useState } from 'react';
import { api, type CommentItem } from '@/lib/api';

// 题目评论:学习/考试复盘/错题本共用。按 questionId 拉取与发表。
export default function Comments({ questionId }: { questionId: string }) {
  const [list, setList] = useState<CommentItem[]>([]);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.comments(questionId).then(setList).catch(() => undefined);
  }, [questionId]);

  async function add() {
    if (!content.trim()) return;
    setBusy(true);
    try {
      const c = await api.addComment(questionId, content.trim());
      setList((l) => [c, ...l]);
      setContent('');
    } catch {
      /* 提交失败用户可重试 */
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: CommentItem) {
    if (!window.confirm('确认删除这条评论吗？')) return;
    try {
      await api.deleteComment(comment.id);
      setList((current) => current.filter((item) => item.id !== comment.id));
    } catch {
      /* 删除失败用户可重试 */
    }
  }

  return (
    <div className="mt-4 border-t border-ink/5 pt-4">
      <div className="flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="写下你的想法..."
          className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-sky"
        />
        <button
          onClick={add}
          disabled={busy}
          className="rounded-lg bg-steel px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          发表
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {list.map((c) => (
          <li key={c.id} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink/75">
            <span className="mr-2 font-medium text-ink/55">{c.nickname}</span>
            {c.content}
            {c.canDelete && (
              <button onClick={() => remove(c)} className="ml-3 text-xs text-red-500 hover:text-red-600">
                删除
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

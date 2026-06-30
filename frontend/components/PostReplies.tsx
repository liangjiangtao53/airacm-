'use client';

import { useEffect, useState } from 'react';
import { api, type PostReplyItem } from '@/lib/api';

export default function PostReplies({
  postId,
  canReply,
  onCountChange,
}: {
  postId: string;
  canReply: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [list, setList] = useState<PostReplyItem[]>([]);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .postReplies(postId)
      .then((rows) => {
        setList(rows);
        onCountChange?.(rows.length);
      })
      .catch(() => undefined);
    // onCountChange intentionally omitted to avoid parent re-render loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function add() {
    const trimmed = content.trim();
    if (!trimmed) return;
    setErr('');
    setBusy(true);
    try {
      const row = await api.addPostReply(postId, trimmed);
      setList((current) => {
        const next = [...current, row];
        onCountChange?.(next.length);
        return next;
      });
      setContent('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-ink/5 pt-4">
      {canReply ? (
        <div className="flex gap-2">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写下你的回复..."
            maxLength={500}
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-sky"
          />
          <button
            onClick={add}
            disabled={busy || !content.trim()}
            className="rounded-lg bg-steel px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            回复
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-mist px-3 py-2 text-sm text-ink/55 sm:flex-row sm:items-center sm:justify-between">
          <span>登录后可以回复。</span>
          <a href="/login" className="font-medium text-sky hover:underline">
            去登录
          </a>
        </div>
      )}
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <ul className="mt-3 space-y-2">
        {list.map((reply) => (
          <li key={reply.id} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink/75">
            <span className="mr-2 font-medium text-ink/55">{reply.nickname}</span>
            {reply.content}
          </li>
        ))}
      </ul>
    </div>
  );
}

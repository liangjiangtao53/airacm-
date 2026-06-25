'use client';

import { useEffect, useState } from 'react';
import { api, type PostReplyItem } from '@/lib/api';

// 帖子回复:交流模块用。按 postId 拉取与发表,回复数变化回传给父卡片。
export default function PostReplies({
  postId,
  onCountChange,
}: {
  postId: string;
  onCountChange?: (count: number) => void;
}) {
  const [list, setList] = useState<PostReplyItem[]>([]);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .postReplies(postId)
      .then((r) => {
        setList(r);
        onCountChange?.(r.length);
      })
      .catch(() => undefined);
    // onCountChange 故意不入依赖:父组件每次渲染传入新函数会致循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function add() {
    if (!content.trim()) return;
    setBusy(true);
    try {
      const c = await api.addPostReply(postId, content.trim());
      setList((l) => {
        const next = [...l, c];
        onCountChange?.(next.length);
        return next;
      });
      setContent('');
    } catch {
      /* 提交失败用户可重试 */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-ink/5 pt-4">
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
          disabled={busy}
          className="rounded-lg bg-steel px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          回复
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {list.map((r) => (
          <li key={r.id} className="rounded-lg bg-mist px-3 py-2 text-sm text-ink/75">
            <span className="mr-2 font-medium text-ink/55">{r.nickname}</span>
            {r.content}
          </li>
        ))}
      </ul>
    </div>
  );
}

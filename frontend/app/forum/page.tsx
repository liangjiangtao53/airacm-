'use client';

import { useEffect, useState } from 'react';
import { api, getToken, type ForumTopic, type PostItem } from '@/lib/api';
import PostReplies from '@/components/PostReplies';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false }).replace(/:\d{2}$/, '');
}

export default function ForumPage() {
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [activeTopic, setActiveTopic] = useState('');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [draft, setDraft] = useState('');
  const [draftTopic, setDraftTopic] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const loggedIn = Boolean(getToken());

  useEffect(() => {
    Promise.all([api.forumTopics(), api.posts()])
      .then(([ts, r]) => {
        setTopics(ts);
        setDraftTopic(ts[0]?.id ?? '');
        setPosts(r.items);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function selectTopic(topicId: string) {
    setActiveTopic(topicId);
    setErr('');
    try {
      const r = await api.posts(topicId ? { topicId } : {});
      setPosts(r.items);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    if (!getToken()) {
      window.location.href = '/login';
      return;
    }
    const content = draft.trim();
    if (!content) return;
    if (!draftTopic) {
      setErr('请选择主题');
      return;
    }
    setErr('');
    setPosting(true);
    try {
      const p = await api.createPost(content, draftTopic);
      if (!activeTopic || activeTopic === draftTopic) setPosts((list) => [p, ...list]);
      setDraft('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  const topicName = (id: string | null) => topics.find((t) => t.id === id)?.name ?? '';

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        返回首页
      </a>
      <h1 className="mb-1 mt-1 text-3xl font-semibold tracking-tight text-ink">交流</h1>
      <p className="mb-6 text-sm text-ink/55">发帖提问、分享经验,与同行讨论交流。</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => selectTopic('')}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            activeTopic === '' ? 'bg-steel text-white' : 'bg-white/60 text-ink/60 hover:text-ink'
          }`}
        >
          全部
        </button>
        {topics.map((topic) => (
          <button
            key={topic.id}
            onClick={() => selectTopic(topic.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTopic === topic.id ? 'bg-steel text-white' : 'bg-white/60 text-ink/60 hover:text-ink'
            }`}
          >
            {topic.name}
          </button>
        ))}
      </div>

      <section className="mb-8 rounded-2xl bg-white/60 p-5 shadow-sm ring-1 ring-white/55 backdrop-blur-xl">
        {loggedIn ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="说点什么..."
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink/40">{draft.length}/1000</span>
                <select
                  value={draftTopic}
                  onChange={(e) => setDraftTopic(e.target.value)}
                  className="rounded-lg border border-ink/15 px-2 py-1 text-sm outline-none focus:border-sky"
                >
                  {topics.length === 0 && <option value="">(暂无主题)</option>}
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={submit}
                disabled={posting || !draft.trim() || !draftTopic}
                className="rounded-lg bg-sky px-5 py-2 text-sm font-medium text-white hover:bg-steel disabled:opacity-50"
              >
                发布
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink/55">未登录可以查看交流内容。登录后可以发帖和评论。</p>
            <a href="/login" className="rounded-lg bg-steel px-5 py-2 text-center text-sm font-medium text-white hover:bg-ink">
              登录后发言
            </a>
          </div>
        )}
      </section>

      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}
      {posts.length === 0 && !err && (
        <p className="rounded-2xl bg-white/60 p-8 text-center text-ink/50 shadow-sm ring-1 ring-white/55 backdrop-blur-xl">
          还没有帖子。
        </p>
      )}

      <div className="space-y-4">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            topicName={topicName(post.topicId)}
            showTopic={!activeTopic}
            loggedIn={loggedIn}
          />
        ))}
      </div>
    </main>
  );
}

function PostCard({
  post,
  topicName,
  showTopic,
  loggedIn,
}: {
  post: PostItem;
  topicName: string;
  showTopic: boolean;
  loggedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(post.replyCount);

  return (
    <section className="rounded-2xl bg-white/60 p-6 shadow-sm ring-1 ring-white/55 backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink/45">
        <span className="font-medium text-ink/70">{post.nickname}</span>
        {showTopic && topicName && <span className="rounded-md bg-sky/10 px-2 py-0.5 text-sky">{topicName}</span>}
        <span>{timeLabel(post.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-ink/85">{post.content}</p>
      <button onClick={() => setOpen((value) => !value)} className="mt-3 text-sm text-ink/50 hover:text-ink">
        {open ? '收起回复' : `回复${replyCount ? ` (${replyCount})` : ''}`}
      </button>
      {open && <PostReplies postId={post.id} canReply={loggedIn} onCountChange={setReplyCount} />}
    </section>
  );
}

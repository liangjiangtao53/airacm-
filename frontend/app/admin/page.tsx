'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-ink/5">
      <h2 className="mb-4 font-semibold text-ink">{props.title}</h2>
      {props.children}
    </section>
  );
}

const input =
  'w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20';
const btn =
  'rounded-lg bg-steel px-5 py-2 font-medium text-white hover:bg-ink disabled:opacity-50';

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  // 发码
  const [count, setCount] = useState('5');
  const [codeAmount, setCodeAmount] = useState('100');
  const [codes, setCodes] = useState<string[]>([]);

  // 手动充值
  const [userId, setUserId] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeMsg, setRechargeMsg] = useState('');

  // 建课程链
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [createdCourseId, setCreatedCourseId] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [createdChapterId, setCreatedChapterId] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [contentMsg, setContentMsg] = useState('');

  useEffect(() => {
    api
      .me()
      .then((u) => {
        if (u.role !== 'admin') {
          router.push('/');
          return;
        }
        setReady(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  function wrap(fn: () => Promise<void>) {
    return async () => {
      setErr('');
      try {
        await fn();
      } catch (e) {
        setErr((e as Error).message);
      }
    };
  }

  const genCodes = wrap(async () => {
    const r = await api.adminGenCodes(Number(count), Math.round(Number(codeAmount) * 100));
    setCodes(r.codes);
  });

  const doRecharge = wrap(async () => {
    const r = await api.adminRecharge(userId.trim(), Math.round(Number(rechargeAmount) * 100));
    setRechargeMsg('充值成功,用户当前余额 ¥' + (r.balance / 100).toFixed(2));
  });

  const createCourse = wrap(async () => {
    const c = await api.adminCreateCourse(title.trim(), Math.round(Number(price) * 100));
    setCreatedCourseId(c.id);
    setContentMsg('课程已创建: ' + c.id);
  });
  const createChapter = wrap(async () => {
    const c = await api.adminCreateChapter(createdCourseId, chapterTitle.trim());
    setCreatedChapterId(c.id);
    setContentMsg('章节已创建: ' + c.id);
  });
  const createLesson = wrap(async () => {
    const l = await api.adminCreateLesson(createdChapterId, lessonTitle.trim(), 'video', 'paid');
    setContentMsg('课时已创建: ' + l.id);
  });

  if (!ready) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">校验权限...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm text-ink/50 hover:text-ink">
        ← 返回工作台
      </a>
      <h1 className="mb-6 mt-1 text-3xl font-semibold tracking-tight text-ink">管理后台</h1>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      <div className="space-y-5">
        <Card title="生成充值码">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <label className="mb-1 block text-xs text-ink/60">数量</label>
              <input className={input} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className="w-36">
              <label className="mb-1 block text-xs text-ink/60">面额(元)</label>
              <input
                className={input}
                value={codeAmount}
                onChange={(e) => setCodeAmount(e.target.value)}
              />
            </div>
            <button className={btn} onClick={genCodes}>
              生成
            </button>
          </div>
          {codes.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-mist p-3 font-mono text-xs text-ink/70">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          )}
        </Card>

        <Card title="手动充值">
          <div className="space-y-3">
            <input
              className={input}
              placeholder="用户 ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <div className="flex gap-3">
              <input
                className={input}
                placeholder="金额(元)"
                value={rechargeAmount}
                onChange={(e) => setRechargeAmount(e.target.value)}
              />
              <button className={btn} onClick={doRecharge}>
                充值
              </button>
            </div>
            {rechargeMsg && <p className="text-sm text-sky">{rechargeMsg}</p>}
          </div>
        </Card>

        <Card title="创建课程内容">
          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                className={input}
                placeholder="课程标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                className={input + ' w-32'}
                placeholder="价格(元)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <button className={btn} onClick={createCourse}>
                建课程
              </button>
            </div>
            {createdCourseId && (
              <div className="flex gap-3">
                <input
                  className={input}
                  placeholder="章节标题"
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                />
                <button className={btn} onClick={createChapter}>
                  建章节
                </button>
              </div>
            )}
            {createdChapterId && (
              <div className="flex gap-3">
                <input
                  className={input}
                  placeholder="课时标题(video/paid)"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                />
                <button className={btn} onClick={createLesson}>
                  建课时
                </button>
              </div>
            )}
            {contentMsg && <p className="text-sm text-sky">{contentMsg}</p>}
          </div>
        </Card>
      </div>
    </main>
  );
}
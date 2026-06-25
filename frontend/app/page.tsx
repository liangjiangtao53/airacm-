'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearToken, getToken, type Me } from '@/lib/api';

type Tile = { href?: string; title: string; desc: string; span?: string; featured?: boolean };

// 普通学员在 Web 端只保留轻入口;管理员额外看到学习/考试入口,便于验收题库与排查内容问题。
const publicTiles: Tile[] = [
  { href: '/forum', title: '交流', desc: '发帖提问,与同行讨论交流', span: 'col-span-2' },
  { href: '/download-app', title: '下载 App', desc: '安卓版安装包上线后在这里下载' },
  { href: '/upgrade', title: '专升本', desc: '咨询报读与资料领取,添加客服了解' },
];
const adminStudyTiles: Tile[] = [
  { href: '/study', title: '专题学习', desc: '按科目刷题,查看答案与解析', span: 'col-span-2' },
  { href: '/exam', title: '在线考试', desc: '按科目组卷,交卷后自动判分' },
  { href: '/exam-review', title: '考试回顾', desc: '历史成绩与逐题复盘' },
  { href: '/wrong', title: '错题本', desc: '错题收集、重做校对与掌握标记' },
];
const adminTile: Tile = {
  href: '/admin',
  title: '管理后台',
  desc: '发码、建课、导入题库、用户管理',
  span: 'sm:col-span-2',
};

function roleLabel(role: Me['role']) {
  return role === 'super' ? '超级管理员' : role === 'admin' ? '业务管理员' : '学员';
}

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 未登录默认进登录页;token 失效(含单点被踢)也清掉并跳登录。
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api
      .me()
      .then(setMe)
      .then(() => setLoaded(true))
      .catch(() => {
        clearToken();
        router.replace('/login');
      });
  }, [router]);

  const isAdmin = me && (me.role === 'admin' || me.role === 'super');
  const shown = isAdmin ? [...adminStudyTiles, ...publicTiles, adminTile] : publicTiles;
  const subtitle = isAdmin
    ? '专题学习 · 在线考试 · 考试回顾 · 错题本 · 交流 · 管理后台'
    : '交流 · App 下载 · 专升本';

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">维修翼站</h1>
          <p className="mt-3 text-ink/50">{subtitle}</p>
        </div>
        {loaded &&
          (me ? (
            <span className="text-sm text-ink/55">
              <span className="font-medium text-ink">{me.nickname || roleLabel(me.role)}</span>
              <span className="text-ink/40"> · {roleLabel(me.role)} · </span>
              <button
                onClick={() => {
                  clearToken();
                  location.href = '/login';
                }}
                className="font-medium text-sky hover:underline"
              >
                退出
              </button>
            </span>
          ) : (
            <a
              href="/login"
              className="glass rounded-full px-6 py-2.5 text-sm font-medium text-ink transition hover:shadow-md hover:ring-sky/30"
            >
              登录
            </a>
          ))}
      </header>

      <div className="grid grid-cols-2 gap-4 sm:auto-rows-[168px] sm:grid-cols-4">
        {shown.map((t) => (
          <TileCard key={t.title} tile={t} />
        ))}
      </div>
    </main>
  );
}

function TileCard({ tile: t }: { tile: Tile }) {
  const className = `group glass-tile relative flex flex-col justify-between overflow-hidden p-6 ${
    t.span ?? ''
  } ${t.featured ? 'sm:p-8' : ''} ${t.href ? '' : 'cursor-default hover:translate-y-0 hover:ring-white/60'}`;

  const content = (
    <>
      {t.featured && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-sky/25 to-steel/10 blur-2xl"
        />
      )}
      <div className="relative">
        <h2
          className={`font-semibold text-ink transition ${t.href ? 'group-hover:text-sky' : ''} ${
            t.featured ? 'text-2xl sm:text-3xl' : 'text-base'
          }`}
        >
          {t.title}
        </h2>
        <p className={`mt-2 text-ink/55 ${t.featured ? 'text-sm sm:text-base' : 'text-sm'}`}>{t.desc}</p>
      </div>
      <span
        className={`relative mt-4 text-sm font-medium transition ${
          t.href ? 'text-sky opacity-0 group-hover:opacity-100' : 'text-ink/35'
        }`}
      >
        {t.href ? '进入 ->' : '即将开放'}
      </span>
    </>
  );

  return t.href ? (
    <a href={t.href} className={className}>
      {content}
    </a>
  ) : (
    <section className={className} aria-label={t.title}>
      {content}
    </section>
  );
}

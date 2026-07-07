'use client';

import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken, type Me } from '@/lib/api';

type Tile = { href: string; title: string; desc: string; span?: string };

const logoUrl = '/images/maintenance-wing-logo.jpg';

const publicTiles: Tile[] = [
  { href: '/forum', title: '交流', desc: '发帖提问,与同行讨论交流', span: 'sm:col-span-2' },
  { href: '/download-app', title: '下载 App', desc: '安卓版本安装包上线后在这里下载' },
  { href: '/upgrade', title: '学历提升', desc: '咨询报读与资料领取,添加客服了解' },
];

const signedInTiles: Tile[] = [
  { href: '/study', title: '专题学习', desc: '顺序学习与模拟考试都在这里进入' },
  { href: '/wrong', title: '错题本', desc: '复盘顺序学习错题,掌握后移出错题本' },
];

const adminTiles: Tile[] = [
  { href: '/admin', title: '后台管理', desc: '维护题库、卡密、用户和 App 安装包' },
];

function roleLabel(role: Me['role']) {
  return role === 'super' ? '超级管理员' : role === 'admin' ? '业务管理员' : '学员';
}

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  async function refreshMe(): Promise<Me | null> {
    if (!getToken()) {
      setMe(null);
      setLoaded(true);
      return null;
    }
    try {
      const user = await api.me();
      setMe(user);
      return user;
    } catch {
      clearToken();
      setMe(null);
      return null;
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void refreshMe();
  }, []);

  const isAdmin = me?.role === 'admin' || me?.role === 'super';
  // Web 端普通个人登录后仍保持公共门户;仅管理员增加学习验收入口和后台管理入口。
  const tiles = isAdmin ? [...publicTiles, ...signedInTiles, ...adminTiles] : publicTiles;
  const subtitle = isAdmin ? '交流 · 学习 · 考试 · 后台管理' : '交流 · App 下载 · 学历提升';

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-12 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <img
            src={logoUrl}
            alt="维修之翼 logo"
            className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-sm sm:h-20 sm:w-20"
          />
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">维修之翼</h1>
            <p className="mt-3 text-ink/50">{subtitle}</p>
          </div>
        </div>

        {loaded && (
          <div className="text-sm text-ink/55">
            {me ? (
              <span>
                <span className="font-medium text-ink">{me.nickname || roleLabel(me.role)}</span>
                <span className="text-ink/40"> · {roleLabel(me.role)} · </span>
                {(me.role === 'admin' || me.role === 'super') && (
                  <>
                    <a href="/admin" className="font-medium text-sky hover:underline">
                      后台
                    </a>
                    <span className="text-ink/40"> · </span>
                  </>
                )}
                <button
                  onClick={() => {
                    clearToken();
                    setMe(null);
                  }}
                  className="font-medium text-sky hover:underline"
                >
                  退出
                </button>
              </span>
            ) : (
              <button onClick={() => setLoginOpen(true)} className="font-medium text-sky hover:underline">
                登录
              </button>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 sm:auto-rows-[168px] sm:grid-cols-4">
        {tiles.map((tile) => (
          <a
            key={tile.title}
            href={tile.href}
            className={`group glass-tile flex flex-col justify-between p-6 ${tile.span ?? ''}`}
          >
            <div>
              <h2 className="text-base font-semibold text-ink transition group-hover:text-sky">{tile.title}</h2>
              <p className="mt-2 text-sm text-ink/55">{tile.desc}</p>
            </div>
            <span className="mt-4 text-sm font-medium text-sky opacity-0 transition group-hover:opacity-100">
              进入
            </span>
          </a>
        ))}
      </div>

      {loginOpen && (
        <LoginDialog
          onClose={() => setLoginOpen(false)}
          onDone={async () => {
            setLoginOpen(false);
            await refreshMe();
          }}
        />
      )}
    </main>
  );
}

function LoginDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'password' | 'key'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'key') {
        const r = await api.keyLogin(keyInput.trim());
        if (r.needProfile) {
          setErr('该卡密首次登录需要补全资料,请到登录页使用卡密登录。');
          return;
        }
        setToken(r.token);
      } else {
        const r = await api.login(phone.trim(), password);
        setToken(r.token);
      }
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-ink/10">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">登录</h2>
            <p className="mt-1 text-sm text-ink/50">登录后可以发帖、评论和进入学习功能。</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-ink/35 hover:text-ink" aria-label="关闭">
            ×
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-lg bg-mist p-1 text-sm">
          <button
            onClick={() => {
              setMode('password');
              setErr('');
            }}
            className={`rounded-md py-2 font-medium ${mode === 'password' ? 'bg-white text-ink shadow-sm' : 'text-ink/50'}`}
          >
            密码登录
          </button>
          <button
            onClick={() => {
              setMode('key');
              setErr('');
            }}
            className={`rounded-md py-2 font-medium ${mode === 'key' ? 'bg-white text-ink shadow-sm' : 'text-ink/50'}`}
          >
            卡密登录
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'password' ? (
            <>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="numeric"
                placeholder="手机号"
                className="w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="密码"
                className="w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
              />
            </>
          ) : (
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="输入卡密"
              className="w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
            />
          )}

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

          <button
            onClick={submit}
            disabled={busy || (mode === 'password' ? !phone.trim() || !password : !keyInput.trim())}
            className="w-full rounded-lg bg-steel px-5 py-2 font-medium text-white hover:bg-ink disabled:opacity-50"
          >
            {busy ? '登录中...' : '登录'}
          </button>
        </div>
      </section>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';

const input =
  'w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20';
const btn = 'rounded-lg bg-steel px-5 py-2 font-medium text-white hover:bg-ink disabled:opacity-50';
const logoUrl = '/images/maintenance-wing-logo.jpg';

export default function LoginPage() {
  const router = useRouter();
  // 注册暂不展示,默认密码登录,另提供卡密登录。
  const [tab, setTab] = useState<'login' | 'register' | 'key'>('login');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // 卡密首次登录:拿到 pending token 后进入资料补全态(强制填手机号+昵称)。
  const [needProfile, setNeedProfile] = useState(false);

  // 发送验证码倒计时(防连点 + 呼应后端 60s 重发限制)。
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  function startCooldown() {
    setCooldown(60);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && timer.current) clearInterval(timer.current);
        return s - 1;
      });
    }, 1000);
  }

  async function sendCode() {
    setErr('');
    setMsg('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setErr('请输入正确的手机号');
      return;
    }
    try {
      await api.sendCode(phone);
      setMsg('验证码已发送(开发模式固定 1234)');
      startCooldown();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function submit() {
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      if (tab === 'key') {
        const r = await api.keyLogin(keyInput.trim());
        setToken(r.token); // 正式 token 或 pending token
        if (r.needProfile) {
          // 首次登录:不放行,进入资料补全态。
          setPhone('');
          setNickname('');
          setNeedProfile(true);
          return;
        }
        router.push('/');
        return;
      }
      const r =
        tab === 'register'
          ? await api.register(phone, code, password, nickname || undefined)
          : await api.login(phone, password);
      setToken(r.token);
      router.push('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // 卡密用户补全资料:手机号 + 昵称(昵称不可重复,后端校验)。
  async function submitProfile() {
    setErr('');
    setMsg('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setErr('请输入正确的手机号');
      return;
    }
    if (nickname.trim().length < 2) {
      setErr('昵称至少 2 个字');
      return;
    }
    setBusy(true);
    try {
      const r = await api.completeProfile(phone, nickname.trim());
      setToken(r.token);
      router.push('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="mb-6 flex flex-col items-center text-center">
        <img
          src={logoUrl}
          alt="维修翼站 logo"
          className="h-24 w-24 rounded-3xl object-cover shadow-sm"
        />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink">维修翼站</h1>
      </div>
      <div className="mt-3 rounded-2xl bg-white/60 backdrop-blur-xl p-7 shadow-sm ring-1 ring-white/55">
        {needProfile ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">完善账号资料</h2>
            <p className="text-sm text-ink/55">
              卡密验证成功,请填写手机号和昵称后进入(昵称不可与他人重复)。
            </p>
            <input
              className={input}
              placeholder="手机号"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className={input}
              placeholder="昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
            <button onClick={submitProfile} disabled={busy} className={btn + ' w-full'}>
              完成并进入
            </button>
          </div>
        ) : (
        <>
        <div className="mb-6 flex gap-2 rounded-lg bg-mist p-1 text-sm">
          {(['login', 'key'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setErr('');
                setMsg('');
              }}
              className={`flex-1 rounded-md py-2 font-medium transition ${
                tab === t ? 'bg-white text-ink shadow-sm' : 'text-ink/50'
              }`}
            >
              {t === 'key' ? '卡密' : '登录'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === 'key' && (
            <input
              className={input}
              placeholder="输入卡密"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          )}

          {tab !== 'key' && (
            <input
              className={input}
              placeholder="手机号"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}

          {tab === 'register' && (
            <div className="flex gap-2">
              <input
                className={input}
                placeholder="短信验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button onClick={sendCode} disabled={cooldown > 0} className={btn + ' whitespace-nowrap'}>
                {cooldown > 0 ? `${cooldown}s` : '发送验证码'}
              </button>
            </div>
          )}

          {tab !== 'key' && (
            <input
              className={input}
              type="password"
              placeholder={tab === 'register' ? '设置密码(至少 8 位)' : '密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}

          {tab === 'register' && (
            <input
              className={input}
              placeholder="昵称(可选)"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          )}

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
          {msg && <p className="rounded-lg bg-sky/10 px-3 py-2 text-sm text-sky">{msg}</p>}

          <button onClick={submit} disabled={busy} className={btn + ' w-full'}>
            {tab === 'register' ? '注册并登录' : tab === 'key' ? '卡密登录' : '登录'}
          </button>
        </div>
        </>
        )}
      </div>
    </main>
  );
}

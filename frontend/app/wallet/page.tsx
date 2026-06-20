'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const yuan = (fen: number) => '¥' + (fen / 100).toFixed(2);

export default function WalletPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const w = await api.wallet();
      setBalance(w.balance);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function redeem() {
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const r = await api.rechargeByCode(code.trim());
      setBalance(r.balance);
      setMsg('充值成功,当前余额 ' + yuan(r.balance));
      setCode('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function wechatPay() {
    setErr('');
    setMsg('');
    const fen = Math.round(parseFloat(amount) * 100);
    if (!fen || fen <= 0) {
      setErr('请输入有效金额');
      return;
    }
    setBusy(true);
    try {
      const r = await api.prepay(fen);
      setMsg('微信预单已创建(单号 ' + r.outTradeNo + '),请在微信完成支付后自动到账。');
      setAmount('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <a href="/" className="text-sm text-ink/50 hover:text-ink">
        ← 返回工作台
      </a>
      <h1 className="mb-6 mt-1 text-3xl font-semibold tracking-tight text-ink">我的钱包</h1>

      <div className="mb-6 rounded-2xl bg-gradient-to-br from-steel to-ink p-7 text-white shadow-lg shadow-steel/20">
        <p className="text-sm text-white/70">当前余额</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          {balance === null ? '...' : yuan(balance)}
        </p>
      </div>

      {msg && <p className="mb-4 rounded-lg bg-sky/10 px-4 py-3 text-sm text-sky">{msg}</p>}
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      <section className="mb-5 rounded-2xl bg-white p-6 ring-1 ring-ink/5">
        <h2 className="mb-3 font-semibold text-ink">充值码充值</h2>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入 16 位充值码"
            className="w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
          />
          <button
            onClick={redeem}
            disabled={busy || !code}
            className="whitespace-nowrap rounded-lg bg-steel px-5 font-medium text-white hover:bg-ink disabled:opacity-50"
          >
            充值
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-ink/5">
        <h2 className="mb-3 font-semibold text-ink">微信充值</h2>
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="充值金额(元)"
            inputMode="decimal"
            className="w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20"
          />
          <button
            onClick={wechatPay}
            disabled={busy || !amount}
            className="whitespace-nowrap rounded-lg border border-sky/40 px-5 font-medium text-sky hover:bg-sky/5 disabled:opacity-50"
          >
            微信支付
          </button>
        </div>
      </section>
    </main>
  );
}
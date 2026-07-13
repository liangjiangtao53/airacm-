import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.LOAD_BASE_URL || 'http://127.0.0.1:8770').replace(/\/$/, '');
const accountFile = process.env.LOAD_ACCOUNTS_FILE || 'load-accounts.json';
const concurrency = Math.max(1, Number(process.env.LOAD_CONCURRENCY) || 200);
const category = process.env.LOAD_CATEGORY || 'M3 飞机结构和系统';
const p95LimitMs = Math.max(1, Number(process.env.LOAD_P95_LIMIT_MS) || 3000);
const maxLimitMs = Math.max(p95LimitMs, Number(process.env.LOAD_MAX_LIMIT_MS) || 5000);

if (process.env.ALLOW_LOAD_TEST !== 'true') {
  throw new Error('设置 ALLOW_LOAD_TEST=true 后才能执行负载测试');
}
if (/weixiuzhiyi\.com\.cn/i.test(baseUrl)) {
  throw new Error('负载测试禁止指向生产域名');
}

const metrics = new Map();

function record(route, elapsed, ok) {
  const row = metrics.get(route) || { times: [], errors: 0 };
  row.times.push(elapsed);
  if (!ok) row.errors++;
  metrics.set(route, row);
}

async function request(route, path, options = {}) {
  const started = performance.now();
  let ok = false;
  try {
    const response = await fetch(`${baseUrl}${path}`, options);
    const body = await response.json();
    ok = response.ok && body?.success !== false;
    if (!ok) throw new Error(body?.error || `${response.status} request failed`);
    return body.data;
  } finally {
    record(route, performance.now() - started, ok);
  }
}

async function login(account) {
  if (account.token) return account.token;
  const path = account.key ? '/auth/key-login' : '/auth/login';
  const data = account.key ? { key: account.key } : { phone: account.phone, password: account.password };
  const result = await request('login', path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (result.needProfile) throw new Error('负载测试账号必须预先补全资料');
  return result.token;
}

async function runUser(account) {
  const token = await login(account);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const paper = await request('exam_start', '/exams/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ category }),
  });
  const answers = {};
  for (let index = 0; index < Math.min(3, paper.questions.length); index++) {
    answers[paper.questions[index].id] = paper.questions[index].options[0]?.key || '';
    await request('exam_draft', `/exams/${paper.attemptId}/draft`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ version: index + 1, currentQuestionIndex: index, answers }),
    });
  }
  await request('study_page', `/questions?usage=study&category=${encodeURIComponent(category)}&page=1&pageSize=20`, {
    headers,
  });
  await request('exam_submit', `/exams/${paper.attemptId}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ answers }),
  });
}

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

const accounts = JSON.parse(await readFile(accountFile, 'utf8'));
if (!Array.isArray(accounts) || accounts.length < concurrency) {
  throw new Error(`需要至少 ${concurrency} 个不同测试账号`);
}

const started = performance.now();
const results = await Promise.allSettled(accounts.slice(0, concurrency).map(runUser));
const elapsedSec = (performance.now() - started) / 1000;
for (const [route, row] of metrics) {
  const sorted = row.times.sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const max = sorted.at(-1) || 0;
  console.log(
    `${route}: requests=${sorted.length} errors=${row.errors} p50=${percentile(sorted, 0.5).toFixed(0)}ms ` +
      `p95=${p95.toFixed(0)}ms p99=${percentile(sorted, 0.99).toFixed(0)}ms ` +
      `max=${max.toFixed(0)}ms throughput=${(sorted.length / elapsedSec).toFixed(1)}/s`,
  );
  if (p95 > p95LimitMs || max > maxLimitMs) process.exitCode = 1;
}
const failed = results.filter((result) => result.status === 'rejected');
console.log(`users=${results.length} failed=${failed.length} elapsed=${elapsedSec.toFixed(1)}s`);
if (failed.length / results.length >= 0.01) process.exitCode = 1;

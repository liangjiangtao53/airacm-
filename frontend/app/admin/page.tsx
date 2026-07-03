'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  getToken,
  type AdminUser,
  type AppApkStatus,
  type ExamPaperRule,
  type ForumTopic,
  type ImportPreview,
  type ImportResult,
  type ManagedQuestionCategory,
  type QuestionUsage,
  type UserRole,
} from '@/lib/api';

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/60 backdrop-blur-xl p-6 shadow-sm ring-1 ring-white/55">
      <h2 className="mb-4 font-semibold text-ink">{props.title}</h2>
      {props.children}
    </section>
  );
}

const input =
  'w-full rounded-lg border border-ink/15 px-3 py-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/20';
const btn =
  'rounded-lg bg-steel px-5 py-2 font-medium text-white hover:bg-ink disabled:opacity-50';
const logoUrl = '/images/maintenance-wing-logo.jpg';
const defaultExamCategoryCounts: Record<string, number> = {
  'M1 航空概论': 32,
  'M2 航空器维修': 50,
  'M3 飞机结构和系统': 182,
  'M5 航空涡轮发动机': 70,
  'M9 航空英语': 60,
  'M9 new': 60,
};
type AccessKeyRow = { id: string; key: string; status: string; expiresAt: string; createdAt: string };
type AdminSheet = 'operations' | 'questions' | 'users' | 'security';
const sheets: Array<{ key: AdminSheet; label: string }> = [
  { key: 'questions', label: '学习资料' },
  { key: 'operations', label: '运营配置' },
  { key: 'users', label: '用户社区' },
  { key: 'security', label: '账号安全' },
];

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [activeSheet, setActiveSheet] = useState<AdminSheet>('questions');

  // 发码(仅 super)
  const [count, setCount] = useState('5');
  const [codeAmount, setCodeAmount] = useState('100');
  const [codes, setCodes] = useState<string[]>([]);

  // 手动充值(仅 super)
  const [userId, setUserId] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [rechargeMsg, setRechargeMsg] = useState('');

  // 建课程链(仅 super)
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [createdCourseId, setCreatedCourseId] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [createdChapterId, setCreatedChapterId] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [contentMsg, setContentMsg] = useState('');

  // 题库 Excel/PDF 导入
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUsage, setImportUsage] = useState<QuestionUsage>('both');
  const [importCategory, setImportCategory] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [managedCategories, setManagedCategories] = useState<ManagedQuestionCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');

  // App 安装包上传(admin + super)
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [apkStatus, setApkStatus] = useState<AppApkStatus | null>(null);
  const [apkMsg, setApkMsg] = useState('');

  // 模拟考试组卷规则(admin + super)
  const [examRule, setExamRule] = useState<ExamPaperRule | null>(null);
  const [examRuleCount, setExamRuleCount] = useState('100');
  const [examRuleCategoryCounts, setExamRuleCategoryCounts] = useState<Record<string, string>>({});
  const [examRuleMsg, setExamRuleMsg] = useState('');

  // 数据维护
  const [stats, setStats] = useState<Array<{ category: string; count: number }>>([]);
  const [keys, setKeys] = useState<AccessKeyRow[]>([]);
  const [genCount, setGenCount] = useState('20');
  const [genTtl, setGenTtl] = useState('30');
  const [maintMsg, setMaintMsg] = useState('');

  // 用户管理
  const [meRole, setMeRole] = useState<UserRole>('admin');
  const [users, setUsers] = useState<AdminUser[]>([]);

  // 论坛主题管理(admin+super)
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [newTopic, setNewTopic] = useState('');

  // 新增业务管理员(仅超管)
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPwd, setAdminPwd] = useState('');
  const [adminNick, setAdminNick] = useState('');
  const [adminMsg, setAdminMsg] = useState('');

  // 当前管理员修改自己的登录密码。
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordErr, setPasswordErr] = useState('');

  const isSuper = meRole === 'super';

  useEffect(() => {
    api
      .me()
      .then((u) => {
        if (u.role !== 'admin' && u.role !== 'super') {
          router.push('/');
          return;
        }
        setMeRole(u.role);
        setReady(true);
        api.categories().then(setCategories).catch(() => undefined);
        api.managedCategories().then(setManagedCategories).catch(() => undefined);
        api.questionStats().then(setStats).catch(() => undefined);
        api.appApkStatus().then(setApkStatus).catch(() => undefined);
        api.examRule().then((r) => {
          setExamRule(r);
          setExamRuleCount(String(r.totalCount));
          const merged = { ...defaultExamCategoryCounts, ...(r.categoryCounts ?? {}) };
          setExamRuleCategoryCounts(Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])));
        }).catch(() => undefined);
        api.users().then(setUsers).catch(() => undefined);
        api.forumTopics().then(setTopics).catch(() => undefined);
        // 卡密仅 super 可见
        if (u.role === 'super') api.accessKeys().then(setKeys).catch(() => undefined);
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

  const refreshStats = async () => setStats(await api.questionStats());
  const refreshCategories = async () => {
    const [names, managed] = await Promise.all([api.categories(), api.managedCategories()]);
    setCategories(names);
    setManagedCategories(managed);
  };

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

  const doImport = wrap(async () => {
    if (!importFile) throw new Error('请先选择 Excel 或 PDF 文件');
    setImportResult(null);
    setImportPreview(null);
    const r = await api.importQuestions(
      importFile,
      importUsage,
      importCategory || undefined,
    );
    setImportResult(r);
    await refreshStats();
    await refreshCategories();
  });

  const previewImport = wrap(async () => {
    if (!importFile) throw new Error('请先选择 Excel 或 PDF 文件');
    setImportResult(null);
    setImportPreview(await api.previewImportQuestions(importFile, importUsage, importCategory || undefined));
  });

  const addQuestionCategory = wrap(async () => {
    await api.createQuestionCategory(newCategory.trim());
    setNewCategory('');
    await refreshCategories();
  });

  const renameQuestionCategory = (category: ManagedQuestionCategory) =>
    wrap(async () => {
      const next = window.prompt('请输入新的类别名称', category.name)?.trim();
      if (!next || next === category.name) return;
      await api.renameQuestionCategory(category.id, next);
      if (importCategory === category.name) setImportCategory(next);
      await refreshCategories();
      await refreshStats();
    })();

  const deleteQuestionCategory = (category: ManagedQuestionCategory) =>
    wrap(async () => {
      if (category.count > 0) {
        throw new Error('该类别下还有题目，请先在“题库(按科目)”里删除题目');
      }
      if (!window.confirm(`确认删除类别「${category.name}」？`)) return;
      await api.deleteQuestionCategory(category.id);
      if (importCategory === category.name) setImportCategory('');
      await refreshCategories();
    })();

  function inferImportCategory(file: File): string {
    const name = file.name.toLowerCase();
    if (name.includes('r3m1')) return 'M1 航空概论';
    if (name.includes('3257')) return 'M9 航空英语';
    if (name.includes('民用航空器维修人员执照英语参考试题m9')) return 'M9 new';
    return '';
  }

  function chooseImportFile(file: File | null) {
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    if (!file) return;
    const inferred = inferImportCategory(file);
    if (inferred) setImportCategory(inferred);
  }

  const uploadApk = wrap(async () => {
    if (!apkFile) throw new Error('请先选择 APK 文件');
    if (!apkFile.name.toLowerCase().endsWith('.apk')) throw new Error('只支持上传 .apk 安装包');
    setApkMsg('');
    const status = await api.uploadAppApk(apkFile);
    setApkStatus(status);
    setApkFile(null);
    setApkMsg('App 安装包已上传');
  });

  const saveExamRule = wrap(async () => {
    const totalCount = Number(examRuleCount);
    if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > 300) {
      throw new Error('模拟考试题目数必须是 1-300 的整数');
    }
    const categoryCounts: Record<string, number> = {};
    for (const category of Array.from(new Set([...categories, ...Object.keys(examRuleCategoryCounts)]))) {
      const value = Number(examRuleCategoryCounts[category] ?? defaultExamCategoryCounts[category] ?? examRule?.totalCount ?? totalCount);
      if (!Number.isInteger(value) || value < 1 || value > 300) {
        throw new Error(`${category} 的题目数必须是 1-300 的整数`);
      }
      categoryCounts[category] = value;
    }
    const saved = await api.updateExamRule(totalCount, categoryCounts);
    setExamRule(saved);
    setExamRuleCount(String(saved.totalCount));
    setExamRuleCategoryCounts(Object.fromEntries(Object.entries(saved.categoryCounts).map(([k, v]) => [k, String(v)])));
    setExamRuleMsg('模拟考试组卷规则已保存');
  });

  // 模板下载:端点需鉴权,普通 <a> 不带 token,改为带鉴权头取 blob 下载。
  const downloadTemplate = wrap(async () => {
    const res = await fetch(api.questionTemplateUrl(), {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
    });
    if (!res.ok) throw new Error('模板下载失败');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'question-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  });

  const purgeCategory = (category: string) =>
    wrap(async () => {
      const label = category || '(未分类)';
      if (!window.confirm(`确认删除「${label}」科目下全部题目?此操作不可恢复。`)) return;
      const impact = await api.questionDeleteImpact(category);
      const input = window.prompt(
        `${label}: 将删除 ${impact.questionCount} 题、${impact.commentCount} 条评论。输入 ${impact.requiredConfirm} 确认删除。`,
      );
      if (input !== impact.requiredConfirm) return;
      const r = await api.purgeQuestions(category, impact.requiredConfirm);
      setMaintMsg(`已删除 ${label} 下 ${r.deleted} 题`);
      await refreshStats();
      await refreshCategories();
    })();

  const doGenKeys = wrap(async () => {
    const r = await api.generateKeys(Number(genCount) || 20, Number(genTtl) || 30);
    setMaintMsg(`已生成 ${r.keys.length} 个卡密,有效期至 ${new Date(r.expiresAt).toLocaleDateString()}`);
    setKeys(await api.accessKeys());
  });

  const genKeysWithTtl = (ttlDays: number) =>
    wrap(async () => {
      setGenTtl(String(ttlDays));
      const r = await api.generateKeys(Number(genCount) || 20, ttlDays);
      setMaintMsg(`已生成 ${r.keys.length} 个${ttlDays === 90 ? '三个月' : '一个月'}卡密,有效期至 ${new Date(r.expiresAt).toLocaleDateString()}`);
      setKeys(await api.accessKeys());
    })();

  const revokeKey = (id: string) =>
    wrap(async () => {
      await api.revokeKey(id);
      setKeys(await api.accessKeys());
    })();

  const editKeyTtl = (key: AccessKeyRow) =>
    wrap(async () => {
      const remainingDays = Math.max(1, Math.ceil((new Date(key.expiresAt).getTime() - Date.now()) / 86_400_000));
      const raw = window.prompt('请输入新的有效期天数(从现在开始计算,如 30 或 90)', String(remainingDays));
      if (!raw) return;
      const ttlDays = Number(raw);
      if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3650) {
        throw new Error('有效期天数必须是 1-3650 的整数');
      }
      const updated = await api.updateKey(key.id, ttlDays);
      setKeys(await api.accessKeys());
      setMaintMsg(`已修改卡密 ${updated.key} 的有效期至 ${new Date(updated.expiresAt).toLocaleDateString()}`);
    })();

  const cleanupKeys = wrap(async () => {
    if (!window.confirm('确认删除全部已过期/已作废的卡密?')) return;
    const r = await api.cleanupKeys();
    setMaintMsg(`已清理 ${r.deleted} 个失效卡密`);
    setKeys(await api.accessKeys());
  });

  const removeUser = (u: AdminUser) =>
    wrap(async () => {
      if (!window.confirm(`确认删除用户 ${u.phone || u.nickname}?`)) return;
      await api.deleteUser(u.id);
      setUsers((l) => l.filter((x) => x.id !== u.id));
    })();

  const addTopic = wrap(async () => {
    const name = newTopic.trim();
    if (!name) return;
    const t = await api.adminCreateTopic(name, topics.length);
    setTopics((l) => [...l, t]);
    setNewTopic('');
  });

  const renameTopic = (t: ForumTopic) =>
    wrap(async () => {
      const name = window.prompt('修改主题名', t.name)?.trim();
      if (!name || name === t.name) return;
      const updated = await api.adminUpdateTopic(t.id, { name });
      setTopics((l) => l.map((x) => (x.id === t.id ? updated : x)));
    })();

  const removeTopic = (t: ForumTopic) =>
    wrap(async () => {
      if (!window.confirm(`确认删除主题「${t.name}」?(该主题下有帖子则无法删除)`)) return;
      await api.adminDeleteTopic(t.id);
      setTopics((l) => l.filter((x) => x.id !== t.id));
    })();

  const createAdmin = wrap(async () => {
    setAdminMsg('');
    const created = await api.adminCreateAdmin(adminPhone.trim(), adminPwd, adminNick.trim());
    setUsers((l) => [
      { id: created.id, phone: created.phone, nickname: created.nickname, role: created.role, source: 'register', createdAt: new Date().toISOString() },
      ...l,
    ]);
    setAdminMsg(`已添加业务管理员 ${created.nickname}(${created.phone})`);
    setAdminPhone('');
    setAdminPwd('');
    setAdminNick('');
  });

  async function changeMyPassword() {
    setErr('');
    setPasswordMsg('');
    setPasswordErr('');
    try {
      if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致');
      await api.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg('密码已修改,下次登录请使用新密码');
    } catch (e) {
      setPasswordErr((e as Error).message);
    }
  }

  const roleLabel = (r: UserRole) =>
    r === 'super' ? '超级管理员' : r === 'admin' ? '业务管理员' : '学员';

  const sourceLabel = (s?: AdminUser['source']) =>
    s === 'key' ? '卡密' : s === 'wechat' ? '微信' : s === 'register' ? '注册' : '';

  const examRuleCategories = Array.from(
    new Set([...Object.keys(defaultExamCategoryCounts), ...categories, ...Object.keys(examRuleCategoryCounts)]),
  );

  if (!ready) {
    return <main className="flex min-h-screen items-center justify-center text-ink/50">校验权限...</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a href="/" className="text-sm font-bold text-ink hover:text-sky">
        ← 返回工作台
      </a>
      <div className="mb-6 mt-2 flex items-center gap-3">
        <img
          src={logoUrl}
          alt="维修翼站 logo"
          className="h-12 w-12 rounded-xl object-cover shadow-sm"
        />
        <h1 className="text-3xl font-semibold tracking-tight text-ink">管理后台</h1>
      </div>
      {err && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</p>}

      <nav className="mb-5 flex gap-2 overflow-x-auto rounded-xl bg-white/55 p-2 ring-1 ring-white/60">
        {sheets.map((sheet) => (
          <button
            key={sheet.key}
            onClick={() => setActiveSheet(sheet.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeSheet === sheet.key
                ? 'bg-steel text-white'
                : 'text-ink/60 hover:bg-mist hover:text-ink'
            }`}
          >
            {sheet.label}
          </button>
        ))}
      </nav>

      <div className="space-y-5">
        {activeSheet === 'operations' && (
          <>
        {/* 充值码 / 手动充值 / 建课程:仅超级管理员 */}
        {isSuper && (
          <Card title="生成充值码">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <label className="mb-1 block text-xs text-ink/60">数量</label>
                <input className={input} value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
              <div className="w-36">
                <label className="mb-1 block text-xs text-ink/60">面额(元)</label>
                <input className={input} value={codeAmount} onChange={(e) => setCodeAmount(e.target.value)} />
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
        )}

        {isSuper && (
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
        )}

        {isSuper && (
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
        )}

        <Card title="模拟考试组卷规则">
          <div className="space-y-3">
            <div className="rounded-lg bg-mist p-3 text-sm text-ink/70">
              默认规则:未选择科目时每次模拟考试{' '}
              <span className="font-semibold text-ink">{examRule?.totalCount ?? 100}</span> 道题。
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36">
                <label className="mb-1 block text-xs text-ink/60">默认题目数</label>
                <input
                  className={input}
                  value={examRuleCount}
                  inputMode="numeric"
                  onChange={(e) => setExamRuleCount(e.target.value)}
                />
              </div>
              <button className={btn} onClick={saveExamRule}>
                保存规则
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {examRuleCategories.map((category) => (
                <label key={category} className="block">
                  <span className="mb-1 block text-xs text-ink/60">{category}</span>
                  <input
                    className={input}
                    value={examRuleCategoryCounts[category] ?? String(defaultExamCategoryCounts[category] ?? examRule?.totalCount ?? 100)}
                    inputMode="numeric"
                    onChange={(e) =>
                      setExamRuleCategoryCounts((prev) => ({
                        ...prev,
                        [category]: e.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-ink/45">按科目开始考试时使用对应题数;没有科目配置时使用默认题数。</p>
            {examRuleMsg && <p className="text-sm text-sky">{examRuleMsg}</p>}
          </div>
        </Card>

        {/* App 安装包:admin + super */}
        <Card title="App 安装包">
          <div className="space-y-3">
            <div className="rounded-lg bg-mist p-3 text-sm text-ink/70">
              <p>
                当前状态:{' '}
                <span className={apkStatus?.exists ? 'font-semibold text-sky' : 'font-semibold text-ink/45'}>
                  {apkStatus?.exists ? '已上传' : '未上传'}
                </span>
              </p>
              {apkStatus?.exists && (
                <p className="mt-1">
                  文件大小 {(apkStatus.size / 1024 / 1024).toFixed(2)} MB
                  {apkStatus.updatedAt ? ` · 更新时间 ${new Date(apkStatus.updatedAt).toLocaleString()}` : ''}
                </p>
              )}
              <p className="mt-1">
                下载地址 <span className="font-medium text-ink">/downloads/app/airacm-android.apk</span>
              </p>
            </div>
            <input
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-steel file:px-4 file:py-2 file:text-white"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button className={btn} onClick={uploadApk} disabled={!apkFile}>
                上传安装包
              </button>
              <a href="/download-app" className="text-sm text-sky hover:underline">
                查看下载页
              </a>
            </div>
            {apkMsg && <p className="text-sm text-sky">{apkMsg}</p>}
          </div>
        </Card>
          </>
        )}

        {activeSheet === 'questions' && (
          <>
        {/* 导入题库:admin + super */}
        <Card title="导入题库(Excel/PDF)">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-ink/60">科目</label>
                <select
                  className={input + ' w-44'}
                  value={importCategory}
                  onChange={(e) => setImportCategory(e.target.value)}
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink/60">归属</label>
                <select
                  className={input + ' w-36'}
                  value={importUsage}
                  onChange={(e) => setImportUsage(e.target.value as QuestionUsage)}
                >
                  <option value="both">考试+学习</option>
                  <option value="exam">仅考试</option>
                </select>
              </div>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls,.pdf"
              onChange={(e) => chooseImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink/70 file:mr-3 file:rounded-lg file:border-0 file:bg-steel file:px-4 file:py-2 file:text-white"
            />
            <div className="flex items-center gap-3">
              <button className={btn} onClick={previewImport}>
                预览
              </button>
              <button className={btn} onClick={doImport}>
                导入
              </button>
              <button onClick={downloadTemplate} className="text-sm text-sky hover:underline">
                下载导入模板
              </button>
            </div>
            {importPreview && (
              <div className="rounded-lg bg-mist p-3 text-sm text-ink">
                <p>
                  预览: 可导入 {importPreview.importable}/{importPreview.totalRows} 行, 失败 {importPreview.failed.length} 行,
                  文件内重复 {importPreview.duplicateInFile} 个, 库内已存在 {importPreview.duplicateInDatabase} 个
                </p>
                {importPreview.failed.length > 0 && (
                  <ul className="mt-2 space-y-1 text-red-500/90">
                    {importPreview.failed.map((f) => (
                      <li key={f.row}>
                        第 {f.row} 行: {f.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {importResult && (
              <div className="rounded-lg bg-mist p-3 text-sm">
                <p className="text-ink">
                  成功导入 <span className="font-semibold text-sky">{importResult.imported}</span> 题
                  {importResult.failed.length > 0 && (
                    <span className="text-red-500">,失败 {importResult.failed.length} 行</span>
                  )}
                </p>
                {importResult.failed.length > 0 && (
                  <ul className="mt-2 space-y-1 text-red-500/90">
                    {importResult.failed.map((f) => (
                      <li key={f.row}>
                        第 {f.row} 行:{f.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* 数据维护:题库(admin+super) + 卡密(仅 super) */}
        <Card title="数据维护">
          <div className="space-y-5">
            {maintMsg && <p className="rounded-lg bg-sky/10 px-3 py-2 text-sm text-sky">{maintMsg}</p>}

            <div>
              <h3 className="mb-2 text-sm font-medium text-ink/80">类别管理</h3>
              <div className="mb-3 flex gap-3">
                <input
                  className={input}
                  placeholder="新增类别名称"
                  value={newCategory}
                  maxLength={50}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
                <button className={btn + ' whitespace-nowrap'} onClick={addQuestionCategory} disabled={!newCategory.trim()}>
                  新增
                </button>
              </div>
              {managedCategories.length === 0 ? (
                <p className="text-sm text-ink/40">暂无类别</p>
              ) : (
                <ul className="space-y-1">
                  {managedCategories.map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded-lg bg-mist px-3 py-2 text-sm">
                      <span className="text-ink/75">
                        {c.name} · {c.count} 题
                      </span>
                      <span className="flex items-center gap-3">
                        <button onClick={() => renameQuestionCategory(c)} className="text-xs font-medium text-sky hover:underline">
                          改名
                        </button>
                        <button
                          onClick={() => deleteQuestionCategory(c)}
                          className="text-xs text-red-500 hover:underline disabled:text-ink/30 disabled:no-underline"
                          disabled={c.count > 0}
                          title={c.count > 0 ? '该类别下还有题目，请先删除题目' : undefined}
                        >
                          删除
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-ink/80">题库(按科目)</h3>
              {stats.length === 0 ? (
                <p className="text-sm text-ink/40">暂无题目</p>
              ) : (
                <ul className="space-y-1">
                  {stats.map((s) => {
                    const realCat = s.category === '(未分类)' ? '' : s.category;
                    return (
                      <li key={s.category} className="rounded-lg bg-mist">
                        <div className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className="text-ink/75">
                            {s.category} · {s.count} 题
                          </span>
                          <span className="flex items-center gap-3">
                            <a
                              href={`/admin/questions?category=${encodeURIComponent(realCat)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-sky hover:underline"
                            >
                              打开
                            </a>
                            <button
                              onClick={() => purgeCategory(realCat)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              删除该科目
                            </button>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {isSuper && (
              <div className="border-t border-ink/5 pt-4">
                <h3 className="mb-2 text-sm font-medium text-ink/80">认证卡密</h3>
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <div className="w-24">
                    <label className="mb-1 block text-xs text-ink/60">数量</label>
                    <input className={input} value={genCount} onChange={(e) => setGenCount(e.target.value)} />
                  </div>
                  <div className="w-28">
                    <label className="mb-1 block text-xs text-ink/60">有效期(天)</label>
                    <input className={input} value={genTtl} onChange={(e) => setGenTtl(e.target.value)} />
                  </div>
                  <button className={btn} onClick={doGenKeys}>
                    生成卡密
                  </button>
                  <button className={btn} onClick={() => genKeysWithTtl(30)}>
                    生成一个月
                  </button>
                  <button className={btn} onClick={() => genKeysWithTtl(90)}>
                    生成三个月
                  </button>
                  <button onClick={cleanupKeys} className="text-sm text-red-500 hover:underline">
                    清理过期/作废
                  </button>
                </div>

                <p className="mb-1 text-xs text-ink/50">卡密列表 {keys.length} 个(最多显示 500)</p>
                <div className="max-h-72 overflow-auto rounded-lg bg-mist">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-mist text-ink/45">
                      <tr>
                        <th className="px-3 py-2 font-medium">卡密</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 font-medium">有效期</th>
                        <th className="px-3 py-2 font-medium">已使用天数</th>
                        <th className="px-3 py-2 font-medium">剩余天数</th>
                        <th className="px-3 py-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/70">
                      {keys.map((k) => {
                        const createdMs = new Date(k.createdAt).getTime();
                        const expiresMs = new Date(k.expiresAt).getTime();
                        const now = Date.now();
                        // 三个天数字段必须口径一致:刚生成 30 天卡密应显示 30/0/30,而不是因毫秒取整变成 31/0/30。
                        const remainingDays = Math.max(0, Math.ceil((expiresMs - now) / 86_400_000));
                        const usedDays = Math.max(0, Math.floor((Math.min(now, expiresMs) - createdMs) / 86_400_000));
                        const validDays = usedDays + remainingDays;
                        const expired = expiresMs < now;
                        const dead = k.status === 'revoked' || expired;
                        return (
                          <tr key={k.id} className={dead ? 'text-ink/35' : 'text-ink/75'}>
                            <td className={`px-3 py-2 font-mono ${dead ? 'line-through' : ''}`}>{k.key}</td>
                            <td className="px-3 py-2">
                              {k.status === 'revoked' ? '已作废' : expired ? '已过期' : '有效'}
                            </td>
                            <td className="px-3 py-2">{validDays} 天</td>
                            <td className="px-3 py-2">{usedDays} 天</td>
                            <td className="px-3 py-2">{remainingDays} 天</td>
                            <td className="px-3 py-2 text-right">
                              {!dead && (
                                <span className="inline-flex items-center gap-2">
                                  <button onClick={() => editKeyTtl(k)} className="text-sky hover:underline">
                                    改有效期
                                  </button>
                                  <button onClick={() => revokeKey(k.id)} className="text-red-500 hover:underline">
                                    作废
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Card>
          </>
        )}

        {activeSheet === 'users' && (
          <>
        {/* 新增业务管理员:仅超管 */}
        {isSuper && (
          <Card title="添加业务管理员">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <input
                  className={input + ' flex-1'}
                  placeholder="手机号"
                  inputMode="numeric"
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                />
                <input
                  className={input + ' flex-1'}
                  placeholder="昵称"
                  value={adminNick}
                  onChange={(e) => setAdminNick(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <input
                  className={input}
                  type="password"
                  placeholder="登录密码(至少 10 位,含大小写/数字/符号)"
                  value={adminPwd}
                  onChange={(e) => setAdminPwd(e.target.value)}
                />
                <button
                  className={btn + ' whitespace-nowrap'}
                  onClick={createAdmin}
                  disabled={!adminPhone.trim() || adminPwd.length < 10 || !adminNick.trim()}
                >
                  添加
                </button>
              </div>
              {adminMsg && <p className="rounded-lg bg-sky/10 px-3 py-2 text-sm text-sky">{adminMsg}</p>}
            </div>
          </Card>
        )}

        {/* 论坛主题管理:admin + super */}
        <Card title="论坛主题">
          <div className="space-y-3">
            <div className="flex gap-3">
              <input
                className={input}
                placeholder="新主题名(如:技术答疑)"
                value={newTopic}
                maxLength={30}
                onChange={(e) => setNewTopic(e.target.value)}
              />
              <button className={btn} onClick={addTopic} disabled={!newTopic.trim()}>
                新建
              </button>
            </div>
            {topics.length === 0 ? (
              <p className="text-sm text-ink/40">暂无主题</p>
            ) : (
              <ul className="space-y-1">
                {topics.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-lg bg-mist px-3 py-2 text-sm"
                  >
                    <span className="text-ink/80">{t.name}</span>
                    <span className="flex items-center gap-3">
                      <button onClick={() => renameTopic(t)} className="text-xs text-sky hover:underline">
                        改名
                      </button>
                      <button onClick={() => removeTopic(t)} className="text-xs text-red-500 hover:underline">
                        删除
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* 用户管理:admin + super */}
        <Card title={isSuper ? '用户管理(超管:可见全部)' : '用户管理(仅普通学员)'}>
          {users.length === 0 ? (
            <p className="text-sm text-ink/40">暂无用户</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between rounded-lg bg-mist px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-ink/80">{u.phone || u.nickname || '(无)'}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        u.role === 'super'
                          ? 'bg-red-50 text-red-500'
                          : u.role === 'admin'
                            ? 'bg-sky/10 text-sky'
                            : 'bg-ink/5 text-ink/50'
                      }`}
                    >
                      {roleLabel(u.role)}
                    </span>
                    {u.role === 'user' && u.source && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">
                        {sourceLabel(u.source)}
                      </span>
                    )}
                  </span>
                  {u.role !== 'super' && (
                    <button onClick={() => removeUser(u)} className="text-xs text-red-500 hover:underline">
                      删除
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
          </>
        )}

        {activeSheet === 'security' && (
          <>
        <Card title="修改密码">
          <div className="space-y-3">
            <input
              className={input}
              type="password"
              placeholder="原密码"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder="新密码(至少 10 位,含大小写/数字/符号)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className={input}
              type="password"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button
              className={btn}
              onClick={changeMyPassword}
              disabled={!oldPassword || newPassword.length < 10 || !confirmPassword}
            >
              修改密码
            </button>
            {passwordErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{passwordErr}</p>}
            {passwordMsg && <p className="rounded-lg bg-sky/10 px-3 py-2 text-sm text-sky">{passwordMsg}</p>}
          </div>
        </Card>
          </>
        )}
      </div>
    </main>
  );
}

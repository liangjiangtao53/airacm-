// 后端 API 客户端:统一处理 JWT、响应信封 {success,data,error} 解包与错误抛出。
// 所有页面经此对接后端,集中一处便于改 baseURL / 鉴权策略。

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8770';
const TOKEN_KEY = 'airacm_token';

export function assetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export type LessonType = 'video' | 'text';
export type LessonAccess = 'free' | 'paid' | 'vip' | 'password';
export type QuestionUsage = 'study' | 'exam' | 'both';
export type WrongQuestionSource = 'study' | 'exam';

export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  access: LessonAccess;
  order: number;
  duration: number;
  locked?: boolean;
}

export interface Course {
  id: string;
  title: string;
  summary: string;
  price: number;
  originalPrice: number;
  chapterCount: number;
  lessonCount: number;
}

export interface QuestionOption {
  key: string;
  text: string;
}

// 学习列表项:后端默认不下发 answer/analysis/imageUrls。
export interface QuestionItem {
  id: string;
  courseId: string | null;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls?: string[];
  usage: QuestionUsage;
  order: number;
}

export interface CommentItem {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
}

export interface ImportResult {
  imported: number;
  failed: Array<{ row: number; reason: string }>;
  batchId?: string;
}

export interface ImportPreview {
  totalRows: number;
  importable: number;
  failed: Array<{ row: number; reason: string }>;
  duplicateInFile: number;
  duplicateInDatabase: number;
}

export interface DeleteImpact {
  category: string;
  questionCount: number;
  commentCount: number;
  requiredConfirm: string;
}

export interface AppApkStatus {
  url: string;
  path: string;
  exists: boolean;
  size: number;
  updatedAt: string | null;
}

// 管理端题目项(含答案,仅管理后台数据维护用)。
export interface AdminQuestionItem {
  id: string;
  category: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls?: string[];
  answer: string;
  analysis: string;
  usage: QuestionUsage;
}

export type AdminQuestionPatch = Partial<
  Pick<AdminQuestionItem, 'category' | 'type' | 'stem' | 'options' | 'answer' | 'analysis' | 'usage'>
>;

export type UserRole = 'user' | 'admin' | 'super';

export interface Me {
  userId: string;
  tenantId: string;
  role: UserRole;
  nickname: string;
}

export interface AdminUser {
  id: string;
  phone: string;
  nickname: string;
  role: UserRole;
  source?: 'key' | 'wechat' | 'register'; // 来源:卡密/微信/手机号注册
  createdAt: string;
}

export interface AdminOperationLogItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  admin: { id: string; phone: string; nickname: string; role: UserRole } | null;
}

export interface UserActivityLogItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; phone: string; nickname: string; role: UserRole } | null;
  accessKey: { id: string; key: string; status: string } | null;
}

export interface AccessKeyItem {
  id: string;
  key: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
}

export interface ManagedQuestionCategory {
  id: string;
  name: string;
  count: number;
}

export interface ExamPaperRule {
  totalCount: number;
  categoryCounts: Record<string, number>;
}

// 考试卷面题目(不含答案)。
export interface PaperQuestion {
  id: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls?: string[];
}

export interface ExamStart {
  attemptId: string;
  total: number;
  questions: PaperQuestion[];
}

export interface GradedItem {
  questionId: string;
  category: string;
  stem: string;
  options: QuestionOption[];
  imageUrls?: string[];
  yourAnswer: string;
  correctAnswer: string;
  analysis: string;
  isCorrect: boolean;
}

export interface ExamResult {
  score: number;
  correct: number;
  total: number;
  details: GradedItem[];
}

export interface ExamAttemptSummary {
  id: string;
  courseId: string | null;
  category: string;
  total: number;
  correct: number;
  score: number;
  submittedAt: string | null;
}

// 错题本条目(含答案/解析,供复习)。
export interface WrongBookItem {
  questionId: string;
  category: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  imageUrls?: string[];
  answer: string;
  analysis: string;
  wrongCount: number;
  source: WrongQuestionSource;
  lastWrongAt: string;
}

// 论坛主题/版块。
export interface ForumTopic {
  id: string;
  name: string;
  order: number;
}

// 交流帖子(列表项带回复数 + 作者昵称 + 归属主题)。
export interface PostItem {
  id: string;
  topicId: string | null;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
  replyCount: number;
}

export interface PostReplyItem {
  id: string;
  postId: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

async function req<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return unwrap<T>(res);
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: Envelope<T> | null = null;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    // 非 JSON(如网关错误):带状态码抛出,页面可据此判断。
  }
  if (!res.ok || !env || env.success === false) {
    // 单点登录被踢 / token 失效:清本地 token,下次进入受保护页会跳登录。
    if (res.status === 401) clearToken();
    const msg = env?.error || `${res.status} 请求失败`;
    throw new Error(msg);
  }
  return env.data as T;
}

// multipart 上传(题库导入):不走 req 的 JSON 分支。
async function upload<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: fd });
  return unwrap<T>(res);
}

export const api = {
  base: BASE,

  // ---- 认证 ----
  sendCode: (phone: string) =>
    req<{ sent: true }>('/auth/send-code', { method: 'POST', body: { phone }, auth: false }),
  register: (phone: string, code: string, password: string, nickname?: string) =>
    req<{ token: string; userId: string }>('/auth/register', {
      method: 'POST',
      body: { phone, code, password, nickname },
      auth: false,
    }),
  login: (phone: string, password: string) =>
    req<{ token: string; userId: string }>('/auth/login', {
      method: 'POST',
      body: { phone, password },
      auth: false,
    }),
  // 卡密登录:凭 key 换 token。needProfile=true 表示首次登录,需补全手机号/昵称。
  keyLogin: (key: string) =>
    req<{ token: string; userId: string; expiresAt: string; needProfile: boolean }>('/auth/key-login', {
      method: 'POST',
      body: { key },
      auth: false,
    }),
  // 卡密用户补全资料(携带 keyLogin 返回的 pending token)。成功返回正式 token。
  completeProfile: (phone: string, nickname: string) =>
    req<{ token: string; userId: string }>('/auth/complete-profile', {
      method: 'POST',
      body: { phone, nickname },
    }),
  me: () => req<Me>('/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    req<{ ok: true }>('/auth/password', { method: 'POST', body: { oldPassword, newPassword } }),

  // ---- 课程 / 学习 ----
  courses: () => req<Course[]>('/courses'),
  course: (id: string) => req<{ course: Course; owned: boolean; chapters: unknown[] }>(`/courses/${id}`),
  lesson: (id: string) => req<Lesson & { playUrl?: string; content?: string }>(`/lessons/${id}`),
  upsertProgress: (lessonId: string, position: number, status: 'in_progress' | 'done') =>
    req<{ ok: boolean }>('/progress', { method: 'POST', body: { lessonId, position, status } }),

  // ---- 题库刷题 / 评论 ----
  // 科目列表(后端固定枚举)。
  categories: () => req<string[]>('/questions/categories'),

  questions: (params: { usage?: QuestionUsage; category?: string; courseId?: string; keyword?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)));
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: QuestionItem[]; total: number; page: number; pageSize: number }>(`/questions${suffix}`);
  },
  questionAnswer: (id: string) => req<{ answer: string; analysis: string; imageUrls?: string[] }>(`/questions/${id}/answer`),

  // ---- 考试 ----
  startExam: (courseId?: string, category?: string) =>
    req<ExamStart>('/exams/start', { method: 'POST', body: { courseId, category } }),
  submitExam: (attemptId: string, answers: Record<string, string>) =>
    req<ExamResult>(`/exams/${attemptId}/submit`, { method: 'POST', body: { answers } }),
  examHistory: () => req<ExamAttemptSummary[]>('/exams/history'),
  examReview: (attemptId: string) =>
    req<ExamResult & { submittedAt: string | null }>(`/exams/${attemptId}/review`),
  deleteExamAttempt: (attemptId: string) =>
    req<{ deleted: boolean }>(`/exams/${attemptId}`, { method: 'DELETE' }),
  wrongBook: () => req<WrongBookItem[]>('/exams/wrong-book'),
  recordStudyWrong: (questionId: string, answer: string) =>
    req<{ ok: true; recorded: boolean }>('/exams/wrong-book/study', { method: 'POST', body: { questionId, answer } }),
  masterWrong: (questionId: string, source: WrongQuestionSource = 'study') =>
    req<{ ok: boolean }>(`/exams/wrong-book/${questionId}/master`, { method: 'POST', body: { source } }),
  comments: (id: string) => req<CommentItem[]>(`/questions/${id}/comments`),
  addComment: (id: string, content: string) =>
    req<CommentItem>(`/questions/${id}/comments`, { method: 'POST', body: { content } }),

  // ---- 交流 ----
  // 论坛主题(任意登录用户可见)。
  forumTopics: () => req<ForumTopic[]>('/forum/topics', { auth: false }),
  posts: (params: { topicId?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.topicId) qs.set('topicId', params.topicId);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: PostItem[]; total: number; page: number; pageSize: number }>(`/posts${suffix}`, {
      auth: false,
    });
  },
  createPost: (content: string, topicId: string) =>
    req<PostItem>('/posts', { method: 'POST', body: { content, topicId } }),
  postReplies: (id: string) => req<PostReplyItem[]>(`/posts/${id}/replies`),
  addPostReply: (id: string, content: string) =>
    req<PostReplyItem>(`/posts/${id}/replies`, { method: 'POST', body: { content } }),
  deletePostReply: (id: string) => req<{ deleted: boolean }>(`/posts/replies/${id}`, { method: 'DELETE' }),
  togglePostReplyLike: (id: string) =>
    req<{ liked: boolean; likeCount: number }>(`/posts/replies/${id}/like`, { method: 'POST' }),

  // ---- 论坛主题管理(admin+super) ----
  adminCreateTopic: (name: string, order?: number) =>
    req<ForumTopic>('/admin/forum/topics', { method: 'POST', body: { name, order } }),
  adminUpdateTopic: (id: string, patch: { name?: string; order?: number }) =>
    req<ForumTopic>(`/admin/forum/topics/${id}`, { method: 'PATCH', body: patch }),
  adminDeleteTopic: (id: string) =>
    req<{ deleted: boolean }>(`/admin/forum/topics/${id}`, { method: 'DELETE' }),

  // ---- 钱包 / 支付 ----
  wallet: () => req<{ balance: number }>('/wallet'),
  rechargeByCode: (code: string) =>
    req<{ balance: number; amount: number }>('/wallet/recharge', { method: 'POST', body: { code } }),
  prepay: (amount: number) =>
    req<{ outTradeNo: string; [k: string]: string }>('/payment/recharge/prepay', {
      method: 'POST',
      body: { amount },
    }),

  // ---- 管理后台 ----
  adminGenCodes: (count: number, amount: number) =>
    req<{ codes: string[] }>('/admin/recharge-codes', { method: 'POST', body: { count, amount } }),
  adminRecharge: (userId: string, amount: number) =>
    req<{ balance: number }>('/admin/wallet/recharge', { method: 'POST', body: { userId, amount } }),
  adminCreateCourse: (title: string, price: number) =>
    req<Course>('/admin/courses', { method: 'POST', body: { title, price } }),
  adminCreateChapter: (courseId: string, title: string) =>
    req<{ id: string }>('/admin/chapters', { method: 'POST', body: { courseId, title } }),
  adminCreateLesson: (chapterId: string, title: string, type: LessonType, access: LessonAccess) =>
    req<{ id: string }>('/admin/lessons', { method: 'POST', body: { chapterId, title, type, access } }),
  operationLogs: (params: { action?: string; actions?: string[]; keyword?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === '') return;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: AdminOperationLogItem[]; total: number; page: number; pageSize: number }>(`/admin/operation-logs${suffix}`);
  },
  userActivityLogs: (params: { action?: string; actions?: string[]; keyword?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === '') return;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    });
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: UserActivityLogItem[]; total: number; page: number; pageSize: number }>(`/admin/user-activity-logs${suffix}`);
  },

  appApkStatus: () => req<AppApkStatus>('/admin/app/apk'),
  uploadAppApk: (file: File) => upload<AppApkStatus>('/admin/app/apk', file),

  examRule: () => req<ExamPaperRule>('/admin/exam/rule'),
  updateExamRule: (totalCount: number, categoryCounts?: Record<string, number>) =>
    req<ExamPaperRule>('/admin/exam/rule', { method: 'PATCH', body: { totalCount, categoryCounts } }),

  // 题库 Excel 导入:整批指定 usage(仅学习/仅考试/两者)。
  importQuestions: (file: File, usage: QuestionUsage, category?: string) => {
    const qs = new URLSearchParams({ usage });
    if (category) qs.set('category', category);
    return upload<ImportResult>(`/admin/questions/import?${qs}`, file);
  },
  previewImportQuestions: (file: File, usage: QuestionUsage, category?: string) => {
    const qs = new URLSearchParams({ usage });
    if (category) qs.set('category', category);
    return upload<ImportPreview>(`/admin/questions/import/preview?${qs}`, file);
  },
  // 模板下载地址(GET,浏览器直接打开)。
  questionTemplateUrl: () => `${BASE}/admin/questions/template`,

  // ---- 管理员数据维护 ----
  questionStats: () => req<Array<{ category: string; count: number }>>('/admin/questions/stats'),
  managedCategories: () => req<ManagedQuestionCategory[]>('/admin/questions/categories'),
  createQuestionCategory: (name: string) =>
    req<ManagedQuestionCategory>('/admin/questions/categories', { method: 'POST', body: { name } }),
  renameQuestionCategory: (id: string, name: string) =>
    req<ManagedQuestionCategory>(`/admin/questions/categories/${id}`, { method: 'POST', body: { name } }),
  deleteQuestionCategory: (id: string) =>
    req<{ deleted: number }>(`/admin/questions/categories/${id}`, { method: 'DELETE' }),

  // 进入科目:按关键词搜题(管理端,含答案),分页。
  adminListQuestions: (params: { category?: string; keyword?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: AdminQuestionItem[]; total: number; page: number; pageSize: number }>(
      `/admin/questions/list${suffix}`,
    );
  },
  batchDeleteQuestions: (ids: string[]) =>
    req<{ deleted: number }>('/admin/questions/batch-delete', { method: 'POST', body: { ids } }),
  questionDeleteImpact: (category: string) =>
    req<DeleteImpact>(`/admin/questions/delete-impact?category=${encodeURIComponent(category)}`),
  purgeQuestions: (category: string, confirm: string) =>
    req<{ deleted: number }>(`/admin/questions?category=${encodeURIComponent(category)}&confirm=${encodeURIComponent(confirm)}`, {
      method: 'DELETE',
    }),
  updateQuestion: (id: string, patch: AdminQuestionPatch) =>
    req<AdminQuestionItem>(`/admin/questions/${id}`, { method: 'PATCH', body: patch }),
  deleteQuestion: (id: string) =>
    req<{ deleted: number }>(`/admin/questions/${id}`, { method: 'DELETE' }),

  // 卡密管理
  generateKeys: (count?: number, ttlDays?: number) =>
    req<{ keys: string[]; expiresAt: string }>('/admin/access-keys', {
      method: 'POST',
      body: { count, ttlDays },
    }),
  accessKeys: (params: { keyword?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
    const suffix = qs.toString() ? `?${qs}` : '';
    return req<{ items: AccessKeyItem[]; total: number; page: number; pageSize: number }>(`/admin/access-keys${suffix}`);
  },
  revokeKey: (id: string) =>
    req<{ ok: boolean }>(`/admin/access-keys/${id}/revoke`, { method: 'POST' }),
  updateKey: (id: string, ttlDays: number) =>
    req<AccessKeyItem>(`/admin/access-keys/${id}`, {
      method: 'POST',
      body: { ttlDays },
    }),
  deleteKey: (id: string) => req<{ deleted: number }>(`/admin/access-keys/${id}`, { method: 'DELETE' }),
  cleanupKeys: () => req<{ deleted: number }>('/admin/access-keys/cleanup', { method: 'DELETE' }),

  // 用户管理(超管看全部,业务管理员只看普通用户)
  users: () => req<AdminUser[]>('/admin/users'),
  deleteUser: (id: string) => req<{ deleted: number }>(`/admin/users/${id}`, { method: 'DELETE' }),
  // 新增业务管理员(仅超管)
  adminCreateAdmin: (phone: string, password: string, nickname: string) =>
    req<{ id: string; phone: string; nickname: string; role: UserRole }>('/admin/admins', {
      method: 'POST',
      body: { phone, password, nickname },
    }),
};

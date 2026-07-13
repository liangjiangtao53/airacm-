const TOKEN_KEY = 'airacm_token';

const runtimeParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : undefined;

export const API_BASE = runtimeParams?.get('apiBase') || import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8770';
export const DOWNLOAD_BASE =
  runtimeParams?.get('downloadBase') || import.meta.env.VITE_DOWNLOAD_BASE || 'http://127.0.0.1:3000';

export function assetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export type UserRole = 'user' | 'admin' | 'super';

export interface Me {
  userId: string;
  tenantId: string;
  role: UserRole;
  nickname: string;
}

export interface LoginResult {
  token: string;
  userId: string;
}

export interface KeyLoginResult extends LoginResult {
  expiresAt: string;
  needProfile: boolean;
}

export interface ForumTopic {
  id: string;
  name: string;
  order: number;
}

export type QuestionUsage = 'study' | 'exam' | 'both';
export type WrongQuestionSource = 'study' | 'exam';

export interface QuestionOption {
  key: string;
  text: string;
}

export interface QuestionPracticeSummary {
  seenCount: number;
  correctCount: number;
  wrongCount: number;
}

export interface QuestionItem {
  id: string;
  courseId: string | null;
  type: 'single' | 'multiple';
  stem: string;
  stemImageUrls?: string[];
  options: QuestionOption[];
  imageUrls?: string[];
  usage: QuestionUsage;
  order: number;
  practice?: QuestionPracticeSummary;
}

export interface PaperQuestion {
  id: string;
  type: 'single' | 'multiple';
  stem: string;
  stemImageUrls?: string[];
  options: QuestionOption[];
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
  stemImageUrls?: string[];
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

export interface WrongBookItem {
  questionId: string;
  category: string;
  type: 'single' | 'multiple';
  stem: string;
  options: QuestionOption[];
  stemImageUrls?: string[];
  imageUrls?: string[];
  answer: string;
  analysis: string;
  wrongCount: number;
  source: WrongQuestionSource;
  lastWrongAt: string;
}

export interface PostItem {
  id: string;
  topicId: string | null;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
  replyCount: number;
  canDelete: boolean;
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

export interface CommentItem {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
  canDelete: boolean;
}

export function getToken(): string {
  return String(uni.getStorageSync(TOKEN_KEY) || '');
}

export function setToken(token: string): void {
  uni.setStorageSync(TOKEN_KEY, token);
}

export function clearToken(): void {
  uni.removeStorageSync(TOKEN_KEY);
}

export function requireLogin(): boolean {
  if (getToken()) return true;
  uni.redirectTo({ url: '/pages/login/index' });
  return false;
}

function request<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; data?: string | AnyObject | ArrayBuffer; auth?: boolean } = {},
): Promise<T> {
  const header: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE}${path}`,
      method: opts.method || 'GET',
      data: opts.data,
      header,
      success: (res) => {
        const env = res.data as Envelope<T> | undefined;
        if (res.statusCode === 401) clearToken();
        if (res.statusCode < 200 || res.statusCode >= 300 || !env || env.success === false) {
          reject(new Error(env?.error || `${res.statusCode} 请求失败`));
          return;
        }
        resolve(env.data as T);
      },
      fail: (err) => reject(new Error(`网络连接失败: ${err.errMsg || '请检查服务器地址或网络'}`)),
    });
  });
}

export const api = {
  login: (phone: string, password: string) =>
    request<LoginResult>('/auth/login', { method: 'POST', data: { phone, password }, auth: false }),
  keyLogin: (key: string) =>
    request<KeyLoginResult>('/auth/key-login', { method: 'POST', data: { key }, auth: false }),
  completeProfile: (phone: string, nickname: string) =>
    request<LoginResult>('/auth/complete-profile', { method: 'POST', data: { phone, nickname } }),
  me: () => request<Me>('/auth/me'),
  categories: () => request<string[]>('/questions/categories'),
  questions: (params: {
    usage?: QuestionUsage;
    category?: string;
    courseId?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  } = {}) => {
    const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
    const qs = pairs.length ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString()}` : '';
    return request<{ items: QuestionItem[]; total: number; page: number; pageSize: number; startIndex?: number }>(`/questions${qs}`);
  },
  questionAnswer: (id: string) => request<{ answer: string; analysis: string; imageUrls?: string[] }>(`/questions/${id}/answer`),
  startExam: (category?: string) =>
    request<ExamStart>('/exams/start', { method: 'POST', data: { category } }),
  submitExam: (attemptId: string, answers: Record<string, string>) =>
    request<ExamResult>(`/exams/${attemptId}/submit`, { method: 'POST', data: { answers } }),
  examHistory: () => request<ExamAttemptSummary[]>('/exams/history'),
  examReview: (attemptId: string) => request<ExamResult & { submittedAt: string | null }>(`/exams/${attemptId}/review`),
  deleteExamAttempt: (attemptId: string) =>
    request<{ deleted: boolean }>(`/exams/${attemptId}`, { method: 'DELETE' }),
  wrongBook: () => request<WrongBookItem[]>('/exams/wrong-book'),
  startStudy: (category?: string, courseId?: string) =>
    request<{ ok: true }>('/exams/study/start', { method: 'POST', data: { category, courseId } }),
  recordStudyProgress: (questionId: string) =>
    request<{ ok: true }>('/exams/study/progress', { method: 'POST', data: { questionId } }),
  recordStudyWrong: (questionId: string, answer: string) =>
    request<{ ok: true; recorded: boolean; practice: QuestionPracticeSummary }>('/exams/wrong-book/study', { method: 'POST', data: { questionId, answer } }),
  masterWrong: (questionId: string, source: WrongQuestionSource = 'study') =>
    request<{ ok: boolean }>(`/exams/wrong-book/${questionId}/master`, { method: 'POST', data: { source } }),
  comments: (questionId: string) => request<CommentItem[]>(`/questions/${questionId}/comments`),
  addComment: (questionId: string, content: string) =>
    request<CommentItem>(`/questions/${questionId}/comments`, { method: 'POST', data: { content } }),
  deleteComment: (commentId: string) =>
    request<{ deleted: boolean }>(`/questions/comments/${commentId}`, { method: 'DELETE' }),
  forumTopics: () => request<ForumTopic[]>('/forum/topics'),
  posts: (params: { topicId?: string; page?: number; pageSize?: number } = {}) => {
    const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
    const qs = pairs.length ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)])).toString()}` : '';
    return request<{ items: PostItem[]; total: number; page: number; pageSize: number }>(`/posts${qs}`);
  },
  createPost: (content: string, topicId: string) =>
    request<PostItem>('/posts', { method: 'POST', data: { content, topicId } }),
  deletePost: (id: string) => request<{ deleted: boolean }>(`/posts/${id}`, { method: 'DELETE' }),
  postReplies: (id: string) => request<PostReplyItem[]>(`/posts/${id}/replies`),
  addPostReply: (id: string, content: string) =>
    request<PostReplyItem>(`/posts/${id}/replies`, { method: 'POST', data: { content } }),
  deletePostReply: (id: string) => request<{ deleted: boolean }>(`/posts/replies/${id}`, { method: 'DELETE' }),
  togglePostReplyLike: (id: string) =>
    request<{ liked: boolean; likeCount: number }>(`/posts/replies/${id}/like`, { method: 'POST' }),
};

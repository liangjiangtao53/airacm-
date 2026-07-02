<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, assetUrl, requireLogin, type CommentItem, type QuestionItem } from '@/utils/api';

const categories = ref<string[]>([]);
const category = ref('');
const keyword = ref('');
const questions = ref<QuestionItem[]>([]);
const picked = ref<Record<string, string[]>>({});
const answers = ref<Record<string, { answer: string; analysis: string }>>({});
const page = ref(1);
const jumpValue = ref('1');
const pageSizeOptions = [10, 20, 30];
const pageSize = ref(10);
const total = ref(0);
const loading = ref(false);
const commentOpen = ref<Record<string, boolean>>({});
const commentInputs = ref<Record<string, string>>({});
const commentLists = ref<Record<string, CommentItem[]>>({});

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

async function loadCategories() {
  const rows = await api.categories();
  categories.value = rows;
  if (!category.value && rows.length) {
    category.value = rows[0];
  }
}

async function loadQuestions(reset = false) {
  if (!requireLogin()) return;
  if (reset) {
    page.value = 1;
    jumpValue.value = '1';
  }
  if (!category.value) return;
  loading.value = true;
  try {
    const res = await api.questions({
      usage: 'study',
      category: category.value,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    questions.value = res.items;
    total.value = res.total;
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function reveal(id: string) {
  if (answers.value[id]) return;
  try {
    const result = await api.questionAnswer(id);
    answers.value[id] = result;
    const pickedKey = [...(picked.value[id] || [])].sort().join('');
    if (pickedKey) {
      await api.recordStudyWrong(id, pickedKey);
    }
  } catch (e) {
    toast((e as Error).message);
  }
}

function toggle(q: QuestionItem, key: string) {
  if (answers.value[q.id]) return;
  const cur = picked.value[q.id] || [];
  if (q.type === 'single') {
    picked.value[q.id] = [key];
    return;
  }
  picked.value[q.id] = cur.includes(key) ? cur.filter((item) => item !== key) : [...cur, key].sort();
}

function isCorrect(id: string, key: string) {
  return Boolean(answers.value[id]?.answer.includes(key));
}

function openExam() {
  uni.switchTab({ url: '/pages/exam/index' });
}

function changeCategory(e: { detail: { value: number } }) {
  category.value = categories.value[Number(e.detail.value)] || '';
  picked.value = {};
  answers.value = {};
  loadQuestions(true);
}

function changePageSize(e: { detail: { value: number } }) {
  pageSize.value = pageSizeOptions[Number(e.detail.value)] || pageSize.value;
  picked.value = {};
  answers.value = {};
  loadQuestions(true);
}

function nextPage(delta: number) {
  const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value));
  const next = Math.min(maxPage, Math.max(1, page.value + delta));
  if (next === page.value) return;
  page.value = next;
  jumpValue.value = String(next);
  picked.value = {};
  answers.value = {};
  loadQuestions();
}

function jumpPage() {
  const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value));
  const next = Math.min(maxPage, Math.max(1, Number(jumpValue.value) || 1));
  jumpValue.value = String(next);
  if (next === page.value) return;
  page.value = next;
  picked.value = {};
  answers.value = {};
  loadQuestions();
}

async function toggleComments(questionId: string) {
  commentOpen.value[questionId] = !commentOpen.value[questionId];
  if (!commentOpen.value[questionId] || commentLists.value[questionId]) return;
  try {
    commentLists.value[questionId] = await api.comments(questionId);
  } catch (e) {
    toast((e as Error).message);
  }
}

async function addComment(questionId: string) {
  const content = (commentInputs.value[questionId] || '').trim();
  if (!content) return;
  try {
    const created = await api.addComment(questionId, content);
    commentLists.value[questionId] = [created, ...(commentLists.value[questionId] || [])];
    commentInputs.value[questionId] = '';
  } catch (e) {
    toast((e as Error).message);
  }
}

onShow(async () => {
  if (!requireLogin()) return;
  try {
    await loadCategories();
    await loadQuestions();
  } catch (e) {
    toast((e as Error).message);
  }
});
</script>

<template>
  <view class="page study-page">
    <view class="header">
      <text class="title">专题学习</text>
      <text class="subtitle">顺序学习与模拟考试。</text>
    </view>

    <view class="subprojects">
      <view class="subproject active">
        <text class="subproject-title">顺序学习</text>
        <text class="subproject-desc">按科目顺序刷题,答错后进入错题本。</text>
      </view>
      <view class="subproject" @tap="openExam">
        <text class="subproject-title">模拟考试</text>
        <text class="subproject-desc">进入模拟考试,开始考试部分保持不变。</text>
      </view>
    </view>

    <view class="card filters">
      <picker mode="selector" :range="categories" @change="changeCategory">
        <view class="select">{{ category || '选择科目' }}</view>
      </picker>
      <input v-model="keyword" class="input" placeholder="搜索题干关键词" confirm-type="search" @confirm="loadQuestions(true)" />
      <button class="btn" @tap="loadQuestions(true)">搜索</button>
    </view>

    <view class="list-meta">
      <text>当前科目共 {{ total }} 题</text>
      <picker mode="selector" :range="pageSizeOptions.map((s) => `${s}题/页`)" @change="changePageSize">
        <view class="page-size">{{ pageSize }}题/页</view>
      </picker>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="questions.length === 0" class="empty">当前科目暂无题目。</view>

    <view class="question-list">
        <view v-for="(q, index) in questions" :key="q.id" class="card question-card">
        <view class="question-head">
          <text class="badge">{{ (page - 1) * pageSize + index + 1 }} · {{ q.type === 'single' ? '单选' : '多选' }}</text>
          <text class="stem">{{ q.stem }}</text>
          <image
            v-for="url in q.imageUrls || []"
            :key="url"
            :src="assetUrl(url)"
            mode="widthFix"
            class="question-image"
          />
        </view>
        <view class="options">
          <view
            v-for="option in q.options"
            :key="option.key"
            :class="[
              'option',
              (picked[q.id] || []).includes(option.key) && 'chosen',
              answers[q.id] && isCorrect(q.id, option.key) && 'correct',
              answers[q.id] && (picked[q.id] || []).includes(option.key) && !isCorrect(q.id, option.key) && 'wrong',
            ]"
            @tap="toggle(q, option.key)"
          >
            <text class="option-key">{{ option.key }}</text>
            <text class="option-text">{{ option.text }}</text>
          </view>
        </view>
        <view class="question-actions">
          <button v-if="!answers[q.id]" class="btn secondary action" @tap="reveal(q.id)">查看答案</button>
          <button class="btn secondary action" @tap="toggleComments(q.id)">
            {{ commentOpen[q.id] ? '收起评论' : '评论' }}
          </button>
        </view>
        <view v-if="answers[q.id]" class="answer-box">
          <text class="answer">答案: {{ answers[q.id].answer }}</text>
          <text v-if="answers[q.id].analysis" class="analysis">解析: {{ answers[q.id].analysis }}</text>
        </view>
        <view v-if="commentOpen[q.id]" class="comment-box">
          <view class="comment-form">
            <input v-model="commentInputs[q.id]" class="comment-input" placeholder="写下你的想法..." />
            <button class="btn comment-submit" @tap="addComment(q.id)">发表</button>
          </view>
          <view v-if="(commentLists[q.id] || []).length === 0" class="comment-empty">暂无评论</view>
          <view v-for="c in commentLists[q.id] || []" :key="c.id" class="comment-item">
            <text class="comment-name">{{ c.nickname }}</text>
            <text class="comment-content">{{ c.content }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="pager">
      <button class="btn secondary pager-btn" @tap="nextPage(-1)">上一页</button>
      <text class="pager-text">第 {{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</text>
      <button class="btn secondary pager-btn" @tap="nextPage(1)">下一页</button>
    </view>
    <view v-if="total > pageSize" class="jump-row">
      <text class="jump-label">跳转到</text>
      <input v-model="jumpValue" class="jump-input" type="number" confirm-type="done" @confirm="jumpPage" />
      <text class="jump-label">页</text>
      <button class="btn secondary jump-btn" @tap="jumpPage">跳转</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.study-page,
.question-list,
.filters,
.list-meta,
.question-card,
.options,
.subprojects,
.answer-box,
.comment-box {
  display: flex;
  flex-direction: column;
}

.study-page {
  gap: 26rpx;
}

.subprojects {
  gap: 18rpx;
}

.subproject {
  background: rgba(255, 255, 255, 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border-radius: 24rpx;
  padding: 24rpx;
}

.subproject.active {
  background: rgba(31, 111, 235, 0.08);
  border-color: rgba(31, 111, 235, 0.28);
}

.subproject-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.subproject-desc {
  color: rgba(17, 24, 39, 0.55);
  font-size: 24rpx;
  margin-top: 8rpx;
}

.header,
.filters,
.question-card,
.answer-box {
  gap: 18rpx;
}

.select {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 18rpx;
  color: #111827;
  font-size: 28rpx;
  min-height: 88rpx;
  padding: 24rpx;
}

.list-meta {
  align-items: center;
  color: rgba(17, 24, 39, 0.55);
  display: flex;
  flex-direction: row;
  font-size: 24rpx;
  justify-content: space-between;
}

.page-size {
  background: rgba(255, 255, 255, 0.7);
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 14rpx;
  color: #111827;
  padding: 12rpx 18rpx;
}

.empty {
  color: rgba(17, 24, 39, 0.45);
  font-size: 28rpx;
  padding: 48rpx 0;
  text-align: center;
}

.question-list {
  gap: 22rpx;
}

.question-head {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.badge {
  align-self: flex-start;
  background: rgba(31, 111, 235, 0.1);
  border-radius: 8rpx;
  color: #1f6feb;
  font-size: 22rpx;
  padding: 6rpx 10rpx;
}

.stem {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.6;
}

.question-image {
  border-radius: 16rpx;
  margin-top: 8rpx;
  width: 100%;
}

.options {
  gap: 12rpx;
}

.option {
  background: rgba(255, 255, 255, 0.62);
  border: 2rpx solid transparent;
  border-radius: 16rpx;
  display: flex;
  gap: 16rpx;
  padding: 18rpx;
}

.option.chosen {
  border-color: #38577a;
}

.option.correct {
  background: rgba(31, 111, 235, 0.08);
  border-color: rgba(31, 111, 235, 0.35);
}

.option.wrong {
  background: #fee2e2;
  border-color: #fca5a5;
}

.option-key,
.answer {
  color: #1f6feb;
  font-weight: 700;
}

.option-text,
.analysis {
  color: rgba(17, 24, 39, 0.7);
  flex: 1;
  font-size: 26rpx;
  line-height: 1.55;
}

.action {
  align-self: flex-start;
}

.answer-box {
  background: rgba(31, 111, 235, 0.08);
  border-radius: 16rpx;
  padding: 20rpx;
}

.question-actions,
.comment-form {
  align-items: center;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 14rpx;
}

.comment-box {
  border-top: 2rpx solid rgba(17, 24, 39, 0.06);
  gap: 12rpx;
  padding-top: 16rpx;
}

.comment-input {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.12);
  border-radius: 16rpx;
  flex: 1;
  min-height: 72rpx;
  min-width: 300rpx;
  padding: 0 20rpx;
}

.comment-submit,
.jump-btn {
  min-height: 68rpx;
}

.comment-empty,
.comment-item {
  color: rgba(17, 24, 39, 0.52);
  font-size: 24rpx;
}

.comment-item {
  background: rgba(255, 255, 255, 0.58);
  border-radius: 14rpx;
  padding: 14rpx 16rpx;
}

.comment-name {
  color: rgba(17, 24, 39, 0.6);
  font-weight: 700;
  margin-right: 12rpx;
}

.comment-content {
  color: rgba(17, 24, 39, 0.76);
}

.pager {
  align-items: center;
  display: flex;
  gap: 16rpx;
  justify-content: space-between;
}

.pager-btn {
  min-height: 72rpx;
  min-width: 150rpx;
}

.pager-text {
  color: rgba(17, 24, 39, 0.55);
  font-size: 24rpx;
}

.jump-row {
  align-items: center;
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  justify-content: center;
}

.jump-label {
  color: rgba(17, 24, 39, 0.55);
  font-size: 24rpx;
}

.jump-input {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.12);
  border-radius: 14rpx;
  color: #111827;
  min-height: 68rpx;
  text-align: center;
  width: 120rpx;
}
</style>

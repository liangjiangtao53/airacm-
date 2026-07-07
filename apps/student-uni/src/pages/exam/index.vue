<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { api, assetUrl, requireLogin, type ExamResult, type PaperQuestion } from '@/utils/api';

const EXAM_CATEGORY_COUNTS: Record<string, number> = {
  'M1 航空概论': 32,
  'M2 航空器维修': 50,
  'M3 飞机结构和系统': 182,
  'M5 航空涡轮发动机': 70,
  'M9 航空英语': 60,
};

const categories = ref<string[]>([]);
const category = ref('');
const phase = ref<'idle' | 'taking' | 'result'>('idle');
const attemptId = ref('');
const questions = ref<PaperQuestion[]>([]);
const answers = ref<Record<string, string[]>>({});
const result = ref<ExamResult | null>(null);
const busy = ref(false);
const currentIndex = ref(0);
const touchStartX = ref(0);
const unansweredJumpIndex = ref(-1);

const answeredCount = computed(() => Object.values(answers.value).filter((v) => v.length > 0).length);
const unfinishedCount = computed(() => Math.max(0, questions.value.length - answeredCount.value));
const currentQuestion = computed(() => questions.value[currentIndex.value] || null);
const canPrev = computed(() => currentIndex.value > 0);
const canNext = computed(() => currentIndex.value < questions.value.length - 1);

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

async function loadCategories() {
  try {
    categories.value = (await api.categories()).filter((name) => EXAM_CATEGORY_COUNTS[name]);
    if (!category.value && categories.value.length > 0) {
      category.value = categories.value[0];
    }
  } catch {
    categories.value = [];
  }
}

async function start() {
  if (!requireLogin()) return;
  if (!category.value) {
    toast('请选择考试科目');
    return;
  }
  busy.value = true;
  try {
    const paper = await api.startExam(category.value);
    attemptId.value = paper.attemptId;
    questions.value = paper.questions;
    answers.value = {};
    result.value = null;
    currentIndex.value = 0;
    unansweredJumpIndex.value = -1;
    phase.value = 'taking';
  } catch (e) {
    toast((e as Error).message);
  } finally {
    busy.value = false;
  }
}

function pick(q: PaperQuestion, key: string) {
  const cur = answers.value[q.id] || [];
  if (q.type === 'single') {
    answers.value[q.id] = [key];
    if (currentQuestion.value?.id === q.id && canNext.value) {
      setTimeout(() => {
        if (currentQuestion.value?.id === q.id) moveQuestion(1);
      }, 180);
    }
    return;
  }
  answers.value[q.id] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].sort();
}

function moveQuestion(delta: number) {
  if (questions.value.length === 0) return;
  const next = Math.min(questions.value.length - 1, Math.max(0, currentIndex.value + delta));
  if (next === currentIndex.value) return;
  currentIndex.value = next;
}

function jumpToNextUnanswered() {
  if (questions.value.length === 0) return;
  for (let step = 1; step <= questions.value.length; step++) {
    const idx = (unansweredJumpIndex.value + step) % questions.value.length;
    const q = questions.value[idx];
    if ((answers.value[q.id] || []).length === 0) {
      unansweredJumpIndex.value = idx;
      currentIndex.value = idx;
      return;
    }
  }
  toast('已全部完成');
}

function onTouchStart(e: { changedTouches?: Array<{ clientX: number }>; touches?: Array<{ clientX: number }> }) {
  touchStartX.value = e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? 0;
}

function onTouchEnd(e: { changedTouches?: Array<{ clientX: number }> }) {
  const endX = e.changedTouches?.[0]?.clientX ?? 0;
  const delta = endX - touchStartX.value;
  if (Math.abs(delta) < 60) return;
  moveQuestion(delta > 0 ? -1 : 1);
}

async function submit() {
  busy.value = true;
  try {
    const payload: Record<string, string> = {};
    Object.entries(answers.value).forEach(([id, vals]) => {
      payload[id] = vals.join('');
    });
    result.value = await api.submitExam(attemptId.value, payload);
    phase.value = 'result';
  } catch (e) {
    toast((e as Error).message);
  } finally {
    busy.value = false;
  }
}

function changeCategory(e: { detail: { value: number } }) {
  const idx = Number(e.detail.value);
  category.value = categories.value[idx] || '';
}

onShow(() => {
  if (!requireLogin()) return;
  loadCategories();
});
</script>

<template>
  <view class="page exam-page">
    <view class="header">
      <text class="title">在线考试</text>
      <text class="subtitle">选择单科考试,交卷后自动判分并进入考试回顾。</text>
    </view>

    <view v-if="phase === 'idle'" class="card start-card">
      <picker mode="selector" :range="categories" @change="changeCategory">
        <view class="select">{{ category || '请选择考试科目' }}</view>
      </picker>
      <text v-if="category" class="hint">本次考试 {{ EXAM_CATEGORY_COUNTS[category] }} 题，考完为止</text>
      <button class="btn" :loading="busy" @tap="start">开始考试</button>
    </view>

    <view v-if="phase === 'taking'" class="taking" @touchstart="onTouchStart" @touchend="onTouchEnd">
      <text class="progress">共 {{ questions.length }} 题 · 已答 {{ answeredCount }}</text>
      <view class="exam-status">
        <text class="status-done">已完成 {{ answeredCount }} 题</text>
        <button class="status-pending" :disabled="unfinishedCount === 0" @tap.stop="jumpToNextUnanswered">
          <text>未答题 {{ unfinishedCount }}</text>
          <text class="pending-action">去作答</text>
          <text class="pending-arrow">&gt;</text>
        </button>
      </view>
      <view v-if="currentQuestion" class="card question-card">
        <view class="question-head">
          <text class="badge">{{ currentIndex + 1 }} / {{ questions.length }} · {{ currentQuestion.type === 'single' ? '单选' : '多选' }}</text>
          <text class="stem">{{ currentQuestion.stem }}</text>
        </view>
        <view class="options">
          <view
            v-for="option in currentQuestion.options"
            :key="option.key"
            :class="['option', (answers[currentQuestion.id] || []).includes(option.key) && 'chosen']"
            @tap="pick(currentQuestion, option.key)"
          >
            <text class="option-key">{{ option.key }}</text>
            <text class="option-text">{{ option.text }}</text>
          </view>
        </view>
      </view>
      <view class="question-nav">
        <button class="btn secondary nav-btn" :disabled="!canPrev" @tap="moveQuestion(-1)">上一题</button>
        <text class="nav-text">{{ currentIndex + 1 }} / {{ questions.length }}</text>
        <button class="btn secondary nav-btn" :disabled="!canNext" @tap="moveQuestion(1)">下一题</button>
      </view>
      <button class="btn submit" :loading="busy" @tap="submit">交卷</button>
    </view>

    <view v-if="phase === 'result' && result" class="result-list">
      <view class="score-card">
        <text class="score-label">本次成绩</text>
        <text class="score">{{ result.score }}</text>
        <text class="score-label">答对 {{ result.correct }} / {{ result.total }} 题</text>
      </view>
      <view v-for="(d, index) in result.details" :key="d.questionId" class="card review-card">
        <text :class="['badge', d.isCorrect ? 'ok' : 'bad']">{{ index + 1 }} · {{ d.isCorrect ? '正确' : '错误' }}</text>
        <text class="stem">{{ d.stem }}</text>
        <text class="summary">你的答案: {{ d.yourAnswer || '(未答)' }} · 正确答案: {{ d.correctAnswer }}</text>
        <text v-if="d.analysis" class="analysis">解析: {{ d.analysis }}</text>
        <image v-for="url in d.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
      </view>
      <button class="btn" @tap="phase = 'idle'">再考一次</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.exam-page,
.start-card,
.taking,
.question-card,
.question-head,
.options,
.question-nav,
.result-list,
.review-card {
  display: flex;
  flex-direction: column;
}

.exam-page,
.taking,
.result-list {
  gap: 24rpx;
}

.header,
.start-card,
.question-card,
.review-card {
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

.progress,
.hint,
.summary,
.analysis {
  color: rgba(17, 24, 39, 0.6);
  font-size: 26rpx;
  line-height: 1.6;
}

.exam-status {
  align-items: center;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
}

.status-done {
  color: rgba(17, 24, 39, 0.58);
  font-size: 26rpx;
  font-weight: 600;
}

.status-pending {
  align-items: center;
  background: #fff7ed;
  border: 2rpx solid #fdba74;
  border-radius: 999rpx;
  box-shadow: 0 8rpx 20rpx rgba(234, 88, 12, 0.12);
  color: #c2410c;
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 1;
  margin: 0;
  min-height: 64rpx;
  padding: 0 12rpx 0 22rpx;
}

.status-pending[disabled] {
  background: rgba(17, 24, 39, 0.05);
  border: 0;
  box-shadow: none;
  color: rgba(17, 24, 39, 0.36);
}

.pending-action {
  background: rgba(255, 255, 255, 0.76);
  border-radius: 999rpx;
  font-size: 22rpx;
  padding: 8rpx 12rpx;
}

.pending-arrow {
  font-size: 26rpx;
  font-weight: 900;
  margin-right: 4rpx;
}

.badge {
  align-self: flex-start;
  background: rgba(31, 111, 235, 0.1);
  border-radius: 8rpx;
  color: #1f6feb;
  font-size: 22rpx;
  padding: 6rpx 10rpx;
}

.badge.ok {
  background: rgba(31, 111, 235, 0.1);
  color: #1f6feb;
}

.badge.bad {
  background: #fee2e2;
  color: #dc2626;
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
  background: rgba(56, 87, 122, 0.08);
}

.option-key {
  color: #1f6feb;
  font-weight: 700;
}

.option-text {
  color: rgba(17, 24, 39, 0.7);
  flex: 1;
  font-size: 26rpx;
  line-height: 1.55;
}

.submit {
  margin-top: 8rpx;
}

.question-nav {
  align-items: center;
  flex-direction: row;
  gap: 16rpx;
  justify-content: space-between;
}

.nav-btn {
  min-height: 72rpx;
  min-width: 160rpx;
}

.nav-text {
  color: rgba(17, 24, 39, 0.55);
  font-size: 26rpx;
}

.score-card {
  background: #38577a;
  border-radius: 24rpx;
  color: #fff;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 42rpx;
  text-align: center;
}

.score {
  font-size: 76rpx;
  font-weight: 800;
}

.score-label {
  color: rgba(255, 255, 255, 0.72);
  font-size: 26rpx;
}
</style>

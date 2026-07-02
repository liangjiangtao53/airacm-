<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { api, assetUrl, requireLogin, type ExamResult, type PaperQuestion } from '@/utils/api';

const categories = ref<string[]>([]);
const category = ref('');
const phase = ref<'idle' | 'taking' | 'result'>('idle');
const attemptId = ref('');
const questions = ref<PaperQuestion[]>([]);
const answers = ref<Record<string, string[]>>({});
const result = ref<ExamResult | null>(null);
const busy = ref(false);

const answeredCount = computed(() => Object.values(answers.value).filter((v) => v.length > 0).length);

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

async function loadCategories() {
  try {
    categories.value = await api.categories();
  } catch {
    categories.value = [];
  }
}

async function start() {
  if (!requireLogin()) return;
  busy.value = true;
  try {
    const paper = await api.startExam(category.value || undefined);
    attemptId.value = paper.attemptId;
    questions.value = paper.questions;
    answers.value = {};
    result.value = null;
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
    return;
  }
  answers.value[q.id] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].sort();
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
  category.value = idx <= 0 ? '' : categories.value[idx - 1] || '';
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
      <text class="subtitle">随机组卷,交卷后自动判分并进入错题本。</text>
    </view>

    <view v-if="phase === 'idle'" class="card start-card">
      <picker mode="selector" :range="['全部科目', ...categories]" @change="changeCategory">
        <view class="select">{{ category || '全部科目' }}</view>
      </picker>
      <button class="btn" :loading="busy" @tap="start">开始考试</button>
    </view>

    <view v-if="phase === 'taking'" class="taking">
      <text class="progress">共 {{ questions.length }} 题 · 已答 {{ answeredCount }}</text>
      <view v-for="(q, index) in questions" :key="q.id" class="card question-card">
        <view class="question-head">
          <text class="badge">{{ index + 1 }} · {{ q.type === 'single' ? '单选' : '多选' }}</text>
          <text class="stem">{{ q.stem }}</text>
          <image v-for="url in q.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
        </view>
        <view class="options">
          <view
            v-for="option in q.options"
            :key="option.key"
            :class="['option', (answers[q.id] || []).includes(option.key) && 'chosen']"
            @tap="pick(q, option.key)"
          >
            <text class="option-key">{{ option.key }}</text>
            <text class="option-text">{{ option.text }}</text>
          </view>
        </view>
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
        <image v-for="url in d.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
        <text class="summary">你的答案: {{ d.yourAnswer || '(未答)' }} · 正确答案: {{ d.correctAnswer }}</text>
        <text v-if="d.analysis" class="analysis">解析: {{ d.analysis }}</text>
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
.summary,
.analysis {
  color: rgba(17, 24, 39, 0.6);
  font-size: 26rpx;
  line-height: 1.6;
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

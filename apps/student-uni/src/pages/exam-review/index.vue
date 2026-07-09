<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { api, assetUrl, requireLogin, type ExamAttemptSummary, type GradedItem } from '@/utils/api';

const attempts = ref<ExamAttemptSummary[]>([]);
const details = ref<Record<string, GradedItem[]>>({});
const analysisOpen = ref<Record<string, boolean>>({});
const openId = ref('');
const loading = ref(false);
const category = ref('');
const categories = computed(() => Array.from(new Set(attempts.value.map((item) => item.category).filter(Boolean))).sort());
const filteredAttempts = computed(() => attempts.value.filter((item) => !category.value || item.category === category.value));

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

function changeCategory(e: { detail: { value: number } }) {
  const idx = Number(e.detail.value);
  category.value = idx === 0 ? '' : categories.value[idx - 1] || '';
}

async function load() {
  if (!requireLogin()) return;
  loading.value = true;
  try {
    attempts.value = await api.examHistory();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function toggle(attempt: ExamAttemptSummary) {
  if (openId.value === attempt.id) {
    openId.value = '';
    return;
  }
  openId.value = attempt.id;
  if (details.value[attempt.id]) return;
  try {
    const res = await api.examReview(attempt.id);
    details.value[attempt.id] = res.details;
  } catch (e) {
    toast((e as Error).message);
    details.value[attempt.id] = [];
  }
}

async function removeAttempt(attempt: ExamAttemptSummary) {
  uni.showModal({
    title: '删除考试记录',
    content: '删除后不再显示这次考试回顾，确认删除吗？',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await api.deleteExamAttempt(attempt.id);
        attempts.value = attempts.value.filter((item) => item.id !== attempt.id);
        delete details.value[attempt.id];
        if (openId.value === attempt.id) openId.value = '';
        toast('已删除');
      } catch (e) {
        toast((e as Error).message);
      }
    },
  });
}

function timeLabel(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function detailKey(attemptId: string, questionId: string) {
  return `${attemptId}:${questionId}`;
}

function toggleAnalysis(attemptId: string, questionId: string) {
  const key = detailKey(attemptId, questionId);
  analysisOpen.value[key] = !analysisOpen.value[key];
}

function isCorrectOption(item: GradedItem, key: string) {
  return item.correctAnswer.includes(key);
}

function isWrongSelection(item: GradedItem, key: string) {
  return item.yourAnswer.includes(key) && !item.correctAnswer.includes(key);
}

onShow(load);
</script>

<template>
  <view class="page review-page">
    <view class="header">
      <text class="title">考试回顾</text>
      <text class="subtitle">历次已交卷考试,点开逐题复盘。</text>
    </view>

    <view class="filter">
      <picker mode="selector" :range="['全部模块', ...categories]" @change="changeCategory">
        <view class="select">{{ category || '全部模块' }}</view>
      </picker>
      <text class="count">{{ filteredAttempts.length }} 次</text>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="attempts.length === 0" class="empty">还没有考试记录。去在线考试做一套吧。</view>
    <view v-else-if="filteredAttempts.length === 0" class="empty">当前模块暂无考试记录。</view>

    <view class="attempt-list">
      <view v-for="(a, index) in filteredAttempts" :key="a.id" class="card attempt-card">
        <view class="attempt-head" @tap="toggle(a)">
          <view>
            <text class="attempt-title">第 {{ filteredAttempts.length - index }} 次考试</text>
            <text class="time">{{ a.category || '未标记模块' }}</text>
            <text class="time">{{ timeLabel(a.submittedAt) }}</text>
          </view>
          <view class="score-box">
            <text class="score">{{ a.score }}</text>
            <text class="time">{{ a.correct }}/{{ a.total }} 题</text>
          </view>
        </view>
        <button class="delete-btn" @tap.stop="removeAttempt(a)">删除</button>
        <view v-if="openId === a.id" class="detail-list">
          <view v-for="(d, i) in details[a.id] || []" :key="d.questionId" class="detail">
            <text :class="['badge', d.isCorrect ? 'ok' : 'bad']">{{ i + 1 }} · {{ d.isCorrect ? '正确' : '错误' }}</text>
            <text class="stem">{{ d.stem }}</text>
            <image v-for="url in d.stemImageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
            <view class="options">
              <view
                v-for="option in d.options"
                :key="option.key"
                :class="['option', isCorrectOption(d, option.key) && 'correct', isWrongSelection(d, option.key) && 'wrong']"
              >
                <text class="option-key">{{ option.key }}</text>
                <text class="option-text">{{ option.text }}</text>
                <text v-if="isCorrectOption(d, option.key)" class="option-tag">正确答案</text>
                <text v-else-if="isWrongSelection(d, option.key)" class="option-tag">你的选择</text>
              </view>
            </view>
            <text class="summary">你的答案: {{ d.yourAnswer || '(未答)' }} · 正确答案: {{ d.correctAnswer }}</text>
            <button v-if="d.analysis || d.imageUrls?.length" class="analysis-btn" @tap="toggleAnalysis(a.id, d.questionId)">
              {{ analysisOpen[detailKey(a.id, d.questionId)] ? '收起解析' : '查看解析' }}
            </button>
            <view v-if="analysisOpen[detailKey(a.id, d.questionId)]" class="analysis-box">
              <text v-if="d.analysis" class="analysis">解析: {{ d.analysis }}</text>
              <image v-for="url in d.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
            </view>
          </view>
          <text v-if="details[a.id]?.length === 0" class="empty-detail">暂无复盘明细</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.review-page,
.attempt-list,
.attempt-card,
.filter,
.detail-list,
.detail {
  display: flex;
  flex-direction: column;
}

.review-page,
.attempt-list,
.detail-list {
  gap: 22rpx;
}

.header,
.attempt-card,
.detail {
  gap: 16rpx;
}

.filter {
  align-items: center;
  flex-direction: row;
  gap: 16rpx;
}

.select {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 16rpx;
  color: #111827;
  font-size: 26rpx;
  min-width: 260rpx;
  padding: 18rpx 22rpx;
}

.count {
  color: rgba(17, 24, 39, 0.45);
  font-size: 24rpx;
}

.empty,
.empty-detail {
  color: rgba(17, 24, 39, 0.45);
  font-size: 28rpx;
  padding: 48rpx 0;
  text-align: center;
}

.attempt-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
}

.attempt-title {
  color: #111827;
  display: block;
  font-size: 30rpx;
  font-weight: 700;
}

.time,
.summary,
.analysis {
  color: rgba(17, 24, 39, 0.58);
  display: block;
  font-size: 24rpx;
  line-height: 1.55;
  margin-top: 6rpx;
}

.score-box {
  text-align: right;
}

.score {
  color: #1f6feb;
  display: block;
  font-size: 42rpx;
  font-weight: 800;
}

.delete-btn {
  align-self: flex-end;
  background: #fee2e2;
  border-radius: 999rpx;
  color: #dc2626;
  font-size: 24rpx;
  line-height: 1;
  margin: 0;
  min-height: 56rpx;
  padding: 14rpx 24rpx;
}

.detail {
  background: rgba(255, 255, 255, 0.58);
  border-radius: 16rpx;
  padding: 20rpx;
}

.badge {
  align-self: flex-start;
  border-radius: 8rpx;
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
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.55;
}

.options,
.analysis-box {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.option {
  align-items: center;
  background: rgba(255, 255, 255, 0.72);
  border: 2rpx solid rgba(17, 24, 39, 0.08);
  border-radius: 12rpx;
  color: rgba(17, 24, 39, 0.68);
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  min-height: 56rpx;
  padding: 12rpx 16rpx;
}

.option.correct {
  background: #ecfdf3;
  border-color: #86efac;
  color: #16a34a;
}

.option.wrong {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
}

.option-key,
.option-tag {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 700;
}

.option-text {
  flex: 1;
  font-size: 24rpx;
  line-height: 1.45;
}

.analysis-btn {
  align-self: flex-start;
  background: rgba(31, 111, 235, 0.1);
  border-radius: 999rpx;
  color: #1f6feb;
  font-size: 24rpx;
  line-height: 1;
  margin: 0;
  min-height: 56rpx;
  padding: 14rpx 24rpx;
}

.question-image {
  border-radius: 16rpx;
  margin-top: 8rpx;
  width: 100%;
}
</style>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, assetUrl, requireLogin, type ExamAttemptSummary, type GradedItem } from '@/utils/api';

const attempts = ref<ExamAttemptSummary[]>([]);
const details = ref<Record<string, GradedItem[]>>({});
const openId = ref('');
const loading = ref(false);

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
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

function timeLabel(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onShow(load);
</script>

<template>
  <view class="page review-page">
    <view class="header">
      <text class="title">考试回顾</text>
      <text class="subtitle">历次已交卷考试,点开逐题复盘。</text>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="attempts.length === 0" class="empty">还没有考试记录。去在线考试做一套吧。</view>

    <view class="attempt-list">
      <view v-for="(a, index) in attempts" :key="a.id" class="card attempt-card">
        <view class="attempt-head" @tap="toggle(a)">
          <view>
            <text class="attempt-title">第 {{ attempts.length - index }} 次考试</text>
            <text class="time">{{ timeLabel(a.submittedAt) }}</text>
          </view>
          <view class="score-box">
            <text class="score">{{ a.score }}</text>
            <text class="time">{{ a.correct }}/{{ a.total }} 题</text>
          </view>
        </view>
        <view v-if="openId === a.id" class="detail-list">
          <view v-for="(d, i) in details[a.id] || []" :key="d.questionId" class="detail">
            <text :class="['badge', d.isCorrect ? 'ok' : 'bad']">{{ i + 1 }} · {{ d.isCorrect ? '正确' : '错误' }}</text>
            <text class="stem">{{ d.stem }}</text>
            <image v-for="url in d.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
            <text class="summary">你的答案: {{ d.yourAnswer || '(未答)' }} · 正确答案: {{ d.correctAnswer }}</text>
            <text v-if="d.analysis" class="analysis">解析: {{ d.analysis }}</text>
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

.question-image {
  border-radius: 16rpx;
  margin-top: 8rpx;
  width: 100%;
}
</style>

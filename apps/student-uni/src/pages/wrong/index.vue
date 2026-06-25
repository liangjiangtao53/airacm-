<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, assetUrl, requireLogin, type CommentItem, type WrongBookItem } from '@/utils/api';

const items = ref<WrongBookItem[]>([]);
const picked = ref<Record<string, string[]>>({});
const revealed = ref<Record<string, boolean>>({});
const loading = ref(false);
const commentOpen = ref<Record<string, boolean>>({});
const commentInputs = ref<Record<string, string>>({});
const commentLists = ref<Record<string, CommentItem[]>>({});

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

async function load() {
  if (!requireLogin()) return;
  loading.value = true;
  try {
    items.value = await api.wrongBook();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

function toggle(q: WrongBookItem, key: string) {
  if (revealed.value[q.questionId]) return;
  const cur = picked.value[q.questionId] || [];
  if (q.type === 'single') {
    picked.value[q.questionId] = [key];
    return;
  }
  picked.value[q.questionId] = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].sort();
}

function isCorrect(q: WrongBookItem, key: string) {
  return q.answer.includes(key);
}

async function master(questionId: string) {
  try {
    await api.masterWrong(questionId);
    items.value = items.value.filter((item) => item.questionId !== questionId);
  } catch (e) {
    toast((e as Error).message);
  }
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

onShow(load);
</script>

<template>
  <view class="page wrong-page">
    <view class="header">
      <text class="title">错题本</text>
      <text class="subtitle">考试答错的题会自动收集,掌握后可移出。</text>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="items.length === 0" class="empty">错题本是空的。去考试练练吧。</view>

    <view class="wrong-list">
      <view v-for="(q, index) in items" :key="q.questionId" class="card wrong-card">
        <view class="question-head">
          <text class="badge">{{ index + 1 }} · {{ q.type === 'single' ? '单选' : '多选' }}</text>
          <text class="wrong-count">错 {{ q.wrongCount }} 次</text>
        </view>
        <text class="stem">{{ q.stem }}</text>
        <image v-for="url in q.imageUrls || []" :key="url" :src="assetUrl(url)" mode="widthFix" class="question-image" />
        <view class="options">
          <view
            v-for="option in q.options"
            :key="option.key"
            :class="[
              'option',
              (picked[q.questionId] || []).includes(option.key) && 'chosen',
              revealed[q.questionId] && isCorrect(q, option.key) && 'correct',
              revealed[q.questionId] && (picked[q.questionId] || []).includes(option.key) && !isCorrect(q, option.key) && 'wrong',
            ]"
            @tap="toggle(q, option.key)"
          >
            <text class="option-key">{{ option.key }}</text>
            <text class="option-text">{{ option.text }}</text>
          </view>
        </view>
        <view class="actions">
          <button v-if="!revealed[q.questionId]" class="btn" @tap="revealed[q.questionId] = true">查看答案</button>
          <template v-else>
            <text class="answer">正确答案: {{ q.answer }}</text>
            <button class="btn secondary master" @tap="master(q.questionId)">已掌握</button>
          </template>
          <button class="btn secondary master" @tap="toggleComments(q.questionId)">
            {{ commentOpen[q.questionId] ? '收起评论' : '评论' }}
          </button>
        </view>
        <text v-if="revealed[q.questionId] && q.analysis" class="analysis">解析: {{ q.analysis }}</text>
        <view v-if="commentOpen[q.questionId]" class="comment-box">
          <view class="comment-form">
            <input v-model="commentInputs[q.questionId]" class="comment-input" placeholder="写下你的想法..." />
            <button class="btn comment-submit" @tap="addComment(q.questionId)">发表</button>
          </view>
          <view v-if="(commentLists[q.questionId] || []).length === 0" class="comment-empty">暂无评论</view>
          <view v-for="c in commentLists[q.questionId] || []" :key="c.id" class="comment-item">
            <text class="comment-name">{{ c.nickname }}</text>
            <text class="comment-content">{{ c.content }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.wrong-page,
.wrong-list,
.wrong-card,
.options,
.comment-box {
  display: flex;
  flex-direction: column;
}

.wrong-page,
.wrong-list {
  gap: 22rpx;
}

.header,
.wrong-card,
.options {
  gap: 16rpx;
}

.empty {
  color: rgba(17, 24, 39, 0.45);
  font-size: 28rpx;
  padding: 48rpx 0;
  text-align: center;
}

.question-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.badge {
  background: rgba(31, 111, 235, 0.1);
  border-radius: 8rpx;
  color: #1f6feb;
  font-size: 22rpx;
  padding: 6rpx 10rpx;
}

.wrong-count {
  color: #dc2626;
  font-size: 24rpx;
}

.stem {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.6;
}

.question-image {
  border-radius: 12rpx;
  margin-top: 8rpx;
  max-width: 100%;
  width: 100%;
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

.actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.master {
  min-height: 72rpx;
}

.comment-box {
  border-top: 2rpx solid rgba(17, 24, 39, 0.06);
  gap: 12rpx;
  padding-top: 16rpx;
}

.comment-form {
  align-items: center;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 14rpx;
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

.comment-submit {
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
</style>

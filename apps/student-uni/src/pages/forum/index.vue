<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, requireLogin, type ForumTopic, type PostItem } from '@/utils/api';

const topics = ref<ForumTopic[]>([]);
const posts = ref<PostItem[]>([]);
const activeTopic = ref('');
const draftTopic = ref('');
const draft = ref('');
const loading = ref(false);
const posting = ref(false);

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function topicName(id: string | null) {
  return topics.value.find((t) => t.id === id)?.name || '';
}

async function load(topicId = activeTopic.value) {
  if (!requireLogin()) return;
  loading.value = true;
  try {
    const [topicRows, postRows] = await Promise.all([api.forumTopics(), api.posts(topicId ? { topicId } : {})]);
    topics.value = topicRows;
    posts.value = postRows.items;
    if (!draftTopic.value) draftTopic.value = topicRows[0]?.id || '';
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function selectTopic(topicId: string) {
  activeTopic.value = topicId;
  await load(topicId);
}

async function submit() {
  const content = draft.value.trim();
  if (!content) return;
  if (!draftTopic.value) {
    toast('请选择主题');
    return;
  }
  posting.value = true;
  try {
    const created = await api.createPost(content, draftTopic.value);
    if (!activeTopic.value || activeTopic.value === draftTopic.value) {
      posts.value = [created, ...posts.value];
    }
    draft.value = '';
  } catch (e) {
    toast((e as Error).message);
  } finally {
    posting.value = false;
  }
}

onShow(() => load());
</script>

<template>
  <view class="page forum-page">
    <view class="header">
      <text class="title">交流</text>
      <text class="subtitle">发帖提问、分享经验，与同行讨论交流。</text>
    </view>

    <scroll-view scroll-x class="topics" show-scrollbar="false">
      <view class="topic-row">
        <view :class="['topic-chip', activeTopic === '' && 'active']" @tap="selectTopic('')">全部</view>
        <view
          v-for="topic in topics"
          :key="topic.id"
          :class="['topic-chip', activeTopic === topic.id && 'active']"
          @tap="selectTopic(topic.id)"
        >
          {{ topic.name }}
        </view>
      </view>
    </scroll-view>

    <view class="card composer">
      <textarea v-model="draft" class="textarea" maxlength="1000" placeholder="说点什么..." />
      <view class="composer-footer">
        <picker
          mode="selector"
          :range="topics"
          range-key="name"
          @change="(e) => (draftTopic = topics[Number(e.detail.value)]?.id || '')"
        >
          <text class="topic-select">{{ topicName(draftTopic) || '选择主题' }}</text>
        </picker>
        <button class="btn post-btn" :loading="posting" :disabled="!draft.trim() || !draftTopic" @tap="submit">
          发布
        </button>
      </view>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="posts.length === 0" class="empty">还没有帖子，来发第一条吧。</view>

    <view class="post-list">
      <view v-for="post in posts" :key="post.id" class="card post-card">
        <view class="post-meta">
          <text class="author">{{ post.nickname }}</text>
          <text v-if="topicName(post.topicId)" class="badge">{{ topicName(post.topicId) }}</text>
          <text>{{ timeLabel(post.createdAt) }}</text>
        </view>
        <text class="post-content">{{ post.content }}</text>
        <text class="reply-count">回复 {{ post.replyCount }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.forum-page {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding-top: 16rpx;
}

.topics {
  white-space: nowrap;
}

.topic-row {
  display: flex;
  gap: 16rpx;
}

.topic-chip {
  background: rgba(255, 255, 255, 0.72);
  border-radius: 999rpx;
  color: rgba(17, 24, 39, 0.58);
  display: inline-flex;
  font-size: 26rpx;
  font-weight: 700;
  padding: 16rpx 28rpx;
}

.topic-chip.active {
  background: #38577a;
  color: #fff;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.composer-footer {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
}

.topic-select {
  color: rgba(17, 24, 39, 0.62);
  font-size: 26rpx;
}

.post-btn {
  min-height: 72rpx;
  min-width: 160rpx;
}

.empty {
  color: rgba(17, 24, 39, 0.45);
  font-size: 28rpx;
  padding: 48rpx 0;
  text-align: center;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}

.post-card {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.post-meta {
  align-items: center;
  color: rgba(17, 24, 39, 0.42);
  display: flex;
  flex-wrap: wrap;
  font-size: 24rpx;
  gap: 12rpx;
}

.author {
  color: rgba(17, 24, 39, 0.78);
  font-weight: 700;
}

.badge {
  background: rgba(31, 111, 235, 0.1);
  border-radius: 8rpx;
  color: #1f6feb;
  padding: 4rpx 10rpx;
}

.post-content {
  color: rgba(17, 24, 39, 0.86);
  font-size: 30rpx;
  line-height: 1.7;
  white-space: pre-wrap;
}

.reply-count {
  color: rgba(17, 24, 39, 0.48);
  font-size: 24rpx;
}
</style>

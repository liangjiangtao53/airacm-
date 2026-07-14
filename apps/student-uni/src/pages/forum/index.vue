<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, requireLogin, type ForumTopic, type PostItem, type PostReplyItem } from '@/utils/api';

const topics = ref<ForumTopic[]>([]);
const posts = ref<PostItem[]>([]);
const activeTopic = ref('');
const draftTopic = ref('');
const draft = ref('');
const loading = ref(false);
const posting = ref(false);
const openPostId = ref('');
const replies = ref<Record<string, PostReplyItem[]>>({});
const replyDrafts = ref<Record<string, string>>({});
const repliesLoading = ref<Record<string, boolean>>({});

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

async function toggleReplies(post: PostItem) {
  openPostId.value = openPostId.value === post.id ? '' : post.id;
  if (openPostId.value && !replies.value[post.id]) {
    await loadReplies(post.id);
  }
}

async function loadReplies(postId: string) {
  repliesLoading.value = { ...repliesLoading.value, [postId]: true };
  try {
    replies.value = { ...replies.value, [postId]: await api.postReplies(postId) };
  } catch (e) {
    toast((e as Error).message);
  } finally {
    repliesLoading.value = { ...repliesLoading.value, [postId]: false };
  }
}

async function submitReply(post: PostItem) {
  const content = (replyDrafts.value[post.id] || '').trim();
  if (!content) return;
  try {
    const created = await api.addPostReply(post.id, content);
    const next = [...(replies.value[post.id] || []), created];
    replies.value = { ...replies.value, [post.id]: next };
    replyDrafts.value = { ...replyDrafts.value, [post.id]: '' };
    post.replyCount = next.length;
  } catch (e) {
    toast((e as Error).message);
  }
}

async function removePost(post: PostItem) {
  uni.showModal({
    title: '删除帖子',
    content: '确认删除这条帖子吗？',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await api.deletePost(post.id);
        posts.value = posts.value.filter((item) => item.id !== post.id);
        if (openPostId.value === post.id) openPostId.value = '';
      } catch (e) {
        toast((e as Error).message);
      }
    },
  });
}

async function toggleReplyLike(reply: PostReplyItem) {
  try {
    const res = await api.togglePostReplyLike(reply.id);
    reply.likedByMe = res.liked;
    reply.likeCount = res.likeCount;
  } catch (e) {
    toast((e as Error).message);
  }
}

async function removeReply(post: PostItem, reply: PostReplyItem) {
  uni.showModal({
    title: '删除回复',
    content: '确认删除这条回复吗？',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await api.deletePostReply(reply.id);
        const next = (replies.value[post.id] || []).filter((item) => item.id !== reply.id);
        replies.value = { ...replies.value, [post.id]: next };
        post.replyCount = next.length;
      } catch (e) {
        toast((e as Error).message);
      }
    },
  });
}

function changeDraftTopic(e: { detail: { value: number } }) {
  draftTopic.value = topics.value[Number(e.detail.value)]?.id || '';
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
          @change="changeDraftTopic"
        >
          <text class="topic-select">{{ topicName(draftTopic) || '选择主题' }}</text>
        </picker>
        <button class="btn post-btn" :loading="posting" :disabled="!draft.trim() || !draftTopic" @tap="submit()">
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
        <text class="reply-count action" @tap="toggleReplies(post)">回复 {{ post.replyCount }}</text>
        <text v-if="post.canDelete" class="reply-count danger" @tap="removePost(post)">删除</text>
        <view v-if="openPostId === post.id" class="reply-panel">
          <view class="reply-composer">
            <input
              v-model="replyDrafts[post.id]"
              class="reply-input"
              maxlength="500"
              placeholder="写下你的回复..."
            />
            <button class="reply-btn" :disabled="!replyDrafts[post.id]?.trim()" @tap="submitReply(post)">回复</button>
          </view>
          <view v-if="repliesLoading[post.id]" class="reply-empty">加载中...</view>
          <view v-else-if="(replies[post.id] || []).length === 0" class="reply-empty">暂无回复</view>
          <view v-for="reply in replies[post.id] || []" :key="reply.id" class="reply-item">
            <view class="reply-meta">
              <text class="author">{{ reply.nickname }}</text>
              <text>{{ timeLabel(reply.createdAt) }}</text>
            </view>
            <text class="reply-content">{{ reply.content }}</text>
            <view class="reply-actions">
              <text :class="['reply-action', reply.likedByMe && 'liked']" @tap="toggleReplyLike(reply)">
                点赞 {{ reply.likeCount }}
              </text>
              <text v-if="reply.canDelete" class="reply-action danger" @tap="removeReply(post, reply)">删除</text>
            </view>
          </view>
        </view>
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

.reply-count.action {
  color: #1f6feb;
  font-weight: 700;
}

.reply-count.danger {
  color: #dc2626;
  font-weight: 700;
  margin-left: 24rpx;
}

.reply-panel {
  border-top: 2rpx solid rgba(17, 24, 39, 0.06);
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding-top: 16rpx;
}

.reply-composer {
  align-items: center;
  display: flex;
  gap: 12rpx;
}

.reply-input {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 14rpx;
  color: #111827;
  flex: 1;
  font-size: 26rpx;
  min-height: 70rpx;
  padding: 0 18rpx;
}

.reply-btn {
  background: #38577a;
  border-radius: 14rpx;
  color: #fff;
  font-size: 24rpx;
  line-height: 1;
  margin: 0;
  min-height: 68rpx;
  padding: 14rpx 24rpx;
}

.reply-empty {
  color: rgba(17, 24, 39, 0.4);
  font-size: 24rpx;
  padding: 12rpx 0;
}

.reply-item {
  background: rgba(255, 255, 255, 0.62);
  border-radius: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx;
}

.reply-meta,
.reply-actions {
  align-items: center;
  color: rgba(17, 24, 39, 0.42);
  display: flex;
  font-size: 22rpx;
  gap: 14rpx;
}

.reply-content {
  color: rgba(17, 24, 39, 0.78);
  font-size: 26rpx;
  line-height: 1.55;
}

.reply-action {
  color: rgba(17, 24, 39, 0.52);
}

.reply-action.liked {
  color: #1f6feb;
  font-weight: 700;
}

.reply-action.danger {
  color: #dc2626;
}
</style>

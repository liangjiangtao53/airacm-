<script setup lang="ts">
import { onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref, watch } from 'vue';
import { api, assetUrl, requireLogin, type QuestionItem } from '@/utils/api';
// #ifndef MP-WEIXIN
import type { CommentItem } from '@/utils/api';
// #endif
import { disableCaptureProtection, enableCaptureProtection } from '@/utils/capture';

const categories = ref<string[]>([]);
const category = ref('');
const keyword = ref('');
const questions = ref<QuestionItem[]>([]);
const picked = ref<Record<string, string[]>>({});
const answers = ref<Record<string, { answer: string; analysis: string; imageUrls?: string[] }>>({});
const autoRevealed = ref<Record<string, boolean>>({});
const explanationOpen = ref<Record<string, boolean>>({});
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const loading = ref(false);
const currentIndex = ref(0);
const touchStartX = ref(0);
const showCorrectAnswer = ref(false);
const jumpNumber = ref('1');
// #ifndef MP-WEIXIN
const commentOpen = ref<Record<string, boolean>>({});
const commentInputs = ref<Record<string, string>>({});
const commentLists = ref<Record<string, CommentItem[]>>({});
// #endif
const startedStudyCategories = ref(new Set<string>());
const progressRecorded = ref<Record<string, boolean>>({});
const loadedCategory = ref('');
const currentQuestion = computed(() => questions.value[currentIndex.value] || null);
const currentNumber = computed(() => (page.value - 1) * pageSize.value + currentIndex.value + 1);
const canPrev = computed(() => page.value > 1 || currentIndex.value > 0);
const canNext = computed(() => currentIndex.value < questions.value.length - 1 || page.value * pageSize.value < total.value);
const currentPractice = computed(() => currentQuestion.value?.practice || { seenCount: 0, correctCount: 0, wrongCount: 0 });
const correctCount = computed(() => currentPractice.value.correctCount);
const wrongCount = computed(() => currentPractice.value.wrongCount);
const accuracy = computed(() => {
  const answered = correctCount.value + wrongCount.value;
  return answered > 0 ? Math.round((correctCount.value / answered) * 100) : 0;
});

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

async function loadQuestions(reset = false, targetIndex = 0) {
  if (!requireLogin()) return;
  if (reset) {
    page.value = 1;
  }
  if (!category.value) return;
  loading.value = true;
  try {
    const keywordText = keyword.value.trim();
    const res = await api.questions({
      usage: 'study',
      category: category.value,
      keyword: keywordText || undefined,
      page: reset && !keywordText ? undefined : page.value,
      pageSize: pageSize.value,
    });
    questions.value = res.items;
    total.value = res.total;
    page.value = res.page;
    pageSize.value = res.pageSize;
    const nextIndex = reset ? (res.startIndex ?? targetIndex) : targetIndex;
    currentIndex.value = Math.min(Math.max(0, nextIndex), Math.max(0, res.items.length - 1));
    loadedCategory.value = category.value;
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function recordStudyStart() {
  const current = category.value;
  if (!current || startedStudyCategories.value.has(current)) return;
  startedStudyCategories.value.add(current);
  try {
    await api.startStudy(current);
  } catch {
    // 行为日志失败不影响正常刷题。
  }
}

async function recordStudyProgress(id?: string) {
  if (!id || progressRecorded.value[id]) return;
  progressRecorded.value[id] = true;
  try {
    await api.recordStudyProgress(id);
  } catch {
    delete progressRecorded.value[id];
  }
}

function updateQuestionPractice(id: string, practice: { seenCount: number; correctCount: number; wrongCount: number }) {
  const idx = questions.value.findIndex((q) => q.id === id);
  if (idx < 0) return;
  questions.value[idx] = { ...questions.value[idx], practice };
}

async function reveal(id: string, recordPractice = true, autoDisplay = false, openExplanation = false) {
  if (answers.value[id]) {
    if (!autoDisplay) {
      autoRevealed.value[id] = false;
      if (openExplanation) {
        explanationOpen.value[id] = true;
      }
      if (recordPractice) {
        const pickedKey = [...(picked.value[id] || [])].sort().join('');
        if (pickedKey) {
          const res = await api.recordStudyWrong(id, pickedKey);
          updateQuestionPractice(id, res.practice);
          progressRecorded.value[id] = true;
        } else {
          await recordStudyProgress(id);
        }
      }
    }
    return;
  }
  try {
    const result = await api.questionAnswer(id);
    answers.value[id] = result;
    autoRevealed.value[id] = autoDisplay;
    if (openExplanation) {
      explanationOpen.value[id] = true;
    }
    if (!recordPractice) return;
    const pickedKey = [...(picked.value[id] || [])].sort().join('');
    if (pickedKey) {
      const res = await api.recordStudyWrong(id, pickedKey);
      updateQuestionPractice(id, res.practice);
      progressRecorded.value[id] = true;
    } else {
      await recordStudyProgress(id);
    }
  } catch (e) {
    toast((e as Error).message);
  }
}

function toggleCorrectAnswer() {
  showCorrectAnswer.value = !showCorrectAnswer.value;
  const q = currentQuestion.value;
  if (showCorrectAnswer.value && q) {
    reveal(q.id, false, true, false);
  }
}

function shouldShowAnswer(id: string) {
  return Boolean(
    answers.value[id] &&
      (showCorrectAnswer.value || explanationOpen.value[id] || !autoRevealed.value[id] || (picked.value[id] || []).length > 0),
  );
}

function shouldShowExplanation(id: string) {
  return Boolean(answers.value[id] && explanationOpen.value[id]);
}

function toggleExplanation(id: string) {
  if (shouldShowExplanation(id)) {
    explanationOpen.value[id] = false;
    return;
  }
  reveal(id, true, false, true);
}

function toggle(q: QuestionItem, key: string) {
  if (answers.value[q.id]) return;
  const cur = picked.value[q.id] || [];
  if (q.type === 'single') {
    picked.value[q.id] = [key];
    // 选择后只取答案做红绿反馈，解析由“查看解析”手动展开。
    reveal(q.id, true, true, false);
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
  explanationOpen.value = {};
  progressRecorded.value = {};
  recordStudyStart();
  loadQuestions(true);
}

async function nextQuestion(delta: number) {
  const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value));
  const nextIndex = currentIndex.value + delta;
  if (delta > 0) {
    await recordStudyProgress(currentQuestion.value?.id);
  }
  if (nextIndex >= 0 && nextIndex < questions.value.length) {
    currentIndex.value = nextIndex;
    return;
  }
  if (delta > 0 && page.value < maxPage) {
    page.value += 1;
    await loadQuestions(false, 0);
    return;
  }
  if (delta < 0 && page.value > 1) {
    page.value -= 1;
    await loadQuestions(false, pageSize.value - 1);
  }
}

async function jumpToQuestion() {
  if (!total.value) return;
  const target = Math.min(total.value, Math.max(1, Number(jumpNumber.value) || 1));
  if (target > currentNumber.value) {
    await recordStudyProgress(currentQuestion.value?.id);
  }
  const targetPage = Math.max(1, Math.ceil(target / pageSize.value));
  const targetIndex = (target - 1) % pageSize.value;
  page.value = targetPage;
  jumpNumber.value = String(target);
  await loadQuestions(false, targetIndex);
}

function onTouchStart(e: TouchEvent) {
  touchStartX.value = e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? 0;
}

function onTouchEnd(e: TouchEvent) {
  const endX = e.changedTouches?.[0]?.clientX ?? 0;
  const delta = endX - touchStartX.value;
  if (Math.abs(delta) < 60) return;
  nextQuestion(delta > 0 ? -1 : 1);
}

// #ifndef MP-WEIXIN
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

async function removeComment(questionId: string, commentId: string) {
  uni.showModal({
    title: '删除评论',
    content: '确认删除这条评论吗？',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await api.deleteComment(commentId);
        commentLists.value[questionId] = (commentLists.value[questionId] || []).filter((item) => item.id !== commentId);
      } catch (e) {
        toast((e as Error).message);
      }
    },
  });
}
// #endif

onShow(async () => {
  if (!requireLogin()) return;
  enableCaptureProtection();
  try {
    await loadCategories();
    await recordStudyStart();
    // Tab 页面切到模拟考试后仍会保留实例；返回时保持顺序学习当前题和作答状态。
    if (loadedCategory.value !== category.value) {
      await loadQuestions(true);
    }
  } catch (e) {
    toast((e as Error).message);
  }
});

onUnload(disableCaptureProtection);

watch(
  () => [showCorrectAnswer.value, currentQuestion.value?.id] as const,
  ([enabled, id]) => {
    if (enabled && id) {
      reveal(String(id), false, true);
    }
  },
);

watch(currentNumber, (n) => {
  jumpNumber.value = String(n);
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
        <view class="subproject-head">
          <text class="subproject-title">顺序学习</text>
          <view :class="['answer-switch', showCorrectAnswer && 'active']" @tap="toggleCorrectAnswer()">
            <text class="answer-switch-label">显示答案</text>
            <view class="switch-track">
              <view class="switch-thumb" />
            </view>
          </view>
        </view>
        <text class="subproject-desc">按科目顺序刷题,答错后进入错题本。</text>
      </view>
      <view class="subproject" @tap="openExam()">
        <text class="subproject-title">模拟考试</text>
        <text class="subproject-desc">进入模拟考试,开始考试部分保持不变。</text>
      </view>
    </view>

    <view class="card filters category-filter">
      <picker mode="selector" :range="categories" @change="changeCategory($event)">
        <view class="select">{{ category || '选择科目' }}</view>
      </picker>
    </view>

    <view class="study-summary">
      <view class="study-stat-row">
        <text>答对: <text class="stat-correct">{{ correctCount }}</text> 题</text>
        <text>答错: <text class="stat-wrong">{{ wrongCount }}</text> 题</text>
        <text>正确率: {{ accuracy }}%</text>
      </view>
      <view class="jump-row">
        <text>共 {{ total }} 题</text>
        <input
          v-model="jumpNumber"
          class="jump-input"
          type="number"
          :max="total"
          min="1"
          confirm-type="go"
          @confirm="jumpToQuestion()"
        />
        <button class="btn secondary jump-btn" @tap="jumpToQuestion()">转到</button>
      </view>
    </view>

    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="questions.length === 0" class="empty">当前科目暂无题目。</view>

    <view class="question-list" @touchstart="onTouchStart($event)" @touchend="onTouchEnd($event)">
      <view v-if="currentQuestion" class="card question-card">
        <view class="question-head">
          <text class="badge">{{ currentNumber }} / {{ total }} · {{ currentQuestion.type === 'single' ? '单选' : '多选' }}</text>
          <text class="stem">{{ currentQuestion.stem }}</text>
        </view>
        <image
          v-for="url in currentQuestion.stemImageUrls || []"
          :key="url"
          :src="assetUrl(url)"
          mode="widthFix"
          class="question-image"
        />
        <view class="options">
          <view
            v-for="option in currentQuestion.options"
            :key="option.key"
            :class="[
              'option',
              (picked[currentQuestion.id] || []).includes(option.key) && 'chosen',
              shouldShowAnswer(currentQuestion.id) && isCorrect(currentQuestion.id, option.key) && 'correct',
              shouldShowAnswer(currentQuestion.id) && (picked[currentQuestion.id] || []).includes(option.key) && !isCorrect(currentQuestion.id, option.key) && 'wrong',
            ]"
            @tap="toggle(currentQuestion, option.key)"
          >
            <text class="option-key">{{ option.key }}</text>
            <text class="option-text">{{ option.text }}</text>
          </view>
        </view>
        <view class="question-actions">
          <button class="btn secondary action" @tap="toggleExplanation(currentQuestion.id)">
            {{ shouldShowExplanation(currentQuestion.id) ? '收起解析' : '查看解析' }}
          </button>
          <!-- #ifndef MP-WEIXIN -->
          <button class="btn secondary action" @tap="toggleComments(currentQuestion.id)">
            {{ commentOpen[currentQuestion.id] ? '收起评论' : '评论' }}
          </button>
          <!-- #endif -->
        </view>
        <view v-if="shouldShowExplanation(currentQuestion.id)" class="answer-box">
          <text class="answer">答案: {{ answers[currentQuestion.id].answer }}</text>
          <text v-if="answers[currentQuestion.id].analysis" class="analysis">解析: {{ answers[currentQuestion.id].analysis }}</text>
          <image
            v-for="url in answers[currentQuestion.id].imageUrls || []"
            :key="url"
            :src="assetUrl(url)"
            mode="widthFix"
            class="question-image"
          />
        </view>
        <!-- #ifndef MP-WEIXIN -->
        <view v-if="commentOpen[currentQuestion.id]" class="comment-box">
          <view class="comment-form">
            <input v-model="commentInputs[currentQuestion.id]" class="comment-input" placeholder="写下你的想法..." />
            <button class="btn comment-submit" @tap="addComment(currentQuestion.id)">发表</button>
          </view>
          <view v-if="(commentLists[currentQuestion.id] || []).length === 0" class="comment-empty">暂无评论</view>
          <view v-for="c in commentLists[currentQuestion.id] || []" :key="c.id" class="comment-item">
            <view class="comment-head">
              <text class="comment-name">{{ c.nickname }}</text>
              <text v-if="c.canDelete" class="comment-delete" @tap="removeComment(currentQuestion.id, c.id)">删除</text>
            </view>
            <text class="comment-content">{{ c.content }}</text>
          </view>
        </view>
        <!-- #endif -->
      </view>
    </view>

    <view v-if="questions.length > 0" class="pager">
      <button class="btn secondary pager-btn" :disabled="!canPrev" @tap="nextQuestion(-1)">上一题</button>
      <text class="pager-text">{{ currentNumber }} / {{ total }}</text>
      <button class="btn secondary pager-btn" :disabled="!canNext" @tap="nextQuestion(1)">下一题</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.study-page,
.question-list,
.filters,
.study-summary,
.question-card,
.options,
.subprojects,
.answer-box {
  display: flex;
  flex-direction: column;
}

.study-page {
  gap: 26rpx;
}

.subprojects {
  gap: 18rpx;
}

.subproject-head {
  align-items: center;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
}

.answer-switch {
  align-items: center;
  background: rgba(255, 255, 255, 0.86);
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 999rpx;
  box-shadow: 0 8rpx 20rpx rgba(17, 24, 39, 0.06);
  color: rgba(17, 24, 39, 0.68);
  display: flex;
  flex-direction: row;
  font-size: 24rpx;
  gap: 14rpx;
  min-height: 60rpx;
  padding: 0 12rpx 0 22rpx;
}

.answer-switch.active {
  background: rgba(31, 111, 235, 0.1);
  border-color: rgba(31, 111, 235, 0.4);
  color: #1f6feb;
}

.answer-switch-label {
  font-weight: 700;
}

.switch-track {
  align-items: center;
  background: rgba(17, 24, 39, 0.16);
  border-radius: 999rpx;
  display: flex;
  height: 34rpx;
  padding: 3rpx;
  width: 62rpx;
}

.switch-thumb {
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 2rpx 8rpx rgba(17, 24, 39, 0.18);
  height: 28rpx;
  transform: translateX(0);
  transition: transform 0.18s ease;
  width: 28rpx;
}

.answer-switch.active .switch-track {
  background: #1f6feb;
}

.answer-switch.active .switch-thumb {
  transform: translateX(28rpx);
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

.category-filter {
  padding: 18rpx 24rpx;
}

.select {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.1);
  border-radius: 18rpx;
  color: #111827;
  font-size: 28rpx;
  min-height: 68rpx;
  padding: 16rpx 20rpx;
}

.study-summary {
  background: rgba(255, 255, 255, 0.68);
  border: 2rpx solid rgba(17, 24, 39, 0.06);
  border-radius: 18rpx;
  color: rgba(17, 24, 39, 0.72);
  gap: 14rpx;
  padding: 18rpx 20rpx;
}

.study-stat-row,
.jump-row {
  align-items: center;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  font-size: 26rpx;
  gap: 18rpx;
}

.stat-correct {
  color: #1f6feb;
  font-weight: 800;
}

.stat-wrong {
  color: #dc2626;
  font-weight: 800;
}

.jump-input {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.14);
  border-radius: 10rpx;
  color: #111827;
  font-size: 26rpx;
  height: 60rpx;
  padding: 0 12rpx;
  text-align: center;
  width: 120rpx;
}

.jump-btn {
  min-height: 60rpx;
  min-width: 96rpx;
  padding: 0 18rpx;
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
  background: rgba(22, 163, 74, 0.08);
  border-color: rgba(22, 163, 74, 0.35);
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

.option.correct .option-key,
.option.correct .option-text {
  color: #16a34a;
  font-weight: 700;
}

.option.wrong .option-key,
.option.wrong .option-text {
  color: #dc2626;
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

.question-actions {
  align-items: center;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 14rpx;
}

/* #ifndef MP-WEIXIN */
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
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 14rpx 16rpx;
}

.comment-name {
  color: rgba(17, 24, 39, 0.6);
  font-weight: 700;
}

.comment-delete {
  color: #dc2626;
  font-weight: 700;
}

.comment-content {
  color: rgba(17, 24, 39, 0.76);
}
/* #endif */

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

</style>

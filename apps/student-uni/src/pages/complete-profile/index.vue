<script setup lang="ts">
import { ref } from 'vue';
import { api, setToken } from '@/utils/api';

const phone = ref('');
const nickname = ref('');
const loading = ref(false);

async function submit() {
  if (loading.value) return;
  loading.value = true;
  try {
    if (!phone.value.trim() || !nickname.value.trim()) throw new Error('请填写手机号和昵称');
    const res = await api.completeProfile(phone.value.trim(), nickname.value.trim());
    setToken(res.token);
    uni.switchTab({ url: '/pages/index/index' });
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <view class="page profile-page">
    <view class="card">
      <text class="title">补全资料</text>
      <text class="subtitle">首次使用卡密登录需要绑定手机号和昵称，后续可直接登录。</text>
      <view class="fields">
        <input v-model="phone" class="input" type="number" placeholder="手机号" />
        <input v-model="nickname" class="input" placeholder="昵称" />
      </view>
      <button class="btn" :loading="loading" @tap="submit">完成</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.profile-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
</style>

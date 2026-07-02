<script setup lang="ts">
import { ref } from 'vue';
import { api, setToken } from '@/utils/api';

const mode = ref<'password' | 'key'>('key');
const phone = ref('');
const password = ref('');
const key = ref('');
const loading = ref(false);
const logoUrl = '/static/maintenance-wing-logo.jpg';

function goHome() {
  uni.switchTab({ url: '/pages/index/index' });
}

function toast(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

function pasteKey() {
  uni.getClipboardData({
    success: (res) => {
      const text = String(res.data || '').trim();
      if (!text) {
        toast('剪贴板为空');
        return;
      }
      key.value = text;
      toast('已粘贴卡密');
    },
    fail: () => toast('无法读取剪贴板'),
  });
}

async function submit() {
  if (loading.value) return;
  loading.value = true;
  try {
    if (mode.value === 'key') {
      const trimmed = key.value.trim();
      if (!trimmed) throw new Error('请输入卡密');
      const res = await api.keyLogin(trimmed);
      setToken(res.token);
      if (res.needProfile) {
        uni.navigateTo({ url: '/pages/complete-profile/index' });
      } else {
        goHome();
      }
      return;
    }

    if (!phone.value.trim() || !password.value) throw new Error('请输入手机号和密码');
    const res = await api.login(phone.value.trim(), password.value);
    setToken(res.token);
    goHome();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <view class="page login-page">
    <view class="brand">
      <image class="logo" :src="logoUrl" mode="aspectFill" />
      <text class="eyebrow">维修翼站</text>
      <text class="title">登录学员端</text>
      <text class="subtitle">使用卡密或手机号登录后进入学习和交流。</text>
    </view>

    <view class="card form-card">
      <view class="segmented">
        <view :class="['segment', mode === 'key' && 'active']" @tap="mode = 'key'">卡密</view>
        <view :class="['segment', mode === 'password' && 'active']" @tap="mode = 'password'">手机号</view>
      </view>

      <view v-if="mode === 'key'" class="fields">
        <view class="key-row">
          <input v-model="key" class="input key-input" placeholder="请输入卡密" />
          <button class="paste-btn" @tap="pasteKey">粘贴</button>
        </view>
      </view>
      <view v-else class="fields">
        <input v-model="phone" class="input" type="number" placeholder="手机号" />
        <input v-model="password" class="input" password placeholder="密码" />
      </view>

      <button class="btn submit" :loading="loading" @tap="submit">登录</button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.login-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-bottom: 42rpx;
  text-align: center;
}

.logo {
  border-radius: 32rpx;
  box-shadow: 0 12rpx 34rpx rgba(31, 55, 82, 0.14);
  height: 148rpx;
  margin-bottom: 8rpx;
  width: 148rpx;
}

.eyebrow {
  color: #1f6feb;
  font-size: 28rpx;
  font-weight: 700;
}

.form-card {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.segmented {
  background: rgba(17, 24, 39, 0.06);
  border-radius: 18rpx;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 6rpx;
}

.segment {
  border-radius: 14rpx;
  color: rgba(17, 24, 39, 0.56);
  font-size: 28rpx;
  font-weight: 700;
  padding: 20rpx 0;
  text-align: center;
}

.segment.active {
  background: #fff;
  color: #111827;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.key-row {
  align-items: center;
  display: flex;
  gap: 16rpx;
}

.key-input {
  flex: 1;
  min-width: 0;
}

.paste-btn {
  align-items: center;
  background: rgba(31, 111, 235, 0.1);
  border-radius: 18rpx;
  color: #1f6feb;
  display: flex;
  flex: 0 0 132rpx;
  font-size: 28rpx;
  font-weight: 700;
  justify-content: center;
  min-height: 88rpx;
  padding: 0;
}

.submit {
  margin-top: 8rpx;
}
</style>

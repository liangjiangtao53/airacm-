<script setup lang="ts">
import { ref } from 'vue';
import logoAsset from '@/static/maintenance-wing-logo.jpg';
import { api, setToken } from '@/utils/api';
import { capabilities } from '@/utils/runtime';

const mode = ref<'password' | 'key'>('key');
const phone = ref('');
const password = ref('');
const key = ref('');
const loading = ref(false);
const logoUrl = logoAsset;
const bindingToken = ref('');
const bindingNeedsProfile = ref(false);
const nickname = ref('');
const showWechatLogin = capabilities.wechatLogin;

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
      if (bindingToken.value) {
        if (bindingNeedsProfile.value && (!phone.value.trim() || !nickname.value.trim())) {
          throw new Error('请填写手机号和昵称');
        }
        const res = await api.bindWechatKey(
          bindingToken.value,
          trimmed,
          bindingNeedsProfile.value ? phone.value.trim() : undefined,
          bindingNeedsProfile.value ? nickname.value.trim() : undefined,
        );
        if (res.needProfile) {
          bindingNeedsProfile.value = true;
          toast('请补全手机号和昵称');
          return;
        }
        setToken(res.token);
        goHome();
        return;
      }
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
    if (bindingToken.value) {
      const res = await api.bindWechatPassword(bindingToken.value, phone.value.trim(), password.value);
      setToken(res.token);
      goHome();
      return;
    }
    const res = await api.login(phone.value.trim(), password.value);
    setToken(res.token);
    goHome();
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading.value = false;
  }
}

function getWechatCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (result) => (result.code ? resolve(result.code) : reject(new Error('未获取到微信登录凭证'))),
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

async function loginWithWechat() {
  if (loading.value) return;
  loading.value = true;
  let lastError: Error = new Error('微信登录失败，请重试');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await api.wechatLogin(await getWechatCode());
        if (!result.needBinding) {
          setToken(result.token);
          goHome();
          return;
        }
        bindingToken.value = result.bindingToken;
        bindingNeedsProfile.value = false;
        mode.value = 'key';
        toast('请绑定已有卡密或手机号账号');
        return;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw lastError;
  } catch (error) {
    toast((error as Error).message);
  } finally {
    loading.value = false;
  }
}

function restartWechatLogin() {
  bindingToken.value = '';
  bindingNeedsProfile.value = false;
  void loginWithWechat();
}
</script>

<template>
  <view class="page login-page">
    <view class="brand">
      <image class="logo" :src="logoUrl" mode="aspectFill" />
      <text class="eyebrow">维修之翼</text>
      <text class="title">登录学员端</text>
      <!-- #ifdef MP-WEIXIN -->
      <text class="subtitle">{{ bindingToken ? '绑定已有账号后继续使用原学习记录。' : '登录后进入学习与练习。' }}</text>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <text class="subtitle">{{ bindingToken ? '绑定已有账号后继续使用原学习记录。' : '登录后进入学习和交流。' }}</text>
      <!-- #endif -->
    </view>

    <view class="card form-card">
      <button v-if="showWechatLogin && !bindingToken" class="wechat-btn" :loading="loading" @tap="loginWithWechat()">
        微信登录
      </button>
      <view v-if="showWechatLogin && !bindingToken" class="divider"><text>其他登录方式</text></view>
      <text v-if="bindingToken" class="binding-title">绑定已有账号</text>
      <button v-if="bindingToken" class="restart-wechat" :disabled="loading" @tap="restartWechatLogin()">
        重新获取微信登录
      </button>
      <view class="segmented">
        <view :class="['segment', mode === 'key' && 'active']" @tap="mode = 'key'">{{ bindingToken ? '绑定卡密' : '卡密' }}</view>
        <view :class="['segment', mode === 'password' && 'active']" @tap="mode = 'password'">{{ bindingToken ? '绑定账号' : '手机号' }}</view>
      </view>

      <view v-if="mode === 'key'" class="fields">
        <view class="key-row">
          <input v-model="key" class="input key-input" placeholder="请输入卡密" />
          <button class="paste-btn" @tap="pasteKey()">粘贴</button>
        </view>
        <input v-if="bindingNeedsProfile" v-model="phone" class="input" type="number" placeholder="手机号" />
        <input v-if="bindingNeedsProfile" v-model="nickname" class="input" placeholder="昵称" />
      </view>
      <view v-else class="fields">
        <input v-model="phone" class="input" type="number" placeholder="手机号" />
        <input v-model="password" class="input" password placeholder="密码" />
      </view>

      <button class="btn submit" :loading="loading" @tap="submit()">{{ bindingToken ? '确认绑定并登录' : '登录' }}</button>
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

.wechat-btn {
  background: #07c160;
  border-radius: 18rpx;
  color: #fff;
  font-size: 30rpx;
  font-weight: 700;
  min-height: 88rpx;
}

.divider {
  align-items: center;
  color: rgba(17, 24, 39, 0.4);
  display: flex;
  font-size: 24rpx;
  justify-content: center;
}

.binding-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.restart-wechat {
  background: transparent;
  color: #1f6feb;
  font-size: 26rpx;
  margin: 0;
  padding: 0;
  text-align: left;
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

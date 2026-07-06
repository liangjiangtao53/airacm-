<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { api, clearToken, getToken, type Me } from '@/utils/api';

const me = ref<Me | null>(null);
const logoUrl = '/static/maintenance-wing-logo.jpg';

type Tile = {
  title: string;
  desc: string;
  url?: string;
  type?: 'tab' | 'page';
  large?: boolean;
  pending?: boolean;
};

const h5Tiles: Tile[] = [
  {
    title: '交流',
    desc: '发帖提问，与同行讨论交流',
    url: '/pages/forum/index',
    type: 'tab',
    large: true,
  },
  {
    title: '下载 App',
    desc: '安卓版安装包上线后在这里下载',
    url: '/pages/download-app/index',
    type: 'page',
  },
  {
    title: '学历提升',
    desc: '咨询报读与资料领取',
    url: '/pages/upgrade/index',
    type: 'page',
  },
];

const appTiles: Tile[] = [
  {
    title: '专题学习',
    desc: '顺序学习与模拟考试都在这里进入',
    url: '/pages/study/index',
    type: 'tab',
    large: true,
  },
  {
    title: '考试回顾',
    desc: '历史成绩与逐题复盘',
    url: '/pages/exam-review/index',
    type: 'page',
  },
  {
    title: '错题本',
    desc: '顺序学习错题自动收集,重做核对与标记掌握',
    url: '/pages/wrong/index',
    type: 'tab',
  },
  {
    title: '交流',
    desc: '发帖提问,与同行讨论交流',
    url: '/pages/forum/index',
    type: 'tab',
  },
  {
    title: '学历提升',
    desc: '咨询报读与资料领取',
    url: '/pages/upgrade/index',
    type: 'page',
  },
];

// Android WebView 壳使用 H5 产物打包,启动时带 platform=app,让 App 首页走学习入口而不是下载页。
let isAppShell = false;
// #ifdef APP-PLUS
isAppShell = true;
// #endif
// #ifdef H5
isAppShell = typeof location !== 'undefined' && new URLSearchParams(location.search).get('platform') === 'app';
// #endif
const isH5 = !isAppShell;
const tiles = isH5 ? h5Tiles : appTiles;
const subtitle = isH5 ? '交流 · App 下载 · 学历提升' : '专题学习 · 考试回顾 · 错题本 · 交流 · 学历提升';

function roleLabel(role?: Me['role']) {
  if (role === 'super') return '超级管理员';
  if (role === 'admin') return '业务管理员';
  return '学员';
}

async function load() {
  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' });
    return;
  }
  try {
    me.value = await api.me();
  } catch {
    clearToken();
    uni.redirectTo({ url: '/pages/login/index' });
  }
}

function openTile(tile: Tile) {
  if (tile.pending || !tile.url) {
    uni.showToast({ title: '该模块正在迁移到 App', icon: 'none' });
    return;
  }
  if (tile.type === 'tab') uni.switchTab({ url: tile.url });
  else uni.navigateTo({ url: tile.url });
}

function logout() {
  clearToken();
  uni.redirectTo({ url: '/pages/login/index' });
}

onShow(load);
</script>

<template>
  <view class="page home-page">
    <view class="header">
      <view class="brand-row">
        <image class="logo" :src="logoUrl" mode="aspectFill" />
        <view>
          <text class="title">维修翼站</text>
          <text class="subtitle">{{ subtitle }}</text>
        </view>
      </view>
      <view class="profile" v-if="me">
        <text>{{ me.nickname || roleLabel(me.role) }}</text>
        <text class="role">{{ roleLabel(me.role) }}</text>
      </view>
    </view>

    <view class="grid">
      <view
        v-for="tile in tiles"
        :key="tile.title"
        :class="['tile', tile.large && 'large', tile.pending && 'pending']"
        @tap="openTile(tile)"
      >
        <text class="tile-title">{{ tile.title }}</text>
        <text class="tile-desc">{{ tile.desc }}</text>
        <text class="tile-link">{{ tile.pending ? '迁移中' : '进入' }}</text>
      </view>
    </view>

    <button class="logout" @tap="logout">退出登录</button>
  </view>
</template>

<style scoped lang="scss">
.home-page {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.header {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  padding-top: 24rpx;
}

.header .subtitle {
  display: block;
  margin-top: 16rpx;
}

.brand-row {
  align-items: center;
  display: flex;
  gap: 22rpx;
  min-width: 0;
}

.logo {
  border-radius: 24rpx;
  box-shadow: 0 10rpx 28rpx rgba(31, 55, 82, 0.12);
  flex-shrink: 0;
  height: 112rpx;
  width: 112rpx;
}

.profile {
  align-items: flex-end;
  color: #111827;
  display: flex;
  flex-direction: column;
  font-size: 24rpx;
  gap: 8rpx;
  max-width: 220rpx;
}

.role {
  color: rgba(17, 24, 39, 0.48);
}

.grid {
  display: grid;
  gap: 22rpx;
  grid-template-columns: 1fr 1fr;
}

.tile {
  background: rgba(255, 255, 255, 0.72);
  border-radius: 24rpx;
  box-shadow: 0 16rpx 46rpx rgba(31, 55, 82, 0.08);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 210rpx;
  padding: 28rpx;
}

.tile.large {
  grid-column: 1 / 3;
}

.tile.pending {
  opacity: 0.86;
}

.tile-title {
  color: #111827;
  font-size: 32rpx;
  font-weight: 700;
}

.tile-desc {
  color: rgba(17, 24, 39, 0.56);
  font-size: 26rpx;
  line-height: 1.5;
  margin-top: 16rpx;
}

.tile-link {
  color: #1f6feb;
  font-size: 26rpx;
  font-weight: 700;
  margin-top: auto;
}

.logout {
  background: transparent;
  color: rgba(17, 24, 39, 0.48);
  font-size: 26rpx;
}
</style>

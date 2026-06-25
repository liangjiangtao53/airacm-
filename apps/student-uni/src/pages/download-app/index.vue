<script setup lang="ts">
import { DOWNLOAD_BASE } from '@/utils/api';

const apkUrl = `${DOWNLOAD_BASE}/downloads/app/airacm-android.apk`;

function downloadApk() {
  // 原来使用相对路径,uni-app H5 单独端口运行时会找不到 Next 静态文件; 改为下载域名可配置。
  // #ifdef H5
  window.location.href = apkUrl;
  // #endif
  // #ifndef H5
  uni.showToast({ title: '请在浏览器下载最新安装包', icon: 'none' });
  // #endif
}
</script>

<template>
  <view class="page download-page">
    <view class="card">
      <text class="eyebrow">App 下载</text>
      <text class="title">安卓安装包</text>
      <text class="subtitle">
        安装包上传后,学员可在这里下载。当前固定文件名,后续更新版本时直接替换文件,页面链接不用改。
      </text>

      <button class="btn" @tap="downloadApk">下载安卓版 APK</button>
      <text class="hint">后续由管理后台「App 安装包」上传并覆盖此文件。</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.download-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.eyebrow {
  color: #1f6feb;
  font-size: 28rpx;
  font-weight: 700;
}

.hint {
  color: rgba(17, 24, 39, 0.52);
  font-size: 24rpx;
  line-height: 1.6;
}
</style>

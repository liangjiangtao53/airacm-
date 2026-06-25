<script setup lang="ts">
const qrUrl = '/static/customer-service-qr.svg';
</script>

<template>
  <view class="page upgrade-page">
    <view class="card intro">
      <text class="eyebrow">专升本咨询</text>
      <text class="title">咨询请添加客服</text>
      <text class="subtitle">扫码添加客服,了解报名条件、课程安排、资料领取和后续服务。</text>

      <view class="info-grid">
        <view class="info-item">
          <text class="info-title">报读咨询</text>
          <text class="info-text">确认适合的专业与层次</text>
        </view>
        <view class="info-item">
          <text class="info-title">资料领取</text>
          <text class="info-text">获取备考资料与流程说明</text>
        </view>
        <view class="info-item">
          <text class="info-title">学习安排</text>
          <text class="info-text">了解课程节奏和服务方式</text>
        </view>
      </view>
    </view>

    <view class="card qr-card">
      <image :src="qrUrl" mode="aspectFit" class="qr" />
      <text class="qr-title">扫码添加客服</text>
      <text class="subtitle qr-note">当前二维码为占位图,替换静态资源后页面自动显示真实二维码。</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.upgrade-page {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.intro,
.qr-card {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}

.eyebrow {
  color: #1f6feb;
  font-size: 28rpx;
  font-weight: 700;
}

.info-grid {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 8rpx;
}

.info-item {
  background: rgba(255, 255, 255, 0.58);
  border-radius: 18rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 22rpx;
}

.info-title {
  color: #111827;
  font-size: 28rpx;
  font-weight: 700;
}

.info-text {
  color: rgba(17, 24, 39, 0.56);
  font-size: 24rpx;
}

.qr-card {
  align-items: center;
  text-align: center;
}

.qr {
  background: #fff;
  border-radius: 24rpx;
  height: 420rpx;
  padding: 24rpx;
  width: 420rpx;
}

.qr-title {
  color: #111827;
  font-size: 30rpx;
  font-weight: 700;
}

.qr-note {
  max-width: 520rpx;
}
</style>

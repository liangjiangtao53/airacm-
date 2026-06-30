<script setup lang="ts">
const qrUrl = '/static/customer-service-qr.svg';

// 原页面只展示咨询入口；这里补充 docs/本科 图片文件名对应的院校名单。
const undergraduateSchoolGroups = [
  {
    title: '本科主推院校',
    schools: [
      '商洛学院',
      '西安外事学院',
      '西安工业大学',
      '西安文理学院',
      '西安欧亚学院',
      '西安理工大学',
      '西安石油大学',
      '西安航空学院',
      '西安财经大学',
      '陕西中医药大学',
      '陕西师范大学',
      '陕西理工大学',
    ],
  },
  {
    title: '其他本科院校',
    schools: [
      '延安大学',
      '渭南师范学院',
      '西北农林科技大学',
      '西北大学',
      '西北工业大学',
      '西安交通大学',
      '西安医学院',
      '西安建筑科技大学',
      '西安科技大学',
      '西安邮电大学',
      '长安大学',
      '陕西学前师范学院',
    ],
  },
];

const undergraduateSchoolCount = undergraduateSchoolGroups.reduce(
  (total, group) => total + group.schools.length,
  0,
);
</script>

<template>
  <view class="page upgrade-page">
    <view class="card intro">
      <text class="eyebrow">学历提升咨询</text>
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

    <view class="card schools-card">
      <view class="schools-header">
        <view class="schools-title-block">
          <text class="eyebrow">本科院校</text>
          <text class="schools-title">可咨询学校名单</text>
        </view>
        <text class="schools-count">共 {{ undergraduateSchoolCount }} 所</text>
      </view>

      <view class="school-groups">
        <view v-for="group in undergraduateSchoolGroups" :key="group.title" class="school-group">
          <view class="school-group-header">
            <text class="school-group-title">{{ group.title }}</text>
            <text class="school-group-count">{{ group.schools.length }} 所</text>
          </view>
          <view class="school-tags">
            <text v-for="school in group.schools" :key="school" class="school-tag">{{ school }}</text>
          </view>
        </view>
      </view>
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

.schools-card {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.schools-header,
.school-group-header {
  align-items: flex-end;
  display: flex;
  gap: 18rpx;
  justify-content: space-between;
}

.schools-title-block {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.schools-title {
  color: #111827;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 1.25;
}

.schools-count,
.school-group-count {
  color: rgba(17, 24, 39, 0.45);
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 700;
}

.school-groups {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.school-group {
  background: rgba(255, 255, 255, 0.58);
  border-radius: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  padding: 24rpx;
}

.school-group-title {
  color: #111827;
  font-size: 28rpx;
  font-weight: 700;
}

.school-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.school-tag {
  background: #fff;
  border: 2rpx solid rgba(17, 24, 39, 0.08);
  border-radius: 999rpx;
  color: rgba(17, 24, 39, 0.7);
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.2;
  padding: 12rpx 18rpx;
}
</style>

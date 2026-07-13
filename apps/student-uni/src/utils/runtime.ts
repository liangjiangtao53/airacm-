import { queryValue } from './query';

export type RuntimeTarget = 'h5' | 'android' | 'mp-weixin';

function detectRuntimeTarget(): RuntimeTarget {
  let detected: RuntimeTarget = 'h5';
  // #ifdef APP-PLUS
  detected = 'android';
  // #endif
  // #ifdef MP-WEIXIN
  detected = 'mp-weixin';
  // #endif
  // Android WebView 壳仍运行 H5 产物，用启动参数识别为 App。
  // #ifdef H5
  if (typeof location !== 'undefined' && queryValue(location.search, 'platform') === 'app') {
    detected = 'android';
  }
  // #endif
  return detected;
}

export const runtimeTarget: RuntimeTarget = detectRuntimeTarget();
export const capabilities = {
  wechatLogin: runtimeTarget === 'mp-weixin',
  appDownload: runtimeTarget === 'h5',
  captureProtection: runtimeTarget === 'mp-weixin',
};

export function runtimeQueryValue(key: string): string {
  // #ifdef H5
  if (typeof location !== 'undefined') return queryValue(location.search, key);
  // #endif
  return '';
}

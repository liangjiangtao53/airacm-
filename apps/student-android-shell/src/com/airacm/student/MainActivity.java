package com.airacm.student;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // QA 截图通过后重新开启: 防止学习/考试内容被系统截图、录屏或显示在最近任务缩略图中。
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

    WebView webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);
    settings.setAllowFileAccessFromFileURLs(true);
    settings.setAllowUniversalAccessFromFileURLs(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(ConsoleMessage message) {
        android.util.Log.d("AiracmWebView", message.message());
        return true;
      }
    });
    webView.setWebViewClient(new WebViewClient());
    setContentView(webView);
    // 生产包统一走公网域名,由 nginx 将 /api 反向代理到后端,避免 App 继续依赖内网 IP。
    webView.loadUrl("file:///android_asset/www/index.html?platform=app&apiBase=https%3A%2F%2Fnickjian.dpdns.org%2Fapi&downloadBase=https%3A%2F%2Fnickjian.dpdns.org#/pages/index/index");
  }
}

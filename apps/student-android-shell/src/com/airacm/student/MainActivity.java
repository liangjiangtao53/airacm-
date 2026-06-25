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
    // 原来没有限制系统截图/录屏; Android 端用 FLAG_SECURE 防止学习与考试内容被截图、录屏或显示在最近任务缩略图中。
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
    // 原来使用 Android 模拟器访问宿主机的 10.0.2.2; 局域网测试包改为直接连接当前服务器 IP。
    webView.loadUrl("file:///android_asset/www/index.html?platform=app&apiBase=http%3A%2F%2F192.168.2.7%3A8770#/pages/index/index");
  }
}

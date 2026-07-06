package com.airacm.student;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // SCREENSHOT_PROTECTION_START
    // Production APK blocks screenshots and screen recording for study/exam content.
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    // SCREENSHOT_PROTECTION_END

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
    webView.loadUrl("file:///android_asset/www/index.html?platform=app&apiBase=https%3A%2F%2Fweixiuzhiyi.com.cn%2Fapi&downloadBase=https%3A%2F%2Fweixiuzhiyi.com.cn#/pages/index/index");
  }
}

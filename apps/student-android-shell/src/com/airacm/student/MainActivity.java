package com.airacm.student;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
  private static final int STORAGE_PERMISSION_REQUEST = 1001;
  private String pendingQrUrl;

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
    // 小程序的长按菜单在 Android WebView 中无效；这里只拦截客服二维码并交给系统下载器保存。
    webView.setOnLongClickListener(view -> {
      WebView.HitTestResult result = webView.getHitTestResult();
      int type = result.getType();
      String imageUrl = result.getExtra();
      boolean isImage = type == WebView.HitTestResult.IMAGE_TYPE
        || type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE;
      if (isImage && isCustomerServiceQr(imageUrl)) {
        showQrActions(imageUrl);
        return true;
      }
      return false;
    });
    setContentView(webView);
    webView.loadUrl("file:///android_asset/www/index.html?platform=app&apiBase=https%3A%2F%2Fweixiuzhiyi.com.cn%2Fapi&downloadBase=https%3A%2F%2Fweixiuzhiyi.com.cn#/pages/index/index");
  }

  private boolean isCustomerServiceQr(String imageUrl) {
    if (imageUrl == null) return false;
    Uri uri = Uri.parse(imageUrl);
    String scheme = uri.getScheme();
    return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
      && uri.getPath() != null
      && uri.getPath().endsWith("/app/customer-service-qr");
  }

  private void showQrActions(String imageUrl) {
    new AlertDialog.Builder(this)
      .setTitle("客服二维码")
      .setItems(new String[] { "保存二维码（可在微信扫一扫中从相册识别）" }, (dialog, which) -> saveQrImage(imageUrl))
      .show();
  }

  private void saveQrImage(String imageUrl) {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
      && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      pendingQrUrl = imageUrl;
      requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, STORAGE_PERMISSION_REQUEST);
      return;
    }
    enqueueQrDownload(imageUrl);
  }

  private void enqueueQrDownload(String imageUrl) {
    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
    if (manager == null) {
      Toast.makeText(this, "系统下载服务不可用", Toast.LENGTH_SHORT).show();
      return;
    }

    try {
      String fileName = "customer-service-qr-" + System.currentTimeMillis() + ".png";
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(imageUrl))
        .setTitle("客服二维码")
        .setDescription("保存后可在微信扫一扫中从相册识别")
        .setMimeType("image/png")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_PICTURES, "Airacm/" + fileName);
      request.allowScanningByMediaScanner();
      manager.enqueue(request);
      Toast.makeText(this, "正在保存二维码，请稍候", Toast.LENGTH_SHORT).show();
    } catch (RuntimeException error) {
      Toast.makeText(this, "二维码保存失败，请稍后重试", Toast.LENGTH_SHORT).show();
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != STORAGE_PERMISSION_REQUEST) return;

    String imageUrl = pendingQrUrl;
    pendingQrUrl = null;
    if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && imageUrl != null) {
      enqueueQrDownload(imageUrl);
    } else {
      Toast.makeText(this, "需要存储权限才能保存二维码", Toast.LENGTH_SHORT).show();
    }
  }
}

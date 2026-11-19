package com.xuper.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class MainActivity extends Activity {
    private WebView webView;
    private XuperLocalServer localServer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private WebChromeClient chromeClient;
    private FrameLayout fullscreenContainer;
    private int safeTopDp = 0;
    private int safeBottomDp = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#0A0A0F"));
        getWindow().setNavigationBarColor(Color.parseColor("#0D0D12"));
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#141414"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#141414"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.setVisibility(View.GONE);
        root.addView(fullscreenContainer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            float density = getResources().getDisplayMetrics().density;
            int topPx;
            int botPx;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets sys = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                topPx = sys.top;
                botPx = sys.bottom;
            } else {
                topPx = insets.getSystemWindowInsetTop();
                botPx = insets.getSystemWindowInsetBottom();
            }
            safeTopDp = Math.round(topPx / Math.max(1f, density));
            safeBottomDp = Math.round(botPx / Math.max(1f, density));
            injectSafeAreaCss();
            return insets;
        });
        root.requestApplyInsets();

        try {
            localServer = XuperLocalServer.getInstance(getApplicationContext(), 8910);
        } catch (Exception e) {
            e.printStackTrace();
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        webView.setOnLongClickListener(v -> true);

        webView.addJavascriptInterface(new XuperBridge(this, webView, localServer), "XuperBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectSafeAreaCss();
            }
        });

        chromeClient = new WebChromeClient() {
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                fullscreenContainer.addView(customView, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                ));
                fullscreenContainer.setVisibility(View.VISIBLE);
                webView.setVisibility(View.GONE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                hideSystemUi();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                fullscreenContainer.removeView(customView);
                fullscreenContainer.setVisibility(View.GONE);
                customView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                webView.setVisibility(View.VISIBLE);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                showSystemUi();
            }
        };
        webView.setWebChromeClient(chromeClient);

        webView.loadUrl("http://127.0.0.1:" + localServer.getPort() + "/");
    }

    private void injectSafeAreaCss() {
        if (webView == null) return;
        String js = "try{document.documentElement.style.setProperty('--sat','" + safeTopDp + "px');"
                + "document.documentElement.style.setProperty('--sab','" + safeBottomDp + "px');}catch(e){}";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null && chromeClient != null) {
            chromeClient.onHideCustomView();
            return;
        }
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){return window.__xuperHandleBack ? window.__xuperHandleBack() : false;})()",
                val -> {
                    if ("true".equals(val)) return;
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                }
            );
            return;
        }
        super.onBackPressed();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        );
    }

    @SuppressWarnings("deprecation")
    private void showSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}

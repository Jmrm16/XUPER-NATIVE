package com.xuper.tv;

import android.app.Activity;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class XuperBridge {
    private final Activity activity;
    private final WebView webView;
    private final XuperLocalServer localServer;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    public XuperBridge(Activity activity, WebView webView, XuperLocalServer localServer) {
        this.activity = activity;
        this.webView = webView;
        this.localServer = localServer;
    }

    @JavascriptInterface
    public String des3EncryptBase64(String plainUtf8, String keyHex) {
        try {
            byte[] keyBytes = hexToBytes(keyHex);
            SecretKeySpec keySpec = new SecretKeySpec(keyBytes, "DESede");
            Cipher cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, keySpec);
            byte[] encrypted = cipher.doFinal(plainUtf8.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(encrypted, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new RuntimeException("3DES encrypt failed: " + e.getMessage(), e);
        }
    }

    @JavascriptInterface
    public String des3DecryptUtf8(String cipherBase64, String keyHex) {
        try {
            byte[] keyBytes = hexToBytes(keyHex);
            SecretKeySpec keySpec = new SecretKeySpec(keyBytes, "DESede");
            Cipher cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, keySpec);
            byte[] cipherBytes = Base64.decode(cipherBase64, Base64.DEFAULT);
            byte[] decrypted = cipher.doFinal(cipherBytes);
            return new String(decrypted, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("3DES decrypt failed: " + e.getMessage(), e);
        }
    }

    @JavascriptInterface
    public String registerStream(String url, String headersJson, double duration, String backupsJson, boolean isLive) {
        return localServer.registerStream(url, headersJson, duration, backupsJson, isLive);
    }

    @JavascriptInterface
    public String registerSubtitle(String url) {
        return localServer.registerSubtitle(url);
    }

    @JavascriptInterface
    public void httpRequest(final String reqId, final String optsJson, final String bodyStr) {
        executor.execute(() -> {
            int status = 0;
            String headersOut = "{}";
            String bodyB64 = "";
            String errorMsg = "";
            HttpURLConnection conn = null;
            try {
                JSONObject opts = new JSONObject(optsJson);
                String urlStr = opts.optString("url", "");
                String method = opts.optString("method", "GET").toUpperCase();
                int timeoutMs = opts.optInt("timeoutMs", 15000);
                JSONObject reqHeaders = opts.optJSONObject("headers");

                conn = localServer.openUpstreamConnection(new URL(urlStr), timeoutMs, timeoutMs);
                conn.setRequestMethod(method);
                conn.setInstanceFollowRedirects(true);

                if (reqHeaders != null) {
                    Iterator<String> keys = reqHeaders.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String v = reqHeaders.optString(k, "");
                        if (k.equalsIgnoreCase("Content-Length")) continue;
                        conn.setRequestProperty(k, v);
                    }
                }

                if (bodyStr != null && !bodyStr.isEmpty() && ("POST".equals(method) || "PUT".equals(method))) {
                    conn.setDoOutput(true);
                    byte[] bodyBytes = bodyStr.getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(bodyBytes);
                    }
                }

                status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (is != null) {
                    if ("gzip".equalsIgnoreCase(conn.getContentEncoding())) {
                        is = new GZIPInputStream(is);
                    }
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        baos.write(buf, 0, n);
                    }
                    bodyB64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                    is.close();
                }

                JSONObject respHeaders = new JSONObject();
                Map<String, List<String>> hdrMap = conn.getHeaderFields();
                if (hdrMap != null) {
                    for (Map.Entry<String, List<String>> entry : hdrMap.entrySet()) {
                        String key = entry.getKey();
                        if (key != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                            respHeaders.put(key.toLowerCase(), entry.getValue().get(0));
                        }
                    }
                }
                headersOut = respHeaders.toString();
            } catch (Exception e) {
                errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }

            final String js = "window.__xuperHttpCallback && window.__xuperHttpCallback("
                    + JSONObject.quote(reqId) + ","
                    + status + ","
                    + JSONObject.quote(headersOut) + ","
                    + JSONObject.quote(bodyB64) + ","
                    + JSONObject.quote(errorMsg) + ");";
            activity.runOnUiThread(() -> webView.evaluateJavascript(js, null));
        });
    }

    private static byte[] hexToBytes(String hex) {
        String clean = hex != null ? hex.replaceAll("[^0-9a-fA-F]", "") : "";
        int len = clean.length() / 2;
        byte[] out = new byte[len];
        for (int i = 0; i < len; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}

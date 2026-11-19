package com.xuper.tv;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class XuperLocalServer {
    private final Context context;
    private final int port;
    private ServerSocket serverSocket;
    private volatile boolean running = false;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final SecureRandom random = new SecureRandom();

    private final ConcurrentHashMap<String, StreamEntry> streams = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> subtitles = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, DnsEntry> dnsCache = new ConcurrentHashMap<>();

    private long lastLiveSignMoment = 0L;

    private static final long[] LIVE_K = {
        3614090360L, 3905402710L, 606105819L, 3250441966L, 4118548399L, 1200080426L,
        2821735955L, 4249261313L, 1770035416L, 2336552879L, 4294925233L, 2304563134L,
        1804603682L, 4254626195L, 2792965006L, 1236535329L, 4129170786L, 3225465664L,
        643717713L, 3921069994L, 3593408605L, 38016083L, 3634488961L, 3889429448L,
        568446438L, 3275163606L, 4107603335L, 1163531501L, 2850285829L, 4243563512L,
        1735328473L, 2368359562L, 4294588738L, 2272392833L, 1839030562L, 4259657740L,
        2763975236L, 1272893353L, 4139469664L, 3200236656L, 681279174L, 3936430074L,
        3564056709L, 76029189L, 3654602809L, 3871185381L, 530742520L, 3299628645L,
        4096336452L, 1126891415L, 2878612391L, 4237533241L, 1700485571L, 2399980690L,
        4293706877L, 2240044497L, 1873313359L, 4264355552L, 2734768916L, 1309151649L,
        4149444226L, 3174756917L, 765973179L, 3951481745L
    };
    private static final int[] LIVE_S = {
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    };
    private static final int[] LIVE_ROUND1 = {10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5};
    private static final int[] LIVE_G = new int[64];
    private static final byte[] LIVE_SALT = {
        115, 97, 108, 116, 51, 51, 51, 51, 61, 52, (byte) 152, 13, 10, 21, 50,
        (byte) 201, (byte) 195, (byte) 130, 23, 8, (byte) 192
    };

    static {
        for (int i = 0; i < 64; i++) {
            if (i < 16) LIVE_G[i] = LIVE_ROUND1[i];
            else if (i < 32) LIVE_G[i] = (5 * i + 1) % 16;
            else if (i < 48) LIVE_G[i] = (3 * i + 5) % 16;
            else LIVE_G[i] = (7 * i) % 16;
        }
    }

    private static final SSLSocketFactory TRUST_ALL_SSL_FACTORY;
    private static final HostnameVerifier TRUST_ALL_HOST_VERIFIER = (hostname, session) -> true;

    static {
        SSLSocketFactory factory = null;
        try {
            TrustManager[] tm = new TrustManager[]{
                new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                    public void checkServerTrusted(X509Certificate[] certs, String authType) {}
                }
            };
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, tm, new SecureRandom());
            factory = sc.getSocketFactory();
        } catch (Exception ignored) {}
        TRUST_ALL_SSL_FACTORY = factory;
    }

    private static class BackupEntry {
        final String url;
        final Map<String, String> headers;
        BackupEntry(String url, Map<String, String> headers) {
            this.url = url;
            this.headers = headers;
        }
    }

    private static class StreamEntry {
        String url;
        Map<String, String> headers;
        final double duration;
        final List<BackupEntry> backupUrls;
        int backupIndex = 0;
        boolean primaryAdded = false;
        final boolean isLive;
        long contentLength = -1L;
        volatile String lastManifest = null;
        volatile long lastManifestAt = 0L;

        StreamEntry(String url, Map<String, String> headers, double duration, List<BackupEntry> backupUrls, boolean isLive) {
            this.url = url;
            this.headers = headers;
            this.duration = duration;
            this.backupUrls = backupUrls;
            this.isLive = isLive;
        }
    }

    private static class DnsEntry {
        final String ip;
        final long at;
        DnsEntry(String ip, long at) {
            this.ip = ip;
            this.at = at;
        }
    }

    private static XuperLocalServer instance;

    public static synchronized XuperLocalServer getInstance(Context ctx, int port) throws IOException {
        if (instance == null) {
            Context appCtx = ctx != null ? ctx.getApplicationContext() : null;
            if (appCtx == null) appCtx = ctx;
            instance = new XuperLocalServer(appCtx, port);
            instance.start();
        } else if (!instance.running) {
            instance.start();
        }
        return instance;
    }

    public XuperLocalServer(Context context, int port) {
        this.context = context;
        this.port = port;
    }

    public int getPort() {
        return serverSocket != null ? serverSocket.getLocalPort() : port;
    }

    public synchronized void start() throws IOException {
        if (running) return;
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        try {
            serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
        } catch (java.net.BindException e) {
            try {
                serverSocket.close();
            } catch (Exception ignored) {}
            serverSocket = new ServerSocket();
            serverSocket.setReuseAddress(true);
            serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
        }
        running = true;
        Thread acceptThread = new Thread(() -> {
            while (running) {
                try {
                    final Socket sock = serverSocket.accept();
                    executor.execute(() -> handleClient(sock));
                } catch (IOException e) {
                    if (running) e.printStackTrace();
                }
            }
        }, "XuperLocalServer-Accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    public void stop() {
        running = false;
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (IOException ignored) {}
        }
    }

    public String registerStream(String url, String headersJson, double duration, String backupsJson, boolean isLive) {
        String token = randomHex(12);
        Map<String, String> headers = parseHeadersJson(headersJson);
        List<BackupEntry> backups = new ArrayList<>();
        try {
            if (backupsJson != null && !backupsJson.isEmpty()) {
                JSONArray arr = new JSONArray(backupsJson);
                for (int i = 0; i < arr.length(); i++) {
                    Object item = arr.opt(i);
                    if (item instanceof String) {
                        backups.add(new BackupEntry((String) item, null));
                    } else if (item instanceof JSONObject) {
                        JSONObject obj = (JSONObject) item;
                        String bUrl = obj.optString("url", "");
                        if (!bUrl.isEmpty()) {
                            JSONObject bHdr = obj.optJSONObject("headers");
                            backups.add(new BackupEntry(bUrl, bHdr != null ? parseHeadersJson(bHdr.toString()) : null));
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        streams.put(token, new StreamEntry(url, headers, duration, backups, isLive));
        if (streams.size() > 60) {
            Iterator<String> it = streams.keySet().iterator();
            if (it.hasNext()) {
                String k = it.next();
                if (!k.equals(token)) streams.remove(k);
            }
        }
        return token;
    }

    public String registerSubtitle(String url) {
        String token = randomHex(12);
        subtitles.put(token, url);
        return token;
    }

    private String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder(bytes * 2);
        for (byte value : b) {
            int v = value & 0xFF;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v));
        }
        return sb.toString();
    }

    private static Map<String, String> parseHeadersJson(String json) {
        Map<String, String> map = new LinkedHashMap<>();
        try {
            if (json != null && !json.trim().isEmpty()) {
                JSONObject obj = new JSONObject(json);
                Iterator<String> it = obj.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    map.put(k, obj.optString(k, ""));
                }
            }
        } catch (Exception ignored) {}
        return map;
    }

    // --- signO3 & monotonic start_moment matching proxy.js & magis.js ---
    private static long rotl(long e, int r) {
        long u = e & 0xFFFFFFFFL;
        return ((u << r) | (u >>> (32 - r))) & 0xFFFFFFFFL;
    }

    private static void liveCompress(long[] e, byte[] r, int t) {
        long[] n = new long[16];
        for (int s = 0; s < 16; s++) {
            int a = t + 4 * s;
            n[s] = ((r[a] & 0xFFL)
                    | ((r[a + 1] & 0xFFL) << 8)
                    | ((r[a + 2] & 0xFFL) << 16)
                    | ((r[a + 3] & 0xFFL) << 24)) & 0xFFFFFFFFL;
        }
        long o = e[0], i = e[1], l = e[2], u = e[3];
        for (int d = 0; d < 64; d++) {
            long f;
            if (d < 16) f = (i & l) | ((~i) & u);
            else if (d < 32) f = (u & i) | ((~u) & l);
            else if (d < 48) f = i ^ l ^ u;
            else f = l ^ (i | (~u));
            long c = (f + o + LIVE_K[d] + n[LIVE_G[d]]) & 0xFFFFFFFFL;
            o = u;
            u = l;
            l = i;
            i = (i + rotl(c, LIVE_S[d])) & 0xFFFFFFFFL;
        }
        e[0] = (e[0] + o) & 0xFFFFFFFFL;
        e[1] = (e[1] + i) & 0xFFFFFFFFL;
        e[2] = (e[2] + l) & 0xFFFFFFFFL;
        e[3] = (e[3] + u) & 0xFFFFFFFFL;
    }

    public static String signO3(String token, long startMoment) {
        byte[] prefix = ("token=" + token + "&sign2_method=sign_o3&instance=0&start_moment=" + startMoment).getBytes(StandardCharsets.UTF_8);
        byte[] msg = new byte[prefix.length + LIVE_SALT.length];
        System.arraycopy(prefix, 0, msg, 0, prefix.length);
        System.arraycopy(LIVE_SALT, 0, msg, prefix.length, LIVE_SALT.length);

        long[] r = {1732584193L, 4023233417L, 2562383102L, 271733878L};
        int t = msg.length;
        int n = (56 - ((t + 1) % 64) + 64) % 64;
        byte[] s = new byte[t + 1 + n + 8];
        System.arraycopy(msg, 0, s, 0, t);
        s[t] = (byte) 0x80;
        long a = (long) (t % 536870912) * 8L;
        long o = t / 536870912L;
        for (int i = 0; i < 4; i++) {
            s[t + 1 + n + i] = (byte) ((a >>> (8 * i)) & 0xFFL);
            s[t + 5 + n + i] = (byte) ((o >>> (8 * i)) & 0xFFL);
        }
        for (int l = 0; l < s.length; l += 64) {
            liveCompress(r, s, l);
        }
        StringBuilder sb = new StringBuilder(32);
        for (int d = 0; d < 4; d++) {
            for (int c = 0; c < 4; c++) {
                int b = (int) ((r[d] >>> (8 * c)) & 0xFFL);
                String hx = Integer.toHexString(b);
                if (hx.length() < 2) sb.append('0');
                sb.append(hx);
            }
        }
        return sb.toString();
    }

    private synchronized String refreshLiveAuthHeader(String authVal) {
        if (authVal == null || !authVal.contains("sign2_method=sign_o3")) return authVal;
        Matcher mTok = Pattern.compile("token=([0-9a-fA-F]{32})").matcher(authVal);
        if (!mTok.find()) {
            mTok = Pattern.compile("token=([^&]+)").matcher(authVal);
            if (!mTok.find()) return authVal;
        }
        long d = System.currentTimeMillis();
        if (d <= lastLiveSignMoment) d = lastLiveSignMoment + 1;
        lastLiveSignMoment = d;
        String newSign = signO3(mTok.group(1), d);
        String updated = authVal.replaceFirst("start_moment=\\d+", "start_moment=" + d);
        updated = updated.replaceFirst("sign2=[0-9a-fA-F]+", "sign2=" + newSign);
        return updated;
    }

    // --- DoH DNS fallback & TLS SNI support ---
    public boolean isSystemDnsResolvable(String host) {
        if (host == null || host.isEmpty()) return false;
        if (host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) return true;
        try {
            InetAddress[] addrs = InetAddress.getAllByName(host);
            for (InetAddress addr : addrs) {
                String ip = addr.getHostAddress();
                if (!addr.isLoopbackAddress() && !ip.startsWith("127.") && !ip.equals("0.0.0.0") && !ip.equals("::1") && !ip.equals("::")) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    public String resolveHostIpViaDoh(String host) {
        if (host == null || host.isEmpty()) return null;
        if (host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) return host;
        DnsEntry cached = dnsCache.get(host);
        if (cached != null && System.currentTimeMillis() - cached.at < 300_000L) {
            return cached.ip;
        }

        String[] dohUrls = {
            "https://1.1.1.1/dns-query?name=" + urlEncode(host) + "&type=A",
            "https://8.8.8.8/resolve?name=" + urlEncode(host) + "&type=A"
        };
        for (String doh : dohUrls) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(doh).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                c.setRequestProperty("Accept", "application/dns-json");
                if (c instanceof HttpsURLConnection && TRUST_ALL_SSL_FACTORY != null) {
                    ((HttpsURLConnection) c).setSSLSocketFactory(TRUST_ALL_SSL_FACTORY);
                }
                if (c.getResponseCode() == 200) {
                    String jsonStr = new String(readAllBytes(c.getInputStream()), StandardCharsets.UTF_8);
                    JSONObject obj = new JSONObject(jsonStr);
                    JSONArray ans = obj.optJSONArray("Answer");
                    if (ans != null) {
                        for (int i = 0; i < ans.length(); i++) {
                            JSONObject rec = ans.optJSONObject(i);
                            if (rec != null && rec.optInt("type", 0) == 1) {
                                String ip = rec.optString("data", "");
                                if (ip.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) {
                                    dnsCache.put(host, new DnsEntry(ip, System.currentTimeMillis()));
                                    return ip;
                                }
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return null;
    }

    public HttpURLConnection openUpstreamConnection(URL url, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        String host = url.getHost();
        HttpURLConnection conn;
        if (isSystemDnsResolvable(host)) {
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(connectTimeoutMs);
            conn.setReadTimeout(readTimeoutMs);
            if (conn instanceof HttpsURLConnection && TRUST_ALL_SSL_FACTORY != null) {
                HttpsURLConnection https = (HttpsURLConnection) conn;
                https.setHostnameVerifier(TRUST_ALL_HOST_VERIFIER);
                https.setSSLSocketFactory(TRUST_ALL_SSL_FACTORY);
            }
        } else {
            String ip = resolveHostIpViaDoh(host);
            URL targetUrl = url;
            if (ip != null && !ip.equals(host)) {
                int p = url.getPort();
                String file = url.getFile();
                if (p != -1) {
                    targetUrl = new URL(url.getProtocol(), ip, p, file);
                } else {
                    targetUrl = new URL(url.getProtocol(), ip, file);
                }
            }
            conn = (HttpURLConnection) targetUrl.openConnection();
            conn.setConnectTimeout(connectTimeoutMs);
            conn.setReadTimeout(readTimeoutMs);
            String hostHeader = url.getAuthority();
            if (hostHeader != null && !hostHeader.isEmpty()) {
                conn.setRequestProperty("Host", hostHeader);
            }
            if (conn instanceof HttpsURLConnection && TRUST_ALL_SSL_FACTORY != null) {
                HttpsURLConnection https = (HttpsURLConnection) conn;
                https.setHostnameVerifier(TRUST_ALL_HOST_VERIFIER);
                https.setSSLSocketFactory(new SniDelegatingSslFactory(TRUST_ALL_SSL_FACTORY, host));
            }
        }
        return conn;
    }

    private static class SniDelegatingSslFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;
        private final String sniHost;

        SniDelegatingSslFactory(SSLSocketFactory delegate, String sniHost) {
            this.delegate = delegate;
            this.sniHost = sniHost;
        }

        private Socket configureSni(Socket s) {
            if (s instanceof SSLSocket && sniHost != null && !sniHost.isEmpty() && !sniHost.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) {
                SSLSocket ssl = (SSLSocket) s;
                SSLParameters params = ssl.getSSLParameters();
                params.setServerNames(Collections.singletonList(new SNIHostName(sniHost)));
                ssl.setSSLParameters(params);
            }
            return s;
        }

        @Override public Socket createSocket() throws IOException {
            return delegate.createSocket();
        }
        @Override public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        @Override public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }
        @Override public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            return configureSni(delegate.createSocket(s, sniHost != null ? sniHost : host, port, autoClose));
        }
        @Override public Socket createSocket(String host, int port) throws IOException {
            return configureSni(delegate.createSocket(host, port));
        }
        @Override public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
            return configureSni(delegate.createSocket(host, port, localHost, localPort));
        }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException {
            return configureSni(delegate.createSocket(host, port));
        }
        @Override public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
            return configureSni(delegate.createSocket(address, port, localAddress, localPort));
        }
    }

    // --- HTTP Server request dispatch ---
    private void handleClient(Socket sock) {
        try {
            sock.setSoTimeout(30000);
            BufferedInputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();

            String requestLine = readLineCrlf(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0].toUpperCase(Locale.ROOT);
            String rawTarget = parts[1];

            Map<String, String> reqHeaders = new HashMap<>();
            String line;
            while ((line = readLineCrlf(in)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    reqHeaders.put(line.substring(0, idx).trim().toLowerCase(Locale.ROOT), line.substring(idx + 1).trim());
                }
            }

            if ("OPTIONS".equals(method)) {
                String hdr = "HTTP/1.1 204 No Content\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n"
                        + "Access-Control-Allow-Headers: Content-Type, Range, If-Range\r\n"
                        + "Connection: close\r\n\r\n";
                out.write(hdr.getBytes(StandardCharsets.US_ASCII));
                out.flush();
                return;
            }

            String pathOnly = rawTarget;
            int qIdx = pathOnly.indexOf('?');
            if (qIdx >= 0) pathOnly = pathOnly.substring(0, qIdx);
            int hIdx = pathOnly.indexOf('#');
            if (hIdx >= 0) pathOnly = pathOnly.substring(0, hIdx);

            if ("/ping".equals(pathOnly) || "/health".equals(pathOnly)) {
                String json = "{\"returnValue\":true,\"status\":\"ok\",\"port\":" + getPort() + "}";
                sendSimple(out, 200, "application/json;charset=utf-8", json.getBytes(StandardCharsets.UTF_8), method);
                return;
            }

            // /sub/:token.(vtt|srt)
            Matcher subM = Pattern.compile("^/sub/([a-f0-9]{24})\\.(srt|vtt)$").matcher(pathOnly);
            if (subM.matches()) {
                handleSubtitle(subM.group(1), "vtt".equals(subM.group(2)), method, out);
                return;
            }

            // /hls/:token/:child
            Matcher hlsM = Pattern.compile("^/hls/([a-f0-9]{24})/([A-Za-z0-9_-]+)$").matcher(pathOnly);
            if (hlsM.matches()) {
                handleHlsChild(hlsM.group(1), hlsM.group(2), method, reqHeaders, out);
                return;
            }

            // /media/:token/seg-:idx.ts or /media/:token/...
            Matcher mediaM = Pattern.compile("^/media/([a-f0-9]{24})(?:/(.*))?$").matcher(pathOnly);
            if (mediaM.matches()) {
                handleMedia(mediaM.group(1), mediaM.group(2) != null ? mediaM.group(2) : "", method, reqHeaders, out);
                return;
            }

            serveAsset(pathOnly, method, out);
        } catch (Exception ignored) {
        } finally {
            try { sock.close(); } catch (IOException ignored) {}
        }
    }

    private void handleSubtitle(String token, boolean asVtt, String method, OutputStream out) throws IOException {
        String subUrl = subtitles.get(token);
        if (subUrl == null || subUrl.isEmpty()) {
            sendSimple(out, 410, "text/plain;charset=utf-8", "expired".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        HttpURLConnection conn = openUpstreamConnection(new URL(subUrl), 10000, 15000);
        conn.setRequestProperty("User-Agent", "XuperWeb/1.0");
        byte[] raw = readAllBytes(conn.getInputStream());
        conn.disconnect();
        String text = new String(raw, StandardCharsets.UTF_8);
        if (asVtt) {
            if (!text.startsWith("WEBVTT")) {
                text = "WEBVTT\n\n" + text.replace("\r\n", "\n").replaceAll("(\\d{2}:\\d{2}:\\d{2}),(\\d{3})", "$1.$2");
            }
            sendSimple(out, 200, "text/vtt;charset=utf-8", text.getBytes(StandardCharsets.UTF_8), method);
        } else {
            sendSimple(out, 200, "application/x-subrip;charset=utf-8", raw, method);
        }
    }

    private void handleHlsChild(String token, String childB64, String method, Map<String, String> reqHeaders, OutputStream out) throws IOException {
        StreamEntry entry = streams.get(token);
        if (entry == null) {
            sendSimple(out, 410, "text/plain;charset=utf-8", "expired".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        String childUrl = new String(Base64.decode(childB64, Base64.URL_SAFE | Base64.NO_PADDING), StandardCharsets.UTF_8);
        boolean isChildPlaylist = Pattern.compile("\\.m3u8(?:$|\\?)", Pattern.CASE_INSENSITIVE).matcher(childUrl).find();
        Map<String, String> hdrs = new LinkedHashMap<>();
        if (entry.headers != null) {
            for (Map.Entry<String, String> e : entry.headers.entrySet()) {
                if (!isChildPlaylist && e.getKey().toLowerCase(Locale.ROOT).matches("^content-(auth|license)$")) {
                    continue;
                }
                hdrs.put(e.getKey(), e.getValue());
            }
        }
        if (entry.isLive && !isChildPlaylist && "GET".equals(method)) {
            for (int attempt = 0; attempt < 2; attempt++) {
                try {
                    UpstreamResult res = fetchBuffered(childUrl, "GET", hdrs, reqHeaders, 15000);
                    if (res.status < 400 && res.body.length > 0) {
                        sendSimple(out, res.status, "video/mp2t", res.body, method);
                        return;
                    }
                    if (attempt == 1) {
                        sendSimple(out, res.status > 0 ? res.status : 502, "video/mp2t", res.body, method);
                        return;
                    }
                } catch (Exception e) {
                    if (attempt == 1) {
                        sendSimple(out, 502, "text/plain;charset=utf-8", "segment error".getBytes(StandardCharsets.UTF_8), method);
                        return;
                    }
                }
            }
            return;
        }

        if (isChildPlaylist) {
            UpstreamResult res = fetchBuffered(childUrl, method, hdrs, reqHeaders, 15000);
            String rewritten = rewriteHlsManifest(new String(res.body, StandardCharsets.UTF_8), token, res.finalUrl);
            sendSimple(out, res.status, "application/vnd.apple.mpegurl", rewritten.getBytes(StandardCharsets.UTF_8), method);
            return;
        }

        streamUpstream(childUrl, method, hdrs, reqHeaders, out);
    }

    private void handleMedia(String token, String subPath, String method, Map<String, String> reqHeaders, OutputStream out) throws IOException {
        StreamEntry entry = streams.get(token);
        if (entry == null) {
            sendSimple(out, 410, "text/plain;charset=utf-8", "expired".getBytes(StandardCharsets.UTF_8), method);
            return;
        }

        Matcher segM = Pattern.compile("^seg-(\\d+)\\.ts$", Pattern.CASE_INSENSITIVE).matcher(subPath);
        if (segM.matches() && !entry.url.contains(".m3u8")) {
            int segIdx = Integer.parseInt(segM.group(1));
            serveVirtualTsSegment(entry, segIdx, method, out);
            return;
        }

        if (!entry.url.contains(".m3u8") && subPath.contains(".m3u8")) {
            serveVirtualHlsPlaylist(entry, method, out);
            return;
        }

        boolean isManifestUrl = entry.url.contains(".m3u8") || subPath.contains(".m3u8");
        if (isManifestUrl) {
            if (entry.isLive && "GET".equals(method) && entry.lastManifest != null
                    && System.currentTimeMillis() - entry.lastManifestAt < 1200L) {
                sendSimple(out, 200, "application/vnd.apple.mpegurl", entry.lastManifest.getBytes(StandardCharsets.UTF_8), method);
                return;
            }
            UpstreamResult res = fetchLiveManifestWithRetries(entry, method, reqHeaders);
            if (res.status >= 400 && entry.isLive && "GET".equals(method) && entry.lastManifest != null
                    && System.currentTimeMillis() - entry.lastManifestAt < 20000L) {
                sendSimple(out, 200, "application/vnd.apple.mpegurl", entry.lastManifest.getBytes(StandardCharsets.UTF_8), method);
                return;
            }
            String body = new String(res.body, StandardCharsets.UTF_8);
            String rewritten = rewriteHlsManifest(body, token, res.finalUrl);
            if (res.status < 400 && entry.isLive && "GET".equals(method) && rewritten.contains("#EXTM3U")) {
                entry.lastManifest = rewritten;
                entry.lastManifestAt = System.currentTimeMillis();
            }
            sendSimple(out, res.status, "application/vnd.apple.mpegurl", rewritten.getBytes(StandardCharsets.UTF_8), method);
            return;
        }

        streamUpstreamWithBackups(entry, method, reqHeaders, out);
    }

    private void streamUpstreamWithBackups(StreamEntry entry, String method, Map<String, String> clientHdrs, OutputStream out) throws IOException {
        List<BackupEntry> candidates = new ArrayList<>();
        candidates.add(new BackupEntry(entry.url, entry.headers));
        if (entry.backupUrls != null) {
            candidates.addAll(entry.backupUrls);
        }
        for (int idx = 0; idx < candidates.size(); idx++) {
            BackupEntry cand = candidates.get(idx);
            String currentUrl = cand.url;
            Map<String, String> baseHdrs = cand.headers != null ? cand.headers : entry.headers;
            boolean isLast = (idx == candidates.size() - 1);
            try {
                for (int redir = 0; redir < 6; redir++) {
                    HttpURLConnection conn = openUpstreamConnection(new URL(currentUrl), 15000, 30000);
                    conn.setInstanceFollowRedirects(false);
                    conn.setRequestMethod(method);
                    applyHeaders(conn, baseHdrs, clientHdrs);

                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc != null && !loc.isEmpty()) {
                            currentUrl = URI.create(currentUrl).resolve(loc).toString();
                            continue;
                        }
                    }

                    if (code >= 400 && !isLast) {
                        conn.disconnect();
                        break;
                    }

                    String ct = conn.getContentType();
                    if (ct == null || ct.isEmpty()) ct = "video/mp4";
                    StringBuilder hdr = new StringBuilder();
                    hdr.append("HTTP/1.1 ").append(code).append(" OK\r\n");
                    hdr.append("Content-Type: ").append(ct).append("\r\n");
                    hdr.append("Access-Control-Allow-Origin: *\r\n");
                    hdr.append("Accept-Ranges: ").append(conn.getHeaderField("Accept-Ranges") != null ? conn.getHeaderField("Accept-Ranges") : "bytes").append("\r\n");
                    String cl = conn.getHeaderField("Content-Length");
                    if (cl != null) hdr.append("Content-Length: ").append(cl).append("\r\n");
                    String cr = conn.getHeaderField("Content-Range");
                    if (cr != null) hdr.append("Content-Range: ").append(cr).append("\r\n");
                    hdr.append("Connection: close\r\n\r\n");
                    out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));

                    if (!"HEAD".equals(method)) {
                        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                        if (is != null) {
                            byte[] buf = new byte[32768];
                            int n;
                            while ((n = is.read(buf)) != -1) {
                                out.write(buf, 0, n);
                            }
                            is.close();
                        }
                    }
                    out.flush();
                    conn.disconnect();
                    return;
                }
            } catch (IOException e) {
                if (isLast) throw e;
            }
        }
    }

    private UpstreamResult fetchLiveManifestWithRetries(StreamEntry entry, String method, Map<String, String> reqHeaders) throws IOException {
        UpstreamResult res = fetchBuffered(entry.url, method, entry.headers, reqHeaders, 15000);
        if (res.status >= 400 && entry.isLive) {
            // Retry same CDN once with fresh monotonic start_moment
            res = fetchBuffered(entry.url, method, entry.headers, reqHeaders, 15000);
        }
        if (res.status >= 400 && entry.backupUrls != null && !entry.backupUrls.isEmpty()) {
            synchronized (entry) {
                if (!entry.primaryAdded) {
                    entry.primaryAdded = true;
                    entry.backupUrls.add(new BackupEntry(entry.url, entry.headers));
                }
                int maxTries = entry.backupUrls.size();
                for (int i = 0; i < maxTries && res.status >= 400; i++) {
                    BackupEntry b = entry.backupUrls.get(entry.backupIndex++ % entry.backupUrls.size());
                    entry.url = b.url;
                    if (b.headers != null) entry.headers = b.headers;
                    res = fetchBuffered(entry.url, method, entry.headers, reqHeaders, 15000);
                }
            }
        }
        return res;
    }

    private long ensureContentLength(StreamEntry entry) throws IOException {
        if (entry.contentLength > 0) return entry.contentLength;
        Map<String, String> probeHdrs = new HashMap<>();
        probeHdrs.put("range", "bytes=0-0");
        UpstreamResult res = fetchBuffered(entry.url, "GET", entry.headers, probeHdrs, 15000);
        String cr = res.headers.get("content-range");
        if (cr != null) {
            Matcher m = Pattern.compile("/(\\d+)").matcher(cr);
            if (m.find()) {
                entry.contentLength = Long.parseLong(m.group(1));
                return entry.contentLength;
            }
        }
        String cl = res.headers.get("content-length");
        if (cl != null) {
            try { entry.contentLength = Long.parseLong(cl); } catch (Exception ignored) {}
        }
        return entry.contentLength;
    }

    private void serveVirtualHlsPlaylist(StreamEntry entry, String method, OutputStream out) throws IOException {
        long len = ensureContentLength(entry);
        if (len <= 0) {
            sendSimple(out, 502, "text/plain;charset=utf-8", "length unavailable".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        double dur = entry.duration > 0 ? entry.duration : 7200.0;
        int numSegs = (int) Math.max(1L, Math.round(dur / 10.0));
        double segDur = dur / numSegs;
        StringBuilder sb = new StringBuilder();
        sb.append("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:")
          .append((int) Math.ceil(segDur))
          .append("\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n");
        String segDurStr = String.format(Locale.US, "%.3f", segDur);
        for (int i = 0; i < numSegs; i++) {
            sb.append("#EXTINF:").append(segDurStr).append(",\nseg-").append(i).append(".ts\n");
        }
        sb.append("#EXT-X-ENDLIST\n");
        sendSimple(out, 200, "application/vnd.apple.mpegurl", sb.toString().getBytes(StandardCharsets.UTF_8), method);
    }

    private void serveVirtualTsSegment(StreamEntry entry, int segIdx, String method, OutputStream out) throws IOException {
        long total = ensureContentLength(entry);
        if (total <= 0) {
            sendSimple(out, 404, "text/plain;charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        double dur = entry.duration > 0 ? entry.duration : 7200.0;
        int numSegs = (int) Math.max(1L, Math.round(dur / 10.0));
        if (segIdx < 0 || segIdx >= numSegs) {
            sendSimple(out, 404, "text/plain;charset=utf-8", "segment out of range".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        long start = (segIdx * total) / numSegs;
        start = (start / 188L) * 188L;
        long end = (segIdx == numSegs - 1) ? total - 1L : (((((segIdx + 1) * total) / numSegs) / 188L) * 188L) - 1L;
        if (end < start) end = Math.min(total - 1L, start + 188L - 1L);

        Map<String, String> rangeHdr = new HashMap<>();
        rangeHdr.put("range", "bytes=" + start + "-" + end);
        streamUpstream(entry.url, method, entry.headers, rangeHdr, out);
    }

    private static class UpstreamResult {
        int status;
        Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];
        String finalUrl;
    }

    private UpstreamResult fetchBuffered(String urlStr, String method, Map<String, String> baseHdrs, Map<String, String> clientHdrs, int timeoutMs) throws IOException {
        String currentUrl = urlStr;
        for (int redir = 0; redir < 6; redir++) {
            HttpURLConnection conn = openUpstreamConnection(new URL(currentUrl), timeoutMs, timeoutMs);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);
            applyHeaders(conn, baseHdrs, clientHdrs);

            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc != null && !loc.isEmpty()) {
                    currentUrl = URI.create(currentUrl).resolve(loc).toString();
                    continue;
                }
            }

            UpstreamResult res = new UpstreamResult();
            res.status = code;
            res.finalUrl = currentUrl;
            Map<String, List<String>> hMap = conn.getHeaderFields();
            if (hMap != null) {
                for (Map.Entry<String, List<String>> e : hMap.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                        res.headers.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(0));
                    }
                }
            }
            if (!"HEAD".equals(method)) {
                InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (is != null) {
                    res.body = readAllBytes(is);
                    is.close();
                }
            }
            conn.disconnect();
            return res;
        }
        throw new IOException("Too many redirects");
    }

    private void streamUpstream(String urlStr, String method, Map<String, String> baseHdrs, Map<String, String> clientHdrs, OutputStream out) throws IOException {
        String currentUrl = urlStr;
        for (int redir = 0; redir < 6; redir++) {
            HttpURLConnection conn = openUpstreamConnection(new URL(currentUrl), 15000, 30000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod(method);
            applyHeaders(conn, baseHdrs, clientHdrs);

            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc != null && !loc.isEmpty()) {
                    currentUrl = URI.create(currentUrl).resolve(loc).toString();
                    continue;
                }
            }

            String ct = conn.getContentType();
            if (ct == null || ct.isEmpty()) ct = "video/mp4";
            StringBuilder hdr = new StringBuilder();
            hdr.append("HTTP/1.1 ").append(code).append(" OK\r\n");
            hdr.append("Content-Type: ").append(ct).append("\r\n");
            hdr.append("Access-Control-Allow-Origin: *\r\n");
            hdr.append("Accept-Ranges: ").append(conn.getHeaderField("Accept-Ranges") != null ? conn.getHeaderField("Accept-Ranges") : "bytes").append("\r\n");
            String cl = conn.getHeaderField("Content-Length");
            if (cl != null) hdr.append("Content-Length: ").append(cl).append("\r\n");
            String cr = conn.getHeaderField("Content-Range");
            if (cr != null) hdr.append("Content-Range: ").append(cr).append("\r\n");
            hdr.append("Connection: close\r\n\r\n");
            out.write(hdr.toString().getBytes(StandardCharsets.US_ASCII));

            if (!"HEAD".equals(method)) {
                InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (is != null) {
                    byte[] buf = new byte[32768];
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                    is.close();
                }
            }
            out.flush();
            conn.disconnect();
            return;
        }
    }

    private void applyHeaders(HttpURLConnection conn, Map<String, String> baseHdrs, Map<String, String> clientHdrs) {
        boolean hasUa = false;
        if (baseHdrs != null) {
            for (Map.Entry<String, String> e : baseHdrs.entrySet()) {
                String k = e.getKey();
                String v = e.getValue();
                if ("content-auth".equalsIgnoreCase(k)) {
                    v = refreshLiveAuthHeader(v);
                }
                if ("user-agent".equalsIgnoreCase(k)) hasUa = true;
                conn.setRequestProperty(k, v);
            }
        }
        if (!hasUa) conn.setRequestProperty("User-Agent", "XuperWeb/1.0");
        if (clientHdrs != null) {
            if (clientHdrs.containsKey("range")) conn.setRequestProperty("Range", clientHdrs.get("range"));
            if (clientHdrs.containsKey("if-range")) conn.setRequestProperty("If-Range", clientHdrs.get("if-range"));
        }
    }

    private static String resolveUrl(String baseUrl, String ref) {
        try {
            return new URL(new URL(baseUrl), ref).toString();
        } catch (Exception e) {
            try {
                return URI.create(baseUrl).resolve(ref).toString();
            } catch (Exception ignored) {
                return ref;
            }
        }
    }

    private String rewriteHlsManifest(String manifest, String token, String baseUrl) {
        if (manifest == null || manifest.isEmpty()) return "";
        String prefix = "http://127.0.0.1:" + getPort() + "/hls/" + token + "/";
        String[] lines = manifest.split("\\r?\\n");
        StringBuilder out = new StringBuilder(manifest.length() + 512);
        Pattern uriPat = Pattern.compile("URI=\"([^\"]+)\"");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                out.append(line).append('\n');
                continue;
            }
            if (trimmed.startsWith("#")) {
                if (trimmed.startsWith("#EXT-X-KEY") || trimmed.startsWith("#EXT-X-MAP") || trimmed.startsWith("#EXT-X-MEDIA")) {
                    Matcher m = uriPat.matcher(line);
                    StringBuffer sb = new StringBuffer();
                    while (m.find()) {
                        String resolved = resolveUrl(baseUrl, m.group(1));
                        String enc = Base64.encodeToString(resolved.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                        m.appendReplacement(sb, Matcher.quoteReplacement("URI=\"" + prefix + enc + "\""));
                    }
                    m.appendTail(sb);
                    out.append(sb).append('\n');
                } else {
                    out.append(line).append('\n');
                }
            } else {
                String resolved = resolveUrl(baseUrl, trimmed);
                String enc = Base64.encodeToString(resolved.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                out.append(prefix).append(enc).append('\n');
            }
        }
        return out.toString();
    }

    private void serveAsset(String pathOnly, String method, OutputStream out) throws IOException {
        AssetManager assets = context.getAssets();
        String rel = pathOnly.replaceAll("^/+", "");
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) {
            sendSimple(out, 404, "text/plain;charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        String assetPath = "public/" + rel;
        byte[] data = readAssetOrNull(assets, assetPath);
        if (data == null && !rel.contains(".")) {
            rel = "index.html";
            assetPath = "public/index.html";
            data = readAssetOrNull(assets, assetPath);
        }
        if (data == null) {
            sendSimple(out, 404, "text/plain;charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8), method);
            return;
        }
        sendSimple(out, 200, mimeFor(rel), data, method);
    }

    private static byte[] readAssetOrNull(AssetManager assets, String path) {
        try (InputStream is = assets.open(path)) {
            return readAllBytes(is);
        } catch (IOException e) {
            return null;
        }
    }

    private static String mimeFor(String name) {
        String low = name.toLowerCase(Locale.ROOT);
        if (low.endsWith(".html")) return "text/html;charset=utf-8";
        if (low.endsWith(".js") || low.endsWith(".mjs")) return "application/javascript;charset=utf-8";
        if (low.endsWith(".css")) return "text/css;charset=utf-8";
        if (low.endsWith(".svg")) return "image/svg+xml";
        if (low.endsWith(".png")) return "image/png";
        if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg";
        if (low.endsWith(".webp")) return "image/webp";
        if (low.endsWith(".ico")) return "image/x-icon";
        if (low.endsWith(".json")) return "application/json;charset=utf-8";
        if (low.endsWith(".woff2")) return "font/woff2";
        if (low.endsWith(".woff")) return "font/woff";
        if (low.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private static void sendSimple(OutputStream out, int status, String contentType, byte[] body, String method) throws IOException {
        String reason = status == 200 ? "OK" : (status == 410 ? "Gone" : (status == 404 ? "Not Found" : "Status"));
        String hdr = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n";
        out.write(hdr.getBytes(StandardCharsets.US_ASCII));
        if (!"HEAD".equals(method)) {
            out.write(body);
        }
        out.flush();
    }

    private static byte[] readAllBytes(InputStream is) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        return baos.toByteArray();
    }

    private static String readLineCrlf(InputStream in) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int b;
        boolean any = false;
        while ((b = in.read()) != -1) {
            any = true;
            if (b == '\n') break;
            if (b != '\r') baos.write(b);
        }
        if (!any && baos.size() == 0) throw new EOFException();
        return new String(baos.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static String urlEncode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }
}

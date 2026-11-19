package com.xuper.tv

import android.app.Activity
import android.content.pm.ActivityInfo
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

class XuperNativeModule(private val reactCtx: ReactApplicationContext) : ReactContextBaseJavaModule(reactCtx) {

    private val executor = Executors.newCachedThreadPool()
    private val localServer: XuperLocalServer = XuperLocalServer.getInstance(reactCtx.applicationContext, 8910)

    override fun getName(): String = "XuperNative"

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getLocalServerPort(): Int {
        return localServer.port
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun des3EncryptBase64(plainUtf8: String, keyHex: String): String {
        val keyBytes = hexToBytes(keyHex)
        val spec = SecretKeySpec(keyBytes, "DESede")
        val cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, spec)
        val encrypted = cipher.doFinal(plainUtf8.toByteArray(StandardCharsets.UTF_8))
        return Base64.encodeToString(encrypted, Base64.NO_WRAP)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun des3DecryptUtf8(cipherBase64: String, keyHex: String): String {
        val keyBytes = hexToBytes(keyHex)
        val spec = SecretKeySpec(keyBytes, "DESede")
        val cipher = Cipher.getInstance("DESede/ECB/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, spec)
        val cipherBytes = Base64.decode(cipherBase64, Base64.DEFAULT)
        val decrypted = cipher.doFinal(cipherBytes)
        return String(decrypted, StandardCharsets.UTF_8)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun registerStream(url: String, headersJson: String, duration: Double, backupsJson: String, isLive: Boolean): String {
        return localServer.registerStream(url, headersJson, duration, backupsJson, isLive)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun registerSubtitle(url: String): String {
        return localServer.registerSubtitle(url)
    }

    @ReactMethod
    fun setLandscape(landscape: Boolean) {
        val act: Activity = reactCtx.currentActivity ?: return
        act.runOnUiThread {
            act.requestedOrientation = if (landscape) {
                ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }

    @ReactMethod
    fun httpRequest(optsJson: String, bodyStr: String?, promise: Promise) {
        executor.execute {
            var conn: HttpURLConnection? = null
            try {
                val opts = JSONObject(optsJson)
                val urlStr = opts.optString("url", "")
                val method = opts.optString("method", "GET").uppercase()
                val timeoutMs = opts.optInt("timeoutMs", 15000)
                val reqHeaders = opts.optJSONObject("headers")

                conn = localServer.openUpstreamConnection(URL(urlStr), timeoutMs, timeoutMs)
                conn.requestMethod = method
                conn.instanceFollowRedirects = true

                if (reqHeaders != null) {
                    val keys = reqHeaders.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        if (k.equals("Content-Length", ignoreCase = true)) continue
                        conn.setRequestProperty(k, reqHeaders.optString(k, ""))
                    }
                }

                if (!bodyStr.isNullOrEmpty() && (method == "POST" || method == "PUT")) {
                    conn.doOutput = true
                    val bytes = bodyStr.toByteArray(StandardCharsets.UTF_8)
                    conn.outputStream.use { it.write(bytes) }
                }

                val status = conn.responseCode
                var stream = if (status >= 400) conn.errorStream else conn.inputStream
                var bodyB64 = ""
                if (stream != null) {
                    if ("gzip".equals(conn.contentEncoding, ignoreCase = true) || urlStr.lowercase().endsWith(".gz")) {
                        stream = GZIPInputStream(stream)
                    }
                    val baos = ByteArrayOutputStream()
                    val buf = ByteArray(16384)
                    var n: Int
                    while (stream.read(buf).also { n = it } != -1) {
                        baos.write(buf, 0, n)
                    }
                    stream.close()
                    bodyB64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
                }

                val respHeaders = JSONObject()
                val hdrMap = conn.headerFields
                if (hdrMap != null) {
                    for ((k, v) in hdrMap) {
                        if (k != null && !v.isNullOrEmpty()) {
                            respHeaders.put(k.lowercase(), v[0])
                        }
                    }
                }

                val result = Arguments.createMap().apply {
                    putInt("status", status)
                    putString("headersJson", respHeaders.toString())
                    putString("bodyBase64", bodyB64)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("HTTP_ERR", e.message ?: e.javaClass.simpleName, e)
            } finally {
                try { conn?.disconnect() } catch (_: Exception) {}
            }
        }
    }

    private data class EpgProg(val title: String, val startMs: Long, val endMs: Long)
    private data class EpgChan(val id: String, val normName: String, val displayName: String)
    private data class CachedGuide(
        val fetchedAt: Long,
        val channels: List<EpgChan>,
        val programsById: Map<String, List<EpgProg>>
    )

    companion object {
        private val epgCache = ConcurrentHashMap<String, CachedGuide>()
        private const val EPG_TTL_MS = 2L * 60L * 60L * 1000L
    }

    @ReactMethod
    fun fetchEpgForChannels(urlStr: String, channelsJson: String, offsetMinutes: Int, promise: Promise) {
        executor.execute {
            try {
                var guide = epgCache[urlStr]
                if (guide == null || System.currentTimeMillis() - guide.fetchedAt > EPG_TTL_MS) {
                    guide = downloadAndParseXmltv(urlStr)
                    if (guide != null) {
                        epgCache[urlStr] = guide
                    }
                }
                if (guide == null) {
                    promise.resolve("{}")
                    return@execute
                }

                val reqChannels = JSONArray(channelsJson)
                val offsetMs = offsetMinutes.toLong() * 60000L
                val effectiveNow = System.currentTimeMillis() + offsetMs
                val hmFmt = SimpleDateFormat("HH:mm", Locale.US)
                val out = JSONObject()

                for (i in 0 until reqChannels.length()) {
                    val chObj = reqChannels.optJSONObject(i) ?: continue
                    val chId = chObj.optString("id", "")
                    val chName = chObj.optString("name", "")
                    val targetNorm = normalizeChannelName(chName)
                    if (chId.isEmpty() || targetNorm.isEmpty()) continue

                    var match = guide.channels.firstOrNull { it.normName == targetNorm }
                    if (match == null && targetNorm.length >= 4) {
                        match = guide.channels.firstOrNull {
                            it.normName.length >= 4 && (it.normName.contains(targetNorm) || targetNorm.contains(it.normName))
                        }
                    }
                    if (match == null) continue
                    val progs = guide.programsById[match.id] ?: continue

                    var nowProg: EpgProg? = null
                    var nextProg: EpgProg? = null
                    for (j in progs.indices) {
                        val p = progs[j]
                        if (p.startMs <= effectiveNow && effectiveNow < p.endMs) {
                            nowProg = p
                            if (j + 1 < progs.size) nextProg = progs[j + 1]
                            break
                        }
                        if (p.startMs > effectiveNow) {
                            nextProg = p
                            break
                        }
                    }
                    if (nowProg == null && nextProg == null) continue

                    val entry = JSONObject()
                    entry.put("channelId", chId)
                    entry.put("displayName", match.displayName)
                    if (nowProg != null) {
                        val nowJson = JSONObject().apply {
                            put("title", nowProg.title)
                            put("startMs", nowProg.startMs)
                            put("endMs", nowProg.endMs)
                            put("startLabel", hmFmt.format(Date(nowProg.startMs - offsetMs)))
                            put("endLabel", hmFmt.format(Date(nowProg.endMs - offsetMs)))
                        }
                        entry.put("now", nowJson)
                        val dur = (nowProg.endMs - nowProg.startMs).coerceAtLeast(1L)
                        val pct = (((effectiveNow - nowProg.startMs).toDouble() / dur.toDouble()) * 100.0).toInt().coerceIn(0, 100)
                        entry.put("progressPct", pct)
                    } else {
                        entry.put("now", JSONObject.NULL)
                        entry.put("progressPct", 0)
                    }
                    if (nextProg != null) {
                        val nextJson = JSONObject().apply {
                            put("title", nextProg.title)
                            put("startMs", nextProg.startMs)
                            put("endMs", nextProg.endMs)
                            put("startLabel", hmFmt.format(Date(nextProg.startMs - offsetMs)))
                            put("endLabel", hmFmt.format(Date(nextProg.endMs - offsetMs)))
                        }
                        entry.put("next", nextJson)
                    } else {
                        entry.put("next", JSONObject.NULL)
                    }
                    out.put(chId, entry)
                }

                promise.resolve(out.toString())
            } catch (e: Exception) {
                promise.resolve("{}")
            }
        }
    }

    private fun downloadAndParseXmltv(urlStr: String): CachedGuide? {
        var conn: HttpURLConnection? = null
        return try {
            conn = localServer.openUpstreamConnection(URL(urlStr), 15000, 25000)
            conn.requestMethod = "GET"
            conn.instanceFollowRedirects = true
            if (conn.responseCode >= 400) return null
            val rawStream = conn.inputStream ?: return null
            val stream = if ("gzip".equals(conn.contentEncoding, ignoreCase = true) || urlStr.lowercase().endsWith(".gz")) {
                GZIPInputStream(BufferedInputStream(rawStream, 32768))
            } else {
                BufferedInputStream(rawStream, 32768)
            }

            val factory = XmlPullParserFactory.newInstance()
            val parser = factory.newPullParser()
            parser.setInput(stream, "UTF-8")

            val channels = ArrayList<EpgChan>()
            val programsById = HashMap<String, ArrayList<EpgProg>>()
            val nowMs = System.currentTimeMillis()
            val minKeep = nowMs - 4L * 3600L * 1000L
            val maxKeep = nowMs + 14L * 3600L * 1000L

            var curChanId: String? = null
            var curChanName = ""
            var curProgChan: String? = null
            var curProgStart = 0L
            var curProgStop = 0L
            var curProgTitle = ""
            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                when (event) {
                    XmlPullParser.START_TAG -> {
                        when (parser.name) {
                            "channel" -> {
                                curChanId = parser.getAttributeValue(null, "id") ?: ""
                                curChanName = ""
                            }
                            "display-name" -> {
                                if (curChanId != null && curChanName.isEmpty()) {
                                    curChanName = parser.nextText().trim()
                                }
                            }
                            "programme" -> {
                                curProgChan = parser.getAttributeValue(null, "channel")
                                curProgStart = parseXmltvTime(parser.getAttributeValue(null, "start"))
                                curProgStop = parseXmltvTime(parser.getAttributeValue(null, "stop"))
                                curProgTitle = ""
                            }
                            "title" -> {
                                if (curProgChan != null && curProgTitle.isEmpty()) {
                                    curProgTitle = parser.nextText().trim()
                                }
                            }
                        }
                    }
                    XmlPullParser.END_TAG -> {
                        when (parser.name) {
                            "channel" -> {
                                val id = curChanId
                                if (!id.isNullOrEmpty()) {
                                    val dn = if (curChanName.isNotEmpty()) curChanName else id
                                    channels.add(EpgChan(id, normalizeChannelName(dn), dn))
                                }
                                curChanId = null
                            }
                            "programme" -> {
                                val ch = curProgChan
                                if (!ch.isNullOrEmpty() && curProgTitle.isNotEmpty() && curProgStart > 0L && curProgStop > 0L && curProgStop >= minKeep && curProgStart <= maxKeep) {
                                    val list = programsById.getOrPut(ch) { ArrayList() }
                                    list.add(EpgProg(curProgTitle, curProgStart, curProgStop))
                                }
                                curProgChan = null
                            }
                        }
                    }
                }
                event = parser.next()
            }
            stream.close()
            for (list in programsById.values) {
                list.sortBy { it.startMs }
            }
            CachedGuide(System.currentTimeMillis(), channels, programsById)
        } catch (_: Exception) {
            null
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    private fun normalizeChannelName(name: String): String {
        val noAccents = Normalizer.normalize(name.lowercase(Locale.US), Normalizer.Form.NFD)
            .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
        val stripped = noAccents.replace(Regex("\\b(fhd|uhd|4k|hd|sd|tv|channel|canal|latino|latam|espanol|es|mx|co|ar)\\b"), " ")
        return stripped.replace(Regex("[^a-z0-9]"), "")
    }

    private fun parseXmltvTime(str: String?): Long {
        if (str == null || str.length < 14) return 0L
        return try {
            val sdf = SimpleDateFormat("yyyyMMddHHmmss", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            var ms = sdf.parse(str.substring(0, 14))?.time ?: return 0L
            val tzMatch = Regex("([+-])(\\d{2})(\\d{2})").find(str.substring(14))
            if (tzMatch != null) {
                val sign = if (tzMatch.groupValues[1] == "-") -1L else 1L
                val h = tzMatch.groupValues[2].toLong()
                val m = tzMatch.groupValues[3].toLong()
                ms -= sign * (h * 60L + m) * 60000L
            }
            ms
        } catch (_: Exception) {
            0L
        }
    }

    private fun hexToBytes(hex: String): ByteArray {
        val clean = hex.replace(Regex("[^0-9a-fA-F]"), "")
        val len = clean.length / 2
        val out = ByteArray(len)
        for (i in 0 until len) {
            out[i] = clean.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return out
    }
}

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const androidDir = path.join(rootDir, "android");
const appDir = path.join(androidDir, "app");
const distWebDir = path.join(rootDir, "xuper-web", "dist");
const assetsDir = path.join(appDir, "src", "main", "assets");
const assetsPublicDir = path.join(assetsDir, "public");
const seedsFallbackSrc = path.join(
  rootDir,
  "webos",
  "services",
  "com.webosflux.xuptertv.fidelity.service",
  "seeds-fallback.json"
);
const resDir = path.join(appDir, "src", "main", "res");
const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
const javaSrcDir = path.join(appDir, "src", "main", "java");
const buildDir = path.join(androidDir, "sdk-build");
const outApkDir = path.join(rootDir, "dist-apk");
const outApkPath = path.join(outApkDir, "XuperTV.apk");

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    "C:\\Program Files\\Java\\jdk-23",
    "C:\\Program Files\\Java\\jdk-21",
    "C:\\Program Files\\Java\\jdk-17",
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "bin", "javac.exe"))) return c;
  }
  throw new Error("Could not find JDK with javac.exe");
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "AppData", "Local", "Android", "Sdk"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "build-tools")) && fs.existsSync(path.join(c, "platforms"))) {
      return c;
    }
  }
  throw new Error("Could not find Android SDK");
}

function latestSubdir(parent, requiredFile) {
  const dirs = fs.readdirSync(parent).sort().reverse();
  for (const d of dirs) {
    const full = path.join(parent, d);
    if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, requiredFile))) {
      return full;
    }
  }
  throw new Error(`No suitable directory with ${requiredFile} in ${parent}`);
}

function collectFiles(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(p, ext, acc);
    else if (!ext || entry.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

function runTool(toolPath, args, opts = {}) {
  console.log(">", path.basename(toolPath), args.join(" "));
  const isBat = toolPath.toLowerCase().endsWith(".bat") || toolPath.toLowerCase().endsWith(".cmd");
  if (isBat) {
    execFileSync("cmd.exe", ["/c", toolPath, ...args], { stdio: "inherit", ...opts });
  } else {
    execFileSync(toolPath, args, { stdio: "inherit", ...opts });
  }
}

const javaHome = findJavaHome();
const sdkDir = findAndroidSdk();
const buildToolsDir = latestSubdir(path.join(sdkDir, "build-tools"), "aapt2.exe");
const platformDir = latestSubdir(path.join(sdkDir, "platforms"), "android.jar");

const javac = path.join(javaHome, "bin", "javac.exe");
const jarTool = path.join(javaHome, "bin", "jar.exe");
const keytool = path.join(javaHome, "bin", "keytool.exe");
const androidJar = path.join(platformDir, "android.jar");
const aapt2 = path.join(buildToolsDir, "aapt2.exe");
const d8 = path.join(buildToolsDir, "d8.bat");
const zipalign = path.join(buildToolsDir, "zipalign.exe");
const apksigner = path.join(buildToolsDir, "apksigner.bat");

if (!fs.existsSync(seedsFallbackSrc)) {
  throw new Error(`Missing seeds-fallback.json at ${seedsFallbackSrc}`);
}

function crc32Buf(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Buf(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function generateBrandingPng(outPath, width, height) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  const cx = width / 2;
  const cy = height / 2;
  const arm = Math.min(width, height) * 0.27;
  const stroke = Math.min(width, height) * 0.085;
  const badgeHalfW = Math.min(width, height) * 0.42;

  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.25) * 0.5;
          const py = y + (sy + 0.25) * 0.5;
          const d1 = distToSegment(px, py, cx - arm, cy - arm, cx + arm, cy + arm);
          const d2 = distToSegment(px, py, cx - arm, cy + arm, cx + arm, cy - arm);
          const inX = Math.min(d1, d2) <= stroke;
          if (inX) {
            rSum += 229;
            gSum += 9;
            bSum += 20;
          } else if (Math.abs(px - cx) <= badgeHalfW && Math.abs(py - cy) <= badgeHalfW &&
                     Math.max(Math.abs(px - cx), Math.abs(py - cy)) >= badgeHalfW - 3) {
            rSum += 38;
            gSum += 22;
            bSum += 30;
          } else {
            rSum += 10;
            gSum += 10;
            bSum += 15;
          }
        }
      }
      const pOff = rowStart + 1 + x * 4;
      raw[pOff] = Math.round(rSum / 4);
      raw[pOff + 1] = Math.round(gSum / 4);
      raw[pOff + 2] = Math.round(bSum / 4);
      raw[pOff + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    sig,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
}

function normalizeZipEntrySlashes(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocdOff = -1;
  const minOff = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minOff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOff = i;
      break;
    }
  }
  if (eocdOff < 0) throw new Error(`EOCD not found in ${zipPath}`);

  const cdSize = buf.readUInt32LE(eocdOff + 12);
  const cdOffset = buf.readUInt32LE(eocdOff + 16);
  const cdEnd = cdOffset + cdSize;
  let pos = cdOffset;
  let fixedNames = 0;

  while (pos < cdEnd) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`Invalid CD signature at offset ${pos}`);
    }
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHdrOff = buf.readUInt32LE(pos + 42);

    let changed = false;
    for (let i = 0; i < nameLen; i++) {
      if (buf[pos + 46 + i] === 0x5c) {
        buf[pos + 46 + i] = 0x2f;
        changed = true;
      }
    }

    if (buf.readUInt32LE(localHdrOff) !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature at offset ${localHdrOff}`);
    }
    const lfNameLen = buf.readUInt16LE(localHdrOff + 26);
    for (let i = 0; i < lfNameLen; i++) {
      if (buf[localHdrOff + 30 + i] === 0x5c) {
        buf[localHdrOff + 30 + i] = 0x2f;
        changed = true;
      }
    }
    if (changed) fixedNames++;
    pos += 46 + nameLen + extraLen + commentLen;
  }

  fs.writeFileSync(zipPath, buf);
  console.log(`[build-apk] Normalized backslashes in ${fixedNames} ZIP entries`);
}

// 1. Sync web bundle assets + generate drawable launcher icon / TV banner
fs.rmSync(assetsPublicDir, { recursive: true, force: true });
fs.mkdirSync(assetsPublicDir, { recursive: true });
fs.cpSync(distWebDir, assetsPublicDir, { recursive: true });
fs.copyFileSync(seedsFallbackSrc, path.join(assetsDir, "seeds-fallback.json"));
generateBrandingPng(path.join(resDir, "drawable", "ic_launcher.png"), 192, 192);
generateBrandingPng(path.join(resDir, "drawable", "ic_banner.png"), 320, 180);

// 2. Clean build staging directory
fs.rmSync(buildDir, { recursive: true, force: true });
const genDir = path.join(buildDir, "gen");
const classesDir = path.join(buildDir, "classes");
const dexDir = path.join(buildDir, "dex");
fs.mkdirSync(genDir, { recursive: true });
fs.mkdirSync(classesDir, { recursive: true });
fs.mkdirSync(dexDir, { recursive: true });
fs.mkdirSync(outApkDir, { recursive: true });

const resZip = path.join(buildDir, "res.zip");
const unalignedNoDex = path.join(buildDir, "unaligned-nodex.apk");
const unalignedApk = path.join(buildDir, "unaligned.apk");
const alignedApk = path.join(buildDir, "aligned.apk");
const classesJar = path.join(buildDir, "classes.jar");

// 3. Compile & link Android resources + manifest + assets
const stagedManifestPath = path.join(buildDir, "AndroidManifest.xml");
let manifestXml = fs.readFileSync(manifestPath, "utf8");
if (!/\bpackage\s*=/.test(manifestXml)) {
  manifestXml = manifestXml.replace("<manifest ", '<manifest package="com.xuper.tv" ');
}
fs.writeFileSync(stagedManifestPath, manifestXml, "utf8");

runTool(aapt2, ["compile", "--dir", resDir, "-o", resZip]);
runTool(aapt2, [
  "link",
  "-o", unalignedNoDex,
  "-I", androidJar,
  "--manifest", stagedManifestPath,
  "-A", assetsDir,
  "-R", resZip,
  "--java", genDir,
  "--min-sdk-version", "24",
  "--target-sdk-version", "35",
  "--version-code", "1",
  "--version-name", "1.0.0",
  "--auto-add-overlay",
]);

// 4. Compile Java sources
const javaFiles = [...collectFiles(genDir, ".java"), ...collectFiles(javaSrcDir, ".java")];
runTool(javac, [
  "-source", "11",
  "-target", "11",
  "-Xlint:-options",
  "-encoding", "UTF-8",
  "-cp", androidJar,
  "-d", classesDir,
  ...javaFiles,
]);

// 5. Jar compiled classes & convert to classes.dex via d8
runTool(jarTool, ["cf", classesJar, "-C", classesDir, "."]);
runTool(d8, ["--lib", androidJar, "--min-api", "24", "--output", dexDir, classesJar], {
  env: { ...process.env, JAVA_HOME: javaHome },
});

// 6. Add classes.dex to APK, normalize ZIP entry slashes for Android AssetManager, & zipalign
fs.copyFileSync(unalignedNoDex, unalignedApk);
runTool(jarTool, ["uf", unalignedApk, "-C", dexDir, "classes.dex"]);
normalizeZipEntrySlashes(unalignedApk);
runTool(zipalign, ["-f", "-p", "4", unalignedApk, alignedApk]);

// 7. Generate debug keystore if needed & sign APK
const keystorePath = path.join(androidDir, "debug.keystore");
if (!fs.existsSync(keystorePath)) {
  runTool(keytool, [
    "-genkeypair", "-v",
    "-keystore", keystorePath,
    "-alias", "androiddebugkey",
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10000",
    "-storepass", "android",
    "-keypass", "android",
    "-dname", "CN=Android Debug,O=Android,C=US",
  ]);
}

runTool(
  apksigner,
  [
    "sign",
    "--ks", keystorePath,
    "--ks-pass", "pass:android",
    "--key-pass", "pass:android",
    "--ks-key-alias", "androiddebugkey",
    "--out", outApkPath,
    alignedApk,
  ],
  { env: { ...process.env, JAVA_HOME: javaHome } }
);

runTool(apksigner, ["verify", "--verbose", outApkPath], {
  env: { ...process.env, JAVA_HOME: javaHome },
});

const size = fs.statSync(outApkPath).size;
console.log(`\n[build-apk] SUCCESS: ${outApkPath} (${size} bytes)`);

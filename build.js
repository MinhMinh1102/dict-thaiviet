// ══════════════════════════════════════════════════════════════════
// build.js — ALAY
// Build step TỐI GIẢN cho Netlify: copy toàn bộ site sang dist/, sau đó minify
// JS/CSS/HTML tại chỗ — GIỮ NGUYÊN tên file và đường dẫn (app.js vẫn là app.js,
// modules/keyboard.js vẫn ở modules/keyboard.js...) nên không cần sửa bất kỳ
// đường dẫn nào trong index.html hay các lệnh import() động trong app.js.
//
// KHÔNG bundle (không gộp nhiều file JS thành 1) — cố tình giữ vậy để không phá
// cấu trúc lazy-load (import() động) đã tách trong app.js/modules/*.js.
//
// Cách chạy: npm install && npm run build  (Netlify tự chạy 2 lệnh này khi deploy,
// xem "command" trong netlify.toml). Chạy thử ở máy mình: cd vào thư mục có
// package.json này rồi gõ đúng 2 lệnh trên — dist/ sẽ chứa bản đã minify.
// ══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { minify: minifyHtml } = require('html-minifier-terser');

// build.js đặt NGAY TẠI GỐC REPO (cùng cấp với index.html/app.js/style.css/modules/),
// nên thư mục nguồn chính là thư mục chứa file này.
const SRC_DIR = __dirname;
const OUT_DIR = path.join(__dirname, 'dist');

// Không copy các thứ này sang dist/ (công cụ build, git, dist cũ...)
const EXCLUDE_TOP_LEVEL = new Set([
  'node_modules', '.git', '.netlify', 'dist',
  'package.json', 'package-lock.json', 'build.js', 'netlify.toml', '.gitignore'
]);

// File JS KHÔNG minify (giữ nguyên byte-cho-byte) — service worker nhạy cảm với
// thay đổi nội dung (ảnh hưởng cơ chế "updatefound" của trình duyệt), nên cố tình
// bỏ qua để tránh rủi ro không đáng, dù minify sw.js về lý thuyết vẫn an toàn.
const JS_SKIP_MINIFY = new Set(['sw.js']);

function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyRecursive(src, dest, isTopLevel) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    if (isTopLevel && EXCLUDE_TOP_LEVEL.has(entry.name)) continue;
    if (!isTopLevel && entry.name === 'node_modules') continue; // phòng hờ nếu có thư mục con lạ
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(s, d, false);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function walkFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(p, exts));
    else if (exts.some(ext => entry.name.endsWith(ext))) out.push(p);
  }
  return out;
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function main() {
  console.log('── Dọn dist/ cũ ──');
  rimraf(OUT_DIR);

  console.log('── Copy toàn bộ site sang dist/ ──');
  copyRecursive(SRC_DIR, OUT_DIR, true);

  let totalBefore = 0, totalAfter = 0;

  console.log('── Minify JS (esbuild, KHÔNG bundle — giữ nguyên từng file riêng) ──');
  for (const file of walkFiles(OUT_DIR, ['.js'])) {
    const rel = path.relative(OUT_DIR, file);
    const base = path.basename(file);
    if (JS_SKIP_MINIFY.has(base)) {
      console.log(`  bỏ qua (giữ nguyên): ${rel}`);
      continue;
    }
    const before = fs.statSync(file).size;
    const src = fs.readFileSync(file, 'utf8');
    const result = await esbuild.transform(src, {
      minify: true,
      target: 'es2019',   // an toàn cho mọi trình duyệt hiện đại, không đổi cú pháp lên bản mới hơn
      loader: 'js'
    });
    fs.writeFileSync(file, result.code);
    const after = Buffer.byteLength(result.code, 'utf8');
    totalBefore += before; totalAfter += after;
    console.log(`  ${rel}: ${humanSize(before)} → ${humanSize(after)} (-${(100 - after / before * 100).toFixed(0)}%)`);
  }

  console.log('── Minify CSS (esbuild) ──');
  for (const file of walkFiles(OUT_DIR, ['.css'])) {
    const rel = path.relative(OUT_DIR, file);
    const before = fs.statSync(file).size;
    const src = fs.readFileSync(file, 'utf8');
    const result = await esbuild.transform(src, { minify: true, loader: 'css' });
    fs.writeFileSync(file, result.code);
    const after = Buffer.byteLength(result.code, 'utf8');
    totalBefore += before; totalAfter += after;
    console.log(`  ${rel}: ${humanSize(before)} → ${humanSize(after)} (-${(100 - after / before * 100).toFixed(0)}%)`);
  }

  console.log('── Minify HTML (html-minifier-terser) ──');
  for (const file of walkFiles(OUT_DIR, ['.html'])) {
    const rel = path.relative(OUT_DIR, file);
    const before = fs.statSync(file).size;
    const src = fs.readFileSync(file, 'utf8');
    const out = await minifyHtml(src, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: false, // giữ nguyên, tránh đổi hành vi thuộc tính mặc định
      minifyCSS: true,   // gọn phần CSS nằm trong thẻ <style>
      minifyJS: false    // KHÔNG đụng vào <script> inline — JS chính đã minify riêng ở bước trên,
                          // để tránh rủi ro không đáng với vài đoạn script nhỏ nằm trực tiếp trong HTML
    });
    fs.writeFileSync(file, out);
    const after = Buffer.byteLength(out, 'utf8');
    totalBefore += before; totalAfter += after;
    console.log(`  ${rel}: ${humanSize(before)} → ${humanSize(after)} (-${(100 - after / before * 100).toFixed(0)}%)`);
  }

  console.log('──────────────────────────────────────────');
  console.log(`Tổng: ${humanSize(totalBefore)} → ${humanSize(totalAfter)} (-${(100 - totalAfter / totalBefore * 100).toFixed(0)}%)`);
  console.log('Build xong → dist/');
}

main().catch(err => { console.error(err); process.exit(1); });

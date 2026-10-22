// ══════════════════════════════════════════════════════════════════
// netlify/edge-functions/word-seo.ts — ALAY
// "Đúc sẵn" nội dung từng từ vào HTML mà Google đọc được, KHÔNG cần chạy JavaScript.
//
// Vấn đề: alay là SPA — /tu/<id>-<slug> luôn trả về cùng 1 index.html rỗng, nội dung từ chỉ xuất hiện SAU KHI JS tải dữ liệu từ Supabase. Google có chạy JS
// nhưng chậm, không đảm bảo, còn Bing/Zalo/Facebook... thường không chạy → thấy trang trống.
//
// Cách làm: hàm này chạy TRƯỚC khi Netlify trả trang (edge function chạy trước redirect), với các đường dẫn bên dưới:
//   /tu/<id>-<slug>   lấy từ từ Supabase → trả CHÍNH index.html của app nhưng đã thay <title>, meta, canonical, Open Graph, thêm JSON-LD
//                     và một khối nội dung <article id="seoWord"> (định nghĩa, ví dụ, từ liên quan) → app vẫn chạy y như cũ
//                     (app.js tự gỡ khối này khi hiển thị từ — xem loadWordFromLocation()).
//                     slug sai/cũ → 301 về địa chỉ đúng; từ không tồn tại/đang ẩn → 404 + noindex (người dùng vẫn thấy app).
//   /tu, /tu/         trang Danh mục từ (độc lập, đọc được không cần JS) — để Google/người dùng duyệt qua mọi từ
//   /sitemap.xml      sơ đồ trang động (luôn cập nhật khi admin thêm từ, không cần deploy lại)
//   /robots.txt       trỏ tới sitemap theo đúng tên miền đang chạy
// Mọi lỗi (Supabase chậm/sập, dữ liệu lạ...) đều RƠI VỀ app bình thường (không bao giờ làm hỏng việc tra từ).
//
// Lưu ý: biến môi trường của netlify.toml KHÔNG dùng được trong edge function nên URL + khóa anon (công khai, y hệt supabase.js) viết thẳng ở dưới.
// Không import thư viện ngoài để tránh lỗi bundle; dùng toàn API chuẩn web (fetch/Request/Response).
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://luoqsudzbmkzxosbdmmp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3FzdWR6Ym1renhvc2JkbW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjkxMTcsImV4cCI6MjA5ODE0NTExN30.0k87aqhSyFpFAah3H-MQ4QObWV3CCT77AcLcUx23KKg';
const BRAND = 'alay – Từ điển Thái Việt';
const FETCH_TIMEOUT_MS = 4000;

// ── Tiện ích chuỗi ─────────────────────────────────────────────────────────────
// Escape cho NỘI DUNG thẻ (không cần thoát dấu nháy) — dùng cho <title> để khớp đúng chữ mà app.js đặt ở trình duyệt
function escText(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
}
function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}
// Y HỆT slugify()/wordSlug()/wordPath() trong app.js (phải khớp từng ký tự để URL do app tạo và URL do hàm này trả luôn trùng nhau)
function slugify(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function wordSlug(w: { id: number | string; phonetic?: string; thai?: string }): string {
  const base = slugify(w.phonetic || '') || slugify(w.thai || '') || 'tu';
  return w.id + '-' + base;
}
function wordPath(w: { id: number | string; phonetic?: string; thai?: string }): string {
  return '/tu/' + wordSlug(w);
}

const ALLOWED_TAGS = new Set(['p', 'br', 'em', 'strong', 'b', 'i', 'u', 'ul', 'ol', 'li']);
// Nội dung rich text do admin nhập: chỉ giữ vài thẻ định dạng cơ bản, bỏ mọi thuộc tính và mọi thẻ khác (chống chèn script/iframe/onclick)
function sanitizeRich(html: unknown): string {
  let s = String(html == null ? '' : html);
  s = s.replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag: string) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (t === 'br') return '<br>';
    return m.charAt(1) === '/' ? '</' + t + '>' : '<' + t + '>';
  });
  return s;
}
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&apos;/gi, "'").replace(/&amp;/gi, '&');
}
// Văn bản thuần (cho title/meta/JSON-LD): bỏ thẻ, giải mã entity, gộp khoảng trắng
function toPlain(html: unknown): string {
  const noTags = String(html == null ? '' : html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

// ── Truy cập Supabase ───────────────────────────────────────────────────────
async function sbRows(path: string): Promise<any[] | null> {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? data : null;
  } catch (_e) {
    return null; // null = lỗi mạng/Supabase (khác với [] = truy vấn thành công nhưng không có dòng nào)
  }
}
// Lấy hết danh sách từ (id, thai, phonetic) theo trang 1000 dòng (giới hạn mặc định của PostgREST)
async function allWordRefs(): Promise<any[] | null> {
  const out: any[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const page = await sbRows('words?select=id,thai,phonetic,meanings,visible&order=id.asc&limit=1000&offset=' + offset);
    if (page === null) return out.length ? out : null;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out.filter((w) => w.visible !== false);
}

// ── Dựng nội dung trang từ ──────────────────────────────────────────────────
type RelMap = Record<string, { id: number; phonetic?: string; thai: string }>;

function relatedTokens(word: any): string[] {
  const set = new Set<string>();
  (word.definitions || []).forEach((d: any) => {
    ['synonyms', 'antonyms', 'related', 'idioms'].forEach((k) => {
      (d && d[k] || []).forEach((it: any) => {
        String((it && it.thai) || '').split(/\s+/).filter(Boolean).forEach((t) => set.add(t));
      });
    });
  });
  set.delete(word.thai);
  return Array.from(set).slice(0, 40);
}
function relList(label: string, items: any[], rel: RelMap): string {
  if (!items || !items.length) return '';
  const parts: string[] = [];
  items.forEach((it) => {
    const thai = String((it && it.thai) || '').trim();
    const viet = String((it && it.viet) || '').trim();
    thai.split(/\s+/).filter(Boolean).forEach((t) => {
      const m = rel[t];
      parts.push(m ? '<a href="' + esc(wordPath(m)) + '" lang="th">' + esc(t) + '</a>' : '<span lang="th">' + esc(t) + '</span>');
    });
    if (viet) parts.push('<span>' + esc(viet) + '</span>');
  });
  return parts.length ? '<p><strong>' + esc(label) + ':</strong> ' + parts.join(' · ') + '</p>' : '';
}

function buildWordSeo(word: any, rel: RelMap, origin: string) {
  const defs: any[] = Array.isArray(word.definitions) ? word.definitions : [];
  const meaningsArr: string[] = Array.isArray(word.meanings) ? word.meanings : (word.meanings ? [word.meanings] : []);
  const firstDef = defs[0] || {};
  const meaning = toPlain(firstDef.viet_meaning || meaningsArr[0] || '');
  const phonetic = word.phonetic ? String(word.phonetic) : '';
  const url = origin + wordPath(word);

  // Giữ nguyên mẫu title/description mà app.js (updateWordSEO) đặt ở phía trình duyệt — nhờ vậy bản dựng sẵn và bản app cập nhật sau đó luôn giống nhau
  const title = word.thai + (phonetic ? ' (' + phonetic + ')' : '') + (meaning ? ' - nghĩa là "' + meaning + '"' : ' - nghĩa là gì') + ' | alay';
  const description = truncate(word.thai + (phonetic ? ', đọc là ' + phonetic : '') + (meaning ? ', nghĩa: ' + meaning : '') + '. Tra từ điển Thái - Việt miễn phí tại alay.', 300);

  const defsHtml = defs.map((d, i) => {
    const vietRich = sanitizeRich(d.viet_meaning || '');
    const thaiRich = sanitizeRich(d.thai_meaning || '');
    const examples: any[] = Array.isArray(d.examples) ? d.examples : [];
    const exHtml = examples.map((ex) => {
      const t = toPlain(ex && ex.thai), v = toPlain(ex && ex.viet);
      if (!t && !v) return '';
      const video = ex && ex.video && ex.video.youtubeId ? ' <a href="https://www.youtube.com/watch?v=' + esc(encodeURIComponent(ex.video.youtubeId)) + '" rel="noopener nofollow">(video)</a>' : '';
      return '<li>' + (t ? '<span lang="th">' + esc(t) + '</span>' : '') + (v ? ' — <span>' + esc(v) + '</span>' : '') + video + '</li>';
    }).join('');
    const img = d.image && d.image.url ? '<p><img src="' + esc(d.image.url) + '" alt="' + esc(toPlain(d.viet_meaning || word.thai)) + '" loading="lazy" style="max-width:100%;height:auto"></p>' : '';
    return '<section><h3>' + (defs.length > 1 ? 'Nghĩa ' + (i + 1) : 'Nghĩa') + (d.type ? ' (' + esc(d.type) + ')' : '') + '</h3>'
      + (vietRich ? '<div>' + vietRich + '</div>' : '')
      + (thaiRich ? '<div lang="th">' + thaiRich + '</div>' : '')
      + img
      + (exHtml ? '<h4>Ví dụ</h4><ul>' + exHtml + '</ul>' : '')
      + relList('Từ đồng nghĩa', d.synonyms, rel) + relList('Từ trái nghĩa', d.antonyms, rel)
      + relList('Thành ngữ', d.idioms, rel) + relList('Từ liên quan', d.related, rel)
      + '</section>';
  }).join('');
  // Từ chưa có định nghĩa chi tiết (mới thêm): vẫn liệt kê các nghĩa ngắn
  const fallbackMeanings = !defs.length && meaningsArr.length
    ? '<section><h3>Nghĩa</h3><ul>' + meaningsArr.map((m) => '<li>' + esc(toPlain(m)) + '</li>').join('') + '</ul></section>' : '';

  const article =
    '<article id="seoWord" lang="vi" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">'
    + '<h1><span lang="th">' + esc(word.thai) + '</span>' + (phonetic ? ' <small>(' + esc(phonetic) + ')</small>' : '') + ' — nghĩa tiếng Việt</h1>'
    + (word.type ? '<p>Loại từ: ' + esc(word.type) + '</p>' : '')
    + (word.structure ? '<p>Cấu tạo: <span lang="th">' + esc(toPlain(word.structure)) + '</span></p>' : '')
    + defsHtml + fallbackMeanings
    + '<nav aria-label="Điều hướng"><a href="/">alay – Từ điển Thái Việt</a> · <a href="/tu/">Danh mục từ</a></nav>'
    + '</article>'
    // Người dùng tắt JavaScript thì app không chạy được: cho khối nội dung hiện ra bình thường thay vì giấu ngoài màn hình
    + '<noscript><style>#seoWord{position:static!important;width:auto!important;height:auto!important;overflow:visible!important;max-width:760px;margin:0 auto;padding:16px;font-family:system-ui,sans-serif}</style></noscript>';

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'DefinedTerm', '@id': url + '#term', name: word.thai, ...(phonetic ? { alternateName: phonetic } : {}),
        description: meaning || ('Nghĩa của từ ' + word.thai + ' trong tiếng Thái'), inLanguage: 'th', url,
        inDefinedTermSet: { '@type': 'DefinedTermSet', name: BRAND, url: origin + '/' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'alay', item: origin + '/' },
          { '@type': 'ListItem', position: 2, name: 'Danh mục từ', item: origin + '/tu/' },
          { '@type': 'ListItem', position: 3, name: word.thai, item: url },
        ],
      },
    ],
  };
  // "<" trong JSON → \u003c để chuỗi "</script>" trong dữ liệu không thoát khỏi thẻ <script>
  const jsonLd = '<script type="application/ld+json" id="seoJsonLd" data-word-id="' + esc(word.id) + '">' + JSON.stringify(graph).replace(/</g, '\\u003c') + '</script>';
  return { title, description, url, article, jsonLd };
}

// ── Chèn vào index.html của app ────────────────────────────────────────────
// Sửa thuộc tính trong thẻ có id=... (chịu được dấu nháy đơn/kép và thứ tự thuộc tính sau khi build đã minify)
function patchTagAttr(html: string, id: string, attr: string, value: string): string {
  const tagRe = new RegExp('<(?:meta|link)\\b[^>]*\\bid=["\']' + id + '["\'][^>]*>', 'i');
  return html.replace(tagRe, (tag) => {
    const attrRe = new RegExp('(\\b' + attr + '=)("[^"]*"|\'[^\']*\')', 'i');
    return attrRe.test(tag) ? tag.replace(attrRe, (_m, p1: string) => p1 + '"' + esc(value) + '"') : tag.replace(/\s*\/?>$/, ' ' + attr + '="' + esc(value) + '">');
  });
}
function injectIntoShell(shell: string, seo: { title: string; description: string; url: string; article: string; jsonLd: string }, noindex: boolean): string {
  let html = shell;
  html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, (t) => t.replace(/>[\s\S]*<\/title>/i, '>' + escText(seo.title) + '</title>'));
  html = patchTagAttr(html, 'metaDescription', 'content', seo.description);
  html = patchTagAttr(html, 'canonicalLink', 'href', seo.url);
  html = patchTagAttr(html, 'ogTitle', 'content', seo.title);
  html = patchTagAttr(html, 'ogDescription', 'content', seo.description);
  html = patchTagAttr(html, 'ogUrl', 'content', seo.url);
  html = patchTagAttr(html, 'twitterTitle', 'content', seo.title);
  html = patchTagAttr(html, 'twitterDescription', 'content', seo.description);
  const headAdd = (noindex ? '<meta name="robots" content="noindex">' : '') + seo.jsonLd;
  html = html.replace(/<\/head>/i, () => headAdd + '</head>');
  html = html.replace(/<body\b[^>]*>/i, (b) => b + seo.article);
  return html;
}

// ── Các trang phụ ─────────────────────────────────────────────────────────
function pageShell(title: string, description: string, canonical: string, body: string): string {
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title><meta name="description" content="' + esc(description) + '"><link rel="canonical" href="' + esc(canonical) + '">'
    + '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(description) + '"><meta property="og:url" content="' + esc(canonical) + '"><meta property="og:type" content="website">'
    + '<link rel="icon" href="/icons/icon-192.png"><link rel="manifest" href="/manifest.json">'
    + '<style>body{margin:0;background:#F5F3ED;color:#3b3a37;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + 'main{max-width:860px;margin:0 auto;padding:24px 16px 56px}a{color:#3D6B85;text-decoration:none}a:hover{text-decoration:underline}'
    + 'h1{font-size:26px;margin:8px 0 6px}.lead{color:#6b6860;margin:0 0 18px}.top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:6px}'
    + '.btn{display:inline-block;padding:8px 16px;border-radius:999px;background:#3D6B85;color:#fff;font-weight:600}.btn:hover{text-decoration:none;filter:brightness(1.08)}'
    + 'h2{font-size:18px;margin:26px 0 8px;padding-top:8px;border-top:1px solid #ddd9cf}ul.words{list-style:none;margin:0;padding:0;columns:2 280px;column-gap:28px}'
    + 'ul.words li{break-inside:avoid;padding:3px 0;font-size:15px}.th{font-family:"Bai Jamjuree",system-ui,sans-serif;font-size:17px;font-weight:500}.mean{color:#6b6860}'
    + '@media (prefers-color-scheme:dark){body{background:#1d1c1a;color:#e6e3dc}.lead,.mean{color:#a9a69d}a{color:#8fbad3}h2{border-color:#3a3833}}</style>'
    + '</head><body>' + body + '</body></html>';
}
function firstMeaning(w: any): string {
  const m = Array.isArray(w.meanings) ? w.meanings : (w.meanings ? [w.meanings] : []);
  return truncate(toPlain(m[0] || ''), 70);
}
function buildIndexPage(words: any[], origin: string): string {
  const sorted = words.slice().sort((a, b) => String(a.thai).localeCompare(String(b.thai), 'th'));
  const groups: Record<string, any[]> = {};
  sorted.forEach((w) => {
    const first = Array.from(String(w.thai).replace(/^[\s\u0e40-\u0e44]+/, ''))[0] || '#'; // bỏ nguyên âm đứng trước (เ แ โ ใ ไ) để xếp theo phụ âm đầu
    (groups[first] = groups[first] || []).push(w);
  });
  const sections = Object.keys(groups).map((k) =>
    '<h2 lang="th">' + esc(k) + '</h2><ul class="words">'
    + groups[k].map((w) => '<li><a href="' + esc(wordPath(w)) + '"><span class="th" lang="th">' + esc(w.thai) + '</span></a>' + (firstMeaning(w) ? ' <span class="mean">— ' + esc(firstMeaning(w)) + '</span>' : '') + '</li>').join('')
    + '</ul>').join('');
  const body = '<main><div class="top"><a href="/" class="btn">Mở alay để tra từ</a></div>'
    + '<h1>Danh mục từ — Từ điển Thái Việt</h1>'
    + '<p class="lead">' + sorted.length + ' từ tiếng Thái kèm nghĩa tiếng Việt, phiên âm và ví dụ. Chọn một từ để xem chi tiết.</p>' + sections + '</main>';
  return pageShell('Danh mục từ — ' + BRAND, 'Danh sách ' + sorted.length + ' từ tiếng Thái kèm nghĩa tiếng Việt, phiên âm và ví dụ tại alay.', origin + '/tu/', body);
}
function buildSitemap(words: any[], origin: string): string {
  const urls = [origin + '/', origin + '/tu/'].concat(words.map((w) => origin + wordPath(w)));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => '  <url><loc>' + esc(u) + '</loc></url>').join('\n') + '\n</urlset>\n';
}

// ── Bộ xử lý chính ─────────────────────────────────────────────────────────
interface EdgeContext { rewrite(path: string): Promise<Response>; next(): Promise<Response>; }

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' };

export default async function handler(request: Request, context: EdgeContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname;
  try {
    if (path === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n\nSitemap: ' + origin + '/sitemap.xml\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
    if (path === '/sitemap.xml') {
      const words = await allWordRefs();
      if (!words) return context.next();
      return new Response(buildSitemap(words, origin), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
    if (path === '/tu' || path === '/tu/') {
      const words = await allWordRefs();
      if (!words) return context.rewrite('/index.html');
      return new Response(buildIndexPage(words, origin), { headers: HTML_HEADERS });
    }
    const m = path.match(/^\/tu\/(\d+)(?:-[^/]*)?\/?$/);
    if (!m) return context.rewrite('/index.html'); // /tu/<không phải số>: để app xử lý như cũ
    const id = Number(m[1]);
    const rows = await sbRows('words?id=eq.' + id + '&select=*');
    if (rows === null) return context.rewrite('/index.html'); // Supabase lỗi/chậm: không chặn người dùng, app tự tải như cũ

    const shellRes = await context.rewrite('/index.html');
    if (!shellRes.ok) return shellRes;
    const shell = await shellRes.text();

    const word = rows[0];
    if (!word || word.visible === false) {
      // Từ không có/đang ẩn: 404 để Google bỏ khỏi chỉ mục; người dùng vẫn thấy app (app tự quay về trang chủ)
      const html = shell.replace(/<\/head>/i, () => '<meta name="robots" content="noindex"></head>');
      return new Response(html, { status: 404, headers: HTML_HEADERS });
    }
    const canonicalPath = wordPath(word);
    let decodedPath = path;
    try { decodedPath = decodeURIComponent(path); } catch (_e) { /* giữ nguyên */ }
    if (decodedPath.replace(/\/$/, '') !== canonicalPath) {
      // Slug cũ/sai (vd phiên âm đã đổi): chuyển hướng vĩnh viễn về URL chuẩn để không bị trùng nội dung
      return new Response(null, { status: 301, headers: { location: canonicalPath, 'cache-control': 'public, max-age=300' } });
    }

    // Các từ liên quan (đồng nghĩa/trái nghĩa/...) trong từ điển → thành liên kết nội bộ thật
    const rel: RelMap = {};
    const tokens = relatedTokens(word);
    if (tokens.length) {
      const q = tokens.map((t) => '"' + t.replace(/"/g, '') + '"').join(',');
      const relRows = await sbRows('words?select=id,thai,phonetic,visible&thai=in.(' + encodeURIComponent(q) + ')');
      (relRows || []).forEach((r) => { if (r.visible !== false && r.id !== word.id && !rel[r.thai]) rel[r.thai] = r; });
    }
    const html = injectIntoShell(shell, buildWordSeo(word, rel, origin), false);
    return new Response(html, { headers: HTML_HEADERS });
  } catch (_err) {
    // Bất cứ lỗi không lường trước nào: trả app bình thường
    return context.rewrite('/index.html');
  }
}

export const config = { path: ['/tu', '/tu/*', '/sitemap.xml', '/robots.txt'] };

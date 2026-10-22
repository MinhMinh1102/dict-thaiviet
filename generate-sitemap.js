// generate-sitemap.js
// Script CHẠY TAY (không phải build step tự động) để tạo sitemap.xml
// khi nào bạn thêm nhiều từ mới và muốn Google index đầy đủ.
//
// Cách chạy (cần Node 18+ vì dùng fetch có sẵn, không cần npm install gì cả):
//   node generate-sitemap.js
// Sau đó copy sitemap.xml vào thư mục repo (ngang hàng index.html) rồi commit + push như bình thường.

const SUPABASE_URL = 'https://luoqsudzbmkzxosbdmmp.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3FzdWR6Ym1renhvc2JkbW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjkxMTcsImV4cCI6MjA5ODE0NTExN30.0k87aqhSyFpFAah3H-MQ4QObWV3CCT77AcLcUx23KKg';
const SITE_ORIGIN = 'https://dictthaiviet.netlify.app';

// Giữ nguyên logic slug với hàm slugify() trong index.html để URL khớp nhau
function slugify(str) {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function wordSlug(word) {
  const base = slugify(word.phonetic) || slugify(word.thai) || 'tu';
  return word.id + '-' + base;
}

async function main() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/words?select=id,thai,phonetic,created_at&order=id.asc', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY }
  });
  if (!res.ok) {
    console.error('Lỗi gọi Supabase:', res.status, await res.text());
    process.exit(1);
  }
  const words = await res.json();
  console.log('Tổng số từ:', words.length);

  const staticUrls = [
    { loc: '/', priority: '1.0' },
    { loc: '/about.html', priority: '0.3' },
    { loc: '/contact.html', priority: '0.3' },
    { loc: '/privacy.html', priority: '0.3' },
    { loc: '/terms.html', priority: '0.3' }
  ];

  const urlEntries = [
    ...staticUrls.map(u => `  <url>\n    <loc>${SITE_ORIGIN}${u.loc}</loc>\n    <priority>${u.priority}</priority>\n  </url>`),
    ...words.map(w => {
      const lastmod = (w.created_at || '').slice(0, 10);
      return `  <url>\n    <loc>${SITE_ORIGIN}/tu/${wordSlug(w)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <priority>0.7</priority>\n  </url>`;
    })
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries.join('\n')}\n</urlset>\n`;

  const fs = require('fs');
  fs.writeFileSync('sitemap.xml', xml, 'utf-8');
  console.log('Đã tạo sitemap.xml (' + urlEntries.length + ' URL). Copy file này vào repo rồi commit + push.');
}

main().catch(err => { console.error(err); process.exit(1); });

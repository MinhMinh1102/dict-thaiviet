// ══════════════════════════════════════════════════════════════════
// modules/widgets.js — ALAY
// Widget "Thông tin nhanh" (thời tiết / tỷ giá / món ăn) ở side-menu + phần
// quản trị 3 widget này trong trang admin (thêm/sửa/xóa từ vựng, tiêu đề card).
// Lazy-load: chỉ tải khi bấm nút "Thông tin nhanh" LẦN ĐẦU (toggleHomeInfoNav
// ở app.js sẽ await import() file này) hoặc khi vào trang quản trị.
// Trước đây 3 card được tải ngay lúc trang chủ vừa load xong (trong loadWords());
// giờ dữ liệu thật (gọi API thời tiết/tỷ giá/Supabase) chỉ tải khi popup mở.
// ══════════════════════════════════════════════════════════════════

// ── Card thời tiết / tỷ giá / món ăn: hiện đúng tab + tải dữ liệu (chỉ 1 lần
// cho mỗi loại, các lần mở popup sau chỉ đổi tab hiển thị, không gọi lại API) ──
const HOME_INFO_CARD_IDS = { weather: 'weatherCard', currency: 'currencyCard', food: 'foodCard' };

function openHomeInfoPopup(key) {
  const popup = document.getElementById('homeInfoPopup');
  if (!popup) return;
  Object.values(HOME_INFO_CARD_IDS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const activeEl = document.getElementById(HOME_INFO_CARD_IDS[key]);
  if (activeEl) activeEl.style.display = '';

  document.querySelectorAll('.home-info-tab').forEach(b => b.classList.remove('active'));
  const tabBtn = document.getElementById('homeInfoTab_' + key);
  if (tabBtn) tabBtn.classList.add('active');

  homeInfoActiveKey = key;
  popup.classList.add('show');
  refreshDictPhonetics(popup); // từ điển có thể vừa tải xong sau lúc card được dựng

  // UX: mở tab "Tỷ giá" thì đưa con trỏ vào thẳng ô nhập Baht luôn, khỏi phải bấm thêm 1 lần
  // nữa mới gõ được. requestAnimationFrame để đợi đúng 1 nhịp render (đề phòng lúc bấm là lần
  // đầu tiên load module, card có thể vừa mới đổ HTML xong) — nếu ô chưa kịp có (card vẫn còn
  // đang tải tỷ giá) thì bỏ qua, không phải lỗi nghiêm trọng.
  if (key === 'currency') {
    requestAnimationFrame(() => {
      const input = document.getElementById('currencyConvThbInput');
      if (input) input.focus();
    });
  }
}

let _widgetCardsLoaded = false;
function ensureWidgetCardsLoaded() {
  if (_widgetCardsLoaded) return;
  _widgetCardsLoaded = true;
  loadHomeCardsConfig();
  loadWeatherCard();
  loadCurrencyCard();
  loadFoodCard();
}

function goToWordByThai(thai) {
  const word = allWords.find(w => w.thai === thai);
  if (word) { goToWord(word.id); return; }
  showPage('home');
  setSearchInputValue(thai);
  doSearch();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── TIÊU ĐỀ 3 CARD (bảng home_cards_config) ─────────────────────────────
// Tiêu đề do admin tự nhập, NHIỀU DÒNG, lưu nguyên trong cột `title` (không cần thêm cột): dòng 1 = tiếng Thái (chữ đậm, ở trên), các dòng sau = tiếng Việt
// (chữ thường, bên dưới) — cùng kiểu hiển thị với card Tỷ giá. Dữ liệu cũ chỉ có 1 dòng (trước đây là dòng tiếng Việt, chữ Thái là chữ cố định) → vẫn hiểu là dòng
// tiếng Việt và dùng chữ Thái mặc định bên dưới, nên không card nào bị đổi nếu admin chưa sửa.
const CARD_TITLE_DEFAULTS = {
  weather:  { thai: 'สภาพอากาศวันนี้',          viet: '🌤️ Thời tiết hôm nay' },
  currency: { thai: 'อัตราแลกเปลี่ยนประจำวัน', viet: '💱 Tỷ giá hôm nay' },
  food:     { thai: 'อาหารไทยวันนี้',            viet: '🍜 Món ăn Thái hôm nay' }
};
function splitCardTitleLines(raw) {
  return String(raw == null ? '' : raw).split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
}
function cardTitleParts(cardKey, raw) {
  const def = CARD_TITLE_DEFAULTS[cardKey] || { thai: '', viet: '' };
  const lines = splitCardTitleLines(raw);
  if (lines.length >= 2) return { thai: lines[0], viet: lines.slice(1).join('\n') };
  if (lines.length === 1) return { thai: def.thai, viet: lines[0] };
  return { thai: def.thai, viet: def.viet };
}
function applyCardTitle(cardKey, raw) {
  if (!CARD_TITLE_DEFAULTS[cardKey]) return; // khóa khác trong home_cards_config (vd currency_example_*) không phải tiêu đề card
  const parts = cardTitleParts(cardKey, raw);
  const thaiEl = document.getElementById(cardKey + 'CardTitleThai');
  const vietEl = document.getElementById(cardKey + 'CardTitleText');
  if (thaiEl) thaiEl.textContent = parts.thai;
  if (vietEl) vietEl.textContent = parts.viet;
  const input = document.getElementById(cardKey + 'CardTitleInput');
  if (input) {
    input.value = parts.thai + '\n' + parts.viet; // ô sửa luôn hiện đúng 2 phần đang hiển thị
    if (typeof autoGrowTextarea === 'function') autoGrowTextarea(input);
    observeCardTitleInput(input);
  }
}
// Trang quản trị đang ẨN lúc ô được điền (autoGrowTextarea bỏ qua khi ẩn) → khi ô hiện ra và có kích thước thật thì tự co giãn theo nội dung.
const _cardTitleRO = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(function(entries) {
  entries.forEach(function(en) { if (en.contentRect.width > 0 && typeof autoGrowTextarea === 'function') autoGrowTextarea(en.target); });
}) : null;
function observeCardTitleInput(input) { if (_cardTitleRO && !input.__cardTitleObserved) { input.__cardTitleObserved = true; _cardTitleRO.observe(input); } }
async function loadHomeCardsConfig() {
  // Dựng sẵn mặc định cho cả 3 ô sửa (kể cả khi bảng chưa có dòng nào), rồi ghi đè bằng dữ liệu admin đã lưu
  Object.keys(CARD_TITLE_DEFAULTS).forEach(function(k) { applyCardTitle(k, ''); });
  try {
    const rows = await sbGet('home_cards_config?select=*');
    const list = Array.isArray(rows) ? rows : [];
    list.forEach(function(row) { applyCardTitle(row.card_key, row.title); });
    applyCurrencyExampleRows(list);
  } catch (e) { /* giữ tiêu đề mặc định nếu tải lỗi */ }
}

async function saveCardTitle(cardKey, inputId) {
  const input = document.getElementById(inputId);
  const lines = splitCardTitleLines(input && input.value);
  if (lines.length < 2) { showToast('⚠️ Nhập 2 dòng: dòng 1 tiếng Thái, dòng 2 tiếng Việt'); return; }
  const title = lines.join('\n');
  try {
    const res = await sbPostAuth('home_cards_config', { card_key: cardKey, title: title }, 'card_key');
    if (!Array.isArray(res)) throw new Error('save failed'); // sbPostAuth trả object lỗi (không throw) khi bị chặn / lỗi
    applyCardTitle(cardKey, title);
    showToast('✅ Đã lưu tiêu đề');
  } catch (e) {
    showToast('⚠️ Lỗi khi lưu tiêu đề, thử lại sau');
  }
}

// ── THỜI TIẾT ───────────────────────────────────────────────────────────

// Danh sách tỉnh thành Thái Lan để chọn xem thời tiết — tên viết tắt (short) hiển thị trên nhãn
// nút "Thời tiết" ở thanh top-info, tên đầy đủ (name) hiển thị trong ô chọn + dòng địa danh của
// card. Toạ độ (lat/lon) dùng gọi Open-Meteo. Chọn lọc thủ công ~20 tỉnh phổ biến/đại diện các
// vùng (không lấy đủ 77 tỉnh để giữ chất lượng — đúng tinh thần "admin-curated over
// algorithmic" của dự án).
const THAI_PROVINCES = [
  { code: 'bangkok',            short: 'กทม.',        name: 'กรุงเทพมหานคร',       lat: 13.7563, lon: 100.5018 },
  { code: 'chiangmai',          short: 'เชียงใหม่',    name: 'เชียงใหม่',           lat: 18.7883, lon: 98.9853  },
  { code: 'chiangrai',          short: 'เชียงราย',     name: 'เชียงราย',            lat: 19.9105, lon: 99.8406  },
  { code: 'maehongson',         short: 'แม่ฮ่องสอน',   name: 'แม่ฮ่องสอน',          lat: 19.3020, lon: 97.9654  },
  { code: 'sukhothai',          short: 'สุโขทัย',       name: 'สุโขทัย',             lat: 17.0068, lon: 99.8265  },
  { code: 'phitsanulok',        short: 'พิษณุโลก',      name: 'พิษณุโลก',            lat: 16.8211, lon: 100.2659 },
  { code: 'khonkaen',           short: 'ขอนแก่น',      name: 'ขอนแก่น',             lat: 16.4419, lon: 102.8360 },
  { code: 'udonthani',          short: 'อุดรธานี',      name: 'อุดรธานี',            lat: 17.4138, lon: 102.7870 },
  { code: 'nongkhai',           short: 'หนองคาย',      name: 'หนองคาย',             lat: 17.8783, lon: 102.7420 },
  { code: 'nakhonratchasima',   short: 'โคราช',        name: 'นครราชสีมา',          lat: 14.9799, lon: 102.0977 },
  { code: 'ubonratchathani',    short: 'อุบลฯ',         name: 'อุบลราชธานี',         lat: 15.2287, lon: 104.8565 },
  { code: 'ayutthaya',          short: 'อยุธยา',        name: 'พระนครศรีอยุธยา',     lat: 14.3532, lon: 100.5686 },
  { code: 'kanchanaburi',       short: 'กาญจนบุรี',     name: 'กาญจนบุรี',           lat: 14.0227, lon: 99.5328  },
  { code: 'chonburi',           short: 'ชลบุรี',        name: 'ชลบุรี',              lat: 13.3611, lon: 100.9847 },
  { code: 'pattaya',            short: 'พัทยา',         name: 'พัทยา',               lat: 12.9236, lon: 100.8825 },
  { code: 'rayong',             short: 'ระยอง',         name: 'ระยอง',               lat: 12.6813, lon: 101.2816 },
  { code: 'suratthani',         short: 'สุราษฎร์ฯ',      name: 'สุราษฎร์ธานี',        lat: 9.1382,  lon: 99.3215  },
  { code: 'nakhonsithammarat',  short: 'นครศรีฯ',       name: 'นครศรีธรรมราช',       lat: 8.4304,  lon: 99.9631  },
  { code: 'phuket',             short: 'ภูเก็ต',        name: 'ภูเก็ต',              lat: 7.8804,  lon: 98.3923  },
  { code: 'krabi',              short: 'กระบี่',        name: 'กระบี่',              lat: 8.0863,  lon: 98.9063  },
  { code: 'songkhla',           short: 'สงขลา',         name: 'สงขลา',               lat: 7.1897,  lon: 100.5951 }
];
const WEATHER_PROVINCE_KEY = 'thai_weather_province';

// ── Nút loa dùng chung cho 3 widget (thời tiết / tỷ giá / món ăn) ──
// Chữ cần đọc nằm ở data-speak của nút; bấm → speakText() (hàm toàn cục của app.js, tự thêm/gỡ class "playing" khi đang đọc, bấm lại thì dừng).
const WIDGET_SPEAK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
function widgetSpeakBtnHtml(text, extraAttrs) {
  if (!text) return '';
  return '<button type="button" class="widget-speak-btn" aria-label="Phát âm" title="Phát âm" data-speak="' + escapeHtml(String(text)) + '"' + (extraAttrs || '') + ' onclick="widgetSpeak(this, event)">' + WIDGET_SPEAK_ICON + '</button>';
}
// ── Phiên âm theo TỪ ĐIỂN ──
// Phiên âm hiện trong 3 widget lấy từ chính các từ có trong từ điển (allWords[].phonetic): khớp cả cụm trước; không có thì tách bằng segmentThai() và nối phiên âm
// của từng từ — CHỈ khi MỌI từ đều có; còn lại dùng phiên âm dự phòng (admin nhập / bảng cố định trong code). Không bọc ngoặc.
// Các thẻ cần phiên âm mang data-phon-thai (chữ Thái) + data-phon-fallback; refreshDictPhonetics() điền lại — gọi khi dựng card VÀ mỗi lần mở popup, vì card
// thường dựng lúc trang mới tải, khi từ điển có thể chưa tải xong.
function stripPhoneticHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function dictPhoneticForThai(thai, fallback) {
  const text = String(thai || '').trim();
  const words = (typeof allWords !== 'undefined' && allWords) ? allWords : [];
  if (text && words.length) {
    const exact = words.find(function(w) { return w.thai === text && w.phonetic; });
    if (exact) return stripPhoneticHtml(exact.phonetic);
    if (typeof segmentThai === 'function') {
      try {
        const phs = segmentThai(text).filter(function(s) { return !s.isSpace; }).map(function(s) {
          const hit = words.find(function(w) { return w.thai === s.thai && w.phonetic; });
          return hit ? stripPhoneticHtml(hit.phonetic) : null;
        });
        if (phs.length && phs.every(Boolean)) return phs.join(' ');
      } catch (e) { /* dùng phiên âm dự phòng */ }
    }
  }
  return fallback || '';
}
// Phiên âm cho 1 câu admin tự nhập: lần lượt từng từ (tách bằng segmentThai) CÓ trong từ điển → phiên âm của từ đó; từ không có thì bỏ qua (không bịa).
function dictPhoneticSequence(text) {
  const words = (typeof allWords !== 'undefined' && allWords) ? allWords : [];
  if (!text || !words.length || typeof segmentThai !== 'function') return '';
  const out = [];
  try {
    segmentThai(String(text)).forEach(function(s) {
      if (s.isSpace) return;
      const hit = words.find(function(w) { return w.thai === s.thai && w.phonetic; });
      if (hit) out.push(stripPhoneticHtml(hit.phonetic));
    });
  } catch (e) { return ''; }
  return out.join(' ');
}
function phonAttrs(thai, fallback) {
  return ' data-phon-thai="' + escapeHtml(String(thai || '')) + '" data-phon-fallback="' + escapeHtml(String(fallback || '')) + '"';
}
function refreshDictPhonetics(root) {
  (root || document).querySelectorAll('[data-phon-thai]').forEach(function(el) {
    el.textContent = dictPhoneticForThai(el.getAttribute('data-phon-thai'), el.getAttribute('data-phon-fallback') || '');
  });
  // Dòng phiên âm của câu tự nhập (data-phon-seq = chữ Thái thuần): ghép phiên âm các từ có trong từ điển; không có từ nào thì ẩn dòng.
  (root || document).querySelectorAll('[data-phon-seq]').forEach(function(el) {
    const t = dictPhoneticSequence(el.getAttribute('data-phon-seq'));
    el.textContent = t;
    el.style.display = t ? '' : 'none';
  });
}

function widgetSpeak(btn, ev) {
  if (ev) ev.stopPropagation(); // nút loa nằm trong chip bấm-để-tra-từ → không kích hoạt chip
  const text = btn && btn.getAttribute('data-speak');
  if (text) speakText(text, btn);
}

function getSelectedProvinceCode() {
  const saved = localStorage.getItem(WEATHER_PROVINCE_KEY);
  return (saved && THAI_PROVINCES.some(function(p) { return p.code === saved; })) ? saved : THAI_PROVINCES[0].code;
}
function getProvinceByCode(code) {
  return THAI_PROVINCES.find(function(p) { return p.code === code; }) || THAI_PROVINCES[0];
}

// Icon thời tiết theo mã WMO của Open-Meteo (current_weather.weathercode) — quy đổi tối giản,
// đủ phân biệt nắng/mây/mưa/dông cho mục đích hiển thị, không cần chi tiết từng mức.
// Icon đơn nét (stroke, bộ Lucide — cùng style 24x24, stroke-width 1.8 với các icon khác trên thanh) theo mã WMO, dùng cho nút "Thời tiết"
// ở thanh trên cùng (thay emoji + nhiệt độ trước đây). Trả về phần ruột của <svg id="topInfoWeatherIcon">.
var WEATHER_SVG_CLOUD = '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>';
function weatherIconSvgForCode(code) {
  if (code === 0) return '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>'; // nắng
  if (code === 1 || code === 2) return '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>'; // nắng có mây
  if (code === 3) return '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'; // nhiều mây
  if (code === 45 || code === 48) return WEATHER_SVG_CLOUD + '<path d="M16 17H7"/><path d="M17 21H9"/>'; // sương mù
  if (code >= 51 && code <= 57) return WEATHER_SVG_CLOUD + '<path d="M8 19v1"/><path d="M8 14v1"/><path d="M16 19v1"/><path d="M16 14v1"/><path d="M12 21v1"/><path d="M12 16v1"/>'; // mưa phùn
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return WEATHER_SVG_CLOUD + '<path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>'; // mưa / mưa rào
  if (code >= 71 && code <= 77) return WEATHER_SVG_CLOUD + '<path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>'; // tuyết
  if (code >= 95) return '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>'; // giông
  return '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'; // mặc định: mây
}

// ── Câu ví dụ thời tiết (phiên âm + nghĩa + loa) ──
// Tự dựng từ mã thời tiết + nhiệt độ hiện tại: câu 1 nói về bầu trời, câu 2 nói nhiệt độ (có cách đọc số). Từ vựng cố định ở đây (không phụ thuộc bảng
// admin nhập) để câu luôn đúng ngữ pháp; phiên âm theo cùng kiểu chữ "aa-gàat" của phần còn lại trong app.
const WEATHER_SKY_PHRASES = [
  [function(c) { return c === 0; },                              'ท้องฟ้าแจ่มใส', 'tɔ́ɔng-fáa jɛ̀ɛm-sǎi',     'trời quang đãng'],
  [function(c) { return c === 1 || c === 2; },                   'มีเมฆบางส่วน',  'mii mêek baang-sùan',       'có mây rải rác'],
  [function(c) { return c === 3; },                              'มีเมฆมาก',      'mii mêek mâak',             'nhiều mây'],
  [function(c) { return c === 45 || c === 48; },                 'มีหมอก',        'mii mɔ̌ɔk',                  'có sương mù'],
  [function(c) { return c >= 51 && c <= 57; },                   'ฝนตกปรอยๆ',     'fǒn dtòk bproi-bproi',      'mưa phùn'],
  [function(c) { return (c >= 61 && c <= 67) || (c >= 80 && c <= 82); }, 'ฝนตก',   'fǒn dtòk',                  'trời mưa'],
  [function(c) { return c >= 71 && c <= 77; },                   'หิมะตก',        'hì-má dtòk',                'tuyết rơi'],
  [function(c) { return c >= 95; },                              'ฝนฟ้าคะนอง',    'fǒn fáa-ká-nɔɔng',          'mưa giông']
];
function weatherSkyPhrase(code) {
  const hit = WEATHER_SKY_PHRASES.find(function(p) { return p[0](code); });
  return hit ? { thai: hit[1], phonetic: hit[2], viet: hit[3] } : { thai: 'มีเมฆมาก', phonetic: 'mii mêek mâak', viet: 'nhiều mây' };
}
function weatherFeelPhrase(t) {
  if (t <= 19) return { thai: 'หนาว',     phonetic: 'nǎao',      viet: 'lạnh' };
  if (t <= 25) return { thai: 'เย็น',     phonetic: 'yen',       viet: 'mát' };
  if (t <= 30) return { thai: 'อุ่น',     phonetic: 'ùn',        viet: 'ấm' };
  if (t <= 34) return { thai: 'ร้อน',     phonetic: 'rɔ́ɔn',      viet: 'nóng' };
  return { thai: 'ร้อนมาก', phonetic: 'rɔ́ɔn mâak', viet: 'rất nóng' };
}
// Số 0-99 → phiên âm (tương ứng thaiNumberToWords: 1 ở hàng đơn vị đọc "èt", 20-29 dùng "yîi-sìp")
function thaiNumberToPhonetic(n) {
  const d = ['sǔun', 'nùng', 'sɔ̌ɔng', 'sǎam', 'sìi', 'hâa', 'hòk', 'jèt', 'bpɛ̀ɛt', 'gâao'];
  n = Math.max(0, Math.min(99, Math.round(n)));
  if (n < 10) return d[n];
  const t = Math.floor(n / 10), u = n % 10;
  const tens = t === 1 ? 'sìp' : (t === 2 ? 'yîi-sìp' : d[t] + '-sìp');
  return u === 0 ? tens : tens + '-' + (u === 1 ? 'èt' : d[u]);
}
function toThaiDigitsStr(n) { return String(n).replace(/\d/g, function(ch) { return '๐๑๒๓๔๕๖๗๘๙'.charAt(+ch); }); }
function buildWeatherExampleHtml(code, temp) {
  const t = Math.max(0, Math.min(99, temp));
  const sky = weatherSkyPhrase(code), feel = weatherFeelPhrase(t);
  // 1 câu duy nhất, 1 dòng, KHÔNG có "วันนี้ / Hôm nay": "มีเมฆบางส่วน อากาศอุ่น ๓๐ องศา" — phiên âm + nghĩa ngay dưới, 1 loa đọc cả câu.
  const thai = sky.thai + ' อากาศ' + feel.thai + ' ' + toThaiDigitsStr(t) + ' องศา';
  // Phiên âm ghép từng phần (bầu trời / อากาศ / cảm giác / số / องศา): phần có trong từ điển lấy theo từ điển, số và phần còn lại dùng bảng dự phòng.
  const phonetic = '<span' + phonAttrs(sky.thai, sky.phonetic) + '>' + sky.phonetic + '</span> <span' + phonAttrs('อากาศ', 'aa-gàat') + '>aa-gàat</span> <span' + phonAttrs(feel.thai, feel.phonetic) + '>' + feel.phonetic + '</span> <span>' + thaiNumberToPhonetic(t) + '</span> <span' + phonAttrs('องศา', 'ong-sǎa') + '>ong-sǎa</span>';
  const viet = sky.viet.charAt(0).toUpperCase() + sky.viet.slice(1) + ', thời tiết ' + feel.viet + ', ' + t + ' độ.';
  const spoken = sky.thai + ' อากาศ' + feel.thai + ' ' + thaiNumberToWords(t) + ' องศา';
  return '<div class="weather-example">' +
    '<div class="weather-example-row"><div class="weather-example-thai" id="weatherExampleThai">' + thai + '</div>' + widgetSpeakBtnHtml(spoken) + '</div>' +
    '<div class="weather-example-phonetic">' + phonetic + '</div>' +
    '<div class="weather-example-viet">' + viet + '</div></div>';
}

// Dòng chữ Thái của câu ví dụ (thời tiết + tỷ giá dùng chung):
// • Chữ Thái nào có trong từ điển thì bấm được để mở popup tra nhanh (cùng cơ chế liên kết từ như phần định nghĩa/ví dụ). Card thường được dựng lúc trang mới tải,
//   khi từ điển (allWords) có thể CHƯA tải xong → chưa liên kết được; nên thử lại mỗi khi popup hiện ra (ResizeObserver bên dưới) cho tới khi liên kết được.
// • Phải nằm TRỌN 1 dòng: co dần cỡ chữ (từng 0.5px, tối thiểu 12px) cho vừa bề ngang; quá hẹp thì cho xuống dòng (13px) thay vì cắt chữ.
function ensureExampleLinks(el) {
  if (!el || el.getAttribute('data-linked') === '1') return;
  if (typeof linkifyWordsPlain !== 'function' || !allWords || !allWords.length) return;
  linkifyWordsPlain(el);
  el.setAttribute('data-linked', '1');
}
function fitExampleLine(el) {
  if (!el || !el.clientWidth) return;
  ensureExampleLinks(el);
  el.style.fontSize = '';
  el.style.whiteSpace = '';
  let size = parseFloat(getComputedStyle(el).fontSize) || 16;
  while (size > 12 && el.scrollWidth > el.clientWidth + 0.5) { size -= 0.5; el.style.fontSize = size + 'px'; }
  if (el.scrollWidth > el.clientWidth + 0.5) { el.style.whiteSpace = 'normal'; el.style.fontSize = '13px'; }
}
// Card có thể được dựng lúc popup đang ẨN (chưa đo được bề ngang) → ResizeObserver: khi popup hiện ra và dòng có bề ngang thật thì tự chạy lại.
let _exampleRO = null;
function observeExampleLine(el) {
  if (!el) return;
  if (typeof ResizeObserver === 'undefined') { fitExampleLine(el); return; }
  if (!_exampleRO) _exampleRO = new ResizeObserver(function(entries) { entries.forEach(function(en) { fitExampleLine(en.target); }); });
  _exampleRO.observe(el);
}

function weatherEmojiForCode(code) {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

async function loadWeatherCard() {
  const body = document.getElementById('weatherCardBody');
  if (!body) return;

  const province = getProvinceByCode(getSelectedProvinceCode());
  const CACHE_KEY = 'thai_weather_cache_' + province.code; // cache riêng theo từng tỉnh
  const CACHE_MS = 60 * 60 * 1000; // 1 giờ
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && (Date.now() - cached.ts) < CACHE_MS) {
      renderWeatherCard(cached.data, province.code);
      return;
    }
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + province.lat + '&longitude=' + province.lon + '&current_weather=true&timezone=Asia%2FBangkok');
    const json = await r.json();
    const cw = json.current_weather;
    if (!cw) throw new Error('no current_weather');
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: cw }));
    renderWeatherCard(cw, province.code);
  } catch (e) {
    body.innerHTML = '<div class="info-card-error">Không tải được thời tiết lúc này.</div>';
  }
}

// Đổi tỉnh trong ô chọn: lưu lựa chọn (localStorage, nhớ cho lần sau), hiện loading rồi tải lại
// đúng luồng loadWeatherCard() bình thường (dùng cache riêng theo tỉnh nếu còn mới trong 1 giờ).
// Dropdown chọn tỉnh có ô tìm (thay <select> gốc): danh sách nằm NGAY trong card (không dùng menu nổi) để không bị popup cắt mất.
function normalizeSearchText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}
function toggleWeatherProvMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('weatherProvMenu');
  const btn = document.getElementById('weatherProvBtn');
  if (!menu) return;
  menu.hidden = !menu.hidden;
  btn.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  if (!menu.hidden) {
    const input = document.getElementById('weatherProvSearch');
    input.value = '';
    filterWeatherProvinces('');
    setTimeout(function() { input.focus(); }, 30);
  }
}
function filterWeatherProvinces(q) {
  const key = normalizeSearchText(q);
  let shown = 0;
  document.querySelectorAll('#weatherProvList .weather-prov-item').forEach(function(item) {
    const ok = !key || item.getAttribute('data-search').indexOf(key) !== -1;
    item.hidden = !ok;
    if (ok) shown++;
  });
  const empty = document.getElementById('weatherProvEmpty');
  if (empty) empty.hidden = shown > 0;
}

async function onWeatherProvinceChange(code, ev) {
  if (ev) ev.stopPropagation(); // mục tỉnh bị dựng lại ngay sau khi bấm → tránh handler "bấm ra ngoài" đóng popup (xem onCurrencySwap)
  localStorage.setItem(WEATHER_PROVINCE_KEY, code);
  const body = document.getElementById('weatherCardBody');
  if (body) body.innerHTML = '<div class="info-card-loading">Đang tải thời tiết...</div>';
  await loadWeatherCard();
}

function renderWeatherCard(cw, provinceCode) {
  const body = document.getElementById('weatherCardBody');
  if (!body) return;
  const province = getProvinceByCode(provinceCode);
  const temp = Math.round(cw.temperature);
  // Popup chỉ còn: chọn tỉnh + câu ví dụ. Khối "emoji + nhiệt độ / tên tỉnh, Thái Lan / chip từ vựng / → nghĩa" đã bỏ (bảng từ vựng thời tiết của admin
  // vẫn được tải và sửa ở trang quản trị nhưng popup không còn hiển thị).

  // Cập nhật LUÔN nhãn nút "Thời tiết" ở thanh top-info (nếu đang có trên trang): chỉ tên tỉnh viết tắt (bỏ emoji + nhiệt độ) và icon đơn nét theo
  // thời tiết hiện tại thay cho icon mặt trời cố định. (Card trong popup bên dưới vẫn giữ emoji + nhiệt độ như cũ.)
  const topLabel = document.getElementById('topInfoWeatherLabel');
  if (topLabel) topLabel.textContent = province.short;
  const topIcon = document.getElementById('topInfoWeatherIcon');
  if (topIcon) topIcon.innerHTML = weatherIconSvgForCode(cw.weathercode);

  const items = THAI_PROVINCES.map(function(p) {
    return '<button type="button" role="option" class="weather-prov-item' + (p.code === province.code ? ' active' : '') + '" data-search="' + escapeHtml(normalizeSearchText(p.name + ' ' + p.short + ' ' + p.code)) + '" onclick="onWeatherProvinceChange(\'' + p.code + '\', event)">' + p.name + '</button>';
  }).join('');

  body.innerHTML =
    '<div class="weather-prov">' +
      '<button type="button" class="weather-prov-btn" id="weatherProvBtn" aria-haspopup="listbox" aria-expanded="false" onclick="toggleWeatherProvMenu(event)"><span>' + province.name + '</span>' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' +
      '<div class="weather-prov-menu" id="weatherProvMenu" hidden>' +
        '<input type="text" class="form-input weather-prov-search" id="weatherProvSearch" placeholder="Tìm tỉnh..." autocomplete="off" oninput="filterWeatherProvinces(this.value)">' +
        '<div class="weather-prov-list" id="weatherProvList" role="listbox">' + items + '<div class="weather-prov-empty" id="weatherProvEmpty" hidden>Không tìm thấy tỉnh nào</div></div>' +
      '</div>' +
    '</div>' +
    buildWeatherExampleHtml(cw.weathercode, temp);
  refreshDictPhonetics(body);
  const exEl = document.getElementById('weatherExampleThai');
  ensureExampleLinks(exEl);
  observeExampleLine(exEl);
}

// ── SỐ ĐỌC BẰNG CHỮ THÁI (dùng cho ô đổi tiền bên dưới) ─────────────────
// Chuyển số nguyên không âm thành cách đọc số tiếng Thái chuẩn (có xử lý 2 trường hợp đặc biệt:
// "เอ็ด" thay cho "หนึ่ง" ở hàng đơn vị khi số có từ 2 chữ số trở lên, và "ยี่สิบ" thay cho
// "สองสิบ" ở hàng chục) — đệ quy theo từng nhóm 6 chữ số (ล้าน) để đọc được số tuỳ ý lớn.
const THAI_DIGIT_WORDS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_PLACE_WORDS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']; // 0=hàng đơn vị..5=hàng trăm nghìn

function thaiWordsUnderMillion(n) {
  if (n <= 0) return '';
  const digitsStr = String(n);
  const len = digitsStr.length;
  let out = '';
  for (let i = 0; i < len; i++) {
    const digit = parseInt(digitsStr[i], 10);
    if (digit === 0) continue;
    const place = len - i - 1; // 0=đơn vị, 1=chục, 2=trăm...
    if (place === 0) {
      out += (digit === 1 && len > 1) ? 'เอ็ด' : THAI_DIGIT_WORDS[digit];
    } else if (place === 1) {
      out += (digit === 1) ? 'สิบ' : (digit === 2) ? 'ยี่สิบ' : THAI_DIGIT_WORDS[digit] + 'สิบ';
    } else {
      out += THAI_DIGIT_WORDS[digit] + THAI_PLACE_WORDS[place];
    }
  }
  return out;
}

function thaiNumberToWords(num) {
  num = Math.round(num);
  if (num === 0) return 'ศูนย์';
  if (num < 0) return 'ลบ' + thaiNumberToWords(-num);
  const millions = Math.floor(num / 1000000);
  const remainder = num % 1000000;
  let out = '';
  if (millions > 0) out += thaiNumberToWords(millions) + 'ล้าน';
  out += thaiWordsUnderMillion(remainder);
  return out;
}

// ── TIỀN TỆ ─────────────────────────────────────────────────────────────
// _currencyRate: lưu tỷ giá THB→VND của lần render gần nhất (1 THB = _currencyRate VND),
// dùng cho ô đổi tiền 2 chiều bên dưới (onCurrencyConvertInput) — không gọi API riêng nữa,
// chỉ tính toán tại chỗ từ số đã có sẵn.
let _currencyRate = null;

async function loadCurrencyCard() {
  const body = document.getElementById('currencyCardBody');
  if (!body) return;

  const CACHE_KEY = 'thai_currency_cache';
  const CACHE_MS = 60 * 60 * 1000; // 1 giờ
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    let vnd;
    if (cached && (Date.now() - cached.ts) < CACHE_MS) {
      vnd = cached.vnd;
    } else {
      const r = await fetch('https://open.er-api.com/v6/latest/THB');
      const json = await r.json();
      vnd = json && json.rates && json.rates.VND;
      if (!vnd) throw new Error('no VND rate');
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), vnd }));
    }
    renderCurrencyCard(vnd);
  } catch (e) {
    body.innerHTML = '<div class="info-card-error">Không tải được tỷ giá lúc này.</div>';
  }
}

// ── Đổi tiền 2 chiều ──
// _currencyDir: ô nào nằm bên TRÁI ("nguồn"): 'thb' (mặc định) hoặc 'vnd' — đổi bằng nút ⇄. Chip số tiền nhanh luôn theo đơn vị của ô trái.
// Ghi nhớ giữa các lần mở (localStorage): hướng (thai_currency_dir) và số tiền gõ gần nhất kèm đơn vị đã gõ (thai_currency_last).
const CURRENCY_DIR_KEY = 'thai_currency_dir';
const CURRENCY_LAST_KEY = 'thai_currency_last';
const CURRENCY_QUICK = { thb: [20, 50, 100, 500, 1000], vnd: [50000, 100000, 200000, 500000, 1000000] };
let _currencyDir = (function() { try { return localStorage.getItem(CURRENCY_DIR_KEY) === 'vnd' ? 'vnd' : 'thb'; } catch (e) { return 'thb'; } })();

function currencyChipLabel(cur, n) {
  if (cur === 'thb') return n.toLocaleString('vi-VN');
  return n >= 1000000 ? (n / 1000000) + ' tr' : (n / 1000) + 'k';
}

function buildCurrencyFieldHtml(cur) {
  const isThb = cur === 'thb';
  return '<div class="currency-converter-col">' +
    '<div class="currency-converter-field">' +
      '<input type="text" inputmode="numeric" autocomplete="off" class="currency-converter-input" id="' + (isThb ? 'currencyConvThbInput' : 'currencyConvVndInput') + '" placeholder="0" oninput="onCurrencyConvertInput(\'' + cur + '\')">' +
      '<span class="currency-converter-unit">' + (isThb ? '฿' : '₫') + '</span>' +
    '</div>' +
    '<div class="currency-converter-read-row">' +
      '<div class="currency-converter-thai-read" id="' + (isThb ? 'currencyConvThbRead' : 'currencyConvVndRead') + '"></div>' +
      '<button type="button" class="widget-speak-btn" id="' + (isThb ? 'currencyConvThbSpeak' : 'currencyConvVndSpeak') + '" aria-label="Phát âm" title="Phát âm" hidden onclick="widgetSpeak(this, event)">' + WIDGET_SPEAK_ICON + '</button>' +
    '</div>' +
  '</div>';
}

// Dựng lại khối đổi tiền (chip + 2 ô theo hướng hiện tại). Giữ nguyên giá trị đang hiện ở 2 ô khi đổi chiều (keepValues).
function renderCurrencyConverter(keepValues) {
  const wrap = document.getElementById('currencyConverterWrap');
  if (!wrap) return;
  const left = _currencyDir, right = left === 'thb' ? 'vnd' : 'thb';
  const chips = CURRENCY_QUICK[left].map(function(n) {
    return '<button type="button" class="currency-quick-chip" onclick="onCurrencyQuickAmount(' + n + ')">' + currencyChipLabel(left, n) + '</button>';
  }).join('');
  wrap.innerHTML =
    '<div class="currency-quick-row">' + chips + '</div>' +
    '<div class="currency-converter">' +
      buildCurrencyFieldHtml(left) +
      '<button type="button" class="currency-swap-btn" aria-label="Đổi chiều" title="Đổi chiều" onclick="onCurrencySwap(event)">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>' +
      '</button>' +
      buildCurrencyFieldHtml(right) +
    '</div>';
  if (keepValues) {
    document.getElementById('currencyConvThbInput').value = keepValues.thb;
    document.getElementById('currencyConvVndInput').value = keepValues.vnd;
    updateCurrencyReads(keepValues.thbRead, keepValues.vndRead);
  }
}

function renderCurrencyCard(vnd) {
  const body = document.getElementById('currencyCardBody');
  if (!body) return;
  const vndRounded = Math.round(vnd);
  _currencyRate = vnd; // lưu lại cho ô đổi tiền bên dưới
  // Cập nhật LUÔN nhãn nút "Tỷ giá" ở thanh top-info (nếu đang có trên trang) — dùng đúng số vừa tính ra ở trên, không gọi API riêng lần nữa.
  const topLabel = document.getElementById('topInfoCurrencyLabel');
  if (topLabel) topLabel.textContent = '1 ฿ ≈ ' + vndRounded.toLocaleString('vi-VN') + ' ₫';
  body.innerHTML = '<div id="currencyConverterWrap"></div><div id="currencyExampleWrap"></div>';
  renderCurrencyConverter();
  restoreCurrencyLast();
  renderCurrencyExample();
}

// Khôi phục số tiền gõ gần nhất (và đơn vị đã gõ) rồi tính lại theo tỷ giá mới
function restoreCurrencyLast() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem(CURRENCY_LAST_KEY) || 'null'); } catch (e) { last = null; }
  if (!last || !last.amount || (last.cur !== 'thb' && last.cur !== 'vnd')) return;
  const input = document.getElementById(last.cur === 'thb' ? 'currencyConvThbInput' : 'currencyConvVndInput');
  if (!input) return;
  input.value = Number(last.amount).toLocaleString('vi-VN');
  onCurrencyConvertInput(last.cur, true);
}

function updateCurrencyReads(thbText, vndText) {
  [['Thb', thbText], ['Vnd', vndText]].forEach(function(pair) {
    const readEl = document.getElementById('currencyConv' + pair[0] + 'Read');
    const spk = document.getElementById('currencyConv' + pair[0] + 'Speak');
    if (readEl) readEl.textContent = pair[1] || '';
    if (spk) { spk.hidden = !pair[1]; spk.setAttribute('data-speak', pair[1] || ''); }
  });
}

// Chip số tiền nhanh: điền vào ô bên trái (nguồn) rồi tính ô kia.
function onCurrencyQuickAmount(n) {
  const input = document.getElementById(_currencyDir === 'thb' ? 'currencyConvThbInput' : 'currencyConvVndInput');
  if (!input) return;
  input.value = n.toLocaleString('vi-VN');
  onCurrencyConvertInput(_currencyDir);
}

// Nút ⇄: đổi vị trí 2 ô (ô bên trái trở thành ô còn lại), giữ nguyên 2 giá trị đang hiện, chip đổi theo đơn vị mới.
// event.stopPropagation(): nút ⇄ bị dựng lại ngay trong handler (không còn nằm trong popup lúc sự kiện nổi lên document) → handler "bấm ra ngoài" của popup
// (app.js: popup.contains(e.target)) sẽ tưởng là click ngoài và đóng popup.
function onCurrencySwap(ev) {
  if (ev) ev.stopPropagation();
  const snap = {
    thb: (document.getElementById('currencyConvThbInput') || {}).value || '',
    vnd: (document.getElementById('currencyConvVndInput') || {}).value || '',
    thbRead: (document.getElementById('currencyConvThbRead') || {}).textContent || '',
    vndRead: (document.getElementById('currencyConvVndRead') || {}).textContent || ''
  };
  _currencyDir = _currencyDir === 'thb' ? 'vnd' : 'thb';
  try { localStorage.setItem(CURRENCY_DIR_KEY, _currencyDir); } catch (e) {}
  renderCurrencyConverter(snap);
}

// Ô đổi tiền 2 chiều: gõ số ở 1 trong 2 ô, ô còn lại tự tính theo _currencyRate. Chỉ giữ lại chữ số khi đọc giá trị gõ vào (bỏ dấu chấm/phẩy ngăn cách
// người dùng có thể gõ); ô KẾT QUẢ mới được định dạng lại có dấu ngăn cách hàng nghìn. Đồng thời hiện cách đọc bằng chữ Thái (thaiNumberToWords) bên dưới
// CẢ 2 ô (+ nút loa). Khi gõ vào ô ₫, số baht tương ứng có thể lẻ (vd 0,13 ฿) nên làm tròn số nguyên RIÊNG cho phần đọc chữ (không ảnh hưởng số hiển thị
// trong ô). skipSave=true khi khôi phục từ localStorage (không ghi lại).
function onCurrencyConvertInput(source, skipSave) {
  if (!_currencyRate) return;
  const thbInput = document.getElementById('currencyConvThbInput');
  const vndInput = document.getElementById('currencyConvVndInput');
  if (!thbInput || !vndInput) return;

  let thbVal = null, vndVal = null, typedDigits = '';
  if (source === 'thb') {
    typedDigits = thbInput.value.replace(/[^\d]/g, '');
    if (typedDigits) {
      thbVal = parseInt(typedDigits, 10);
      vndVal = Math.round(thbVal * _currencyRate);
      vndInput.value = vndVal.toLocaleString('vi-VN');
    } else {
      vndInput.value = '';
    }
  } else {
    typedDigits = vndInput.value.replace(/[^\d]/g, '');
    if (typedDigits) {
      vndVal = parseInt(typedDigits, 10);
      thbInput.value = (vndVal / _currencyRate).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
      thbVal = Math.round(vndVal / _currencyRate); // chỉ làm tròn riêng cho phần đọc chữ
    } else {
      thbInput.value = '';
    }
  }
  updateCurrencyReads(thbVal !== null ? thaiNumberToWords(thbVal) : '', vndVal !== null ? thaiNumberToWords(vndVal) : '');
  if (!skipSave) {
    try {
      if (typedDigits) localStorage.setItem(CURRENCY_LAST_KEY, JSON.stringify({ cur: source, amount: typedDigits }));
      else localStorage.removeItem(CURRENCY_LAST_KEY);
    } catch (e) {}
  }
}

// ── Câu ví dụ của card Tỷ giá (thay cho danh sách từ vựng cũ) ──
// Admin tự nhập bằng ô rich text (B / I / U): 1 ô chữ Thái + 1 ô nghĩa tiếng Việt. Lưu trong bảng home_cards_config (cột title) với 2 khóa
// "currency_example_thai" / "currency_example_viet" — không cần thêm bảng hay cột mới. Phiên âm KHÔNG nhập: tự lấy từ từ điển cho các từ có trong câu;
// chữ Thái có trong từ điển bấm được để tra nhanh; loa đọc cả câu. Hiển thị cùng kiểu câu ví dụ của card Thời tiết. Chưa nhập gì thì ẩn cả khối.
const CURRENCY_EX_KEYS = { thai: 'currency_example_thai', viet: 'currency_example_viet' };
let _currencyExample = { thai: '', viet: '' };

// Chỉ giữ định dạng đơn giản (đậm / nghiêng / gạch chân / xuống dòng), bỏ mọi thẻ và thuộc tính khác — nội dung do admin nhập nhưng vẫn lọc cho an toàn.
function sanitizeExampleHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const KEEP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', BR: 'br' };
  const BLOCK = { DIV: 1, P: 1, LI: 1 };
  const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1 }; // bỏ luôn cả nội dung bên trong, không chỉ bỏ thẻ
  function walk(node) {
    let out = '';
    node.childNodes.forEach(function(ch) {
      if (ch.nodeType === 3) { out += ch.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); return; }
      if (ch.nodeType !== 1) return;
      const tag = ch.tagName;
      if (DROP[tag]) return;
      const inner = walk(ch);
      if (KEEP[tag] === 'br') out += '<br>';
      else if (KEEP[tag]) out += '<' + KEEP[tag] + '>' + inner + '</' + KEEP[tag] + '>';
      else if (BLOCK[tag]) out += (out && !/<br>$/.test(out) ? '<br>' : '') + inner;
      else out += inner; // thẻ lạ: bỏ thẻ, giữ chữ bên trong
    });
    return out;
  }
  return walk(tpl.content).replace(/(<br>)+$/, '').trim();
}
function htmlToPlainText(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.innerText !== undefined ? d.innerText : d.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderCurrencyExample() {
  const wrap = document.getElementById('currencyExampleWrap');
  if (!wrap) return;
  const thaiHtml = sanitizeExampleHtml(_currencyExample.thai);
  const vietHtml = sanitizeExampleHtml(_currencyExample.viet);
  const plain = htmlToPlainText(thaiHtml);
  if (!plain && !htmlToPlainText(vietHtml)) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="weather-example currency-example">' +
    '<div class="weather-example-row"><div class="weather-example-thai" id="currencyExampleThai">' + thaiHtml + '</div>' + widgetSpeakBtnHtml(plain) + '</div>' +
    '<div class="weather-example-phonetic" data-phon-seq="' + escapeHtml(plain) + '"></div>' +
    (vietHtml ? '<div class="weather-example-viet">' + vietHtml + '</div>' : '') +
  '</div>';
  refreshDictPhonetics(wrap);
  const exEl = document.getElementById('currencyExampleThai');
  ensureExampleLinks(exEl);
  observeExampleLine(exEl);
}

// Đọc cấu hình từ home_cards_config (cùng lượt tải với tiêu đề card) → nhận 2 dòng ví dụ tỷ giá
function applyCurrencyExampleRows(list) {
  list.forEach(function(row) {
    if (row.card_key === CURRENCY_EX_KEYS.thai) _currencyExample.thai = row.title || '';
    if (row.card_key === CURRENCY_EX_KEYS.viet) _currencyExample.viet = row.title || '';
  });
  renderCurrencyExample();
  fillCurrencyExampleAdmin();
}
function fillCurrencyExampleAdmin() {
  const t = document.getElementById('currencyExampleThaiInput');
  const v = document.getElementById('currencyExampleVietInput');
  if (t) t.innerHTML = sanitizeExampleHtml(_currencyExample.thai);
  if (v) v.innerHTML = sanitizeExampleHtml(_currencyExample.viet);
}
async function loadCurrencyExampleAdmin() {
  try {
    const rows = await sbGet('home_cards_config?select=*');
    if (Array.isArray(rows)) applyCurrencyExampleRows(rows);
  } catch (e) { /* giữ nội dung hiện có */ }
  fillCurrencyExampleAdmin();
}
async function saveCurrencyExample() {
  const thai = sanitizeExampleHtml((document.getElementById('currencyExampleThaiInput') || {}).innerHTML);
  const viet = sanitizeExampleHtml((document.getElementById('currencyExampleVietInput') || {}).innerHTML);
  if (!htmlToPlainText(thai) && htmlToPlainText(viet)) { showToast('⚠️ Nhập câu tiếng Thái trước (hoặc xóa cả hai ô để ẩn ví dụ)'); return; }
  try {
    const res = await sbPostAuth('home_cards_config', [
      { card_key: CURRENCY_EX_KEYS.thai, title: thai },
      { card_key: CURRENCY_EX_KEYS.viet, title: viet }
    ], 'card_key');
    if (!Array.isArray(res)) throw new Error('save failed'); // sbPostAuth trả object lỗi (không throw) khi bị chặn / lỗi
    _currencyExample = { thai: thai, viet: viet };
    renderCurrencyExample();
    showToast(thai || viet ? '✅ Đã lưu câu ví dụ' : '✅ Đã xóa câu ví dụ (khối ví dụ sẽ ẩn)');
  } catch (e) {
    showToast('⚠️ Không lưu được câu ví dụ — kiểm tra bảng home_cards_config (cần nhận khóa currency_example_thai / currency_example_viet)');
  }
}

// ── ẨM THỰC (bảng home_food_list) ───────────────────────────────────────
// _foodListCache: danh sách món ăn đã tải sẵn ở loadFoodCard() — nút "ngẫu nhiên" trong popup
// (pickRandomFood) dùng lại đúng danh sách này, không gọi lại DB.
// _currentFoodDishId: id món đang hiện trong popup, để nút ngẫu nhiên tránh chọn trùng món hiện tại.
let _foodListCache = [];
let _currentFoodDishId = null;

function buildFoodDishRowHtml(dish) {
  const mainRow =
    '<div class="food-card-row">' +
      '<div class="food-card-emoji">' + (dish.emoji || '🍽️') + '</div>' +
      '<div>' +
        '<span class="food-card-name-thai" onclick="goToWordByThai(\'' + dish.thai + '\')">' + dish.thai + '</span>' +
        '<span class="food-card-phonetic"' + phonAttrs(dish.thai, dish.phonetic) + '>' + escapeHtml(dish.phonetic || '') + '</span>' +
        widgetSpeakBtnHtml(dish.thai) +
        '<div class="food-card-viet">' + dish.viet + '</div>' +
        (dish.description ? '<div class="food-card-desc">' + dish.description + '</div>' : '') +
      '</div>' +
    '</div>';
  // "Cách gọi món" và "fact văn hoá" — admin tự nhập tay (tiếng Thái + tiếng Việt), thay cho mục
  // độ cay cũ. Chỉ hiện mục nào admin đã nhập (bỏ trống thì ẩn cả khối, không hiện tiêu đề rỗng).
  const orderSection = (dish.order_phrase_thai || dish.order_phrase_viet)
    ? '<div class="food-card-section">' +
        '<div class="food-card-section-label">🗣️ Cách gọi món</div>' +
        (dish.order_phrase_thai ? '<div class="food-card-order-thai"><span>' + dish.order_phrase_thai + '</span>' + widgetSpeakBtnHtml(dish.order_phrase_thai) + '</div>' : '') +
        (dish.order_phrase_viet ? '<div class="food-card-order-viet">' + dish.order_phrase_viet + '</div>' : '') +
      '</div>'
    : '';
  const factSection = (dish.culture_fact_thai || dish.culture_fact_viet)
    ? '<div class="food-card-section">' +
        '<div class="food-card-section-label">📖 Bạn có biết?</div>' +
        (dish.culture_fact_thai ? '<div class="food-card-fact-thai">' + dish.culture_fact_thai + '</div>' : '') +
        (dish.culture_fact_viet ? '<div class="food-card-fact-viet">' + dish.culture_fact_viet + '</div>' : '') +
      '</div>'
    : '';
  return mainRow + orderSection + factSection;
}

async function loadFoodCard() {
  const body = document.getElementById('foodCardBody');
  if (!body) return;
  try {
    const rows = await sbGet('home_food_list?select=*&order=sort_order.asc,id.asc');
    const list = Array.isArray(rows) ? rows : [];
    _foodListCache = list;
    if (!list.length) { body.innerHTML = '<div class="info-card-error">Chưa có món ăn nào được thêm.</div>'; return; }
    const startOfYear = new Date(new Date().getFullYear(), 0, 0);
    const diff = Date.now() - startOfYear.getTime();
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    const dish = list[dayOfYear % list.length];
    _currentFoodDishId = dish.id;
    // Cập nhật LUÔN nhãn nút "Món ăn" ở thanh top-info (nếu đang có trên trang) — đúng món ăn
    // của hôm nay vừa tính ra ở trên, không gọi lại API/DB lần nữa (giống cách đã làm với nhãn
    // "Tỷ giá" và "Thời tiết"). Nhãn này LUÔN hiện món "của hôm nay" cố định — nút ngẫu nhiên bên
    // dưới chỉ đổi phần hiển thị trong popup, không đụng tới nhãn này.
    const topLabel = document.getElementById('topInfoFoodLabel');
    if (topLabel) topLabel.textContent = dish.thai; // bỏ emoji món ăn ở nhãn thanh trên cùng (popup vẫn hiện emoji)
    body.innerHTML =
      '<div id="foodCardDishRow">' + buildFoodDishRowHtml(dish) + '</div>' +
      '<button type="button" class="food-random-btn" onclick="pickRandomFood()">' +
        '<span class="food-random-btn-thai">อยากกินอะไรดี</span>' +
        '<span class="food-random-btn-viet">Thèm ăn gì nhỉ?</span>' +
      '</button>';
    refreshDictPhonetics(body);
  } catch (e) {
    body.innerHTML = '<div class="info-card-error">Không tải được món ăn hôm nay.</div>';
  }
}

// Nút "ngẫu nhiên" trong popup: chọn 1 món KHÁC món đang hiện (nếu danh sách có từ 2 món trở
// lên) từ đúng danh sách đã tải sẵn (_foodListCache), không gọi lại DB — chỉ đổi phần hiển thị
// món ăn trong popup, KHÔNG đụng tới nhãn "Món ăn" ở thanh top-info (nhãn đó luôn hiện đúng món
// "của hôm nay" theo ngày, cố định).
function pickRandomFood() {
  if (!_foodListCache.length) return;
  const pool = (_foodListCache.length > 1)
    ? _foodListCache.filter(function(f) { return f.id !== _currentFoodDishId; })
    : _foodListCache;
  const dish = pool[Math.floor(Math.random() * pool.length)];
  _currentFoodDishId = dish.id;
  const row = document.getElementById('foodCardDishRow');
  if (row) { row.innerHTML = buildFoodDishRowHtml(dish); refreshDictPhonetics(row); }
}

// Admin: quản lý danh sách món ăn (thêm / sửa / xóa)
let allFoodItems = [];
let editingFoodId = null;

async function loadFoodAdmin() {
  try {
    const rows = await sbGet('home_food_list?select=*&order=sort_order.asc,id.asc');
    allFoodItems = Array.isArray(rows) ? rows : [];
  } catch (e) { allFoodItems = []; }
  renderFoodAdminList();
}

function renderFoodAdminList() {
  const el = document.getElementById('foodAdminList');
  if (!el) return;
  el.innerHTML = allFoodItems.length
    ? allFoodItems.map(function(f) {
        return '<div class="wla-row">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="iv-admin-thai">' + (f.emoji || '🍽️') + ' ' + f.thai + '</div>' +
            '<div class="iv-admin-sub">' + (f.phonetic || '') + ' — ' + f.viet + '</div>' +
          '</div>' +
          '<div class="wla-actions">' +
            '<button class="btn-small edit" title="Chỉnh sửa" onclick="openEditFoodModal(' + f.id + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>' +
            '<button class="btn-small del" title="Xóa" onclick="deleteFoodItem(' + f.id + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>' +
          '</div>' +
        '</div>';
      }).join('')
    : '<div class="quote-admin-empty">Chưa có món ăn nào</div>';
}

async function saveFoodItem() {
  const thai = document.getElementById('foodThaiInput').value.trim();
  const phonetic = document.getElementById('foodPhoneticInput').value.trim();
  const viet = document.getElementById('foodVietInput').value.trim();
  const emoji = document.getElementById('foodEmojiInput').value.trim() || '🍽️';
  const description = document.getElementById('foodDescInput').value.trim();
  const order_phrase_thai = document.getElementById('foodOrderThaiInput').value.trim();
  const order_phrase_viet = document.getElementById('foodOrderVietInput').value.trim();
  const culture_fact_thai = document.getElementById('foodFactThaiInput').value.trim();
  const culture_fact_viet = document.getElementById('foodFactVietInput').value.trim();
  if (!thai || !viet) { showToast('⚠️ Nhập tên món tiếng Thái và tiếng Việt'); return; }
  try {
    const sortOrder = allFoodItems.length ? Math.max.apply(null, allFoodItems.map(function(f) { return f.sort_order || 0; })) + 1 : 1;
    await sbPostAuth('home_food_list', { thai, phonetic, viet, emoji, description, order_phrase_thai, order_phrase_viet, culture_fact_thai, culture_fact_viet, sort_order: sortOrder });
    document.getElementById('foodThaiInput').value = '';
    document.getElementById('foodPhoneticInput').value = '';
    document.getElementById('foodVietInput').value = '';
    document.getElementById('foodEmojiInput').value = '';
    document.getElementById('foodDescInput').value = '';
    document.getElementById('foodOrderThaiInput').value = '';
    document.getElementById('foodOrderVietInput').value = '';
    document.getElementById('foodFactThaiInput').value = '';
    document.getElementById('foodFactVietInput').value = '';
    showToast('✅ Đã thêm món ăn');
    await loadFoodAdmin();
    loadFoodCard();
  } catch (e) {
    showToast('⚠️ Lỗi khi lưu, thử lại sau');
  }
}

function openEditFoodModal(id) {
  const f = allFoodItems.find(function(x) { return x.id === id; });
  if (!f) return;
  editingFoodId = id;
  document.getElementById('editFoodThaiInput').value = f.thai || '';
  document.getElementById('editFoodPhoneticInput').value = f.phonetic || '';
  document.getElementById('editFoodVietInput').value = f.viet || '';
  document.getElementById('editFoodEmojiInput').value = f.emoji || '';
  document.getElementById('editFoodDescInput').value = f.description || '';
  document.getElementById('editFoodOrderThaiInput').value = f.order_phrase_thai || '';
  document.getElementById('editFoodOrderVietInput').value = f.order_phrase_viet || '';
  document.getElementById('editFoodFactThaiInput').value = f.culture_fact_thai || '';
  document.getElementById('editFoodFactVietInput').value = f.culture_fact_viet || '';
  document.getElementById('editFoodError').textContent = '';
  document.getElementById('editFoodModal').classList.add('show');
}

function closeEditFoodModal() {
  document.getElementById('editFoodModal').classList.remove('show');
  editingFoodId = null;
}

async function saveEditFoodItem() {
  if (!editingFoodId) return;
  const thai = document.getElementById('editFoodThaiInput').value.trim();
  const phonetic = document.getElementById('editFoodPhoneticInput').value.trim();
  const viet = document.getElementById('editFoodVietInput').value.trim();
  const emoji = document.getElementById('editFoodEmojiInput').value.trim() || '🍽️';
  const description = document.getElementById('editFoodDescInput').value.trim();
  const order_phrase_thai = document.getElementById('editFoodOrderThaiInput').value.trim();
  const order_phrase_viet = document.getElementById('editFoodOrderVietInput').value.trim();
  const culture_fact_thai = document.getElementById('editFoodFactThaiInput').value.trim();
  const culture_fact_viet = document.getElementById('editFoodFactVietInput').value.trim();
  const errorEl = document.getElementById('editFoodError');
  errorEl.textContent = '';
  if (!thai || !viet) { errorEl.textContent = 'Vui lòng nhập tên món tiếng Thái và tiếng Việt'; return; }
  try {
    await sbPatchAuth('home_food_list?id=eq.' + editingFoodId, { thai, phonetic, viet, emoji, description, order_phrase_thai, order_phrase_viet, culture_fact_thai, culture_fact_viet });
    closeEditFoodModal();
    showToast('✅ Đã cập nhật món ăn');
    await loadFoodAdmin();
    loadFoodCard();
  } catch (e) {
    errorEl.textContent = 'Lỗi khi cập nhật: ' + (e.message || 'thử lại sau');
  }
}

async function deleteFoodItem(id) {
  if (!confirm('Xóa món ăn này?')) return;
  try {
    await sbDeleteAuth('home_food_list?id=eq.' + id);
    showToast('Đã xóa món ăn');
    await loadFoodAdmin();
    loadFoodCard();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, thử lại sau');
  }
}

// Gọi tải dữ liệu 3 card ngay khi module này được import lần đầu (tức là ngay
// khi popup "Thông tin nhanh" vừa mở lần đầu tiên trong phiên) — thay cho việc
// gọi trong loadWords() lúc trang chủ vừa load xong như code cũ.
ensureWidgetCardsLoaded();

Object.assign(window, {
  openHomeInfoPopup, goToWordByThai,
  loadHomeCardsConfig, saveCardTitle,
  widgetSpeak, toggleWeatherProvMenu, filterWeatherProvinces,
  loadWeatherCard, renderWeatherCard, onWeatherProvinceChange,
  loadCurrencyCard, renderCurrencyCard, onCurrencyConvertInput, onCurrencyQuickAmount, onCurrencySwap, loadCurrencyExampleAdmin, saveCurrencyExample,
  loadFoodCard, pickRandomFood, loadFoodAdmin, renderFoodAdminList, saveFoodItem, openEditFoodModal, closeEditFoodModal, saveEditFoodItem, deleteFoodItem
});

export { openHomeInfoPopup, loadCurrencyExampleAdmin, loadFoodAdmin };

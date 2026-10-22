// ══════════════════════════════════════════════════════════════════
// modules/keyboard.js — ALAY
// Bàn phím ảo TIS 820-2531 + canvas viết tay (nhận diện nét vẽ: ưu tiên API ink recognition
// của Google — cùng backend Google Dịch dùng — dự phòng bằng Tesseract.js khi Google lỗi/chặn).
// Tách khỏi app.js (lazy-load qua import() động) — chỉ được trình duyệt tải
// về khi người dùng THỰC SỰ bấm mở bàn phím ảo lần đầu tiên (openKeyboard),
// không nằm sẵn trong bundle app.js ban đầu nữa.
//
// LƯU Ý: đây là ES module thật (nạp qua import()), nên các biến let/const
// khai báo bên trong KHÔNG rò ra ngoài (không đụng độ tên với app.js).
// Ngược lại, để code TRONG module này gọi được các hàm dùng chung của
// app.js (vd showToast, onSearchWithClear...), những hàm đó phải là khai
// báo kiểu 'function xxx(){}' ở top-level app.js — loại này tự động thành
// thuộc tính của window nên module vẫn thấy được bình thường.
// ══════════════════════════════════════════════════════════════════

// ── THAI KEYBOARD ─────────────────────────────────────
// TIS 820-2531 standard layout
const TIS_NORMAL = [
  [
    {m:'ๅ',s:'๑'},{m:'/',s:'๒'},{m:'-',s:'๓'},{m:'ภ',s:'๔'},
    {m:'ถ',s:'ู'},{m:'ุ',s:'฿'},{m:'ึ',s:'๕'},{m:'ค',s:'๖'},
    {m:'ต',s:'๗'},{m:'จ',s:'๘'},{m:'ข',s:'๙'},{m:'ช',s:'๐'},
  ],
  [
    {m:'ๆ',s:'๐'},{m:'ไ',s:'ๅ'},{m:'ำ',s:'ๆ'},{m:'พ',s:'โ'},
    {m:'ะ',s:'ฌ'},{m:'ั',s:'็'},{m:'ี',s:'๋'},{m:'ร',s:'ษ'},
    {m:'น',s:'ซ'},{m:'ย',s:'ศ'},{m:'บ',s:'ซ'},{m:'ล',s:'ฅ'},{m:'ฃ',s:''},
  ],
  [
    {m:'ฟ',s:'ฎ'},{m:'ห',s:'ฑ'},{m:'ก',s:'ธ'},{m:'ด',s:'ํ'},
    {m:'เ',s:'๊'},{m:'้',s:'ณ'},{m:'่',s:'ฯ'},{m:'า',s:'ญ'},
    {m:'ส',s:'ฐ'},{m:'ว',s:'ฑ'},{m:'ง',s:'ข'},
  ],
  [
    {m:'ผ',s:'ฉ'},{m:'ป',s:'ฮ'},{m:'แ',s:'ฆ'},{m:'อ',s:'ฑ'},
    {m:'ิ',s:'ั'},{m:'ื',s:'ั'},{m:'ท',s:'ภ'},{m:'ม',s:'ฒ'},
    {m:'ใ',s:'ฬ'},{m:'ฝ',s:'ฦ'},
  ],
];

let kbdShift = false;
let kbdTargetId = '';
let kbdActiveTab = 'tis';

function switchKbdTab(tab) {
  kbdActiveTab = tab;
  document.getElementById('kbdTIS').style.display = tab === 'tis' ? '' : 'none';
  document.getElementById('kbdHW').style.display = tab === 'hw' ? '' : 'none';
  document.getElementById('tabTIS').classList.toggle('active', tab === 'tis');
  document.getElementById('tabHW').classList.toggle('active', tab === 'hw');
  if (tab === 'hw') initCanvas();
}

function openKeyboard(inputId) {
  kbdTargetId = inputId;
  kbdShift = false;
  renderKeyboard();
  switchKbdTab('tis');
  document.getElementById('kbdOverlay').classList.add('show');
  restoreKbdPanelPosition();
}

// ── Kéo di chuyển bàn phím ảo (floating panel) ─────────
// CHỈ áp dụng trên desktop: trên mobile bàn phím hiện dạng bottom sheet cố định ở đáy màn hình
// (xem @media trong style.css) — kéo-thả tự do sẽ phá layout đó (panel bị đẩy ra giữa màn hình,
// mất trạng thái "dính đáy"), nên chủ động tắt hẳn tính năng kéo khi màn hẹp.
const KBD_MOBILE_BREAKPOINT = 640;
function isKbdMobile() { return window.innerWidth <= KBD_MOBILE_BREAKPOINT; }

let kbdDrag = { active: false, offsetX: 0, offsetY: 0 };

function kbdDragStart(e) {
  if (isKbdMobile()) return;
  const panel = document.getElementById('kbdPanel');
  const rect = panel.getBoundingClientRect();
  kbdDrag.active = true;
  kbdDrag.offsetX = e.clientX - rect.left;
  kbdDrag.offsetY = e.clientY - rect.top;
  panel.style.left = rect.left + 'px';
  panel.style.top = rect.top + 'px';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  e.preventDefault();
}

function kbdDragMove(e) {
  if (!kbdDrag.active) return;
  const panel = document.getElementById('kbdPanel');
  const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
  const x = Math.min(Math.max(e.clientX - kbdDrag.offsetX, 0), maxX);
  const y = Math.min(Math.max(e.clientY - kbdDrag.offsetY, 0), maxY);
  panel.style.left = x + 'px';
  panel.style.top = y + 'px';
}

function kbdDragEnd() {
  if (!kbdDrag.active) return;
  kbdDrag.active = false;
  const panel = document.getElementById('kbdPanel');
  localStorage.setItem('thai_kbd_pos', JSON.stringify({
    left: parseFloat(panel.style.left) || 0,
    top: parseFloat(panel.style.top) || 0
  }));
}

document.addEventListener('pointermove', kbdDragMove);
document.addEventListener('pointerup', kbdDragEnd);

// Khôi phục vị trí bàn phím đã kéo ở lần trước (nếu có), đảm bảo vẫn nằm trong màn hình.
// Trên mobile: bỏ qua hẳn vị trí đã lưu (vốn chỉ có ý nghĩa cho panel nổi/kéo-thả trên desktop)
// và xoá mọi style inline left/top/bottom/transform còn sót lại từ lần kéo trên desktop trước
// đó (nếu người dùng dùng chung tài khoản/trình duyệt trên nhiều thiết bị) — để CSS bottom sheet
// trong @media (max-width:640px) áp dụng đúng, không bị style inline đè lên.
function restoreKbdPanelPosition() {
  const panel = document.getElementById('kbdPanel');
  if (isKbdMobile()) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.transform = '';
    return;
  }
  const saved = JSON.parse(localStorage.getItem('thai_kbd_pos') || 'null');
  if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
    panel.style.left = saved.left + 'px';
    panel.style.top = saved.top + 'px';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
  } else {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.transform = '';
  }
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width);
    const maxY = Math.max(0, window.innerHeight - rect.height);
    const x = Math.min(Math.max(rect.left, 0), maxX);
    const y = Math.min(Math.max(rect.top, 0), maxY);
    if (Math.abs(x - rect.left) > 1 || Math.abs(y - rect.top) > 1) {
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
    }
  });
}

function closeKeyboard() {
  document.getElementById('kbdOverlay').classList.remove('show');
}

// ── Click ra ngoài để đóng bàn phím (mọi kích thước màn hình) ──────────────────────────────
// #kbdOverlay có "pointer-events:none" trên desktop (để không chặn thao tác với phần còn lại
// của trang khi bàn phím đang mở — panel nổi, không phải modal chặn nền) — nghĩa là onclick gắn
// trực tiếp trên chính overlay đó KHÔNG BAO GIỜ tự bắn ở desktop, vì click ở vùng "ngoài panel"
// đi xuyên qua overlay tới phần tử thật sự nằm dưới, overlay không nhận được sự kiện. Đây là lý
// do "click ra ngoài để thoát" trước đó không hoạt động. Sửa bằng cách lắng nghe click ở
// document (nhận được MỌI click dù rơi vào đâu, không phụ thuộc pointer-events của overlay),
// tự kiểm tra: đang mở + click không nằm trong #kbdPanel + không phải đúng cú click vừa mở bàn
// phím (nút mở đều có onclick chứa "openKeyboard", loại trừ để không tự đóng ngay sau khi mở).
document.addEventListener('click', (e) => {
  const overlay = document.getElementById('kbdOverlay');
  if (!overlay || !overlay.classList.contains('show')) return;
  if (e.target.closest('#kbdPanel')) return;
  if (e.target.closest('[onclick*="openKeyboard"]')) return;
  closeKeyboard();
});


function renderKeyboard() {
  const container = document.getElementById('kbdKeys');
  // Store chars in data attr to avoid quote escaping
  const rowsHTML = TIS_NORMAL.map((row) => {
    const keys = row.map((k, ki) => {
      const ch = kbdShift ? (k.s || k.m) : k.m;
      const sub = kbdShift ? k.m : (k.s || '');
      return '<button class="kbd-key" data-ch="' + encodeURIComponent(ch) + '" onclick="kbdTypeFromBtn(this)">'
        + ch
        + (sub ? '<span class="sub">' + sub + '</span>' : '')
        + '</button>';
    }).join('');
    return '<div class="kbd-row">' + keys + '</div>';
  }).join('');

  const shiftStyle = kbdShift ? 'background:#3D6B85;color:#fff;' : '';
  const bottomRow = '<div class="kbd-row" style="margin-top:2px">'
    + '<button class="kbd-key dark" onclick="kbdToggleShift()" style="' + shiftStyle + 'min-width:52px;font-size:16px">⇧</button>'
    + '<button class="kbd-key dark" data-ch="KA" onclick="kbdTypeFromBtn(this)" style="min-width:36px">(</button>'
    + '<button class="kbd-key dark" data-ch="KB" onclick="kbdTypeFromBtn(this)" style="min-width:36px">)</button>'
    + '<button class="kbd-key space-key" data-ch="SP" onclick="kbdTypeFromBtn(this)">วรรค</button>'
    + '<button class="kbd-key dark" onclick="kbdBS()" style="min-width:52px;font-size:16px">⌫</button>'
    + '<button class="kbd-key dark" onclick="closeKeyboard()" style="min-width:52px;background:#3D6B85;color:#fff;font-size:13px">เสร็จ</button>'
    + '</div>';

  container.innerHTML = rowsHTML + bottomRow;
}

function kbdTypeFromBtn(btn) {
  const raw = btn.getAttribute('data-ch');
  if (raw === 'SP') { kbdType(' '); return; }
  if (raw === 'KA') { kbdType('('); return; }
  if (raw === 'KB') { kbdType(')'); return; }
  kbdType(decodeURIComponent(raw));
}

function kbdType(char) {
  const el = document.getElementById(kbdTargetId);
  if (!el) return;
  el.value += char;
  el.dispatchEvent(new Event('input'));
  el.focus();
}
function kbdBS() {
  const el = document.getElementById(kbdTargetId);
  if (!el) return;
  el.value = el.value.slice(0, -1);
  el.dispatchEvent(new Event('input'));
}
function kbdClear() {
  const el = document.getElementById(kbdTargetId);
  if (!el) return;
  el.value = '';
  el.dispatchEvent(new Event('input'));
}
function kbdToggleShift() {
  kbdShift = !kbdShift;
  renderKeyboard();
}

// ── HANDWRITING (nhận diện chữ viết tay bằng Tesseract.js) ─────────────────────────────────
// TRƯỚC ĐÂY showHWResults() chỉ RANDOM 8 ký tự Thái bất kỳ trong 1 danh sách cố định — hoàn
// toàn KHÔNG đọc nét vẽ thật trên canvas (xem comment cũ "simulate handwriting recognition").
// Đây chính là nguyên nhân gốc của lỗi "không nhận dạng đúng nét chữ": chưa từng có nhận diện
// thật nào cả, kết quả luôn ngẫu nhiên bất kể vẽ gì. Sửa tận gốc: chụp lại đúng canvas người
// dùng vừa vẽ rồi đưa qua Tesseract.recognize() — DÙNG CHUNG thư viện Tesseract.js đã có sẵn
// cho tính năng "Tra từ bằng ảnh chụp" (xem onImageSearchSelected trong app.js), không thêm
// dependency mới, không tốn thêm dung lượng tải trang.
//
// LƯU Ý QUAN TRỌNG về giới hạn: Tesseract.js là OCR cho CHỮ IN, không phải công cụ nhận diện
// chữ VIẾT TAY chuyên dụng — độ chính xác với nét vẽ tự do bằng chuột/ngón tay chắc chắn không
// bằng chữ in. Các bước xử lý ảnh dưới đây (crop sát nét vẽ, phóng to, nhị phân hoá đen/trắng,
// giới hạn bộ ký tự) giúp cải thiện đáng kể so với gửi thẳng cả canvas trắng tinh kèm 1 nét vẽ
// nhỏ xíu ở giữa (cách cũ) — nhưng nếu độ chính xác vẫn chưa như ý sau khi thử các thay đổi này,
// đó là giới hạn của bản chất công nghệ OCR chứ không phải lỗi code, cần cân nhắc giải pháp khác
// (vd bộ nhận diện chữ viết tay chuyên dụng) nếu muốn độ chính xác cao hơn nữa.
//
// Dùng 1 worker DÙNG LẠI (persist) giữa các lần đoán trong cùng phiên thay vì gọi thẳng
// Tesseract.recognize() (tự tạo + hủy worker mỗi lần, phải tải lại dữ liệu ngôn ngữ ~vài MB mỗi
// lần) — nếu không sẽ quá chậm vì hàm này bị gọi lại sau MỖI lần dừng nét vẽ (debounce 600ms).
let hwCanvas, hwCtx, hwDrawing = false, hwTimer;
let hwWorker = null, hwWorkerPromise = null, hwRecognizing = false, hwPendingRerun = false;

// Giới hạn bộ ký tự Tesseract được phép đoán — chỉ trong bảng chữ cái/nguyên âm/thanh điệu
// tiếng Thái. Không có whitelist này, Tesseract có thể đoán nhầm sang ký tự Latin/số/ký hiệu
// khác hoàn toàn không liên quan (dựa theo mô hình ngôn ngữ in ấn), làm giảm độ chính xác rõ rệt.
const THAI_CHAR_WHITELIST =
  'กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮ' +
  'ะัาำิีึืุูเแโใไๅ็่้๊๋์ๆฯ' +
  '๐๑๒๓๔๕๖๗๘๙';

async function ensureHwWorker() {
  if (hwWorker) return hwWorker;
  if (!hwWorkerPromise) {
    hwWorkerPromise = (async () => {
      if (!window.Tesseract) throw new Error('Tesseract chưa tải xong');
      const worker = await Tesseract.createWorker('tha');
      await worker.setParameters({
        // PSM 8 = xem như 1 "khối chữ" liền nhau (không bắt buộc đúng 1 ký tự như PSM 10, vốn
        // sẽ đoán sai ngay khi 1 âm tiết Thái gồm nhiều bộ phận ghép — phụ âm + sara trên/dưới +
        // dấu thanh — vì PSM 10 ép Tesseract coi cả cụm đó là ĐÚNG 1 glyph duy nhất).
        tessedit_pageseg_mode: '8',
        tessedit_char_whitelist: THAI_CHAR_WHITELIST
      });
      hwWorker = worker;
      return worker;
    })().catch((err) => { hwWorkerPromise = null; throw err; });
  }
  return hwWorkerPromise;
}

function initCanvas() {
  hwCanvas = document.getElementById('handwriteCanvas');
  if (!hwCanvas) return;
  hwCtx = hwCanvas.getContext('2d');
  hwCtx.strokeStyle = '#3D6B85';
  hwCtx.lineWidth = 5; // đậm hơn (trước là 3) — nét quá mảnh khiến ảnh giống chữ in kém hơn, OCR khó nhận ra hình dạng
  hwCtx.lineCap = 'round';
  hwCtx.lineJoin = 'round';
  clearCanvas();
  ensureHwWorker().catch(() => {}); // tải sẵn worker ngầm lúc mở tab để lần đoán đầu tiên đỡ chậm

  // initCanvas() được gọi lại MỖI LẦN chuyển sang tab "Viết tay" (switchKbdTab) — nếu không có
  // guard này, mỗi lần chuyển tab sẽ GẮN THÊM 1 bộ listener mới đè lên các listener cũ (canvas
  // vẫn nằm nguyên trong DOM, không bị gỡ), khiến 1 lần vẽ thực tế bị xử lý lặp nhiều lần (vẽ đè
  // nét nhiều lần, debounce nhận diện bị gọi chồng chéo) — cũng góp phần gây kết quả sai lệch.
  if (hwCanvas.dataset.hwBound) return;
  hwCanvas.dataset.hwBound = '1';

  hwCanvas.addEventListener('mousedown', startDraw);
  hwCanvas.addEventListener('mousemove', draw);
  hwCanvas.addEventListener('mouseup', endDraw);
  hwCanvas.addEventListener('mouseleave', endDraw);
  hwCanvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e.touches[0]); }, {passive:false});
  hwCanvas.addEventListener('touchmove', e => { e.preventDefault(); draw(e.touches[0]); }, {passive:false});
  hwCanvas.addEventListener('touchend', endDraw);
}

function getPos(e) {
  const r = hwCanvas.getBoundingClientRect();
  const scaleX = hwCanvas.width / r.width;
  const scaleY = hwCanvas.height / r.height;
  return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
}

// Ghi lại toạ độ THẬT của từng nét vẽ (không chỉ vẽ lên canvas như trước) — API nhận diện nét
// vẽ (ink recognition) của Google cần dữ liệu toạ độ theo thứ tự/thời gian thật của từng nét,
// khác hẳn Tesseract (chỉ cần ảnh pixel cuối cùng). hwStrokes = mảng các nét, mỗi nét là
// {x:[...], y:[...]} theo đúng hệ toạ độ gốc của canvas (500×150).
let hwStrokes = [];
let hwCurrentStroke = null;

function startDraw(e) {
  hwDrawing = true;
  const p = getPos(e);
  hwCtx.beginPath();
  hwCtx.moveTo(p.x, p.y);
  hwCurrentStroke = { x: [p.x], y: [p.y] };
  hwStrokes.push(hwCurrentStroke);
}
function draw(e) {
  if (!hwDrawing) return;
  const p = getPos(e);
  hwCtx.lineTo(p.x, p.y);
  hwCtx.stroke();
  if (hwCurrentStroke) { hwCurrentStroke.x.push(p.x); hwCurrentStroke.y.push(p.y); }
  clearTimeout(hwTimer);
  hwTimer = setTimeout(showHWResults, 600);
}
function endDraw() { hwDrawing = false; hwCurrentStroke = null; }

// ── Sửa gốc lỗi thứ 2: "Xóa" canvas trong lúc 1 lệnh nhận diện cũ vẫn đang chạy dở (worker.
// recognize() không có cách hủy giữa chừng) khiến kết quả cũ trả về SAU khi đã xóa, đè lên chữ
// "Viết ký tự để xem gợi ý..." bằng 1 kết quả không còn liên quan gì tới canvas hiện tại. Dùng 1
// bộ đếm "thế hệ" (generation): mỗi lần clearCanvas() tăng số này lên; showHWResults() ghi nhớ
// số tại thời điểm bắt đầu, nếu sau khi đợi xong mà số đã đổi (nghĩa là canvas đã bị xóa/vẽ lại
// từ đầu) thì âm thầm bỏ qua kết quả, không ghi đè UI.
let hwGen = 0;

function clearCanvas() {
  if (!hwCtx) return;
  hwGen++;
  hwStrokes = [];
  hwCurrentStroke = null;
  clearTimeout(hwTimer);
  hwCtx.clearRect(0, 0, hwCanvas.width, hwCanvas.height);
  hwCtx.fillStyle = '#fff';
  hwCtx.fillRect(0, 0, hwCanvas.width, hwCanvas.height);
  document.getElementById('hwResults').innerHTML = '<span style="font-size:13px;color:#8A8079">Viết ký tự để xem gợi ý...</span>';
}

// ── Nhận diện nét vẽ bằng API của Google (CÙNG BACKEND mà ô viết tay trên Google Dịch dùng) ──
// Đây là API KHÔNG CHÍNH THỨC (không tài liệu công khai, không cam kết từ Google) — Google có
// thể đổi định dạng hoặc chặn theo domain bất kỳ lúc nào không báo trước. Vì vậy hàm này LUÔN
// được gọi trong try/catch ở showHWResults() bên dưới: bất kỳ lỗi nào (mất mạng, bị chặn CORS,
// đổi định dạng phản hồi, quá thời gian chờ...) đều khiến code tự động rơi về Tesseract (chạy
// offline, luôn sẵn sàng) — xem đoạn "dự phòng" trong showHWResults(). Ném lỗi ở đây là chuyện
// BÌNH THƯỜNG và được xử lý, không phải bug.
const GOOGLE_INK_ENDPOINT = 'https://www.google.com/inputtools/request?ime=handwriting&app=translate&cs=1&oe=UTF-8&num=8';

async function recognizeWithGoogleInk() {
  if (!hwStrokes.length) return null;
  const ink = hwStrokes.map(s => [s.x, s.y]);
  const body = {
    options: 'enable_pre_space',
    requests: [{
      writing_guide: { writing_area_width: hwCanvas.width, writing_area_height: hwCanvas.height },
      ink: ink,
      language: 'th'
    }]
  };
  const controller = new AbortController();
  // Đừng để treo quá lâu nếu Google chặn/không phản hồi — rơi về Tesseract cho nhanh thay vì
  // bắt người dùng chờ vô thời hạn.
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(GOOGLE_INK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Google ink API trả về lỗi HTTP ' + res.status);
    const json = await res.json();
    // Định dạng phản hồi không có tài liệu chính thức, suy ra từ quan sát thực tế — kiểm tra kỹ
    // hình dạng trước khi dùng, sai hình dạng thì coi như thất bại (ném lỗi) để rơi về Tesseract,
    // thay vì cố dùng dữ liệu không đúng khuôn dạng.
    if (!Array.isArray(json) || json[0] !== 'SUCCESS') throw new Error('Phản hồi không đúng định dạng mong đợi');
    const candidates = json[1] && json[1][0] && json[1][0][1];
    if (!Array.isArray(candidates) || !candidates.length) throw new Error('Không có kết quả phù hợp');
    return candidates.slice(0, 8);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Tiền xử lý ảnh trước khi đưa qua Tesseract ──────────────────────────────────────────────
// Gửi thẳng cả canvas 500×150 gốc (phần lớn là nền trắng trống, nét vẽ chỉ chiếm 1 góc nhỏ)
// khiến bước phân tích bố cục của Tesseract khó xác định đâu là "chữ" — đây là nguyên nhân
// chính khiến bản sửa lần trước vẫn chưa nhận diện đúng. 2 hàm dưới đây: (1) quét pixel tìm
// đúng vùng có nét mực (bounding box), (2) crop sát vùng đó + phóng to cho đủ lớn + nhị phân
// hoá thành đen/trắng thuần (bỏ màu xanh + khử răng cưa) — giống hệt cách 1 ảnh chữ in rõ nét
// thường trông như thế nào, đúng "khẩu vị" của OCR hơn nhiều so với ảnh gốc.
function getInkBoundingBox() {
  const w = hwCanvas.width, h = hwCanvas.height;
  const px = hwCtx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Nền được tô trắng tuyệt đối (clearCanvas dùng fillStyle #fff) — bất kỳ pixel nào tối
      // hơn hẳn màu trắng đều là mực (nét vẽ #3D6B85 hoặc phần khử răng cưa quanh nét).
      if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // canvas trống, chưa vẽ gì
  return { minX, minY, maxX, maxY };
}

function buildRecognitionCanvas() {
  const box = getInkBoundingBox();
  if (!box) return null;
  const bw = box.maxX - box.minX + 1;
  const bh = box.maxY - box.minY + 1;
  const pad = 28;
  // Phóng to sao cho chiều cao nét vẽ đạt khoảng 140px (Tesseract nhận diện tốt hơn hẳn khi chữ
  // đủ lớn/rõ, tương tự cỡ chữ trong ảnh chụp thông thường) — không phóng nếu đã to sẵn hơn mức đó.
  const scale = Math.min(5, Math.max(1, 140 / bh));
  const outW = Math.round(bw * scale) + pad * 2;
  const outH = Math.round(bh * scale) + pad * 2;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  outCtx.fillStyle = '#fff';
  outCtx.fillRect(0, 0, outW, outH);
  outCtx.imageSmoothingEnabled = true;
  outCtx.drawImage(
    hwCanvas,
    box.minX, box.minY, bw, bh,
    pad, pad, Math.round(bw * scale), Math.round(bh * scale)
  );
  // Nhị phân hoá: mọi pixel không phải trắng tuyệt đối (kể cả viền khử răng cưa xám nhạt quanh
  // nét, hay màu xanh #3D6B85 gốc) đều ép thành ĐEN tuyệt đối — bỏ hẳn màu sắc/độ mờ, chỉ còn
  // đen/trắng thuần, đúng dạng ảnh mà engine OCR được huấn luyện để đọc tốt nhất.
  const imgData = outCtx.getImageData(0, 0, outW, outH);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const isInk = d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245;
    if (isInk) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255; }
    else { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255; }
  }
  outCtx.putImageData(imgData, 0, 0);
  return outCanvas;
}

// Nhận diện nét vừa vẽ — ƯU TIÊN Google ink API (chính xác cao, giống Google Dịch), DỰ PHÒNG
// bằng Tesseract (offline, luôn hoạt động) nếu Google lỗi/chặn/mất mạng. Có chống chạy chồng:
// nếu đang đợi kết quả lần trước mà người dùng đã vẽ thêm (debounce mới bắn tiếp), chỉ đánh dấu
// "chạy lại sau khi xong" thay vì bắn thêm 1 lệnh song song — tránh 2 kết quả trả về không theo
// thứ tự (kết quả cũ trả về sau đè lên kết quả mới hơn).
async function showHWResults() {
  if (!hwCanvas || !hwCtx) return;
  if (hwRecognizing) { hwPendingRerun = true; return; }
  hwRecognizing = true;
  const genAtStart = hwGen;
  const resultsEl = document.getElementById('hwResults');
  resultsEl.innerHTML = '<span style="font-size:13px;color:#8A8079">Đang nhận diện...</span>';
  try {
    let chars = null;

    // BƯỚC 1 — thử Google trước (xem comment ở recognizeWithGoogleInk phía trên). Lỗi ở đây là
    // BÌNH THƯỜNG (API không chính thức), im lặng rơi xuống bước 2 chứ không báo lỗi cho người
    // dùng ngay — chỉ thực sự báo lỗi nếu CẢ HAI đều thất bại (xem catch ngoài cùng bên dưới).
    try {
      const googleResult = await recognizeWithGoogleInk();
      if (googleResult && googleResult.length) chars = googleResult;
    } catch (e) { /* rơi xuống Tesseract ở bước 2 */ }

    if (hwGen !== genAtStart) return; // canvas đã bị xóa/vẽ lại trong lúc đợi — bỏ kết quả cũ này

    // BƯỚC 2 — dự phòng bằng Tesseract nếu Google không trả được kết quả nào
    if (!chars) {
      const recCanvas = buildRecognitionCanvas();
      if (!recCanvas) {
        resultsEl.innerHTML = '<span style="font-size:13px;color:#8A8079">Viết ký tự để xem gợi ý...</span>';
        hwRecognizing = false;
        return;
      }
      const worker = await ensureHwWorker();
      const { data } = await worker.recognize(recCanvas);
      if (hwGen !== genAtStart) return;
      chars = Array.from((data.text || '').replace(/\s+/g, '').trim());
    }

    if (!chars.length) {
      resultsEl.innerHTML = '<span style="font-size:13px;color:#8A8079">Chưa nhận diện được, thử viết to và rõ nét hơn</span>';
    } else {
      resultsEl.innerHTML = chars.map(c =>
        '<button class="hw-result-btn" onclick="hwSelect(\'' + c.replace(/'/g, "\\'") + '\')">' + c + '</button>'
      ).join('');
    }
  } catch (err) {
    if (hwGen !== genAtStart) return;
    resultsEl.innerHTML = '<span style="font-size:13px;color:#8A8079">Lỗi nhận diện, thử lại sau</span>';
  } finally {
    hwRecognizing = false;
    if (hwPendingRerun) {
      hwPendingRerun = false;
      showHWResults();
    }
  }
}

function hwSelect(char) {
  kbdType(char);
  clearCanvas();
}

// ── Đăng ký ra window để: (1) HTML tĩnh (onclick="switchKbdTab(...)" v.v.
// vốn có sẵn trong index.html) gọi được ngay sau khi module này tải xong,
// (2) app.js gọi lại đúng phiên bản thật sau khi stub openKeyboard() ở
// app.js await xong import() này (xem loadKeyboardModule ở app.js).
Object.assign(window, {
  switchKbdTab, openKeyboard, kbdDragStart, kbdDragMove, kbdDragEnd,
  restoreKbdPanelPosition, closeKeyboard, renderKeyboard, kbdTypeFromBtn,
  kbdType, kbdBS, kbdClear, kbdToggleShift,
  initCanvas, getPos, startDraw, draw, endDraw, clearCanvas, showHWResults, hwSelect
});

export { openKeyboard };

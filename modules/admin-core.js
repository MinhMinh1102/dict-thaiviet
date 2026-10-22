// ══════════════════════════════════════════════════════════════════
// modules/admin-core.js — ALAY
// Lõi trang quản trị: CRUD từ điển (thêm/sửa/xóa từ + trình soạn định nghĩa
// rich-text/ví dụ/từ đồng-trái nghĩa) và CRUD danh sách quote.
// Lazy-load: chỉ tải khi vào trang quản trị (showPage('admin') ở app.js sẽ
// await import() file này trước khi hiển thị danh sách từ/quote).
//
// PHẠM VI: đây là phần lõi, dùng nhiều nhất của trang admin. Các mảng quản
// trị khác (Font Challenge, góp ý, đề xuất từ mới, quản lý người dùng, tiêu
// đề trang chủ) vẫn còn nằm trong app.js — có thể tách tiếp theo cùng mẫu
// này ở một đợt sau nếu muốn giảm thêm kích thước bundle chính.
// ══════════════════════════════════════════════════════════════════

// ── CRUD TỪ ĐIỂN ─────────────────────────────────────
async function addWord() {
  const thai = document.getElementById('fThai').value.trim();
  const phonetic = document.getElementById('fPhonetic').value.trim();
  const structure = document.getElementById('fStructure').innerHTML.trim();
  const visible = document.getElementById('fVisible') ? document.getElementById('fVisible').checked : true;
  if (!thai) { showToast('⚠️ Vui lòng nhập từ tiếng Thái'); return; }

  const definitions = getDefData('add');
  if (!definitions.length) { showToast('⚠️ Vui lòng thêm ít nhất 1 định nghĩa'); return; }

  // Fallback meanings for backward compat
  const meanings = definitions.map(d => stripHtml(d.viet_meaning) || stripHtml(d.thai_meaning));
  const type = definitions[0]?.type || 'danh từ';

  const btn = document.getElementById('btnAdd');
  btn.disabled = true; btn.textContent = 'Đang lưu...';

  try {
    const result = await sbPostAuth('words', { thai, phonetic: phonetic || null, structure: structure || null, type, meanings, definitions, examples: [], visible });
    if (result && result[0]) {
      allWords.push({ ...result[0], meanings, definitions, examples: [] });
      allWords.sort((a,b) => a.thai.localeCompare(b.thai));
      invalidateSegmentDictCache(); // vừa thêm 1 từ mới → cache Set tách từ PopThai (app.js) cần dựng lại
      document.getElementById('fThai').value = '';
      document.getElementById('fPhonetic').value = '';
      document.getElementById('fStructure').innerHTML = '';
      if (document.getElementById('fVisible')) document.getElementById('fVisible').checked = true;
      document.getElementById('defBuilderList').innerHTML = '';
      defBlocks = [];
      showToast('✅ Đã thêm từ: ' + thai);
      updateStats();
      renderAdminList(allWords);
    } else { showToast('⚠️ Lỗi khi thêm từ'); }
  } catch(e) { showToast('⚠️ Lỗi kết nối'); }

  btn.disabled = false; btn.textContent = 'Thêm từ vào từ điển';
}

// Bật/tắt 1 từ trong danh sách "Từ ngẫu nhiên" (mục chip 🎲 trên thanh search) — cần cột
// "is_random_pick" (boolean, mặc định false) trong bảng words trên Supabase, xem hướng dẫn
// migration SQL đã gửi kèm. Cập nhật lạc quan (optimistic) trên nút bấm trước, rồi PATCH lên
// Supabase; nếu lỗi thì hoàn tác lại trạng thái nút + allWords.
async function toggleRandomPick(id, btnEl) {
  const w = allWords.find(x => x.id === id);
  if (!w) return;
  const next = !w.is_random_pick;
  w.is_random_pick = next;
  if (btnEl) {
    btnEl.classList.toggle('active', next);
    btnEl.title = next ? 'Đang nằm trong danh sách Từ ngẫu nhiên (bấm để bỏ)' : 'Thêm vào danh sách Từ ngẫu nhiên';
  }
  try {
    const resp = await fetch(window.SUPABASE_URL + '/rest/v1/words?id=eq.' + id, {
      method: 'PATCH',
      headers: Object.assign(await authHeaders(), { 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ is_random_pick: next })
    });
    if (!resp.ok) throw new Error('PATCH thất bại');
    showToast(next ? '🎲 Đã thêm vào danh sách Từ ngẫu nhiên: ' + w.thai : '🎲 Đã bỏ khỏi danh sách Từ ngẫu nhiên: ' + w.thai);
  } catch (e) {
    w.is_random_pick = !next; // hoàn tác
    if (btnEl) {
      btnEl.classList.toggle('active', !next);
      btnEl.title = !next ? 'Đang nằm trong danh sách Từ ngẫu nhiên (bấm để bỏ)' : 'Thêm vào danh sách Từ ngẫu nhiên';
    }
    showToast('⚠️ Lỗi khi cập nhật — cần thêm cột "is_random_pick" (boolean) vào bảng words trong Supabase');
  }
}

// Bật/tắt 1 từ trong nhóm "Thành ngữ" (chip Thành ngữ ở thanh tìm kiếm chọn ngẫu nhiên trong nhóm này) — cần cột "is_idiom_pick" (boolean, mặc định false)
// trong bảng words, xem migration_words_idiom_pick.sql. Cùng cách làm với toggleRandomPick(): cập nhật lạc quan, PATCH lên Supabase, lỗi thì hoàn tác.
async function toggleIdiomPick(id, btnEl) {
  const w = allWords.find(x => x.id === id);
  if (!w) return;
  const setUi = on => {
    if (!btnEl) return;
    btnEl.classList.toggle('active', on);
    btnEl.title = on ? 'Đang nằm trong danh sách Thành ngữ (bấm để bỏ)' : 'Thêm vào danh sách Thành ngữ';
  };
  const next = !w.is_idiom_pick;
  w.is_idiom_pick = next;
  setUi(next);
  try {
    const resp = await fetch(window.SUPABASE_URL + '/rest/v1/words?id=eq.' + id, {
      method: 'PATCH',
      headers: Object.assign(await authHeaders(), { 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ is_idiom_pick: next })
    });
    if (!resp.ok) throw new Error('PATCH thất bại');
    showToast(next ? '✅ Đã thêm vào danh sách Thành ngữ: ' + w.thai : '✅ Đã bỏ khỏi danh sách Thành ngữ: ' + w.thai);
  } catch (e) {
    w.is_idiom_pick = !next; // hoàn tác
    setUi(!next);
    showToast('⚠️ Lỗi khi cập nhật — cần thêm cột "is_idiom_pick" (boolean) vào bảng words trong Supabase (migration_words_idiom_pick.sql)');
  }
}

async function deleteWord(id) {
  if (!confirm('Xóa từ này khỏi từ điển?')) return;
  try {
    await sbDeleteAuth('words?id=eq.' + id);
    allWords = allWords.filter(w => w.id !== id);
    invalidateSegmentDictCache(); // vừa xoá 1 từ → cache Set tách từ PopThai (app.js) cần dựng lại
    favorites = favorites.filter(k => !k.startsWith(id + ':'));
    Object.keys(favFolderMap).forEach(k => { if (k.startsWith(id + ':')) delete favFolderMap[k]; });
    Object.keys(favNotesMap).forEach(k => { if (k.startsWith(id + ':')) delete favNotesMap[k]; });
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
    localStorage.setItem('thai_fav_notes', JSON.stringify(favNotesMap));
    showToast('Đã xóa từ');
    updateStats();
    renderAdminList(allWords);
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa từ, thử lại sau');
  }
}

let adminFiltered = [];
// Lớp phòng thủ thứ 2 chống trình duyệt tự điền email vào ô tìm từ admin (ngoài readonly + autocomplete trong index.html):
// nếu ô chứa đúng 1 địa chỉ email mà người dùng KHÔNG đang đặt con trỏ vào ô → coi là autofill, xóa ngay.
function clearAdminSearchAutofill() {
  const el = document.getElementById('adminSearch');
  if (!el || document.activeElement === el) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((el.value || '').trim())) return false;
  el.value = '';
  return true;
}

function filterAdminList(q) {
  if (clearAdminSearchAutofill()) q = '';
  q = (q || '').toLowerCase();
  const filtered = q
    ? allWords.filter(w => w.thai.includes(q) || (w.meanings||[]).some(m => m.toLowerCase().includes(q)))
    : allWords;
  renderAdminList(filtered);
}

function renderAdminList(list) {
  adminFiltered = list;
  document.getElementById('adminList').innerHTML = list.length
    ? list.map(w => `
      <div class="wla-row${w.visible === false ? ' wla-hidden' : ''}" id="wla-${w.id}">
        <div class="wla-thai">${w.thai}${w.visible === false ? '<span class="wla-hidden-badge" title="Từ này đang ẨN — không hiện trong tìm kiếm/gợi ý cho người dùng, chỉ admin xem/sửa được">Đã ẩn</span>' : ''}</div>
        <div class="wla-actions">
          <button class="btn-small${w.is_random_pick ? ' active' : ''}" title="${w.is_random_pick ? 'Đang nằm trong danh sách Từ ngẫu nhiên (bấm để bỏ)' : 'Thêm vào danh sách Từ ngẫu nhiên'}" onclick="toggleRandomPick(${w.id}, this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/></svg></button>
          <button class="btn-small${w.is_idiom_pick ? ' active' : ''}" title="${w.is_idiom_pick ? 'Đang nằm trong danh sách Thành ngữ (bấm để bỏ)' : 'Thêm vào danh sách Thành ngữ'}" onclick="toggleIdiomPick(${w.id}, this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4Z"/></svg></button>
          <button class="btn-small edit" title="Chỉnh sửa" onclick="openEditModal(${w.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
          <button class="btn-small del" title="Xóa" onclick="deleteWord(${w.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
        </div>
      </div>
    `).join('')
    : '<div class="loading-bar">Không có từ nào</div>';
}

// Edit word
async function openEditModal(id) {
  const w = await ensureWordFull(id);
  if (!w) return;
  document.getElementById('editId').value = id;
  document.getElementById('editThai').value = w.thai || '';
  // Phiên âm vẫn là ô nhập thường (không cần rich text — chỉ hiển thị 1 dòng ngắn ở khắp nơi
  // trong app, xem lịch sử trước đó). Cấu tạo từ giờ là rich text B/I/U (đổi theo yêu cầu, dùng
  // để diễn giải cách đọc chi tiết — CHỈ hiện ở trang kết quả tra từ chính, không hiện ở lịch
  // sử/gợi ý) nên đổ thẳng innerHTML, không stripHtml như trước để giữ định dạng đã lưu.
  document.getElementById('editPhonetic').value = stripHtml(w.phonetic || '');
  document.getElementById('editStructure').innerHTML = w.structure || '';
  // Cột "visible" mới thêm — từ cũ chưa có cột này trong dữ liệu (undefined) coi như đang hiển
  // thị bình thường (mặc định true), CHỈ false mới là admin chủ động ẩn.
  document.getElementById('editVisible').checked = w.visible !== false;

  // Reset definition builder cho edit, rồi đổ dữ liệu hiện có vào
  document.getElementById('editDefBuilderList').innerHTML = '';
  editDefBlocks = [];
  const defs = (w.definitions && w.definitions.length)
    ? w.definitions
    // Fallback cho từ kiểu cũ chỉ có "meanings" + "examples" rời rạc
    : (w.meanings || ['']).map((m, i) => ({
        type: w.type || '',
        thai_meaning: '',
        viet_meaning: m,
        examples: i === 0 ? (w.examples || []) : []
      }));
  defs.forEach(d => addDefBlock('edit', d));
  if (!defs.length) addDefBlock('edit');

  document.getElementById('editModal').classList.add('show');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('show');
}

async function saveEdit() {
  const id = parseInt(document.getElementById('editId').value);
  const thai = document.getElementById('editThai').value.trim();
  const phonetic = document.getElementById('editPhonetic').value.trim();
  const structure = document.getElementById('editStructure').innerHTML.trim();
  const visible = document.getElementById('editVisible').checked;
  if (!thai) { showToast('⚠️ Vui lòng nhập từ tiếng Thái'); return; }

  const definitions = getDefData('edit');
  if (!definitions.length) { showToast('⚠️ Vui lòng thêm ít nhất 1 định nghĩa'); return; }

  const meanings = definitions.map(d => stripHtml(d.viet_meaning) || stripHtml(d.thai_meaning));
  const type = definitions[0]?.type || 'danh từ';

  const btn = document.getElementById('btnSaveEdit');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const resp = await fetch(window.SUPABASE_URL + '/rest/v1/words?id=eq.' + id, {
      method: 'PATCH',
      headers: Object.assign(await authHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify({ thai, phonetic: phonetic || null, structure: structure || null, type, meanings, definitions, visible })
    });
    if (resp.ok) {
      const idx = allWords.findIndex(x => x.id === id);
      if (idx >= 0) allWords[idx] = { ...allWords[idx], thai, phonetic, structure, type, meanings, definitions, visible };
      invalidateSegmentDictCache(); // chữ Thái của từ có thể vừa đổi → cache Set tách từ PopThai (app.js) cần dựng lại
      closeEditModal();
      showToast('✅ Đã cập nhật từ: ' + thai);
      renderAdminList(allWords);
    } else { showToast('⚠️ Lỗi khi cập nhật'); }
  } catch(e) { showToast('⚠️ Lỗi kết nối'); }
  btn.disabled = false; btn.textContent = 'Lưu thay đổi';
}

// ── TRÌNH SOẠN ĐỊNH NGHĨA (dùng trong form thêm/sửa từ ở trên, và khi admin
// duyệt 1 đề xuất từ mới thành từ thật — xem useSuggestionToAddWord ở app.js) ──
// ── DEF BUILDER ───────────────────────────────────────
const WORD_TYPES = [
  'คำนาม - Danh từ',
  'ลักษณนาม - Danh loại từ',
  'คำกริยา - Động từ',
  'คําคุณศัพท์ - Tính từ',
  'คำกริยาวิเศษณ์ - Trạng từ',
  'คำบุพบท - Giới từ',
  'คำสันธาน - Liên từ',
  'คำอุทาน - Thán từ',
  'คำลงท้าย - Từ tình thái',
  'บุรุษสรรพนาม - Đại từ nhân xưng',
  'คำเสริม - Trợ từ',
  'คำนามประสม - Danh từ ghép',
  'ประพันธสรรพนาม - Đại từ quan hệ',
  'คำวิสามานยนาม - Danh từ riêng',
  'คำอุปสรรค - Tiền tố',
  'นิยมสรรพนาม - Đại từ chỉ định',
  'วิภาคสรรพนาม - Đại từ phân bổ',
  'ปฤจฉาสรรพนาม - Đại từ nghi vấn',
  'อนิยมสรรพนาม - Đại từ không xác định',
  'วิกตรรถกริยา - Trợ động từ',
  'สรรพนามเจ้าของ - Đại từ sở hữu',
  'คำเลียนเสียง - Từ tượng thanh',
  'คำเลียนสภาพ - Từ tượng hình',
  // 2 loại mới dùng cho kệ gợi ý nhanh "Thành ngữ" / "Slang" ở thanh search (xem
  // collectIdiomWords/collectSlangWords ở app.js) — admin tick vào đây khi soạn định nghĩa
  // để đánh dấu 1 từ LÀ thành ngữ / tiếng lóng. CHÚ Ý: chuỗi này phải khớp CHÍNH XÁC với hằng
  // số WORD_TYPE_IDIOM / WORD_TYPE_SLANG khai báo ở app.js — admin-core.js là ES module nạp
  // động (chỉ tải khi mở trang admin) nên không thể dùng chung biến toàn cục với app.js được,
  // phải khai báo lặp lại chuỗi này ở cả 2 nơi.
  'สำนวน - Thành ngữ',
  'คำสแลง - Tiếng lóng'
];
let defBlocks = [];       // scope 'add'
let editDefBlocks = [];   // scope 'edit'
let defIdCounter = 0;

// WORD_TYPES lưu chuỗi "Thái - Việt" làm VALUE thật (khớp chính xác với dữ liệu đã lưu / các
// hằng số WORD_TYPE_IDIOM, WORD_TYPE_SLANG bên app.js) — chỉ ẩn phần tiếng Thái khi HIỂN THỊ cho
// gọn (dropdown/summary), không đổi gì ở dữ liệu lưu xuống Supabase.
function wordTypeVietLabel(full) {
  const idx = (full || '').indexOf(' - ');
  return idx >= 0 ? full.slice(idx + 3).trim() : (full || '');
}

function scopeBlocks(scope) { return scope === 'edit' ? editDefBlocks : defBlocks; }
function scopeListId(scope) { return scope === 'edit' ? 'editDefBuilderList' : 'defBuilderList'; }

// Lấy danh sách loại từ đã chọn (mảng string) của 1 def-builder
function getTypeValue(scope, id) {
  const box = document.getElementById(`dtype-${scope}-${id}`);
  if (!box) return [];
  return [...box.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
}

// Đặt lại các checkbox loại từ theo dữ liệu có sẵn (string "a, b" hoặc mảng)
function setTypeValue(scope, id, typeData) {
  const box = document.getElementById(`dtype-${scope}-${id}`);
  if (!box) return;
  const values = Array.isArray(typeData)
    ? typeData
    : (typeData || '').split(',').map(s => s.trim()).filter(Boolean);
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = values.includes(cb.value);
  });
  updateTypeSummary(scope, id);
}

// Cập nhật dòng tóm tắt hiển thị các loại từ đã chọn + đóng/mở dropdown — chỉ hiện tiếng Việt
// cho gọn (xem wordTypeVietLabel), giá trị lưu thật vẫn giữ nguyên cả tiếng Thái.
function updateTypeSummary(scope, id) {
  const selected = getTypeValue(scope, id);
  const summary = document.getElementById(`dtype-summary-${scope}-${id}`);
  if (summary) summary.textContent = selected.length ? selected.map(wordTypeVietLabel).join(', ') : 'Chọn loại từ...';
}

// Bấm checkbox "Ẩn" ở header 1 def-builder — chỉ đổi CSS (làm mờ cả khối) để admin thấy rõ
// định nghĩa này sẽ không hiện mặc định ngoài trang kết quả, không xoá/khoá dữ liệu gì cả.
// Giá trị thật lấy lại từ chính checkbox này lúc lưu (xem getDefData).
// Bấm toggle "Hiển thị cho người dùng" ở form Thêm từ mới / popup Sửa từ — chỉ đổi icon
// mắt/mắt-gạch + màu viền cho admin thấy rõ trạng thái ngay lúc soạn, giá trị thật lấy lại từ
// chính checkbox này lúc lưu (xem addWord()/saveEdit()).
function onWordVisibleToggle(checkboxEl) {
  const wrap = checkboxEl.closest('.word-visible-toggle');
  if (wrap) wrap.classList.toggle('off', !checkboxEl.checked);
}

function onDefHideToggle(scope, id) {
  const box = document.getElementById('def-' + scope + '-' + id);
  const checkbox = document.getElementById(`dhide-${scope}-${id}`);
  const checked = !!checkbox?.checked;
  if (box) box.classList.toggle('def-builder-hidden', checked);
  if (checkbox) checkbox.closest('.def-hide-toggle')?.classList.toggle('checked', checked);
}

function toggleTypeDropdown(scope, id) {
  const dd = document.getElementById(`dtype-dropdown-${scope}-${id}`);
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  document.querySelectorAll('.type-dropdown.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.type-dropdown-clip-fix').forEach(el => el.classList.remove('type-dropdown-clip-fix'));
  if (!isOpen) {
    dd.classList.add('open');
    // Dropdown dùng position:absolute nên bị CẮT NGANG bởi bất kỳ tổ tiên nào có overflow khác
    // "visible" — cụ thể là .edit-word-modal-body (overflow-y:auto để cuộn nội dung popup Sửa từ)
    // và .edit-word-modal-box (overflow:hidden để bo góc popup). Tạm thời gỡ overflow của 2 tổ
    // tiên này trong lúc dropdown đang mở (xem .type-dropdown-clip-fix ở style.css) để dropdown
    // tràn ra ngoài hiển thị đầy đủ 2 cột thay vì bị cắt cụt — đóng dropdown lại (hoặc bấm ra
    // ngoài, xem listener bên dưới) sẽ trả overflow về như cũ, không ảnh hưởng cuộn/bo góc bình
    // thường của popup.
    dd.closest('.edit-word-modal-body')?.classList.add('type-dropdown-clip-fix');
    dd.closest('.edit-word-modal-box')?.classList.add('type-dropdown-clip-fix');
  }
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.type-multiselect')) {
    document.querySelectorAll('.type-dropdown.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.type-dropdown-clip-fix').forEach(el => el.classList.remove('type-dropdown-clip-fix'));
  }
});

// ── KÉO-THẢ SẮP XẾP LẠI (định nghĩa / ví dụ câu) ────────────────────────────
// Dùng chung 1 cơ chế native HTML5 Drag and Drop (không cần thư viện ngoài) cho cả 2 nơi: sắp
// xếp lại thứ tự các định nghĩa (.def-builder trong #defBuilderList/#editDefBuilderList) và thứ
// tự các ví dụ câu (.ex-row trong #exlist-scope-defId). CHỈ phần tay cầm (icon "grip-vertical")
// có draggable="true" — không phải cả khối — để không cản trở việc bôi đen/chọn chữ trong các ô
// nhập bên trong khi rê chuột.
const GRIP_VERTICAL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';

// Tìm phần tử nên chèn TRƯỚC nó dựa theo vị trí con trỏ chuột theo trục dọc — thuật toán quen
// thuộc cho kéo-thả sắp xếp lại danh sách bằng native Drag and Drop API.
function dragGetSiblingAfter(container, y, itemSelector) {
  const els = [...container.querySelectorAll(itemSelector + ':not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity }).element;
}

// Gắn dragover cho 1 container danh sách — CHỈ 1 LẦN (idempotent nhờ dataset flag, vì hàm này
// được gọi lại mỗi lần addDefBlock/addExRow thêm phần tử mới). Tự tìm phần tử đang mang class
// "dragging" bên trong chính container đó để di chuyển theo con trỏ chuột.
// Ngoài sắp lại vị trí, còn tự cuộn vùng chứa (modal body / trang admin) khi rê chuột tới sát mép
// trên/dưới — cần thiết vì danh sách định nghĩa có thể dài hơn khung nhìn, kéo tới rìa mà không tự
// cuộn thì không thể thả xuống phần đang khuất.
function dragInitList(listEl, itemSelector) {
  if (!listEl || listEl.dataset.dragInit) return;
  listEl.dataset.dragInit = '1';
  listEl.addEventListener('dragover', e => {
    const dragging = listEl.querySelector(itemSelector + '.dragging');
    if (!dragging) return;
    e.preventDefault();
    const after = dragGetSiblingAfter(listEl, e.clientY, itemSelector);
    if (after == null) listEl.appendChild(dragging);
    else listEl.insertBefore(dragging, after);
    dragAutoScroll(listEl, e.clientY);
  });
}

// Vùng sát mép trên/dưới (px) sẽ kích hoạt tự cuộn khi rê tới, và tốc độ cuộn mỗi lần dragover bắn ra.
const DRAG_SCROLL_EDGE = 56;
const DRAG_SCROLL_SPEED = 16;

// Tìm tổ tiên gần nhất có thể cuộn dọc được (overflow-y auto/scroll + nội dung thật sự dài hơn
// khung) — với popup "Chỉnh sửa từ" đó là .edit-word-modal-body, với form "Thêm từ mới" (nằm
// thẳng trong trang admin, không có khung cuộn riêng) sẽ rơi về document.scrollingElement.
function dragFindScrollParent(el) {
  let node = el && el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}
function dragAutoScroll(listEl, clientY) {
  const scrollParent = dragFindScrollParent(listEl);
  if (!scrollParent) return;
  const isWindowScroll = scrollParent === document.scrollingElement || scrollParent === document.documentElement;
  const top = isWindowScroll ? 0 : scrollParent.getBoundingClientRect().top;
  const bottom = isWindowScroll ? window.innerHeight : scrollParent.getBoundingClientRect().bottom;
  if (clientY < top + DRAG_SCROLL_EDGE) scrollParent.scrollTop -= DRAG_SCROLL_SPEED;
  else if (clientY > bottom - DRAG_SCROLL_EDGE) scrollParent.scrollTop += DRAG_SCROLL_SPEED;
}

// Gắn tay cầm kéo cho 1 phần tử — itemEl là khối thật sự được di chuyển (def-builder hoặc
// ex-row), handleEl là icon grip-vertical nhỏ bên trong nó dùng để bắt đầu kéo. Ảnh kéo (ghost)
// KHÔNG dùng nguyên cả khối itemEl nữa — nếu định nghĩa đang mở rộng (dài, nhiều ví dụ/ảnh) thì
// cả khối cao lêu nghêu trông rất xấu khi kéo. Thay vào đó nhân bản riêng phần header (đã có tay
// cầm + tiêu đề + preview, luôn ngắn gọn) làm ảnh kéo — nhân bản này chỉ tồn tại tạm trong DOM
// đúng lúc dragstart bắn ra rồi xoá ngay.
function dragInitHandle(handleEl, itemEl, onDragEnd) {
  if (!handleEl || !itemEl) return;
  handleEl.setAttribute('draggable', 'true');
  handleEl.addEventListener('dragstart', e => {
    itemEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    const ghostSource = itemEl.querySelector(':scope > .def-builder-header') || itemEl;
    const ghost = ghostSource.cloneNode(true);
    ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:' + ghostSource.offsetWidth + 'px;'
      + 'max-height:90px;overflow:hidden;pointer-events:none;background:var(--surface-card);'
      + 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);opacity:0.95;';
    document.body.appendChild(ghost);
    try { e.dataTransfer.setDragImage(ghost, 20, 20); } catch (err) { /* trình duyệt cũ không hỗ trợ, bỏ qua */ }
    setTimeout(() => ghost.remove(), 0);
  });
  handleEl.addEventListener('dragend', () => {
    itemEl.classList.remove('dragging');
    if (onDragEnd) onDragEnd();
  });
}

// Sau khi thả 1 định nghĩa vào vị trí mới: đồng bộ lại mảng defBlocks/editDefBlocks (getDefData
// đọc dữ liệu theo mảng này, KHÔNG theo thứ tự DOM) + đánh số lại nhãn "Định nghĩa N" hiển thị
// trong header từng khối cho khớp vị trí mới. Ví dụ câu (.ex-row) không cần hàm tương ứng vì
// getDefData đọc ví dụ trực tiếp theo thứ tự DOM (querySelectorAll('.ex-row')), kéo xong là tự
// đúng thứ tự luôn, không cần đồng bộ mảng riêng.
function syncDefBlocksOrder(scope) {
  const list = document.getElementById(scopeListId(scope));
  if (!list) return;
  const newOrder = [...list.children].map(el => parseInt(el.id.split('-').pop(), 10)).filter(n => !isNaN(n));
  if (scope === 'edit') editDefBlocks = newOrder; else defBlocks = newOrder;
  newOrder.forEach((id, idx) => {
    const titleEl = document.querySelector('#def-' + scope + '-' + id + ' .def-builder-title');
    if (titleEl) titleEl.textContent = 'Định nghĩa ' + (idx + 1);
  });
}

function addDefBlock(scope, prefill) {
  scope = scope || 'add';
  const id = defIdCounter++;
  scopeBlocks(scope).push(id);
  const list = document.getElementById(scopeListId(scope));
  const div = document.createElement('div');
  div.className = 'def-builder';
  div.id = 'def-' + scope + '-' + id;
  div.innerHTML = `
    <div class="def-builder-header">
      <span class="def-drag-handle" title="Kéo để sắp xếp lại thứ tự định nghĩa">${GRIP_VERTICAL_ICON}</span>
      <button type="button" class="def-collapse-toggle" onclick="toggleDefCollapse('${scope}',${id})" title="Thu gọn / mở rộng định nghĩa này">
        <svg class="def-collapse-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <span class="def-builder-title-wrap">
        <span class="def-builder-title">Định nghĩa ${scopeBlocks(scope).indexOf(id)+1}</span>
        <span class="def-builder-preview" id="dpreview-${scope}-${id}"></span>
      </span>
      <div class="def-move-btns">
        <button type="button" class="def-move-btn" onclick="moveDefBlock('${scope}',${id},-1)" title="Chuyển lên trên">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button type="button" class="def-move-btn" onclick="moveDefBlock('${scope}',${id},1)" title="Chuyển xuống dưới">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <label class="def-hide-toggle" title="Ẩn định nghĩa này khỏi hiển thị mặc định — gộp vào dòng &quot;Xem thêm&quot; ở cuối, người dùng bấm vào mới thấy">
        <input type="checkbox" id="dhide-${scope}-${id}" onchange="onDefHideToggle('${scope}',${id})">
        <span>Ẩn</span>
      </label>
      <div class="type-multiselect" id="dtype-${scope}-${id}">
        <div class="type-summary" onclick="toggleTypeDropdown('${scope}',${id})">
          <span id="dtype-summary-${scope}-${id}">Chọn loại từ...</span>
          <span class="type-summary-arrow">▾</span>
        </div>
        <div class="type-dropdown" id="dtype-dropdown-${scope}-${id}">
          ${WORD_TYPES.map((t,i) => `
            <label class="type-opt">
              <input type="checkbox" value="${t}" onchange="updateTypeSummary('${scope}',${id})">
              <span>${wordTypeVietLabel(t)}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <button class="btn-remove" onclick="removeDefBlock(${id},'${scope}')" title="Xóa">✕</button>
    </div>
    <div class="def-builder-body" id="defbody-${scope}-${id}">
      <div class="form-group">
        <div class="rte-wrap">
          <div class="rte-area" data-lang="thai" contenteditable="true" id="dthai-${scope}-${id}" placeholder="กรอกความหมายภาษาไทย..." oninput="updateDefPreview('${scope}',${id})"></div>
        </div>
      </div>
      <div class="form-group">
        <div class="rte-wrap">
          <div class="rte-area" contenteditable="true" id="dviet-${scope}-${id}" placeholder="Nhập nghĩa tiếng Việt..." oninput="updateDefPreview('${scope}',${id})"></div>
        </div>
      </div>
      <div class="def-ex-builder">
        <div id="exlist-${scope}-${id}"></div>
        <button class="btn-add-ex" onclick="addExRow(${id},'${scope}')">+ Thêm ví dụ</button>
      </div>
      <div class="def-image-builder">
        <div class="def-image-block" id="defimg-${scope}-${id}" data-url="" data-path=""></div>
      </div>
      <div class="def-rel-builder">
        <div id="synlist-${scope}-${id}"></div>
        <button class="btn-add-ex" onclick="addRelWordRow(${id},'${scope}','syn')">+ Thêm từ đồng nghĩa</button>
      </div>
      <div class="def-rel-builder">
        <div id="antlist-${scope}-${id}"></div>
        <button class="btn-add-ex" onclick="addRelWordRow(${id},'${scope}','ant')">+ Thêm từ trái nghĩa</button>
      </div>
      <div class="def-rel-builder">
        <div id="idmlist-${scope}-${id}"></div>
        <button class="btn-add-ex" onclick="addRelWordRow(${id},'${scope}','idm')">+ Thêm thành ngữ</button>
      </div>
      <div class="def-rel-builder">
        <div id="rellist-${scope}-${id}"></div>
        <button class="btn-add-ex" onclick="addRelWordRow(${id},'${scope}','rel')">+ Thêm từ liên quan</button>
      </div>
    </div>
  `;
  list.appendChild(div);

  if (prefill) {
    setTypeValue(scope, id, prefill.type);
    if (prefill.hidden) {
      const hideEl = document.getElementById(`dhide-${scope}-${id}`);
      if (hideEl) { hideEl.checked = true; onDefHideToggle(scope, id); }
    }
    document.getElementById(`dthai-${scope}-${id}`).innerHTML = prefill.thai_meaning || '';
    document.getElementById(`dviet-${scope}-${id}`).innerHTML = prefill.viet_meaning || '';
    (prefill.examples || []).forEach(ex => addExRow(id, scope, ex));
    if (!(prefill.examples || []).length) addExRow(id, scope);
    (prefill.synonyms || []).forEach(w => addRelWordRow(id, scope, 'syn', w));
    (prefill.antonyms || []).forEach(w => addRelWordRow(id, scope, 'ant', w));
    (prefill.idioms || []).forEach(w => addRelWordRow(id, scope, 'idm', w));
    (prefill.related || []).forEach(w => addRelWordRow(id, scope, 'rel', w));
    if (prefill.image && prefill.image.url) {
      const imgBlock = document.getElementById(`defimg-${scope}-${id}`);
      imgBlock.dataset.url = prefill.image.url;
      imgBlock.dataset.path = prefill.image.path || '';
    }
    // Định nghĩa có sẵn khi SỬA một từ đã lưu → thu gọn ngay từ đầu để danh sách ngắn gọn, dễ kéo-
    // thả sắp xếp lại dù nội dung bên trong dài (ví dụ, ảnh, từ liên quan...) — bấm vào mới mở ra
    // sửa. Riêng scope 'add' (kể cả điền sẵn từ đề xuất người dùng — xem useSuggestionToAddWord)
    // LUÔN mở sẵn vì đây thường là nội dung admin đang trực tiếp gõ/kiểm tra ngay lúc đó.
    updateDefPreview(scope, id);
    if (scope === 'edit') setDefCollapsed(scope, id, true);
  } else {
    updateTypeSummary(scope, id);
    addExRow(id, scope);
  }
  renderDefImageBlock(scope, id);

  // Kéo-thả sắp xếp lại thứ tự định nghĩa — chỉ icon .def-drag-handle mới draggable, kéo cả khối
  // .def-builder (div) di chuyển theo (xem dragInitHandle/dragInitList). Sau khi thả, đồng bộ lại
  // mảng defBlocks/editDefBlocks + đánh số lại "Định nghĩa N" theo thứ tự DOM mới.
  // Kéo-thả HTML5 gốc KHÔNG hoạt động trên chạm/mobile (Safari iOS không hỗ trợ) — nút mũi tên
  // lên/xuống (.def-move-btn) ở trên là cách thay thế luôn dùng được trên mọi thiết bị.
  dragInitList(list, '.def-builder');
  dragInitHandle(div.querySelector('.def-drag-handle'), div, () => syncDefBlocksOrder(scope));
}

// Thu gọn/mở rộng 1 khối định nghĩa — chỉ ẩn/hiện .def-builder-body, không đụng gì tới dữ liệu
// bên trong. Thu gọn giúp danh sách nhiều định nghĩa dài (ví dụ, ảnh, từ liên quan...) ngắn lại
// thành các hàng tiêu đề đơn giản — dễ nhìn tổng quan VÀ dễ kéo-thả sắp xếp lại hơn hẳn so với
// kéo cả khối cao lêu nghêu.
function setDefCollapsed(scope, id, collapsed) {
  const block = document.getElementById('def-' + scope + '-' + id);
  if (!block) return;
  block.classList.toggle('collapsed', collapsed);
  const btn = block.querySelector('.def-collapse-toggle');
  if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}
function toggleDefCollapse(scope, id) {
  const block = document.getElementById('def-' + scope + '-' + id);
  if (!block) return;
  setDefCollapsed(scope, id, !block.classList.contains('collapsed'));
}

// Đoạn xem trước (nghĩa tiếng Việt, cắt ngắn) hiện cạnh tiêu đề "Định nghĩa N" khi đã thu gọn —
// để nhận ra định nghĩa nào là định nghĩa nào mà không cần mở ra. Cập nhật mỗi lần gõ (oninput
// trên ô nghĩa tiếng Việt) nên luôn khớp nội dung mới nhất kể cả lúc đang mở.
function updateDefPreview(scope, id) {
  const previewEl = document.getElementById('dpreview-' + scope + '-' + id);
  if (!previewEl) return;
  const vietEl = document.getElementById('dviet-' + scope + '-' + id);
  const thaiEl = document.getElementById('dthai-' + scope + '-' + id);
  const text = stripHtml((vietEl && vietEl.innerHTML) || (thaiEl && thaiEl.innerHTML) || '').trim();
  previewEl.textContent = text ? ('— ' + (text.length > 46 ? text.slice(0, 46) + '…' : text)) : '';
}

// Chuyển 1 khối định nghĩa lên/xuống 1 vị trí bằng nút bấm — thay thế đáng tin cậy cho kéo-thả
// trên thiết bị chạm (HTML5 drag gốc không hoạt động trên mobile), cũng tiện hơn khi định nghĩa
// đang mở dài, không cần cuộn theo lúc kéo.
function moveDefBlock(scope, id, dir) {
  const list = document.getElementById(scopeListId(scope));
  const block = document.getElementById('def-' + scope + '-' + id);
  if (!list || !block) return;
  if (dir < 0) {
    const prev = block.previousElementSibling;
    if (prev) list.insertBefore(block, prev);
  } else {
    const next = block.nextElementSibling;
    if (next) list.insertBefore(next, block);
  }
  syncDefBlocksOrder(scope);
}

// Tương tự moveDefBlock nhưng cho từng ví dụ câu bên trong 1 định nghĩa — không cần đồng bộ mảng
// riêng (xem ghi chú ở dragInitList phía addExRow), chỉ cần đổi vị trí DOM là đủ.
function moveExRow(scope, defId, eid, dir) {
  const list = document.getElementById('exlist-' + scope + '-' + defId);
  const row = document.getElementById('ex-' + scope + '-' + eid);
  if (!list || !row) return;
  if (dir < 0) {
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('ex-row')) list.insertBefore(row, prev);
  } else {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('ex-row')) list.insertBefore(next, row);
  }
}

let relRowCounter = 0;
const REL_LIST_PREFIX = { syn: 'synlist', ant: 'antlist', idm: 'idmlist', rel: 'rellist' };
const REL_PLACEHOLDER_THAI = { syn: 'เช่น พูด', ant: 'เช่น เงียบ', idm: 'เช่น พูดจาไพเราะ', rel: 'เช่น อาหาร' };
const REL_PLACEHOLDER_VIET = { syn: 'vd: nói', ant: 'vd: im lặng', idm: 'vd: ăn nói ngọt ngào', rel: 'vd: món ăn' };

// Thêm 1 dòng nhập từ đồng nghĩa/trái nghĩa/thành ngữ (relType: 'syn' | 'ant' | 'idm')
// Admin tự gõ tay để đảm bảo chính xác về ngữ nghĩa — nếu từ tiếng Thái gõ vào trùng khớp
// với 1 từ có sẵn trong từ điển, hệ thống sẽ tự động biến nó thành liên kết click được khi hiển thị.
function addRelWordRow(defId, scope, relType, prefillRel) {
  scope = scope || 'add';
  const rid = relRowCounter++;
  const list = document.getElementById(REL_LIST_PREFIX[relType] + '-' + scope + '-' + defId);
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'rel-row';
  row.id = 'rel-' + relType + '-' + scope + '-' + rid;
  row.innerHTML = `
    <input type="text" class="form-input rel-input-thai" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" placeholder="${REL_PLACEHOLDER_THAI[relType]}" value="${prefillRel ? (prefillRel.thai || '').replace(/"/g, '&quot;') : ''}">
    <input type="text" class="form-input rel-input-viet" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" placeholder="${REL_PLACEHOLDER_VIET[relType]}" value="${prefillRel ? (prefillRel.viet || '').replace(/"/g, '&quot;') : ''}">
    <button class="btn-remove" onclick="document.getElementById('rel-${relType}-${scope}-${rid}').remove()">✕</button>
  `;
  list.appendChild(row);
}

// Thu thập dữ liệu 1 loại quan hệ (đồng nghĩa/trái nghĩa/thành ngữ) từ các dòng đã nhập
function getRelWordData(scope, defId, relType) {
  const list = document.getElementById(REL_LIST_PREFIX[relType] + '-' + scope + '-' + defId);
  if (!list) return [];
  const result = [];
  list.querySelectorAll('.rel-row').forEach(row => {
    const thaiInput = row.querySelector('.rel-input-thai');
    const vietInput = row.querySelector('.rel-input-viet');
    const thai = (thaiInput?.value || '').trim();
    const viet = (vietInput?.value || '').trim();
    if (thai || viet) result.push({ thai, viet });
  });
  return result;
}

function removeDefBlock(id, scope) {
  scope = scope || 'add';
  if (scope === 'edit') editDefBlocks = editDefBlocks.filter(b => b !== id);
  else defBlocks = defBlocks.filter(b => b !== id);
  document.getElementById('def-' + scope + '-' + id)?.remove();
}

let exCounter = 0;
function addExRow(defId, scope, prefillEx) {
  scope = scope || 'add';
  const eid = exCounter++;
  const list = document.getElementById('exlist-' + scope + '-' + defId);
  const row = document.createElement('div');
  row.className = 'ex-row';
  row.id = 'ex-' + scope + '-' + eid;
  const v = prefillEx && prefillEx.video ? prefillEx.video : null;
  row.innerHTML = `
    <div class="ex-handle-col">
      <div class="ex-drag-handle" title="Kéo để sắp xếp lại thứ tự ví dụ">${GRIP_VERTICAL_ICON}</div>
      <button type="button" class="ex-move-btn" onclick="moveExRow('${scope}',${defId},${eid},-1)" title="Chuyển lên trên">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button type="button" class="ex-move-btn" onclick="moveExRow('${scope}',${defId},${eid},1)" title="Chuyển xuống dưới">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="rte-wrap">
      <div class="rte-area" data-lang="thai" contenteditable="true" placeholder="ประโยคตัวอย่าง...">${prefillEx ? prefillEx.thai || '' : ''}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <div class="rte-wrap" style="flex:1">
        <div class="rte-area" contenteditable="true" placeholder="Câu ví dụ tiếng Việt...">${prefillEx ? prefillEx.viet || '' : ''}</div>
      </div>
      <button class="btn-remove" onclick="removeExRow('${scope}',${eid})">✕</button>
    </div>
    <div class="ex-video-block" id="exvid-${scope}-${eid}"
      data-video-id="${v && v.youtubeId ? v.youtubeId : ''}"
      data-start="${v && v.start != null ? v.start : ''}"
      data-end="${v && v.end != null ? v.end : ''}"
      data-subtitle="${escapeHtml(v && v.subtitle ? v.subtitle : '')}"
      data-captions="${escapeHtml(JSON.stringify(
        typeof migrateVideoCaptions === 'function'
          ? migrateVideoCaptions(v)
          : (v && Array.isArray(v.captions) ? v.captions : [])
      ))}"
      data-cc="${v && v.showCaptions ? '1' : '0'}"></div>
  `;
  // "Thêm vào cuối" — TRƯỚC ĐÂY code cũ dùng insertBefore(row, list.lastElementChild), tưởng có
  // 1 phần tử "chốt" cuối danh sách cần giữ ở cuối, nhưng thật ra KHÔNG có gì như vậy (nút "+ Thêm
  // ví dụ" nằm NGOÀI #exlist, không phải con của nó) — nên mỗi ví dụ mới thêm vào lại bị chèn vào
  // TRƯỚC ví dụ cuối cùng thay vì xuống cuối, làm xáo trộn thứ tự ngay từ lúc tải dữ liệu (mở sửa
  // 1 từ có ≥ 3 ví dụ là thấy thứ tự khác ngay, trước cả khi admin tự tay kéo-thả gì). Đây chính là
  // nguyên nhân " thứ tự ví dụ không đổi/đổi sai" — sửa lại thành appendChild cho đúng.
  list.appendChild(row);
  renderExVideoBlock(scope, eid);
  // Kéo-thả sắp xếp lại thứ tự ví dụ — getDefData đọc ví dụ trực tiếp theo thứ tự DOM nên không
  // cần đồng bộ mảng riêng như định nghĩa (xem syncDefBlocksOrder).
  dragInitList(list, '.ex-row');
  dragInitHandle(row.querySelector('.ex-drag-handle'), row, null);
}

function removeExRow(scope, eid) {
  destroyExYtPlayer(scope, eid);
  document.getElementById('ex-' + scope + '-' + eid)?.remove();
}

// ── ẢNH MINH HỌA CHO ĐỊNH NGHĨA (1 ảnh/định nghĩa, admin upload từ máy) ────
// Nén ảnh ngay trên trình duyệt (resize + convert WebP) TRƯỚC khi upload lên Supabase Storage,
// để giảm dung lượng đáng kể so với ảnh gốc chụp từ điện thoại (thường 2-5MB -> còn ~80-200KB).
const DEF_IMAGE_MAX_WIDTH = 1400;
const DEF_IMAGE_QUALITY = 0.78;
function compressImageFile(file, maxWidth, quality) {
  maxWidth = maxWidth || DEF_IMAGE_MAX_WIDTH;
  quality = quality != null ? quality : DEF_IMAGE_QUALITY;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Không nén được ảnh')); return; }
          resolve(blob);
        }, 'image/webp', quality);
      };
      img.onerror = () => reject(new Error('File không phải ảnh hợp lệ'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Không đọc được file'));
    reader.readAsDataURL(file);
  });
}

// Vẽ lại nội dung khối ảnh: có ảnh -> hiện preview + nút xóa; chưa có -> hiện nút chọn file
function renderDefImageBlock(scope, id) {
  const block = document.getElementById(`defimg-${scope}-${id}`);
  if (!block) return;
  const url = block.dataset.url;
  if (url) {
    block.innerHTML = `
      <div class="def-image-preview">
        <img src="${url}" alt="Ảnh minh họa">
        <button type="button" class="btn-remove def-image-remove" onclick="removeDefImage('${scope}',${id})" title="Xóa ảnh">✕</button>
      </div>`;
  } else {
    block.innerHTML = `
      <div class="def-image-upload">
        <label class="btn-add-ex def-image-upload-label">📷 Chọn ảnh...
          <input type="file" accept="image/*" style="display:none" onchange="onDefImageSelected('${scope}',${id},this)">
        </label>
        <span class="def-image-status" id="defimg-status-${scope}-${id}"></span>
      </div>`;
  }
}

async function onDefImageSelected(scope, id, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  const statusEl = document.getElementById(`defimg-status-${scope}-${id}`);
  if (statusEl) statusEl.textContent = 'Đang nén & tải lên...';
  try {
    const blob = await compressImageFile(file);
    const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';
    const url = await sbUploadStorageFile('word-images', path, blob);
    const block = document.getElementById(`defimg-${scope}-${id}`);
    const oldPath = block.dataset.path;
    block.dataset.url = url;
    block.dataset.path = path;
    renderDefImageBlock(scope, id);
    if (oldPath) sbDeleteStorageFile('word-images', oldPath); // xóa ảnh cũ nếu đang thay ảnh khác, không chặn UI
    showToast('✅ Đã tải ảnh lên (' + Math.round(blob.size / 1024) + ' KB)');
  } catch (e) {
    if (statusEl) statusEl.textContent = '';
    showToast('⚠️ Lỗi khi tải ảnh lên: ' + (e.message || 'thử lại sau'));
  }
}

function removeDefImage(scope, id) {
  const block = document.getElementById(`defimg-${scope}-${id}`);
  if (!block) return;
  const oldPath = block.dataset.path;
  block.dataset.url = '';
  block.dataset.path = '';
  renderDefImageBlock(scope, id);
  if (oldPath) sbDeleteStorageFile('word-images', oldPath);
}

function rteCmd(cmd, btn) {
  document.execCommand(cmd, false, null);
  btn.classList.toggle('active');
}

function getDefData(scope) {
  scope = scope || 'add';
  return scopeBlocks(scope).map(id => {
    const thaiEl = document.getElementById('dthai-' + scope + '-' + id);
    const vietEl = document.getElementById('dviet-' + scope + '-' + id);
    const type = getTypeValue(scope, id).join(', ');
    const exRows = document.getElementById('exlist-' + scope + '-' + id)?.querySelectorAll('.ex-row') || [];
    const examples = [];
    exRows.forEach(row => {
      const areas = row.querySelectorAll('.rte-area');
      if (areas.length >= 2) {
        const t = areas[0].innerHTML.trim();
        const v = areas[1].innerHTML.trim();
        if (!t && !v) return;
        const exObj = { thai: t, viet: v };
        const vidBlock = row.querySelector('.ex-video-block');
        if (vidBlock && vidBlock.dataset.videoId) {
          exObj.video = {
            youtubeId: vidBlock.dataset.videoId,
            start: vidBlock.dataset.start !== '' ? Number(vidBlock.dataset.start) : null,
            end: vidBlock.dataset.end !== '' ? Number(vidBlock.dataset.end) : null
          };
          // Ưu tiên captions (đa dòng, có mốc thời gian) — subtitle cũ chỉ còn giữ lại để
          // tương thích ngược với dữ liệu chưa được admin mở sửa lại (xem migrateVideoCaptions).
          let caps = [];
          try { caps = JSON.parse(vidBlock.dataset.captions || '[]'); } catch (e) { caps = []; }
          if (Array.isArray(caps) && caps.length) exObj.video.captions = caps;
          else if (vidBlock.dataset.subtitle) exObj.video.subtitle = vidBlock.dataset.subtitle;
          if (vidBlock.dataset.cc === '1') exObj.video.showCaptions = true;
        }
        examples.push(exObj);
      }
    });
    const imgBlock = document.getElementById('defimg-' + scope + '-' + id);
    const image = (imgBlock && imgBlock.dataset.url) ? { url: imgBlock.dataset.url, path: imgBlock.dataset.path || '' } : null;
    const hidden = !!document.getElementById(`dhide-${scope}-${id}`)?.checked;
    return {
      type,
      thai_meaning: thaiEl?.innerHTML.trim() || '',
      viet_meaning: vietEl?.innerHTML.trim() || '',
      examples,
      image,
      hidden,
      synonyms: getRelWordData(scope, id, 'syn'),
      antonyms: getRelWordData(scope, id, 'ant'),
      idioms: getRelWordData(scope, id, 'idm'),
      related: getRelWordData(scope, id, 'rel')
    };
  }).filter(d => d.thai_meaning || d.viet_meaning);
}

// ── CRUD DANH SÁCH "HÔM NAY CÓ GÌ?" (quote/hội thoại/thành ngữ/lời bài hát/thông báo/
// ngày kỷ niệm...) ─────────────────────────────
// Nhãn hiển thị theo "type" cho danh sách quản trị — KHAI BÁO LẶP LẠI giống hệt
// TODAY_TYPE_LABELS bên app.js (xem ghi chú kiến trúc: admin-core.js là ES module tách
// riêng, không tự thấy được hằng số khai báo ở app.js dù cùng chạy chung 1 trang).
const TODAY_TYPE_LABELS_ADMIN = {
  quote: '💬 Trích dẫn', dialog: '🗨️ Hội thoại', idiom: '📖 Thành ngữ',
  lyrics: '🎵 Lời bài hát', announcement: '📢 Thông báo', anniversary: '🎁 Ngày kỷ niệm'
};

async function saveQuote() {
  const type = (document.getElementById('quoteTypeInput') && document.getElementById('quoteTypeInput').value) || 'quote';
  const text = document.getElementById('quoteInput').innerHTML.trim();
  const phonetic = document.getElementById('quotePhoneticInput').value.trim();
  const textVi = document.getElementById('quoteViInput').innerHTML.trim();
  const author = document.getElementById('quoteAuthorInput').value.trim();
  if (!text) { showToast('⚠️ Nhập nội dung'); return; }
  // Ngày hiển thị: chỉ áp dụng Thông báo / Ngày kỷ niệm (cần add_quote_show_dates.sql trên Supabase).
  const isDated = type === 'announcement' || type === 'anniversary';
  const showFrom = isDated ? (document.getElementById('quoteShowFromInput').value || '') : '';
  const showTo = isDated ? (document.getElementById('quoteShowToInput').value || '') : '';
  if (isDated && !showFrom && !showTo) { showToast('⚠️ Chọn ngày hiển thị (từ ngày hoặc đến ngày)'); return; }
  if (showFrom && showTo && showFrom > showTo) { showToast('⚠️ "Từ ngày" phải trước hoặc bằng "đến ngày"'); return; }
  const btn = document.querySelector('button[onclick="saveQuote()"]');
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
    const payload = { type, text, phonetic: phonetic || null, text_vi: textVi || null, author };
    if (isDated) { payload.show_from = showFrom || null; payload.show_to = showTo || null; }
    const res = await sbPostAuth('quotes', payload);
    // sbPostAuth không tự throw khi Supabase báo lỗi (vd chưa chạy SQL thêm cột ngày) — kiểm tra kết quả
    // riêng cho trường hợp có cột ngày để không báo "đã lưu" sai.
    if (isDated && !Array.isArray(res)) throw new Error('save failed');
    showToast('✅ Đã lưu nội dung!');
    document.getElementById('quoteShowFromInput').value = '';
    document.getElementById('quoteShowToInput').value = '';
    document.getElementById('quoteDateGroup').style.display = 'none';
    document.getElementById('quoteInput').innerHTML = '';
    document.getElementById('quotePhoneticInput').value = '';
    document.getElementById('quoteViInput').innerHTML = '';
    document.getElementById('quoteAuthorInput').value = '';
    if (document.getElementById('quoteTypeInput')) document.getElementById('quoteTypeInput').value = 'quote';
    loadQuote();
    await loadAllQuotesAdmin();
  } catch(e) {
    showToast('⚠️ Lỗi khi lưu nội dung, thử lại sau');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── QUẢN LÝ DANH SÁCH QUOTE (admin: xem tất cả / sửa / xóa) ────
let allQuotes = [];
let editingQuoteId = null;

async function loadAllQuotesAdmin() {
  try {
    const quotes = await sbGet('quotes?select=*&order=id.desc');
    const list = Array.isArray(quotes) ? quotes : [];
    // Loại trùng theo id để phòng trường hợp dữ liệu có bản ghi trùng lặp
    const seen = new Set();
    allQuotes = list.filter(q => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    });
  } catch (e) {
    allQuotes = [];
  }
  renderQuoteAdminList();
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY' cho danh sách quản trị; rỗng thì hiện chữ thay thế (fallback).
function quoteDateFmt(s, fallback) {
  return s ? String(s).split('-').reverse().join('/') : fallback;
}

function renderQuoteAdminList() {
  const el = document.getElementById('quoteAdminList');
  const countEl = document.getElementById('quoteAdminCount');
  if (countEl) countEl.textContent = allQuotes.length ? allQuotes.length + ' câu' : '';
  if (!el) return;
  el.innerHTML = allQuotes.length
    ? allQuotes.map(q => {
        const plain = stripHtml(q.text || '');
        const preview = plain.length > 120 ? plain.slice(0, 120) + '…' : plain;
        const plainVi = stripHtml(q.text_vi || '');
        const previewVi = plainVi.length > 120 ? plainVi.slice(0, 120) + '…' : plainVi;
        const typeLabel = TODAY_TYPE_LABELS_ADMIN[q.type] || TODAY_TYPE_LABELS_ADMIN.quote;
        return `
        <div class="wla-row" id="quote-row-${q.id}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-type-badge">${typeLabel}</div>
            <div class="quote-admin-text">${preview}</div>
            ${q.phonetic ? `<div class="quote-admin-author">🔤 ${escapeHtml(q.phonetic)}</div>` : ''}
            ${previewVi ? `<div class="quote-admin-text-vi">${previewVi}</div>` : ''}
            ${q.author ? `<div class="quote-admin-author">— ${q.author}</div>` : ''}
            ${(q.type === 'announcement' || q.type === 'anniversary') ? `<div class="quote-admin-author">${(q.show_from || q.show_to) ? '📅 ' + quoteDateFmt(q.show_from, 'từ đầu') + ' → ' + quoteDateFmt(q.show_to, 'không giới hạn') : '⚠️ Chưa đặt ngày — nội dung này sẽ KHÔNG hiển thị'}</div>` : ''}
          </div>
          <div class="wla-actions">
            <button class="btn-small edit" title="Chỉnh sửa" onclick="openEditQuoteModal(${q.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
            <button class="btn-small del" title="Xóa" onclick="deleteQuote(${q.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      }).join('')
    : '<div class="quote-admin-empty">Chưa có nội dung nào được lưu</div>';
}

function openEditQuoteModal(id) {
  const q = allQuotes.find(x => x.id === id);
  if (!q) return;
  editingQuoteId = id;
  if (document.getElementById('editQuoteTypeInput')) document.getElementById('editQuoteTypeInput').value = q.type || 'quote';
  document.getElementById('editQuoteInput').innerHTML = q.text || '';
  document.getElementById('editQuotePhoneticInput').value = q.phonetic || '';
  autoGrowTextarea(document.getElementById('editQuotePhoneticInput'));
  document.getElementById('editQuoteViInput').innerHTML = q.text_vi || '';
  document.getElementById('editQuoteAuthorInput').value = q.author || '';
  document.getElementById('editQuoteShowFromInput').value = q.show_from || '';
  document.getElementById('editQuoteShowToInput').value = q.show_to || '';
  document.getElementById('editQuoteDateGroup').style.display = (q.type === 'announcement' || q.type === 'anniversary') ? '' : 'none';
  document.getElementById('editQuoteError').textContent = '';
  document.getElementById('editQuoteModal').classList.add('show');
}

function closeEditQuoteModal() {
  document.getElementById('editQuoteModal').classList.remove('show');
  editingQuoteId = null;
}

async function saveEditQuote() {
  if (!editingQuoteId) return;
  const type = (document.getElementById('editQuoteTypeInput') && document.getElementById('editQuoteTypeInput').value) || 'quote';
  const text = document.getElementById('editQuoteInput').innerHTML.trim();
  const phonetic = document.getElementById('editQuotePhoneticInput').value.trim();
  const textVi = document.getElementById('editQuoteViInput').innerHTML.trim();
  const author = document.getElementById('editQuoteAuthorInput').value.trim();
  const errorEl = document.getElementById('editQuoteError');
  errorEl.textContent = '';
  if (!text) { errorEl.textContent = 'Vui lòng nhập nội dung'; return; }
  // Ngày hiển thị (Thông báo/Ngày kỷ niệm). Chỉ gửi 2 cột này khi loại cần ngày HOẶC dòng này đang có ngày
  // cần xoá (đổi sang loại thường) — để sửa quote thường không bị lỗi nếu chưa chạy add_quote_show_dates.sql.
  const isDated = type === 'announcement' || type === 'anniversary';
  const showFrom = isDated ? (document.getElementById('editQuoteShowFromInput').value || '') : '';
  const showTo = isDated ? (document.getElementById('editQuoteShowToInput').value || '') : '';
  if (isDated && !showFrom && !showTo) { errorEl.textContent = 'Chọn ngày hiển thị (từ ngày hoặc đến ngày)'; return; }
  if (showFrom && showTo && showFrom > showTo) { errorEl.textContent = '"Từ ngày" phải trước hoặc bằng "đến ngày"'; return; }
  const editing = allQuotes.find(x => x.id === editingQuoteId);
  const payload = { type, text, phonetic: phonetic || null, text_vi: textVi || null, author: author || null };
  if (isDated || (editing && (editing.show_from || editing.show_to))) {
    payload.show_from = showFrom || null;
    payload.show_to = showTo || null;
  }
  try {
    const resp = await fetch(window.SUPABASE_URL + '/rest/v1/quotes?id=eq.' + editingQuoteId, {
      method: 'PATCH',
      headers: Object.assign(await authHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => null);
      throw new Error((errBody && errBody.message) || ('HTTP ' + resp.status));
    }
    closeEditQuoteModal();
    showToast('✅ Đã cập nhật nội dung');
    await loadAllQuotesAdmin(); // đồng bộ lại từ server để chắc chắn khớp với DB
    loadQuote(); // cập nhật lại nội dung đang hiển thị ở trang chủ nếu trùng câu vừa sửa
  } catch (e) {
    errorEl.textContent = 'Lỗi khi cập nhật: ' + (e.message || 'thử lại sau');
  }
}

async function deleteQuote(id) {
  if (!confirm('Xóa nội dung này?')) return;
  try {
    await sbDeleteAuth('quotes?id=eq.' + id);
    showToast('Đã xóa nội dung');
    await loadAllQuotesAdmin(); // đồng bộ lại từ server thay vì chỉ xóa lạc quan ở local
    loadQuote();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, kiểm tra lại quyền xóa (RLS) trên bảng quotes trong Supabase');
  }
}

// Điền sẵn thông tin đề xuất vào form "Thêm từ mới" để admin chỉnh sửa & lưu nhanh.
// Hàm này thuộc luồng "QUẢN LÝ ĐỀ XUẤT TỪ MỚI" (modules/admin-extra.js) nhưng phải nằm ở
// ĐÂY (admin-core.js) vì cần dùng trực tiếp defBlocks/addDefBlock của trình soạn định nghĩa
// ở trên — 2 module ES riêng biệt không tự chia sẻ biến let cho nhau, còn allWordSuggestions
// (thuộc admin-extra.js) thì đọc qua window (xem window.allWordSuggestions ở admin-extra.js).
function useSuggestionToAddWord(id) {
  const s = window.allWordSuggestions.find(x => x.id === id);
  if (!s) return;
  document.getElementById('fThai').value = s.thai || '';
  document.getElementById('fPhonetic').value = s.phonetic || '';
  document.getElementById('fStructure').innerHTML = '';
  document.getElementById('defBuilderList').innerHTML = '';
  defBlocks = [];
  addDefBlock('add', { viet_meaning: s.meaning_suggestion || '' });
  document.getElementById('fThai').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('📋 Đã điền sẵn từ đề xuất — kiểm tra & bổ sung định nghĩa đầy đủ trước khi lưu');
}

// Autofill thường tới TRỄ (sau khi trang tải xong / sau đăng nhập) nên kiểm tra thêm vài lần + khi quay lại trang (bfcache)
[0, 300, 1000, 2500].forEach(ms => setTimeout(() => { if (clearAdminSearchAutofill() && typeof allWords !== 'undefined' && allWords.length) filterAdminList(''); }, ms));
window.addEventListener('pageshow', () => { if (clearAdminSearchAutofill() && typeof allWords !== 'undefined' && allWords.length) filterAdminList(''); });

Object.assign(window, {
  addWord, deleteWord, filterAdminList, renderAdminList, openEditModal, closeEditModal, saveEdit,
  getTypeValue, setTypeValue, updateTypeSummary, toggleTypeDropdown, addDefBlock, removeDefBlock,
  addRelWordRow, getRelWordData, addExRow, removeExRow, rteCmd, getDefData, useSuggestionToAddWord,
  saveQuote, loadAllQuotesAdmin, renderQuoteAdminList, openEditQuoteModal, closeEditQuoteModal, saveEditQuote, deleteQuote,
  compressImageFile, renderDefImageBlock, onDefImageSelected, removeDefImage, toggleRandomPick, toggleIdiomPick,
  onDefHideToggle, toggleDefCollapse, updateDefPreview, moveDefBlock, moveExRow, onWordVisibleToggle
});

export { renderAdminList, loadAllQuotesAdmin, addWord, addDefBlock };

// ══════════════════════════════════════════════════════════════════
// modules/admin-extra.js — ALAY
// Các mảng quản trị còn lại của trang admin: Font Challenge, góp ý/báo lỗi,
// đề xuất từ mới, quản lý người dùng. Lazy-load cùng lúc với admin-core.js
// khi vào trang quản trị (showPage('admin') ở app.js).
// ══════════════════════════════════════════════════════════════════

// ── QUẢN LÝ FONT CHALLENGE (admin: thêm / sửa / xóa) ───────────
let allFontChallenges = [];
let editingFcId = null;

async function saveFontChallenge() {
  const thai_text = document.getElementById('fcThaiInput').value.trim();
  const phonetic = document.getElementById('fcPhoneticInput').value.trim();
  const font_id = document.getElementById('fcFontSelect').value;
  const meaning_vi = document.getElementById('fcMeaningInput').value.trim();
  const grammar_point = document.getElementById('fcGrammarInput').value.trim();
  const explanation = document.getElementById('fcExplainInput').innerHTML.trim();
  if (!thai_text) { showToast('⚠️ Nhập câu tiếng Thái'); return; }
  if (!meaning_vi) { showToast('⚠️ Nhập nghĩa tiếng Việt'); return; }
  const btn = document.querySelector('button[onclick="saveFontChallenge()"]');
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try {
    await sbPostAuth('font_challenges', { thai_text, phonetic, font_id, meaning_vi, grammar_point, explanation });
    showToast('✅ Đã lưu câu Font Challenge!');
    document.getElementById('fcThaiInput').value = '';
    document.getElementById('fcPhoneticInput').value = '';
    document.getElementById('fcMeaningInput').value = '';
    document.getElementById('fcGrammarInput').value = '';
    document.getElementById('fcExplainInput').innerHTML = '';
    await loadAllFontChallengesAdmin();
    loadFontChallenge();
  } catch (e) {
    showToast('⚠️ Lỗi khi lưu câu Font Challenge, thử lại sau');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadAllFontChallengesAdmin() {
  try {
    const rows = await sbGet('font_challenges?select=*&order=id.desc');
    allFontChallenges = Array.isArray(rows) ? rows : [];
  } catch (e) { allFontChallenges = []; }
  renderFcAdminList();
}

function renderFcAdminList() {
  const el = document.getElementById('fcAdminList');
  const countEl = document.getElementById('fcAdminCount');
  if (countEl) countEl.textContent = allFontChallenges.length ? allFontChallenges.length + ' câu' : '';
  if (!el) return;
  el.innerHTML = allFontChallenges.length
    ? allFontChallenges.map(c => `
        <div class="wla-row" id="fc-row-${c.id}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text thai-font">${escapeHtml(c.thai_text || '')}</div>
            <div class="quote-admin-author">${escapeHtml(c.meaning_vi || '')} · ${FC_FONT_LABEL[c.font_id] || c.font_id}${c.grammar_point ? ' · 📘 ' + escapeHtml(c.grammar_point) : ''}</div>
          </div>
          <div class="wla-actions">
            <button class="btn-small edit" title="Chỉnh sửa" onclick="openEditFcModal(${c.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
            <button class="btn-small del" title="Xóa" onclick="deleteFontChallenge(${c.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`).join('')
    : '<div class="quote-admin-empty">Chưa có câu Font Challenge nào</div>';
}

function openEditFcModal(id) {
  const c = allFontChallenges.find(x => x.id === id);
  if (!c) return;
  editingFcId = id;
  document.getElementById('editFcThaiInput').value = c.thai_text || '';
  document.getElementById('editFcPhoneticInput').value = c.phonetic || '';
  document.getElementById('editFcFontSelect').value = c.font_id || 'chanok';
  document.getElementById('editFcMeaningInput').value = c.meaning_vi || '';
  document.getElementById('editFcGrammarInput').value = c.grammar_point || '';
  document.getElementById('editFcExplainInput').innerHTML = c.explanation || '';
  document.getElementById('editFcError').textContent = '';
  document.getElementById('editFcModal').classList.add('show');
}

function closeEditFcModal() {
  document.getElementById('editFcModal').classList.remove('show');
  editingFcId = null;
}

async function saveEditFontChallenge() {
  if (!editingFcId) return;
  const thai_text = document.getElementById('editFcThaiInput').value.trim();
  const phonetic = document.getElementById('editFcPhoneticInput').value.trim();
  const font_id = document.getElementById('editFcFontSelect').value;
  const meaning_vi = document.getElementById('editFcMeaningInput').value.trim();
  const grammar_point = document.getElementById('editFcGrammarInput').value.trim();
  const explanation = document.getElementById('editFcExplainInput').innerHTML.trim();
  const errorEl = document.getElementById('editFcError');
  errorEl.textContent = '';
  if (!thai_text) { errorEl.textContent = 'Vui lòng nhập câu tiếng Thái'; return; }
  if (!meaning_vi) { errorEl.textContent = 'Vui lòng nhập nghĩa tiếng Việt'; return; }
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/font_challenges?id=eq.' + editingFcId, {
      method: 'PATCH',
      headers: Object.assign(await authHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify({ thai_text, phonetic, font_id, meaning_vi, grammar_point, explanation })
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => null);
      throw new Error((errBody && errBody.message) || ('HTTP ' + resp.status));
    }
    closeEditFcModal();
    showToast('✅ Đã cập nhật câu Font Challenge');
    await loadAllFontChallengesAdmin();
    loadFontChallenge();
  } catch (e) {
    errorEl.textContent = 'Lỗi khi cập nhật: ' + (e.message || 'thử lại sau');
  }
}

async function deleteFontChallenge(id) {
  if (!confirm('Xóa câu Font Challenge này?')) return;
  try {
    await sbDeleteAuth('font_challenges?id=eq.' + id);
    showToast('Đã xóa câu Font Challenge');
    await loadAllFontChallengesAdmin();
    loadFontChallenge();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, kiểm tra lại quyền xóa (RLS) trên bảng font_challenges trong Supabase');
  }
}

// ── QUẢN LÝ GÓP Ý TRONG ADMIN ───────────────────────────
let allFeedback = [];

async function loadFeedbackAdmin() {
  try {
    const rows = await sbGetAuth('word_feedback?select=*&order=id.desc');
    allFeedback = Array.isArray(rows) ? rows : [];
  } catch (e) {
    allFeedback = [];
  }
  renderFeedbackAdminList();
}

function renderFeedbackAdminList() {
  const el = document.getElementById('feedbackAdminList');
  const countEl = document.getElementById('feedbackAdminCount');
  if (countEl) countEl.textContent = allFeedback.length ? allFeedback.length + ' góp ý' : '';
  if (!el) return;
  el.innerHTML = allFeedback.length
    ? allFeedback.map(f => {
        const word = allWords.find(w => w.id === f.word_id);
        return `
        <div class="wla-row" id="feedback-row-${f.id}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text">${word ? '📖 <b>' + word.thai + '</b> — ' : '(từ đã bị xóa) — '}${escapeHtml(f.feedback_text || '')}</div>
            ${f.user_id ? `<div class="quote-admin-author">👤 ${escapeHtml(f.user_display_name || 'Tài khoản (chưa đặt tên hiển thị)')}</div>` : ''}
            ${f.contact_email ? `<div class="quote-admin-author">✉️ ${escapeHtml(f.contact_email)}</div>` : ''}
          </div>
          <div class="wla-actions">
            ${word ? `<button class="btn-small edit" title="Xem từ này" onclick="showPage('home'); goToWord(${word.id})">👁️</button>` : ''}
            <button class="btn-small del" title="Xóa góp ý này" onclick="deleteFeedback(${f.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      }).join('')
    : '<div class="quote-admin-empty">Chưa có góp ý nào từ người dùng</div>';
}

async function deleteFeedback(id) {
  if (!confirm('Xóa góp ý này? (nên xóa sau khi đã xử lý xong)')) return;
  try {
    await sbDeleteAuth('word_feedback?id=eq.' + id);
    showToast('Đã xóa góp ý');
    await loadFeedbackAdmin();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa góp ý, kiểm tra quyền xóa (RLS) trên bảng word_feedback');
  }
}

// ── QUẢN LÝ ĐỀ XUẤT TỪ MỚI TRONG ADMIN ──────────────────
let allWordSuggestions = [];
let suggestionStatusFilter = 'pending'; // 'pending' | 'approved' | 'rejected' | 'all'
const SUGGESTION_STALE_DAYS = 30; // đánh dấu nổi bật nếu "pending" quá lâu chưa xử lý

// Mirror lên window: useSuggestionToAddWord() nằm ở modules/admin-core.js (module KHÁC,
// vì cần dùng chung defBlocks/addDefBlock của trình soạn định nghĩa) nên phải đọc mảng
// này qua window — 2 module ES riêng biệt không tự chia sẻ biến let/const cho nhau.
async function loadSuggestionsAdmin() {
  try {
    const rows = await sbGetAuth('word_suggestions?select=*&order=id.desc');
    allWordSuggestions = Array.isArray(rows) ? rows : [];
  } catch (e) {
    allWordSuggestions = [];
  }
  window.allWordSuggestions = allWordSuggestions;
  renderSuggestionsAdminList();
}

function setSuggestionStatusFilter(status) {
  suggestionStatusFilter = status;
  document.querySelectorAll('.suggestion-status-chip').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderSuggestionsAdminList();
}

function renderSuggestionsAdminList() {
  const el = document.getElementById('suggestionsAdminList');
  const countEl = document.getElementById('suggestionsAdminCount');
  const pendingCount = allWordSuggestions.filter(s => (s.status || 'pending') === 'pending').length;
  if (countEl) countEl.textContent = pendingCount ? pendingCount + ' chờ duyệt' : (allWordSuggestions.length ? 'Đã xử lý hết' : '');
  if (!el) return;

  const shown = suggestionStatusFilter === 'all'
    ? allWordSuggestions
    : allWordSuggestions.filter(s => (s.status || 'pending') === suggestionStatusFilter);

  const now = Date.now();
  const staleMs = SUGGESTION_STALE_DAYS * 86400000;

  el.innerHTML = shown.length
    ? shown.map(s => {
        const status = s.status || 'pending';
        const isStale = status === 'pending' && s.created_at && (now - new Date(s.created_at).getTime()) > staleMs;
        const statusBadge = status === 'approved'
          ? '<span class="suggestion-status-badge approved">✅ Đã thêm</span>'
          : status === 'rejected'
            ? '<span class="suggestion-status-badge rejected">❌ Từ chối</span>'
            : (isStale ? '<span class="suggestion-status-badge stale">⏳ Chờ lâu (>' + SUGGESTION_STALE_DAYS + ' ngày)</span>' : '');
        return `
        <div class="wla-row${isStale ? ' suggestion-row-stale' : ''}" id="suggestion-row-${s.id}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text">➕ <b class="thai-font">${escapeHtml(s.thai || '')}</b>${s.phonetic ? ' (' + escapeHtml(s.phonetic) + ')' : ''}${s.meaning_suggestion ? ' — ' + escapeHtml(s.meaning_suggestion) : ''}${s.request_count > 1 ? ' <span class="suggestion-request-count">👥 ' + s.request_count + ' người cùng đề xuất</span>' : ''}</div>
            ${s.note ? `<div class="quote-admin-author">📝 ${escapeHtml(s.note)}</div>` : ''}
            ${s.user_id ? `<div class="quote-admin-author">👤 ${escapeHtml(s.user_display_name || 'Tài khoản (chưa đặt tên hiển thị)')}</div>` : ''}
            ${s.contact_email ? `<div class="quote-admin-author">✉️ ${escapeHtml(s.contact_email)}</div>` : ''}
            ${s.admin_note ? `<div class="quote-admin-author">💬 Ghi chú của bạn: ${escapeHtml(s.admin_note)}</div>` : ''}
            ${statusBadge}
          </div>
          <div class="wla-actions">
            <button class="btn-small edit" title="Điền sẵn vào form Thêm từ mới" onclick="useSuggestionToAddWord(${s.id})">➕</button>
            ${status !== 'approved' ? `<button class="btn-small" title="Đánh dấu đã thêm vào từ điển" onclick="setSuggestionStatus(${s.id}, 'approved')">✅</button>` : ''}
            ${status !== 'rejected' ? `<button class="btn-small" title="Từ chối đề xuất này" onclick="setSuggestionStatus(${s.id}, 'rejected')">❌</button>` : ''}
            <button class="btn-small del" title="Xóa hẳn đề xuất này" onclick="deleteWordSuggestion(${s.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      }).join('')
    : '<div class="quote-admin-empty">' + (suggestionStatusFilter === 'pending' ? 'Không còn đề xuất nào chờ duyệt 🎉' : 'Không có đề xuất nào ở mục này') + '</div>';
}

// Đánh dấu trạng thái xử lý — KHÔNG xóa bản ghi (khác hành vi cũ) để người dùng còn thấy lại kết
// quả đề xuất của mình (tab "Đề xuất từ" + Hồ sơ). "rejected" hỏi thêm ghi chú lý do (không bắt
// buộc) để người dùng hiểu vì sao, thay vì chỉ thấy im lặng.
async function setSuggestionStatus(id, status) {
  let admin_note = null;
  if (status === 'rejected') {
    admin_note = prompt('Lý do từ chối (không bắt buộc, người đề xuất sẽ thấy được):', '');
    if (admin_note === null) return; // bấm Hủy — không đổi trạng thái
    admin_note = admin_note.trim() || null;
  }
  try {
    await sbPatchAuth('word_suggestions?id=eq.' + id, { status, admin_note });
    showToast(status === 'approved' ? '✅ Đã đánh dấu "Đã thêm"' : '❌ Đã từ chối đề xuất');
    await loadSuggestionsAdmin();
  } catch (e) {
    showToast('⚠️ Lỗi khi cập nhật trạng thái, kiểm tra quyền (RLS) trên bảng word_suggestions');
  }
}

async function deleteWordSuggestion(id) {
  if (!confirm('Xóa HẲN đề xuất này? (người đề xuất sẽ không còn thấy lại được nữa — nếu chỉ muốn xử lý xong thì dùng nút ✅/❌ ở trên thay vì xóa)')) return;
  try {
    await sbDeleteAuth('word_suggestions?id=eq.' + id);
    showToast('Đã xóa đề xuất');
    await loadSuggestionsAdmin();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa đề xuất, kiểm tra quyền xóa (RLS) trên bảng word_suggestions');
  }
}

// ── TỪ TÌM NHIỀU NHƯNG CHƯA CÓ KẾT QUẢ (thay cho widget vote đề xuất từ mới cũ) ────
// Dữ liệu do app.js tự ghi nhận ngầm (scheduleNoResultLog) mỗi khi có người tìm 1 từ mà
// không ra kết quả — không cần người dùng chủ động làm gì, tín hiệu nhu cầu thật 100%.
let allNoResultSearches = [];

async function loadNoResultSearchesAdmin() {
  try {
    const rows = await sbGetAuth('no_result_searches?select=*&order=hit_count.desc&limit=50');
    allNoResultSearches = Array.isArray(rows) ? rows : [];
  } catch (e) {
    allNoResultSearches = [];
  }
  renderNoResultSearchesList();
}

function renderNoResultSearchesList() {
  const el = document.getElementById('noResultSearchesList');
  const countEl = document.getElementById('noResultSearchesCount');
  if (countEl) countEl.textContent = allNoResultSearches.length ? 'Top ' + allNoResultSearches.length : '';
  if (!el) return;
  el.innerHTML = allNoResultSearches.length
    ? allNoResultSearches.map(r => `
        <div class="wla-row" id="nrs-row-${escapeHtml(r.query_text)}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text">🔍 <b class="thai-font">${escapeHtml(r.query_text)}</b> — ${r.hit_count} lượt tìm</div>
            <div class="quote-admin-author">🕒 Gần nhất: ${r.last_searched_at ? new Date(r.last_searched_at).toLocaleString('vi-VN') : ''}</div>
          </div>
          <div class="wla-actions">
            <button class="btn-small edit" title="Điền sẵn từ này vào form Thêm từ mới" onclick="useNoResultSearchToAddWord('${escapeHtml(r.query_text).replace(/'/g, "\\'")}')">➕</button>
            <button class="btn-small del" title="Xóa khỏi danh sách" onclick="deleteNoResultSearch('${escapeHtml(r.query_text).replace(/'/g, "\\'")}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`).join('')
    : '<div class="quote-admin-empty">Chưa ghi nhận từ nào — dữ liệu tự tích lũy khi người dùng tìm không ra kết quả</div>';
}

// Điền sẵn cụm từ tìm không ra kết quả vào form "Thêm từ mới" — chỉ điền ô từ tiếng Thái
// (#fThai, giống field admin-core.js dùng cho useSuggestionToAddWord), KHÔNG đụng tới
// defBlocks/addDefBlock vì đó là biến riêng của module admin-core.js, admin-extra.js không
// truy cập được (2 file là 2 ES module độc lập, không share scope) — với dữ liệu này cũng
// không có sẵn nghĩa gợi ý để điền, admin tự bổ sung định nghĩa như thêm từ mới bình thường.
function useNoResultSearchToAddWord(queryText) {
  const thaiInput = document.getElementById('fThai');
  if (thaiInput) {
    thaiInput.value = queryText;
    thaiInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  showToast('📋 Đã điền "' + queryText + '" vào ô từ tiếng Thái — bổ sung phiên âm & định nghĩa trước khi lưu');
}

async function deleteNoResultSearch(queryText) {
  try {
    await sbDeleteAuth('no_result_searches?query_text=eq.' + encodeURIComponent(queryText));
    showToast('Đã xóa khỏi danh sách');
    await loadNoResultSearchesAdmin();
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, kiểm tra quyền xóa (RLS) trên bảng no_result_searches');
  }
}

// ── QUẢN LÝ NGƯỜI DÙNG (bảng profiles) ──────────────────
let allProfiles = [];

async function loadUsersAdmin() {
  try {
    const rows = await sbGetAuth('profiles?select=*&order=created_at.desc');
    allProfiles = Array.isArray(rows) ? rows : [];
  } catch (e) {
    allProfiles = [];
  }
  renderUsersAdminList();
}

function renderUsersAdminList() {
  const el = document.getElementById('usersAdminList');
  const countEl = document.getElementById('usersAdminCount');
  if (countEl) countEl.textContent = allProfiles.length ? allProfiles.length + ' người dùng' : '';
  if (!el) return;
  el.innerHTML = allProfiles.length
    ? allProfiles.map(p => `
        <div class="wla-row" id="user-row-${p.id}">
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text">${escapeHtml(p.display_name || '(chưa đặt tên hiển thị)')}${p.is_admin ? ' <span class="admin-badge" style="margin-left:6px">● Admin</span>' : ''}</div>
            <div class="quote-admin-author">✉️ ${escapeHtml(p.email || '')}</div>
            <div class="quote-admin-author">📅 Tham gia ${p.created_at ? new Date(p.created_at).toLocaleDateString('vi-VN') : '—'}</div>
          </div>
          <div class="wla-actions">
            ${p.id === (session && session.user && session.user.id)
              ? '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap">Tài khoản của bạn</span>'
              : `<button class="btn-small ${p.is_admin ? 'del' : 'edit'}" title="${p.is_admin ? 'Thu hồi quyền admin' : 'Cấp quyền admin'}" onclick="toggleUserAdmin('${p.id}', ${!p.is_admin})">${p.is_admin ? '⬇️ Thu hồi' : '⬆️ Cấp admin'}</button>`}
          </div>
        </div>`).join('')
    : '<div class="quote-admin-empty">Chưa có người dùng nào đăng ký</div>';
}

async function toggleUserAdmin(userId, makeAdmin) {
  const label = allProfiles.find(p => p.id === userId)?.display_name || allProfiles.find(p => p.id === userId)?.email || 'người dùng này';
  if (!confirm((makeAdmin ? 'Cấp quyền admin cho ' : 'Thu hồi quyền admin của ') + label + '?')) return;
  try {
    await sbPatchAuth('profiles?id=eq.' + userId, { is_admin: makeAdmin });
    showToast(makeAdmin ? '✅ Đã cấp quyền admin' : '✅ Đã thu hồi quyền admin');
    await loadUsersAdmin();
  } catch (e) {
    showToast('⚠️ Lỗi khi đổi quyền, kiểm tra quyền (RLS) trên bảng profiles');
  }
}

// ── QUẢN LÝ NGÂN HÀNG CÂU DỊCH (bảng sentence_bank — cache tính năng "Dịch cả câu") ────
// Khác các bảng admin khác: sentence_bank có thể phình rất to theo thời gian (mỗi câu mới
// người dùng gõ đều được lưu lại), nên KHÔNG tải hết 1 lần như quotes/feedback — chỉ tải
// tối đa 100 dòng theo usage_count giảm dần (câu được tra nhiều nhất lên đầu), và ô tìm
// kiếm truy vấn thẳng lên server (ilike) thay vì lọc phía client.
let allSentenceBank = [];
let editingSentenceId = null;
// Chế độ "Chọn nhiều" để xóa hàng loạt: selectMode bật/tắt checkbox đầu dòng, selectedSentenceIds giữ các id đang tick.
let sentenceBankSelectMode = false;
const selectedSentenceIds = new Set();
let sentenceBankSearchTimeout;

// Làm sạch văn bản hiển thị trong ngân hàng câu: bỏ thẻ HTML (<p>, <em>...) VÀ giải mã entity (&nbsp; &amp; &lt;...)
// thành chữ thường. Chạy tối đa 2 lượt phòng trường hợp dữ liệu bị escape 2 lần (vd "&lt;p&gt;"). Chỉ dùng để HIỂN THỊ,
// không ghi ngược lại DB. Dùng <template> nên không thực thi script/ảnh trong chuỗi.
function sentenceBankPlain(str) {
  let t = String(str || '');
  for (let i = 0; i < 2; i++) {
    const tpl = document.createElement('template');
    tpl.innerHTML = t.replace(/<\/p>\s*<p[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
    t = (tpl.content.textContent || '');
    if (!/[<&]/.test(t)) break;
  }
  return t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function loadSentenceBankAdmin(searchTerm) {
  const term = (searchTerm || '').trim();
  let path = 'sentence_bank?select=*&order=usage_count.desc,updated_at.desc&limit=100';
  if (term) path += '&thai_sentence=ilike.*' + encodeURIComponent(term) + '*';
  try {
    const rows = await sbGetAuth(path);
    allSentenceBank = Array.isArray(rows) ? rows : [];
  } catch (e) {
    allSentenceBank = [];
  }
  // Bỏ khỏi danh sách chọn những id không còn nằm trong kết quả hiện tại (vd sau khi tìm kiếm/xóa)
  const visibleIds = new Set(allSentenceBank.map(x => x.id));
  Array.from(selectedSentenceIds).forEach(id => { if (!visibleIds.has(id)) selectedSentenceIds.delete(id); });
  renderSentenceBankAdminList(term);
}

// Debounce 350ms giống các ô tìm kiếm khác trong app — tránh gọi API dồn dập mỗi lần gõ phím
function onSentenceBankSearch(val) {
  clearTimeout(sentenceBankSearchTimeout);
  sentenceBankSearchTimeout = setTimeout(() => loadSentenceBankAdmin(val), 350);
}

function renderSentenceBankAdminList(searchTerm) {
  const el = document.getElementById('sentenceBankAdminList');
  const countEl = document.getElementById('sentenceBankAdminCount');
  if (countEl) countEl.textContent = allSentenceBank.length
    ? allSentenceBank.length + (allSentenceBank.length >= 100 ? '+ câu (top 100)' : ' câu')
    : '';
  if (!el) return;
  const bulkBar = allSentenceBank.length ? `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${sentenceBankSelectMode ? `
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" id="sentenceBankSelectAll" onchange="toggleSentenceSelectAll(this.checked)"> Chọn tất cả
          </label>
          <span id="sentenceBankSelectedCount" style="font-size:13px;color:var(--text-muted)"></span>
          <button type="button" class="btn-small del" id="sentenceBankBulkDelBtn" style="width:auto;padding:0 12px;color:#C62828" onclick="deleteSelectedSentences()">Xóa đã chọn</button>
          <button type="button" class="btn-small" style="width:auto;padding:0 12px" onclick="toggleSentenceSelectMode()">Hủy</button>
        ` : `
          <button type="button" class="btn-small" style="width:auto;padding:0 12px;font-size:13px" onclick="toggleSentenceSelectMode()">Chọn nhiều</button>
        `}
      </div>` : '';
  el.innerHTML = bulkBar + (allSentenceBank.length
    ? allSentenceBank.map(s => `
        <div class="wla-row" id="sentence-bank-row-${s.id}">
          ${sentenceBankSelectMode ? `<input type="checkbox" class="sentence-bank-select-cb" data-id="${s.id}" ${selectedSentenceIds.has(s.id) ? 'checked' : ''} onchange="toggleSentenceSelect(${s.id}, this.checked)" style="flex-shrink:0;width:18px;height:18px;cursor:pointer">` : ''}
          <div style="flex:1;min-width:0">
            <div class="quote-admin-text thai-font">${escapeHtml(sentenceBankPlain(s.thai_sentence))}${s.verified_by_admin ? ' <span style="font-size:11px;color:#2E7D32;font-weight:600">✅ Đã duyệt</span>' : ' <span style="font-size:11px;color:var(--text-muted)">⏳ Chưa duyệt</span>'}</div>
            <div class="quote-admin-author">→ ${escapeHtml(sentenceBankPlain(s.translation))}</div>
            <div class="quote-admin-author">🔁 ${s.usage_count || 0} lượt tra${s.model ? ' · ' + escapeHtml(s.model) : ''}</div>
          </div>
          ${sentenceBankSelectMode ? '' : `<div class="wla-actions">
            <button class="btn-small edit" title="Chỉnh sửa bản dịch" onclick="openEditSentenceModal(${s.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
            <button class="btn-small del" title="Xóa khỏi ngân hàng câu (AI sẽ dịch lại từ đầu lần sau)" onclick="deleteSentenceBankEntry(${s.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>`}
        </div>`).join('')
    : `<div class="quote-admin-empty">${searchTerm ? 'Không tìm thấy câu nào khớp' : 'Chưa có câu nào được dịch qua tính năng này'}</div>`);
  updateSentenceBankSelectUI();
}

// ── CHỌN NHIỀU + XÓA HÀNG LOẠT ──
function toggleSentenceSelectMode() {
  sentenceBankSelectMode = !sentenceBankSelectMode;
  selectedSentenceIds.clear();
  renderSentenceBankAdminList(document.getElementById('sentenceBankSearchInput')?.value || '');
}

function toggleSentenceSelect(id, checked) {
  if (checked) selectedSentenceIds.add(id); else selectedSentenceIds.delete(id);
  updateSentenceBankSelectUI();
}

// "Chọn tất cả" áp dụng cho các dòng ĐANG HIỆN (kết quả tìm kiếm hiện tại, tối đa 100 dòng)
function toggleSentenceSelectAll(checked) {
  allSentenceBank.forEach(s => { if (checked) selectedSentenceIds.add(s.id); else selectedSentenceIds.delete(s.id); });
  document.querySelectorAll('.sentence-bank-select-cb').forEach(cb => { cb.checked = checked; });
  updateSentenceBankSelectUI();
}

function updateSentenceBankSelectUI() {
  if (!sentenceBankSelectMode) return;
  const n = selectedSentenceIds.size;
  const countEl = document.getElementById('sentenceBankSelectedCount');
  if (countEl) countEl.textContent = n ? 'Đã chọn ' + n + ' câu' : 'Chưa chọn câu nào';
  const delBtn = document.getElementById('sentenceBankBulkDelBtn');
  if (delBtn) { delBtn.disabled = !n; delBtn.style.opacity = n ? '1' : '0.5'; delBtn.style.cursor = n ? 'pointer' : 'not-allowed'; }
  const allCb = document.getElementById('sentenceBankSelectAll');
  if (allCb) allCb.checked = allSentenceBank.length > 0 && allSentenceBank.every(s => selectedSentenceIds.has(s.id));
}

async function deleteSelectedSentences() {
  const ids = Array.from(selectedSentenceIds);
  if (!ids.length) return;
  if (!confirm('Xóa ' + ids.length + ' câu đã chọn khỏi ngân hàng câu? Lần sau ai gõ đúng các câu này, AI sẽ dịch lại từ đầu.')) return;
  try {
    await sbDeleteAuth('sentence_bank?id=in.(' + ids.join(',') + ')');
    selectedSentenceIds.clear();
    await loadSentenceBankAdmin(document.getElementById('sentenceBankSearchInput')?.value || '');
    // sbDeleteAuth không báo lỗi khi bị RLS chặn — đối chiếu lại danh sách vừa tải để biết có xóa thật không
    const remaining = ids.filter(id => allSentenceBank.some(s => s.id === id)).length;
    if (remaining) showToast('⚠️ Còn ' + remaining + '/' + ids.length + ' câu chưa xóa được, kiểm tra quyền xóa (RLS) trên bảng sentence_bank');
    else showToast('Đã xóa ' + ids.length + ' câu khỏi ngân hàng câu');
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, kiểm tra quyền xóa (RLS) trên bảng sentence_bank');
  }
}

function openEditSentenceModal(id) {
  const s = allSentenceBank.find(x => x.id === id);
  if (!s) return;
  editingSentenceId = id;
  document.getElementById('editSentenceThaiDisplay').textContent = sentenceBankPlain(s.thai_sentence);
  document.getElementById('editSentenceTranslationInput').value = s.translation || '';
  document.getElementById('editSentenceRomanizationInput').value = s.romanization || '';
  document.getElementById('editSentenceGrammarInput').value = s.grammar || '';
  const verifiedCheckbox = document.getElementById('editSentenceVerifiedInput');
  if (verifiedCheckbox) verifiedCheckbox.checked = !!s.verified_by_admin;
  const metaEl = document.getElementById('editSentenceMeta');
  if (metaEl) {
    const parts = [];
    if (s.model) parts.push('Model: ' + s.model);
    if (s.prompt_version) parts.push('Prompt: ' + s.prompt_version);
    parts.push((s.usage_count || 0) + ' lượt tra');
    if (s.updated_at) parts.push('Cập nhật ' + new Date(s.updated_at).toLocaleString('vi-VN'));
    metaEl.textContent = parts.join(' · ');
  }
  document.getElementById('editSentenceError').textContent = '';
  document.getElementById('editSentenceModal').classList.add('show');
}

function closeEditSentenceModal() {
  document.getElementById('editSentenceModal').classList.remove('show');
  editingSentenceId = null;
}

async function saveEditSentence() {
  if (!editingSentenceId) return;
  const translation = document.getElementById('editSentenceTranslationInput').value.trim();
  const romanization = document.getElementById('editSentenceRomanizationInput').value.trim();
  const grammar = document.getElementById('editSentenceGrammarInput').value.trim();
  // Admin bấm Lưu (dù có sửa nội dung hay chỉ xác nhận) coi như đã kiểm duyệt câu này —
  // trừ khi admin bỏ tick ô "Đã kiểm duyệt" (vd muốn đánh dấu lại để xem sau).
  const verified = document.getElementById('editSentenceVerifiedInput')?.checked ?? true;
  const errorEl = document.getElementById('editSentenceError');
  errorEl.textContent = '';
  if (!translation) { errorEl.textContent = 'Vui lòng nhập bản dịch'; return; }
  try {
    await sbPatchAuth('sentence_bank?id=eq.' + editingSentenceId, {
      translation,
      romanization: romanization || null,
      grammar: grammar || null,
      verified_by_admin: verified
    });
    closeEditSentenceModal();
    showToast('✅ Đã cập nhật bản dịch — áp dụng ngay cho lần tra tiếp theo');
    await loadSentenceBankAdmin(document.getElementById('sentenceBankSearchInput')?.value || '');
  } catch (e) {
    errorEl.textContent = 'Lỗi khi cập nhật: ' + (e.message || 'thử lại sau, kiểm tra quyền (RLS) trên bảng sentence_bank');
  }
}

async function deleteSentenceBankEntry(id) {
  if (!confirm('Xóa câu này khỏi ngân hàng câu? Lần sau ai gõ đúng câu này, AI sẽ dịch lại từ đầu.')) return;
  try {
    await sbDeleteAuth('sentence_bank?id=eq.' + id);
    showToast('Đã xóa khỏi ngân hàng câu');
    await loadSentenceBankAdmin(document.getElementById('sentenceBankSearchInput')?.value || '');
  } catch (e) {
    showToast('⚠️ Lỗi khi xóa, kiểm tra quyền xóa (RLS) trên bảng sentence_bank');
  }
}

Object.assign(window, {
  toggleSentenceSelectMode, toggleSentenceSelect, toggleSentenceSelectAll, deleteSelectedSentences,
  saveFontChallenge, loadAllFontChallengesAdmin, renderFcAdminList, openEditFcModal, closeEditFcModal, saveEditFontChallenge, deleteFontChallenge,
  loadFeedbackAdmin, renderFeedbackAdminList, deleteFeedback,
  loadSuggestionsAdmin, renderSuggestionsAdminList, deleteWordSuggestion, setSuggestionStatusFilter, setSuggestionStatus,
  loadNoResultSearchesAdmin, renderNoResultSearchesList, useNoResultSearchToAddWord, deleteNoResultSearch,
  loadUsersAdmin, renderUsersAdminList, toggleUserAdmin,
  loadSentenceBankAdmin, onSentenceBankSearch, renderSentenceBankAdminList,
  openEditSentenceModal, closeEditSentenceModal, saveEditSentence, deleteSentenceBankEntry
});

export { loadAllFontChallengesAdmin, loadFeedbackAdmin, loadSuggestionsAdmin, loadNoResultSearchesAdmin, loadUsersAdmin, loadSentenceBankAdmin };

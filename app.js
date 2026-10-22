// ============================================================
// Supabase client (SUPABASE_URL/KEY), sbGet/sbPost/sbDelete,
// session (auth), sbGetAuth/sbPostAuth/sbPatchAuth/sbDeleteAuth,
// saveSession/clearSession, signUpUser/signInUser, signInWithGoogle,
// consumeAuthHashIfPresent, refreshSessionToken, ensureValidSession
// ĐÃ CHUYỂN sang file supabase.js (nạp trước app.js trong index.html).
// ============================================================

// ════════════════════════════════════════════════════════════
// LAZY LOAD MODULES (import() động) — alay
// 4 khối tính năng ít dùng ngay từ đầu (bàn phím ảo + canvas viết tay, widget
// thời tiết/tỷ giá/món ăn, lõi trang quản trị) đã được tách sang các file
// riêng trong /modules, KHÔNG còn nằm sẵn trong app.js nữa — trình duyệt chỉ
// tải các file này về khi người dùng thực sự cần đến (mở bàn phím ảo, mở
// widget "Thông tin nhanh", hoặc vào trang quản trị). import() tự cache theo
// URL nên gọi loadXxxModule() nhiều lần chỉ tải qua mạng đúng 1 lần.
//
// Mỗi module, khi tải xong, tự gán các hàm của nó lên window (Object.assign),
// ghi đè các hàm stub bên dưới — nên toàn bộ onclick="..." có sẵn trong HTML
// (kể cả HTML do JS sinh ra sau này) vẫn gọi đúng tên hàm như cũ, không cần
// sửa gì ở index.html.
// ════════════════════════════════════════════════════════════
// MODULES_VER: số phiên bản gắn vào URL import() để ÉP trình duyệt tải lại module khi bạn sửa file trong /modules/.
// Import động không có cách nào khác để "bump" như ?v= ở thẻ <script>/<link>. TĂNG số này mỗi lần deploy có sửa
// bất kỳ file nào trong modules/ (cùng lúc với ?v= của app.js trong index.html và CACHE_VERSION trong sw.js).
const MODULES_VER = '207';
function loadKeyboardModule()  { return import('/modules/keyboard.js?v=' + MODULES_VER); }
function loadWidgetsModule()   { return import('/modules/widgets.js?v=' + MODULES_VER); }
function loadAdminCoreModule() { return import('/modules/admin-core.js?v=' + MODULES_VER); }
function loadAdminExtraModule(){ return import('/modules/admin-extra.js?v=' + MODULES_VER); }

// ── Stub cho các entry-point được gọi trực tiếp từ HTML TĨNH (index.html) —
// tức có thể bị bấm trước khi module kịp tải xong. Mỗi stub chỉ chờ module
// tải xong (await) rồi gọi lại đúng tên hàm đó — lúc này window[name] đã được
// module ghi đè bằng bản triển khai thật nên gọi lại là chạy đúng logic thật.
// Các hàm do HTML admin/widget SINH RA ĐỘNG (vd onclick="openEditModal(...)")
// không cần stub vì chỉ render ra sau khi module tương ứng đã tải xong rồi.
(function registerLazyStubs() {
  // openKeyboard: icon bàn phím ảo ở ô tìm kiếm chính + ô tìm kiếm trên header
  window.openKeyboard = function(...args) {
    return loadKeyboardModule().then(function() { return window.openKeyboard(...args); });
  };
  // Các nút trong form thêm/sửa từ + ô lọc danh sách từ ở trang admin (modules/admin-core.js)
  ['addWord', 'filterAdminList', 'closeEditModal', 'saveEdit', 'addDefBlock',
   'rteCmd'].forEach(function(name) {
    window[name] = function(...args) {
      return loadAdminCoreModule().then(function() { return window[name](...args); });
    };
  });
  // Các nút quản trị widget thời tiết/tỷ giá/món ăn ở trang admin (modules/widgets.js)
  ['saveCardTitle', 'saveCurrencyExample', 'saveFoodItem', 'closeEditFoodModal', 'saveEditFoodItem'].forEach(function(name) {
    window[name] = function(...args) {
      return loadWidgetsModule().then(function() { return window[name](...args); });
    };
  });
  // Form thêm/sửa câu Font Challenge ở trang admin (modules/admin-extra.js)
  ['saveFontChallenge', 'saveEditFontChallenge', 'closeEditFcModal'].forEach(function(name) {
    window[name] = function(...args) {
      return loadAdminExtraModule().then(function() { return window[name](...args); });
    };
  });
})();

// Đồng bộ dữ liệu khi đăng nhập: đẩy dữ liệu ẩn danh (localStorage) đang có lên tài khoản (nếu chưa có),
// sau đó lấy toàn bộ dữ liệu từ tài khoản làm nguồn dữ liệu chính
async function syncUserDataOnLogin() {
  const uid = session.user.id;
  try {
    const [remoteFolders, remoteFavs, remoteHist, remotePins, remoteFolderLinks, remoteSrsProgress] = await Promise.all([
      sbGetAuth('favorite_folders?select=id,name,is_public,save_count&user_id=eq.' + uid + '&order=created_at.asc'),
      sbGetAuth('favorites?select=word_id,def_index,folder_id,note_def,note_example&user_id=eq.' + uid),
      sbGetAuth('search_history?select=word_id,ts,pinned,count&user_id=eq.' + uid),
      sbGetAuth('pinned_items?select=word_id,item_type,def_index,ex_index&user_id=eq.' + uid),
      sbGetAuth('favorite_folder_links?select=word_id,def_index,folder_id&user_id=eq.' + uid),
      sbGetAuth('srs_progress?select=word_id,def_index,box,due,interval,ignored&user_id=eq.' + uid)
    ]);
    const remoteFolderList = Array.isArray(remoteFolders) ? remoteFolders : [];
    const remoteFavRows = Array.isArray(remoteFavs) ? remoteFavs : [];
    const remoteFavKeys = new Set(remoteFavRows.map(r => favKey(r.word_id, r.def_index)));
    const remoteHistIds = new Set((Array.isArray(remoteHist) ? remoteHist : []).map(r => r.word_id));
    const remotePinRows = Array.isArray(remotePins) ? remotePins : [];
    const remotePinnedDefKeys = new Set(remotePinRows.filter(r => r.item_type === 'definition').map(r => pinDefKey(r.word_id, r.def_index)));
    const remotePinnedExKeys = new Set(remotePinRows.filter(r => r.item_type === 'example').map(r => pinExKey(r.word_id, r.def_index, r.ex_index)));
    // Tập hợp "key-folderId" đã có sẵn trên favorite_folder_links, để không đẩy trùng lặp
    const remoteFolderLinkKeys = new Set((Array.isArray(remoteFolderLinks) ? remoteFolderLinks : [])
      .map(r => favKey(r.word_id, r.def_index) + '::' + r.folder_id));
    // srs_progress giờ TÁCH RIÊNG khỏi favorites hoàn toàn (xem migration_add_srs_progress.sql) —
    // 1 nghĩa có thể có mặt trong srs_progress mà KHÔNG có trong favorites (tự đánh giá mức nhớ mà
    // chưa lưu Yêu thích), nên cần 1 Set khoá riêng để biết entry nào đã có trên tài khoản.
    const remoteSrsRows = Array.isArray(remoteSrsProgress) ? remoteSrsProgress : [];
    const remoteSrsKeys = new Set(remoteSrsRows.map(r => favKey(r.word_id, r.def_index)));

    const localFavs = migrateOldFavorites(JSON.parse(localStorage.getItem('thai_favs') || '[]'));
    const localFolders = JSON.parse(localStorage.getItem('thai_fav_folders') || '[]');
    const localFolderMap = normalizeFolderMap(JSON.parse(localStorage.getItem('thai_fav_folder_map') || '{}'));
    const localNotesMap = JSON.parse(localStorage.getItem('thai_fav_notes') || '{}');
    const localSrsMap = JSON.parse(localStorage.getItem('thai_fav_srs') || '{}');
    const localHistRaw = JSON.parse(localStorage.getItem('thai_recent') || '[]');
    const localHist = (localHistRaw.length && typeof localHistRaw[0] === 'number')
      ? localHistRaw.map((id, i) => ({ id, ts: Date.now() - i * 1000, pinned: false }))
      : localHistRaw;
    // Ghim (pin) ẩn danh — lưu ở localStorage dưới dạng { "wordId-defIndex": createdAtMs, ... },
    // giống cấu trúc pinnedDefsMap/pinnedExMap đang dùng trong bộ nhớ (xem onDefPinClick/
    // onExamplePinClick), nên đẩy thẳng lên được mà không cần chuyển đổi định dạng.
    const localPinnedDefs = JSON.parse(localStorage.getItem('thai_pinned_defs') || '{}');
    const localPinnedEx = JSON.parse(localStorage.getItem('thai_pinned_ex') || '{}');

    // Đẩy các thư mục yêu thích đang có ở máy (chưa có trên tài khoản) lên Supabase, theo tên
    const remoteFolderByName = new Map(remoteFolderList.map(f => [f.name.toLowerCase(), f]));
    const localIdToRemoteFolderId = {};
    for (const lf of localFolders) {
      const existing = remoteFolderByName.get((lf.name || '').toLowerCase());
      if (existing) {
        localIdToRemoteFolderId[lf.id] = existing.id;
      } else {
        try {
          const created = await sbPostAuth('favorite_folders', { user_id: uid, name: lf.name });
          const row = Array.isArray(created) ? created[0] : created;
          if (row) {
            localIdToRemoteFolderId[lf.id] = row.id;
            remoteFolderByName.set((lf.name || '').toLowerCase(), row);
          }
        } catch (e) { /* bỏ qua, thư mục sẽ không được đồng bộ nếu lỗi mạng */ }
      }
    }

    const favPushes = localFavs.filter(key => !remoteFavKeys.has(key))
      .map(key => {
        const { wordId, defIndex } = favKeyParts(key);
        const note = localNotesMap[key] || {};
        return sbPostAuth('favorites', {
          user_id: uid, word_id: wordId, def_index: defIndex,
          note_def: note.noteDef || null, note_example: note.noteExample || null
        }, 'user_id,word_id,def_index').catch(() => {});
      });
    // srs_progress đẩy RIÊNG, ĐỘC LẬP với favPushes ở trên — 1 nghĩa có thể có tiến độ ôn tập mà
    // chưa từng được lưu Yêu thích (tự đánh giá mức nhớ không cần lưu vào Sổ tay), nên không thể
    // gộp chung điều kiện lọc "chưa có trên favorites" như trước nữa.
    const srsPushes = Object.keys(localSrsMap).filter(key => !remoteSrsKeys.has(key))
      .map(key => {
        const { wordId, defIndex } = favKeyParts(key);
        const srs = localSrsMap[key];
        return sbPostAuth('srs_progress', {
          user_id: uid, word_id: wordId, def_index: defIndex,
          box: srs.box || 1, due: new Date(srs.due || Date.now()).toISOString(), interval: srs.interval || null, ignored: !!srs.ignored
        }, 'user_id,word_id,def_index').catch(() => {});
      });
    const histPushes = localHist.filter(r => r && !remoteHistIds.has(r.id))
      .map(r => sbPostAuth('search_history', { user_id: uid, word_id: r.id, ts: r.ts || Date.now(), pinned: !!r.pinned, count: r.count || 1 }, 'user_id,word_id').catch(() => {}));
    const pinDefPushes = Object.keys(localPinnedDefs).filter(key => !remotePinnedDefKeys.has(key))
      .map(key => {
        const [wordId, defIndex] = key.split('-').map(Number);
        return sbPostAuth('pinned_items', { user_id: uid, word_id: wordId, item_type: 'definition', def_index: defIndex, ex_index: -1 }).catch(() => {});
      });
    const pinExPushes = Object.keys(localPinnedEx).filter(key => !remotePinnedExKeys.has(key))
      .map(key => {
        const [wordId, defIndex, exIndex] = key.split('-').map(Number);
        return sbPostAuth('pinned_items', { user_id: uid, word_id: wordId, item_type: 'example', def_index: defIndex, ex_index: exIndex }).catch(() => {});
      });
    // Đẩy từng liên kết "nghĩa X thuộc thư mục Y" đang có ở máy (ẩn danh) lên bảng
    // favorite_folder_links — 1 nghĩa có thể đẩy NHIỀU dòng (nhiều thư mục cùng lúc).
    const folderLinkPushes = [];
    Object.keys(localFolderMap).forEach(key => {
      const { wordId, defIndex } = favKeyParts(key);
      (localFolderMap[key] || []).forEach(localFolderId => {
        const remoteFolderId = localIdToRemoteFolderId[localFolderId] || localFolderId;
        if (remoteFolderLinkKeys.has(key + '::' + remoteFolderId)) return;
        folderLinkPushes.push(sbPostAuth('favorite_folder_links', {
          user_id: uid, word_id: wordId, def_index: defIndex, folder_id: remoteFolderId
        }, 'user_id,word_id,def_index,folder_id').catch(() => {}));
      });
    });
    await Promise.all([...favPushes, ...srsPushes, ...histPushes, ...pinDefPushes, ...pinExPushes, ...folderLinkPushes]);

    const [finalFolders, finalFavs, finalHist, finalPins, finalFolderLinks, finalSrsProgress] = await Promise.all([
      sbGetAuth('favorite_folders?select=id,name,is_public,save_count&user_id=eq.' + uid + '&order=created_at.asc'),
      sbGetAuth('favorites?select=word_id,def_index,folder_id,note_def,note_example&user_id=eq.' + uid),
      sbGetAuth('search_history?select=word_id,ts,pinned,count&user_id=eq.' + uid),
      sbGetAuth('pinned_items?select=word_id,item_type,def_index,ex_index,created_at&user_id=eq.' + uid),
      sbGetAuth('favorite_folder_links?select=word_id,def_index,folder_id&user_id=eq.' + uid),
      sbGetAuth('srs_progress?select=word_id,def_index,box,due,interval,ignored&user_id=eq.' + uid)
    ]);
    favoriteFolders = (Array.isArray(finalFolders) ? finalFolders : []).map(f => ({ id: f.id, name: f.name, is_public: !!f.is_public, save_count: f.save_count || 0 }));
    const finalFavRows = Array.isArray(finalFavs) ? finalFavs : [];
    favorites = finalFavRows.map(r => favKey(r.word_id, r.def_index));
    favFolderMap = {};
    favNotesMap = {};
    finalFavRows.forEach(r => {
      const key = favKey(r.word_id, r.def_index);
      // cột favorites.folder_id cũ (đã lưu trước khi có bảng favorite_folder_links) vẫn được
      // đọc để không mất dữ liệu cũ — gộp chung vào mảng cùng các liên kết mới bên dưới.
      if (r.folder_id) favFolderMap[key] = [r.folder_id];
      if (r.note_def || r.note_example) favNotesMap[key] = { noteDef: r.note_def || '', noteExample: r.note_example || '' };
    });
    // srs_progress giờ là bảng RIÊNG, tách khỏi favorites — favSrsMap dựng thẳng từ đây, không
    // còn phụ thuộc gì vào việc nghĩa đó có được yêu thích hay không.
    favSrsMap = {};
    (Array.isArray(finalSrsProgress) ? finalSrsProgress : []).forEach(r => {
      const key = favKey(r.word_id, r.def_index);
      favSrsMap[key] = { box: r.box || 1, due: r.due ? new Date(r.due).getTime() : Date.now(), interval: r.interval || null, ignored: !!r.ignored };
    });
    (Array.isArray(finalFolderLinks) ? finalFolderLinks : []).forEach(r => {
      const key = favKey(r.word_id, r.def_index);
      const arr = favFolderMap[key] = favFolderMap[key] || [];
      if (!arr.includes(r.folder_id)) arr.push(r.folder_id);
    });
    recentSearches = (Array.isArray(finalHist) ? finalHist : []).map(r => ({ id: r.word_id, ts: r.ts, pinned: r.pinned, count: r.count || 1 }));
    pinnedDefsMap = {};
    pinnedExMap = {};
    (Array.isArray(finalPins) ? finalPins : []).forEach(r => {
      const ts = r.created_at ? new Date(r.created_at).getTime() : Date.now();
      if (r.item_type === 'definition') pinnedDefsMap[pinDefKey(r.word_id, r.def_index)] = ts;
      else if (r.item_type === 'example') pinnedExMap[pinExKey(r.word_id, r.def_index, r.ex_index)] = ts;
    });

    // Lịch sử tự đánh giá mức nhớ (srsReviewLog, phục vụ thống kê Learning Bar) — KHÔNG gộp/đẩy
    // dữ liệu ẩn danh trước đăng nhập lên đây (log này không có khóa duy nhất để chống trùng, gộp
    // ẩu dễ đếm gấp đôi). Đơn giản hơn: coi dữ liệu trên tài khoản là nguồn chính, TẢI VỀ THAY THẾ
    // luôn dữ liệu local — dữ liệu ẩn danh trước đó bị bỏ qua cho riêng thống kê này (không ảnh
    // hưởng gì tới srs_progress/favorites thật, chỉ mất phần thống kê "hay quên" của phiên ẩn
    // danh trước đó).
    try {
      const remoteLog = await sbGetAuth('srs_review_log?select=word_id,def_index,level,created_at&user_id=eq.' + uid
        + '&created_at=gte.' + new Date(Date.now() - 30 * 86400000).toISOString());
      srsReviewLog = (Array.isArray(remoteLog) ? remoteLog : []).map(r => ({
        wordId: r.word_id, defIndex: r.def_index, level: r.level, ts: new Date(r.created_at).getTime()
      }));
      saveSrsReviewLog();
    } catch (e) { /* không chặn luồng đăng nhập nếu lỗi, thống kê chỉ mang tính tham khảo */ }

    try { await syncSavedVideosOnLogin(); } catch (e) { /* video đã lưu là phần thêm — lỗi thì bỏ qua */ }
    try { await syncSentenceCardsOnLogin(); } catch (e) { /* thẻ câu từ video là phần thêm — lỗi thì bỏ qua, không chặn đăng nhập */ }

    initLearningBar();
  } catch (e) {
    showToast('⚠️ Không thể đồng bộ dữ liệu tài khoản');
  }
}

function loadLocalFavoritesAndHistory() {
  favorites = migrateOldFavorites(JSON.parse(localStorage.getItem('thai_favs') || '[]'));
  favoriteFolders = JSON.parse(localStorage.getItem('thai_fav_folders') || '[]');
  favFolderMap = normalizeFolderMap(JSON.parse(localStorage.getItem('thai_fav_folder_map') || '{}'));
  favNotesMap = JSON.parse(localStorage.getItem('thai_fav_notes') || '{}');
  favSrsMap = JSON.parse(localStorage.getItem('thai_fav_srs') || '{}');
  sentenceCards = loadLocalSentenceCards();
  savedVideos = loadLocalSavedVideos();
  // Ghim (pinnedDefsMap/pinnedExMap): giờ đã hỗ trợ ẩn danh (localStorage), giống favorites —
  // xem onDefPinClick/onExamplePinClick. Khi đăng nhập, dữ liệu ẩn danh này sẽ được đẩy lên tài
  // khoản (xem syncUserDataOnLogin), không bị mất khi đăng nhập sau.
  pinnedDefsMap = JSON.parse(localStorage.getItem('thai_pinned_defs') || '{}');
  pinnedExMap = JSON.parse(localStorage.getItem('thai_pinned_ex') || '{}');
  const raw = JSON.parse(localStorage.getItem('thai_recent') || '[]');
  if (raw.length && typeof raw[0] === 'number') {
    const now = Date.now();
    recentSearches = raw.map((id, i) => ({ id, ts: now - i * 1000, pinned: false, count: 1 }));
  } else {
    recentSearches = raw;
  }
}

async function initAuthState() {
  const handledViaHash = await handleAuthHashLogin();
  if (!handledViaHash && session) {
    const valid = await ensureValidSession();
    if (valid) {
      await syncUserDataOnLogin();
    } else {
      loadLocalFavoritesAndHistory();
    }
  }
  updateAuthUI();
  renderFavorites();
  renderRecent();
  updateStats();
}

function updateAuthUI() {
  const label = document.getElementById('accountNavLabel');
  const userBlock = document.getElementById('accountDropdownUser');
  const nameEl = document.getElementById('accountDropdownName');
  const emailEl = document.getElementById('accountDropdownEmail');
  const profileLabel = document.getElementById('accountItemProfileLabel');
  const logoutBtn = document.getElementById('accountLogoutBtn');
  const divider = document.getElementById('accountDropdownDivider');
  const btn = document.getElementById('accountNavBtn');
  if (!btn) return;
  if (isLoggedIn()) {
    const email = session.user.email || '';
    const name = session.user.display_name || '';
    // Đã đăng nhập: "คุณ" + tên hiển thị (chưa đặt tên thì dùng email) — thay cho icon/avatar cũ.
    // Tách riêng 2 <span> theo font: "คุณ" luôn dùng font Thái TorsilpThamnganMangThoe, còn TÊN dùng
    // riêng Bai Jamjuree — không gộp chung 1 font-family (Torsilp, fallback Bai Jamjuree) cho cả cụm
    // như trước, vì TorsilpThamnganMangThoe có chữ cái Latin THƯỜNG (a, e, o...) nhưng THIẾU các ký tự
    // có dấu tiếng Việt → trình duyệt lấy lẫn lộn: chữ cái từ font Thái, dấu từ font dự phòng, dấu bị
    // lệch/vỡ. Tên tiếng Việt vì vậy PHẢI ép hẳn sang 1 font duy nhất (Bai Jamjuree, vốn hỗ trợ đủ dấu
    // tiếng Việt) thay vì để trình duyệt tự chọn theo từng ký tự. Dùng textContent (không innerHTML) vì
    // tên là dữ liệu do người dùng nhập.
    if (label) {
      label.textContent = '';
      const thaiSpan = document.createElement('span');
      thaiSpan.className = 'account-label-thai';
      thaiSpan.textContent = 'คุณ';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'account-label-name';
      nameSpan.textContent = ' ' + (name || email);
      label.appendChild(thaiSpan);
      label.appendChild(nameSpan);
    }
    if (userBlock) userBlock.style.display = '';
    if (nameEl) nameEl.textContent = name || email;
    if (emailEl) { emailEl.textContent = name ? email : ''; emailEl.style.display = name ? '' : 'none'; }
    if (profileLabel) profileLabel.textContent = 'Hồ sơ';
    if (logoutBtn) logoutBtn.style.display = '';
    if (divider) divider.style.display = '';
    btn.title = name || email;
  } else {
    // Chưa đăng nhập: chữ mời "คุณชื่ออะไร" (bạn tên là gì?) thay cho icon người dùng — thuần chữ Thái
    // (không có ký tự Latin nào) nên không gặp vấn đề lẫn font như nhánh đã đăng nhập ở trên, nhưng vẫn
    // bọc trong <span class="account-label-thai"> cho đồng bộ cấu trúc.
    if (label) {
      label.textContent = '';
      const thaiSpan = document.createElement('span');
      thaiSpan.className = 'account-label-thai';
      thaiSpan.textContent = 'คุณชื่ออะไร';
      label.appendChild(thaiSpan);
    }
    if (userBlock) userBlock.style.display = 'none';
    if (profileLabel) profileLabel.textContent = 'Đăng nhập / Đăng ký';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (divider) divider.style.display = 'none';
    btn.title = 'Đăng nhập / Đăng ký';
  }
  applyHeroTagline();
}

function onAccountBtnClick() {
  toggleAccountDropdown();
}

function onProfileMenuClick() {
  closeAccountDropdown();
  if (isLoggedIn()) openProfileModal();
  else openAuthModal('login');
}

// Class "account-open" trên thanh trên cùng (#topInfoBar) chỉ để nâng z-index của cả thanh khi panel Tài khoản
// toàn màn hình đang mở trên mobile (panel nằm BÊN TRONG thanh này nên bị z-index của thanh giới hạn) — xem
// .top-info-bar.account-open trong style.css.
function syncAccountOpenClass() {
  const dd = document.getElementById('accountDropdown');
  const bar = document.getElementById('topInfoBar');
  if (bar && dd) bar.classList.toggle('account-open', dd.classList.contains('show'));
}

function toggleAccountDropdown() {
  const dd = document.getElementById('accountDropdown');
  if (dd) dd.classList.toggle('show');
  syncAccountOpenClass();
}

function closeAccountDropdown() {
  const dd = document.getElementById('accountDropdown');
  if (dd) dd.classList.remove('show');
  closeInfoSubmenu();
  syncAccountOpenClass();
}

document.addEventListener('click', function(e) {
  const wrap = document.getElementById('accountBtnWrap');
  // MỌI tagline (.hero-tagline-clickable, ở trang chủ lẫn Sổ tay) cũng mở được menu Tài khoản —
  // loại trừ khỏi điều kiện "bấm ra ngoài" bằng closest(), không thì menu vừa mở đã bị đóng ngay
  // bởi chính sự kiện click này.
  const insideWrap = wrap && wrap.contains(e.target);
  const insideHero = e.target.closest && e.target.closest('.hero-tagline-clickable');
  if (!insideWrap && !insideHero) closeAccountDropdown();
});

// ── AUTH MODAL (Đăng nhập / Đăng ký) ───────────────────
let authMode = 'login'; // 'login' | 'register'

// Hiện/ẩn mật khẩu bằng icon con mắt (dùng chung cho các ô mật khẩu trong modal đăng nhập/đăng ký)
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showIcon = btn.querySelector('.eye-icon-show');
  const hideIcon = btn.querySelector('.eye-icon-hide');
  const nowHidden = input.type === 'password';
  input.type = nowHidden ? 'text' : 'password';
  if (showIcon) showIcon.style.display = nowHidden ? 'none' : '';
  if (hideIcon) hideIcon.style.display = nowHidden ? '' : 'none';
}

function openAuthModal(mode) {
  authMode = mode || 'login';
  switchAuthTab(authMode);
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authPasswordConfirm').value = '';
  document.getElementById('authTermsCheckbox').checked = false;
  document.getElementById('authRememberCheckbox').checked = true;
  document.getElementById('authError').textContent = '';
  document.querySelectorAll('#authModal .password-field-wrap input').forEach(inp => { inp.type = 'password'; });
  document.querySelectorAll('#authModal .password-toggle-btn').forEach(btn => {
    btn.querySelector('.eye-icon-show').style.display = '';
    btn.querySelector('.eye-icon-hide').style.display = 'none';
  });
  document.getElementById('authModal').classList.add('show');
  setTimeout(() => document.getElementById('authEmail').focus(), 100);
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('show');
}

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('authTabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('authTabRegister').classList.toggle('active', mode === 'register');
  document.getElementById('authModalTitle').textContent = mode === 'login' ? 'Đăng nhập tài khoản' : 'Tạo tài khoản mới';
  document.getElementById('authModalSub').textContent = mode === 'login'
    ? 'Đăng nhập để lưu yêu thích và lịch sử tra từ theo tài khoản'
    : 'Tạo tài khoản để lưu yêu thích và lịch sử tra từ của bạn';
  document.getElementById('authPasswordConfirmWrap').style.display = mode === 'register' ? '' : 'none';
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Đăng nhập' : 'Đăng ký';
  document.getElementById('authPassword').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  document.getElementById('authGoogleBtnText').textContent = mode === 'login' ? 'Đăng nhập với Google' : 'Đăng ký với Google';
  document.getElementById('authTermsRow').style.display = mode === 'register' ? 'flex' : 'none';
  document.getElementById('authOptionsRow').style.display = mode === 'login' ? 'flex' : 'none';
  document.getElementById('authError').textContent = '';
}

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errorEl = document.getElementById('authError');
  const btn = document.getElementById('authSubmitBtn');
  errorEl.textContent = '';

  if (!email || !password) { errorEl.textContent = 'Vui lòng nhập đầy đủ email và mật khẩu'; return; }
  if (password.length < 6) { errorEl.textContent = 'Mật khẩu cần ít nhất 6 ký tự'; return; }
  if (authMode === 'register') {
    const confirm = document.getElementById('authPasswordConfirm').value;
    if (password !== confirm) { errorEl.textContent = 'Mật khẩu nhập lại không khớp'; return; }
    if (!document.getElementById('authTermsCheckbox').checked) {
      errorEl.textContent = 'Vui lòng đồng ý với điều khoản sử dụng trước khi đăng ký';
      return;
    }
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang xử lý...';
  try {
    if (authMode === 'login') {
      const remember = document.getElementById('authRememberCheckbox').checked;
      const data = await signInUser(email, password);
      saveSession(data, remember);
      closeAuthModal();
      activeFavFolder = 'all';
      await syncUserDataOnLogin();
      updateAuthUI();
      renderFavorites();
      renderRecent();
      updateStats();
      loadFontChallenge();
      showToast('✅ Đăng nhập thành công!');
      const isAdmin = await checkIsAdmin();
      if (pendingAdminEntry) {
        pendingAdminEntry = false;
        if (isAdmin) showPage('admin');
        else showToast('⚠️ Tài khoản này không có quyền quản trị');
      }
    } else {
      const data = await signUpUser(email, password);
      if (data.access_token) {
        // Dự án đã tắt xác nhận email: đăng nhập luôn sau khi đăng ký
        saveSession(data, true);
        closeAuthModal();
        activeFavFolder = 'all';
        await syncUserDataOnLogin();
        updateAuthUI();
        renderFavorites();
        renderRecent();
        updateStats();
        loadFontChallenge();
        showToast('✅ Tạo tài khoản thành công!');
        const isAdmin = await checkIsAdmin();
        if (pendingAdminEntry) {
          pendingAdminEntry = false;
          if (isAdmin) showPage('admin');
          else showToast('⚠️ Tài khoản này không có quyền quản trị, liên hệ admin hiện tại để được cấp quyền');
        }
      } else {
        closeAuthModal();
        showToast('📧 Kiểm tra email để xác nhận tài khoản trước khi đăng nhập');
      }
    }
  } catch (e) {
    errorEl.textContent = e.message || 'Có lỗi xảy ra, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function doSignOut() {
  try {
    await fetch(SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: await authHeaders() });
  } catch (e) {}
  clearSession();
  activeFavFolder = 'all';
  loadLocalFavoritesAndHistory();
  updateAuthUI();
  renderFavorites();
  renderRecent();
  updateStats();
  const adminBtn = document.getElementById('adminNavBtn');
  if (adminBtn) adminBtn.style.display = 'none';
  showPage('home');
  showToast('Đã đăng xuất');
}

// ── QUÊN MẬT KHẨU ───────────────────────────────────────
function openForgotPasswordModal(e) {
  if (e) e.preventDefault();
  closeAuthModal();
  document.getElementById('forgotEmail').value = document.getElementById('authEmail').value || '';
  document.getElementById('forgotError').textContent = '';
  document.getElementById('forgotPasswordModal').classList.add('show');
  setTimeout(() => document.getElementById('forgotEmail').focus(), 100);
}

function closeForgotPasswordModal() {
  document.getElementById('forgotPasswordModal').classList.remove('show');
}

async function submitForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const errorEl = document.getElementById('forgotError');
  const btn = document.getElementById('forgotSubmitBtn');
  errorEl.textContent = '';
  if (!email) { errorEl.textContent = 'Vui lòng nhập email'; return; }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang gửi...';
  try {
    const redirectTo = location.origin + '/';
    const r = await fetch(SUPABASE_URL + '/auth/v1/recover?redirect_to=' + encodeURIComponent(redirectTo), {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.msg || data.error_description || 'Không thể gửi email, thử lại sau');
    }
    closeForgotPasswordModal();
    showToast('📧 Đã gửi email đặt lại mật khẩu, vui lòng kiểm tra hộp thư');
  } catch (e) {
    errorEl.textContent = e.message || 'Có lỗi xảy ra, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── ĐẶT MẬT KHẨU MỚI (từ liên kết trong email quên mật khẩu) ──
function openResetPasswordModal() {
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('resetNewPasswordConfirm').value = '';
  document.getElementById('resetError').textContent = '';
  document.getElementById('resetPasswordModal').classList.add('show');
}

function closeResetPasswordModal() {
  document.getElementById('resetPasswordModal').classList.remove('show');
}

async function submitResetPassword() {
  const pw = document.getElementById('resetNewPassword').value;
  const pwConfirm = document.getElementById('resetNewPasswordConfirm').value;
  const errorEl = document.getElementById('resetError');
  const btn = document.getElementById('resetSubmitBtn');
  errorEl.textContent = '';
  if (!pw || pw.length < 6) { errorEl.textContent = 'Mật khẩu cần ít nhất 6 ký tự'; return; }
  if (pw !== pwConfirm) { errorEl.textContent = 'Mật khẩu nhập lại không khớp'; return; }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang lưu...';
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify({ password: pw })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.msg || data.error_description || 'Cập nhật thất bại');
    closeResetPasswordModal();
    showToast('✅ Đã đặt mật khẩu mới thành công');
  } catch (e) {
    errorEl.textContent = e.message || 'Có lỗi xảy ra, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── ĐIỀU KHOẢN SỬ DỤNG ──────────────────────────────────
function openTermsModal(e) {
  if (e) e.preventDefault();
  document.getElementById('termsModal').classList.add('show');
}

function closeTermsModal() {
  document.getElementById('termsModal').classList.remove('show');
}

// ── HỒ SƠ (đổi tên hiển thị / đổi mật khẩu) ────────────
function openProfileModal() {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  document.getElementById('profileEmail').value = session.user.email || '';
  document.getElementById('profileDisplayName').value = session.user.display_name || '';
  document.getElementById('profileJoinDate').textContent = session.user.created_at
    ? new Date(session.user.created_at).toLocaleDateString('vi-VN')
    : '—';
  document.getElementById('profileNewPassword').value = '';
  document.getElementById('profileNewPasswordConfirm').value = '';
  document.getElementById('profileError').textContent = '';
  document.getElementById('profileModal').classList.add('show');
  loadMyContributions();
}

// Tải danh sách góp ý & đề xuất từ mới mà chính người dùng này đã gửi (hiển thị trong Hồ sơ)
async function loadMyContributions() {
  const uid = session.user.id;
  const fbList = document.getElementById('profileFeedbackList');
  const sgList = document.getElementById('profileSuggestionList');
  fbList.innerHTML = '<div class="profile-contrib-empty">Đang tải...</div>';
  sgList.innerHTML = '<div class="profile-contrib-empty">Đang tải...</div>';
  try {
    const rows = await sbGetAuth('word_feedback?select=*&user_id=eq.' + uid + '&order=id.desc');
    const myFeedback = Array.isArray(rows) ? rows : [];
    document.getElementById('profileFeedbackCount').textContent = myFeedback.length ? '(' + myFeedback.length + ')' : '';
    fbList.innerHTML = myFeedback.length
      ? myFeedback.map(f => {
          const word = allWords.find(w => w.id === f.word_id);
          return `<div class="profile-contrib-item">
            <div class="profile-contrib-text">${word ? '📖 <b>' + escapeHtml(word.thai) + '</b> — ' : ''}${escapeHtml(f.feedback_text || '')}</div>
            <div class="profile-contrib-meta">${f.created_at ? new Date(f.created_at).toLocaleDateString('vi-VN') : ''}</div>
          </div>`;
        }).join('')
      : '<div class="profile-contrib-empty">Bạn chưa gửi góp ý nào</div>';
  } catch (e) {
    fbList.innerHTML = '<div class="profile-contrib-empty">Không tải được dữ liệu</div>';
  }
  try {
    const rows = await sbGetAuth('word_suggestions?select=*&user_id=eq.' + uid + '&order=id.desc');
    const mySuggestions = Array.isArray(rows) ? rows : [];
    document.getElementById('profileSuggestionCount').textContent = mySuggestions.length ? '(' + mySuggestions.length + ')' : '';
    sgList.innerHTML = mySuggestions.length
      ? mySuggestions.map(s => {
          const status = s.status || 'pending';
          const badge = status === 'approved'
            ? '<span class="suggestion-status-badge approved">✅ Đã thêm</span>'
            : status === 'rejected'
              ? '<span class="suggestion-status-badge rejected">❌ Từ chối</span>'
              : '<span class="suggestion-status-badge pending">⏳ Chờ duyệt</span>';
          return `<div class="profile-contrib-item">
            <div class="profile-contrib-text">➕ <b class="thai-font">${escapeHtml(s.thai || '')}</b>${s.meaning_suggestion ? ' — ' + escapeHtml(s.meaning_suggestion) : ''} ${badge}</div>
            <div class="profile-contrib-meta">${s.created_at ? new Date(s.created_at).toLocaleDateString('vi-VN') : ''}</div>
          </div>`;
        }).join('')
      : '<div class="profile-contrib-empty">Bạn chưa đề xuất từ nào</div>';
  } catch (e) {
    sgList.innerHTML = '<div class="profile-contrib-empty">Không tải được dữ liệu</div>';
  }
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('show');
}

async function submitProfile() {
  const errorEl = document.getElementById('profileError');
  const btn = document.getElementById('profileSubmitBtn');
  errorEl.textContent = '';

  const displayName = document.getElementById('profileDisplayName').value.trim();
  const newPassword = document.getElementById('profileNewPassword').value;
  const newPasswordConfirm = document.getElementById('profileNewPasswordConfirm').value;

  if (newPassword || newPasswordConfirm) {
    if (newPassword.length < 6) { errorEl.textContent = 'Mật khẩu mới cần ít nhất 6 ký tự'; return; }
    if (newPassword !== newPasswordConfirm) { errorEl.textContent = 'Mật khẩu nhập lại không khớp'; return; }
  }

  const payload = { data: { display_name: displayName } };
  if (newPassword) payload.password = newPassword;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang lưu...';
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.msg || data.error_description || data.error || 'Cập nhật thất bại');
    session.user.display_name = (data.user_metadata && data.user_metadata.display_name) || displayName;
    session.user.email = data.email || session.user.email;
    persistCurrentSession();
    updateAuthUI();
    syncWlistOwnerDisplayName(session.user.display_name);
    closeProfileModal();
    showToast('✅ Đã cập nhật hồ sơ');
  } catch (e) {
    errorEl.textContent = e.message || 'Có lỗi xảy ra, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── STATE ─────────────────────────────────────────────
var allWords = [];
// Resolve khi loadWords() đã tải xong dữ liệu "mỏng" (allWords có nội dung) — dùng để trang
// Admin đợi chắc chắn có dữ liệu trước khi vẽ danh sách, tránh render với allWords còn rỗng
// nếu người dùng vào trang Admin nhanh hơn tốc độ tải ban đầu (xem showPage('admin') ở dưới).
let wordsLoadedResolve;
const wordsLoadedPromise = new Promise(resolve => { wordsLoadedResolve = resolve; });
let filteredWords = [];
let currentWord = null;
let acIndex = -1;
let acResults = [];

// Yêu thích giờ lưu theo TỪNG NGHĨA (định nghĩa) của 1 từ, không phải theo cả từ.
// Mỗi mục yêu thích được định danh bằng "favKey" = "wordId:defIndex" (defIndex bắt đầu từ 0).
function favKey(wordId, defIndex) { return wordId + ':' + (defIndex || 0); }
function favKeyParts(key) { const [w, d] = String(key).split(':'); return { wordId: Number(w), defIndex: Number(d) }; }
function isFavDef(wordId, defIndex) { return favorites.includes(favKey(wordId, defIndex)); }

// Tự động chuyển dữ liệu cũ (mảng word_id đơn giản, từ trước khi có tính năng theo-từng-nghĩa)
// sang định dạng favKey mới, mặc định gán vào nghĩa đầu tiên (defIndex 0)
function migrateOldFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length && typeof raw[0] === 'number') return raw.map(id => favKey(id, 0));
  return raw;
}

// favFolderMap giờ lưu MẢNG id thư mục cho mỗi nghĩa (1 nghĩa có thể nằm trong NHIỀU thư mục
// cùng lúc — xem addDefToFolder/removeDefFromFolder), thay vì chỉ 1 id duy nhất như trước. Hàm
// này chuyển dữ liệu cũ (giá trị là 1 id đơn, kiểu number/string) sang mảng 1 phần tử, để dữ
// liệu đã lưu trước đây (localStorage của khách, hoặc cột favorites.folder_id cũ trên Supabase)
// vẫn hiển thị đúng mà không mất gì.
function normalizeFolderMap(raw) {
  const out = {};
  Object.keys(raw || {}).forEach(k => {
    const v = raw[k];
    if (Array.isArray(v)) { if (v.length) out[k] = v.slice(); }
    else if (v !== null && v !== undefined && v !== '') out[k] = [v];
  });
  return out;
}

var favorites = migrateOldFavorites(JSON.parse(localStorage.getItem('thai_favs') || '[]'));


// Thư mục chủ đề cho mục Yêu thích: favoriteFolders = [{id, name}]
// favFolderMap / favNotesMap giờ khóa theo favKey ("wordId:defIndex") thay vì theo word_id
let favoriteFolders = JSON.parse(localStorage.getItem('thai_fav_folders') || '[]');
var favFolderMap = normalizeFolderMap(JSON.parse(localStorage.getItem('thai_fav_folder_map') || '{}'));
// favFolderRecentMap: { folderId: lastUsedAtMs } — chỉ lưu local (không đồng bộ server), dùng để
// sắp xếp thư mục "vừa dùng gần đây lên đầu" trong popup chọn thư mục (xem renderFavFolderPickerList).
var favFolderRecentMap = JSON.parse(localStorage.getItem('thai_fav_folder_recent') || '{}');
function touchFolderRecent(folderId) {
  if (folderId === null || folderId === undefined) return;
  favFolderRecentMap[folderId] = Date.now();
  localStorage.setItem('thai_fav_folder_recent', JSON.stringify(favFolderRecentMap));
}
// favNotesMap: { favKey: { noteDef: '', noteExample: '' } } — ghi chú cá nhân cho từng nghĩa đã lưu
var favNotesMap = JSON.parse(localStorage.getItem('thai_fav_notes') || '{}');
// favSrsMap: { favKey: { box: 1-5, due: epoch ms } } — tiến độ ôn tập kiểu Leitner cho từng nghĩa đã lưu
let favSrsMap = JSON.parse(localStorage.getItem('thai_fav_srs') || '{}');
// Thẻ câu từ video (xem khối "THẺ CÂU TỪ VIDEO" phía dưới) — khai báo SỚM ở đây vì loadLocalFavoritesAndHistory() gán biến này lúc khởi động.
let sentenceCards = [];
// Video đã lưu vào Sổ tay (xem khối "VIDEO ĐÃ LƯU") — cũng khai báo sớm vì loadLocalFavoritesAndHistory() gán lúc khởi động.
let savedVideos = [];
// srsReviewLog: [{ wordId, defIndex, level, ts }, ...] — lịch sử MỖI LẦN bấm tự đánh giá mức nhớ
// (xem onGuessMemoryLevel), dùng để tính thống kê cho "Learning Bar" phía trên ô tìm kiếm (vd "từ
// hay quên nhất tuần này"). Chỉ giữ 30 ngày gần nhất (đủ dư so với khung "7 ngày" đang dùng để
// tính, phòng lệch múi giờ) để không phình localStorage vô hạn theo thời gian.
let srsReviewLog = JSON.parse(localStorage.getItem('thai_srs_log') || '[]');
(function pruneSrsReviewLog() {
  const cutoff = Date.now() - 30 * 86400000;
  srsReviewLog = srsReviewLog.filter(e => e && e.ts >= cutoff);
})();
function saveSrsReviewLog() {
  localStorage.setItem('thai_srs_log', JSON.stringify(srsReviewLog));
}
let activeFavFolder = 'all'; // 'all' | 'none' | id thư mục
let favPickerContext = null; // { mode, wordId, defIndex, btnEl } — ngữ cảnh khi đang mở popup chọn thư mục

// ── GHIM ĐỊNH NGHĨA / VÍ DỤ ─────────────────────────────────────────────────
// Khác với Yêu thích (♥ lưu vào trang riêng, có thư mục): Ghim (📌) chỉ đẩy 1 định nghĩa/ví dụ
// lên ĐẦU danh sách NGAY TẠI CHỖ đang xem, không lưu vào đâu khác. CẦN đăng nhập (đồng bộ theo
// tài khoản qua bảng "pinned_items" trên Supabase) — không có bản localStorage cho khách chưa
// đăng nhập, vì tính năng này chủ yếu phục vụ nhu cầu cá nhân hoá lâu dài của 1 tài khoản.
// pinnedDefsMap: { 'wordId-defIndex': createdAtMs } — ghim cả 1 định nghĩa
// pinnedExMap:   { 'wordId-defIndex-exIndex': createdAtMs } — ghim 1 ví dụ cụ thể trong định nghĩa
// createdAtMs dùng để sắp xếp: ghim gần đây nhất nổi lên trên cùng trong nhóm đã ghim.
var pinnedDefsMap = {};
var pinnedExMap = {};
function pinDefKey(wordId, defIndex) { return wordId + '-' + defIndex; }
function pinExKey(wordId, defIndex, exIndex) { return wordId + '-' + defIndex + '-' + exIndex; }
function isDefPinned(wordId, defIndex) { return !!pinnedDefsMap[pinDefKey(wordId, defIndex)]; }
function isExamplePinned(wordId, defIndex, exIndex) { return !!pinnedExMap[pinExKey(wordId, defIndex, exIndex)]; }

// Render lại phần định nghĩa bên trong 1 container cụ thể, nhưng GIỮ NGUYÊN accordion nào đang
// mở (theo data-def-index, ổn định dù ghim làm đổi thứ tự hiển thị) và phần "Xem thêm ví dụ"
// nào đang mở rộng — trước đây gọi thẳng buildDefinitionsHTML rồi thay innerHTML làm mọi
// accordion tự đóng lại (vì HTML mới luôn không có class "open"), khiến ví dụ đang xem BỊ ẨN
// ngay sau khi bấm ghim — đây chính là bug đã sửa.
function refreshDefsContainer(containerEl, word, savedIndices) {
  if (!containerEl) return;
  const openDefIndices = new Set();
  const expandedExtraDefIndices = new Set();
  const noteOpenState = {};
  containerEl.querySelectorAll('.def-block').forEach(b => {
    const di = b.getAttribute('data-def-index');
    if (b.classList.contains('open')) openDefIndices.add(di);
    const extraEl = b.querySelector('.def-ex-extra');
    if (extraEl && extraEl.style.display !== 'none') expandedExtraDefIndices.add(di);
    const noteBox = b.querySelector('.def-note-box');
    if (noteBox) noteOpenState[di] = !noteBox.classList.contains('collapsed');
  });
  containerEl.innerHTML = buildDefinitionsHTML(word, savedIndices);
  segmentizeDefsIfEnabled(containerEl);
  containerEl.querySelectorAll('.def-block').forEach(b => {
    const di = b.getAttribute('data-def-index');
    if (openDefIndices.has(di)) {
      b.classList.add('open');
      const body = b.querySelector('.def-body');
      if (body) body.classList.add('fade-in'); // hiện ngay, không chạy lại hiệu ứng mờ dần vì đã mở sẵn từ trước
      const guessBtn = b.querySelector('.def-guess-btn');
      setGuessBtnState(guessBtn, true);
    }
    if (expandedExtraDefIndices.has(di)) {
      const extraEl = b.querySelector('.def-ex-extra');
      const moreBtn = b.querySelector('.def-ex-more-btn');
      if (extraEl) extraEl.style.display = '';
      if (moreBtn) {
        moreBtn.classList.add('open');
        const label = moreBtn.querySelector('.def-ex-more-btn-label');
        if (label) label.textContent = 'Thu gọn ví dụ';
      }
    }
    if (di in noteOpenState) {
      const noteBox = b.querySelector('.def-note-box');
      const noteAddBtn = b.querySelector('.def-note-add-btn');
      if (noteBox) noteBox.classList.toggle('collapsed', !noteOpenState[di]);
      if (noteAddBtn && noteOpenState[di]) noteAddBtn.style.display = 'none';
    }
  });
}

// Render lại đúng những nơi đang hiển thị từ này sau khi ghim/bỏ ghim đổi thứ tự — chỉ đụng vào
// đúng phần định nghĩa (không gọi lại showResult/onDefWordClick nguyên khối, tránh tác dụng phụ
// như đếm lượt xem trùng lặp hoặc reset trạng thái nút phát âm).
function afterPinChange(wordId) {
  const word = allWords.find(w => w.id === wordId);
  if (!word) return;
  if (currentWord && currentWord.id === wordId && document.getElementById('resultSection').classList.contains('show')) {
    refreshDefsContainer(document.getElementById('rDefinitions'), word);
  }
  if (wordPopupWordId === wordId && document.getElementById('wordPopupOverlay').classList.contains('show')) {
    refreshDefsContainer(document.getElementById('wordPopupDefs'), word);
  }
  const favExpandBody = document.getElementById('fav-expand-' + wordId);
  if (favExpandBody && favExpandBody.classList.contains('show')) {
    const savedIndices = favorites.filter(k => k.startsWith(wordId + ':')).map(k => favKeyParts(k).defIndex);
    refreshDefsContainer(favExpandBody.querySelector('.fav-expand-defs'), word, savedIndices);
  }
}

// Cập nhật lạc quan (optimistic): đổi trạng thái + render lại ngay, rồi mới lưu (Supabase nếu
// đã đăng nhập, localStorage nếu ẩn danh — xem loadLocalFavoritesAndHistory/syncUserDataOnLogin
// để biết cách dữ liệu ẩn danh được đẩy lên tài khoản khi đăng nhập sau); nếu lưu lỗi thì hoàn
// tác lại đúng trạng thái cũ và render lại lần nữa.
async function onDefPinClick(wordId, defIndex) {
  const key = pinDefKey(wordId, defIndex);
  const wasPinned = !!pinnedDefsMap[key];
  if (wasPinned) delete pinnedDefsMap[key]; else pinnedDefsMap[key] = Date.now();
  afterPinChange(wordId);
  if (!isLoggedIn()) {
    localStorage.setItem('thai_pinned_defs', JSON.stringify(pinnedDefsMap));
    return;
  }
  try {
    if (wasPinned) {
      await sbDeleteAuth('pinned_items?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&item_type=eq.definition&def_index=eq.' + defIndex);
    } else {
      await sbPostAuth('pinned_items', { user_id: session.user.id, word_id: wordId, item_type: 'definition', def_index: defIndex, ex_index: -1 });
    }
  } catch (e) {
    if (wasPinned) pinnedDefsMap[key] = Date.now(); else delete pinnedDefsMap[key];
    afterPinChange(wordId);
    showToast('⚠️ Không thể cập nhật ghim, thử lại sau');
  }
}

async function onExamplePinClick(wordId, defIndex, exIndex) {
  const key = pinExKey(wordId, defIndex, exIndex);
  const wasPinned = !!pinnedExMap[key];
  if (wasPinned) delete pinnedExMap[key]; else pinnedExMap[key] = Date.now();
  afterPinChange(wordId);
  if (!isLoggedIn()) {
    localStorage.setItem('thai_pinned_ex', JSON.stringify(pinnedExMap));
    return;
  }
  try {
    if (wasPinned) {
      await sbDeleteAuth('pinned_items?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&item_type=eq.example&def_index=eq.' + defIndex + '&ex_index=eq.' + exIndex);
    } else {
      await sbPostAuth('pinned_items', { user_id: session.user.id, word_id: wordId, item_type: 'example', def_index: defIndex, ex_index: exIndex });
    }
  } catch (e) {
    if (wasPinned) pinnedExMap[key] = Date.now(); else delete pinnedExMap[key];
    afterPinChange(wordId);
    showToast('⚠️ Không thể cập nhật ghim, thử lại sau');
  }
}

// Lịch sử tra từ: mỗi bản ghi { id, ts, pinned }
// Tự động migrate dữ liệu cũ (mảng số id đơn giản) sang định dạng mới
let recentSearches = (function() {
  const raw = JSON.parse(localStorage.getItem('thai_recent') || '[]');
  if (raw.length && typeof raw[0] === 'number') {
    // dữ liệu cũ: mảng id, mới nhất ở đầu — gán timestamp giảm dần để giữ đúng thứ tự
    const now = Date.now();
    return raw.map((id, i) => ({ id, ts: now - i * 1000, pinned: false }));
  }
  return raw;
})();

// ── SEO: URL riêng cho từng từ (/tu/<id>-<slug>) ───────
// Bỏ dấu tiếng Việt/Thái, chỉ giữ chữ cái La-tinh + số, nối bằng dấu gạch ngang.
// Dùng phonetic (phiên âm La-tinh có sẵn) làm nguồn chính vì thân thiện SEO hơn chữ Thái gốc.
function slugify(str) {
  if (!str) return '';
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function wordSlug(word) {
  const base = slugify(word.phonetic) || slugify(word.thai) || 'tu';
  return word.id + '-' + base;
}
function wordPath(word) { return '/tu/' + wordSlug(word); }
function wordUrl(word) { return window.location.origin + wordPath(word); }

// ── Chia sẻ từ ra mạng xã hội ──────────────────────────
// Facebook: dùng link chia sẻ chuẩn của Facebook, không cần đăng ký app/API key.

// Mở/đóng popup nhỏ chứa icon Facebook/Zalo khi bấm icon chia sẻ (kiểu YouTube)
// Menu "..." gom icon bàn phím/ghi âm/chụp ảnh trên thanh search header (chỉ hiện dạng dropdown ở màn hình nhỏ)
function toggleHeaderMoreMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('headerMoreMenu');
  const inner = document.querySelector('.header-search-inner');
  if (!menu) return;
  const willShow = !menu.classList.contains('show');
  menu.classList.toggle('show', willShow);
  if (inner) inner.classList.toggle('menu-open', willShow);
}
function closeHeaderMoreMenu() {
  const menu = document.getElementById('headerMoreMenu');
  const inner = document.querySelector('.header-search-inner');
  if (menu) menu.classList.remove('show');
  if (inner) inner.classList.remove('menu-open');
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.header-search-right-icons')) closeHeaderMoreMenu();
});

// Menu "..." gom icon bàn phím/ghi âm/chụp ảnh trên ô search THÂN TRANG (khác #headerMoreMenu
// ở trên vốn dành cho thanh search header/Spotlight) — cùng cơ chế hệt nhau, chỉ đổi target.
function toggleSearchMoreMenu(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('searchMoreMenu');
  const inner = document.getElementById('searchInnerBox');
  if (!menu) return;
  const willShow = !menu.classList.contains('show');
  menu.classList.toggle('show', willShow);
  if (inner) inner.classList.toggle('menu-open', willShow);
}
function closeSearchMoreMenu() {
  const menu = document.getElementById('searchMoreMenu');
  const inner = document.getElementById('searchInnerBox');
  if (menu) menu.classList.remove('show');
  if (inner) inner.classList.remove('menu-open');
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.search-right-icons')) closeSearchMoreMenu();
});

function toggleFfcMenu(menuId, event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasOpen = menu.classList.contains('show');
  closeAllFfcMenus();
  if (!wasOpen) menu.classList.add('show');
}
function closeAllFfcMenus() {
  document.querySelectorAll('.ffc-menu.show').forEach(m => m.classList.remove('show'));
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.ffc-menu-wrap')) closeAllFfcMenus();
});

function toggleShareMenu(menuId, event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasOpen = menu.classList.contains('show');
  closeAllShareMenus();
  if (!wasOpen) menu.classList.add('show');
}
function closeAllShareMenus() {
  document.querySelectorAll('.share-menu.show').forEach(m => m.classList.remove('show'));
}
document.addEventListener('click', function(e) {
  if (!e.target.closest('.share-menu-wrap')) closeAllShareMenus();
});

function shareWordToFacebook(wordId) {
  const word = allWords.find(w => w.id === wordId);
  if (!word) return;
  const shareUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(wordUrl(word));
  window.open(shareUrl, 'fbShare', 'width=600,height=520,noopener,noreferrer');
}

// Zalo: Zalo chỉ có nút chia sẻ chính thức qua Official Account (cần đăng ký OA riêng).
// Vì trang chưa có OA, dùng Web Share API (trên điện thoại sẽ mở khung chia sẻ của máy,
// có sẵn Zalo nếu người dùng đã cài đặt); nếu trình duyệt không hỗ trợ, copy link vào
// clipboard để người dùng tự dán vào Zalo.
function shareWordToZalo(wordId) {
  const word = allWords.find(w => w.id === wordId);
  if (!word) return;
  const url = wordUrl(word);
  const firstDef = (word.definitions && word.definitions[0]) || {};
  const vietMeaning = firstDef.viet_meaning || (word.meanings && word.meanings[0]) || '';
  const shareText = word.thai + (word.phonetic ? ' (' + word.phonetic + ')' : '') + (vietMeaning ? ' - ' + vietMeaning : '') + ' | alay';
  if (navigator.share) {
    navigator.share({ title: word.thai, text: shareText, url: url }).catch(() => {});
  } else {
    copyLinkToClipboard(url, '📋 Đã copy link! Dán vào Zalo để chia sẻ nhé.');
  }
}

function copyLinkToClipboard(url, successMessage) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast(successMessage)).catch(() => legacyCopyFallback(url, successMessage));
  } else {
    legacyCopyFallback(url, successMessage);
  }
}
function legacyCopyFallback(url, successMessage) {
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(successMessage);
  } catch (e) {
    showToast('⚠️ Không thể copy link, vui lòng copy thủ công từ thanh địa chỉ');
  }
  document.body.removeChild(ta);
}

// Cập nhật title/meta/OG/canonical theo từ đang xem + đẩy URL sạch vào thanh địa chỉ
// (không tải lại trang). pushHistory=false dùng khi chỉ đang đồng bộ theo URL đã có sẵn
// (ví dụ khi xử lý nút back/forward) để tránh chèn thêm 1 mục lịch sử thừa.
// Chuyển nội dung rich text (HTML, có thể chứa &nbsp;) thành chữ thường dùng cho <title>/meta — giống toPlain() ở netlify/edge-functions/word-seo.ts
function htmlToPlainText(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html || '');
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function updateWordSEO(word, pushHistory) {
  if (!word) return;
  // JSON-LD đúc sẵn từ máy chủ chỉ đúng cho từ của URL lúc tải trang — sang từ khác thì gỡ để không còn dữ liệu cũ
  const seoLd = document.getElementById('seoJsonLd');
  if (seoLd && seoLd.dataset.wordId !== String(word.id)) seoLd.remove();
  const firstDef = (word.definitions && word.definitions[0]) || {};
  const vietMeaning = htmlToPlainText(firstDef.viet_meaning || (word.meanings && word.meanings[0]) || '');
  const title = word.thai + (word.phonetic ? ' (' + word.phonetic + ')' : '') + (vietMeaning ? ' - nghĩa là "' + vietMeaning + '"' : ' - nghĩa là gì') + ' | alay';
  const desc = word.thai + (word.phonetic ? ', đọc là ' + word.phonetic : '') + (vietMeaning ? ', nghĩa: ' + vietMeaning : '') + '. Tra từ điển Thái - Việt miễn phí tại alay.';
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('metaDescription').setAttribute('content', desc);
  document.getElementById('canonicalLink').setAttribute('href', wordUrl(word));
  document.getElementById('ogTitle').setAttribute('content', title);
  document.getElementById('ogDescription').setAttribute('content', desc);
  document.getElementById('ogUrl').setAttribute('content', wordUrl(word));
  document.getElementById('twitterTitle').setAttribute('content', title);
  document.getElementById('twitterDescription').setAttribute('content', desc);
  if (pushHistory !== false && location.pathname !== wordPath(word)) {
    history.pushState({ wordId: word.id }, '', wordPath(word));
  }
}

// Đưa title/meta về mặc định trang chủ (dùng khi về home / xóa ô search)
function resetSEO() {
  const seoLd = document.getElementById('seoJsonLd');
  if (seoLd) seoLd.remove();
  const title = 'alay – Từ điển Thái Việt';
  const desc = 'Từ điển Thái - Việt trực tuyến: tra từ, phát âm, ví dụ, thành ngữ Thái Lan. Miễn phí, dễ dùng, có OCR và bàn phím ảo.';
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('metaDescription').setAttribute('content', desc);
  document.getElementById('canonicalLink').setAttribute('href', window.location.origin + '/');
  document.getElementById('ogTitle').setAttribute('content', title);
  document.getElementById('ogDescription').setAttribute('content', desc);
  document.getElementById('ogUrl').setAttribute('content', window.location.origin + '/');
  document.getElementById('twitterTitle').setAttribute('content', title);
  document.getElementById('twitterDescription').setAttribute('content', desc);
}

// Đọc từ trong URL hiện tại (dạng mới /tu/<id>-<slug> hoặc cũ ?w=<thai>) và hiển thị nếu tìm thấy
async function loadWordFromLocation() {
  // Khối <article id="seoWord"> do máy chủ đúc sẵn cho Google (netlify/edge-functions/word-seo.ts): app sắp hiển thị chính từ đó nên gỡ đi để khỏi trùng nội dung
  const seoWord = document.getElementById('seoWord');
  if (seoWord) seoWord.remove();
  const path = window.location.pathname;
  const tuMatch = path.match(/^\/tu\/(\d+)(?:-.*)?$/);
  if (tuMatch) {
    let word = allWords.find(x => String(x.id) === tuMatch[1]);
    if (word) {
      word = await ensureWordFull(word.id);
      setSearchInputValue(word.thai);
      syncHeaderSearchValue(word.thai);
      showResult(word);
      addRecent(word);
      updateWordSEO(word, false);
      return true;
    }
  }
  const params = new URLSearchParams(location.search);
  const wParam = params.get('w');
  if (wParam) {
    let word = allWords.find(x => x.thai === wParam);
    if (word) {
      word = await ensureWordFull(word.id);
      setSearchInputValue(word.thai);
      syncHeaderSearchValue(word.thai);
      showResult(word);
      addRecent(word);
      // Nâng cấp link cũ lên URL sạch mới trong thanh địa chỉ (không thêm lịch sử mới)
      history.replaceState({ wordId: word.id }, '', wordPath(word));
      updateWordSEO(word, false);
      return true;
    }
  }
  return false;
}

// Xử lý nút back/forward của trình duyệt
window.addEventListener('popstate', async function() {
  if (!allWords.length) return; // dữ liệu chưa load xong thì bỏ qua, loadWords() sẽ tự xử lý URL ban đầu
  const found = await loadWordFromLocation();
  if (!found) {
    showPage('home');
    resetSEO();
  }
});

// ── LOAD DATA ─────────────────────────────────────────
// Các id đã có đủ definitions/examples trong allWords — tránh gọi API lại nếu đã tải rồi.
const fullyLoadedWordIds = new Set();

// Đảm bảo 1 từ trong allWords đã có đầy đủ definitions/examples trước khi hiển thị chi tiết
// hoặc mở form sửa — nếu chưa có thì tải riêng đúng từ đó (1 dòng, nhẹ) rồi vá vào allWords.
// LƯU Ý: mọi nơi hiển thị/sửa CHI TIẾT 1 từ (xem kết quả, popup xem nhanh, sửa ở admin,
// ôn tập flashcard, xem từ trong PopThai) đều phải gọi qua hàm này trước — nếu không sẽ có
// nguy cơ hiển thị/lưu đè dữ liệu rỗng vì allWords mặc định chỉ tải "mỏng".
async function ensureWordFull(id) {
  const idx = allWords.findIndex(w => w.id === id);
  if (idx === -1) return null;
  if (fullyLoadedWordIds.has(id)) return allWords[idx];
  try {
    const rows = await sbGet('words?id=eq.' + id + '&select=*');
    const full = rows && rows[0];
    if (full) {
      allWords[idx] = {
        ...full,
        meanings: Array.isArray(full.meanings) ? full.meanings : (full.meanings ? [full.meanings] : []),
        examples: full.examples || [],
        definitions: full.definitions || []
      };
      fullyLoadedWordIds.add(id);
    }
  } catch (e) {
    console.error('ensureWordFull error', e);
  }
  return allWords[idx];
}

// Tải nền definitions/examples cho những từ NGƯỜI DÙNG NÀY thực sự có khả năng mở tiếp — favorites
// + lịch sử tra gần đây (recentSearches) — thay vì TOÀN BỘ từ điển như trước. Lý do đổi: khi từ
// điển đã có hàng nghìn từ, tải "select=*" (definitions/examples JSONB) cho tất cả từ mỗi phiên
// truy cập trở thành payload rất nặng, tốn băng thông người dùng lẫn egress Supabase — trong khi
// phần lớn người dùng chỉ tra vài từ mỗi lượt. ensureWordFull() (tải từng từ theo yêu cầu, xem
// phía trên) đã đủ xử lý mọi từ KHÁC không nằm trong 2 nhóm này, chỉ chậm hơn ~1 lần gọi mạng
// riêng ở lần đầu mở từ đó, không ảnh hưởng gì tới các lần mở lại sau.
async function hydratePriorityWordsData() {
  try {
    const wordIdsInMemory = new Set(allWords.map(w => w.id));
    const favIds = favorites
      .map(k => parseInt(String(k).split(':')[0], 10))
      .filter(id => !isNaN(id) && wordIdsInMemory.has(id));
    const recentIds = recentSearches
      .map(r => r.id)
      .filter(id => typeof id === 'number' && wordIdsInMemory.has(id));
    const idsToLoad = Array.from(new Set([...favIds, ...recentIds]))
      .filter(id => !fullyLoadedWordIds.has(id))
      .slice(0, 500); // giới hạn an toàn — phòng trường hợp hiếm gặp có rất nhiều mục yêu thích/lịch sử
    if (!idsToLoad.length) return;

    const full = await sbGet('words?id=in.(' + idsToLoad.join(',') + ')&select=*');
    const byId = new Map(full.map(w => [w.id, w]));
    allWords = allWords.map(w => {
      if (fullyLoadedWordIds.has(w.id)) return w; // đã có bản mới hơn từ ensureWordFull rồi, giữ nguyên
      const f = byId.get(w.id);
      if (!f) return w;
      fullyLoadedWordIds.add(w.id);
      return {
        ...f,
        meanings: Array.isArray(f.meanings) ? f.meanings : (f.meanings ? [f.meanings] : []),
        examples: f.examples || [],
        definitions: f.definitions || []
      };
    });
  } catch (e) {
    console.error('hydratePriorityWordsData error', e);
  }
}

async function loadWords() {
  try {
    // Tải "mỏng": chỉ các trường cần cho autocomplete/tìm kiếm (không có definitions/examples —
    // phần JSONB nặng nhất và sẽ càng ngày càng nặng khi mở rộng nội dung từ điển). Nhờ vậy
    // trang sẵn sàng tra từ nhanh hơn nhiều, nhất là khi từ điển đã có nhiều mục.
    // is_idiom_pick (chip "Thành ngữ", xem migration_words_idiom_pick.sql): nếu cột chưa được tạo trên Supabase thì truy vấn trả lỗi (không phải mảng) → thử lại
    // không có cột đó để từ điển KHÔNG bị hỏng trong lúc chờ chạy migration.
    let data = await sbGet('words?select=id,thai,phonetic,type,meanings,structure,created_at,is_random_pick,is_idiom_pick,visible&order=thai.asc');
    if (!Array.isArray(data)) data = await sbGet('words?select=id,thai,phonetic,type,meanings,structure,created_at,is_random_pick,visible&order=thai.asc');
    allWords = data.map(w => ({
      ...w,
      meanings: Array.isArray(w.meanings) ? w.meanings : (w.meanings ? [w.meanings] : []),
      examples: [],
      definitions: []
    }));
    wordsLoadedResolve();
    initWOD();
    initLearningBar();
    renderRecent();
    updateStats();

    // Nếu trang được mở kèm /tu/id-slug (URL mới) hoặc ?w=từ (link cũ), tự động tra từ đó
    loadWordFromLocation();

    // Tải nền definitions/examples cho favorites + lịch sử tra gần đây sau khi trang đã sẵn sàng
    // tra từ cơ bản (không await, không chặn gì) — KHÔNG còn tải toàn bộ từ điển như trước (xem
    // chú thích ở hydratePriorityWordsData() phía trên).
    hydratePriorityWordsData();
    await initAuthState();

    // Các trang chính sách (about/contact/privacy/terms) trỏ về đây kèm ?open=... khi người dùng
    // bấm 1 icon chức năng ở thanh rail rút gọn của chúng (favorites/history/search/suggest) —
    // tự mở đúng tính năng đó ngay khi trang chủ tải xong, dọn query khỏi URL sau đó.
    (function handleDeepLinkOpen() {
      const openTarget = new URLSearchParams(location.search).get('open');
      if (!openTarget) return;
      history.replaceState(null, '', location.pathname);
      if (openTarget === 'search') openSpotlight();
      else if (openTarget === 'favorites') showPage('favorites');
      else if (openTarget === 'history') showPage('history');
      else if (openTarget === 'suggest') openSuggestWordModal('');
    })();

    // Widget thời tiết/tỷ giá/món ăn (modules/widgets.js) KHÔNG còn tải ở đây nữa — giờ chỉ
    // tải (cả code lẫn dữ liệu) khi người dùng thực sự mở nút "Thông tin nhanh" ở side-menu,
    // hoặc khi admin vào trang quản trị. Xem toggleHomeInfoNav() và showPage('admin').
  } catch(e) {
    showToast('⚠️ Lỗi kết nối database');
    wordsLoadedResolve(); // vẫn resolve dù lỗi — tránh trang Admin chờ vô thời hạn nếu mạng lỗi hẳn
  }
}

// ── SEARCH ────────────────────────────────────────────
let searchTimeout;

function isThaiScript(s) {
  return /[\u0E00-\u0E7F]/.test(s);
}

// ── GIỚI HẠN DỊCH CÂU (đồng bộ với MAX_TEXT_LENGTH bên Edge Function translate-sentence) ──
const MAX_TRANSLATE_TEXT_LENGTH = 300;
let wasOverTranslateLimit = false;

// Bộ đếm ký tự góc phải trên thanh search — chỉ hiện khi có chữ, đổi đỏ khi vượt giới hạn
// cho phép của tính năng dịch câu, kèm cảnh báo 1 lần đúng lúc vừa vượt ngưỡng (không lặp lại
// mỗi phím gõ tiếp theo trong lúc vẫn đang vượt, tránh làm phiền).
// Bộ đếm ký tự — cập nhật ĐỒNG THỜI cả 2 ô search dùng chung 1 giá trị (trang chủ #searchInput
// và header/spotlight #headerSearchInput luôn đồng bộ giá trị với nhau qua setSearchInputValue/
// syncHeaderSearchValue), nên counter của cả 2 ô cũng phải khớp nhau dù ô nào đang hiện.
const SEARCH_CHAR_COUNTER_IDS = ['searchCharCounter', 'headerSearchCharCounter'];
function updateSearchCharCounter(val) {
  const counters = SEARCH_CHAR_COUNTER_IDS.map(id => document.getElementById(id)).filter(Boolean);
  if (!counters.length) return;
  if (!val || !val.trim()) {
    counters.forEach(c => c.classList.remove('show'));
    wasOverTranslateLimit = false;
    return;
  }
  const len = val.length;
  const isOver = len > MAX_TRANSLATE_TEXT_LENGTH;
  const text = len + '/' + MAX_TRANSLATE_TEXT_LENGTH;
  counters.forEach(c => {
    c.textContent = text;
    c.classList.add('show');
    c.classList.toggle('warn', isOver);
  });
  if (isOver && !wasOverTranslateLimit) {
    showToast('⚠️ Câu quá dài để dịch (tối đa ' + MAX_TRANSLATE_TEXT_LENGTH + ' ký tự)');
  }
  wasOverTranslateLimit = isOver;
}

// Điều kiện để 1 đoạn text được phép dịch: có chữ và là tiếng Thái — dùng để bật/mờ icon
// "Dịch câu" nổi ở góc khung kết quả tách từ (xem updateTranslateButtonState()).
function shouldOfferTranslate(val) {
  const t = (val || '').trim();
  return !!t && isThaiScript(t);
}

// Bật/tắt icon "Dịch câu" (#ptPanelTranslateBtn, nổi ở góc phải trên khung kết quả tách từ) —
// chỉ bấm được khi ô đang có chữ tiếng Thái hợp lệ và chưa vượt giới hạn ký tự dịch.
function updateTranslateButtonState(val) {
  const t = (val || '').trim();
  const overLimit = t.length > MAX_TRANSLATE_TEXT_LENGTH;
  const eligible = shouldOfferTranslate(val);
  const translateDisabled = !t || overLimit || !eligible;

  const panelBtn = document.getElementById('ptPanelTranslateBtn');
  if (panelBtn) {
    panelBtn.disabled = translateDisabled;
    panelBtn.title = !t ? 'Dịch câu này sang tiếng Việt'
      : overLimit ? 'Câu quá dài để dịch'
      : !eligible ? 'Dịch câu này sang tiếng Việt'
      : 'Dịch câu này sang tiếng Việt';
  }
}

function onSearchWithClear(val) {
  autoGrowSearchInput();
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('visible', !!val);
  syncHeaderSearchValue(val);
  const histDropdown = document.getElementById('searchHistoryDropdown');
  if (histDropdown && val.trim()) { histDropdown.classList.remove('show'); clearQuickShelfActive(); }
  updateSearchCharCounter(val);
  updateTranslateButtonState(val);
  updateSearchPlaceholderVisibility();
  document.getElementById('ptTranslateResult').classList.remove('show');
  if (searchMode === 'popthai') {
    onPopthaiInput(val);
  } else {
    onSearch(val);
  }
}

// Ô search thân trang tự tăng chiều cao theo nội dung (văn bản dài, ví dụ khi tách từ PopThai,
// sẽ hiển thị đầy đủ thay vì bị cắt/scroll ngang). Ô search trên header giữ nguyên 1 dòng như cũ.
function autoGrowSearchInput() {
  const el = document.getElementById('searchInput');
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  const maxHeight = 240;
  const newHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = newHeight + 'px';
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

// Set giá trị ô search thân trang bằng JS (không phải người dùng gõ tay) — dùng hàm này thay vì
// gán .value= trực tiếp, vì gán trực tiếp KHÔNG tự kích hoạt sự kiện "input", nên nút X xóa sẽ
// không hiện dù ô đã có chữ (bug khi chọn từ từ Từ hot / Lịch sử / gợi ý / trích dẫn...).
function setSearchInputValue(val) {
  const input = document.getElementById('searchInput');
  if (!input) return;
  input.value = val;
  autoGrowSearchInput();
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('visible', !!val);
  updateSearchPlaceholderVisibility();
}

// Đồng bộ nội dung đang gõ sang thanh search trên header (không kích hoạt autocomplete header)
function syncHeaderSearchValue(val) {
  const headerInput = document.getElementById('headerSearchInput');
  const headerClearBtn = document.getElementById('headerSearchClearBtn');
  if (headerInput && document.activeElement !== headerInput) {
    headerInput.value = val;
    if (headerClearBtn) headerClearBtn.classList.toggle('visible', !!val);
  }
}
// Hiện dropdown lịch sử tra từ khi bấm/focus vào ô search (chỉ khi ô đang trống và ở mode tra từ,
// để không xung đột với dropdown autocomplete khi người dùng đang gõ). Đóng lại khi bấm ra ngoài
// (xử lý ở listener click chung, không dùng blur để tránh đóng trước khi kịp bấm chọn 1 mục trong dropdown).
// Dùng chung cho cả thanh search thân trang lẫn thanh search trên header.
function showSearchHistDropdown(dropdownId, inputId) {
  const dropdown = document.getElementById(dropdownId);
  const input = document.getElementById(inputId);
  if (!dropdown || !input) return;
  if (Date.now() < suppressHistHoverUntil) return; // vừa chọn 1 từ xong, chặn mở lại
  if (typeof searchMode !== 'undefined' && searchMode !== 'word') return;
  if (input.value.trim()) return; // đang gõ tìm kiếm, không hiện đè lên autocomplete
  renderRecentDropdown();
  dropdown.classList.add('show');
  // Ô search chính có chip "Lịch sử" trên kệ gợi ý nhanh — tự sáng lên để báo đang ở chế độ
  // Lịch sử (dropdown này CHÍNH LÀ nội dung của chip đó), người dùng khỏi phải bấm thêm.
  if (dropdownId === 'searchHistoryDropdown') {
    quickShelfActiveKind = 'history';
    const chip = document.getElementById('qsChipHistory');
    if (chip) chip.classList.add('active');
  }
}
function onSearchInputFocus() {
  clearQuickShelfActive();
  showSearchHistDropdown('searchHistoryDropdown', 'searchInput');
}
function onHeaderSearchInputFocus() {
  showSearchHistDropdown('headerSearchHistoryDropdown', 'headerSearchInput');
}

// ── KỆ GỢI Ý NHANH (Lịch sử / Thành ngữ / Slang / Từ hot) ──────────────
// Tái dùng đúng khung #searchHistoryDropdown đã có sẵn (không tạo dropdown riêng) — chỉ đổi
// nội dung bên trong tuỳ theo mục đang chọn. Bấm lại mục đang mở sẽ đóng (dạng accordion).
let quickShelfActiveKind = null;

function clearQuickShelfActive() {
  quickShelfActiveKind = null;
  ['qsChipHistory', 'qsChipTrending'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
}

// 4 mục kệ gợi ý nhanh (Lịch sử/Từ tra nhiều/Từ ngẫu nhiên/Thành ngữ) đều phục vụ việc TRA TỪ —
// nếu đang ở mục Tách từ & Dịch câu mà bấm vào, tự chuyển về Tra từ trước rồi mới mở, tránh cảnh
// chọn 1 từ nhưng giao diện vẫn đứng ở tab Tách từ & Dịch câu.
function toggleQuickShelfList(kind, btnEl, event) {
  if (event) event.stopPropagation();
  if (typeof searchMode !== 'undefined' && searchMode !== 'word') switchSearchMode('word');
  const dropdown = document.getElementById('searchHistoryDropdown');
  if (!dropdown) return;

  if (quickShelfActiveKind === kind && dropdown.classList.contains('show')) {
    dropdown.classList.remove('show');
    clearQuickShelfActive();
    return;
  }

  clearQuickShelfActive();
  quickShelfActiveKind = kind;
  if (btnEl) btnEl.classList.add('active');
  dropdown.classList.add('show');

  if (kind === 'history') {
    renderRecentDropdown();
  } else if (kind === 'trending') {
    renderQuickShelfTrending();
  }
}

// 1 dòng đơn giản trong danh sách kệ gợi ý (khác renderRecentRowDropdown ở chỗ không có
// thời gian tra gần đây/nút ghim, chỉ có icon + từ + phát âm, bấm để tra).
// countText (tuỳ chọn): chuỗi nhỏ hiện bên phải, trước nút loa — vd "128 lượt tra" ở danh sách Từ tra nhiều.
function renderSimpleWordRow(w, iconSvgInner, countText) {
  return `
    <div class="ac-item" onclick="goToWord(${w.id})">
      <svg class="hist-clock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconSvgInner}</svg>
      <div class="ac-main">
        <div class="ac-thai">${w.thai}</div>
        <div class="ac-phonetic">${w.phonetic || ''}</div>
      </div>
      ${countText ? `<span class="ac-view-count">${countText}</span>` : ''}
      <button class="recent-hist-icon-btn" title="Phát âm" onclick="event.stopPropagation(); speakText('${w.thai}', this)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  `;
}

// Thành ngữ: gom tất cả mục "idioms" mà admin đã nhập ở từng định nghĩa (def.idioms, dữ liệu
// thật đã có sẵn — không phải bịa), CHỈ giữ những thành ngữ có phần tiếng Thái khớp đúng 1 mục
// từ điển thật (mới có chỗ để "tra" khi bấm vào). Thành ngữ dạng câu tự do không khớp từ nào thì
// bỏ qua ở đây, vì mục đích danh sách này là chọn TỪ để tra, không phải đọc thành ngữ.
function collectIdiomWords() {
  const seen = new Set();
  const out = [];
  (allWords || []).forEach(w => {
    (w.definitions || []).forEach(def => {
      (def.idioms || []).forEach(it => {
        const thai = (it.thai || '').trim();
        if (!thai) return;
        const matched = allWords.find(x => x.thai === thai);
        if (!matched || seen.has(matched.id)) return;
        seen.add(matched.id);
        out.push(matched);
      });
    });
  });
  return out;
}
// Thành ngữ: giống chip "Từ ngẫu nhiên" — bấm là tra ngay 1 thành ngữ ngẫu nhiên trong nhóm admin đã đánh dấu (cột is_idiom_pick trong bảng words,
// bật/tắt bằng nút bong bóng thoại ở từng dòng trang quản trị — xem toggleIdiomPick() ở admin-core.js). Tránh ra lại đúng thành ngữ vừa rồi nếu nhóm có ≥2.
// Chưa đánh dấu từ nào → tạm dùng các từ khớp mục "Thành ngữ" admin đã nhập trong phần định nghĩa (collectIdiomWords) để chip vẫn dùng được.
let lastIdiomPickId = null;
function pickRandomIdiomChip(event) {
  if (event) event.stopPropagation();
  if (typeof searchMode !== 'undefined' && searchMode !== 'word') switchSearchMode('word');
  closeSearchHistDropdowns();
  let pool = (allWords || []).filter(w => w.is_idiom_pick && w.visible !== false);
  if (!pool.length) pool = collectIdiomWords().filter(w => w.visible !== false);
  if (!pool.length) {
    showToast('💡 Chưa có thành ngữ nào — vào trang quản trị bấm nút bong bóng thoại ở dòng từ để chọn');
    return;
  }
  const candidates = (pool.length > 1 && lastIdiomPickId != null) ? pool.filter(w => w.id !== lastIdiomPickId) : pool;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastIdiomPickId = picked.id;
  goToWord(picked.id);
}

// Từ ngẫu nhiên: KHÔNG mở danh sách như 3 mục còn lại — bấm là tra ngay 1 từ ngẫu nhiên trong
// nhóm admin đã đánh dấu (cột "is_random_pick" trong bảng words, bật/tắt ở trang quản trị bằng
// nút 🎲 trên từng dòng — xem toggleRandomPick() ở admin-core.js). Tránh ra lại đúng từ vừa rồi
// nếu nhóm có từ 2 từ trở lên.
let lastRandomPickId = null;
function pickRandomWordChip(event) {
  if (event) event.stopPropagation();
  if (typeof searchMode !== 'undefined' && searchMode !== 'word') switchSearchMode('word');
  closeSearchHistDropdowns();
  const pool = (allWords || []).filter(w => w.is_random_pick && w.visible !== false);
  if (!pool.length) {
    showToast('⚠️ Chưa có từ nào trong danh sách Từ ngẫu nhiên — vào trang quản trị để chọn từ');
    return;
  }
  const candidates = (pool.length > 1 && lastRandomPickId != null)
    ? pool.filter(w => w.id !== lastRandomPickId)
    : pool;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastRandomPickId = picked.id;
  goToWord(picked.id);
}

// Từ tra nhiều: tái dùng đúng RPC get_trending_words đã có sẵn (dùng cho sidebar "Từ hot tuần này"
// hiện đang tạm ẩn) — chỉ render vào dropdown kệ gợi ý thay vì sidebar, không đổi gì ở sidebar cũ.
async function renderQuickShelfTrending() {
  const dropdown = document.getElementById('searchHistoryDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '<div class="quick-shelf-loading">Đang tải…</div>';
  const iconFlame = '<path d="M12 2c1 3-2 4-2 7a3 3 0 0 0 6 0c1.5 1 2 3 2 4.5A6.5 6.5 0 0 1 5 13.5C5 9 8 7 8 4c1.5 1 2 2 2 3.5C10.5 5.5 11 3.5 12 2Z"/>';
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_trending_words', {
      method: 'POST',
      headers,
      body: JSON.stringify({ days_back: 36500, limit_count: 15 }) // 36500 ngày (~100 năm) = tính TỔNG từ trước đến nay thay vì 7 ngày
    });
    const rows = await r.json();
    if (quickShelfActiveKind !== 'trending') return; // người dùng đã chuyển mục khác trong lúc chờ
    if (!Array.isArray(rows) || !rows.length) {
      dropdown.innerHTML = '<div class="quick-shelf-empty">Chưa có dữ liệu từ tra nhiều</div>';
      return;
    }
    // Giữ kèm view_count (tổng lượt tra của TẤT CẢ người dùng từ trước đến nay, do RPC get_trending_words tổng hợp với days_back rất lớn).
    const items = rows.map(row => ({ w: allWords.find(x => x.id === row.word_id), count: row.view_count })).filter(it => it.w);
    const words = items;
    if (!words.length) {
      dropdown.innerHTML = '<div class="quick-shelf-empty">Chưa có dữ liệu từ tra nhiều</div>';
      return;
    }
    dropdown.innerHTML = '<div class="search-hist-list">'
      + items.map(it => renderSimpleWordRow(it.w, iconFlame, Number(it.count).toLocaleString('vi-VN') + ' lượt tra')).join('')
      + '</div>';
  } catch (e) {
    if (quickShelfActiveKind === 'trending') {
      dropdown.innerHTML = '<div class="quick-shelf-empty">Không tải được dữ liệu từ tra nhiều</div>';
    }
  }
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  input.value = '';
  autoGrowSearchInput();
  const clearBtn = document.getElementById('searchClearBtn');
  if (clearBtn) clearBtn.classList.remove('visible');
  syncHeaderSearchValue('');
  updateSearchPlaceholderVisibility();
  onSearch('');
  input.focus();
}
// Dòng autocomplete gọn: chỉ hiện từ + phiên âm + loa + tim (không hiện nghĩa/loại từ)
// Dùng chung cho autocomplete ở cả thanh search thân trang lẫn header
function renderAcRowCompact(w, selectFn) {
  return `
    <div class="ac-item" onmousedown="${selectFn}(${w.id})">
      <div class="ac-main">
        <div class="ac-thai">${w.thai}</div>
        <div class="ac-phonetic">${w.phonetic || ''}</div>
      </div>
      <div class="ac-actions">
        <button class="recent-hist-icon-btn" title="Phát âm" onmousedown="event.preventDefault(); event.stopPropagation(); speakText('${w.thai}', this)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    </div>
  `;
}

// ── TRẠNG THÁI "KHÔNG TÌM THẤY TỪ" (#emptyState) ────────────────
// 2 trạng thái render động, tuỳ thời điểm:
// 1) renderEmptyStateNotFound(word): chưa tìm thấy từ trong từ điển — icon search-off (line),
//    câu báo có cụm "đề xuất bổ sung" là nút bấm mở popup gửi đề xuất.
// 2) renderEmptyStateThanks(): sau khi gửi đề xuất thành công — thay ngay tại chỗ (không cần
//    tìm lại) bằng lời cảm ơn + nút "Đề xuất từ khác" để mở lại popup (rỗng, không prefill).
function renderEmptyStateNotFound(word) {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  emptyState.innerHTML = `
    <div class="empty-icon" aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.3-4.3"/>
        <path d="m8 8 6 6"/>
        <path d="m14 8-6 6"/>
      </svg>
    </div>
    <div class="empty-title">Từ "<span class="empty-state-word">${escapeHtml(word)}</span>" chưa có trong từ điển</div>
    <div class="empty-sub">Thử kiểm tra chính tả hoặc <button type="button" class="empty-suggest-link" onclick="openSuggestWordModal('${jsStr(word)}','emptyState')">đề xuất bổ sung</button> từ này</div>
  `;
  emptyState.classList.add('show');
}
function renderEmptyStateThanks() {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  emptyState.innerHTML = `
    <div class="empty-state-thanks">
      <div class="empty-state-thanks-msg">✓ Đã nhận đề xuất. Cảm ơn bạn đã giúp alay bổ sung từ điển. Chúng mình sẽ xem xét từ này sớm.</div>
      <button type="button" class="btn-suggest-word" onclick="openSuggestWordModal('','emptyState')">＋ Đề xuất từ khác</button>
    </div>
  `;
  emptyState.classList.add('show');
}

// ── GỬI TÌM KIẾM (Enter / nút tìm) — KHÔNG tự chọn gợi ý đầu tiên ─────────────────────────────
// Trước đây Enter (khi chưa dùng phím mũi tên chọn dòng nào) luôn mở gợi ý ĐẦU TIÊN — nên gõ "กิน" (chưa có trong từ điển) mà
// dropdown có "กินข้าว" thì mở "กินข้าว", người dùng không thể biết "กิน" chưa có. Giờ: chỉ mở khi (a) đang tô sáng 1 dòng gợi ý bằng ↑↓,
// hoặc (b) có từ khớp CHÍNH XÁC với điều gì vừa gõ; ngược lại hiện màn "chưa có trong từ điển" (kèm nút đề xuất bổ sung) như khi gõ ra 0 kết quả.
function findExactWordMatch(val) {
  const q = (val || '').trim().normalize('NFC');
  if (!q) return null;
  const lq = q.toLowerCase();
  const visible = allWords.filter(w => w.visible !== false);
  return visible.find(w => (w.thai || '').normalize('NFC') === q)
    || visible.find(w => w.phonetic && w.phonetic.toLowerCase() === lq)
    || visible.find(w => (w.meanings || []).some(m => (m || '').toLowerCase() === lq))
    || null;
}
// Sắp gợi ý: khớp chính xác lên đầu, rồi bắt đầu bằng chuỗi gõ, rồi còn lại (sort ổn định nên giữ nguyên thứ tự cũ trong từng nhóm)
function rankSearchSuggestions(list, val) {
  const q = (val || '').trim().normalize('NFC');
  const lq = q.toLowerCase();
  const rank = w => {
    const thai = (w.thai || '').normalize('NFC');
    if (thai === q || (w.meanings || []).some(m => (m || '').toLowerCase() === lq)) return 0;
    if (thai.startsWith(q)) return 1;
    return 2;
  };
  return list.map((w, i) => ({ w, i, r: rank(w) })).sort((a, b) => a.r - b.r || a.i - b.i).map(o => o.w);
}
function submitWordSearch(val, highlightedWord, fromHeader) {
  val = (val || '').trim();
  const open = id => (fromHeader ? selectWordFromHeader(id) : selectWord(id));
  if (highlightedWord) { open(highlightedWord.id); return; }
  if (!val) return;
  const exact = findExactWordMatch(val);
  if (exact) { open(exact.id); return; }
  // Không có từ khớp chính xác -> báo "chưa có trong từ điển"
  clearTimeout(searchTimeout);
  clearTimeout(headerSearchTimeout);
  acResults = []; acIndex = -1; headerAcResults = []; headerAcIndex = -1;
  ['autocomplete', 'headerAc'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('show'); });
  if (fromHeader) {
    const wasSpotlight = headerSearchWrap.classList.contains('spotlight-mode') && headerSearchWrap.classList.contains('visible');
    if (wasSpotlight) closeSpotlight();
    showPage('home');
    setSearchInputValue(val);
    setTimeout(() => scrollActivePageToTop(), 50);
  }
  document.getElementById('homeDefault').style.display = 'none';
  document.getElementById('resultSection').classList.remove('show');
  lastNoResultQuery = val;
  renderEmptyStateNotFound(val);
  scheduleNoResultLog(val);
}

function onSearch(val) {
  clearTimeout(searchTimeout);
  val = val.trim();
  const ac = document.getElementById('autocomplete');
  const homeDefault = document.getElementById('homeDefault');
  const resultSection = document.getElementById('resultSection');
  const emptyState = document.getElementById('emptyState');

  if (!val) {
    ac.classList.remove('show');
    homeDefault.style.display = 'block';
    resultSection.classList.remove('show');
    emptyState.classList.remove('show');
    acResults = []; acIndex = -1;
    return;
  }

  homeDefault.style.display = 'none';
  resultSection.classList.remove('show');
  emptyState.classList.remove('show');

  searchTimeout = setTimeout(() => {
    const q = val.toLowerCase();
    acResults = rankSearchSuggestions(allWords.filter(w =>
      w.visible !== false && (
        w.thai.includes(val) ||
        (w.phonetic && w.phonetic.toLowerCase().includes(q)) ||
        (w.meanings && w.meanings.some(m => m.toLowerCase().includes(q)))
      )
    ), val).slice(0, 7);

    if (!acResults.length) {
      ac.classList.remove('show');
      lastNoResultQuery = val;
      renderEmptyStateNotFound(val);
      scheduleNoResultLog(val);
      return;
    }

    ac.innerHTML = acResults.map((w, i) => renderAcRowCompact(w, 'selectWord')).join('');
    ac.classList.add('show');
    acIndex = -1;
  }, 150);
}

function onKeydown(e) {
  if (searchMode === 'popthai') {
    if (e.key === 'Enter') { e.preventDefault(); runPopthai(); }
    return;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex+1, acResults.length-1); highlightAC(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex-1, 0); highlightAC(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    submitWordSearch(document.getElementById('searchInput').value, acIndex >= 0 ? acResults[acIndex] : null, false);
  } else if (e.key === 'Escape') {
    document.getElementById('autocomplete').classList.remove('show');
  }
}

function highlightAC() {
  document.querySelectorAll('#autocomplete .ac-item').forEach((el, i) => el.classList.toggle('highlighted', i === acIndex));
}

async function selectWord(id) {
  const word = await ensureWordFull(id);
  if (!word) return;
  currentWord = word;
  setSearchInputValue(word.thai);
  syncHeaderSearchValue(word.thai);
  document.getElementById('autocomplete').classList.remove('show');
  showResult(word);
  addRecent(word);
  updateWordSEO(word);
}

const THAI_DIGITS_MAP = ['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙'];
function toThaiNum(n) { return String(n).split('').map(d => THAI_DIGITS_MAP[+d]).join(''); }
// Số trong vòng tròn — vẽ bằng CSS (span tròn chứa số thường) thay vì ký tự Unicode "①②③..."
// (loại ký tự đó chỉ có sẵn tới ⑳ rồi hết, quá số đó phải rơi về dạng khác; đồng thời bề rộng
// ký tự Unicode không đều nhau giữa các trình duyệt/font, dễ làm lệch dòng). Cách này luôn ra
// đúng 1 vòng tròn cho MỌI số, không giới hạn.
function buildNumBadgeHTML(n, cssClass) {
  return '<span class="' + cssClass + '">' + n + '</span>';
}
const THAI_NUMS_DEF = new Proxy([], { get(_, i) { const idx = parseInt(i); if (isNaN(idx)) return undefined; return toThaiNum(idx + 1); } });

// Cập nhật nhãn chữ + trạng thái xoay icon của nút "Xem/Ẩn ví dụ" — dùng querySelector cho label
// riêng thay vì gán thẳng textContent, vì nút giờ có kèm <svg> chevron bên trong (gán textContent
// sẽ xóa mất icon đó).
function setGuessBtnState(guessBtn, opening) {
  if (!guessBtn) return;
  guessBtn.classList.toggle('open', opening);
  const label = guessBtn.querySelector('.def-guess-btn-label');
  if (label) label.textContent = opening ? 'Ẩn ví dụ' : 'Xem ví dụ';
}

// Mở/đóng 1 def-block, đồng thời đồng bộ nhãn nút "Xem ví dụ" (nếu có, xem buildGuessInputHTML)
// theo đúng trạng thái hiện tại, bất kể block được mở qua nút này hay qua header accordion phía
// trên.
// .def-body tự hiện/ẩn tức thời bằng display:none/block qua CSS (class 'open' trên block, xem
// style.css) — không animate chiều cao/layout nên không thể gây giật. Phần hiệu ứng nằm ở
// .def-body-inner (mờ dần + phóng to nhẹ từ dưới lên, chỉ opacity/transform), và CHỈ chạy đúng
// 1 lần vào lần đầu tiên định nghĩa này được mở — đánh dấu bằng inner.dataset.animated để các
// lần mở sau (kể cả đóng rồi mở lại ngay) hiện ra tức thời, không animate lại.
function setDefBlockOpen(block, opening) {
  if (!block) return;
  block.classList.toggle('open', opening);
  setGuessBtnState(block.querySelector('.def-guess-btn'), opening);
  const inner = block.querySelector('.def-body-inner');
  if (!inner) return;
  if (opening) {
    if (inner.dataset.animated) return; // đã chạy hiệu ứng lần đầu rồi, hiện ngay không animate lại
    inner.dataset.animated = '1';
    inner.classList.add('def-body-anim');
    inner.addEventListener('animationend', function onAnimEnd(e) {
      if (e.target !== inner) return;
      inner.removeEventListener('animationend', onAnimEnd);
      inner.classList.remove('def-body-anim');
    });
  } else {
    // Nếu người dùng đóng lại NGAY khi hiệu ứng lần đầu còn đang chạy dở, display:none sẽ cắt
    // ngang animation mà KHÔNG bắn sự kiện 'animationend' — gỡ luôn class ở đây để tránh việc
    // trình duyệt tự khởi động lại animation ở lần mở kế tiếp (display:none→block vốn tự restart
    // animation nếu class animation vẫn còn gắn trên phần tử).
    inner.classList.remove('def-body-anim');
  }
}

function toggleDef(el) {
  const block = el.closest('.def-block');
  if (!block) return;
  setDefBlockOpen(block, !block.classList.contains('open'));
}

// Mở/đóng TẤT CẢ các thẻ định nghĩa trong 1 container cùng lúc (nút icon "Mở tất cả ví dụ").
function toggleAllDefs(containerId, btnEl) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const blocks = container.querySelectorAll('.def-block');
  if (!blocks.length) return;
  const shouldOpen = !container.classList.contains('all-open');
  blocks.forEach(b => setDefBlockOpen(b, shouldOpen));
  container.classList.toggle('all-open', shouldOpen);
  if (btnEl) {
    btnEl.classList.toggle('active', shouldOpen);
    btnEl.setAttribute('data-tooltip', shouldOpen ? 'Thu gọn tất cả ví dụ' : 'Mở tất cả ví dụ');
  }
}

// Chỉ hiện nút "Mở tất cả ví dụ" khi từ có từ 2 nghĩa trở lên VÀ có ít nhất 1 ví dụ nào đó
// (từ chỉ có 1 nghĩa hoặc không có ví dụ thì nút này thừa, gây rối giao diện).
function updateDefExpandAllBtn(btnId, containerId, word) {
  const btn = document.getElementById(btnId);
  const container = document.getElementById(containerId);
  if (!btn || !container) return;
  const defs = (word && word.definitions) || [];
  const hasMultiple = defs.length > 1;
  const hasAnyExample = defs.some(d => (d.examples || []).length > 0);
  btn.classList.toggle('show', hasMultiple && hasAnyExample);
  btn.classList.remove('active');
  btn.setAttribute('data-tooltip', 'Mở tất cả ví dụ');
  container.classList.remove('all-open');
}

// Xây dựng HTML phần định nghĩa (accordion) — dùng chung cho trang kết quả và popup tra nhanh
// Tìm các từ khác có chung 1 loại từ cụ thể (vd "คำกริยา - Động từ") với định nghĩa đang xét.
// Vì 1 định nghĩa có thể có nhiều loại từ (nối bằng dấu phẩy), so khớp từng loại riêng lẻ.
// Hiển thị 1 danh sách từ đồng nghĩa/trái nghĩa/thành ngữ do admin nhập tay.
// Mỗi mục tự thêm dấu chấm " · " giữa tiếng Thái và tiếng Việt.
// Nếu phần tiếng Thái trùng khớp chính xác 1 từ có sẵn trong từ điển, tự động biến
// thành liên kết click được (giống các từ liên kết khác); nếu không khớp, hiển thị text thường.
// icon: chuỗi SVG hiển thị ở đầu nhãn (xem 4 icon riêng cho từng loại trong
// renderAllRelWordSections bên dưới — 2 vòng tròn móc nhau/2 dấu ngã chồng nhau/2 mũi tên trái
// chiều/dấu quote).
function renderRelWordList(items, currentWordId, label, icon) {
  if (!items || !items.length) return '';
  const rendered = [];
  items.forEach(it => {
    const thai = (it.thai || '').trim();
    const viet = (it.viet || '').trim();
    if (!thai && !viet) return;
    // 1 mục "thai" có thể chứa NHIỀU từ cách nhau bằng khoảng trắng (admin gõ gộp thành 1 dòng,
    // vd "กิน ดี") — tách theo khoảng trắng ĐƠN GIẢN (KHÔNG chạy thuật toán tách từ PopThai,
    // .def-related-grid cũng đã bị loại khỏi segmentizeTextNodes ở trên, xem skipSelector).
    // Mỗi từ sau khi tách tự kiểm tra khớp từ điển để có link riêng, rồi được đẩy thành 1 phần
    // tử RIÊNG trong "rendered" — nhờ vậy tận dụng đúng dấu "·" mà CSS grid đã tự thêm giữa các
    // phần tử liền kề (.def-related-grid > *:not(:last-child)::after), không cần tự nối chuỗi.
    thai.split(/\s+/).filter(Boolean).forEach(w => {
      const matched = allWords.find(ww => ww.thai === w && ww.id !== currentWordId);
      rendered.push(matched
        ? '<span class="def-word-link" onclick="event.stopPropagation(); onRelatedWordClick(' + matched.id + ')" ondblclick="event.stopPropagation(); onRelatedWordDblClick(' + matched.id + ')" title="Nhấp để xem nghĩa · Nhấp đúp để chuyển tới">' + w + '</span>'
        : '<span class="def-rel-plain">' + w + '</span>');
    });
    if (viet) rendered.push('<span class="def-rel-plain">' + viet + '</span>');
  });
  if (!rendered.length) return '';
  // Không còn đường kẻ nét đứt ngăn cách phía trên mỗi nhóm nữa (trước đây .def-related-divider)
  // — 4 nhóm giờ nằm chung trong 1 khối "Đào sâu" duy nhất, chỉ còn khoảng cách margin giữa
  // các nhãn (.def-related-label) là đủ để phân biệt, không cần thêm đường kẻ.
  return '<div class="def-related-label">' + (icon || '') + '<span>' + label + '</span></div>'
    + '<div class="def-related-grid">' + rendered.join('') + '</div>';
}

// 4 icon dạng đường nét (line icon), đồng bộ style với các icon khác trong app (stroke =
// currentColor, tự đổi màu theo light/dark mode).
const REL_ICON_RELATED = '<svg class="def-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="5.2"/><circle cx="15" cy="12" r="5.2"/></svg>'; // 2 vòng tròn móc vào nhau
const REL_ICON_SYNONYM = '<svg class="def-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9c1.3-1.7 3-1.7 4.3 0s3 1.7 4.3 0 3-1.7 4.3 0 3 1.7 4.3 0"/><path d="M3 16c1.3-1.7 3-1.7 4.3 0s3 1.7 4.3 0 3-1.7 4.3 0 3 1.7 4.3 0"/></svg>'; // 2 dấu ngã xếp chồng lên nhau
const REL_ICON_ANTONYM = '<svg class="def-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h14"/><path d="M13 4l4 4-4 4"/><path d="M21 16H7"/><path d="M11 20l-4-4 4-4"/></svg>'; // 2 mũi tên trái chiều nhau
const REL_ICON_IDIOM = '<svg class="def-related-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 15h2.5V9H6a1.5 1.5 0 0 0-1.5 1.5v1A3.5 3.5 0 0 0 7.5 15z"/><path d="M17.5 15H20V9h-4a1.5 1.5 0 0 0-1.5 1.5v1a3.5 3.5 0 0 0 3 3.5z"/></svg>'; // dấu quote
// Icon thỏ ló đầu khỏi hang — dùng ĐÚNG hình ảnh do người dùng cung cấp (không vẽ lại bằng SVG
// line-icon như trước), cho nút gộp chung "Đào sâu" (đồng nghĩa/trái nghĩa/thành ngữ/liên quan
// gộp làm 1, xem renderAllRelWordSections bên dưới). File ảnh: /icons/explore-rabbit.png (PNG
// nền trong suốt 64x64, cần copy vào thư mục icons/ của repo).
// Dùng class RIÊNG "def-explore-icon" (24x24, xem style.css) — KHÔNG dùng chung "def-related-icon"
// (16x16) với 4 icon dòng đồng nghĩa/trái nghĩa/thành ngữ/liên quan bên trong nội dung xổ ra,
// để phóng to icon thỏ mà không ảnh hưởng kích thước 4 icon còn lại.
const REL_ICON_EXPLORE = '<img class="def-explore-icon" src="/icons/explore-rabbit.png" alt="" width="24" height="24">'; // thỏ ló đầu khỏi hang

// Gộp 4 nhóm (đồng nghĩa/trái nghĩa/thành ngữ/liên quan) làm 1 mục "Đào sâu" duy nhất, thu gọn
// mặc định (bấm mũi tên để xổ xuống) — trước đây mỗi nhóm là 1 khối riêng có đường kẻ nét đứt
// ngăn cách phía trên (.def-related-divider), giờ bỏ hết các đường kẻ đó, chỉ giữ lại nhãn nhỏ
// (vd "Từ đồng nghĩa") phân biệt từng nhóm bên trong nội dung đã xổ xuống.
function renderAllRelWordSections(def, currentWordId) {
  const groups = renderRelWordList(def.synonyms, currentWordId, 'คำพ้องความ · Từ đồng nghĩa', REL_ICON_SYNONYM)
    + renderRelWordList(def.antonyms, currentWordId, 'คำตรงข้าม · Từ trái nghĩa', REL_ICON_ANTONYM)
    + renderRelWordList(def.idioms, currentWordId, 'สำนวน · Thành ngữ', REL_ICON_IDIOM)
    + renderRelWordList(def.related, currentWordId, 'คำเกี่ยวข้อง · Từ liên quan', REL_ICON_RELATED);
  if (!groups) return '';
  return '<button type="button" class="def-explore-toggle" onclick="toggleExploreSection(this)">'
    + REL_ICON_EXPLORE + '<span>Đào sâu</span>'
    + '<svg class="def-explore-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    + '</button>'
    + '<div class="def-explore-content" style="display:none">' + groups + '</div>';
}

// Bấm mũi tên "Đào sâu" để xổ xuống/thu gọn danh sách đồng nghĩa/trái nghĩa/thành ngữ/liên
// quan — mặc định LUÔN thu gọn (display:none đặt sẵn trong renderAllRelWordSections ở trên),
// giống cách toggleExtraExamples() xổ thêm ví dụ.
function toggleExploreSection(btn) {
  const content = btn.nextElementSibling;
  if (!content || !content.classList.contains('def-explore-content')) return;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? '' : 'none';
  btn.classList.toggle('open', isHidden);
}

// Bấm dòng kẻ "Xem thêm (N) nghĩa" kiểu GitHub (xem buildDefinitionsHTML) — xổ/thu gọn khối
// định nghĩa admin đã tích "Ẩn". Đổi luôn chữ + mũi tên khi đang mở (giống nút "..." của
// GitHub đổi thành "Ẩn bớt" sau khi bấm), để có thể thu gọn lại nếu muốn.
function toggleHiddenDefs(btn) {
  const content = btn.nextElementSibling;
  if (!content || !content.classList.contains('def-hidden-defs')) return;
  const label = btn.querySelector('.def-hidden-toggle-text');
  const count = content.querySelectorAll('.def-block').length;
  const isHidden = content.style.display === 'none';
  content.style.display = isHidden ? '' : 'none';
  btn.classList.toggle('open', isHidden);
  if (label) label.textContent = isHidden ? ('Ẩn bớt ' + count + ' nghĩa') : ('Xem thêm ' + count + ' nghĩa');
}

// Icon bookmark dùng cho nút "yêu thích" ở mỗi định nghĩa — thay cho icon trái tim trước đây.
// Khi đã lưu (active=true): tô đặc (fill=currentColor) + đổi màu sang xanh accent (xem CSS
// .def-fav-btn.active). Icon trái tim ở thanh menu bên (#navFavoritesBtn) đã đổi riêng sang
// icon library-big (thư viện) — không dùng chung path này nữa, xem index.html.
const BOOKMARK_SHAPE_PATH = 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z';
// Tooltip mặc định "Lưu/Bỏ yêu thích" — nếu đã lưu và đang nằm trong 1+ thư mục, đổi tooltip
// thành liệt kê tên các thư mục đó (vd: Đã lưu trong: 'Đồ ăn' 'Nhà cửa') để biết ngay không cần
// mở popup — xem addDefToFolder/removeDefFromFolder ở nơi cập nhật favFolderMap.
function buildDefHeartBtn(wordId, defIndex) {
  const active = isFavDef(wordId, defIndex);
  const folderIds = active ? (favFolderMap[favKey(wordId, defIndex)] || []) : [];
  let tooltip = active ? 'Bỏ yêu thích nghĩa này' : 'Lưu nghĩa này vào yêu thích';
  if (folderIds.length) {
    const names = folderIds.map(fid => { const f = favoriteFolders.find(x => x.id === fid); return f ? f.name : null; }).filter(Boolean);
    if (names.length) tooltip = 'Đã lưu trong: ' + names.map(n => "'" + n + "'").join(' ');
  }
  return '<button class="def-fav-btn tooltip-right' + (active ? ' active' : '') + '" onclick="event.stopPropagation(); onDefFavClick(' + wordId + ', ' + defIndex + ')" aria-label="' + (active ? 'Bỏ yêu thích nghĩa này' : 'Lưu nghĩa này vào yêu thích') + '" data-tooltip="' + escapeHtml(tooltip) + '">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="' + BOOKMARK_SHAPE_PATH + '"/>'
    + '</svg></button>';
}


// Icon ghim (📌) đứng NGAY TRƯỚC từ loại, ở đầu header mỗi định nghĩa (đã thế chỗ mũi tên
// accordion cũ) — bấm để đẩy định nghĩa này lên đầu danh sách hiển thị ngay tại trang đang xem
// (xem cách sắp xếp lại trong buildDefinitionsHTML). Ghim được cả khi chưa đăng nhập (lưu
// tạm ở localStorage, tự đẩy lên tài khoản khi đăng nhập sau) — xem onDefPinClick.
// Dùng tooltip-left (không phải tooltip-right) vì icon nằm gần MÉP TRÁI header — tooltip cần mở
// rộng sang phải mới không bị .def-block (overflow:hidden) cắt mất, xem class .tooltip-left
// trong style.css.
function buildDefPinBtn(wordId, defIndex) {
  const active = isDefPinned(wordId, defIndex);
  return '<button type="button" class="def-pin-btn tooltip-left' + (active ? ' active' : '') + '" onclick="event.stopPropagation(); onDefPinClick(' + wordId + ', ' + defIndex + ')" aria-label="' + (active ? 'Bỏ ghim định nghĩa này' : 'Ghim định nghĩa này lên đầu') + '" data-tooltip="' + (active ? 'Bỏ ghim định nghĩa này' : 'Ghim định nghĩa này lên đầu') + '">'
    + '<svg width="17" height="17" viewBox="0 0 24 24" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1z"/>'
    + '</svg></button>';
}

// Ghi chú cũ (trước khi gộp) tách 2 ô riêng noteDef/noteExample, dạng chữ thường (không HTML).
// Từ nay chỉ còn 1 ô noteDef duy nhất, cho phép rich text (đậm/nghiêng/gạch chân). Khi hiển thị
// lần đầu sau khi gộp: nếu noteDef đã là rich text (có thẻ HTML, tức đã được lưu bằng ô mới) thì
// dùng thẳng; nếu vẫn là chữ thường kiểu cũ thì ghép chung với noteExample cũ (nếu có), chuyển
// thành HTML an toàn (escape + đổi xuống dòng thành <br>) để không mất ghi chú cũ của người dùng.
// Kiểm tra 1 chuỗi HTML có CHỮ THẬT hay không (bỏ qua thẻ HTML rỗng như "<br>", "<p></p>" —
// contenteditable đôi khi tự chèn mấy thẻ này dù người dùng chưa gõ gì, nếu chỉ kiểm tra chuỗi
// có rỗng hay không (truthy) sẽ tính nhầm là "đã có nội dung"). Dùng DOM textContent để lấy
// đúng phần chữ hiển thị, bỏ hết thẻ.
function htmlHasVisibleText(html) {
  if (!html) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').trim().length > 0;
}

function buildNoteInitialHTML(note) {
  if (!note) return '';
  const looksLikeHTML = note.noteDef && /<[a-zA-Z][^>]*>/.test(note.noteDef);
  if (looksLikeHTML) return note.noteDef;
  const parts = [];
  if (note.noteDef) parts.push(escapeHtml(note.noteDef).replace(/\n/g, '<br>'));
  if (note.noteExample) parts.push(escapeHtml(note.noteExample).replace(/\n/g, '<br>'));
  return parts.join('<br><br>');
}

// Khung ghi chú giờ nằm NGOÀI khung ví dụ (.def-body), đặt thành khối riêng LUÔN hiển thị ngay
// dưới khung ví dụ — không cần mở accordion "Xem ví dụ" mới thấy/ghi chú được nữa. Mặc định CHỈ
// hiện khung khi đã có sẵn nội dung ghi chú THẬT (dùng htmlHasVisibleText, không chỉ kiểm tra
// chuỗi rỗng hay không — tránh trường hợp lưu nhầm "<br>" rỗng khiến khung cứ hiện mãi dù không
// có chữ nào); nếu chưa có ghi chú, chỉ hiện 1 nút nhỏ "Thêm ghi chú" (icon notebook-pen) — bấm
// vào mới hiện khung để gõ.
function buildDefNoteHTML(wordId, defIndex) {
  const key = favKey(wordId, defIndex);
  if (!favorites.includes(key)) return '';
  const note = favNotesMap[key] || {};
  const hasContent = htmlHasVisibleText(note.noteDef) || htmlHasVisibleText(note.noteExample);
  const addBtnHTML = hasContent ? '' : '<button type="button" class="def-note-add-btn" onclick="event.stopPropagation(); toggleDefNoteBox(this)" aria-label="Thêm ghi chú của bạn">'
    + NOTEBOOK_PEN_ICON(14) + '<span>Thêm ghi chú của bạn</span></button>';
  const boxHTML = '<div class="def-note-box' + (hasContent ? '' : ' collapsed') + '" onclick="event.stopPropagation()">'
    + '<div class="def-note-label">' + NOTEBOOK_PEN_ICON(14) + ' Ghi chú của bạn'
    + '<span class="def-note-saved-msg">Đã lưu ✓</span></div>'
    + '<div class="def-note-area" contenteditable="true" data-placeholder="Định nghĩa và ví dụ của riêng bạn"'
    + ' onblur="onDefNoteBlur(' + wordId + ', ' + defIndex + ', this)">'
    + buildNoteInitialHTML(note) + '</div>'
    + '</div>';
  return '<div class="def-note-section">' + addBtnHTML + boxHTML + '</div>';
}

// Icon notebook-pen (sổ tay + bút) dùng cho nút mở ghi chú và nhãn khung ghi chú — 1 hàm sinh
// SVG theo kích thước truyền vào thay vì lặp lại code SVG.
function NOTEBOOK_PEN_ICON(size) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>';
}

// Bấm nút "Thêm ghi chú" → mở khung ghi chú, đưa focus luôn vào ô nhập cho tiện gõ ngay, đồng
// thời ẩn hẳn nút "Thêm ghi chú" (đã có khung mở ngay dưới rồi, không cần nút thừa nữa).
function toggleDefNoteBox(btn) {

  const block = btn.closest('.def-block');
  const box = block ? block.querySelector('.def-note-box') : null;
  if (!box) return;
  box.classList.remove('collapsed');
  btn.style.display = 'none'; // ẩn hẳn nút "Thêm ghi chú" — khung đã mở ngay dưới, không cần nút thừa
  const area = box.querySelector('.def-note-area');
  if (area) area.focus();
}

// Lệnh định dạng (đậm/nghiêng/gạch chân) vẫn dùng được qua phím tắt trình duyệt (Ctrl+B/I/U)
// ngay trên ô contenteditable — không cần thanh công cụ riêng để giữ khung ghi chú gọn như cũ.

// Lưu ghi chú khi rời khỏi ô (chỉ còn 1 trường noteDef duy nhất từ nay), và hiện thông báo
// "Đã lưu ✓" mờ dần — cho người dùng yên tâm ghi chú không bị mất. Đã bỏ bộ đếm ký tự (trước
// đây hiện góc phải khi đang gõ) để khung ghi chú gọn hơn, không cần theo dõi độ dài nữa.
async function onDefNoteBlur(wordId, defIndex, areaEl) {
  const wrap = areaEl.closest('.def-note-box');
  const rawHtml = areaEl.innerHTML.trim();
  // Chuẩn hoá về '' nếu không có chữ thật (vd chỉ có "<br>" rỗng do contenteditable tự chèn) —
  // tránh lưu rác khiến hasContent tính nhầm là "đã có ghi chú" ở lần render sau (xem
  // htmlHasVisibleText/buildDefNoteHTML).
  const finalHtml = htmlHasVisibleText(rawHtml) ? rawHtml : '';
  await saveDefNote(wordId, defIndex, 'noteDef', finalHtml);
  const savedMsg = wrap && wrap.querySelector('.def-note-saved-msg');
  if (savedMsg) {
    savedMsg.classList.remove('show');
    void savedMsg.offsetWidth; // ép reflow để animation chạy lại từ đầu mỗi lần lưu
    savedMsg.classList.add('show');
  }
}

// Loại từ lưu dạng "คำกริยา - Động từ" (có thể nhiều cặp nối bằng dấu phẩy) — hiển thị đổi
// dấu gạch ngang giữa 2 phần tiếng Thái/tiếng Việt thành dấu chấm cho gọn, không đổi dữ liệu gốc
function formatDefType(type) {
  return (type || '').replace(/\s-\s/g, ' · ');
}

// Nút "⋯" (3 chấm) ở góc phải trên mỗi ví dụ — gom 3 thao tác vào 1 nút: Phát âm (đọc cả câu), Phiên âm (hiện phiên âm dưới từng từ có trong từ điển),
// Xem video (chỉ khi ví dụ có gắn video YouTube). Thông tin video lưu ở data-* của nút; menu thật là 1 phần tử #exMenu gắn thẳng vào <body> (xem openExMenu)
// vì .def-block có overflow:hidden + có thể có backdrop-filter nên menu đặt bên trong sẽ bị cắt / lệch vị trí.
// Phụ đề tự viết của video ví dụ: tra theo khóa "mã video|bắt đầu|kết thúc" (đúng 3 giá trị mà openExampleVideo nhận) để không phải nhét cả
// mảng phụ đề vào thuộc tính HTML của từng nút. Chuẩn hóa về {start,end,thai,viet} (dữ liệu cũ dạng {text} → thai) và sắp theo thời gian.
const exVideoCaptionsMap = {};
function exVideoKey(id, start, end) { return id + '|' + (start != null && start !== '' ? Number(start) : '') + '|' + (end != null && end !== '' ? Number(end) : ''); }
function normalizeVideoCaptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    start: Number(c && c.start), end: Number(c && c.end),
    thai: String((c && (c.thai != null ? c.thai : c.text)) || '').trim(),
    viet: String((c && c.viet) || '').trim()
  })).filter(c => isFinite(c.start) && isFinite(c.end) && c.end > c.start && (c.thai || c.viet)).sort((a, b) => a.start - b.start);
}
function registerExVideoCaptions(v) {
  if (!v || !v.youtubeId) return;
  const caps = normalizeVideoCaptions(v.captions);
  if (caps.length) exVideoCaptionsMap[exVideoKey(v.youtubeId, v.start, v.end)] = { caps: caps, showDefault: !!v.showCaptions };
}

function buildExMenuBtn(ex) {
  const v = ex && ex.video && ex.video.youtubeId ? ex.video : null;
  registerExVideoCaptions(v);
  const videoAttrs = v
    ? ' data-video-id="' + v.youtubeId + '" data-video-start="' + (v.start != null ? v.start : '') + '" data-video-end="' + (v.end != null ? v.end : '') + '"'
    : '';
  return '<button type="button" class="def-ex-menu-btn" aria-label="Tùy chọn cho ví dụ" aria-haspopup="menu" aria-expanded="false" title="Phát âm · Phiên âm' + (v ? ' · Video' : '') + '"'
    + videoAttrs + ' onclick="toggleExMenu(this, event)">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>'
    + '</button>';
}

const EX_MENU_ICONS = {
  speak: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  phon: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  video: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none"/></svg>'
};
let exMenuBtn = null;

function getExMenuEl() {
  let el = document.getElementById('exMenu');
  if (!el) {
    el = document.createElement('div');
    el.id = 'exMenu';
    el.className = 'ex-menu';
    el.setAttribute('role', 'menu');
    document.body.appendChild(el);
  }
  return el;
}

function toggleExMenu(btn, e) {
  if (e) e.stopPropagation();
  const wasOpen = exMenuBtn === btn;
  closeExMenu();
  if (!wasOpen) openExMenu(btn);
}

function openExMenu(btn) {
  const menu = getExMenuEl();
  const item = btn.closest('.def-ex-item');
  const phonOn = !!(item && item.classList.contains('show-phon'));
  const mk = (kind, label) => '<button type="button" role="menuitem" class="ex-menu-item" onclick="onExMenuAction(\'' + kind + '\')">' + EX_MENU_ICONS[kind] + '<span>' + label + '</span></button>';
  menu.innerHTML = mk('speak', 'Phát âm') + mk('phon', phonOn ? 'Ẩn phiên âm' : 'Hiện phiên âm') + (btn.dataset.videoId ? mk('video', 'Xem video') : '');
  menu.classList.add('show');
  // Đặt ngay dưới nút, canh mép phải theo nút; hết chỗ phía dưới thì mở lên trên.
  const r = btn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  exMenuBtn = btn;
  btn.classList.add('menu-open');
  btn.setAttribute('aria-expanded', 'true');
}

function closeExMenu() {
  const menu = document.getElementById('exMenu');
  if (menu) menu.classList.remove('show');
  if (exMenuBtn) { exMenuBtn.classList.remove('menu-open'); exMenuBtn.setAttribute('aria-expanded', 'false'); }
  exMenuBtn = null;
}
document.addEventListener('click', e => { if (exMenuBtn && !e.target.closest('#exMenu')) closeExMenu(); });
window.addEventListener('scroll', () => { if (exMenuBtn) closeExMenu(); }, true);
window.addEventListener('resize', () => { if (exMenuBtn) closeExMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && exMenuBtn) closeExMenu(); });

function onExMenuAction(kind) {
  const btn = exMenuBtn;
  closeExMenu();
  if (!btn) return;
  if (kind === 'speak') {
    speakText(getExampleSpeakText(btn), btn); // btn tự có class "playing" khi đang đọc
  } else if (kind === 'phon') {
    toggleExamplePhonetics(btn.closest('.def-ex-item'));
  } else if (kind === 'video') {
    const num = v => (v === '' || v == null) ? null : Number(v);
    openExampleVideo(btn, btn.dataset.videoId, num(btn.dataset.videoStart), num(btn.dataset.videoEnd));
  }
}

// Câu tiếng Thái "sạch" để đọc: bỏ phần phiên âm (<rt>) nếu đang hiện, gộp khoảng trắng. Nhãn ngữ cảnh "(...)" và số thứ tự nằm ở phần tử khác nên không lẫn vào.
function getExampleSpeakText(btn) {
  const el = btn.closest('.def-ex-item') && btn.closest('.def-ex-item').querySelector('.def-ex-thai-text');
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('rt').forEach(n => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

// Phiên âm tự lấy từ chính các từ đã có trong từ điển: chỉ những từ được biến thành link (.def-word-link, khớp từ điển) mới có phiên âm hiện dưới chữ
// (dùng <ruby> — canh dưới từng từ, không làm lệch dòng); từ không có trong từ điển (trợ từ, tên riêng, số…) để nguyên, không bịa phiên âm.
function toggleExamplePhonetics(item) {
  if (!item) return;
  const textEl = item.querySelector('.def-ex-thai-text');
  if (!textEl) return;
  const turnOn = !item.classList.contains('show-phon');
  const links = textEl.querySelectorAll('.def-word-link[data-word-id]');
  if (turnOn) {
    let count = 0;
    links.forEach(sp => {
      if (sp.querySelector('ruby')) { count++; return; }
      const w = allWords.find(x => String(x.id) === sp.dataset.wordId);
      const tmp = document.createElement('div');
      tmp.innerHTML = (w && w.phonetic) || '';
      const phon = tmp.textContent.trim();
      if (!phon) return;
      const base = sp.textContent;
      sp.dataset.base = base;
      sp.textContent = '';
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(base));
      const rt = document.createElement('rt');
      rt.className = 'def-ex-rt';
      rt.textContent = phon;
      ruby.appendChild(rt);
      sp.appendChild(ruby);
      count++;
    });
    if (!count) { showToast('Chưa có phiên âm cho các từ trong ví dụ này'); return; }
    item.classList.add('show-phon');
  } else {
    links.forEach(sp => { if (sp.querySelector('ruby')) sp.textContent = sp.dataset.base || sp.textContent; });
    item.classList.remove('show-phon');
  }
}

// Icon video ở góc phải trên header mỗi định nghĩa — hiện nếu định nghĩa đó có
// ít nhất 1 ví dụ gắn video, bấm vào mở luôn video của ví dụ đầu tiên có video
// (không cần mở accordion để bấm icon trong từng ví dụ)
function buildDefVideoBtn(def) {
  const examples = (def && def.examples) || [];
  const withVideo = examples.find(ex => ex && ex.video && ex.video.youtubeId);
  if (!withVideo) return '';
  registerExVideoCaptions(withVideo.video);
  const start = withVideo.video.start != null ? withVideo.video.start : 'null';
  const end = withVideo.video.end != null ? withVideo.video.end : 'null';
  return '<button type="button" class="def-header-video-btn tooltip-below" aria-label="Xem video minh họa" data-tooltip="Xem video minh họa"'
    + ' onclick="event.stopPropagation(); openExampleVideo(this,\'' + withVideo.video.youtubeId + '\',' + start + ',' + end + ')">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<circle cx="12" cy="12" r="9"/><polygon points="10 8.5 16 12 10 15.5" fill="currentColor" stroke="none"/></svg>'
    + '</button>';
}

// Icon ảnh minh họa ở góc phải header mỗi định nghĩa — hiện nếu admin đã gắn 1 ảnh cho định
// nghĩa đó (def.image = {url, path}), bấm vào mở ảnh phóng to (lightbox), không cần mở accordion.
function buildDefImageBtn(def) {
  if (!def || !def.image || !def.image.url) return '';
  const url = def.image.url;
  return '<button type="button" class="def-header-image-btn tooltip-below" aria-label="Xem ảnh minh họa" data-tooltip="Xem ảnh minh họa"'
    + ' onclick="event.stopPropagation(); openDefImage(\'' + url.replace(/'/g, "\\'") + '\')">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
    + '</button>';
}

// Mở/đóng modal xem ảnh minh họa phóng to (lightbox), dùng chung cho mọi định nghĩa có ảnh
function openDefImage(url) {
  const img = document.getElementById('defImageModalImg');
  if (img) img.src = url;
  document.getElementById('defImageModal').classList.add('show');
}
function closeDefImage() {
  document.getElementById('defImageModal').classList.remove('show');
  const img = document.getElementById('defImageModalImg');
  if (img) img.src = ''; // giải phóng bộ nhớ ảnh đang tải, tránh giữ ảnh lớn khi đóng modal
}

// Nhiều định nghĩa/ví dụ có ghi chú ngữ cảnh trong ngoặc đơn NGAY ĐẦU câu (admin gõ trực tiếp
// trong ô nhập, không phải trường riêng) — vd "(ภาษาปาก) เปล่งเสียง...", "(Khẩu ngữ) Phát ra
// âm thanh...". Để lẫn trong câu thì không nổi bật; tách phần trong ngoặc ra để hiển thị thành
// nhãn nhỏ RIÊNG (giống kiểu từ điển khác: nhãn xám nhỏ nằm phía trên định nghĩa/ví dụ), còn lại
// mới là nội dung định nghĩa/ví dụ thật sự.
// Dùng DOM thật (không phải regex trên chuỗi HTML thô) vì ô nhập là rich-text editor — nội dung
// có thể bị trình duyệt bọc thêm thẻ ở đầu (vd "<div>(ภาษาปาก) ...</div>") tuỳ cách admin gõ/xuống
// dòng, nên chỉ so khớp "^\(" trên chuỗi thô sẽ bỏ sót các trường hợp có thẻ bọc trước dấu ngoặc.
// Duyệt tới TEXT NODE có nội dung đầu tiên (bỏ qua text rỗng/toàn khoảng trắng), kiểm tra text
// node đó có bắt đầu bằng "(...)" hay không — nếu có, cắt phần ngoặc ra khỏi đúng text node đó rồi
// dựng lại innerHTML, giữ nguyên mọi thẻ bao quanh (không phá cấu trúc HTML còn lại).
function extractLeadingTag(html) {
  if (!html) return { tag: '', rest: html || '' };
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !(node.nodeValue && node.nodeValue.trim())) node = walker.nextNode();
  if (!node) return { tag: '', rest: html };
  const m = node.nodeValue.match(/^\s*\(([^()]+)\)\s*/);
  if (!m) return { tag: '', rest: html };
  node.nodeValue = node.nodeValue.slice(m[0].length);
  return { tag: m[1].trim(), rest: wrap.innerHTML };
}
// Nhãn đặt PHÍA TRÊN dòng nghĩa/ví dụ — chữ thường (không khung/nền), có ngoặc đơn bao quanh
// giống văn bản gốc, chỉ khác là đứng RIÊNG 1 dòng thay vì lẫn vào đầu câu.
function buildUsageTagHTML(tag, cssClass) {
  return tag ? '<div class="' + cssClass + '">(' + tag + ')</div>' : '';
}


// exIndex: chỉ số GỐC của ví dụ trong def.examples (không đổi dù thứ tự hiển thị bị xáo lại do
// ghim) — dùng để lưu/tra đúng trạng thái ghim qua pinnedExMap, độc lập với j (vị trí hiển thị,
// chỉ dùng để đánh số thứ tự 1./2./3... trên màn hình).
// Mỗi dòng (nhãn ngữ cảnh / câu Thái / bản dịch Việt) đều là 1 hàng flex riêng, ô đầu hàng luôn
// là "ô số" — hàng câu Thái chứa số thật, các hàng còn lại chứa 1 BẢN SAO y hệt nhưng ẩn đi
// (visibility:hidden, vẫn chiếm chỗ). Nhờ nội dung giống hệt nhau, trình duyệt tự tính ra bề
// rộng bằng nhau cho mọi ô số dù số 1 chữ số hay 2 chữ số — nên câu Thái và câu Việt LUÔN bắt
// đầu đúng cùng 1 vị trí, không cần đoán 1 con số pixel cố định (vốn sẽ sai ngay khi gặp số ví
// dụ ≥ 10, ví dụ "๒๑ (21)" rộng hơn "๑ (1)" nên đẩy lệch dòng — đúng lỗi đã gặp).
function buildExItemHTML(ex, j, wordId, defIndex, exIndex) {
  // Icon ghim ví dụ nằm TRONG ô số thật (numCellHTML) — CSS đặt nó position:absolute right:100%
  // so với chính ô số này, nên tự động rơi vào khoảng trắng padding-left:3.2rem có sẵn của
  // .def-body-inner, KHÔNG đẩy chữ ví dụ sang phải. Chỉ thêm vào numCellHTML (dòng câu Thái thật),
  // KHÔNG thêm vào numCellSpacerHTML (dòng nhãn/bản dịch) — vì icon chỉ cần xuất hiện 1 lần cho cả
  // ví dụ, và nhờ position:absolute nó không cộng thêm bề rộng nên spacer vẫn thẳng hàng bình thường.
  const pinBtnHTML = buildExPinBtn(wordId, defIndex, exIndex);
  const numCellInner = '<span class="def-ex-num-thai">' + (THAI_NUMS_DEF[j]||j+1) + '</span>' + buildNumBadgeHTML(j+1, 'def-ex-num-badge');
  const numCellHTML = '<span class="def-ex-num-cell">' + pinBtnHTML + numCellInner + '</span>';
  const numCellSpacerHTML = '<span class="def-ex-num-cell def-ex-num-cell-spacer" aria-hidden="true">' + numCellInner + '</span>';

  const thaiParsed = extractLeadingTag(ex.thai || '');
  const vietParsed = extractLeadingTag(ex.viet || '');

  const thaiTagRow = thaiParsed.tag ? '<div class="def-ex-row">' + numCellSpacerHTML + '<span class="def-ex-usage-tag">(' + thaiParsed.tag + ')</span></div>' : '';
  const thaiRow = ex.thai ? '<div class="def-ex-row">' + numCellHTML + '<span class="def-ex-thai-text">' + thaiParsed.rest + '</span></div>' : '';
  const vietTagRow = vietParsed.tag ? '<div class="def-ex-row">' + numCellSpacerHTML + '<span class="def-ex-usage-tag">(' + vietParsed.tag + ')</span></div>' : '';
  const vietRow = ex.viet ? '<div class="def-ex-row">' + numCellSpacerHTML + '<span class="def-ex-viet">' + vietParsed.rest + '</span></div>' : '';

  const pinned = isExamplePinned(wordId, defIndex, exIndex);
  // def-ex-icons giờ chỉ chứa nút "⋯" (Phát âm / Phiên âm / Video) — icon ghim đã dời vào numCellHTML ở trên.
  const iconsHTML = '<div class="def-ex-icons">' + buildExMenuBtn(ex) + '</div>';
  return '<div class="def-ex-item' + (pinned ? ' pinned' : '') + '">' + iconsHTML + thaiTagRow + thaiRow + vietTagRow + vietRow + '</div>';
}

// Icon ghim (📌) đặt bên trong ô số, hiện ở BÊN TRÁI số thứ tự ví dụ (xem CSS .def-ex-pin-btn) —
// ghim 1 ví dụ cụ thể, đẩy lên đầu danh sách ví dụ của ĐÚNG định nghĩa đó, kể cả đang nằm trong
// phần "Xem thêm" bị ẩn cũng sẽ nổi lên nhóm 5 ví dụ hiển thị mặc định. Ghim được cả khi chưa
// đăng nhập (lưu tạm ở localStorage, tự đẩy lên tài khoản khi đăng nhập sau) — xem
// onExamplePinClick. Dùng tooltip-left (không phải tooltip-right) vì icon nằm sát MÉP TRÁI của
// khung ví dụ — tooltip-right trước đây khiến tooltip mở rộng càng sang trái, bị cắt mất bởi
// overflow:hidden của .def-block; tooltip-left mở rộng sang phải nên không còn bị che nữa.
function buildExPinBtn(wordId, defIndex, exIndex) {
  const active = isExamplePinned(wordId, defIndex, exIndex);
  return '<button type="button" class="def-ex-pin-btn tooltip-below tooltip-left' + (active ? ' active' : '') + '" onclick="event.stopPropagation(); onExamplePinClick(' + wordId + ', ' + defIndex + ', ' + exIndex + ')" aria-label="' + (active ? 'Bỏ ghim ví dụ này' : 'Ghim ví dụ này lên đầu') + '" data-tooltip="' + (active ? 'Bỏ ghim ví dụ này' : 'Ghim ví dụ này lên đầu') + '">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1z"/>'
    + '</svg></button>';
}

// Chỉ hiện sẵn 5 ví dụ đầu, còn lại gấp lại sau nút "Xem thêm" — tránh 1 định nghĩa có quá
// nhiều ví dụ làm trang dài lê thê khi mở accordion.
const DEF_EX_SHOW_LIMIT = 5;
// wordId/defIndex: dùng để tra + lưu trạng thái ghim đúng định nghĩa. Ví dụ đã ghim được đưa lên
// đầu (ghim gần đây nhất trước), phần còn lại GIỮ NGUYÊN thứ tự gốc admin nhập — số thứ tự 1./2.
// hiển thị trên màn hình đánh lại theo vị trí MỚI sau khi ghim, không theo thứ tự gốc trong dữ liệu.
function buildExamplesHTML(examples, wordId, defIndex) {
  const indexed = examples.map((ex, idx) => ({ ex, idx }));
  indexed.sort((a, b) => {
    const aPinned = isExamplePinned(wordId, defIndex, a.idx);
    const bPinned = isExamplePinned(wordId, defIndex, b.idx);
    if (aPinned && bPinned) {
      return pinnedExMap[pinExKey(wordId, defIndex, b.idx)] - pinnedExMap[pinExKey(wordId, defIndex, a.idx)];
    }
    if (aPinned) return -1;
    if (bPinned) return 1;
    return a.idx - b.idx;
  });
  const shown = indexed.slice(0, DEF_EX_SHOW_LIMIT);
  const extra = indexed.slice(DEF_EX_SHOW_LIMIT);
  let html = shown.map((item, j) => buildExItemHTML(item.ex, j, wordId, defIndex, item.idx)).join('');
  if (extra.length) {
    html += '<div class="def-ex-extra" style="display:none">'
      + extra.map((item, j) => buildExItemHTML(item.ex, j + DEF_EX_SHOW_LIMIT, wordId, defIndex, item.idx)).join('')
      + '</div>'
      + '<button type="button" class="def-ex-more-btn" onclick="toggleExtraExamples(this)"><span class="def-ex-more-btn-label">Xem thêm ' + extra.length + ' ví dụ</span><svg class="def-ex-more-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>';
  }
  return html;
}

function toggleExtraExamples(btn) {
  const extraEl = btn.previousElementSibling;
  if (!extraEl || !extraEl.classList.contains('def-ex-extra')) return;
  const isHidden = extraEl.style.display === 'none';
  extraEl.style.display = isHidden ? '' : 'none';
  btn.classList.toggle('open', isHidden);
  const label = btn.querySelector('.def-ex-more-btn-label');
  if (label) label.textContent = isHidden ? 'Thu gọn ví dụ' : ('Xem thêm ' + extraEl.children.length + ' ví dụ');
}


// Ô "đoán trước" (active recall) — gợi ý người dùng tự nghĩ ra từ/ý nghĩa tiếng Việt phù hợp
// với định nghĩa vừa đọc, TRƯỚC khi mở accordion xem ví dụ, thay vì chỉ đọc thẳng đáp án.
// Chỉ mang tính gợi ý (không bắt buộc gõ, không chấm đúng/sai, không lưu lại nội dung đã gõ) —
// người dùng vẫn bấm mở ví dụ bất cứ lúc nào.
// Dòng tự đánh giá mức độ nhớ ("Bạn thấy mình nhớ từ này ở mức nào?") xuất hiện SAU khi mở ví dụ
// (đáp án đã lộ ra) cho MỌI nghĩa, kể cả nghĩa CHƯA lưu yêu thích — 5 mức (Mới gặp/Đang làm
// quen/Đã hiểu/Đã quen/Làm chủ, icon mặt trăng khuyết dần→tròn) ánh xạ THẲNG 1-1 vào 5 hộp Leitner
// sẵn có (favSrsMap[key].box) — bấm 1 mức là SET THẲNG hộp đó luôn (không tăng/giảm dần như kiểu
// đúng/sai nhị phân cũ), tự nhiên và chính xác hơn vì người học tự biết rõ mình đang ở mức nào
// hơn là chỉ trả lời đúng/sai 1 câu. Xem setDefSrsLevel()/onGuessMemoryLevel() bên dưới — CÙNG 1
// thang này cũng được dùng lại nguyên trong Review Mode (renderReviewSelfCheckInto/
// onReviewSelfCheckLevel) thay cho 2 nút Đúng/Sai nhị phân cũ, để cả app chỉ còn 1 ngôn ngữ tương
// tác duy nhất cho việc tự đánh giá — không tạo hệ SRS thứ 2 song song. Vì hàng đợi ôn tập
// (buildReviewQueue) chỉ lọc theo Object.keys(favSrsMap), nghĩa CHƯA lưu sẽ được TỰ ĐỘNG lưu vào
// "Chưa phân loại" ngay lúc bấm (tái dùng đúng setDefUncategorized() đang chạy cho nút "Chưa phân
// loại" ở bộ chọn thư mục) để có chỗ trong hàng đợi ôn — không hỏi lại thư mục (giữ thao tác 1
// bấm, không làm gián đoạn).
// onclick stopPropagation để bấm/gõ vào ô này không vô tình đóng/mở accordion (dù thực ra chỉ
// .def-header-top mới có onclick toggleDef, thêm cho chắc vì .def-summary đứng ngay sát đó).
const GUESS_MEMORY_LEVELS = [
  { level: 1, emoji: '🌑', label: 'Mới gặp' },
  { level: 2, emoji: '🌒', label: 'Đang làm quen' },
  { level: 3, emoji: '🌓', label: 'Đã hiểu' },
  { level: 4, emoji: '🌔', label: 'Đã quen' },
  { level: 5, emoji: '🌕', label: 'Làm chủ' }
];
function buildGuessInputHTML(wordId, defIndex) {
  return '<div class="def-guess-box" onclick="event.stopPropagation()">'
    + '<input type="text" class="def-guess-input" autocomplete="off" spellcheck="false"'
    + ' placeholder="Thử đoán từ xem nào, trước khi...">'
    + '<button type="button" class="def-guess-btn" onclick="toggleDef(this)"><span class="def-guess-btn-label">Xem ví dụ</span><svg class="def-guess-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
    + '</div>';
}

// Khung tự đánh giá mức hiểu — hiển thị như 1 THANH TIẾN TRÌNH 5 nấc (icon mặt trăng đặt trên 1
// đường kẻ ngang, phần đã đạt tô đậm màu accent). Có TIÊU ĐỀ CỐ ĐỊNH bên trên (luôn hiện, giải
// thích 5 icon này để làm gì kể cả với nghĩa đã từng đánh giá trước đó) + 1 dòng chữ TRẠNG THÁI
// bên dưới (buildGuessCaptionText, đọc thẳng favSrsMap[key] lúc RENDER) — thay cho toast thoáng
// qua lúc bấm (toast biến mất, quay lại trang là mất dấu vết, không biết mình từng chấm ở mức
// nào). Tách RIÊNG khỏi buildGuessInputHTML() ở trên, đặt SAU khung ví dụ (.def-body) và TRƯỚC
// khung ghi chú (noteHTML) trong renderDefBlock. Vẫn chỉ lộ ra khi .def-block đã mở (đáp án/ví dụ
// đã hiện) nhờ CSS .def-block.open .def-guess-selfcheck.
function buildGuessSelfCheckHTML(wordId, defIndex) {
  const key = favKey(wordId, defIndex);
  const srs = favSrsMap[key];
  if (srs && srs.ignored) {
    return '<div class="def-guess-selfcheck">'
      + '<div class="def-guess-ignored-row">'
      + '<span class="def-guess-ignored-text">Đã bỏ qua nghĩa này, không đưa vào Ôn tập</span>'
      + '<button type="button" class="def-guess-ignore-toggle" onclick="event.stopPropagation(); onToggleDefIgnored(' + wordId + ',' + defIndex + ')">Theo dõi lại</button>'
      + '</div></div>';
  }
  const currentLevel = srs ? srs.box : 0;
  const segsHTML = GUESS_MEMORY_LEVELS.map(function(l) {
    const cls = 'def-guess-level-seg' + (l.level <= currentLevel ? ' filled' : '') + (l.level === currentLevel ? ' current' : '');
    return '<button type="button" class="' + cls + '" data-level="' + l.level + '" title="' + l.label + '"'
      + ' onclick="event.stopPropagation(); onGuessMemoryLevel(' + wordId + ',' + defIndex + ',' + l.level + ',this)">' + l.emoji + '</button>';
  }).join('');
  const fillPct = currentLevel > 0 ? Math.round((currentLevel - 1) / 4 * 100) : 0;
  return '<div class="def-guess-selfcheck">'
    + '<div class="def-guess-selfcheck-titlerow">'
    + '<span class="def-guess-selfcheck-title">Bạn hiểu nghĩa này ở mức nào?</span>'
    + '<button type="button" class="def-guess-ignore-toggle" onclick="event.stopPropagation(); onToggleDefIgnored(' + wordId + ',' + defIndex + ')">Không quan tâm</button>'
    + '</div>'
    + '<div class="def-guess-level-track">'
    + '<div class="def-guess-level-line"><div class="def-guess-level-line-fill" style="width:' + fillPct + '%"></div></div>'
    + segsHTML
    + '</div>'
    + '<div class="def-guess-level-caption">' + buildGuessCaptionText(key) + '</div>'
    + '</div>';
}

// Bấm "Không quan tâm" / "Theo dõi lại" ở khung tự đánh giá (trang kết quả tra từ) — TOGGLE flag
// "ignored" trên đúng nghĩa đó (xem setDefIgnored), rồi render lại tại chỗ. Nghĩa "không quan
// tâm" bị loại khỏi Ôn tập/Learning Bar (xem buildReviewQueue/computeLearningBarMessages) nhưng
// KHÔNG mất mức đã chấm trước đó (nếu có) — bấm "Theo dõi lại" là quay về y như cũ.
async function onToggleDefIgnored(wordId, defIndex) {
  const key = favKey(wordId, defIndex);
  const wasIgnored = !!(favSrsMap[key] && favSrsMap[key].ignored);
  await setDefIgnored(key, !wasIgnored);
  const block = document.querySelector('.def-block[data-def-index="' + defIndex + '"]');
  if (block) {
    const container = block.querySelector('.def-guess-selfcheck');
    if (container && container.parentElement) {
      const wrap = document.createElement('div');
      wrap.innerHTML = buildGuessSelfCheckHTML(wordId, defIndex);
      container.replaceWith(wrap.firstElementChild);
    }
  }
  const statusEl = document.getElementById('rWordStatus');
  if (currentWord && currentWord.id === wordId && statusEl) statusEl.innerHTML = buildWordStatusRowHTML(currentWord);
}

// Ghi/xoá flag "ignored" cho 1 nghĩa — GIỮ NGUYÊN box/due/interval đã có (nếu có), chỉ đổi cờ
// ignored. Nếu nghĩa CHƯA từng có srs_progress nào (chưa từng tự đánh giá) mà bấm "Không quan
// tâm" luôn, tạo 1 hàng mới với box mặc định 1 — không ảnh hưởng gì vì ignored=true đã loại khỏi
// mọi tính toán review rồi, giá trị box lúc này không còn ý nghĩa cho tới khi bấm "Theo dõi lại".
async function setDefIgnored(key, ignored) {
  const { wordId, defIndex } = favKeyParts(key);
  const current = favSrsMap[key] || { box: 1, due: Date.now(), interval: null };
  favSrsMap[key] = Object.assign({}, current, { ignored: ignored });
  if (isLoggedIn()) {
    try {
      await sbPostAuth('srs_progress', {
        user_id: session.user.id, word_id: wordId, def_index: defIndex,
        box: favSrsMap[key].box, due: new Date(favSrsMap[key].due).toISOString(),
        interval: favSrsMap[key].interval, ignored: ignored
      }, 'user_id,word_id,def_index');
    } catch (e) { /* không chặn luồng nếu lỗi mạng, thử lại lần sau */ }
  } else {
    localStorage.setItem('thai_fav_srs', JSON.stringify(favSrsMap));
  }
}

// Dòng TRẠNG THÁI bên dưới thanh tiến trình (khác với tiêu đề cố định ở trên) — rỗng/gợi ý nhẹ
// khi CHƯA từng tự đánh giá, hoặc "<emoji> <tên mức> · ôn lại sau N ngày" khi đã có. Tách hàm
// riêng vì cần gọi lại y hệt lúc build HTML ban đầu (buildGuessSelfCheckHTML) LẪN lúc cập nhật
// tại chỗ sau khi bấm (onGuessMemoryLevel) — tránh viết trùng logic ở 2 nơi.
function buildGuessCaptionText(key) {
  const srs = favSrsMap[key];
  if (!srs) return 'Chưa đánh giá lần nào';
  const levelInfo = GUESS_MEMORY_LEVELS.find(function(l) { return l.level === srs.box; });
  const daysLeft = Math.max(0, Math.round((srs.due - Date.now()) / 86400000));
  return levelInfo.emoji + ' ' + levelInfo.label
    + (daysLeft > 0 ? ' · ôn lại sau ' + daysLeft + ' ngày' : ' · ôn lại luôn hôm nay');
}

// Số ngày CƠ SỞ cho lần đầu đạt tới mỗi mức (1 ngày/3 ngày/7 ngày/15 ngày — mức 2 chưa được cho
// số cụ thể, mình tạm suy ra 2 ngày để nội suy đều giữa mức 1 và mức 3, có thể chỉnh lại nếu
// không đúng ý). Đây là bảng số RIÊNG cho tính năng tự đánh giá này — không đụng vào
// SRS_INTERVAL_DAYS (bảng gốc, vẫn giữ nguyên cho tab Ôn tập flashcard đúng/sai nhị phân).
const GUESS_LEVEL_BASE_DAYS = { 1: 1, 2: 2, 3: 3, 4: 7, 5: 15 };

// Ghi thẳng mức tự đánh giá (1-5) vào hộp Leitner của nghĩa đó — GHI VÀO BẢNG srs_progress RIÊNG,
// tách hoàn toàn khỏi favorites (xem migration_add_srs_progress.sql): tự đánh giá mức nhớ áp dụng
// cho MỌI nghĩa, không cần nghĩa đó có nằm trong Sổ tay hay không, nên không thể còn PATCH lên
// hàng của bảng favorites như trước (nghĩa chưa lưu thì làm gì có hàng nào ở đó để PATCH).
// Quy tắc khoảng ngày ôn tiếp theo:
// - Chọn mức 1-4 (dù lặp lại mức cũ hay không): LUÔN dùng đúng số ngày cơ sở của mức đó
//   (GUESS_LEVEL_BASE_DAYS) — không cộng dồn/tăng dần. Vd chọn 🌑 2 lần liên tiếp vẫn ra 1 ngày
//   cả 2 lần, không giảm/tăng gì thêm.
// - Chọn mức 5 (🌕 Làm chủ) LẦN ĐẦU (trước đó chưa ở mức 5): dùng số ngày cơ sở 15.
// - Chọn mức 5 LẦN NỮA khi đã đang ở mức 5 rồi (box hiện tại = 5): NHÂN ĐÔI khoảng ngày lần
//   trước (15 → 30 → 60 → 120 → ...) — đúng kiểu "thẻ đã chín" của SRS, càng nhớ lâu càng giãn xa
//   thêm, không giữ mãi ở mức trần 15 ngày.
// Không dùng chung với hàng đợi ôn tập Font Challenge (bảng/hàm riêng, xem SRS_INTERVAL_DAYS ở
// phần Font Challenge) — mỗi tính năng có 1 nguồn dữ liệu SRS riêng, không lẫn vào nhau.
async function setDefSrsLevel(key, level) {
  const { wordId, defIndex } = favKeyParts(key);
  const current = favSrsMap[key];
  const isRepeatingMaxLevel = level === 5 && current && current.box === 5 && current.interval > 0;
  const intervalDays = isRepeatingMaxLevel ? current.interval * 2 : GUESS_LEVEL_BASE_DAYS[level];
  const newDue = Date.now() + intervalDays * 86400000;
  favSrsMap[key] = { box: level, due: newDue, interval: intervalDays };
  if (isLoggedIn()) {
    try {
      await sbPostAuth('srs_progress', {
        user_id: session.user.id, word_id: wordId, def_index: defIndex,
        box: level, due: new Date(newDue).toISOString(), interval: intervalDays
      }, 'user_id,word_id,def_index');
    } catch (e) { /* không chặn luồng nếu lỗi mạng, thử lại lần sau */ }
  } else {
    localStorage.setItem('thai_fav_srs', JSON.stringify(favSrsMap));
  }
}

// Bấm 1 trong 5 icon mặt trăng ở thanh tiến trình (mọi nghĩa, xem buildGuessSelfCheckHTML) — set
// thẳng mức đó vào bảng srs_progress (RIÊNG, tách khỏi Sổ tay/favorites hoàn toàn), rồi cập nhật
// TẠI CHỖ cả phần tô đậm thanh tiến trình lẫn dòng chữ chú thích bên dưới — KHÔNG dùng toast nữa
// (đã thay bằng dòng chữ persist ngay dưới thanh, không biến mất, không cần bấm mới thấy lại).
// Không cần biết/đụng gì tới trạng thái yêu thích nữa — tự đánh giá mức nhớ áp dụng được cho MỌI
// nghĩa dù có lưu vào Sổ tay hay không.
async function onGuessMemoryLevel(wordId, defIndex, level, btnEl) {
  const key = favKey(wordId, defIndex);
  await setDefSrsLevel(key, level);
  logSrsReview(wordId, defIndex, level);
  const selfCheck = btnEl.closest('.def-guess-selfcheck');
  if (selfCheck) {
    selfCheck.querySelectorAll('.def-guess-level-seg').forEach(function(b) {
      const lvl = Number(b.dataset.level);
      b.classList.toggle('filled', lvl <= level);
      b.classList.toggle('current', lvl === level);
    });
    const lineFill = selfCheck.querySelector('.def-guess-level-line-fill');
    if (lineFill) lineFill.style.width = Math.round((level - 1) / 4 * 100) + '%';
    const captionEl = selfCheck.querySelector('.def-guess-level-caption');
    if (captionEl) captionEl.textContent = buildGuessCaptionText(key);
  }
  // Cập nhật lại luôn hàng trạng thái ngang (mức độ hiểu) ở đầu trang nếu đang xem đúng từ này —
  // không cần đợi tra lại từ mới thấy mức mới nhất.
  if (currentWord && currentWord.id === wordId) {
    const statusEl = document.getElementById('rWordStatus');
    if (statusEl) statusEl.innerHTML = buildWordStatusRowHTML(currentWord);
  }
}


// Ghi 1 dòng lịch sử mỗi lần bấm tự đánh giá mức nhớ (xem onGuessMemoryLevel) — CHỈ để phục vụ
// thống kê "Learning Bar" phía trên ô tìm kiếm (vd "từ hay quên nhất tuần này"), không ảnh hưởng
// gì tới hộp Leitner (favSrsMap, xem setDefSrsLevel) — 2 việc tách biệt hoàn toàn.
async function logSrsReview(wordId, defIndex, level) {
  const entry = { wordId, defIndex, level, ts: Date.now() };
  srsReviewLog.push(entry);
  saveSrsReviewLog();
  if (isLoggedIn()) {
    try {
      await sbPostAuth('srs_review_log', {
        user_id: session.user.id, word_id: wordId, def_index: defIndex, level: level
      });
    } catch (e) { /* không chặn luồng nếu lỗi mạng, thống kê chỉ mang tính tham khảo */ }
  }
}

// ── LEARNING BAR — thanh nhắc ôn tập phía trên ô tìm kiếm (kiểu banner "You are out of free
// messages..." của Claude) — luân phiên vài dòng thông điệp thay vì chỉ nhắc ôn tập đơn thuần,
// biến thanh này thành kênh "giao tiếp" ngắn với người học mỗi lần mở app. Bấm vào thanh sẽ mở
// thẳng tab Ôn tập (đúng tinh thần "trước khi tìm từ mới, ôn lại từ cũ"). Chỉ giữ 2 thông điệp:
// số từ đến hạn hôm nay + từ hay quên nhất tuần này (2 mục "đã nhớ được X từ"/"học thêm X từ mới"
// đã bỏ theo yêu cầu).
const LEARNING_BAR_ROTATE_MS = 15000;
let learningBarMessages = [];
let learningBarIndex = 0;
let learningBarTimer = null;

function computeLearningBarMessages() {
  const now = Date.now();
  const msgs = [];

  // Nguồn đếm giờ là favSrsMap (bảng srs_progress) — KHÔNG còn dựa vào favorites nữa, vì Ôn tập
  // đã tách hẳn khỏi Sổ tay (xem ghi chú trong index.html/buildReviewQueue). Loại bỏ các nghĩa
  // "Không quan tâm" (ignored) — không tính vào số từ cần ôn/tổng số theo dõi. Số hiển thị GIỚI
  // HẠN ở đúng REVIEW_SESSION_LIMIT — dù thật ra có 87 từ đến hạn, hiện "20 từ" khớp với đúng số
  // thẻ 1 phiên sẽ phục vụ (xem buildReviewQueue), tránh gây áp lực bằng con số dồn ứ không thực tế.
  const trackedKeys = reviewableKeys();
  const totalTracked = trackedKeys.length;
  const dueCount = trackedKeys.filter(k => reviewSrsOf(k).due <= now).length;
  if (dueCount > 0) {
    msgs.push({ text: 'Hôm nay bạn có ' + Math.min(dueCount, REVIEW_SESSION_LIMIT) + ' từ nên', chipLabel: 'Xem lại', kind: 'review' });
  } else if (totalTracked > 0) {
    // Đã từng ôn ít nhất 1 từ và giờ không còn từ nào đến hạn nữa — ăn mừng nhẹ thay vì im lặng.
    msgs.push({ text: '🎉 Bạn đã hoàn thành hôm nay.', chipLabel: null, kind: 'none' });
  }

  // Chuỗi ngày ôn liên tục (streak) — chỉ hiện khi >= 2 ngày (1 ngày chưa có gì đặc biệt để khoe).
  const streak = computeReviewStreak();
  if (streak >= 2) {
    msgs.push({ text: streak + ' ngày ôn tập liên tục', chipLabel: null, kind: 'none' });
  }

  // Từ hay quên nhất tuần này — dùng chung computeTopForgottenWords() với danh sách đầy đủ trong
  // Review Mode (xem renderReviewTopForgottenBox), chỉ lấy đúng 1 từ đứng đầu ở đây.
  const topForgotten = computeTopForgottenWords(1);
  if (topForgotten.length) {
    msgs.push({ text: 'Từ bạn hay quên nhất tuần này là', chipLabel: topForgotten[0].word.thai, kind: 'word', wordId: topForgotten[0].word.id });
  }

  return msgs;
}

// Top N từ hay quên nhất trong 7 ngày gần đây — đếm số lần bấm 🌑 "Mới gặp" (tín hiệu quên rõ
// nhất), gộp theo TỪ (wordId, không tách theo từng nghĩa). Dùng chung cho cả Learning Bar (N=1)
// lẫn danh sách đầy đủ trong Review Mode (N=5, xem renderReviewTopForgottenBox).
function computeTopForgottenWords(n) {
  const weekAgo = Date.now() - 7 * 86400000;
  const forgetCountByWord = {};
  srsReviewLog.forEach(e => {
    if (e.level === 1 && e.ts >= weekAgo) forgetCountByWord[e.wordId] = (forgetCountByWord[e.wordId] || 0) + 1;
  });
  return Object.keys(forgetCountByWord)
    .map(wid => ({ wordId: Number(wid), count: forgetCountByWord[wid] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map(o => {
      const w = allWords.find(x => x.id === o.wordId);
      return w ? { word: w, count: o.count } : null;
    })
    .filter(Boolean);
}

function renderLearningBarMessage() {
  if (!learningBarMessages.length) return;
  const msg = learningBarMessages[learningBarIndex % learningBarMessages.length];
  const textEl = document.getElementById('learningBarText');
  const chipEl = document.getElementById('learningBarChip');
  if (textEl) textEl.textContent = msg.text;
  if (chipEl) {
    if (msg.chipLabel) {
      chipEl.style.visibility = 'visible';
      chipEl.textContent = msg.chipLabel;
      chipEl.dataset.kind = msg.kind;
      chipEl.dataset.wordId = msg.wordId || '';
    } else {
      // visibility (không phải display) để vẫn chiếm đúng chỗ trong hàng — giữ chiều cao/độ rộng
      // .learning-bar cố định giữa các lần xoay thông điệp, xem ghi chú CSS .learning-bar-chip.
      chipEl.style.visibility = 'hidden';
    }
  }
}

function initLearningBar() {
  learningBarMessages = computeLearningBarMessages();
  const bar = document.getElementById('learningBar');
  if (!bar) return;
  if (!learningBarMessages.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  learningBarIndex = 0;
  renderLearningBarMessage();
  if (learningBarTimer) clearInterval(learningBarTimer);
  if (learningBarMessages.length > 1) {
    learningBarTimer = setInterval(function() {
      learningBarIndex = (learningBarIndex + 1) % learningBarMessages.length;
      renderLearningBarMessage();
    }, LEARNING_BAR_ROTATE_MS);
  }
}

// Bấm vào chip ("Xem lại" hoặc chính từ hay quên nhất) — hành động khác nhau tuỳ thông điệp đang
// hiện (đọc từ data-kind/data-word-id đã gắn sẵn ở renderLearningBarMessage): "word" tra thẳng từ
// đó (dùng lại selectWord() — hàm gốc phục vụ chọn từ từ autocomplete); "review" mở thẳng Review
// Mode toàn màn hình (openReviewMode(), tách riêng khỏi Sổ tay — xem ghi chú trong index.html).
function onLearningBarChipClick() {
  const chip = document.getElementById('learningBarChip');
  if (!chip) return;
  if (chip.dataset.kind === 'word' && chip.dataset.wordId) {
    selectWord(Number(chip.dataset.wordId));
  } else if (chip.dataset.kind === 'review') {
    openReviewMode();
  }
}


function buildDefinitionsHTML(word, onlyIndices) {
  const filterSet = Array.isArray(onlyIndices) ? new Set(onlyIndices) : null;
  const defs = word.definitions || [];
  if (defs.length) {
    // Sắp thứ tự RENDER theo ghim (ghim gần đây nhất lên trước), phần còn lại giữ nguyên thứ tự
    // gốc admin nhập. "i" bên dưới LUÔN là chỉ số GỐC trong mảng definitions — dùng cho mọi thứ
    // gắn với dữ liệu đã lưu theo defIndex (yêu thích, ghi chú, ghim...) — chỉ có "renderPos"
    // (vị trí sau khi sắp lại) dùng để đánh số ๑/๒/1./2. hiển thị trên màn hình.
    const order = defs.map((def, i) => i).sort((a, b) => {
      const aPinned = isDefPinned(word.id, a);
      const bPinned = isDefPinned(word.id, b);
      if (aPinned && bPinned) return pinnedDefsMap[pinDefKey(word.id, b)] - pinnedDefsMap[pinDefKey(word.id, a)];
      if (aPinned) return -1;
      if (bPinned) return 1;
      return a - b;
    });

    // Định nghĩa admin tích "Ẩn" (def.hidden === true) không hiện lẫn với định nghĩa thường —
    // đẩy xuống dưới cùng, gộp sau 1 dòng kiểu GitHub "Xem thêm (N) nghĩa", bấm vào mới xổ ra.
    // Vẫn giữ nguyên thứ tự ghim/thường tương đối bên trong từng nhóm (visible/hidden) như "order"
    // đã sắp ở trên — chỉ tách nhóm, không sắp lại lần nữa.
    const visibleOrder = order.filter(i => !(defs[i] && defs[i].hidden));
    const hiddenOrder = order.filter(i => defs[i] && defs[i].hidden);

    const renderDefBlock = (i, renderPos) => {
      const def = defs[i];
      if (filterSet && !filterSet.has(i)) return '';
      const examples = def.examples || [];
      const exHTML = buildExamplesHTML(examples, word.id, i);

      const thaiMeaningParsed = extractLeadingTag(def.thai_meaning || '');
      const vietMeaningParsed = extractLeadingTag(def.viet_meaning || '');

      const relatedHTML = renderAllRelWordSections(def, word.id);
      const noteHTML = buildDefNoteHTML(word.id, i);
      // noteHTML (khung ghi chú) và relatedHTML (đồng nghĩa/trái nghĩa/thành ngữ/liên quan) CỐ
      // TÌNH không gộp vào bodyInner nữa — trước đây cả 2 nằm chung khung .def-body với ví dụ nên
      // bị ẩn theo accordion ví dụ, muốn ghi/xem chú phải mở ví dụ trước mới thấy. Giờ tách hẳn
      // thành 2 khối riêng, đặt NGAY SAU khung ví dụ (ghi chú trước, "Đào sâu" sau) —
      // LUÔN hiển thị độc lập với việc mở/đóng accordion ví dụ.
      const bodyInner = exHTML;

      return '<div class="def-block result-box' + (isDefPinned(word.id, i) ? ' pinned' : '') + '" data-def-index="' + i + '">'
        + '<div class="def-header">'
        + '<div class="def-header-top" onclick="toggleDef(this)">'
        // Icon ghim đứng NGOÀI CÙNG bên trái, trước cả số thứ tự (giống cách bố trí icon ghim ở
        // mỗi ví dụ — .def-ex-pin-btn) — thế chỗ mũi tên accordion cũ đã bỏ. Accordion vẫn mở/
        // đóng bình thường khi bấm vào hàng này, chỉ là không còn icon mũi tên riêng nữa vì đã
        // có nút "Xem ví dụ" + mũi tên riêng ngay bên dưới, xem buildGuessInputHTML.
        + buildDefPinBtn(word.id, i)
        + '<span class="def-num-combined"><span class="def-num-thai">' + (THAI_NUMS_DEF[renderPos]||renderPos+1) + '</span> ' + buildNumBadgeHTML(renderPos+1, 'def-num-badge') + '</span>'
        + (def.type ? '<span class="def-type">' + formatDefType(def.type) + '</span>' : '')
        // Nhóm video/ảnh/tim vẫn tự đẩy về rìa phải header nhờ margin-left:auto trên nút đầu
        // nhóm đó (xem .def-header-video-btn trong style.css). Icon bút ghi chú đã bỏ khỏi đây —
        // giờ nằm trong chính khung ghi chú bên dưới (xem buildDefNoteHTML).
        + buildDefVideoBtn(def)
        + buildDefImageBtn(def)
        + buildDefHeartBtn(word.id, i)
        + '</div>'
        + '<div class="def-summary">'
        + buildUsageTagHTML(thaiMeaningParsed.tag, 'def-usage-tag')
        + '<div class="def-thai-meaning">' + thaiMeaningParsed.rest + '</div>'
        + buildUsageTagHTML(vietMeaningParsed.tag, 'def-usage-tag')
        + '<div class="def-viet-meaning">' + vietMeaningParsed.rest + '</div>'
        + (exHTML ? buildGuessInputHTML(word.id, i) : '')
        + '</div></div>'
        + (bodyInner ? '<div class="def-body"><div class="def-body-inner">' + bodyInner + '</div></div>' : '')
        + (exHTML ? buildGuessSelfCheckHTML(word.id, i) : '')
        + noteHTML
        + (relatedHTML ? '<div class="def-related-section">' + relatedHTML + '</div>' : '')
        + '</div>';
    };

    const visibleHTML = visibleOrder.map((i, renderPos) => renderDefBlock(i, renderPos)).join('');

    let hiddenSectionHTML = '';
    if (hiddenOrder.length) {
      const hiddenBlocksHTML = hiddenOrder.map((i, idx) => renderDefBlock(i, visibleOrder.length + idx)).join('');
      // Chỉ hiện dòng "Xem thêm" nếu thật sự có nội dung để xổ ra sau khi lọc filterSet (trang
      // yêu thích/popup chỉ hiện 1 vài nghĩa cụ thể có thể lọc hết sạch nhóm ẩn này).
      if (hiddenBlocksHTML.trim()) {
        hiddenSectionHTML = '<button type="button" class="def-hidden-toggle" onclick="toggleHiddenDefs(this)">'
          + '<span class="def-hidden-toggle-line"></span>'
          + '<span class="def-hidden-toggle-label">'
          + '<span class="def-hidden-toggle-text">Xem thêm ' + hiddenOrder.length + ' nghĩa</span>'
          + '<svg class="def-hidden-toggle-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</span>'
          + '<span class="def-hidden-toggle-line"></span>'
          + '</button>'
          + '<div class="def-hidden-defs" style="display:none">' + hiddenBlocksHTML + '</div>';
      }
    }

    return visibleHTML + hiddenSectionHTML;
  }
  // fallback: show old meanings + examples format
  const meanings = word.meanings || [];
  const oldExamples = word.examples || [];
  return meanings.map((m, i) => {
    if (filterSet && !filterSet.has(i)) return '';
    const exHTML = (i === 0 && oldExamples.length) ? buildExamplesHTML(oldExamples, word.id, i) : '';
    const noteHTML = buildDefNoteHTML(word.id, i);
    return '<div class="def-block result-box' + (isDefPinned(word.id, i) ? ' pinned' : '') + '" data-def-index="' + i + '">'
      + '<div class="def-header">'
      + '<div class="def-header-top" onclick="toggleDef(this)">'
      + buildDefPinBtn(word.id, i)
      + '<span class="def-num-combined"><span class="def-num-thai">' + (THAI_NUMS_DEF[i]||i+1) + '</span> ' + buildNumBadgeHTML(i+1, 'def-num-badge') + '</span>'
      + buildDefVideoBtn({ examples: i === 0 ? oldExamples : [] })
      + buildDefHeartBtn(word.id, i)
      + '</div>'
      + (exHTML ? '<div class="def-body"><div class="def-body-inner">' + exHTML + '</div></div>' : '')
      + noteHTML
      + '</div>';
  }).join('');
}

// 4 font hiển thị chữ Thái (Mitr/Sriracha/Charmonman/Saruns Lai Mue) dùng chung ở trang kết quả,
// trang Yêu thích và popup định nghĩa. Từ ngắn (<=4 "từ" tính theo khoảng trắng) xếp ngang cách
// đều nhau; từ/thành ngữ dài hơn thì xuống dòng, căn trái như cũ.
function buildWordFontsHTML(thai) {
  const t = thai || '';
  return '<div class="word-thai-mitr">' + t + '</div>'
    + '<div class="word-thai-sriracha">' + t + '</div>'
    + '<div class="word-thai-charmonman">' + t + '</div>'
    + '<div class="word-thai-sarunslaimue">' + t + '</div>';
}
// Icon กขค (nút .btn-font-preview trong .word-actions, chỉ có ở trang kết quả chính #rThai) đứng
// THẲNG HÀNG với hàng 4 font: xếp ngang thì căn giữa theo cả hàng 4 font; xếp dọc (từ dài) thì căn
// giữa theo font đầu tiên. Đo chiều cao thật sau khi render nên đúng với cả 2 kiểu xếp. Container
// khác (trang Yêu thích, popup) không có .word-actions này nên hàm tự bỏ qua.
function alignFontPreviewBtn(containerEl) {
  const top = containerEl.closest('.result-top');
  const actions = top && top.querySelector('.word-actions');
  if (!actions) return;
  const horizontal = containerEl.classList.contains('wt-horizontal');
  const ref = horizontal ? containerEl : containerEl.firstElementChild;
  if (!ref) return;
  const offset = Math.max(0, Math.round(ref.offsetHeight / 2 - actions.offsetHeight / 2));
  actions.style.marginTop = offset + 'px';
}
// Quyết định xếp ngang hay xuống dòng dựa trên ĐỘ RỘNG THỰC TẾ sau khi render, không đoán theo
// số từ — vì tiếng Thái nhiều khi viết liền không dấu cách dù vẫn dài (ไม่เป็นสับปะรด), hoặc có
// dấu cách nhưng mỗi "từ" đã tự dài (ฟังไม่ได้ศัพท์ จับไปกระเดียด). Thử xếp ngang trước; đợi font
// tải xong rồi đo, nếu font nào bị tràn (phải cuộn) thì tự động chuyển cả 4 khung về xếp dọc, căn trái.
function applyWordThaiLayout(containerEl) {
  if (!containerEl) return;
  containerEl.classList.add('wt-horizontal');
  alignFontPreviewBtn(containerEl);
  const check = () => {
    if (!containerEl.isConnected) return;
    const boxes = containerEl.querySelectorAll('.word-thai-mitr, .word-thai-sriracha, .word-thai-charmonman, .word-thai-sarunslaimue');
    let overflow = false;
    boxes.forEach(b => { if (b.scrollWidth > b.clientWidth + 1) overflow = true; });
    if (overflow) containerEl.classList.remove('wt-horizontal');
    alignFontPreviewBtn(containerEl);
  };
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestAnimationFrame(check));
  } else {
    requestAnimationFrame(check);
  }
}

function showResult(word) {
  const t = word.thai;
  const rThaiEl = document.getElementById('rThai');
  rThaiEl.classList.remove('wt-horizontal');
  rThaiEl.innerHTML = buildWordFontsHTML(t);
  applyWordThaiLayout(rThaiEl);
  document.getElementById('rPhonetic').innerHTML = word.phonetic || '';
  document.getElementById('rStructure').innerHTML = word.structure || '';
  // Đọc recentSearches TRƯỚC KHI addRecent() (gọi sau showResult() trong luồng selectWord()) cập
  // nhật số liệu — nên "Đã tra N lần"/"Lần cuối tra" phản ánh đúng lịch sử TRƯỚC lượt xem hiện tại
  // (hợp lý hơn: hiện thời điểm bạn đang xem thì không thể vừa là "lần cuối" của chính nó).
  const statusEl = document.getElementById('rWordStatus');
  if (statusEl) {
    statusEl.innerHTML = buildWordStatusRowHTML(word);
    statusEl.style.display = '';
  }

  const defEl = document.getElementById('rDefinitions');
  defEl.innerHTML = buildDefinitionsHTML(word);
  segmentizeDefsIfEnabled(defEl);
  updateDefExpandAllBtn('rDefExpandAllBtn', 'rDefinitions', word);

  document.getElementById('resultSection').classList.add('show');
  document.getElementById('emptyState').classList.remove('show');
  document.getElementById('homeDefault').style.display = 'none';
  trackWordView(word.id);
}

// Hàng trạng thái ngang dưới phiên âm/cấu tạo từ — "lần cuối tra" + "đã tra N lần" (đọc thẳng
// recentSearches, đã có sẵn cho tính năng Lịch sử) + "mức độ hiểu" (đọc favSrsMap — lấy mức THẤP
// NHẤT trong các nghĩa của từ, vì đây là tín hiệu hữu ích nhất: nghĩa bạn yếu nhất, không phải
// trung bình cộng dễ gây hiểu lầm hay chỉ lấy nghĩa đầu tiên bỏ sót nghĩa khác). Ẩn phần mức độ
// hiểu nếu CHƯA từng tự đánh giá nghĩa nào của từ này (không hiện "chưa đánh giá" cho đỡ rối).
function buildWordStatusRowHTML(word) {
  const existing = recentSearches.find(r => r.id === word.id);
  const parts = [];
  if (existing && existing.ts) {
    parts.push('Lần cuối tra: ' + formatRecentTime(existing.ts));
    if (existing.count > 1) parts.push('Đã tra ' + existing.count + ' lần');
  } else {
    parts.push('Lần đầu tra từ này');
  }
  const defCount = (word.definitions && word.definitions.length) || (word.meanings && word.meanings.length) || 1;
  let minLevel = null;
  for (let i = 0; i < defCount; i++) {
    const srs = favSrsMap[favKey(word.id, i)];
    if (srs && !srs.ignored) minLevel = (minLevel === null) ? srs.box : Math.min(minLevel, srs.box);
  }
  if (minLevel !== null) {
    const levelInfo = GUESS_MEMORY_LEVELS.find(l => l.level === minLevel);
    parts.push(levelInfo.emoji + ' ' + levelInfo.label);
  }
  return parts.map(p => '<span class="word-status-item">' + p + '</span>').join('<span class="word-status-sep">·</span>');
}

// ── SPEAK ─────────────────────────────────────────────
function speak() {
  if (!currentWord) return;
  speakText(currentWord.thai, 'btnSpeak');
}

let currentSpeakingBtn = null;

// Phát âm 1 đoạn text tiếng Thái bất kỳ (dùng chung cho tra từ đơn lẻ và tách từ).
// Bấm khi ĐANG phát ở đúng nút đó -> dừng phát (toggle off), không phát chồng thêm lần nữa.
// Bấm nút khác trong khi đang phát -> dừng bản đang phát rồi phát bản mới (không xếp hàng).
function speakText(text, btn) {
  text = (text || '').trim();
  if (!text) return;
  const btnEl = typeof btn === 'string' ? document.getElementById(btn) : btn;

  if (speechSynthesis.speaking) {
    const wasSameBtn = currentSpeakingBtn === btnEl;
    speechSynthesis.cancel();
    if (wasSameBtn) return;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH'; u.rate = 0.85;
  if (btnEl) {
    btnEl.classList.add('playing');
    u.onend = () => { btnEl.classList.remove('playing'); if (currentSpeakingBtn === btnEl) currentSpeakingBtn = null; };
    u.onerror = () => { btnEl.classList.remove('playing'); if (currentSpeakingBtn === btnEl) currentSpeakingBtn = null; };
  }
  currentSpeakingBtn = btnEl || null;
  speechSynthesis.speak(u);
}

// ── FAVORITES ─────────────────────────────────────────
// ── YÊU THÍCH THEO TỪNG NGHĨA (favKey = wordId:defIndex) ────────
// Click bookmark khi CHƯA lưu -> mở popup chọn thư mục (hoặc tạo mới) rồi mới lưu.
// Click bookmark khi ĐÃ lưu -> bỏ yêu thích ngay (không cần xác nhận thêm, kể cả đang nằm
// trong nhiều thư mục cùng lúc — bỏ yêu thích sẽ xoá khỏi TẤT CẢ thư mục đó).
function onDefFavClick(wordId, defIndex) {
  if (isFavDef(wordId, defIndex)) {
    unfavoriteDefinition(wordId, defIndex).then(() => afterFavChange(wordId));
  } else {
    openFavFolderPicker(wordId, defIndex, null);
  }
}

async function unfavoriteDefinition(wordId, defIndex) {
  const key = favKey(wordId, defIndex);
  favorites = favorites.filter(k => k !== key);
  delete favFolderMap[key];
  delete favNotesMap[key];
  delete favSrsMap[key];
  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorites?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&def_index=eq.' + defIndex);
      // Dọn luôn các liên kết thư mục còn sót lại (nếu nghĩa này từng nằm trong 1+ thư mục) —
      // không dọn sẽ để lại dòng "mồ côi" trên favorite_folder_links, có thể hồi sinh nhầm nếu
      // sau này người dùng yêu thích lại đúng nghĩa này (xem syncUserDataOnLogin).
      await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&def_index=eq.' + defIndex);
    } catch (e) { showToast('⚠️ Không thể bỏ yêu thích'); }
  } else {
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
    localStorage.setItem('thai_fav_notes', JSON.stringify(favNotesMap));
    localStorage.setItem('thai_fav_srs', JSON.stringify(favSrsMap));
  }
  showToast('Đã bỏ khỏi yêu thích');
}

// Lưu ghi chú cá nhân (định nghĩa / ví dụ riêng) cho 1 nghĩa đã lưu yêu thích
async function saveDefNote(wordId, defIndex, field, value) {
  const key = favKey(wordId, defIndex);
  if (!favorites.includes(key)) return; // chỉ lưu ghi chú cho nghĩa đã yêu thích
  const note = favNotesMap[key] || { noteDef: '', noteExample: '' };
  note[field] = value;
  favNotesMap[key] = note;
  if (isLoggedIn()) {
    try {
      const body = field === 'noteDef' ? { note_def: value || null } : { note_example: value || null };
      await sbPatchAuth('favorites?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&def_index=eq.' + defIndex, body);
    } catch (e) { showToast('⚠️ Không thể lưu ghi chú'); }
  } else {
    localStorage.setItem('thai_fav_notes', JSON.stringify(favNotesMap));
  }
}

// Cập nhật lại mọi nơi đang hiển thị từ này (trang tra từ chính, popup tra nhanh, dòng mở rộng trong Yêu thích)
// sau khi trạng thái yêu thích của 1 nghĩa nào đó thay đổi
function afterFavChange(wordId) {
  updateStats();
  if (currentWord && currentWord.id === wordId && document.getElementById('resultSection').classList.contains('show')) {
    showResult(currentWord);
  }
  if (wordPopupWordId === wordId && document.getElementById('wordPopupOverlay').classList.contains('show')) {
    onDefWordClick(wordId);
  }
  const favExpandBody = document.getElementById('fav-expand-' + wordId);
  if (favExpandBody && favExpandBody.classList.contains('show')) {
    renderFavExpandedRow(wordId);
  }
  renderRecent();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  renderFavorites();
}

// ── POPUP CHỌN THƯ MỤC KHI LƯU YÊU THÍCH (hỗ trợ CHỌN NHIỀU THƯ MỤC CÙNG LÚC) ──
// rawFolderId luôn đến từ 1 thuộc tính onclick (chuỗi) — chuyển về đúng kiểu number nếu id thư
// mục là số (thư mục đã đồng bộ lên Supabase), giữ nguyên chuỗi nếu là id tạo cục bộ khi chưa
// đăng nhập (dạng "f_xxx", xem genLocalFolderId).
function coerceFolderId(rawFolderId) {
  if (rawFolderId === null || rawFolderId === undefined || rawFolderId === '') return null;
  return isNaN(Number(rawFolderId)) ? rawFolderId : Number(rawFolderId);
}

function setFolderPickerHeader(title, subtitle) {
  const box = document.querySelector('#favFolderPickerModal .fav-folder-picker-box');
  if (!box) return;
  const titleEl = box.querySelector('.modal-title');
  const subEl = box.querySelector('.modal-sub');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
}

// Thứ tự thư mục trong popup: thư mục VỪA DÙNG GẦN ĐÂY NHẤT lên đầu (favFolderRecentMap, xem
// touchFolderRecent) — tính 1 LẦN khi mở popup rồi giữ cố định suốt phiên mở đó (không tính lại
// mỗi lần tick chọn), để thư mục vừa bấm không bị nhảy vị trí ngay dưới ngón tay/con trỏ chuột
// khi đang chọn liên tiếp nhiều thư mục. Lần MỞ POPUP KẾ TIẾP mới áp dụng thứ tự mới.
function computeSortedFolderPickerOrder() {
  return favoriteFolders.slice().sort((a, b) => (favFolderRecentMap[b.id] || 0) - (favFolderRecentMap[a.id] || 0));
}

function openFavFolderPicker(wordId, defIndex, btnEl) {
  favPickerContext = { mode: 'def', wordId, defIndex, btnEl, folderOrder: computeSortedFolderPickerOrder() };
  setFolderPickerHeader('Thêm vào thư mục', 'Thêm nghĩa này vào một hoặc nhiều thư mục, hoặc tạo thư mục mới');
  const searchInput = document.getElementById('favFolderPickerSearch');
  if (searchInput) searchInput.value = '';
  renderFavFolderPickerList();
  const newNameInput = document.getElementById('favFolderPickerNewName');
  if (newNameInput) newNameInput.value = '';
  document.getElementById('favFolderPickerModal').classList.add('show');
}

// Mở popup chọn thư mục để CHUYỂN TOÀN BỘ các nghĩa đã lưu của 1 từ sang thư mục khác (thay thế
// hẳn thư mục cũ, không phải "thêm vào" — khác với mode 'def' ở trên vốn cho chọn nhiều thư mục
// cùng lúc). Bấm 1 thư mục trong danh sách là chuyển luôn và đóng popup (xem confirmFavFolderPick).
function openMoveWordFolderPicker(wordId) {
  favPickerContext = { mode: 'moveWord', wordId, folderOrder: computeSortedFolderPickerOrder() };
  setFolderPickerHeader('Chuyển sang thư mục nào?', 'Chọn thư mục để chuyển từ này sang, hoặc tạo thư mục mới');
  const searchInput = document.getElementById('favFolderPickerSearch');
  if (searchInput) searchInput.value = '';
  renderFavFolderPickerList();
  const newNameInput = document.getElementById('favFolderPickerNewName');
  if (newNameInput) newNameInput.value = '';
  document.getElementById('favFolderPickerModal').classList.add('show');
}

// Mở popup chọn thư mục để lưu HÀNG LOẠT nhiều từ cùng lúc (mode 'bulk') — dùng cho "Chọn nhiều"
// ở tab Lịch sử. Khác mode 'def' (cho phép tick nhiều thư mục cho 1 nghĩa): ở đây bấm 1 thư mục
// là áp dụng luôn cho TẤT CẢ từ đã chọn (mặc định lưu nghĩa đầu tiên mỗi từ) rồi đóng popup —
// xem confirmBulkAddToFolder().
function openFavFolderPickerBulk(wordIds) {
  favPickerContext = { mode: 'bulk', wordIds, folderOrder: computeSortedFolderPickerOrder() };
  setFolderPickerHeader('Lưu ' + wordIds.length + ' từ vào thư mục', 'Chọn 1 thư mục — áp dụng cho tất cả từ đã chọn (mặc định lưu nghĩa đầu tiên)');
  const searchInput = document.getElementById('favFolderPickerSearch');
  if (searchInput) searchInput.value = '';
  renderFavFolderPickerList();
  const newNameInput = document.getElementById('favFolderPickerNewName');
  if (newNameInput) newNameInput.value = '';
  document.getElementById('favFolderPickerModal').classList.add('show');
}

// Mở popup CHUYỂN HÀNG LOẠT nhiều từ sang 1 thư mục khác (mode 'bulkMove') — dùng cho "Chọn
// nhiều" ở Sổ tay. Khác mode 'bulk' (dùng ở Lịch sử, vốn CHỈ THÊM nghĩa đầu tiên vào thư mục vì
// từ trong lịch sử có thể chưa được lưu): ở đây các từ ĐÃ ĐƯỢC LƯU sẵn, nên hành vi đúng là "chuyển
// thư mục" — thay thế hẳn thư mục cũ của MỌI nghĩa đã lưu, giống hệt moveWordToFolder() nhưng cho
// nhiều từ cùng lúc.
function openMoveWordFolderPickerBulk(wordIds) {
  favPickerContext = { mode: 'bulkMove', wordIds, folderOrder: computeSortedFolderPickerOrder() };
  setFolderPickerHeader('Chuyển ' + wordIds.length + ' từ sang thư mục nào?', 'Chọn thư mục để chuyển các từ đã chọn sang, hoặc tạo thư mục mới');
  const searchInput = document.getElementById('favFolderPickerSearch');
  if (searchInput) searchInput.value = '';
  renderFavFolderPickerList();
  const newNameInput = document.getElementById('favFolderPickerNewName');
  if (newNameInput) newNameInput.value = '';
  document.getElementById('favFolderPickerModal').classList.add('show');
}

function closeFavFolderPicker() {
  document.getElementById('favFolderPickerModal').classList.remove('show');
  favPickerContext = null;
}

const FFPI_CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const FFPI_UNCATEGORIZED_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>';
const FFPI_FOLDER_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

function renderFavFolderPickerList() {
  const el = document.getElementById('favFolderPickerList');
  if (!el || !favPickerContext) return;
  const { mode, wordId, defIndex, wordIds } = favPickerContext;
  const order = favPickerContext.folderOrder || (favPickerContext.folderOrder = computeSortedFolderPickerOrder());
  const searchInput = document.getElementById('favFolderPickerSearch');
  const q = ((searchInput && searchInput.value) || '').trim().toLowerCase();

  const key = mode === 'def' ? favKey(wordId, defIndex) : null;
  const selectedIds = mode === 'def' ? (favFolderMap[key] || []) : [];
  const isAlreadyFav = mode === 'def' ? favorites.includes(key) : false;

  const rows = [];

  if (!q || 'không phân loại'.includes(q) || 'chưa phân loại'.includes(q)) {
    if (mode === 'video') {
      const sv = savedVideos.find(x => x.id === favPickerContext.videoId);
      const checked = !!sv && !(sv.folders && sv.folders.length);
      rows.push(
        '<button type="button" class="fav-folder-pick-item' + (checked ? ' picked' : '') + '" onclick="setVideoUncategorized(\'' + favPickerContext.videoId + '\')">'
        + '<span class="ffpi-check">' + (checked ? FFPI_CHECK_ICON : '') + '</span>'
        + FFPI_UNCATEGORIZED_ICON + '<span class="ffpi-name">Chưa phân loại</span></button>'
      );
    } else if (mode === 'def') {
      const checked = isAlreadyFav && selectedIds.length === 0;
      rows.push(
        '<button type="button" class="fav-folder-pick-item' + (checked ? ' picked' : '') + '" onclick="setDefUncategorized(' + wordId + ',' + defIndex + ')">'
        + '<span class="ffpi-check">' + (checked ? FFPI_CHECK_ICON : '') + '</span>'
        + FFPI_UNCATEGORIZED_ICON + '<span class="ffpi-name">Chưa phân loại</span></button>'
      );
    } else if (mode === 'bulk') {
      rows.push('<button type="button" class="fav-folder-pick-item" onclick="confirmBulkAddToFolder(null)">' + FFPI_UNCATEGORIZED_ICON + '<span class="ffpi-name">Chưa phân loại</span></button>');
    } else if (mode === 'bulkMove') {
      rows.push('<button type="button" class="fav-folder-pick-item" onclick="confirmBulkMoveToFolder(null)">' + FFPI_UNCATEGORIZED_ICON + '<span class="ffpi-name">Chưa phân loại</span></button>');
    } else {
      rows.push('<button type="button" class="fav-folder-pick-item" onclick="confirmFavFolderPick(null)">' + FFPI_UNCATEGORIZED_ICON + '<span class="ffpi-name">Chưa phân loại</span></button>');
    }
  }

  order.filter(f => !q || f.name.toLowerCase().includes(q)).forEach(f => {
    const wordCount = countWordsInFolder(f.id);
    if (mode === 'video') {
      const sv = savedVideos.find(x => x.id === favPickerContext.videoId);
      const checked = !!sv && (sv.folders || []).includes(f.id);
      const vc = countVideosInFolder(f.id);
      rows.push(
        '<button type="button" class="fav-folder-pick-item' + (checked ? ' picked' : '') + '" onclick="toggleVideoInFolder(\'' + favPickerContext.videoId + '\',\'' + f.id + '\')">'
        + '<span class="ffpi-check">' + (checked ? FFPI_CHECK_ICON : '') + '</span>'
        + FFPI_FOLDER_ICON + '<span class="ffpi-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="ffpi-count">' + [wordCount > 0 ? wordCount + ' từ' : '', vc > 0 ? vc + ' video' : ''].filter(Boolean).join(' · ') + '</span></button>'
      );
    } else if (mode === 'def') {
      const checked = selectedIds.includes(f.id);
      rows.push(
        '<button type="button" class="fav-folder-pick-item' + (checked ? ' picked' : '') + '" onclick="' + (checked ? 'removeDefFromFolder' : 'addDefToFolder') + '(' + wordId + ',' + defIndex + ',\'' + f.id + '\')">'
        + '<span class="ffpi-check">' + (checked ? FFPI_CHECK_ICON : '') + '</span>'
        + FFPI_FOLDER_ICON + '<span class="ffpi-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="ffpi-count">' + wordCount + ' từ</span></button>'
      );
    } else if (mode === 'bulk') {
      rows.push(
        '<button type="button" class="fav-folder-pick-item" onclick="confirmBulkAddToFolder(\'' + f.id + '\')">'
        + FFPI_FOLDER_ICON + '<span class="ffpi-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="ffpi-count">' + wordCount + ' từ</span></button>'
      );
    } else if (mode === 'bulkMove') {
      rows.push(
        '<button type="button" class="fav-folder-pick-item" onclick="confirmBulkMoveToFolder(\'' + f.id + '\')">'
        + FFPI_FOLDER_ICON + '<span class="ffpi-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="ffpi-count">' + wordCount + ' từ</span></button>'
      );
    } else {
      rows.push(
        '<button type="button" class="fav-folder-pick-item" onclick="confirmFavFolderPick(\'' + f.id + '\')">'
        + FFPI_FOLDER_ICON + '<span class="ffpi-name">' + escapeHtml(f.name) + '</span>'
        + '<span class="ffpi-count">' + wordCount + ' từ</span></button>'
      );
    }
  });

  el.innerHTML = rows.length ? rows.join('') : '<div class="fav-folder-pick-empty">Không tìm thấy thư mục nào</div>';
}

async function createFolderFromPicker() {
  const input = document.getElementById('favFolderPickerNewName');
  const name = (input.value || '').trim();
  if (!name) return;
  if (favoriteFolders.some(f => f.name.toLowerCase() === name.toLowerCase())) {
    showToast('⚠️ Thư mục này đã tồn tại');
    return;
  }
  let newId;
  if (isLoggedIn()) {
    try {
      const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name });
      const row = Array.isArray(created) ? created[0] : created;
      if (!row) throw new Error('no row returned');
      favoriteFolders.push({ id: row.id, name: row.name, is_public: false, save_count: 0 });
      newId = row.id;
    } catch (e) { showToast('⚠️ Không thể tạo thư mục, thử lại sau'); return; }
  } else {
    newId = genLocalFolderId();
    favoriteFolders.push({ id: newId, name, is_public: false, save_count: 0 });
    localStorage.setItem('thai_fav_folders', JSON.stringify(favoriteFolders));
  }
  input.value = '';
  if (!favPickerContext) return;
  favPickerContext.folderOrder = computeSortedFolderPickerOrder();

  if (favPickerContext.mode === 'moveWord') {
    // Mode "chuyển thư mục": tạo xong là chuyển luôn + đóng popup, giữ nguyên hành vi cũ.
    await confirmFavFolderPick(newId);
    return;
  }

  if (favPickerContext.mode === 'bulk') {
    await confirmBulkAddToFolder(newId);
    return;
  }

  if (favPickerContext.mode === 'bulkMove') {
    await confirmBulkMoveToFolder(newId);
    return;
  }

  if (favPickerContext.mode === 'video') {
    // Video: tạo xong tự tick luôn thư mục vừa tạo, giữ popup mở để chọn tiếp
    await toggleVideoInFolder(favPickerContext.videoId, newId);
    return;
  }

  // Mode "lưu vào nhiều thư mục" (mặc định): KHÔNG đóng popup — tự tick chọn luôn thư mục vừa
  // tạo (gồm cả toast + Hoàn tác như tick tay) rồi render lại danh sách, cho phép chọn tiếp.
  await addDefToFolder(favPickerContext.wordId, favPickerContext.defIndex, newId);
  renderFavFolderPickerList();
}

// Dùng cho mode 'moveWord' — bấm 1 thư mục là CHUYỂN LUÔN (thay thế thư mục cũ) rồi đóng popup.
async function confirmFavFolderPick(rawFolderId) {
  if (!favPickerContext) return;
  const folderId = coerceFolderId(rawFolderId);
  if (favPickerContext.mode === 'moveWord') {
    const { wordId } = favPickerContext;
    await moveWordToFolder(wordId, folderId);
    if (folderId !== null) touchFolderRecent(folderId);
    closeFavFolderPicker();
    showToast('📁 Đã chuyển thư mục');
    afterFavChange(wordId);
  }
}

// Dùng cho mode 'bulk' (chọn nhiều ở tab Lịch sử) — áp dụng 1 thư mục cho TẤT CẢ từ đã chọn cùng
// lúc (mặc định lưu nghĩa đầu tiên mỗi từ), gộp lại chỉ 1 toast cuối cùng thay vì spam từng từ.
async function confirmBulkAddToFolder(rawFolderId) {
  if (!favPickerContext || favPickerContext.mode !== 'bulk') return;
  const wordIds = (favPickerContext.wordIds || []).slice();
  if (!wordIds.length) return;
  const folderId = rawFolderId === null ? null : coerceFolderId(rawFolderId);
  if (folderId === null) {
    for (const wid of wordIds) await setDefUncategorized(wid, 0, true);
  } else {
    for (const wid of wordIds) await addDefToFolder(wid, 0, folderId, true);
  }
  closeFavFolderPicker();
  const folder = folderId === null ? null : favoriteFolders.find(f => f.id === folderId);
  showToast('✅ Đã lưu ' + wordIds.length + ' từ' + (folder ? ' vào "' + folder.name + '"' : ''));
  historySelectMode = false;
  historySelectedIds.clear();
  updateHistorySelectToolbar();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
}

// Dùng cho mode 'bulkMove' (chọn nhiều ở Sổ tay) — chuyển TẤT CẢ từ đã chọn sang 1 thư mục, thay
// thế hẳn thư mục cũ của mỗi từ (giống moveWordToFolder() nhưng cho nhiều từ, gộp lại chỉ 1 toast
// cuối cùng).
async function confirmBulkMoveToFolder(rawFolderId) {
  if (!favPickerContext || favPickerContext.mode !== 'bulkMove') return;
  const wordIds = (favPickerContext.wordIds || []).slice();
  if (!wordIds.length) return;
  const folderId = rawFolderId === null ? null : coerceFolderId(rawFolderId);
  for (const wid of wordIds) {
    await moveWordToFolder(wid, folderId);
    afterFavChange(wid);
  }
  closeFavFolderPicker();
  const folder = folderId === null ? null : favoriteFolders.find(f => f.id === folderId);
  showToast('📁 Đã chuyển ' + wordIds.length + ' từ' + (folder ? ' sang "' + folder.name + '"' : ' về "Chưa phân loại"'));
  favSelectMode = false;
  favSelectedIds.clear();
  updateFavSelectToolbar();
  renderFavorites();
}

// Thêm 1 nghĩa vào 1 thư mục cụ thể — KHÔNG ảnh hưởng các thư mục khác nghĩa đó đang có (1
// nghĩa có thể ở trong nhiều thư mục cùng lúc). Tự động yêu thích nghĩa này nếu chưa lưu. Sau
// khi lưu, hiện toast nhỏ có tên thư mục (bấm được, điều hướng tới đúng thư mục) + nút Hoàn tác.
async function addDefToFolder(wordId, defIndex, rawFolderId, silent) {
  const folderId = coerceFolderId(rawFolderId);
  if (folderId === null) return;
  const key = favKey(wordId, defIndex);
  const isNewFav = !favorites.includes(key);
  if (isNewFav) favorites.push(key);
  const arr = favFolderMap[key] = favFolderMap[key] || [];
  if (!arr.includes(folderId)) arr.push(folderId);
  touchFolderRecent(folderId);
  if (isLoggedIn()) {
    try {
      if (isNewFav) {
        await sbPostAuth('favorites', {
          user_id: session.user.id, word_id: wordId, def_index: defIndex
        }, 'user_id,word_id,def_index');
      }
      await sbPostAuth('favorite_folder_links', {
        user_id: session.user.id, word_id: wordId, def_index: defIndex, folder_id: folderId
      }, 'user_id,word_id,def_index,folder_id');
    } catch (e) { showToast('⚠️ Không thể lưu vào thư mục'); }
  } else {
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_srs', JSON.stringify(favSrsMap));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
  }
  if (!silent) {
    const folder = favoriteFolders.find(f => f.id === folderId);
    showFolderActionToast(wordId, defIndex, folderId, folder ? folder.name : '');
    renderFavFolderPickerList();
  }
  afterFavChange(wordId);
}

// Bỏ 1 nghĩa khỏi 1 thư mục cụ thể (vẫn còn yêu thích, và vẫn ở trong các thư mục khác nếu có)
async function removeDefFromFolder(wordId, defIndex, rawFolderId) {
  const folderId = coerceFolderId(rawFolderId);
  if (folderId === null) return;
  const key = favKey(wordId, defIndex);
  const arr = favFolderMap[key] || [];
  const idx = arr.indexOf(folderId);
  if (idx !== -1) arr.splice(idx, 1);
  if (!arr.length) delete favFolderMap[key];
  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&def_index=eq.' + defIndex + '&folder_id=eq.' + folderId);
    } catch (e) { showToast('⚠️ Không thể bỏ khỏi thư mục'); }
  } else {
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
  }
  renderFavFolderPickerList();
  afterFavChange(wordId);
}

// "Chưa phân loại" — đảm bảo nghĩa này đã được yêu thích, đồng thời XOÁ mọi thư mục đã gán
// (nếu có), đưa về trạng thái "đã lưu nhưng chưa phân loại vào thư mục nào".
async function setDefUncategorized(wordId, defIndex, silent) {
  const key = favKey(wordId, defIndex);
  const isNewFav = !favorites.includes(key);
  if (isNewFav) favorites.push(key);
  const hadFolders = (favFolderMap[key] || []).slice();
  delete favFolderMap[key];
  if (isLoggedIn()) {
    try {
      if (isNewFav) {
        await sbPostAuth('favorites', {
          user_id: session.user.id, word_id: wordId, def_index: defIndex
        }, 'user_id,word_id,def_index');
      }
      if (hadFolders.length) {
        await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId + '&def_index=eq.' + defIndex);
      }
    } catch (e) { showToast('⚠️ Không thể lưu'); }
  } else {
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_srs', JSON.stringify(favSrsMap));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
  }
  if (!silent) renderFavFolderPickerList();
  afterFavChange(wordId);
}

// Chuyển toàn bộ các nghĩa đã lưu của 1 từ sang 1 thư mục khác (hoặc "Chưa phân loại" nếu
// folderId = null) — THAY THẾ hẳn thư mục cũ (nếu nghĩa đó đang ở nhiều thư mục, tất cả sẽ được
// gộp về chỉ còn đúng 1 thư mục mới này). Dùng cho nút "Chuyển sang thư mục khác" ở trang Sổ tay.
async function moveWordToFolder(wordId, folderId) {
  const keys = favorites.filter(k => k.startsWith(wordId + ':'));
  keys.forEach(k => { if (folderId) favFolderMap[k] = [folderId]; else delete favFolderMap[k]; });
  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=eq.' + wordId);
      if (folderId) {
        await Promise.all(keys.map(k => {
          const { defIndex } = favKeyParts(k);
          return sbPostAuth('favorite_folder_links', {
            user_id: session.user.id, word_id: wordId, def_index: defIndex, folder_id: folderId
          }, 'user_id,word_id,def_index,folder_id').catch(() => {});
        }));
      }
    } catch (e) { showToast('⚠️ Không thể chuyển thư mục'); }
  } else {
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
  }
}

function genLocalFolderId() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── TOAST RIÊNG CHO HÀNH ĐỘNG LƯU VÀO THƯ MỤC (có link + nút Hoàn tác) ──────────
// Khác với showToast() thường (chỉ hiện chữ, tự ẩn, không bấm được) — toast này cần: tên thư
// mục bấm được (điều hướng tới đúng thư mục), và nút "Hoàn tác" để bỏ ngay hành động vừa làm.
let folderActionToastTimer = null;
let folderActionToastCtx = null; // { wordId, defIndex, folderId } — để Hoàn tác biết cần gỡ gì

function showFolderActionToast(wordId, defIndex, folderId, folderName) {
  const t = document.getElementById('folderActionToast');
  if (!t) return;
  const linkEl = document.getElementById('folderActionToastLink');
  if (linkEl) linkEl.textContent = '"' + folderName + '"';
  folderActionToastCtx = { wordId, defIndex, folderId };
  t.classList.add('show');
  if (folderActionToastTimer) clearTimeout(folderActionToastTimer);
  folderActionToastTimer = setTimeout(hideFolderActionToast, 4000);
}

function hideFolderActionToast() {
  const t = document.getElementById('folderActionToast');
  if (t) t.classList.remove('show');
  if (folderActionToastTimer) { clearTimeout(folderActionToastTimer); folderActionToastTimer = null; }
  folderActionToastCtx = null;
}

function onFolderToastLinkClick() {
  if (!folderActionToastCtx) return;
  const folderId = folderActionToastCtx.folderId;
  hideFolderActionToast();
  navigateToFavFolder(folderId);
}

async function undoFolderActionToast() {
  if (!folderActionToastCtx) return;
  const { wordId, defIndex, folderId } = folderActionToastCtx;
  hideFolderActionToast();
  await removeDefFromFolder(wordId, defIndex, folderId);
}

// Điều hướng thẳng tới 1 thư mục cụ thể trong trang Sổ tay — đóng popup đang mở (nếu có) trước
function navigateToFavFolder(folderId) {
  closeFavFolderPicker();
  showPage('favorites');
  switchFavTab('mine');
  setActiveFavFolder(folderId);
}

// Nút "Mở Sổ tay" ở cuối popup chọn thư mục — điều hướng thẳng tới trang Sổ tay (tab "mine")
function openFavLibraryFromPicker() {
  closeFavFolderPicker();
  const videoModal = document.getElementById('exampleVideoModal');
  if (videoModal && videoModal.classList.contains('show')) closeExampleVideo(); // mở từ popup video: đóng video để thấy Sổ tay
  showPage('favorites');
  switchFavTab('mine');
}

// Đếm số TỪ (không phải số nghĩa) có ít nhất 1 nghĩa nằm trong thư mục folderId — truyền null
// để đếm "Chưa phân loại" (nghĩa đã yêu thích nhưng không thuộc thư mục nào). Dùng chung cho cả
// lưới thư mục ở trang Sổ tay (renderFavorites) VÀ popup chọn thư mục (renderFavFolderPickerList).
function countWordsInFolder(folderId) {
  const byWord = {};
  favorites.forEach(k => {
    const { wordId, defIndex } = favKeyParts(k);
    if (!byWord[wordId]) byWord[wordId] = [];
    byWord[wordId].push(defIndex);
  });
  const test = folderId === null
    ? (k => !(favFolderMap[k] && favFolderMap[k].length))
    : (k => (favFolderMap[k] || []).includes(folderId));
  return Object.keys(byWord).filter(wid => byWord[wid].some(di => test(favKey(Number(wid), di)))).length;
}


// ── TRANG YÊU THÍCH: danh sách gọn theo TỪ, mở rộng xem chi tiết ngay tại chỗ ──
// Gợi ý dọn thư mục ĐANG TRỐNG (0 từ + 0 câu). LƯU Ý: đơn giản hóa so với ý tưởng ban đầu "trống
// LÂU NGÀY" — app hiện không lưu thời điểm tạo/hoạt động cuối của từng thư mục ở phía client (chỉ
// có id/name/is_public/save_count), nên tạm dùng tiêu chí "đang trống" (không phân biệt mới tạo
// hay tạo lâu rồi) thay vì thời gian, để không phải sửa thêm cột created_at ở nhiều nơi tạo thư mục.
function renderFavEmptyFolderReminder() {
  const el = document.getElementById('favEmptyFolderReminder');
  if (!el) return;
  const emptyFolders = favoriteFolders.filter(f => countWordsInFolder(f.id) === 0 && countVideosInFolder(f.id) === 0);
  if (!emptyFolders.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML =
    `<span>🧹 ${emptyFolders.length} thư mục đang trống: ${emptyFolders.map(f => escapeHtml(f.name)).join(', ')}</span>` +
    `<button type="button" class="hist-stale-review-btn" onclick="cleanupEmptyFolders()">Xóa hết</button>`;
}

async function cleanupEmptyFolders() {
  const emptyFolders = favoriteFolders.filter(f => countWordsInFolder(f.id) === 0 && countVideosInFolder(f.id) === 0);
  if (!emptyFolders.length) return;
  if (!confirm('Xóa ' + emptyFolders.length + ' thư mục đang trống?\n' + emptyFolders.map(f => '• ' + f.name).join('\n'))) return;
  for (const f of emptyFolders) {
    await deleteFavFolder(f.id, null, true);
  }
  showToast('🧹 Đã dọn ' + emptyFolders.length + ' thư mục trống');
}

function renderFavorites() {
  // Đảm bảo activeFavFolder trỏ tới thư mục còn tồn tại, nếu không thì quay về "Tất cả"
  if (activeFavFolder !== 'all' && activeFavFolder !== 'none' && !favoriteFolders.some(f => f.id === activeFavFolder)) {
    activeFavFolder = 'all';
  }

  // Nhóm các nghĩa đã lưu theo word_id: { wordId: [defIndex, ...] }
  const byWord = {};
  favorites.forEach(key => {
    const { wordId, defIndex } = favKeyParts(key);
    if (!byWord[wordId]) byWord[wordId] = [];
    byWord[wordId].push(defIndex);
  });
  const allWordIds = Object.keys(byWord).map(Number);

  // Nhãn số lượng cho 1 thư mục (VD "12 từ"); thư mục chưa có từ nào ghi "Trống".
  function folderCountLabel(wordCount, videoCount) {
    const parts = [];
    if (wordCount > 0) parts.push(wordCount + ' từ');
    if (videoCount > 0) parts.push(videoCount + ' video');
    return parts.length ? parts.join(' · ') : 'Trống';
  }

  const gridEl = document.getElementById('favFolderGrid');
  if (gridEl) {
    const cards = [
      `<button class="fav-folder-card ${activeFavFolder === 'all' ? 'active' : ''}" onclick="setActiveFavFolder('all')">
        <div class="ffc-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg></div>
        <div class="ffc-name">Tất cả</div>
        <div class="ffc-count">${folderCountLabel(allWordIds.length, savedVideos.length)}</div>
      </button>`,
      `<button class="fav-folder-card ${activeFavFolder === 'none' ? 'active' : ''}" onclick="setActiveFavFolder('none')">
        <div class="ffc-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg></div>
        <div class="ffc-name">Chưa phân loại</div>
        <div class="ffc-count">${folderCountLabel(countWordsInFolder(null), countVideosInFolder(null))}</div>
      </button>`
    ];
    favoriteFolders.forEach(f => {
      cards.push(`
        <button class="fav-folder-card ${activeFavFolder === f.id ? 'active' : ''}" onclick="setActiveFavFolder('${f.id}')">
          ${f.is_public ? '<div class="ffc-badge-public" title="Thư mục công khai, ai cũng xem được ở mục Cộng đồng">🌐</div>' : ''}
          <div class="ffc-menu-wrap" onclick="event.stopPropagation()">
            <span class="ffc-menu-btn" role="button" tabindex="0" onclick="toggleFfcMenu('ffc-menu-${f.id}', event)" title="Tuỳ chọn thư mục" aria-label="Tuỳ chọn thư mục"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></span>
            <div class="ffc-menu" id="ffc-menu-${f.id}">
              <span class="ffc-menu-item" role="button" tabindex="0" onclick="toggleFavFolderPublic('${f.id}', event); closeAllFfcMenus()">${f.is_public ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Chuyển về riêng tư' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg> Công khai thư mục'}</span>
              <span class="ffc-menu-item" role="button" tabindex="0" onclick="renameFavFolder('${f.id}', event); closeAllFfcMenus()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg> Đổi tên</span>
              <span class="ffc-menu-item" role="button" tabindex="0" onclick="editFavFolderDescription('${f.id}', event); closeAllFfcMenus()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg> Lời giới thiệu</span>
              <span class="ffc-menu-item" role="button" tabindex="0" onclick="exportFavFolder('${f.id}', event); closeAllFfcMenus()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg> Xuất danh sách</span>
              <span class="ffc-menu-item ffc-menu-item-danger" role="button" tabindex="0" onclick="deleteFavFolder('${f.id}', event); closeAllFfcMenus()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Xóa thư mục</span>
            </div>
          </div>
          <div class="ffc-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></div>
          <div class="ffc-name">${f.name}</div>
          <div class="ffc-count">${folderCountLabel(countWordsInFolder(f.id), countVideosInFolder(f.id))}</div>
        </button>
      `);
    });
    cards.push(`<button class="fav-folder-card fav-folder-card-add" onclick="createFavFolder()">
      <div class="ffc-icon">+</div>
      <div class="ffc-name">Thư mục mới</div>
    </button>`);
    gridEl.innerHTML = cards.join('');
  }

  renderFavEmptyFolderReminder();

  let wordIdsToShow = allWordIds;
  if (activeFavFolder === 'none') wordIdsToShow = allWordIds.filter(wid => byWord[wid].some(di => !(favFolderMap[favKey(wid, di)] && favFolderMap[favKey(wid, di)].length)));
  else if (activeFavFolder !== 'all') wordIdsToShow = allWordIds.filter(wid => byWord[wid].some(di => (favFolderMap[favKey(wid, di)] || []).includes(activeFavFolder)));

  const hadAnyBeforeSearch = wordIdsToShow.length;

  // Tìm kiếm trong Sổ tay (kết hợp thêm với thư mục đang lọc ở trên, không thay thế)
  if (favSearchQuery) {
    wordIdsToShow = wordIdsToShow.filter(wid => {
      const w = allWords.find(w => w.id === wid);
      if (!w) return false;
      return w.thai.includes(favSearchQuery) ||
        (w.phonetic && w.phonetic.toLowerCase().includes(favSearchQuery)) ||
        (w.meanings || []).some(m => m.toLowerCase().includes(favSearchQuery));
    });
  }

  // Sắp xếp danh sách từ — mặc định giữ nguyên thứ tự lưu (allWordIds theo Object.keys(byWord),
  // vốn theo thứ tự favorites[] — mới lưu sau nằm sau). "az": theo chữ Thái. "due": theo hạn ôn
  // SRS gần nhất (lấy hạn SỚM NHẤT trong các nghĩa đã lưu của từ đó). "recent": mới lưu gần đây
  // lên đầu (đảo ngược thứ tự mặc định, vì favorites[] vốn nối thêm vào cuối mỗi lần lưu mới).
  if (favSortMode !== 'default') {
    wordIdsToShow = wordIdsToShow.slice().sort((a, b) => {
      if (favSortMode === 'az') {
        const wa = allWords.find(w => w.id === a), wb = allWords.find(w => w.id === b);
        return (wa && wb) ? wa.thai.localeCompare(wb.thai, 'th') : 0;
      }
      if (favSortMode === 'due') {
        const dueOf = (wid) => Math.min(...byWord[wid].map(di => reviewSrsOf(favKey(wid, di)).due));
        return dueOf(a) - dueOf(b);
      }
      if (favSortMode === 'recent') return b - a; // wordId lớn hơn = lưu gần đây hơn (id tăng dần theo thời gian tạo bản ghi)
      return 0;
    });
  }

  // Video đã lưu: lọc theo thư mục đang chọn + ô tìm kiếm (tên/kênh/chữ phụ đề), mới lưu lên đầu
  let videosToShow = savedVideos.slice();
  if (activeFavFolder === 'none') videosToShow = videosToShow.filter(v => !(v.folders && v.folders.length));
  else if (activeFavFolder !== 'all') videosToShow = videosToShow.filter(v => (v.folders || []).includes(activeFavFolder));
  if (favSearchQuery) {
    videosToShow = videosToShow.filter(v =>
      (v.title || '').toLowerCase().includes(favSearchQuery) || (v.author || '').toLowerCase().includes(favSearchQuery) ||
      (v.captions || []).some(c => (c.thai || '').includes(favSearchQuery) || (c.viet || '').toLowerCase().includes(favSearchQuery)));
  }
  videosToShow.sort((a, b) => (b.created || 0) - (a.created || 0));
  const videoSectionHTML = buildSavedVideosSectionHTML(videosToShow);

  const el = document.getElementById('favList');
  if (!wordIdsToShow.length && videoSectionHTML) {
    // Không có từ nào để hiện nhưng có video: chỉ hiện phần video (không báo "chưa có gì được lưu")
    el.innerHTML = videoSectionHTML;
    updateFavSelectToolbar();
    renderFavReviewEntry();
    return;
  }
  if (!wordIdsToShow.length) {
    const searchMissWithVideos = !!favSearchQuery && !hadAnyBeforeSearch && savedVideos.length > 0; // chỉ có video đã lưu mà tìm không ra gì
    el.innerHTML = searchMissWithVideos
      ? '<div class="fav-empty">Không tìm thấy từ hoặc video phù hợp</div>'
      : !hadAnyBeforeSearch
      ? (allWordIds.length || savedVideos.length
        ? '<div class="fav-empty"><div style="display:flex;justify-content:center;opacity:0.5"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></div><br>Không có gì trong mục này</div>'
        : '<div class="fav-empty">❤️<br><br>Chưa có gì được lưu<br><span style="font-size:13px">Tra cứu và nhấn ❤️ ở từng nghĩa</span></div>')
      : '<div class="fav-empty">Không tìm thấy từ phù hợp trong mục này</div>';
    return;
  }

  const sections = [];

  if (wordIdsToShow.length) {
    sections.push(`
      <div class="fav-list-toolbar">
        <div class="fav-section-heading" style="margin:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v16"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/></svg> Từ (${wordIdsToShow.length})</div>
        <div class="fav-list-toolbar-actions">
          <!-- Dropdown sắp xếp tự dựng (thay <select> gốc trình duyệt — kiểu dáng khác nhau tuỳ hệ điều hành,
               không khớp các dropdown tự thiết kế khác của app như menu lọc loại túi mù) — xem
               toggleFavSortMenu()/closeFavSortMenu()/setFavSort() trong app.js. -->
          <div class="fav-sort-wrap" id="favSortWrap">
            <button type="button" class="fav-sort-btn" id="favSortBtn" aria-haspopup="true" aria-expanded="false" onclick="toggleFavSortMenu(event)">
              <span id="favSortBtnLabel">${FAV_SORT_LABELS[favSortMode]}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="fav-sort-menu" id="favSortMenu" role="menu" hidden>
              ${Object.keys(FAV_SORT_LABELS).map(m => '<button type="button" class="fav-sort-item' + (favSortMode === m ? ' active' : '') + '" role="menuitemradio" onclick="setFavSort(\'' + m + '\')">' + FAV_SORT_LABELS[m] + '</button>').join('')}
            </div>
          </div>
          <button type="button" class="fav-select-toggle-btn" id="favSelectToggleBtn" onclick="toggleFavSelectMode()">${favSelectMode ? 'Hủy chọn' : 'Chọn nhiều'}</button>
        </div>
      </div>
    `);
    sections.push(wordIdsToShow.map(wid => {
      const word = allWords.find(w => w.id === wid);
      if (!word) return '';
      const savedIndices = byWord[wid];
      const hasNote = savedIndices.some(di => { const n = favNotesMap[favKey(wid, di)]; return n && (n.noteDef || n.noteExample); });
      const maxBox = Math.max(1, ...savedIndices.map(di => (favSrsMap[favKey(wid, di)] || { box: 1 }).box));
      const srsDots = Array.from({ length: 5 }, (_, i) => `<span class="fav-srs-dot${i < maxBox ? ' filled' : ''}"></span>`).join('');
      const checked = favSelectedIds.has(wid);
      return `
      <div class="fav-word-row">
        <div class="fav-word-row-head ${favSelectMode ? 'fav-select-mode' : ''}" onclick="${favSelectMode ? 'toggleFavSelectItem(' + wid + ')' : 'toggleFavExpand(' + wid + ')'}">
          ${favSelectMode ? `<input type="checkbox" class="fav-select-checkbox" data-id="${wid}" ${checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleFavSelectItem(${wid})">` : ''}
          <div class="fav-word-row-main">
            <div class="fav-word-row-top">
              <span class="fav-word-row-thai">${word.thai}</span>
              ${hasNote ? '<span class="fav-note-flag" title="Từ này có ghi chú"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></span>' : ''}
              <span class="fav-srs-dots" title="Mức độ ôn tập (${maxBox}/5)">${srsDots}</span>
            </div>
            ${word.phonetic ? '<div class="fav-word-row-phonetic">' + word.phonetic + '</div>' : ''}
          </div>
          <div class="fav-word-row-actions">
            <button class="btn-small" title="Phát âm" onclick="event.stopPropagation(); speakText('${jsAttrStr(word.thai)}', this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg></button>
            <button class="btn-small" title="Chuyển sang thư mục khác" onclick="event.stopPropagation(); openMoveWordFolderPicker(${wid})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></button>
            <button class="btn-small del" title="Xóa khỏi yêu thích" onclick="event.stopPropagation(); deleteFavWord(${wid})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
            <span class="fav-word-row-caret" id="fav-caret-${wid}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
          </div>
        </div>
        <div class="fav-word-row-body" id="fav-expand-${wid}"></div>
      </div>`;
    }).join(''));
  }

  el.innerHTML = videoSectionHTML + sections.join('');
  updateFavSelectToolbar();
  renderFavReviewEntry();
}

// Mở/đóng phần chi tiết của 1 từ ngay trong trang Yêu thích (không chuyển trang)
function toggleFavExpand(wid) {
  const body = document.getElementById('fav-expand-' + wid);
  const caret = document.getElementById('fav-caret-' + wid);
  if (!body) return;
  const isOpen = body.classList.contains('show');
  document.querySelectorAll('.fav-word-row-body.show').forEach(b => {
    if (b !== body) { b.classList.remove('show'); b.innerHTML = ''; }
  });
  // Caret là 1 icon chevron SVG CỐ ĐỊNH (xem template dòng render) — chỉ xoay 180° bằng class "open" (CSS
  // transition: transform), không đổi nội dung; trước đây đổi textContent thành ký tự ▾/▴ nên sau khi đổi
  // sang icon SVG, cách làm cũ sẽ XOÁ MẤT icon mỗi lần bấm.
  document.querySelectorAll('.fav-word-row-caret').forEach(c => {
    if (c.id !== 'fav-caret-' + wid) c.classList.remove('open');
  });
  if (isOpen) {
    body.classList.remove('show');
    body.innerHTML = '';
    if (caret) caret.classList.remove('open');
  } else {
    renderFavExpandedRow(wid);
    body.classList.add('show');
    if (caret) caret.classList.add('open');
  }
}

// Hiển thị chi tiết 1 từ ngay trong trang Yêu thích — giao diện giống hệt kết quả tra từ ở trang chính
function renderFavExpandedRow(wid) {
  const body = document.getElementById('fav-expand-' + wid);
  const word = allWords.find(w => w.id === wid);
  if (!body || !word) return;
  body.innerHTML = `
    <div class="fav-expand-top">
      <div class="word-thai-wrap">
        ${buildWordFontsHTML(word.thai)}
      </div>
      <button class="btn-action btn-speak" aria-label="Phát âm" data-tooltip="Phát âm" onclick="speakText('${word.thai}', this)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>
      </button>
    </div>
    ${word.phonetic ? `<div class="word-phonetic">${word.phonetic}</div>` : ''}
    ${word.structure ? `<div class="word-structure">${word.structure}</div>` : ''}
    <div class="fav-expand-defs"></div>
  `;
  applyWordThaiLayout(body.querySelector('.word-thai-wrap'));
  const defEl = body.querySelector('.fav-expand-defs');
  const savedIndices = favorites.filter(k => k.startsWith(wid + ':')).map(k => favKeyParts(k).defIndex);
  defEl.innerHTML = buildDefinitionsHTML(word, savedIndices);
  segmentizeDefsIfEnabled(defEl);
}

// Xóa hẳn 1 từ khỏi Yêu thích (xóa toàn bộ các nghĩa đã lưu của từ đó)
async function deleteFavWord(wid) {
  if (!confirm('Xóa từ này khỏi mục yêu thích? (tất cả nghĩa đã lưu của từ này sẽ bị xóa)')) return;
  favorites = favorites.filter(k => !k.startsWith(wid + ':'));
  Object.keys(favFolderMap).forEach(k => { if (k.startsWith(wid + ':')) delete favFolderMap[k]; });
  Object.keys(favNotesMap).forEach(k => { if (k.startsWith(wid + ':')) delete favNotesMap[k]; });
  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorites?user_id=eq.' + session.user.id + '&word_id=eq.' + wid);
      await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=eq.' + wid);
    }
    catch (e) { showToast('⚠️ Lỗi khi xóa'); }
  } else {
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
    localStorage.setItem('thai_fav_notes', JSON.stringify(favNotesMap));
  }
  updateStats();
  showToast('Đã xóa khỏi yêu thích');
  renderFavorites();
}

// ── THƯ MỤC CHỦ ĐỀ CHO YÊU THÍCH ────────────────────────
let favSearchQuery = ''; // tìm kiếm trong Sổ tay — xem onFavSearch()
let favSortMode = 'default'; // 'default' | 'az' | 'due' | 'recent' — xem setFavSort()
const FAV_SORT_LABELS = { default: 'Mặc định', recent: 'Mới lưu gần đây', due: 'Sắp đến hạn ôn nhất', az: 'A-Z' };
let favSelectMode = false; // "Chọn nhiều" ở Sổ tay — CHỈ áp dụng cho từ (không áp dụng cho câu)
let favSelectedIds = new Set(); // các wordId đang được chọn

function onFavSearch(val) {
  favSearchQuery = (val || '').trim().toLowerCase();
  renderFavorites();
}

// Dropdown sắp xếp tự dựng (thay <select> gốc) — mở/đóng/bấm-ra-ngoài/Esc, là 1 menu riêng (#favSortMenu).
function toggleFavSortMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('favSortMenu');
  const btn = document.getElementById('favSortBtn');
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
function closeFavSortMenu() {
  const menu = document.getElementById('favSortMenu');
  const btn = document.getElementById('favSortBtn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('favSortWrap');
  if (wrap && !wrap.contains(e.target)) closeFavSortMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFavSortMenu(); });

function setFavSort(mode) {
  closeFavSortMenu();
  if (mode === favSortMode) return;
  favSortMode = mode;
  renderFavorites();
}

function toggleFavSelectMode() {
  favSelectMode = !favSelectMode;
  favSelectedIds.clear();
  renderFavorites();
  updateFavSelectToolbar();
}

function toggleFavSelectItem(wid) {
  if (favSelectedIds.has(wid)) favSelectedIds.delete(wid); else favSelectedIds.add(wid);
  const cb = document.querySelector('.fav-select-checkbox[data-id="' + wid + '"]');
  if (cb) cb.checked = favSelectedIds.has(wid);
  updateFavSelectToolbar();
}

// Chọn tất cả các từ ĐANG hiển thị (đã áp dụng thư mục/tìm kiếm/sắp xếp) — lấy từ checkbox
// trong DOM để luôn khớp đúng với những gì người dùng đang thấy.
function favSelectAllVisible() {
  document.querySelectorAll('.fav-select-checkbox').forEach(cb => {
    favSelectedIds.add(parseInt(cb.dataset.id, 10));
    cb.checked = true;
  });
  updateFavSelectToolbar();
}

function updateFavSelectToolbar() {
  const bar = document.getElementById('favSelectToolbar');
  const toggleBtn = document.getElementById('favSelectToggleBtn');
  if (toggleBtn) toggleBtn.textContent = favSelectMode ? 'Hủy chọn' : 'Chọn nhiều';
  if (!bar) return;
  bar.style.display = favSelectMode ? 'flex' : 'none';
  const n = favSelectedIds.size;
  const countEl = document.getElementById('favSelectCount');
  if (countEl) countEl.textContent = n + ' đã chọn';
  const moveBtn = document.getElementById('favSelectMoveBtn');
  const delBtn = document.getElementById('favSelectDeleteBtn');
  if (moveBtn) moveBtn.disabled = n === 0;
  if (delBtn) delBtn.disabled = n === 0;
}

async function favSelectedDeleteBulk() {
  const ids = [...favSelectedIds];
  if (!ids.length) return;
  if (!confirm('Xóa ' + ids.length + ' từ khỏi yêu thích? (tất cả nghĩa đã lưu của các từ này sẽ bị xóa)')) return;
  ids.forEach(wid => {
    favorites = favorites.filter(k => !k.startsWith(wid + ':'));
    Object.keys(favFolderMap).forEach(k => { if (k.startsWith(wid + ':')) delete favFolderMap[k]; });
    Object.keys(favNotesMap).forEach(k => { if (k.startsWith(wid + ':')) delete favNotesMap[k]; });
  });
  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorites?user_id=eq.' + session.user.id + '&word_id=in.(' + ids.join(',') + ')');
      await sbDeleteAuth('favorite_folder_links?user_id=eq.' + session.user.id + '&word_id=in.(' + ids.join(',') + ')');
    } catch (e) { showToast('⚠️ Lỗi khi xóa'); }
  } else {
    localStorage.setItem('thai_favs', JSON.stringify(favorites));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
    localStorage.setItem('thai_fav_notes', JSON.stringify(favNotesMap));
  }
  favSelectMode = false;
  favSelectedIds.clear();
  updateStats();
  showToast('Đã xóa ' + ids.length + ' từ khỏi yêu thích');
  renderFavorites();
}

function favSelectedMoveBulk() {
  const ids = [...favSelectedIds];
  if (!ids.length) return;
  openMoveWordFolderPickerBulk(ids);
}

function setActiveFavFolder(rawId) {
  if (rawId === 'all' || rawId === 'none') { activeFavFolder = rawId; }
  else { activeFavFolder = isNaN(Number(rawId)) ? rawId : Number(rawId); }
  renderFavorites();
}

// Bộ nhớ tạm cho lần showTextPromptModal() đang mở — resolve() của Promise hiện tại (đang mở hay không, chặn mở
// chồng 2 lần, vd bấm rất nhanh 2 lần vào "Đổi tên" ở 2 thẻ khác nhau trước khi popup đầu kịp hiện).
let textPromptResolve = null;
// Popup nhập-chữ dùng chung, thay prompt() gốc trình duyệt (xấu, không theo giao diện/dark mode của app, và một
// số trình duyệt mobile chặn hẳn). opts: { title, sub, value, placeholder, multiline }. Trả về Promise<string|null>
// — chuỗi (có thể rỗng) nếu bấm OK/Enter, null nếu Huỷ/Esc/bấm ra ngoài, ĐÚNG như ngữ nghĩa prompt() gốc để 3 hàm
// gọi nó (createFavFolder/renameFavFolder/editFavFolderDescription) giữ nguyên logic if (!name) return /
// if (newDesc === null) return đã có sẵn.
function showTextPromptModal(opts) {
  if (textPromptResolve) return Promise.resolve(null); // đang có 1 popup khác mở dở — không mở chồng
  const overlay = document.getElementById('textPromptModal');
  const input = document.getElementById('textPromptInput');
  const textarea = document.getElementById('textPromptTextarea');
  const field = opts.multiline ? textarea : input;
  document.getElementById('textPromptTitle').textContent = opts.title || '';
  const subEl = document.getElementById('textPromptSub');
  subEl.style.display = opts.sub ? '' : 'none';
  subEl.textContent = opts.sub || '';
  input.style.display = opts.multiline ? 'none' : '';
  textarea.style.display = opts.multiline ? '' : 'none';
  field.value = opts.value || '';
  field.placeholder = opts.placeholder || '';
  overlay.classList.add('show');
  setTimeout(() => { field.focus(); field.select(); }, 30); // sau khi popup kịp hiện (transition mở) mới focus
  return new Promise(resolve => { textPromptResolve = resolve; });
}
// result: chuỗi (OK/Enter) | null (Huỷ/Esc/bấm ra ngoài) | undefined (nút OK — nghĩa là "đọc từ ô nhập").
function closeTextPromptModal(result) {
  if (!textPromptResolve) return;
  const overlay = document.getElementById('textPromptModal');
  const field = document.getElementById('textPromptTextarea').style.display === 'none'
    ? document.getElementById('textPromptInput') : document.getElementById('textPromptTextarea');
  const value = result === undefined ? field.value : result;
  overlay.classList.remove('show');
  const resolve = textPromptResolve;
  textPromptResolve = null;
  resolve(value);
}
document.addEventListener('keydown', e => {
  if (!textPromptResolve) return;
  if (e.key === 'Escape') closeTextPromptModal(null);
  else if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'textPromptInput') closeTextPromptModal(undefined);
});

async function createFavFolder() {
  const raw = await showTextPromptModal({ title: 'Tên thư mục mới', placeholder: 'vd: Đồ ăn, Du lịch, Công việc...' });
  const name = (raw || '').trim();
  if (!name) return;
  if (favoriteFolders.some(f => f.name.toLowerCase() === name.toLowerCase())) {
    showToast('⚠️ Thư mục này đã tồn tại');
    return;
  }
  if (isLoggedIn()) {
    try {
      const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name });
      const row = Array.isArray(created) ? created[0] : created;
      if (!row) throw new Error('no row returned');
      favoriteFolders.push({ id: row.id, name: row.name, is_public: false, save_count: 0 });
      activeFavFolder = row.id;
    } catch (e) { showToast('⚠️ Không thể tạo thư mục, thử lại sau'); return; }
  } else {
    const id = genLocalFolderId();
    favoriteFolders.push({ id, name, is_public: false, save_count: 0 });
    localStorage.setItem('thai_fav_folders', JSON.stringify(favoriteFolders));
    activeFavFolder = id;
  }
  showToast('📁 Đã tạo thư mục "' + name + '"');
  renderFavorites();
}

async function deleteFavFolder(rawId, event, skipConfirm) {
  if (event) event.stopPropagation();
  const folderId = isNaN(Number(rawId)) ? rawId : Number(rawId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder) return;
  if (!skipConfirm && !confirm('Xóa thư mục "' + folder.name + '"? Các nghĩa trong thư mục sẽ chuyển về "Chưa phân loại".')) return;

  if (isLoggedIn()) {
    try {
      await sbDeleteAuth('favorite_folders?id=eq.' + folderId + '&user_id=eq.' + session.user.id);
      // favorites.folder_id (cột cũ) tự động về NULL nhờ khóa ngoại "on delete set null"; còn
      // favorite_folder_links (bảng mới, nhiều-nhiều) đã khai báo "on delete cascade" nên các
      // dòng liên kết tới thư mục này cũng tự xoá theo, không cần xoá tay thêm ở đây.
    } catch (e) { showToast('⚠️ Lỗi khi xóa thư mục'); return; }
  }
  favoriteFolders = favoriteFolders.filter(f => f.id !== folderId);
  Object.keys(favFolderMap).forEach(k => {
    const arr = favFolderMap[k];
    if (!Array.isArray(arr)) return;
    const idx = arr.indexOf(folderId);
    if (idx !== -1) arr.splice(idx, 1);
    if (!arr.length) delete favFolderMap[k];
  });
  if (!isLoggedIn()) {
    localStorage.setItem('thai_fav_folders', JSON.stringify(favoriteFolders));
    localStorage.setItem('thai_fav_folder_map', JSON.stringify(favFolderMap));
  }
  // Video đã lưu trong thư mục này chuyển về "Chưa phân loại" (id thư mục nằm trong chính dòng video nên phải gỡ tay)
  for (const sv of savedVideos) {
    if ((sv.folders || []).includes(folderId)) { sv.folders = sv.folders.filter(x => x !== folderId); await persistSavedVideo(sv); }
  }
  if (activeFavFolder === folderId) activeFavFolder = 'all';
  showToast('Đã xóa thư mục');
  renderFavorites();
}

// Xuất danh sách 1 thư mục ra file .txt (Thái — phiên âm — nghĩa mỗi dòng) để in ra hoặc chép
// sang nơi khác — khác với "Công khai thư mục" (vốn là chia sẻ NGAY TRONG app qua mục Cộng
// đồng), cái này mang nội dung RA NGOÀI app.
function exportFavFolder(rawId, event) {
  if (event) event.stopPropagation();
  const folderId = isNaN(Number(rawId)) ? rawId : Number(rawId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder) return;
  const byWordExport = {};
  favorites.forEach(k => {
    const { wordId, defIndex } = favKeyParts(k);
    (byWordExport[wordId] = byWordExport[wordId] || []).push(defIndex);
  });
  const wordIds = Object.keys(byWordExport).map(Number).filter(wid =>
    byWordExport[wid].some(di => (favFolderMap[favKey(wid, di)] || []).includes(folderId))
  );
  if (!wordIds.length) { showToast('Thư mục này chưa có từ nào để xuất'); return; }
  const lines = wordIds.map(wid => {
    const w = allWords.find(w => w.id === wid);
    if (!w) return null;
    return w.thai + (w.phonetic ? ' (' + w.phonetic + ')' : '') + (w.meanings && w.meanings.length ? ' — ' + w.meanings.join('; ') : '');
  }).filter(Boolean);
  const content = folder.name + '\n' + '='.repeat(folder.name.length) + '\n\n' + lines.join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = folder.name.replace(/[\\/:*?"<>|]/g, '_') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('⬇ Đã xuất ' + wordIds.length + ' từ');
}

async function toggleFavFolderPublic(rawId, event) {
  if (event) event.stopPropagation();
  if (!isLoggedIn()) { showToast('🔒 Đăng nhập để công khai thư mục'); openAuthModal('login'); return; }
  const folderId = isNaN(Number(rawId)) ? rawId : Number(rawId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder) return;
  if (typeof folderId !== 'number') { showToast('⚠️ Thư mục cần đồng bộ tài khoản trước khi công khai được'); return; }

  const makePublic = !folder.is_public;
  if (makePublic && !confirm('Công khai thư mục "' + folder.name + '"? Mọi người sẽ xem được toàn bộ từ trong thư mục này ở mục Cộng đồng.')) return;

  try {
    await sbPatchAuth('favorite_folders?id=eq.' + folderId + '&user_id=eq.' + session.user.id, {
      is_public: makePublic, owner_display_name: session.user.display_name || ''
    });
  } catch (e) { showToast('⚠️ Không thể đổi trạng thái, thử lại sau'); return; }
  folder.is_public = makePublic;
  showToast(makePublic ? '🌐 Đã công khai thư mục "' + folder.name + '"' : '🔒 Đã chuyển về riêng tư');
  renderFavorites();
  // Xóa cache Cộng đồng để lần sau mở tab sẽ tải lại danh sách mới nhất
  folderExploreCache = null;
  folderMineCache = null;
  wlistSavedFoldersCache = null;
}


async function renameFavFolder(rawId, event) {
  if (event) event.stopPropagation();
  const folderId = isNaN(Number(rawId)) ? rawId : Number(rawId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder) return;
  const rawName = await showTextPromptModal({ title: 'Đổi tên thư mục', value: folder.name });
  const newName = (rawName || '').trim();
  if (!newName || newName === folder.name) return;
  if (favoriteFolders.some(f => f.id !== folderId && f.name.toLowerCase() === newName.toLowerCase())) {
    showToast('⚠️ Tên thư mục này đã tồn tại');
    return;
  }
  if (isLoggedIn()) {
    try {
      await sbPatchAuth('favorite_folders?id=eq.' + folderId + '&user_id=eq.' + session.user.id, { name: newName });
    } catch (e) { showToast('⚠️ Không thể đổi tên thư mục, thử lại sau'); return; }
  }
  folder.name = newName;
  if (!isLoggedIn()) {
    localStorage.setItem('thai_fav_folders', JSON.stringify(favoriteFolders));
  }
  showToast('Đã đổi tên thư mục');
  renderFavorites();
}

// Lời giới thiệu (mô tả) do người dùng tự viết cho thư mục — hiện ở card trong tab "Khám phá"
// khi thư mục được công khai (giống mô tả của "Danh sách" vốn đã có sẵn field description).
async function editFavFolderDescription(rawId, event) {
  if (event) event.stopPropagation();
  const folderId = isNaN(Number(rawId)) ? rawId : Number(rawId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder) return;
  const newDesc = await showTextPromptModal({
    title: 'Lời giới thiệu thư mục "' + folder.name + '"',
    sub: 'Hiện ở tab Khám phá khi thư mục công khai.',
    value: folder.description || '', multiline: true, placeholder: 'Viết vài dòng giới thiệu thư mục này...'
  });
  if (newDesc === null) return; // bấm Huỷ
  const trimmed = newDesc.trim();
  if (isLoggedIn()) {
    try {
      await sbPatchAuth('favorite_folders?id=eq.' + folderId + '&user_id=eq.' + session.user.id, { description: trimmed || null });
    } catch (e) { showToast('⚠️ Không thể lưu lời giới thiệu, thử lại sau'); return; }
  }
  folder.description = trimmed || null;
  if (!isLoggedIn()) {
    localStorage.setItem('thai_fav_folders', JSON.stringify(favoriteFolders));
  }
  showToast('Đã lưu lời giới thiệu');
  // Xóa cache Cộng đồng để lần sau mở tab Khám phá hiện đúng mô tả mới — chỉ cần làm nếu thư mục
  // đang công khai (riêng tư thì không hiện ở Khám phá nên không cần làm mới cache).
  if (folder.is_public) { folderExploreCache = null; folderMineCache = null; wlistSavedFoldersCache = null; }
}

// ── DANH SÁCH TỪ VỰNG CỘNG ĐỒNG (word_lists / word_list_items / word_list_saves) ──
let favActiveTab = 'mine';           // 'mine' | 'community'
let wlistSegment = 'explore';        // 'explore' (công khai, mọi người) | 'mine' (danh sách tôi tạo) | 'saved' (đã lưu từ người khác)
let wlistExploreCache = null;        // cache danh sách công khai đã tải
let wlistMineCache = null;           // cache danh sách của chính user đã tải
let wlistSavedListsCache = null;     // cache đầy đủ các danh sách NGƯỜI KHÁC mà mình đã lưu (tab "Đã lưu")
let wlistSavedFoldersCache = null;   // tương tự, cho thư mục
let wlistSortMode = 'popular';       // 'popular' | 'newest' | 'wordcount' — xem setWlistSort()
let wlistTypeFilter = 'all';         // 'all' | 'list' | 'folder' — xem setWlistTypeFilter()
let wlistMySaves = [];               // list_id mà user hiện tại đã "Lưu về Yêu thích"
let wlistMyFolderSaves = [];         // folder_id (thư mục công khai) mà user hiện tại đã "Lưu về Yêu thích"
let wlistCurrentDetail = null;       // { type: 'list'|'folder', ...dữ liệu, items:[...] } đang xem chi tiết, hoặc null
let wlistEditingId = null;           // id danh sách đang sửa (null = đang tạo mới)
let folderExploreCache = null;       // cache thư mục Yêu thích công khai (của mọi người) đã tải
let folderMineCache = null;          // cache thư mục Yêu thích công khai của chính mình đã tải
let wlistAuthorViewing = null;       // { id, name } tác giả đang xem toàn bộ danh sách/thư mục công khai, hoặc null
let wlistAuthorCache = null;         // cache danh sách/thư mục công khai của tác giả đang xem

// Menu ngang các mục quản trị (Từ vựng/Trang chủ/Hôm nay có gì?/Font Challenge/Người dùng/
// Phản hồi/Ngân hàng dịch) — thay cho danh sách rất dài xếp dọc trước đây. Các khối
// .admin-tab-panel KHÔNG bị di chuyển trong DOM (dữ liệu vẫn tải/đổ vào như cũ ngay khi vào
// trang Admin, xem showPage('admin') trong app.js), hàm này chỉ toggle hiện/ẩn theo data-tab.
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.admin-tab-panel').forEach(function(panel) {
    panel.classList.toggle('active', panel.dataset.tab === tab);
  });
  const tabsEl = document.getElementById('adminTabs');
  if (tabsEl) tabsEl.scrollTop = 0;
  const pageAdmin = document.getElementById('page-admin');
  if (pageAdmin) pageAdmin.scrollTop = 0;
}

let favPrevTab = 'mine'; // tab đang xem trước khi mở màn "Đề xuất từ" (nút Quay lại ở đầu màn đó quay về đây)
function switchFavTab(tab) {
  if (tab === 'suggest' && favActiveTab !== 'suggest') favPrevTab = favActiveTab;
  favActiveTab = tab;
  document.getElementById('favTabBtnMine').classList.toggle('active', tab === 'mine');
  document.getElementById('favTabBtnCommunity').classList.toggle('active', tab === 'community');
  document.getElementById('favTabBtnHistory').classList.toggle('active', tab === 'history');
  const reviewTabBtn = document.getElementById('favTabBtnReview');
  if (reviewTabBtn) reviewTabBtn.classList.toggle('active', tab === 'review');
  const reviewTabPanel = document.getElementById('favReviewTab');
  if (reviewTabPanel) reviewTabPanel.style.display = tab === 'review' ? '' : 'none';
  document.getElementById('favMineTab').style.display = tab === 'mine' ? '' : 'none';
  if (tab === 'mine') renderFavReviewEntry();
  document.getElementById('favCommunityTab').style.display = tab === 'community' ? '' : 'none';
  document.getElementById('favHistoryTab').style.display = tab === 'history' ? '' : 'none';
  document.getElementById('favSuggestTab').style.display = tab === 'suggest' ? '' : 'none';
  if (tab === 'community') {
    closeWlistDetail();
    closeAuthorLists();
    loadWlistSegment();
  }
  // Lịch sử tra từ trước đây là trang riêng (#page-history), giờ là tab thứ 3 ở đây — render lại
  // danh sách mỗi lần chuyển sang tab này để luôn khớp lịch sử mới nhất.
  if (tab === 'history') {
    renderRecentFullList();
  } else {
    // Rời khỏi tab Lịch sử: tắt chế độ "Chọn nhiều" nếu đang bật, tránh giữ lại trạng thái chọn
    // dở khi quay lại tab khác rồi trở lại.
    historySelectMode = false;
    historySelectedIds.clear();
    updateHistorySelectToolbar();
  }
  if (tab !== 'mine') {
    // Rời khỏi Sổ tay: reset tìm kiếm/chọn nhiều để lần sau quay lại không bị giữ trạng thái cũ
    favSearchQuery = '';
    const favSearchInput = document.getElementById('favSearchInput');
    if (favSearchInput) favSearchInput.value = '';
    favSelectMode = false;
    favSelectedIds.clear();
  }
  // Đề xuất từ mới trước đây là mục riêng trên thanh menu dọc — giờ là tab thứ 4 ở đây; reset
  // form mỗi lần vào tab để không giữ lại nội dung của lượt gửi trước.
  if (tab === 'suggest') resetSuggestTabForm();
  // Tab "Từ cần ôn": vào là dựng hàng đợi + hiện câu ôn luôn (xem openReviewPage) — mỗi lần vào tab đều dựng lại để từ đến hạn luôn mới nhất.
  if (tab === 'review') openReviewPage();
}

// Cách sắp xếp mặc định theo từng tab con: Cộng đồng = phổ biến nhất; Của tôi / Đã lưu = MỚI NHẤT (nếu để "phổ biến" thì danh sách vừa tạo, 0 lượt lưu, bị
// đẩy xuống cuối "Của tôi" và người dùng tưởng chưa tạo được).
const WLIST_DEFAULT_SORT = { explore: 'popular', mine: 'newest', saved: 'newest' };

// Đồng bộ giao diện với wlistSegment: nút tab con đang chọn, nút "Tạo danh sách" (CHỈ hiện ở "Của tôi" — nơi danh sách mới xuất hiện), nhãn sắp xếp mặc định.
function wlistSyncSegmentUi(resetSort) {
  document.getElementById('wlistSegBtnExplore').classList.toggle('active', wlistSegment === 'explore');
  document.getElementById('wlistSegBtnMine').classList.toggle('active', wlistSegment === 'mine');
  document.getElementById('wlistSegBtnSaved').classList.toggle('active', wlistSegment === 'saved');
  const createBtn = document.getElementById('wlistCreateBtn');
  if (createBtn) createBtn.style.display = wlistSegment === 'mine' ? '' : 'none';
  if (resetSort) wlistApplySortUi(WLIST_DEFAULT_SORT[wlistSegment] || 'popular');
}

function setWlistSegment(seg) {
  if ((seg === 'mine' || seg === 'saved') && !isLoggedIn()) { openAuthModal('login'); return; }
  wlistSegment = seg;
  wlistAuthorViewing = null;
  wlistResetPaging();
  wlistSyncSegmentUi(true);
  loadWlistSegment();
}

// Xem toàn bộ danh sách + thư mục công khai của 1 người dùng (bấm vào tên tác giả)
async function openAuthorLists(ownerId, ownerName) {
  wlistAuthorViewing = { id: ownerId, name: ownerName };
  document.getElementById('wlistNormalToolbar').style.display = 'none';
  document.getElementById('wlistAuthorToolbar').style.display = '';
  document.getElementById('wlistAuthorToolbarTitle').innerHTML = USER_ICON_SVG + ' Công khai bởi ' + escapeHtml(ownerName);
  closeWlistDetail();
  const gridEl = document.getElementById('wlistGrid');
  if (gridEl) gridEl.innerHTML = '<div class="wlist-empty">Đang tải...</div>';
  try {
    const [lists, folders] = await Promise.all([
      sbGet('word_lists?select=*&owner_id=eq.' + ownerId + '&is_public=eq.true&order=save_count.desc'),
      sbGet('favorite_folders?select=*&user_id=eq.' + ownerId + '&is_public=eq.true&order=save_count.desc')
    ]);
    wlistAuthorCache = {
      lists: Array.isArray(lists) ? lists : [],
      folders: Array.isArray(folders) ? folders : []
    };
    await Promise.all([
      attachWlistListWordCounts(wlistAuthorCache.lists),
      attachWlistFolderWordCounts(wlistAuthorCache.folders)
    ]);
    if (isLoggedIn()) await loadWlistMySaves();
  } catch (e) {
    wlistAuthorCache = { lists: [], folders: [] };
    if (gridEl) gridEl.innerHTML = '<div class="wlist-empty">⚠️ Không tải được, thử lại sau</div>';
    return;
  }
  renderWlistGrid();
}

function closeAuthorLists() {
  wlistAuthorViewing = null;
  wlistAuthorCache = null;
  document.getElementById('wlistNormalToolbar').style.display = '';
  document.getElementById('wlistAuthorToolbar').style.display = 'none';
  renderWlistGrid();
}

const WLIST_SORT_LABELS = { popular: 'Phổ biến nhất', newest: 'Mới nhất', wordcount: 'Nhiều từ nhất' };
// Dropdown sắp xếp tự dựng cho Khám phá — cùng khuôn mở/đóng/bấm-ra-ngoài/Esc với favSort (Sổ tay) và
// todayFilterMenu (túi mù), tách hàm riêng vì đây là 1 menu khác (#wlistSortMenu).
function closeSuggestTab() { switchFavTab(favPrevTab && favPrevTab !== 'suggest' ? favPrevTab : 'mine'); }

// ⓘ cạnh chip lọc: bấm để hiện/ẩn lời giải thích "Danh sách khác Thư mục thế nào" (trước đây là 1 dòng luôn hiện).
function toggleWlistTypeHint() {
  const hint = document.getElementById('wlistTypeHint');
  const btn = document.getElementById('wlistInfoBtn');
  if (!hint) return;
  hint.hidden = !hint.hidden;
  if (btn) btn.setAttribute('aria-expanded', hint.hidden ? 'false' : 'true');
}

function toggleWlistSortMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('wlistSortMenu');
  const btn = document.getElementById('wlistSortBtn');
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
function closeWlistSortMenu() {
  const menu = document.getElementById('wlistSortMenu');
  const btn = document.getElementById('wlistSortBtn');
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('wlistSortWrap');
  if (wrap && !wrap.contains(e.target)) closeWlistSortMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWlistSortMenu(); });

// Đặt chế độ sắp xếp + cập nhật nhãn/menu (không render lại lưới — nơi gọi tự render).
function wlistApplySortUi(mode) {
  wlistSortMode = WLIST_SORT_LABELS[mode] ? mode : 'popular';
  const labelEl = document.getElementById('wlistSortBtnLabel');
  if (labelEl) labelEl.textContent = WLIST_SORT_LABELS[wlistSortMode];
  document.querySelectorAll('#wlistSortMenu .fav-sort-item').forEach((btn, i) => {
    btn.classList.toggle('active', Object.keys(WLIST_SORT_LABELS)[i] === wlistSortMode);
  });
}
function setWlistSort(mode) {
  closeWlistSortMenu();
  if (mode === wlistSortMode) return;
  wlistApplySortUi(mode);
  wlistResetPaging();
  renderWlistGrid();
}

function setWlistTypeFilter(t) {
  wlistResetPaging();
  wlistTypeFilter = t;
  document.querySelectorAll('.wlist-type-chip').forEach(b => b.classList.toggle('active', b.dataset.type === t));
  renderWlistGrid();
}

// Cache các danh sách chỉ sống 5 phút — quá hạn thì tải lại để thấy lượt lưu / danh sách mới của người khác (trước đây chỉ tải 1 lần mỗi lần mở trang).
const WLIST_CACHE_TTL_MS = 5 * 60 * 1000;
let wlistCacheAt = 0;
const WLIST_PAGE = 24;          // số thẻ hiện mỗi đợt; "Xem thêm" hiện tiếp
let wlistShowCount = WLIST_PAGE;
function wlistResetPaging() { wlistShowCount = WLIST_PAGE; }
function wlistShowMore() { wlistShowCount += WLIST_PAGE; renderWlistGrid(); }
function wlistOnSearch() { wlistResetPaging(); renderWlistGrid(); }

async function loadWlistSegment() {
  if (wlistCacheAt && Date.now() - wlistCacheAt > WLIST_CACHE_TTL_MS) {
    wlistExploreCache = null; folderExploreCache = null; wlistMineCache = null; folderMineCache = null; wlistSavedListsCache = null; wlistSavedFoldersCache = null;
    wlistCacheAt = 0;
  }
  wlistSyncSegmentUi(false);
  const gridEl = document.getElementById('wlistGrid');
  if (gridEl) gridEl.innerHTML = '<div class="wlist-empty">Đang tải...</div>';
  try {
    if (wlistSegment === 'explore') {
      if (!wlistExploreCache) {
        wlistExploreCache = await sbGet('word_lists?select=*&is_public=eq.true&order=save_count.desc,created_at.desc&limit=200');
        if (!Array.isArray(wlistExploreCache)) wlistExploreCache = [];
        await attachWlistListWordCounts(wlistExploreCache);
      }
      if (!folderExploreCache) {
        folderExploreCache = await sbGet('favorite_folders?select=*&is_public=eq.true&order=save_count.desc,created_at.desc&limit=200');
        if (!Array.isArray(folderExploreCache)) folderExploreCache = [];
        await attachWlistFolderWordCounts(folderExploreCache);
      }
      if (isLoggedIn()) await loadWlistMySaves();
    } else if (wlistSegment === 'saved') {
      if (!isLoggedIn()) { wlistSavedListsCache = []; wlistSavedFoldersCache = []; }
      else {
        await loadWlistMySaves();
        if (!wlistSavedListsCache) {
          wlistSavedListsCache = wlistMySaves.length
            ? await sbGet('word_lists?select=*&id=in.(' + wlistMySaves.join(',') + ')')
            : [];
          if (!Array.isArray(wlistSavedListsCache)) wlistSavedListsCache = [];
          await attachWlistListWordCounts(wlistSavedListsCache);
        }
        if (!wlistSavedFoldersCache) {
          wlistSavedFoldersCache = wlistMyFolderSaves.length
            ? await sbGet('favorite_folders?select=*&id=in.(' + wlistMyFolderSaves.join(',') + ')')
            : [];
          if (!Array.isArray(wlistSavedFoldersCache)) wlistSavedFoldersCache = [];
          await attachWlistFolderWordCounts(wlistSavedFoldersCache);
        }
      }
    } else {
      if (!isLoggedIn()) { wlistMineCache = []; folderMineCache = []; }
      else {
        if (!wlistMineCache) {
          wlistMineCache = await sbGetAuth('word_lists?select=*&owner_id=eq.' + session.user.id + '&order=created_at.desc');
          if (!Array.isArray(wlistMineCache)) wlistMineCache = [];
          await attachWlistListWordCounts(wlistMineCache);
        }
        if (!folderMineCache) {
          folderMineCache = await sbGetAuth('favorite_folders?select=*&user_id=eq.' + session.user.id + '&is_public=eq.true&order=created_at.desc');
          if (!Array.isArray(folderMineCache)) folderMineCache = [];
          await attachWlistFolderWordCounts(folderMineCache);
        }
      }
    }
  } catch (e) {
    if (gridEl) gridEl.innerHTML = '<div class="wlist-empty">⚠️ Không tải được danh sách, thử lại sau</div>';
    return;
  }
  if (!wlistCacheAt) wlistCacheAt = Date.now();
  renderWlistGrid();
}

// Đếm số từ trong mỗi thư mục công khai bằng 1 truy vấn gộp — TIỆN THỂ lấy luôn word_id để dựng
// preview 3 từ đầu tiên trên card (preview_words), không cần thêm truy vấn riêng cho việc đó.
// Từ khi có migration_wlist_counts.sql: số từ + 3 từ xem trước nằm sẵn trong hàng (word_count, preview_word_ids) → khỏi kéo toàn bộ dòng thành viên về đếm.
function wlistPreviewFromIds(ids) {
  return (ids || []).slice(0, 3).map(wid => { const w = allWords.find(w => w.id === wid); return w ? w.thai : null; }).filter(Boolean);
}
function wlistHasStoredCounts(rows) { return rows.every(r => typeof r.word_count === 'number' && Array.isArray(r.preview_word_ids)); }

async function attachWlistFolderWordCounts(folders) {
  if (!folders.length) return;
  if (wlistHasStoredCounts(folders)) { folders.forEach(f => { f.preview_words = wlistPreviewFromIds(f.preview_word_ids); }); return; }
  try {
    const ids = folders.map(f => f.id).join(',');
    // Thành viên thư mục nằm ở favorite_folder_links (nơi trang chi tiết thư mục đọc) — trước đây đọc favorites.folder_id (cột cũ) nên số từ trên thẻ có thể lệch.
    const rows = await sbGet('favorite_folder_links?select=folder_id,word_id&folder_id=in.(' + ids + ')');
    const counts = {};
    const previewIds = {};
    (Array.isArray(rows) ? rows : []).forEach(r => {
      counts[r.folder_id] = (counts[r.folder_id] || 0) + 1;
      (previewIds[r.folder_id] = previewIds[r.folder_id] || []).push(r.word_id);
    });
    folders.forEach(f => {
      f.word_count = counts[f.id] || 0;
      f.preview_words = (previewIds[f.id] || []).slice(0, 3)
        .map(wid => { const w = allWords.find(w => w.id === wid); return w ? w.thai : null; })
        .filter(Boolean);
    });
  } catch (e) {
    folders.forEach(f => { f.word_count = null; f.preview_words = []; });
  }
}

// Đếm số từ trong mỗi danh sách cộng đồng bằng 1 truy vấn gộp — tương tự, tiện thể lấy preview
async function attachWlistListWordCounts(lists) {
  if (!lists.length) return;
  if (wlistHasStoredCounts(lists)) { lists.forEach(l => { l.preview_words = wlistPreviewFromIds(l.preview_word_ids); }); return; }
  try {
    const ids = lists.map(l => l.id).join(',');
    const rows = await sbGet('word_list_items?select=list_id,word_id&list_id=in.(' + ids + ')');
    const counts = {};
    const previewIds = {};
    (Array.isArray(rows) ? rows : []).forEach(r => {
      counts[r.list_id] = (counts[r.list_id] || 0) + 1;
      (previewIds[r.list_id] = previewIds[r.list_id] || []).push(r.word_id);
    });
    lists.forEach(l => {
      l.word_count = counts[l.id] || 0;
      l.preview_words = (previewIds[l.id] || []).slice(0, 3)
        .map(wid => { const w = allWords.find(w => w.id === wid); return w ? w.thai : null; })
        .filter(Boolean);
    });
  } catch (e) {
    lists.forEach(l => { l.word_count = null; l.preview_words = []; });
  }
}

async function loadWlistMySaves() {
  if (!isLoggedIn()) { wlistMySaves = []; wlistMyFolderSaves = []; return; }
  try {
    const [listRows, folderRows] = await Promise.all([
      sbGetAuth('word_list_saves?select=list_id&user_id=eq.' + session.user.id),
      sbGetAuth('favorite_folder_saves?select=folder_id&user_id=eq.' + session.user.id)
    ]);
    wlistMySaves = Array.isArray(listRows) ? listRows.map(r => r.list_id) : [];
    wlistMyFolderSaves = Array.isArray(folderRows) ? folderRows.map(r => r.folder_id) : [];
  } catch (e) { wlistMySaves = []; wlistMyFolderSaves = []; }
}

// Màu avatar tròn tạo từ tên (ổn định, không đổi giữa các lần render)
const WLIST_AVATAR_COLORS = ['#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#00897B', '#43A047', '#FB8C00', '#6D4C41'];
function wlistAvatarColor(name) {
  const s = name || '?';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return WLIST_AVATAR_COLORS[Math.abs(hash) % WLIST_AVATAR_COLORS.length];
}

function renderWlistGrid() {
  const gridEl = document.getElementById('wlistGrid');
  if (!gridEl) return;

  let lists, folders;
  if (wlistAuthorViewing) {
    lists = (wlistAuthorCache ? wlistAuthorCache.lists : []);
    folders = (wlistAuthorCache ? wlistAuthorCache.folders : []);
  } else if (wlistSegment === 'explore') {
    lists = wlistExploreCache || []; folders = folderExploreCache || [];
  } else if (wlistSegment === 'saved') {
    lists = wlistSavedListsCache || []; folders = wlistSavedFoldersCache || [];
  } else {
    lists = wlistMineCache || []; folders = folderMineCache || [];
  }

  const cLists = lists.map(l => ({ type: 'list', id: l.id, title: l.title, desc: l.description, is_public: l.is_public, ownerId: l.owner_id, ownerName: l.owner_display_name, save_count: l.save_count, wordCount: l.word_count, previewWords: l.preview_words || [], createdAt: l.created_at, typeLabel: 'Danh sách' }));
  const cFolders = folders.map(f => ({ type: 'folder', id: f.id, title: f.name, desc: f.description || null, is_public: f.is_public, ownerId: f.user_id, ownerName: f.owner_display_name, save_count: f.save_count, wordCount: f.word_count, previewWords: f.preview_words || [], createdAt: f.created_at, typeLabel: 'Thư mục' }));

  // "Mới đăng gần đây" — chỉ hiện ở Khám phá (không hiện khi đang xem trang riêng của 1 tác giả,
  // hay ở "Của tôi"/"Đã lưu" vì không có ý nghĩa "mới của cộng đồng" ở đó). Lấy top 5 theo
  // created_at, TÁI DÙNG dữ liệu đã tải sẵn, không gọi thêm truy vấn nào.
  // Dải "Mới đăng gần đây" đã bỏ khỏi giao diện (trùng với sắp xếp "Mới nhất" và đẩy danh sách xuống dưới) — stripEl = null nên khối dưới không chạy.
  const stripEl = null;
  if (stripEl) {
    if (wlistSegment === 'explore' && !wlistAuthorViewing) {
      const recent = [...cLists, ...cFolders]
        .filter(c => c.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5);
      if (recent.length) {
        stripEl.style.display = '';
        // Không có icon trước nhãn (khớp các nhãn hist-insight-label khác trong app — vốn đều là chữ thường, không icon).
        stripEl.innerHTML = '<div class="hist-insight-label">Mới đăng gần đây</div><div class="wlist-recent-strip-row">' +
          recent.map(c => `<button type="button" class="wlist-recent-chip" onclick="${c.type === 'folder' ? 'openFolderDetail' : 'openWlistDetail'}(${c.id})">${escapeHtml(c.title)}<span class="wlist-recent-chip-count">${c.wordCount != null ? c.wordCount + ' từ' : ''}</span></button>`).join('') +
          '</div>';
      } else { stripEl.style.display = 'none'; stripEl.innerHTML = ''; }
    } else {
      stripEl.style.display = 'none'; stripEl.innerHTML = '';
    }
  }

  let combined = [...cLists, ...cFolders];
  if (wlistTypeFilter !== 'all') combined = combined.filter(c => c.type === wlistTypeFilter);
  // Cộng đồng: ẩn danh sách/thư mục RỖNG (0 từ) — không có gì để xem hay lưu (wordCount null = chưa biết thì vẫn giữ).
  if (wlistSegment === 'explore' && !wlistAuthorViewing) combined = combined.filter(c => c.wordCount !== 0);

  const q = wlistAuthorViewing ? '' : (document.getElementById('wlistSearchInput').value || '').trim().toLowerCase();
  if (q) combined = combined.filter(c => c.title.toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q));

  combined.sort((a, b) => {
    if (wlistSortMode === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    if (wlistSortMode === 'wordcount') return (b.wordCount || 0) - (a.wordCount || 0);
    return (b.save_count || 0) - (a.save_count || 0); // 'popular' (mặc định)
  });

  if (!combined.length) {
    const filtering = !!q || wlistTypeFilter !== 'all';
    let msg;
    if (wlistAuthorViewing) msg = 'Người này chưa công khai danh sách hay thư mục nào';
    else if (filtering) msg = 'Không có kết quả phù hợp<br><span style="font-size:13px">Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm</span>';
    else if (wlistSegment === 'explore') msg = 'Cộng đồng chưa có danh sách hay thư mục nào được chia sẻ';
    else if (wlistSegment === 'saved') msg = isLoggedIn()
      ? 'Bạn chưa lưu danh sách hay thư mục nào của người khác<br><span style="font-size:13px">Bấm "Lưu" ở mục Cộng đồng để thêm vào đây</span>'
      : 'Đăng nhập để xem danh sách/thư mục bạn đã lưu';
    else msg = isLoggedIn()
      ? 'Bạn chưa chia sẻ danh sách hay thư mục nào<br><span style="font-size:13px">Tạo danh sách mới, hoặc công khai một thư mục trong tab Sổ tay</span><br><button class="wlist-create-btn" onclick="openWlistEditModal()">' + PLUS_ICON_SVG + ' Tạo danh sách</button>'
      : 'Đăng nhập để tạo và quản lý danh sách của riêng bạn';
    gridEl.innerHTML = '<div class="wlist-empty">📭<br><br>' + msg + '</div>';
    return;
  }

  // Chỉ dựng WLIST_PAGE thẻ mỗi đợt (nhẹ khi cộng đồng có hàng trăm mục); nút "Xem thêm" hiện tiếp.
  const totalCards = combined.length;
  const shownCards = combined.slice(0, wlistShowCount);
  gridEl.innerHTML = shownCards.map(c => {
    const isOwner = isLoggedIn() && c.ownerId === session.user.id;
    const alreadySaved = c.type === 'list' ? wlistMySaves.includes(c.id) : wlistMyFolderSaves.includes(c.id);
    const authorName = c.ownerName || 'Ẩn danh';
    const initial = authorName.trim().charAt(0).toUpperCase() || '?';
    const openFn = c.type === 'folder' ? 'openFolderDetail' : 'openWlistDetail';
    return `
    <div class="wlist-card">
      <button class="wlist-card-body" onclick="${openFn}(${c.id})">
        <div class="wlist-card-pills">
          <span class="wlist-pill">${c.wordCount != null ? c.wordCount + ' từ' : '...'}</span>
          <span class="wlist-pill">${c.typeLabel}</span>
          ${c.is_public ? '' : '<span class="wlist-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Riêng tư</span>'}
        </div>
        <div class="wlist-card-title">${escapeHtml(c.title)}</div>
        ${c.desc ? `<div class="wlist-card-desc">${escapeHtml(c.desc)}</div>` : ''}
        ${c.previewWords.length ? `<div class="wlist-card-preview">${c.previewWords.map(w => escapeHtml(w)).join(', ')}${c.wordCount > c.previewWords.length ? '...' : ''}</div>` : ''}
      </button>
      <div class="wlist-card-author-row">
        <button class="wlist-card-avatar" style="background:${wlistAvatarColor(authorName)}" onclick="openAuthorLists('${c.ownerId}', '${jsStr(authorName)}')">${initial}</button>
        <button class="wlist-card-author-link" onclick="openAuthorLists('${c.ownerId}', '${jsStr(authorName)}')">${escapeHtml(authorName)}</button>
        ${isOwner ? '' : `<button class="wlist-card-report-btn" title="Báo cáo nội dung" onclick="reportWlistCard('${c.type}', ${c.id}, event)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg></button>`}
      </div>
      <div class="wlist-card-divider"></div>
      <div class="wlist-card-footer">
        <span class="wlist-card-savecount"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg> ${c.save_count || 0}</span>
        ${isOwner ? `<button class="wlist-card-save-btn saved" onclick="${openFn}(${c.id})">Quản lý</button>` : `
        <button class="wlist-card-save-btn${alreadySaved ? ' saved' : ''}" onclick="quickSaveWlistCard('${c.type}', ${c.id})">${alreadySaved ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Đã lưu' : 'Lưu'}</button>`}
      </div>
    </div>
  `;
  }).join('') + (totalCards > shownCards.length
    ? '<div class="wlist-more-wrap"><button type="button" class="wlist-more-btn" onclick="wlistShowMore()">Xem thêm (' + (totalCards - shownCards.length) + ')</button></div>' : '');
}

// Tìm 1 danh sách/thư mục trong các cache hiện có (dùng cho Lưu nhanh ngay trên card)
function findWlistCacheEntry(type, id) {
  const collections = type === 'list'
    ? [wlistExploreCache, wlistMineCache, wlistSavedListsCache, wlistAuthorCache ? wlistAuthorCache.lists : null]
    : [folderExploreCache, folderMineCache, wlistSavedFoldersCache, wlistAuthorCache ? wlistAuthorCache.folders : null];
  for (const c of collections) {
    if (!c) continue;
    const found = c.find(x => x.id === id);
    if (found) return found;
  }
  return null;
}

// Lưu nhanh 1 danh sách/thư mục vào Yêu thích ngay từ card, không cần mở chi tiết
async function quickSaveWlistCard(type, id) {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  if (type === 'list' ? wlistMySaves.includes(id) : wlistMyFolderSaves.includes(id)) return;
  try {
    if (type === 'list') await quickSaveList(id);
    else await quickSaveFolder(id);
  } catch (e) {
    showToast('⚠️ Có lỗi khi lưu, thử lại sau');
  }
  // Vừa lưu thêm 1 cái mới — làm mới cache tab "Đã lưu" ở lần vào sau (không load lại ngay vì
  // đang đứng ở Khám phá/Của tôi/trang tác giả, không phải tab Đã lưu).
  wlistSavedListsCache = null;
  wlistSavedFoldersCache = null;
  renderWlistGrid();
}

// Báo cáo nội dung cộng đồng không phù hợp — tái dùng NGUYÊN popup "Góp ý" đã có sẵn (cùng
// đường gửi qua Edge Function đã kiểm chứng hoạt động, tránh phải thêm "type" mới mà Edge
// Function phía server chưa chắc đã hỗ trợ), chỉ đổi tiêu đề + điền sẵn nội dung mô tả cái đang
// báo cáo. openFeedbackModal(null) là lối đi ĐÃ CÓ SẴN (dùng khi không có currentWord cụ thể).
function reportWlistCard(type, id, event) {
  if (event) event.stopPropagation();
  const entry = findWlistCacheEntry(type, id);
  const title = entry ? (type === 'folder' ? entry.name : entry.title) : '';
  openFeedbackModal(null);
  document.getElementById('feedbackWordLabel').innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg> Báo cáo nội dung cộng đồng';
  const textEl = document.getElementById('feedbackText');
  textEl.value = 'Báo cáo ' + (type === 'folder' ? 'thư mục' : 'danh sách') + ' công khai "' + title + '" (id ' + id + ')\nLý do: ';
  autoGrowTextarea(textEl);
  textEl.focus();
}

async function quickSaveList(listId) {
  const entry = findWlistCacheEntry('list', listId);
  const title = entry ? entry.title : 'Danh sách';
  const items = await (isLoggedIn() ? sbGetAuth : sbGet)('word_list_items?select=word_id,def_index&list_id=eq.' + listId);

  let folder = favoriteFolders.find(f => f.name === title);
  if (!folder) {
    const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name: title });
    const row = Array.isArray(created) ? created[0] : created;
    if (row) { folder = { id: row.id, name: row.name, is_public: false, save_count: 0 }; favoriteFolders.push(folder); }
  }
  for (const it of (Array.isArray(items) ? items : [])) {
    const di = it.def_index || 0;
    const key = favKey(it.word_id, di);
    if (favorites.includes(key)) continue;
    favorites.push(key);
    if (folder) favFolderMap[key] = [folder.id];
    await sbPostAuth('favorites', { user_id: session.user.id, word_id: it.word_id, def_index: di });
    if (folder) await sbPostAuth('favorite_folder_links', { user_id: session.user.id, word_id: it.word_id, def_index: di, folder_id: folder.id }, 'user_id,word_id,def_index,folder_id').catch(() => {});
  }
  if (!wlistMySaves.includes(listId)) {
    await sbPostAuth('word_list_saves', { list_id: listId, user_id: session.user.id });
    wlistMySaves.push(listId);
    if (entry) entry.save_count = (entry.save_count || 0) + 1;
  }
  updateStats();
  showToast('❤️ Đã lưu "' + title + '" vào Yêu thích');
}

async function quickSaveFolder(folderId) {
  const entry = findWlistCacheEntry('folder', folderId);
  const title = entry ? entry.name : 'Thư mục';
  const rows = await (isLoggedIn() ? sbGetAuth : sbGet)('favorite_folder_links?select=word_id,def_index&folder_id=eq.' + folderId);

  let folder = favoriteFolders.find(f => f.name === title);
  if (!folder) {
    const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name: title });
    const row = Array.isArray(created) ? created[0] : created;
    if (row) { folder = { id: row.id, name: row.name, is_public: false, save_count: 0 }; favoriteFolders.push(folder); }
  }
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const di = r.def_index || 0;
    const key = favKey(r.word_id, di);
    if (favorites.includes(key)) continue;
    favorites.push(key);
    if (folder) favFolderMap[key] = [folder.id];
    await sbPostAuth('favorites', { user_id: session.user.id, word_id: r.word_id, def_index: di });
    if (folder) await sbPostAuth('favorite_folder_links', { user_id: session.user.id, word_id: r.word_id, def_index: di, folder_id: folder.id }, 'user_id,word_id,def_index,folder_id').catch(() => {});
  }
  if (!wlistMyFolderSaves.includes(folderId)) {
    await sbPostAuth('favorite_folder_saves', { folder_id: folderId, user_id: session.user.id });
    wlistMyFolderSaves.push(folderId);
    if (entry) entry.save_count = (entry.save_count || 0) + 1;
  }
  updateStats();
  showToast('❤️ Đã lưu "' + title + '" vào Yêu thích');
}

// ── Tạo / Sửa danh sách ──────────────────────────────────
// Các khóa nghĩa ("wordId:defIndex") đang nằm trong 1 thư mục của người dùng.
function favFolderKeys(folderId) {
  return Object.keys(favFolderMap).filter(k => (favFolderMap[k] || []).map(String).includes(String(folderId)));
}

function openWlistEditModal(listId) {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  wlistEditingId = listId || null;
  const list = listId ? [...(wlistExploreCache || []), ...(wlistMineCache || [])].find(l => l.id === listId) : null;
  document.getElementById('wlistEditModalTitle').textContent = listId ? 'Sửa danh sách' : 'Tạo danh sách mới';
  document.getElementById('wlistEditTitleInput').value = list ? list.title : '';
  document.getElementById('wlistEditDescInput').value = list ? (list.description || '') : '';
  document.getElementById('wlistEditPublicInput').checked = list ? !!list.is_public : true;
  document.getElementById('wlistEditError').textContent = '';
  // "Bắt đầu từ thư mục của bạn": chỉ khi TẠO MỚI và có thư mục nào đó đã có từ — sao chép sẵn các từ đó vào danh sách mới.
  const fromWrap = document.getElementById('wlistEditFromFolderWrap');
  const fromSel = document.getElementById('wlistEditFromFolder');
  const opts = listId ? [] : (favoriteFolders || []).map(f => ({ f, n: favFolderKeys(f.id).length })).filter(o => o.n > 0);
  fromSel.innerHTML = '<option value="">Danh sách trống</option>' + opts.map(o => '<option value="' + o.f.id + '">' + escapeHtml(o.f.name) + ' (' + o.n + ' từ)</option>').join('');
  fromWrap.style.display = opts.length ? '' : 'none';
  document.getElementById('wlistEditModal').classList.add('show');
}
function closeWlistEditModal() {
  document.getElementById('wlistEditModal').classList.remove('show');
}

async function submitWlistEdit() {
  const title = document.getElementById('wlistEditTitleInput').value.trim();
  const description = document.getElementById('wlistEditDescInput').value.trim();
  const isPublic = document.getElementById('wlistEditPublicInput').checked;
  const errEl = document.getElementById('wlistEditError');
  if (!title) { errEl.textContent = 'Vui lòng nhập tên danh sách'; return; }

  try {
    if (wlistEditingId) {
      const updated = await sbPatchAuth('word_lists?id=eq.' + wlistEditingId + '&owner_id=eq.' + session.user.id, {
        title, description, is_public: isPublic
      });
      const row = Array.isArray(updated) ? updated[0] : updated;
      [wlistExploreCache, wlistMineCache].forEach(cache => {
        if (!cache) return;
        const idx = cache.findIndex(l => l.id === wlistEditingId);
        if (idx !== -1 && row) cache[idx] = row;
      });
      if (wlistCurrentDetail && wlistCurrentDetail.id === wlistEditingId && row) {
        wlistCurrentDetail = row;
        renderWlistDetailHead();
      }
      showToast('Đã lưu thay đổi');
    } else {
      const created = await sbPostAuth('word_lists', {
        owner_id: session.user.id,
        owner_display_name: session.user.display_name || '',
        title, description, is_public: isPublic
      });
      const row = Array.isArray(created) ? created[0] : created;
      if (!row || !row.id) throw new Error('no row returned');
      // Sao chép từ thư mục đã chọn (nếu có) vào danh sách vừa tạo bằng 1 lần chèn hàng loạt; lỗi thì danh sách vẫn được tạo (rỗng) và báo cho người dùng.
      row.word_count = 0; row.preview_words = [];
      const fromFolderId = document.getElementById('wlistEditFromFolder').value;
      if (fromFolderId) {
        const copyRows = favFolderKeys(fromFolderId).map(k => { const p = favKeyParts(k); return { list_id: row.id, word_id: p.wordId, def_index: p.defIndex }; });
        try {
          const added = await sbPostAuth('word_list_items', copyRows);
          if (!Array.isArray(added)) throw new Error('copy failed');
          row.word_count = added.length;
          row.preview_words = wlistPreviewFromIds(added.map(a => a.word_id));
        } catch (e) { showToast('⚠️ Đã tạo danh sách nhưng chưa sao chép được từ thư mục'); }
      }
      if (wlistMineCache) wlistMineCache.unshift(row);
      if (isPublic && wlistExploreCache) wlistExploreCache.unshift(row);
      showToast('✅ Đã tạo danh sách "' + title + '"');
      // Chuyển sang "Của tôi" (cập nhật đủ cả 3 nút tab con + ô tìm/lọc), dựng lại lưới (nếu chưa từng mở "Của tôi" thì tải luôn — đã gồm danh sách vừa tạo),
      // rồi mở thẳng chi tiết danh sách với ô thêm từ để người dùng bắt đầu thêm từ ngay.
      if (wlistAuthorViewing) closeAuthorLists();
      wlistSegment = 'mine';
      wlistSyncSegmentUi(true);
      document.getElementById('wlistSearchInput').value = '';
      wlistTypeFilter = 'all';
      document.querySelectorAll('.wlist-type-chip').forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
      closeWlistEditModal();
      await loadWlistSegment();
      await openWlistDetail(row.id);
      if (wlistCurrentDetail && wlistCurrentDetail.id === row.id && document.getElementById('wlistAddBox').style.display === 'none') toggleWlistAddBox();
      return;
    }
  } catch (e) {
    errEl.textContent = 'Không thể lưu, thử lại sau';
    return;
  }
  closeWlistEditModal();
  renderWlistGrid();
}

async function deleteWlist(listId) {
  if (!confirm('Xóa hẳn danh sách này? Không thể hoàn tác.')) return;
  try {
    await sbDeleteAuth('word_lists?id=eq.' + listId + '&owner_id=eq.' + session.user.id);
  } catch (e) { showToast('⚠️ Lỗi khi xóa'); return; }
  [wlistExploreCache, wlistMineCache].forEach(cache => {
    if (!cache) return;
    const idx = cache.findIndex(l => l.id === listId);
    if (idx !== -1) cache.splice(idx, 1);
  });
  showToast('Đã xóa danh sách');
  closeWlistDetail();
  renderWlistGrid();
}

// ── Chi tiết 1 danh sách ──────────────────────────────────
async function openWlistDetail(listId) {
  document.getElementById('wlistBrowse').style.display = 'none';
  const detailEl = document.getElementById('wlistDetail');
  detailEl.style.display = '';
  document.getElementById('wlistDetailTitle').textContent = 'Đang tải...';
  document.getElementById('wlistItemList').innerHTML = '';
  document.getElementById('wlistAddBox').style.display = 'none';

  try {
    const rows = await (isLoggedIn() ? sbGetAuth : sbGet)('word_lists?select=*&id=eq.' + listId);
    const list = Array.isArray(rows) ? rows[0] : null;
    if (!list) { showToast('⚠️ Không tìm thấy danh sách'); closeWlistDetail(); return; }
    wlistCurrentDetail = {
      type: 'list', id: list.id, title: list.title, description: list.description,
      is_public: list.is_public, owner_id: list.owner_id, owner_display_name: list.owner_display_name,
      save_count: list.save_count, items: []
    };
    renderWlistDetailHead();

    const items = await (isLoggedIn() ? sbGetAuth : sbGet)('word_list_items?select=*&list_id=eq.' + listId + '&order=created_at.asc');
    wlistCurrentDetail.items = (Array.isArray(items) ? items : []).map(it => ({
      key: 'l' + it.id, word_id: it.word_id, def_index: it.def_index || 0, list_item_id: it.id
    }));
    renderWlistItemList();
  } catch (e) {
    showToast('⚠️ Không tải được danh sách');
    closeWlistDetail();
  }
}

// Xem chi tiết 1 thư mục Yêu thích công khai (của tôi hoặc của người khác)
async function openFolderDetail(folderId) {
  document.getElementById('wlistBrowse').style.display = 'none';
  const detailEl = document.getElementById('wlistDetail');
  detailEl.style.display = '';
  document.getElementById('wlistDetailTitle').textContent = 'Đang tải...';
  document.getElementById('wlistItemList').innerHTML = '';
  document.getElementById('wlistAddBox').style.display = 'none';

  try {
    const rows = await (isLoggedIn() ? sbGetAuth : sbGet)('favorite_folders?select=*&id=eq.' + folderId);
    const folder = Array.isArray(rows) ? rows[0] : null;
    if (!folder) { showToast('⚠️ Không tìm thấy thư mục'); closeWlistDetail(); return; }
    wlistCurrentDetail = {
      type: 'folder', id: folder.id, title: folder.name, description: folder.description || null,
      is_public: folder.is_public, owner_id: folder.user_id, owner_display_name: folder.owner_display_name,
      save_count: folder.save_count, items: []
    };
    renderWlistDetailHead();

    const favRows = await (isLoggedIn() ? sbGetAuth : sbGet)('favorite_folder_links?select=word_id,def_index&folder_id=eq.' + folderId);
    wlistCurrentDetail.items = (Array.isArray(favRows) ? favRows : []).map(r => ({
      key: 'f' + r.word_id + '_' + (r.def_index || 0), word_id: r.word_id, def_index: r.def_index || 0, list_item_id: null
    }));
    renderWlistItemList();
  } catch (e) {
    showToast('⚠️ Không tải được thư mục');
    closeWlistDetail();
  }
}

function closeWlistDetail() {
  wlistCurrentDetail = null;
  document.getElementById('wlistBrowse').style.display = '';
  document.getElementById('wlistDetail').style.display = 'none';
}

// Icon dùng chung cho khu vực chi tiết Danh sách/Thư mục (Khám phá) — trước đây là emoji (🔒📁👤🔖✎🗑📝+✓), giờ
// chuyển sang SVG Lucide đồng bộ với phần còn lại của app (đã làm ở Sổ tay). Khai báo 1 lần, dùng nhiều chỗ.
const LOCK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const FOLDER_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const USER_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const BOOKMARK_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>';
const CHECK_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const PENCIL_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
const REVIEW_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
const PLUS_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const TRASH_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const FILETEXT_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';

function renderWlistDetailHead() {
  const d = wlistCurrentDetail;
  if (!d) return;
  const isOwner = isLoggedIn() && d.owner_id === session.user.id;
  // Icon loại + trạng thái riêng tư đặt trong span riêng (không phải textContent) để icon là SVG thay vì emoji.
  document.getElementById('wlistDetailTitle').innerHTML = (d.type === 'folder' ? '<span class="wlist-detail-title-icon">'+FOLDER_ICON_SVG+'</span> ' : '')
    + (d.is_public ? '' : '<span class="wlist-detail-title-icon">'+LOCK_ICON_SVG+'</span> ') + escapeHtml(d.title);
  document.getElementById('wlistDetailDesc').textContent = d.description || '';
  document.getElementById('wlistDetailDesc').style.display = d.description ? '' : 'none';
  document.getElementById('wlistDetailMeta').innerHTML =
    `<span>${USER_ICON_SVG} <button class="wlist-detail-author-link" onclick="openAuthorLists('${d.owner_id}', '${jsStr(d.owner_display_name || 'Ẩn danh')}')">${escapeHtml(d.owner_display_name || 'Ẩn danh')}</button></span><span>${BOOKMARK_ICON_SVG} ${d.save_count || 0} lượt lưu</span>`;

  let actions = '';
  if (d.type === 'list') {
    if (isOwner) {
      actions += `<button class="wlist-action-btn" onclick="openWlistEditModal(${d.id})">${PENCIL_ICON_SVG} Sửa thông tin</button>`;
      actions += `<button class="wlist-action-btn" onclick="toggleWlistAddBox()">${PLUS_ICON_SVG} Thêm từ</button>`;
      actions += `<button class="wlist-action-btn danger" onclick="deleteWlist(${d.id})">${TRASH_ICON_SVG} Xóa danh sách</button>`;
    } else {
      const alreadySaved = wlistMySaves.includes(d.id);
      actions += `<button class="wlist-action-btn primary${alreadySaved ? ' saved' : ''}" id="wlistSaveBtn" onclick="saveWlistToFavorites(${d.id})">`
        + (alreadySaved ? CHECK_ICON_SVG + ' Đã lưu về Yêu thích' : BOOKMARK_ICON_SVG + ' Lưu về Yêu thích của tôi') + '</button>';
    }
  } else {
    if (isOwner) {
      actions += `<button class="wlist-action-btn" onclick="goManageFolderInMine(${d.id})">${PENCIL_ICON_SVG} Quản lý trong "Của tôi"</button>`;
      actions += `<button class="wlist-action-btn" onclick="editFolderDescriptionFromDetail(${d.id})">${FILETEXT_ICON_SVG} Sửa lời giới thiệu</button>`;
      actions += `<button class="wlist-action-btn" onclick="toggleFavFolderPublicFromDetail(${d.id})">${LOCK_ICON_SVG} Chuyển về riêng tư</button>`;
      actions += `<button class="wlist-action-btn danger" onclick="deleteFolderFromDetail(${d.id})">${TRASH_ICON_SVG} Xóa thư mục</button>`;
    } else {
      const alreadySaved = wlistMyFolderSaves.includes(d.id);
      actions += `<button class="wlist-action-btn primary${alreadySaved ? ' saved' : ''}" id="wlistSaveBtn" onclick="saveFolderToFavorites(${d.id})">`
        + (alreadySaved ? CHECK_ICON_SVG + ' Đã lưu về Yêu thích' : BOOKMARK_ICON_SVG + ' Lưu về Yêu thích của tôi') + '</button>';
    }
  }
  actions = `<button class="wlist-action-btn" onclick="startWlistTrialReview()">${REVIEW_ICON_SVG} Ôn thử bộ này</button>` + actions;
  document.getElementById('wlistDetailActions').innerHTML = actions;
}

// Chuyển sang tab "Sổ tay" và mở đúng thư mục để quản lý (thêm/xóa từ) — chỉnh sửa thư mục
// vẫn thực hiện y hệt như trước giờ, ở đúng chỗ cũ, tránh trùng lặp logic thêm/xóa từ.
function goManageFolderInMine(folderId) {
  switchFavTab('mine');
  setActiveFavFolder(String(folderId));
}

async function toggleFavFolderPublicFromDetail(folderId) {
  await toggleFavFolderPublic(folderId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder || !wlistCurrentDetail || wlistCurrentDetail.id !== folderId) return;
  if (!folder.is_public) { closeWlistDetail(); return; }
  wlistCurrentDetail.is_public = folder.is_public;
  renderWlistDetailHead();
}

async function editFolderDescriptionFromDetail(folderId) {
  await editFavFolderDescription(folderId);
  const folder = favoriteFolders.find(f => f.id === folderId);
  if (!folder || !wlistCurrentDetail || wlistCurrentDetail.id !== folderId) return;
  wlistCurrentDetail.description = folder.description;
  renderWlistDetailHead();
}

async function deleteFolderFromDetail(folderId) {
  await deleteFavFolder(folderId);
  folderExploreCache = null; folderMineCache = null; wlistSavedFoldersCache = null;
  closeWlistDetail();
}

// "Ôn thử bộ này": ôn nhanh các từ của danh sách/thư mục đang xem mà KHÔNG cần lưu vào Sổ tay. Từ nào bạn tự đánh giá mức nhớ sẽ vào mục "Từ cần ôn"
// (cùng cơ chế như tự đánh giá ở trang kết quả); từ chưa chấm thì không để lại gì.
function startWlistTrialReview() {
  const d = wlistCurrentDetail;
  if (!d) return;
  const keys = [...new Set((d.items || []).map(it => favKey(it.word_id, it.def_index)))];
  if (!keys.length) { showToast('Bộ này chưa có từ nào để ôn'); return; }
  openReviewMode('custom', keys, d.title || d.name || '');
}

function toggleWlistAddBox() {
  const box = document.getElementById('wlistAddBox');
  const show = box.style.display === 'none';
  box.style.display = show ? '' : 'none';
  if (show) { document.getElementById('wlistAddSearchInput').value = ''; document.getElementById('wlistAddResults').innerHTML = ''; }
}

// Giữ số từ trên thẻ (cache) khớp với danh sách vừa thêm/xóa từ — không cần tải lại.
function wlistSyncCountInCache(list) {
  const e = findWlistCacheEntry('list', list.id);
  if (!e) return;
  e.word_count = (list.items || []).length;
  e.preview_words = wlistPreviewFromIds((list.items || []).map(it => it.word_id));
}

function toggleWlistBulkBox() {
  const box = document.getElementById('wlistBulkBox');
  const open = box.style.display === 'none';
  box.style.display = open ? '' : 'none';
  if (open) { document.getElementById('wlistBulkResult').textContent = ''; document.getElementById('wlistBulkInput').focus(); }
}

// Dán nhiều từ: mỗi dòng (hoặc cách nhau bằng , ;) 1 từ. Khớp đúng chữ Thái, hoặc đúng 1 nghĩa tiếng Việt thuộc DUY NHẤT 1 từ; còn lại báo "không tìm thấy" / "nhiều từ trùng nghĩa".
async function addBulkWordsToWlist() {
  const list = wlistCurrentDetail;
  if (!list || list.type !== 'list') return;
  const resEl = document.getElementById('wlistBulkResult');
  const tokens = [...new Set(document.getElementById('wlistBulkInput').value.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean))].slice(0, 200);
  if (!tokens.length) { resEl.textContent = 'Hãy dán danh sách từ (mỗi dòng một từ)'; return; }
  const existing = new Set((list.items || []).map(it => it.word_id));
  const visible = allWords.filter(w => w.visible !== false);
  const toAdd = [], notFound = [], ambiguous = []; let already = 0;
  tokens.forEach(t => {
    const lower = t.toLowerCase();
    let hit = visible.filter(w => w.thai === t);
    if (!hit.length) hit = visible.filter(w => (w.meanings || []).some(m => String(m).trim().toLowerCase() === lower));
    if (!hit.length) { notFound.push(t); return; }
    if (hit.length > 1) { ambiguous.push(t); return; }
    const w = hit[0];
    if (existing.has(w.id) || toAdd.some(x => x.word_id === w.id)) { already++; return; }
    toAdd.push({ list_id: list.id, word_id: w.id });
  });
  if (toAdd.length) {
    const btn = document.getElementById('wlistBulkBtn'); btn.disabled = true;
    try {
      const created = await sbPostAuth('word_list_items', toAdd);
      if (!Array.isArray(created)) throw new Error('bulk insert failed');
      created.forEach(row => list.items.push({ key: 'l' + row.id, word_id: row.word_id, def_index: row.def_index || 0, list_item_id: row.id }));
      wlistSyncCountInCache(list);
      renderWlistItemList();
    } catch (e) { btn.disabled = false; resEl.textContent = '⚠️ Không thể thêm từ, thử lại sau'; return; }
    btn.disabled = false;
  }
  const parts = [];
  parts.push(toAdd.length ? '✅ Đã thêm ' + toAdd.length + ' từ.' : 'Không có từ mới để thêm.');
  if (already) parts.push(already + ' từ đã có sẵn.');
  if (ambiguous.length) parts.push('Nhiều từ trùng nghĩa (hãy dùng chữ Thái): ' + ambiguous.join(', ') + '.');
  if (notFound.length) parts.push('Không tìm thấy: ' + notFound.join(', ') + '.');
  resEl.textContent = parts.join(' ');
  if (!notFound.length && !ambiguous.length) document.getElementById('wlistBulkInput').value = '';
}

function renderWlistAddResults() {
  if (!wlistCurrentDetail || wlistCurrentDetail.type !== 'list') return; // chỉ áp dụng cho danh sách cộng đồng, thư mục quản lý ở tab Của tôi
  const q = (document.getElementById('wlistAddSearchInput').value || '').trim().toLowerCase();
  const resEl = document.getElementById('wlistAddResults');
  if (!q) { resEl.innerHTML = ''; return; }
  const existingWordIds = (wlistCurrentDetail.items || []).map(it => it.word_id);
  const matches = allWords.filter(w =>
    w.visible !== false && (w.thai.includes(q) || (w.meanings || []).some(m => m.toLowerCase().includes(q))) && !existingWordIds.includes(w.id)
  ).slice(0, 20);
  resEl.innerHTML = matches.length ? matches.map(w => `
    <div class="wlist-add-result-item" onclick="addWordToWlist(${w.id})">
      <span><span class="wlist-add-result-thai">${w.thai}</span> <span class="wlist-add-result-meaning">${(w.meanings || [])[0] || ''}</span></span>
      <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></span>
    </div>
  `).join('') : '<div class="wlist-add-result-meaning">Không tìm thấy từ phù hợp</div>';
}

async function addWordToWlist(wordId) {
  const list = wlistCurrentDetail;
  if (!list || list.type !== 'list') return;
  try {
    const created = await sbPostAuth('word_list_items', { list_id: list.id, word_id: wordId });
    const row = Array.isArray(created) ? created[0] : created;
    if (row) list.items.push({ key: 'l' + row.id, word_id: row.word_id, def_index: row.def_index || 0, list_item_id: row.id });
  } catch (e) { showToast('⚠️ Không thể thêm từ, thử lại sau'); return; }
  wlistSyncCountInCache(list);
  document.getElementById('wlistAddSearchInput').value = '';
  document.getElementById('wlistAddResults').innerHTML = '';
  renderWlistItemList();
}

async function removeWordFromWlist(itemId) {
  const list = wlistCurrentDetail;
  if (!list || list.type !== 'list') return;
  try { await sbDeleteAuth('word_list_items?id=eq.' + itemId); }
  catch (e) { showToast('⚠️ Không thể xóa từ này'); return; }
  list.items = list.items.filter(it => it.list_item_id !== itemId);
  wlistSyncCountInCache(list);
  renderWlistItemList();
}

function renderWlistItemList() {
  const d = wlistCurrentDetail;
  const el = document.getElementById('wlistItemList');
  if (!d || !el) return;
  const isOwner = isLoggedIn() && d.owner_id === session.user.id;
  const canRemove = d.type === 'list' && isOwner; // thư mục thì chỉnh sửa ở tab Của tôi, không xóa trực tiếp ở đây
  if (!d.items.length) {
    el.innerHTML = '<div class="wlist-empty">' + (d.type === 'folder' ? 'Thư mục' : 'Danh sách') + ' này chưa có từ nào'
      + (d.type === 'list' && isOwner ? '<br><span style="font-size:13px">Bấm "+ Thêm từ" ở trên để bắt đầu</span>' : '') + '</div>';
    return;
  }
  // Cùng cấu trúc dòng đã dùng ở Sổ tay (phiên âm dưới chữ Thái + nút nghe ngay + caret SVG xoay bằng CSS) —
  // trước đây khu vực Khám phá có 1 bản riêng, cũ hơn, không có phiên âm/nút nghe, caret đổi bằng ký tự ▾.
  el.innerHTML = d.items.map(it => {
    const word = allWords.find(w => w.id === it.word_id);
    if (!word) return '';
    return `
    <div class="fav-word-row">
      <div class="fav-word-row-head" onclick="toggleWlistItemExpand('${it.key}', ${word.id})">
        <div class="fav-word-row-main">
          <div class="fav-word-row-top">
            <span class="fav-word-row-thai">${word.thai}</span>
          </div>
          ${word.phonetic ? '<div class="fav-word-row-phonetic">' + word.phonetic + '</div>' : ''}
        </div>
        <div class="fav-word-row-actions">
          <button class="btn-small" title="Phát âm" onclick="event.stopPropagation(); speakText('${jsAttrStr(word.thai)}', this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg></button>
          ${canRemove ? `<button class="btn-small del" title="Xóa khỏi danh sách" onclick="event.stopPropagation(); removeWordFromWlist(${it.list_item_id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>` : ''}
          <span class="fav-word-row-caret" id="wlist-caret-${it.key}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
      </div>
      <div class="fav-word-row-body" id="wlist-expand-${it.key}"></div>
    </div>`;
  }).join('');
}

function toggleWlistItemExpand(itemKey, wordId) {
  const body = document.getElementById('wlist-expand-' + itemKey);
  const caret = document.getElementById('wlist-caret-' + itemKey);
  if (!body) return;
  const isOpen = body.classList.contains('show');
  document.querySelectorAll('#wlistItemList .fav-word-row-body.show').forEach(b => {
    if (b !== body) { b.classList.remove('show'); b.innerHTML = ''; }
  });
  // Caret là icon SVG cố định (xoay bằng class "open" + CSS transform) — giống toggleFavExpand() ở Sổ tay.
  document.querySelectorAll('#wlistItemList .fav-word-row-caret').forEach(c => {
    if (c.id !== 'wlist-caret-' + itemKey) c.classList.remove('open');
  });
  if (isOpen) {
    body.classList.remove('show'); body.innerHTML = ''; if (caret) caret.classList.remove('open');
    return;
  }
  if (caret) caret.classList.add('open');
  const word = allWords.find(w => w.id === wordId);
  if (!word) return;
  body.innerHTML = `
    <div class="fav-expand-top">
      <div class="word-thai-wrap">${buildWordFontsHTML(word.thai)}</div>
      <button class="btn-action btn-speak" aria-label="Phát âm" data-tooltip="Phát âm" onclick="speakText('${jsAttrStr(word.thai)}', this)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>
      </button>
    </div>
    ${word.phonetic ? `<div class="word-phonetic">${word.phonetic}</div>` : ''}
    ${word.structure ? `<div class="word-structure">${word.structure}</div>` : ''}
    <div class="fav-expand-defs"></div>
  `;
  applyWordThaiLayout(body.querySelector('.word-thai-wrap'));
  const defEl = body.querySelector('.fav-expand-defs');
  const savedIndices = favorites.filter(k => k.startsWith(wordId + ':')).map(k => favKeyParts(k).defIndex);
  defEl.innerHTML = buildDefinitionsHTML(word, savedIndices);
  segmentizeDefsIfEnabled(defEl);
  body.classList.add('show');
  if (caret) caret.textContent = '▴';
}

// Lưu toàn bộ từ trong 1 danh sách cộng đồng về mục Yêu thích cá nhân (tạo thư mục trùng tên danh sách)
async function saveWlistToFavorites(listId) {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  const list = wlistCurrentDetail;
  if (!list || list.type !== 'list' || list.id !== listId) return;
  const btn = document.getElementById('wlistSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

  try {
    // Tạo (hoặc tái dùng nếu đã có) 1 thư mục Yêu thích trùng tên danh sách
    let folder = favoriteFolders.find(f => f.name === list.title);
    if (!folder) {
      const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name: list.title });
      const row = Array.isArray(created) ? created[0] : created;
      if (row) { folder = { id: row.id, name: row.name, is_public: false, save_count: 0 }; favoriteFolders.push(folder); }
    }

    for (const it of (list.items || [])) {
      const key = favKey(it.word_id, it.def_index);
      if (favorites.includes(key)) continue;
      favorites.push(key);
      if (folder) favFolderMap[key] = [folder.id];
      await sbPostAuth('favorites', { user_id: session.user.id, word_id: it.word_id, def_index: it.def_index });
      if (folder) await sbPostAuth('favorite_folder_links', { user_id: session.user.id, word_id: it.word_id, def_index: it.def_index, folder_id: folder.id }, 'user_id,word_id,def_index,folder_id').catch(() => {});
    }

    if (!wlistMySaves.includes(listId)) {
      await sbPostAuth('word_list_saves', { list_id: listId, user_id: session.user.id });
      wlistMySaves.push(listId);
      list.save_count = (list.save_count || 0) + 1;
    }
    updateStats();
    showToast('❤️ Đã lưu danh sách vào Yêu thích, thư mục "' + list.title + '"');
  } catch (e) {
    showToast('⚠️ Có lỗi khi lưu, thử lại sau');
  } finally {
    renderWlistDetailHead();
  }
}

// Lưu toàn bộ từ trong 1 thư mục công khai của người khác về Yêu thích cá nhân (tạo thư mục trùng tên)
async function saveFolderToFavorites(folderId) {
  if (!isLoggedIn()) { openAuthModal('login'); return; }
  const d = wlistCurrentDetail;
  if (!d || d.type !== 'folder' || d.id !== folderId) return;
  const btn = document.getElementById('wlistSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

  try {
    let folder = favoriteFolders.find(f => f.name === d.title);
    if (!folder) {
      const created = await sbPostAuth('favorite_folders', { user_id: session.user.id, name: d.title });
      const row = Array.isArray(created) ? created[0] : created;
      if (row) { folder = { id: row.id, name: row.name, is_public: false, save_count: 0 }; favoriteFolders.push(folder); }
    }

    for (const it of (d.items || [])) {
      const key = favKey(it.word_id, it.def_index);
      if (favorites.includes(key)) continue;
      favorites.push(key);
      if (folder) favFolderMap[key] = [folder.id];
      await sbPostAuth('favorites', { user_id: session.user.id, word_id: it.word_id, def_index: it.def_index });
      if (folder) await sbPostAuth('favorite_folder_links', { user_id: session.user.id, word_id: it.word_id, def_index: it.def_index, folder_id: folder.id }, 'user_id,word_id,def_index,folder_id').catch(() => {});
    }

    if (!wlistMyFolderSaves.includes(folderId)) {
      await sbPostAuth('favorite_folder_saves', { folder_id: folderId, user_id: session.user.id });
      wlistMyFolderSaves.push(folderId);
      d.save_count = (d.save_count || 0) + 1;
    }
    updateStats();
    showToast('❤️ Đã lưu thư mục vào Yêu thích, thư mục "' + d.title + '"');
  } catch (e) {
    showToast('⚠️ Có lỗi khi lưu, thử lại sau');
  } finally {
    renderWlistDetailHead();
  }
}

// Khi user đổi tên hiển thị trong hồ sơ, đồng bộ lại tên chủ sở hữu trên mọi
// danh sách cộng đồng họ đã tạo (chạy ngầm, không chặn UI hồ sơ)
async function syncWlistOwnerDisplayName(newName) {
  if (!isLoggedIn()) return;
  try {
    const [updatedLists, updatedFolders] = await Promise.all([
      sbPatchAuth('word_lists?owner_id=eq.' + session.user.id, { owner_display_name: newName || '' }),
      sbPatchAuth('favorite_folders?user_id=eq.' + session.user.id + '&is_public=eq.true', { owner_display_name: newName || '' })
    ]);
    const listRows = Array.isArray(updatedLists) ? updatedLists : [];
    const folderRows = Array.isArray(updatedFolders) ? updatedFolders : [];
    [wlistExploreCache, wlistMineCache].forEach(cache => {
      if (!cache) return;
      cache.forEach(l => {
        const fresh = listRows.find(r => r.id === l.id);
        if (fresh) l.owner_display_name = fresh.owner_display_name;
      });
    });
    [folderExploreCache, folderMineCache].forEach(cache => {
      if (!cache) return;
      cache.forEach(f => {
        const fresh = folderRows.find(r => r.id === f.id);
        if (fresh) f.owner_display_name = fresh.owner_display_name;
      });
    });
    if (wlistCurrentDetail && (
      (wlistCurrentDetail.type === 'list' && listRows.some(r => r.id === wlistCurrentDetail.id)) ||
      (wlistCurrentDetail.type === 'folder' && folderRows.some(r => r.id === wlistCurrentDetail.id))
    )) {
      wlistCurrentDetail.owner_display_name = newName || '';
      renderWlistDetailHead();
    }
    if (document.getElementById('favCommunityTab') && document.getElementById('favCommunityTab').style.display !== 'none') {
      renderWlistGrid();
    }
  } catch (e) {
    // im lặng bỏ qua — không quan trọng bằng việc lưu tên hiển thị thành công
  }
}

// ── ÔN TẬP (FLASHCARD) — dùng dữ liệu Yêu thích + hộp Leitner (1-5) ──────
// Khoảng cách ôn lại (tính bằng ngày) ứng với từng "box":
// box 1 = hôm nay/ngay lập tức, box 2 = 1 ngày, box 3 = 3 ngày, box 4 = 7 ngày, box 5 = 14 ngày
const SRS_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
let reviewQueue = [];      // mảng favKey đang chờ ôn trong phiên này
let reviewIndex = 0;
let reviewFlipped = false;
let reviewDueOnly = true;
let reviewCustomKeys = []; // khóa nghĩa của phiên "Ôn thử bộ này" (reviewSource === 'custom')
let reviewSource = 'all';   // nguồn từ của phiên ôn: 'notebook' (nghĩa đã lưu Sổ tay) | 'learning' (nghĩa đã tự đánh giá mức nhớ) | 'all' (gộp cả hai — Learning Bar/nhắc nhở gọi không tham số)
let reviewRenderToken = 0;  // tăng mỗi lần renderReviewCard() — bỏ kết quả của lần render CŨ về trễ (xem renderReviewCard)
let reviewAnswerLock = false; // chặn bấm chấm mức/"Không quan tâm" 2 lần liên tiếp → nhảy cách 2 thẻ + ghi SRS đôi
let reviewSessionStartTs = 0; // mốc thời gian mở Review Mode — dùng lọc srsReviewLog để tóm tắt cuối phiên
const REVIEW_SESSION_LIMIT = 20; // trần số thẻ MỖI PHIÊN — bỏ bê vài ngày dồn hàng trăm từ đến hạn thì
// mở ra vẫn chỉ thấy tối đa ngần này, đỡ nản; ưu tiên từ đến hạn LÂU NHẤT trước (xem buildReviewQueue).

// Mở/đóng Review Mode toàn màn hình — TÁCH RIÊNG hoàn toàn khỏi Sổ tay (xem ghi chú trong
// index.html). Nguồn hàng đợi ôn tập giờ là Object.keys(favSrsMap) — TỨC LÀ MỌI nghĩa đã từng
// được tự đánh giá mức nhớ (xem onGuessMemoryLevel), bất kể có nằm trong Sổ tay/favorites hay
// không — không còn lọc theo thư mục nữa (thư mục là khái niệm của Sổ tay, không liên quan đến
// việc ôn tập). Đóng lại chỉ ẩn overlay đi (trang bên dưới không hề bị đụng tới trong lúc mở nên
// tự động "quay lại đúng trang trước đó"), rồi tính lại Learning Bar để cập nhật thông điệp
// (chuyển sang "Bạn đã hoàn thành hôm nay." nếu vừa ôn hết đồ đến hạn).
// Danh sách 5 từ hay quên nhất tuần này — mở rộng từ Learning Bar (vốn chỉ nêu đúng 1 từ), hiện
// ngay trong Review Mode để người học chủ động ôn riêng nhóm này nếu muốn. Ẩn hẳn nếu chưa có dữ
// liệu (chưa ai bấm 🌑 lần nào trong 7 ngày qua). Bấm vào 1 từ: đóng Review Mode, tra thẳng từ đó
// (dùng lại selectWord()) — nhất quán với cách chip "từ hay quên nhất" trên Learning Bar hoạt động.
function renderReviewTopForgottenBox() {
  const box = document.getElementById('reviewTopForgottenBox');
  if (!box) return;
  const top5 = computeTopForgottenWords(5);
  if (!top5.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="review-top-forgotten-title">Từ hay quên nhất tuần này</div>'
    + '<div class="review-top-forgotten-list">'
    + top5.map(o => '<button type="button" class="review-top-forgotten-chip" onclick="onReviewTopForgottenClick(' + o.word.id + ')">'
      + o.word.thai + '<span class="review-top-forgotten-count">×' + o.count + '</span></button>').join('')
    + '</div>';
}
function onReviewTopForgottenClick(wordId) {
  closeReviewMode();
  selectWord(wordId);
}

// asPage=true: ôn NGAY TRONG trang (tab "Từ cần ôn" của Thư viện, xem openReviewPage) — gắn #reviewModeContent vào #reviewPageHost, KHÔNG bật overlay.
// asPage=false/không truyền: chế độ review toàn màn hình như cũ (chip "Xem lại", "Ôn ngay", "Ôn sổ tay", "Ôn thử bộ này").
function mountReviewContent(toPage) {
  const content = document.getElementById('reviewModeContent');
  const target = document.getElementById(toPage ? 'reviewPageHost' : 'reviewModeOverlay');
  if (content && target && content.parentNode !== target) target.appendChild(content);
}
function openReviewMode(source, customKeys, customTitle, asPage, practice) {
  const overlay = document.getElementById('reviewModeOverlay');
  if (!overlay) return;
  reviewPracticeMode = !!practice; // true = "Bài tập từ video" (startExampleVideoPractice): thẻ tạm, không SRS, không nút chuyển phạm vi
  const scopeSeg = document.getElementById('reviewScopeSeg');
  if (scopeSeg) scopeSeg.style.display = reviewPracticeMode ? 'none' : '';
  mountReviewContent(!!asPage);
  reviewSource = (source === 'notebook' || source === 'learning' || source === 'custom') ? source : 'all';
  reviewCustomKeys = source === 'custom' ? (customKeys || []) : [];
  const titleEl = document.getElementById('reviewModeTitle');
  if (titleEl) titleEl.textContent = reviewSource === 'custom' ? (reviewPracticeMode ? (customTitle || 'Bài tập từ video') : 'Ôn thử: ' + (customTitle || 'bộ từ')) : reviewSource === 'notebook' ? 'Ôn sổ tay' : reviewSource === 'learning' ? 'Từ cần ôn' : 'Ôn tập';
  overlay.style.display = asPage ? 'none' : 'flex';
  // Ôn thử cả bộ: tick sẵn "chỉ từ đến hạn" sẽ làm mất những từ bạn đã thuộc → mặc định ôn TẤT CẢ từ của bộ.
  reviewDueOnly = reviewSource !== 'custom';
  syncReviewScopeUi();
  reviewSessionStartTs = Date.now(); // mốc để tính tóm tắt cuối phiên (xem buildReviewQueue)
  if (reviewSource === 'notebook' || reviewSource === 'custom') { const tf = document.getElementById('reviewTopForgottenBox'); if (tf) { tf.style.display = 'none'; tf.innerHTML = ''; } }
  else renderReviewTopForgottenBox(); // "hay quên nhất" lấy từ lịch sử tự đánh giá nên không hiện ở Ôn sổ tay
  // Badge chuỗi ngày ôn — hiện luôn TRONG lúc đang ôn (không chỉ trước/sau ở Learning Bar), nhắc
  // nhẹ suốt phiên thay vì chỉ thấy thoáng qua lúc mở/đóng.
  const streak = computeReviewStreak();
  const streakEl = document.getElementById('reviewModeStreak');
  if (streakEl) {
    if (streak >= 2) { streakEl.textContent = '🔥 ' + streak; streakEl.style.display = ''; }
    else streakEl.style.display = 'none';
  }
  buildReviewQueue();
  ensureReviewDistractorPool(); // chạy nền, không chặn hiện thẻ đầu tiên (xem ghi chú tại hàm)
}
function closeReviewMode() {
  const overlay = document.getElementById('reviewModeOverlay');
  if (overlay) overlay.style.display = 'none';
  initLearningBar();
  // Đang đứng ở tab "Từ cần ôn" (nội dung ôn bị gắn sang overlay lúc mở review toàn màn hình) → gắn lại + dựng lại trang ôn.
  const favPage = document.getElementById('page-favorites');
  if (favActiveTab === 'review' && favPage && favPage.classList.contains('active')) openReviewPage();
}

// Nút chuyển phạm vi ôn "Đến hạn" | "Tất cả" (thay ô tick "Chỉ ôn từ đến hạn" cũ).
function setReviewScope(scope) {
  reviewDueOnly = scope !== 'all';
  syncReviewScopeUi();
  buildReviewQueue();
}
function syncReviewScopeUi() {
  const due = document.getElementById('reviewSegDue');
  const all = document.getElementById('reviewSegAll');
  if (!due || !all) return;
  due.classList.toggle('active', reviewDueOnly);
  all.classList.toggle('active', !reviewDueOnly);
  due.setAttribute('aria-pressed', reviewDueOnly ? 'true' : 'false');
  all.setAttribute('aria-pressed', reviewDueOnly ? 'false' : 'true');
}

// Trộn ngẫu nhiên mảng (Fisher-Yates)
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ══ THẺ CÂU TỪ VIDEO ═══════════════════════════════════════════════════════
// Người học bấm "Lưu câu" ở popup video để đưa câu phụ đề đang đọc vào hàng đợi Ôn tập. Mỗi câu là 1 "thẻ câu" (KHÔNG phải nghĩa của 1 từ) nên
// không nhét được vào srs_progress/favorites (khóa theo word_id + def_index) — có kho riêng:
//   thẻ = { id, thai, viet, youtubeId, start, end, box, due, interval, ignored, created }
// - Chưa đăng nhập: localStorage "thai_sentence_cards". Đã đăng nhập: bảng Supabase "sentence_cards" (xem migration_add_sentence_cards.sql) kèm bản
//   nháp localStorage theo từng tài khoản (để vẫn không mất dữ liệu nếu chưa chạy SQL tạo bảng).
// - Trong hàng đợi Ôn tập, thẻ câu có khóa "s:<id>" (khóa của nghĩa từ là "<wordId>:<defIndex>" nên không bao giờ trùng).
// - Bài tập từ video: các câu phụ đề được dựng thành thẻ TẠM (ephemeralSentenceCards, không lưu, không tính SRS) rồi ôn bằng đúng khung Ôn tập.
const SENTENCE_KEY_PREFIX = 's:';
const ephemeralSentenceCards = {};
function isSentenceKey(key) { return typeof key === 'string' && key.indexOf(SENTENCE_KEY_PREFIX) === 0; }
function sentenceCardLocalKey() { return isLoggedIn() ? 'thai_sentence_cards_u_' + session.user.id : 'thai_sentence_cards'; }
function loadLocalSentenceCards() {
  try { const arr = JSON.parse(localStorage.getItem(sentenceCardLocalKey()) || '[]'); return Array.isArray(arr) ? arr.filter(c => c && c.id && c.thai) : []; } catch (e) { return []; }
}
function saveLocalSentenceCards() {
  try { localStorage.setItem(sentenceCardLocalKey(), JSON.stringify(sentenceCards)); } catch (e) {}
}
function makeSentenceCardId(youtubeId, start) { return youtubeId + '_' + Math.round(Number(start) * 10); }
function getSentenceCard(key) {
  if (!isSentenceKey(key)) return null;
  const id = key.slice(SENTENCE_KEY_PREFIX.length);
  return sentenceCards.find(c => c.id === id) || ephemeralSentenceCards[id] || null;
}
function isEphemeralSentenceKey(key) { return isSentenceKey(key) && !!ephemeralSentenceCards[key.slice(SENTENCE_KEY_PREFIX.length)]; }
function sentenceCardToRow(c) {
  return {
    user_id: session.user.id, card_id: c.id, thai: c.thai, viet: c.viet || '', youtube_id: c.youtubeId,
    start_sec: c.start, end_sec: c.end, box: c.box || 1, due: new Date(c.due || Date.now()).toISOString(),
    interval_days: c.interval || null, ignored: !!c.ignored
  };
}
function sentenceCardFromRow(r) {
  return {
    id: r.card_id, thai: r.thai, viet: r.viet || '', youtubeId: r.youtube_id,
    start: r.start_sec != null ? Number(r.start_sec) : null, end: r.end_sec != null ? Number(r.end_sec) : null,
    box: r.box || 1, due: r.due ? new Date(r.due).getTime() : Date.now(), interval: r.interval_days != null ? Number(r.interval_days) : null,
    ignored: !!r.ignored, created: r.created_at ? new Date(r.created_at).getTime() : Date.now()
  };
}
// Ghi 1 thẻ: luôn lưu local; đã đăng nhập thì đẩy lên Supabase (lỗi mạng/chưa có bảng thì bỏ qua — vẫn còn bản local)
async function persistSentenceCard(card) {
  saveLocalSentenceCards();
  if (isLoggedIn()) {
    try { await sbPostAuth('sentence_cards', sentenceCardToRow(card), 'user_id,card_id'); } catch (e) {}
  }
}
async function removeSentenceCardById(id) {
  sentenceCards = sentenceCards.filter(c => c.id !== id);
  saveLocalSentenceCards();
  if (isLoggedIn()) {
    try { await sbDeleteAuth('sentence_cards?user_id=eq.' + session.user.id + '&card_id=eq.' + encodeURIComponent(id)); } catch (e) {}
  }
}
// Lưu 1 câu phụ đề vào hàng đợi ôn tập (mới lưu = hộp 1, đến hạn ngay). Trả về thẻ đã lưu.
async function saveSentenceCard(caption, youtubeId) {
  const id = makeSentenceCardId(youtubeId, caption.start);
  let card = sentenceCards.find(c => c.id === id);
  if (card) { card.thai = caption.thai; card.viet = caption.viet || ''; card.ignored = false; }
  else {
    card = { id: id, thai: caption.thai, viet: caption.viet || '', youtubeId: youtubeId, start: caption.start, end: caption.end, box: 1, due: Date.now(), interval: null, ignored: false, created: Date.now() };
    sentenceCards.push(card);
  }
  await persistSentenceCard(card);
  return card;
}
function isSentenceSaved(youtubeId, start) {
  const id = makeSentenceCardId(youtubeId, start);
  return sentenceCards.some(c => c.id === id && !c.ignored);
}
// Khi đăng nhập: tải thẻ từ tài khoản, thẻ lưu lúc chưa đăng nhập (chỉ có ở local) được đẩy lên rồi gộp
async function syncSentenceCardsOnLogin() {
  const guestRaw = (() => { try { return JSON.parse(localStorage.getItem('thai_sentence_cards') || '[]'); } catch (e) { return []; } })();
  const accountLocalRaw = (() => { try { return JSON.parse(localStorage.getItem('thai_sentence_cards_u_' + session.user.id) || '[]'); } catch (e) { return []; } })();
  const localCards = (Array.isArray(guestRaw) ? guestRaw : []).concat(Array.isArray(accountLocalRaw) ? accountLocalRaw : []).filter(c => c && c.id && c.thai);
  let remote = null;
  try {
    const res = await sbGetAuth('sentence_cards?select=*&user_id=eq.' + session.user.id);
    if (Array.isArray(res)) remote = res.map(sentenceCardFromRow);
  } catch (e) {}
  if (remote === null) { sentenceCards = localCards; saveLocalSentenceCards(); return; } // chưa có bảng/lỗi mạng: dùng bản local
  const byId = {};
  remote.forEach(c => { byId[c.id] = c; });
  const toPush = [];
  localCards.forEach(c => { if (!byId[c.id]) { byId[c.id] = c; toPush.push(c); } });
  sentenceCards = Object.keys(byId).map(k => byId[k]);
  saveLocalSentenceCards();
  for (const c of toPush) { try { await sbPostAuth('sentence_cards', sentenceCardToRow(c), 'user_id,card_id'); } catch (e) {} }
  try { localStorage.removeItem('thai_sentence_cards'); } catch (e) {} // thẻ của khách đã chuyển sang tài khoản
}
// Cập nhật mức nhớ của thẻ câu — CÙNG bảng quy đổi mức → số ngày với nghĩa của từ (GUESS_LEVEL_BASE_DAYS, mức 5 lặp lại thì nhân đôi)
async function setSentenceSrsLevel(key, level) {
  const card = getSentenceCard(key);
  if (!card || isEphemeralSentenceKey(key)) return; // thẻ tạm của bài tập từ video: không tính SRS
  const isRepeatingMaxLevel = level === 5 && card.box === 5 && card.interval > 0;
  const intervalDays = isRepeatingMaxLevel ? card.interval * 2 : GUESS_LEVEL_BASE_DAYS[level];
  card.box = level;
  card.interval = intervalDays;
  card.due = Date.now() + intervalDays * 86400000;
  await persistSentenceCard(card);
}
async function setSentenceIgnored(key) {
  const card = getSentenceCard(key);
  if (!card || isEphemeralSentenceKey(key)) return;
  card.ignored = true;
  await persistSentenceCard(card);
}
// Ôn câu cũng tính vào chuỗi ngày/tóm tắt phiên: ghi 1 dòng log CỤC BỘ với wordId = -1 (không tồn tại trong từ điển nên không lọt vào "từ hay quên"),
// không đẩy lên srs_review_log (cột word_id của bảng đó là khóa từ).
function logSentenceReview(level) {
  srsReviewLog.push({ wordId: -1, defIndex: 0, level: level, ts: Date.now(), sentence: true });
  saveSrsReviewLog();
}
function reviewKeyExists(key) {
  if (isSentenceKey(key)) return !!getSentenceCard(key);
  return allWords.some(w => w.id === favKeyParts(key).wordId);
}

// ══ VIDEO ĐÃ LƯU (SỔ TAY) ═══════════════════════════════════════════════════
// Người học bấm "Lưu video" ở popup video để giữ NGUYÊN video (đoạn ví dụ + phụ đề) trong Sổ tay, xếp vào thư mục như từ vựng.
//   video = { id, youtubeId, start, end, title, author, captions:[{start,end,thai,viet}], showCaptions, folders:[folderId...], created }
// Phụ đề được CHỤP LẠI (snapshot) lúc lưu để mở lại từ Sổ tay không phụ thuộc từ chứa video. Thư mục dùng chung danh sách favoriteFolders với từ vựng.
// Lưu: chưa đăng nhập = localStorage "thai_saved_videos"; đã đăng nhập = bảng Supabase "saved_videos" (migration_add_saved_videos.sql) kèm bản nháp
// localStorage theo tài khoản (không mất dữ liệu nếu chưa chạy SQL).
function savedVideoLocalKey() { return isLoggedIn() ? 'thai_saved_videos_u_' + session.user.id : 'thai_saved_videos'; }
function loadLocalSavedVideos() {
  try { const arr = JSON.parse(localStorage.getItem(savedVideoLocalKey()) || '[]'); return Array.isArray(arr) ? arr.filter(v => v && v.id && v.youtubeId) : []; } catch (e) { return []; }
}
function saveLocalSavedVideos() {
  try { localStorage.setItem(savedVideoLocalKey(), JSON.stringify(savedVideos)); } catch (e) {}
}
function makeSavedVideoId(youtubeId, start, end) {
  const f = x => (x != null && x !== '' && isFinite(x)) ? Math.round(Number(x) * 10) : 'x';
  return youtubeId + '_' + f(start) + '_' + f(end);
}
function findSavedVideo(youtubeId, start, end) {
  const id = makeSavedVideoId(youtubeId, start, end);
  return savedVideos.find(v => v.id === id) || null;
}
function savedVideoToRow(v) {
  return {
    user_id: session.user.id, video_id: v.id, youtube_id: v.youtubeId,
    start_sec: v.start != null ? v.start : null, end_sec: v.end != null ? v.end : null,
    title: v.title || '', author: v.author || '', captions: v.captions || [], show_captions: !!v.showCaptions,
    folder_ids: v.folders || [], created_at: new Date(v.created || Date.now()).toISOString()
  };
}
function savedVideoFromRow(r) {
  return {
    id: r.video_id, youtubeId: r.youtube_id,
    start: r.start_sec != null ? Number(r.start_sec) : null, end: r.end_sec != null ? Number(r.end_sec) : null,
    title: r.title || '', author: r.author || '', captions: normalizeVideoCaptions(r.captions), showCaptions: !!r.show_captions,
    folders: Array.isArray(r.folder_ids) ? r.folder_ids : [], created: r.created_at ? new Date(r.created_at).getTime() : Date.now()
  };
}
async function persistSavedVideo(v) {
  saveLocalSavedVideos();
  if (isLoggedIn()) {
    try { await sbPostAuth('saved_videos', savedVideoToRow(v), 'user_id,video_id'); } catch (e) {}
  }
}
async function removeSavedVideoById(id) {
  savedVideos = savedVideos.filter(v => v.id !== id);
  saveLocalSavedVideos();
  if (isLoggedIn()) {
    try { await sbDeleteAuth('saved_videos?user_id=eq.' + session.user.id + '&video_id=eq.' + encodeURIComponent(id)); } catch (e) {}
  }
}
// Số video trong 1 thư mục (folderId = null → video chưa xếp thư mục nào)
function countVideosInFolder(folderId) {
  if (folderId === null) return savedVideos.filter(v => !(v.folders && v.folders.length)).length;
  return savedVideos.filter(v => (v.folders || []).includes(folderId)).length;
}
// Khi đăng nhập: tải video từ tài khoản, video lưu lúc chưa đăng nhập (chỉ có ở local) được đẩy lên rồi gộp.
// Thư mục của khách có id nội bộ ("f_...") — đổi sang id thư mục tài khoản theo TÊN (danh sách thư mục khách đọc từ localStorage nếu còn);
// không ánh xạ được thì video về "Chưa phân loại".
async function syncSavedVideosOnLogin() {
  const readJson = (k) => { try { const x = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } };
  const guestVideos = readJson('thai_saved_videos');
  const guestFolders = readJson('thai_fav_folders');
  const accountLocal = readJson('thai_saved_videos_u_' + session.user.id);
  const mapFolderIds = (ids) => (ids || []).map(fid => {
    if (favoriteFolders.some(f => f.id === fid)) return fid;
    const lf = guestFolders.find(f => f.id === fid);
    const byName = lf ? favoriteFolders.find(f => (f.name || '').toLowerCase() === (lf.name || '').toLowerCase()) : null;
    return byName ? byName.id : null;
  }).filter(x => x !== null);
  const localVideos = guestVideos.map(v => Object.assign({}, v, { folders: mapFolderIds(v.folders) })).concat(accountLocal).filter(v => v && v.id && v.youtubeId);
  let remote = null;
  try {
    const res = await sbGetAuth('saved_videos?select=*&user_id=eq.' + session.user.id);
    if (Array.isArray(res)) remote = res.map(savedVideoFromRow);
  } catch (e) {}
  if (remote === null) { savedVideos = localVideos; saveLocalSavedVideos(); return; } // chưa có bảng/lỗi mạng: dùng bản local
  const byId = {};
  remote.forEach(v => { byId[v.id] = v; });
  const toPush = [];
  localVideos.forEach(v => { if (!byId[v.id]) { byId[v.id] = v; toPush.push(v); } });
  savedVideos = Object.keys(byId).map(k => byId[k]);
  saveLocalSavedVideos();
  for (const v of toPush) { try { await sbPostAuth('saved_videos', savedVideoToRow(v), 'user_id,video_id'); } catch (e) {} }
  try { localStorage.removeItem('thai_saved_videos'); } catch (e) {}
}

// ── Chọn thư mục cho video (dùng lại popup chọn thư mục của từ vựng, chế độ 'video': tick nhiều thư mục như chế độ 'def') ──
function openVideoFolderPicker(videoId, justSaved) {
  favPickerContext = { mode: 'video', videoId: videoId, folderOrder: computeSortedFolderPickerOrder() };
  setFolderPickerHeader(justSaved ? 'Lưu video vào thư mục' : 'Chuyển video sang thư mục', 'Chọn một hoặc nhiều thư mục, hoặc tạo thư mục mới (đóng popup = để ở "Chưa phân loại")');
  const searchInput = document.getElementById('favFolderPickerSearch');
  if (searchInput) searchInput.value = '';
  renderFavFolderPickerList();
  const newNameInput = document.getElementById('favFolderPickerNewName');
  if (newNameInput) newNameInput.value = '';
  document.getElementById('favFolderPickerModal').classList.add('show');
}
function refreshSavedVideosUI() {
  const favPage = document.getElementById('page-favorites');
  if (favPage && favPage.classList.contains('active') && favActiveTab === 'mine') renderFavorites();
}
async function toggleVideoInFolder(videoId, rawFolderId) {
  const v = savedVideos.find(x => x.id === videoId);
  const folderId = coerceFolderId(rawFolderId);
  if (!v || folderId === null) return;
  v.folders = v.folders || [];
  const i = v.folders.indexOf(folderId);
  if (i === -1) { v.folders.push(folderId); touchFolderRecent(folderId); } else { v.folders.splice(i, 1); }
  await persistSavedVideo(v);
  renderFavFolderPickerList();
  refreshSavedVideosUI();
}
async function setVideoUncategorized(videoId) {
  const v = savedVideos.find(x => x.id === videoId);
  if (!v) return;
  v.folders = [];
  await persistSavedVideo(v);
  renderFavFolderPickerList();
  refreshSavedVideosUI();
}
// Mở lại video đã lưu từ Sổ tay: đăng ký lại phụ đề đã chụp rồi mở popup video như ở chỗ khác
function openSavedVideo(id) {
  const v = savedVideos.find(x => x.id === id);
  if (!v) return;
  registerExVideoCaptions({ youtubeId: v.youtubeId, start: v.start, end: v.end, showCaptions: v.showCaptions, captions: v.captions });
  openExampleVideo(null, v.youtubeId, v.start, v.end);
}
async function deleteSavedVideo(id, event) {
  if (event) event.stopPropagation();
  if (!confirm('Bỏ video này khỏi Sổ tay?')) return;
  await removeSavedVideoById(id);
  showToast('Đã bỏ video khỏi Sổ tay');
  syncExampleVideoSaveVideoBtn();
  renderFavorites();
}
function buildSavedVideosSectionHTML(videos) {
  if (!videos.length) return '';
  const rows = videos.map(v => {
    const folderNames = (v.folders || []).map(fid => { const f = favoriteFolders.find(x => x.id === fid); return f ? f.name : null; }).filter(Boolean);
    const range = v.start != null && v.end != null ? exampleVideoListTime(v.start) + '–' + exampleVideoListTime(v.end) : '';
    const meta = [v.author, v.captions && v.captions.length ? v.captions.length + ' câu' : '', range].filter(Boolean).join(' · ');
    return '<div class="fav-video-row" onclick="openSavedVideo(\'' + v.id + '\')">'
      + '<div class="fav-video-thumb"><img src="https://i.ytimg.com/vi/' + encodeURIComponent(v.youtubeId) + '/mqdefault.jpg" loading="lazy" alt=""><span class="fav-video-play">▶</span></div>'
      + '<div class="fav-video-info">'
      +   '<div class="fav-video-title">' + escapeHtml(v.title || 'Video YouTube') + '</div>'
      +   (meta ? '<div class="fav-video-meta">' + escapeHtml(meta) + '</div>' : '')
      +   (folderNames.length ? '<div class="fav-video-folders">' + folderNames.map(n => '<span class="fav-video-folder-chip">' + escapeHtml(n) + '</span>').join('') + '</div>' : '')
      + '</div>'
      + '<div class="fav-video-actions">'
      +   '<button type="button" class="btn-small" title="Chuyển sang thư mục khác" onclick="event.stopPropagation(); openVideoFolderPicker(\'' + v.id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></button>'
      +   '<button type="button" class="btn-small del" title="Bỏ video khỏi Sổ tay" onclick="deleteSavedVideo(\'' + v.id + '\', event)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
      + '</div></div>';
  }).join('');
  return '<div class="fav-video-section"><div class="fav-section-heading fav-video-heading">🎬 Video đã lưu <span class="fav-video-count">' + videos.length + '</span></div>' + rows + '</div>';
}

// Toàn bộ nghĩa CÓ THỂ ôn = mọi nghĩa đã LƯU (favorites), không chỉ nghĩa đã từng tự đánh giá (favSrsMap) — trước
// đây Ôn tập chỉ duyệt favSrsMap nên từ mới lưu mà CHƯA từng bấm mức hiểu 1 lần nào sẽ vắng mặt hoàn toàn khỏi Ôn
// tập (kể cả bật "Ôn thêm tất cả"), người dùng phải vào trang kết quả tự chấm trước thì mới ôn được. Từ chưa có
// mục favSrsMap coi như box=1 (mới), due=ngay bây giờ (đến hạn ngay) — value TẠM, KHÔNG ghi vào favSrsMap hay
// Supabase ở bước này; nó chỉ thực sự được lưu khi người dùng tự chấm mức lần đầu tiên trong phiên ôn.
function reviewableKeys(source) {
  const isIgnoredKey = k => isSentenceKey(k) ? !!(getSentenceCard(k) && getSentenceCard(k).ignored) : !!(favSrsMap[k] && favSrsMap[k].ignored);
  if (source === 'custom') return reviewCustomKeys.filter(k => !isIgnoredKey(k));
  const keys = new Set();
  if (source !== 'learning') favorites.forEach(k => keys.add(k));         // 'notebook' hoặc gộp
  if (source !== 'notebook') Object.keys(favSrsMap).forEach(k => keys.add(k)); // 'learning' hoặc gộp
  sentenceCards.forEach(c => { if (!c.ignored) keys.add(SENTENCE_KEY_PREFIX + c.id); }); // câu đã lưu từ video: có mặt ở mọi nguồn (người học tự lưu chủ động)
  return Array.from(keys).filter(k => !isIgnoredKey(k));
}
function reviewSrsOf(key) {
  if (isSentenceKey(key)) {
    const c = getSentenceCard(key);
    return c ? { box: c.box || 1, due: c.due || Date.now(), interval: c.interval || null } : { box: 1, due: Date.now(), interval: null };
  }
  return favSrsMap[key] || { box: 1, due: Date.now(), interval: null };
}
// Thẻ "Ôn tập" LUÔN HIỆN trong Sổ tay (#favReviewEntry, xem index.html) — cập nhật dòng phụ theo đúng cách tính
// của Learning Bar (reviewableKeys/reviewSrsOf ở trên): "Có N từ đến hạn" nếu có, ngược lại nếu Sổ tay đang có
// từ thì "Ôn thêm M từ (chưa đến hạn)" để vẫn mời chủ động ôn, trống hoàn toàn thì "Sổ tay chưa có từ nào".
// Dòng phụ mô tả nguồn ôn (dùng chung cho nút "Ôn sổ tay" và hộp chọn): "Có N từ đến hạn" nếu có, ngược lại
// nếu nguồn có từ thì "Ôn thêm M từ (chưa đến hạn)", trống hoàn toàn thì emptyText.
function reviewSourceSubText(source, emptyText) {
  const now = Date.now();
  const keys = reviewableKeys(source);
  const dueCount = keys.filter(k => reviewSrsOf(k).due <= now).length;
  if (dueCount > 0) return 'Có ' + Math.min(dueCount, REVIEW_SESSION_LIMIT) + ' từ đến hạn';
  if (keys.length > 0) return 'Ôn thêm ' + keys.length + ' từ (chưa đến hạn)';
  return emptyText;
}
function renderFavReviewEntry() {
  const sub = document.getElementById('favReviewEntrySub');
  if (!sub) return;
  sub.textContent = reviewSourceSubText('notebook', 'Sổ tay chưa có từ nào');
}
// Lối vào "Từ cần ôn" (nút sidebar): sang trang Thư viện, tab "Từ cần ôn" — switchFavTab('review') sẽ tự dựng câu ôn.
function openReviewTab() {
  showPage('favorites');
  switchFavTab('review');
}
// Dựng trang ôn trong tab: nguồn cố định 'learning' ("Từ cần ôn"), hiện câu ôn luôn, không hộp chọn.
function openReviewPage() {
  openReviewMode('learning', null, null, true);
}
function buildReviewQueue(forceAll) {
  reviewAnswerLock = false;
  reviewRenderToken++; // huỷ mọi lần render thẻ cũ còn đang chờ tải từ
  const now = Date.now();
  // Loại bỏ hẳn các nghĩa đã đánh dấu "Không quan tâm" (ignored) NGAY TỪ ĐẦU — trước cả bước lọc
  // đến hạn/giới hạn phiên, để mọi tính toán phía sau (đến hạn, giới hạn 20 thẻ, tổng số theo
  // dõi...) không cần biết gì về khái niệm "ignored" nữa, gọn code đúng như mong muốn ban đầu.
  const allKeys = reviewableKeys(reviewSource);
  const totalInScope = allKeys.length;
  // Số hiển thị trên nút chuyển phạm vi — chỉ đếm nghĩa mà từ gốc còn tồn tại (đúng bộ lọc áp dụng ở dưới), để khớp với hàng đợi thật.
  const existingKeys = allKeys.filter(k => reviewKeyExists(k));
  const dueCountShown = existingKeys.filter(k => reviewSrsOf(k).due <= now).length;
  const dueCountEl = document.getElementById('reviewSegDueCount');
  const allCountEl = document.getElementById('reviewSegAllCount');
  if (dueCountEl) dueCountEl.textContent = dueCountShown;
  if (allCountEl) allCountEl.textContent = existingKeys.length;
  let keys;
  let cappedFromCount = 0;
  if (reviewDueOnly && !forceAll) {
    // Ưu tiên từ đến hạn LÂU NHẤT (due date cũ nhất) — nếu dồn quá REVIEW_SESSION_LIMIT thẻ do
    // bỏ bê vài ngày, phiên này chỉ phục vụ đúng ngần đó, phần còn lại để dành phiên sau (xem
    // ghi chú REVIEW_SESSION_LIMIT).
    const dueKeys = allKeys.filter(k => reviewSrsOf(k).due <= now).sort((a, b) => reviewSrsOf(a).due - reviewSrsOf(b).due);
    cappedFromCount = dueKeys.length;
    keys = dueKeys.slice(0, REVIEW_SESSION_LIMIT);
  } else {
    keys = allKeys; // forceAll ("Ôn thêm tất cả") hoặc bỏ tick "chỉ ôn từ đến hạn": không giới hạn
  }
  // Chỉ giữ lại các nghĩa mà từ vựng gốc vẫn còn tồn tại (phòng trường hợp từ đã bị admin xóa)
  keys = keys.filter(k => reviewKeyExists(k));

  reviewQueue = reviewPracticeMode ? keys.slice() : shuffleArray(keys); // luyện tập từ video: giữ đúng thứ tự trong video
  reviewIndex = 0;
  reviewFlipped = false;

  const emptyState = document.getElementById('reviewEmptyState');
  const cardArea = document.getElementById('reviewCardArea');
  const cappedNoteEl = document.getElementById('reviewCappedNote');
  if (cappedNoteEl) {
    cappedNoteEl.style.display = (cappedFromCount > REVIEW_SESSION_LIMIT) ? '' : 'none';
    if (cappedFromCount > REVIEW_SESSION_LIMIT) {
      cappedNoteEl.textContent = 'Còn ' + (cappedFromCount - REVIEW_SESSION_LIMIT) + ' từ khác cũng đến hạn, hẹn phiên sau.';
    }
  }
  if (!reviewQueue.length) {
    emptyState.style.display = 'block';
    cardArea.style.display = 'none';
    // Dùng existingKeys (chỉ nghĩa mà từ gốc còn tồn tại) thay vì totalInScope để khớp số trên nút "Tất cả" — nghĩa của từ đã bị xóa
    // khỏi từ điển không được tính là "đang theo dõi".
    const hasWordsToReview = existingKeys.length > 0;
    document.getElementById('reviewEmptyEmoji').textContent = hasWordsToReview ? '🎉' : '📚';
    document.getElementById('reviewEmptyTitle').textContent = hasWordsToReview
      ? 'Bạn đã ôn xong hết rồi!'
      : (reviewSource === 'notebook' ? 'Sổ tay chưa có từ nào để ôn' : 'Chưa có từ nào để ôn tập');
    // Tóm tắt PHIÊN VỪA XONG — đếm số lượt tự đánh giá kể từ lúc mở Review Mode (reviewSessionStartTs),
    // tách theo mức: bao nhiêu lên Làm chủ, bao nhiêu vẫn Mới gặp. Không đếm số TỪ (1 từ có thể được
    // đánh giá nhiều lần trong 1 phiên nếu dùng "Ôn thêm tất cả") mà đếm số LƯỢT, phản ánh đúng công
    // sức vừa bỏ ra. Nếu chưa ôn lượt nào trong phiên này (mở lên đã hết sẵn) thì rơi về câu gợi ý cũ.
    const sessionEntries = srsReviewLog.filter(e => e.ts >= reviewSessionStartTs);
    if (sessionEntries.length > 0) {
      const masteredCount = sessionEntries.filter(e => e.level === 5).length;
      const strugglingCount = sessionEntries.filter(e => e.level === 1).length;
      let summary = 'Đã ôn ' + sessionEntries.length + ' lượt trong phiên này';
      if (masteredCount) summary += ', ' + masteredCount + ' lên Làm chủ';
      if (strugglingCount) summary += ', ' + strugglingCount + ' vẫn Mới gặp';
      document.getElementById('reviewEmptySub').textContent = summary + '.';
    } else {
      document.getElementById('reviewEmptySub').textContent = hasWordsToReview
        ? 'Còn ' + existingKeys.length + ' từ đang theo dõi, ôn thêm nếu muốn.'
        : (reviewSource === 'notebook' ? 'Lưu từ vào Sổ tay để bắt đầu ôn.' : 'Hãy tự đánh giá mức nhớ ở trang kết quả tra từ để bắt đầu ôn tập.');
    }
    document.querySelector('#reviewEmptyState .review-empty-btn').style.display = hasWordsToReview ? '' : 'none';
    return;
  }
  emptyState.style.display = 'none';
  cardArea.style.display = 'block';
  renderReviewCard();
}

function reviewAll() {
  setReviewScope('all');
}

// Số ngày ôn tập LIÊN TỤC (streak) — đếm từ hôm nay lùi về trước, mỗi ngày có ít nhất 1 lượt tự
// đánh giá (srsReviewLog) thì tính. Nếu HÔM NAY chưa ôn lượt nào thì không tính là "gãy chuỗi"
// ngay — bắt đầu đếm từ hôm qua (người dùng còn cả ngày để ôn, chưa mở app không có nghĩa là bỏ
// cuộc). Dùng cho Learning Bar (xem computeLearningBarMessages).
function computeReviewStreak() {
  if (!srsReviewLog.length) return 0;
  const activeDays = new Set(srsReviewLog.map(e => new Date(e.ts).toDateString()));
  const d = new Date();
  if (!activeDays.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (activeDays.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ── ÔN TẬP: 6 KIỂU BÀI XOAY NGẪU NHIÊN, TẤT CẢ XOAY QUANH VÍ DỤ THẬT ─────────
// Nhãn + icon + màu riêng cho mỗi kiểu bài — giúp nhận ra ngay đang chơi kiểu nào, đỡ đơn điệu
// khi 6 kiểu xoay vòng (trước đây cả 6 kiểu dùng chung 1 tiêu đề chữ hoa xám giống hệt nhau).
const REVIEW_EXERCISE_META = {
  cloze: { icon: '✏️', label: 'Điền từ', colorClass: 'rt-cloze' },
  forward: { icon: '📖', label: 'Đọc hiểu', colorClass: 'rt-forward' },
  reverse: { icon: '🔍', label: 'Tìm câu', colorClass: 'rt-reverse' },
  reorder: { icon: '🔀', label: 'Sắp xếp câu', colorClass: 'rt-reorder' },
  listening: { icon: '🎧', label: 'Nghe', colorClass: 'rt-listening' },
  truefalse: { icon: '✅', label: 'Đúng/Sai', colorClass: 'rt-truefalse' }
};
function buildReviewTypeTagHTML(type) {
  const meta = REVIEW_EXERCISE_META[type];
  if (!meta) return '';
  return '<div class="review-type-tag ' + meta.colorClass + '">' + meta.icon + ' ' + meta.label + '</div>';
}

// Mỗi lượt ôn 1 nghĩa, hệ thống kiểm tra nghĩa đó ĐỦ DỮ LIỆU cho những kiểu bài nào (không phải
// nghĩa nào cũng có đủ ví dụ/nghĩa để làm mọi kiểu), rồi bốc NGẪU NHIÊN 1 kiểu trong số đó:
//  - cloze: điền từ còn thiếu vào câu ví dụ thật (cần ví dụ chứa nguyên văn từ)
//  - forward: cho câu ví dụ tiếng Thái, chọn đúng nghĩa tiếng Việt (cần ví dụ có bản dịch)
//  - reverse: cho nghĩa tiếng Việt, chọn đúng câu ví dụ tiếng Thái (cần có sẵn nguồn câu của
//    NHỮNG TỪ KHÁC để làm nhiễu — xem reviewDistractorPool, tải nền lúc mở Ôn tập)
//  - reorder: xáo trộn các cụm từ trong câu ví dụ (tách bằng segmentThai() — dùng lại đúng thuật
//    toán PopThai), kéo/chạm xếp lại đúng thứ tự
//  - listening: phát âm câu ví dụ (ẩn chữ Thái), chọn đúng nghĩa tiếng Việt
//  - truefalse: cho câu ví dụ + 1 câu khẳng định về nghĩa của từ trong câu (đúng hoặc sai), chọn
//    Đúng/Sai
// Nếu nghĩa không đủ dữ liệu cho BẤT KỲ kiểu nào trong 6 kiểu trên (không có ví dụ nào cả) thì
// rơi về khung lật thẻ .review-card cũ (renderReviewFlipCard) — vẫn giữ nguyên làm phương án dự
// phòng cuối cùng, không xoá.
// Tất cả 6 kiểu đều kết thúc bằng CÙNG 1 bước: renderReviewSelfCheckInto() — thang 5 mặt trăng
// dùng chung với trang kết quả tra từ, không có kiểu nào tự chấm đúng/sai riêng.
async function renderReviewCard() {
  const myToken = ++reviewRenderToken;
  reviewAnswerLock = false; // thẻ mới hiện ra -> cho phép chấm lại
  const key = reviewQueue[reviewIndex];
  const { wordId, defIndex } = favKeyParts(key);
  document.getElementById('reviewProgress').textContent = (reviewIndex + 1) + ' / ' + reviewQueue.length;
  const fillEl = document.getElementById('reviewProgressBarFill');
  if (fillEl) fillEl.style.width = Math.round((reviewIndex + 1) / reviewQueue.length * 100) + '%';
  document.getElementById('reviewAnswerBtns').style.display = 'none';
  document.getElementById('reviewAnswerBtns').innerHTML = '';
  // Hiệu ứng chuyển thẻ — mờ nhẹ + trượt lên 1 chút mỗi lần đổi thẻ, xoá ngay sau khi animation
  // chạy xong (250ms) để lần đổi thẻ TIẾP THEO vẫn kích hoạt lại được (browser không phát lại
  // animation nếu class chưa từng bị gỡ ra rồi gắn lại).
  const exerciseAreaElForAnim = document.getElementById('reviewExerciseArea');
  if (exerciseAreaElForAnim) {
    exerciseAreaElForAnim.classList.remove('review-card-enter');
    void exerciseAreaElForAnim.offsetWidth; // ép reflow để restart animation
    exerciseAreaElForAnim.classList.add('review-card-enter');
  }

  if (isSentenceKey(key)) { renderSentenceReviewCard(key); return; } // thẻ câu từ video — không có từ/định nghĩa để tải, dựng bài từ chính câu
  const word = await ensureWordFull(wordId);
  // Trong lúc chờ tải từ, người học có thể đã sang thẻ khác / đổi bộ lọc "chỉ ôn từ đến hạn" (gọi renderReviewCard lần nữa):
  // bỏ kết quả về trễ này để nó không đè lên thẻ mới hơn.
  if (myToken !== reviewRenderToken) return;
  if (!word) { nextReviewCard(); return; }
  const def = (word.definitions || [])[defIndex];
  const examples = (def ? (def.examples || []) : ((defIndex === 0) ? (word.examples || []) : [])).filter(ex => ex && ex.thai);

  // Cloze phải tìm từ trong PHẦN CÂU (đã bỏ thẻ đầu dòng như [ทางการ]) — nếu từ chỉ nằm trong thẻ thì chỗ trống sẽ không xuất hiện
  const clozeEx = examples.find(ex => extractLeadingTag(ex.thai).rest.indexOf(word.thai) !== -1);
  const meaningEx = examples.find(ex => ex.viet);
  let reorderEx = null, reorderChunks = null;
  for (const ex of examples) {
    const chunks = getReorderChunks(extractLeadingTag(ex.thai).rest);
    if (chunks.length >= 3 && chunks.length <= 8) { reorderEx = ex; reorderChunks = chunks; break; }
  }

  const eligible = [];
  if (clozeEx) eligible.push({ type: 'cloze', ex: clozeEx });
  if (meaningEx) eligible.push({ type: 'forward', ex: meaningEx });
  if (meaningEx && reviewDistractorPool.length >= 3) eligible.push({ type: 'reverse', ex: meaningEx });
  if (reorderEx) eligible.push({ type: 'reorder', ex: reorderEx, chunks: reorderChunks });
  if (meaningEx) eligible.push({ type: 'listening', ex: meaningEx });
  // Đúng/Sai cần nghĩa tiếng Việt của định nghĩa để dựng câu khẳng định — không có thì câu hiện ra rỗng "...nghĩa là \"\""
  if (meaningEx && def && extractLeadingTag(def.viet_meaning || '').rest.trim()) eligible.push({ type: 'truefalse', ex: meaningEx });

  const exerciseAreaEl = document.getElementById('reviewExerciseArea');
  const flipCardEl = document.getElementById('reviewCard');
  const hintEl = document.getElementById('reviewHint');

  if (!eligible.length) {
    exerciseAreaEl.style.display = 'none';
    flipCardEl.style.display = '';
    hintEl.style.display = '';
    currentReviewExerciseType = null; // khung lật thẻ cũ không tính vào thống kê cân bằng độ khó
    renderReviewFlipCard(word, def, defIndex, key);
    return;
  }

  flipCardEl.style.display = 'none';
  hintEl.style.display = 'none';
  exerciseAreaEl.style.display = 'block';
  const chosen = pickWeightedExerciseType(eligible);
  currentReviewExerciseType = chosen.type;
  if (chosen.type === 'cloze') renderReviewCloze(word, chosen.ex);
  else if (chosen.type === 'forward') renderReviewForward(word, chosen.ex);
  else if (chosen.type === 'reverse') renderReviewReverse(word, chosen.ex);
  else if (chosen.type === 'reorder') renderReviewReorder(chosen.ex, chosen.chunks);
  else if (chosen.type === 'listening') renderReviewListening(word, chosen.ex);
  else if (chosen.type === 'truefalse') renderReviewTrueFalse(word, def, chosen.ex);
}

// ── THẺ CÂU TỪ VIDEO TRONG KHUNG ÔN TẬP ────────────────────────────────────
// Dựng bài tập từ CHÍNH câu phụ đề bằng các hàm vẽ bài có sẵn (cloze/forward/reverse/reorder/listening) — chúng chỉ cần 1 "ví dụ" {thai, viet}
// và (cloze) 1 từ đích. Từ đích cho cloze chọn ngẫu nhiên trong các từ của câu, ưu tiên từ có trong từ điển. Không có bài nào đủ điều kiện
// (câu quá ngắn, không có bản dịch) thì rơi về thẻ "xem nghĩa". Bài đúng/sai không dùng vì cần nghĩa của 1 từ cụ thể.
function renderSentenceReviewCard(key) {
  const card = getSentenceCard(key);
  if (!card) { nextReviewCard(); return; }
  const ex = { thai: card.thai, viet: card.viet || '' };
  const chunks = getReorderChunks(extractLeadingTag(ex.thai).rest);
  const dict = getSegmentDictSet();
  let cands = chunks.filter(c => c.length >= 2 && dict.has(c));
  if (!cands.length) cands = chunks.filter(c => c.length >= 3);
  const target = cands.length ? cands[Math.floor(Math.random() * cands.length)] : '';
  const pseudoWord = { id: -1, thai: target, meanings: [] };
  const eligible = [];
  if (target) eligible.push({ type: 'cloze' });
  if (ex.viet) {
    eligible.push({ type: 'forward' });
    eligible.push({ type: 'listening' });
    if (reviewDistractorPool.length >= 3) eligible.push({ type: 'reverse' });
  }
  if (chunks.length >= 3 && chunks.length <= 8) eligible.push({ type: 'reorder' });

  document.getElementById('reviewCard').style.display = 'none';
  document.getElementById('reviewHint').style.display = 'none';
  const area = document.getElementById('reviewExerciseArea');
  area.style.display = 'block';
  if (!eligible.length) {
    currentReviewExerciseType = null;
    renderSentenceReveal(card);
  } else {
    const chosen = pickWeightedExerciseType(eligible);
    currentReviewExerciseType = chosen.type;
    if (chosen.type === 'cloze') renderReviewCloze(pseudoWord, ex);
    else if (chosen.type === 'forward') renderReviewForward(pseudoWord, ex);
    else if (chosen.type === 'reverse') renderReviewReverse(pseudoWord, ex);
    else if (chosen.type === 'reorder') renderReviewReorder(ex, chunks);
    else if (chosen.type === 'listening') renderReviewListening(pseudoWord, ex);
  }
  area.insertAdjacentHTML('beforeend', buildSentenceSourceHTML(card));
}
function buildSentenceSourceHTML(card) {
  if (!card.youtubeId) return '';
  const t = card.start != null && isFinite(card.start) && card.start > 0 ? '&t=' + Math.floor(card.start) + 's' : '';
  return '<div class="review-sentence-source">🎬 Câu từ video · <a href="https://www.youtube.com/watch?v=' + encodeURIComponent(card.youtubeId) + t + '" target="_blank" rel="noopener noreferrer">Xem video gốc ↗</a></div>';
}
// Dự phòng: chỉ hiện câu Thái (kèm nút nghe), bấm "Xem nghĩa" mới lộ bản dịch rồi tự chấm
function renderSentenceReveal(card) {
  const thaiParsed = extractLeadingTag(card.thai || '');
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-cloze-sentence">' + thaiParsed.rest + '</div>'
    + '<button type="button" class="review-cloze-viet-toggle" onclick="onSentenceRevealClick(this)">Xem nghĩa</button>'
    + '<div class="review-cloze-viet" id="reviewSentenceViet" style="display:none">' + escapeHtml(card.viet || '(chưa có bản dịch)') + '</div>';
}
function onSentenceRevealClick(btn) {
  const v = document.getElementById('reviewSentenceViet');
  if (v) v.style.display = '';
  if (btn) btn.style.display = 'none';
  renderReviewSelfCheckInto('reviewAnswerBtns');
}

// ── BÀI TẬP TỪ CHÍNH VIDEO ───────────────────────────────────────────────
// Từ popup video: dựng thẻ TẠM từ các câu phụ đề (không lưu, không tính SRS) rồi mở khung Ôn tập ở chế độ "luyện tập" (ordering giữ nguyên thứ tự video).
// Làm xong mỗi câu có nút "Lưu vào ôn tập" để giữ lại câu khó và "Tiếp tục".
let reviewPracticeMode = false;
function startExampleVideoPractice() {
  const st = exampleVideoState;
  if (!st.captions || !st.captions.length || !st.id) return;
  Object.keys(ephemeralSentenceCards).forEach(k => { delete ephemeralSentenceCards[k]; });
  const keys = st.captions.slice(0, 20).map(c => {
    const id = 'p_' + makeSentenceCardId(st.id, c.start);
    ephemeralSentenceCards[id] = { id: id, thai: c.thai, viet: c.viet || '', youtubeId: st.id, start: c.start, end: c.end, box: 1, due: Date.now(), interval: null, ignored: false };
    return SENTENCE_KEY_PREFIX + id;
  }).filter(k => ephemeralSentenceCards[k.slice(SENTENCE_KEY_PREFIX.length)].thai);
  if (!keys.length) return;
  closeExampleVideo();
  openReviewMode('custom', keys, 'Bài tập từ video', false, true);
}
async function onPracticeSaveSentence(btn) {
  const key = reviewQueue[reviewIndex];
  const card = getSentenceCard(key);
  if (!card || !card.youtubeId) return;
  await saveSentenceCard({ start: card.start, end: card.end, thai: card.thai, viet: card.viet }, card.youtubeId);
  if (btn) { btn.textContent = 'Đã lưu ✓'; btn.disabled = true; }
  showToast('🔖 Đã lưu câu vào ôn tập');
}
function onPracticeNext() {
  if (reviewAnswerLock) return;
  reviewAnswerLock = true;
  nextReviewCard();
}
function showPracticeDone() {
  const emptyState = document.getElementById('reviewEmptyState');
  const cardArea = document.getElementById('reviewCardArea');
  const n = reviewQueue.length;
  if (cardArea) cardArea.style.display = 'none';
  if (emptyState) emptyState.style.display = 'block';
  document.getElementById('reviewEmptyEmoji').textContent = '🎉';
  document.getElementById('reviewEmptyTitle').textContent = 'Bạn đã luyện xong!';
  document.getElementById('reviewEmptySub').textContent = 'Đã làm ' + n + ' câu từ video. Câu nào cần ôn lại thì lưu vào ôn tập để app nhắc đúng lúc.';
  const btn = document.querySelector('#reviewEmptyState .review-empty-btn');
  if (btn) btn.style.display = 'none';
}

// Cân bằng độ khó giữa 6 kiểu bài theo lịch sử trả lời — kiểu nào hay bị tự đánh giá THẤP (mức
// 1-2, "Mới gặp"/"Đang làm quen") ngay sau đó thì được ưu tiên ra NHIỀU HƠN 1 chút ở các phiên
// sau, thiên về rèn đúng chỗ yếu thay vì random đều tay. Dùng công thức Laplace smoothing
// (weak+1)/(attempts+2) để kiểu nào CHƯA từng thử hoặc toàn đúng vẫn có cơ hội được chọn (không
// bao giờ về 0), tránh 1 kiểu bị loại hẳn khỏi vòng xoay chỉ vì may mắn đúng vài lần đầu. Chỉ lưu
// local (localStorage) — đây là gợi ý cá nhân hoá nhẹ, không cần đồng bộ tài khoản.
// Bọc try/catch: chuỗi hỏng trong localStorage mà JSON.parse ném lỗi ở cấp cao nhất thì CẢ app.js dừng chạy từ dòng này.
let reviewTypeStats = (function() { try { return JSON.parse(localStorage.getItem('thai_review_type_stats') || '{}') || {}; } catch (e) { return {}; } })();
let currentReviewExerciseType = null;
function saveReviewTypeStats() {
  localStorage.setItem('thai_review_type_stats', JSON.stringify(reviewTypeStats));
}
function recordReviewTypeResult(type, level) {
  if (!type) return;
  const s = reviewTypeStats[type] || { attempts: 0, weak: 0 };
  s.attempts++;
  if (level <= 2) s.weak++;
  reviewTypeStats[type] = s;
  saveReviewTypeStats();
}
function pickWeightedExerciseType(eligible) {
  const weights = eligible.map(item => {
    const s = reviewTypeStats[item.type] || { attempts: 0, weak: 0 };
    return (s.weak + 1) / (s.attempts + 2);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

// Pool câu ví dụ của NHỮNG TỪ KHÁC (ngẫu nhiên), tải nền 1 LẦN lúc mở Ôn tập (xem openReviewMode)
// — chỉ dùng làm câu nhiễu cho kiểu bài "reverse" (cho nghĩa Việt, chọn đúng câu Thái). Không
// chặn hiện thẻ đầu tiên (chạy nền, không await) — vài thẻ đầu trong phiên có thể chưa đủ pool
// nên tạm thời "reverse" sẽ không nằm trong danh sách kiểu bài đủ điều kiện, tự động bốc kiểu
// khác thay thế, không lỗi gì cả.
let reviewDistractorPool = [];
async function ensureReviewDistractorPool() {
  if (reviewDistractorPool.length >= 15) return;
  const candidates = shuffleArray(allWords.filter(w => w.thai)).slice(0, 12);
  for (const w of candidates) {
    const full = await ensureWordFull(w.id);
    if (!full) continue;
    const allExamples = (full.definitions && full.definitions.length)
      ? full.definitions.reduce((acc, d) => acc.concat(d.examples || []), [])
      : (full.examples || []);
    allExamples.forEach(ex => { if (ex && ex.thai && ex.viet) reviewDistractorPool.push({ thai: ex.thai, viet: ex.viet }); });
  }
}

// Sinh N từ nhiễu ngẫu nhiên (khác từ đúng) từ toàn bộ từ điển — dùng cho kiểu bài cloze.
function buildClozeDistractors(correctThai, count) {
  const candidates = allWords.filter(w => w.thai && w.thai !== correctThai && w.visible !== false);
  return shuffleArray(candidates).slice(0, count).map(w => w.thai);
}

// Sinh N nghĩa tiếng Việt nhiễu (lấy nghĩa đầu tiên của từ khác, KHÔNG cần tải definitions đầy
// đủ — dùng thẳng field "meanings" đã có sẵn từ đầu trong allWords) — dùng cho forward/listening/
// truefalse, nhẹ hơn nhiều so với việc tải ví dụ đầy đủ của từ khác (xem reviewDistractorPool).
// Chuỗi an toàn để nhét vào onclick="speakText('...')" (thuộc tính HTML đặt trong ngoặc kép): thoát \, ', " và xuống dòng —
// trước đây chỉ thoát dấu ' nên câu ví dụ có dấu " hoặc \ làm gãy thuộc tính, nút nghe không chạy.
function jsAttrStr(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');
}
function pickMeaningDistractors(excludeWordId, count, excludeText) {
  const candidates = allWords.filter(w => w.id !== excludeWordId && Array.isArray(w.meanings) && w.meanings[0]);
  const seen = new Set(excludeText ? [excludeText] : []);
  const out = [];
  for (const w of shuffleArray(candidates)) {
    const t = extractLeadingTag(w.meanings[0]).rest;
    if (!t || seen.has(t)) continue; // bỏ nghĩa trùng đáp án đúng / trùng nhau — tránh 2 nút giống hệt
    seen.add(t); out.push(t);
    if (out.length >= count) break;
  }
  return out;
}
// Đáp án nhiễu cho forward/listening: đáp án ĐÚNG là BẢN DỊCH CẢ CÂU, nên nhiễu cũng phải là bản dịch cả câu của các ví dụ
// khác (lấy từ reviewDistractorPool) — trước đây dùng nghĩa 1-2 từ của từ khác nên đáp án dài nhất luôn là đáp án đúng
// (đoán được không cần hiểu). Pool chưa đủ (chưa tải xong / từ điển ít ví dụ) thì dùng lại cách cũ (nghĩa của từ khác).
function pickSentenceDistractors(word, correctViet, count) {
  const seen = new Set([correctViet]);
  const out = [];
  for (const p of shuffleArray(reviewDistractorPool)) {
    const t = extractLeadingTag(p.viet || '').rest;
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= count) break;
  }
  if (out.length >= count) return out;
  return out.concat(pickMeaningDistractors(word.id, count - out.length, correctViet).filter(t => !seen.has(t)));
}

// Tách câu ví dụ thành các cụm từ có nghĩa (dùng lại ĐÚNG segmentThai() — thuật toán PopThai đang
// chạy cho "Tách từ & Dịch câu") — dùng cho kiểu bài reorder. Bỏ khoảng trắng/dấu câu, chỉ giữ
// đúng các cụm chữ Thái.
function getReorderChunks(thaiText) {
  return segmentThai(thaiText).filter(s => !s.isSpace && /[\u0E00-\u0E7F]/.test(s.thai)).map(s => s.thai);
}

// Gắn sự kiện bấm cho khối đáp án trắc nghiệm DÙNG CHUNG (forward/reverse/listening/truefalse) —
// mỗi nút tự mang sẵn data-correct="1"/"0" lúc render, không cần so khớp text (tránh lỗi nếu 2
// đáp án trùng chữ). Tô đúng/sai rồi hiện thanh tự đánh giá — không có bước "lộ đáp án tại chỗ
// trống" như cloze nên tách hàm riêng, không dùng chung onReviewClozeChoice.
function bindReviewChoiceButtons() {
  document.getElementById('reviewChoicesBox').querySelectorAll('.review-choice-btn').forEach(btn => {
    btn.onclick = function() { onReviewChoiceClick(btn); };
  });
}
function onReviewChoiceClick(btn) {
  const choicesEl = document.getElementById('reviewChoicesBox');
  choicesEl.querySelectorAll('.review-choice-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === '1') { b.classList.add('correct'); b.insertAdjacentHTML('beforeend', ' <span class="review-choice-feedback-icon">✓</span>'); }
  });
  if (btn.dataset.correct !== '1') { btn.classList.add('incorrect'); btn.insertAdjacentHTML('beforeend', ' <span class="review-choice-feedback-icon">✕</span>'); }
  renderReviewSelfCheckInto('reviewAnswerBtns');
}

// 1. CLOZE — điền từ còn thiếu vào câu ví dụ thật.
let currentClozeCorrectAnswer = '';
function renderReviewCloze(word, ex) {
  currentClozeCorrectAnswer = word.thai;
  const blankHTML = '<span class="review-cloze-blank">▢▢▢</span>';
  const thaiParsed = extractLeadingTag(ex.thai || '');
  const sentenceHTML = thaiParsed.rest.split(word.thai).join(blankHTML);
  const vietParsed = extractLeadingTag(ex.viet || '');
  const distractors = buildClozeDistractors(word.thai, 3);
  const options = shuffleArray([word.thai].concat(distractors));
  const choicesHTML = options.map(opt =>
    '<button type="button" class="review-choice-btn review-choice-btn-thaiword" data-correct="' + (opt === word.thai ? '1' : '0') + '">' + opt + '</button>'
  ).join('');
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-cloze-sentence">' + sentenceHTML + '</div>'
    + (ex.viet ? '<button type="button" class="review-cloze-viet-toggle" id="reviewClozeVietToggle" onclick="toggleReviewClozeViet()">Xem bản dịch</button><div class="review-cloze-viet" id="reviewClozeViet" style="display:none">' + vietParsed.rest + '</div>' : '')
    + '<div class="review-choices review-choices-2col" id="reviewChoicesBox">' + choicesHTML + '</div>';
  document.getElementById('reviewChoicesBox').querySelectorAll('.review-choice-btn').forEach(btn => {
    btn.onclick = function() { onReviewClozeChoice(btn); };
  });
}
function toggleReviewClozeViet() {
  const vietEl = document.getElementById('reviewClozeViet');
  const btn = document.getElementById('reviewClozeVietToggle');
  const isHidden = vietEl.style.display === 'none';
  vietEl.style.display = isHidden ? '' : 'none';
  btn.textContent = isHidden ? 'Ẩn bản dịch' : 'Xem bản dịch';
  btn.classList.toggle('open', isHidden);
}
function onReviewClozeChoice(btn) {
  const choicesEl = document.getElementById('reviewChoicesBox');
  choicesEl.querySelectorAll('.review-choice-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === '1') { b.classList.add('correct'); b.insertAdjacentHTML('beforeend', ' <span class="review-choice-feedback-icon">✓</span>'); }
  });
  if (btn.dataset.correct !== '1') { btn.classList.add('incorrect'); btn.insertAdjacentHTML('beforeend', ' <span class="review-choice-feedback-icon">✕</span>'); }
  // Điền đáp án vào TẤT CẢ chỗ trống (từ xuất hiện nhiều lần trong câu thì split() tạo nhiều ô trống, trước đây chỉ điền ô đầu)
  document.querySelectorAll('.review-cloze-sentence .review-cloze-blank').forEach(el => { el.textContent = currentClozeCorrectAnswer; });
  renderReviewSelfCheckInto('reviewAnswerBtns');
}

// 2. FORWARD — cho câu ví dụ tiếng Thái (đủ chữ, không ẩn từ), chọn đúng nghĩa tiếng Việt.
function renderReviewForward(word, ex) {
  const thaiParsed = extractLeadingTag(ex.thai || '');
  const vietParsed = extractLeadingTag(ex.viet || '');
  const correctViet = vietParsed.rest;
  const options = shuffleArray([correctViet].concat(pickSentenceDistractors(word, correctViet, 3)));
  const choicesHTML = options.map(opt =>
    '<button type="button" class="review-choice-btn" data-correct="' + (opt === correctViet ? '1' : '0') + '">' + opt + '</button>'
  ).join('');
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-cloze-sentence">' + thaiParsed.rest + '</div>'
    + '<div class="review-choices" id="reviewChoicesBox">' + choicesHTML + '</div>';
  bindReviewChoiceButtons();
}

// 3. REVERSE — cho nghĩa tiếng Việt, chọn đúng câu ví dụ tiếng Thái (câu nhiễu lấy từ
// reviewDistractorPool — của NHỮNG TỪ KHÁC, tải nền lúc mở Ôn tập).
function renderReviewReverse(word, ex) {
  const thaiParsed = extractLeadingTag(ex.thai || '');
  const vietParsed = extractLeadingTag(ex.viet || '');
  const correctThai = thaiParsed.rest;
  // So sánh bản ĐÃ BỎ thẻ đầu dòng (correctThai là bản đã bỏ thẻ) — trước đây so bản gốc có thẻ nên câu đúng vẫn lọt vào làm đáp án
  // nhiễu, hiện 2 nút giống hệt; đồng thời bỏ các câu nhiễu trùng nhau.
  const seenThai = new Set([correctThai]);
  const distractors = [];
  for (const p of shuffleArray(reviewDistractorPool)) {
    const t = extractLeadingTag(p.thai).rest;
    if (!t || seenThai.has(t)) continue;
    seenThai.add(t); distractors.push(t);
    if (distractors.length >= 3) break;
  }
  const options = shuffleArray([correctThai].concat(distractors));
  const choicesHTML = options.map(opt =>
    '<button type="button" class="review-choice-btn review-choice-btn-thai" data-correct="' + (opt === correctThai ? '1' : '0') + '">' + opt + '</button>'
  ).join('');
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-cloze-viet review-reverse-prompt">' + vietParsed.rest + '</div>'
    + '<div class="review-choices" id="reviewChoicesBox">' + choicesHTML + '</div>';
  bindReviewChoiceButtons();
}

// 4. REORDER — xáo trộn các cụm từ trong câu ví dụ, chạm theo đúng thứ tự để ghép lại câu gốc.
let reviewReorderCorrectOrder = [];
let reviewReorderCurrentPicks = [];
function renderReviewReorder(ex, chunks) {
  reviewReorderCorrectOrder = chunks.slice();
  reviewReorderCurrentPicks = [];
  const poolHTML = shuffleArray(chunks).map((c, idx) =>
    '<button type="button" class="review-reorder-chip" data-idx="' + idx + '" onclick="onReviewReorderPick(this)">' + c + '</button>'
  ).join('');
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-reorder-answer" id="reviewReorderAnswer"></div>'
    + '<div class="review-reorder-pool" id="reviewReorderPool">' + poolHTML + '</div>';
}
function onReviewReorderPick(btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('used');
  reviewReorderCurrentPicks.push(btn.textContent);
  const answerEl = document.getElementById('reviewReorderAnswer');
  const span = document.createElement('span');
  span.className = 'review-reorder-answer-chip';
  span.textContent = btn.textContent;
  answerEl.appendChild(span);
  if (reviewReorderCurrentPicks.length === reviewReorderCorrectOrder.length) {
    const isCorrect = reviewReorderCurrentPicks.join('') === reviewReorderCorrectOrder.join('');
    answerEl.classList.add(isCorrect ? 'correct' : 'incorrect');
    if (!isCorrect) {
      const correctLine = document.createElement('div');
      correctLine.className = 'review-reorder-correct-line';
      correctLine.textContent = 'Câu đúng: ' + reviewReorderCorrectOrder.join('');
      answerEl.insertAdjacentElement('afterend', correctLine);
    }
    renderReviewSelfCheckInto('reviewAnswerBtns');
  }
}

// 5. LISTENING — câu ví dụ tiếng Thái được ẩn, người học BẤM NÚT LOA để nghe (không tự phát), rồi chọn đúng nghĩa tiếng Việt
// (dùng lại speakText() có sẵn, không viết TTS mới).
function renderReviewListening(word, ex) {
  const thaiParsed = extractLeadingTag(ex.thai || '');
  const vietParsed = extractLeadingTag(ex.viet || '');
  const correctViet = vietParsed.rest;
  const options = shuffleArray([correctViet].concat(pickSentenceDistractors(word, correctViet, 3)));
  const choicesHTML = options.map(opt =>
    '<button type="button" class="review-choice-btn" data-correct="' + (opt === correctViet ? '1' : '0') + '">' + opt + '</button>'
  ).join('');
  const safeThai = jsAttrStr(thaiParsed.rest);
  document.getElementById('reviewExerciseArea').innerHTML =
    '<button type="button" class="review-listen-btn" onclick="speakText(\'' + safeThai + '\')" aria-label="Nghe lại">'
    + '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">'
    + '<path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/>'
    + '</svg></button>'
    + '<div class="review-choices" id="reviewChoicesBox">' + choicesHTML + '</div>';
  bindReviewChoiceButtons();
  // KHÔNG tự phát âm — chỉ phát khi người học bấm nút loa (onclick ở trên).
}

// 6. TRUE/FALSE — câu ví dụ + 1 câu khẳng định về nghĩa của từ trong câu (50% đúng/50% sai, câu
// sai lấy nghĩa của 1 từ ngẫu nhiên khác), chọn Đúng/Sai.
function renderReviewTrueFalse(word, def, ex) {
  const thaiParsed = extractLeadingTag(ex.thai || '');
  const correctMeaning = extractLeadingTag(def.viet_meaning || '').rest;
  // Câu SAI lấy nghĩa của từ khác (khác nghĩa đúng). Nếu không tìm được nghĩa nhiễu nào hợp lệ thì BẮT BUỘC dùng câu ĐÚNG —
  // trước đây vẫn gắn nhãn "Sai" cho câu vốn đúng (rơi về correctMeaning), nên trả lời đúng lại bị chấm sai.
  const wrongOptions = pickMeaningDistractors(word.id, 1, correctMeaning);
  const isTrueStatement = wrongOptions.length ? Math.random() < 0.5 : true;
  const statementText = isTrueStatement ? correctMeaning : wrongOptions[0];
  document.getElementById('reviewExerciseArea').innerHTML =
    '<div class="review-cloze-sentence">' + thaiParsed.rest + '</div>'
    + '<div class="review-tf-statement">"' + word.thai + '" trong câu trên nghĩa là "' + statementText + '"</div>'
    + '<div class="review-choices review-choices-2col" id="reviewChoicesBox">'
    + '<button type="button" class="review-choice-btn" data-correct="' + (isTrueStatement ? '1' : '0') + '">Đúng</button>'
    + '<button type="button" class="review-choice-btn" data-correct="' + (isTrueStatement ? '0' : '1') + '">Sai</button>'
    + '</div>';
  bindReviewChoiceButtons();
}

// Khung lật thẻ CŨ — chỉ còn dùng làm PHƯƠNG ÁN DỰ PHÒNG CUỐI CÙNG khi nghĩa không có ví dụ nào
// cả (không đủ dữ liệu cho bất kỳ kiểu bài nào trong 6 kiểu trên).
function renderReviewFlipCard(word, def, defIndex, key) {
  const card = document.getElementById('reviewCard');
  card.classList.remove('flipped');
  reviewFlipped = false;

  // Mặt trước: giống hệt phần đầu khung kết quả tra từ — đủ 4 font tiếng Thái + phiên âm + loa
  // phát âm, KHÔNG hiện nghĩa để giữ đúng tính chất active recall của flashcard.
  const frontEl = document.getElementById('reviewCardFront');
  frontEl.innerHTML =
    '<div class="word-thai-wrap review-front-thaiwrap">' + buildWordFontsHTML(word.thai) + '</div>'
    + (word.phonetic ? '<div class="word-phonetic review-front-phonetic">' + word.phonetic + '</div>' : '')
    + '<button type="button" class="btn-action btn-speak review-front-speak" aria-label="Phát âm" data-tooltip="Phát âm"'
    + ' onclick="event.stopPropagation(); speakText(\'' + jsAttrStr(word.thai) + '\', this)">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">'
    + '<path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/>'
    + '</svg></button>';
  applyWordThaiLayout(frontEl.querySelector('.review-front-thaiwrap'));

  const note = favNotesMap[key] || {};
  let backHTML = '<div class="review-back-content">';
  if (def) {
    if (def.type) backHTML += '<div class="def-type review-back-type">' + formatDefType(def.type) + '</div>';
    const thaiMeaningParsed = extractLeadingTag(def.thai_meaning || '');
    const vietMeaningParsed = extractLeadingTag(def.viet_meaning || '');
    backHTML += buildUsageTagHTML(thaiMeaningParsed.tag, 'def-usage-tag');
    backHTML += '<div class="def-thai-meaning">' + thaiMeaningParsed.rest + '</div>';
    backHTML += buildUsageTagHTML(vietMeaningParsed.tag, 'def-usage-tag');
    backHTML += '<div class="def-viet-meaning">' + vietMeaningParsed.rest + '</div>';
    const examples = def.examples || [];
    backHTML += buildReviewExamplesToggleHTML(examples, word.id, defIndex);
  } else {
    const meaning = (word.meanings || [])[defIndex] || (word.meanings || [])[0] || '';
    const meaningParsed = extractLeadingTag(meaning);
    backHTML += buildUsageTagHTML(meaningParsed.tag, 'def-usage-tag');
    backHTML += '<div class="def-viet-meaning">' + meaningParsed.rest + '</div>';
    const oldExamples = (defIndex === 0) ? (word.examples || []) : [];
    backHTML += buildReviewExamplesToggleHTML(oldExamples, word.id, defIndex);
  }
  if (note.noteDef || note.noteExample) {
    backHTML += '<div class="review-back-note"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> ' + buildNoteInitialHTML(note) + '</div>';
  }
  backHTML += '</div>';
  const backEl = document.getElementById('reviewCardBack');
  backEl.innerHTML = backHTML;
  segmentizeDefsIfEnabled(backEl);
}

// Nút "Xem N ví dụ ▾" ẩn/hiện TOÀN BỘ ví dụ của định nghĩa ở mặt sau flashcard — mặc định ẩn để
// mặt sau gọn, người học có thể tự chọn xem thêm ngữ cảnh (câu ví dụ có phần dịch được bôi đậm ở
// nơi khác trong app) nếu định nghĩa không đủ. Dùng lại buildExItemHTML để đồng bộ giao diện với
// khung kết quả tra từ (số thứ tự, icon video/ghim nếu có).
function buildReviewExamplesToggleHTML(examples, wordId, defIndex) {
  if (!examples || !examples.length) return '';
  return '<button type="button" class="review-ex-toggle-btn" onclick="event.stopPropagation(); toggleReviewExamples(this)"><span class="review-ex-toggle-btn-label">Xem ' + examples.length + ' ví dụ</span><svg class="review-ex-toggle-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'
    + '<div class="review-back-examples" style="display:none" onclick="event.stopPropagation()">'
    + examples.map((ex, idx) => buildExItemHTML(ex, idx, wordId, defIndex, idx)).join('')
    + '</div>';
}

function toggleReviewExamples(btn) {
  const box = btn.nextElementSibling;
  if (!box || !box.classList.contains('review-back-examples')) return;
  const isHidden = box.style.display === 'none';
  box.style.display = isHidden ? '' : 'none';
  btn.classList.toggle('open', isHidden);
  const label = btn.querySelector('.review-ex-toggle-btn-label');
  if (label) label.textContent = isHidden ? 'Ẩn ví dụ' : ('Xem ' + box.children.length + ' ví dụ');
}

function flipReviewCard() {
  const card = document.getElementById('reviewCard');
  reviewFlipped = !reviewFlipped;
  card.classList.toggle('flipped', reviewFlipped);
  document.getElementById('reviewHint').style.display = reviewFlipped ? 'none' : '';
  if (reviewFlipped) renderReviewSelfCheckInto('reviewAnswerBtns');
  else { document.getElementById('reviewAnswerBtns').style.display = 'none'; document.getElementById('reviewAnswerBtns').innerHTML = ''; }
}

// Thanh tự đánh giá mức hiểu (5 icon mặt trăng) — DÙNG CHUNG đúng thang GUESS_MEMORY_LEVELS ở
// trang kết quả tra từ, bơm vào containerId bất kỳ (dùng cho cả 2 luồng: sau khi lật thẻ CŨ lẫn
// sau khi chọn đáp án cloze MỚI) — THAY cho 2 nút Đúng/Sai nhị phân cũ, để cả app chỉ còn 1 ngôn
// ngữ tương tác duy nhất cho việc tự đánh giá. Kèm nút "Không quan tâm" (dùng chung
// onToggleReviewIgnored) — lỡ đang ôn giữa chừng mới nhận ra "cái này mình không cần nhớ" thì
// không cần thoát ra trang tra từ mới tắt được.
function renderReviewSelfCheckInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const curKey = reviewQueue[reviewIndex];
  const isSentence = isSentenceKey(curKey);
  if (isSentence && isEphemeralSentenceKey(curKey)) {
    // Bài tập từ video (thẻ tạm, không SRS): thay thanh tự đánh giá bằng "Lưu vào ôn tập" + "Tiếp tục"
    el.innerHTML = '<div class="review-practice-actions">'
      + '<button type="button" class="review-practice-save" onclick="onPracticeSaveSentence(this)">🔖 Lưu vào ôn tập</button>'
      + '<button type="button" class="review-practice-next" onclick="onPracticeNext()">Tiếp tục →</button>'
      + '</div>';
    el.style.display = 'flex';
    return;
  }
  const segsHTML = GUESS_MEMORY_LEVELS.map(function(l) {
    return '<button type="button" class="def-guess-level-seg" data-level="' + l.level + '" title="' + l.label + '" onclick="onReviewSelfCheckLevel(' + l.level + ')">' + l.emoji + '</button>';
  }).join('');
  el.innerHTML = '<div class="review-selfcheck-titlerow">'
    + '<span class="review-selfcheck-title">' + (isSentence ? 'Bạn hiểu câu này ở mức nào?' : 'Bạn hiểu nghĩa này ở mức nào?') + '</span>'
    + '<button type="button" class="def-guess-ignore-toggle" onclick="onToggleReviewIgnored()">' + (isSentence ? 'Bỏ câu này' : 'Không quan tâm') + '</button>'
    + '</div>'
    + '<div class="def-guess-level-track">' + segsHTML + '</div>';
  el.style.display = 'flex';
}

// Bấm "Không quan tâm" NGAY TRONG Review Mode — set ignored=true cho đúng nghĩa đang ôn (dùng lại
// NGUYÊN setDefIgnored() ở trang kết quả tra từ, không tạo hàm ghi dữ liệu thứ 2), rồi xoá thẳng
// khỏi hàng đợi HIỆN TẠI của phiên (không cần đợi mở lại Review Mode mới thấy biến mất) và chuyển
// sang thẻ tiếp — không cần chọn mức mặt trăng nữa vì nghĩa này không còn được theo dõi.
async function onToggleReviewIgnored() {
  if (reviewAnswerLock) return;
  const key = reviewQueue[reviewIndex];
  if (!key) return;
  reviewAnswerLock = true;
  try { if (isSentenceKey(key)) await setSentenceIgnored(key); else await setDefIgnored(key, true); } catch (e) { reviewAnswerLock = false; throw e; }
  reviewQueue.splice(reviewIndex, 1);
  if (reviewIndex >= reviewQueue.length) {
    buildReviewQueue(); // hết hàng đợi hoặc vừa bỏ thẻ cuối — dựng lại để hiện đúng empty state
  } else {
    renderReviewCard();
  }
}

// Bấm 1 trong 5 icon mặt trăng ở cuối 1 lượt ôn — set thẳng mức đó vào bảng srs_progress (dùng
// lại NGUYÊN setDefSrsLevel() đang chạy cho trang kết quả tra từ, không tạo hàm ghi dữ liệu thứ
// 2), ghi log cho thống kê Learning Bar, ghi nhận kết quả theo KIỂU BÀI vừa làm (để cân bằng độ
// khó các lượt sau, xem pickWeightedExerciseType), rồi chuyển sang thẻ tiếp theo.
async function onReviewSelfCheckLevel(level) {
  if (reviewAnswerLock) return; // đã chấm thẻ này rồi (bấm đúp) — tránh nhảy cách thẻ + ghi SRS/log 2 lần
  const key = reviewQueue[reviewIndex];
  if (!key) return;
  reviewAnswerLock = true;
  if (isSentenceKey(key)) {
    // Thẻ câu từ video: ghi SRS vào kho riêng của thẻ câu (setSentenceSrsLevel), không động tới srs_progress của từ
    const sCard = getSentenceCard(key);
    const reachedSentenceMastery = level === 5 && !!sCard && !isEphemeralSentenceKey(key) && sCard.box !== 5;
    try { await setSentenceSrsLevel(key, level); } catch (e) { reviewAnswerLock = false; throw e; }
    if (!isEphemeralSentenceKey(key)) logSentenceReview(level);
    recordReviewTypeResult(currentReviewExerciseType, level);
    if (reachedSentenceMastery) {
      const sBtn = document.querySelector('#reviewAnswerBtns .def-guess-level-seg[data-level="5"]');
      if (sBtn) sBtn.classList.add('review-mastery-burst');
      setTimeout(nextReviewCard, 550);
    } else {
      nextReviewCard();
    }
    return;
  }
  const { wordId, defIndex } = favKeyParts(key);
  // Vừa LÊN mức Làm chủ (trước đó CHƯA ở mức 5) — bật hiệu ứng ăn mừng ngắn trên đúng icon mặt
  // trăng vừa bấm, trễ chuyển thẻ 1 chút (550ms) để người học kịp thấy, thay vì chuyển ngay lập
  // tức như các mức khác.
  const reachedMastery = level === 5 && !(favSrsMap[key] && favSrsMap[key].box === 5);
  try { await setDefSrsLevel(key, level); } catch (e) { reviewAnswerLock = false; throw e; } // lỗi lưu thì mở khoá để bấm lại
  logSrsReview(wordId, defIndex, level);
  recordReviewTypeResult(currentReviewExerciseType, level);
  if (reachedMastery) {
    const btnEl = document.querySelector('#reviewAnswerBtns .def-guess-level-seg[data-level="5"]');
    if (btnEl) btnEl.classList.add('review-mastery-burst');
    setTimeout(nextReviewCard, 550);
  } else {
    nextReviewCard();
  }
}

function nextReviewCard() {
  reviewIndex++;
  if (reviewIndex >= reviewQueue.length) {
    if (reviewPracticeMode) { showPracticeDone(); return; } // bài tập từ video: hết câu là xong, không dựng lại hàng đợi
    buildReviewQueue(); // hết lượt -> tính lại hàng đợi (thường sẽ trống nếu vừa ôn xong các từ đến hạn)
  } else {
    renderReviewCard();
  }
}

// ── RECENT (Lịch sử tra từ) ───────────────────────────
// Mỗi bản ghi: { id, ts, pinned, count } — "count" là số lần đã tra từ này (hiển thị dạng "x8"
// bên cạnh thời gian, xem renderRecentRowDropdown()), tăng dần mỗi lần addRecent() gặp lại đúng
// từ đã có trong lịch sử thay vì tạo bản ghi mới.
function saveRecent() {
  // Chỉ dùng localStorage khi chưa đăng nhập; khi đã đăng nhập, dữ liệu ghi thẳng lên Supabase
  // ngay tại nơi thay đổi (addRecent/pinRecent/...), hàm này không làm gì trong trường hợp đó.
  if (!isLoggedIn()) localStorage.setItem('thai_recent', JSON.stringify(recentSearches));
}

async function addRecent(word) {
  const ts = Date.now();
  const existing = recentSearches.find(r => r.id === word.id);
  const pinned = existing ? existing.pinned : false;
  const count = existing ? (existing.count || 1) + 1 : 1;
  if (existing) {
    // Đã tra rồi: không tạo bản ghi mới, chỉ cập nhật thời gian + tăng số lần tra rồi đưa lên đầu
    existing.ts = ts;
    existing.count = count;
    recentSearches = [existing, ...recentSearches.filter(r => r.id !== word.id)];
  } else {
    recentSearches = [{ id: word.id, ts, pinned: false, count: 1 }, ...recentSearches];
  }
  // Giới hạn tổng số bản ghi lưu trữ (giữ ghim ưu tiên, không giới hạn quá chặt để còn dùng cho trang "Xem tất cả")
  if (recentSearches.length > 200) {
    const pinned2 = recentSearches.filter(r => r.pinned);
    const rest = recentSearches.filter(r => !r.pinned).slice(0, 200 - pinned2.length);
    recentSearches = [...pinned2, ...rest].sort((a,b) => b.ts - a.ts);
  }
  if (isLoggedIn()) {
    try {
      await sbPostAuth('search_history', { user_id: session.user.id, word_id: word.id, ts, pinned, count }, 'user_id,word_id');
    } catch (e) { /* giữ trạng thái local, thử lại lần sau */ }
  } else {
    saveRecent();
  }
  updateStats();
  renderRecent();
}

async function pinRecent(id, event) {
  if (event) event.stopPropagation();
  const rec = recentSearches.find(r => r.id === id);
  if (!rec) return;
  rec.pinned = !rec.pinned;
  if (isLoggedIn()) {
    try { await sbPatchAuth('search_history?user_id=eq.' + session.user.id + '&word_id=eq.' + id, { pinned: rec.pinned }); }
    catch (e) {}
  } else {
    saveRecent();
  }
  renderRecent();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  renderRecentDropdown();
}

async function removeRecentItem(id, event) {
  if (event) event.stopPropagation();
  const removed = recentSearches.find(r => r.id === id);
  recentSearches = recentSearches.filter(r => r.id !== id);
  if (isLoggedIn()) {
    try { await sbDeleteAuth('search_history?user_id=eq.' + session.user.id + '&word_id=eq.' + id); }
    catch (e) {}
  } else {
    saveRecent();
  }
  updateStats();
  renderRecent();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  renderRecentDropdown();
  if (removed) showUndoToast('Đã xóa khỏi lịch sử', () => restoreRemovedRecentItems([removed]));
}

// Khôi phục lại các bản ghi lịch sử vừa xóa (dùng cho nút "Hoàn tác" trong toast) — chỉ khôi
// phục những từ CHƯA có bản ghi mới hơn (phòng trường hợp người dùng tra lại đúng từ đó trong lúc
// toast còn hiện, tránh đè lên bản ghi mới).
async function restoreRemovedRecentItems(removedRecords) {
  const toRestore = removedRecords.filter(r => !recentSearches.some(x => x.id === r.id));
  if (!toRestore.length) return;
  recentSearches = [...toRestore, ...recentSearches];
  if (isLoggedIn()) {
    await Promise.all(toRestore.map(r =>
      sbPostAuth('search_history', { user_id: session.user.id, word_id: r.id, ts: r.ts, pinned: !!r.pinned, count: r.count || 1 }, 'user_id,word_id').catch(() => {})
    ));
  } else {
    saveRecent();
  }
  updateStats();
  renderRecent();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  renderRecentDropdown();
}

async function clearAllRecent() {
  if (!recentSearches.length) return;
  if (!confirm('Xóa toàn bộ lịch sử tra từ? (các từ đã ghim cũng sẽ bị xóa)')) return;
  recentSearches = [];
  if (isLoggedIn()) {
    try { await sbDeleteAuth('search_history?user_id=eq.' + session.user.id); }
    catch (e) {}
  } else {
    saveRecent();
  }
  updateStats();
  renderRecent();
  // Reset chip filter về "Tất cả" + xóa ô tìm kiếm — sau khi xóa sạch, để lại 1 chip/ô lọc cũ sẽ
  // hiện nhầm "Không tìm thấy từ phù hợp" thay vì đúng "Bạn chưa tra từ nào".
  historyActiveFilter = 'all';
  historySortMode = 'recent';
  historySelectMode = false;
  historySelectedIds.clear();
  document.querySelectorAll('.hist-filter-chip').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  syncHistorySortUi();
  const inputEl = document.getElementById('historySearchInput');
  if (inputEl) inputEl.value = '';
  renderRecentFullList();
  renderRecentDropdown();
  updateHistorySelectToolbar();
}

// ── CHỌN NHIỀU (bulk actions) trong tab "Lịch sử" ──────
let historySelectMode = false;
let historySelectedIds = new Set();

function toggleHistorySelectMode() {
  historySelectMode = !historySelectMode;
  historySelectedIds.clear();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  updateHistorySelectToolbar();
}

function toggleHistorySelectItem(id) {
  if (historySelectedIds.has(id)) historySelectedIds.delete(id); else historySelectedIds.add(id);
  const cb = document.querySelector('.hist-select-checkbox[data-id="' + id + '"]');
  if (cb) cb.checked = historySelectedIds.has(id);
  updateHistorySelectToolbar();
}

// Chọn tất cả các dòng ĐANG hiển thị trên màn hình (đã áp dụng tìm kiếm/chip filter/sắp xếp) —
// lấy trực tiếp từ checkbox trong DOM thay vì tính lại logic lọc, đảm bảo luôn khớp đúng những gì
// người dùng đang thấy.
function historySelectAllVisible() {
  document.querySelectorAll('.hist-select-checkbox').forEach(cb => {
    historySelectedIds.add(parseInt(cb.dataset.id, 10));
    cb.checked = true;
  });
  updateHistorySelectToolbar();
}

function updateHistorySelectToolbar() {
  const bar = document.getElementById('histSelectToolbar');
  const toggleBtn = document.getElementById('histSelectToggleBtn');
  if (toggleBtn) toggleBtn.textContent = historySelectMode ? 'Hủy chọn' : 'Chọn nhiều';
  if (!bar) return;
  bar.style.display = historySelectMode ? 'flex' : 'none';
  const n = historySelectedIds.size;
  const countEl = document.getElementById('histSelectCount');
  if (countEl) countEl.textContent = n + ' đã chọn';
  const saveBtn = document.getElementById('histSelectSaveBtn');
  const delBtn = document.getElementById('histSelectDeleteBtn');
  if (saveBtn) saveBtn.disabled = n === 0;
  if (delBtn) delBtn.disabled = n === 0;
}

async function historySelectedDeleteBulk() {
  const ids = [...historySelectedIds];
  if (!ids.length) return;
  if (!confirm('Xóa ' + ids.length + ' từ đã chọn khỏi lịch sử?')) return;
  const removedRecords = recentSearches.filter(r => ids.includes(r.id));
  recentSearches = recentSearches.filter(r => !ids.includes(r.id));
  if (isLoggedIn()) {
    try { await sbDeleteAuth('search_history?user_id=eq.' + session.user.id + '&word_id=in.(' + ids.join(',') + ')'); }
    catch (e) {}
  } else {
    saveRecent();
  }
  historySelectMode = false;
  historySelectedIds.clear();
  updateStats();
  renderRecent();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
  renderRecentDropdown();
  showUndoToast('Đã xóa ' + removedRecords.length + ' từ khỏi lịch sử', () => restoreRemovedRecentItems(removedRecords));
}

function historySelectedSaveBulk() {
  const ids = [...historySelectedIds];
  if (!ids.length) return;
  openFavFolderPickerBulk(ids);
}

// Sắp xếp: ghim lên đầu (theo thời gian ghim/tra gần nhất), sau đó theo thời gian tra gần nhất
function sortedRecent() {
  return [...recentSearches].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.ts - a.ts;
  });
}

function formatRecentTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return min + ' phút trước';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' giờ trước';
  const day = Math.floor(hr / 24);
  if (day < 7) return day + ' ngày trước';
  const d = new Date(ts);
  return d.toLocaleDateString('vi-VN');
}

// Dòng hiển thị 1 từ trong lịch sử: chỉ từ + phiên âm + loa + tim (không hiển thị nghĩa)
// Dòng lịch sử — dùng chung cho cả dropdown (hover ô search) lẫn trang "Xem tất cả":
// icon đồng hồ đầu dòng, từ + phiên âm, giờ tra (+ "· x{count}" nếu đã tra từ này ≥2 lần — ẩn khi
// chỉ tra 1 lần để đỡ rườm rà), rồi 3 icon: phát âm / ghim (pin rỗng→đầy) / xóa
// "compact=true" (dropdown gợi ý nhỏ khi hover ô search) ẩn gợi ý "Thêm vào ôn tập?" bên dưới để
// đỡ chiếm chỗ — gợi ý này chỉ hiện ở tab "Lịch sử" đầy đủ trong Thư viện.
// "selectMode=true" (chế độ "Chọn nhiều" ở tab Lịch sử) thêm checkbox đầu dòng, bấm vào dòng để
// chọn/bỏ chọn thay vì mở từ.
function renderRecentRowDropdown(w, rec, compact, selectMode) {
  const savedDefCount = favorites.filter(k => k.startsWith(w.id + ':')).length; // số nghĩa đã lưu
  const hasMultipleDefs = (w.definitions || []).length > 1; // chỉ hiện số khi từ có ≥2 nghĩa
  const suggestReview = !compact && rec.count >= 3 && savedDefCount === 0;
  const rowClick = selectMode ? `toggleHistorySelectItem(${w.id})` : `goToWord(${w.id})`;
  const checked = historySelectedIds.has(w.id);
  return `
    <div class="ac-item ${selectMode ? 'hist-select-mode' : ''}" onclick="${rowClick}">
      ${selectMode ? `<input type="checkbox" class="hist-select-checkbox" data-id="${w.id}" ${checked ? 'checked' : ''} onclick="event.stopPropagation(); toggleHistorySelectItem(${w.id})">` : ''}
      <svg class="hist-clock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>
      </svg>
      <div class="ac-main">
        <div class="ac-thai">${w.thai}</div>
        <div class="ac-phonetic">${w.phonetic || ''}</div>
      </div>
      <div class="recent-hist-time">${formatRecentTime(rec.ts)}${rec.count > 1 ? ' · x' + rec.count : ''}</div>
      <div class="ac-actions">
        <button class="recent-hist-icon-btn" title="Phát âm" onclick="event.stopPropagation(); speakText('${w.thai}', this)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>
        </button>
        ${savedDefCount > 0 ? `
        <span class="recent-hist-bookmark-badge-wrap" title="Đã lưu${hasMultipleDefs ? ' ' + savedDefCount + '/' + (w.definitions || []).length + ' nghĩa' : ''}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21l-6-4-6 4V3.5z"/>
          </svg>
          ${hasMultipleDefs ? `<span class="recent-hist-bookmark-count">${savedDefCount}</span>` : ''}
        </span>` : ''}
        <button class="recent-hist-icon-btn ${rec.pinned ? 'active' : ''}" title="${rec.pinned ? 'Bỏ ghim' : 'Ghim từ này'}" onclick="pinRecent(${w.id}, event)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${rec.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 10.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.5l2 2.5a1 1 0 0 1-.8 1.6H7.8a1 1 0 0 1-.8-1.6z"/>
            <path d="M12 17v5"/>
          </svg>
        </button>
        <button class="recent-hist-icon-btn" title="Xóa khỏi lịch sử" onclick="removeRecentItem(${w.id}, event)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    ${suggestReview ? `<button type="button" class="hist-review-suggest" onclick="event.stopPropagation(); openFavFolderPicker(${w.id}, 0, this)">➕ Thêm vào ôn tập?</button>` : ''}
  `;
}


// Trang chủ: khối "Đã tra gần đây" (giữ nguyên vị trí cũ, hiển thị gọn)
// (Khối "Đã tra gần đây" trên trang chủ đã bị bỏ; renderRecent() giờ chỉ cập nhật dropdown lịch sử)
function renderRecent() {
  renderRecentDropdown();
}

// Dropdown hiện khi hover vào ô search: 15 từ gần nhất + nút "Xem tất cả"
// Áp dụng cho cả thanh search thân trang lẫn thanh search trên header
function renderRecentDropdown() {
  const dropdownIds = ['searchHistoryDropdown', 'headerSearchHistoryDropdown'];
  const list = sortedRecent();
  const items = list.map(r => ({ w: allWords.find(w => w.id === r.id), r })).filter(x => x.w);

  let html;
  if (!items.length) {
    html = '<div class="search-hist-empty">Chưa có từ nào được tra gần đây</div>';
  } else {
    const top15 = items.slice(0, 15);
    html = `
      <div class="search-hist-list">
        ${top15.map(x => renderRecentRowDropdown(x.w, x.r, true)).join('')}
      </div>
      <div class="search-hist-footer">
        <button class="search-hist-viewall" onclick="showPage('history'); event.stopPropagation()">Xem tất cả (${items.length})</button>
        <button class="search-hist-clear" onclick="clearAllRecent(); event.stopPropagation()">Xóa tất cả</button>
      </div>
    `;
  }

  dropdownIds.forEach(id => {
    const dropdown = document.getElementById(id);
    if (dropdown) dropdown.innerHTML = html;
  });
}

let historyActiveFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'pinned' —
// chip filter đang chọn trong tab "Lịch sử" (Thư viện), xem setHistoryFilter() + .hist-filter-row
let historySortMode = 'recent'; // 'recent' | 'count' | 'az' — xem setHistorySort()

const HISTORY_SORT_LABELS = { recent: 'Mới nhất', count: 'Tra nhiều nhất', az: 'A-Z' };
// Đặt nhãn + mục đang chọn của dropdown sắp xếp Lịch sử (thay <select> gốc, dùng chung kiểu .fav-sort-*).
function syncHistorySortUi() {
  const labelEl = document.getElementById('histSortBtnLabel');
  if (labelEl) labelEl.textContent = HISTORY_SORT_LABELS[historySortMode] || HISTORY_SORT_LABELS.recent;
  document.querySelectorAll('#histSortMenu .fav-sort-item').forEach((b, i) => b.classList.toggle('active', Object.keys(HISTORY_SORT_LABELS)[i] === historySortMode));
}
function toggleHistorySortMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('histSortMenu');
  const willOpen = menu.hidden;
  closeHistoryMenus();
  menu.hidden = !willOpen;
  document.getElementById('histSortBtn').setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
// Menu "⋯" cạnh ô tìm kiếm: gom "Chọn nhiều" và "Xóa tất cả" (trước đây là 2 nút luôn hiện ở đầu tab).
function toggleHistoryMoreMenu(ev) {
  if (ev) ev.stopPropagation();
  const menu = document.getElementById('histMoreMenu');
  const willOpen = menu.hidden;
  closeHistoryMenus();
  menu.hidden = !willOpen;
  document.getElementById('histMoreBtn').setAttribute('aria-expanded', willOpen ? 'true' : 'false');
}
function closeHistoryMenus() {
  ['histSortMenu', 'histMoreMenu'].forEach(id => { const m = document.getElementById(id); if (m) m.hidden = true; });
  ['histSortBtn', 'histMoreBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', 'false'); });
}
document.addEventListener('click', e => {
  if (!e.target.closest('#histSortWrap') && !e.target.closest('#histMoreWrap')) closeHistoryMenus();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHistoryMenus(); });
function setHistorySort(mode) {
  closeHistoryMenus();
  historySortMode = mode;
  syncHistorySortUi();
  renderRecentFullList(document.getElementById('historySearchInput') ? document.getElementById('historySearchInput').value : '');
}

// Thống kê nhỏ ngay dưới lời giới thiệu tab "Lịch sử" — luôn tính trên TOÀN BỘ lịch sử, không
// phụ thuộc ô tìm kiếm/chip filter đang chọn bên dưới (đây là tổng quan chung, không phải kết
// quả đã lọc). "Đã lưu" = từ có ít nhất 1 nghĩa nằm trong danh sách yêu thích (favorites).
function renderHistoryStats() {
  const el = document.getElementById('histStatsRow');
  if (!el) return;
  const items = sortedRecent().map(r => ({ w: allWords.find(w => w.id === r.id), r })).filter(x => x.w);
  if (!items.length) { el.innerHTML = ''; return; }

  const total = items.length;
  const todayCount = items.filter(x => getHistoryDateBucket(x.r.ts) === 'today').length;
  const savedCount = items.filter(x => favorites.some(k => k.startsWith(x.w.id + ':'))).length;
  const notSavedCount = total - savedCount;

  el.innerHTML =
    `<span><span class="hist-stat-total">${total}</span> từ đã tra</span>` +
    `<span class="hist-stat-sep">·</span><span>${todayCount} từ hôm nay</span>` +
    `<span class="hist-stat-sep">·</span><span>${savedCount} từ đã lưu</span>` +
    `<span class="hist-stat-sep">·</span><span>${notSavedCount} từ chưa lưu</span>`;
}

// Nhắc ôn lại — từ ĐÃ LƯU (có trong favorites) nhưng đã lâu (>30 ngày) không tra lại (r.ts = lần
// tra GẦN NHẤT). Chỉ hiện khi có ít nhất 1 từ như vậy. Bấm "Ôn ngay" mở thẳng Review Mode toàn
// màn hình (tách riêng khỏi Sổ tay, xem openReviewMode() — ôn TẤT CẢ nghĩa đang đến hạn nói
// chung, không lọc riêng theo tiêu chí "lâu chưa tra", nhắc ở đây chỉ để gợi ý người dùng NHỚ
// quay lại ôn).
const HISTORY_STALE_DAYS = 30;
function renderHistoryStaleReminder() {
  const el = document.getElementById('histStaleReminder');
  if (!el) return;
  const threshold = HISTORY_STALE_DAYS * 86400000;
  const now = Date.now();
  const staleCount = recentSearches.filter(r =>
    favorites.some(k => k.startsWith(r.id + ':')) && (now - r.ts) > threshold
  ).length;
  if (!staleCount) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.innerHTML =
    `<span>🔔 ${staleCount} từ đã lưu nhưng hơn ${HISTORY_STALE_DAYS} ngày chưa tra lại</span>` +
    `<button type="button" class="hist-stale-review-btn" onclick="openReviewMode()">Ôn ngay</button>`;
}

function renderHistoryTopWords() {
  const wrap = document.getElementById('histTopWordsWrap');
  const el = document.getElementById('histTopWords');
  if (!el || !wrap) return;
  const items = recentSearches
    .map(r => ({ w: allWords.find(w => w.id === r.id), r }))
    .filter(x => x.w && x.r.count > 1)
    .sort((a, b) => b.r.count - a.r.count)
    .slice(0, 5);
  if (!items.length) { wrap.style.display = 'none'; el.innerHTML = ''; return; }
  wrap.style.display = '';
  el.innerHTML = items.map(x =>
    `<button type="button" class="hist-top-word-chip" onclick="goToWord(${x.w.id})">${escapeHtml(x.w.thai)} <span class="hist-top-word-count">x${x.r.count}</span></button>`
  ).join('');
}

// Trang "Xem tất cả" lịch sử: có ô tìm kiếm trong lịch sử
function renderRecentFullList(query) {
  renderHistoryStats();
  renderHistoryStaleReminder();
  renderHistoryTopWords();
  const el = document.getElementById('historyFullList');
  if (!el) return;
  query = (query || '').trim().toLowerCase();
  let list = sortedRecent();
  let items = list.map(r => ({ w: allWords.find(w => w.id === r.id), r })).filter(x => x.w);

  if (query) {
    items = items.filter(x =>
      x.w.thai.includes(query) ||
      (x.w.phonetic && x.w.phonetic.toLowerCase().includes(query)) ||
      (x.w.meanings || []).some(m => m.toLowerCase().includes(query))
    );
  }

  // Áp dụng chip filter (kết hợp thêm với ô tìm kiếm ở trên, không thay thế)
  if (historyActiveFilter === 'pinned') {
    items = items.filter(x => x.r.pinned);
  } else if (historyActiveFilter !== 'all') {
    items = items.filter(x => getHistoryDateBucket(x.r.ts) === historyActiveFilter);
  }

  // Áp dụng sắp xếp khi khác mặc định "Mới nhất" (mặc định giữ nguyên thứ tự sortedRecent() —
  // ghim trước, mới nhất trước). Luôn giữ ghim lên đầu bất kể chế độ sắp xếp nào.
  if (historySortMode !== 'recent') {
    items = items.slice().sort((a, b) => {
      if (a.r.pinned !== b.r.pinned) return a.r.pinned ? -1 : 1;
      if (historySortMode === 'count') return (b.r.count || 1) - (a.r.count || 1);
      if (historySortMode === 'az') return a.w.thai.localeCompare(b.w.thai, 'th');
      return b.r.ts - a.r.ts;
    });
  }

  const isFiltering = !!query || historyActiveFilter !== 'all';
  const skipGrouping = isFiltering || historySortMode !== 'recent';

  if (!items.length) {
    el.innerHTML = isFiltering
      ? '<div class="fav-empty">Không tìm thấy từ phù hợp</div>'
      : '<div class="fav-empty">Bạn chưa tra từ nào<br>Bắt đầu <button type="button" class="history-empty-qmark-btn" onclick="goToWordSearchFocus()" aria-label="Tra từ nhanh" title="Tra từ nhanh"><span class="spotlight-fab-qmark">?</span></button> từ đầu tiên</div>';
    return;
  }

  // Đang lọc/sắp xếp khác mặc định: giữ danh sách phẳng (không nhóm theo ngày) — nhóm chỉ hợp lý
  // khi đang xem đúng thứ tự thời gian mặc định.
  if (skipGrouping) {
    el.innerHTML = items.map(x => renderRecentRowDropdown(x.w, x.r, false, historySelectMode)).join('');
    return;
  }

  // Không lọc: nhóm theo thời gian tra — mục đã ghim tách riêng lên đầu (không phụ thuộc ngày,
  // giữ đúng hành vi "ghim luôn nổi lên trên" như trước), phần còn lại nhóm theo Hôm nay/Hôm qua/
  // Tuần này/Tháng này/Cũ hơn (xem getHistoryDateBucket()).
  const pinnedItems = items.filter(x => x.r.pinned);
  const restItems = items.filter(x => !x.r.pinned);
  const buckets = [
    { key: 'today', label: 'Hôm nay', items: [] },
    { key: 'yesterday', label: 'Hôm qua', items: [] },
    { key: 'week', label: 'Tuần này', items: [] },
    { key: 'month', label: 'Tháng này', items: [] },
    { key: 'older', label: 'Cũ hơn', items: [] }
  ];
  restItems.forEach(x => {
    const bucket = buckets.find(b => b.key === getHistoryDateBucket(x.r.ts)) || buckets[buckets.length - 1];
    bucket.items.push(x);
  });

  let html = '';
  if (pinnedItems.length) {
    html += '<div class="hist-date-group-label">📌 Đã ghim</div>' + pinnedItems.map(x => renderRecentRowDropdown(x.w, x.r, false, historySelectMode)).join('');
  }
  buckets.forEach(b => {
    if (!b.items.length) return;
    html += '<div class="hist-date-group-label">' + b.label + '</div>' + b.items.map(x => renderRecentRowDropdown(x.w, x.r, false, historySelectMode)).join('');
  });
  el.innerHTML = html;
}

// Đổi chip filter đang chọn trong tab "Lịch sử" (giữ nguyên nội dung ô tìm kiếm, chỉ thêm điều
// kiện lọc theo thời gian/ghim bên cạnh) rồi render lại danh sách.
function setHistoryFilter(filter) {
  historyActiveFilter = filter;
  document.querySelectorAll('.hist-filter-chip').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  const inputEl = document.getElementById('historySearchInput');
  renderRecentFullList(inputEl ? inputEl.value : '');
}

// Xác định 1 mốc thời gian (ts, mili-giây) thuộc nhóm ngày nào — dùng cho tab "Lịch sử" (Thư
// viện) khi KHÔNG lọc theo từ khóa. So sánh theo NGÀY LỊCH (giờ địa phương máy người dùng), không
// phải khoảng cách 24h/7 ngày/30 ngày cứng — vd tra lúc 23h50 hôm qua và 00h10 hôm nay vẫn tính
// đúng là "Hôm qua"/"Hôm nay" dù cách nhau chỉ 20 phút. "Tuần này" tính từ thứ Hai của tuần hiện
// tại (quy ước phổ biến ở VN), "Tháng này" là phần còn lại trong cùng tháng dương lịch.
function getHistoryDateBucket(ts) {
  const dayMs = 86400000;
  const now = new Date();
  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const todayStart = startOfDay(now);
  const itemStart = startOfDay(new Date(ts));

  if (itemStart === todayStart) return 'today';
  if (itemStart === todayStart - dayMs) return 'yesterday';

  const dow = now.getDay() === 0 ? 7 : now.getDay(); // 1=Thứ 2 ... 7=Chủ nhật
  const mondayStart = todayStart - (dow - 1) * dayMs;
  if (itemStart >= mondayStart) return 'week';

  const d = new Date(ts);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'month';

  return 'older';
}

function onHistorySearch(val) {
  renderRecentFullList(val);
}

// ── WOD ───────────────────────────────────────────────
function initWOD() {
  // WOD replaced by quote - no-op
}

// ── PAGES ─────────────────────────────────────────────
function showPage(name) {
  // Lịch sử tra từ không còn là trang riêng (#page-history đã bị xóa) — giờ là tab thứ 3 nằm
  // cùng hàng với Sổ tay/Khám phá trong trang Thư viện (xem .fav-tabs). Giữ nguyên mọi nơi gọi
  // showPage('history') trong app.js (nút "Xem tất cả" ở dropdown lịch sử, nút Lịch sử ở menu
  // dọc...) bằng cách chuyển hướng ngay tại đây, không cần sửa từng chỗ gọi.
  if (name === 'history') { showPage('favorites'); switchFavTab('history'); return; }
  // Bảo vệ: nếu "name" không khớp #page-<name> nào (gõ sai/gọi nhầm tên trang không tồn tại, vd
  // "review" — Ôn tập giờ là Review Mode toàn màn hình riêng, không phải trang, xem
  // openReviewMode()), dừng lại ở đây và báo lỗi ra console thay vì tiếp tục ẩn hết .page rồi
  // crash ngay bước kế — trước đây lỗi này khiến CẢ TRANG BỊ TRẮNG XOÁ không cách nào phục hồi
  // (mọi .page đã bị remove class "active" nhưng trang đích lại không tồn tại để add lại).
  if (!document.getElementById('page-' + name)) {
    console.error('showPage: không tìm thấy #page-' + name);
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  // .main chỉ bọc riêng #page-home (xem ghi chú cấu trúc trong style.css) — nhưng bản thân .main
  // KHÔNG phải .page nên không tự ẩn qua rule ".page{display:none}" ở trên. Trước đây .main luôn
  // hiện (kể cả khi #page-home đang ẩn bên trong), khiến nó lộ ra như 1 khung trắng rỗng ở các
  // trang khác (rõ nhất ở trang Admin — không có class "layout-with-sidebar" để lách qua rule ẩn
  // .main, nên bị lộ y hệt "vệt trắng ở đầu trang"). Ẩn/hiện .main tường minh ở đây cho MỌI trang,
  // không chỉ riêng Yêu thích/Lịch sử, để không còn trường hợp lọt lưới nào nữa.
  const mainEl = document.querySelector('.main');
  if (mainEl) mainEl.style.display = (name === 'home') ? '' : 'none';
  // update nav active state by id (cả nav-btn cũ lẫn side-nav-btn mới trong thanh menu dọc)
  document.querySelectorAll('.nav-btn, .side-nav-btn').forEach(b => {
    const onclick = b.getAttribute('onclick') || '';
    const match = onclick.match(/showPage\('(\w+)'\)/);
    if (match) b.classList.toggle('active', match[1] === name);
  });
  if (typeof closeSideMenu === 'function') closeSideMenu();
  // Điều hướng sang trang khác thì đóng Spotlight nếu đang mở (đã chọn xong việc cần tra).
  if (typeof closeSpotlight === 'function') closeSpotlight();
  if (typeof closeHomeInfoPopup === 'function') closeHomeInfoPopup();
  // Sidebar phải (chỗ trống dành cho sau này: quảng cáo/game/quiz) — CHỈ áp dụng các trang không
  // phải Trang chủ/Admin (vd Yêu thích, Lịch sử), và chỉ ở màn hình rộng (xem @media trong
  // style.css).
  const contentRow = document.querySelector('.content-row');
  const sidebarAllowedPage = (name !== 'admin' && name !== 'home');
  if (contentRow) contentRow.classList.toggle('layout-with-sidebar', sidebarAllowedPage);
  if (name === 'favorites') {
    renderFavorites();
    if (favActiveTab === 'community') loadWlistSegment();
    else if (favActiveTab === 'history') renderRecentFullList();
    else if (favActiveTab === 'review') openReviewPage();
  }
  if (name === 'admin') {
    updateStats();
    // Lõi CRUD từ (modules/admin-core.js) + quản trị widget thời tiết/tỷ giá/món ăn
    // (modules/widgets.js) + Font Challenge/góp ý/đề xuất/người dùng (modules/admin-extra.js)
    // chỉ tải khi vào trang admin lần đầu trong phiên, không nằm sẵn trong app.js nữa —
    // renderAdminList/loadCurrencyExampleAdmin/loadAllFontChallengesAdmin...
    // chỉ tồn tại sau khi các module này tải xong nên phải đợi rồi mới gọi.
    Promise.all([loadAdminCoreModule(), loadWidgetsModule(), loadAdminExtraModule(), wordsLoadedPromise]).then(function() {
      renderAdminList(allWords);
      loadCurrencyExampleAdmin();
      loadFoodAdmin();
      loadAllFontChallengesAdmin();
      loadFeedbackAdmin();
      loadSuggestionsAdmin();
      loadNoResultSearchesAdmin();
      loadUsersAdmin();
      loadSentenceBankAdmin();
    });
    // Đổ nội dung đã lưu vào 2 khối: câu chào chính (dòng to, admin tự nhập) + tagline theo
    // khung giờ (dòng nhỏ) — lấy từ dữ liệu đã lưu (siteSettingsState), không lấy từ DOM vì DOM
    // có thể đang hiển thị câu chào đang random ra chứ không phải đúng danh sách đã lưu.
    populateHeroGreetingInputs();
    populateGreetingInputs();
    populateFontDifficultyAdminInputs();
  }
}

// ── NÚT "THÔNG TIN NHANH" TRONG SIDE-MENU (thời tiết/tỷ giá/món ăn gộp 1 nút) ───────
// Bấm nút mở popup flyout cạnh nút, có 3 tab nhỏ để chuyển đổi nội dung, tái dùng nguyên
// nội dung/hàm render cũ của 3 card trước đây (chỉ đổi chỗ hiển thị, không đổi cách tải dữ liệu).
var homeInfoActiveKey = null;

function closeHomeInfoPopup() {
  const popup = document.getElementById('homeInfoPopup');
  if (popup) popup.classList.remove('show');
  document.querySelectorAll('.home-info-tab').forEach(b => b.classList.remove('active'));
}

// Nút chính trong side-menu (drawer mobile): bấm để mở/đóng popup (giữ tab đã xem gần nhất,
// mặc định thời tiết). openHomeInfoPopup + dữ liệu thời tiết/tỷ giá/món ăn nằm trong
// modules/widgets.js (lazy-load) — chỉ tải về (và chỉ gọi API thời tiết/tỷ giá lần đầu) khi bấm
// nút này hoặc 1 trong 3 mục ở .top-info-bar lần đầu tiên trong phiên.
async function toggleHomeInfoNav() {
  const popup = document.getElementById('homeInfoPopup');
  if (popup && popup.classList.contains('show')) { closeHomeInfoPopup(); return; }
  await loadWidgetsModule();
  openHomeInfoPopup(homeInfoActiveKey || 'weather');
}

// 3 mục thời tiết/tỷ giá/món ăn ở thanh header ngang (.top-info-bar, desktop/tablet) — mỗi mục
// LUÔN mở thẳng đúng tab đó (không toggle đóng như nút gộp trong drawer mobile ở trên), vì giờ
// là 3 điểm vào riêng biệt chứ không phải 1 nút duy nhất.
async function openTopInfoWidget(kind) {
  await loadWidgetsModule();
  openHomeInfoPopup(kind);
  positionTopInfoPopup();
}

// #homeInfoPopup nằm ở cấp <body> (không lồng trong .top-info-bar — xem lý do trong comment HTML
// tại vị trí popup), nên KHÔNG còn mốc position:relative để tự đổ xuống đúng chỗ bằng CSS thuần
// như trước — tính toán tay bằng JS mỗi lần mở, đặt popup ngay dưới nhóm 3 mục
// (#topInfoWidgetsWrap), căn theo mép phải của nhóm đó (để không tràn ra ngoài màn hình bên
// phải với các màn hình hẹp hơn). CHỈ áp dụng ở desktop/tablet (≥641px) — mobile đã có CSS riêng
// (position:fixed, cố định giữa màn hình, xem @media max-width:640px trong style.css) tự lo,
// không cần/không nên ghi đè bằng toạ độ tính ở đây.
function positionTopInfoPopup() {
  // Không còn định vị bằng JS: popup tiện ích giờ là .modal-overlay căn giữa màn hình bằng CSS (giống popup lịch).
  // Giữ lại hàm rỗng vì openTopInfoWidget() và listener 'resize' bên dưới vẫn gọi tới.
}
window.addEventListener('resize', function() {
  const popup = document.getElementById('homeInfoPopup');
  if (popup && popup.classList.contains('show')) positionTopInfoPopup();
});

document.addEventListener('click', function(e) {
  const popup = document.getElementById('homeInfoPopup');
  if (!popup || !popup.classList.contains('show')) return;
  // .home-info-trigger: dùng chung cho CẢ nút gộp trong drawer mobile (#homeInfoNavBtn) LẪN 3
  // nút riêng ở .top-info-bar — bấm bất kỳ nút nào trong số này không được tính là "click ra
  // ngoài" (tránh vừa mở lại vừa tự đóng ngay trong cùng 1 lượt bấm).
  if (popup.contains(e.target) || e.target.closest('.home-info-trigger')) return;
  closeHomeInfoPopup();
});

// ── SUBMENU "THÔNG TIN" (About/Contact/Privacy/Terms/Cookie) — flyout lồng trong dropdown hồ sơ,
// giống kiểu menu con của Canva, thay cho popup toàn trang trước đây.
function toggleInfoSubmenu(e) {
  if (e) e.stopPropagation();
  const sub = document.getElementById('infoSubmenu');
  if (sub) sub.classList.toggle('show');
}
function closeInfoSubmenu() {
  const sub = document.getElementById('infoSubmenu');
  if (sub) sub.classList.remove('show');
}

// ── MENU "CÔNG CỤ FONT CHỮ" (Font Challenge) — gộp 2 lối vào cũ (Luyện theo font cụ thể/Xem chữ khó
// đọc) thành 1 icon กขค duy nhất, bấm ra menu nhỏ 2 dòng chữ để chọn, cùng cơ chế bật/tắt class
// "show" + đóng khi bấm ra ngoài như toggleInfoSubmenu()/toggleAccountDropdown() ở trên.
function toggleFcFontToolsMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('fcFontToolsMenu');
  if (menu) menu.classList.toggle('show');
}
function closeFcFontToolsMenu() {
  const menu = document.getElementById('fcFontToolsMenu');
  if (menu) menu.classList.remove('show');
}
document.addEventListener('click', function(e) {
  const wrap = document.getElementById('fcFontToolsBtn');
  const menu = document.getElementById('fcFontToolsMenu');
  if (!menu || !menu.classList.contains('show')) return;
  if ((wrap && wrap.contains(e.target)) || menu.contains(e.target)) return;
  closeFcFontToolsMenu();
});

// ── BACK TO TOP ─────────────────────────────────────────
// Kiến trúc mới: trang KHÔNG còn cuộn theo window nữa (xem body{overflow:hidden} trong
// style.css) — mỗi khung trang (.main/#page-favorites/#page-admin) tự cuộn RIÊNG bên trong nó.
// scrollActivePageToTop() thay cho mọi chỗ trước đây gọi window.scrollTo({top:0,...}): tìm đúng
// khung đang cuộn thực sự ứng với trang đang active rồi cuộn khung ĐÓ lên đầu.
function getActiveScroller() {
  const active = document.querySelector('.page.active');
  if (!active) return document.querySelector('.main');
  // #page-home không tự cuộn — .main (khung bọc ngoài nó) mới là phần tử thực sự có
  // overflow-y:auto. Các trang khác (#page-favorites/#page-admin) tự là khung cuộn luôn.
  return active.id === 'page-home' ? document.querySelector('.main') : active;
}
function scrollActivePageToTop() {
  const scroller = getActiveScroller();
  if (scroller) scroller.scrollTo({ top: 0, behavior: 'smooth' });
}
function scrollToTop() {
  scrollActivePageToTop();
}
// Nút "Lên đầu trang" cần biết khung nào đang cuộn để hiện/ẩn đúng lúc — gắn listener riêng cho
// CẢ 3 khung (thay vì 1 listener duy nhất trên window như trước), dùng chung 1 hàm xử lý.
function handleContainerScroll(e) {
  const btn = document.getElementById('backToTopBtn');
  if (!btn) return;
  // Chỉ phản ứng với khung đang THỰC SỰ hiển thị (tránh trường hợp 1 khung ẩn cuộn ngầm ở vị trí
  // cũ từ trước đó làm nút hiện/ẩn sai trang đang xem).
  if (e.target !== getActiveScroller()) return;
  if (e.target.scrollTop > 300) btn.classList.add('show');
  else btn.classList.remove('show');
}
['main', 'page-favorites', 'page-admin'].forEach(function(sel) {
  const el = sel === 'main' ? document.querySelector('.main') : document.getElementById(sel);
  if (el) el.addEventListener('scroll', handleContainerScroll, { passive: true });
});

function goToWord(id) {
  closeSearchHistDropdowns();
  showPage('home');
  selectWord(id);
}

// Ẩn dropdown lịch sử tra từ ở cả 2 thanh search (thân trang + header) ngay khi chọn 1 từ.
// Đồng thời khóa tạm việc mở lại trong 1 khoảng ngắn để tránh trường hợp ô search vẫn đang
// giữ focus → focus fire lại làm dropdown hiện lại ngay sau khi chọn.
let suppressHistHoverUntil = 0;
function closeSearchHistDropdowns() {
  suppressHistHoverUntil = Date.now() + 500;
  clearQuickShelfActive();
  ['searchHistoryDropdown', 'headerSearchHistoryDropdown'].forEach(id => {
    const dropdown = document.getElementById(id);
    if (dropdown) dropdown.classList.remove('show');
  });
}

// Về trang chủ (bấm logo): chuyển trang + reset ô tìm kiếm về trạng thái mặc định
function goHome() {
  showPage('home');
  const input = document.getElementById('searchInput');
  const headerInput = document.getElementById('headerSearchInput');
  if (input) input.value = '';
  if (headerInput) headerInput.value = '';
  onSearch('');
  resetSEO();
  if (location.pathname !== '/') history.pushState({}, '', '/');
  scrollActivePageToTop();
}

// ── ADMIN ─────────────────────────────────────────────
// ── Helper: bỏ thẻ HTML nhưng giữ khoảng trắng giữa các đoạn <p> ──
function stripHtml(s) {
  return (s || '')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')   // nối các đoạn <p> bằng dấu cách
    .replace(/<br\s*\/?>/gi, ' ')          // <br> cũng thành dấu cách
    .replace(/<[^>]+>/g, '')               // bỏ các thẻ còn lại
    .replace(/\s+/g, ' ')                  // gộp khoảng trắng thừa
    .trim();
}

// Escape ký tự đặc biệt HTML — dùng khi chèn văn bản do người dùng tự nhập (vd ghi chú cá nhân)
// vào innerHTML, tránh phá layout hoặc lỗi bảo mật nếu họ gõ dấu <, >, &, "...
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Escape 1 chuỗi để nhúng an toàn làm tham số string trong onclick="fn('...')"
// (thoát ký tự đặc biệt cho JS trước, rồi escape HTML cho thuộc tính bên ngoài)
function jsStr(s) {
  const jsEscaped = String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeHtml(jsEscaped);
}


// Chỉ còn cập nhật tổng số từ (hiện cạnh tiêu đề "Danh sách từ" ở tab Từ vựng trong trang Admin).
// Đã bỏ 2 số liệu "Yêu thích"/"Đã tra cứu" cũ vì đó là dữ liệu cá nhân của trình duyệt đang
// đăng nhập (localStorage favorites/recentSearches), không phải thống kê toàn hệ thống nên
// không có ý nghĩa với vai trò quản trị. Vẫn giữ tên hàm updateStats() vì được gọi ở rất nhiều
// nơi trong app.js — bọc kiểm tra tồn tại phần tử vì #statTotal giờ chỉ nằm trong trang Admin.
function updateStats() {
  const totalEl = document.getElementById('statTotal');
  if (totalEl) totalEl.textContent = '(' + allWords.length + ')';
}

// ── TOAST ─────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// Toast có nút "Hoàn tác" — dùng cho các thao tác xóa dễ bấm nhầm (xóa 1 từ / nhiều từ khỏi lịch
// sử). Dùng chung khung #toast với showToast() ở trên nhưng đổi sang innerHTML (có nút bấm được)
// thay vì textContent, và tự dài hơi hơn (5s thay vì 2.2s) để kịp bấm hoàn tác.
let pendingUndoAction = null;
let undoToastTimer = null;
function showUndoToast(message, undoFn) {
  const t = document.getElementById('toast');
  if (!t) return;
  pendingUndoAction = undoFn;
  t.innerHTML = escapeHtml(message) + ' <button type="button" class="toast-undo-btn" onclick="runPendingUndo()">Hoàn tác</button>';
  t.classList.add('show');
  if (undoToastTimer) clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => { t.classList.remove('show'); pendingUndoAction = null; }, 5000);
}
function runPendingUndo() {
  const t = document.getElementById('toast');
  if (t) t.classList.remove('show');
  if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
  if (pendingUndoAction) { const fn = pendingUndoAction; pendingUndoAction = null; fn(); }
}


// ── DARK MODE ─────────────────────────────────────────
function toggleDark() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
  updateDarkIcon(!isDark);
}
function updateDarkIcon(isDark) {
  const iconD = document.getElementById('iconDark');
  const iconL = document.getElementById('iconLight');
  if (iconD) iconD.style.display = isDark ? 'none' : 'block';
  if (iconL) iconL.style.display = isDark ? 'block' : 'none';
  // Đồng bộ chữ trạng thái ở hàng "Giao diện" trong menu Tài khoản (mobile) — hàng này thay cho nút
  // darkModeBtn đã ẩn trên mobile, xem index.html/@media max-width:640px trong style.css.
  const stateEl = document.getElementById('accountDarkModeState');
  if (stateEl) stateEl.textContent = isDark ? 'Tối' : 'Sáng';
}
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    updateDarkIcon(true);
  }
}

// ── "CHẾ ĐỘ DỄ ĐỌC" (định nghĩa & ví dụ) ─────────────────────────────────
// Trước đây segmentizeTextNodes() LUÔN tự chạy trên mọi định nghĩa/ví dụ hiển thị (tách từ tự
// động, không tắt được). Giờ đổi thành 1 tùy chọn hiển thị toàn trang (icon phím cách cạnh nút
// Dark/Light mode ở menu dọc, gọi "Chế độ dễ đọc") — mặc định TẮT, lưu ở localStorage, CHỈ áp
// dụng cho định nghĩa + ví dụ. Bật lên tạo khoảng cách giữa các từ bằng margin-right trong CSS
// (.def-seg-word trong style.css) — không chèn dấu cách thật vào văn bản, chỉ là hiệu ứng hiển
// thị, nên câu SẼ dài hơn/dễ xuống dòng khác khi bật so với lúc tắt (đánh đổi đã biết trước).
// Font Challenge đã BỎ HẲN tách từ tự động (không còn segmentizeTextNodes() nào ở khu vực đó nữa) —
// không gộp vào tùy chọn này theo đúng yêu cầu.
let thaiSegmentMode = localStorage.getItem('thai_segment_mode') === '1';

// Dùng hàm này thay cho gọi thẳng segmentizeTextNodes() ở MỌI nơi hiển thị định nghĩa/ví dụ —
// chỉ thực sự tách từ khi thaiSegmentMode đang bật, nếu tắt thì giữ nguyên HTML gốc vừa build
// (câu liền mạch, không tô nền/link từng từ).
// Vùng KHÔNG xử lý khi tách từ / biến từ thành link: nhãn trộn Thái + Việt (loại từ, tag cách dùng, số thứ tự ví dụ…) và khối từ liên quan admin nhập tay.
const DEF_WORD_LINK_SKIP_SELECTOR = '.def-related-label, .def-related-grid, .def-type, .def-ex-num-cell, .def-usage-tag, .def-ex-usage-tag';

// Chế độ dễ đọc BẬT: tách từ có khoảng cách (segmentizeTextNodes). TẮT: giữ nguyên câu liền mạch nhưng VẪN biến từ có trong từ điển thành link
// bấm-để-tra-nhanh (linkifyWordsPlain) — tra nhanh luôn dùng được, chế độ dễ đọc chỉ thêm khoảng cách giữa các từ.
function segmentizeDefsIfEnabled(root) {
  if (thaiSegmentMode) segmentizeTextNodes(root);
  else linkifyWordsPlain(root, DEF_WORD_LINK_SKIP_SELECTOR);
}

function toggleSegmentMode() {
  thaiSegmentMode = !thaiSegmentMode;
  localStorage.setItem('thai_segment_mode', thaiSegmentMode ? '1' : '0');
  updateSegmentModeIcon();
  reapplySegmentModeToVisibleDefs();
}

function updateSegmentModeIcon() {
  // 2 nút .segment-mode-btn (trang kết quả tra từ #rSegmentModeBtn + popup tra nhanh
  // #popupSegmentModeBtn) — cùng cập nhật 1 lượt, không còn 1 id duy nhất như hồi còn ở sidebar.
  document.querySelectorAll('.segment-mode-btn').forEach(btn => btn.classList.toggle('active', thaiSegmentMode));
  // Đồng bộ chữ trạng thái ở hàng "Chế độ dễ đọc" trong menu Tài khoản (mobile) — lối bật/tắt nhanh
  // khi đang ở trang không có .segment-mode-btn tại chỗ (vd Sổ tay).
  const stateEl = document.getElementById('accountSegmentModeState');
  if (stateEl) stateEl.textContent = thaiSegmentMode ? 'Bật' : 'Tắt';
}

function initSegmentMode() {
  updateSegmentModeIcon();
}

// Render lại NGAY các khung định nghĩa/ví dụ đang thực sự hiển thị trên màn hình (khung kết quả
// tra từ chính + popup tra nhanh đang mở + dòng Yêu thích đang mở rộng), để bật/tắt có hiệu lực
// tức thì mà không cần tải lại trang. Những khung CHƯA mở (flashcard chưa lật, dòng danh sách
// cộng đồng chưa mở, v.v.) không cần xử lý ở đây — chúng luôn gọi qua segmentizeDefsIfEnabled()
// mỗi khi mở nên tự động đúng trạng thái mới ngay lần mở kế tiếp.
function reapplySegmentModeToVisibleDefs() {
  if (currentWord) {
    const defEl = document.getElementById('rDefinitions');
    if (defEl) {
      defEl.innerHTML = buildDefinitionsHTML(currentWord);
      segmentizeDefsIfEnabled(defEl);
      updateDefExpandAllBtn('rDefExpandAllBtn', 'rDefinitions', currentWord);
    }
  }
  const popupOverlay = document.getElementById('wordPopupOverlay');
  if (popupOverlay && popupOverlay.classList.contains('show') && wordPopupWordId != null) {
    onDefWordClick(wordPopupWordId);
  }
  const openFavBody = document.querySelector('.fav-word-row-body.show[id^="fav-expand-"]');
  if (openFavBody) {
    const wid = parseInt(openFavBody.id.replace('fav-expand-', ''));
    if (!isNaN(wid)) renderFavExpandedRow(wid);
  }
}


// ── TỪ TÌM NHIỀU NHƯNG CHƯA CÓ KẾT QUẢ (thay cho widget vote đề xuất từ mới cũ) ─────
// Thay vì hỏi ý kiến/vote (tốn công người dùng, cần nhiều lượt tham gia mới có ý nghĩa),
// dùng chính dữ liệu tìm kiếm thật: mỗi khi ai đó tìm 1 từ mà không ra kết quả, ghi nhận lại
// (không cần đăng nhập, không cần bấm gì) — admin xem bảng xếp hạng "tìm nhiều nhất mà chưa
// có" trong panel quản lý để biết nên ưu tiên thêm từ nào, tín hiệu tự nhiên, zero-friction.
let noResultLogTimer = null;
function scheduleNoResultLog(val) {
  clearTimeout(noResultLogTimer);
  const v = (val || '').trim();
  if (!v) return;
  // Debounce dài hơn debounce autocomplete (150ms) — chỉ ghi nhận khi người dùng đã DỪNG gõ
  // được ~1.2s và vẫn ở trạng thái không có kết quả, tránh ghi hàng loạt bản ghi rác ứng với
  // từng ký tự gõ dở (vd "r", "rắ", "rắc" đều tạm thời "không có kết quả" khi đang gõ dở).
  noResultLogTimer = setTimeout(() => {
    sbPost('rpc/log_no_result_search', { p_query: v }).catch(() => {});
  }, 1200);
}


// Ghi nhận 1 lượt tra từ (dùng để tính "Từ hot"). Chạy ngầm, lỗi thì bỏ qua, không ảnh hưởng trải nghiệm tra từ
async function trackWordView(wordId) {
  if (wordId == null) return;
  try { await sbPost('word_views', { word_id: wordId }); } catch (e) { /* im lặng bỏ qua */ }
}

// ── THẺ THÔNG TIN THỤ ĐỘNG: THỜI TIẾT / TIỀN TỆ / ẨM THỰC ──────────────
// Mục tiêu: cài cắm từ vựng tiếng Thái vào nội dung thông tin thực tế, giúp người dùng học
// thụ động mỗi lần ghé trang chủ mà không cần chủ động tra cứu. Mỗi từ tiếng Thái hiển thị
// đều bấm được để nhảy thẳng sang trang tra từ, dùng đúng cơ chế allWords + selectWord có sẵn.
// Toàn bộ nội dung (tiêu đề card + từ vựng) lưu ở Supabase, chỉnh sửa được từ trang admin.

// Click 1 từ tiếng Thái trong info-card: nếu có sẵn trong từ điển thì mở thẳng, nếu chưa có
// thì đưa vào ô tìm kiếm và tra như bình thường (để không bao giờ bị "chết" link).

// ── (Đã bỏ hiệu ứng đổ bóng header khi cuộn — header ngang không còn tồn tại,
//    thay bằng thanh menu dọc cố định .side-menu không đổi theo cuộn trang) ──
const heroEl = document.querySelector('.hero');
const headerSearchWrap = document.getElementById('headerSearchWrap');

// ── THANH MENU DỌC (.side-menu) — LUÔN hiển thị ở mọi kích thước màn hình (cột cố định bên
// trái ở desktop, thanh cố định Ở ĐÁY màn hình ở mobile) — không còn là drawer ẩn/hiện qua
// hamburger nữa nên đã bỏ hẳn toggleSideMenu()/openSideMenu(). closeSideMenu() giữ lại dạng
// rỗng-an-toàn vì showPage() vẫn gọi tới (không còn tác dụng gì, chỉ để không phải sửa chỗ gọi).
function closeSideMenu() {}

// ── SPOTLIGHT SEARCH (nút nổi tra từ nhanh — dùng chung cho MỌI trang, kể cả trang chủ) ──
// Tái dùng nguyên #headerSearchWrap, chỉ thêm class .spotlight-mode để CSS biến nó
// thành modal nổi giữa màn hình thay vì thanh dính dưới header. Đây giờ là cơ chế
// tra-từ-nhanh-từ-header duy nhất của toàn site (đã bỏ hẳn thanh search cuộn-hiện cũ).
//
// LƯU Ý QUAN TRỌNG: <header> có backdrop-filter (blur) -> theo CSS spec, phần tử có
// backdrop-filter/filter/transform sẽ trở thành containing block cho con cháu có
// position:fixed. Nếu để #headerSearchWrap nằm nguyên trong <header> khi bật spotlight-mode,
// nó sẽ bị "nhốt" trong stacking context + lớp blur của header (gây mờ luôn cả logo/icon header).
// -> Khi mở Spotlight, phải "nhấc" hẳn #headerSearchWrap ra khỏi <header>, gắn tạm vào <body>;
// đóng lại thì trả nó về đúng chỗ cũ.
const headerSearchWrapHomeParent = headerSearchWrap.parentNode;
const headerSearchWrapHomeNextSibling = headerSearchWrap.nextSibling;

// Nút nổi "?" (spotlightFabBtn) giờ LUÔN hiện (không còn ẩn/hiện theo trạng thái overlay
// Spotlight như trước) — hàm này giữ lại chỉ để không phải sửa các nơi đang gọi nó.
function updateSpotlightFabVisibility() {
  const fab = document.getElementById('spotlightFabBtn');
  if (!fab) return;
  fab.classList.add('show');
}
updateSpotlightFabVisibility();

// Nút nổi "?" (spotlightFabBtn): chuyển thẳng về trang tra từ (đúng mục "Tra từ", không phải
// "Tách từ") + focus vào ô nhập chính — KHÁC với Spotlight (openSpotlight() ở dưới, mở overlay
// nổi ngay tại chỗ đang đứng): nút này đưa hẳn người dùng về trang chủ để tra cứu.
// Luôn thêm 1 hiệu ứng chớp sáng ngắn quanh ô search (.flash-highlight, xem style.css) SAU khi
// focus — vì nếu người dùng đã sẵn đứng ở trang chủ từ trước, chỉ riêng việc focus() sẽ khó
// nhận ra có phản hồi gì (không đổi trang, không cuộn trang) — hiệu ứng chớp sáng đảm bảo bấm
// vào LUÔN thấy có phản ứng rõ ràng, dù đang đứng ở đâu.
// THỬ NGHIỆM thanh menu mobile: nút "ภาษาไทย" mở Font Challenge. Font Challenge hiện vẫn nằm bên trong
// #page-home (chưa tách thành trang riêng — việc đó lớn hơn nhiều, để sau) nên ở đây tạm về trang chủ rồi
// cuộn mượt tới đúng khung .fc-card, giống hệt cách goToWordSearchFocus() cuộn tới ô tìm kiếm bên dưới.
function goToFontChallenge() {
  showPage('home');
  setTimeout(function() {
    const card = document.getElementById('fcCard');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}
function goToWordSearchFocus() {
  showPage('home');
  switchSearchMode('word');
  scrollActivePageToTop();
  setTimeout(function() {
    const inp = document.getElementById('searchInput');
    const wrap = document.querySelector('.search-wrap .search-inner');
    if (inp) inp.focus();
    if (wrap) {
      wrap.classList.add('flash-highlight');
      setTimeout(function() { wrap.classList.remove('flash-highlight'); }, 650);
    }
  }, 150);
}

function openSpotlight() {
  document.body.appendChild(headerSearchWrap); // thoát khỏi containing block do backdrop-filter của <header> tạo ra
  headerSearchWrap.classList.add('spotlight-mode', 'visible');
  document.getElementById('spotlightBackdrop').classList.add('show');
  updateSpotlightFabVisibility();
  setTimeout(() => { const inp = document.getElementById('headerSearchInput'); if (inp) inp.focus(); }, 80);
}

function closeSpotlight() {
  headerSearchWrap.classList.remove('visible');
  document.getElementById('spotlightBackdrop').classList.remove('show');
  document.getElementById('headerAc').classList.remove('show');
  const hd = document.getElementById('headerSearchHistoryDropdown');
  if (hd) hd.classList.remove('show');
  // đợi transition đóng xong rồi mới gỡ spotlight-mode + trả phần tử về đúng chỗ cũ trong header
  setTimeout(() => {
    if (!headerSearchWrap.classList.contains('visible')) {
      if (headerSearchWrapHomeNextSibling) {
        headerSearchWrapHomeParent.insertBefore(headerSearchWrap, headerSearchWrapHomeNextSibling);
      } else {
        headerSearchWrapHomeParent.appendChild(headerSearchWrap);
      }
      headerSearchWrap.classList.remove('spotlight-mode');
    }
  }, 200);
  updateSpotlightFabVisibility();
}

// Phím tắt Ctrl/Cmd+K: mở Spotlight từ bất kỳ trang nào, kể cả trang chủ
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openSpotlight();
    return;
  }
  if (e.key === 'Escape' && headerSearchWrap.classList.contains('spotlight-mode') && headerSearchWrap.classList.contains('visible')) {
    closeSpotlight();
  }
});

// Header search handlers
let headerAcResults = [], headerAcIndex = -1;
let headerSearchTimeout;
function onHeaderSearch(val) {
  const clearBtn = document.getElementById('headerSearchClearBtn');
  if (clearBtn) clearBtn.classList.toggle('visible', !!val);
  const headerHistDropdown = document.getElementById('headerSearchHistoryDropdown');
  if (headerHistDropdown && val.trim()) headerHistDropdown.classList.remove('show');
  updateSearchCharCounter(val);
  updateTranslateButtonState(val);
  document.getElementById('ptTranslateResult').classList.remove('show');
  if (searchMode === 'popthai') {
    // Đồng bộ sang ô search chính + ô popthai ẩn, không chạy autocomplete tra từ
    setSearchInputValue(val);
    onPopthaiInput(val);
    return;
  }
  // Đồng bộ sang ô search chính (không kích hoạt autocomplete/onSearch của ô đó)
  const mainInput = document.getElementById('searchInput');
  if (mainInput && document.activeElement !== mainInput) {
    setSearchInputValue(val);
  }
  val = val.trim();
  const ac = document.getElementById('headerAc');
  clearTimeout(headerSearchTimeout);
  if (!val) { ac.classList.remove('show'); headerAcResults = []; return; }

  // Debounce 150ms — đồng bộ với ô search chính (onSearch) để tránh lọc lại liên tục khi gõ nhanh
  headerSearchTimeout = setTimeout(() => {
    const q = val.toLowerCase();
    headerAcResults = rankSearchSuggestions(allWords.filter(w =>
      w.visible !== false && (
        w.thai.includes(val) ||
        (w.phonetic && w.phonetic.toLowerCase().includes(q)) ||
        (w.meanings && w.meanings.some(m => m.toLowerCase().includes(q)))
      )
    ), val).slice(0, 7);

    if (!headerAcResults.length) {
      // Không tìm thấy: hiện trạng thái báo + nút đề xuất bổ sung, giống ô search chính (#emptyState)
      lastNoResultQuery = val;
      scheduleNoResultLog(val);
      ac.innerHTML = '<div class="header-ac-empty">'
        + '<div class="header-ac-empty-title">🔍 Không tìm thấy từ này</div>'
        + '<div class="header-ac-empty-sub">Thử tìm với từ khác hoặc kiểm tra chính tả</div>'
        + '<button class="btn-suggest-word" onclick="openSuggestWordFromHeader()">➕ Đề xuất bổ sung từ này vào từ điển</button>'
        + '</div>';
      ac.classList.add('show');
      headerAcIndex = -1;
      return;
    }
    ac.innerHTML = headerAcResults.map((w, i) => renderAcRowCompact(w, 'selectWordFromHeader')).join('');
    ac.classList.add('show');
    headerAcIndex = -1;
  }, 150);
}

// Đóng Spotlight trước khi mở modal đề xuất từ mới (modal dùng z-index thấp hơn backdrop Spotlight,
// nếu không đóng trước sẽ bị che khuất phía sau lớp mờ).
function openSuggestWordFromHeader() {
  const wasSpotlight = headerSearchWrap.classList.contains('spotlight-mode') && headerSearchWrap.classList.contains('visible');
  if (wasSpotlight) {
    closeSpotlight();
    setTimeout(() => openSuggestWordModal(lastNoResultQuery), 220);
  } else {
    openSuggestWordModal(lastNoResultQuery);
  }
}

function onHeaderKeydown(e) {
  if (searchMode === 'popthai') {
    if (e.key === 'Enter') {
      e.preventDefault();
      showPage('home');
      runPopthai();
      setTimeout(() => scrollActivePageToTop(), 50);
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    headerAcIndex = Math.min(headerAcIndex + 1, headerAcResults.length - 1);
    highlightHeaderAC();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    headerAcIndex = Math.max(headerAcIndex - 1, 0);
    highlightHeaderAC();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    submitWordSearch(document.getElementById('headerSearchInput').value, headerAcIndex >= 0 ? headerAcResults[headerAcIndex] : null, true);
  } else if (e.key === 'Escape') {
    document.getElementById('headerAc').classList.remove('show');
  }
}

function highlightHeaderAC() {
  document.querySelectorAll('#headerAc .ac-item').forEach((el, i) => el.classList.toggle('highlighted', i === headerAcIndex));
}

function clearHeaderSearch() {
  const input = document.getElementById('headerSearchInput');
  input.value = '';
  const clearBtn = document.getElementById('headerSearchClearBtn');
  if (clearBtn) clearBtn.classList.remove('visible');
  document.getElementById('headerAc').classList.remove('show');
  headerAcResults = [];
  input.focus();
}

function doHeaderSearch() {
  if (searchMode === 'popthai') {
    showPage('home');
    runPopthai();
    setTimeout(() => scrollActivePageToTop(), 50);
    return;
  }
  submitWordSearch(document.getElementById('headerSearchInput').value, headerAcIndex >= 0 ? headerAcResults[headerAcIndex] : null, true);
}

function selectWordFromHeader(id) {
  document.getElementById('headerAc').classList.remove('show');
  showPage('home');
  selectWord(id);
  // scroll to top smoothly
  setTimeout(() => scrollActivePageToTop(), 50);
}


// ── TRA TỪ BẰNG GIỌNG NÓI ────────────────────────────
// Dùng Web Speech API (SpeechRecognition), nhận diện tiếng Thái (th-TH)
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceRecognition = null;
let voiceActiveBtnId = null;

function startVoiceSearch(inputId, btnId) {
  if (!SpeechRecognitionAPI) {
    showToast('⚠️ Trình duyệt không hỗ trợ tìm kiếm bằng giọng nói');
    return;
  }
  const btn = document.getElementById(btnId);

  // Nếu đang ghi âm ở nút này rồi thì bấm lại để dừng
  if (voiceRecognition && voiceActiveBtnId === btnId) {
    voiceRecognition.stop();
    return;
  }
  // Nếu đang ghi âm ở nút khác (thân trang/header), dừng lại trước khi bắt đầu nút mới
  if (voiceRecognition) {
    voiceRecognition.stop();
  }

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = 'th-TH';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  voiceRecognition = recognition;
  voiceActiveBtnId = btnId;

  if (btn) btn.classList.add('listening');
  showToast('🎙️ Đang nghe... hãy nói từ tiếng Thái');

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript.trim();
    if (!transcript) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = transcript;
    input.focus();
    // Kích hoạt đúng luồng tìm kiếm tương ứng của ô input đó
    if (inputId === 'headerSearchInput') {
      onHeaderSearch(transcript);
    } else {
      onSearchWithClear(transcript);
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') {
      showToast('⚠️ Không nghe thấy giọng nói, vui lòng thử lại');
    } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showToast('⚠️ Vui lòng cho phép quyền truy cập micro');
    } else {
      showToast('⚠️ Lỗi nhận diện giọng nói');
    }
  };

  recognition.onend = () => {
    if (btn) btn.classList.remove('listening');
    voiceRecognition = null;
    voiceActiveBtnId = null;
  };

  try {
    recognition.start();
  } catch (err) {
    if (btn) btn.classList.remove('listening');
    voiceRecognition = null;
    voiceActiveBtnId = null;
  }
}

// ── TRA TỪ BẰNG CHỤP ẢNH (OCR, dùng Tesseract.js chạy hoàn toàn phía client) ──
// Trước đây tesseract.js được nhúng bằng <script> tĩnh trong index.html nên tải/chặn render
// trên MỌI trang dù tính năng OCR chỉ số ít người dùng bấm tới (~vài trăm KB không cần thiết
// cho phần lớn lượt truy cập). Giờ chỉ tải đúng lúc người dùng bấm nút chụp ảnh, y hệt cách
// modules/keyboard.js hay modules/widgets.js được import() động khi cần. Cache lại Promise
// để bấm chụp ảnh nhiều lần trong 1 phiên chỉ tải thư viện đúng 1 lần duy nhất.
let tesseractLoadPromise = null;
function loadTesseractLib() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => { tesseractLoadPromise = null; reject(new Error('Không tải được tesseract.js')); };
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}
function openImageScanOverlay() {
  document.getElementById('imageScanProgressText').textContent = 'Đang xử lý ảnh...';
  document.getElementById('imageScanOverlay').classList.add('show');
}
function closeImageScanOverlay() {
  document.getElementById('imageScanOverlay').classList.remove('show');
}
function updateImageScanProgress(percent) {
  const el = document.getElementById('imageScanProgressText');
  if (el) el.textContent = 'Đang nhận diện... ' + percent + '%';
}

async function onImageSearchSelected(event, inputId) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ''; // cho phép chọn lại cùng 1 ảnh ở lần sau vẫn kích hoạt onchange
  if (!file) return;

  // Đóng Spotlight trước khi hiện overlay quét ảnh — overlay dùng z-index thấp hơn backdrop
  // của Spotlight nên nếu không đóng trước sẽ bị che khuất, không thấy tiến trình quét.
  if (inputId === 'headerSearchInput') closeSpotlight();

  openImageScanOverlay();
  if (!window.Tesseract) {
    document.getElementById('imageScanProgressText').textContent = 'Đang tải thư viện nhận diện...';
  }
  try {
    await loadTesseractLib();
  } catch (e) {
    closeImageScanOverlay();
    showToast('⚠️ Không tải được thư viện nhận diện chữ, kiểm tra kết nối mạng và thử lại');
    return;
  }

  try {
    const { data: { text } } = await Tesseract.recognize(file, 'tha', {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          updateImageScanProgress(Math.round(m.progress * 100));
        }
      }
    });
    const cleaned = (text || '').replace(/\s+/g, ' ').trim();
    closeImageScanOverlay();

    if (!cleaned) {
      showToast('⚠️ Không nhận diện được chữ Thái trong ảnh, thử ảnh rõ nét và đủ sáng hơn');
      return;
    }

    // Dùng chế độ Tách từ (PopThai) để xử lý tốt cả trường hợp 1 từ lẫn cả câu/cụm từ chụp từ ảnh
    if (inputId === 'headerSearchInput') {
      switchSearchModeFromHeader('popthai');
    } else {
      switchSearchMode('popthai');
    }
    const targetInput = document.getElementById(inputId);
    if (inputId === 'searchInput') {
      setSearchInputValue(cleaned);
    } else if (targetInput) {
      targetInput.value = cleaned;
      const headerClearBtn = document.getElementById('headerSearchClearBtn');
      if (headerClearBtn) headerClearBtn.classList.toggle('visible', !!cleaned);
    }
    document.getElementById('popthaiInput').value = cleaned;
    if (inputId === 'headerSearchInput') {
      showPage('home');
      runPopthai();
      setTimeout(() => scrollActivePageToTop(), 50);
    } else {
      runPopthai();
    }
    showToast('📷 Đã nhận diện: ' + cleaned);
  } catch (err) {
    closeImageScanOverlay();
    showToast('⚠️ Lỗi khi nhận diện ảnh, vui lòng thử lại');
  }
}


document.addEventListener('click', e => {
  // Bàn phím ảo (#kbdOverlay) và modal viết tay nằm ngoài #headerSearchWrap/.search-wrap về mặt DOM,
  // nhưng bấm vào đó vẫn là đang "gõ" cho ô search — không được tính là click ra ngoài để đóng dropdown.
  const isTypingTool = e.target.closest('#kbdOverlay'); // canvas viết tay cũng nằm trong này
  if (isTypingTool) return;
  if (!e.target.closest('#headerSearchWrap')) {
    document.getElementById('headerAc').classList.remove('show');
    const hd = document.getElementById('headerSearchHistoryDropdown');
    if (hd) hd.classList.remove('show');
  }
  if (!e.target.closest('.search-wrap') && !e.target.closest('#autocomplete')) {
    document.getElementById('autocomplete').classList.remove('show');
    const sd = document.getElementById('searchHistoryDropdown');
    if (sd) sd.classList.remove('show');
    clearQuickShelfActive();
  }
});

// ── FOOTER CLOCK ─────────────────────────────────────
const THAI_DIGITS = ['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙'];
const THAI_DAYS = ['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'];
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const VIET_DAYS = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
// Dạng RÚT GỌN dùng cho .top-info-bar (header ngang ngoài .main) + drawer mobile: bỏ chữ "วัน"
// trước tên thứ (còn "จันทร์" thay vì "วันจันทร์"), viết tắt tên tháng kiểu 3 chữ cái chuẩn
// hành chính Thái ("ส.ค." thay vì "สิงหาคม").
const THAI_DAYS_SHORT = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const THAI_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function toThaiDigits(n) {
  return String(n).split('').map(d => THAI_DIGITS[parseInt(d)] ?? d).join('');
}

function getThaiTime(h, m) {
  // Thai time description: เช้า/บ่าย/เย็น/ค่ำ
  let period = '', thaiH = h;
  if (h === 0) { period = 'เที่ยงคืน'; thaiH = 0; }
  else if (h < 7) { period = 'ตี'; thaiH = h; }
  else if (h < 12) { period = 'โมงเช้า'; thaiH = h === 7 ? 1 : h - 6; }
  else if (h === 12) { period = 'เที่ยง'; thaiH = 0; }
  else if (h < 13) { period = 'บ่ายโมง'; thaiH = 0; }
  else if (h < 18) { period = 'บ่าย'; thaiH = h - 12; }
  else if (h < 19) { period = 'เย็น'; thaiH = h - 12; }
  else { period = 'ทุ่ม'; thaiH = h - 18; }

  const minStr = m > 0 ? ` ${toThaiDigits(m)}นาที` : ''; // "บ่าย ๒โมง ๒๕นาที" — cách trước số phút, số dính "นาที"

  if (h === 0 || h === 12) {
    return period + (m > 0 ? minStr : '');
  }
  if (h < 7) {
    return `${period} ${toThaiDigits(thaiH)}` + minStr; // "ตี ๓" — cách chữ chỉ buổi và số
  }
  if (h < 12) {
    return `${toThaiDigits(thaiH)}${period}` + minStr;
  }
  if (h === 13) {
    return 'บ่ายโมง' + minStr;
  }
  if (h < 18) {
    return `${period} ${toThaiDigits(thaiH)}โมง` + minStr; // "บ่าย ๒โมง" — cách "บ่าย" và số, số dính "โมง"
  }
  return `${toThaiDigits(thaiH)}${period}` + minStr;
}

// Mobile: dòng ngày ("วัน… ที่… ตุลาคม พ.ศ. 2569") PHẢI hiện đủ, không bị cắt "…" — thanh trên cùng còn chung chỗ với 3 icon + nút tài khoản
// nên bề ngang còn lại thay đổi theo máy/font. Các bước, dừng ngay khi vừa khít: (1) co cỡ chữ tới 9px; (2) nếu vẫn chật → thu nút tài khoản
// còn icon (class .compact-account trên #topInfoBar, ẩn nhãn "Đăng nhập"/tên); (3) co tiếp tới tối thiểu 7.5px. Desktop: bỏ qua.
function fitTopInfoDate() {
  const el = document.getElementById('topInfoDate');
  const bar = document.getElementById('topInfoBar');
  if (!el) return;
  el.style.fontSize = '';
  if (bar) bar.classList.remove('compact-account');
  if (!window.matchMedia('(max-width: 640px)').matches) return;
  const clipped = () => [...el.children].some(c => c.scrollWidth > c.clientWidth + 0.5);
  let size = parseFloat(getComputedStyle(el).fontSize) || 10.5;
  const shrinkTo = min => { while (size > min && clipped()) { size -= 0.5; el.style.fontSize = size + 'px'; } };
  shrinkTo(9);
  if (clipped() && bar) { bar.classList.add('compact-account'); shrinkTo(7.5); }
}
window.addEventListener('resize', fitTopInfoDate);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTopInfoDate); // font thật tải xong có thể đổi bề rộng chữ

function updateClock() {
  const now = new Date();
  const d = now.getDay(), date = now.getDate(),
        mo = now.getMonth(), y = now.getFullYear(),
        h = now.getHours(), m = now.getMinutes();

  // Thai format
  const thaiYear = y + 543;
  const thaiTime = getThaiTime(h, m);
  // Câu ngày giờ đầy đủ: "วันอาทิตย์ ที่๔ ตุลาคม พ.ศ. 2569 - บ่าย ๒โมง ๒๕นาที" — ngày dùng số Thái (dính liền "ที่"), năm Phật lịch số Ả Rập.
  // Tách 2 nửa (ngày | giờ) để thanh trên cùng ở mobile xuống 2 dòng được (bỏ dấu " - " ở mobile); desktop + popup lịch vẫn 1 dòng.
  const thaiDatePart = `${THAI_DAYS[d]} ที่${toThaiDigits(date)} ${THAI_MONTHS[mo]} พ.ศ. ${thaiYear}`;
  const thaiTimePart = thaiTime;
  const thaiStr = `${thaiDatePart} - ${thaiTimePart}`;

  // Vietnamese format
  const pad = n => String(n).padStart(2, '0');
  const vietStr = `${VIET_DAYS[d]}, ${date} tháng ${mo + 1} năm ${y} - ${pad(h)}:${pad(m)}`;

  // Định dạng ĐẦY ĐỦ (câu tiếng Thái + tiếng Việt) — hiện trong popup lịch Thái, CÙNG 1 khung với
  // câu hỏi "วันนี้ วันอะไร..." (xem #tcalFullClock/.tcal-today-banner trong index.html). Cặp
  // Thái-Việt cách nhau bằng XUỐNG DÒNG (2 <span> block riêng), không dùng dấu "·" nối chung 1
  // dòng như trước — mỗi dòng vẫn không tự ý wrap giữa chừng, dài quá thì cuộn ngang được
  // (.tcal-today-th/.tcal-today-vi trong style.css).
  const fullClockEl = document.getElementById('tcalFullClock');
  if (fullClockEl) {
    fullClockEl.innerHTML =
      '<span class="tcal-today-th">' + thaiStr + '</span>' +
      '<span class="tcal-today-vi">' + vietStr + '</span>';
  }

  // Định dạng RÚT GỌN bằng tiếng Thái (vd "จันทร์ 24 ส.ค. 2568, 14:32") — hiện ở thanh header
  // ngang ngoài .main (#topInfoDate, chỉ desktop/tablet ≥641px) VÀ trong drawer mobile
  // (#sideClockDate/#sideClockTime, xem style.css @media max-width:640px). Ngày + năm Phật lịch
  // dùng số Ả Rập thường (không phải số Thái ๑๒๓) cho gọn, khớp đúng kiểu viết tắt phổ biến.
  const shortThaiStr = THAI_DAYS_SHORT[d] + ' ' + date + ' ' + THAI_MONTHS_SHORT[mo] + ' ' + thaiYear;
  const timeStr = pad(h) + ':' + pad(m);

  const topInfoDateEl = document.getElementById('topInfoDate');
  if (topInfoDateEl) {
    // Thanh trên cùng (desktop + mobile): câu ĐẦY ĐỦ như trong lịch. Chỉ ghi lại DOM khi nội dung đổi (mỗi phút), rồi co chữ cho vừa (mobile).
    const html = '<span>' + thaiDatePart + '</span><span class="tid-sep"> - </span><span>' + thaiTimePart + '</span>';
    if (topInfoDateEl.dataset.html !== html) { topInfoDateEl.innerHTML = html; topInfoDateEl.dataset.html = html; fitTopInfoDate(); }
  }

  const sideDateEl = document.getElementById('sideClockDate');
  const sideTimeEl = document.getElementById('sideClockTime');
  if (sideDateEl) sideDateEl.textContent = shortThaiStr;
  if (sideTimeEl) sideTimeEl.textContent = timeStr;
}

updateClock();
setInterval(updateClock, 1000);

// Placeholder tĩnh theo mode giờ set trực tiếp trong switchSearchMode() (ô Tra từ / Tách từ &
// Dịch câu mỗi mode 1 câu cố định) — đã bỏ hẳn cơ chế xoay vòng ví dụ từ vựng cũ ở đây, vì nó
// tự ý ghi đè placeholder mỗi 3.2s bất kể đang ở mode nào, gây xung đột với placeholder đúng
// ngữ cảnh của switchSearchMode().

// ── POPUP LỊCH THÁI (ปฏิทินไทย) — mở khi click vào đồng hồ footer ─
// Ngày lễ cố định (lặp lại cùng ngày/tháng mỗi năm dương lịch)
const THAI_FIXED_HOLIDAYS = [
  { m: 1, d: 1, name: 'วันขึ้นปีใหม่', nameVi: 'Tết Dương lịch' },
  { m: 4, d: 6, name: 'วันจักรี', nameVi: 'Ngày Chakri (lập vương triều)' },
  { m: 4, d: 13, name: 'วันสงกรานต์', nameVi: 'Tết té nước Songkran' },
  { m: 4, d: 14, name: 'วันสงกรานต์', nameVi: 'Tết té nước Songkran' },
  { m: 4, d: 15, name: 'วันสงกรานต์', nameVi: 'Tết té nước Songkran' },
  { m: 5, d: 1, name: 'วันแรงงานแห่งชาติ', nameVi: 'Ngày Quốc tế Lao động' },
  { m: 5, d: 4, name: 'วันฉัตรมงคล', nameVi: 'Ngày Đăng quang Nhà vua' },
  { m: 6, d: 3, name: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี', nameVi: 'Sinh nhật Hoàng hậu' },
  { m: 7, d: 28, name: 'วันเฉลิมพระชนมพรรษา รัชกาลที่ 10', nameVi: 'Sinh nhật Nhà vua Rama X' },
  { m: 8, d: 12, name: 'วันแม่แห่งชาติ', nameVi: 'Ngày của Mẹ' },
  { m: 10, d: 13, name: 'วันคล้ายวันสวรรคต รัชกาลที่ 9', nameVi: 'Ngày giỗ Vua Rama IX' },
  { m: 10, d: 23, name: 'วันปิยมหาราช', nameVi: 'Ngày Chulalongkorn' },
  { m: 12, d: 5, name: 'วันพ่อแห่งชาติ', nameVi: 'Ngày của Cha' },
  { m: 12, d: 10, name: 'วันรัฐธรรมนูญ', nameVi: 'Ngày Hiến pháp' },
  { m: 12, d: 31, name: 'วันสิ้นปี', nameVi: 'Ngày cuối năm' }
];
// Ngày lễ Phật giáo theo âm lịch Thái — ngày thay đổi mỗi năm, chỉ nhập tay theo lịch chính thức
// (ưu tiên độ chính xác: chỉ liệt kê những năm đã xác minh, không tự suy đoán năm chưa rõ)
const THAI_LUNAR_HOLIDAYS = {
  2024: [
    { m: 2, d: 24, name: 'วันมาฆบูชา', nameVi: 'Lễ Māgha Pūjā' },
    { m: 2, d: 26, name: 'ชดเชยวันมาฆบูชา', nameVi: 'Nghỉ bù lễ Māgha Pūjā' },
    { m: 5, d: 22, name: 'วันวิสาขบูชา', nameVi: 'Lễ Phật đản Visākha Pūjā' },
    { m: 7, d: 20, name: 'วันอาสาฬหบูชา', nameVi: 'Lễ Āsāḷha Pūjā' },
    { m: 7, d: 21, name: 'วันเข้าพรรษา', nameVi: 'Lễ Nhập hạ (Khao Phansa)' },
    { m: 7, d: 22, name: 'ชดเชยวันเข้าพรรษา', nameVi: 'Nghỉ bù lễ Nhập hạ' }
  ],
  2025: [
    { m: 2, d: 12, name: 'วันมาฆบูชา', nameVi: 'Lễ Māgha Pūjā' },
    { m: 5, d: 11, name: 'วันวิสาขบูชา', nameVi: 'Lễ Phật đản Visākha Pūjā' },
    { m: 5, d: 12, name: 'ชดเชยวันวิสาขบูชา', nameVi: 'Nghỉ bù lễ Phật đản' },
    { m: 7, d: 10, name: 'วันอาสาฬหบูชา', nameVi: 'Lễ Āsāḷha Pūjā' },
    { m: 7, d: 11, name: 'วันเข้าพรรษา', nameVi: 'Lễ Nhập hạ (Khao Phansa)' }
  ],
  2026: [
    { m: 3, d: 3, name: 'วันมาฆบูชา', nameVi: 'Lễ Māgha Pūjā' },
    { m: 5, d: 31, name: 'วันวิสาขบูชา', nameVi: 'Lễ Phật đản Visākha Pūjā' },
    { m: 7, d: 29, name: 'วันอาสาฬหบูชา', nameVi: 'Lễ Āsāḷha Pūjā' },
    { m: 7, d: 30, name: 'วันเข้าพรรษา', nameVi: 'Lễ Nhập hạ (Khao Phansa)' }
  ],
  2027: [
    { m: 5, d: 20, name: 'วันวิสาขบูชา', nameVi: 'Lễ Phật đản Visākha Pūjā' }
  ]
};

// Mỗi tháng 1 tông màu gradient riêng (cùng kiểu dốc 160deg như tháng 07 gốc)
const TCAL_MONTH_GRADIENTS = [
  'linear-gradient(160deg, #6FA8F5 0%, #4A85E0 55%, #3268C7 100%)', // 1 - Tháng Giêng: xanh dương
  'linear-gradient(160deg, #F07AA6 0%, #E85C90 55%, #D63E77 100%)', // 2 - Tháng Hai: hồng
  'linear-gradient(160deg, #B08CF0 0%, #9068E0 55%, #7350C7 100%)', // 3 - Tháng Ba: tím
  'linear-gradient(160deg, #4DD0C0 0%, #2FB8A8 55%, #1F9C8E 100%)', // 4 - Tháng Tư: ngọc lam (Songkran)
  'linear-gradient(160deg, #F0C24D 0%, #E0A82F 55%, #C78E1F 100%)', // 5 - Tháng Năm: vàng
  'linear-gradient(160deg, #6BC96B 0%, #4DAE4D 55%, #3A9438 100%)', // 6 - Tháng Sáu: xanh lá
  'linear-gradient(160deg, #FF9D5C 0%, #FF7A3D 55%, #FF6423 100%)', // 7 - Tháng Bảy: cam (gốc)
  'linear-gradient(160deg, #F07A6B 0%, #E05A4A 55%, #C7412F 100%)', // 8 - Tháng Tám: đỏ cam
  'linear-gradient(160deg, #4DA6C9 0%, #2F8CAF 55%, #1F7295 100%)', // 9 - Tháng Chín: xanh biển
  'linear-gradient(160deg, #8A7AE0 0%, #6C5CCF 55%, #5544AE 100%)', // 10 - Tháng Mười: chàm tím
  'linear-gradient(160deg, #C98A4D 0%, #AF6E2F 55%, #94571F 100%)', // 11 - Tháng Mười một: nâu hổ phách
  'linear-gradient(160deg, #4D6BC9 0%, #2F4DAE 55%, #1F3894 100%)'  // 12 - Tháng Mười hai: xanh navy
];

// Danh sách LỄ HỘI văn hoá Thái Lan tiêu biểu trong năm — KHÁC với "ngày lễ chính thức"
// (THAI_FIXED_HOLIDAYS/THAI_LUNAR_HOLIDAYS, ngày nghỉ theo luật) ở chỗ đây là các lễ hội VĂN HOÁ
// truyền thống để giới thiệu, không phải lịch nghỉ — nên hiện CỐ ĐỊNH quanh năm, không lọc theo
// tháng đang xem như danh sách ngày lễ bên trên. Chọn lọc thủ công, chỉ liệt kê lễ hội đã xác
// minh rõ ràng (đúng tinh thần admin-curated over algorithmic của dự án).
const THAI_FESTIVALS = [
  { month: 1,  name: 'ตรุษจีน',              nameVi: 'Tết Nguyên Đán (cộng đồng người Hoa ở Thái Lan)' },
  { month: 4,  name: 'สงกรานต์',              nameVi: 'Songkran — Tết té nước, mừng năm mới truyền thống Thái' },
  { month: 5,  name: 'บุญบั้งไฟ',              nameVi: 'Lễ hội bắn pháo thăng thiên cầu mưa (vùng Đông Bắc – Isan)' },
  { month: 7,  name: 'เทศกาลเทียนพรรษา',      nameVi: 'Lễ hội rước nến khổng lồ Ubon Ratchathani' },
  { month: 7,  name: 'ผีตาโขน',               nameVi: 'Lễ hội mặt nạ ma Phi Ta Khon (tỉnh Loei)' },
  { month: 10, name: 'เทศกาลกินเจ',           nameVi: 'Lễ hội ăn chay (nổi tiếng nhất ở Phuket)' },
  { month: 11, name: 'ลอยกระทง',              nameVi: 'Loy Krathong — thả đèn hoa đăng trên sông' },
  { month: 11, name: 'ยี่เป็ง',                nameVi: 'Yi Peng — thả đèn trời (đặc trưng vùng Chiang Mai)' }
];
const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Nội dung TĨNH (không đổi theo tháng đang xem) nên chỉ cần dựng 1 lần lúc mở popup, không cần
// gọi lại trong renderThaiCalendar() (hàm đó chạy lại mỗi lần đổi tháng, sẽ lãng phí re-render).
function renderThaiFestivalList() {
  const el = document.getElementById('calFestivalList');
  if (!el) return;
  el.innerHTML = THAI_FESTIVALS.map(function(f) {
    return '<div class="tcal-legend-item"><span class="tcal-legend-dot tcal-festival-month">' + THAI_MONTH_SHORT[f.month - 1] + '</span>'
      + '<span class="tcal-legend-text">' + escapeHtml(f.name) + '<span class="tcal-legend-vi">' + escapeHtml(f.nameVi) + '</span></span></div>';
  }).join('');
}

let calYear = null, calMonth = null; // month: 0-11 (theo Date của JS)

function getMonthHolidays(year, month1to12) {
  const fixed = THAI_FIXED_HOLIDAYS.filter(h => h.m === month1to12).map(h => ({ day: h.d, name: h.name, nameVi: h.nameVi }));
  const lunar = (THAI_LUNAR_HOLIDAYS[year] || []).filter(h => h.m === month1to12).map(h => ({ day: h.d, name: h.name, nameVi: h.nameVi }));
  return fixed.concat(lunar).sort((a, b) => a.day - b.day);
}

function renderThaiCalendar() {
  const year = calYear, month = calMonth;
  const monthNum1 = month + 1;
  const thaiYear = year + 543;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const holidays = getMonthHolidays(year, monthNum1);
  const holidayMap = {};
  holidays.forEach(h => { holidayMap[h.day] = h.name; });

  const now = new Date();
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
  const todayDate = now.getDate();

  document.getElementById('calMonthNum').textContent = String(monthNum1).padStart(2, '0');
  document.getElementById('calMonthYearThai').textContent = THAI_MONTHS[month] + ' ' + thaiYear;

  const modalBox = document.querySelector('#thaiCalendarModal .tcal-modal-box');
  if (modalBox) modalBox.style.background = TCAL_MONTH_GRADIENTS[month];

  let cellsHtml = '';
  for (let i = 0; i < firstDay; i++) cellsHtml += '<div class="tcal-cell tcal-empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidayMap.hasOwnProperty(d);
    const isToday = isCurrentMonth && d === todayDate;
    let cls = 'tcal-cell';
    if (isWeekend) cls += ' tcal-weekend';
    if (isHoliday) cls += ' tcal-holiday';
    if (isToday) cls += ' tcal-today';
    const titleAttr = isHoliday ? ' title="' + escapeHtml(holidayMap[d]) + '"' : '';
    cellsHtml += '<div class="' + cls + '"' + titleAttr + '>'
      + '<span class="tcal-cell-th">' + toThaiDigits(d) + '</span>'
      + '<span class="tcal-cell-latin">' + d + '</span>'
      + '</div>';
  }
  document.getElementById('calGrid').innerHTML = cellsHtml;

  const legendEl = document.getElementById('calHolidayList');
  legendEl.innerHTML = holidays.length
    ? holidays.map(h => '<div class="tcal-legend-item"><span class="tcal-legend-dot">' + toThaiDigits(h.day) + '</span>'
        + '<span class="tcal-legend-text">' + escapeHtml(h.name) + '<span class="tcal-legend-vi">' + escapeHtml(h.nameVi || '') + '</span></span></div>').join('')
    : '<div class="tcal-legend-empty">ไม่มีวันหยุดสำคัญในเดือนนี้<br>Không có ngày lễ quan trọng trong tháng này</div>';
}

function changeCalendarMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderThaiCalendar();
}

function openThaiCalendarModal() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  renderThaiCalendar();
  renderThaiFestivalList();
  document.getElementById('thaiCalendarModal').classList.add('show');
}

function closeThaiCalendarModal() {
  document.getElementById('thaiCalendarModal').classList.remove('show');
}


// ── FONT CHALLENGE: đoán câu tiếng Thái viết bằng font khó đọc ─
// Mỗi câu gắn 1 điểm ngữ pháp (grammar_point), admin giải thích ở phần "explanation".
// Hàng đợi mỗi phiên = câu đến hạn ôn (kiểu Leitner, dùng chung SRS_INTERVAL_DAYS với Flashcard)
// + câu hoàn toàn mới, cho phép chơi liên tiếp nhiều câu trong ngày (bấm "Câu tiếp theo").
// Font hiển thị được chọn ngẫu nhiên mỗi lần gặp lại câu đó (khác font lần trước nếu có thể),
// để tránh học thuộc hình dạng chữ thay vì đọc thật.
// "Xem đáp án" không tính điểm (chống gian lận) và đưa câu về box 1 -> gặp lại sớm hơn;
// "Tôi đọc được" chấm bằng diff ký tự (LCS): khớp >=95% -> full XP (box +1, hẹn xa hơn),
// >=60% -> partial XP (giữ nguyên box), còn lại -> 0 XP, về box 1, vẫn hiện đáp án để học.
const FC_FONT_CLASS = { ekkamai: 'fc-font-ekkamai', sovprisna: 'fc-font-sovprisna', blk: 'fc-font-blk', lkkaohom: 'fc-font-lkkaohom', spkaneng: 'fc-font-spkaneng', dontworry: 'fc-font-dontworry', akhanake: 'fc-font-akhanake', ceangkhan: 'fc-font-ceangkhan', duck: 'fc-font-duck', jenjrus: 'fc-font-jenjrus', jarakefadhang: 'fc-font-jarakefadhang', klasak: 'fc-font-klasak', lunchakorn: 'fc-font-lunchakorn', suvarnakorn: 'fc-font-suvarnakorn', haanblack: 'fc-font-haanblack', sovbaanrai: 'fc-font-sovbaanrai', sovfanchan: 'fc-font-sovfanchan', sovjiggo: 'fc-font-sovjiggo', sovlaiyoi: 'fc-font-sovlaiyoi', sovlambuek: 'fc-font-sovlambuek', sovler: 'fc-font-sovler', sovmaneejan: 'fc-font-sovmaneejan', sovnamskul: 'fc-font-sovnamskul', sovporntip: 'fc-font-sovporntip', sovrimthangline: 'fc-font-sovrimthangline', sovtongdang: 'fc-font-sovtongdang', sovwaan: 'fc-font-sovwaan', sovyuekyak: 'fc-font-sovyuekyak', sovroongroj: 'fc-font-sovroongroj', sovsitis: 'fc-font-sovsitis', sarunslaimue2: 'fc-font-sarunslaimue2', talooknode: 'fc-font-talooknode', torsilpchaidimak: 'fc-font-torsilpchaidimak', torsilpchongcharoen: 'fc-font-torsilpchongcharoen', torsilppenrat: 'fc-font-torsilppenrat', torsilppreatawan: 'fc-font-torsilppreatawan', torsilpsuchatlight: 'fc-font-torsilpsuchatlight', torsilpyingyai: 'fc-font-torsilpyingyai', torsilprungrueang: 'fc-font-torsilprungrueang', torsilptalaymohk: 'fc-font-torsilptalaymohk', torsilptearborki: 'fc-font-torsilptearborki', jaomatcha: 'fc-font-jaomatcha', jaothursday: 'fc-font-jaothursday', junkshoplaeklai: 'fc-font-junkshoplaeklai', sovhuahliam: 'fc-font-sovhuahliam', sovhuahyak: 'fc-font-sovhuahyak', sovpokon: 'fc-font-sovpokon', sovsritham: 'fc-font-sovsritham', sovswadee: 'fc-font-sovswadee', sovyoona: 'fc-font-sovyoona', sovjatulokabal: 'fc-font-sovjatulokabal', spngongae: 'fc-font-spngongae', spkhianfont: 'fc-font-spkhianfont', spsensin: 'fc-font-spsensin', torsilpchettana: 'fc-font-torsilpchettana', torsilpdekthapud: 'fc-font-torsilpdekthapud', torsilpkriangkrai: 'fc-font-torsilpkriangkrai', torsilplamun: 'fc-font-torsilplamun', torsilpmankhong: 'fc-font-torsilpmankhong', torsilporigami: 'fc-font-torsilporigami', torsilpphato: 'fc-font-torsilpphato', torsilpyaluemchan: 'fc-font-torsilpyaluemchan', dyagencygp: 'fc-font-dyagencygp', waschutintarosb: 'fc-font-waschutintarosb' };
var FC_FONT_LABEL = { ekkamai: 'Ekkamai Vibe Bold', sovprisna: 'SOV Prisna', blk: 'BLK BangLi-Ko-Sa-Na', lkkaohom: 'LK Kaohom Freecomm', spkaneng: 'SP KanEng Ke', dontworry: '2547 Dontworry KookkaiN', akhanake: 'Book Akhanake', ceangkhan: 'CS Ceangkhan', duck: 'Iannnnn Duck', jenjrus: 'Jenjrus Chan', jarakefadhang: 'Layiji JaRaKeFadHang', klasak: 'PK Klasak Bold', lunchakorn: 'PS Lunchakorn', suvarnakorn: 'WC Suvarnakorn', haanblack: 'Haan Black', sovbaanrai: 'SOV Baan Rai', sovfanchan: 'SOV Fan Chan', sovjiggo: 'SOV Jiggo', sovlaiyoi: 'SOV Lai Yoi', sovlambuek: 'SOV Lam Buek', sovler: 'SOV Ler', sovmaneejan: 'SOV Manee Jan', sovnamskul: 'SOV Nam Skul', sovporntip: 'SOV Porn Tip', sovrimthangline: 'SOV Rim Thang Line', sovtongdang: 'SOV Tong Dang', sovwaan: 'SOV Waan', sovyuekyak: 'SOV Yuek Yak', sovroongroj: 'SOV Roongroj', sovsitis: 'SOV Sitis', sarunslaimue2: 'Saruns Lai Mue 2', talooknode: 'TA Look Node', torsilpchaidimak: 'Torsilp Chai Di Mak', torsilpchongcharoen: 'Torsilp Chong Charoen', torsilppenrat: 'Torsilp Penrat', torsilppreatawan: 'Torsilp Preatawan', torsilpsuchatlight: 'Torsilp Su Chat Light', torsilpyingyai: 'Torsilp Yingyai', torsilprungrueang: 'Torsilp Rungrueang', torsilptalaymohk: 'Torsilp Talaymohk', torsilptearborki: 'Torsilp Tearborki', jaomatcha: 'JaoMatcha Bold', jaothursday: 'JaoThursday Thin', junkshoplaeklai: 'Junkshop LaekLai', sovhuahliam: 'SOV Hua Hliam', sovhuahyak: 'SOV Hua Hyak', sovpokon: 'SOV Pok On', sovsritham: 'SOV Sri Tham', sovswadee: 'SOV Swadee', sovyoona: 'SOV Yoona', sovjatulokabal: 'SOV Jatulokab Al', spngongae: 'SP Ngongae BCRDI', spkhianfont: 'SP KhianFont Kf', spsensin: 'SP SenSin Ss', torsilpchettana: 'Torsilp Chettana', torsilpdekthapud: 'Torsilp Dekthapud', torsilpkriangkrai: 'Torsilp Kriangkrai', torsilplamun: 'Torsilp Lamun', torsilpmankhong: 'Torsilp Mankhong', torsilporigami: 'Torsilp Origami', torsilpphato: 'Torsilp Phato', torsilpyaluemchan: 'Torsilp Ya Luem Chan', dyagencygp: 'dY AgencyGP', waschutintarosb: 'was@chutintaroSB' };
// 4 cấp độ khó do admin tự gắn cho TỪNG FONT (không phải từng câu) — 1 font luôn giữ đúng 1 mức
// độ khó dù được dùng ở bao nhiêu câu khác nhau. Lưu trong site_settings.font_difficulty_map
// (jsonb, { fontId: 'de'|'vua'|'kho'|'rat_kho' }), xem loadSiteSettings/saveFontDifficultyMap.
// CHỈ dùng để quản lý dữ liệu ở trang Admin — CHƯA hiển thị công khai ở đâu (dành cho tính năng
// tuỳ chỉnh mức độ theo từng người dùng sau này), nên không có hàm "render badge" nào ở đây.
const FC_DIFFICULTY_LABELS = { de: 'Dễ', vua: 'Vừa', kho: 'Khó', rat_kho: 'Rất khó' };
let fcChallenges = [];
let fcCurrent = null;
let fcCurrentFont = null;
let fcDayKey = null;
let fcRevealedAlready = false;
let fcCurrentFinished = false; // câu đang hiện đã hoàn tất (đã trả lời/xem đáp án) chưa — quyết định mũi tên › là "Bỏ qua" hay "Câu tiếp theo"
let fcProgressMap = {};  // { challengeId: { box, due(ms), lastFont, timesSeen, timesRevealed } }
let fcQueue = [];
let fcQueueIndex = 0;
let fcFontFilter = null; // font_id đang luyện riêng (chế độ "Luyện theo font cụ thể") | null = bình thường
// "Trình độ" thích ứng của người dùng (0 = mới bắt đầu, 1 = đã giỏi) — tự tăng/giảm sau mỗi câu
// dựa trên kết quả đọc + có bấm "Xem gợi ý"/"Xem đáp án" hay không (xem fcComputeSkillDelta),
// dùng để tính lại tỉ lệ Dễ/Vừa/Khó/Rất khó cho các câu MỚI trong hàng đợi (fcComputeLevelWeights/
// fcWeightedShuffleFresh). Lưu ở font_challenge_stats.difficulty_skill (đăng nhập) hoặc
// localStorage "fc_skill_score" (khách) — xem fcLoadSkillScore/fcSaveProgress. KHÔNG hiển thị
// cho người dùng thấy (chạy ngầm hoàn toàn), và KHÔNG có lối tự chọn mức thủ công.
let fcSkillScore = 0;
// Có bấm "Xem gợi ý" trong lúc đang làm câu HIỆN TẠI hay không — reset về false mỗi khi sang câu
// mới (fcShowCurrentInQueue), bật true trong fcShowHint(), đọc 1 lần khi tính skill delta lúc
// hoàn tất câu (fcSaveProgress) rồi bỏ qua (không cần reset lại ở đó vì câu tiếp theo sẽ tự reset).
let fcHintUsedThisQuestion = false;
// Lưu lại trạng thái "đã hoàn tất" của từng câu trong hàng đợi hiện tại, theo index — dùng để
// mũi tên back/next khôi phục lại đúng những gì đã hiện ra trước đó, không cần làm lại câu hỏi.
// key = index trong fcQueue, value = { thaiText, fontClass, readingTitle, revealHtml,
// translateTitle, translateRevealHtml, keyPointsVisible, explainHtml }. Reset về rỗng mỗi khi
// hàng đợi được build lại (fcBuildQueue) vì lúc đó index không còn trỏ đúng câu cũ nữa.
let fcAnswerSnapshots = {};

async function loadFontChallenge() {
  const card = document.getElementById('fcCard');
  if (!card) return;
  try {
    const rows = await sbGet('font_challenges?select=*&order=id.asc');
    fcChallenges = Array.isArray(rows) ? rows : [];
  } catch (e) { fcChallenges = []; }

  const activeEl = document.getElementById('fcActiveArea');
  const emptyEl = document.getElementById('fcEmptyState');
  if (!fcChallenges.length) {
    if (activeEl) activeEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (activeEl) activeEl.style.display = '';

  fcDayKey = String(Math.floor(Date.now() / 86400000));

  // Bọc try/catch quanh toàn bộ phần xây hàng đợi + render câu đầu tiên — trước đây nếu BẤT KỲ
  // bước nào ở đây ném lỗi (mạng lỗi khi tải tiến độ, lỗi dữ liệu bất thường...), lỗi sẽ rớt ra
  // ngoài async function mà không ai bắt, khiến 2 dòng gọi sau (fcBuildQueue/fcShowCurrentInQueue)
  // KHÔNG BAO GIỜ chạy — để lại đúng khung trống mặc định của #fcThaiDisplay (không có chữ, chỉ
  // còn nền + padding từ CSS) y hệt lỗi "khung trắng không có câu" người dùng gặp phải. Giờ nếu có
  // lỗi, in ra console để dễ chẩn đoán + rơi về đúng trạng thái rỗng có nút thử lại, thay vì treo
  // trắng vô thời hạn.
  try {
    await Promise.all([fcLoadProgressMap(), fcLoadSkillScore(), fcLoadSavedMap()]);
    fcBuildQueue();
    fcShowCurrentInQueue();
    fcSetupNavListeners();
  } catch (e) {
    console.error('loadFontChallenge() lỗi khi xây hàng đợi/hiển thị câu:', e);
    if (activeEl) activeEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.innerHTML = '<div class="quick-shelf-empty">⚠️ Có lỗi khi tải Font Challenge. '
        + '<button type="button" class="btn-link-small" onclick="loadFontChallenge()">Thử lại</button></div>';
    }
  }
}

// Gắn phím tắt (mũi tên trái/phải, phím cách) + vuốt chạm trái/phải trên di động để điều hướng
// câu — CHỈ gắn 1 lần duy nhất (loadFontChallenge có thể được gọi lại nhiều lần, vd sau khi
// đăng nhập) nhờ cờ fcNavListenersAttached, tránh nhân đôi listener.
let fcNavListenersAttached = false;
function fcSetupNavListeners() {
  if (fcNavListenersAttached) return;
  fcNavListenersAttached = true;

  document.addEventListener('keydown', (e) => {
    const activeArea = document.getElementById('fcActiveArea');
    if (!activeArea || activeArea.style.display === 'none') return;
    // Đang gõ trong ô input/textarea nào đó (không riêng gì Font Challenge) thì bỏ qua hẳn —
    // phím cách phải gõ ra dấu cách bình thường, không được cướp làm phím điều hướng.
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (active && active.isContentEditable)) return;
    if (e.key === 'ArrowRight' || ((e.key === ' ' || e.code === 'Space') && !e.shiftKey)) {
      e.preventDefault();
      fcGoNext();
    } else if (e.key === 'ArrowLeft' || ((e.key === ' ' || e.code === 'Space') && e.shiftKey)) {
      e.preventDefault();
      fcGoBack();
    }
  });

  const card = document.getElementById('fcCard');
  let touchStartX = 0, touchStartY = 0;
  card.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    // Đang gõ trong ô input của Font Challenge thì bỏ qua (tránh nuốt mất thao tác bôi đen/chọn
    // chữ trong ô bằng ngón tay, vốn cũng là 1 kiểu "vuốt ngang").
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Cần vuốt đủ xa theo chiều ngang (>50px) VÀ ngang nhiều hơn dọc, để không nhầm với cuộn
    // trang theo chiều dọc.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) fcGoNext(); else fcGoBack();
  }, { passive: true });
}

// Tải tiến độ ôn tập của người dùng: đăng nhập -> Supabase theo user_id, khách -> localStorage.
async function fcLoadProgressMap() {
  fcProgressMap = {};
  if (isLoggedIn()) {
    try {
      const rows = await sbGetAuth('font_challenge_progress?select=*&user_id=eq.' + session.user.id);
      (Array.isArray(rows) ? rows : []).forEach(r => {
        fcProgressMap[r.challenge_id] = {
          box: r.box_level || 1,
          due: r.next_due ? new Date(r.next_due).getTime() : Date.now(),
          lastFont: r.last_font_id || null,
          timesSeen: r.times_seen || 0,
          timesRevealed: r.times_revealed || 0
        };
      });
    } catch (e) { /* giữ map rỗng nếu lỗi mạng, vẫn cho chơi được */ }
  } else {
    try {
      const raw = localStorage.getItem('fc_progress_map');
      fcProgressMap = raw ? JSON.parse(raw) : {};
    } catch (e) { fcProgressMap = {}; }
  }
}

// Tải "trình độ" thích ứng đã lưu — song song với fcLoadProgressMap ở trên, cùng nguyên tắc
// đăng nhập -> Supabase (bảng font_challenge_stats, đã có sẵn cho XP/streak, thêm cột
// difficulty_skill), khách -> localStorage.
async function fcLoadSkillScore() {
  if (isLoggedIn()) {
    try {
      const rows = await sbGetAuth('font_challenge_stats?select=difficulty_skill&user_id=eq.' + session.user.id);
      const row = Array.isArray(rows) && rows[0];
      fcSkillScore = (row && typeof row.difficulty_skill === 'number') ? row.difficulty_skill : 0;
    } catch (e) { fcSkillScore = 0; }
  } else {
    const raw = parseFloat(localStorage.getItem('fc_skill_score'));
    fcSkillScore = isNaN(raw) ? 0 : Math.max(0, Math.min(1, raw));
  }
}

// 2 mốc tỉ lệ Dễ/Vừa/Khó/Rất khó ứng với skill=0 (người mới) và skill=1 (đã đọc tốt) — nội suy
// tuyến tính giữa 2 mốc này theo đúng skill hiện tại của người dùng (fcComputeLevelWeights).
const FC_SKILL_WEIGHTS_MIN = { de: 0.6, vua: 0.3, kho: 0.1, rat_kho: 0 };
const FC_SKILL_WEIGHTS_MAX = { de: 0.2, vua: 0.4, kho: 0.3, rat_kho: 0.1 };
function fcComputeLevelWeights(skill) {
  const s = Math.max(0, Math.min(1, skill));
  const w = {};
  Object.keys(FC_SKILL_WEIGHTS_MIN).forEach(k => {
    w[k] = FC_SKILL_WEIGHTS_MIN[k] + s * (FC_SKILL_WEIGHTS_MAX[k] - FC_SKILL_WEIGHTS_MIN[k]);
  });
  return w;
}

// Xáo trộn các câu CHƯA TỪNG LÀM theo trọng số độ khó (dùng lấy mẫu có trọng số, KHÔNG hoàn lại
// — mọi câu vẫn chắc chắn xuất hiện đủ hết trong hàng đợi, chỉ khác nhau ở VỊ TRÍ: bucket trọng
// số cao dễ được rút ra sớm/dày hơn). Câu thuộc font ADMIN CHƯA PHÂN LOẠI xếp riêng 1 bucket với
// trọng số cố định (không phụ thuộc skill) để không bị bỏ quên. Có "trọng số sàn" (FLOOR) cho
// mọi bucket — kể cả bucket đang 0% (vd "Rất khó" lúc skill=0) vẫn có cơ hội nhỏ xuất hiện, không
// bị chặn cứng hoàn toàn.
function fcWeightedShuffleFresh(freshList, weights) {
  const UNCLASSIFIED_WEIGHT = 0.15;
  const FLOOR = 0.02;
  const buckets = { de: [], vua: [], kho: [], rat_kho: [], unclassified: [] };
  const map = siteSettingsState.font_difficulty_map || {};
  freshList.forEach(c => {
    const lvl = map[c.font_id];
    (buckets[lvl] || buckets.unclassified).push(c);
  });
  const pools = {};
  Object.keys(buckets).forEach(k => { pools[k] = shuffleArray(buckets[k]); });
  const w = Object.assign({ unclassified: UNCLASSIFIED_WEIGHT }, weights);

  const result = [];
  let remainingKeys = Object.keys(pools).filter(k => pools[k].length);
  while (remainingKeys.length) {
    let total = 0;
    remainingKeys.forEach(k => { total += Math.max(w[k] || 0, FLOOR); });
    let r = Math.random() * total;
    let chosen = remainingKeys[remainingKeys.length - 1];
    for (const k of remainingKeys) {
      const wk = Math.max(w[k] || 0, FLOOR);
      if (r < wk) { chosen = k; break; }
      r -= wk;
    }
    result.push(pools[chosen].shift());
    remainingKeys = remainingKeys.filter(k => pools[k].length);
  }
  return result;
}

// Xây hàng đợi cho phiên chơi: câu đến hạn (đã có tiến độ, due <= hiện tại) trước, xáo ngẫu
// nhiên bình thường (đã tới hạn thì phải ôn, không phân biệt độ khó). Câu hoàn toàn mới xếp sau,
// xáo theo trọng số độ khó ứng với "trình độ" hiện tại của người dùng (fcSkillScore).
// Nếu đang ở chế độ "Luyện theo font cụ thể" (fcFontFilter khác null) — BỎ QUA hẳn điều kiện đến
// hạn, lấy TẤT CẢ câu (của mọi font) xáo ngẫu nhiên, luyện ngay không cần chờ tới lượt SRS; mọi
// câu đều được HIỂN THỊ bằng font đã chọn (xem fcShowCurrentInQueue) thay vì font admin gắn sẵn.
// Trả lời vẫn cập nhật đúng tiến độ SRS bình thường (box/due) như mọi lần — chỉ CÁCH CHỌN câu vào
// hàng đợi và font hiển thị là khác, không ảnh hưởng gì tới việc chấm điểm.
function fcBuildQueue() {
  if (fcPracticeIds) { // "Luyện lại câu đã lưu": chỉ các câu được chọn, bỏ qua điều kiện đến hạn SRS (như chế độ luyện theo font)
    const wanted = new Set(fcPracticeIds);
    fcQueue = shuffleArray(fcChallenges.filter(c => wanted.has(String(c.id))));
    fcQueueIndex = 0;
    fcAnswerSnapshots = {};
    return;
  }
  if (fcFontFilter) {
    fcQueue = shuffleArray(fcChallenges.slice());
    fcQueueIndex = 0;
    fcAnswerSnapshots = {};
    return;
  }
  const now = Date.now();
  const due = [], fresh = [];
  fcChallenges.forEach(c => {
    const p = fcProgressMap[c.id];
    if (!p) fresh.push(c);
    else if (p.due <= now) due.push(c);
  });
  const weights = fcComputeLevelWeights(fcSkillScore);
  fcQueue = shuffleArray(due).concat(fcWeightedShuffleFresh(fresh, weights));
  fcQueueIndex = 0;
  fcAnswerSnapshots = {};
}

// ── LUYỆN THEO FONT CỤ THỂ ──────────────────────────────
// ── XEM CHỮ THEO FONT KHÓ ĐỌC (gõ tự do, không cần có trong từ điển) ──
// Khác "Luyện theo font cụ thể" ngay bên dưới (cái đó CHỌN font để LUYỆN câu admin soạn sẵn, có
// đoán/chấm điểm) — cái này chỉ để XEM THỬ, không đoán/chấm gì cả. Dùng chung đúng bộ
// FC_FONT_CLASS/FC_FONT_LABEL (85 font) đã nhúng sẵn cho Font Challenge, không cần thêm font mới.
// prefillText (tuỳ chọn): mở kèm sẵn chữ có sẵn — xem nút "Xem theo font khó đọc" ở trang kết quả
// tra từ, truyền currentWord.thai vào để không phải gõ lại tay.
function openFcFontPreview(prefillText) {
  const modal = document.getElementById('fcFontPreviewModal');
  if (!modal) return;
  document.getElementById('fcFontPreviewInput').value = prefillText || '';
  document.getElementById('fcFontPreviewSearch').value = '';
  fcRenderFontPreviewList();
  modal.classList.add('show');
}
function closeFcFontPreview() {
  const modal = document.getElementById('fcFontPreviewModal');
  if (modal) modal.classList.remove('show');
}
function fcRenderFontPreviewList() {
  const listEl = document.getElementById('fcFontPreviewList');
  if (!listEl) return;
  const text = (document.getElementById('fcFontPreviewInput').value || '').trim();
  if (!text) { listEl.innerHTML = '<div class="fc-font-preview-empty">✏️ Gõ chữ ở ô trên để xem thử</div>'; return; }
  const q = (document.getElementById('fcFontPreviewSearch').value || '').trim().toLowerCase();
  const fontIds = Object.keys(FC_FONT_LABEL)
    .filter(fid => !q || (FC_FONT_LABEL[fid] || fid).toLowerCase().includes(q))
    .sort((a, b) => (FC_FONT_LABEL[a] || a).localeCompare(FC_FONT_LABEL[b] || b));
  if (!fontIds.length) { listEl.innerHTML = '<div class="fc-font-preview-empty">Không tìm thấy font phù hợp</div>'; return; }
  const safeText = escapeHtml(text);
  // animation-delay tăng dần theo thứ tự (tối đa 12 mục đầu) để hiệu ứng fade-in trông như xổ ra
  // lần lượt thay vì bật hết cùng lúc — chỉ áp dụng vài mục đầu, tránh người dùng phải chờ lâu
  // mới thấy hết danh sách nếu gõ lại/lọc liên tục.
  listEl.innerHTML = fontIds.map((fid, idx) =>
    '<div class="fc-font-preview-item" style="animation-delay:' + Math.min(idx, 12) * 25 + 'ms">'
    + '<div class="fc-font-preview-sample ' + (FC_FONT_CLASS[fid] || '') + '">' + safeText + '</div>'
    + '<div class="fc-font-preview-name">' + escapeHtml(FC_FONT_LABEL[fid] || fid) + '</div>'
    + '</div>'
  ).join('');
}
function fcSpeakFontPreviewInput() {
  const text = (document.getElementById('fcFontPreviewInput').value || '').trim();
  if (text) speakText(text);
}

function fcOpenFontPicker() {
  document.getElementById('fcFontPickerSearch').value = '';
  fcRenderFontPickerList();
  document.getElementById('fcFontPickerModal').classList.add('show');
}
function closeFcFontPicker() {
  document.getElementById('fcFontPickerModal').classList.remove('show');
}

function fcRenderFontPickerList() {
  const listEl = document.getElementById('fcFontPickerList');
  if (!listEl) return;
  const q = (document.getElementById('fcFontPickerSearch').value || '').trim().toLowerCase();
  // Liệt kê TOÀN BỘ font đã nhúng sẵn (FC_FONT_LABEL), không chỉ font admin đã gắn cho câu nào —
  // vì luyện riêng 1 font giờ áp font đó cho mọi câu (xem fcBuildQueue/fcShowCurrentInQueue).
  // Không hiện phân loại độ khó (font_difficulty_map) ở danh sách chọn này nữa — chỉ còn tên font.
  const fontIds = Object.keys(FC_FONT_LABEL)
    .filter(fid => !q || (FC_FONT_LABEL[fid] || fid).toLowerCase().includes(q))
    .sort((a, b) => (FC_FONT_LABEL[a] || a).localeCompare(FC_FONT_LABEL[b] || b));

  if (!fontIds.length) { listEl.innerHTML = '<div class="fav-empty" style="padding:1rem 0">Không tìm thấy font phù hợp</div>'; return; }

  listEl.innerHTML = fontIds.map(fid => {
    const label = FC_FONT_LABEL[fid] || fid;
    return '<button type="button" class="fc-font-picker-item" onclick="fcSelectFontToPractice(\'' + fid + '\')">' +
      '<span class="fc-font-picker-sample ' + (FC_FONT_CLASS[fid] || '') + '">กขค</span>' +
      '<span class="fc-font-picker-name">' + escapeHtml(label) + '</span>' +
      '</button>';
  }).join('');
}

function fcSelectFontToPractice(fontId) {
  fcPracticeIds = null;
  fcFontFilter = fontId;
  closeFcFontPicker();
  fcBuildQueue();
  fcShowCurrentInQueue();
  fcUpdateFontFilterBanner();
}

function fcExitFontFilter() {
  fcFontFilter = null;
  fcPracticeIds = null;
  fcBuildQueue();
  fcShowCurrentInQueue();
  fcUpdateFontFilterBanner();
}

function fcUpdateFontFilterBanner() {
  const banner = document.getElementById('fcFontFilterBanner');
  if (!banner) return;
  if (!fcFontFilter && !fcPracticeIds) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  if (fcPracticeIds) { document.getElementById('fcFontFilterBannerText').textContent = 'Đang luyện ' + fcPracticeLabel + ' (' + fcQueue.length + ' câu)'; return; }
  document.getElementById('fcFontFilterBannerText').textContent = '🔤 Đang luyện riêng: ' + (FC_FONT_LABEL[fcFontFilter] || fcFontFilter);
}

// ══ FONT CHALLENGE: CÂU ĐÃ LƯU + GHI CHÚ CÁ NHÂN ═══════════════
// Lưu 1 câu để xem lại sau (kèm ghi chú riêng). Bảng font_challenge_saved (xem migration_font_challenge_saved.sql — CHẠY TAY trước khi deploy),
// khóa (user_id, challenge_id). Chưa đăng nhập: lưu ở localStorage "fc_saved_map" rồi tự đẩy lên tài khoản khi đăng nhập (fcLoadSavedMap).
// fcSavedMap = { "challengeId": { note, ts } } — key luôn là chuỗi.
var fcSavedMap = {};
let fcPracticeLabel = 'câu đã lưu'; // tên hiển thị trên banner khi đang luyện theo danh sách id (câu đã lưu / điểm ngữ pháp)
let fcPracticeIds = null;      // mảng id (chuỗi) khi đang "Luyện lại câu đã lưu"; null = chế độ thường (xem fcBuildQueue/fcUpdateFontFilterBanner)
let fcNoteEditingId = null;
const FC_NOTE_MAX = 1000;

function fcChallengeById(id) { return fcChallenges.find(c => String(c.id) === String(id)) || null; }
function fcSavedPersistLocal() { try { localStorage.setItem('fc_saved_map', JSON.stringify(fcSavedMap)); } catch (e) {} }

async function fcSavedUpsertRemote(id, note) {
  const c = fcChallengeById(id);
  const res = await sbPostAuth('font_challenge_saved', {
    user_id: session.user.id, challenge_id: c ? c.id : id, note: note || '', updated_at: new Date().toISOString()
  }, 'user_id,challenge_id');
  if (!Array.isArray(res)) throw new Error('fc saved upsert failed'); // sbPostAuth trả về object lỗi (không throw) khi bảng chưa tạo / bị RLS chặn
}

async function fcLoadSavedMap() {
  let local = {};
  try { local = JSON.parse(localStorage.getItem('fc_saved_map') || '{}') || {}; } catch (e) { local = {}; }
  if (!isLoggedIn()) { fcSavedMap = local; fcUpdateSavedCountBadge(); return; }
  try {
    const rows = await sbGetAuth('font_challenge_saved?select=challenge_id,note,created_at&user_id=eq.' + session.user.id);
    if (!Array.isArray(rows)) throw new Error('fc saved load failed');
    const map = {};
    rows.forEach(r => { map[String(r.challenge_id)] = { note: r.note || '', ts: r.created_at ? new Date(r.created_at).getTime() : Date.now() }; });
    // Phần đã lưu lúc chưa đăng nhập (chỉ có ở máy này) → đẩy lên tài khoản; đẩy hết thì xoá bản local.
    const localOnly = Object.keys(local).filter(id => !map[id] && fcChallengeById(id));
    let allPushed = true;
    for (const id of localOnly) {
      try { await fcSavedUpsertRemote(id, local[id].note || ''); map[id] = local[id]; } catch (e) { allPushed = false; }
    }
    if (allPushed) { try { localStorage.removeItem('fc_saved_map'); } catch (e) {} }
    fcSavedMap = map;
  } catch (e) {
    fcSavedMap = local; // lỗi mạng / chưa chạy migration: tạm dùng bản trên máy
  }
  fcUpdateSavedCountBadge();
}

// Đặt trạng thái lưu của 1 câu (saved=true: lưu/cập nhật ghi chú; false: bỏ lưu). Trả về true nếu thành công, lỗi thì hoàn lại trạng thái cũ.
async function fcSetSaved(id, saved, note) {
  const key = String(id);
  const prev = fcSavedMap[key];
  if (saved) fcSavedMap[key] = { note: note != null ? note : (prev ? prev.note : ''), ts: prev ? prev.ts : Date.now() };
  else delete fcSavedMap[key];
  fcAfterSavedChange();
  if (!isLoggedIn()) { fcSavedPersistLocal(); return true; }
  try {
    if (saved) await fcSavedUpsertRemote(key, fcSavedMap[key].note);
    else await sbDeleteAuth('font_challenge_saved?user_id=eq.' + session.user.id + '&challenge_id=eq.' + encodeURIComponent(key));
    return true;
  } catch (e) {
    if (prev) fcSavedMap[key] = prev; else delete fcSavedMap[key];
    fcAfterSavedChange();
    showToast('⚠️ Không thể lưu, thử lại sau');
    return false;
  }
}

function fcAfterSavedChange() {
  fcUpdateSaveBtn();
  fcUpdateSavedCountBadge();
  const m = document.getElementById('fcSavedModal');
  if (m && m.classList.contains('show')) fcRenderSavedList();
}

function fcUpdateSavedCountBadge() {
  const el = document.getElementById('fcSavedMenuCount');
  if (!el) return;
  const n = Object.keys(fcSavedMap).length;
  el.textContent = n ? '(' + n + ')' : '';
}

// Cập nhật icon lưu theo câu đang hiện: đã lưu = bookmark tô đặc; đã có ghi chú = thêm chấm nhỏ (class has-note). hide=true khi không có câu nào (hết hàng đợi).
function fcUpdateSaveBtn(hide) {
  const sb = document.getElementById('fcSaveBtn');
  if (!sb) return;
  if (hide || !fcCurrent) { sb.style.display = 'none'; return; }
  const e = fcSavedMap[String(fcCurrent.id)];
  sb.style.display = '';
  sb.classList.toggle('saved', !!e);
  sb.classList.toggle('has-note', !!(e && e.note));
  sb.setAttribute('aria-pressed', e ? 'true' : 'false');
  sb.setAttribute('aria-label', e ? 'Ghi chú hoặc bỏ lưu câu' : 'Lưu câu');
  sb.setAttribute('data-tooltip', e ? 'Ghi chú / bỏ lưu' : 'Lưu câu để xem lại');
}

// Chưa lưu: lưu ngay rồi mở ô ghi chú (đóng lại không nhập gì cũng không sao, câu vẫn được lưu). Đã lưu: mở lại ô ghi chú (trong đó có nút "Bỏ lưu").
async function fcToggleSave() {
  if (!fcCurrent) return;
  const id = String(fcCurrent.id);
  if (!fcSavedMap[id] && !(await fcSetSaved(id, true))) return;
  fcOpenNoteEditor(id);
}

function fcOpenNoteEditor(id) {
  const c = fcChallengeById(id);
  if (!c) return;
  fcNoteEditingId = String(id);
  const fid = c.font_id || 'ekkamai';
  const sent = document.getElementById('fcNoteSentence');
  sent.className = 'fc-note-sentence ' + (FC_FONT_CLASS[fid] || FC_FONT_CLASS.ekkamai);
  sent.textContent = c.thai_text || '';
  const input = document.getElementById('fcNoteInput');
  input.value = (fcSavedMap[fcNoteEditingId] && fcSavedMap[fcNoteEditingId].note) || '';
  fcUpdateNoteCounter();
  document.getElementById('fcNoteModal').classList.add('show');
  autoGrowTextarea(input); // phải gọi SAU khi hiện popup: phần tử đang ẩn có scrollHeight = 0, và gán .value bằng JS không bắn sự kiện 'input'
  setTimeout(() => input.focus(), 120);
}
function closeFcNote() { document.getElementById('fcNoteModal').classList.remove('show'); fcNoteEditingId = null; }
function fcUpdateNoteCounter() {
  const v = document.getElementById('fcNoteInput').value;
  document.getElementById('fcNoteCounter').textContent = v.length + '/' + FC_NOTE_MAX;
}
// Nút "Bỏ lưu câu này" trong ô ghi chú (có Hoàn tác như khi bỏ lưu từ danh sách).
function fcNoteUnsave() {
  const id = fcNoteEditingId;
  closeFcNote();
  if (id != null) fcSavedRemove(id);
}
async function fcSaveNote() {
  if (fcNoteEditingId == null) return;
  const text = document.getElementById('fcNoteInput').value.trim().slice(0, FC_NOTE_MAX);
  const id = fcNoteEditingId;
  if (await fcSetSaved(id, true, text)) { closeFcNote(); showToast(text ? '✅ Đã lưu ghi chú' : 'Đã xoá ghi chú'); }
}

// ── Danh sách "Câu đã lưu" ──────────────────────────
function fcOpenSaved() {
  document.getElementById('fcSavedSearch').value = '';
  document.getElementById('fcSavedFontFilter').value = '';
  fcRenderSavedList();
  document.getElementById('fcSavedModal').classList.add('show');
}
function closeFcSaved() { document.getElementById('fcSavedModal').classList.remove('show'); }

// Các câu đã lưu (còn tồn tại trong ngân hàng câu), mới lưu trước.
function fcSavedItems() {
  return Object.keys(fcSavedMap).map(id => ({ id, entry: fcSavedMap[id], c: fcChallengeById(id) }))
    .filter(it => it.c).sort((a, b) => (b.entry.ts || 0) - (a.entry.ts || 0));
}

function fcSavedFilteredItems() {
  const q = (document.getElementById('fcSavedSearch').value || '').trim().toLowerCase();
  const font = document.getElementById('fcSavedFontFilter').value;
  return fcSavedItems().filter(it => {
    if (font && (it.c.font_id || 'ekkamai') !== font) return false;
    if (!q) return true;
    return [it.c.thai_text, it.c.meaning_vi, it.c.phonetic, it.entry.note].some(t => (t || '').toLowerCase().includes(q));
  });
}

function fcRenderSavedList() {
  const listEl = document.getElementById('fcSavedList');
  if (!listEl) return;
  const all = fcSavedItems();
  // Bộ lọc font: chỉ liệt kê các font đang có trong câu đã lưu, giữ lựa chọn hiện tại nếu còn.
  const sel = document.getElementById('fcSavedFontFilter');
  const prevFont = sel.value;
  const fonts = [...new Set(all.map(it => it.c.font_id || 'ekkamai'))].sort((a, b) => (FC_FONT_LABEL[a] || a).localeCompare(FC_FONT_LABEL[b] || b));
  sel.innerHTML = '<option value="">Tất cả font</option>' + fonts.map(f => '<option value="' + f + '">' + escapeHtml(FC_FONT_LABEL[f] || f) + '</option>').join('');
  sel.value = fonts.includes(prevFont) ? prevFont : '';
  sel.style.display = fonts.length > 1 ? '' : 'none';

  const items = fcSavedFilteredItems();
  document.getElementById('fcSavedSub').textContent = all.length
    ? (items.length === all.length ? all.length + ' câu' : items.length + '/' + all.length + ' câu')
    : 'Bấm biểu tượng đánh dấu ở khung Font Challenge để lưu câu muốn xem lại.';
  document.getElementById('fcSavedPracticeAll').style.display = items.length ? '' : 'none';
  document.getElementById('fcSavedSearch').style.display = all.length ? '' : 'none';
  if (!items.length) {
    listEl.innerHTML = all.length ? '<div class="fav-empty" style="padding:1rem 0">Không có câu nào khớp</div>' : '';
    return;
  }
  const ICON_SPEAK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const ICON_TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  listEl.innerHTML = items.map(it => {
    const c = it.c, fid = c.font_id || 'ekkamai';
    const fontCls = FC_FONT_CLASS[fid] || FC_FONT_CLASS.ekkamai;
    const note = (it.entry.note || '').trim();
    const date = it.entry.ts ? new Date(it.entry.ts).toLocaleDateString('vi-VN') : '';
    return '<div class="fc-saved-item" data-id="' + escapeHtml(it.id) + '">'
      + '<div class="fc-saved-thai ' + fontCls + '">' + escapeHtml(c.thai_text || '') + '</div>'
      + (c.phonetic ? '<div class="fc-saved-phonetic">' + escapeHtml(c.phonetic) + '</div>' : '')
      + '<div class="fc-saved-detail" style="display:none"></div>'
      + (note ? '<div class="fc-saved-note"><span class="fc-saved-note-label">Ghi chú</span>' + escapeHtml(note) + '</div>' : '')
      + '<div class="fc-saved-meta"><span>' + escapeHtml(FC_FONT_LABEL[fid] || fid) + '</span>' + (date ? '<span>' + date + '</span>' : '') + '</div>'
      + '<div class="fc-saved-actions">'
      +   '<button type="button" class="fc-saved-btn" onclick="fcSavedToggleDetail(\'' + it.id + '\', this)">Xem nghĩa</button>'
      +   '<button type="button" class="fc-saved-btn" onclick="fcOpenNoteEditor(\'' + it.id + '\')">' + (note ? 'Sửa ghi chú' : 'Ghi chú') + '</button>'
      +   '<button type="button" class="fc-saved-btn fc-saved-btn-main" onclick="fcSavedPractice(\'' + it.id + '\')">Luyện lại</button>'
      +   '<span class="fc-saved-actions-spacer"></span>'
      +   '<button type="button" class="fc-saved-icon-btn" onclick="fcSavedSpeak(\'' + it.id + '\', this)" aria-label="Phát âm" title="Phát âm">' + ICON_SPEAK + '</button>'
      +   '<button type="button" class="fc-saved-icon-btn" onclick="fcSavedRemove(\'' + it.id + '\')" aria-label="Bỏ lưu" title="Bỏ lưu">' + ICON_TRASH + '</button>'
      + '</div></div>';
  }).join('');
}

// Nghĩa + điểm cần nhớ chỉ dựng khi bấm "Xem nghĩa" (ẩn sẵn để người dùng tự nhớ trước, giống phần gợi ý).
function fcSavedToggleDetail(id, btn) {
  const item = btn.closest('.fc-saved-item');
  const box = item.querySelector('.fc-saved-detail');
  const open = box.style.display === 'none';
  if (open && !box.dataset.built) {
    const c = fcChallengeById(id);
    box.innerHTML = (c.meaning_vi ? '<div class="fc-saved-meaning">' + escapeHtml(c.meaning_vi) + '</div>' : '<div class="fc-saved-meaning fc-saved-meaning-empty">Câu này chưa có nghĩa tiếng Việt</div>')
      + (fcHtmlHasContent(c.explanation) ? '<div class="fc-saved-explain">' + c.explanation + '</div>' : '');
    const ex = box.querySelector('.fc-saved-explain');
    if (ex) linkifyWordsPlain(ex);
    box.dataset.built = '1';
  }
  box.style.display = open ? '' : 'none';
  btn.textContent = open ? 'Ẩn nghĩa' : 'Xem nghĩa';
}

function fcSavedSpeak(id, btn) {
  const c = fcChallengeById(id);
  if (c) speakText(c.thai_text, btn);
}

async function fcSavedRemove(id) {
  const prev = fcSavedMap[String(id)] ? { note: fcSavedMap[String(id)].note } : { note: '' };
  if (await fcSetSaved(id, false)) showUndoToast('Đã bỏ lưu câu' + (prev.note ? ' và ghi chú' : ''), () => fcSetSaved(id, true, prev.note));
}

// Luyện lại: dùng chế độ luyện riêng (bỏ qua lịch đến hạn), vẫn cập nhật tiến độ SRS khi trả lời như bình thường.
function fcStartPractice(ids, label) {
  if (!ids.length) return;
  closeFcSaved();
  fcFontFilter = null;
  fcPracticeIds = ids.map(String);
  fcPracticeLabel = label || 'câu đã lưu';
  fcBuildQueue();
  fcShowCurrentInQueue();
  fcUpdateFontFilterBanner();
  const card = document.getElementById('fcCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function fcSavedPractice(id) { fcStartPractice([id]); }
function fcSavedPracticeAll() { fcStartPractice(fcSavedFilteredItems().map(it => it.id)); }

function fcShowCurrentInQueue() {
  const doneEl = document.getElementById('fcDoneState');
  const flipWrapEl = document.getElementById('fcFlipWrap');
  if (!fcQueue.length || fcQueueIndex >= fcQueue.length) {
    flipWrapEl.style.display = 'none';
    document.getElementById('fcThaiDisplay').style.display = 'none';
    document.getElementById('fcGuessBox').style.display = 'none';
    document.getElementById('fcReveal').style.display = 'none';
    document.getElementById('fcKeyPointsSection').style.display = 'none';
    document.getElementById('fcAnswerSpeakBtn').style.display = 'none';
    doneEl.style.display = '';
    fcUpdateSaveBtn(true);
    fcUpdateNavArrows();
    return;
  }
  doneEl.style.display = 'none';
  flipWrapEl.style.display = '';
  flipWrapEl.classList.remove('flipped');
  flipWrapEl.classList.remove('fc-review-both');
  document.getElementById('fcAnswerSpeakBtn').style.display = 'none'; // nút loa chỉ hiện sau khi đã xem đáp án
  fcCurrent = fcQueue[fcQueueIndex];

  // Bảo vệ khỏi lỗi "khung trắng không có chữ": nếu câu này vì lý do gì đó (dữ liệu lỗi/thiếu,
  // admin lỡ lưu rỗng...) không có thai_text, KHÔNG hiển thị khung trống im lặng — bỏ qua câu này
  // (xoá khỏi hàng đợi hiện tại) và tự động render sang câu kế tiếp, đồng thời báo lỗi ra console
  // để dễ phát hiện câu nào trong DB đang bị thiếu dữ liệu.
  if (!fcCurrent || !(fcCurrent.thai_text || '').trim()) {
    console.error('Font Challenge: bỏ qua câu thiếu thai_text (id=' + (fcCurrent && fcCurrent.id) + ')');
    fcQueue.splice(fcQueueIndex, 1);
    fcShowCurrentInQueue();
    return;
  }

  // Font hiển thị do ADMIN CHỌN SẴN cho đúng câu này (font_id, xem trang quản trị) — không còn
  // random mỗi lần gặp lại như trước, để admin kiểm soát được đúng mức độ khó cần luyện.
  // Đang luyện riêng 1 font (fcFontFilter) thì MỌI câu đều hiện bằng font đã chọn đó, bất kể font
  // admin gắn sẵn cho câu.
  // 'chanok' (JS Chanok) đã bị bỏ khỏi danh sách Font Challenge — font dự phòng cứng khi chưa có
  // font_id hợp lệ (câu cũ chưa gán font, hoặc font_id trỏ tới 1 font đã bị xoá khỏi pool) đổi sang
  // 'ekkamai'.
  fcCurrentFont = fcFontFilter || fcCurrent.font_id || 'ekkamai';

  const disp = document.getElementById('fcThaiDisplay');
  disp.style.display = '';
  disp.className = 'fc-thai-display ' + (FC_FONT_CLASS[fcCurrentFont] || FC_FONT_CLASS.ekkamai)
    + ((fcCurrent.thai_text || '').length > 30 ? ' fc-long-text' : ''); // câu dài tự thu nhỏ chữ hơn, xem .fc-long-text trong style.css
  disp.textContent = fcCurrent.thai_text || '';

  fcRevealedAlready = false;
  fcCurrentFinished = false;
  fcHintUsedThisQuestion = false;
  document.getElementById('fcGuessBox').style.display = '';
  document.getElementById('fcInput').value = '';
  document.getElementById('fcInput').placeholder = 'Để mình thử xem, trước khi...';
  document.getElementById('fcHintLinkBtn').style.display = '';
  document.getElementById('fcGuessOrSpan').style.display = '';
  document.getElementById('fcReveal').style.display = 'none';
  document.getElementById('fcReveal').innerHTML = '';
  document.getElementById('fcReadingSectionTitle').textContent = 'Bạn đọc được câu này chứ?';
  // Gợi ý (nghĩa tiếng Việt) — ẩn đi mỗi khi sang câu mới, xem fcShowHint().
  const hintEl0 = document.getElementById('fcHintBox');
  hintEl0.style.display = 'none';
  hintEl0.textContent = '';
  document.getElementById('fcKeyPointsSection').style.display = 'none';
  document.getElementById('fcExplainContent').innerHTML = '';
  document.getElementById('fcGrammarRow').style.display = 'none';
  document.getElementById('fcKeyPointActions').style.display = 'none';
  fcSyncFlipHeight();
  fcUpdateNavArrows();
  fcUpdateSaveBtn();

  // SỬA LỖI TRÀN/CHỒNG CHỮ Ở KHUNG CÂU THÁI (xem ảnh chụp màn hình người dùng báo): fcSyncFlipHeight()
  // ở dòng trên đo scrollHeight NGAY khi vừa gán font trang trí (fc-font-...) — nhưng bản thân file
  // @font-face của font trang trí (nhiều dấu thanh/nguyên âm Thái nằm cao-thấp bất thường, xem
  // gen/... pyftsubset) có thể còn đang tải, nên trình duyệt tạm vẽ/đo bằng font dự phòng THẤP hơn
  // hẳn font thật. Khi font trang trí tải xong (không đồng bộ với dòng đo ở trên), chữ vẽ lại CAO
  // hơn nhưng khung .fc-flip-wrap đã lỡ set theo chiều cao đo sai lúc nãy → chữ tràn ra ngoài, đè
  // chồng lên ô đoán từ/ngày tháng bên dưới. document.fonts.ready chỉ đợi đúng lượt tải font vừa
  // kích hoạt bởi dòng gán class phía trên — đo lại 1 lần nữa cho chắc khi nó tải xong, có so lại
  // fcQueueIndex để không đo nhầm nếu người dùng đã bấm sang câu khác trong lúc chờ tải font.
  const fcSyncedQueueIndex = fcQueueIndex;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function() {
      if (fcQueueIndex === fcSyncedQueueIndex) fcSyncFlipHeight();
    });
  }
}

// Đo chiều cao thật của mặt thẻ đang hiện (trước hoặc sau khi lật) rồi set cho khung
// bọc ngoài fc-flip-wrap — vì 2 mặt trước/sau dài ngắn khác nhau (câu hỏi ngắn, đáp án
// có thể dài do thêm ngữ pháp/giải thích), không thể dùng chiều cao cố định như review-card.
//
// SỬA LỖI CHỒNG CHỮ: bản trước đo/set chiều cao bên trong requestAnimationFrame (trễ đúng 1
// khung hình so với lúc lật thẻ + hiện nội dung mục dịch nghĩa bên dưới, vốn chạy NGAY LẬP TỨC
// ở fcFinish()/fcRestoreSnapshot()) — trong đúng 1 khung hình bị trễ đó, trình duyệt có thể vẽ
// ra trạng thái "khung .fc-flip-wrap còn thấp (theo chiều cao CŨ) trong khi nội dung mặt sau
// (đáp án) đã cao hơn hẳn" → nội dung đáp án TRÀN ra ngoài khung, ĐÈ CHỒNG lên mục dịch nghĩa
// vừa hiện ra ngay bên dưới. Đây chính là lỗi chồng chữ trong ảnh chụp màn hình người dùng báo.
// Đọc "scrollHeight" tự động ép trình duyệt tính lại layout ngay khi cần (không cần đợi khung
// hình kế tiếp), nên bỏ hẳn requestAnimationFrame — set chiều cao NGAY trong cùng 1 lượt xử lý
// đồng bộ với việc lật thẻ/hiện nội dung, trình duyệt chỉ vẽ ra đúng 1 trạng thái nhất quán duy
// nhất (hiệu ứng giãn cao 0.35s trong CSS vẫn chạy bình thường, không mất animation).
function fcSyncFlipHeight() {
  const wrap = document.getElementById('fcFlipWrap');
  const inner = document.getElementById('fcFlipInner');
  const front = document.getElementById('fcFlipFront');
  const back = document.getElementById('fcFlipBack');
  if (!wrap || !front || !back || wrap.style.display === 'none') return;
  // Chế độ xem lại "cả 2 mặt" (fc-review-both, xem fcRestoreSnapshot): 2 mặt không còn absolute
  // chồng lên nhau nữa mà xếp dọc bình thường trong .fc-flip-inner — đo chiều cao của CHÍNH
  // .fc-flip-inner (tổng cả 2 mặt cộng lại), không phải riêng 1 mặt như 2 trường hợp còn lại.
  if (wrap.classList.contains('fc-review-both')) {
    wrap.style.height = inner.scrollHeight + 'px';
    return;
  }
  const activeFace = wrap.classList.contains('flipped') ? back : front;
  wrap.style.height = activeFace.scrollHeight + 'px';
}
window.addEventListener('resize', fcSyncFlipHeight);

// Sang câu tiếp theo trong hàng đợi; hết hàng đợi thì xây lại (câu vừa sai/xem đáp án sẽ
// tự quay lại vì due ngay lập tức), nếu vẫn rỗng thì hiển thị trạng thái "đã ôn xong".
// Lưu lại toàn bộ trạng thái hiển thị hiện tại (sau khi đã hoàn tất 1 câu) vào snapshot theo
// index — để lát nữa bấm mũi tên back/next quay lại đúng câu này thì khôi phục ngay, không cần
// làm lại. Gọi ngay sau khi fcFinalizeChallenge() hoàn tất (xem fcFinish()).
function fcCaptureSnapshot() {
  fcAnswerSnapshots[fcQueueIndex] = {
    thaiText: fcCurrent.thai_text || '',
    fontClass: document.getElementById('fcThaiDisplay').className,
    readingTitle: document.getElementById('fcReadingSectionTitle').textContent,
    revealHtml: document.getElementById('fcReveal').innerHTML,
    keyPointsVisible: document.getElementById('fcKeyPointsSection').style.display !== 'none',
    explainHtml: document.getElementById('fcExplainContent').innerHTML,
  };
}

// Khôi phục lại đúng trạng thái đã lưu của câu ở "index" — dùng khi bấm mũi tên back/next để
// xem lại câu đã làm, KHÔNG tính lại điểm/tiến độ (chỉ hiển thị lại, không gọi fcSaveProgress).
function fcRestoreSnapshot(index) {
  const snap = fcAnswerSnapshots[index];
  if (!snap) return false;
  fcQueueIndex = index;
  fcCurrent = fcQueue[index];
  fcCurrentFinished = true;

  document.getElementById('fcDoneState').style.display = 'none';

  const flipWrapEl = document.getElementById('fcFlipWrap');
  flipWrapEl.style.display = '';
  const disp = document.getElementById('fcThaiDisplay');
  disp.style.display = '';
  disp.className = snap.fontClass;
  disp.textContent = snap.thaiText;

  document.getElementById('fcGuessBox').style.display = 'none';
  const hintElR = document.getElementById('fcHintBox');
  hintElR.style.display = 'none';
  hintElR.textContent = '';
  const revealEl = document.getElementById('fcReveal');
  revealEl.innerHTML = snap.revealHtml;
  revealEl.style.display = '';
  // Quay lại xem câu ĐÃ làm: hiện CẢ câu gốc (font khó đọc) LẪN đáp án (đã có sẵn cả bản dịch
  // tiếng Việt trong snap.revealHtml, xem fcRenderReadingReveal) cùng lúc (fc-review-both, xem
  // style.css) — trước đây chỉ lật thẳng sang mặt sau, giờ đổi để dễ đối chiếu "chữ này đọc là
  // gì" hơn khi ôn lại.
  flipWrapEl.classList.remove('flipped');
  flipWrapEl.classList.add('fc-review-both');
  document.getElementById('fcAnswerSpeakBtn').style.display = '';
  document.getElementById('fcReadingSectionTitle').textContent = snap.readingTitle;

  document.getElementById('fcKeyPointsSection').style.display = snap.keyPointsVisible ? '' : 'none';
  document.getElementById('fcExplainContent').innerHTML = snap.explainHtml;
  if (snap.keyPointsVisible) fcRenderKeyPointExtras();

  fcSyncFlipHeight();
  fcUpdateNavArrows();
  fcUpdateSaveBtn();
  return true;
}

// Bật/tắt 2 mũi tên điều hướng: back bật khi câu liền trước đã có snapshot (đã làm xong); next
// bật khi câu liền sau đã có snapshot (đang xem lại lịch sử) HOẶC câu đang xem đã hoàn tất (cho
// phép tiến sang câu MỚI tiếp theo).
function fcUpdateNavArrows() {
  const backBtn = document.getElementById('fcNavBack');
  const nextBtn = document.getElementById('fcNavNext');
  if (!backBtn || !nextBtn) return;
  backBtn.disabled = fcQueueIndex <= 0 || fcAnswerSnapshots[fcQueueIndex - 1] === undefined;
  // Mũi tên › có 2 vai: câu ĐANG LÀM (chưa trả lời/xem đáp án) -> "Bỏ qua câu này" (thế chỗ nút chữ
  // cũ, xem fcSkipQuestion); câu đã hoàn tất/đang xem lại -> "Câu tiếp theo" như trước.
  const canSkip = !fcCurrentFinished && fcAnswerSnapshots[fcQueueIndex] === undefined
    && fcQueue.length > 0 && fcQueueIndex < fcQueue.length;
  nextBtn.disabled = !(canSkip
    || fcAnswerSnapshots[fcQueueIndex + 1] !== undefined
    || fcAnswerSnapshots[fcQueueIndex] !== undefined);
  const nextLabel = canSkip ? 'Bỏ qua câu này' : 'Câu tiếp theo';
  nextBtn.setAttribute('aria-label', nextLabel);
  nextBtn.setAttribute('data-tooltip', nextLabel);
}

function fcGoBack() {
  if (fcQueueIndex <= 0) return;
  fcRestoreSnapshot(fcQueueIndex - 1);
}

// allowSkip = true CHỈ khi bấm trực tiếp mũi tên › (onclick trong index.html): câu chưa làm thì
// bỏ qua sang câu khác. Phím mũi tên/phím cách/vuốt trái gọi fcGoNext() KHÔNG tham số nên vẫn
// giữ hành vi cũ (câu chưa làm thì không làm gì) — tránh lỡ tay bỏ qua câu khi bấm phím cách hay
// vuốt nhầm.
function fcGoNext(allowSkip) {
  const nextIndex = fcQueueIndex + 1;
  if (fcAnswerSnapshots[nextIndex] !== undefined) {
    // Câu kế tiếp đã từng làm xong trong phiên này (đang xem lại lịch sử) -> khôi phục ngay.
    fcRestoreSnapshot(nextIndex);
    return;
  }
  if (fcAnswerSnapshots[fcQueueIndex] === undefined) {
    // Câu đang xem chưa hoàn tất: chỉ bỏ qua khi bấm nút và câu CHƯA trả lời/xem đáp án.
    if (allowSkip === true && !fcCurrentFinished) fcSkipQuestion();
    return;
  }
  fcQueueIndex = nextIndex;
  if (fcQueueIndex >= fcQueue.length) fcBuildQueue();
  fcShowCurrentInQueue();
}

function fcShowAnswer() {
  fcRevealedAlready = true;
  fcFinish('none', 0, null, true);
}

// "Bỏ qua câu này" (giờ do mũi tên › ở hàng tiêu đề đảm nhiệm khi câu chưa làm — xem fcGoNext/
// fcUpdateNavArrows) — KHÔNG tính đúng/sai, không đụng tới SRS/skill của câu này (khác hẳn
// fcShowAnswer() vốn TÍNH LÀ ĐÃ XEM ĐÁP ÁN). Chỉ đơn giản đi sang câu kế tiếp trong hàng đợi —
// câu bị bỏ qua vẫn còn nguyên trong fcQueue, không xoá/không đẩy xuống cuối (tránh làm lệch chỉ
// số fcAnswerSnapshots vốn tham chiếu theo đúng vị trí trong fcQueue, dùng cho nút quay lại/tiến
// tới xem lại lịch sử phiên) — sẽ tự gặp lại câu này vào phiên ôn tập sau theo đúng lịch SRS
// bình thường (không sớm hơn, không muộn hơn vì bỏ qua).
function fcSkipQuestion() {
  if (!fcQueue.length || fcQueueIndex >= fcQueue.length) return;
  if (fcHintTimerInterval) clearInterval(fcHintTimerInterval);
  fcQueueIndex++;
  if (fcQueueIndex >= fcQueue.length) fcBuildQueue();
  fcShowCurrentInQueue();
}

async function fcSubmitAnswer() {
  const val = document.getElementById('fcInput').value.trim();
  if (!val) { showToast('⚠️ Nhập câu bạn đọc được'); return; }
  if (fcRevealedAlready) {
    fcFinish('none', 0, fcDiff(val, fcCurrent.thai_text || '').diffHtml, true);
    return;
  }
  const { score, diffHtml } = fcDiff(val, fcCurrent.thai_text || '');
  let result, xp;
  if (score >= 0.95) { result = 'full'; xp = 10; }
  else if (score >= 0.6) { result = 'partial'; xp = 5; }
  else { result = 'none'; xp = 0; }
  fcFinish(result, xp, diffHtml, false);
}

function fcNormalize(s) {
  return (s || '').replace(/\s+/g, '');
}

// Diff LCS ký tự đơn giản: trả về điểm khớp (0-1) và HTML tô đỏ phần người dùng gõ sai/thiếu
function fcDiff(userText, correctText) {
  const a = [...fcNormalize(userText)];
  const bNorm = [...fcNormalize(correctText)];
  const m = a.length, n = bNorm.length;
  if (!n) return { score: 0, diffHtml: escapeHtml(correctText) };
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === bNorm[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  const score = dp[m][n] / n;
  const matchedInB = new Array(n).fill(false);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === bNorm[j-1]) { matchedInB[j-1] = true; i--; j--; }
    else if (dp[i-1][j] >= dp[i][j-1]) i--;
    else j--;
  }

  // Ánh xạ kết quả so khớp (theo ký tự đã bỏ khoảng trắng) về từng ký tự gốc của correctText.
  const origChars = [...correctText];
  let bIdx = 0;
  const matchedByOrigIdx = origChars.map(ch => {
    if (/\s/.test(ch)) return true;
    const matched = matchedInB[bIdx];
    bIdx++;
    return matched;
  });

  // Tô đỏ theo NGUYÊN CẢ TỪ (segment, dùng chung segmentThai() với chỗ khác trong app) nếu có bất
  // kỳ ký tự nào trong từ đó sai, ĐỒNG THỜI dựng link tra từ cho từ nào có trong từ điển — nhưng
  // KHÔNG chèn thêm dấu cách giữa các segment nữa (khác bản trước khi bỏ "tách từ tự động"): giữ
  // đúng khoảng trắng có sẵn trong văn bản gốc (seg.isSpace), không tự thêm.
  const segments = segmentThai(correctText);
  let pos = 0;
  let diffHtml = '';
  segments.forEach(seg => {
    if (seg.isSpace) {
      diffHtml += seg.thai;
      pos += seg.thai.length;
      return;
    }
    const segStart = pos;
    const segLen = seg.thai.length;
    const hasError = Array.from({ length: segLen }, (_, k) => matchedByOrigIdx[segStart + k]).some(ok => ok === false);
    const escaped = escapeHtml(seg.thai);
    const matched = allWords.find(w => w.thai === seg.thai);
    const cls = matched ? ('def-word-link' + (hasError ? ' fc-diff-char-miss' : '')) : (hasError ? 'fc-diff-char-miss' : '');
    if (matched) {
      diffHtml += '<span class="' + cls + '" onclick="event.stopPropagation(); onDefWordClick(' + matched.id + ')" ondblclick="event.stopPropagation(); onDefWordDblClick(' + matched.id + ')" title="Nhấp để xem nghĩa · Nhấp đúp để mở tab mới">' + escaped + '</span>';
    } else {
      diffHtml += cls ? ('<span class="' + cls + '">' + escaped + '</span>') : escaped;
    }
    pos += segLen;
  });

  return { score, diffHtml };
}

let fcPendingResult = null;
let fcPendingXp = 0;
let fcPendingRevealed = false;

function fcFinish(result, xp, diffHtml, revealed) {
  document.getElementById('fcGuessBox').style.display = 'none';
  const hintElF = document.getElementById('fcHintBox');
  hintElF.style.display = 'none';
  hintElF.textContent = '';
  fcPendingResult = result;
  fcPendingXp = xp;
  fcPendingRevealed = !!revealed;
  fcCurrentFinished = true;
  fcUpdateNavArrows(); // khoá › cho tới khi lưu xong + có snapshot (tránh "bỏ qua" nhầm giữa chừng)
  fcRenderReadingReveal(result, xp, diffHtml);
  document.getElementById('fcFlipWrap').classList.remove('fc-review-both');
  document.getElementById('fcFlipWrap').classList.add('flipped');
  document.getElementById('fcReadingSectionTitle').textContent = 'Hoá ra là đọc như này!';
  document.getElementById('fcAnswerSpeakBtn').style.display = ''; // đáp án đã hiện, giờ mới cho phát âm
  fcSyncFlipHeight();
  // Mục "hiểu nghĩa" (bước dịch riêng) đã bỏ — nghĩa tiếng Việt giờ chỉ dùng làm gợi ý xem TRƯỚC
  // lúc đang đoán (fcShowHint()), không còn là bước bắt buộc sau khi đọc xong. Hiện luôn "Điểm
  // cần nhớ" rồi lưu tiến độ ngay khi đáp án đã hiện.
  fcRevealKeyPoints();
  fcFinalizeChallenge();
}

// 3 icon line thay cho emoji cũ (🎉/👍/📖) ở badge kết quả phần đọc chữ.
const FC_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const FC_ICON_THUMB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>';

// Dòng "Font: <tên font>" nhỏ ở mặt đáp án — chỉ hiện ở chế độ bình thường (mỗi câu 1 font do admin
// gắn), để người dùng biết tên font vừa đọc mà tìm luyện riêng. Bấm vào tên font → chuyển thẳng sang
// "Luyện theo font cụ thể" với font đó (tiến độ câu vừa làm đã lưu xong ở fcFinalizeChallenge nên
// không mất). Đang luyện riêng (fcFontFilter) thì ẨN vì banner phía trên đã ghi tên font rồi.
// Nằm trong fcReveal nên tự đi theo snapshot (fcCaptureSnapshot/fcRestoreSnapshot) khi xem lại câu.
function fcBuildFontNameHtml() {
  if (fcFontFilter || !fcCurrentFont || !/^[\w-]+$/.test(fcCurrentFont)) return '';
  const label = FC_FONT_LABEL[fcCurrentFont] || fcCurrentFont;
  // Chip nhỏ nằm trong GÓC TRÊN PHẢI khung đáp án (không còn dòng "Font: …" riêng bên dưới khung) — xem .fc-answer-font-chip + .fc-answer-box.has-font-chip.
  return '<button type="button" class="fc-answer-font-chip" data-tooltip="Luyện riêng font này"'
    + ' onclick="event.stopPropagation(); fcSelectFontToPractice(\'' + fcCurrentFont + '\')">'
    + escapeHtml(label) + '</button>';
}

// Hiện kết quả phần ĐỌC CHỮ (không gồm Nghĩa) — Nghĩa được tách thành bước riêng bên dưới
// để người dùng tự dịch trước khi xem đáp án.
function fcRenderReadingReveal(result, xp, diffHtml) {
  const el = document.getElementById('fcReveal');
  // Chỉ hiện badge khi có kết quả tính điểm rõ ràng (đúng hẳn/gần đúng) — trường hợp "xem đáp án"
  // hoặc "chưa khớp" KHÔNG còn hiện badge "Đáp án"/"Chưa khớp — xem đáp án bên dưới nhé" nữa
  // (bỏ theo yêu cầu, giữ giao diện gọn hơn — câu đúng tự nó đã đủ rõ ràng bên dưới). Đã bỏ luôn
  // "+ N XP" khỏi badge vì không còn hiển thị XP ở đâu khác trong giao diện nữa.
  const badgeHtml = result === 'full' ? ('<span class="fc-result-badge fc-result-full">' + FC_ICON_CHECK + ' Chính xác hoàn toàn!</span>')
    : result === 'partial' ? ('<span class="fc-result-badge fc-result-partial">' + FC_ICON_THUMB + ' Gần đúng rồi!</span>')
    : '';

  // Gộp câu đúng + phiên âm vào 1 khung duy nhất — bỏ nhãn "Câu đúng" phía trên (đã đủ rõ nhờ
  // ngữ cảnh, không cần nhãn), căn giữa toàn khung cho gọn (xem .fc-answer-box trong style.css).
  // Chữ sai tô đỏ (không gạch ngang, xem .fc-diff-char-miss) để vẫn bấm tra được bình thường.
  // Tag ngữ pháp (grammar_point) đã bỏ khỏi màn hình chính theo yêu cầu rút gọn giao diện —
  // dữ liệu vẫn được lưu ở admin, chỉ không hiển thị ở đây nữa.
  const fontChipHtml = fcBuildFontNameHtml();
  el.innerHTML =
    badgeHtml +
    '<div class="fc-answer-box' + (fontChipHtml ? ' has-font-chip' : '') + '">' +
      fontChipHtml +
      '<div class="fc-correct-text" id="fcCorrectTextEl">' + (diffHtml || '') + '</div>' +
      (fcCurrent.phonetic ? '<div class="fc-answer-phonetic">' + escapeHtml(fcCurrent.phonetic) + '</div>' : '') +
      (fcCurrent.meaning_vi ? '<div class="fc-answer-translation">' + escapeHtml(fcCurrent.meaning_vi) + '</div>' : '') +
    '</div>';
  el.style.display = '';

  const correctEl = document.getElementById('fcCorrectTextEl');
  if (correctEl && !diffHtml) {
    correctEl.textContent = fcCurrent.thai_text || '';
    linkifyWordsPlain(correctEl);
  }
  // "Điểm cần nhớ của câu này" giờ KHÔNG hiện ở bước này nữa — chuyển sang hiện sau khi người
  // dùng hoàn tất bước dịch nghĩa (gửi bản dịch hoặc bấm "Bỏ qua"), xem fcRevealKeyPoints().
}

// Hiện "Điểm cần nhớ của câu này" (trước đây gọi "Khám phá") — chỉ gọi SAU KHI người dùng đã
// hoàn tất bước dịch nghĩa (gửi bản dịch hoặc bấm "Bỏ qua"), không còn hiện ngay lúc đọc xong.
function fcRevealKeyPoints() {
  const keyPointsSection = document.getElementById('fcKeyPointsSection');
  const explainContentEl = document.getElementById('fcExplainContent');
  const hasExplain = fcHtmlHasContent(fcCurrent.explanation);
  if (hasExplain) {
    explainContentEl.innerHTML = fcCurrent.explanation;
    linkifyWordsPlain(explainContentEl);
  } else {
    explainContentEl.innerHTML = '';
  }
  // Có điểm ngữ pháp mà admin chưa viết giải thích vẫn hiện mục này (chỉ với hàng ngữ pháp + nút luyện cùng điểm).
  keyPointsSection.style.display = (hasExplain || fcCurrent.grammar_point) ? '' : 'none';
  fcRenderKeyPointExtras();
}

// ── Điểm cần nhớ: hàng ngữ pháp + 2 nút hành động ──────────────────
// Thống kê theo điểm ngữ pháp của người dùng (bảng font_challenge_grammar_stats, đã được fcUpdateGrammarStats() ghi mỗi lần trả lời).
// Chỉ có khi đã đăng nhập; cache theo grammar_point, cập nhật ngay khi vừa ghi để lần xem đầu không bị thiếu lượt vừa làm.
var fcGrammarStatsCache = {};

function fcKeyPointPlainText() {
  // HTML giải thích → chữ thường: xuống dòng theo đoạn/mục, gạch đầu dòng "• " cho từng <li>.
  const tmp = document.createElement('div');
  tmp.innerHTML = fcCurrent.explanation || '';
  tmp.querySelectorAll('li').forEach(li => li.insertBefore(document.createTextNode('• '), li.firstChild));
  tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  tmp.querySelectorAll('p, div, li, h1, h2, h3, h4, ul, ol').forEach(el => el.appendChild(document.createTextNode('\n')));
  return (tmp.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fcRenderKeyPointExtras() {
  const row = document.getElementById('fcGrammarRow');
  const actions = document.getElementById('fcKeyPointActions');
  const practiceBtn = document.getElementById('fcGrammarPracticeBtn');
  const copyBtn = document.getElementById('fcCopyToNoteBtn');
  if (!row || !fcCurrent) return;
  const gp = fcCurrent.grammar_point || '';
  if (gp) {
    row.innerHTML = '<span class="fc-grammar-chip">Ngữ pháp · ' + escapeHtml(gp) + '</span><span class="fc-grammar-stats" id="fcGrammarStats"></span>';
    row.style.display = '';
    fcRenderGrammarStatsText();
    if (isLoggedIn() && !fcGrammarStatsCache[gp]) fcLoadGrammarStats(gp);
  } else {
    row.innerHTML = '';
    row.style.display = 'none';
  }
  // Nút luyện: các câu KHÁC cùng điểm ngữ pháp (không tính câu đang xem).
  const sameIds = gp ? fcChallenges.filter(c => c.grammar_point === gp && String(c.id) !== String(fcCurrent.id)).map(c => c.id) : [];
  practiceBtn.style.display = sameIds.length ? '' : 'none';
  practiceBtn.textContent = 'Luyện ' + sameIds.length + ' câu cùng điểm này';
  // Nút chép vào ghi chú: chỉ khi admin có viết giải thích.
  copyBtn.style.display = fcHtmlHasContent(fcCurrent.explanation) ? '' : 'none';
  actions.style.display = (sameIds.length || fcHtmlHasContent(fcCurrent.explanation)) ? '' : 'none';
}

async function fcLoadGrammarStats(gp) {
  try {
    const rows = await sbGetAuth('font_challenge_grammar_stats?select=times_practiced,times_full&user_id=eq.' + session.user.id + '&grammar_point=eq.' + encodeURIComponent(gp));
    if (Array.isArray(rows) && rows[0]) fcGrammarStatsCache[gp] = rows[0];
  } catch (e) { /* không có thống kê thì thôi, không ảnh hưởng phần còn lại */ }
  fcRenderGrammarStatsText();
}

function fcRenderGrammarStatsText() {
  const el = document.getElementById('fcGrammarStats');
  if (!el || !fcCurrent) return;
  const st = fcGrammarStatsCache[fcCurrent.grammar_point || ''];
  el.textContent = st && st.times_practiced ? 'Bạn đã luyện ' + st.times_practiced + ' lần · đúng hoàn toàn ' + (st.times_full || 0) + ' lần' : '';
}

function fcPracticeSameGrammar() {
  if (!fcCurrent || !fcCurrent.grammar_point) return;
  const gp = fcCurrent.grammar_point;
  const ids = fcChallenges.filter(c => c.grammar_point === gp && String(c.id) !== String(fcCurrent.id)).map(c => c.id);
  fcStartPractice(ids, 'điểm ngữ pháp "' + gp + '"');
}

// Chép điểm cần nhớ vào ghi chú cá nhân của câu (tự lưu câu nếu chưa lưu), nối vào cuối ghi chú cũ nếu có, rồi mở ô ghi chú để người dùng sửa lại.
async function fcCopyKeyPointToNote() {
  if (!fcCurrent || !fcHtmlHasContent(fcCurrent.explanation)) return;
  const id = String(fcCurrent.id);
  const gp = fcCurrent.grammar_point || '';
  const chunk = 'Điểm cần nhớ' + (gp ? ' — ' + gp : '') + ':\n' + fcKeyPointPlainText();
  const prev = (fcSavedMap[id] && fcSavedMap[id].note) || '';
  if (prev.includes(chunk)) { showToast('Điểm này đã có trong ghi chú'); fcOpenNoteEditor(id); return; }
  let note = prev ? prev.replace(/\s+$/, '') + '\n\n' + chunk : chunk;
  if (note.length > FC_NOTE_MAX) { note = note.slice(0, FC_NOTE_MAX - 1) + '…'; showToast('Ghi chú dài quá nên đã được cắt bớt'); }
  if (!(await fcSetSaved(id, true, note))) return;
  fcOpenNoteEditor(id);
}

// Kiểm tra 1 chuỗi HTML (từ rich-text editor) có nội dung thật sự hay chỉ là thẻ rỗng
// (vd "<p><br></p>") — tránh hiện tiêu đề "Khám phá" khi admin chưa nhập gì.
function fcHtmlHasContent(html) {
  if (!html) return false;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').replace(/\u00a0/g, ' ').trim().length > 0;
}

// Gợi ý = accordion 3 mục hỗ trợ đọc câu, theo đúng thiết kế mẫu: khung ngoài có hàng tiêu đề
// "Xem gợi ý" (bấm để thu/mở cả khối), bên trong là danh sách 3 mục nối liền nhau (không phải 3
// thẻ rời) — mỗi mục bấm vào MỞ RỘNG xem nội dung ngay tại chỗ (accordion, chỉ 1 mục mở cùng lúc):
// (1) Nghe phát âm — mở ra có nút Play + timer đếm giờ thật lúc đang đọc (TTS, bấm lại vẫn phát
//     lại được); (2) Phiên âm — mở ra hiện chữ phiên âm (field "phonetic" của câu); (3) Bản dịch
//     — mở ra hiện nghĩa tiếng Việt.
let fcHintTimerInterval = null;

function fcSpeakChallengeHint(itemEl) {
  if (!fcCurrent || !fcCurrent.thai_text) return;
  speakText(fcCurrent.thai_text, itemEl); // gắn "playing" lên itemEl (không phải nút Play) để
    // .fc-hint-item.playing kích hoạt animation vạch sóng âm — xem CSS .fc-wave-bar
  const timeEl = itemEl.querySelector('.fc-hint-audio-time');
  if (!timeEl) return;
  if (fcHintTimerInterval) clearInterval(fcHintTimerInterval);
  let elapsedMs = 0;
  timeEl.textContent = '0:00';
  fcHintTimerInterval = setInterval(() => {
    if (!speechSynthesis.speaking) { clearInterval(fcHintTimerInterval); return; }
    elapsedMs += 200;
    const s = Math.floor(elapsedMs / 1000);
    timeEl.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 200);
}

// Accordion: bấm vào tiêu đề 1 mục để mở/đóng — chỉ 1 mục mở tại 1 thời điểm (đóng các mục khác
// đang mở trước đó), khớp đúng hành vi trong ảnh mẫu.
function fcToggleHintItem(headEl) {
  const itemEl = headEl.closest('.fc-hint-item');
  const wasOpen = itemEl.classList.contains('open');
  itemEl.parentElement.querySelectorAll('.fc-hint-item.open').forEach(el => el.classList.remove('open'));
  itemEl.classList.toggle('open', !wasOpen);
  fcSyncFlipHeight();
}

// Bấm hàng tiêu đề "Xem gợi ý" trên cùng để thu/mở toàn bộ danh sách 3 mục (không hiện/ẩn cả
// khung — khung vẫn còn đó, chỉ thu gọn danh sách bên trong).
function fcToggleHintBox() {
  document.getElementById('fcHintBox').classList.toggle('collapsed');
  fcSyncFlipHeight();
}

function fcShowHint() {
  fcHintUsedThisQuestion = true; // tín hiệu "đang gặp khó" — dùng để hạ nhẹ skill khi hoàn tất câu, xem fcComputeSkillDelta
  // Đã xem gợi ý: đổi placeholder gợi ý đổi hướng ("thử LẠI" thay vì "thử xem" lần đầu) + ẩn
  // luôn nút "Xem gợi ý" và chữ "hoặc" — chỉ còn "Xem đáp án" (đã xem gợi ý thì không cần bấm
  // gợi ý lại nữa, chỉ còn lựa chọn thử lại hoặc xem đáp án).
  document.getElementById('fcInput').placeholder = 'Bạn thử lại xem sao, trước khi...';
  document.getElementById('fcHintLinkBtn').style.display = 'none';
  document.getElementById('fcGuessOrSpan').style.display = 'none';
  const hintEl = document.getElementById('fcHintBox');
  hintEl.classList.remove('collapsed'); // luôn mở sẵn khi vừa bấm "Xem gợi ý", tránh giữ trạng
    // thái "đã thu gọn" sót lại từ câu trước (đóng bên trong .fc-hint-box lúc innerHTML rebuild)
  const phonetic = fcCurrent.phonetic ? escapeHtml(fcCurrent.phonetic) : 'Câu này chưa có phiên âm';
  const meaning = fcCurrent.meaning_vi ? escapeHtml(fcCurrent.meaning_vi) : 'Câu này chưa có nghĩa tiếng Việt';
  // 20 vạch sóng âm minh họa (trang trí, không đồng bộ biên độ thật với giọng đọc — Web Speech
  // API không cho phép đọc dữ liệu âm thanh thô để vẽ dạng sóng thật).
  const waveBars = Array.from({ length: 20 }, (_, i) => '<span class="fc-wave-bar" style="height:' + (30 + (i * 37) % 70) + '%"></span>').join('');
  hintEl.innerHTML =
    '<button type="button" class="fc-hint-header" onclick="fcToggleHintBox()">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' +
      '<span class="fc-hint-header-text">Xem gợi ý</span>' +
      '<svg class="fc-hint-header-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
    '</button>' +
    '<div class="fc-hint-list">' +
      '<div class="fc-hint-item open">' +
        '<button type="button" class="fc-hint-item-head" onclick="fcToggleHintItem(this)">' +
          '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="m18.8289 9.14289 -0.31 -0.41c-0.33 -0.3 -0.8 -0.12 -0.78 0.16 0 0.08 0 0.19 0.1 0.26 0.31 0.3 0.12 0.18 0.22 0.36 0.27 0.90001 0.34 3.00001 -0.52 3.72001 -0.0727 0.0611 -0.1206 0.1467 -0.1347 0.2406 -0.0141 0.094 0.0065 0.1898 0.0581 0.2696 0.0516 0.0798 0.1305 0.138 0.2219 0.1638 0.0914 0.0257 0.1891 0.0172 0.2747 -0.024 0.3923 -0.2334 0.7301 -0.548 0.9908 -0.9227 0.2607 -0.3747 0.4382 -0.8008 0.5206 -1.2498 0.0824 -0.4489 0.0678 -0.9103 -0.0428 -1.3531 -0.1107 -0.44288 -0.3147 -0.85694 -0.5986 -1.21441Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M22.1193 5.62265c-0.12 -0.17002 -1.6501 -1.70015 -1.8801 -1.05009 -0.4901 0.39003 0.69 0.68005 1.1501 1.51012 0.5841 1.10247 0.9764 2.29627 1.1601 3.5303 0.64 3.71032 -0.8701 6.61052 -3.2803 7.87072 -0.046 0.0229 -0.087 0.0547 -0.1206 0.0936 -0.0337 0.0388 -0.0594 0.0839 -0.0757 0.1326 -0.0162 0.0488 -0.0227 0.1003 -0.0191 0.1515 0.0037 0.0513 0.0174 0.1013 0.0404 0.1473 0.023 0.046 0.0548 0.087 0.0936 0.1206 0.0388 0.0337 0.0839 0.0594 0.1327 0.0756 0.0487 0.0163 0.1002 0.0228 0.1515 0.0191 0.0512 -0.0036 0.1013 -0.0173 0.1472 -0.0403 4.8904 -2.3102 5.6305 -8.1107 2.5002 -12.56105Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.7986 3.41247C11.8985 1.01226 6.428 5.92268 5.07789 8.77292c-0.05873 -0.04048 -0.1287 -0.06147 -0.20002 -0.06C1.99763 8.66291 -0.772608 10.9431 0.197474 13.8434c0.192479 0.5909 0.541458 1.1187 1.009856 1.5272 0.4684 0.4086 1.03872 0.6826 1.65037 0.793 0.49897 0.1146 1.00829 0.1783 1.52013 0.19 2.21019 -0.11 2.00017 -0.21 1.26011 -6.44058 -0.06001 -0.34003 -0.75007 -0.41003 -0.65006 0.40008 0.14445 1.5935 0.14445 3.1968 0 4.7904 -0.36003 -0.05 -0.08001 0 -1.25011 -0.09l-1.00008 -0.2701c-1.49013 -0.55 -2.430206 -3.1702 0.18002 -4.6604 1.74014 -1.00005 2.25019 -0.07 3.00025 -1.34008 1.21831 -1.81787 2.85846 -3.31391 4.78044 -4.36037 0.59 -0.31003 1.7801 -0.82007 2.1702 -0.27002 1 1.38012 1.2501 12.41107 0.06 15.07127 -0.3401 0.7601 -0.8101 1.2101 -1.6102 1.0001 -1.2201 -0.32 -3.64029 -2.1602 -5.00041 -3.6903 -0.06896 -0.0822 -0.16776 -0.1337 -0.27466 -0.1431 -0.10691 -0.0094 -0.21316 0.0241 -0.29538 0.0931 -0.08223 0.0689 -0.13369 0.1677 -0.14307 0.2746 -0.00937 0.1069 0.0241 0.2132 0.09306 0.2954 1.14345 1.3186 2.46649 2.4699 3.93034 3.4203 0.36287 0.3069 0.78672 0.5333 1.24352 0.6644 0.4569 0.131 0.9363 0.1636 1.4067 0.0957 1.6801 -0.4301 2.1702 -2.7002 2.4102 -4.4204 0.31 -2.6402 0.7201 -11.25095 -0.8901 -13.36113Z" clip-rule="evenodd"/></svg>' +
          '<div class="fc-hint-item-text"><div class="fc-hint-item-title">Nghe phát âm</div><div class="fc-hint-item-desc">Nghe người bản xứ đọc câu bằng giọng chuẩn Thái.</div></div>' +
          '<svg class="fc-hint-item-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
        '<div class="fc-hint-item-body">' +
          '<div class="fc-hint-audio-row">' +
            '<button type="button" class="fc-hint-play-btn" onclick="event.stopPropagation(); fcSpeakChallengeHint(this.closest(\'.fc-hint-item\'))" aria-label="Phát âm"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg></button>' +
            '<span class="fc-hint-waveform">' + waveBars + '</span>' +
            '<span class="fc-hint-audio-time">0:00</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="fc-hint-item">' +
        '<button type="button" class="fc-hint-item-head" onclick="fcToggleHintItem(this)">' +
          '<span class="fc-hint-aa-icon" aria-hidden="true">Aa</span>' +
          '<div class="fc-hint-item-text"><div class="fc-hint-item-title">Phiên âm</div><div class="fc-hint-item-desc">Xem cách đọc bằng chữ cái Latin.</div></div>' +
          '<svg class="fc-hint-item-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
        '<div class="fc-hint-item-body"><div class="fc-hint-item-value">' + phonetic + '</div></div>' +
      '</div>' +
      '<div class="fc-hint-item">' +
        '<button type="button" class="fc-hint-item-head" onclick="fcToggleHintItem(this)">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>' +
          '<div class="fc-hint-item-text"><div class="fc-hint-item-title">Bản dịch</div><div class="fc-hint-item-desc">Xem nghĩa tiếng Việt của câu.</div></div>' +
          '<svg class="fc-hint-item-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
        '<div class="fc-hint-item-body"><div class="fc-hint-item-value fc-hint-item-value-vi">' + meaning + '</div></div>' +
      '</div>' +
    '</div>';
  hintEl.style.display = '';
  fcSyncFlipHeight();
}

async function fcFinalizeChallenge(translationFailed) {
  await fcSaveProgress(fcPendingResult, fcPendingXp, fcPendingRevealed, translationFailed);
  fcCaptureSnapshot();
  fcUpdateNavArrows();
}

// Cập nhật tiến độ ôn tập kiểu Leitner cho riêng câu vừa trả lời (dùng chung SRS_INTERVAL_DAYS
// với Flashcard Yêu thích): full -> box+1 (hẹn xa hơn), partial -> giữ nguyên box,
// sai/xem đáp án -> về box 1. Nếu người dùng tự đánh giá dịch nghĩa "Chưa đúng"
// (translationFailed=true), box cũng bị ép về 1 bất kể kết quả đọc chữ ra sao.
async function fcSaveProgress(result, xp, revealed, translationFailed) {
  const c = fcCurrent;
  if (!c) return;
  const prev = fcProgressMap[c.id] || { box: 1, due: Date.now(), timesSeen: 0, timesRevealed: 0 };
  let newBox = result === 'full' ? Math.min(5, (prev.box || 1) + 1)
    : result === 'partial' ? (prev.box || 1)
    : 1;
  if (translationFailed) newBox = 1;
  const intervalDays = SRS_INTERVAL_DAYS[newBox] || 0;
  const newDue = Date.now() + intervalDays * 86400000;
  const entry = {
    box: newBox, due: newDue, lastFont: fcCurrentFont,
    timesSeen: (prev.timesSeen || 0) + 1,
    timesRevealed: (prev.timesRevealed || 0) + (revealed ? 1 : 0)
  };
  fcProgressMap[c.id] = entry;

  // Cập nhật "trình độ" thích ứng (chạy ngầm, không hiển thị cho người dùng) — nhích nhẹ theo
  // từng câu dựa trên kết quả đọc + có bấm "Xem gợi ý" hay không, dùng để tính lại tỉ lệ
  // Dễ/Vừa/Khó/Rất khó cho các câu MỚI ở phiên chơi kế tiếp (fcComputeLevelWeights).
  fcSkillScore = Math.max(0, Math.min(1, fcSkillScore + fcComputeSkillDelta(result, revealed, fcHintUsedThisQuestion)));

  if (isLoggedIn()) {
    try {
      await sbPostAuth('font_challenge_progress', {
        user_id: session.user.id, challenge_id: c.id,
        box_level: entry.box, next_due: new Date(entry.due).toISOString(),
        last_font_id: entry.lastFont, times_seen: entry.timesSeen, times_revealed: entry.timesRevealed,
        result, xp_earned: xp
      }, 'user_id,challenge_id');
      await fcUpdateStatsServer(xp);
      if (c.grammar_point) await fcUpdateGrammarStats(c.grammar_point, result, xp);
    } catch (e) { /* im lặng, không chặn trải nghiệm nếu lưu lỗi */ }
  } else {
    try {
      localStorage.setItem('fc_progress_map', JSON.stringify(fcProgressMap));
      localStorage.setItem('fc_skill_score', String(fcSkillScore));
    } catch (e) {}
  }
}

// Mức tăng/giảm "trình độ" sau MỖI câu — nhỏ và tăng dần đều (không giật cục chỉ vì 1 câu may/
// rủi). "Xem đáp án" (bỏ cuộc hẳn, không thử) trừ nặng nhất; bấm "Xem gợi ý" trừ thêm dù sau đó
// có đọc đúng hay không, đúng theo yêu cầu: hay bấm gợi ý = đang đuối, tự hạ độ khó dần.
function fcComputeSkillDelta(result, revealed, hintUsed) {
  let delta;
  if (revealed) delta = -0.03;
  else if (result === 'full') delta = 0.03;
  else if (result === 'partial') delta = 0.012;
  else delta = -0.01;
  if (hintUsed) delta -= 0.02;
  return delta;
}

async function fcUpdateStatsServer(xp) {
  const rows = await sbGetAuth('font_challenge_stats?select=*&user_id=eq.' + session.user.id);
  const prev = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const dayIndex = Number(fcDayKey);
  let streak = 1;
  if (prev && prev.last_day_key !== undefined && prev.last_day_key !== null) {
    const lastDay = Number(prev.last_day_key);
    if (lastDay === dayIndex) streak = prev.current_streak || 1;
    else if (lastDay === dayIndex - 1) streak = (prev.current_streak || 0) + 1;
    else streak = 1;
  }
  const totalXp = (prev ? (prev.total_xp || 0) : 0) + xp;
  const longest = Math.max(streak, prev ? (prev.longest_streak || 0) : 0);
  await sbPostAuth('font_challenge_stats', {
    user_id: session.user.id, total_xp: totalXp, current_streak: streak, longest_streak: longest, last_day_key: fcDayKey,
    difficulty_skill: fcSkillScore
  }, 'user_id');
}

// Thống kê XP/số lần luyện riêng theo từng điểm ngữ pháp -> dùng để sau này hiển thị
// "đã nắm vững điểm ngữ pháp nào" (ví dụ: times_full cao so với times_practiced).
async function fcUpdateGrammarStats(grammarPoint, result, xp) {
  try {
    const rows = await sbGetAuth('font_challenge_grammar_stats?select=*&user_id=eq.' + session.user.id + '&grammar_point=eq.' + encodeURIComponent(grammarPoint));
    const prev = Array.isArray(rows) && rows[0] ? rows[0] : null;
    await sbPostAuth('font_challenge_grammar_stats', {
      user_id: session.user.id, grammar_point: grammarPoint,
      total_xp: (prev ? (prev.total_xp || 0) : 0) + xp,
      times_practiced: (prev ? (prev.times_practiced || 0) : 0) + 1,
      times_full: (prev ? (prev.times_full || 0) : 0) + (result === 'full' ? 1 : 0),
      times_partial: (prev ? (prev.times_partial || 0) : 0) + (result === 'partial' ? 1 : 0),
      last_practiced: new Date().toISOString()
    }, 'user_id,grammar_point');
    fcGrammarStatsCache[grammarPoint] = { times_practiced: (prev ? (prev.times_practiced || 0) : 0) + 1, times_full: (prev ? (prev.times_full || 0) : 0) + (result === 'full' ? 1 : 0) };
    fcRenderGrammarStatsText();
  } catch (e) { /* không chặn trải nghiệm nếu lưu thống kê ngữ pháp lỗi */ }
}


// ── TEXTAREA TỰ CO GIÃN THEO NỘI DUNG (thay vì kéo tay bằng resize handle) ──────────────────
// Áp dụng cho các textarea có class "textarea-autogrow" (popup Đề xuất từ mới/Đề xuất nghĩa
// mới/Góp ý — xem CSS .textarea-autogrow). Khi set value bằng JS (prefill lúc mở popup) thì sự
// kiện 'input' không tự bắn nên các hàm mở popup phải tự gọi lại autoGrowTextarea() 1 lần sau
// khi set value — nghe 'input' qua delegation trên document là đủ cho phần người dùng tự gõ.
// Khi textarea đang RỖNG, "scrollHeight" chỉ phản ánh 1 dòng trống — không tính tới việc chữ
// placeholder xuống dòng (2-3 dòng) — khiến placeholder dài bị cắt/che mất nếu chiều cao ban
// đầu quá thấp. Sửa tận gốc: lúc đo, tạm gán value = placeholder để scrollHeight tính đúng số
// dòng placeholder cần, rồi trả lại value rỗng ngay sau đó (placeholder vẫn hiện bình thường
// qua CSS ::placeholder, người dùng không thấy sự thay đổi tạm thời này).
function autoGrowTextarea(el) {
  if (!el) return;
  // Đang ẨN (display:none ở trang/popup chưa mở) thì scrollHeight = 0 → đặt height:0px làm ô xẹp thành 1 vệt mỏng. Bỏ qua, chạy lại khi ô hiện ra.
  if (!el.getClientRects().length) return;
  const hadValue = el.value.length > 0;
  if (!hadValue && el.placeholder) el.value = el.placeholder;
  el.style.height = 'auto';
  // box-sizing: border-box → height gồm cả viền; chỉ đặt scrollHeight thì ô thiếu đúng bề dày viền và dòng cuối bị cắt vài px.
  el.style.height = (el.scrollHeight + (el.offsetHeight - el.clientHeight)) + 'px';
  if (!hadValue && el.placeholder) el.value = '';
}
document.addEventListener('input', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('textarea-autogrow')) {
    autoGrowTextarea(e.target);
  }
});

// ── GÓP Ý / BÁO LỖI VỀ 1 TỪ (người dùng gửi, admin duyệt) ──────
let feedbackWordId = null;
let lastNoResultQuery = '';

function openFeedbackModal(wordId) {
  feedbackWordId = wordId;
  const word = allWords.find(w => w.id === wordId);
  document.getElementById('feedbackWordLabel').textContent = word
    ? 'Góp ý cho từ "' + word.thai + '"'
    : 'Báo lỗi hoặc góp ý để giúp từ điển chính xác hơn';
  const textEl = document.getElementById('feedbackText');
  textEl.value = '';
  autoGrowTextarea(textEl);
  const noteEl = document.getElementById('feedbackMeaningNote');
  noteEl.value = '';
  autoGrowTextarea(noteEl);
  document.getElementById('feedbackError').textContent = '';
  setFeedbackType('general');
  document.getElementById('feedbackModal').classList.add('show');
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal').classList.remove('show');
}

// Chuyển đổi giữa 2 chế độ trong CÙNG 1 modal Góp ý: "Góp ý / báo lỗi" thông thường và
// "Đề xuất nghĩa mới" (trước đây là 1 nút + modal RIÊNG "＋ Đề xuất nghĩa mới" nổi ngay dưới
// định nghĩa — nay gộp hẳn vào modal Góp ý cho gọn, đỡ trùng lặp UI vì cả 2 vốn đã cùng gửi
// qua chung 1 type 'feedback' phía backend). Chỉ đổi placeholder + hiện/ẩn ô ghi chú ví dụ,
// không đổi cấu trúc dữ liệu gửi đi.
let feedbackType = 'general'; // 'general' | 'meaning'
function setFeedbackType(type) {
  feedbackType = type;
  document.querySelectorAll('#feedbackTypeToggle .feedback-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  const textEl = document.getElementById('feedbackText');
  const noteEl = document.getElementById('feedbackMeaningNote');
  if (type === 'meaning') {
    textEl.placeholder = 'Nghĩa tiếng Việt bạn muốn đề xuất thêm cho từ này *';
    noteEl.style.display = '';
  } else {
    textEl.placeholder = 'Góp ý về thông tin, ví dụ, phát âm, phiên âm hoặc bất kỳ vấn đề nào khác.';
    noteEl.style.display = 'none';
  }
}

// Gửi góp ý/đề xuất qua Edge Function "submit-contribution" (dùng service_role phía server)
// thay vì insert thẳng bằng anon key — chặn spam bằng rate-limit thật sự phía server,
// và tự xác thực user_id/tên hiển thị từ JWT thay vì tin dữ liệu client tự khai.
const EDGE_FN_SUBMIT_URL = SUPABASE_URL + '/functions/v1/submit-contribution';

async function submitViaEdgeFunction(type, payload) {
  // apikey PHẢI là SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) — function này viết theo
  // pattern withSupabase({ auth: 'publishable' }) giống translate-sentence, KHÔNG chấp nhận
  // anon key kiểu JWT dài cũ (SUPABASE_KEY), sẽ báo lỗi 401 nếu dùng nhầm.
  const reqHeaders = { 'Content-Type': 'application/json', 'apikey': SUPABASE_PUBLISHABLE_KEY };
  if (isLoggedIn()) {
    await ensureValidSession();
    reqHeaders['Authorization'] = 'Bearer ' + session.access_token;
  }
  let resp;
  try {
    resp = await fetch(EDGE_FN_SUBMIT_URL, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(Object.assign({ type: type }, payload))
    });
  } catch (e) {
    throw new Error('Không kết nối được máy chủ, thử lại sau');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error(data.error === 'daily_limit_reached'
        ? 'Bạn đã gửi quá số lần cho phép trong hôm nay, vui lòng quay lại vào ngày mai'
        : 'Bạn gửi hơi nhanh, vui lòng đợi một chút rồi thử lại');
    }
    if (resp.status === 409 && data.error === 'duplicate_suggestion') {
      throw new Error('Từ này đã được người khác đề xuất trước đó — mời bạn tìm và bình chọn cho đề xuất đã có thay vì gửi lại');
    }
    throw new Error('Lỗi khi gửi, thử lại sau');
  }
  return data;
}

async function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  const note = document.getElementById('feedbackMeaningNote').value.trim();
  const errorEl = document.getElementById('feedbackError');
  errorEl.textContent = '';
  if (!text) {
    errorEl.textContent = feedbackType === 'meaning' ? 'Vui lòng nhập nghĩa bạn muốn đề xuất' : 'Vui lòng nhập nội dung góp ý';
    return;
  }

  const btn = document.getElementById('feedbackSubmitBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang gửi...';
  try {
    // Chế độ "Đề xuất nghĩa mới" (trước đây là modal riêng "＋ Đề xuất nghĩa mới" nổi ngay dưới
    // định nghĩa, nay gộp vào modal Góp ý) vẫn gửi qua CÙNG type 'feedback' như góp ý thường —
    // chỉ thêm tiền tố "💡 Đề xuất nghĩa mới:" để admin phân biệt được khi xem trong trang quản trị.
    const feedbackText = feedbackType === 'meaning'
      ? '💡 Đề xuất nghĩa mới: ' + text + (note ? '\nGhi chú: ' + note : '')
      : text;
    await submitViaEdgeFunction('feedback', {
      word_id: feedbackWordId,
      feedback_text: feedbackText,
      // Không hỏi email thủ công nữa — nếu đã đăng nhập, tự lấy email từ session hiện có gửi
      // kèm (contact_email) để admin thấy trong trang quản trị, giống popup "Đề xuất từ mới".
      contact_email: isLoggedIn() ? (session.user.email || null) : null
    });
    closeFeedbackModal();
    showToast(feedbackType === 'meaning' ? '✅ Cảm ơn bạn! Đề xuất nghĩa mới đã được gửi tới admin' : '✅ Cảm ơn góp ý của bạn!');
  } catch (e) {
    errorEl.textContent = e.message || 'Lỗi khi gửi, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}


// ── ĐỀ XUẤT TỪ MỚI (người dùng gửi từ chưa có trong từ điển) ───
// ── KHÁM PHÁ (giới thiệu tính năng) ─────────────────────
function openExploreGuide() {
  closeAccountDropdown();
  document.getElementById('exploreGuideModal').classList.add('show');
}
function closeExploreGuide() {
  document.getElementById('exploreGuideModal').classList.remove('show');
}

// ── HƯỚNG DẪN QUY ƯỚC PHIÊN ÂM ──────────────────────────
function openPhoneticGuide() {
  document.getElementById('phoneticGuideModal').classList.add('show');
}
function closePhoneticGuide() {
  document.getElementById('phoneticGuideModal').classList.remove('show');
}

// origin: nơi mở popup, dùng để biết cần cập nhật lại UI nào tại chỗ sau khi gửi thành công.
// 'emptyState' = mở từ khối "chưa tìm thấy từ" (#emptyState) → sau khi gửi xong, thay ngay
// nội dung khối đó bằng lời cảm ơn (renderEmptyStateThanks), không cần toast riêng nữa.
let suggestWordModalOrigin = null;
function openSuggestWordModal(prefillThai, origin) {
  suggestWordModalOrigin = origin || null;
  document.getElementById('suggestThai').value = prefillThai || '';
  document.getElementById('suggestPhonetic').value = '';
  document.getElementById('suggestMeaning').value = '';
  const noteEl = document.getElementById('suggestNote');
  noteEl.value = '';
  autoGrowTextarea(noteEl);
  document.getElementById('suggestConsentCheckbox').checked = false;
  document.getElementById('suggestError').textContent = '';
  document.getElementById('suggestWordModal').classList.add('show');
}
function closeSuggestWordModal() {
  document.getElementById('suggestWordModal').classList.remove('show');
}

// Không có ô email cho người dùng tự gõ — nếu đã đăng nhập, tự lấy email ngầm từ session hiện
// có gửi kèm (contact_email), để admin thấy được trong trang quản trị mà khỏi cần hỏi thủ công;
// nếu chưa đăng nhập thì đề xuất gửi ẩn danh, đơn giản hoá form.
async function submitWordSuggestion() {
  const thai = document.getElementById('suggestThai').value.trim();
  const phonetic = document.getElementById('suggestPhonetic').value.trim();
  const meaning = document.getElementById('suggestMeaning').value.trim();
  const note = document.getElementById('suggestNote').value.trim();
  const errorEl = document.getElementById('suggestError');
  errorEl.textContent = '';
  if (!thai) { errorEl.textContent = 'Vui lòng nhập từ tiếng Thái muốn đề xuất'; return; }
  if (!document.getElementById('suggestConsentCheckbox').checked) {
    errorEl.textContent = 'Vui lòng xác nhận nội dung trước khi gửi';
    return;
  }

  const btn = document.getElementById('suggestSubmitBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang gửi...';
  try {
    await submitViaEdgeFunction('suggestion', {
      thai,
      phonetic: phonetic || null,
      meaning_suggestion: meaning || null,
      note: note || null,
      contact_email: isLoggedIn() ? (session.user.email || null) : null
    });
    closeSuggestWordModal();
    if (suggestWordModalOrigin === 'emptyState') {
      // Thay trạng thái "chưa có" ngay tại chỗ bằng lời cảm ơn, khỏi cần toast trùng ý
      renderEmptyStateThanks();
    } else {
      showToast('✅ Cảm ơn bạn! Đề xuất đã được gửi tới admin');
    }
  } catch (e) {
    errorEl.textContent = e.message || 'Lỗi khi gửi, thử lại sau';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── ĐỀ XUẤT TỪ MỚI — tab "Đề xuất từ" trong Thư viện ───────────
// Bản sao độc lập của form/hàm gửi ở trên (suggestWordModal/submitWordSuggestion), dùng ID riêng
// (suggestTab...) vì đây là nội dung nằm thẳng trong trang (#favSuggestTab), không phải popup —
// 2 nơi cùng gọi chung submitViaEdgeFunction('suggestion', ...) nên dữ liệu gửi lên giống hệt
// nhau, chỉ khác chỗ hiển thị (modal mở nhanh theo ngữ cảnh vd "không tìm thấy từ", còn tab này
// là lối vào chính trong Thư viện, thay cho mục "Đề xuất từ mới" trước đây ở thanh menu dọc).
let suggestTabDupState = null; // null | {type:'exists', wordId} | {type:'pending', count}
let suggestTabDupTimer = null;

function resetSuggestTabForm() {
  document.getElementById('suggestTabThai').value = '';
  document.getElementById('suggestTabPhonetic').value = '';
  document.getElementById('suggestTabMeaning').value = '';
  const noteEl = document.getElementById('suggestTabNote');
  noteEl.value = '';
  autoGrowTextarea(noteEl);
  document.getElementById('suggestTabConsentCheckbox').checked = false;
  document.getElementById('suggestTabError').textContent = '';
  suggestTabDupState = null;
  const dupEl = document.getElementById('suggestTabDupNote');
  dupEl.style.display = 'none';
  dupEl.innerHTML = '';
  const btn = document.getElementById('suggestTabSubmitBtn');
  btn.textContent = 'Gửi đề xuất';
  renderMySuggestions();
}

// Kiểm tra trùng khi gõ (debounce 400ms) — (1) đã có sẵn trong từ điển chưa (so trực tiếp với
// allWords đang có trong bộ nhớ, không cần gọi mạng), (2) nếu chưa, có ai đang đề xuất từ này và
// còn "chờ duyệt" chưa (gọi hàm an toàn find_or_bump_suggestion(p_bump=false) — xem migration
// migration_word_suggestions_status.sql — hàm chỉ trả về id/request_count, không lộ email/user_id
// của người khác). Nếu trùng dạng (2), đổi nút gửi thành "+1" thay vì tạo bản ghi mới.
function onSuggestTabThaiInput() {
  const dupEl = document.getElementById('suggestTabDupNote');
  const btn = document.getElementById('suggestTabSubmitBtn');
  suggestTabDupState = null;
  btn.textContent = 'Gửi đề xuất';
  const thai = document.getElementById('suggestTabThai').value.trim();
  if (suggestTabDupTimer) clearTimeout(suggestTabDupTimer);
  if (!thai) { dupEl.style.display = 'none'; dupEl.innerHTML = ''; return; }

  const existing = allWords.find(w => w.thai === thai);
  if (existing) {
    suggestTabDupState = { type: 'exists', wordId: existing.id };
    dupEl.style.display = '';
    dupEl.className = 'suggest-dup-note suggest-dup-exists';
    dupEl.innerHTML = '⚠️ Từ này đã có trong từ điển rồi — <a href="#" onclick="event.preventDefault(); showPage(\'home\'); goToWord(' + existing.id + ')">xem tại đây</a>';
    return;
  }
  dupEl.style.display = 'none'; dupEl.innerHTML = '';

  suggestTabDupTimer = setTimeout(async () => {
    if (document.getElementById('suggestTabThai').value.trim() !== thai) return; // đã gõ tiếp, bỏ kết quả cũ
    try {
      const rows = await sbPost('rpc/find_or_bump_suggestion', { p_thai: thai, p_bump: false });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        suggestTabDupState = { type: 'pending', count: row.request_count };
        dupEl.style.display = '';
        dupEl.className = 'suggest-dup-note suggest-dup-pending';
        dupEl.innerHTML = '👥 Đã có ' + row.request_count + ' người đề xuất từ này, đang chờ admin duyệt — bấm "Gửi đề xuất" để +1 thay vì tạo bản ghi mới.';
        btn.textContent = '👍 Tôi cũng đề xuất từ này (+1)';
      }
    } catch (e) { /* không chặn luồng nếu RPC lỗi — vẫn cho gửi bình thường */ }
  }, 400);
}

async function submitWordSuggestionTab() {
  const thai = document.getElementById('suggestTabThai').value.trim();
  const phonetic = document.getElementById('suggestTabPhonetic').value.trim();
  const meaning = document.getElementById('suggestTabMeaning').value.trim();
  const note = document.getElementById('suggestTabNote').value.trim();
  const errorEl = document.getElementById('suggestTabError');
  errorEl.textContent = '';
  if (!thai) { errorEl.textContent = 'Vui lòng nhập từ tiếng Thái muốn đề xuất'; return; }
  if (suggestTabDupState && suggestTabDupState.type === 'exists') {
    errorEl.textContent = 'Từ này đã có trong từ điển rồi, không cần đề xuất thêm';
    return;
  }
  if (!document.getElementById('suggestTabConsentCheckbox').checked) {
    errorEl.textContent = 'Vui lòng xác nhận nội dung trước khi gửi';
    return;
  }

  const btn = document.getElementById('suggestTabSubmitBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Đang gửi...';
  try {
    if (suggestTabDupState && suggestTabDupState.type === 'pending') {
      await sbPost('rpc/find_or_bump_suggestion', { p_thai: thai, p_bump: true });
      showToast('👍 Đã +1! Cảm ơn bạn đã cùng đề xuất từ này');
    } else {
      await submitViaEdgeFunction('suggestion', {
        thai,
        phonetic: phonetic || null,
        meaning_suggestion: meaning || null,
        note: note || null,
        contact_email: isLoggedIn() ? (session.user.email || null) : null
      });
      showToast('✅ Cảm ơn bạn! Đề xuất đã được gửi tới admin');
    }
    resetSuggestTabForm(); // tự đặt lại nhãn nút về "Gửi đề xuất" — KHÔNG khôi phục originalText
    // ở finally bên dưới nữa vì lúc bấm gửi originalText có thể đang là "+1" (đã lỗi thời sau khi
    // reset form xong).
    btn.disabled = false;
    return;
  } catch (e) {
    errorEl.textContent = e.message || 'Lỗi khi gửi, thử lại sau';
  }
  btn.disabled = false;
  btn.textContent = originalText;
}

// Danh sách "Đề xuất của bạn" — hiện lại trạng thái xử lý (chờ duyệt/đã thêm/từ chối + ghi chú
// admin nếu bị từ chối) để người dùng biết đề xuất của mình có kết quả gì, thay vì chỉ "mất hút"
// như trước. CHỈ hiện được cho người đã đăng nhập (khách vãng lai không có user_id ổn định để
// tra lại được).
async function renderMySuggestions() {
  const el = document.getElementById('suggestTabMyList');
  if (!el) return;
  if (!isLoggedIn()) {
    el.innerHTML = '<div class="fav-empty" style="padding:1rem 0">Đăng nhập để xem lại các đề xuất bạn đã gửi trước đó</div>';
    return;
  }
  el.innerHTML = '<div class="fav-empty" style="padding:1rem 0">Đang tải...</div>';
  try {
    const rows = await sbGetAuth('word_suggestions?select=*&user_id=eq.' + session.user.id + '&order=id.desc');
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) { el.innerHTML = '<div class="fav-empty" style="padding:1rem 0">Bạn chưa gửi đề xuất nào</div>'; return; }
    el.innerHTML = list.map(s => {
      const status = s.status || 'pending';
      const badge = status === 'approved'
        ? '<span class="suggestion-status-badge approved">✅ Đã thêm vào từ điển</span>'
        : status === 'rejected'
          ? '<span class="suggestion-status-badge rejected">❌ Từ chối</span>'
          : '<span class="suggestion-status-badge pending">⏳ Chờ duyệt</span>';
      return `
        <div class="suggest-my-row">
          <div class="suggest-my-thai thai-font">${escapeHtml(s.thai || '')}${s.phonetic ? ' <span class="suggest-my-phonetic">(' + escapeHtml(s.phonetic) + ')</span>' : ''}</div>
          ${s.meaning_suggestion ? `<div class="suggest-my-meaning">${escapeHtml(s.meaning_suggestion)}</div>` : ''}
          ${s.request_count > 1 ? `<div class="suggest-my-meta">👥 ${s.request_count} người cùng đề xuất</div>` : ''}
          ${badge}
          ${s.admin_note ? `<div class="suggest-my-admin-note">💬 ${escapeHtml(s.admin_note)}</div>` : ''}
        </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="fav-empty" style="padding:1rem 0">Không tải được, thử lại sau</div>';
  }
}



// ── Video minh họa (YouTube) cho ví dụ câu ─────────────────────────────
// Thay thế YouGlish: dùng YouTube IFrame Player API chính thức (không bị chặn
// cookie bên thứ 3 như popup YouGlish/Cloudflare). Admin dán link YouTube có
// người Thái nói câu ví dụ, tua đến đúng đoạn rồi bấm "Đánh dấu bắt đầu/kết thúc".
// Dữ liệu lưu ngay trong examples[].video = { youtubeId, start, end } (giây),
// không cần bảng SQL mới.
let ytApiLoaded = false;
let ytApiLoadingPromise = null;
const ytPlayers = {}; // key "scope-eid" -> YT.Player

function loadYouTubeApi() {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiLoadingPromise) return ytApiLoadingPromise;
  ytApiLoadingPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { ytApiLoaded = true; resolve(); return; }
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function() {
      if (typeof prevReady === 'function') prevReady();
      ytApiLoaded = true; resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiLoadingPromise;
}

function extractYouTubeId(input) {
  if (!input) return null;
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const m = input.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function formatYtTime(sec) {
  if (sec === '' || sec === null || sec === undefined || isNaN(sec)) return '--:--';
  const r = Math.max(0, Math.round(Number(sec) * 10) / 10); // làm tròn 0,1 giây
  const m = Math.floor(r / 60);
  const rest = r - m * 60;
  const secTxt = Number.isInteger(r) ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0');
  return m + ':' + secTxt;
}
// Đọc mốc bắt đầu từ link YouTube dán vào: ?t=90, &t=90s, &t=1m30s, &start=90 (youtu.be/ID?t=90 cũng được). Không có thì trả null.
function extractYouTubeStart(input) {
  const m = (input || '').match(/[?&#](?:t|start)=([0-9hms]+)/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const parts = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!parts || (!parts[1] && !parts[2] && !parts[3])) return null;
  return (Number(parts[1] || 0) * 3600) + (Number(parts[2] || 0) * 60) + Number(parts[3] || 0);
}
// Chuỗi hiển thị khoảng đã chọn: "0:12.4 → 0:20.9 (8.5s)"
function formatYtRange(start, end) {
  let txt = formatYtTime(start) + ' → ' + formatYtTime(end);
  if (start !== '' && end !== '' && !isNaN(start) && !isNaN(end) && Number(end) > Number(start)) {
    txt += ' (' + (Math.round((Number(end) - Number(start)) * 10) / 10) + 's)';
  }
  return txt;
}

function renderExVideoBlock(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  if (!block) return;
  const vid = block.dataset.videoId;
  const start = block.dataset.start;
  const end = block.dataset.end;

  if (vid && block.dataset.editing !== '1') {
    const hasRange = start !== '' && end !== '';
    block.innerHTML =
      '<div class="ex-video-badge">' +
        '<span class="ex-video-icon">🎬</span>' +
        '<span class="ex-video-info">' + vid + (hasRange ? ' · ' + formatYtTime(start) + '–' + formatYtTime(end) : ' · chưa đánh dấu đoạn') + '</span>' +
        '<button type="button" class="btn-link-small" onclick="editExVideo(\'' + scope + '\',' + eid + ')">Sửa</button>' +
        '<button type="button" class="btn-link-small" onclick="clearExVideo(\'' + scope + '\',' + eid + ')">Xóa video</button>' +
      '</div>';
    return;
  }

  if (vid && block.dataset.editing === '1') {
    block.innerHTML =
      '<div class="ex-video-editor">' +
        '<div class="ex-video-player" id="ytplayer-' + scope + '-' + eid + '"></div>' +
        '<div class="ex-video-controls">' +
          '<button type="button" class="btn-video-mark" onclick="markExVideoTime(\'' + scope + '\',' + eid + ',\'start\')">⏱ Đánh dấu bắt đầu</button>' +
          '<button type="button" class="btn-video-mark" onclick="markExVideoTime(\'' + scope + '\',' + eid + ',\'end\')">⏱ Đánh dấu kết thúc</button>' +
          '<button type="button" class="btn-video-mark" onclick="previewExVideoRange(\'' + scope + '\',' + eid + ')">▶ Xem thử đoạn</button>' +
          '<span class="ex-video-range" id="ytrange-' + scope + '-' + eid + '">' + formatYtRange(start, end) + '</span>' +
          '<button type="button" class="btn-link-small" onclick="doneExVideo(\'' + scope + '\',' + eid + ')">Xong</button>' +
        '</div>' +
        '<div class="ex-video-nudge">' +
          '<span class="ex-video-nudge-label">Tinh chỉnh bắt đầu</span>' +
          '<button type="button" class="btn-nudge" onclick="nudgeExVideoTime(\'' + scope + '\',' + eid + ',\'start\',-0.5)">−0,5s</button>' +
          '<button type="button" class="btn-nudge" onclick="nudgeExVideoTime(\'' + scope + '\',' + eid + ',\'start\',0.5)">+0,5s</button>' +
          '<span class="ex-video-nudge-label">kết thúc</span>' +
          '<button type="button" class="btn-nudge" onclick="nudgeExVideoTime(\'' + scope + '\',' + eid + ',\'end\',-0.5)">−0,5s</button>' +
          '<button type="button" class="btn-nudge" onclick="nudgeExVideoTime(\'' + scope + '\',' + eid + ',\'end\',0.5)">+0,5s</button>' +
        '</div>' +
        '<div class="ex-cap-editor">' +
          '<div class="ex-cap-head">' +
            '<span class="ex-cap-title">💬 Phụ đề tự viết</span>' +
            '<button type="button" class="btn-video-mark" id="excapfetch-' + scope + '-' + eid + '" onclick="fetchExVideoCaptions(\'' + scope + '\',' + eid + ')">⬇ Lấy từ YouTube</button>' +
            '<button type="button" class="btn-video-mark" onclick="addExCaptionRow(\'' + scope + '\',' + eid + ')">＋ Thêm dòng</button>' +
            '<button type="button" class="btn-video-mark" onclick="toggleExCaptionImport(\'' + scope + '\',' + eid + ')">📋 Dán / nhập file</button>' +
            '<label class="ex-cap-default"><input type="checkbox" ' + (block.dataset.cc === '1' ? 'checked ' : '') + 'onchange="setExCaptionDefault(\'' + scope + '\',' + eid + ',this.checked)"> Bật sẵn cho người học</label>' +
          '</div>' +
          '<div class="ex-cap-import" id="excapimport-' + scope + '-' + eid + '" style="display:none">' +
            '<div class="ex-cap-import-hint"><b>Cách nhanh nhất:</b> mở video trên YouTube → bấm <b>… (Thêm) → Hiện bản chép lời</b> → bôi đen toàn bộ chữ trong bảng → copy → dán vào ô dưới. Hoặc dán nội dung/chọn file <b>.srt .vtt .json3</b>. Tự nhận dạng định dạng và chỉ giữ các dòng nằm trong đoạn đã đánh dấu.</div>' +
            '<textarea class="form-input" rows="5" placeholder="Dán bản chép lời YouTube, hoặc nội dung SRT / VTT / JSON3..."></textarea>' +
            '<div class="ex-cap-import-actions">' +
              '<button type="button" class="btn-video-mark" onclick="importExCaptionText(\'' + scope + '\',' + eid + ')">Nhập</button>' +
              '<label class="btn-video-mark ex-cap-file-btn">Chọn file…<input type="file" accept=".srt,.vtt,.json,.json3,.txt" style="display:none" onchange="loadExCaptionFile(\'' + scope + '\',' + eid + ',this)"></label>' +
            '</div>' +
          '</div>' +
          '<div class="ex-cap-list" id="excaplist-' + scope + '-' + eid + '"></div>' +
        '</div>' +
      '</div>';
    loadYouTubeApi().then(() => createExYtPlayer(scope, eid, vid));
    renderExCaptionList(scope, eid);
    return;
  }

  // Chưa có video nào — ô nhập link
  block.innerHTML =
    '<div class="ex-video-input">' +
      '<input type="text" class="form-input ex-video-url" autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other" placeholder="🎬 Dán link YouTube (có thể kèm ?t=giây) — dán xong tự nhúng..." onkeydown="onExVideoUrlKey(event,\'' + scope + '\',' + eid + ')" onpaste="onExVideoUrlPaste(this,\'' + scope + '\',' + eid + ')">' +
      '<button type="button" class="btn-video-mark" onclick="attachExVideo(\'' + scope + '\',' + eid + ')">Nhúng video</button>' +
    '</div>';
}

function attachExVideo(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const input = block.querySelector('.ex-video-url');
  const id = extractYouTubeId(input ? input.value : '');
  if (!id) { showToast('⚠️ Link YouTube không hợp lệ'); return; }
  block.dataset.videoId = id;
  const startFromLink = extractYouTubeStart(input ? input.value : '');
  block.dataset.start = startFromLink != null ? startFromLink : '';
  block.dataset.end = '';
  block.dataset.editing = '1';
  renderExVideoBlock(scope, eid);
}
// Enter trong ô link = nhúng ngay; dán link hợp lệ = tự nhúng (khỏi bấm nút)
function onExVideoUrlKey(e, scope, eid) {
  if (e.key === 'Enter') { e.preventDefault(); attachExVideo(scope, eid); }
}
function onExVideoUrlPaste(input, scope, eid) {
  setTimeout(() => { if (extractYouTubeId(input.value)) attachExVideo(scope, eid); }, 0);
}

function editExVideo(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  block.dataset.editing = '1';
  renderExVideoBlock(scope, eid);
}

function doneExVideo(scope, eid) {
  destroyExYtPlayer(scope, eid);
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  delete block.dataset.editing;
  renderExVideoBlock(scope, eid);
}

function clearExVideo(scope, eid) {
  destroyExYtPlayer(scope, eid);
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  block.dataset.videoId = '';
  block.dataset.start = '';
  block.dataset.end = '';
  delete block.dataset.editing;
  renderExVideoBlock(scope, eid);
}

function destroyExYtPlayer(scope, eid) {
  const key = scope + '-' + eid;
  if (ytPlayers[key]) {
    try { ytPlayers[key].destroy(); } catch (e) {}
    delete ytPlayers[key];
  }
}

function createExYtPlayer(scope, eid, videoId) {
  const key = scope + '-' + eid;
  const elId = 'ytplayer-' + scope + '-' + eid;
  if (!document.getElementById(elId)) return; // panel đã đóng trước khi API load xong
  destroyExYtPlayer(scope, eid);
  const vars = { rel: 0, modestbranding: 1 };
  // origin chỉ hợp lệ khi phục vụ qua http(s) — nếu mở file:// trực tiếp thì bỏ qua
  // (nếu không YouTube sẽ báo lỗi 153 do không xác thực được domain gọi embed)
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    vars.origin = location.origin;
  }
  ytPlayers[key] = new YT.Player(elId, {
    height: '200',
    width: '100%',
    videoId: videoId,
    playerVars: vars,
    events: {
      onError: (e) => onExYtPlayerError(scope, eid, e.data)
    }
  });
}

function onExYtPlayerError(scope, eid, code) {
  const messages = {
    2: 'ID video không hợp lệ — kiểm tra lại link',
    5: 'Lỗi trình phát HTML5 của YouTube',
    100: 'Video không tồn tại hoặc đã bị xóa',
    101: 'Chủ video đã tắt tính năng nhúng (embed) — cần chọn video khác',
    150: 'Chủ video đã tắt tính năng nhúng (embed) — cần chọn video khác',
    153: location.protocol === 'file:'
      ? 'Đang mở file trực tiếp (file://) nên YouTube chặn phát — hãy test qua server HTTP (vd: python3 -m http.server) hoặc trên Netlify'
      : 'Lỗi cấu hình phát video — thử tải lại trang'
  };
  showToast('⚠️ ' + (messages[code] || ('Lỗi phát video (mã ' + code + ')')));
}

function markExVideoTime(scope, eid, which) {
  const key = scope + '-' + eid;
  const player = ytPlayers[key];
  if (!player || typeof player.getCurrentTime !== 'function') { showToast('⚠️ Video chưa tải xong, đợi một chút rồi thử lại'); return; }
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const t = Math.round(player.getCurrentTime() * 10) / 10; // chính xác tới 0,1 giây (trước đây làm tròn cả giây nên đoạn hay bị lố/thiếu)
  if (which === 'end' && block.dataset.start !== '' && t <= Number(block.dataset.start)) {
    showToast('⚠️ Điểm kết thúc phải sau điểm bắt đầu'); return;
  }
  block.dataset[which] = t;
  const rangeEl = document.getElementById('ytrange-' + scope + '-' + eid);
  if (rangeEl) rangeEl.textContent = formatYtRange(block.dataset.start, block.dataset.end);
}

// ── Phụ đề tự viết (admin) ─────────────────────────────────────────────
// Lưu trong examples[].video.captions = [{ start, end, thai, viet }] (giây) — chuỗi JSON nằm ở data-captions của khối video, admin-core đã
// sẵn đọc/ghi trường này khi lưu từ. "Bật sẵn cho người học" = data-cc → video.showCaptions.
function getExCaptions(block) {
  let raw = [];
  try { raw = JSON.parse(block.dataset.captions || '[]'); } catch (e) { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  return raw.map(c => ({
    start: Number(c && c.start) || 0, end: Number(c && c.end) || 0,
    thai: String((c && (c.thai != null ? c.thai : c.text)) || ''), viet: String((c && c.viet) || '')
  }));
}
function setExCaptions(block, arr) { block.dataset.captions = JSON.stringify(arr); }

// Chấp nhận "12.4", "12,4" hoặc "1:05.5"
function parseExTimeInput(str) {
  str = String(str || '').trim().replace(',', '.');
  const m = str.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return Math.round((Number(m[1] || 0) * 60 + Number(m[2])) * 10) / 10;
}
function fmtExTimeInput(sec) { return String(Math.round(Number(sec) * 10) / 10); }

function renderExCaptionList(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const list = document.getElementById('excaplist-' + scope + '-' + eid);
  if (!block || !list) return;
  const caps = getExCaptions(block);
  if (!caps.length) {
    list.innerHTML = '<div class="ex-cap-empty">Chưa có phụ đề. Đánh dấu đoạn video rồi bấm "Lấy từ YouTube", hoặc thêm dòng / dán SRT/VTT.</div>';
    return;
  }
  const q = (x) => "'" + scope + "'," + eid + "," + x;
  list.innerHTML = caps.map((c, i) =>
    '<div class="ex-cap-row">' +
      '<div class="ex-cap-times">' +
        '<input class="form-input ex-cap-time" value="' + fmtExTimeInput(c.start) + '" title="Giây bắt đầu" onchange="editExCaption(' + q(i + ",'start'") + ',this)">' +
        '<input class="form-input ex-cap-time" value="' + fmtExTimeInput(c.end) + '" title="Giây kết thúc" onchange="editExCaption(' + q(i + ",'end'") + ',this)">' +
        '<button type="button" class="btn-nudge" title="Tua video tới dòng này" onclick="seekExCaption(' + q(i) + ')">▶</button>' +
      '</div>' +
      '<div class="ex-cap-texts">' +
        '<textarea class="form-input ex-cap-text ex-cap-thai" rows="1" placeholder="Tiếng Thái" oninput="editExCaption(' + q(i + ",'thai'") + ',this)">' + escapeHtml(c.thai) + '</textarea>' +
        '<textarea class="form-input ex-cap-text" rows="1" placeholder="Tiếng Việt (không bắt buộc)" oninput="editExCaption(' + q(i + ",'viet'") + ',this)">' + escapeHtml(c.viet) + '</textarea>' +
      '</div>' +
      '<button type="button" class="btn-remove" title="Xóa dòng" onclick="removeExCaption(' + q(i) + ')">✕</button>' +
    '</div>'
  ).join('');
}

function editExCaption(scope, eid, i, field, el) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const caps = getExCaptions(block);
  if (!caps[i]) return;
  if (field === 'start' || field === 'end') {
    const v = parseExTimeInput(el.value);
    if (v === null) { el.value = fmtExTimeInput(caps[i][field]); showToast('⚠️ Giờ không hợp lệ (ví dụ 12.4 hoặc 1:05.5)'); return; }
    caps[i][field] = v;
    if (caps[i].end <= caps[i].start) { showToast('⚠️ Giờ kết thúc phải sau giờ bắt đầu'); }
    caps.sort((a, b) => a.start - b.start);
    setExCaptions(block, caps);
    renderExCaptionList(scope, eid); // đổi giờ có thể đổi thứ tự dòng nên dựng lại
    return;
  }
  caps[i][field] = el.value; // gõ chữ: chỉ cập nhật dữ liệu, KHÔNG dựng lại (tránh mất con trỏ)
  setExCaptions(block, caps);
}

function removeExCaption(scope, eid, i) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const caps = getExCaptions(block);
  caps.splice(i, 1);
  setExCaptions(block, caps);
  renderExCaptionList(scope, eid);
}

// Thêm dòng mới bắt đầu tại vị trí đang xem của video (hoặc đầu đoạn nếu chưa phát), dài 2 giây
function addExCaptionRow(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const player = ytPlayers[scope + '-' + eid];
  let t = block.dataset.start !== '' ? Number(block.dataset.start) : 0;
  if (player && typeof player.getCurrentTime === 'function') { try { t = Math.round(player.getCurrentTime() * 10) / 10; } catch (e) {} }
  const caps = getExCaptions(block);
  caps.push({ start: t, end: Math.round((t + 2) * 10) / 10, thai: '', viet: '' });
  caps.sort((a, b) => a.start - b.start);
  setExCaptions(block, caps);
  renderExCaptionList(scope, eid);
}

function seekExCaption(scope, eid, i) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const caps = getExCaptions(block);
  const player = ytPlayers[scope + '-' + eid];
  if (caps[i] && player && typeof player.seekTo === 'function') player.seekTo(caps[i].start, true);
}

function setExCaptionDefault(scope, eid, on) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  block.dataset.cc = on ? '1' : '0';
}

function toggleExCaptionImport(scope, eid) {
  const box = document.getElementById('excapimport-' + scope + '-' + eid);
  if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ── NHẬP PHỤ ĐỀ TỪ NHIỀU NGUỒN ─────────────────────────────────────────
// Máy chủ Supabase thường bị YouTube chặn (yêu cầu xác minh robot) nên đường nhập thủ công là đường CHÍNH đáng tin cậy. Tự nhận dạng 3 dạng:
//  (1) JSON3 (yt-dlp --sub-format json3, hoặc timedtext)  (2) SRT/VTT  (3) chép nguyên bảng "Hiện bản chép lời / Show transcript" của YouTube.
const THAI_RE = /[\u0E00-\u0E7F]/;
const r1Cap = (n) => Math.round(n * 10) / 10;
function splitThaiViet(lines) {
  const thai = lines.filter(l => THAI_RE.test(l)).join(' ');
  const viet = lines.filter(l => !THAI_RE.test(l)).join(' ');
  return { thai: thai || viet, viet: thai ? viet : '' };
}
// Cắt cuối dòng trước tại điểm bắt đầu dòng sau (phụ đề tự động hay chồng lấn)
function trimCaptionOverlaps(caps) {
  caps.sort((a, b) => a.start - b.start);
  for (let i = 0; i < caps.length - 1; i++) { if (caps[i + 1].start < caps[i].end) caps[i].end = caps[i + 1].start; }
  return caps.filter(c => c.end > c.start);
}

// (2) SRT/VTT. Phụ đề tự động của YouTube ở dạng VTT lặp lại dòng cũ trong cue kế tiếp — bỏ các dòng giống hệt cue trước đó.
function parseSubtitleText(text) {
  const toSec = (h, m, sec) => (Number(h || 0) * 3600) + (Number(m) * 60) + Number(String(sec).replace(',', '.'));
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2}[.,]\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2}[.,]\d{1,3})/;
  const out = [];
  let prevLines = [];
  String(text || '').replace(/\r/g, '').split(/\n{2,}/).forEach(blk => {
    const lines = blk.split('\n');
    const ti = lines.findIndex(l => re.test(l));
    if (ti === -1) return;
    const m = lines[ti].match(re);
    const start = r1Cap(toSec(m[1], m[2], m[3]));
    const end = r1Cap(toSec(m[4], m[5], m[6]));
    const body = lines.slice(ti + 1).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const fresh = body.filter(l => prevLines.indexOf(l) === -1);
    prevLines = body;
    if (!fresh.length || end <= start) return;
    const tv = splitThaiViet(fresh);
    out.push({ start, end, thai: tv.thai, viet: tv.viet });
  });
  return trimCaptionOverlaps(out);
}

// (1) JSON3 của YouTube
function parseJson3Text(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { return []; }
  const out = [];
  (json && Array.isArray(json.events) ? json.events : []).forEach(ev => {
    if (!ev || !Array.isArray(ev.segs)) return;
    const t = ev.segs.map(sg => (sg && sg.utf8) || '').join('').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const start = (Number(ev.tStartMs) || 0) / 1000;
    const tv = splitThaiViet([t]);
    out.push({ start: r1Cap(start), end: r1Cap(start + (Number(ev.dDurationMs) || 0) / 1000), thai: tv.thai, viet: tv.viet });
  });
  return trimCaptionOverlaps(out);
}

// (3) Chép từ bảng "Hiện bản chép lời" của YouTube: dòng giờ ("0:12" / "1:02:03") rồi tới các dòng chữ; hoặc giờ + chữ cùng dòng.
// YouTube không cho giờ kết thúc → lấy giờ bắt đầu của dòng kế (tối đa 8 giây); dòng cuối dài 3 giây. Admin chỉnh lại sau.
function parseTranscriptPanelText(text) {
  const tsOnly = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/;
  const tsText = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(\S.*)$/;
  const toSec = (str) => str.split(':').map(Number).reduce((acc, v) => acc * 60 + v, 0);
  const items = [];
  let cur = null;
  String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (tsOnly.test(line)) { cur = { start: toSec(line), lines: [] }; items.push(cur); return; }
    const m = line.match(tsText);
    if (m) { cur = { start: toSec(m[1]), lines: [m[2]] }; items.push(cur); return; }
    if (cur) cur.lines.push(line); // dòng chữ thuộc mốc giờ gần nhất; dòng tiêu đề đứng trước mốc giờ đầu tiên bị bỏ qua
  });
  // Dự phòng khi không tách được theo dòng (nội dung bị dính thành 1 dòng, hoặc giờ và chữ cách nhau bằng tab/nhiều khoảng trắng):
  // tìm mọi mốc giờ đứng riêng giữa 2 khoảng trắng, chữ là phần nằm giữa 2 mốc giờ.
  const hasInlineStamp = items.some(it => it.lines.some(l => /(?:^|\s)\d{1,2}(?::\d{2}){1,2}(?=\s|$)/.test(l)));
  if (!items.length || hasInlineStamp) {
    items.length = 0; // 1 dòng chứa nhiều mốc giờ → làm lại theo mốc giờ
    const flat = String(text || '').replace(/\r/g, ' ').replace(/\n/g, ' \n ');
    const re = /(?:^|\s)(\d{1,2}(?::\d{2}){1,2})(?=\s|$)/g;
    const marks = [];
    let mm;
    while ((mm = re.exec(flat))) marks.push({ ts: mm[1], textStart: mm.index + mm[0].length, tokenStart: mm.index });
    marks.forEach((mk, i) => {
      const endAt = i + 1 < marks.length ? marks[i + 1].tokenStart : flat.length;
      const body = flat.slice(mk.textStart, endAt).split('\n').map(l => l.trim()).filter(Boolean);
      if (body.length) items.push({ start: toSec(mk.ts), lines: body });
    });
  }
  const out = [];
  items.forEach((it, i) => {
    if (!it.lines.length) return;
    const next = items[i + 1];
    const end = next ? Math.min(next.start, it.start + 8) : it.start + 3;
    const tv = splitThaiViet(it.lines.map(l => l.replace(/^[•·\-–—]\s*/, '')).filter(Boolean)); // bỏ dấu đầu dòng (•, -) nếu có
    out.push({ start: it.start, end: end > it.start ? end : it.start + 2, thai: tv.thai, viet: tv.viet });
  });
  return out;
}

// Chuẩn hóa nội dung dán: bỏ ký tự vô hình (zero-width, BOM) và khoảng trắng đặc biệt mà YouTube hay chèn khi copy, đổi số Thái → số thường
function normalizeImportText(text) {
  return String(text || '')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u0E50-\u0E59]/g, ch => String(ch.charCodeAt(0) - 0x0E50))
    .replace(/\uFF1A/g, ':'); // dấu hai chấm toàn chiều rộng
}
function parseCaptionImport(text) {
  const t = normalizeImportText(text).trim();
  if (!t) return { caps: [], kind: '' };
  if (t[0] === '{') return { caps: parseJson3Text(t), kind: 'JSON3' };
  if (t.indexOf('-->') !== -1) return { caps: parseSubtitleText(t), kind: 'SRT/VTT' };
  return { caps: parseTranscriptPanelText(t), kind: 'bản chép lời YouTube' };
}

function importExCaptionText(scope, eid) {
  const box = document.getElementById('excapimport-' + scope + '-' + eid);
  const ta = box ? box.querySelector('textarea') : null;
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const parsed = parseCaptionImport(ta ? ta.value : '');
  if (!parsed.caps.length) {
    const raw = normalizeImportText(ta ? ta.value : '').trim();
    const sample = raw.replace(/\s+/g, ' ').slice(0, 60);
    console.warn('Nhập phụ đề thất bại — nội dung nhận được (300 ký tự đầu):', JSON.stringify(raw.slice(0, 300)));
    showToast('⚠️ Không đọc được dòng phụ đề nào' + (raw ? ' — nhận ' + raw.split('\n').length + ' dòng, bắt đầu: "' + sample + '". Cần có mốc giờ như 0:12 hoặc 00:00:12,000 -->' : ' — ô dán đang trống'));
    return;
  }
  // Dán cả bản chép lời của video dài thì chỉ giữ các dòng nằm trong đoạn ví dụ đã đánh dấu (±1s)
  let caps = parsed.caps;
  const total = caps.length;
  if (block.dataset.start !== '' && block.dataset.end !== '') {
    const lo = Number(block.dataset.start) - 1, hi = Number(block.dataset.end) + 1;
    caps = caps.filter(c => c.end > lo && c.start < hi);
    if (!caps.length) { showToast('⚠️ Có ' + total + ' dòng nhưng không dòng nào nằm trong đoạn ' + formatYtRange(block.dataset.start, block.dataset.end) + ' — kiểm tra lại video/đoạn đã đánh dấu'); return; }
  }
  if (getExCaptions(block).length && !confirm('Thay phụ đề hiện tại bằng ' + caps.length + ' dòng vừa nhập?')) return;
  setExCaptions(block, caps);
  if (ta) ta.value = '';
  if (box) box.style.display = 'none';
  renderExCaptionList(scope, eid);
  showToast('Đã nhập ' + caps.length + ' dòng (' + parsed.kind + (caps.length < total ? ', lọc từ ' + total + ' dòng theo đoạn ví dụ' : '') + ') — hãy kiểm tra và chỉnh lại');
}

// Chọn file .srt/.vtt/.json/.json3/.txt → đưa nội dung vào ô dán
function loadExCaptionFile(scope, eid, input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const box = document.getElementById('excapimport-' + scope + '-' + eid);
    const ta = box ? box.querySelector('textarea') : null;
    if (ta) ta.value = String(reader.result || '');
    input.value = '';
    importExCaptionText(scope, eid);
  };
  reader.readAsText(f, 'utf-8');
}

// Lấy phụ đề của video từ YouTube qua Edge Function "youtube-captions" — CHỈ lấy các dòng nằm trong đoạn đã đánh dấu; admin chỉnh lại sau đó.
async function fetchExVideoCaptions(scope, eid) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const btn = document.getElementById('excapfetch-' + scope + '-' + eid);
  if (!block || !block.dataset.videoId) return;
  if (block.dataset.start === '' || block.dataset.end === '') { showToast('⚠️ Hãy đánh dấu đoạn bắt đầu/kết thúc trước — chỉ lấy phụ đề trong đoạn đó'); return; }
  const existing = getExCaptions(block);
  if (existing.length && !confirm('Thay ' + existing.length + ' dòng phụ đề hiện tại bằng phụ đề lấy từ YouTube?')) return;
  const oldLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Đang lấy...'; }
  try {
    const r = await fetch(SUPABASE_URL + '/functions/v1/youtube-captions', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_PUBLISHABLE_KEY, 'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: block.dataset.videoId, lang: 'th', from: Number(block.dataset.start), to: Number(block.dataset.end) })
    });
    const data = await r.json();
    if (!r.ok) {
      if (data.debug) console.warn('youtube-captions — chi tiết từng lần thử (gửi kèm khi báo lỗi):', data.debug);
      const importBox = document.getElementById('excapimport-' + scope + '-' + eid);
      if (importBox) importBox.style.display = ''; // thất bại → mở sẵn khung dán thủ công
      throw new Error(data.error || 'Không lấy được phụ đề');
    }
    const caps = normalizeVideoCaptions(data.captions);
    if (!caps.length) { showToast('⚠️ Video có phụ đề nhưng không có dòng nào trong đoạn đã chọn'); return; }
    setExCaptions(block, caps);
    renderExCaptionList(scope, eid);
    showToast('Đã lấy ' + caps.length + ' dòng (' + (data.auto ? 'phụ đề tự động' : 'phụ đề thủ công') + (data.translated ? ', kèm bản dịch Việt tự động' : '') + ') — hãy kiểm tra và chỉnh lại');
  } catch (e) {
    showToast('⚠️ ' + (e.message || 'Không lấy được phụ đề, thử lại sau'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldLabel; }
  }
}

// Tinh chỉnh mốc ±0,5s rồi tua tới mốc mới để nghe/nhìn ngay.
function nudgeExVideoTime(scope, eid, which, delta) {
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  if (!block || block.dataset[which] === '') { showToast('⚠️ Hãy đánh dấu ' + (which === 'start' ? 'điểm bắt đầu' : 'điểm kết thúc') + ' trước'); return; }
  let t = Math.max(0, Math.round((Number(block.dataset[which]) + delta) * 10) / 10);
  if (which === 'start' && block.dataset.end !== '' && t >= Number(block.dataset.end)) { showToast('⚠️ Điểm bắt đầu phải trước điểm kết thúc'); return; }
  if (which === 'end' && block.dataset.start !== '' && t <= Number(block.dataset.start)) { showToast('⚠️ Điểm kết thúc phải sau điểm bắt đầu'); return; }
  block.dataset[which] = t;
  const rangeEl = document.getElementById('ytrange-' + scope + '-' + eid);
  if (rangeEl) rangeEl.textContent = formatYtRange(block.dataset.start, block.dataset.end);
  const player = ytPlayers[scope + '-' + eid];
  if (player && typeof player.seekTo === 'function') player.seekTo(which === 'end' ? Math.max(0, t - 1.5) : t, true);
}

function previewExVideoRange(scope, eid) {
  const key = scope + '-' + eid;
  const player = ytPlayers[key];
  const block = document.getElementById('exvid-' + scope + '-' + eid);
  const start = block.dataset.start !== '' ? Number(block.dataset.start) : null;
  const end = block.dataset.end !== '' ? Number(block.dataset.end) : null;
  if (!player || start === null) { showToast('⚠️ Hãy đánh dấu điểm bắt đầu trước'); return; }
  player.seekTo(start, true);
  player.playVideo();
  if (block._previewTimer) clearInterval(block._previewTimer);
  if (end !== null && end > start) {
    block._previewTimer = setInterval(() => {
      if (!player || typeof player.getCurrentTime !== 'function') { clearInterval(block._previewTimer); return; }
      if (player.getCurrentTime() >= end) {
        player.pauseVideo();
        clearInterval(block._previewTimer);
      }
    }, 200);
  }
}


// ── Modal Video minh họa cho người dùng (thay YouGlish) ────────────────
// Mở từ icon 🎬 cạnh mỗi ví dụ. Video được lặp lại trong đoạn [start, end]
// đã đánh dấu sẵn ở admin, giúp người học nghe đi nghe lại đúng câu ví dụ.
let exampleVideoLoopTimer = null;
let exampleVideoState = { id: null, start: null, end: null, captions: null };
let exampleVideoCapModePref = null; // chế độ phụ đề tự viết người học đã chọn trong phiên: 'TH' | 'VI' | 'ALL' | 'OFF' (null = theo mặc định admin: ALL nếu bật sẵn, ngược lại OFF)
let exampleVideoSentenceLoop = false; // đang lặp liên tục 1 câu phụ đề
let exampleVideoLoopIdx = -1;         // chỉ số câu đang bị khóa lặp
let exampleVideoLoopAuto = false;     // true = chế độ "tự lặp N lần rồi sang câu sau"
let exampleVideoLoopPlays = 0;        // số lần ĐÃ phát xong câu đang khóa (chỉ dùng cho chế độ tự lặp)
let exampleVideoLoopGuardUntil = 0;   // thời điểm (ms) đến khi bỏ qua việc dò hết câu — seekTo của YouTube bất đồng bộ, getCurrentTime có thể còn trả giờ cũ
const EX_VIDEO_AUTO_REPEATS = 3;
const EX_VIDEO_CAP_MODES = ['TH', 'VI', 'ALL', 'OFF'];
let exampleVideoCapIdx = -1;
let exampleVideoRate = 1;     // tốc độ người học đã chọn — nhớ trong phiên, các lần mở sau dùng lại
let exampleVideoCc = false;   // bật/tắt phụ đề YouTube — nhớ trong phiên
const EX_VIDEO_RATES = [1, 0.75, 0.5];

function openExampleVideo(btnEl, youtubeId, start, end) {
  const modalBox = document.querySelector('#exampleVideoModal .example-video-modal-box');
  if (modalBox) {
    // Popup rộng bằng đúng ô định nghĩa (.def-block) chứa nút vừa bấm, để không bị lệch tông với layout xung quanh
    const refBox = btnEl && btnEl.closest ? btnEl.closest('.def-block') : null;
    const w = refBox ? refBox.getBoundingClientRect().width : 0;
    modalBox.style.width = w > 0 ? Math.round(w) + 'px' : '';
  }
  const wrap = document.getElementById('exampleVideoPlayerWrap');
  if (!wrap) return;
  const hasRange = start != null && end != null && end > start;
  const capEntry = exVideoCaptionsMap[exVideoKey(youtubeId, start, end)] || null;
  exampleVideoState = { id: youtubeId, start: start != null ? start : null, end: hasRange ? end : null, captions: capEntry ? capEntry.caps : null, capsDefault: capEntry ? capEntry.showDefault : false };
  closeExampleVideoSpeaking();
  exampleVideoCapIdx = -1;
  exampleVideoSentenceLoop = false;
  exampleVideoLoopIdx = -1;
  exampleVideoLoopAuto = false;
  exampleVideoLoopPlays = 0;
  syncExampleVideoControls();
  syncExampleVideoPlayIcon(false);
  setExampleVideoSource(youtubeId, exampleVideoState.start, '');
  document.getElementById('exampleVideoModal').classList.add('show');
  createExampleVideoPlayer(exampleVideoState.start);
}

// Dựng (hoặc dựng lại) trình phát. YT.Player thay thẻ đích bằng iframe và destroy() xoá luôn iframe nên mỗi lần dựng phải tạo lại thẻ đích.
// KHÔNG truyền "end" vào playerVars: YouTube sẽ dừng hẳn ở mốc đó (trạng thái ENDED) nên không lặp được — tự canh mốc kết thúc bằng
// đồng hồ 80ms bên dưới để lặp đúng đoạn, lệch tối đa ~0,1s (trước đây 0,3s).
function createExampleVideoPlayer(startSec) {
  const state = exampleVideoState;
  const wrap = document.getElementById('exampleVideoPlayerWrap');
  if (!wrap || !state.id) return;
  if (exampleVideoLoopTimer) { clearInterval(exampleVideoLoopTimer); exampleVideoLoopTimer = null; }
  destroyExYtPlayer('modal', 'main');
  wrap.innerHTML = '<div id="exampleVideoPlayer"></div>';
  loadYouTubeApi().then(() => {
    if (state !== exampleVideoState) return; // đã đóng/mở video khác trước khi API kịp tải
    if (!document.getElementById('exampleVideoPlayer')) return;
    const from = startSec != null ? Number(startSec) : null;
    // GIỮ thanh điều khiển gốc của YouTube (mặc định controls:1) — chính sách YouTube API cấm phủ lớp/nút lên trước trình phát, nên mọi nút của app
    // (phát/tạm dừng, tốc độ, lặp câu, phụ đề...) nằm ở thẻ bên DƯỚI video, không đè lên video.
    const vars = { rel: 0, modestbranding: 1, autoplay: 1, playsinline: 1, iv_load_policy: 3, cc_load_policy: exampleVideoCc ? 1 : 0, cc_lang_pref: 'th', hl: 'vi' };
    if (from != null && from > 0) vars.start = Math.floor(from); // playerVars.start chỉ nhận số nguyên giây — phần lẻ tua lại ở onReady
    if (location.protocol === 'http:' || location.protocol === 'https:') vars.origin = location.origin;
    ytPlayers['modal-main'] = new YT.Player('exampleVideoPlayer', {
      height: '100%', width: '100%',
      videoId: state.id,
      playerVars: vars,
      events: {
        onReady: (e) => {
          if (from != null && from > 0 && !Number.isInteger(from)) e.target.seekTo(from, true);
          applyExampleVideoRate(e.target);
          refreshExampleVideoSourceFromPlayer(e.target);
        },
        onError: (e) => onExYtPlayerError('modal', 'main', e.data),
        onStateChange: (e) => {
          if (exampleVideoLoopTimer) { clearInterval(exampleVideoLoopTimer); exampleVideoLoopTimer = null; }
          const p = e.target;
          syncExampleVideoPlayIcon(e.data === YT.PlayerState.PLAYING);
          if (e.data === YT.PlayerState.PLAYING) {
            applyExampleVideoRate(p);
            refreshExampleVideoSourceFromPlayer(p);
            exampleVideoLoopTimer = setInterval(() => {
              if (typeof p.getCurrentTime !== 'function') return;
              const t = p.getCurrentTime();
              if (exampleVideoSentenceLoop && state.captions && state.captions[exampleVideoLoopIdx]) {
                const cap = state.captions[exampleVideoLoopIdx];
                const guarded = Date.now() < exampleVideoLoopGuardUntil;
                if (!guarded && (t >= cap.end + 0.6 || t < cap.start - 0.4)) {
                  // Người học tự kéo thanh tiến độ gốc của YouTube sang chỗ khác → khóa lặp sang câu ở vị trí mới, không kéo ngược về câu cũ
                  relockExampleVideoSentenceLoop(t);
                } else if (!guarded && t >= cap.end - 0.05) {
                  exampleVideoLoopGuardUntil = Date.now() + 500;
                  if (!exampleVideoLoopAuto) { p.seekTo(cap.start, true); return; } // lặp liên tục câu phụ đề đang chọn
                  // Tự lặp N lần: đủ N lần thì sang câu kế, chưa đủ thì phát lại câu này
                  exampleVideoLoopPlays++;
                  if (exampleVideoLoopPlays < EX_VIDEO_AUTO_REPEATS) { syncExampleVideoLoopBadge(); p.seekTo(cap.start, true); return; }
                  exampleVideoLoopPlays = 0;
                  const next = exampleVideoLoopIdx + 1;
                  if (next < state.captions.length) {
                    exampleVideoLoopIdx = next;
                    syncExampleVideoLoopBadge();
                    p.seekTo(state.captions[next].start, true);
                  } else {
                    // Hết câu cuối: về đầu câu cuối và dừng — bấm phát sẽ lại lặp câu này đủ N lần
                    syncExampleVideoLoopBadge();
                    p.seekTo(cap.start, true);
                    p.pauseVideo();
                  }
                  return;
                }
              }
              if (exampleVideoSpeakPlayUntil != null && t >= exampleVideoSpeakPlayUntil) { exampleVideoSpeakPlayUntil = null; p.pauseVideo(); return; } // "Nghe mẫu" của Luyện nói: phát đúng 1 câu rồi dừng
              if (state.end != null && t >= state.end - 0.05) { p.seekTo(state.start || 0, true); return; } // lặp lại đúng đoạn ví dụ
              updateExampleVideoCaption(t);
            }, 80);
          } else {
            if (typeof p.getCurrentTime === 'function') {
              updateExampleVideoCaption(p.getCurrentTime()); // tạm dừng/tua: cập nhật dòng phụ đề ngay
            }
            if (e.data === YT.PlayerState.ENDED && state.end != null) {
              // đoạn kết thúc sát cuối video: video tự hết trước khi đồng hồ kịp bắt — quay lại đầu đoạn
              p.seekTo(state.start || 0, true);
              p.playVideo();
            }
          }
        }
      }
    });
  });
}

function applyExampleVideoRate(p) {
  try {
    const rates = typeof p.getAvailablePlaybackRates === 'function' ? p.getAvailablePlaybackRates() : null;
    if (rates && rates.length && rates.indexOf(exampleVideoRate) === -1) return; // video không hỗ trợ tốc độ này
    if (p.getPlaybackRate() !== exampleVideoRate) p.setPlaybackRate(exampleVideoRate);
  } catch (err) {}
}

// Đồng bộ trạng thái nút tốc độ + CC + Phụ đề trên thanh điều khiển của popup.
// Video có phụ đề tự viết: hiện nút "Phụ đề" (tự viết), ẩn nút CC của YouTube để khỏi trùng 2 dòng phụ đề.
function exampleVideoCapMode() {
  const st = exampleVideoState;
  if (!st.captions || !st.captions.length) return 'OFF';
  if (exampleVideoCapModePref) return exampleVideoCapModePref;
  return st.capsDefault ? 'ALL' : 'OFF';
}
function exampleVideoCapsOn() { return exampleVideoCapMode() !== 'OFF'; }
function syncExampleVideoControls() {
  const speedBtn = document.getElementById('exampleVideoSpeedBtn');
  if (speedBtn) {
    speedBtn.textContent = String(exampleVideoRate).replace('.', ',') + 'x';
    speedBtn.classList.toggle('active', exampleVideoRate !== 1); // sáng lên khi đang không phải tốc độ thường
  }
  const nav = document.getElementById('exampleVideoNav');
  if (nav) nav.style.display = (exampleVideoState.captions && exampleVideoState.captions.length) ? '' : 'none';
  const hasCaps = !!(exampleVideoState.captions && exampleVideoState.captions.length);
  const capsOn = exampleVideoCapsOn();
  const cc = document.getElementById('exampleVideoCcBtn');
  if (cc) {
    cc.style.display = hasCaps ? 'none' : '';
    cc.classList.toggle('active', exampleVideoCc);
    cc.setAttribute('aria-pressed', exampleVideoCc ? 'true' : 'false');
  }
  const capsBtn = document.getElementById('exampleVideoCapsBtn');
  if (capsBtn) {
    capsBtn.style.display = hasCaps ? '' : 'none';
    capsBtn.textContent = exampleVideoCapMode(); // TH · VI · ALL · OFF
    capsBtn.classList.toggle('active', capsOn);
    capsBtn.setAttribute('aria-pressed', capsOn ? 'true' : 'false');
  }
  const loopBtn = document.getElementById('exampleVideoLoopBtn');
  if (loopBtn) {
    loopBtn.style.display = hasCaps ? '' : 'none'; // lặp câu cần phụ đề tự viết để biết ranh giới từng câu
    loopBtn.classList.toggle('active', exampleVideoSentenceLoop);
    loopBtn.classList.toggle('is-auto', exampleVideoSentenceLoop && exampleVideoLoopAuto);
    loopBtn.setAttribute('aria-pressed', exampleVideoSentenceLoop ? 'true' : 'false');
    const label = !exampleVideoSentenceLoop ? 'Lặp lại câu hiện tại'
      : (exampleVideoLoopAuto ? 'Đang tự lặp ' + EX_VIDEO_AUTO_REPEATS + ' lần rồi sang câu sau — bấm để tắt'
        : 'Đang lặp liên tục câu này — bấm để chuyển sang tự lặp ' + EX_VIDEO_AUTO_REPEATS + ' lần rồi sang câu sau');
    loopBtn.title = label;
    loopBtn.setAttribute('aria-label', label);
    syncExampleVideoLoopBadge();
  }
  const panel = document.getElementById('exampleVideoCaption');
  if (panel) {
    panel.style.display = hasCaps && capsOn ? '' : 'none';
    if (!(hasCaps && capsOn)) { panel.innerHTML = ''; exampleVideoCapIdx = -1; closeExampleVideoLookup(); }
  }
  const actions = document.getElementById('exampleVideoActions');
  if (actions) actions.style.display = exampleVideoState.id ? '' : 'none'; // "Lưu video" áp dụng cho MỌI video; "Lưu câu"/"Luyện tập" cần phụ đề tự viết
  ['exampleVideoSaveBtn', 'exampleVideoPracticeBtn', 'exampleVideoSpeakBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = hasCaps ? '' : 'none'; });
  syncExampleVideoSaveVideoBtn();
  exampleVideoSaveIdx = -2;
  syncExampleVideoSaveBtn(null);
  buildExampleVideoCaptionList();
}

// Hiện dòng phụ đề đang đọc tại thời điểm t (giây). Chỉ chạm DOM khi đổi sang dòng khác.
function updateExampleVideoCaption(t) {
  syncExampleVideoSaveBtn(t); // nút "Lưu câu" theo dõi câu đang đọc kể cả khi phụ đề đang OFF
  if (!exampleVideoCapsOn()) return;
  const panel = document.getElementById('exampleVideoCaption');
  if (!panel) return;
  const caps = exampleVideoState.captions;
  let idx = -1;
  for (let i = 0; i < caps.length; i++) { if (t >= caps[i].start && t < caps[i].end) { idx = i; break; } }
  if (idx === exampleVideoCapIdx) return;
  exampleVideoCapIdx = idx;
  closeExampleVideoLookup(); // sang câu khác thì đóng thẻ tra từ của câu trước
  highlightExampleVideoListItem(idx);
  if (idx === -1) { panel.innerHTML = ''; return; }
  const c = caps[idx];
  const mode = exampleVideoCapMode();
  // TH: chỉ chữ Thái · VI: chỉ chữ Việt (to như dòng chính) · ALL: cả hai. Chữ Thái tách từ và BẤM ĐƯỢC để tra nghĩa.
  panel.innerHTML = (c.thai && mode !== 'VI' ? '<div class="ev-cap-thai">' + renderExampleVideoThaiWords(c.thai) + '</div>' : '')
    + (c.viet && mode === 'ALL' ? '<div class="ev-cap-viet">' + escapeHtml(c.viet) + '</div>' : '')
    + (c.viet && mode === 'VI' ? '<div class="ev-cap-thai ev-cap-vi-main">' + escapeHtml(c.viet) + '</div>' : '');
}

// Tách câu Thái thành các từ (dùng lại segmentThai() của PopThai) → mỗi từ là 1 <span> bấm được; từ có trong từ điển được gạch chân chấm
function renderExampleVideoThaiWords(text) {
  return segmentThai(text).map(seg => {
    if (seg.isSpace) return ' ';
    if (!THAI_RE.test(seg.thai)) return escapeHtml(seg.thai); // dấu câu, số... không bấm
    const inDict = getSegmentDictSet().has(seg.thai);
    return '<span class="ev-cap-word' + (inDict ? ' has-def' : '') + '" data-w="' + escapeHtml(seg.thai) + '">' + escapeHtml(seg.thai) + '</span>';
  }).join('');
}

// ── TRA TỪ KHI BẤM CHỮ THÁI TRONG PHỤ ĐỀ ──────────────────────────────────
// Bấm 1 từ: tạm dừng video để kịp đọc, hiện thẻ nghĩa ngay dưới câu (không rời popup). "Xem đầy đủ" mới đóng video và mở trang kết quả của từ.
document.addEventListener('click', e => {
  const el = e.target && e.target.closest ? e.target.closest('#exampleVideoCaption .ev-cap-word') : null;
  if (el) onExampleVideoWordClick(el);
});
function onExampleVideoWordClick(el) {
  const p = ytPlayers['modal-main'];
  try { if (p && typeof p.getPlayerState === 'function' && p.getPlayerState() === 1) p.pauseVideo(); } catch (err) {}
  document.querySelectorAll('#exampleVideoCaption .ev-cap-word.active').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  showExampleVideoLookup(el.dataset.w || '');
}
function showExampleVideoLookup(thai) {
  const box = document.getElementById('exampleVideoLookup');
  if (!box) return;
  const word = allWords.find(w => w.thai === thai && w.visible !== false);
  let html = '<div class="ev-lookup-head"><span class="ev-lookup-thai">' + escapeHtml(thai) + '</span>';
  if (word && word.phonetic) html += '<span class="ev-lookup-phon">' + escapeHtml(stripHtml(word.phonetic)) + '</span>';
  html += '<button type="button" class="ev-lookup-close" aria-label="Đóng" onclick="closeExampleVideoLookup()">✕</button></div>';
  if (word) {
    const meanings = (word.meanings || []).map(m => stripHtml(m)).filter(Boolean).slice(0, 4);
    html += (word.type ? '<div class="ev-lookup-type">' + escapeHtml(word.type) + '</div>' : '')
      + (meanings.length ? '<ul class="ev-lookup-meanings">' + meanings.map(m => '<li>' + escapeHtml(m) + '</li>').join('') + '</ul>' : '')
      + '<button type="button" class="ev-lookup-more" onclick="openWordFromExampleVideo(' + Number(word.id) + ')">Xem đầy đủ →</button>';
  } else {
    html += '<div class="ev-lookup-none">Chưa có từ này trong từ điển.</div>';
  }
  box.innerHTML = html;
  box.style.display = '';
}
function closeExampleVideoLookup() {
  const box = document.getElementById('exampleVideoLookup');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  document.querySelectorAll('#exampleVideoCaption .ev-cap-word.active').forEach(x => x.classList.remove('active'));
}
function openWordFromExampleVideo(id) {
  closeExampleVideo();
  goToWord(id);
}

// ── DANH SÁCH CÂU: BẤM ĐỂ TUA ───────────────────────────────────────────
// Liệt kê mọi câu phụ đề (giờ + chữ theo chế độ TH/VI/ALL), câu đang đọc được tô sáng và tự cuộn vào giữa khung; bấm 1 câu = tua tới đầu câu đó và phát.
// Chế độ OFF thì ẩn cả danh sách (nếu không sẽ lộ chữ, mất ý nghĩa của chế độ tự luyện nghe).
let exampleVideoListKey = '';
let exampleVideoSaveIdx = -2; // chỉ số câu mà nút "Lưu câu" đang phản ánh (-2 = chưa tính)
function exampleVideoListTime(sec) {
  const r = Math.max(0, Math.floor(sec));
  return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
}
function buildExampleVideoCaptionList() {
  const list = document.getElementById('exampleVideoCaptionList');
  if (!list) return;
  const st = exampleVideoState;
  const mode = exampleVideoCapMode();
  const show = !!(st.captions && st.captions.length) && mode !== 'OFF';
  list.style.display = show ? '' : 'none';
  const key = show ? st.id + '|' + st.start + '|' + mode : '';
  if (key === exampleVideoListKey) return;
  exampleVideoListKey = key;
  if (!show) { list.innerHTML = ''; return; }
  list.innerHTML = st.captions.map((c, i) => {
    const thai = c.thai && mode !== 'VI' ? '<span class="ev-list-thai">' + escapeHtml(c.thai) + '</span>' : '';
    const viet = c.viet && mode !== 'TH' ? '<span class="' + (mode === 'VI' ? 'ev-list-thai ev-list-vi-main' : 'ev-list-viet') + '">' + escapeHtml(c.viet) + '</span>' : '';
    return '<button type="button" class="ev-list-item" data-i="' + i + '" onclick="jumpToExampleVideoCaption(' + i + ')">'
      + '<span class="ev-list-time">' + exampleVideoListTime(c.start) + '</span>'
      + '<span class="ev-list-text">' + thai + viet + '</span></button>';
  }).join('');
  highlightExampleVideoListItem(exampleVideoCapIdx);
}
function highlightExampleVideoListItem(idx) {
  const list = document.getElementById('exampleVideoCaptionList');
  if (!list || list.style.display === 'none') return;
  list.querySelectorAll('.ev-list-item.active').forEach(x => x.classList.remove('active'));
  if (idx < 0) return;
  const item = list.querySelector('.ev-list-item[data-i="' + idx + '"]');
  if (!item) return;
  item.classList.add('active');
  // Cuộn BÊN TRONG khung danh sách (không dùng scrollIntoView để khỏi kéo cả popup/trang)
  list.scrollTop = Math.max(0, item.offsetTop - (list.clientHeight - item.offsetHeight) / 2);
}
function jumpToExampleVideoCaption(i) {
  const p = ytPlayers['modal-main'];
  const caps = exampleVideoState.captions;
  if (!p || typeof p.seekTo !== 'function' || !caps || !caps[i]) return;
  p.seekTo(caps[i].start, true);
  if (exampleVideoSentenceLoop) { exampleVideoLoopIdx = i; exampleVideoLoopPlays = 0; exampleVideoLoopGuardUntil = Date.now() + 500; syncExampleVideoLoopBadge(); } // đang lặp câu → khóa lặp sang câu vừa bấm
  exampleVideoCapIdx = -1;
  updateExampleVideoCaption(caps[i].start + 0.01);
  p.playVideo();
}

// ── LƯU CÂU VÀO ÔN TẬP + LUYỆN TẬP TỪ VIDEO ──────────────────────────────
// "Lưu câu" áp dụng cho câu ĐANG ĐỌC (hoặc câu vừa đọc xong nếu đang ở khoảng lặng giữa 2 câu). Bấm lại khi đã lưu = bỏ lưu.
function syncExampleVideoSaveBtn(t) {
  const btn = document.getElementById('exampleVideoSaveBtn');
  const caps = exampleVideoState.captions;
  if (!btn || !caps || !caps.length) return;
  let time = t;
  if (time == null) {
    const p = ytPlayers['modal-main'];
    time = p && typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : caps[0].start;
  }
  const idx = exampleVideoCaptionIndexAt(time);
  if (idx === exampleVideoSaveIdx) return;
  exampleVideoSaveIdx = idx;
  const saved = idx >= 0 && isSentenceSaved(exampleVideoState.id, caps[idx].start);
  btn.classList.toggle('active', saved);
  btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
  const label = document.getElementById('exampleVideoSaveLabel');
  if (label) label.textContent = saved ? 'Đã lưu' : 'Lưu câu';
}
// ── LUYỆN NÓI (NHẬN DẠNG GIỌNG NÓI CỦA TRÌNH DUYỆT, KHÔNG TỐN PHÍ API) ───────────────────────────
// Người học nghe câu mẫu (đoạn video), bấm micro nói lại; trình duyệt (Web Speech API, lang th-TH) chuyển giọng thành chữ, app so chữ nghe được với câu
// phụ đề mẫu rồi chấm độ khớp + tô màu từng từ đúng/thiếu/sai. KHÔNG chấm thanh điệu/âm vị — chỉ biết máy nghe ra chữ gì.
// Chrome gửi âm thanh lên máy chủ Google để nhận dạng, Safari xử lý trên thiết bị; Firefox mặc định không hỗ trợ → hiện thông báo thay vì micro.
// (Giao diện không còn dòng ghi chú về việc gửi âm thanh — nên nêu điều này trong trang Chính sách quyền riêng tư.)
// Thu âm song song bằng MediaRecorder để cho nghe lại giọng mình là "cố gắng tối đa": có thiết bị không cho 2 thứ dùng micro cùng lúc, khi đó tự tắt phần
// nghe lại (recognition vẫn chạy) để không làm hỏng tính năng chính.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let exampleVideoSpeakPlayUntil = null; // giây: khi video chạy tới mốc này thì tạm dừng (Nghe mẫu)
// Thời gian chờ (ms) khi ghi âm — xem từng mốc bên dưới
// Chốt nhanh (completeSilenceMs) CHỈ khi chữ nghe được đã khớp ≥ completeScore% với câu mẫu (người học gần như đã nói xong); nếu chưa đủ thì chờ kiên nhẫn
// incompleteSilenceMs (người nói chậm đang nghĩ từ tiếp theo). Luôn có thể tự bấm micro để dừng.
const exampleVideoSpeakTiming = { completeSilenceMs: 1800, completeScore: 90, incompleteSilenceMs: 10000, noSpeechMs: 12000, maxMs: 45000, networkRetries: 2 };
const speakState = { open: false, idx: -1, rec: null, listening: false, want: false, fatal: false, startedAt: 0, lastResultAt: 0, watchdog: null, restartTimer: null, netRetries: 0, interim: '', accFinals: [], accAlts: [], finals: [], alts: [], result: null, error: '', recorder: null, stream: null, chunks: [], audioUrl: null, recorderOff: false };

// Chuẩn hóa để so khớp: bỏ khoảng trắng, dấu câu, ký hiệu; thường hóa
function speakNormalize(str) {
  return String(str || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
// Chấm 1 chuỗi nghe được so với câu mẫu: căn chỉnh theo dãy ký tự dài chung nhất (LCS) rồi tính điểm theo từng từ (tách bằng segmentThai)
function evaluateSpeaking(targetText, heardText) {
  const words = [];
  const tChars = [];
  segmentThai(String(targetText || '')).forEach(seg => {
    if (seg.isSpace) return;
    const norm = speakNormalize(seg.thai);
    if (!norm) return;
    const wi = words.length;
    words.push({ text: seg.thai, total: 0, matched: 0 });
    [...norm].forEach(ch => { tChars.push({ ch: ch, wi: wi }); words[wi].total++; });
  });
  const h = [...speakNormalize(heardText)];
  const n = tChars.length, m = h.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = tChars[i - 1].ch === h[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (tChars[i - 1].ch === h[j - 1]) { words[tChars[i - 1].wi].matched++; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  const lcs = dp[n][m];
  const score = n + m === 0 ? 0 : Math.round((2 * lcs / (n + m)) * 100); // Dice: phạt cả thiếu lẫn thừa chữ
  words.forEach(w => {
    const r = w.total ? w.matched / w.total : 0;
    w.status = r >= 0.8 ? 'ok' : (r >= 0.4 ? 'part' : 'miss');
  });
  return { score: score, words: words, heard: heardText };
}

// Biểu tượng nét line (stroke) dùng chung cho khung Luyện nói — đồng bộ với các nút line khác của popup video
const EV_LINE_ICON_SPEAKER = '<svg class="ev-ico-line" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
const EV_LINE_ICON_MIC = '<svg class="ev-ico-line" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg>';
const EV_LINE_ICON_PLAY = '<svg class="ev-ico-line" viewBox="0 0 24 24"><path d="m6 4 14 8-14 8z"/></svg>';
function exampleVideoSpeakTarget() {
  const caps = exampleVideoState.captions;
  return caps && caps[speakState.idx] ? caps[speakState.idx] : null;
}
function toggleExampleVideoSpeaking() {
  const caps = exampleVideoState.captions;
  if (!caps || !caps.length) return;
  if (speakState.open) { closeExampleVideoSpeaking(); return; }
  const p = ytPlayers['modal-main'];
  let t = caps[0].start;
  try { if (p && typeof p.getCurrentTime === 'function') t = p.getCurrentTime(); if (p && p.pauseVideo) p.pauseVideo(); } catch (err) {} // tạm dừng để mic không thu cả tiếng video
  speakState.open = true;
  speakState.idx = exampleVideoCaptionIndexAt(t);
  resetExampleVideoSpeakResult();
  renderExampleVideoSpeaking();
  const btn = document.getElementById('exampleVideoSpeakBtn');
  if (btn) btn.classList.add('active');
}
function closeExampleVideoSpeaking() {
  stopExampleVideoSpeakRecognition(true);
  releaseExampleVideoSpeakAudio();
  exampleVideoSpeakPlayUntil = null;
  speakState.open = false;
  speakState.idx = -1;
  const box = document.getElementById('exampleVideoSpeak');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  const btn = document.getElementById('exampleVideoSpeakBtn');
  if (btn) btn.classList.remove('active');
}
function resetExampleVideoSpeakResult() {
  stopExampleVideoSpeakRecognition(true);
  releaseExampleVideoSpeakAudio();
  speakState.interim = ''; speakState.finals = []; speakState.alts = []; speakState.accFinals = []; speakState.accAlts = []; speakState.result = null; speakState.error = '';
}
function releaseExampleVideoSpeakAudio() {
  if (speakState.audioUrl) { try { URL.revokeObjectURL(speakState.audioUrl); } catch (err) {} speakState.audioUrl = null; }
}
function exampleVideoSpeakNav(dir) {
  const caps = exampleVideoState.captions;
  if (!caps || !caps.length) return;
  const next = Math.max(0, Math.min(caps.length - 1, speakState.idx + dir));
  if (next === speakState.idx) return;
  speakState.idx = next;
  resetExampleVideoSpeakResult();
  const p = ytPlayers['modal-main'];
  try { if (p && p.seekTo) { p.seekTo(caps[next].start, true); if (p.pauseVideo) p.pauseVideo(); } } catch (err) {}
  renderExampleVideoSpeaking();
}
// Nghe mẫu: phát đúng đoạn của câu rồi tự dừng (xem kiểm tra ở vòng lặp đồng hồ)
function exampleVideoSpeakPlayModel() {
  const c = exampleVideoSpeakTarget();
  const p = ytPlayers['modal-main'];
  if (!c || !p) return;
  stopExampleVideoSpeakRecognition(true);
  exampleVideoSpeakPlayUntil = c.end - 0.05;
  try { p.seekTo(c.start, true); p.playVideo(); } catch (err) {}
}
function exampleVideoSpeakPlayMine() {
  if (!speakState.audioUrl) return;
  const p = ytPlayers['modal-main'];
  try { if (p && p.pauseVideo) p.pauseVideo(); } catch (err) {}
  new Audio(speakState.audioUrl).play().catch(() => {});
}

function speakErrorMessage(code) {
  const map = {
    'not-allowed': 'Trình duyệt chưa được phép dùng micro. Hãy cho phép micro cho trang này rồi thử lại.',
    'service-not-allowed': 'Trình duyệt không cho dùng dịch vụ nhận dạng giọng nói.',
    'no-speech': 'Không nghe thấy giọng nói. Hãy nói gần micro hơn rồi thử lại.',
    'audio-capture': 'Không tìm thấy micro (hoặc micro đang bận). Kiểm tra micro rồi thử lại.',
    'network': 'Lỗi mạng khi nhận dạng giọng nói. Kiểm tra kết nối rồi thử lại.',
    'language-not-supported': 'Trình duyệt này chưa hỗ trợ nhận dạng tiếng Thái.'
  };
  return map[code] || 'Không nhận dạng được giọng nói (' + code + '). Thử lại nhé.';
}
function exampleVideoSpeakToggleRecord() {
  if (speakState.want) { stopExampleVideoSpeakRecognition(false); return; } // bấm micro lần nữa = người học tự chốt
  startExampleVideoSpeakRecognition();
}
// Ghi âm KÉO DÀI: trình duyệt tự ngắt nhận dạng sau một khoảng ngập ngừng ngắn nên người nói chậm bị cắt giữa câu. Cách xử lý:
//  - continuous = true để không ngắt ở chỗ ngừng ngắn;
//  - nếu trình duyệt vẫn tự kết thúc phiên (Chrome ngắt khi im lặng lâu) mà người học chưa bấm dừng → mở phiên mới ngay và NỐI kết quả;
//  - chỉ tự chốt khi (a) người học bấm dừng, (b) đã nói rồi mà im lặng quá exampleVideoSpeakTiming.silenceMs,
//    (c) chưa nói gì quá noSpeechMs, hoặc (d) quá maxMs.
function startExampleVideoSpeakRecognition() {
  if (!SpeechRecognitionCtor) return;
  resetExampleVideoSpeakResult();
  exampleVideoSpeakPlayUntil = null;
  const p = ytPlayers['modal-main'];
  try { if (p && p.pauseVideo) p.pauseVideo(); } catch (err) {} // video đang phát sẽ lọt vào micro
  speakState.want = true;
  speakState.fatal = false;
  speakState.netRetries = 0;
  speakState.listening = true;
  speakState.startedAt = Date.now();
  speakState.lastResultAt = 0;
  speakState.watchdog = setInterval(exampleVideoSpeakWatchdog, 300);
  openExampleVideoSpeakSession();
  renderExampleVideoSpeaking();
}
function openExampleVideoSpeakSession() {
  const rec = new SpeechRecognitionCtor();
  rec.lang = 'th-TH';
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 3;
  speakState.rec = rec;
  speakState.finals = []; speakState.alts = []; speakState.interim = '';
  rec.onstart = () => { startExampleVideoSpeakRecorder(); };
  rec.onresult = (e) => {
    let interim = '';
    const finals = [], alts = [];
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finals.push(r[0].transcript);
        const a = []; for (let k = 0; k < r.length; k++) a.push(r[k].transcript);
        alts.push(a);
      } else { interim += r[0].transcript; }
    }
    // Một số máy (Android) lặp lại kết quả cũ kèm phần mới → cái sau bắt đầu bằng cái trước thì thay thế thay vì nối thêm
    const mergedFinals = [], mergedAlts = [];
    finals.forEach((f, i) => {
      const last = mergedFinals.length - 1;
      if (last >= 0 && speakNormalize(f).indexOf(speakNormalize(mergedFinals[last])) === 0) { mergedFinals[last] = f; mergedAlts[last] = alts[i]; }
      else { mergedFinals.push(f); mergedAlts.push(alts[i]); }
    });
    speakState.finals = mergedFinals; speakState.alts = mergedAlts; speakState.interim = interim;
    speakState.lastResultAt = Date.now();
    updateExampleVideoSpeakingLive();
  };
  rec.onerror = (e) => {
    const code = e && e.error ? e.error : 'unknown';
    // 'no-speech' / 'aborted' chỉ là phiên hết hạn — onend sẽ mở phiên mới. Các lỗi còn lại là lỗi thật: dừng hẳn.
    if (code === 'no-speech' || code === 'aborted') return;
    // Lỗi mạng của dịch vụ nhận dạng thường chỉ chập chờn: thử mở lại phiên vài lần trước khi bỏ cuộc (đỡ bị "ngừng thu âm" giữa chừng)
    if (code === 'network' && speakState.netRetries < exampleVideoSpeakTiming.networkRetries) { speakState.netRetries++; console.info('[Luyện nói] lỗi mạng, thử lại lần', speakState.netRetries); return; }
    console.info('[Luyện nói] dừng vì lỗi:', code);
    speakState.error = code;
    speakState.fatal = true;
    if (code === 'audio-capture' && speakState.recorder) speakState.recorderOff = true; // có thể 2 luồng micro tranh nhau → lần sau chỉ nhận dạng
  };
  rec.onend = () => {
    // Gộp kết quả của phiên vừa xong vào phần đã tích lũy
    speakState.accFinals = speakState.accFinals.concat(speakState.finals);
    speakState.accAlts = speakState.accAlts.concat(speakState.alts);
    if (speakState.interim) { speakState.accFinals.push(speakState.interim); speakState.accAlts.push([speakState.interim]); }
    speakState.finals = []; speakState.alts = []; speakState.interim = '';
    const elapsed = Date.now() - speakState.startedAt;
    if (speakState.want && !speakState.fatal && elapsed < exampleVideoSpeakTiming.maxMs) {
      // Trình duyệt tự ngắt phiên nhưng người học chưa dừng → nghe tiếp
      console.info('[Luyện nói] trình duyệt kết thúc phiên sau', Math.round(elapsed / 100) / 10, 's, mở phiên mới');
      clearTimeout(speakState.restartTimer);
      speakState.restartTimer = setTimeout(() => { if (speakState.want && speakState.open) openExampleVideoSpeakSession(); }, 30); // mở lại gần như tức thì để không hụt chữ
      return;
    }
    finishExampleVideoSpeakListening();
  };
  try { rec.start(); } catch (err) { speakState.error = 'audio-capture'; speakState.fatal = true; finishExampleVideoSpeakListening(); }
}
// Canh thời gian. Chốt khi: quá maxMs · chưa nói gì quá noSpeechMs · đã nói rồi mà im lặng đủ lâu — NGẮN (completeSilenceMs) nếu chữ nghe được
// đã khớp gần hết câu mẫu, DÀI (incompleteSilenceMs) nếu còn thiếu (người nói chậm vẫn đang nghĩ từ tiếp theo).
function exampleVideoSpeakWatchdog() {
  if (!speakState.want) return;
  const now = Date.now();
  const t = exampleVideoSpeakTiming;
  if (now - speakState.startedAt >= t.maxMs) { stopExampleVideoSpeakRecognition(false); return; }
  if (speakState.lastResultAt === 0) {
    if (now - speakState.startedAt >= t.noSpeechMs) stopExampleVideoSpeakRecognition(false);
    return;
  }
  const silence = now - speakState.lastResultAt;
  if (silence < t.completeSilenceMs) return;
  const target = exampleVideoSpeakTarget();
  const live = exampleVideoSpeakLiveText();
  const complete = !!target && !!live && evaluateSpeaking(target.thai, live).score >= t.completeScore;
  if (complete || silence >= t.incompleteSilenceMs) stopExampleVideoSpeakRecognition(false);
}
function stopExampleVideoSpeakRecognition(silent) {
  speakState.want = false;
  clearInterval(speakState.watchdog); speakState.watchdog = null;
  clearTimeout(speakState.restartTimer); speakState.restartTimer = null;
  const rec = speakState.rec;
  if (rec) {
    if (silent) { rec.onend = null; rec.onresult = null; rec.onerror = null; try { rec.abort(); } catch (err) {} }
    else { try { rec.stop(); } catch (err) {} } // onend sẽ gọi finishExampleVideoSpeakListening
  }
  if (silent) { speakState.rec = null; speakState.listening = false; stopExampleVideoSpeakRecorder(); }
}
function finishExampleVideoSpeakListening() {
  speakState.want = false;
  speakState.listening = false;
  clearInterval(speakState.watchdog); speakState.watchdog = null;
  clearTimeout(speakState.restartTimer); speakState.restartTimer = null;
  speakState.rec = null;
  stopExampleVideoSpeakRecorder();
  finalizeExampleVideoSpeak();
}
// Thu âm song song để cho nghe lại — lỗi thì bỏ qua, không ảnh hưởng nhận dạng
async function startExampleVideoSpeakRecorder() {
  if (speakState.recorder || speakState.recorderOff || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!speakState.listening) { stream.getTracks().forEach(t => t.stop()); return; }
    speakState.stream = stream;
    speakState.chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) speakState.chunks.push(ev.data); };
    mr.onstop = () => {
      if (speakState.chunks.length) {
        releaseExampleVideoSpeakAudio();
        speakState.audioUrl = URL.createObjectURL(new Blob(speakState.chunks, { type: mr.mimeType || 'audio/webm' }));
        if (speakState.open) renderExampleVideoSpeaking();
      }
    };
    speakState.recorder = mr;
    mr.start();
  } catch (err) { speakState.recorderOff = true; }
}
function stopExampleVideoSpeakRecorder() {
  const mr = speakState.recorder;
  speakState.recorder = null;
  try { if (mr && mr.state !== 'inactive') mr.stop(); } catch (err) {}
  if (speakState.stream) { speakState.stream.getTracks().forEach(t => t.stop()); speakState.stream = null; }
}
function finalizeExampleVideoSpeak() {
  const target = exampleVideoSpeakTarget();
  if (!target) return;
  const finals = speakState.accFinals.slice();
  const alts = speakState.accAlts.slice();
  const candidates = [];
  if (finals.length === 1) {
    // Chỉ 1 đoạn: thử cả các phương án khác mà trình duyệt đề xuất
    (alts[0] || [finals[0]]).forEach(x => candidates.push(x));
  } else if (finals.length > 1) {
    candidates.push(finals.join(' ')); // nhiều đoạn (nói ngắt quãng): nối các đoạn lại thành 1 câu
  }
  if (!candidates.length) {
    if (!speakState.error) speakState.error = 'no-speech';
    speakState.result = null;
  } else {
    // Chọn bản nghe được khớp nhất với câu mẫu
    let best = null;
    candidates.forEach(c => { const ev = evaluateSpeaking(target.thai, c); if (!best || ev.score > best.score) best = ev; });
    speakState.result = best;
    speakState.error = speakState.fatal ? speakState.error : '';
  }
  renderExampleVideoSpeaking();
}
function exampleVideoSpeakLiveText() {
  return speakState.accFinals.concat(speakState.finals).concat(speakState.interim ? [speakState.interim] : []).join(' ').trim();
}
function updateExampleVideoSpeakingLive() {
  const live = document.getElementById('exampleVideoSpeakLive');
  if (live) live.textContent = exampleVideoSpeakLiveText();
}
function renderExampleVideoSpeaking() {
  const box = document.getElementById('exampleVideoSpeak');
  if (!box) return;
  const caps = exampleVideoState.captions;
  const c = exampleVideoSpeakTarget();
  if (!speakState.open || !c) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  if (!SpeechRecognitionCtor) {
    box.innerHTML = '<div class="ev-speak-head"><span class="ev-speak-title">' + EV_LINE_ICON_MIC + 'Luyện nói</span><button type="button" class="ev-lookup-close" aria-label="Đóng" onclick="closeExampleVideoSpeaking()">✕</button></div>'
      + '<div class="ev-speak-msg">Trình duyệt này chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome, Edge hoặc Safari (iOS 14.5 trở lên).</div>';
    return;
  }
  const res = speakState.result;
  // Câu mẫu: có kết quả thì tô màu từng từ, chưa có thì hiện chữ thường
  let targetHTML;
  if (res) {
    targetHTML = res.words.map(w => '<span class="ev-speak-w ' + w.status + '">' + escapeHtml(w.text) + '</span>').join('');
  } else {
    targetHTML = escapeHtml(c.thai);
  }
  let resultHTML = '';
  if (speakState.listening) {
    resultHTML = '<div class="ev-speak-live-wrap"><span class="ev-speak-rec-dot"></span><span id="exampleVideoSpeakLive" class="ev-speak-live">' + escapeHtml(exampleVideoSpeakLiveText()) + '</span></div><div class="ev-speak-hint">Đang nghe… cứ nói chậm cũng được, app sẽ chờ bạn. Nói xong bấm micro để dừng.</div>';
  } else if (res) {
    const label = res.score >= 85 ? 'Rất tốt 🎉' : (res.score >= 60 ? 'Khá tốt, gần đúng rồi' : 'Chưa khớp, thử lại nhé');
    resultHTML = '<div class="ev-speak-score ' + (res.score >= 85 ? 'great' : (res.score >= 60 ? 'good' : 'low')) + '"><span class="ev-speak-score-num">' + res.score + '%</span><span class="ev-speak-score-label">' + label + '</span></div>';
  } else if (speakState.error) {
    resultHTML = '<div class="ev-speak-msg err">' + escapeHtml(speakErrorMessage(speakState.error)) + '</div>';
  } else {
    resultHTML = '<div class="ev-speak-hint">Bấm micro rồi đọc câu trên. Nên bấm "Nghe mẫu" trước.</div>';
  }
  box.innerHTML =
    '<div class="ev-speak-head"><span class="ev-speak-title">' + EV_LINE_ICON_MIC + 'Luyện nói</span>'
    + '<span class="ev-speak-count">Câu ' + (speakState.idx + 1) + '/' + caps.length + '</span>'
    + '<button type="button" class="ev-lookup-close" aria-label="Đóng" onclick="closeExampleVideoSpeaking()">✕</button></div>'
    + '<div class="ev-speak-target">' + targetHTML + '</div>'
    + (c.viet ? '<div class="ev-speak-viet">' + escapeHtml(c.viet) + '</div>' : '')
    + '<div class="ev-speak-controls">'
    +   '<div class="ev-speak-row-main">'
    +     '<button type="button" class="ev-circle" aria-label="Câu trước" title="Câu trước" onclick="exampleVideoSpeakNav(-1)"' + (speakState.idx <= 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>'
    +     '<button type="button" class="ev-speak-mic' + (speakState.listening ? ' listening' : '') + '" aria-label="' + (speakState.listening ? 'Dừng' : 'Bắt đầu nói') + '" onclick="exampleVideoSpeakToggleRecord()"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/></svg></button>'
    +     '<button type="button" class="ev-circle" aria-label="Câu sau" title="Câu sau" onclick="exampleVideoSpeakNav(1)"' + (speakState.idx >= caps.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>'
    +   '</div>'
    +   '<div class="ev-speak-row-sub">'
    +     '<button type="button" class="ev-speak-model-btn" onclick="exampleVideoSpeakPlayModel()">' + EV_LINE_ICON_SPEAKER + 'Nghe mẫu</button>'
    +     (speakState.audioUrl ? '<button type="button" class="ev-speak-model-btn" onclick="exampleVideoSpeakPlayMine()">' + EV_LINE_ICON_PLAY + 'Giọng của bạn</button>' : '')
    +   '</div>'
    + '</div>'
    + resultHTML;
}

// ── LƯU CẢ VIDEO VÀO SỔ TAY ──────────────────────────────────────────────
function syncExampleVideoSaveVideoBtn() {
  const btn = document.getElementById('exampleVideoSaveVideoBtn');
  const st = exampleVideoState;
  if (!btn || !st.id) return;
  const saved = !!findSavedVideo(st.id, st.start, st.end);
  btn.classList.toggle('active', saved);
  btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
  const label = document.getElementById('exampleVideoSaveVideoLabel');
  if (label) label.textContent = saved ? 'Đã lưu video' : 'Lưu video';
}
// Lưu video (đoạn ví dụ + phụ đề đã chụp lại) rồi mở popup chọn thư mục. Đã lưu thì bấm lại = bỏ lưu (có hỏi xác nhận vì mất cả thư mục đã xếp).
async function toggleExampleVideoSaveVideo() {
  const st = exampleVideoState;
  if (!st.id) return;
  const existing = findSavedVideo(st.id, st.start, st.end);
  if (existing) {
    if (!confirm('Bỏ video này khỏi Sổ tay?')) return;
    await removeSavedVideoById(existing.id);
    showToast('Đã bỏ video khỏi Sổ tay');
    syncExampleVideoSaveVideoBtn();
    refreshSavedVideosUI();
    return;
  }
  let title = '', author = '';
  try {
    const p = ytPlayers['modal-main'];
    const d = p && typeof p.getVideoData === 'function' ? p.getVideoData() : null;
    if (d) { title = String(d.title || '').trim(); author = String(d.author || '').trim(); }
  } catch (err) {}
  const video = {
    id: makeSavedVideoId(st.id, st.start, st.end), youtubeId: st.id, start: st.start, end: st.end,
    title: title, author: author, captions: (st.captions || []).map(c => ({ start: c.start, end: c.end, thai: c.thai, viet: c.viet })),
    showCaptions: !!st.capsDefault, folders: [], created: Date.now()
  };
  savedVideos.push(video);
  await persistSavedVideo(video);
  syncExampleVideoSaveVideoBtn();
  refreshSavedVideosUI();
  showToast('🎬 Đã lưu video vào Sổ tay');
  openVideoFolderPicker(video.id, true);
}

async function toggleExampleVideoSaveSentence() {
  const caps = exampleVideoState.captions;
  if (!caps || !caps.length) return;
  const p = ytPlayers['modal-main'];
  const t = p && typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : caps[0].start;
  const idx = exampleVideoCaptionIndexAt(t);
  const c = caps[idx];
  if (!c || !c.thai) { showToast('⚠️ Câu này chưa có chữ Thái để lưu'); return; }
  const id = makeSentenceCardId(exampleVideoState.id, c.start);
  if (sentenceCards.some(x => x.id === id && !x.ignored)) {
    await removeSentenceCardById(id);
    showToast('Đã bỏ câu khỏi ôn tập');
  } else {
    await saveSentenceCard(c, exampleVideoState.id);
    showToast('🔖 Đã lưu câu vào ôn tập — xem ở tab Từ cần ôn');
  }
  exampleVideoSaveIdx = -2;
  syncExampleVideoSaveBtn(t);
}

// Nút phụ đề chuyển vòng: TH → VI → ALL → OFF → TH
function toggleExampleVideoCaptions() {
  const i = EX_VIDEO_CAP_MODES.indexOf(exampleVideoCapMode());
  exampleVideoCapModePref = EX_VIDEO_CAP_MODES[(i + 1) % EX_VIDEO_CAP_MODES.length];
  exampleVideoCapIdx = -1;
  syncExampleVideoControls();
  const p = ytPlayers['modal-main'];
  if (p && typeof p.getCurrentTime === 'function') { try { updateExampleVideoCaption(p.getCurrentTime()); } catch (err) {} }
}

// ── ĐIỀU KHIỂN KIỂU CAKE (thẻ dưới video) ──────────────────────────────────
function syncExampleVideoPlayIcon(playing) {
  const btn = document.getElementById('exampleVideoPlayBtn');
  if (btn) btn.classList.toggle('is-playing', !!playing);
}
// Nút phát/tạm dừng riêng của app (nằm ở thẻ bên dưới video; thanh điều khiển gốc của YouTube vẫn dùng bình thường)
function toggleExampleVideoPlay() {
  const p = ytPlayers['modal-main'];
  if (!p || typeof p.getPlayerState !== 'function') return;
  if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo();
}

// ── GHI NGUỒN + LIÊN KẾT VỀ VIDEO GỐC ───────────────────────────────────────
// Luôn hiện "Xem video gốc trên YouTube" (liên kết tới đúng giây bắt đầu của đoạn ví dụ); khi trình phát tải xong thì bổ sung tên kênh/tiêu đề
// lấy từ getVideoData() của trình phát (nếu có). Dùng textContent để chữ lấy từ YouTube không thể chèn HTML.
function setExampleVideoSource(youtubeId, start, authorTitle) {
  const box = document.getElementById('exampleVideoSource');
  const link = document.getElementById('exampleVideoSourceLink');
  const meta = document.getElementById('exampleVideoSourceMeta');
  if (!box || !link) return;
  const startSec = start != null && isFinite(start) && start > 0 ? '&t=' + Math.floor(start) + 's' : '';
  link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(youtubeId) + startSec;
  if (meta) meta.textContent = authorTitle || '';
  box.style.display = youtubeId ? '' : 'none';
}
function refreshExampleVideoSourceFromPlayer(p) {
  try {
    const d = typeof p.getVideoData === 'function' ? p.getVideoData() : null;
    if (!d) return;
    const meta = document.getElementById('exampleVideoSourceMeta');
    const parts = [d.author, d.title].filter(x => x && String(x).trim());
    if (meta && parts.length) meta.textContent = parts.join(' — ');
  } catch (err) {}
}

// Nút tốc độ dạng 1 viên: bấm lần lượt 1x → 0,75x → 0,5x → 1x
function cycleExampleVideoRate() {
  const i = EX_VIDEO_RATES.indexOf(exampleVideoRate);
  setExampleVideoRate(EX_VIDEO_RATES[(i + 1) % EX_VIDEO_RATES.length]);
}
// Câu trước / câu sau theo phụ đề tự viết. "Câu trước": đang ở quá 1 giây trong câu hiện tại thì về đầu câu đó, ngược lại về câu liền trước.
function jumpExampleVideoCaption(dir) {
  const p = ytPlayers['modal-main'];
  const caps = exampleVideoState.captions;
  if (!p || typeof p.getCurrentTime !== 'function' || !caps || !caps.length) return;
  const t = p.getCurrentTime();
  let cur = -1;
  for (let i = 0; i < caps.length; i++) { if (caps[i].start <= t + 0.05) cur = i; else break; }
  let target;
  if (dir < 0) target = (cur >= 0 && t - caps[cur].start > 1.0) ? cur : cur - 1;
  else target = cur + 1;
  if (target < 0) target = 0;
  if (target > caps.length - 1) target = caps.length - 1;
  const ts = caps[target].start;
  p.seekTo(ts, true);
  if (exampleVideoSentenceLoop) { exampleVideoLoopIdx = target; exampleVideoLoopPlays = 0; exampleVideoLoopGuardUntil = Date.now() + 500; syncExampleVideoLoopBadge(); }
  exampleVideoCapIdx = -1;
  updateExampleVideoCaption(ts + 0.01);
  p.playVideo();
}

function setExampleVideoRate(rate) {
  if (EX_VIDEO_RATES.indexOf(rate) === -1) return;
  exampleVideoRate = rate;
  syncExampleVideoControls();
  const p = ytPlayers['modal-main'];
  if (p && typeof p.setPlaybackRate === 'function') applyExampleVideoRate(p);
}

// Chỉ số câu phụ đề tại thời điểm t: câu đang đọc, hoặc câu gần nhất đã bắt đầu; trước câu đầu tiên thì câu 0
function exampleVideoCaptionIndexAt(t) {
  const caps = exampleVideoState.captions;
  if (!caps || !caps.length) return -1;
  let cur = 0;
  for (let i = 0; i < caps.length; i++) { if (caps[i].start <= t + 0.05) cur = i; else break; }
  return cur;
}
// Nút lặp câu đổi vòng 3 chế độ: TẮT → lặp liên tục câu hiện tại → tự lặp 3 lần rồi sang câu sau → TẮT.
// Lặp liên tục: khóa vào câu đang đọc lúc bật; nút ‹ › / bấm câu trong danh sách / kéo thanh tiến độ sẽ khóa sang câu mới.
// Tự lặp 3 lần: mỗi câu phát đủ 3 lần rồi tự chuyển sang câu kế (hết câu cuối thì về đầu câu cuối và dừng).
// Tắt: quay về hành vi thường — lặp lại cả đoạn ví dụ.
function toggleExampleVideoLoop() {
  const p = ytPlayers['modal-main'];
  const caps = exampleVideoState.captions;
  if (!caps || !caps.length) return;
  if (!exampleVideoSentenceLoop) {
    exampleVideoSentenceLoop = true;
    exampleVideoLoopAuto = false;
    exampleVideoLoopPlays = 0;
    const t = p && typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : caps[0].start;
    exampleVideoLoopIdx = exampleVideoCaptionIndexAt(t);
    // Đang đứng ngoài khoảng câu (khoảng lặng giữa 2 câu): đưa về đầu câu để lặp có hiệu lực ngay
    const c = caps[exampleVideoLoopIdx];
    if (p && typeof p.seekTo === 'function' && (t < c.start - 0.05 || t >= c.end)) { exampleVideoLoopGuardUntil = Date.now() + 500; p.seekTo(c.start, true); }
    if (p && typeof p.playVideo === 'function') p.playVideo();
  } else if (!exampleVideoLoopAuto) {
    // Chuyển sang tự lặp N lần: phát lại câu từ đầu để đủ N lần nghe trọn câu
    exampleVideoLoopAuto = true;
    exampleVideoLoopPlays = 0;
    const c = caps[exampleVideoLoopIdx];
    if (c && p && typeof p.seekTo === 'function') { exampleVideoLoopGuardUntil = Date.now() + 500; p.seekTo(c.start, true); }
    if (p && typeof p.playVideo === 'function') p.playVideo();
  } else {
    exampleVideoSentenceLoop = false;
    exampleVideoLoopAuto = false;
    exampleVideoLoopPlays = 0;
    exampleVideoLoopIdx = -1;
  }
  syncExampleVideoControls();
}
// Huy hiệu "lần 2/3" trên nút lặp (chỉ hiện ở chế độ tự lặp)
function syncExampleVideoLoopBadge() {
  const badge = document.getElementById('exampleVideoLoopBadge');
  if (!badge) return;
  const on = exampleVideoSentenceLoop && exampleVideoLoopAuto;
  badge.textContent = on ? (exampleVideoLoopPlays + 1) + '/' + EX_VIDEO_AUTO_REPEATS : '';
  badge.style.display = on ? '' : 'none';
}
// Khi người học tua/chọn câu khác lúc đang lặp câu → khóa lặp sang câu tại vị trí mới
function relockExampleVideoSentenceLoop(t) {
  if (!exampleVideoSentenceLoop) return;
  exampleVideoLoopIdx = exampleVideoCaptionIndexAt(t);
  exampleVideoLoopPlays = 0; // sang câu mới thì đếm lại từ lần 1
  syncExampleVideoLoopBadge();
}

// Bật/tắt phụ đề: cc_load_policy chỉ áp dụng lúc khởi tạo nên dựng lại trình phát và tua về đúng vị trí đang xem (cách chính thức, không dùng API ẩn)
function toggleExampleVideoCc() {
  exampleVideoCc = !exampleVideoCc;
  syncExampleVideoControls();
  const p = ytPlayers['modal-main'];
  let t = exampleVideoState.start;
  if (p && typeof p.getCurrentTime === 'function') { try { t = p.getCurrentTime(); } catch (err) {} }
  createExampleVideoPlayer(t);
}

function closeExampleVideo() {
  document.getElementById('exampleVideoModal').classList.remove('show');
  if (exampleVideoLoopTimer) { clearInterval(exampleVideoLoopTimer); exampleVideoLoopTimer = null; }
  exampleVideoState = { id: null, start: null, end: null, captions: null }; // làm "cũ" mọi lần dựng trình phát đang chờ API
  destroyExYtPlayer('modal', 'main');
  const wrap = document.getElementById('exampleVideoPlayerWrap');
  if (wrap) wrap.innerHTML = '';
  const capPanel = document.getElementById('exampleVideoCaption');
  if (capPanel) capPanel.innerHTML = '';
  closeExampleVideoSpeaking(); // dừng nhận dạng + giải phóng micro/bản ghi
  setExampleVideoSource('', null, '');
  exampleVideoSaveIdx = -2;
  closeExampleVideoLookup();
  exampleVideoListKey = '';
  const capList = document.getElementById('exampleVideoCaptionList');
  if (capList) { capList.innerHTML = ''; capList.style.display = 'none'; }
}
// Esc đóng popup video
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('exampleVideoModal');
  if (modal && modal.classList.contains('show')) closeExampleVideo();
});

// ── Tiêu đề / Tagline trang chủ (chỉnh sửa được trong admin) ───────────────
// Chế độ 'auto': tự động hiện câu chào theo buổi trong ngày (giống Claude), nội dung admin tự sửa được;
// Chế độ 'custom': admin tự nhập nội dung cố định, không đổi theo giờ.
// Dòng phụ nhỏ theo khung giờ (câu chào thực sự) — ADMIN TỰ NHẬP 1 chuỗi/khung giờ, hỗ trợ
// xuống dòng (Enter trong textarea) để viết song song tiếng Thái / tiếng Việt. Đã bỏ hẳn
// đậm/nghiêng/gạch chân/màu/cỡ chữ riêng từng khung giờ (rườm rà, không cần thiết) — chỉ còn
// văn bản thuần, hiển thị với white-space:pre-line để giữ nguyên xuống dòng đã nhập.
const DEFAULT_GREETING_TEXTS = {
  morning:   'Chào buổi sáng',
  noon:      'Chào buổi trưa',
  afternoon: 'Chào buổi chiều',
  evening:   'Chào buổi tối',
  night:     'Khuya rồi, chúc bạn ngủ ngon'
};
const GREETING_KEYS = ['morning', 'noon', 'afternoon', 'evening', 'night'];
function greetingCap(key) { return key.charAt(0).toUpperCase() + key.slice(1); }
let siteSettingsState = { greeting_texts: { ...DEFAULT_GREETING_TEXTS }, hero_greetings_first: [], hero_greetings_returning: [], font_difficulty_map: {} };

function getGreetingSlotKey() {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'noon';
  if (hour >= 13 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

function stripHtmlToText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || tmp.innerText || '').trim();
}

// Chuẩn hoá 1 khung giờ đọc từ Supabase thành CHUỖI TEXT THUẦN — hỗ trợ cả dữ liệu cũ (chuỗi
// HTML từ RTE contenteditable đời đầu, hoặc object {text,bold,italic,color,size...} từ đợt có
// định dạng riêng từng khung giờ trước khi bỏ) lẫn dữ liệu mới (chuỗi thường, có thể nhiều dòng).
function normalizeGreetingSlot(raw, defText) {
  if (raw == null) return defText;
  if (typeof raw === 'string') return raw.indexOf('<') !== -1 ? (stripHtmlToText(raw) || defText) : raw;
  if (typeof raw === 'object' && typeof raw.text === 'string') return raw.text || defText;
  return defText;
}

function readGreetingInputs() {
  const result = {};
  GREETING_KEYS.forEach(function(key) {
    const cap = greetingCap(key);
    const textEl = document.getElementById('greetingText' + cap);
    result[key] = (textEl && textEl.value.trim()) || DEFAULT_GREETING_TEXTS[key];
  });
  return result;
}

function populateGreetingInputsFrom(data) {
  GREETING_KEYS.forEach(function(key) {
    const cap = greetingCap(key);
    const el = document.getElementById('greetingText' + cap);
    if (el) el.value = (data && data[key]) || DEFAULT_GREETING_TEXTS[key];
  });
}

function populateGreetingInputs() {
  populateGreetingInputsFrom(siteSettingsState.greeting_texts || {});
}

// Ghép câu chào: text + tên người dùng — white-space:pre-line trên #heroTagline (xem style.css)
// giữ nguyên các dòng xuống hàng admin đã nhập (vd dòng Thái + dòng Việt song song).
// Tagline này CŨNG là lối vào menu Tài khoản (thay cho nút góc phải top bar — nay chỉ còn hiện ở
// trang Admin, nơi CHƯA có tagline riêng và vốn đã có nút "Đăng xuất" khác cho phiên admin, tách biệt
// khỏi tài khoản người dùng thường; xem body:has(...) #accountBtnWrap trong style.css). CẬP NHẬT MỌI
// phần tử có class "hero-tagline-clickable" cùng lúc (hiện có #heroTagline ở trang chủ,
// #heroTaglineFav ở đầu trang Sổ tay) — không lặp lại logic riêng cho từng trang, thêm trang mới chỉ
// cần thêm 1 phần tử cùng class.
//
// Tách 2 <span> RIÊNG theo font (giống cách đã làm cho nút Tài khoản cũ — xem updateAuthUI()):
// - .hero-tagline-thai (font TorsilpThamnganMangThoe): text + ", คุณ" — CHƯA đăng nhập nối thêm luôn
//   "ชื่ออะไร" (không dấu cách, ghép thành cụm "คุณชื่ออะไร" hoàn chỉnh) vẫn trong span này vì đều là
//   chữ Thái, không cần tách.
// - .hero-tagline-name (font Charm, chỉ xuất hiện khi ĐÃ đăng nhập): tên người dùng — Charm có bộ chữ
//   Vietnamese riêng (khác TorsilpThamnganMangThoe chỉ có Latin cơ bản) nên không bị lỗi lẫn font khi
//   tên có dấu tiếng Việt.
// Dựng bằng createTextNode/textContent (không innerHTML) vì tên là dữ liệu người dùng nhập.
function applyHeroTagline() {
  applyHeroGreetingMain();
  const key = getGreetingSlotKey();
  const text = (siteSettingsState.greeting_texts && siteSettingsState.greeting_texts[key]) || DEFAULT_GREETING_TEXTS[key];
  const name = (isLoggedIn() && session.user.display_name) ? session.user.display_name : '';
  document.querySelectorAll('.hero-tagline-clickable').forEach(el => {
    el.textContent = '';
    const thaiSpan = document.createElement('span');
    thaiSpan.className = 'hero-tagline-thai';
    thaiSpan.textContent = text + ', คุณ' + (name ? '' : 'ชื่ออะไร');
    el.appendChild(thaiSpan);
    if (name) {
      el.appendChild(document.createTextNode(' '));
      const nameSpan = document.createElement('span');
      nameSpan.className = 'hero-tagline-name';
      nameSpan.textContent = name;
      el.appendChild(nameSpan);
    }
    const arrow = document.createElement('span');
    arrow.className = 'hero-tagline-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    el.appendChild(arrow);
  });
}

// ── Câu mở đầu (gợi ý học tập, chữ to phía trên) — KHÔNG PHẢI câu chào, mà là câu trigger
// gợi mở: lần đầu ghé/mới quay lại gần đây thì hỏi "hôm nay học gì đây?", quay lại sau lâu thì
// nhắc "tiếp tục học". ADMIN TỰ NHẬP 2 danh sách câu (mỗi dòng textarea = 1 câu): 1 danh sách
// cho lượt ghé lần đầu/mới quay lại gần đây, 1 danh sách riêng cho lượt quay lại sau > 30 phút
// (giống Claude hay đổi câu chào "Back at it", "Welcome back"... mỗi lần mở lại thay vì luôn 1
// câu cố định nhàm chán). Textarea thường, không có định dạng đậm/nghiêng/màu riêng.
const DEFAULT_HERO_GREETINGS_FIRST = ['Hôm nay học gì đây?', 'Cùng khám phá từ mới nhé', 'Bắt đầu học tiếng Thái thôi'];
const DEFAULT_HERO_GREETINGS_RETURNING = ['Tiếp tục học nhé', 'Quay lại học tiếp nào', 'Học thêm chút nữa thôi'];
const HERO_GREETING_RETURN_THRESHOLD_MS = 30 * 60 * 1000; // > 30 phút kể từ lần ghé trước mới tính là "quay lại" — tránh hiện sai ngay khi họ chỉ vừa tải lại trang/chuyển tab trong cùng 1 phiên
let heroGreetingMainCache = null; // chỉ chọn ngẫu nhiên 1 LẦN mỗi lượt tải trang — applyHeroTagline() còn được setInterval gọi lại mỗi 5 phút để cập nhật khung giờ, không muốn câu chào chính tự đổi lung tung giữa chừng trong lúc người dùng đang xem trang

function pickRandomGreeting(arr, fallback) {
  const list = (arr && arr.length) ? arr : (fallback || DEFAULT_HERO_GREETINGS_FIRST);
  return list[Math.floor(Math.random() * list.length)];
}

function getHeroGreetingMainText() {
  if (heroGreetingMainCache) return heroGreetingMainCache;
  const STORAGE_KEY = 'alay_last_visit_at';
  const now = Date.now();
  const lastVisit = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  localStorage.setItem(STORAGE_KEY, String(now));
  const isReturning = lastVisit > 0 && (now - lastVisit) > HERO_GREETING_RETURN_THRESHOLD_MS;
  const pool = isReturning ? siteSettingsState.hero_greetings_returning : siteSettingsState.hero_greetings_first;
  const fallbackPool = isReturning ? DEFAULT_HERO_GREETINGS_RETURNING : DEFAULT_HERO_GREETINGS_FIRST;
  heroGreetingMainCache = pickRandomGreeting(pool, fallbackPool);
  return heroGreetingMainCache;
}

// Câu mở đầu KHÔNG kèm tên người dùng (chỉ câu chào #heroTagline mới thêm tên — xem applyHeroTagline)
function applyHeroGreetingMain() {
  const mainEl = document.getElementById('heroGreetingMain');
  if (!mainEl) return;
  mainEl.textContent = getHeroGreetingMainText() + '!';
}

// Textarea → mảng câu (mỗi dòng 1 câu, bỏ dòng trống)
function textareaToLines(el) {
  if (!el) return [];
  return el.value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
}
function linesToTextarea(el, lines) {
  if (!el) return;
  el.value = (lines && lines.length ? lines : []).join('\n');
}

function populateHeroGreetingInputs() {
  linesToTextarea(document.getElementById('heroGreetFirstInput'), siteSettingsState.hero_greetings_first);
  linesToTextarea(document.getElementById('heroGreetReturningInput'), siteSettingsState.hero_greetings_returning);
}

async function loadSiteSettings() {
  try {
    const data = await sbGet('site_settings?select=*&id=eq.1');
    if (data && data[0]) {
      const raw = data[0].greeting_texts || {};
      const merged = {};
      GREETING_KEYS.forEach(function(key) {
        merged[key] = normalizeGreetingSlot(raw[key], DEFAULT_GREETING_TEXTS[key]);
      });
      siteSettingsState.greeting_texts = merged;
      siteSettingsState.hero_greetings_first = Array.isArray(data[0].hero_greetings_first) ? data[0].hero_greetings_first : [];
      siteSettingsState.hero_greetings_returning = Array.isArray(data[0].hero_greetings_returning) ? data[0].hero_greetings_returning : [];
      siteSettingsState.font_difficulty_map = (data[0].font_difficulty_map && typeof data[0].font_difficulty_map === 'object') ? data[0].font_difficulty_map : {};
    }
  } catch(e) { /* bảng site_settings chưa có hoặc lỗi mạng - giữ mặc định (chào tự động) */ }
  applyHeroTagline();
  // Cập nhật lại câu chào mỗi 5 phút để không bị "lệch buổi" nếu người dùng mở trang lâu
  setInterval(applyHeroTagline, 5 * 60 * 1000);
}

async function saveSiteSettings() {
  const greetingTexts = readGreetingInputs();
  const heroGreetFirst = textareaToLines(document.getElementById('heroGreetFirstInput'));
  const heroGreetReturning = textareaToLines(document.getElementById('heroGreetReturningInput'));
  const btn = document.getElementById('btnSaveTagline');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/site_settings?on_conflict=id', {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        id: 1,
        greeting_texts: greetingTexts,
        hero_greetings_first: heroGreetFirst,
        hero_greetings_returning: heroGreetReturning
      })
    });
    if (resp.ok) {
      siteSettingsState.greeting_texts = greetingTexts;
      siteSettingsState.hero_greetings_first = heroGreetFirst;
      siteSettingsState.hero_greetings_returning = heroGreetReturning;
      heroGreetingMainCache = null; // đổi danh sách rồi thì chọn lại ngẫu nhiên ngay, không giữ câu cũ từ trước khi lưu
      applyHeroTagline();
      showToast('✅ Đã lưu tiêu đề trang chủ');
    } else { showToast('⚠️ Lỗi khi lưu — cần thêm cột hero_greetings_first/hero_greetings_returning (kiểu jsonb hoặc text[]) vào bảng site_settings trong Supabase'); }
  } catch(e) { showToast('⚠️ Lỗi kết nối'); }
  btn.disabled = false; btn.textContent = 'Lưu tiêu đề';
}

// ── PHÂN LOẠI ĐỘ KHÓ TỪNG FONT (Font Challenge) ─────────────────────
// Chỉ quản lý DỮ LIỆU ở trang Admin — KHÔNG hiển thị công khai ở đâu cả (người dùng vẫn thấy câu
// Font Challenge như bình thường), giữ sẵn cho tính năng tuỳ chỉnh mức độ theo từng người dùng
// sẽ làm sau. Danh sách 26 font cố định (FC_FONT_LABEL) — vẽ 1 hàng/font kèm select chọn mức độ
// khó, đổ sẵn lựa chọn hiện có (nếu font đó đã được phân loại từ trước) mỗi khi vào trang Admin.
function populateFontDifficultyAdminInputs() {
  const listEl = document.getElementById('fcDifficultyAdminList');
  if (!listEl) return;
  const map = siteSettingsState.font_difficulty_map || {};
  const levelOptions = Object.keys(FC_DIFFICULTY_LABELS)
    .map(k => '<option value="' + k + '">' + FC_DIFFICULTY_LABELS[k] + '</option>').join('');
  listEl.innerHTML = Object.keys(FC_FONT_LABEL).map(fid => {
    return '<div class="wla-row">'
      + '<span class="thai-font" style="flex:1;min-width:0">' + escapeHtml(FC_FONT_LABEL[fid]) + '</span>'
      + '<select class="form-select fc-diff-admin-select" data-font-id="' + fid + '">'
      + '<option value="">— Chưa chọn —</option>'
      + levelOptions
      + '</select>'
      + '</div>';
  }).join('');
  // Gán value SAU khi đã chèn xong innerHTML (đặt "selected" trực tiếp trong chuỗi HTML dễ lỗi
  // nếu current chứa ký tự đặc biệt) — set thẳng qua thuộc tính value của từng select.
  listEl.querySelectorAll('.fc-diff-admin-select').forEach(sel => {
    sel.value = map[sel.dataset.fontId] || '';
  });
}

async function saveFontDifficultyMap() {
  const map = {};
  document.querySelectorAll('#fcDifficultyAdminList .fc-diff-admin-select').forEach(sel => {
    if (sel.value) map[sel.dataset.fontId] = sel.value;
  });
  const btn = document.getElementById('btnSaveFontDifficulty');
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const resp = await fetch(SUPABASE_URL + '/rest/v1/site_settings?on_conflict=id', {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: 1, font_difficulty_map: map })
    });
    if (resp.ok) {
      siteSettingsState.font_difficulty_map = map;
      showToast('✅ Đã lưu phân loại độ khó font');
    } else { showToast('⚠️ Lỗi khi lưu — cần thêm cột font_difficulty_map (kiểu jsonb) vào bảng site_settings trong Supabase'); }
  } catch (e) { showToast('⚠️ Lỗi kết nối'); }
  btn.disabled = false; btn.textContent = 'Lưu phân loại độ khó';
}


// ── ADMIN AUTH ────────────────────────────────────────
// Admin giờ là 1 tài khoản đăng nhập bình thường (email/mật khẩu, dùng chung hệ thống
// Đăng nhập/Đăng ký) có cờ is_admin = true trong bảng profiles (Supabase). Không còn mật khẩu
// cứng trong code — quyền admin được RLS phía Supabase kiểm tra thật sự, không chỉ ẩn UI.
const SECRET_KEYS = []; // buffer phím bí mật
const SECRET_COMBO = 'admin'; // gõ chữ "admin" ở bất kỳ đâu để mở đăng nhập/vào trang admin
let pendingAdminEntry = false; // true khi gõ "admin" lúc chưa đăng nhập, để tự kiểm tra quyền sau khi login xong

// Hỏi Supabase xem tài khoản đang đăng nhập có phải admin không (is_admin trong bảng profiles).
// Cập nhật session.user.is_admin (cache) + hiện/ẩn nút Admin trên thanh nav.
async function checkIsAdmin() {
  if (!isLoggedIn()) {
    const btn = document.getElementById('adminNavBtn');
    if (btn) btn.style.display = 'none';
    return false;
  }
  let isAdmin = false;
  try {
    const rows = await sbGetAuth('profiles?select=is_admin&id=eq.' + session.user.id);
    isAdmin = Array.isArray(rows) && rows[0] ? !!rows[0].is_admin : false;
  } catch (e) {
    // In lỗi thật ra console để debug (fetch lỗi mạng/CORS khác với "tài khoản không có quyền")
    console.error('checkIsAdmin() lỗi khi gọi Supabase:', e);
    isAdmin = false;
  }
  session.user.is_admin = isAdmin;
  persistCurrentSession();
  const btn = document.getElementById('adminNavBtn');
  if (btn) btn.style.display = isAdmin ? '' : 'none';
  return isAdmin;
}

// Gọi khi trang vừa tải xong: hiện nút Admin nếu tài khoản đang đăng nhập có quyền,
// và xử lý phương án dự phòng vào admin qua URL ?admin=1 hoặc #admin
async function initAdminState() {
  const wantsAdmin = location.search.indexOf('admin=1') !== -1 || location.hash === '#admin';
  if (isLoggedIn()) {
    const isAdmin = await checkIsAdmin();
    if (wantsAdmin) {
      if (isAdmin) showPage('admin');
      else showToast('⚠️ Tài khoản này không có quyền quản trị');
    }
  } else if (wantsAdmin) {
    pendingAdminEntry = true;
    openAuthModal('login');
  }
}

// Gõ chữ "admin" ở bất kỳ đâu → vào trang quản trị nếu đã có quyền, hoặc mở đăng nhập trước
async function enterAdminFlow() {
  if (isLoggedIn()) {
    const isAdmin = session.user.is_admin === true ? true : await checkIsAdmin();
    if (isAdmin) showPage('admin');
    else showToast('⚠️ Tài khoản này không có quyền quản trị');
  } else {
    pendingAdminEntry = true;
    openAuthModal('login');
  }
}

// Lắng nghe gõ phím bí mật (kể cả khi đang focus vào search input)
document.addEventListener('keydown', function(e) {
  const tag = document.activeElement.tagName;
  const ce = document.activeElement.contentEditable;
  const id = document.activeElement.id;
  // Chỉ bỏ qua nếu đang gõ vào textarea, contenteditable, hoặc input KHÔNG phải search
  if (ce === 'true') return;
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && id !== 'searchInput' && id !== 'headerSearchInput') return;
  // Autofill của trình duyệt (vd tự điền email/mật khẩu) đôi khi bắn ra sự kiện keydown "giả"
  // không có e.key (undefined) — bỏ qua các trường hợp này thay vì để crash toàn bộ script.
  if (!e.key) return;
  SECRET_KEYS.push(e.key.toLowerCase());
  if (SECRET_KEYS.length > SECRET_COMBO.length) SECRET_KEYS.shift();
  if (SECRET_KEYS.join('') === SECRET_COMBO) {
    SECRET_KEYS.length = 0;
    enterAdminFlow();
  }
});

// Đăng xuất khỏi trang Admin = đăng xuất toàn bộ tài khoản (admin giờ là 1 tài khoản thật,
// không còn khái niệm "phiên admin" tách riêng khỏi phiên đăng nhập user)
function logoutAdmin() {
  doSignOut();
}


// ── SEARCH MODE ───────────────────────────────────────
let searchMode = 'word'; // 'word' | 'popthai' — mục "Tách từ" giờ gộp luôn cả dịch câu
                          // (icon dịch câu nổi ở góc khung kết quả tách từ, xem ptPanelTranslateBtn)

// preserveText: mặc định false (giữ hành vi cũ — đổi mode thì xoá trắng ô input để tránh nhầm
// lẫn). Truyền true khi cần chuyển mode NHƯNG giữ nguyên nội dung đang gõ.
function switchSearchMode(mode, preserveText) {
  const prevMode = searchMode;
  searchMode = mode;
  document.getElementById('modeTabWord').classList.toggle('active', mode === 'word');
  document.getElementById('modeTabPop').classList.toggle('active', mode === 'popthai');
  const headerTabWord = document.getElementById('headerModeTabWord');
  const headerTabPop = document.getElementById('headerModeTabPop');
  if (headerTabWord) headerTabWord.classList.toggle('active', mode === 'word');
  if (headerTabPop) headerTabPop.classList.toggle('active', mode === 'popthai');
  document.getElementById('popthaiWrap').classList.toggle('show', mode === 'popthai');
  const searchInnerBox = document.querySelector('.search-wrap .search-inner');
  if (searchInnerBox) searchInnerBox.classList.toggle('mode-popthai', mode === 'popthai');
  updateModeTabsThumb();

  const searchInputEl = document.getElementById('searchInput');
  const headerInputEl = document.getElementById('headerSearchInput');
  // Placeholder giờ do startSearchPlaceholderRotation() (luân phiên câu, dùng chung cho cả 2 mode)
  // đảm nhiệm liên tục ở nền — không set text cố định theo mode ở đây nữa.

  if (prevMode === mode) { updateTranslateButtonState(searchInputEl ? searchInputEl.value : ''); return; }

  const keptText = (preserveText && searchInputEl) ? searchInputEl.value : '';

  if (!preserveText) {
    // Dùng chung 1 ô input cho cả 2 mode: xóa nội dung khi đổi mode để tránh nhầm lẫn
    if (searchInputEl) searchInputEl.value = '';
    if (headerInputEl) headerInputEl.value = '';
    document.getElementById('popthaiInput').value = '';
    const clearBtn = document.getElementById('searchClearBtn');
    if (clearBtn) clearBtn.classList.remove('visible');
    const headerClearBtn = document.getElementById('headerSearchClearBtn');
    if (headerClearBtn) headerClearBtn.classList.remove('visible');
  }
  autoGrowSearchInput();
  document.getElementById('autocomplete').classList.remove('show');
  document.getElementById('headerAc').classList.remove('show');
  document.getElementById('resultSection').classList.remove('show');
  document.getElementById('emptyState').classList.remove('show');
  document.getElementById('popthaiMultifontWrap').classList.remove('show');
  document.getElementById('ptTranslateResult').classList.remove('show');
  // Dropdown lịch sử/kệ gợi ý nhanh chỉ áp dụng cho mục Tra từ — đổi mode thì đóng luôn, tránh
  // bị "dính" mở sẵn (kèm chip "Lịch sử" đang sáng) khi đã chuyển sang Tách từ & Dịch câu.
  document.getElementById('searchHistoryDropdown').classList.remove('show');
  document.getElementById('headerSearchHistoryDropdown').classList.remove('show');
  clearQuickShelfActive();

  // Mục trang chủ (Font Challenge/từ hot...) hiện y hệt nhau ở CẢ 2 mode khi ô đang trống —
  // không còn để trống riêng cho mục Tách từ & Dịch câu nữa. Nếu preserveText có sẵn chữ, lệnh
  // onPopthaiInput()/onSearch() gọi ngay bên dưới sẽ tự ẩn nó đi (đúng như hành vi lúc gõ chữ).
  document.getElementById('homeDefault').style.display = keptText ? 'none' : 'block';
  document.getElementById('ptDefPanel').classList.remove('show');

  if (preserveText && keptText) {
    setSearchInputValue(keptText);
    syncHeaderSearchValue(keptText);
    if (mode === 'popthai') onPopthaiInput(keptText); else onSearch(keptText);
  }

  updateTranslateButtonState(keptText);
  updateSearchCharCounter(keptText);
  if (searchInputEl) searchInputEl.focus();
}

// Thanh trượt xanh của segmented control "Tra từ / Tách từ & Dịch câu" — đo vị trí + độ rộng
// THẬT của nút đang active bằng offsetLeft/offsetWidth (2 nhãn dài ngắn khác nhau nên không thể
// chia đều 50/50 bằng CSS thuần) rồi di chuyển thanh trượt bằng transform, mượt nhờ transition
// đã khai báo sẵn trong CSS (.mode-tabs-thumb).
function updateModeTabsThumb() {
  const thumb = document.getElementById('modeTabsThumb');
  const activeBtn = document.querySelector('#searchModeTabs .mode-tab-btn.active');
  if (!thumb || !activeBtn) return;
  thumb.style.width = activeBtn.offsetWidth + 'px';
  thumb.style.transform = 'translateX(' + activeBtn.offsetLeft + 'px)';
}

// Chuyển mode từ thanh search trên header: đưa về trang chủ trước rồi mới chuyển mode
function switchSearchModeFromHeader(mode) {
  showPage('home');
  switchSearchMode(mode);
  scrollActivePageToTop();
}

// Placeholder luân phiên — dùng CHUNG cho cả 2 mode (Tra từ / Tách từ & Dịch câu), đổi câu gợi ý
// mỗi 6s để đỡ nhàm, giống kiểu ô chat của Claude. Ô search chính dùng 1 <span> đè lên
// (search-placeholder-rotate) để có hiệu ứng crossfade mượt (0.7s) — placeholder gốc của trình
// duyệt không tự đổi chữ có transition được. Ô search header (nhỏ, ít nổi bật hơn) vẫn dùng
// thẳng thuộc tính placeholder gốc, đổi tức thì, không cần crossfade riêng.
const SEARCH_PLACEHOLDER_PHRASES = [
  'Hôm nay bạn muốn tra từ gì?',
  'Bạn đang không hiểu câu nào?',
  'Có câu nào khó đọc phải không?'
];
let searchPlaceholderIdx = 0;
let searchPlaceholderTimer = null;

function tickSearchPlaceholder() {
  searchPlaceholderIdx = (searchPlaceholderIdx + 1) % SEARCH_PLACEHOLDER_PHRASES.length;
  const text = SEARCH_PLACEHOLDER_PHRASES[searchPlaceholderIdx];

  const overlay = document.getElementById('searchPlaceholderRotate');
  if (overlay) {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.textContent = text;
      overlay.classList.remove('fade-out');
    }, 700); // khớp thời lượng transition trong CSS (.search-placeholder-rotate)
  }

  const headerInputEl = document.getElementById('headerSearchInput');
  if (headerInputEl && document.activeElement !== headerInputEl && !headerInputEl.value) {
    headerInputEl.placeholder = text;
  }
}

function startSearchPlaceholderRotation() {
  const overlay = document.getElementById('searchPlaceholderRotate');
  if (overlay) overlay.textContent = SEARCH_PLACEHOLDER_PHRASES[searchPlaceholderIdx];
  updateSearchPlaceholderVisibility();
  clearInterval(searchPlaceholderTimer);
  searchPlaceholderTimer = setInterval(tickSearchPlaceholder, 6000);
}

// Ẩn overlay chỉ khi ô đang có chữ (áp dụng như nhau ở cả 2 mode).
function updateSearchPlaceholderVisibility() {
  const el = document.getElementById('searchPlaceholderRotate');
  const input = document.getElementById('searchInput');
  if (!el || !input) return;
  el.classList.toggle('hide', !!input.value);
}

// ── POPTHAI ───────────────────────────────────────────
// (Đã xoá getThaiSyllables() cùng 4 hằng THAI_CONSONANTS/THAI_VOWELS_ABOVE/THAI_VOWELS_BELOW/
// THAI_FINAL — thuật toán tách âm tiết thử nghiệm cũ trước khi chuyển sang PopThai bên dưới,
// không còn nơi nào gọi tới. Xem lịch sử git nếu cần khôi phục.)

// Tô ranh giới giữa các từ tiếng Thái trong 1 phần tử DOM (định nghĩa/ví dụ) bằng NỀN MÀU XEN
// KẼ — KHÔNG chèn dấu cách thật vào văn bản (tránh câu bị dài ra, xuống dòng lộn xộn). Chỉ sửa
// nội dung text node, không đụng tới thẻ <strong>/<em>/<p> bên trong. Đây là chế độ hiển thị
// "Tách từ" (nút icon sách mở cạnh Dark/Light mode) — CHỈ dùng cho định nghĩa/ví dụ, xem
// segmentizeDefsIfEnabled() ở trên; Font Challenge không dùng hàm này nữa.
function segmentizeTextNodes(root) {
  if (!root) return;
  // Bỏ qua các nhãn trộn tiếng Thái + tiếng Việt trong cùng 1 chuỗi (vd "คำพ้องความ · Từ đồng nghĩa",
  // hoặc "คำกริยา · Động từ" ở phần từ loại) — chạy tách từ tiếng Thái lên các chuỗi này sẽ làm
  // hỏng/tách vụn phần tiếng Việt đi kèm, vì thuật toán không nhận diện được đó không phải tiếng Thái.
  // .def-related-grid (nội dung đồng nghĩa/trái nghĩa/thành ngữ/liên quan admin nhập tay) cũng bị
  // loại — mỗi mục ở đây đã tự có link/plain span dựng sẵn (xem renderRelWordList), nhiều mục
  // cách nhau bằng dấu "·" qua CSS; tách từ đè lên sẽ phá mất cấu trúc đó.
  const skipSelector = DEF_WORD_LINK_SKIP_SELECTOR;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.parentElement && node.parentElement.closest(skipSelector))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const original = node.nodeValue;
    if (!original || !/[\u0E00-\u0E7F]/.test(original)) return; // bỏ qua text không có tiếng Thái (vd tiếng Việt)
    const segments = segmentThai(original);
    if (!segments.length) return;

    const frag = document.createDocumentFragment();
    segments.forEach((s, idx) => {
      const isThaiWord = /[\u0E00-\u0E7F]/.test(s.thai) && !s.isSpace;
      if (!isThaiWord) { frag.appendChild(document.createTextNode(s.thai)); return; }

      const word = allWords.find(w => w.thai === s.thai);
      const span = document.createElement('span');
      span.className = 'def-seg-word'; // khoảng cách giữa từ đến từ margin-right trong CSS, không
                                        // còn tô nền xen kẽ a/b như trước nên không cần đếm chẵn/lẻ.
      // Đoạn KẾ TIẾP nếu đã là dấu cách có sẵn trong văn bản gốc (vd trước số/chữ Latin/dấu câu
      // tách rời) thì bỏ qua margin-right CSS cho từ này — tránh bị cách 2 lần (margin + dấu cách
      // thật cộng dồn) ngay tại những chỗ vốn đã có khoảng trắng.
      const next = segments[idx + 1];
      if (next && next.isSpace) span.classList.add('def-seg-word-tight');
      span.textContent = s.thai;
      if (word) {
        span.classList.add('def-word-link');
        span.dataset.wordId = word.id;
        span.title = 'Nhấp để xem nghĩa · Nhấp đúp để mở tab mới';
        span.onclick = (e) => { e.stopPropagation(); onDefWordClick(word.id, e); };
        span.ondblclick = (e) => { e.stopPropagation(); onDefWordDblClick(word.id, e); };
      }
      frag.appendChild(span);
    });
    node.parentNode.replaceChild(frag, node);
  });
}

// Biến các từ tiếng Thái KHỚP TỪ ĐIỂN thành liên kết bấm-để-tra, giữ NGUYÊN văn bản gốc — không
// chèn dấu cách, không tô nền xen kẽ (khác segmentizeTextNodes() ở trên, vốn dành riêng cho
// "Chế độ dễ đọc" của định nghĩa/ví dụ). Dùng cho Font Challenge — khu vực
// này KHÔNG thuộc phạm vi "Chế độ dễ đọc" nhưng vẫn cần giữ được tính năng bấm từ để tra nhanh.
function linkifyWordsPlain(root, skipSelector) {
  if (!root) return;
  skipSelector = skipSelector || '.def-related-label, .def-related-grid'; // mặc định cho Font Challenge; định nghĩa/ví dụ truyền thêm vùng cần bỏ qua
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.parentElement && node.parentElement.closest(skipSelector))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const original = node.nodeValue;
    if (!original || !/[\u0E00-\u0E7F]/.test(original)) return;
    const segments = segmentThai(original);
    if (!segments.length) return;

    const frag = document.createDocumentFragment();
    segments.forEach((s) => {
      const isThaiWord = /[\u0E00-\u0E7F]/.test(s.thai) && !s.isSpace;
      const word = isThaiWord ? allWords.find(w => w.thai === s.thai) : null;
      if (!word) { frag.appendChild(document.createTextNode(s.thai)); return; }

      const span = document.createElement('span');
      span.className = 'def-word-link';
      span.textContent = s.thai;
      span.dataset.wordId = word.id;
      span.title = 'Nhấp để xem nghĩa · Nhấp đúp để mở tab mới';
      span.onclick = (e) => { e.stopPropagation(); onDefWordClick(word.id, e); };
      span.ondblclick = (e) => { e.stopPropagation(); onDefWordDblClick(word.id, e); };
      frag.appendChild(span);
    });
    node.parentNode.replaceChild(frag, node);
  });
}

// ── Popup tra nhanh khi click vào từ liên kết trong định nghĩa/ví dụ ──
let wordPopupWordId = null;
let wordPopupThaiText = ''; // chữ Thái "sạch" (1 bản duy nhất) để phát âm — không đọc trực tiếp
                             // từ #popupRThai vì khung đó chứa 4 bản hiển thị (4 font) trùng nhau,
                             // đọc textContent của nó sẽ bị lặp lại 4 lần.

async function onDefWordClick(id) {
  const word = await ensureWordFull(id);
  if (!word) return;
  wordPopupWordId = id;

  const t = word.thai;
  wordPopupThaiText = t;
  const popupRThaiEl = document.getElementById('popupRThai');
  popupRThaiEl.classList.remove('wt-horizontal');
  popupRThaiEl.innerHTML = buildWordFontsHTML(t);
  applyWordThaiLayout(popupRThaiEl);
  document.getElementById('popupRPhonetic').innerHTML = word.phonetic || '';
  document.getElementById('popupRStructure').innerHTML = word.structure || '';

  const defEl = document.getElementById('wordPopupDefs');
  defEl.innerHTML = buildDefinitionsHTML(word);
  segmentizeDefsIfEnabled(defEl);
  updateDefExpandAllBtn('popupDefExpandAllBtn', 'wordPopupDefs', word);

  document.getElementById('popupBtnSpeak').classList.remove('playing');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); currentSpeakingBtn = null; }

  document.getElementById('wordPopupOverlay').classList.add('show');
  trackWordView(id);
}

function closeWordPopup() {
  document.getElementById('wordPopupOverlay').classList.remove('show');
  wordPopupWordId = null;
}

// Double-click: mở tab mới với kết quả tra từ của từ đó
function onDefWordDblClick(id) {
  const word = allWords.find(w => w.id === id);
  if (!word) return;
  closeWordPopup();
  window.open(wordUrl(word), '_blank');
}

// ── Khối "Từ cùng loại": click mở popup (dùng chung logic), double-click chuyển
// thẳng sang trang kết quả tra từ đó ngay trong tab hiện tại (không mở tab mới) ──
function onRelatedWordClick(id) {
  onDefWordClick(id);
}

function onRelatedWordDblClick(id) {
  const word = allWords.find(w => w.id === id);
  if (!word) return;
  closeWordPopup();
  showPage('home');
  selectWord(id);
  scrollActivePageToTop();
}

// Cache Set các từ trong từ điển dùng cho thuật toán tách từ longest-match — dựng 1 LẦN, tái
// dùng cho mọi lần gọi segmentThai() sau đó, thay vì map+sort+Set lại TOÀN BỘ allWords mỗi lần
// dịch câu (tốn dần khi từ điển càng lớn). Sort theo độ dài giảm dần thật ra KHÔNG cần thiết —
// thuật toán bên dưới đã tự thử từ độ dài dài nhất (20) xuống 1 khi tra Set, nên bỏ luôn bước
// sort thừa đó. Chỉ dựng lại cache khi allWords thực sự đổi (thêm/sửa/xoá từ) — xem
// invalidateSegmentDictCache(), được admin-core.js gọi sau các thao tác CRUD từ trong admin.
let _segmentDictSet = null;
function invalidateSegmentDictCache() {
  _segmentDictSet = null;
}
function getSegmentDictSet() {
  if (!_segmentDictSet) {
    _segmentDictSet = new Set(allWords.map(w => w.thai).filter(Boolean));
  }
  return _segmentDictSet;
}

function segmentThai(text) {
  if (!text.trim()) return [];

  const dictSet = getSegmentDictSet();

  const result = [];
  let i = 0;
  const chars = [...text]; // handle unicode correctly

  while (i < chars.length) {
    const code = chars[i].charCodeAt(0);
    
    // Non-Thai: space or punctuation
    if (code < 0x0E00 || code > 0x0E7F) {
      if (chars[i] === ' ' || chars[i] === ' ') {
        result.push({ thai: ' ', isSpace: true });
      } else {
        result.push({ thai: chars[i], isSpace: false });
      }
      i++; continue;
    }

    // Try longest match from dictionary
    let matched = false;
    for (let len = Math.min(20, chars.length - i); len >= 1; len--) {
      const candidate = chars.slice(i, i + len).join('');
      if (dictSet.has(candidate)) {
        result.push({ thai: candidate, isSpace: false });
        i += len; matched = true; break;
      }
    }

    if (!matched) {
      // Chưa có trong từ điển: gom nguyên cụm ký tự Thái liên tiếp thành 1 khối,
      // không tách thành từng âm tiết/chữ cái. Chỉ dừng lại khi gặp 1 từ đã biết
      // trong từ điển (bắt đầu từ vị trí sau) hoặc hết chuỗi ký tự Thái.
      let j = i + 1;
      while (j < chars.length) {
        const nc = chars[j].charCodeAt(0);
        if (nc < 0x0E00 || nc > 0x0E7F) break; // hết ký tự Thái

        // Nếu từ vị trí j bắt đầu khớp với 1 từ có trong từ điển thì dừng gom lại
        let startsKnownWord = false;
        for (let len = Math.min(20, chars.length - j); len >= 1; len--) {
          if (dictSet.has(chars.slice(j, j + len).join(''))) { startsKnownWord = true; break; }
        }
        if (startsKnownWord) break;
        j++;
      }
      result.push({ thai: chars.slice(i, j).join(''), isSpace: false });
      i = j;
    }
  }
  return result;
}

// Đồng bộ nội dung gõ ở ô search chính sang ô popthaiInput ẩn, debounce chạy tách từ
let popthaiTimeout;
function onPopthaiInput(val) {
  document.getElementById('popthaiInput').value = val;
  clearTimeout(popthaiTimeout);
  const homeDefault = document.getElementById('homeDefault');
  if (!val.trim()) {
    document.getElementById('popthaiMultifontWrap').classList.remove('show');
    document.getElementById('ptDefPanel').classList.remove('show');
    document.getElementById('ptTranslateResult').classList.remove('show');
    if (homeDefault) homeDefault.style.display = 'block';
    return;
  }
  if (homeDefault) homeDefault.style.display = 'none';
  popthaiTimeout = setTimeout(runPopthai, 250);
}

// 4 khung kết quả tách từ, mỗi khung 1 font khác nhau (Mitr / Sriracha / Charmonman / Saruns Lai Mue).
// Cùng 1 danh sách từ đã tách được render vào cả 4 khung — chỉ khác font hiển thị chữ Thái,
// mỗi từ vẫn bấm được để tra nghĩa (dùng chung data-idx nên bấm ở khung nào cũng chạy ptWordClick y hệt).
const PT_MULTIFONT_KEYS = ['mitr', 'sriracha', 'charmonman', 'sarunslaimue'];
function buildPtWordsHtml(segments) {
  return segments.length ? segments.map((seg, idx) => {
    if (seg.isSpace) return '<span style="width:7px;display:inline-block"></span>';
    const word = allWords.find(w => w.thai === seg.thai);
    const phonetic = word ? (word.phonetic || '') : '';
    const hasDict = !!word;
    const phoneticHTML = phonetic ? '<span class="pt-word-phonetic">' + phonetic + '</span>' : '';
    return '<span class="pt-word' + (hasDict ? ' has-def' : '') + '" data-idx="' + idx + '" onclick="ptWordClick(' + idx + ')">'
      + '<span class="pt-word-thai">' + seg.thai + '</span>'
      + phoneticHTML
      + '</span>';
  }).join('') : '<div style="padding:12px;color:var(--text-muted)">Không tách được từ</div>';
}

function runPopthai() {
  const text = document.getElementById('popthaiInput').value.trim();
  if (!text) { showToast('⚠️ Vui lòng nhập đoạn văn bản Thái'); return; }

  document.getElementById('popthaiMultifontWrap').classList.add('show');
  document.getElementById('ptDefPanel').classList.remove('show');

  const segments = segmentThai(text);
  window._ptSegments = segments;

  const html = buildPtWordsHtml(segments);
  PT_MULTIFONT_KEYS.forEach(key => {
    const el = document.getElementById('popthaiWords-' + key);
    if (el) el.innerHTML = html;
  });
}

// ── DỊCH CẢ CÂU (OpenAI API qua Supabase Edge Function "translate-sentence") ───
// browserToken: định danh ẩn danh riêng cho trình duyệt này (không phải thông tin cá nhân gì),
// dùng để ghi nhận số liệu sử dụng — xem chi tiết các lớp chặn abuse trong Edge Function.
function getBrowserToken() {
  let token = localStorage.getItem('thai_browser_token');
  if (!token) {
    token = 'bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('thai_browser_token', token);
  }
  return token;
}

// Dịch câu giờ nằm gọn trong mục "Tách từ & Dịch câu" — icon dịch câu nổi ở góc khung kết quả
// tách từ (#ptPanelTranslateBtn), gọi hàm này trực tiếp. Kết quả hiện ở #ptTranslateResult,
// ngay phía trên khối 4 khung kết quả tách từ.
async function translateCurrentSentence() {
  const text = document.getElementById('searchInput').value.trim();
  const resultEl = document.getElementById('ptTranslateResult');
  if (!text) return;
  // Chặn phía client trước khi tốn 1 lượt gọi mạng — cùng ngưỡng với Edge Function, tránh gửi
  // request chắc chắn sẽ bị từ chối; nút cũng đã bị disable ở trường hợp này nhưng vẫn chặn
  // thêm ở đây phòng khi bấm Enter hoặc gọi hàm từ chỗ khác.
  if (text.length > MAX_TRANSLATE_TEXT_LENGTH) {
    showToast('⚠️ Câu quá dài để dịch (tối đa ' + MAX_TRANSLATE_TEXT_LENGTH + ' ký tự)');
    return;
  }
  const panelBtn = document.getElementById('ptPanelTranslateBtn');
  if (panelBtn) { panelBtn.classList.add('loading'); panelBtn.disabled = true; }
  if (resultEl) {
    resultEl.innerHTML = 'Đang dịch...';
    resultEl.classList.add('show');
  }
  try {
    const r = await fetch(SUPABASE_URL + '/functions/v1/translate-sentence', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, browserToken: getBrowserToken() })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Không dịch được lúc này');
    if (resultEl) resultEl.innerHTML = escapeHtml(data.translation);
  } catch (e) {
    if (resultEl) resultEl.innerHTML = '⚠️ ' + escapeHtml(e.message || 'Không dịch được, thử lại sau');
  } finally {
    if (panelBtn) { panelBtn.classList.remove('loading'); panelBtn.disabled = false; }
  }
}

async function ptWordClick(idx) {
  const seg = window._ptSegments && window._ptSegments[idx];
  if (!seg || seg.isSpace) return;
  const thai = seg.thai;

  // Highlight từ vừa bấm ở CẢ 4 khung font cùng lúc (dùng chung data-idx)
  document.querySelectorAll('.pt-word').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.pt-word[data-idx="' + idx + '"]').forEach(el => el.classList.add('active'));

  let word = allWords.find(w => w.thai === thai);

  if (!word) {
    // Từ chưa có trong từ điển: vẫn hiện panel rút gọn báo "không tìm thấy"
    document.getElementById('resultSection').classList.remove('show');
    const panel = document.getElementById('ptDefPanel');
    document.getElementById('ptDefThai').textContent = thai;
    document.getElementById('ptDefPhonetic').textContent = '';
    document.getElementById('ptDefBody').innerHTML = `<div class="pt-not-found">Không tìm thấy "${thai}" trong từ điển</div>`;
    panel.classList.add('show');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  word = await ensureWordFull(word.id);
  if (!word) return;

  // Từ có trong từ điển: hiển thị đầy đủ y hệt trang kết quả tra từ đơn lẻ,
  // ngay bên dưới kết quả tách từ trên cùng 1 trang (không chuyển trang, không cần nút quay lại)
  document.getElementById('ptDefPanel').classList.remove('show');
  currentWord = word;
  showResult(word);
  addRecent(word);

  const resultSection = document.getElementById('resultSection');
  resultSection.classList.add('show');
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function doSearch() {
  if (searchMode === 'popthai') { runPopthai(); return; }
  submitWordSearch(document.getElementById('searchInput').value, null, false);
}

// ── NHÃN TỶ GIÁ THẬT TRÊN NÚT "Tỷ giá" (thanh top-info) ─────────────────
// Mặc định trong HTML nút này chỉ ghi chữ "Tỷ giá" — để hiện tỷ giá thật (vd
// "1 ฿ ≈ 750 ₫") mà KHÔNG gọi API riêng (từng gây lỗi im lặng, không rõ
// nguyên nhân khi API lỗi), giờ tải sớm luôn modules/widgets.js ngay lúc vào
// trang thay vì đợi người dùng bấm nút "Thông tin nhanh" như trước. Việc tải
// module này tự động gọi loadCurrencyCard() → renderCurrencyCard() (xem
// ensureWidgetCardsLoaded() ở widgets.js), và renderCurrencyCard() là nơi
// DUY NHẤT cập nhật cả card lẫn nhãn nút này (#topInfoCurrencyLabel) — dùng
// chung đúng 1 nguồn dữ liệu, không còn 2 lần gọi API riêng biệt như trước.
// (gọi thật ở khối INIT phía dưới)

// ── THÔNG BÁO CHẤP NHẬN COOKIE ──────────────────────────
function initCookieConsent() {
  const choice = localStorage.getItem('cookieConsent');
  if (choice) return; // đã chọn từ trước (chấp nhận hoặc từ chối), không hiện lại
  setTimeout(() => {
    const banner = document.getElementById('cookieBanner');
    if (banner) banner.classList.add('show');
  }, 800);
}
function acceptCookieConsent() {
  localStorage.setItem('cookieConsent', 'accepted');
  hideCookieBanner();
}
function dismissCookieBanner() {
  localStorage.setItem('cookieConsent', 'declined');
  hideCookieBanner();
}
function hideCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.classList.remove('show');
}
function openCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.classList.add('show');
}

// ── INIT ──────────────────────────────────────────────
loadWords();
initAdminState();
initTheme();
initSegmentMode();
// Font Challenge tải câu hỏi ngay lúc vào trang (không còn màn "Bắt đầu luyện tập" riêng) —
// người dùng thấy được câu đầu tiên luôn. File .woff2 của từng font vẫn tự lazy-load đúng chuẩn
// @font-face của trình duyệt (chỉ tải file của font đang HIỂN THỊ), nên bấm sang câu tiếp theo
// mới kéo theo tải font của câu đó — không tải trước cả 83 font cùng lúc.
loadFontChallenge();
loadSiteSettings();
initCookieConsent();
// Tải sớm modules/widgets.js (thay vì đợi bấm nút "Thông tin nhanh") để nhãn
// nút "Tỷ giá" ở thanh top-info hiện tỷ giá thật ngay — xem chú thích phía trên.
loadWidgetsModule().catch(() => {});
// Icon "Dịch câu" cần đúng trạng thái bật/mờ ngay từ đầu (ô search rỗng lúc mới tải).
updateTranslateButtonState('');
// Bắt đầu luân phiên placeholder (dùng chung cho cả 2 mode).
startSearchPlaceholderRotation();
// Đặt vị trí ban đầu của thanh trượt trên segmented control — chờ 1 nhịp render để web font
// (Kodchasan/Bai Jamjuree) kịp load xong, tránh đo nhầm độ rộng nút lúc còn dùng font dự phòng.
requestAnimationFrame(updateModeTabsThumb);
window.addEventListener('resize', updateModeTabsThumb);
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(updateModeTabsThumb).catch(() => {});
}
// initAuthState() được gọi bên trong loadWords() (sau khi allWords đã sẵn sàng)

// ── PWA: đăng ký service worker + gợi ý "Cài đặt / Thêm vào màn hình chính" ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

let deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (localStorage.getItem('pwa_install_dismissed') === '1') return;
  deferredPwaPrompt = e;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.style.display = '';
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('pwa_install_dismissed', '1');
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
});

async function triggerPwaInstall() {
  if (!deferredPwaPrompt) return;
  deferredPwaPrompt.prompt();
  await deferredPwaPrompt.userChoice;
  deferredPwaPrompt = null;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
}

function dismissPwaBanner() {
  localStorage.setItem('pwa_install_dismissed', '1');
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
}

// Khởi tạo trạng thái nút nổi Spotlight ngay khi tải trang (mặc định ở trang chủ nên sẽ ẩn)
updateSpotlightFabVisibility();

// iOS Safari không hỗ trợ beforeinstallprompt -> tự hiện hướng dẫn cài đặt thủ công
(function checkIosInstallHint() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || isStandalone) return;
  if (localStorage.getItem('pwa_install_dismissed') === '1') return;
  setTimeout(() => {
    if (deferredPwaPrompt) return; // trình duyệt khác đã tự hiện prompt chuẩn rồi thì thôi
    const textEl = document.getElementById('pwaInstallText');
    const banner = document.getElementById('pwaInstallBanner');
    if (textEl) textEl.textContent = '📲 Thêm alay vào Màn hình chính: bấm nút Chia sẻ ⬆️ rồi chọn "Thêm vào MH chính"';
    if (banner) banner.style.display = 'flex';
  }, 2500);
})();

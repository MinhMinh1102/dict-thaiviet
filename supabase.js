// ============================================================
// supabase.js — ALAY
// Supabase client (REST) + các hàm gọi API dùng chung toàn app.
// Tách ra từ app.js (bước 3 kế hoạch modular hoá).
// File này KHÔNG dùng ES module (giữ nguyên vanilla script global),
// nên PHẢI được nạp bằng <script src="/supabase.js" defer></script>
// TRƯỚC thẻ <script src="/app.js" defer> trong index.html, vì app.js
// gọi trực tiếp các hàm/biến toàn cục khai báo ở đây
// (sbGet, sbPost, sbDelete, sbGetAuth, sbPostAuth, sbPatchAuth,
// sbDeleteAuth, session, isLoggedIn, saveSession, clearSession,
// signUpUser, signInUser, signInWithGoogle, consumeAuthHashIfPresent,
// ensureValidSession, ...). Nhờ "defer" nên thứ tự script tag chính
// là thứ tự thực thi, script sau vẫn xếp hàng đợi DOM sẵn sàng.
// ============================================================

const SUPABASE_URL = 'https://luoqsudzbmkzxosbdmmp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3FzdWR6Ym1renhvc2JkbW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjkxMTcsImV4cCI6MjA5ODE0NTExN30.0k87aqhSyFpFAah3H-MQ4QObWV3CCT77AcLcUx23KKg';
// Key kiểu MỚI (sb_publishable_...) — CHỈ dùng riêng cho các Edge Function viết theo pattern
// withSupabase({ auth: 'publishable' }) (hiện tại là translate-sentence), vì các function đó
// không chấp nhận key anon kiểu cũ (JWT dài) ở trên, sẽ báo 401 Invalid credentials nếu dùng
// nhầm. Toàn bộ phần còn lại của site (bảng words/quotes/favorites...) vẫn dùng SUPABASE_KEY
// (anon key cũ) như trước giờ, không đổi gì — 2 loại key này độc lập, dùng song song được.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OZ4t9BYw80cMpBypm-ssbg_ahjol3IQ';

// Mirror lên window: app.js/supabase.js là script thường (không phải module) nên các biến
// khai báo bằng const/let ở top-level KHÔNG tự động thành thuộc tính của window — nhưng các
// file trong /modules/ (nạp qua import() động, xem loadKeyboardModule/loadWidgetsModule/
// loadAdminCoreModule ở app.js) LÀ ES module thật, có phạm vi biến riêng nên không tự thấy
// được SUPABASE_URL/SUPABASE_KEY khai báo ở đây. Gán tường minh lên window để các module đó
// dùng được (qua window.SUPABASE_URL).
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers });
  return r.json();
}
async function sbPost(path, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('sbPost thất bại: ' + r.status);
  return r.json();
}
async function sbDelete(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'DELETE', headers });
  if (!r.ok) throw new Error('sbDelete thất bại: ' + r.status);
}

// ── AUTH (đăng ký / đăng nhập user, Supabase Auth REST API) ────
// Không dùng SDK, gọi thẳng REST endpoint /auth/v1/* giống cách sbGet/sbPost gọi /rest/v1/*
let session = JSON.parse(localStorage.getItem('thai_session') || sessionStorage.getItem('thai_session') || 'null');

function isLoggedIn() {
  return !!(session && session.access_token && session.user);
}

// "Nhớ mật khẩu": nếu bật, phiên đăng nhập lưu ở localStorage (giữ qua lần đóng trình duyệt);
// nếu tắt, lưu ở sessionStorage (mất khi đóng tab/trình duyệt)
function isRememberMeOn() {
  return localStorage.getItem('thai_remember_me') !== '0';
}
function persistCurrentSession() {
  if (!session) return;
  if (isRememberMeOn()) {
    localStorage.setItem('thai_session', JSON.stringify(session));
    sessionStorage.removeItem('thai_session');
  } else {
    sessionStorage.setItem('thai_session', JSON.stringify(session));
    localStorage.removeItem('thai_session');
  }
}

// Headers dùng cho các bảng cần RLS theo user (favorites, search_history):
// Authorization phải là JWT của chính user (không phải anon key) để auth.uid() nhận diện đúng
// Tự động làm mới access_token nếu đã hết hạn (mặc định Supabase cấp token sống 1 tiếng),
// tránh lỗi "invalid JWT: token is expired" khi người dùng mở tab lâu mà không tải lại trang.
async function authHeaders(extra) {
  if (session) await ensureValidSession();
  const token = (session && session.access_token) || SUPABASE_KEY;
  return Object.assign({
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }, extra || {});
}

async function sbGetAuth(path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: await authHeaders() });
  return r.json();
}
// upsertConflict: tên cột dùng làm khóa xung đột, vd 'user_id,word_id' — tự động update nếu đã tồn tại
async function sbPostAuth(path, body, upsertConflict) {
  let url = path;
  const h = await authHeaders();
  if (upsertConflict) {
    h['Prefer'] = 'resolution=merge-duplicates,return=representation';
    url += (url.indexOf('?') !== -1 ? '&' : '?') + 'on_conflict=' + upsertConflict;
  }
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return r.json();
}
async function sbPatchAuth(path, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(body) });
  return r.json();
}
async function sbDeleteAuth(path) {
  await fetch(SUPABASE_URL + '/rest/v1/' + path, { method: 'DELETE', headers: await authHeaders() });
}

function saveSession(data, remember) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
    user: {
      id: data.user.id,
      email: data.user.email,
      display_name: (data.user.user_metadata && data.user.user_metadata.display_name) || '',
      created_at: data.user.created_at || (session && session.user && session.user.created_at) || null
    }
  };
  if (typeof remember === 'boolean') {
    localStorage.setItem('thai_remember_me', remember ? '1' : '0');
  }
  persistCurrentSession();
}

function clearSession() {
  session = null;
  localStorage.removeItem('thai_session');
  sessionStorage.removeItem('thai_session');
}

async function signUpUser(email, password) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.msg || data.error_description || data.error || 'Đăng ký thất bại');
  return data;
}

async function signInUser(email, password) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error_description || data.msg || 'Sai email hoặc mật khẩu');
  return data;
}

// ── ĐĂNG NHẬP/ĐĂNG KÝ BẰNG GOOGLE (Supabase Auth OAuth) ────────
// Chuyển hướng sang Google, Supabase xử lý OAuth rồi trả về trang chủ
// kèm access_token/refresh_token trong URL hash (#access_token=...)
function signInWithGoogle() {
  const redirectTo = location.origin + '/';
  window.location.href = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
}

function onGoogleAuthClick() {
  const errorEl = document.getElementById('authError');
  if (authMode === 'register') {
    const chk = document.getElementById('authTermsCheckbox');
    if (chk && !chk.checked) {
      if (errorEl) errorEl.textContent = 'Vui lòng đồng ý với điều khoản sử dụng trước khi đăng ký';
      return;
    }
  }
  signInWithGoogle();
}

// Đọc access_token/refresh_token từ URL hash sau khi Supabase redirect về (đăng nhập Google hoặc email quên mật khẩu),
// rồi xoá hash khỏi URL. type === 'recovery' nghĩa là người dùng vừa bấm link "quên mật khẩu" trong email.
function consumeAuthHashIfPresent() {
  if (!location.hash || location.hash.indexOf('access_token=') === -1) return null;
  const params = new URLSearchParams(location.hash.substring(1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_in = params.get('expires_in');
  const type = params.get('type');
  const errorDescription = params.get('error_description');
  history.replaceState(null, '', location.pathname + location.search);
  if (errorDescription) { showToast('⚠️ ' + decodeURIComponent(errorDescription)); return null; }
  if (!access_token) return null;
  return { access_token, refresh_token, expires_in: expires_in ? parseInt(expires_in, 10) : 3600, type };
}

// Xử lý phiên đăng nhập đến từ URL hash (Google OAuth hoặc link đặt lại mật khẩu qua email)
async function handleAuthHashLogin() {
  const hashData = consumeAuthHashIfPresent();
  if (!hashData) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + hashData.access_token }
    });
    const userData = await r.json();
    if (!r.ok) throw new Error('Không xác thực được phiên đăng nhập');
    saveSession({
      access_token: hashData.access_token,
      refresh_token: hashData.refresh_token,
      expires_in: hashData.expires_in,
      user: userData
    }, true);
    activeFavFolder = 'all';
    await syncUserDataOnLogin();
    if (hashData.type === 'recovery') {
      showToast('🔑 Vui lòng đặt mật khẩu mới cho tài khoản');
      setTimeout(() => openResetPasswordModal(), 300);
    } else if (hashData.type === 'signup' || hashData.type === 'email_change') {
      showToast('✅ Email đã được xác nhận, chào mừng bạn!');
    } else {
      showToast('✅ Đăng nhập bằng Google thành công!');
    }
    return true;
  } catch (e) {
    showToast('⚠️ Không thể hoàn tất đăng nhập, thử lại sau');
    return false;
  }
}

async function refreshSessionToken() {
  if (!session || !session.refresh_token) return false;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await r.json();
    if (!r.ok) throw new Error('refresh failed');
    saveSession(data);
    return true;
  } catch (e) {
    clearSession();
    return false;
  }
}

async function ensureValidSession() {
  if (!session) return false;
  if (Date.now() > session.expires_at - 60000) {
    return await refreshSessionToken();
  }
  return true;
}

// ── SUPABASE STORAGE (upload ảnh minh họa cho định nghĩa) ──────
// Dùng JWT của admin đang đăng nhập (qua authHeaders) để upload/xóa — policy trên bucket
// word-images chỉ cho phép admin (is_admin=true trong bảng profiles) ghi/xóa, ai cũng đọc được.
// path: tên file duy nhất trong bucket, KHÔNG chứa "/" ở đầu (vd "1234-ab12cd.webp").
// Trả về URL công khai để lưu thẳng vào definitions[].image.url.
async function sbUploadStorageFile(bucket, path, blob) {
  const h = await authHeaders({ 'Content-Type': blob.type || 'application/octet-stream' });
  delete h['Prefer']; // header này chỉ dùng cho REST bảng dữ liệu, Storage API không cần
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, {
    method: 'POST', headers: h, body: blob
  });
  if (!r.ok) throw new Error('Tải ảnh lên thất bại (mã ' + r.status + ')');
  return SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + path;
}

// Xóa file cũ trên Storage khi admin thay ảnh khác hoặc bấm xóa ảnh — cố gắng làm nhưng không
// chặn UI nếu lỗi (vd ảnh đã bị xóa từ trước), gọi kiểu "fire and forget" ở nơi dùng.
async function sbDeleteStorageFile(bucket, path) {
  if (!path) return;
  try {
    const h = await authHeaders();
    delete h['Content-Type'];
    delete h['Prefer'];
    await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + path, { method: 'DELETE', headers: h });
  } catch (e) { /* bỏ qua lỗi xóa file cũ, không ảnh hưởng luồng chính */ }
}

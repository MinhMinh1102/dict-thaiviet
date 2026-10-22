// ══════════════════════════════════════════════════════════════════
// youtube-captions/index.ts — SABAISABAIDI
//
// Lấy phụ đề (có sẵn của YouTube) của 1 video để ADMIN chỉnh sửa lại thành "phụ đề tự viết" cho câu ví dụ.
// Trình duyệt KHÔNG gọi thẳng YouTube lấy phụ đề được (bị chặn CORS) nên cần function này làm trung gian.
//
// CÁCH DÙNG TRONG SUPABASE DASHBOARD (giống translate-sentence):
//   1) Edge Functions > Create new edge function, XÓA HẾT code mẫu trong index.ts, paste TOÀN BỘ file này
//   2) Function name: youtube-captions
//   3) Nếu có tùy chọn "Verify JWT" / "Enforce JWT verification" khi deploy — TẮT nó đi
//   4) Deploy. KHÔNG cần secret hay file SQL nào.
//
// INPUT (POST JSON):  { videoId: "11 ký tự", lang?: "th" (mặc định), from?: giây, to?: giây }
//   from/to: chỉ trả các dòng nằm trong khoảng này (±1s) — admin gửi đúng đoạn ví dụ để phản hồi gọn, không kéo cả video.
// OUTPUT: { language, auto, translated, tracks:[{lang,name,auto}], captions:[{start,end,thai,viet}] }
//   thai = phụ đề gốc theo ngôn ngữ chọn; viet = bản dịch tự động sang tiếng Việt của YouTube (rỗng nếu video không cho dịch).
//
// LƯU Ý ĐỘ TIN CẬY: function gọi API nội bộ không chính thức của YouTube (InnerTube). YouTube có thể chặn/đổi bất cứ lúc nào, nhất là
// với IP của máy chủ đám mây — khi đó function trả lỗi và admin dùng "Thêm dòng"/"Dán SRT/VTT" thay thế. Video không có phụ đề
// (cả tự động lẫn thủ công) cũng trả lỗi 404.
// ══════════════════════════════════════════════════════════════════

import { withSupabase } from 'npm:@supabase/server@^1';

const CLIENT_VERSION = '20.10.38';
const MAX_CAPTIONS = 400; // chặn phản hồi quá lớn khi admin quên gửi from/to

// ── Hàm thuần (không phụ thuộc mạng) — dễ kiểm thử ───────────────────────────────────────────────
function parseJson3(json: any): { start: number; end: number; text: string; startMs: number }[] {
  const out: { start: number; end: number; text: string; startMs: number }[] = [];
  for (const ev of (json && Array.isArray(json.events) ? json.events : [])) {
    if (!ev || !Array.isArray(ev.segs)) continue; // bỏ sự kiện không có chữ (vd xuống dòng, cửa sổ hiển thị)
    const text = ev.segs.map((s: any) => (s && s.utf8) || '').join('').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startMs = Number(ev.tStartMs) || 0;
    out.push({ start: startMs / 1000, end: (startMs + (Number(ev.dDurationMs) || 0)) / 1000, text, startMs });
  }
  // Phụ đề tự động hay chồng lấn thời gian — cắt cuối dòng trước tại điểm bắt đầu dòng sau
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i + 1].start < out[i].end) out[i].end = out[i + 1].start;
  }
  return out.filter(c => c.end > c.start);
}

function pickTrack(tracks: any[], lang: string): any | null {
  if (!tracks.length) return null;
  const same = tracks.filter(t => t.languageCode === lang || (t.languageCode || '').startsWith(lang + '-'));
  return same.find(t => t.kind !== 'asr') || same[0] || null; // ưu tiên phụ đề thủ công hơn tự động
}

// Ghép bản dịch vào bản gốc theo mốc bắt đầu (khớp đúng, hoặc lệch tối đa 500ms)
function alignTranslation(orig: { startMs: number }[], trans: { startMs: number; text: string }[]): string[] {
  const byStart = new Map<number, string>();
  for (const t of trans) byStart.set(t.startMs, t.text);
  return orig.map(o => {
    if (byStart.has(o.startMs)) return byStart.get(o.startMs)!;
    let best: { d: number; text: string } | null = null;
    for (const t of trans) {
      const d = Math.abs(t.startMs - o.startMs);
      if (d <= 500 && (!best || d < best.d)) best = { d, text: t.text };
    }
    return best ? best.text : '';
  });
}

// ── Gọi YouTube ──────────────────────────────────────────────────────────────────────────────────
async function getCaptionTracks(videoId: string): Promise<any[]> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `com.google.android.youtube/${CLIENT_VERSION} (Linux; U; Android 14) gzip`,
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': CLIENT_VERSION,
    },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: CLIENT_VERSION, androidSdkVersion: 34, hl: 'en', gl: 'US' } },
      videoId,
    }),
  });
  if (!res.ok) throw new Error('YouTube player ' + res.status);
  const data = await res.json();
  return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

async function fetchTrackEvents(baseUrl: string, tlang?: string) {
  const u = new URL(baseUrl);
  u.searchParams.set('fmt', 'json3');
  if (tlang) u.searchParams.set('tlang', tlang);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error('YouTube timedtext ' + res.status);
  const body = await res.text();
  if (!body) throw new Error('YouTube timedtext trống');
  return parseJson3(JSON.parse(body));
}

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (req, _ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    let body: any;
    try { body = await req.json(); } catch { return Response.json({ error: 'Body không hợp lệ' }, { status: 400 }); }

    const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return Response.json({ error: 'Mã video không hợp lệ' }, { status: 400 });
    const lang = typeof body?.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(body.lang) ? body.lang : 'th';
    const from = Number.isFinite(Number(body?.from)) && body?.from !== null && body?.from !== '' ? Number(body.from) : null;
    const to = Number.isFinite(Number(body?.to)) && body?.to !== null && body?.to !== '' ? Number(body.to) : null;

    try {
      const tracks = await getCaptionTracks(videoId);
      if (!tracks.length) return Response.json({ error: 'Video này không có phụ đề nào (kể cả tự động)' }, { status: 404 });

      const track = pickTrack(tracks, lang);
      const trackList = tracks.map((t: any) => ({ lang: t.languageCode, name: t.name?.simpleText || t.languageCode, auto: t.kind === 'asr' }));
      if (!track) {
        return Response.json({ error: `Video không có phụ đề tiếng "${lang}". Các ngôn ngữ có sẵn: ${trackList.map(t => t.lang).join(', ')}`, tracks: trackList }, { status: 404 });
      }

      let orig = await fetchTrackEvents(track.baseUrl);
      let viet: string[] = [];
      let translated = false;
      let transEvents: { startMs: number; text: string }[] = [];
      if (track.isTranslatable) {
        try { transEvents = await fetchTrackEvents(track.baseUrl, 'vi'); translated = transEvents.length > 0; } catch (_e) { /* bản dịch là phần thêm — lỗi thì bỏ qua */ }
      }

      if (from !== null || to !== null) {
        const lo = from !== null ? from - 1 : -Infinity;
        const hi = to !== null ? to + 1 : Infinity;
        orig = orig.filter(c => c.end > lo && c.start < hi);
      }
      orig = orig.slice(0, MAX_CAPTIONS);
      viet = translated ? alignTranslation(orig, transEvents) : orig.map(() => '');

      const r1 = (n: number) => Math.round(n * 10) / 10; // 0,1 giây là đủ chính xác cho phụ đề ví dụ
      return Response.json({
        language: track.languageCode,
        auto: track.kind === 'asr',
        translated,
        tracks: trackList,
        captions: orig.map((c, i) => ({ start: r1(c.start), end: r1(c.end), thai: c.text, viet: viet[i] || '' })),
      });
    } catch (e) {
      console.error('youtube-captions error:', e);
      return Response.json({ error: 'Không lấy được phụ đề từ YouTube lúc này (có thể YouTube đang chặn máy chủ). Hãy nhập tay hoặc dán SRT/VTT.' }, { status: 502 });
    }
  }),
};

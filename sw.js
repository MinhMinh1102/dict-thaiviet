// ============================================================
// SERVICE WORKER — ALAY
// Chiến lược cache:
// - App shell (index.html, các trang tĩnh, manifest, icon): network-first,
//   dự phòng bằng cache khi mất mạng (luôn ưu tiên bản mới nhất khi có mạng).
// - Dữ liệu từ điển (bảng "words" trên Supabase): network-first + lưu cache,
//   để vẫn tra được từ khi mất mạng (dùng bản đã cache lần gần nhất).
// - Tài nguyên bên ngoài (Google Fonts, Tesseract CDN...): cache-first.
// ============================================================

const CACHE_VERSION = 'alay-v231'; // bump len v103: doi cho icon loa/font-preview canh khung 4-font, loa chuyen xuong canh gop y
                                          // thể" ở Font Challenge — icon mới cạnh tiêu đề mở
                                          // popup danh sách font (xem trước bằng chính font đó,
                                          // kèm số câu + huy hiệu độ khó nếu đã phân loại). Chọn
                                          // 1 font sẽ luyện NGAY các câu của font đó, BỎ QUA điều
                                          // kiện đến hạn SRS (không cần chờ tới lượt) — trả lời
                                          // vẫn cập nhật tiến độ SRS bình thường. Có banner báo
                                          // đang luyện riêng font nào + nút Thoát về chế độ bình
                                          // thường. Xem fcBuildQueue()/fcOpenFontPicker() trong
                                          // app.js.
// (v71) thêm nút "Bỏ qua câu này" ở Font
                                          // Challenge (fcSkipQuestion()) — KHÔNG tính đúng/sai,
                                          // không đụng SRS/skill của câu đó (khác fcShowAnswer()
                                          // vốn tính là đã xem đáp án), chỉ chuyển sang câu kế
                                          // tiếp trong hàng đợi hiện tại; câu bị bỏ qua vẫn còn
                                          // nguyên trong hàng đợi SRS, tự gặp lại đúng lịch bình
                                          // thường ở phiên sau. Đặt tách riêng dưới "Xem gợi ý"/
                                          // "Xem đáp án", chữ nhạt hơn.
// (v70) viết lại hoàn toàn khu vực "Xem gợi ý"
                                          // Font Challenge theo đúng ảnh thiết kế mẫu — khung có
                                          // hàng tiêu đề "Xem gợi ý" (icon la bàn + mũi tên
                                          // thu/mở cả khối, fcToggleHintBox()), bên dưới là danh
                                          // sách 3 mục nối liền (không phải thẻ rời), mỗi mục là
                                          // accordion con bấm để mở rộng xem nội dung tại chỗ
                                          // (fcToggleHintItem(), chỉ 1 mục mở cùng lúc). Mục
                                          // "Nghe phát âm" có nút Play tròn + dạng sóng minh họa
                                          // (trang trí, không đồng bộ biên độ thật) + đồng hồ đếm
                                          // giờ thật lúc đang đọc (fcSpeakChallengeHint()).
// (v69) bo góc VUÔNG HƠN (giảm border-radius)
                                          // cho khung gợi ý Font Challenge — khung ngoài 18px→
                                          // 10px, 3 thẻ trắng bên trong 14px→8px.
// (v68) khung nền xanh nhạt của 3 gợi ý Font
                                          // Challenge đổi sang ĐÚNG màu #E8EEF3 đã dùng làm viền
                                          // khung câu hỏi (.fc-thai-display border-color) — trước
                                          // dùng color-mix với --accent (xanh slate, không phải
                                          // xanh nhạt như khung câu hỏi). Tăng border-radius +
                                          // padding của 3 thẻ trắng bên trong cho vuông vắn hơn.
// (v67) 4 chỉnh sửa cho 3 gợi ý Font Challenge
                                          // — (1) bỏ tiêu đề "Gợi ý"; (2) bỏ dấu ✓ khi đã xem
                                          // (chỉ còn thay đổi cursor); (3) icon + tên gợi ý nằm
                                          // chung 1 hàng ngang (.fc-hint-row-top), nội dung thật
                                          // xuống dòng riêng bên dưới; (4) icon loa "Phát âm" có
                                          // sóng âm nhấp nháy lệch nhịp khi đang đọc (dựa vào
                                          // class "playing" speakText() tự thêm/gỡ, xem
                                          // fcSpeakChallengeHint() + @keyframes fcHintWavePulse).
// (v66) đổi layout 3 gợi ý Font Challenge —
                                          // khung ngoài nền XANH NHẠT (color-mix với --accent),
                                          // 3 mục giờ là 3 THẺ TRẮNG xếp NGANG (flex row, đều
                                          // nhau) thay vì xếp dọc như trước, mỗi thẻ icon-nhãn-
                                          // giá trị canh giữa theo cột dọc bên trong thẻ.
// (v65) đơn giản hóa 3 gợi ý Font Challenge —
                                          // thêm tiêu đề "Gợi ý", mặc định CHỈ hiện icon + tiêu
                                          // đề (bỏ dòng phụ "Bấm để xem"), bỏ hẳn hiệu ứng mờ
                                          // opacity, tiêu đề đổi thành chữ thường (bỏ viết hoa/
                                          // letter-spacing), icon Bản dịch đổi sang "translate"
                                          // (Lucide Languages), icon loa Phát âm bỏ vòng tròn nền
                                          // — dùng chung style icon trơn với 2 mục còn lại.
// (v64) sau khi bấm "Xem gợi ý" ở Font
                                          // Challenge — đổi placeholder ô nhập thành "Bạn thử lại
                                          // xem sao, trước khi..." + ẩn nút "Xem gợi ý" và chữ
                                          // "hoặc" (chỉ còn "Xem đáp án"). Reset lại placeholder
                                          // gốc + hiện lại 2 phần tử đó khi sang câu mới.
// (v63) đổi icon nút "Kiểm tra" ở ô nhập câu
                                          // trả lời Font Challenge — từ kính lúp+check sang
                                          // circle-check (Lucide), màu accent thay vì thai-gold.
// (v62) 3 mục gợi ý ở Font Challenge giờ ẨN nội
                                          // dung mặc định — bấm "Xem gợi ý" chỉ hiện 3 NHÃN (mờ),
                                          // phải bấm vào TỪNG mục mới lộ nội dung + đổi trạng
                                          // thái mục đó thành "đã xem" (dấu ✓ + hết mờ). Xem
                                          // fcRevealHintRow() trong app.js + class "revealed"
                                          // trong style.css. Dọn luôn 2 khối comment cũ trùng lặp
                                          // sót lại từ 2 lần sửa trước.
// (v61) "Xem gợi ý" ở Font Challenge giờ hiện
                                          // 3 mục thay vì 1 — Phát âm (nút loa TTS mới,
                                          // fcSpeakChallengeHint()), Phiên âm (field "phonetic"
                                          // câu, font TUV Ahamono), Bản dịch (nghĩa tiếng Việt,
                                          // font Bad Script — giữ nguyên như trước). Xem
                                          // fcShowHint() trong app.js + .fc-hint-row/.fc-hint-
                                          // speak-btn/.fc-hint-aa-icon trong style.css.
// (v60) chậm lại hiệu ứng lật trang "Hôm nay
                                          // có gì?" — 0.5s → 0.9s, chỉnh lại mốc đổi nội dung
                                          // trong JS (flipQuotePage()) theo đúng giữa lượt lật mới.
// (v59) hiệu ứng lật trang "Hôm nay có gì?" đổi
                                          // trục xoay — trước xoay quanh mép TRÁI kiểu lật cả
                                          // trang sách, giờ xoay quanh GÓC DƯỚI-PHẢI theo trục
                                          // chéo (rotate3d(-1,1,0,...), transform-origin:100% 100%,
                                          // khớp đúng vị trí icon .today-flip-btn) mô phỏng cảm
                                          // giác nhấc góc trang giấy thật lên rồi lật úp, kèm
                                          // perspective-origin lệch về góc đó cho đúng góc nhìn 3D.
// (v58) sửa lỗi MẤT dòng tiếng Thái ĐẦU TIÊN
                                          // khi ghép với phiên âm — nguyên nhân: Chrome lưu dòng
                                          // đầu gõ trong ô contenteditable dưới dạng text RỜI
                                          // (không bọc <div>), chỉ các dòng sau (tạo bằng Enter)
                                          // mới có <div> riêng; code cũ lọc theo tagName DIV/P
                                          // nên bỏ sót. Viết lại bằng splitHtmlIntoLines() — duyệt
                                          // qua từng node con, gom text rời + tự đóng dòng đúng
                                          // lúc gặp <div>/<p>/<br> tiếp theo. #quoteText giờ LUÔN
                                          // được chuẩn hóa thành <div> sạch từng dòng (kể cả khi
                                          // không có phiên âm) nên formatQuoteBilingual() cũng
                                          // đơn giản hóa lại, không cần tự tách dòng nữa.
// (v57) "Hôm nay có gì?" giờ ghép cặp tiếng
                                          // Thái + phiên âm XEN KẼ (dòng Thái 1 → phiên âm 1 →
                                          // dòng Thái 2 → phiên âm 2...) thay vì tách 2 khối
                                          // riêng — xem buildQuoteTextWithPhonetic() trong
                                          // app.js. Ô "Phiên âm" ở Admin đổi từ input 1 dòng
                                          // sang textarea nhiều dòng (mỗi dòng khớp 1 dòng tiếng
                                          // Thái theo thứ tự). formatQuoteBilingual()/
                                          // getQuoteThaiText() cập nhật để bỏ qua dòng phiên âm
                                          // (không tính nhầm thành dòng dịch tiếng Việt / không
                                          // đọc lẫn vào giọng TTS tiếng Thái). Bỏ hẳn #quotePhonetic
                                          // (không dùng nữa, đã ghép vào trong #quoteText).
// (v56) sửa ĐÚNG chỗ lần này — field CHÍNH
                                          // #quoteTextVi (không phải nhánh fallback cũ mình vá
                                          // nhầm ở v55) thiếu !important nên style dính theo khi
                                          // copy-paste (hoặc .quote-text * nếu rơi vào case
                                          // nested) đè mất Bad Script ở đoạn có định dạng riêng
                                          // (b/i/u). Gộp .quote-vi-line + .quote-vi-line * thành
                                          // 1 rule chung có !important, áp dụng cho MỌI trường
                                          // hợp (field riêng lẫn fallback nested), bỏ rule trùng
                                          // lặp .quote-text .quote-vi-line cũ.
// (v55) sửa lỗi font — đoạn dịch tiếng Việt
                                          // (fallback .quote-vi-line trong "Hôm nay có gì?") nếu
                                          // được admin BÔI ĐẬM/NGHIÊNG/GẠCH CHÂN 1 phần thì phần
                                          // đó bị .quote-text * (ép font tiếng Thái, !important)
                                          // ghi đè mất Bad Script — đã chặn thêm cho cả thẻ con
                                          // (b/i/u) bên trong .quote-vi-line, không chỉ riêng
                                          // .quote-vi-line.
// (v54) bỏ nền tròn trắng + viền của mọi icon
                                          // tính năng trong "Hôm nay có gì?" — chỉ còn icon trơn.
                                          // Gồm .quote-icon-action (Xem bản dịch/Phát âm/Lưu/
                                          // Copy/Share) và .today-dice-btn (Xem lại hôm nay/Xem
                                          // câu khác). .today-flip-btn (icon lật góc trang) vốn
                                          // đã không có nền/viền từ trước, không cần đổi.
// (v53) tác giả/nguồn "Hôm nay có gì?"
                                          // (.quote-author) đổi sang font 'MN Pak Kad Hom' —
                                          // lưu ý font này subset chỉ Thái + Latin không dấu,
                                          // tên có dấu tiếng Việt sẽ rớt về font dự phòng.
// (v52) (1) thêm phiên âm cho "Hôm nay có gì?"
                                          // — cột mới "phonetic" trong bảng quotes (CHẠY TAY
                                          // migration_quotes_phonetic.sql TRƯỚC khi deploy), ô
                                          // nhập mới trong Admin (thêm + sửa), hiển thị ở
                                          // .quote-phonetic (font TUV Ahamono, chữ thẳng); (2) bỏ
                                          // font-style:italic (đổi thành chữ thẳng) ở phiên âm
                                          // Font Challenge (.fc-answer-phonetic) và vocab thời
                                          // tiết/tỷ giá/món ăn (.weather/-currency/-food-card-
                                          // vocab-phonetic) — riêng phiên âm trang kết quả tra từ
                                          // chính (.word-phonetic) và lịch sử (.ac-phonetic)
                                          // KHÔNG đổi, không nằm trong yêu cầu lần này.
// (v51) câu tiếng Thái trong "Hôm nay có gì?"
                                          // (.quote-text) đổi sang font 'MN Pak Kad Hom' (file
                                          // mới /fonts/mn-pak-kad-hom.woff2, subset khối tiếng
                                          // Thái + Latin cơ bản, cùng quy ước với các font FC*).
                                          // Tiện thể sửa 1 lỗi phát sinh: .quote-text * (ép font
                                          // cho mọi phần tử con) đang đè luôn cả font 'Bad Script'
                                          // của dòng dịch tiếng Việt fallback (.quote-vi-line
                                          // nested trong .quote-text, case quote cũ chưa có field
                                          // text_vi riêng) — đã thêm !important ưu tiên cao hơn.
// (v50) đổi lại thành 'Bad Script' theo đúng
                                          // yêu cầu ban đầu (thay vì Dancing Script đã tạm dùng)
                                          // — Minh Minh test thực tế xác nhận Bad Script vẫn
                                          // hiện đúng dấu tiếng Việt nhờ có sẵn combining
                                          // diacritics trong font dù trang Google Fonts không
                                          // liệt kê chính thức "Vietnamese" vào ngôn ngữ hỗ trợ.
// (v49) 5 tính năng mới cho "Đề xuất từ" —
                                          // (1) trạng thái xử lý (pending/approved/rejected, cột
                                          // mới trong word_suggestions, admin không xóa nữa mà
                                          // đánh dấu ✅/❌, thấy lại được ở tab "Đề xuất từ" +
                                          // Hồ sơ); (2) cảnh báo trùng khi gõ (so allWords có
                                          // sẵn, không tốn request); (3) gộp đề xuất trùng của
                                          // nhiều người qua hàm SQL an toàn find_or_bump_suggestion
                                          // (SECURITY DEFINER, không mở quyền SELECT công khai
                                          // lên cột nhạy cảm contact_email/user_id) — xem
                                          // migration_word_suggestions_status.sql (CHẠY TAY
                                          // TRƯỚC khi deploy); (4) ghi chú admin khi từ chối;
                                          // (5) đánh dấu đề xuất "pending" quá 30 ngày trong danh
                                          // sách admin. Lưu ý: (2)+(3) mới áp dụng ở tab "Đề xuất
                                          // từ" trong Thư viện, CHƯA áp dụng ở popup ngữ cảnh
                                          // (suggestWordModal) — có thể mở rộng sau nếu cần.
// (v48) field "Cấu tạo từ" (structure) trong
                                          // Admin (form Thêm từ mới + modal Sửa từ) đổi từ ô nhập
                                          // thường sang rich text B/I/U (.rte-wrap/.rte-toolbar/
                                          // .rte-area, cùng mẫu với ô Định nghĩa/Ví dụ) — riêng
                                          // Phiên âm vẫn giữ ô nhập thường như cũ, không đổi.
                                          // .word-structure ở trang kết quả (nơi hiển thị) vốn đã
                                          // render bằng innerHTML từ trước nên không cần sửa gì
                                          // phía hiển thị, tự nhận định dạng mới.
// (v47) nội dung tiếng Việt của "Hôm nay có
                                          // gì?" (.quote-vi-line) và Font Challenge (.fc-answer-
                                          // translation, .fc-hint-box, .fc-explain) đổi sang font
                                          // 'Dancing Script' (Google Font) — ĐỔI Ý so với yêu cầu
                                          // ban đầu dùng 'Bad Script' vì font đó không hỗ trợ
                                          // tiếng Việt (chữ có dấu sẽ rớt font), đã xác nhận lại
                                          // với Minh Minh trước khi đổi. Tăng size các dòng này
                                          // lên vì chữ viết tay nét mảnh cần cỡ lớn hơn mới rõ,
                                          // bỏ font-style:italic ở .quote-vi-line (chồng nghiêng
                                          // lên chữ thảo sẽ xấu).
// (v46) áp dụng font riêng 'TUV Ahamono' (file
                                          // mới /fonts/tuv-ahamono.woff2, convert từ .otf gốc,
                                          // KHÔNG subset) cho MỌI nơi hiển thị phiên âm trên toàn
                                          // app — liệt kê tường minh từng class (.ac-phonetic,
                                          // .word-phonetic, .fc-answer-phonetic, .trending-
                                          // phonetic, .weather/-currency/-food-card-vocab-
                                          // phonetic, .pt-word/-def-phonetic, ô đầu mỗi dòng
                                          // .phonetic-guide-table) — KHÔNG áp cho ô input admin
                                          // đang gõ phiên âm (giữ font thường dễ đọc/gõ).
// (v45) thư mục trong "Khám phá" giờ có lời
                                          // giới thiệu (mô tả) do người dùng tự viết, giống Danh
                                          // sách đã có sẵn — thêm cột "description" cho bảng
                                          // favorite_folders (CHẠY TAY migration_favorite_folders
                                          // _description.sql trong Supabase SQL Editor TRƯỚC khi
                                          // deploy bản này). Sửa qua menu "⋮" mỗi thư mục ở Sổ
                                          // tay ("📝 Lời giới thiệu") hoặc nút trong trang chi
                                          // tiết thư mục ở Khám phá (editFavFolderDescription()).
// (v44) 6 tính năng mới cho tab "Khám phá":
                                          // (1) sắp xếp Phổ biến nhất/Mới nhất/Nhiều từ nhất
                                          // (setWlistSort); (2) lọc loại Tất cả/Danh sách/Thư
                                          // mục (setWlistTypeFilter); (3) tab thứ 3 "Đã lưu" —
                                          // xem lại đúng những gì đã lưu từ người khác (trước chỉ
                                          // có Khám phá/Của tôi); (4) nút 🚩 báo cáo nội dung —
                                          // TÁI DÙNG nguyên popup Góp ý sẵn có (không thêm type
                                          // mới cho Edge Function, tránh rủi ro server chưa hỗ
                                          // trợ); (5) dải "Mới đăng gần đây" (top 5 theo
                                          // created_at, tái dùng dữ liệu đã tải sẵn không thêm
                                          // truy vấn); (6) xem trước 3 từ tiêu biểu trên card
                                          // (preview_words, gộp chung vào truy vấn đếm số từ có
                                          // sẵn — không tốn thêm request nào).
// (v43) 7 tính năng mới cho tab "Sổ tay":
                                          // (1) tìm kiếm trong Sổ tay (onFavSearch, kết hợp thêm
                                          // với thư mục đang lọc); (2) sắp xếp Mặc định/Mới lưu
                                          // gần đây/Sắp đến hạn ôn/A-Z (setFavSort); (3) "Chọn
                                          // nhiều" — xóa/chuyển thư mục hàng loạt (chỉ áp dụng
                                          // cho từ, tái dùng mode 'bulkMove' mới trong popup chọn
                                          // thư mục); (4) chấm tròn nhỏ (●●●○○) báo mức tiến độ
                                          // SRS (box 1-5) ngay trên dòng thu gọn; (5) icon 📝 báo
                                          // từ có ghi chú; (6) banner gợi ý dọn thư mục ĐANG
                                          // TRỐNG — ĐƠN GIẢN HÓA từ ý tưởng "trống lâu ngày" ban
                                          // đầu vì app không lưu created_at/last-active của từng
                                          // thư mục ở client; (7) xuất danh sách 1 thư mục ra file
                                          // .txt (exportFavFolder, thêm vào menu "⋮" mỗi thư mục).
// (v42) 6 tính năng mới cho tab "Lịch sử":
                                          // (1) "Chọn nhiều" — checkbox chọn hàng loạt, xóa/lưu
                                          // vào thư mục nhiều từ cùng lúc (mode 'bulk' mới trong
                                          // popup chọn thư mục, xem openFavFolderPickerBulk());
                                          // (2) dropdown sắp xếp Mới nhất/Tra nhiều nhất/A-Z;
                                          // (3) banner nhắc ôn lại từ đã lưu >30 ngày chưa tra
                                          // (renderHistoryStaleReminder, mở thẳng flashcard SRS);
                                          // (4) toast "Hoàn tác" sau khi xóa 1 từ/nhiều từ khỏi
                                          // lịch sử (showUndoToast); (5) heatmap nhỏ kiểu
                                          // contribution graph (renderHistoryHeatmap — LƯU Ý là
                                          // ước lượng dựa trên lần tra gần nhất, không phải nhật
                                          // ký từng ngày tuyệt đối, vì DB không lưu vậy); (6) top
                                          // 5 từ tra nhiều nhất mọi thời điểm (renderHistoryTopWords).
// (v41) thêm icon bookmark "đã lưu" cạnh icon
                                          // ghim trong dòng lịch sử — chỉ hiện khi từ có ≥1
                                          // nghĩa đã lưu vào thư mục, kèm số nhỏ = số nghĩa đã
                                          // lưu nếu từ có ≥2 nghĩa (từ 1 nghĩa thì không cần số).
                                          // Icon chỉ là chỉ báo trạng thái, không bấm được riêng.
// (v40) thêm dòng thống kê nhỏ dưới lời giới
                                          // thiệu tab "Lịch sử" — tổng số từ đã tra / số từ hôm
                                          // nay / số từ đã lưu / số từ chưa lưu. Luôn tính trên
                                          // toàn bộ lịch sử, không phụ thuộc ô tìm kiếm/chip
                                          // filter đang chọn. Xem renderHistoryStats() trong
                                          // app.js + .hist-stats-row trong style.css.
// (v39) gợi ý "➕ Thêm vào ôn tập?" hiện dưới
                                          // 1 dòng lịch sử khi từ đó đã tra ≥3 lần mà CHƯA lưu
                                          // vào thư mục nào — bấm vào mở luôn popup chọn thư mục
                                          // (openFavFolderPicker, mặc định nghĩa đầu tiên), tự
                                          // vào hàng đợi ôn tập SRS sau khi lưu. Chỉ hiện ở tab
                                          // "Lịch sử" đầy đủ, ẩn ở dropdown gợi ý nhỏ (đỡ chật).
// (v38) thêm hàng chip filter dưới ô tìm kiếm
                                          // lịch sử — Tất cả/Hôm nay/Hôm qua/Tuần này/Tháng này/
                                          // Đã ghim (khớp đúng nhóm getHistoryDateBucket()), kết
                                          // hợp được với ô tìm kiếm text ở trên cùng lúc. Xem
                                          // setHistoryFilter() + .hist-filter-row.
// (v37) thêm số lần tra từ ("x8") bên cạnh thời
                                          // gian trong lịch sử — bảng search_history có thêm cột
                                          // "count" (xem migration_search_history_count.sql,
                                          // CHẠY TAY trong Supabase SQL Editor trước khi deploy
                                          // bản này). Chỉ hiện khi tra ≥2 lần, ẩn khi mới tra 1
                                          // lần cho đỡ rườm rà.
// (v36) tab "Lịch sử" (Thư viện) — thêm nhóm
                                          // theo thời gian khi không lọc: Đã ghim (nếu có, luôn
                                          // trên cùng như trước) → Hôm nay → Hôm qua → Tuần này
                                          // (từ thứ Hai) → Tháng này → Cũ hơn. Xem
                                          // getHistoryDateBucket() + .hist-date-group-label
                                          // trong app.js/style.css. Khi đang lọc theo từ khóa vẫn
                                          // giữ danh sách phẳng như trước.
// (v35) empty state tab "Lịch sử" đổi text lần
                                          // nữa — "Bạn chưa tra từ nào" + "Bắt đầu [?] từ đầu
                                          // tiên", bỏ hẳn emoji 🕓 (cả 2 nhánh có/không có query).
// (v34) empty state tab "Lịch sử" (Thư viện)
                                          // đổi thành "Chưa tra từ nào" + nút "?" (style giống hệt
                                          // nút nổi "Tra từ nhanh", dùng chung .spotlight-fab-
                                          // qmark) + "để bắt đầu" — bấm nút "?" gọi đúng
                                          // goToWordSearchFocus() như nút nổi kia.
// (v33) (1) sát sidebar/topbar hơn nữa —
                                          // margin-top + margin-left của .main/#page-favorites/
                                          // #page-admin về hẳn 0 (trước 2px), margin-right/bottom
                                          // vẫn giữ 2px; (2) bỏ logo "chào" /images/chao.png
                                          // (ảnh chắp tay ไทยแลนด์ ở góc trên) — xoá cả <img> lẫn
                                          // CSS .top-left-corner-logo, không còn dùng nữa.
// (v32) sát hơn nữa theo yêu cầu — bỏ hẳn
                                          // max-width:1600px + margin/width rút về mức tối thiểu
                                          // (2px mỗi cạnh) cho .main/#page-favorites/#page-admin,
                                          // áp dụng cả 4 cạnh (trước chỉ chỉnh trái/trên), kể cả
                                          // ở mobile — khung giờ luôn sát mép, không còn hở nhiều
                                          // trên màn hình rộng dù trước đó max-width vốn cố tình
                                          // giới hạn để dòng chữ không quá dài.
// (v31) sửa lại đúng hướng theo ảnh chụp — bỏ
                                          // padding 68px/2rem đoán sai ở v30, đổi margin của
                                          // .main + #page-favorites + #page-admin (10px auto 8px
                                          // → 6px auto 8px 6px) để khung SÁT với cột icon
                                          // .side-menu bên trái và thanh .top-info-bar bên trên,
                                          // thay vì canh giữa để hở đều 2 bên như thiết kế cũ.
// (v30) tăng padding khung .main — top 2rem
                                          // (khớp cột icon side-menu bên trái nếu cần khoảng hở
                                          // rộng hơn phía trên), right 68px (bằng đúng bề rộng
                                          // cột icon .side-menu bên trái, để 2 bên cân đối).
// (v29) thu hẹp padding-top (1.25rem→0.75rem)
                                          // và padding-right (1.5rem→1rem) của khung .main (giữ
                                          // nguyên padding trái/dưới) — bớt khoảng trống thừa
                                          // phía trên và bên phải khung nội dung chính.
// (v28) popup vẫn sát mép trên màn hình dù đã
                                          // có max-height — nguyên nhân do .modal-overlay chưa
                                          // có padding riêng, max-height tính theo % CẢ màn hình.
                                          // Thêm padding cho .modal-overlay (áp dụng mọi popup)
                                          // + giảm max-height .feedback-modal-box 88vh→80vh để
                                          // luôn còn khoảng hở với mép màn hình.
// (v27) sửa popup "Đề xuất từ" (đổi tên từ "Đề
                                          // xuất từ mới") bị cắt ngang trên mobile — thêm
                                          // max-height + overflow-y cho .feedback-modal-box
                                          // (dùng chung cho popup này và popup Góp ý) để nội
                                          // dung dài tự cuộn bên trong thay vì tràn khỏi màn hình.
// (v26) bọc form tab "Đề xuất từ" (Thư viện)
                                          // vào 1 khung card (.suggest-tab-card trong style.css)
                                          // thay vì để input trôi nổi trên nền trang.
// (v25) gộp mục "Đề xuất từ mới" (trước đây ở thanh menu dọc, mở popup) vào Thư viện thành tab thứ
                                          // 4 "Đề xuất từ", cùng hàng với Sổ tay/Khám phá/Lịch sử
                                          // — xem #favSuggestTab + submitWordSuggestionTab()
                                          // trong app.js.
// (v24) tối ưu cho từ điển quy mô lớn (chuẩn bị
                                          // thêm ~9000 từ) — (1) hydrateAllWordsFullData() (tải
                                          // "select=*" cho TOÀN BỘ từ điển mỗi phiên) đổi thành
                                          // hydratePriorityWordsData(): chỉ tải nền favorites +
                                          // lịch sử tra gần đây, các từ khác dựa vào
                                          // ensureWordFull() tải theo yêu cầu khi thực sự mở; (2)
                                          // segmentThai() (tách từ PopThai) không còn dựng lại Set
                                          // từ điển từ đầu mỗi lần dịch câu — cache 1 lần
                                          // (getSegmentDictSet()), chỉ dựng lại khi admin thêm/
                                          // sửa/xoá từ (invalidateSegmentDictCache(), gọi từ
                                          // modules/admin-core.js). Xem app.js + admin-core.js.
// (v23) cặp Thái-Việt trong popup Lịch Thái xuống dòng; nút đóng đổi thành X góc trên.
// (v22) gộp câu hỏi + câu trả lời vào chung 1 khung, mỗi câu 1 dòng, cuộn ngang nếu quá dài.
// (v21) popup Lịch Thái thêm mục "🎉 Lễ hội trong năm" (THAI_FESTIVALS, cố định quanh năm).
// (v20) popup món ăn bỏ "Độ cay", thêm "Cách gọi món" + "fact văn hoá" (admin nhập tay).
// (v19) popup món ăn có nút "ngẫu nhiên" đổi sang món khác.
// (v18) nhãn nút "Món ăn" hiện đúng tên món ăn hôm nay; giới hạn bề rộng 3 nhãn top-info.
// (v12) thêm ô đổi tiền 2 chiều (Baht ↔ VND) trong card "Tỷ giá" (modules/widgets.js +
// onCurrencyConvertInput + CSS .currency-converter-* trong style.css).
// (v11) nút "Tỷ giá" ở thanh top-info giờ hiển thị tỷ giá THB→VND thật (vd "1 ฿ ≈ 750 ₫") ngay
// lúc tải trang thay vì chỉ ghi chữ "Tỷ giá" tĩnh — xem loadTopBarCurrencyRate() trong app.js.
// (v10) sửa 3 lỗi mobile —
                                          // (1) Toast "Đã lưu vào..." LUÔN hiển thị dù không thao
                                          // tác gì: .toast/.folder-toast ẩn bằng
                                          // transform:translateY(80px) TÍNH TỪ giá trị "bottom"
                                          // gốc (24px) — khi tăng "bottom" mobile lên
                                          // var(--bottom-bar-h)+24px (~80px) để né thanh menu đáy
                                          // mới, quên tăng luôn translateY tương ứng, khiến 2 giá
                                          // trị triệt tiêu nhau (trạng thái ẨN lại nằm nguyên
                                          // trong khung nhìn) — đã sửa translateY tăng theo cùng
                                          // biến --bottom-bar-h.
                                          // (2) Icon "Thư viện" lệch hàng trong thanh menu đáy:
                                          // margin-top:18px viết INLINE trong HTML (chỉnh cho cột
                                          // dọc desktop) áp dụng luôn cả mobile — đã chuyển vào
                                          // CSS, chỉ bật ở desktop (≥641px).
                                          // (3) Bỏ nhãn chữ dưới icon ở thanh menu mobile, chỉ
                                          // còn icon (giống desktop) — giảm luôn --bottom-bar-h
                                          // 56px→48px cho gọn.
const SHELL_CACHE = CACHE_VERSION + '-shell';
const DATA_CACHE = CACHE_VERSION + '-data';

const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .catch(() => {}) // không chặn cài đặt nếu 1 vài asset lỗi lúc build
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Chỉ can thiệp vào GET; các request POST/PATCH/DELETE (lưu yêu thích, gửi góp ý...)
  // luôn đi thẳng ra mạng, không qua service worker, để không ảnh hưởng tới việc ghi dữ liệu.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Dữ liệu từ Supabase REST API (/rest/v1/*) — TOÀN BỘ bảng (words, word_suggestions,
  // quotes, site_settings, font_challenges...), không chỉ riêng bảng "words" như trước:
  // network-first, cache lại để dùng offline. Trước đây chỉ bắt đúng "/rest/v1/words" nên
  // mọi bảng khác rơi xuống nhánh cacheFirst() phía dưới (vốn chỉ nên dành cho font/CDN
  // tĩnh bên ngoài) — khiến dữ liệu đổi thường xuyên (vd danh sách "Đề xuất từ mới") bị
  // cache-first "kẹt" mãi ở lần tải đầu tiên, không bao giờ thấy dữ liệu mới dù server đã đổi.
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Trang & tài nguyên cùng gốc với site (index.html, about.html, manifest.json...): network-first
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Tài nguyên bên ngoài (Google Fonts, Tesseract.js CDN...): cache-first
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

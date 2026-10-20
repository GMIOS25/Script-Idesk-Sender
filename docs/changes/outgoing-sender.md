# Ban hành văn bản iDesk · AI Sender

## 1.3.0 — 2026-10-20

- Cảnh báo cần đối chiếu chỉ hiển thị để tham khảo, không yêu cầu ghi chú hoặc xác nhận từng cảnh báo trước khi điền/lưu kết quả. Cập nhật backend cùng userscript để áp dụng cả phía API.
- Mỗi mục cần quyết định có các checkbox cho phép chọn nhiều người/đơn vị, kể cả người nhận bổ sung từ danh bạ; hiển thị số lượng đã chọn và cho bỏ chọn từng người.
- Các vai trò người nhận có checkbox luôn hiển thị trên iDesk, nền và viền nổi bật khi được chọn. Có thể thao tác bằng bàn phím.

## 1.2.2 — 2026-10-17

- Xóa ô mã phòng khỏi giao diện tài liệu trước, trong và sau khi phân tích; giữ các thay đổi bố cục hiện tại.
- Thêm kiểm thử để ô mã phòng không xuất hiện lại khi chỉnh sửa giao diện.

## 1.2.1 — 2026-10-17

- Bỏ ô “Mã phòng đã xác minh”. Phân tích văn bản trả danh sách người và đơn vị nhận ở tất cả các phòng được nhắc tới, không cần nhập mã phòng.
- Mã phòng đã nhập trong phiên cũ không còn được gửi khi phân tích. Mục chưa xác định được định danh vẫn hiển thị để rà soát.
- Cập nhật backend `ai-document-sender` cùng userscript `dist/idesk_outgoing.user.js`, được tạo bởi `pnpm run build:outgoing`, rồi bấm “Phân tích lại” để lấy kết quả mới.

## 1.1.0 — 2026-10-10

- Nhấn giữ thanh tiêu đề rồi kéo để di chuyển cửa sổ trợ lý. Thả chuột để dừng.
- Giữ kích thước cửa sổ khi kéo và giữ cửa sổ trong màn hình khi kéo, đổi kích thước trình duyệt hoặc mở lại.
- Cập nhật Tampermonkey bằng `dist/idesk_outgoing.user.js`, được tạo bởi `pnpm run build:outgoing`.

Kiểm chứng: `pnpm test` và `node scripts/verify-outgoing-drag.mjs` (cần Playwright cùng Chromium; có thể chỉ định package/browser đã cài bằng `PLAYWRIGHT_MODULE_PATH` và `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). Kiểm thử trình duyệt chạy userscript đã build trên trang giả lập iDesk, không gọi backend hay gửi văn bản.

# Ban hành văn bản iDesk · AI Sender

Bản riêng cho **Văn bản đi → Ban hành văn bản**, kết nối FastAPI `ai-document-sender` bằng hợp đồng `outgoing.v1`.

Worktree: `C:\Workspaces\Script-Idesk\.worktrees\ban-hanh-van-ban`, nhánh `codex/outgoing-sender`. Source và lệnh build của bản Tiếp nhận văn bản vẫn giữ nguyên. Bản mới có tên, namespace, cấu hình và phạm vi trang riêng; có thể cài cùng userscript tiếp nhận.

## Cài đặt

1. Chạy backend bằng cấu hình hiện có:

   ```powershell
   Set-Location C:\Workspaces\ai-document-sender
   .\.venv\Scripts\python.exe -m ai_document_sender serve
   ```

   Địa chỉ trong `.env` hiện tại là `http://127.0.0.1:8000`. Nếu dùng cấu hình mặc định từ `.env.example`, backend dùng cổng `8001`; nhập đúng địa chỉ trong giao diện script. Không sao chép `.env` hay key OpenRouter sang userscript.

2. Build bản outgoing trong worktree:

   ```powershell
   Set-Location C:\Workspaces\Script-Idesk\.worktrees\ban-hanh-van-ban
   npm ci
   npm run build:outgoing
   ```

3. Trong Tampermonkey, tạo script mới, dán toàn bộ `dist\idesk_outgoing.user.js` và lưu. Giữ bản tiếp nhận đang dùng. Bản outgoing chạy trong iframe `*/smartcloud/idesk6/page/paperwork/ed/publish-doc.cpx`; không bật tùy chọn chặn script trong iframe.

4. Mở `https://vpdt.gialai.gov.vn/vpub/smartcloud/idesk6/page/paperwork/index.cpx#paperwork-menu-published`, bấm **AI · Ban hành văn bản**. Bấm biểu tượng **Cài đặt kết nối** cạnh nút **Đóng**, nhập địa chỉ máy chủ và `SENDER_API_KEY` nếu máy chủ yêu cầu, rồi bấm **Lưu và kiểm tra**. Cấu hình được lưu riêng trong storage Tampermonkey.

`GM_xmlhttpRequest` nối HTTPS iDesk với backend localhost, không cần sửa CORS của FastAPI. Metadata chỉ cho phép localhost/127.0.0.1; nếu dùng máy chủ khác, bổ sung `@connect` đúng hostname trước khi cài. Backend nhận PDF và metadata văn bản; không nhận tài khoản, mật khẩu hoặc cookie iDesk.

## Sử dụng

1. **Quét văn bản**: chọn dòng có icon `i.icon-share-sign.blue[title="Đã chuyển nội bộ"]` thực sự hiển thị, hoặc dòng có icon `i.icon-book[title="Đã vào sổ"]` hiển thị và có tài liệu chính khớp số văn bản. Với nhóm chỉ **Đã vào sổ**, script đọc chi tiết trước khi chọn, bỏ qua văn bản không có đính kèm, không có số/ký hiệu, hoặc không có tệp bắt đầu bằng số khớp (có thể có tiền tố `CV`/`Số`) và `contentUid` để tải. Số 0 đầu được chuẩn hóa (ví dụ `0339` khớp `339/QĐ-UBND`); loại tên bắt đầu bằng ngày tháng, tệp ghi rõ `phụ lục`/`PL` và số nằm giữa tên tệp. Trong các tệp khớp vẫn ưu tiên PDF đã ký, dấu đã đóng dấu/đã ký. Không dùng fallback tệp duy nhất hoặc dung lượng lớn nhất để chọn tệp khác số hay không có số. Icon trong template ẩn không được tính. Giới hạn áp dụng sau lọc; để trống để quét hết các trang của bộ lọc iDesk hiện tại. Điều kiện và chi tiết đính kèm được kiểm tra lại trước upload và trước điền.
2. Chọn văn bản, đối chiếu **Tài liệu chính**. Script ưu tiên PDF đã ký; các tệp khác được tải qua chức năng chuyển PDF native và kiểm tra header PDF. Văn bản không có tài liệu sẽ bị chặn. Không cần nhập mã phòng; người nhận được tra trên toàn danh bạ.
3. Bấm **Phân tích văn bản này** hoặc **Phân tích danh sách**. Job chạy tuần tự; **Dừng sau văn bản này** kết thúc sau job đang chạy. Lỗi từng văn bản được hiển thị và không chặn toàn bộ danh sách.
4. Rà soát bằng chứng, các mục chưa xác định và cảnh báo đọc thiếu ở vùng giữa. Panel bên phải chỉ giữ một hàng tra cứu và **Danh sách người nhận** trong vùng cuộn riêng; tiêu đề, mô tả lặp và hàng trạng thái kết nối đã được bỏ để dành diện tích cho danh sách. Nút **Đóng** nằm trên thanh công cụ; kéo vùng trống của thanh công cụ để di chuyển cửa sổ. Nút **Tra danh bạ** tại từng mục chưa xác định đưa tên sang ô tìm kiếm, giữ nguyên vị trí đang đọc. Chọn trường nội bộ tại từng người nhận: **Xử lý văn bản đi**, **Chuyển để biết**, **Phối hợp xử lý**, **Theo dõi**. Đơn vị trong/ngoài tỉnh được gắn đúng trường tương ứng; kết quả đã chọn hiển thị **Đã thêm**. Trên màn hình hẹp, dùng **Nội dung rà soát** / **Danh bạ & người nhận** để chuyển vùng. Tra cứu không tự chọn ứng viên đầu tiên.
5. Chọn **Tôi đã đối chiếu…** khi mọi mục đã được xử lý. **Điền vào iDesk** mở form và chọn chính xác ID native, kiểm tra lại chip. Mặc định giữ người nhận có sẵn. Tùy chọn **Thay thế…** chỉ xóa ở các trường được điền.
6. Sau khi điền thành công, trợ lý thu lại để kiểm tra form native. Người dùng bấm **Đồng ý** để gửi chính thức. Mở lại trợ lý để **Lưu kết quả rà soát** trên backend, độc lập với bước gửi iDesk.

Khi danh bạ/chính sách hoặc metadata/tài liệu thay đổi, phải phân tích lại. Kết quả `completed` có thể còn cần rà soát. Feedback chỉ ghi nhận lựa chọn, không tự cập nhật alias/model. Nếu request lưu feedback bị timeout, kiểm tra backend trước khi lưu lại vì feedback là append-only.

## Kiểm chứng và cấu trúc

```powershell
npm test
npm run build:outgoing
npm run verify:outgoing -- C:\Workspaces\ai-document-sender
```

Lệnh `verify:outgoing` dùng Python `.venv` của backend, tạo PDF tiếng Việt và DB nhỏ tạm, chạy FastAPI offline trên cổng `8052`, kiểm tra upload/poll/search/feedback/idempotency/version, rồi dừng server. Không dùng dữ liệu hoặc provider cloud của cấu hình vận hành.

Kiểm chứng ngày 10/10/2026: 85 tests JavaScript và 59 tests backend đạt; 8 nhóm kiểm tra HTTP tích hợp đạt. Browser native lọc được 5 văn bản đủ điều kiện, tải chi tiết/danh bạ và điền thử người `270`, phòng `269`, đơn vị `H21.24`; chip đúng ID. Trường Phối hợp xử lý được thử riêng. Các form thử đều được hủy; chưa gửi/ban hành văn bản thật và chưa đánh giá chất lượng model cloud trên văn bản thật.

- `src/outgoing/idesk.js`: thu dữ liệu native, lọc marker, danh bạ và tải PDF.
- `src/outgoing/provider.js`: API FastAPI, idempotency, polling và kiểm tra version.
- `src/outgoing/review.js`: quyết định rà soát và payload feedback.
- `src/outgoing/dashboard.js`, `view.js`, `styles.js`: giao diện trợ lý.
- `src/outgoing/form.js`: chuẩn bị người nhận trên form native; không submit.
- `resource\Văn bản đi\Ban hành văn bản`: fixtures đối chiếu API/DOM outgoing.

Build outgoing không đọc `.env` của release tiếp nhận và không nhúng thông tin đăng nhập. `dist/` là output tự sinh, không commit. Hai test tiếp nhận được cập nhật đường dẫn fixture sau lần dọn resource trước đó; record Hỏa tốc cũ được giữ tối thiểu trong `tests/fixtures/receiving-urgent.json` để tiếp tục kiểm tra priority=3.

# Ban hành văn bản iDesk · AI Sender

Userscript chuyên biệt cho tác vụ **Văn bản đi → Ban hành văn bản** trên hệ thống iDesk, kết nối FastAPI `ai-document-sender` thông qua hợp đồng API `outgoing.v1`.

Kho mã nguồn này hoạt động hoàn toàn độc lập, chỉ phục vụ luồng nghiệp vụ Ban hành văn bản.

> 📖 **Xem sổ tay hướng dẫn toàn diện từ A-Z**: [GUIDE.md](../ai-document-sender/GUIDE.md)

## Cài đặt và Chạy

### 1. Khởi động Backend (`ai-document-sender`)

```powershell
Set-Location C:\Workspaces\ai-document-sender
.\.venv\Scripts\python.exe -m ai_document_sender serve
```

Backend chạy mặc định tại `http://127.0.0.1:8000` (hoặc cổng được cấu hình trong `.env`).

### 2. Build Userscript

```powershell
npm install
npm run build
```

Lệnh build sẽ sinh ra tệp `dist/idesk_outgoing.user.js`.

### 3. Cài đặt vào Trình duyệt (Tampermonkey)

1. Cài đặt extension **Tampermonkey** trên trình duyệt.
2. Tạo script mới, dán toàn bộ nội dung tệp `dist/idesk_outgoing.user.js` và lưu.
3. Userscript sẽ kích hoạt khi truy cập phạm vi văn bản đi: `*/smartcloud/idesk6/page/paperwork/ed/publish-doc.cpx` hoặc trang quản lý văn bản đi.

### 4. Cấu hình kết nối

1. Mở trang quản lý văn bản iDesk, bấm nút **AI · Ban hành văn bản**.
2. Bấm biểu tượng **Cài đặt kết nối**, nhập địa chỉ backend (ví dụ: `http://127.0.0.1:8000`) và API Key (nếu có), sau đó bấm **Lưu và kiểm tra**.

## Luồng Nghiệp vụ

1. **Quét văn bản**: Tìm các văn bản có icon "Đã chuyển nội bộ" hoặc "Đã vào sổ" kèm file đính kèm chính hợp lệ khớp số ký hiệu văn bản.
2. **Đối chiếu file đính kèm chính**: Ưu tiên tệp PDF đã ký số, đã đóng dấu.
3. **Phân tích với AI**: Gửi PDF và metadata sang backend để bóc tách nơi nhận, giải quyết danh bạ và đưa ra gợi ý người nhận.
4. **Rà soát & Điều chỉnh**: Kiểm tra người nhận nội bộ, đơn vị trong tỉnh, đơn vị ngoài tỉnh, gán vai trò (Xử lý văn bản đi, Chuyển để biết, Phối hợp xử lý, Theo dõi).
5. **Điền vào form iDesk**: Tự động điền danh sách người nhận vào đúng các trường native của form ban hành iDesk.

### Danh bạ đơn vị bổ sung (userscript 1.4.0)

Lần đầu mỗi ngày, script hợp nhất lịch sử gửi với danh bạ **Đơn vị theo cấp / Đơn vị theo loại**, đọc ID nhóm và cấu hình trung tâm từ phiên iDesk hiện tại. Đồng bộ có giới hạn 64 nhóm, tối đa 4 truy vấn nhóm đồng thời; nhóm lỗi hoặc kết quả bị giới hạn được báo để tra bổ sung. Danh mục nhóm không chứng minh đã bao phủ toàn bộ đơn vị con hoặc đơn vị chưa phân loại.

Khi phân tích còn đơn vị chưa tìm thấy, script tra trực tiếp iDesk (tối đa 10 tên mỗi văn bản), gửi các định danh tìm được về backend và đối chiếu lại trên phần trích xuất đã lưu. Không gửi lại PDF và không OCR lại. Tra cứu thủ công cũng tự tra iDesk khi danh bạ cục bộ rỗng; dùng **Tìm đơn vị trực tiếp trên iDesk** khi cần tìm ngoài các ứng viên đã có. Kết quả là ứng viên, cần chọn đúng định danh.

Nút **Đối chiếu lại danh bạ** tạo snapshot mới. Các quyết định, trường người nhận và xác nhận rà soát được đặt lại để kiểm tra kết quả mới. Nếu phiên iDesk hết hạn hoặc backend lỗi, giao diện báo tra cứu chưa thành công, không coi đó là đơn vị không tồn tại. Cookie iDesk chỉ nằm trong trình duyệt.

Cập nhật userscript và khởi động lại backend cùng phiên bản. Job được tạo trước khi backend ghi nhận tenant vẫn đọc được để đối chiếu; cần phân tích/upload lại một lần nếu muốn lưu rà soát hoặc tạo resolution mới cho các job cũ này.

## Kiểm thử & Xác thực

```powershell
# Chạy bộ unit tests
npm test

# Build userscript
npm run build

# Chạy kiểm thử tích hợp backend end-to-end
npm run verify:outgoing -- C:\Workspaces\ai-document-sender
```

## Cấu trúc Mã nguồn

- `src/outgoing/idesk.js`: Thu thập dữ liệu native, lọc marker văn bản, tải danh bạ và tải file PDF đính kèm.
- `src/outgoing/attachment.js`: Nhận diện, lọc và chọn file đính kèm chính (PDF đã ký, đóng dấu, khớp số hiệu).
- `src/outgoing/provider.js`: Giao tiếp API FastAPI `outgoing.v1`, cơ chế polling và bảo đảm tính bất biến (idempotency).
- `src/outgoing/review.js`: Xử lý logic rà soát, gán trường người nhận và xây dựng feedback payload.
- `src/outgoing/dashboard.js`, `view.js`, `styles.js`: Giao diện trợ lý ban hành văn bản.
- `src/outgoing/form.js`: Điền tự động người nhận vào form native iDesk.
- `src/outgoing/drag.js`: Hỗ trợ kéo thả giao diện trợ lý.
- `resource/Văn bản đi/Ban hành văn bản`: Fixtures phục vụ kiểm thử DOM và API.

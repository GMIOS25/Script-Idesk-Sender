# Giao diện Script-Idesk và form chuyển xử lý

Đặc tả này phản ánh đúng `src/ui/dashboard.js`, `src/ui/unitPicker.js`,
`src/ui/deadlineEditor.js`, `src/automation/formFiller.js` và selectors trong
`src/config.js`. Ảnh/chụp HTML trong `resource` chỉ là fixture giao diện iDesk,
không phải mã UI của userscript.

## 1. Vị trí và khởi tạo

Userscript chạy trên các URL `smartcloud` được khai báo trong `src/meta.js`.
Khi `#process-list-widget` xuất hiện, script thêm một hub cố định
`#idesk-rpa-hub` vào cuối `document.body`. Hub nằm góc dưới bên phải, có thể
kéo bằng header và thu nhỏ thành thanh 340 × 42 px.

Không có bước nhận/sổ văn bản đến trong automation cho role Chủ tịch/Lãnh đạo
xử lý chính; văn thư đã vào sổ trước đó. Script thao tác trên danh sách văn bản
đang xử lý và form `Chuyển xử lý`, không bấm `Lưu và chuyển`.

## 2. Cấu trúc hub

```text
Header: tên tool + số lượng văn bản | Console | Thu nhỏ/Phóng to
Body:
  Toolbar: Bắt đầu | Duyệt
  Card feed: từng văn bản, cuộn dọc
  Console: log, mở/đóng theo nút header
Footer: trạng thái | progress current/total
```

`Bắt đầu` quét các item iDesk đang hiển thị và gửi các văn bản `idle`/`ai_error`
đến AI. `Duyệt` dùng kết quả đã rà soát để điền form và chuyển từng văn bản được
chọn. Hai batch không chạy đồng thời.

## 3. Card văn bản

Card có checkbox, badge trạng thái và các metadata có sẵn:

- số hiệu, loại, độ khẩn gốc iDesk, cơ quan ban hành, người ký, sổ, ngày;
- trích yếu;
- `summary` (nhãn “TÓM TẮT AI”), `reason` (lý do định tuyến) và `notes`
  (nhãn “Cần kiểm tra”);
- đơn vị xử lý chính, phối hợp, lãnh đạo theo dõi, hạn thực hiện.

Độ khẩn gốc được đọc từ `ed.priority`/`edSearchDto.priority`, chỉ hiển thị khi
đã có dữ liệu. Các mức 0–4 lần lượt là `Bình thường`, `Khẩn`, `Thượng khẩn`,
`Hỏa tốc`, `Hỏa tốc hẹn giờ`; mức 3/4 có badge cảnh báo mạnh.

| Trạng thái code | Badge card |
| --- | --- |
| `idle` | Chưa gửi |
| `pending` | Đang gửi |
| `ai_done` | Đã phân tích |
| `ai_error` | Lỗi AI |
| `fill_done` | Đã điền |
| `fill_error` | Lỗi điền |

Checkbox được lưu trong `doc.selected` và giữ nguyên khi card render lại. Khi
chưa từng đổi checkbox, mọi văn bản trừ `fill_done` mặc định được chọn; thiếu
`aiData` sẽ gây lỗi cho văn bản đó nếu bấm `Duyệt`.

## 4. Chỉnh dữ liệu trên card

- Main và monitoring chỉ cho một giá trị: chip hiện tại có nút `×`; nếu trống
  thì có `+ Thêm`.
- Coordinating cho nhiều giá trị: mỗi chip có `×` và luôn có `+ Thêm`.
- Picker `+ Thêm` dựa vào `unitCache` lấy từ `fbyvsphere.cpx`, dựng cây
  `parent` → con. Có tìm kiếm theo tên/người, mở/thu gọn nhánh và chọn một node.
- Với giá trị AI thô, nếu cây iDesk có một ứng viên khớp gần đúng và khác tên
  hiện tại, nút `Gợi ý: ...` xuất hiện bên cạnh chip. Bấm mới áp dụng; không tự
  thay dữ liệu. Gợi ý coordinating thay đúng chuỗi thô đang hiển thị, không để
  hai phiên bản cùng tồn tại.
- Hạn thực hiện mở popover chỉnh số ngày. Input chỉ nhận chữ số, có nút `−/+`,
  giới hạn 1–100 và mặc định 5 khi không suy được số ngày hiện tại. Nút `Bỏ hạn`
  đặt giá trị về `null` và để trống hai trường hạn khi chuyển văn bản.

Mỗi chỉnh sửa cập nhật `aiData` trong RAM và render lại card. Với DocFlow có
`stt`, script PATCH best-effort; với router local, script đánh dấu `_router.edited`
để feedback sau chuyển mang quyết định `edited`.

## 5. Form iDesk mà `Duyệt` thao tác

| Trường/nút | Selector | Hành vi |
| --- | --- | --- |
| Item văn bản | `.messageListItem[data-id="..."]` | Bấm để mở chi tiết nếu chưa chọn. |
| Chuyển xử lý | `#ed-view-btn-transfer` | Bấm để mở form. |
| Form | `#ed-transfer-document-container` | Chờ render; có fallback tìm nút `Đồng ý`. |
| Xử lý chính | `#ed-transfer-select-user-responsible` | Chọn một node cây; thất bại thì dừng. |
| Phối hợp | `#ed-transfer-select-user-participants` | Chọn tuần tự từng node; thất bại thì dừng. |
| Thêm người theo dõi | `#ed-transfer-add-follow-btn` | Chỉ bấm nếu AI có monitoring và field đang ẩn. |
| Người theo dõi | `#ed-transfer-select-user-follow` | Chọn một node nếu có giá trị. |
| Số ngày hạn | `#ed-transfer-txt-deadline-number` | Điền khi deadline có số ngày. |
| Ngày hạn | `#ed-transfer-txt-deadline` | Điền ngày `DD/MM/YYYY` khi parse được. |
| Độ khẩn | `#ed-transfer-select-priority` | Dùng `aiData.priority`, mặc định `0`. |
| Nội dung | `#ed-transfer-txt-content` | Điền `aiData.summary` hoặc chuỗi rỗng. Không điền `notes`. |
| Đồng ý | `#ed-transfer-btn-transfer` | Bấm để chuyển xử lý. |

Script không tự điền các checkbox `Tiếp tục xử lý`, `Gửi thông báo`, `Có tài
liệu giấy`, không thao tác `Sổ văn bản đến`, và không bấm nút `Bỏ qua`.

## 6. Luồng người dùng

```text
Mở trang iDesk có danh sách xử lý
  → hub xuất hiện
  → nhập số văn bản tối đa (không bắt buộc; để trống = quét tất cả)
  → Bắt đầu
  → xem metadata, tóm tắt, lý do, cảnh báo và trạng thái
  → sửa main/phối hợp/theo dõi/hạn nếu cần
  → bỏ chọn văn bản chưa muốn chuyển
  → Duyệt
  → script mở form, điền, bấm Đồng ý từng văn bản
  → feedback router (nếu dùng provider local)
```

`Duyệt` chỉ chặn khi không có đơn vị xử lý chính. Các cảnh báo khác chưa tự
động khóa nút; người dùng phải đọc và quyết định trước khi bấm.

## 7. Điều cần kiểm tra khi iDesk thay UI

Selectors trong `src/config.js` và cấu trúc popup `a.user-box-group-item` là
điểm phụ thuộc DOM. Nếu hệ thống iDesk đổi HTML, cập nhật selectors và test
chọn cây. Script không có `MutationObserver`; nó chờ vài lần sau thao tác và
bắt dữ liệu động từ XHR/fetch.

# Đề xuất chuẩn hóa định dạng chuỗi trong `processing_unit`, `coordinating_units` và `monitoring_leader`

**Trạng thái:** Đã cập nhật frontend theo backend nhiều đơn vị xử lý chính
**Liên quan:** `docs/en/docflow.md` mục 4, 5, 6 — `POST /documents/process`, `POST /documents/lookup`, `PATCH /documents/{stt}`
**Kiểu dữ liệu:** `processing_unit: List<string>`, `coordinating_units: List<string>`, `monitoring_leader: string|null`

## 1. Vấn đề hiện tại

`docflow.md` hiện chỉ mô tả kiểu dữ liệu chung chung, kèm placeholder mơ hồ như `"Phòng Tổng hợp"`, `"Đơn vị B"`, `"Đơn vị C"` — không quy định nội dung chuỗi phải theo định dạng nào khi đơn vị/người xử lý là một **alias** (chức danh gắn với một người cụ thể) trong cây tổ chức của iDesk.

Đây không chỉ là vấn đề thẩm mỹ. Userscript tự động điền form bằng cách mở popup cây tổ chức rồi so khớp chính xác `textContent` của từng node với chuỗi AI trả về (xem `selectTreeItem` trong `src/automation/treeSelect.js`). Trên giao diện thật của iDesk, mỗi node loại "alias" (ví dụ "Văn thư", "Chuyên viên", "Phó Chủ tịch UBND"...) luôn hiển thị dạng **"Chức danh (Họ tên người giữ chức)"**, vì rất nhiều chức danh trùng tên nhau nhưng khác người đảm nhiệm.

Nếu backend chỉ trả `name` (ví dụ chỉ `"Văn thư"`) mà thiếu phần `(refFullname)`:

- Hệ thống có nhiều "Văn thư" khác nhau (Văn thư Công an xã, Văn thư phòng Kinh tế, Văn thư Trung tâm HCC...) → automation không biết chính xác node nào cần chọn.
- `selectTreeItem` sẽ chọn nhầm node đầu tiên khớp `includes()`, hoặc không chọn được node nào nếu không có exact match.

## 2. Hướng giải quyết

Backend áp dụng đúng quy tắc hiển thị mà iDesk đang dùng trên cây tổ chức thật khi sinh chuỗi cho `processing_unit`, `monitoring_leader` và từng phần tử trong `coordinating_units`:

| `type` trong cây tổ chức                   | Định dạng chuỗi trả về            | Ví dụ                                                                  |
| ------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| `dept` (phòng/ban)                         | `name`                            | `"Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai"`                       |
| `unit` (đơn vị cấp trên/cây gốc)           | `name`                            | `"UBND Xã Vĩnh Thạnh - Tỉnh Gia Lai"`                                  |
| `alias` (chức danh gắn với 1 người cụ thể) | `name + " (" + refFullname + ")"` | `"Văn thư (Văn thư phòng Kinh tế)"`, `"Chủ tịch UBND (Lê Minh Thông)"` |

Áp dụng cho cả ba trường:

- `processing_unit`: mỗi phần tử trong danh sách áp dụng đúng quy tắc trên; danh sách phải có ít nhất một phần tử trước khi chuyển.
- `monitoring_leader`: một chuỗi duy nhất (hoặc null), theo đúng bảng trên tùy loại đối tượng được chọn làm lãnh đạo theo dõi.
- `coordinating_units`: mỗi phần tử trong list áp dụng đúng quy tắc trên (list có thể trộn lẫn cả `dept`/`unit`/`alias`, không cần cùng loại).

## 3. Ví dụ before/after

**Before** (hiện tại theo `docflow.md`):

```json
{
  "processing_unit": ["Phòng Tổng hợp"],
  "coordinating_units": ["Đơn vị B", "Đơn vị C"],
  "monitoring_leader": "Chủ tịch UBND"
}
```

**After** (đề xuất — dựng từ dữ liệu thật trong `clean_data/Data_Samples.db`):

```json
{
  "processing_unit": [
    "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai",
    "Phòng Tài nguyên và Môi trường"
  ],
  "coordinating_units": [
    "Phòng Văn hóa - Xã hội",
    "Văn thư (Văn thư phòng Kinh tế)"
  ],
  "monitoring_leader": "Chủ tịch UBND (Lê Minh Thông)"
}
```

`"Phòng Kinh tế..."` và `"Phòng Văn hóa..."` là type `dept` → giữ nguyên `name`. `"Văn thư (Văn thư phòng Kinh tế)"` và `"Chủ tịch UBND (Lê Minh Thông)"` là type `alias` → bắt buộc kèm `refFullname` để phân biệt với các chức danh trùng tên khác trong hệ thống.

## 4. Tài liệu tham khảo / mock đã hiện thực sẵn

Quy tắc này đã được hiện thực đầy đủ trong `src/back_end_mockup/mock_backend.py` (hàm `_org_tag_label()` và bộ dữ liệu mẫu `ORG_SAMPLE_ELEMENTS`) — backend dev dùng trực tiếp file này làm tham chiếu khi implement, không cần đoán định dạng.

Nguồn dữ liệu gốc (tên/refFullname/type thật của từng phòng ban, đơn vị, chức danh) nằm trong `clean_data/Data_Samples.db`, 3 bảng `ward`, `organizational`, `person` — cột `type` phân biệt `dept`/`unit`/`alias`, cột `refFullname` chỉ tồn tại ở bảng `person` (ứng với các node `alias`).

## 5. Việc mỗi bên cần làm

**Backend:**

- Khi sinh giá trị cho `processing_unit`/`coordinating_units`/`monitoring_leader`, tra `type` của đối tượng được chọn và áp đúng quy tắc format ở mục 2.
- Cập nhật lại các ví dụ trong `docs/en/docflow.md` mục 4, 5, 6 để không còn placeholder mơ hồ (`"Phòng Tổng hợp"`, `"Đơn vị B"`...) khiến hiểu nhầm đây là chuỗi tự do, không theo cấu trúc cây tổ chức.
- Trả `processing_unit` dưới dạng danh sách và chuẩn hóa nội dung từng chuỗi.

**Frontend/automation:**

- `formFiller` gọi `selectTreeItem` lần lượt cho từng phần tử `processing_unit`.

## 6. Lưu ý về ràng buộc hiện có

Mỗi phần tử vẫn là một string đơn, `processing_unit` và `coordinating_units` đều được PATCH dưới dạng danh sách. Không phát sinh field mới.

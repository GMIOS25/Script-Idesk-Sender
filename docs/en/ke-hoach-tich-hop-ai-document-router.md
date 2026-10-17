# Trạng thái tích hợp Script-Idesk với `ai-document-router`

Cập nhật theo code ngày 2026-09-15. Tệp này giữ tên cũ để không làm hỏng liên
kết, nhưng nội dung là trạng thái đã triển khai, không còn là kế hoạch dựng
compatibility API.

## 1. Kiến trúc đang chạy

```text
iDesk trong trình duyệt
  └─ Script-Idesk userscript
       ├─ đọc danh sách/chi tiết/cây đơn vị từ API và DOM iDesk
       ├─ tải PDF bằng session iDesk
       ├─ POST /v1/jobs tới ai-document-router local
       ├─ poll GET /v1/jobs/{job_id}
       ├─ review và chỉnh tay trên dashboard
       ├─ tự điền + bấm Đồng ý trên iDesk
       └─ POST /v1/jobs/{job_id}/feedback
```

Không có service trung gian và không dùng compatibility API `/api/v1` trong
luồng mặc định. `src/services/ai.js` là facade; adapter chính nằm tại
`src/services/providers/localRouterProvider.js`.

## 2. Phần đã triển khai

- Chọn và tải file đính kèm từ iDesk; ưu tiên PDF đã ký/bản đóng dấu.
- SHA-256 phía trình duyệt và idempotency key ổn định theo văn bản, ngày nhận,
  nội dung file.
- Tạo job multipart, poll trạng thái, retry lỗi mạng/429/503.
- Kiểm tra `document_id` của kết quả để tránh gắn nhầm văn bản.
- Chuyển recipients/deadline/độ khẩn/audit về shape UI hiện có.
- Hiển thị lý do định tuyến và các `review_reasons` đã biết bằng tiếng Việt.
- Nạp cây đơn vị iDesk, gợi ý khớp tên và cho sửa đơn vị/lãnh đạo/hạn trước khi
  chuyển.
- Bắt buộc có ít nhất một giá trị trong `processing_unit` cuối cùng.
- Gửi feedback `accepted` hoặc `edited`, có idempotency key riêng.
- Giữ DocFlow Bearer + presign + process/lookup/PATCH làm nhánh fallback.

## 3. Mapping hiện tại

Có hai phép ánh xạ độc lập:

1. **Router name → iDesk label khi review/điền:** dùng cây thực tế từ
   `fbyvsphere.cpx`; ưu tiên `startsWith`, fallback `includes`, rồi chọn nhãn
   ngắn nhất. Người dùng phải tự áp dụng gợi ý hoặc chọn tay.
2. **iDesk label → router ID khi feedback:** tải `GET /v1/directory`, ưu tiên ID
   chính xác, tên chính xác, rồi một kết quả chứa duy nhất.

`docs/idesk-router-map.json` không được import trong bundle. Đây chỉ là snapshot
đối chiếu thủ công; thay đổi file này không đổi hành vi runtime.

## 4. Các giới hạn còn tồn tại

| Hạng mục | Hành vi code hiện tại |
| --- | --- |
| Review gating | Chỉ thiếu `processing_unit` mới chặn. `needs_review`, `requires_confirmation`, `degraded` và cảnh báo khác chỉ được hiển thị. |
| Ánh xạ | Dùng tên, chưa dùng `external_id` ổn định giữa router và iDesk. Tên trùng/mơ hồ có thể làm fill hoặc feedback lỗi. |
| Feedback | Gửi sau khi iDesk hoàn tất. Lỗi feedback chỉ ghi log và chưa có nút retry riêng. |
| Deadline | Câu `N ngày` được cộng theo ngày lịch, chưa tính ngày làm việc/ngày nghỉ. |
| Hỏa tốc | Router `hoa_toc` được điền thành option iDesk `2` (`Thượng khẩn`) và kèm cảnh báo. |
| Độ khẩn gốc iDesk | Card hiển thị `doc.priority` nhưng form dùng `aiData.priority` (mặc định `0` nếu AI không cung cấp); code chưa bảo toàn mức gốc khi chuyển. |
| Nội dung xử lý | Form điền `summary` hoặc chuỗi rỗng; nếu AI không có summary, nội dung đang có trên form có thể bị ghi rỗng. |
| Attachment | Khi không còn PDF, logic có thể chọn file đã ký hoặc file bất kỳ nhưng vẫn gọi `download.cpx?view=pdf`; chưa kiểm tra magic bytes PDF trước khi gửi router. |
| Secret | API key được nhúng vào bundle build; không thể coi là secret phía client. |
| Host | `@connect` chỉ cho production DocFlow đã khai báo và localhost/127.0.0.1. |
| State | Cache/token chỉ ở RAM; reload tab mất trạng thái frontend. |
| Test | Test tự động hiện chỉ phủ priority và chọn node cây; chưa có test adapter/router, deadline, attachment, controller hay fill end-to-end. |
| Extension | `package.json` có `build:extension`, nhưng thư mục `extension` không tồn tại. |

## 5. Nhánh DocFlow dự phòng

Khi `AI_PROVIDER` khác `local-router`, code thực hiện:

```text
POST /auth/token
POST /documents/lookup
  └─ nếu chưa có kết quả:
       GET PDF từ iDesk
       POST /files/presign
       PUT upload_url
       POST /documents/process
PATCH /documents/{stt} khi người dùng sửa review
```

Nhánh này không gửi feedback router. Sửa tay được PATCH best-effort; thất bại
không hoàn tác dữ liệu đang hiển thị trong phiên.

## 6. Việc nên làm trước khi mở rộng production

1. Chốt mapping ID bền vững giữa directory router và node iDesk để bỏ phụ thuộc
   vào fuzzy name ở đường nghiệp vụ quan trọng.
2. Quyết định có chặn `Duyệt` khi `needs_review`, `requires_confirmation` hoặc
   `degraded` hay không, rồi viết test cho đúng quyết định.
3. Thêm retry feedback độc lập, không chạy lại giao dịch chuyển văn bản iDesk.
4. Viết test cho attachment selection, mapping kết quả router, deadline và
   payload feedback trước khi thay đổi contract.
5. Nếu chạy router trên host khác, cập nhật `@connect` và dùng key riêng từng
   máy/người dùng với ACL mạng phù hợp.

Chi tiết cấu hình và endpoint xem `../local-router-integration.md` và
`api_host.md`; shape runtime xem `METADATA_SCHEMA.md`.

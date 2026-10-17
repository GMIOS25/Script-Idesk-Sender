# Luồng xử lý văn bản của Script-Idesk 3.0

Tài liệu này mô tả luồng end-to-end đang được triển khai trong `src`. Luồng
router local là mặc định; luồng DocFlow cũ chỉ là fallback.

## 1. Khởi tạo userscript

1. `src/index.js` cài interceptor cho cả `XMLHttpRequest` và `fetch`.
2. Script chờ `#process-list-widget` xuất hiện, kiểm tra lại mỗi 400 ms.
3. Khi widget tồn tại, dashboard được gắn vào `document.body` một lần.
4. Dashboard giao tiếp với logic qua event bus, không import controller trực
   tiếp.

Script không dùng `MutationObserver`. Nội dung iDesk tải động được xử lý bằng
interceptor response và các vòng chờ ngắn trước thao tác DOM.

## 2. Dữ liệu lấy từ iDesk

| Nguồn | Dữ liệu được giữ |
| --- | --- |
| `qsprocess.cpx` | ID, số hiệu, trích yếu, loại, cơ quan ban hành, người ký, ngày, độ khẩn, trách nhiệm, sổ. |
| `view.cpx` | Bổ sung/ghi đè metadata trên và danh sách attachment; URL cũng cung cấp `exeacode`. |
| `fbyvsphere.cpx` | Cây đơn vị/người dùng cho picker, gợi ý và chọn form. |
| DOM danh sách | Fallback để lấy ID, `.sender` và `.subject` của item đang hiển thị. |

`ensureBasePath()` suy ra prefix `/{tenant}/smartcloud` từ URL request iDesk.
Nếu chưa bắt được, fallback lấy segment đầu của `window.location.pathname`.

## 3. Nút `Bắt đầu`: quét và phân tích

```text
Bắt đầu
  → quét item iDesk đang hiển thị
  → lấy các văn bản idle hoặc ai_error
  → với từng văn bản, chạy tuần tự:
       lấy chi tiết/attachment
       mồi cây đơn vị một lần mỗi phiên
       gọi provider AI
       ai_done hoặc ai_error
  → cập nhật card và progress
```

- Nếu chưa thấy item, scanner thử lại tối đa 4 lần, mỗi lần 800 ms.
- `docCache` không bị xóa giữa các lần bấm; văn bản đã quét ở các trang trước
  vẫn còn trong RAM.
- Batch AI chạy tuần tự và chờ 2,2 giây giữa hai văn bản.
- Chỉ `idle` và `ai_error` được gửi lại. `ai_done`, `fill_done` và `fill_error`
  không được nút này xử lý lại.
- `state.isProcessing` được nhả trong `finally`, kể cả khi có lỗi bất ngờ.

## 4. Lấy chi tiết và chọn attachment

Nếu attachment còn rỗng, script bấm item tương ứng và chờ response `view.cpx`.
Nếu vẫn rỗng nhưng đã biết `exeacode`, script gọi trực tiếp:

```http
GET {basePath}/document/edocs/view.cpx
    ?exeacode={exeacode}
    &id={document_id}
    &responsibility={responsibility|main}
```

Không có attachment sau các bước này thì văn bản thành `ai_error`.

Thứ tự chọn file:

1. Tạo nhóm ứng viên đầu tiên không rỗng theo thứ tự: PDF + `signed=Y`, mọi
   file `signed=Y`, mọi PDF, mọi file.
2. Trong nhóm, ưu tiên tên chứa `dadongdau` hoặc `daky` sau khi bỏ dấu, khoảng
   trắng, gạch ngang và gạch dưới.
3. Nếu chưa có, khớp số hiệu văn bản trong tên file.
4. Cuối cùng chọn file lớn nhất.

File được tải qua:

```http
GET {origin}{basePath}/docx/download.cpx
    ?docID={contentUid}&view=pdf&t={timestamp}
```

Request dùng `GM_xmlhttpRequest`, `responseType=blob`, timeout 60 giây và tạo
`File` có MIME mặc định `application/pdf`.

## 5. Provider mặc định: router local

### 5.1 Tạo job

Script tính SHA-256 của file rồi gọi:

```http
POST {ROUTER_BASE_URL}/v1/jobs
X-API-Key: {ROUTER_API_KEY}
Idempotency-Key: idesk-{document_id}-{received_on}-{sha256_prefix}
Content-Type: multipart/form-data
```

Form có:

- `document_id`: ID iDesk;
- `received_on`: ngày ISO đã có trên document hoặc ngày hiện tại theo UTC+7;
- `file`: file vừa tải.

HTTP 200/202 đều hợp lệ. Response phải có `job_id`.

### 5.2 Chờ kết quả

Script poll:

```http
GET {ROUTER_BASE_URL}/v1/jobs/{job_id}
X-API-Key: {ROUTER_API_KEY}
```

| `status` | Hành vi |
| --- | --- |
| `completed` | Bắt buộc có `result`; chuyển sang dữ liệu UI. |
| `failed` | Ném lỗi với `job.error`. |
| Giá trị khác | Chờ `ROUTER_POLL_INTERVAL_MS` rồi poll lại. |

Quá `ROUTER_TIMEOUT_MS` thì dừng. Mỗi request router cũng dùng chính timeout
này.

### 5.3 Chuẩn hóa kết quả

Recipient được đọc từ:

- `recipients.don_vi_xu_ly_chinh`;
- `recipients.phoi_hop_xu_ly`;
- `recipients.lanh_dao_theo_doi`.

`processing_unit` giữ toàn bộ tên main hợp lệ dưới dạng mảng. Monitoring chỉ nhận
khi đúng một phần tử. Coordinating cũng giữ toàn bộ tên hợp lệ.

Adapter tạo cảnh báo khi:

- router trả các mã `review_reasons` đã biết;
- main không có giá trị;
- monitoring có nhiều hơn một giá trị;
- `do_khan=hoa_toc`;
- router chạy `degraded`.

`priority` dùng khi điền form được ánh xạ:

| `do_khan` | Option iDesk |
| --- | --- |
| `thuong` | `0` |
| `khan` | `1` |
| `thuong_khan` | `2` |
| `hoa_toc` | `2` và cảnh báo |

Kết quả bị từ chối nếu `result.document_id` khác ID văn bản đang xử lý.

## 6. Provider fallback: DocFlow

Đặt `AI_PROVIDER` thành giá trị khác `local-router` để dùng nhánh này.

```text
POST /auth/token
POST /documents/lookup
  ├─ completed → dùng data đã có
  └─ còn lại/lỗi lookup
       → tải PDF từ iDesk
       → POST /files/presign
       → PUT upload_url bằng bytes file
       → POST /documents/process
```

Sáu metadata gửi đi là `document_number`, `document_type`, `issuing_agency`,
`document_date`, `signer`, `subject`. Lookup nhận object phẳng; process nhận
`{metadata, file_url}`.

Token được cache trong RAM và không được làm mới tự động khi server trả 401.
Presign, upload và process retry tối đa 3 lần chỉ với HTTP 429/503 hoặc lỗi mạng,
backoff 1 giây rồi 2 giây. Lookup/PATCH không có retry.

Chi tiết endpoint ở `api_host.md`.

## 7. Review trên dashboard

Mỗi card hiển thị:

- checkbox, số hiệu, loại, độ khẩn gốc iDesk, cơ quan, người ký, sổ, ngày;
- trạng thái, trích yếu, tóm tắt AI, lý do định tuyến, cảnh báo;
- xử lý chính, phối hợp, lãnh đạo theo dõi, hạn thực hiện.

Người dùng có thể:

- xóa/thêm nhiều main hoặc coordinating;
- xóa/thêm một monitoring;
- áp dụng gợi ý tên đầy đủ từ cây iDesk;
- sửa hạn thành 1–100 ngày.

Với router local, mọi sửa đổi chỉ đặt `_router.edited=true` để đưa vào feedback.
Với DocFlow, nếu `aiData.stt` tồn tại, script PATCH thay đổi best-effort. Lỗi
PATCH chỉ ghi log, không hoàn tác thay đổi trong RAM.

Picker đơn vị chỉ hoạt động khi `unitCache` đã có dữ liệu. Cây được xây theo
`parent`, sắp xếp theo `order` rồi tên, hỗ trợ tìm kiếm, thu gọn/mở rộng và
đóng bằng click ngoài hoặc phím Escape.

## 8. Nút `Duyệt`: tự điền và chuyển

Mặc định mọi văn bản chưa `fill_done` được chọn, trừ khi người dùng đã đổi
checkbox. Batch xử lý tuần tự:

1. Yêu cầu document có `aiData` và `processing_unit` chứa ít nhất một phần tử.
2. Bấm item trong danh sách nếu chưa được chọn.
3. Tìm và bấm `#ed-view-btn-transfer` (`Chuyển xử lý`).
4. Chờ `#ed-transfer-document-container`.
5. Chọn từng main, từng coordinating, rồi monitoring nếu có.
6. Điền số ngày/ngày hạn khi parse được.
7. Chọn độ khẩn.
8. Điền `summary` vào `#ed-transfer-txt-content`; `notes` không được điền.
9. Bấm `#ed-transfer-btn-transfer` (`Đồng ý`).
10. Với router local, gửi feedback.

Nếu feedback lỗi sau bước 9, document vẫn là `fill_done`; lỗi chỉ được ghi ở
console. Nếu lỗi trước khi hoàn thành form, document là `fill_error`.

## 9. Chọn node trên form iDesk

Sau khi mở selector, script:

1. Tìm popup đang hiển thị trong wrapper hiện tại, fallback sang document.
2. Bấm nút mở rộng tất cả nếu có.
3. Điền ô tìm kiếm và phát `input`/`keyup`.
4. Chỉ xét `a.user-box-group-item` đang hiển thị, bỏ node “Chọn tất cả”.
5. Lấy text từ `.user-box-group-item-name`.
6. Không phân biệt hoa/thường; ưu tiên `startsWith`, fallback `includes`, chọn
   nhãn ngắn nhất.
7. Click checkbox/radio bên trong hoặc click chính link.

Không tìm thấy main hoặc coordinating làm cả văn bản `fill_error`. Monitoring
cũng gây `fill_error` nếu có giá trị nhưng không chọn được.

## 10. Retry, lỗi và progress

- Router local: lỗi mạng, 429 và 503 được retry tối đa 3 lần.
- DocFlow: chỉ presign/upload/process có retry; lỗi JSON và HTTP khác dừng ngay.
- Listener event bus được cô lập bằng `try/catch`; một listener lỗi không làm
  văng batch đang chạy.
- Progress được logic phát qua event `progress`; UI là nơi duy nhất cập nhật DOM.
- Log dùng text node cho message từ server để tránh chèn HTML.

## 11. State và giới hạn phiên

`docCache`, `unitCache`, auth token, base path, `exeacode` và cờ xử lý đều chỉ ở
RAM. Reload trang làm mất toàn bộ state frontend. Script không có nút hủy batch,
không persist hàng đợi và không chạy song song nhiều văn bản.

Schema chi tiết xem `METADATA_SCHEMA.md`; đặc tả UI xem `dactagiaodien.md`.

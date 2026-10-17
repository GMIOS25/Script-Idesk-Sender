# Cấu trúc dữ liệu runtime của Script-Idesk 3.0

Tài liệu này mô tả dữ liệu mà userscript thực sự đọc, lưu và sử dụng. Đây không
phải schema database hay Pydantic của backend. Nguồn sự thật là `src/state.js`,
`src/services/api.js`, `src/services/providers/localRouterProvider.js` và các
consumer trong `src/ui`/`src/automation`.

## 1. `docCache`

`docCache` là `Map<string, DocumentState>`, chỉ tồn tại trong bộ nhớ của tab.
Không có bước persist vào local storage.

| Field | Kiểu runtime | Nguồn/cách dùng |
| --- | --- | --- |
| `id` | `string` | ID văn bản iDesk; khóa của `docCache`, dùng tạo job và tìm item DOM. |
| `signNumber` | `string` | `edSearchDto.signNumber`, `ed.signNumber`, hoặc text `.sender`. |
| `subject` | `string` | `edSearchDto.subject`, `ed.subject`, hoặc text `.subject`. |
| `category` | `string` | Loại văn bản từ API iDesk. |
| `author` | `string` | Cơ quan ban hành từ API iDesk. |
| `signer` | `string` | Người ký từ API iDesk. |
| `docDateStr` | `string` | Ngày văn bản; đổi sang `YYYY-MM-DD` khi gọi nhánh DocFlow cũ. |
| `priority` | `number \| string \| null` | Độ khẩn gốc từ iDesk. Dashboard ánh xạ các mức 0–4. |
| `creatorAcode` | `string` | Đọc từ API iDesk; hiện chưa có consumer khác. |
| `responsibility` | `string` | Tham số gọi `view.cpx`; mặc định `main`. |
| `book` | `object \| null` | Dashboard chỉ đọc `book.serialNumber`. |
| `attachments` | `Attachment[]` | Danh sách file từ `view.cpx`. |
| `aiData` | `UiAiData \| null` | Kết quả đã chuẩn hóa để review và điền form. |
| `status` | `string` | Trạng thái vòng đời ở mục 2. |
| `selected` | `boolean \| undefined` | Lựa chọn checkbox của người dùng. |

Các field có thể xuất hiện dần: item quét từ DOM ban đầu chưa chắc đã có chi
tiết, rồi được bổ sung khi interceptor nhận `qsprocess.cpx` hoặc `view.cpx`.

### `Attachment`

Code lựa chọn file chỉ dựa trên các field sau:

| Field | Kiểu mong đợi | Ý nghĩa |
| --- | --- | --- |
| `contentUid` | `string \| number` | `docID` dùng để tải file từ iDesk. |
| `name` | `string` | Tên file, dùng nhận diện PDF, bản đã ký và số hiệu. |
| `format` | `string` | Bằng `pdf` thì được coi là PDF. |
| `signed` | `string` | Bằng `Y` thì được coi là đã ký. |
| `size` | `number` | Tiêu chí cuối cùng khi phải chọn file lớn nhất. |

## 2. Trạng thái văn bản

| Giá trị | Ý nghĩa | Có được `Bắt đầu` thử lại? |
| --- | --- | --- |
| `idle` | Đã quét, chưa gửi AI. | Có |
| `pending` | Đang lấy chi tiết/gửi/chờ AI. | Không |
| `ai_done` | Có `aiData`, sẵn sàng review. | Không |
| `ai_error` | Lỗi tải file, router hoặc DocFlow. | Có |
| `fill_done` | Đã bấm `Đồng ý` trên iDesk thành công. | Không; checkbox mặc định bỏ chọn. |
| `fill_error` | Lỗi mở/chọn/điền/chuyển trên iDesk. | Không được nút `Bắt đầu` gửi AI lại; vẫn có thể chọn để `Duyệt` lại. |

`state.isProcessing` khóa chung hai batch `Bắt đầu` và `Duyệt` để chúng không
chạy đồng thời.

## 3. `UiAiData`

Hai provider phải quy về shape này trước khi UI và `formFiller` sử dụng:

| Field | Kiểu runtime | Cách dùng thực tế |
| --- | --- | --- |
| `processing_unit` | `string[]` | Các đơn vị xử lý chính. Phải có ít nhất một phần tử trước khi chuyển. |
| `coordinating_units` | `string[]` | Danh sách phối hợp; UI cảnh báo nếu backend cũ trả sai kiểu. |
| `monitoring_leader` | `string \| null` | Một lãnh đạo theo dõi; field trên form chỉ được mở khi có giá trị. |
| `implementation_deadline` | `number \| string \| null` | Số ngày cũ, ngày ISO, hoặc câu chứa `N ngày`. |
| `priority` | `number \| string` | Mức dùng khi điền select độ khẩn. Với router local được suy từ `do_khan`. |
| `do_khan` | `string \| undefined` | Giá trị canonical của router: `thuong`, `khan`, `thuong_khan`, `hoa_toc`. |
| `summary` | `string` | Nội dung duy nhất được điền vào textarea chỉ đạo/xử lý. |
| `reason` | `string \| undefined` | Lý do định tuyến, chỉ hiển thị trên card. |
| `notes` | `string \| null` | Cảnh báo review, chỉ hiển thị/log; không điền vào textarea iDesk. |
| `confidence` | giá trị router | Hiện được giữ trong RAM nhưng chưa render trực tiếp. |
| `needs_review` | `boolean \| undefined` | Giữ để tham chiếu; hiện chưa khóa nút `Duyệt`. |
| `requires_confirmation` | `boolean \| undefined` | Giữ để tham chiếu; hiện chưa khóa nút `Duyệt`. |
| `review_reasons` | `string[] \| undefined` | Mã cảnh báo gốc từ router. |
| `_router` | `RouterContext \| undefined` | Chỉ có ở provider local; dùng audit, đánh dấu sửa tay và feedback. |
| `stt` | `number \| undefined` | Chỉ có ở nhánh DocFlow cũ; dùng PATCH chỉnh sửa. |

Nếu router local không có `summary`, adapter dùng
`result.extracted_metadata.trich_yeu`, sau đó mới dùng chuỗi rỗng.

### Deadline

- Số hữu hạn: cộng số ngày lịch vào ngày hiện tại.
- Chuỗi ISO `YYYY-MM-DD`: dùng đúng ngày đó.
- Chuỗi chứa `N ngày`: lấy `N`, cộng số ngày lịch và vẫn giữ câu gốc để hiển thị.
- Chuỗi khác: hiển thị nguyên văn nhưng không tự điền ngày.
- Trình sửa deadline chỉ nhận 1–100. Nếu giá trị cũ không phải dạng tương đối,
  lúc lưu sẽ chuyển thành `trong NN ngày làm việc`. Người dùng có thể bấm
  `Bỏ hạn` để đặt trường này về `null`.

Code hiện dùng ngày lịch (`Date.setDate`), không loại cuối tuần/ngày nghỉ dù câu
chuẩn hóa có chữ “ngày làm việc”.

## 4. `RouterContext`

```text
_router
├─ job_id, document_id, input_sha256
├─ rules_sha256, rules_version, directory_version, received_on
├─ proposed
│  ├─ main[]          { id, name }
│  ├─ coordinating[]  { id, name }
│  ├─ monitoring[]    { id, name }
│  ├─ deadline
│  └─ do_khan
├─ audit
│  ├─ matched_rules[]
│  ├─ evidence
│  ├─ extracted_metadata
│  ├─ tier
│  └─ degraded
├─ edited
├─ requires_manual_mapping
└─ feedback_id (sau khi ghi feedback thành công)
```

`edited` đổi thành `true` khi người dùng thêm/xóa đơn vị, lãnh đạo hoặc sửa hạn
trên card. `requires_manual_mapping` chỉ là snapshot lúc adapter nhận kết quả;
controller không dùng flag này để chặn vì người dùng có thể đã sửa xong.

## 5. Contract router local đầu vào/đầu ra

### Tạo job

`POST /v1/jobs`, `multipart/form-data`:

| Field/header | Giá trị |
| --- | --- |
| `document_id` | `doc.id` của iDesk, chuyển thành chuỗi. |
| `received_on` | `doc.receivedOn`/`doc.received_on` dạng ISO; nếu thiếu dùng ngày hiện tại UTC+7. |
| `file` | Đối tượng `File` tải từ iDesk. |
| `X-API-Key` | `ROUTER_API_KEY`. |
| `Idempotency-Key` | `idesk-{id}-{received_on}-{sha256-prefix}`. |

Response tạo job phải có `job_id`; HTTP 200 và 202 đều được chấp nhận.

### Kết quả job được adapter đọc

Adapter đọc các field sau từ `job.result`:

- `document_id`, `job_id`, `input_sha256`, `rules_sha256`, `rules_version`,
  `directory_version`, `received_on`;
- `recipients.don_vi_xu_ly_chinh`, `recipients.phoi_hop_xu_ly`,
  `recipients.lanh_dao_theo_doi`, mỗi phần tử hợp lệ có `id` và `name`;
- `han_thuc_hien`, `do_khan`, `summary`, `reason`, `confidence`;
- `needs_review`, `requires_confirmation`, `review_reasons`, `degraded`;
- `matched_rules`, `evidence`, `extracted_metadata`, `tier`.

Adapter từ chối kết quả nếu `result.document_id` khác ID văn bản đang xử lý.

### Feedback

`POST /v1/jobs/{job_id}/feedback` gửi:

```json
{
  "document_id": "<id iDesk>",
  "input_sha256": "<sha256>",
  "rules_sha256": "<sha256 rule>",
  "decision": "accepted | edited",
  "final": {
    "don_vi_xu_ly_chinh": ["<router id>"],
    "phoi_hop_xu_ly": ["<router id>"],
    "lanh_dao_theo_doi": ["<router id>"],
    "han_thuc_hien": "YYYY-MM-DD | null"
  },
  "do_khan": "thuong | khan | thuong_khan | hoa_toc",
  "note": "<tối đa 2000 ký tự>"
}
```

Thành công phải là HTTP 201.

## 6. Contract DocFlow cũ

Khi `AI_PROVIDER` khác `local-router`, frontend gửi sáu field metadata sau:

```json
{
  "document_number": "<signNumber>",
  "document_type": "<category>",
  "issuing_agency": "<author>",
  "document_date": "YYYY-MM-DD | chuỗi rỗng",
  "signer": "<signer>",
  "subject": "<subject>"
}
```

`/documents/lookup` nhận object phẳng. `/documents/process` nhận object này trong
`metadata` cùng `file_url`. Kết quả có thể là `{data: UiAiData}` hoặc trực tiếp
là `UiAiData`. Chỉnh sửa tay chỉ PATCH sáu field:
`summary`, `processing_unit`, `monitoring_leader`,
`implementation_deadline`, `coordinating_units`, `notes`.

## 7. Dữ liệu không được persist

Script không lưu PDF, token, cache văn bản, cache đơn vị hoặc kết quả AI vào
storage của trình duyệt. Reload tab làm mất toàn bộ state runtime. Backend/router
có thể có cơ chế lưu riêng, nhưng không thuộc contract của repository này.

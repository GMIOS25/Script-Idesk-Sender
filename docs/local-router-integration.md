# Tích hợp `ai-document-router` local

Tài liệu này mô tả đúng luồng mặc định của Script-Idesk 3.0. Nguồn sự thật là
`src/services/providers/localRouterProvider.js`, `src/services/ai.js` và
`src/config.js`.

## 1. Phạm vi

Script-Idesk là userscript chạy trong phiên iDesk của người dùng. Script tải PDF
bằng cookie của phiên iDesk, gửi file sang `ai-document-router`, chờ kết quả,
cho người dùng rà soát rồi tự điền biểu mẫu chuyển xử lý.

`AI_PROVIDER=local-router` là mặc định. Nhánh DocFlow cũ vẫn còn trong
`src/services/ai.js` để dự phòng; xem `docs/en/api_host.md`.

## 2. Cấu hình

Sao chép `.env.example` thành `.env` và điền:

```dotenv
AI_PROVIDER=local-router
ROUTER_BASE_URL=http://127.0.0.1:8000
ROUTER_API_KEY=<API key của router>
ROUTER_POLL_INTERVAL_MS=1500
ROUTER_TIMEOUT_MS=330000
```

| Biến | Mặc định khi build | Ý nghĩa |
| --- | --- | --- |
| `AI_PROVIDER` | `local-router` | Chọn adapter router local. Mọi giá trị khác dùng nhánh DocFlow cũ. |
| `ROUTER_BASE_URL` | `http://127.0.0.1:8000` | URL gốc, không thêm `/v1`; code tự nối đường dẫn endpoint. |
| `ROUTER_API_KEY` | rỗng | Gửi qua `X-API-Key`. Adapter local dừng ngay nếu chưa cấu hình. |
| `ROUTER_POLL_INTERVAL_MS` | `1500` | Chu kỳ đọc trạng thái job. |
| `ROUTER_TIMEOUT_MS` | `330000` | Timeout cho từng request router và trần tổng thời gian poll một job. |

Các giá trị được esbuild nhúng thẳng vào bundle. `.env` không được commit, nhưng
API key vẫn có thể được đọc từ userscript đã build; chỉ dùng key có phạm vi hẹp,
giới hạn mạng và có thể thu hồi.

Metadata userscript hiện chỉ cho phép kết nối tới `127.0.0.1`, `localhost` và
`api.truyenthanh755.xyz`. Nếu đổi router sang hostname khác, phải bổ sung
`@connect` trong `src/meta.js` rồi build lại.

## 3. Luồng gọi router

1. Chọn một file đính kèm theo thứ tự ưu tiên: PDF đã ký, file đã ký, PDF, rồi
   mới tới mọi file còn lại. Trong cùng nhóm, ưu tiên tên có `dadongdau`/`daky`,
   tiếp theo là số hiệu văn bản, cuối cùng là file lớn nhất.
2. Tải file qua `GM_xmlhttpRequest` từ endpoint iDesk `docx/download.cpx` với
   timeout 60 giây.
3. Tính SHA-256 của file trong trình duyệt.
4. Gửi `POST /v1/jobs` dạng `multipart/form-data` gồm `document_id`,
   `received_on` và `file`. Header có `X-API-Key` và `Idempotency-Key`.
5. Poll `GET /v1/jobs/{job_id}` đến khi `completed` hoặc `failed`.
6. Chuyển kết quả canonical của router sang shape dùng chung cho dashboard và
   bộ điền form. Dữ liệu audit/version được giữ trong `aiData._router`.
7. Sau khi iDesk bấm `Đồng ý` thành công, gửi
   `POST /v1/jobs/{job_id}/feedback` với quyết định `accepted` hoặc `edited`.

`Idempotency-Key` của job gồm ID văn bản iDesk, ngày nhận theo UTC+7 và 32 ký tự
đầu của SHA-256. Key feedback phụ thuộc job, quyết định và nội dung cuối cùng.

## 4. Rà soát và ánh xạ đơn vị

- Router trả recipient theo `{id, name}`; UI hiện tên.
- Script nạp cây đơn vị thực tế từ `fbyvsphere.cpx` vào `unitCache` sau khi đã
  bắt được `exeacode` từ một request `view.cpx`.
- Gợi ý trên card và thao tác chọn lúc điền form dùng cùng thuật toán: không
  phân biệt hoa/thường, ưu tiên tên bắt đầu bằng chuỗi router, sau đó mới tìm
  chuỗi chứa và chọn nhãn ngắn nhất.
- Gợi ý không được tự áp dụng. Người dùng phải bấm gợi ý hoặc chọn thủ công.
- Khi ghi feedback, tên cuối cùng được đổi lại thành router ID qua
  `GET /v1/directory`: ưu tiên ID chính xác, rồi tên chính xác, cuối cùng là một
  kết quả chứa duy nhất. Không ánh xạ được thì chỉ feedback lỗi; giao dịch iDesk
  đã hoàn tất không bị đổi thành lỗi điền.

`docs/idesk-router-map.json` là bản đối chiếu phục vụ kiểm tra thủ công, không
được runtime nạp và không thay thế quy trình trên.

## 5. Quy tắc chặn và cảnh báo hiện tại

- `Đơn vị xử lý chính` là trường duy nhất bắt buộc trước khi chuyển.
- Không có đơn vị xử lý chính: card cảnh báo và người dùng phải chọn ít nhất một
  giá trị. Nhiều đơn vị xử lý chính được giữ nguyên để review và chuyển.
- Nhiều lãnh đạo theo dõi: để trống, hiển thị cảnh báo; đây không phải chốt chặn.
- `needs_review`, `requires_confirmation`, `review_reasons` và `degraded` được
  hiển thị dưới dạng cảnh báo, nhưng chưa tự động khóa nút `Duyệt`.
- `hoa_toc` được hạ về option `2` (`Thượng khẩn`) khi điền vì form hiện chỉ có
  các option `0/1/2`; card vẫn cảnh báo người dùng xác nhận.

## 6. Retry và timeout

`POST /v1/jobs`, `GET /v1/jobs/{id}`, `GET /v1/directory` và feedback thử tối đa
3 lần khi gặp lỗi mạng, HTTP 429 hoặc 503, với backoff 1 giây rồi 2 giây.
Batch chờ 2,2 giây giữa các văn bản AI; giữa hai lần điền form chờ 0,8 giây.

Nếu job không hoàn tất trước `ROUTER_TIMEOUT_MS`, card chuyển sang `Lỗi AI` và
có thể được thử lại bằng nút `Bắt đầu` trong cùng phiên.

## 7. Build và kiểm tra

```powershell
npm ci
npm test
npm run build
```

Build tạo cùng một bundle tại:

- `src/idesk_automation.user.js`
- `dist/idesk_automation.user.js`

Cả hai đều bị `.gitignore` loại khỏi Git. Không sửa hoặc commit bundle; sửa các
module trong `src` rồi build lại. Script `build:extension` đang được khai báo
trong `package.json`, nhưng repository hiện không có thư mục `extension`, nên
không thuộc quy trình build đang hỗ trợ.

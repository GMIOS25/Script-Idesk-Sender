# API mà Script-Idesk hiện gọi

Nguồn sự thật phía frontend: `src/config.js`, `src/services/ai.js`,
`src/services/providers/localRouterProvider.js`. Tài liệu này không khẳng định
mọi deployment backend có cùng contract; hãy đối chiếu backend đang chạy trước
khi kết nối thật.

## 1. Provider mặc định: `local-router`

`ROUTER_BASE_URL` mặc định là `http://127.0.0.1:8000` (không có `/api/v1`).
Mọi request router gửi `Accept: application/json` và `X-API-Key` từ
`ROUTER_API_KEY`. Adapter từ chối chạy nếu key rỗng.

| Method | URL tương đối | Body | Thành công |
| --- | --- | --- | --- |
| POST | `/v1/jobs` | `multipart/form-data`: `document_id`, `received_on`, `file`; header `Idempotency-Key`. | 200/202, JSON có `job_id`. |
| GET | `/v1/jobs/{job_id}` | Không body. | 200, JSON có `status`, khi `completed` phải có `result`. |
| GET | `/v1/directory` | Không body. | 200, JSON có `recipients: [{id,name}, ...]`; được cache mỗi phiên. |
| POST | `/v1/jobs/{job_id}/feedback` | JSON gồm `document_id`, hashes, `decision`, `final`, `do_khan`, `note`; header `Idempotency-Key`. | 201, JSON có thể có `feedback_id`. |

Job và feedback dùng hai idempotency key khác nhau. Request gặp lỗi mạng, 429
hoặc 503 được retry tối đa 3 lần với backoff 1 giây rồi 2 giây. Những HTTP
status khác dừng ngay. Mỗi request và vòng poll đều dùng trần
`ROUTER_TIMEOUT_MS` (mặc định 330000 ms); chu kỳ poll mặc định 1500 ms.

Kết quả job phải có `result.document_id` khớp ID văn bản iDesk đang mở. Shape
chi tiết của dữ liệu dùng trong UI và feedback xem `METADATA_SCHEMA.md`.

## 2. API iDesk trong phiên trình duyệt

Script không đăng nhập lại iDesk; request chạy trong phiên hiện có.

| Method | URL tương đối | Mục đích |
| --- | --- | --- |
| XHR/fetch sẵn có | `qsprocess.cpx` | Đọc list văn bản. |
| XHR/fetch sẵn có, hoặc GET trực tiếp | `/document/edocs/view.cpx?exeacode=...&id=...&responsibility=...` | Metadata và attachment. |
| XHR/fetch sẵn có, hoặc POST trực tiếp | `/comm/nodes/fbyvsphere.cpx` | Cây đơn vị theo `exeacode`, `type=transfer`, `responsibility=main`. |
| GET qua `GM_xmlhttpRequest` | `/docx/download.cpx?docID=...&view=pdf&t=...` | Tải attachment bằng session iDesk; timeout 60 giây. |

Các URL trực tiếp có prefix `/{tenant}/smartcloud` do code suy ra từ request
hoặc pathname hiện tại.

## 3. Provider dự phòng: DocFlow

Khi `AI_PROVIDER` khác `local-router`, các endpoint được nối với
`AUTH_BASE_URL` (mặc định lúc build `http://localhost:5000`). Đây là provider
Bearer/presign cũ, không phải luồng mặc định. Nếu dùng production host
`https://api.truyenthanh755.xyz/api/v1`, đặt toàn bộ URL đó vào
`AUTH_BASE_URL`; `src/config.js` chỉ nối path, không tự thêm `/api/v1`.

| Method | Path | Body/đáp ứng frontend |
| --- | --- | --- |
| POST | `/auth/token` | JSON `{username,password}`; HTTP 200 có `access_token`. Token được cache trong RAM. |
| POST | `/documents/lookup` | Sáu metadata phẳng; HTTP 200 có `found`, `state`, `data`. Chỉ dùng khi `found && state=completed && data`. |
| POST | `/files/presign` | JSON `{filename,content_type:"application/pdf"}`; HTTP 200 có `upload_url`, `public_url`, `upload_headers`. |
| PUT | `upload_url` từ presign | Body là bytes file, headers từ `upload_headers` cộng Bearer; chấp nhận 204 hoặc 200. |
| POST | `/documents/process` | JSON `{metadata:{6 field},file_url:public_url}`; HTTP 200 nhận `result.data` hoặc chính `result`. |
| PATCH | `/documents/{stt}` | Subset của sáu field AI; HTTP 200 nhận `result.data` hoặc chính `result`. |

Sáu metadata: `document_number`, `document_type`, `issuing_agency`,
`document_date`, `signer`, `subject`. PATCH chỉ chấp nhận:
`summary`, `processing_unit`, `monitoring_leader`,
`implementation_deadline`, `coordinating_units`, `notes`.

- Token rỗng không ngăn request tiếp theo; các endpoint gửi Bearer chỉ khi lấy
  được token.
- Code hiện không refresh token khi 401.
- Presign/upload/process retry lỗi mạng và 429/503 tối đa 3 lần; lookup/PATCH
  không retry.
- API trả lỗi `{error:{code,message,detail}}` được dùng để viết log. Nếu có
  header `x-request-id` đúng dạng mà parser đọc được, ID được thêm vào lỗi.
- Nhánh fallback không gọi `/wards`, `/organizations`, `/health` hay
  `/files/tmp` trực tiếp từ frontend.

`src/back_end_mockup/mock_backend.py` là Flask mock để thử contract DocFlow,
chạy mặc định ở cổng 5000; nó không mô phỏng `/v1/jobs` của router local. Mock
chỉ có alias `/api/v1/documents/process`, còn auth/presign/lookup/PATCH không có
alias `/api/v1` tương ứng. Để test mock, dùng `AUTH_BASE_URL=http://localhost:5000`.

## 4. Cấu hình build và quyền kết nối

`build.mjs` đọc biến môi trường của process trước, rồi `.env`, sau đó dùng
mặc định. Build nhúng auth username/password, API key và URL vào userscript,
nên không đưa credential thật vào tài liệu hay commit bundle.

Userscript metadata hiện cấp quyền `@connect` cho:

- `api.truyenthanh755.xyz`;
- `127.0.0.1`;
- `localhost`.

Đổi host API/router phải sửa `src/meta.js` và build lại. Cấu hình `CONNECT_URL`
trong `.env.example` hiện không được `build.mjs` hoặc `src/config.js` sử dụng.

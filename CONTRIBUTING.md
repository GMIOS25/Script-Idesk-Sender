# Quy tắc làm việc nhóm (2 người: UI + Logic)

## Ai sửa thư mục nào

| Người phụ trách | Thư mục sở hữu | Không được import từ |
|---|---|---|
| **UI** (giao diện) | `src/ui/` (`dashboard.js`, `styles.js`) | `src/controllers/`, `src/services/`, `src/automation/` |
| **Logic** (nghiệp vụ) | `src/controllers/`, `src/services/`, `src/automation/`, `src/state.js` | `src/ui/` |

Cả 2 phía đều được phép dùng chung (không thuộc về ai, ít khi đổi):
`src/core/bus.js`, `src/utils/`, `src/config.js`.

## Nguyên tắc bắt buộc

1. **`src/ui/*` và `src/controllers|services|automation/*` không bao giờ import lẫn nhau.**
   Muốn giao tiếp, dùng event bus ở `src/core/bus.js`:
   - UI phát sự kiện khi người dùng thao tác: `emit('scan-requested')`, `emit('fill-requested')`.
   - Logic phát sự kiện khi dữ liệu đổi: `emit('docs-changed')`, `emit('progress', {current, total})`.
   - Ai lắng nghe gì thì tự đăng ký bằng `on(...)` trong file của mình.
   - Nếu cần thêm sự kiện mới, khai báo tên và ý nghĩa ngay trong comment đầu file `src/core/bus.js` để người còn lại biết.

2. **Không commit file build.** `src/idesk_automation.user.js` do `pnpm run build` tự sinh ra
   (xem `build.mjs`), đã nằm trong `.gitignore`. Chỉ build ở máy cá nhân để tự test, hoặc
   build khi cần release. Không `git add` file này.

3. **Trước khi tạo PR / merge:** chạy `pnpm run build` để chắc code không lỗi cú pháp, nhưng
   **không** commit kết quả build.

## Quy trình git đề xuất

```
features/chairperson          <- nhánh chung của cả nhóm
 ├── feature/chairperson-ui       <- người làm UI
 └── feature/chairperson-logic    <- người làm logic
```

- Mỗi người rẽ nhánh riêng từ `features/chairperson`, commit nhỏ, thường xuyên `git pull --rebase`
  nhánh chung về để đỡ lệch xa.
- Mở PR vào `features/chairperson`, review chéo rồi merge.
- Vì 2 người không còn đụng chung file logic/UI (chỉ có thể cùng sửa `core/bus.js` khi thêm
  sự kiện mới - trường hợp này hiếm và dễ merge), conflict thực tế còn lại chủ yếu chỉ xảy ra
  nếu cả 2 cùng sửa đúng 1 dòng trong cùng 1 file - dùng nhánh nhỏ + rebase thường xuyên để giảm rủi ro này.

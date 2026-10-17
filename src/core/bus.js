// ==============================================================================
// EVENT BUS - Điểm giao tiếp DUY NHẤT giữa UI (src/ui/*) và Logic (controllers/services/automation).
//
// Quy ước: KHÔNG import trực tiếp file trong src/ui/* từ trong controllers/services/automation,
// và ngược lại KHÔNG import controllers/services/automation từ trong src/ui/*.
// Muốn giao tiếp 2 chiều thì dùng on()/emit() ở đây.
//
// Các event đang dùng trong dự án (cập nhật danh sách này khi thêm event mới):
//   - 'scan-requested'        : UI báo người dùng bấm nút "Bắt đầu" { limit: number|null }
//   - 'fill-requested'        : UI báo người dùng bấm nút "Duyệt"
//   - 'docs-changed'          : Logic báo docCache vừa thay đổi, UI cần render lại danh sách
//   - 'progress'              : Logic báo tiến độ xử lý { current, total }, UI cập nhật progress bar
//   - 'unit-remove-requested' : UI báo người dùng bấm "×" trên 1 chip đơn vị { id, kind: 'main'|'co'|'leader', value? }
//   - 'unit-picker-requested' : UI báo người dùng bấm "+" để thêm đơn vị { id, kind: 'main'|'co'|'leader', anchor }
//   - 'unit-add-confirmed'    : unitPicker (chọn thủ công) HOẶC dashboard (bấm nút
//                               "Gợi ý" hiện sẵn lúc review, xem suggestUnitLabel()
//                               trong ui/unitPicker.js) báo 1 đơn vị đã được xác nhận
//                               { id, kind: 'main'|'co'|'leader', label, replaceValue? }
//                               — replaceValue (chỉ dùng khi kind:'co') là chuỗi thô
//                               cần thay thế khi áp dụng gợi ý, tránh còn lại cả 2 bản
//                               (thô + đã khớp) cùng lúc trong coordinating_units
//   - 'deadline-editor-requested' : UI báo người dùng bấm vào "Hạn thực hiện" để sửa số ngày { id, anchor }
//   - 'deadline-update-confirmed' : deadlineEditor báo người dùng đã lưu số ngày mới
//                                   hoặc bỏ hạn { id, days: number|null }
// ==============================================================================

const listeners = {};
export const on = (e, cb) => (listeners[e] = listeners[e] || []).push(cb);
export const off = (e, cb) => listeners[e] && (listeners[e] = listeners[e].filter(fn => fn !== cb));

// Cô lập lỗi từng listener: một listener hỏng không được phép làm văng
// ngược vào vòng xử lý gọi emit() (vd scanAndSendAll/runFillOnAll), vì khi đó
// state.isProcessing sẽ bị kẹt true và khoá toàn bộ tool cho tới khi reload.
export const emit = (e, data) => {
    (listeners[e] || []).forEach((fn) => {
        try {
            fn(data);
        } catch (err) {
            // Best-effort: không có logger ở đây để tránh circular import;
            // in ra console để vẫn nhìn thấy listener nào đang lỗi.
            console.error(`[bus] listener for "${e}" failed:`, err);
        }
    });
};

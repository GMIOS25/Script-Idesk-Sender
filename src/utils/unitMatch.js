// ==============================================================================
// UNIT MATCH - thuật toán khớp GẦN ĐÚNG (fuzzy) giữa 1 chuỗi thô AI backend trả
// về (vd "Phòng kinh tế") và tên hiển thị THẬT của 1 đơn vị/người trong cây tổ
// chức iDesk (vd "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai").
//
// Đặt CHUNG ở đây và dùng lại y hệt tại 2 nơi, để gợi ý lúc review và giá trị
// thực sự được chọn lúc fill KHÔNG BAO GIỜ lệch nhau:
//   - src/automation/treeSelect.js : khớp trên DOM thật (popup cây tổ chức của
//     hệ thống iDesk) — chạy lúc người dùng bấm "Duyệt", quyết định node nào
//     THỰC SỰ được click chọn trên hệ thống.
//   - src/ui/unitPicker.js         : khớp trên unitCache (cây đơn vị đã mồi
//     sẵn qua fbyvsphere.cpx, xem automation/unitPrimer.js) — chạy NGAY lúc
//     kết quả AI vừa hiện lên UI để review, chỉ nhằm GỢI Ý cho người dùng xem
//     trước/chọn nhanh, không tự ý thay giá trị nếu người dùng chưa xác nhận.
// ==============================================================================

// Chuẩn hoá về chữ thường trước khi so sánh: giá trị AI backend trả về có thể
// khác hoa/thường so với tên thật hiển thị trên hệ thống (vd AI trả "Phong
// kinh te" chữ thường, trong khi tên thật viết hoa chữ đầu từng từ) — nếu so
// sánh phân biệt hoa/thường thì cả startsWith() lẫn includes() đều sẽ không
// khớp được.
const normalize = (s) => (s || '').toLowerCase();

// Chọn ứng viên có `label` NGẮN NHẤT trong 1 danh sách đã lọc sẵn — dùng chung
// cho cả 2 bước bên dưới để ưu tiên khớp CHÍNH XÁC/gần đúng nhất khi có nhiều
// ứng viên cùng thoả điều kiện lọc.
const shortestLabel = (list) => list.reduce((best, cur) => (
    (!best || cur.label.length < best.label.length) ? cur : best
), null);

/**
 * Tìm ứng viên khớp tốt nhất với `targetName` trong `candidates` (mỗi phần tử
 * tối thiểu có field `label`; các field khác — vd `el`, `id` — được giữ
 * nguyên tuỳ nơi gọi để dùng tiếp sau khi có kết quả).
 *
 * YÊU CẦU NGHIỆP VỤ: đơn vị/người trên hệ thống thật thường có thêm hậu tố
 * (tên xã/phường, "UBND xã ...") mà AI backend không thể biết trước và sẽ
 * KHÔNG BAO GIỜ trả về đúng 100% như vậy (vd AI trả "Phòng kinh tế" nhưng tên
 * thật là "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai"). Vì vậy tiêu chí
 * chọn KHÔNG bắt buộc khớp 100% (exact), mà theo 2 bước ưu tiên:
 *
 *   1) Ưu tiên các label BẮT ĐẦU BẰNG targetName — tín hiệu mạnh hơn "chứa ở
 *      bất kỳ đâu". Tên của 1 ĐƠN VỊ/PHÒNG BAN luôn nằm NGAY ĐẦU chính tên
 *      của nó (vd "Phòng Kinh tế - Xã Vĩnh Thạnh..." bắt đầu bằng "Phòng
 *      Kinh tế"), trong khi cụm từ đó rất hay bị LẶP LẠI Ở GIỮA tên của
 *      NHIỀU người/vị trí THUỘC đơn vị ấy (vd "Văn thư (Văn thư phòng Kinh
 *      tế)", "Trưởng phòng Kinh tế (Nguyễn Tuấn Trình)"). Nếu chỉ xét "chứa
 *      substring ở bất kỳ đâu" rồi chọn ứng viên ngắn nhất, các mục
 *      NGƯỜI/alias ngắn hơn này sẽ thắng NHẦM trước cả đúng nút ĐƠN VỊ/PHÒNG
 *      BAN cần chọn.
 *   2) Fallback: không có ứng viên nào BẮT ĐẦU BẰNG targetName — vd AI chỉ
 *      trả về riêng tên người ("Trần Thanh Đức") trong khi tên thật đang là
 *      "Vai trò (Tên người)" ("Chỉ huy trưởng (Trần Thanh Đức)"). Lúc này
 *      mới rơi về so khớp "chứa substring ở bất kỳ vị trí nào".
 *   3) Trong mỗi bước, nếu có nhiều ứng viên cùng thoả, chọn label NGẮN NHẤT.
 *
 * Trả về `null` nếu không có ứng viên nào khớp — KHÔNG đoán bừa.
 */
export const findBestUnitMatch = (candidates, targetName) => {
    if (!targetName || !targetName.trim() || !candidates || candidates.length === 0) return null;
    const targetNorm = normalize(targetName.trim());

    let best = shortestLabel(candidates.filter((c) => normalize(c.label).startsWith(targetNorm)));
    if (!best) {
        best = shortestLabel(candidates.filter((c) => normalize(c.label).includes(targetNorm)));
    }
    return best;
};

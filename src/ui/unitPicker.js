import { unitCache } from '../state.js';
import { on, emit } from '../core/bus.js';
import { findBestUnitMatch } from '../utils/unitMatch.js';

// Chuỗi hiển thị cho 1 phần tử: "unit"/"dept" hiện tên đơn vị/phòng ban, "alias"
// hiện "{Chức danh} ({Người phụ trách})" — đồng bộ với định dạng chip do backend
// trả về (vd AI trả "Chỉ huy trưởng (Trần Thanh Đức)"), tránh lệch giá trị giữa
// đơn vị do BE gán sẵn và đơn vị do user tự chọn qua picker.
const labelOf = (u) => (u.type === 'alias' && u.refFullname) ? `${u.name} (${u.refFullname})` : u.name;

/**
 * Gợi ý 1 đơn vị/người THẬT (đã có sẵn trong unitCache) khớp gần đúng nhất với
 * 1 chuỗi THÔ mà AI backend trả về (vd "Phòng kinh tế").
 *
 * TRƯỚC ĐÂY: việc so khớp gần đúng này (xem automation/treeSelect.js) CHỈ chạy
 * SAU KHI người dùng đã bấm "Duyệt" và tool mở popup cây tổ chức THẬT trên hệ
 * thống iDesk để tìm — nghĩa là người dùng không hề biết trước tool sẽ chọn
 * đúng hay nhầm cho tới tận lúc điền xong form.
 *
 * BÂY GIỜ: hàm này chạy lại ĐÚNG thuật toán đó (findBestUnitMatch trong
 * ../utils/unitMatch.js) nhưng SỚM HƠN — ngay lúc kết quả AI vừa hiện lên UI
 * để review — và tra trên unitCache (cây đơn vị đã mồi sẵn qua fbyvsphere.cpx,
 * xem automation/unitPrimer.js) thay vì DOM thật của hệ thống. Nhờ đó
 * ui/dashboard.js có thể hiện gợi ý ngay tại card review cho người dùng xem
 * trước/bấm chọn, không phải đợi tới lúc fill mới biết tool định chọn gì.
 *
 * Trả về nhãn hiển thị đầy đủ (đã qua labelOf, vd "Phòng Kinh tế - Xã Vĩnh
 * Thạnh - Tỉnh Gia Lai") nếu tìm được ứng viên khớp VÀ nhãn đó khác với chuỗi
 * thô ban đầu (giống hệt rồi thì không có gì để gợi ý thêm). Trả về `null` nếu
 * unitCache rỗng (chưa mồi được cây đơn vị), không có chuỗi thô để so khớp,
 * hoặc không có ứng viên nào khớp — ĐÚNG theo yêu cầu "không khớp thì không
 * gợi ý gì cả", không đoán bừa.
 */
export const suggestUnitLabel = (rawValue) => {
    if (!rawValue || !rawValue.trim() || unitCache.size === 0) return null;

    const candidates = [];
    unitCache.forEach((u) => candidates.push({ label: labelOf(u) }));

    const best = findBestUnitMatch(candidates, rawValue.trim());
    if (!best) return null;

    // Khớp y hệt (không phân biệt hoa/thường) với giá trị thô thì không còn gì
    // để gợi ý thêm — tránh hiện 1 nút "gợi ý" thay thế bằng đúng giá trị đang
    // có sẵn.
    if (best.label.trim().toLowerCase() === rawValue.trim().toLowerCase()) return null;

    return best.label;
};

/**
 * Dựng cây cha-con từ unitCache (Map phẳng id -> unit). Node nào có `parent`
 * không tồn tại trong unitCache (vd id gốc của cả cụm/xã) sẽ là node gốc.
 * Không giả định số cấp/độ sâu cụ thể — tự đúng với bất kỳ cấu trúc xã nào.
 */
const buildTree = () => {
    const nodes = new Map();
    unitCache.forEach((u, id) => nodes.set(id, { ...u, children: [] }));

    const roots = [];
    nodes.forEach((n) => {
        if (n.parent && nodes.has(n.parent)) nodes.get(n.parent).children.push(n);
        else roots.push(n);
    });

    const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'vi');
    const sortRec = (list) => {
        list.sort(byOrder);
        list.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
};

let popoverEl = null;
let collapsed = null; // Set<id> các nhánh đang thu gọn (mặc định: mở hết)

const closePopover = () => {
    if (popoverEl) { popoverEl.remove(); popoverEl = null; }
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
};

const onOutsideClick = (e) => {
    if (popoverEl && !popoverEl.contains(e.target)) closePopover();
};

const onKeyDown = (e) => {
    if (e.key === 'Escape') closePopover();
};

const renderRows = (tree, query) => {
    const q = query.trim().toLowerCase();
    const rows = [];

    const walk = (list, depth) => {
        list.forEach((node) => {
            const label = labelOf(node);
            const selfMatch = !q || label.toLowerCase().includes(q);
            const hasChildren = node.children.length > 0;

            // Khi đang tìm kiếm: vẫn hiện node cha nếu 1 trong các con của nó khớp,
            // để không mất ngữ cảnh (biết person đó thuộc phòng ban/đơn vị nào).
            const childMatches = q ? node.children.some((c) => nodeOrDescMatches(c, q)) : true;
            if (!selfMatch && !childMatches) return;

            rows.push({ node, depth, label, hasChildren });
            if (hasChildren && (q ? true : !collapsed.has(node.id))) {
                walk(node.children, depth + 1);
            }
        });
    };
    walk(tree, 0);
    return rows;
};

const nodeOrDescMatches = (node, q) => {
    if (labelOf(node).toLowerCase().includes(q)) return true;
    return node.children.some((c) => nodeOrDescMatches(c, q));
};

const openPicker = ({ id, kind, anchor }) => {
    closePopover();

    if (unitCache.size === 0) {
        alert('Chưa có dữ liệu đơn vị. Hãy bấm "Bắt đầu" ít nhất 1 lần để hệ thống tự lấy danh sách đơn vị trước.');
        return;
    }

    collapsed = new Set();
    const tree = buildTree();

    popoverEl = document.createElement('div');
    popoverEl.className = 'rpa-unit-picker';
    popoverEl.innerHTML = `
        <div class="rpa-unit-picker-search-wrap">
            <input type="text" class="rpa-unit-picker-search" placeholder="Tìm đơn vị hoặc người...">
            <svg class="rpa-unit-picker-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </div>
        <div class="rpa-unit-picker-list"></div>
    `;
    document.body.appendChild(popoverEl);

    // Định vị ngay dưới nút "+", ghim trong viewport để không tràn màn hình.
    const rect = anchor.getBoundingClientRect();
    const width = 280;
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    popoverEl.style.left = `${Math.max(8, left)}px`;
    popoverEl.style.top = `${rect.bottom + 4}px`;
    popoverEl.style.width = `${width}px`;

    const listEl = popoverEl.querySelector('.rpa-unit-picker-list');
    const searchEl = popoverEl.querySelector('.rpa-unit-picker-search');

    const render = () => {
        const rows = renderRows(tree, searchEl.value);
        if (rows.length === 0) {
            listEl.innerHTML = `<div class="rpa-unit-picker-empty">Không tìm thấy đơn vị/người phù hợp</div>`;
            return;
        }
        listEl.innerHTML = rows.map(({ node, depth, label, hasChildren }) => `
            <div class="rpa-unit-picker-row ${hasChildren ? 'is-branch' : 'is-leaf'}" style="padding-left:${10 + depth * 16}px" data-id="${node.id}">
                <span class="rpa-unit-picker-caret" data-caret="${node.id}">${hasChildren ? (collapsed.has(node.id) ? '▸' : '▾') : ''}</span>
                <span class="rpa-unit-picker-label">${label}</span>
            </div>
        `).join('');
    };
    render();

    searchEl.addEventListener('input', render);

    listEl.addEventListener('click', (e) => {
        const caret = e.target.closest('[data-caret]');
        if (caret) {
            const nodeId = Number(caret.getAttribute('data-caret'));
            if (collapsed.has(nodeId)) collapsed.delete(nodeId);
            else collapsed.add(nodeId);
            render();
            return;
        }

        const row = e.target.closest('.rpa-unit-picker-row');
        if (!row) return;
        const unit = unitCache.get(Number(row.getAttribute('data-id')));
        if (!unit) return;
        emit('unit-add-confirmed', { id, kind, label: labelOf(unit) });
        closePopover();
    });

    searchEl.focus();
    setTimeout(() => {
        document.addEventListener('click', onOutsideClick, true);
        document.addEventListener('keydown', onKeyDown, true);
    }, 0);
};

on('unit-picker-requested', openPicker);
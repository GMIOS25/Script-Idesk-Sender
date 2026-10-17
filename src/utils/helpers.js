import { S } from '../config.js';
import { state } from '../state.js';
import { appendLog } from './logger.js';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Các backend mới trả danh sách đơn vị; vẫn nhận chuỗi từ cache/backend cũ để
// phiên đang chạy không bị hỏng khi chuyển đổi schema.
export const toStringArray = (value) => {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return values.map(item => String(item).trim()).filter((item, index, all) => item && all.indexOf(item) === index);
};

export const isVisible = (el) => !!el && (el.getClientRects?.().length > 0 || el.offsetParent != null);

export const formatDate = (date) => {
    const d = date || new Date();
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const calcDeadline = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(days, 10));
    return formatDate(date);
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_DAYS_RE = /(\d+)\s*ng[aà]y/i;

export const resolveDeadlineDate = (value) => {
    const result = { dateStr: null, daysNum: null, displayText: '---', raw: value, unparsed: false };
    if (!value && value !== 0) return result;

    if (typeof value === 'number' && Number.isFinite(value)) {
        result.daysNum = value;
        result.dateStr = calcDeadline(value);
        result.displayText = `${result.dateStr} (+${value} ngày)`;
        return result;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return result;

        const isoMatch = trimmed.match(ISO_DATE_RE);
        if (isoMatch) {
            const d = new Date(`${trimmed}T00:00:00`);
            if (!isNaN(d.getTime())) {
                result.dateStr = formatDate(d);
                result.displayText = result.dateStr;
                return result;
            }
        }

        const relMatch = trimmed.match(RELATIVE_DAYS_RE);
        if (relMatch) {
            result.daysNum = parseInt(relMatch[1], 10);
            result.dateStr = calcDeadline(result.daysNum);
            result.displayText = `${trimmed} (~ ${result.dateStr})`;
            return result;
        }

        result.unparsed = true;
        result.displayText = trimmed;
    }

    return result;
};

export const applyDeadlineDays = (rawValue, newDays) => {
    const n = Math.round(Number(newDays));
    const clamped = Math.min(100, Math.max(1, Number.isFinite(n) ? n : 1));
    const defaultFormatted = `trong ${String(clamped).padStart(2, '0')} ngày làm việc`;

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        const relMatch = trimmed.match(RELATIVE_DAYS_RE);
        if (relMatch) {
            const digits = relMatch[1];
            const padded = (digits.length > 1 && digits.startsWith('0')) ? String(clamped).padStart(digits.length, '0') : String(clamped);
            return trimmed.slice(0, relMatch.index) + relMatch[0].replace(digits, padded) + trimmed.slice(relMatch.index + relMatch[0].length);
        }
    }
    return defaultFormatted;
};

export const getVisibleItems = () => {
    let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
    if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
    return items.filter(isVisible);
};

// iDesk renders hidden flag spans on ordinary rows too. The row class is the
// primary signal; a visible flag is the fallback for variants without it.
export const getReceivedItemKind = (el) => {
    if (!el) return 'ordinary';
    const hasVisibleFlag = (name) => {
        const flag = el.querySelector?.(`.${name}`);
        return !!flag && isVisible(flag);
    };
    if (el.classList.contains('update') || hasVisibleFlag('updateFlag')) return 'update';
    if (el.classList.contains('book') || hasVisibleFlag('bookFlag')) return 'book';
    return 'ordinary';
};

export const isOrdinaryReceivedItem = (el) => getReceivedItemKind(el) === 'ordinary';

// Trang cuối trước, rồi đến dòng cuối trong cùng một trang.
export const compareReceivedPositionDesc = (left, right) =>
    (right?.page || 0) - (left?.page || 0) ||
    (right?.pageIndex ?? -1) - (left?.pageIndex ?? -1);

export const ensureBasePath = (url) => {
    if (state.basePath) return;
    const m = (url || '').match(/(\/[^\/?]+\/smartcloud)(?=\/)/);
    if (m && m[1]) {
        state.basePath = m[1];
        appendLog(`Da xac dinh duong dan goc he thong: ${state.basePath}`);
    }
};

export const getFallbackBasePath = () => {
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}/smartcloud` : '/smartcloud';
};

export const findByVisibleText = (root, selector, texts) => {
    const scope = root || document;
    const nodes = scope.querySelectorAll(selector);
    for (const el of nodes) {
        const t = (el.textContent || el.value || '').trim();
        if (texts.includes(t) && isVisible(el)) return el;
    }
    return null;
};

/**
 * Loại bỏ hậu tố " - Tỉnh Gia Lai" khỏi tên cơ quan ban hành khi hiển thị.
 * Không thay đổi dữ liệu gốc.
 * @param {string} name - Tên cơ quan ban hành
 * @returns {string} Tên đã được rút gọn
 */
export const stripAgencySuffix = (name) => {
    if (!name || name === '---') return name;
    return name.replace(/\s*-\s*Tỉnh\s+Gia\s+Lai\s*$/i, '').trim();
};

const PRIORITY_LABELS = ['Bình thường', 'Khẩn', 'Thượng khẩn', 'Hỏa tốc', 'Hỏa tốc hẹn giờ'];

export const resolvePriority = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const level = Number(value);
    const label = Number.isInteger(level) ? PRIORITY_LABELS[level] : null;
    return label ? { level, label, isCritical: level >= 3 } : null;
};

export const toISODateOnly = (value) => {
    if (!value) return '';
    const s = String(value).trim();
    const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoPrefix) return isoPrefix[1];
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

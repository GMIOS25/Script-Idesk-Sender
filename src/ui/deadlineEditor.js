import { docCache } from '../state.js';
import { resolveDeadlineDate } from '../utils/helpers.js';
import { on, emit } from '../core/bus.js';

const MIN_DAYS = 1;
const MAX_DAYS = 100;
const DEFAULT_DAYS = 5;

let popoverEl = null;

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
    if (e.key === 'Enter' && popoverEl) {
        const confirmBtn = popoverEl.querySelector('[data-role="confirm"]');
        if (confirmBtn) confirmBtn.click();
    }
};

const clamp = (n) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));

// Chỉ giữ lại chữ số trong input — người dùng không được gõ chữ/ký tự khác vào đây,
// đúng yêu cầu "chỉ tương tác với con số".
const sanitizeDigits = (str) => String(str).replace(/[^\d]/g, '');

const openEditor = ({ id, anchor }) => {
    closePopover();

    const doc = docCache.get(id);
    if (!doc) return;

    const rawDeadline = doc.aiData ? doc.aiData.implementation_deadline : null;
    const resolved = resolveDeadlineDate(rawDeadline);
    let currentDays = clamp(resolved.daysNum !== null ? resolved.daysNum : DEFAULT_DAYS);

    popoverEl = document.createElement('div');
    popoverEl.className = 'rpa-deadline-editor';
    popoverEl.innerHTML = `
        <div class="rpa-deadline-editor-title">Hạn thực hiện (số ngày)</div>
        <div class="rpa-deadline-editor-row">
            <button type="button" class="rpa-deadline-step" data-role="dec" aria-label="Giảm">−</button>
            <input type="text" inputmode="numeric" class="rpa-deadline-input" data-role="input" value="${currentDays}" maxlength="3">
            <button type="button" class="rpa-deadline-step" data-role="inc" aria-label="Tăng">+</button>
        </div>
        <div class="rpa-deadline-editor-hint">Nhập từ ${String(MIN_DAYS).padStart(2, '0')} đến ${MAX_DAYS} ngày</div>
        <div class="rpa-deadline-editor-actions">
            <button type="button" class="rpa-btn rpa-btn-outline rpa-deadline-remove" data-role="remove">Bỏ hạn</button>
            <button type="button" class="rpa-btn rpa-btn-outline" data-role="cancel">Huỷ</button>
            <button type="button" class="rpa-btn rpa-btn-primary" data-role="confirm">Lưu</button>
        </div>
    `;
    document.body.appendChild(popoverEl);

    // Định vị ngay dưới phần tử được bấm, ghim trong viewport.
    const rect = anchor.getBoundingClientRect();
    const width = 200;
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    popoverEl.style.left = `${Math.max(8, left)}px`;
    popoverEl.style.top = `${rect.bottom + 4}px`;
    popoverEl.style.width = `${width}px`;

    const inputEl = popoverEl.querySelector('[data-role="input"]');

    const syncInput = () => { inputEl.value = String(currentDays); };

    inputEl.addEventListener('input', () => {
        const digits = sanitizeDigits(inputEl.value);
        if (digits === '') { inputEl.value = ''; return; }
        // Chặn không cho gõ quá 3 chữ số (giới hạn là 100) ngay khi đang nhập.
        const n = parseInt(digits, 10);
        inputEl.value = digits.length > 3 ? digits.slice(0, 3) : digits;
        if (Number.isFinite(n)) currentDays = n; // chưa clamp lúc gõ dở, chỉ clamp khi rời ô/lưu
    });

    inputEl.addEventListener('blur', () => {
        const n = parseInt(sanitizeDigits(inputEl.value), 10);
        currentDays = clamp(Number.isFinite(n) ? n : DEFAULT_DAYS);
        syncInput();
    });

    popoverEl.querySelector('[data-role="dec"]').addEventListener('click', () => {
        currentDays = clamp(currentDays - 1);
        syncInput();
    });
    popoverEl.querySelector('[data-role="inc"]').addEventListener('click', () => {
        currentDays = clamp(currentDays + 1);
        syncInput();
    });

    popoverEl.querySelector('[data-role="cancel"]').addEventListener('click', closePopover);
    popoverEl.querySelector('[data-role="remove"]').addEventListener('click', () => {
        emit('deadline-update-confirmed', { id, days: null });
        closePopover();
    });
    popoverEl.querySelector('[data-role="confirm"]').addEventListener('click', () => {
        const n = parseInt(sanitizeDigits(inputEl.value), 10);
        const finalDays = clamp(Number.isFinite(n) ? n : DEFAULT_DAYS);
        emit('deadline-update-confirmed', { id, days: finalDays });
        closePopover();
    });

    inputEl.focus();
    inputEl.select();
    setTimeout(() => {
        document.addEventListener('click', onOutsideClick, true);
        document.addEventListener('keydown', onKeyDown, true);
    }, 0);
};

on('deadline-editor-requested', openEditor);

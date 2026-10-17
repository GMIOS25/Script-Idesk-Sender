import { docCache } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { CONFIG, S } from '../config.js';
import { getVisibleItems, getReceivedItemKind, sleep } from '../utils/helpers.js';
import { emit } from '../core/bus.js';

const waitForItems = async (retries = 20) => {
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
        attempt++;
        await sleep(CONFIG.DELAY_MS.PAGE_CHANGE_POLL);
        items = getVisibleItems();
    }
    return items;
};

const visibleIds = () => getVisibleItems().map(el => el.getAttribute('data-id')).filter(Boolean).join(',');

const waitForPageChange = async (previousIds, retries = 40) => {
    for (let i = 0; i < retries; i++) {
        const ids = visibleIds();
        if (ids && ids !== previousIds) return true;
        await sleep(CONFIG.DELAY_MS.PAGE_CHANGE_POLL);
    }
    return false;
};

const isEnabled = (button) => !!button && !button.disabled && !button.classList.contains('disabled');

const currentPage = () => {
    const value = Number(document.querySelector(S.PAGING_CURRENT)?.textContent?.trim());
    return Number.isFinite(value) && value > 0 ? value : 1;
};

const collectItems = (items, page, documentIds, limit, reverse = false) => {
    let newCount = 0;
    for (let step = 0; step < items.length && documentIds.size < limit; step++) {
        // reverse = true: quét từ dòng cuối trang lên (cũ nhất trước) nhưng vẫn lưu
        // pageIndex theo đúng vị trí DOM (0 = dòng đầu) để sort hiển thị không sai.
        const pageIndex = reverse ? items.length - 1 - step : step;
        const el = items[pageIndex];
        const id = el.getAttribute('data-id');
        if (!id || documentIds.has(id)) continue;
        documentIds.add(id);
        const kind = getReceivedItemKind(el);
        const doc = docCache.get(id);
        if (!doc) {
            docCache.set(id, {
                id,
                signNumber: el.querySelector('.sender')?.textContent?.trim() || '',
                subject: el.querySelector('.subject')?.textContent?.trim() || '',
                status: 'idle',
                aiData: null,
                attachments: [],
                priority: null,
                creatorAcode: '',
                eligible: true,
                page,
                pageIndex,
                kind
            });
            newCount++;
        } else {
            doc.eligible = true;
            doc.page = page;
            doc.pageIndex = pageIndex;
            doc.kind = kind;
            doc.signNumber = doc.signNumber || el.querySelector('.sender')?.textContent?.trim() || '';
            doc.subject = doc.subject || el.querySelector('.subject')?.textContent?.trim() || '';
        }
    }
    return newCount;
};

const clickAndWaitForPage = async (button) => {
    const previousIds = visibleIds();
    button.click();
    return waitForPageChange(previousIds);
};

// Quét toàn bộ danh sách: quay về trang đầu rồi bấm "Trang sau" tới hết.
// Khi có giới hạn N: lấy N văn bản CŨ NHẤT (nằm cuối danh sách) — đi tới trang
// cuối rồi quét ngược bằng "Trang trước", trong mỗi trang lấy từ dòng cuối lên.
export const scanAllPages = async (maxDocuments = null) => {
    const requestedLimit = maxDocuments === null || maxDocuments === undefined || maxDocuments === ''
        ? Infinity
        : Number(maxDocuments);
    if (requestedLimit !== Infinity && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) {
        throw new Error('Số văn bản cần quét phải là số nguyên lớn hơn 0');
    }

    docCache.forEach(doc => { doc.eligible = false; });

    const seenPages = new Set();
    const documentIds = new Set();
    let totalNew = 0;

    if (requestedLimit !== Infinity) {
        // Đi tới trang cuối cùng (không có nút "Trang cuối" nên bấm "Trang sau" cho
        // tới khi bị vô hiệu). Ngắt an toàn nếu trang không đổi để tránh lặp vô hạn.
        while (true) {
            const nextButton = document.querySelector(S.PAGING_NEXT_BTN);
            if (!isEnabled(nextButton)) break;
            if (!await clickAndWaitForPage(nextButton)) break;
        }

        while (true) {
            const items = await waitForItems();
            if (!items.length) throw new Error('Không tìm thấy văn bản trên trang đang quét');

            const pageKey = items.map(el => el.getAttribute('data-id')).filter(Boolean).join(',');
            if (seenPages.has(pageKey)) {
                throw new Error('Danh sách không chuyển sang trang mới');
            }
            seenPages.add(pageKey);

            const page = currentPage();
            totalNew += collectItems(items, page, documentIds, requestedLimit, true);
            setStatus(`Đang quét trang ${page}: ${documentIds.size} văn bản`);
            emit('docs-changed');

            if (documentIds.size >= requestedLimit) break;

            const prevButton = document.querySelector(S.PAGING_PREV_BTN);
            if (!isEnabled(prevButton)) break;
            if (!await clickAndWaitForPage(prevButton)) {
                throw new Error(`Không tải được trang trước trang ${page}`);
            }
        }
    } else {
        const firstButton = document.querySelector(S.PAGING_FIRST_BTN);
        if (isEnabled(firstButton) && !await clickAndWaitForPage(firstButton)) {
            throw new Error('Không tải được trang đầu của danh sách');
        }

        while (true) {
            const items = await waitForItems();
            if (!items.length) throw new Error('Không tìm thấy văn bản trên trang đang quét');

            const pageKey = items.map(el => el.getAttribute('data-id')).filter(Boolean).join(',');
            if (seenPages.has(pageKey)) {
                throw new Error('Danh sách không chuyển sang trang mới');
            }
            seenPages.add(pageKey);

            const page = currentPage();
            totalNew += collectItems(items, page, documentIds, requestedLimit);
            setStatus(`Đang quét trang ${page}: ${documentIds.size} văn bản`);
            emit('docs-changed');

            const nextButton = document.querySelector(S.PAGING_NEXT_BTN);
            if (!isEnabled(nextButton)) break;
            if (!await clickAndWaitForPage(nextButton)) {
                throw new Error(`Không tải được trang sau trang ${page}`);
            }
        }
    }

    const summary = requestedLimit !== Infinity && documentIds.size >= requestedLimit
        ? `Đã quét ${documentIds.size} văn bản theo giới hạn (${seenPages.size} trang)`
        : `Đã quét hết ${seenPages.size} trang: ${documentIds.size} văn bản`;
    appendLog(`${summary} (${totalNew} mới)`);
    setStatus(summary);
    return documentIds.size;
};

const findRow = (id) => document.querySelector(`.messageListItem[data-id="${id}"]`);

// Đưa văn bản đã quét trở lại DOM trước khi điền. Số trang lưu lúc quét được
// dùng làm đường tắt; nếu danh sách vừa thay đổi, quét lại từ trang đầu để tìm.
export const showDocumentInList = async (id, preferredPage) => {
    if (findRow(id)) return true;

    const targetPage = Number(preferredPage);
    if (Number.isFinite(targetPage) && targetPage > 0) {
        for (let guard = 0; guard < 100 && currentPage() !== targetPage; guard++) {
            const selector = currentPage() < targetPage ? S.PAGING_NEXT_BTN : S.PAGING_PREV_BTN;
            const button = document.querySelector(selector);
            if (!isEnabled(button) || !await clickAndWaitForPage(button)) break;
        }
        if (findRow(id)) return true;
    }

    const firstButton = document.querySelector(S.PAGING_FIRST_BTN);
    if (isEnabled(firstButton) && !await clickAndWaitForPage(firstButton)) return false;
    while (true) {
        if (findRow(id)) return true;
        const nextButton = document.querySelector(S.PAGING_NEXT_BTN);
        if (!isEnabled(nextButton) || !await clickAndWaitForPage(nextButton)) return false;
    }
};

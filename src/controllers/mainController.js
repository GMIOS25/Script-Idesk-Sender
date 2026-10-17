import { CONFIG } from '../config.js';
import { docCache, state } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { sleep, applyDeadlineDays, compareReceivedPositionDesc, toStringArray } from '../utils/helpers.js';
import { ensureDocDetails } from '../services/api.js';
import { callAIBackend, lookupDocument, patchDocument, recordFeedback } from '../services/ai.js';
import { autoFillAndSubmit } from '../automation/formFiller.js';
import { primeUnitTreeDirect } from '../automation/unitPrimer.js';
import { scanAllPages, showDocumentInList } from '../services/scanner.js';
import { on, emit } from '../core/bus.js';

export const getPendingDocumentIds = () => [...docCache.entries()]
    .filter(([, doc]) => doc.eligible && (doc.status === 'idle' || doc.status === 'ai_error'))
    .sort(([, left], [, right]) => compareReceivedPositionDesc(left, right))
    .map(([id]) => id);

export const scanAndSendAll = async ({ limit = null } = {}) => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    state.isProcessing = true;
    let found;
    try {
        found = await scanAllPages(limit);
    } catch (err) {
        appendLog(`Lỗi quét phân trang: ${err.message}`);
        setStatus(`Lỗi quét phân trang: ${err.message}`);
        state.isProcessing = false;
        return;
    }
    if (!found) {
        state.isProcessing = false;
        return;
    }

    // Cho phép thử lại VB từng lỗi AI: trước đây chỉ 'idle' được đưa vào nên một
    // lỗi mạng/503 thoáng qua làm VB biến mất khỏi automation cả phiên.
    const pendingIds = getPendingDocumentIds();

    if (pendingIds.length === 0) {
        setStatus(`Khong co van ban moi can gui AI.`);
        state.isProcessing = false;
        return;
    }

    let success = 0, errors = 0;
    const total = pendingIds.length;
    updateProgress(0, total);

    try {
        for (let i = 0; i < pendingIds.length; i++) {
            const id = pendingIds[i];
            const doc = docCache.get(id);
            if (!doc) continue;

            const processingStartedAt = performance.now();
            doc.processingTimeMs = null;
            doc.status = 'pending';
            emit('docs-changed');
            updateProgress(i, total);

            try {
                const fullDoc = await ensureDocDetails(id);

                // Chỉ cần chạy 1 lần cho cả phiên: khi văn bản đầu tiên được mở, hệ thống
                // đã tự có exeacode (qua view.cpx) để lấy cây đơn vị của đúng xã đang
                // đăng nhập, phục vụ phần chỉnh sửa "Đơn vị xử lý"/"Đơn vị phối hợp".
                // Mồi thành công (chuyển false -> true) thì emit thêm 'docs-changed' để
                // vẽ lại các card ĐÃ hiện trước đó ngay trong batch này (nếu có) — nhờ đó
                // gợi ý đơn vị (suggestUnitLabel(), dựa trên unitCache) xuất hiện ngay cả
                // với văn bản đầu tiên, không cần đợi văn bản kế tiếp mới trigger vẽ lại.
                if (!state.unitsPrimed) {
                    const justPrimed = await primeUnitTreeDirect();
                    if (justPrimed) emit('docs-changed');
                }

                if (!fullDoc.attachments || fullDoc.attachments.length === 0) {
                    throw new Error('Van ban khong co file dinh kem');
                }

                // Tra cache truoc qua /documents/lookup (docs/en/docflow.md muc 5) de
                // tranh goi lai OCR/AI cho van ban da xu ly xong tu truoc. Chi dung ket
                // qua khi state = "completed"; moi truong hop khac (not_found,
                // processing, failed_retryable, hoac loi lookup) deu roi ve /documents/process
                // nhu luong cu, khong thay doi hanh vi hien tai.
                let aiData = null;
                try {
                    const lookupResult = await lookupDocument(fullDoc);
                    if (lookupResult && lookupResult.found && lookupResult.state === 'completed' && lookupResult.data) {
                        aiData = lookupResult.data;
                        appendLog(`${doc.signNumber}: da co san tu /documents/lookup, bo qua goi AI`);
                    }
                } catch (lookupErr) {
                    appendLog(`${doc.signNumber}: lookup that bai (${lookupErr.message}), tiep tuc qua /documents/process`);
                }

                doc.aiData = aiData || await callAIBackend(fullDoc);
                doc.status = 'ai_done';
                success++;
            } catch (err) {
                doc.status = 'ai_error';
                errors++;
                appendLog(`${doc.signNumber}: ${err.message}`);
            }
            doc.processingTimeMs = performance.now() - processingStartedAt;
            emit('docs-changed');
            updateProgress(i + 1, total);

            // Backend gioi han rate theo cua so truot (mock_backend.py: 30 request/60s
            // cho tung endpoint). Giữ khoảng nghỉ giữa các lượt gửi để tránh 429.
            if (i < pendingIds.length - 1) await sleep(CONFIG.DELAY_MS.BETWEEN_AI_CALLS);
        }
    } finally {
        // Luôn nhả khoá kể cả khi có exception ngoài tầm try của từng VB, nếu
        // không state.isProcessing kẹt true và tool bị khoá tới khi reload.
        state.isProcessing = false;
    }

    setStatus(`Hoan tat AI: ${success} thanh cong, ${errors} loi`);
    updateProgress(total, total);
};

export const runFillOnAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    // Đọc lựa chọn từ state thay vì DOM: re-render 'docs-changed' (chạy sau mỗi VB
    // trong vòng lặp) không phá mất lựa chọn người dùng. Mặc định: mọi VB chưa
    // fill_done đều được chọn.
    const selectedIds = [];
    docCache.forEach((doc, id) => {
        if (!doc.eligible) return;
        const selected = doc.selected !== undefined ? doc.selected : doc.status !== 'fill_done';
        if (selected) selectedIds.push(id);
    });
    // Xử lý từ trang cuối về trang đầu để việc một văn bản biến mất sau khi
    // chuyển không làm thay đổi số trang của các văn bản chưa xử lý phía trước.
    selectedIds.sort((a, b) => compareReceivedPositionDesc(docCache.get(a), docCache.get(b)));
    if (selectedIds.length === 0) return alert('Hay chon it nhat 1 van ban!');

    state.isProcessing = true;
    let success = 0, errors = 0;
    const total = selectedIds.length;
    updateProgress(0, total);

    try {
        for (let i = 0; i < selectedIds.length; i++) {
            const id = selectedIds[i];
            const doc = docCache.get(id);
            if (!doc || (!doc.aiData && doc.kind !== 'update')) {
                errors++;
                appendLog(`${doc ? doc.signNumber : id}: khong co du lieu AI de dien`);
                updateProgress(i + 1, total);
                continue;
            }

            setStatus(`Dang dien: ${doc.signNumber || id} (${i + 1}/${total})`);
            updateProgress(i, total);

            try {
                // Chốt "phải có đơn vị xử lý chính" được tính lại từ giá trị hiện
                // tại, KHÔNG dùng flag requires_manual_mapping — flag đó được ghi
                // một lần và không bao giờ xoá, từng khoá vĩnh viễn luồng sửa tay.
                const mainUnits = toStringArray(doc.aiData?.processing_unit);
                if (doc.kind !== 'update' && mainUnits.length === 0) {
                    throw new Error('Chưa có đơn vị xử lý chính; hãy chọn trên thẻ review trước khi chuyển');
                }
                if (!await showDocumentInList(id, doc.page)) {
                    throw new Error(`Không tìm thấy văn bản ${doc.signNumber || id} trong danh sách hiện tại`);
                }
                await autoFillAndSubmit(id, doc.aiData);
                if (doc.kind !== 'update' && doc.aiData?._router) {
                    try {
                        await recordFeedback(doc);
                    } catch (feedbackErr) {
                        // Giao dịch iDesk đã hoàn tất; không đánh dấu fill lỗi chỉ vì
                        // feedback bị gián đoạn. Người dùng vẫn thấy cảnh báo để retry.
                        appendLog(`${doc.signNumber || id}: chuyển iDesk xong nhưng ghi feedback thất bại (${feedbackErr.message})`);
                    }
                }
                doc.status = 'fill_done';
                doc.fillError = null;
                doc.selected = false;
                success++;
            } catch (err) {
                doc.status = 'fill_error';
                doc.fillError = err.message;
                errors++;
                appendLog(`Loi ${doc.signNumber}: ${err.message}`);
            }
            emit('docs-changed');
            updateProgress(i + 1, total);
            await sleep(CONFIG.DELAY_MS.BETWEEN_DOCS);
        }
    } finally {
        state.isProcessing = false;
    }

    setStatus(`Ket thuc tu dong dien: ${success}/${total} thanh cong`);
    updateProgress(total, total);
};

export const updateProgress = (current, total) => {
    emit('progress', { current, total });
};

// Đồng bộ chỉnh sửa tay của người dùng (đơn vị xử lý/phối hợp, hạn thực hiện...)
// lên backend qua PATCH /documents/{stt} (patchDocument() trong services/ai.js),
// ngay sau khi đã cập nhật doc.aiData trong RAM.
const persistAiDataPatch = async (doc, fields) => {
    if (doc?.aiData?._router) {
        doc.aiData._router.edited = true;
        return;
    }
    if (!doc || !doc.aiData || !doc.aiData.stt) return;
    try {
        await patchDocument(doc.aiData.stt, fields);
    } catch (err) {
        appendLog(`${doc.signNumber || doc.aiData.stt}: luu chinh sua len backend that bai (${err.message}) - thay doi van duoc giu tam trong phien lam viec, thu lai sau`);
    }
};

// Người dùng bấm "×" trên 1 chip đơn vị xử lý chính/phối hợp/lãnh đạo theo dõi để xoá.
on('unit-remove-requested', ({ id, kind, value }) => {
    const doc = docCache.get(id);
    if (!doc || !doc.aiData) return;

    if (kind === 'leader') {
        doc.aiData.monitoring_leader = null;
        emit('docs-changed');
        persistAiDataPatch(doc, { monitoring_leader: null });
    } else {
        const field = kind === 'main' ? 'processing_unit' : 'coordinating_units';
        doc.aiData[field] = toStringArray(doc.aiData[field]).filter(u => u !== value);
        emit('docs-changed');
        persistAiDataPatch(doc, { [field]: doc.aiData[field] });
    }
});

// Người dùng chọn xong 1 đơn vị/người (thủ công qua picker hoặc bấm "Gợi ý").
on('unit-add-confirmed', ({ id, kind, label, replaceValue }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};

    if (kind === 'leader') {
        doc.aiData.monitoring_leader = label;
        emit('docs-changed');
        persistAiDataPatch(doc, { monitoring_leader: label });
    } else {
        const field = kind === 'main' ? 'processing_unit' : 'coordinating_units';
        let arr = toStringArray(doc.aiData[field]);
        if (replaceValue) arr = arr.filter(v => v !== replaceValue);
        if (!arr.includes(label)) arr.push(label);
        doc.aiData[field] = arr;
        emit('docs-changed');
        persistAiDataPatch(doc, { [field]: arr });
    }
});

// Người dùng chỉnh số ngày hoặc bỏ hạn thực hiện qua popover (deadlineEditor).
on('deadline-update-confirmed', ({ id, days }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};
    doc.aiData.implementation_deadline = days === null
        ? null
        : applyDeadlineDays(doc.aiData.implementation_deadline, days);
    emit('docs-changed');
    persistAiDataPatch(doc, { implementation_deadline: doc.aiData.implementation_deadline });
});

on('scan-requested', scanAndSendAll);
on('fill-requested', runFillOnAll);

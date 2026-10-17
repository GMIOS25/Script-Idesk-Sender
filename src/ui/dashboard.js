import { docCache } from '../state.js';
import { CSS_STYLES } from './styles.js';
import { appendLog } from '../utils/logger.js';
import { compareReceivedPositionDesc, stripAgencySuffix, resolveDeadlineDate, resolvePriority, toStringArray } from '../utils/helpers.js';
import { getAttachmentPreviewUrl, selectAttachment } from '../utils/attachment.js';
import { on, emit } from '../core/bus.js';
import { suggestUnitLabel } from './unitPicker.js'; // cũng đăng ký lắng nghe 'unit-picker-requested' (side-effect khi import)
import './deadlineEditor.js'; // side-effect: đăng ký lắng nghe 'deadline-editor-requested'

let logPanel = null;

export const createDashboard = () => {
    if (document.getElementById('idesk-rpa-hub')) return;

    GM_addStyle(CSS_STYLES);

    const hub = document.createElement('div');
    hub.id = 'idesk-rpa-hub';
    hub.innerHTML = `
        <div class="rpa-header">
            <div class="rpa-title">
                Nhận và chuyển văn bản trên trục công văn <span class="badge-count" id="rpa-doc-count">0</span>
            </div>
            <div class="rpa-header-actions">
                <button id="rpa-btn-toggle-log">Console</button>
                <button id="rpa-btn-minimize">Thu nhỏ</button>
            </div>
        </div>
        <div class="rpa-body">
            <div class="rpa-toolbar">
                <button class="rpa-btn rpa-btn-primary" id="rpa-btn-scan">Bắt đầu</button>
                <label class="rpa-scan-limit" for="rpa-scan-limit-input">
                    <span>Số văn bản</span>
                    <input type="text" inputmode="numeric" id="rpa-scan-limit-input" placeholder="Tất cả" aria-label="Số văn bản tối đa cần quét">
                </label>
                <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">Duyệt</button>
            </div>
            <div class="rpa-feed-wrap">
                <div class="rpa-card-feed" id="rpa-card-feed">
                    <div class="rpa-empty-state">Nhấn "Bắt đầu" để bắt đầu...</div>
                </div>
            </div>
            <div class="rpa-log-panel" id="rpa-log-panel"><div id="rpa-log-body"></div></div>
        </div>
        <div class="rpa-footer">
            <span class="rpa-status-text" id="rpa-footer-status">Sẵn sàng. Nhấn "Bắt đầu" để bắt đầu.</span>
            <div class="rpa-progress-wrap">
                <span class="rpa-average-time" id="rpa-average-time">TB: --</span>
                <span class="rpa-progress-text" id="rpa-progress-text">0/0</span>
                <div class="rpa-progress-bar"><div class="rpa-progress-fill" id="rpa-progress-fill"></div></div>
            </div>
        </div>
    `;
    document.body.appendChild(hub);
    logPanel = document.getElementById('rpa-log-panel');

    makeDraggable(hub);

    document.getElementById('rpa-btn-minimize').addEventListener('click', () => {
        const minimized = hub.classList.toggle('minimized');
        document.getElementById('rpa-btn-minimize').textContent = minimized ? 'Phóng to' : 'Thu nhỏ';
    });
    document.getElementById('rpa-btn-toggle-log').addEventListener('click', () => logPanel.classList.toggle('open'));
    const scanLimitInput = document.getElementById('rpa-scan-limit-input');
    scanLimitInput.addEventListener('input', () => {
        scanLimitInput.value = scanLimitInput.value.replace(/[^\d]/g, '');
    });
    document.getElementById('rpa-btn-scan').addEventListener('click', () => {
        const rawLimit = scanLimitInput.value.trim();
        const limit = rawLimit === '' ? null : Number.parseInt(rawLimit, 10);
        if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) {
            alert('Số văn bản cần quét phải lớn hơn 0. Để trống nếu muốn quét tất cả.');
            scanLimitInput.focus();
            return;
        }
        emit('scan-requested', { limit });
    });
    document.getElementById('rpa-btn-fill-all').addEventListener('click', () => emit('fill-requested'));

    // Delegation cho nút "×" (xoá) và "+" (mở dropdown chọn) trên chip đơn vị xử lý
    // chính/phối hợp. Gắn 1 lần duy nhất vì #rpa-card-feed không bị thay thế, chỉ
    // innerHTML con của nó đổi mỗi lần updateDashboard().
    document.getElementById('rpa-card-feed').addEventListener('click', (e) => {
        // Ghi nhận lựa chọn checkbox vào state ngay khi người dùng bấm, để các
        // lần re-render sau (docs-changed) giữ nguyên lựa chọn thay vì suy lại
        // từ doc.status.
        const check = e.target.closest('.rpa-row-check');
        if (check) {
            const doc = docCache.get(check.getAttribute('data-id'));
            if (doc) doc.selected = check.checked;
            return;
        }

        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');

        if (action === 'remove-main') {
            emit('unit-remove-requested', { id, kind: 'main', value: btn.getAttribute('data-value') });
        } else if (action === 'remove-co') {
            emit('unit-remove-requested', { id, kind: 'co', value: btn.getAttribute('data-value') });
        } else if (action === 'remove-leader') {
            emit('unit-remove-requested', { id, kind: 'leader' });
        } else if (action === 'add-main') {
            emit('unit-picker-requested', { id, kind: 'main', anchor: btn });
        } else if (action === 'add-co') {
            emit('unit-picker-requested', { id, kind: 'co', anchor: btn });
        } else if (action === 'add-leader') {
            emit('unit-picker-requested', { id, kind: 'leader', anchor: btn });
        } else if (action === 'edit-deadline') {
            emit('deadline-editor-requested', { id, anchor: btn });
        } else if (action === 'apply-suggest-main') {
            emit('unit-add-confirmed', { id, kind: 'main', label: btn.getAttribute('data-value'), replaceValue: btn.getAttribute('data-raw') });
        } else if (action === 'apply-suggest-leader') {
            emit('unit-add-confirmed', { id, kind: 'leader', label: btn.getAttribute('data-value') });
        } else if (action === 'apply-suggest-co') {
            // replaceValue = chuỗi thô AI trả về ban đầu, cần loại khỏi mảng
            // coordinating_units trước khi thêm giá trị đã khớp vào, nếu không
            // sẽ còn lại cả 2 bản (thô + đã khớp) cùng lúc. Xử lý ở
            // mainController.js (handler 'unit-add-confirmed', nhánh kind 'co').
            emit('unit-add-confirmed', { id, kind: 'co', label: btn.getAttribute('data-value'), replaceValue: btn.getAttribute('data-raw') });
        }
    });

    on('docs-changed', updateDashboard);
    on('progress', ({ current, total }) => setProgress(current, total));

    appendLog('Khởi tạo Nhận và chuyển văn bản trên trục công văn Card Feed UI v3.0');
};

export const makeDraggable = (elmnt) => {
    const header = elmnt.querySelector('.rpa-header');
    let startX, startY, startTop, startLeft, dragging = false;

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = elmnt.getBoundingClientRect();
        startTop = rect.top;
        startLeft = rect.left;
        elmnt.style.top = startTop + 'px';
        elmnt.style.left = startLeft + 'px';
        elmnt.style.bottom = 'auto';
        elmnt.style.right = 'auto';
        elmnt.classList.add('rpa-dragging');
        header.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        elmnt.style.left = Math.min(Math.max(startLeft + dx, -elmnt.offsetWidth + 80), window.innerWidth - 60) + 'px';
        elmnt.style.top = Math.min(Math.max(startTop + dy, 0), window.innerHeight - 50) + 'px';
    });

    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        elmnt.classList.remove('rpa-dragging');
        try { header.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
};

/**
 * Escape HTML entities for safe rendering inside title/attributes.
 */
const escHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&' + 'amp;')
        .replace(/"/g, '&' + 'quot;')
        .replace(/'/g, '&' + '#39;')
        .replace(/</g, '&' + 'lt;')
        .replace(/>/g, '&' + 'gt;');
};

const escAttr = escHtml;
const formatSeconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} giây`;

export const updateDashboard = () => {
    const cardFeed = document.getElementById('rpa-card-feed');
    if (!cardFeed) return;

    const countEl = document.getElementById('rpa-doc-count');
    const documentCount = Array.from(docCache.values()).filter(doc => doc.eligible).length;
    if (countEl) countEl.textContent = documentCount.toString();

    const completedTimes = Array.from(docCache.values())
        .filter(doc => doc.eligible && doc.aiData && Number.isFinite(doc.processingTimeMs))
        .map(doc => doc.processingTimeMs);
    const averageEl = document.getElementById('rpa-average-time');
    if (averageEl) {
        const averageMs = completedTimes.reduce((sum, time) => sum + time, 0) / completedTimes.length;
        averageEl.textContent = completedTimes.length ? `TB: ${formatSeconds(averageMs)}/văn bản` : 'TB: --';
    }

    if (documentCount === 0) {
        cardFeed.innerHTML = `<div class="rpa-empty-state">Nhấn "Bắt đầu" để bắt đầu...</div>`;
        return;
    }

    let html = '';
    const documents = [...docCache.entries()]
        .filter(([, doc]) => doc.eligible)
        .sort(([, left], [, right]) => compareReceivedPositionDesc(left, right));
    for (const [id, doc] of documents) {
        const statusMap = {
            'idle': ['rpa-badge-idle', 'Chưa gửi'],
            'pending': ['rpa-badge-pending', 'Đang gửi'],
            'ai_done': ['rpa-badge-success', 'Đã phân tích'],
            'ai_error': ['rpa-badge-error', 'Lỗi AI'],
            'fill_done': ['rpa-badge-sent', 'Đã điền'],
            'fill_error': ['rpa-badge-error', 'Lỗi điền'],
        };
        const s = statusMap[doc.status] || statusMap.idle;

        // Lựa chọn checkbox nằm ở state (doc.selected), không suy lại từ status, để
        // việc re-render khi 'docs-changed' không phá mất lựa chọn người dùng.
        const isSelected = doc.selected !== undefined ? doc.selected : doc.status !== 'fill_done';

        const ai = doc.aiData || {};
        const summary = ai.summary || 'Chưa có tóm tắt AI...';
        const reason = ai.reason || '';
        const routerNotes = ai.notes
            ? `<div class="rpa-router-notes"><strong>Cần kiểm tra:</strong><br>${escHtml(ai.notes).replace(/\n/g, '<br>')}</div>`
            : '';

        // --- Metadata values ---
        const signNumber = doc.signNumber || ai.document_number || '---';
        const docType = doc.category || ai.document_type || '';
        const agency = stripAgencySuffix(doc.author || ai.issuing_agency || '---');
        const signer = doc.signer || ai.signer || '---';
        const bookSerial = doc.book ? doc.book.serialNumber || '---' : '---';
        const docDate = doc.docDateStr || '';

        // --- Assignment ---
        const mainUnits = toStringArray(ai.processing_unit);
        const leader = ai.monitoring_leader || null;
        // `implementation_deadline` la string|null theo METADATA_SCHEMA.md (#11), khong
        // phai luon la so ngay — resolveDeadlineDate() xu ly moi dang hop le.
        const daysStr = resolveDeadlineDate(ai.implementation_deadline).displayText;
        const coUnits = ai.coordinating_units;

        // Gợi ý đơn vị THẬT khớp gần đúng với chuỗi thô AI trả về — tính NGAY
        // lúc render card review, KHÔNG đợi tới lúc bấm "Duyệt" mới so khớp
        // trên DOM thật như automation/treeSelect.js (xem suggestUnitLabel()
        // trong ui/unitPicker.js, dùng chung 1 thuật toán khớp với lúc fill).
        // unitCache chưa sẵn sàng hoặc không có ứng viên nào khớp -> null,
        // khi đó KHÔNG hiện gợi ý gì (đúng yêu cầu, không đoán bừa).
        const leaderSuggestion = leader ? suggestUnitLabel(leader) : null;

        // Nút "Gợi ý": hiện NGAY cạnh chip hiện tại (không cần mở rpa-unit-picker),
        // chỉ xuất hiện khi suggestUnitLabel() tìm được 1 khớp thật từ unitCache.
        // Bấm là áp dụng luôn (emit 'unit-add-confirmed' y hệt như đang tự chọn
        // thủ công qua picker) — 1 click, không cần xác nhận thêm lần nữa.
        const suggestBtnHtml = (action, suggestion, extraAttr = '') => suggestion
            ? `<button type="button" class="rpa-unit-suggest" data-action="${action}" data-id="${id}" data-value="${escAttr(suggestion)}" ${extraAttr} title="Khớp trên hệ thống: ${escAttr(suggestion)}">
                   <span class="rpa-unit-suggest-label">Gợi ý: ${escHtml(suggestion)}</span>
               </button>`
            : '';

        // Đơn vị xử lý chính cho phép nhiều giá trị, mỗi giá trị là một chip có
        // thể sửa qua gợi ý hoặc xoá riêng; nút "+ Thêm" luôn nằm cuối danh sách.
        const mainChip = (value) => `
            <span class="rpa-unit-pill" title="${escAttr(value)}">
                <span class="rpa-unit-pill-text">${escHtml(value)}</span>
                <button type="button" class="rpa-unit-remove" data-action="remove-main" data-id="${id}" data-value="${escAttr(value)}" aria-label="Xoá">×</button>
            </span>${suggestBtnHtml('apply-suggest-main', suggestUnitLabel(value), `data-raw="${escAttr(value)}"`)}`;
        const mainUnitHtml = mainUnits.map(mainChip).join('') +
            `<button type="button" class="rpa-unit-pill rpa-unit-add" data-action="add-main" data-id="${id}">+ Thêm</button>`;

        // Lãnh đạo theo dõi chỉ được chọn 1, dùng chung unitCache/picker nạp từ
        // fbyvsphere.cpx (đã gồm cả "unit"/"dept" lẫn "alias" - người/chức danh
        // cụ thể) nên không cần cây dữ liệu riêng.
        const leaderHtml = leader
            ? `<span class="rpa-unit-pill" title="${escAttr(leader)}">
                   <span class="rpa-unit-pill-text">${escAttr(leader)}</span>
                   <button type="button" class="rpa-unit-remove" data-action="remove-leader" data-id="${id}" aria-label="Xoá">×</button>
               </span>${suggestBtnHtml('apply-suggest-leader', leaderSuggestion)}`
            : `<button type="button" class="rpa-unit-pill rpa-unit-add" data-action="add-leader" data-id="${id}">+ Thêm</button>`;

        // Đơn vị phối hợp: chọn nhiều, luôn hiện chip "+" ở cuối để thêm nếu thiếu.
        // Mỗi phần tử có gợi ý RIÊNG (so khớp độc lập từng chuỗi thô trong mảng),
        // kèm data-raw để mainController biết cần thay thế đúng phần tử nào khi
        // người dùng bấm "Gợi ý" (xem action 'apply-suggest-co' phía trên).
        const addCoBtn = `<button type="button" class="rpa-unit-pill rpa-unit-add" data-action="add-co" data-id="${id}">+ Thêm</button>`;
        const coChip = (value) => `
            <span class="rpa-unit-pill" title="${escAttr(value)}">
                <span class="rpa-unit-pill-text">${escAttr(value)}</span>
                <button type="button" class="rpa-unit-remove" data-action="remove-co" data-id="${id}" data-value="${escAttr(value)}" aria-label="Xoá">×</button>
            </span>${suggestBtnHtml('apply-suggest-co', suggestUnitLabel(value), `data-raw="${escAttr(value)}"`)}`;

        let coUnitsPills;
        if (Array.isArray(coUnits)) {
            coUnitsPills = coUnits.map(coChip).join('') + addCoBtn;
        } else if (coUnits) {
            // docs/en/docflow.md muc 4 cam ket coordinating_units luon la mang (ke ca
            // []), khong bao gio la string/null. Neu roi vao day tuc BE dang vi pham
            // hop dong API — bao cho biet thay vi am tham "sua" du lieu nhu binh thuong.
            if (!doc._coUnitsContractWarned) {
                appendLog(`⚠ coordinating_units cua VB "${doc.signNumber || id}" khong phai mang (vi pham docflow.md muc 4, nhan duoc kieu ${typeof coUnits}): ${JSON.stringify(coUnits)}`);
                doc._coUnitsContractWarned = true;
            }
            coUnitsPills = coChip(`⚠ ${String(coUnits).trim()}`) + addCoBtn;
        } else {
            coUnitsPills = addCoBtn;
        }

        // Độ khẩn là metadata gốc của iDesk (ed.priority trong view.cpx), không
        // thuộc dữ liệu AI. Giá trị chưa tải thì không hiển thị để tránh gắn nhầm
        // "Bình thường" trước khi nhận được chi tiết văn bản.
        const priority = resolvePriority(doc.priority);

        // --- Build header badge chips ---
        const escSign = escAttr(signNumber);
        const escType = escAttr(docType);
        const escAgency = escAttr(agency);
        const escSigner = escAttr(signer);
        const escBook = escAttr(bookSerial);

        const chipSign = `<span class="rpa-badge-chip is-signnumber" title="${escSign}">${escSign}</span>`;
        const chipType = docType ? `<span class="rpa-badge-chip" title="${escType}">${escType}</span>` : '';
        const chipAgency = agency !== '---' ? `<span class="rpa-badge-chip" title="${escAgency}">CQ: ${escAgency}</span>` : '';
        const chipSigner = signer !== '---' ? `<span class="rpa-badge-chip" title="${escSigner}">Ký: ${escSigner}</span>` : '';
        const chipBook = bookSerial !== '---' ? `<span class="rpa-badge-chip" title="Số: ${escBook}">Sổ: ${escBook}</span>` : '';

        const chipDate = docDate ? `<span class="rpa-badge-chip" title="${docDate}">${docDate}</span>` : '';
        const chipProcessingTime = doc.aiData && Number.isFinite(doc.processingTimeMs)
            ? `<span class="rpa-badge-chip is-processing-time" title="Thời gian từ lúc gửi đến khi nhận kết quả">Xử lý: ${formatSeconds(doc.processingTimeMs)}</span>`
            : '';
        const chipPriority = priority
            ? `<span class="rpa-badge-chip${priority.level > 0 ? ' is-priority' : ''}${priority.isCritical ? ' is-critical' : ''}" title="Độ khẩn: ${escAttr(priority.label)}">${escHtml(priority.label)}</span>`
            : '';
        const kindLabel = { update: 'Văn bản cập nhật', book: 'Đã vào sổ' }[doc.kind] || 'Văn bản thường';
        const chipKind = `<span class="rpa-badge-chip is-kind is-${doc.kind || 'ordinary'}">${kindLabel}</span>`;
        const mainAttachment = selectAttachment(doc, true);
        const previewUrl = getAttachmentPreviewUrl(mainAttachment);
        const previewLink = previewUrl
            ? `<a class="rpa-preview-link" href="${escAttr(previewUrl)}" target="_blank" rel="noopener noreferrer" title="${escAttr(mainAttachment.name || 'Văn bản chính')}">Xem văn bản chính</a>`
            : '';

        html += `
            <div data-id="${id}" class="rpa-doc-card">
                <div class="rpa-card-header">
                    <div class="rpa-card-header-left">
                        <input type="checkbox" class="rpa-row-check" data-id="${id}" ${isSelected ? 'checked' : ''}>
                        ${chipSign}
                        ${chipKind}
                        ${chipType}
                        ${chipPriority}
                        ${chipAgency}
                        ${chipSigner}
                        ${chipBook}
                        ${chipDate}
                        ${chipProcessingTime}
                    </div>
                    <div class="rpa-card-header-right">
                        <span class="rpa-badge ${s[0]}"${doc.status === 'fill_error' && doc.fillError ? ` title="${escAttr(doc.fillError)}"` : ''}>${s[1]}</span>
                    </div>
                </div>

                <div class="rpa-card-body">
                    <div class="rpa-card-subject">
                        <span class="rpa-subject-label">Trích yếu:</span> ${escHtml(doc.subject || ai.subject || '---')}
                        ${previewLink}
                    </div>

                    <div class="rpa-card-summary">
                        <div class="rpa-summary-title">TÓM TẮT AI</div>
                        <div class="rpa-summary-text">${escHtml(summary)}</div>
                        ${reason ? `<div class="rpa-reason-line"><strong>Lý do định tuyến:</strong> ${escHtml(reason)}</div>` : ''}
                        ${routerNotes}
                    </div>

                    <div class="rpa-assignment-grid">
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Đơn vị xử lý chính</span>
                            <div class="rpa-unit-tags">${mainUnitHtml}</div>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Đơn vị phối hợp</span>
                            <div class="rpa-unit-tags">${coUnitsPills}</div>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Lãnh đạo theo dõi</span>
                            <div class="rpa-unit-tags">${leaderHtml}</div>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Hạn thực hiện</span>
                            <button type="button" class="rpa-deadline-btn" data-action="edit-deadline" data-id="${id}" title="Bấm để chỉnh số ngày hạn thực hiện">
                                <span class="rpa-deadline-btn-text">${daysStr}</span>
                                <svg class="rpa-deadline-btn-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    cardFeed.innerHTML = html;
};

// UI sở hữu trọn vẹn progress bar. Logic chỉ emit('progress', {current, total}), không tự query DOM nữa.
export const setProgress = (current, total) => {
    const fill = document.getElementById('rpa-progress-fill');
    const text = document.getElementById('rpa-progress-text');
    if (fill && text) {
        fill.style.width = (total > 0 ? Math.round((current / total) * 100) : 0) + '%';
        text.textContent = `${current}/${total}`;
    }
};

import { documents, context, scanDocuments, ensureDocumentDetails, showDocument, isDocumentEligible, chooseAttachment, downloadPDF, primeDirectories, getTenantId, fetchLookupPayload, searchOrganizations } from './idesk.js';
import { createSenderClient, documentMetadata } from './provider.js';
import { createReview, assignRecipient, setRecipient, setDecision, setDecisionRecipient, buildFeedback } from './review.js';
import { prepareOutgoingForm, FIELD_DEFINITIONS } from './form.js';
import { renderDocumentList, renderReview, renderRecipientPanel, escapeHtml } from './view.js';
import { styles } from './styles.js';
import { makePanelDraggable } from './drag.js';

const invalidate = session => { session.reviewed = false; session.feedbackId = ''; session.applied = null; session.error = ''; };

export const refreshResolution = async (session, onStatus = () => {}) => {
    invalidate(session);
    const response = await session.client.resolveJob(session.jobId, session.review.result, { onStatus });
    session.jobId = response.jobId;
    session.review = createReview(response.result);
    session.searchResults = null;
    session.existingSummary = '';
    session.directoryWarning = 'Danh bạ đã được đối chiếu lại; kiểm tra danh sách và chọn lại các trường người nhận.';
    return response;
};

const supplementOrganizations = async (session, queries, { search = searchOrganizations, onStatus = () => {} } = {}) => {
    const found = new Map(), warnings = [];
    const unique = [...new Set(queries.filter(q => typeof q === 'string' && q.trim().length >= 2 && q.length <= 256))];
    if (!unique.length) return { found: 0, failed: false };
    const deadline = Date.now() + 30000;
    for (const query of unique.slice(0, 10)) {
        if (Date.now() >= deadline) { warnings.push('Chưa tra hết đơn vị; có thể tra trực tiếp từng tên.'); break; }
        onStatus(`Đang tìm đơn vị trên iDesk: ${query}`);
        try {
            const result = await search(query);
            for (const node of result.elements) found.set(`${node.sphere}:${node.code}`, node);
            warnings.push(...result.warnings);
        } catch (error) { warnings.push(`Tra cứu iDesk chưa thành công: ${error.message}`); break; }
    }
    if (unique.length > 10) warnings.push('Còn đơn vị chưa tra; có thể tra trực tiếp từng tên.');
    if (found.size) {
        // Import proves existence only. The backend resolver decides correspondence.
        const imported = await session.client.syncOrganizations([...found.values()], 'search');
        const old = session.review.result;
        if (old.registry_version !== imported.registry_version || old.alias_policy_version !== imported.alias_policy_version) {
            await refreshResolution(session, onStatus);
            warnings.push('Danh bạ đã cập nhật và đối chiếu lại; cần rà soát danh sách mới.');
        }
    }
    session.directoryWarning = warnings.join(' ');
    return { found: found.size, failed: warnings.some(w => w.startsWith('Tra cứu iDesk chưa thành công')) };
};

export const enrichUnresolvedOrganizations = async (session, options = {}) => {
    const queries = session.review.result.unresolved.filter(item => ['unit', 'organization'].includes(item.kind)).map(item => item.raw);
    try { return await supplementOrganizations(session, queries, options); }
    catch (error) { session.directoryWarning = `Chưa cập nhật được danh bạ: ${error.message}`; return { found: 0, failed: true }; }
};

export const searchSessionRecipients = async (session, query, options = {}) => {
    let body = await session.client.searchRecipients(query);
    const stale = () => body.registry_version !== session.review.result.registry_version || body.alias_policy_version !== session.review.result.alias_policy_version;
    if (stale()) { await refreshResolution(session, options.onStatus); body = await session.client.searchRecipients(query); }
    if (!body.items.length || options.forceLive) {
        const supplemented = await supplementOrganizations(session, [query], options);
        if (supplemented.failed) throw new Error(session.directoryWarning);
        body = await session.client.searchRecipients(query);
    }
    if (stale()) throw new Error('Danh bạ đang thay đổi; bấm Đối chiếu lại danh bạ rồi thử lại.');
    return body;
};

export const refreshSessionDocument = (session, doc) => {
    session.doc = doc;
    const existing = (doc.attachments || []).find(item => item.contentUid === session.attachment?.contentUid);
    session.attachment = existing && chooseAttachment({ ...doc, attachments: [existing] })
        ? existing : chooseAttachment(doc);
    if (session.review && (!session.attachment ||
        JSON.stringify(documentMetadata(doc, session.attachment, session.publication)) !== JSON.stringify(session.metadata))) {
        session.review = null;
        session.searchResults = null;
        session.searchError = '';
        session.retryNonce = '';
        invalidate(session);
    }
    return session;
};

export const createDashboard = () => {
    if (document.getElementById('sender-panel')) return () => {};
    const getSetting = (key, fallback) => typeof GM_getValue === 'function' ? GM_getValue(`outgoing-sender:${key}`, fallback) : fallback;
    let settings = { baseUrl: getSetting('baseUrl', 'http://127.0.0.1:8000'), apiKey: getSetting('apiKey', '') };
    const getSavedDocs = () => {
        try {
            const raw = typeof GM_getValue === 'function' ? GM_getValue('outgoing-sender:savedDocs', '{}') : '{}';
            return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        } catch {
            return {};
        }
    };
    const markDocSaved = (docId, info = {}) => {
        if (!docId) return;
        try {
            const map = getSavedDocs();
            map[String(docId)] = { savedAt: Date.now(), ...info };
            if (typeof GM_setValue === 'function') GM_setValue('outgoing-sender:savedDocs', JSON.stringify(map));
        } catch (err) {
            console.warn('Lưu lịch sử văn bản thất bại:', err);
        }
    };
    const sessions = new Map();
    let selectedId = '';
    let busy = false;
    let stopped = false;
    let lookupSync = null;
    const launcher = document.createElement('button');
    launcher.id = 'sender-launcher';
    launcher.type = 'button';
    launcher.textContent = 'AI · Ban hành văn bản';
    launcher.setAttribute('aria-controls', 'sender-panel');
    launcher.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('section');
    panel.id = 'sender-panel';
    panel.hidden = true;
    panel.dataset.mobileView = 'review';
    panel.setAttribute('aria-label', 'Trợ lý ban hành văn bản');
    panel.innerHTML = `<div class="sender-toolbar"><div class="sender-toolbar-controls"><button type="button" data-action="scan">Quét văn bản</button><label>Giới hạn <input id="sender-limit" type="number" min="1" step="1" placeholder="Tất cả" aria-label="Giới hạn số văn bản đủ điều kiện"></label><button type="button" data-action="batch">Phân tích danh sách</button><button type="button" data-action="stop" disabled title="Dừng sau văn bản đang phân tích">Dừng</button><span class="sender-count" id="sender-count">0 văn bản</span></div><div class="sender-toolbar-spacer" title="Kéo để di chuyển" aria-hidden="true"></div><div class="sender-toolbar-actions"><button type="button" data-action="toggle-settings" aria-label="Cài đặt kết nối" aria-controls="sender-settings-panel" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/><circle cx="9" cy="18" r="2" fill="white"/></svg></button><button type="button" data-action="close" aria-label="Đóng trợ lý">Đóng</button></div></div>
        <div id="sender-settings-panel" class="sender-connection" hidden><div class="sender-settings"><label class="sender-label">Địa chỉ máy chủ<input id="sender-base-url" type="url" value="${escapeHtml(settings.baseUrl)}"></label><label class="sender-label">Khóa truy cập (nếu có)<input id="sender-api-key" type="password" autocomplete="off" value="${escapeHtml(settings.apiKey)}"></label><button type="button" data-action="connect">Lưu và kiểm tra</button></div></div>
        <nav class="sender-mobile-switch" aria-label="Chuyển vùng làm việc"><button type="button" data-action="show-review" aria-controls="sender-detail" aria-pressed="true">Nội dung rà soát</button><button type="button" data-action="show-recipients" aria-controls="sender-recipients" aria-pressed="false">Danh bạ & người nhận</button></nav>
        <div class="sender-body"><aside id="sender-list" class="sender-list" aria-label="Văn bản đủ điều kiện"></aside><main id="sender-detail" class="sender-detail" aria-label="Nội dung rà soát" tabindex="0"></main><aside id="sender-recipients" class="sender-recipients" aria-label="Danh bạ & người nhận"></aside></div><footer id="sender-status" class="sender-footer" role="status" aria-live="polite">Chọn văn bản Đã chuyển nội bộ hoặc Đã vào sổ có tài liệu chính khớp số văn bản.</footer>`;
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.appendChild(style);
    document.body.append(launcher, panel);
    const keepInViewport = makePanelDraggable(panel);
    const list = panel.querySelector('#sender-list');
    const detail = panel.querySelector('#sender-detail');
    const sidebar = panel.querySelector('#sender-recipients');
    const status = message => { panel.querySelector('#sender-status').textContent = message; };
    const current = () => sessions.get(selectedId);
    const previewUrl = attachment => attachment?.contentUid ? `${window.location.origin}${context.basePath || window.location.pathname.match(/^(\/[^/]+\/smartcloud)/)?.[1]}/docx/download.cpx?${new URLSearchParams({ docID: attachment.contentUid, view: 'pdf' })}` : '';
    const updateBusy = () => {
        panel.querySelectorAll('button[data-action]').forEach(button => {
            if (['close', 'stop', 'show-review', 'show-recipients'].includes(button.dataset.action)) return;
            if (busy) button.disabled = true;
            else if (button.dataset.action === 'analyze' && detail.contains(button)) button.disabled = !current()?.attachment;
            else if (!['apply', 'feedback'].includes(button.dataset.action)) button.disabled = false;
        });
        panel.querySelector('[data-action="stop"]').disabled = !busy;
        panel.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = busy; });
        panel.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = busy; });
    };
    const renderList = () => {
        list.innerHTML = renderDocumentList(documents, selectedId, sessions, getSavedDocs());
        panel.querySelector('#sender-count').textContent = `${[...documents.values()].filter(doc => doc.eligible).length} văn bản`;
        updateBusy();
    };
    const showWorkspace = view => {
        panel.dataset.mobileView = view;
        panel.querySelector('[data-action="show-review"]').setAttribute('aria-pressed', String(view === 'review'));
        panel.querySelector('[data-action="show-recipients"]').setAttribute('aria-pressed', String(view === 'recipients'));
    };
    const renderDetail = () => {
        const active = document.activeElement;
        const restoreFocus = detail.contains(active) || sidebar.contains(active);
        const scrolls = ['#sender-detail', '.sender-recipient-list', '.sender-search-matches'].map(selector => [selector, panel.querySelector(selector)?.scrollTop || 0]);
        detail.innerHTML = renderReview(current(), getSavedDocs());
        sidebar.innerHTML = renderRecipientPanel(current());
        updateBusy();
        for (const [selector, top] of scrolls) { const node = panel.querySelector(selector); if (node) node.scrollTop = top; }
        if (restoreFocus) {
            const replacement = [...panel.querySelectorAll('input,select,textarea,button,[tabindex]')].find(node =>
                node.tagName === active.tagName && node.id === active.id && node.name === active.name && node.className === active.className &&
                JSON.stringify(node.dataset) === JSON.stringify(active.dataset));
            (replacement || sidebar.querySelector('input[type="search"]'))?.focus({ preventScroll: true });
        }
    };
    const render = () => { renderList(); renderDetail(); };
    const sessionFor = doc => {
        if (!sessions.has(doc.id)) sessions.set(doc.id, { doc, reviewed: false, replaceExisting: false });
        const session = sessions.get(doc.id);
        refreshSessionDocument(session, doc);
        session.previewUrl = previewUrl(session.attachment);
        return session;
    };
    const select = async id => {
        selectedId = id;
        const doc = await ensureDocumentDetails(id);
        sessionFor(doc);
        showWorkspace('review');
        render();
        detail.scrollTop = 0;
        sidebar.querySelector('.sender-recipient-list')?.scrollTo(0, 0);
    };
    const analyze = async id => {
        selectedId = id;
        let session = sessionFor(documents.get(id) || { id });
        session.processing = true;
        session.error = '';
        session.review = null;
        session.searchResults = null;
        session.searchError = '';
        invalidate(session);
        render();
        try {
            const doc = await ensureDocumentDetails(id);
            session = sessionFor(doc);
            if (!session.attachment) throw new Error('Văn bản không có tài liệu chính để phân tích.');
            await triggerBackgroundSync();
            const client = createSenderClient(settings);
            const metadata = documentMetadata(doc, session.attachment, session.publication);
            const file = await downloadPDF(session.attachment);
            // Recheck after downloading: neither a cached API flag nor a hidden
            // template icon can authorize a document for backend upload.
            await ensureDocumentDetails(id, { refresh: true });
            const row = await showDocument(id);
            const nativeAttachment = (doc.attachments || []).find(item => item.contentUid === session.attachment.contentUid);
            if (!isDocumentEligible(row, doc) || !nativeAttachment ||
                !chooseAttachment({ ...doc, attachments: [nativeAttachment] }) ||
                JSON.stringify(documentMetadata(doc, nativeAttachment, session.publication)) !== JSON.stringify(metadata)) {
                throw new Error('Văn bản hoặc tài liệu chính không còn đủ điều kiện.');
            }
            if (session.failed) session.retryNonce = crypto.randomUUID();
            const response = await client.analyze({ file, metadata, retryNonce: session.retryNonce || '', onStatus: value => {
                session.progress = ({ queued: 'Đang chờ xử lý', extracting: 'Đang đọc tài liệu', resolving: 'Đang đối chiếu danh bạ', completed: 'Đã phân tích', failed: 'Phân tích lỗi' })[value] || value;
                status(`${doc.signNumber || id}: ${session.progress}`);
            } });
            session.client = client;
            session.metadata = response.metadata;
            session.jobId = response.jobId;
            session.review = createReview(response.result);
            await enrichUnresolvedOrganizations(session, { onStatus: status });
            session.failed = false;
            status(`Đã phân tích ${doc.signNumber || id}; hãy đối chiếu người nhận và chọn trường cần điền.`);
        } catch (error) {
            // A transport timeout may leave the original job running. Reuse
            // its stable intent; only a terminal failed job needs a fresh key.
            session.failed = Boolean(error.jobFailed);
            session.error = error.message;
            throw error;
        } finally { session.processing = false; render(); }
    };
    const verifyReview = async session => {
        if (!session?.reviewed) throw new Error('Cần xác nhận đã đối chiếu danh sách trước khi điền hoặc lưu rà soát.');
        const feedback = buildFeedback(session.review);
        await session.client.checkVersions(session.review.result);
        return feedback;
    };
    const apply = async () => {
        const session = current();
        if (session) { session.applied = null; session.existingSummary = ''; }
        const payload = await verifyReview(session);
        if (getTenantId() === 'vpub' && !session.metadata?.publication) {
            throw new Error('Chọn phạm vi và ngày phát hành dự kiến rồi phân tích lại trước khi điền.');
        }
        session.doc.detailsLoaded = false;
        const doc = await ensureDocumentDetails(session.doc.id);
        const nativeAttachment = (doc.attachments || []).find(item => item.contentUid === session.attachment.contentUid);
        if (!nativeAttachment || JSON.stringify(documentMetadata(doc, nativeAttachment, session.publication)) !== JSON.stringify(session.metadata)) {
            invalidate(session);
            throw new Error('Thông tin văn bản hoặc tài liệu chính đã thay đổi; cần phân tích lại.');
        }
        const selectionPlan = session.review.result.selection_plan || [];
        const groupDependencies = session.review.result.audit?.group_dependencies || selectionPlan;
        const { nativeGroups } = await primeDirectories([...session.review.recipients.values()], { groups: groupDependencies.length > 0 });
        for (const group of groupDependencies) {
            const matches = nativeGroups.filter(native => native.id === group.group_id && native.sphere === group.sphere);
            const live = matches.length === 1 ? matches[0] : null;
            if (!live?.complete || live.member_codes.length !== group.member_codes.length
                || live.member_codes.some(code => !group.member_codes.includes(code))) {
                invalidate(session);
                throw new Error('Thành viên nhóm iDesk đã thay đổi. Đồng bộ danh bạ rồi đối chiếu lại.');
            }
        }
        await session.client.checkVersions(session.review.result);
        const result = await prepareOutgoingForm({ doc, recipients: [...session.review.recipients.values()],
            assignments: session.review.assignments, selectionPlan, registryVersion: session.review.result.registry_version,
            firstInsideCode: session.review.result.field_suggestions?.some(a => a.field === 'inside_unit') ? 'H21.21.04' : null,
            publicationAssignments: session.review.result.field_suggestions, previousPolicyChips: session.publicationChips,
            replaceExisting: session.replaceExisting, onStatus: status });
        session.applied = result.applied;
        session.publicationChips = result.publicationChips;
        if (!session.feedbackId && session.client && session.jobId) {
            try {
                const res = await session.client.feedback(session.jobId, payload);
                session.feedbackId = res.feedback_id;
                markDocSaved(session.doc.id, { feedbackId: res.feedback_id, signNumber: session.doc.signNumber, applied: true });
            } catch (err) {
                console.warn('Lưu dữ liệu rà soát tự động không thành công:', err);
                markDocSaved(session.doc.id, { signNumber: session.doc.signNumber, applied: true });
            }
        } else {
            markDocSaved(session.doc.id, { feedbackId: session.feedbackId, signNumber: session.doc.signNumber, applied: true });
        }
        const preserved = Object.entries(result.existing).filter(([, ids]) => ids.length).map(([field, ids]) => `${FIELD_DEFINITIONS.find(item => item.key === field)?.label}: ${ids.length}`);
        session.existingSummary = !session.replaceExisting && preserved.length ? `Đã giữ người nhận có sẵn — ${preserved.join('; ')}. Kiểm tra các mục này trên form.` : '';
        status('Đã điền vào form iDesk. Kiểm tra người nhận rồi bấm Đồng ý để gửi.');
        panel.hidden = true;
        launcher.setAttribute('aria-expanded', 'false');
    };
    const run = async action => {
        if (busy) return;
        busy = true;
        stopped = false;
        updateBusy();
        try { await action(); } catch (error) {
            if (current()) current().error = error.message;
            status(error.message);
        } finally { busy = false; render(); }
    };
    launcher.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        launcher.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) {
            keepInViewport();
            panel.querySelector('[data-action="close"]').focus();
        }
    });
    panel.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'close') { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); return; }
        if (action === 'stop') { stopped = true; status('Sẽ dừng sau văn bản đang xử lý.'); return; }
        if (action === 'show-review' || action === 'show-recipients') { showWorkspace(action === 'show-review' ? 'review' : 'recipients'); return; }
        if (busy) return;
        if (action === 'toggle-settings') {
            const connection = panel.querySelector('#sender-settings-panel');
            connection.hidden = !connection.hidden;
            button.setAttribute('aria-expanded', String(!connection.hidden));
            if (!connection.hidden) panel.querySelector('#sender-base-url').focus();
            return;
        }
        if (action === 'lookup-mention') {
            const session = current();
            if (!session?.review) return;
            session.searchQuery = button.dataset.query;
            session.searchResults = null;
            session.searchError = '';
            renderDetail();
            showWorkspace('recipients');
            const query = sidebar.querySelector('input[type="search"]');
            query.focus({ preventScroll: true });
            query.select();
            query.form.requestSubmit();
            return;
        }
        if (action === 'remove-recipient' || action === 'search-add') {
            const session = current();
            if (!session?.review) return;
            if (action === 'remove-recipient') setRecipient(session.review, session.review.recipients.get(button.dataset.recipientId), false);
            else {
                const recipient = session.searchResults?.find(item => item.recipient_id === button.dataset.recipientId);
                if (!recipient) return;
                setRecipient(session.review, recipient, true);
            }
            invalidate(session); renderDetail(); return;
        }
        void run(async () => {
            if (action === 'connect') {
                const next = { baseUrl: panel.querySelector('#sender-base-url').value.trim(), apiKey: panel.querySelector('#sender-api-key').value.trim() };
                await createSenderClient(next).health();
                settings = next;
                if (typeof GM_setValue === 'function') Object.entries(settings).forEach(([key, value]) => GM_setValue(`outgoing-sender:${key}`, value));
                panel.querySelector('#sender-settings-panel').hidden = true;
                const toggle = panel.querySelector('[data-action="toggle-settings"]');
                toggle.setAttribute('aria-expanded', 'false');
                status('Đã lưu cài đặt và kết nối thành công.');
            } else if (action === 'scan') {
                const value = panel.querySelector('#sender-limit').value;
                const count = await scanDocuments({ limit: value === '' ? null : Number(value), onStatus: status });
                if (selectedId && !documents.get(selectedId)?.eligible) selectedId = '';
                status(`Đã chọn ${count} văn bản đủ điều kiện.`);
            } else if (action === 'select') await select(button.dataset.id);
            else if (action === 'analyze') await analyze(button.dataset.id);
            else if (action === 'batch') {
                const savedMap = getSavedDocs();
                const eligibleDocs = [...documents.values()].filter(doc => doc.eligible);
                const pendingDocs = eligibleDocs.filter(doc => !savedMap[String(doc.id)] && !sessions.get(doc.id)?.feedbackId);
                if (!eligibleDocs.length) throw new Error('Quét danh sách để chọn văn bản đủ điều kiện trước.');
                if (!pendingDocs.length) {
                    status('Tất cả văn bản đủ điều kiện đã được lưu rà soát trước đó.');
                    return;
                }
                const ids = pendingDocs.map(doc => doc.id);
                const skippedCount = eligibleDocs.length - pendingDocs.length;
                status(`Bắt đầu phân tích ${ids.length} văn bản mới${skippedCount ? ` (bỏ qua ${skippedCount} đã lưu)` : ''}…`);
                let completed = 0;
                for (const id of ids) {
                    if (stopped) break;
                    try { await analyze(id); completed++; } catch (error) { status(`Bỏ qua ${id}: ${error.message}`); }
                }
                status(`Đã phân tích ${completed}/${ids.length} văn bản${skippedCount ? ` (bỏ qua ${skippedCount} đã lưu)` : ''}${stopped ? '; đã dừng theo yêu cầu' : ''}.`);
            } else if (action === 'resolve') {
                const session = current();
                await refreshResolution(session, status);
                await enrichUnresolvedOrganizations(session, { onStatus: status });
                status('Đã đối chiếu lại danh bạ; kiểm tra danh sách và chọn lại các trường người nhận.');
            } else if (action === 'apply') await apply();
            else if (action === 'feedback') {
                const session = current();
                const payload = await verifyReview(session);
                const result = await session.client.feedback(session.jobId, payload);
                session.feedbackId = result.feedback_id;
                markDocSaved(session.doc.id, { feedbackId: result.feedback_id, signNumber: session.doc.signNumber });
                status('Đã lưu kết quả rà soát trên backend.');
            }
        }).then(() => {
            if (action === 'connect' && !panel.hidden) {
                panel.querySelector(panel.querySelector('#sender-settings-panel').hidden ? '[data-action="toggle-settings"]' : '[data-action="connect"]').focus();
            }
        });
    });
    panel.addEventListener('change', event => {
        const input = event.target;
        const session = current();
        if (busy || !session) return;
        if (input.dataset.setting === 'attachment') {
            session.attachment = session.doc.attachments.find(item => item.contentUid === input.value);
            session.previewUrl = previewUrl(session.attachment);
            session.review = null; session.retryNonce = ''; invalidate(session);
        } else if (['publication-date', 'publication-scope'].includes(input.dataset.setting)) {
            const date = detail.querySelector('[data-setting="publication-date"]').value;
            const scope = detail.querySelector('[data-setting="publication-scope"]').value;
            session.publicationDate = date;
            session.publicationScope = scope;
            session.publication = date && scope ? { mode: 'confirmed_intent', date, external: scope === 'external' } : undefined;
            session.review = null; session.retryNonce = ''; invalidate(session);
        } else if (input.dataset.setting === 'reviewed') session.reviewed = input.checked;
        else if (input.dataset.setting === 'replace') session.replaceExisting = input.checked;
        else if (session.review) {
            if (input.dataset.assignment) {
                const fields = [...sidebar.querySelectorAll('input[data-assignment]')].filter(item => item.dataset.recipientId === input.dataset.recipientId && item.checked).map(item => item.dataset.assignment);
                assignRecipient(session.review, input.dataset.recipientId, fields);
            } else if (input.dataset.decisionRecipients) {
                const mention = session.review.result.unresolved.find(item => item.mention_id === input.dataset.decisionRecipients);
                const recipient = session.review.recipients.get(input.value) || mention?.candidates?.find(item => item.recipient_id === input.value);
                if (!mention || !recipient) return;
                setDecisionRecipient(session.review, mention.mention_id, recipient, input.checked);
            } else {
                const id = input.dataset.decisionAction || input.dataset.decisionNote;
                if (!id) return;
                const all = [...detail.querySelectorAll('[data-decision-action],[data-decision-note]')];
                const find = attribute => all.find(node => node.dataset[attribute] === id);
                const action = find('decisionAction').value;
                const ids = [...detail.querySelectorAll('input[data-decision-recipients]')].filter(node => node.dataset.decisionRecipients === id && node.checked).map(node => node.value);
                setDecision(session.review, { mention_id: id, action, note: find('decisionNote').value, recipient_ids: action === 'resolve' ? ids : [] });
            }
            invalidate(session);
        }
        renderDetail();
    });
    panel.addEventListener('input', event => {
        if (event.target.id === 'sender-recipient-query' && current()) current().searchQuery = event.target.value;
    });
    panel.addEventListener('submit', event => {
        if (event.target.dataset.form !== 'recipient-search') return;
        event.preventDefault();
        const session = current();
        const query = event.target.elements.query.value.trim();
        if (busy || !session?.review || !query) return;
        session.searchQuery = query;
        const forceLive = event.submitter?.value === 'idesk';
        session.searchResults = null;
        session.searchError = '';
        session.error = '';
        session.searching = true;
        renderDetail();
        void run(async () => {
            try {
                const body = await searchSessionRecipients(session, query, { forceLive, onStatus: status });
                session.searchResults = body.items;
                status(`Tìm thấy ${body.items.length} ứng viên. Chọn đúng định danh để thêm.`);
            } catch (error) { session.searchError = error.message; throw error; }
            finally { session.searching = false; }
        }).then(() => sidebar.querySelector('input[type="search"]')?.focus({ preventScroll: true }));
    });
    const triggerBackgroundSync = () => {
        if (lookupSync) return lookupSync;
        lookupSync = (async () => { try {
            const tenantId = getTenantId();
            const today = new Date().toISOString().slice(0, 10);
            const syncKey = `outgoing-sender:last-directory-sync:v2:${tenantId}`;
            const lastSync = typeof GM_getValue === 'function' ? GM_getValue(syncKey, '') : '';
            if (lastSync === today) return;

            let warning = '';
            const payload = await fetchLookupPayload({ onWarning: value => { warning = value; } });
            if (!payload) return;

            const client = createSenderClient(settings);
            const res = await client.syncLookup(payload);
            if (res && ['synced', 'no_change'].includes(res.status)) {
                if (warning) { if (current()) current().directoryWarning = warning; status(warning); }
                else if (typeof GM_setValue === 'function') GM_setValue(syncKey, today);
            }
        } catch (error) {
            if (current()) current().directoryWarning = `Chưa đồng bộ được danh bạ: ${error.message}`;
        } })().finally(() => { lookupSync = null; if (!busy) renderDetail(); });
        return lookupSync;
    };

    launcher.addEventListener('click', () => {
        void triggerBackgroundSync();
    });
    if (typeof setTimeout === 'function') setTimeout(() => { void triggerBackgroundSync(); }, 3000);

    render();
    return renderList;
};

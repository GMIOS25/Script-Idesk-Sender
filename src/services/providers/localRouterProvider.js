import { CONFIG } from '../../config.js';
import { setStatus, appendLog } from '../../utils/logger.js';
import { resolveDeadlineDate, sleep, toISODateOnly, toStringArray } from '../../utils/helpers.js';
import { selectAttachment } from '../../utils/attachment.js';

const ROLE_KEYS = {
    main: 'don_vi_xu_ly_chinh',
    coordinating: 'phoi_hop_xu_ly',
    monitoring: 'lanh_dao_theo_doi'
};

const normalize = (value) => (value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

const parseJson = (response, label) => {
    try {
        return JSON.parse(response.responseText || '{}');
    } catch (err) {
        throw new Error(`Router tra ve JSON khong hop le (${label}): ${err.message}`);
    }
};

const request = ({ method, url, headers = {}, data, responseType }) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        responseType,
        timeout: CONFIG.ROUTER.TIMEOUT_MS,
        onload: resolve,
        onerror: () => reject(new Error(`Khong ket noi duoc router local (${method} ${url})`)),
        ontimeout: () => reject(new Error(`Timeout router local (${method} ${url})`))
    });
});

const routerHeaders = (extra = {}) => ({
    Accept: 'application/json',
    ...(CONFIG.ROUTER.API_KEY ? { 'X-API-Key': CONFIG.ROUTER.API_KEY } : {}),
    ...extra
});

const checkResponse = (response, expected, label) => {
    if (expected.includes(response.status)) return;
    let detail = response.responseText || `HTTP ${response.status}`;
    try {
        const body = JSON.parse(response.responseText || '{}');
        detail = body.detail || body.error?.message || detail;
    } catch (e) { /* giữ thông báo thô nếu body không phải JSON */ }
    throw new Error(`${label} HTTP ${response.status}: ${detail}`);
};

const RETRYABLE_STATUS = new Set([429, 503]);
const REQUEST_MAX_ATTEMPTS = 3;

// Router trả 429 (queue_full) / 503 khi bận. Luồng DocFlow cũ có retry/backoff
// cho 429/503 (services/ai.js); adapter local trước đây bỏ mất, nên batch vượt
// max_pending=8 sẽ chết ngay ở VB thứ 9. Thử lại 429/503 và cả lỗi mạng.
const requestWithRetry = async (opts, label) => {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt++) {
        try {
            const response = await request(opts);
            if (!RETRYABLE_STATUS.has(response.status)) return response;
            lastError = new Error(`${label} HTTP ${response.status} (router bận)`);
        } catch (err) {
            lastError = err;
        }
        if (attempt < REQUEST_MAX_ATTEMPTS) {
            const delay = 1000 * 2 ** (attempt - 1);
            setStatus(`${lastError.message} — thử lại lần ${attempt}/${REQUEST_MAX_ATTEMPTS - 1}...`);
            await sleep(delay);
        }
    }
    throw lastError;
};

const toHex = (buffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

const sha256 = async (file) => toHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));

const receivedOn = (doc) => {
    const value = toISODateOnly(doc.receivedOn || doc.received_on || '');
    if (value) return value;
    // Router mặc định UTC+7; dùng cùng múi giờ để idempotency không đổi giữa client/server.
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

const safeKeyPart = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 70);

const jobIdempotencyKey = (doc, digest) =>
    // Kèm received_on để khi sang ngày mới (received_on đổi) sẽ tạo key mới -> job mới,
    // thay vì trùng key cũ nhưng lệch fingerprint -> 409 idempotency_key_conflict.
    `idesk-${safeKeyPart(doc.id)}-${receivedOn(doc)}-${digest.slice(0, 32)}`.slice(0, 128);

const postJob = async (doc, pdfFile, digest) => {
    const form = new FormData();
    form.append('document_id', String(doc.id));
    form.append('received_on', receivedOn(doc));
    form.append('file', pdfFile, pdfFile.name || `document-${doc.id}.pdf`);

    setStatus(`Gui "${doc.signNumber || doc.id}" den AI local...`);
    const response = await requestWithRetry({
        method: 'POST',
        url: `${CONFIG.ROUTER.BASE_URL}/v1/jobs`,
        headers: routerHeaders({ 'Idempotency-Key': jobIdempotencyKey(doc, digest) }),
        data: form
    }, 'Tạo job');
    checkResponse(response, [200, 202], 'Tạo job');
    const body = parseJson(response, 'create job');
    if (!body.job_id) throw new Error('Router không trả về job_id');
    return body.job_id;
};

const waitForJob = async (doc, jobId) => {
    const deadline = Date.now() + CONFIG.ROUTER.TIMEOUT_MS;
    let lastStatus = '';

    while (Date.now() < deadline) {
        const response = await requestWithRetry({
            method: 'GET',
            url: `${CONFIG.ROUTER.BASE_URL}/v1/jobs/${encodeURIComponent(jobId)}`,
            headers: routerHeaders()
        }, 'Đọc trạng thái job');
        checkResponse(response, [200], 'Đọc trạng thái job');
        const job = parseJson(response, 'job status');

        if (job.status !== lastStatus) {
            lastStatus = job.status;
            setStatus(`Router local: ${job.status} - ${doc.signNumber || doc.id}`);
        }
        if (job.status === 'completed') {
            if (!job.result) throw new Error('Job completed nhưng không có result');
            return job.result;
        }
        if (job.status === 'failed') throw new Error(`Router xử lý thất bại: ${job.error || 'unknown error'}`);
        await sleep(CONFIG.ROUTER.POLL_INTERVAL_MS);
    }

    throw new Error(`Router không hoàn tất trong ${CONFIG.ROUTER.TIMEOUT_MS}ms (job ${jobId})`);
};

const names = (result, role) => (result.recipients?.[ROLE_KEYS[role]] || []).map(item => item.name).filter(Boolean);
const recipients = (result, role) => (result.recipients?.[ROLE_KEYS[role]] || [])
    .filter(item => item && item.id && item.name)
    .map(item => ({ id: item.id, name: item.name }));

const priorityForUrgency = (urgency) => ({
    thuong: '0',
    khan: '1',
    thuong_khan: '2',
    // Form iDesk hiện chỉ có option 0/1/2; giữ cảnh báo canonical trong notes.
    hoa_toc: '2'
}[urgency] || '0');

// Bản đồ mã lý do cần kiểm tra (review_reasons) -> mô tả tiếng Việt để hiển thị.
const REVIEW_REASON_TEXT = {
    'missing_co_quan_ban_hanh': 'Thiếu cơ quan ban hành',
    'missing_trich_yeu': 'Thiếu trích yếu',
    'missing_loai': 'Thiếu loại văn bản',
    'multiple_deadlines': 'Có nhiều hạn thực hiện khác nhau',
    'unresolved_relative_deadline': 'Có hạn tương đối (X ngày) chưa xác định được mốc',
    'unresolved_deadline': 'Có hạn nhưng chưa đọc được ngày cụ thể',
    'ambiguous_reply_reference': 'Viện dẫn nhiều văn bản trả lời, chưa rõ văn bản nào',
    'overdue_deadline': 'Hạn thực hiện đã quá ngày',
    'invalid_deadline': 'Hạn thực hiện không hợp lệ',
    'unverified_rule_mapping': 'Ánh xạ rule chưa được nghiệm thu',
    'unverified_domain_mapping': 'Ánh xạ lĩnh vực chưa được nghiệm thu',
    'ambiguous_domain': 'Nhiều lĩnh vực khớp ngang điểm, chưa rõ lĩnh vực nào',
    'missing_primary_recipient': 'Chưa xác định được đơn vị xử lý chính',
    'ambiguous_advisory_unit': 'Nhiều đơn vị tham mưu khả dĩ, chưa rõ chọn đơn vị nào',
    'incomplete_or_unverified_extraction': 'Trích xuất văn bản chưa đầy đủ/đáng tin (bản scan?)',
    'multiple_attachments_require_review': 'Có nhiều file đính kèm, cần kiểm tra',
    'model_suggestion_requires_review': 'Đề xuất từ model, cần người duyệt',
    'model_unavailable_or_invalid': 'Model không khả dụng, chỉ dùng rule',
    'model_deadline_not_grounded': 'Hạn do model đưa ra không khớp văn bản (đã bỏ)'
};
const reasonText = (code) => REVIEW_REASON_TEXT[code] || code;

export const toUiData = (doc, result, digest) => {
    const main = names(result, 'main');
    const coordinating = names(result, 'coordinating');
    const monitoring = names(result, 'monitoring');
    const review = Array.isArray(result.review_reasons) ? result.review_reasons : [];
    const warnings = review.map(reasonText);
    if (main.length === 0) warnings.push('Chưa có đơn vị xử lý chính; cần chọn thủ công trước khi chuyển.');
    if (monitoring.length > 1) warnings.push('Có nhiều lãnh đạo theo dõi; cần chọn thủ công trước khi chuyển.');
    if (result.do_khan === 'hoa_toc') warnings.push('iDesk hiện chưa có option Hỏa tốc; giao diện sẽ hiển thị mức Thượng khẩn để người dùng xác nhận.');
    if (result.degraded) warnings.push('Router đang ở chế độ degraded; cần kiểm tra lại đề xuất.');

    const routerRecipients = {
        main: recipients(result, 'main'),
        coordinating: recipients(result, 'coordinating'),
        monitoring: recipients(result, 'monitoring')
    };
    const manualMapping = main.length === 0 || monitoring.length > 1;

    return {
        // Các khóa này là shape cũ mà dashboard/formFiller đang dùng.
        processing_unit: main,
        coordinating_units: coordinating,
        monitoring_leader: monitoring.length === 1 ? monitoring[0] : null,
        implementation_deadline: result.han_thuc_hien,
        priority: priorityForUrgency(result.do_khan),
        do_khan: result.do_khan,
        // summary = tóm tắt nội dung (model sinh) hoặc trích yếu (fallback);
        // reason = lý do định tuyến (khớp rule nào), tách riêng để UI hiển thị đúng vai trò.
        summary: result.summary || result.extracted_metadata?.trich_yeu || '',
        reason: result.reason || '',
        notes: warnings.join('\n'),
        confidence: result.confidence,
        needs_review: result.needs_review,
        requires_confirmation: result.requires_confirmation,
        review_reasons: review,
        _router: {
            job_id: result.job_id,
            document_id: result.document_id,
            input_sha256: result.input_sha256 || digest,
            rules_sha256: result.rules_sha256,
            rules_version: result.rules_version,
            directory_version: result.directory_version,
            received_on: result.received_on,
            proposed: {
                main: routerRecipients.main,
                coordinating: routerRecipients.coordinating,
                monitoring: routerRecipients.monitoring,
                deadline: result.han_thuc_hien,
                do_khan: result.do_khan
            },
            audit: {
                matched_rules: result.matched_rules || [],
                evidence: result.evidence || {},
                extracted_metadata: result.extracted_metadata || {},
                tier: result.tier,
                degraded: Boolean(result.degraded)
            },
            edited: false,
            requires_manual_mapping: manualMapping
        }
    };
};

export const processDocument = async (doc, { downloadPDF }) => {
    if (!CONFIG.ROUTER.API_KEY) {
        throw new Error('Chưa cấu hình ROUTER_API_KEY cho adapter local');
    }
    const attachment = selectAttachment(doc);
    if (!attachment) throw new Error(`Không tìm thấy file đính kèm phù hợp cho VB "${doc.signNumber}"`);

    const pdfFile = await downloadPDF(attachment.contentUid, attachment.name || `doc_${attachment.contentUid}.pdf`);
    const digest = await sha256(pdfFile);
    const jobId = await postJob(doc, pdfFile, digest);
    const result = await waitForJob(doc, jobId);
    if (String(result.document_id || '') !== String(doc.id)) {
        throw new Error(`Router trả document_id=${result.document_id || 'rỗng'}, không khớp văn bản đang mở ${doc.id}`);
    }
    // Một số backend trả result.job_id; luôn bổ sung từ URL để feedback không mất liên kết.
    result.job_id = result.job_id || jobId;
    appendLog(`Router hoàn tất "${doc.signNumber || doc.id}": ${result.reason || result.job_id}`);
    return toUiData(doc, result, digest);
};

const dateForFeedback = (value) => {
    if (!value) return null;
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const resolved = resolveDeadlineDate(value);
    return dateForFeedback(resolved.dateStr);
};

// Danh bạ đầy đủ của router (GET /v1/directory), cache theo phiên. Dùng để ánh
// xạ nhãn đơn vị người dùng chọn (trên form iDesk) về router ID.
let directoryCache = null;
const getDirectory = async () => {
    if (directoryCache) return directoryCache;
    const response = await requestWithRetry({
        method: 'GET',
        url: `${CONFIG.ROUTER.BASE_URL}/v1/directory`,
        headers: routerHeaders()
    }, 'Đọc danh bạ router');
    checkResponse(response, [200], 'Đọc danh bạ router');
    const body = parseJson(response, 'directory');
    directoryCache = Array.isArray(body.recipients) ? body.recipients : [];
    return directoryCache;
};

const findRecipient = (value, directory) => {
    if (!value || !String(value).trim()) return null;
    const raw = String(value).trim();
    const exactId = directory.find(item => item.id === raw);
    if (exactId) return exactId.id;
    const key = normalize(raw);
    const exact = directory.filter(item => normalize(item.name) === key);
    if (exact.length === 1) return exact[0].id;
    const candidates = directory.filter(item => {
        const itemKey = normalize(item.name);
        return itemKey.includes(key) || key.includes(itemKey);
    });
    if (candidates.length === 1) return candidates[0].id;
    throw new Error(`Không ánh xạ được đơn vị iDesk "${raw}" về danh bạ router`);
};

const finalIds = async (aiData, field) => {
    const directory = await getDirectory();
    return toStringArray(aiData[field]).map(item => findRecipient(item, directory)).filter(Boolean);
};

const feedbackKey = async (jobId, decision, body) => {
    const data = new TextEncoder().encode(JSON.stringify(body));
    const suffix = toHex(await crypto.subtle.digest('SHA-256', data)).slice(0, 20);
    return `feedback-${safeKeyPart(jobId)}-${decision}-${suffix}`.slice(0, 128);
};

export const recordFeedback = async (doc) => {
    const aiData = doc?.aiData;
    const router = aiData?._router;
    if (!router?.job_id) return null;

    const edited = Boolean(router.edited);
    const decision = edited ? 'edited' : 'accepted';
    const final = {
        don_vi_xu_ly_chinh: await finalIds(aiData, 'processing_unit'),
        phoi_hop_xu_ly: await finalIds(aiData, 'coordinating_units'),
        lanh_dao_theo_doi: await finalIds(aiData, 'monitoring_leader'),
        han_thuc_hien: dateForFeedback(aiData.implementation_deadline)
    };
    if (final.don_vi_xu_ly_chinh.length === 0) throw new Error('Feedback cần ít nhất một đơn vị xử lý chính');

    const body = {
        document_id: String(router.document_id || doc.id),
        input_sha256: router.input_sha256,
        rules_sha256: router.rules_sha256,
        decision,
        final,
        do_khan: aiData.do_khan || router.proposed.do_khan || 'thuong',
        note: (aiData.notes || '').slice(0, 2000)
    };
    const idempotencyKey = await feedbackKey(router.job_id, decision, body);
    const response = await requestWithRetry({
        method: 'POST',
        url: `${CONFIG.ROUTER.BASE_URL}/v1/jobs/${encodeURIComponent(router.job_id)}/feedback`,
        headers: routerHeaders({
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
        }),
        data: JSON.stringify(body)
    }, 'Ghi feedback');
    checkResponse(response, [201], 'Ghi feedback');
    const result = parseJson(response, 'feedback');
    router.feedback_id = result.feedback_id;
    appendLog(`Đã ghi feedback ${decision} cho ${doc.signNumber || doc.id}: ${result.feedback_id || 'ok'}`);
    return result;
};

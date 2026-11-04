const METADATA_FIELDS = ['document_id', 'sign_number', 'subject', 'document_date', 'issuer',
    'department_code', 'attachment_content_uid', 'attachment_name'];

function senderError(code, message, status = 0, retryable = false) {
    return Object.assign(new Error(message), { code, status, retryable });
}

function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
        || Object.keys(metadata).some(key => !METADATA_FIELDS.includes(key))
        || typeof metadata.document_id !== 'string' || !metadata.document_id.trim()
        || metadata.document_id.length > 256
        || Object.values(metadata).some(value => value != null && typeof value !== 'string')) {
        throw senderError('invalid_metadata', 'Thông tin văn bản không đúng hợp đồng outgoing.v1.');
    }
    if (metadata.document_date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.document_date)
        || !Number.isFinite(Date.parse(metadata.document_date))
        || new Date(metadata.document_date).toISOString().slice(0, 10) !== metadata.document_date)) {
        throw senderError('invalid_metadata', 'Ngày văn bản không hợp lệ.');
    }
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

export function documentMetadata(doc, attachment) {
    const metadata = { document_id: doc?.id == null ? '' : String(doc.id) };
    for (const [field, value] of Object.entries({
        sign_number: doc?.signNumber, subject: doc?.subject, issuer: doc?.author,
        attachment_content_uid: attachment?.contentUid, attachment_name: attachment?.name
    })) {
        if (value != null && value !== '') metadata[field] = String(value);
    }
    if (doc?.docDateStr) {
        const raw = String(doc.docDateStr);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) metadata.document_date = raw;
        else {
            // iDesk dates carry an explicit UTC offset; +07 is the user's local date.
            const stamp = Date.parse(raw);
            if (!Number.isFinite(stamp) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
                throw senderError('invalid_metadata', 'Ngày văn bản thiếu múi giờ hoặc không hợp lệ.');
            }
            metadata.document_date = new Date(stamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        }
    }
    return validateMetadata(metadata);
}

const JOB_STATUSES = ['queued', 'extracting', 'resolving', 'completed', 'failed'];
const hasVersions = value => typeof value?.registry_version === 'string' && value.registry_version.length > 0
    && typeof value?.alias_policy_version === 'string' && value.alias_policy_version.length > 0;

async function sha256(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value) {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function validateResult(result, jobId, metadata, inputHash) {
    if (result?.schema_version !== 'outgoing.v1' || result.job_id !== jobId || !hasVersions(result)
        || typeof result.document_id !== 'string' || !/^[a-f0-9]{64}$/.test(result.input_sha256 || '')
        || (metadata && result.document_id !== metadata.document_id)
        || (inputHash && result.input_sha256 !== inputHash)
        || !['complete', 'partial', 'failed'].includes(result.extraction_status)
        || typeof result.needs_review !== 'boolean'
        || ['people', 'units', 'mentions', 'unresolved', 'excluded', 'review_reasons'].some(key => !Array.isArray(result[key]))
        || (!result.needs_review && (result.extraction_status !== 'complete' || result.unresolved.length || result.review_reasons.length))) {
        throw senderError('invalid_result', 'Kết quả không khớp văn bản, tệp PDF hoặc hợp đồng outgoing.v1.');
    }
    return result;
}

export function createSenderClient({ baseUrl = 'http://127.0.0.1:8000', apiKey = '', tenantId = '',
    pollIntervalMs = 1500, timeoutMs = 330000, request } = {}) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
        throw senderError('invalid_config', 'Địa chỉ hoặc thời gian chờ backend không hợp lệ.');
    }
    const endpoint = url.href.replace(/\/+$/, '');
    const activeTenant = (tenantId || (typeof window !== 'undefined' && window.location?.pathname?.match(/^\/([^/]+)\/smartcloud/)?.[1]?.toLowerCase()) || 'vpub').replace(/[^a-z0-9_-]/g, '') || 'vpub';
    const transport = request || globalThis.GM_xmlhttpRequest;
    const remaining = deadline => {
        const milliseconds = deadline - Date.now();
        if (milliseconds <= 0) throw senderError('timeout', 'Hết thời gian chờ backend; có thể kiểm tra lại job hiện tại.');
        return milliseconds;
    };
    const pause = async (milliseconds, deadline) => {
        await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(milliseconds, remaining(deadline)))));
        remaining(deadline);
    };

    async function call(method, path, { data, headers = {}, deadline = Date.now() + timeoutMs, retries = 3 } = {}) {
        if (typeof transport !== 'function') throw senderError('transport_unavailable', 'Cần GM_xmlhttpRequest để kết nối backend.');
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const requestTimeout = Math.min(60000, remaining(deadline));
                    let handle;
                    let finished = false;
                    const settle = (callback, value) => {
                        if (finished) return;
                        finished = true;
                        clearTimeout(watchdog);
                        callback(value);
                    };
                    const watchdog = setTimeout(() => {
                        settle(reject, senderError(deadline <= Date.now() ? 'timeout' : 'network_error',
                            'Hết thời gian chờ phản hồi backend.', 0, deadline > Date.now()));
                        handle?.abort?.();
                    }, requestTimeout);
                    try {
                        handle = transport({ method, url: endpoint + path, data, timeout: requestTimeout,
                            headers: { Accept: 'application/json', ...(apiKey ? { 'X-API-Key': apiKey } : {}), 'X-Tenant-ID': activeTenant, ...headers },
                            onload: response => settle(resolve, response),
                            onerror: () => settle(reject, senderError('network_error', 'Không kết nối được backend.', 0, true)),
                            ontimeout: () => settle(reject, senderError('network_error', 'Backend không phản hồi đúng hạn.', 0, true)),
                            onabort: () => settle(reject, senderError('request_aborted', 'Yêu cầu backend đã dừng.'))
                        });
                    } catch {
                        settle(reject, senderError('network_error', 'Không thực hiện được yêu cầu backend.', 0, true));
                    }
                });
                let body;
                try {
                    body = response.response && typeof response.response === 'object'
                        ? response.response : JSON.parse(response.responseText ?? response.response);
                } catch {
                    if (response.status >= 200 && response.status < 300) throw senderError('invalid_response', 'Backend trả dữ liệu không phải JSON.');
                }
                if (response.status < 200 || response.status >= 300) {
                    throw senderError(body?.error?.code || 'http_error', body?.error?.message || 'Backend từ chối yêu cầu.',
                        response.status, response.status === 429 || response.status === 503);
                }
                if (!body || typeof body !== 'object' || Array.isArray(body)) throw senderError('invalid_response', 'Backend trả cấu trúc JSON không hợp lệ.');
                return body;
            } catch (error) {
                if (!error.retryable || attempt === retries) throw error;
                await pause(Math.min(500 * attempt, pollIntervalMs), deadline);
            }
        }
    }

    async function health(deadline = Date.now() + timeoutMs) {
        const body = await call('GET', '/health', { deadline });
        if (body.schema_version !== 'outgoing.v1' || !hasVersions(body)
            || !Number.isSafeInteger(body.limits?.max_file_bytes) || body.limits.max_file_bytes <= 0) {
            throw senderError('invalid_schema', 'Backend không cung cấp hợp đồng outgoing.v1 và phiên bản danh bạ hợp lệ.');
        }
        return body;
    }

    async function getJob(jobId, deadline = Date.now() + timeoutMs) {
        if (typeof jobId !== 'string' || !jobId) throw senderError('invalid_job', 'Mã job không hợp lệ.');
        const job = await call('GET', '/v1/outgoing/jobs/' + encodeURIComponent(jobId), { deadline });
        if (job.job_id !== jobId || !JOB_STATUSES.includes(job.status)
            || (job.status === 'failed' && (!job.error || typeof job.error.code !== 'string'))) {
            throw senderError('invalid_result', 'Trạng thái job không đúng hợp đồng outgoing.v1.');
        }
        if (job.status === 'completed') validateResult(job.result, jobId);
        return job;
    }

    async function pollJob(created, deadline, onStatus) {
        if (typeof created.job_id !== 'string' || !created.job_id || !JOB_STATUSES.includes(created.status)) throw senderError('invalid_result', 'Backend không trả mã job hợp lệ.');
        let previousStatus;
        const status = next => { if (next !== previousStatus) onStatus(next); previousStatus = next; };
        status(created.status);
        while (true) {
            remaining(deadline);
            const job = await getJob(created.job_id, deadline);
            status(job.status);
            if (job.status === 'failed') throw Object.assign(
                senderError(job.error.code, job.error.message || 'Không phân tích được văn bản.', 0, Boolean(job.error.retryable)),
                { jobFailed: true, jobId: created.job_id });
            if (job.status === 'completed') return job;
            await pause(pollIntervalMs, deadline);
        }
    }

    async function analyze({ file, metadata, retryNonce = '', onStatus = () => {} }) {
        const deadline = Date.now() + timeoutMs;
        metadata = validateMetadata(metadata);
        if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 5) {
            throw senderError('invalid_pdf', 'Cần một tệp PDF hợp lệ để phân tích.');
        }
        const current = await health(deadline);
        if (file.size > current.limits.max_file_bytes) throw senderError('upload_too_large', 'Tệp PDF vượt giới hạn của backend.');
        const bytes = await file.arrayBuffer();
        remaining(deadline);
        if (new TextDecoder().decode(new Uint8Array(bytes, 0, 5)) !== '%PDF-') throw senderError('invalid_pdf', 'Tệp tải về không có nội dung PDF.');
        const inputSha256 = await sha256(bytes);
        const key = 'outgoing.v1:' + await sha256(stableJson({ metadata, input_sha256: inputSha256,
            registry_version: current.registry_version, alias_policy_version: current.alias_policy_version, retry_nonce: String(retryNonce) }));
        const form = new FormData();
        form.append('file', file, file.name || metadata.attachment_name || 'document.pdf');
        form.append('metadata', JSON.stringify(metadata));
        const created = await call('POST', '/v1/outgoing/jobs', { data: form, headers: { 'Idempotency-Key': key }, deadline });
        const job = await pollJob(created, deadline, onStatus);
        validateResult(job.result, job.job_id, metadata, inputSha256);
        return { jobId: job.job_id, result: job.result, inputSha256, metadata };
    }

    async function resolveJob(jobId, previousResult, { onStatus = () => {} } = {}) {
        validateResult(previousResult, jobId);
        const deadline = Date.now() + timeoutMs;
        const created = await call('POST', '/v1/outgoing/jobs/' + encodeURIComponent(jobId) + '/resolutions', { deadline });
        const job = await pollJob(created, deadline, onStatus);
        validateResult(job.result, job.job_id, { document_id: previousResult.document_id }, previousResult.input_sha256);
        return { jobId: job.job_id, result: job.result };
    }

    async function syncOrganizations(elements, source = 'search') {
        if (!Array.isArray(elements) || elements.length > 10000 || !['directory', 'search'].includes(source) || elements.some(node =>
            !node || typeof node.code !== 'string' || !node.code.trim() || typeof node.name !== 'string' || !node.name.trim() ||
            !['int_province_comm', 'ext_province_comm'].includes(node.sphere))) throw senderError('invalid_payload', 'Dữ liệu đơn vị bổ sung không hợp lệ.');
        const body = await call('POST', '/v1/sync/organizations', {
            data: JSON.stringify({ source, elements }), headers: { 'Content-Type': 'application/json' }
        });
        if (!['synced', 'no_change'].includes(body.status) || !hasVersions(body)) throw senderError('invalid_response', 'Backend chưa xác nhận cập nhật danh bạ.');
        return body;
    }

    async function searchRecipients(query) {
        if (typeof query !== 'string' || !query.trim() || query.length > 256) throw senderError('invalid_query', 'Cần từ khóa tra cứu hợp lệ.');
        const body = await call('GET', '/v1/outgoing/recipients/search?q=' + encodeURIComponent(query.trim()) + '&limit=10');
        if (!Array.isArray(body.items) || !hasVersions(body)) throw senderError('invalid_response', 'Danh bạ trả cấu trúc không hợp lệ.');
        return body;
    }

    async function feedback(jobId, payload) {
        if (typeof jobId !== 'string' || !jobId) throw senderError('invalid_job', 'Mã job không hợp lệ.');
        // Feedback is append-only and has no idempotency key: a transport timeout
        // must remain visible so the user can check instead of duplicating an audit.
        const body = await call('POST', '/v1/outgoing/jobs/' + encodeURIComponent(jobId) + '/feedback', {
            data: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }, retries: 1
        });
        if (typeof body.feedback_id !== 'string' || !body.feedback_id) throw senderError('invalid_response', 'Backend không xác nhận lưu rà soát.');
        return body;
    }

    async function checkVersions(result) {
        const current = await health();
        if (!hasVersions(result) || result.schema_version !== 'outgoing.v1'
            || current.registry_version !== result.registry_version || current.alias_policy_version !== result.alias_policy_version) {
            throw senderError('stale_snapshot', 'Danh bạ hoặc quy tắc đã thay đổi; cần phân tích lại trước khi điền.');
        }
        return current;
    }

    async function syncLookup(payload, deadline = Date.now() + timeoutMs) {
        if (!payload || typeof payload !== 'object') throw senderError('invalid_payload', 'Dữ liệu đồng bộ danh mục không hợp lệ.');
        return await call('POST', '/v1/sync/lookup', {
            data: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            deadline
        });
    }

    return { health, analyze, getJob, resolveJob, syncOrganizations, searchRecipients, feedback, checkVersions, syncLookup, tenantId: activeTenant };
}

import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { getFallbackBasePath, sleep, toISODateOnly } from '../utils/helpers.js';
import { selectAttachment } from '../utils/attachment.js';
import { processDocument as processWithLocalRouter, recordFeedback as recordLocalFeedback } from './providers/localRouterProvider.js';

const parseResponseHeaders = (raw) => Object.fromEntries((raw || '').split('\r\n').map(l => l.split(': ')).filter(p => p[1]));

// Doc payload loi chuan theo docs/en/docflow.md muc 9: { error: { code, message, detail } }
const parseErrorPayload = (resp) => {
    try {
        const body = JSON.parse(resp.responseText);
        if (body && body.error) return body.error;
    } catch (e) {
        // response khong phai JSON hop le, roi qua fallback ben duoi
    }
    return { code: null, message: resp.responseText || `HTTP ${resp.status}`, detail: null };
};

// docs/en/docflowv2.md muc 1: "Moi response deu co header X-Request-Id ... Khi
// bao loi, gui gia tri nay de doi chieu log." Truoc day chi callAIBackendOnce()
// (goi /documents/process) doc va gan header nay vao message loi; cac endpoint
// con lai (presign, upload, lookup, patch) bo qua hoan toan header response nen
// log loi cua chung khong doi chieu duoc voi server. Gom logic doc header ve 1
// cho de moi endpoint deu dinh kem request id giong nhau khi bao loi.
const extractRequestId = (resp) => parseResponseHeaders(resp.responseHeaders)['x-request-id'] || null;

const requestIdSuffix = (resp) => {
    const id = extractRequestId(resp);
    return id ? ` [X-Request-Id: ${id}]` : '';
};

const RETRYABLE_STATUS = new Set([429, 503]);

export const downloadPDF = (contentUid, fileName) => {
    return new Promise((resolve, reject) => {
        const bp = state.basePath || getFallbackBasePath();
        const url = `${bp}/docx/download.cpx?docID=${contentUid}&view=pdf&t=${Date.now()}`;
        setStatus(`Dang tai PDF: ${fileName}...`);

        GM_xmlhttpRequest({
            method: 'GET',
            url: window.location.origin + url,
            responseType: 'blob',
            timeout: CONFIG.DOWNLOAD_TIMEOUT_MS,
            onload: (resp) => {
                if (resp.status >= 200 && resp.status < 300) {
                    const blob = resp.response;
                    resolve(new File([blob], fileName || `doc_${contentUid}.pdf`, {
                        type: blob.type || 'application/pdf'
                    }));
                } else {
                    reject(new Error(`Download HTTP ${resp.status}`));
                }
            },
            onerror: (err) => reject(new Error(`Loi ket noi download: ${err}`)),
            ontimeout: () => reject(new Error('Timeout download PDF'))
        });
    });
};

export const getAuthToken = () => {
    return new Promise((resolve) => {
        if (state.cachedAuthToken) return resolve(state.cachedAuthToken);
        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.AUTH_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ username: CONFIG.AUTH_USERNAME, password: CONFIG.AUTH_PASSWORD }),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const res = JSON.parse(resp.responseText);
                        state.cachedAuthToken = res.access_token || '';
                        appendLog('Da lay Auth Token tu Backend');
                    } catch (e) {}
                }
                resolve(state.cachedAuthToken);
            },
            onerror: () => resolve(''),
            ontimeout: () => resolve('')
        });
    });
};

// POST /files/presign (docs/en/docflowv2.md muc 6) — xin cap URL tam de day file
// PDF that len, thay cho viec gui thang link noi bo iDesk (yeu cau cookie phien
// dang nhap cua nguoi dung -> AI backend that, chay o server khac, khong tai duoc).
const presignFileOnce = (pdfFile, token) => {
    return new Promise((resolve) => {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.PRESIGN_URL,
            headers,
            data: JSON.stringify({ filename: pdfFile.name, content_type: 'application/pdf' }),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        resolve({ ok: true, data: JSON.parse(resp.responseText) });
                    } catch (e) {
                        resolve({ ok: false, retryable: false, error: new Error(`Parse JSON loi (presign): ${e.message}`) });
                    }
                    return;
                }
                const errPayload = parseErrorPayload(resp);
                resolve({ ok: false, retryable: RETRYABLE_STATUS.has(resp.status), status: resp.status, error: new Error(`Presign HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${requestIdSuffix(resp)}`) });
            },
            onerror: () => resolve({ ok: false, retryable: true, error: new Error('Khong ket noi duoc /files/presign') }),
            ontimeout: () => resolve({ ok: false, retryable: true, error: new Error('Timeout goi /files/presign') })
        });
    });
};

// PUT /files/upload/{token} (docs/en/docflowv2.md muc 7) — day thang BYTES THO cua
// file, KHONG boc JSON, KHONG multipart. Header Content-Type phai khop CHINH XAC
// gia tri trong upload_headers tra ve tu buoc presign, sai se bi 400
// UPLOAD_CONTENT_TYPE_MISMATCH. Response thanh cong la 204 No Content, khong co body.
const uploadFileOnce = (uploadUrl, uploadHeaders, pdfFile, token) => {
    return new Promise((resolve) => {
        const headers = Object.assign({}, uploadHeaders);
        if (token) headers['Authorization'] = `Bearer ${token}`;

        GM_xmlhttpRequest({
            method: 'PUT',
            url: uploadUrl,
            headers,
            data: pdfFile,
            onload: (resp) => {
                if (resp.status === 204 || resp.status === 200) {
                    resolve({ ok: true });
                    return;
                }
                const errPayload = parseErrorPayload(resp);
                resolve({ ok: false, retryable: RETRYABLE_STATUS.has(resp.status), status: resp.status, error: new Error(`Upload HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${requestIdSuffix(resp)}`) });
            },
            onerror: () => resolve({ ok: false, retryable: true, error: new Error('Khong ket noi duoc /files/upload') }),
            ontimeout: () => resolve({ ok: false, retryable: true, error: new Error('Timeout PUT /files/upload') })
        });
    });
};

// Ghep presign + upload thanh 1 buoc co retry/backoff rieng, dung chung CONFIG.RETRY
// voi callAIBackendOnce. docs/en/docflowv2.md muc 7 co 503 SERVER_BUSY khi kho tam
// day -> lui vai giay roi thu lai, nen ap dung retry giong het nhanh goi AI chinh.
const prepareFileUrl = async (doc, pdfFile, token) => {
    const maxAttempts = CONFIG.RETRY.MAX_ATTEMPTS;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        setStatus(`Day file "${doc.signNumber}" len storage tam${attempt > 1 ? ` - lan thu ${attempt}` : ''}...`);

        const presignResult = await presignFileOnce(pdfFile, token);
        if (!presignResult.ok) {
            lastError = presignResult.error;
            if (!presignResult.retryable || attempt === maxAttempts) throw lastError;
            await sleep(CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
        }

        const { upload_url, public_url, upload_headers } = presignResult.data;
        const uploadResult = await uploadFileOnce(upload_url, upload_headers, pdfFile, token);
        if (uploadResult.ok) {
            appendLog(`Da day file "${pdfFile.name}" len storage tam, public_url: ${public_url}`);
            return public_url;
        }

        lastError = uploadResult.error;
        if (!uploadResult.retryable || attempt === maxAttempts) throw lastError;
        await sleep(CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }

    throw lastError;
};

const callAIBackendOnce = (doc, payload, token) => {
    return new Promise((resolve) => {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.BACKEND_URL,
            headers: headers,
            data: JSON.stringify(payload),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const result = JSON.parse(resp.responseText);
                        const responseData = result.data || result;
                        appendLog(`AI phan hoi cho "${doc.signNumber}": ${JSON.stringify(responseData)}`);
                        resolve({ ok: true, data: responseData });
                    } catch (e) {
                        resolve({ ok: false, retryable: false, error: new Error(`Parse JSON loi: ${e.message}`) });
                    }
                    return;
                }

                const errPayload = parseErrorPayload(resp);
                const err = new Error(`Backend HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${requestIdSuffix(resp)}`);
                resolve({ ok: false, retryable: RETRYABLE_STATUS.has(resp.status), status: resp.status, error: err });
            },
            onerror: () => resolve({ ok: false, retryable: true, error: new Error(`Khong ket noi duoc AI (${CONFIG.BACKEND_URL})`) }),
            ontimeout: () => resolve({ ok: false, retryable: true, error: new Error('Timeout goi AI backend') })
        });
    });
};

// docs/en/docflow.md muc 10: 429 RATE_LIMITED / 503 SERVER_BUSY -> FE nen doi (backoff)
// roi thu lai, khong duoc coi la loi cuoi cung ngay lan dau.
export const callAIBackend = async (doc) => {
    if (CONFIG.AI_PROVIDER === 'local-router') {
        return processWithLocalRouter(doc, { downloadPDF });
    }

    const targetAttach = selectAttachment(doc);
    if (!targetAttach) {
        throw new Error(`Khong tim thay file dinh kem phu hop cho VB "${doc.signNumber}"`);
    }

    const token = await getAuthToken();

    // Tai file PDF that bang chinh session dang nhap hien tai (GM_xmlhttpRequest
    // mang theo cookie trinh duyet), roi day len storage tam qua /files/presign +
    // /files/upload de lay public_url khong con phu thuoc cookie/session cua nguoi
    // dung (docs/en/docflowv2.md muc 2 nhanh (b) va muc 6-7). Thay the hoan toan
    // cach cu la gui thang link download.cpx cua iDesk lam file_url — link do chi
    // tai duoc trong dung phien trinh duyet dang nhap, AI backend that (server
    // khac) khong co cookie nen luon that bai (xem docs/changes/De_xuat_presigned_url.md).
    const pdfFile = await downloadPDF(
        targetAttach.contentUid,
        targetAttach.name || `doc_${targetAttach.contentUid}.pdf`
    );
    const fileUrl = await prepareFileUrl(doc, pdfFile, token);

    const payload = {
        metadata: {
            document_number: doc.signNumber || '',
            document_type: doc.category || '',
            issuing_agency: doc.author || '',
            document_date: toISODateOnly(doc.docDateStr),
            signer: doc.signer || '',
            subject: doc.subject || ''
        },
        file_url: fileUrl
    };

    const maxAttempts = CONFIG.RETRY.MAX_ATTEMPTS;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        setStatus(`Gui "${doc.signNumber}" den AI (DocFlow API)${attempt > 1 ? ` - lan thu ${attempt}` : ''}...`);
        const result = await callAIBackendOnce(doc, payload, token);

        if (result.ok) return result.data;

        lastError = result.error;
        if (!result.retryable || attempt === maxAttempts) {
            throw lastError;
        }

        const delay = CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1);
        appendLog(`${doc.signNumber}: ${lastError.message} — cho ${delay}ms roi thu lai (${attempt}/${maxAttempts})`);
        await sleep(delay);
    }

    throw lastError;
};

// POST /documents/lookup (docs/en/docflow.md muc 5) — tra metadata da xu ly ma
// khong can goi lai OCR/AI. Duoc dung boi controllers/mainController.js truoc khi
// goi callAIBackend() de tranh xu ly trung mot van ban da "completed".
export const lookupDocument = async (doc) => {
    if (CONFIG.AI_PROVIDER === 'local-router') return null;

    const token = await getAuthToken();
    const payload = {
        document_number: doc.signNumber || '',
        document_type: doc.category || '',
        issuing_agency: doc.author || '',
        document_date: toISODateOnly(doc.docDateStr),
        signer: doc.signer || '',
        subject: doc.subject || ''
    };

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.LOOKUP_URL,
            headers,
            data: JSON.stringify(payload),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        resolve(JSON.parse(resp.responseText));
                    } catch (e) {
                        reject(new Error(`Parse JSON loi (lookup): ${e.message}`));
                    }
                } else {
                    const errPayload = parseErrorPayload(resp);
                    reject(new Error(`Lookup HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${requestIdSuffix(resp)}`));
                }
            },
            onerror: () => reject(new Error('Khong ket noi duoc /documents/lookup')),
            ontimeout: () => reject(new Error('Timeout goi /documents/lookup'))
        });
    });
};

// 6 truong duy nhat PATCH /documents/{stt} chap nhan (docs/en/docflow.md muc 6).
const PATCHABLE_FIELDS = ['summary', 'processing_unit', 'monitoring_leader', 'implementation_deadline', 'coordinating_units', 'notes'];

// PATCH /documents/{stt} — duoc goi (fire-and-forget) tu controllers/mainController.js
// moi khi nguoi dung sua tay processing_unit/coordinating_units/implementation_deadline
// tren UI review, de luu lai chinh sua vao backend. Neu khong PATCH, lan tra cuu
// sau (lookupDocument hoac nhanh cache cua /documents/process) se tra ve du lieu
// AI goc, chua sua.
export const patchDocument = async (stt, fields) => {
    const body = {};
    for (const key of PATCHABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) body[key] = fields[key];
    }
    if (Object.keys(body).length === 0) {
        throw new Error(`patchDocument: can it 1 truong hop le trong [${PATCHABLE_FIELDS.join(', ')}]`);
    }

    const token = await getAuthToken();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'PATCH',
            url: `${CONFIG.PATCH_URL_BASE}/${stt}`,
            headers,
            data: JSON.stringify(body),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const result = JSON.parse(resp.responseText);
                        resolve(result.data || result);
                    } catch (e) {
                        reject(new Error(`Parse JSON loi (patch): ${e.message}`));
                    }
                } else {
                    const errPayload = parseErrorPayload(resp);
                    reject(new Error(`Patch HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${requestIdSuffix(resp)}`));
                }
            },
            onerror: () => reject(new Error(`Khong ket noi duoc PATCH /documents/${stt}`)),
            ontimeout: () => reject(new Error(`Timeout goi PATCH /documents/${stt}`))
        });
    });
};

// Router local ghi nhận phiên bản cuối qua feedback sau khi iDesk chuyển xử lý.
// Giữ export này ở facade để controller không phụ thuộc trực tiếp vào provider.
export const recordFeedback = async (doc) => {
    if (CONFIG.AI_PROVIDER !== 'local-router') return null;
    return recordLocalFeedback(doc);
};

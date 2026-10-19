import { selectAttachment, getNumberMatchedAttachments } from './attachment.js';

export const documents = new Map();
export const internalDirectory = new Map();
export const organizationDirectory = new Map();
export const context = { basePath: '', execAcode: '' };

const LIST = '#listview-publish-list-content .messageListItem[data-id]';
const MARKER = 'i.icon-share-sign.blue[title="Đã chuyển nội bộ"]';
const BOOK_MARKER = 'i.icon-book[title="Đã vào sổ"]';
const PAGING = '#listview-publish-paging';
const BUTTON = '#listview-publish-paging-listview-publish-pagingbtn-';
const SPHERES = ['int_province_comm', 'ext_province_comm'];
const ENDPOINTS = {
    list: '/document/edocs/qspublishing.cpx',
    view: '/document/edocs/view.cpx',
    internal: '/comm/nodes/fbyvsphere.cpx',
    organization: '/history/organext/list.cpx'
};
const installedRealms = new WeakSet();
const nativeViews = new WeakMap();
const bridgeReads = new WeakSet();
const bridgeResourceReads = new WeakMap();
let onChange = () => {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageWindow = () => typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
const notify = () => { try { onChange(); } catch { /* A panel error must not break native iDesk requests. */ } };

export const getTenantId = () => {
    if (typeof window === 'undefined') return 'vpub';
    const match = window.location?.pathname?.match(/^\/([^/]+)\/smartcloud/);
    return match ? match[1].toLowerCase() : 'vpub';
};

const basePath = () => {
    if (!context.basePath) {
        context.basePath = window.location.pathname.match(/^(\/[^/]+\/smartcloud)(?:\/|$)/)?.[1] || '';
    }
    if (!context.basePath) throw new Error('Không xác định được đường dẫn iDesk của phiên hiện tại');
    return context.basePath;
};

const nativeTarget = input => {
    try {
        const url = new URL(typeof input === 'string' ? input : input?.url || String(input), window.location.origin);
        if (url.origin !== window.location.origin) return null;
        const endpoint = Object.entries(ENDPOINTS).find(([, path]) => url.pathname === `${basePath()}${path}`)?.[0];
        return endpoint ? { url, endpoint } : null;
    } catch { return null; }
};

const captureExecutor = (target, body) => {
    const actor = target?.url.searchParams.get('exeacode') ||
        (typeof body === 'string' || body instanceof URLSearchParams ? new URLSearchParams(body).get('exeacode') : null);
    if (target && actor) context.execAcode = actor;
};

// Resource timing recovers a native view request when the userscript was enabled
// after page load. Its actor belongs to the live request, not the document creator.
const latestViewResource = () => {
    const page = pageWindow();
    const entries = page.performance?.getEntriesByType?.('resource') || [];
    const ownReads = bridgeResourceReads.get(page) || [];
    for (const entry of [...entries].sort((left, right) => right.startTime - left.startTime)) {
        if (ownReads.some(read => entry.name === read.url && entry.startTime >= read.start && entry.startTime <= read.end)) continue;
        const target = nativeTarget(entry.name);
        if (target?.endpoint === 'view' && target.url.searchParams.get('id')) return target;
    }
    return null;
};

const recoverExecutor = () => {
    if (context.execAcode) return context.execAcode;
    captureExecutor(latestViewResource());
    return context.execAcode;
};

const visible = element => {
    if (!element || !(element.getClientRects?.().length > 0 || element.offsetParent != null)) return false;
    for (let node = element; node; node = node.parentElement) {
        const style = window.getComputedStyle?.(node) || node.style;
        if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
    }
    return true;
};

// The marker exists in hidden templates on ordinary rows. API flags or row
// classes alone cannot grant eligibility: the actual icon must be rendered.
export const hasInternalTransferMarker = row => visible(row) &&
    [...row.querySelectorAll(MARKER)].some(visible);

export const hasRegisteredMarker = row => visible(row) &&
    [...row.querySelectorAll(BOOK_MARKER)].some(visible);

export const isDocumentEligible = (row, doc = documents.get(row?.getAttribute('data-id'))) =>
    hasInternalTransferMarker(row) || (hasRegisteredMarker(row) && doc?.detailsLoaded &&
        Boolean(chooseAttachment({ ...doc, selectionMarker: 'book' })));

const rows = () => [...document.querySelectorAll(LIST)].filter(visible);
const currentPage = () => Number(document.querySelector(`${PAGING} [data-page="number"]`)?.textContent) || 1;
const pageKey = () => rows().map(row => row.getAttribute('data-id')).join(',');
const enabled = button => button && !button.disabled && !button.classList.contains('disabled');
const rowFor = id => rows().find(row => row.getAttribute('data-id') === String(id));

const changePage = async direction => {
    const button = document.querySelector(`${BUTTON}${direction}`);
    if (!enabled(button)) return false;
    const previousKey = pageKey();
    button.click();
    for (let attempt = 0; attempt < 50; attempt++) {
        if (pageKey() && pageKey() !== previousKey) return true;
        await sleep(150);
    }
    throw new Error('Danh sách Ban hành văn bản chưa chuyển trang; hãy tải lại danh sách');
};

const getDocument = id => {
    const key = String(id);
    if (!documents.has(key)) documents.set(key, { id: key, status: 'idle', eligible: false, attachments: [] });
    return documents.get(key);
};

const collectRow = (row, page, pageIndex) => {
    const doc = getDocument(row.getAttribute('data-id'));
    doc.selectionMarker = hasInternalTransferMarker(row) ? 'internal' : 'book';
    doc.page = page;
    doc.pageIndex = pageIndex;
    doc.signNumber ||= row.querySelector('.sender')?.textContent?.trim() || '';
    doc.subject ||= row.querySelector('.subject')?.textContent?.trim().replace(/^\[\d{1,2}\/\d{1,2}\/\d{4}\]\s*/, '') || '';
    doc.edStatus ||= row.getAttribute('data-status') || '';
    doc.eligible = isDocumentEligible(row, doc);
    return doc;
};

export const scanDocuments = async ({ limit = null, onStatus = () => {} } = {}) => {
    const maximum = limit === null ? Infinity : Number(limit);
    if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 1)) {
        throw new Error('Số văn bản cần quét phải là số nguyên lớn hơn 0');
    }
    documents.forEach(doc => { doc.eligible = false; });
    await changePage('first');
    const seenPages = new Set();
    const qualified = new Set();
    while (true) {
        const pageRows = rows();
        const key = pageKey();
        if (seenPages.has(key)) throw new Error('Danh sách lặp lại cùng một trang khi quét');
        seenPages.add(key);
        for (const [pageIndex, row] of pageRows.entries()) {
            if (!hasInternalTransferMarker(row) && !hasRegisteredMarker(row)) continue;
            const id = row.getAttribute('data-id');
            if (qualified.has(id)) continue;
            const doc = collectRow(row, currentPage(), pageIndex);
            if (doc.selectionMarker === 'book') {
                doc.eligible = false;
                doc.detailsLoaded = false;
                onStatus(`Đang kiểm tra tài liệu chính: ${doc.signNumber || id}`);
                await loadDocumentDetails(id);
                doc.eligible = isDocumentEligible(rowFor(id), doc);
                if (!doc.eligible) continue;
            }
            qualified.add(id);
            if (qualified.size >= maximum) break;
        }
        onStatus(`Trang ${currentPage()}: ${qualified.size} văn bản đủ điều kiện`);
        notify();
        if (qualified.size >= maximum || !await changePage('next')) break;
    }
    return qualified.size;
};

const requireMarker = (row, expectedId) => {
    const id = row?.getAttribute('data-id') || expectedId;
    if (!hasInternalTransferMarker(row) && !hasRegisteredMarker(row)) {
        if (id && documents.has(id)) documents.get(id).eligible = false;
        throw new Error(`Văn bản ${id || ''} không có dấu Đã chuyển nội bộ hoặc Đã vào sổ đang hiển thị`);
    }
    return row;
};

const requireEligibleDocument = row => {
    requireMarker(row);
    const doc = getDocument(row.getAttribute('data-id'));
    doc.selectionMarker = hasInternalTransferMarker(row) ? 'internal' : 'book';
    doc.eligible = isDocumentEligible(row, doc);
    if (!doc.eligible) throw new Error(`Văn bản ${doc.signNumber || doc.id} đã vào sổ nhưng không có tài liệu chính khớp số văn bản`);
    return row;
};

const normalText = value => String(value || '').replace(/\s+/g, ' ').trim();
const displayMatches = doc => {
    const header = document.querySelector('#ed-view-subject');
    const transferSubject = document.querySelector('#ed-full-transfer-doc-text-subject');
    const element = visible(header) ? header : visible(transferSubject) ? transferSubject : null;
    if (!element || !doc.subject) return false;
    const subject = element.getAttribute?.('title') || element.textContent?.replace(/^\s*\[[^\]]+\]\s*/, '');
    if (normalText(subject) !== normalText(doc.subject)) return false;
    // The full-transfer panel has only a subject label. The native view header
    // also carries the sign number, so compare it when both sides expose one.
    const headerNumber = header === element ? element.textContent?.match(/\[\s*(.*?)\s+-\s+\d{1,2}\/\d{1,2}\/\d{4}\s*\]/)?.[1] : '';
    return !headerNumber || !doc.signNumber || normalText(headerNumber) === normalText(doc.signNumber);
};

const selected = id => rows().some(row => row.getAttribute('data-id') === id && row.classList.contains('selected'));
const waitForNativeView = async (id, previousSerial) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        requireMarker(rowFor(id), id);
        if (!selected(id)) throw new Error('Văn bản đang chọn đã thay đổi trong khi tải chi tiết');
        const witness = nativeViews.get(pageWindow());
        if (witness?.id === id && witness.serial > previousSerial && displayMatches(getDocument(id))) return;
        await sleep(100);
    }
    throw new Error(`Chưa xác nhận được màn hình iDesk đã tải đúng văn bản ${id}; hãy chọn lại văn bản`);
};

const selectAndWait = async row => {
    const serial = nativeViews.get(pageWindow())?.serial || 0;
    row.click();
    await waitForNativeView(row.getAttribute('data-id'), serial);
};

export const showDocument = async value => {
    const id = String(value?.id ?? value);
    let row = rowFor(id);
    if (!row) {
        const targetPage = documents.get(id)?.page;
        for (let guard = 0; targetPage && currentPage() !== targetPage && guard < 100; guard++) {
            if (!await changePage(currentPage() < targetPage ? 'next' : 'prev')) break;
        }
        row = rowFor(id);
    }
    if (!row) {
        await changePage('first');
        const seen = new Set();
        while (!row) {
            const key = pageKey();
            if (seen.has(key)) break;
            seen.add(key);
            row = rowFor(id);
            if (row || !await changePage('next')) break;
        }
    }
    if (!row) {
        if (documents.has(id)) documents.get(id).eligible = false;
        throw new Error(`Không tìm thấy văn bản ${id} trong danh sách Ban hành văn bản`);
    }
    requireMarker(row, id);
    collectRow(row, currentPage(), rows().indexOf(row));
    if (!row.classList.contains('selected')) {
        await selectAndWait(row);
    } else {
        const doc = getDocument(id);
        const nativeWitness = nativeViews.get(pageWindow());
        const resourceWitness = latestViewResource();
        const witnessedId = nativeWitness?.id || resourceWitness?.url.searchParams.get('id');
        if (witnessedId === id) {
            if (!doc.detailsLoaded) await loadDocumentDetails(id);
            if (displayMatches(doc)) return requireEligibleDocument(rowFor(id));
        }
        // A script enabled after load may lack a response witness. Selecting a
        // different row only reads it; eligibility still gates every analysis.
        const alternative = rows().find(item => item.getAttribute('data-id') !== id);
        if (!alternative) throw new Error('Không xác nhận được văn bản đang hiển thị; hãy mở lại danh sách iDesk');
        const serial = nativeViews.get(pageWindow())?.serial || 0;
        alternative.click();
        const deadline = Date.now() + 8000;
        let confirmed = false;
        while (Date.now() < deadline) {
            if (!selected(alternative.getAttribute('data-id'))) throw new Error('Văn bản đang chọn đã thay đổi trong khi tải chi tiết');
            const witness = nativeViews.get(pageWindow());
            if (witness?.id === alternative.getAttribute('data-id') && witness.serial > serial) { confirmed = true; break; }
            await sleep(100);
        }
        if (!confirmed) throw new Error('Chưa xác nhận được iDesk đã tải văn bản để chọn lại');
        await selectAndWait(requireMarker(rowFor(id), id));
    }
    return requireEligibleDocument(rowFor(id));
};

const copyNativeFields = (doc, ed) => {
    for (const field of ['signNumber', 'subject', 'docDateStr', 'author', 'category', 'signer', 'priority', 'security',
        'internalTransfer', 'externalTransfer', 'intProvinceTransfer', 'extProvinceTransfer', 'published', 'signed',
        'type', 'composedUnit', 'composer', 'documentId']) {
        if (ed[field] !== undefined && ed[field] !== null) doc[field] = ed[field];
    }
    if (ed.status !== undefined) doc.edStatus = ed.status;
};

export const ingestResponse = (input, data, body) => {
    const target = nativeTarget(input);
    if (!target || !data) return false;
    captureExecutor(target, body);
    if (target.endpoint === 'list' && Array.isArray(data.items)) {
        for (const item of data.items) {
            const ed = item.edSearchDto || {};
            if (item.id == null || (ed.type && ed.type !== 'out')) continue;
            const doc = getDocument(item.id);
            copyNativeFields(doc, ed);
            doc.responsibility = item.responsibility || doc.responsibility || 'main';
            doc.book = item.book ?? doc.book;
        }
    } else if (target.endpoint === 'view' && data.ed?.id != null && (!data.ed.type || data.ed.type === 'out')) {
        const doc = getDocument(data.ed.id);
        copyNativeFields(doc, data.ed);
        doc.attachments = Array.isArray(data.attachments) ? data.attachments : [];
        doc.receivers = Array.isArray(data.receivers) ? data.receivers : [];
        doc.book = data.book ?? doc.book;
        doc.detailsLoaded = true;
    } else if (target.endpoint === 'internal' && Array.isArray(data.elements)) {
        data.elements.forEach(node => { if (node?.id != null) internalDirectory.set(String(node.id), node); });
    } else if (target.endpoint === 'organization' && Array.isArray(data.elements)) {
        const sphere = target.url.searchParams.get('sphere');
        if (!SPHERES.includes(sphere)) return false;
        data.elements.forEach(node => {
            if (node?.code && (!node.sphere || node.sphere === sphere)) {
                organizationDirectory.set(`${sphere}:${node.code}`, { ...node, sphere });
            }
        });
    } else return false;
    notify();
    return true;
};

const fetchJson = async (url, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const page = pageWindow();
    const start = page.performance?.now?.();
    const read = nativeTarget(url)?.endpoint === 'view' && Number.isFinite(start)
        ? { url: new URL(url, window.location.origin).href, start, end: Infinity } : null;
    if (read) {
        if (!bridgeResourceReads.has(page)) bridgeResourceReads.set(page, []);
        bridgeResourceReads.get(page).push(read);
    }
    try {
        const options = { credentials: 'same-origin', signal: controller.signal, ...init };
        bridgeReads.add(options);
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`iDesk trả HTTP ${response.status}`);
        return await response.json();
    } finally {
        if (read) read.end = page.performance.now();
        clearTimeout(timer);
    }
};

const loadDocumentDetails = async key => {
    const doc = getDocument(key);
    if (doc.detailsLoaded) return doc;
    for (let attempt = 0; attempt < 15 && !recoverExecutor(); attempt++) {
        await sleep(150);
        if (doc.detailsLoaded) return doc;
    }
    if (!context.execAcode) throw new Error('Chưa xác định được người đang xử lý; hãy mở một văn bản rồi thử lại');
    const url = `${basePath()}${ENDPOINTS.view}?${new URLSearchParams({ exeacode: context.execAcode, id: key })}`;
    const data = await fetchJson(url);
    if (String(data.ed?.id ?? '') !== key || (data.ed.type && data.ed.type !== 'out')) {
        throw new Error('Chi tiết iDesk không khớp văn bản đi đang chọn');
    }
    requireMarker(rowFor(key), key);
    ingestResponse(url, data);
    return getDocument(key);
};

export const ensureDocumentDetails = async (id, { refresh = false } = {}) => {
    const key = String(id?.id ?? id);
    if (refresh) getDocument(key).detailsLoaded = false;
    await showDocument(key);
    return loadDocumentDetails(key);
};

export const chooseAttachment = doc => selectAttachment(doc.selectionMarker === 'book'
    ? { ...doc, attachments: getNumberMatchedAttachments(doc) } : doc, true);

export const primeDirectories = async () => {
    if (!recoverExecutor()) throw new Error('Chưa xác định được người đang xử lý để tải danh bạ iDesk');
    const actor = context.execAcode;
    const requests = [
        [`${basePath()}${ENDPOINTS.internal}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams({ exeacode: actor, type: 'transfer' }).toString()
        }],
        ...SPHERES.map(sphere => [`${basePath()}${ENDPOINTS.organization}?${new URLSearchParams({ sphere, exeacode: actor })}`, {}])
    ];
    await Promise.all(requests.map(async ([url, init]) => ingestResponse(url, await fetchJson(url, init), init.body)));
    return { internal: internalDirectory.size, organizations: organizationDirectory.size };
};

export const fetchLookupPayload = async () => {
    if (!recoverExecutor()) return null;
    const actor = context.execAcode;
    const [person, unit_internal, unit_external] = await Promise.all([
        fetchJson(`${basePath()}${ENDPOINTS.internal}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body: new URLSearchParams({ exeacode: actor, type: 'transfer' }).toString()
        }),
        fetchJson(`${basePath()}${ENDPOINTS.organization}?${new URLSearchParams({ sphere: 'int_province_comm', exeacode: actor })}`),
        fetchJson(`${basePath()}${ENDPOINTS.organization}?${new URLSearchParams({ sphere: 'ext_province_comm', exeacode: actor })}`)
    ]);
    return { person, unit_internal, unit_external };
};

export const downloadPDF = attachment => new Promise((resolve, reject) => {
    if (!attachment?.contentUid) return reject(new Error('Tệp đính kèm không có contentUid'));
    const url = `${window.location.origin}${basePath()}/docx/download.cpx?${new URLSearchParams({ docID: attachment.contentUid, view: 'pdf', t: String(Date.now()) })}`;
    GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', anonymous: false, timeout: 60000,
        onload: async response => {
            try {
                if (response.status < 200 || response.status >= 300) throw new Error(`Tải PDF iDesk trả HTTP ${response.status}`);
                const blob = response.response;
                if (!blob?.arrayBuffer || new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5)) !== '%PDF-') {
                    throw new Error('iDesk không trả nội dung PDF; hãy kiểm tra phiên đăng nhập và tệp đính kèm');
                }
                const originalName = attachment.name || `document-${attachment.contentUid}.pdf`;
                const name = /\.pdf$/i.test(originalName) ? originalName : `${originalName.replace(/\.(docx?|odt|rtf)$/i, '')}.pdf`;
                resolve(new File([blob], name, { type: 'application/pdf' }));
            } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('Không tải được PDF từ iDesk')),
        ontimeout: () => reject(new Error('Tải PDF iDesk quá thời gian chờ'))
    });
});

export const installInterceptors = (callback = () => {}) => {
    onChange = callback;
    const page = pageWindow();
    if (installedRealms.has(page)) return;
    installedRealms.add(page);
    const nativeResponse = (input, data, body) => {
        if (!ingestResponse(input, data, body)) return;
        const target = nativeTarget(input);
        const id = String(data.ed?.id ?? '');
        if (target?.endpoint === 'view' && id && id === target.url.searchParams.get('id')) {
            nativeViews.set(page, { id, serial: (nativeViews.get(page)?.serial || 0) + 1 });
        }
    };
    const prototype = page.XMLHttpRequest?.prototype;
    if (prototype) {
        const originalOpen = prototype.open;
        const originalSend = prototype.send;
        const requests = new WeakMap();
        prototype.open = function(method, url) {
            requests.set(this, { url });
            return originalOpen.apply(this, arguments);
        };
        prototype.send = function(body) {
            const request = requests.get(this);
            const target = nativeTarget(request?.url);
            if (target) {
                captureExecutor(target, body);
                this.addEventListener('load', () => {
                    try {
                        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                        nativeResponse(request.url, data, body);
                    } catch { /* Unrelated/non-JSON responses must keep working. */ }
                }, { once: true });
            }
            return originalSend.apply(this, arguments);
        };
    }
    if (typeof page.fetch === 'function') {
        const originalFetch = page.fetch;
        page.fetch = async function(input, init) {
            const target = nativeTarget(input);
            if (target) captureExecutor(target, init?.body);
            const response = await originalFetch.apply(this, arguments);
            if (target) {
                try {
                    const data = await response.clone().json();
                    if (init && bridgeReads.has(init)) ingestResponse(target.url.href, data, init.body);
                    else nativeResponse(target.url.href, data, init?.body);
                } catch { /* Preserve the native response. */ }
            }
            return response;
        };
    }
};

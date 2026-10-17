import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    documents, internalDirectory, organizationDirectory, context,
    hasInternalTransferMarker, scanDocuments, showDocument, ensureDocumentDetails,
    downloadPDF, installInterceptors, ingestResponse, chooseAttachment, primeDirectories
} from '../src/outgoing/idesk.js';

const resources = new URL('../resource/Văn bản đi/Ban hành văn bản/', import.meta.url);
const fixture = name => JSON.parse(readFileSync(new URL(name, resources), 'utf8'));
const originalFetch = globalThis.fetch;

afterEach(() => {
    documents.clear();
    internalDirectory.clear();
    organizationDirectory.clear();
    context.basePath = '';
    context.execAcode = '';
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.unsafeWindow;
    delete globalThis.GM_xmlhttpRequest;
    globalThis.fetch = originalFetch;
});

const iconSelector = 'i.icon-share-sign.blue[title="Đã chuyển nội bộ"]';
const bookSelector = 'i.icon-book[title="Đã vào sổ"]';
const row = (id, qualified = true, options = {}) => {
    const icon = {
        getClientRects: () => qualified ? [{}] : [],
        parentElement: options.hiddenParent ? { style: { display: 'none' }, parentElement: null } : null
    };
    const classes = new Set(options.selected ? ['selected'] : []);
    return {
        id: String(id), classes,
        attachments: options.attachments || [],
        subject: options.subject || `Văn bản ${id}`,
        signNumber: options.signNumber || `${id}/QĐ-UBND`,
        getClientRects: () => [{}],
        getAttribute: name => name === 'data-id' ? String(id) : name === 'data-status' ? 'completed' : null,
        classList: { contains: name => classes.has(name) },
        querySelectorAll: selector => selector === iconSelector ? [icon] : selector === bookSelector ? [{
            getClientRects: () => options.book ? [{}] : [],
            parentElement: options.hiddenBook ? { style: { display: 'none' }, parentElement: null } : null
        }] : [],
        querySelector: selector => selector === '.sender' ? { textContent: options.signNumber || `${id}/QĐ-UBND` } :
            selector === '.subject' ? { textContent: options.subject || `Văn bản ${id}` } : null,
        click() { classes.add('selected'); }
    };
};

const browser = (pages, start = 0) => {
    let page = start;
    let displayed = pages[page].find(item => item.classes.has('selected')) || pages[page][0];
    globalThis.window = {
        location: { origin: 'https://vpdt.gialai.gov.vn', pathname: '/vpub/smartcloud/idesk6/page/paperwork/ed/publish-doc.cpx' },
        getComputedStyle: element => ({ display: element.style?.display || 'block', visibility: 'visible', opacity: '1' }),
        performance: { getEntriesByType: () => displayed ? [{ name: `https://vpdt.gialai.gov.vn/vpub/smartcloud/document/edocs/view.cpx?exeacode=simulated-actor&id=${displayed.id}`, startTime: 1 }] : [] },
        fetch: async input => {
            const id = new URL(input, window.location.origin).searchParams.get('id');
            const target = pages.flat().find(item => item.id === id);
            const json = async () => ({ ed: { id, type: 'out', subject: target.subject, signNumber: target.signNumber }, attachments: target.attachments });
            return { ok: true, json, clone: () => ({ json }) };
        }
    };
    installInterceptors();
    for (const item of pages.flat()) item.click = () => {
        pages.flat().forEach(other => other.classes.delete('selected'));
        item.classes.add('selected');
        displayed = item;
        void window.fetch(`/vpub/smartcloud/document/edocs/view.cpx?exeacode=simulated-actor&id=${item.id}`);
    };
    const control = (enabled, action) => ({ disabled: !enabled, classList: { contains: () => false }, click: action });
    globalThis.document = {
        querySelectorAll: selector => selector === '#listview-publish-list-content .messageListItem[data-id]' ? pages[page] : [],
        querySelector: selector => {
            if (selector === '#ed-view-subject') return displayed ? { getClientRects: () => [{}], textContent: `[${displayed.signNumber} - 19/08/2026] ${displayed.subject}`, getAttribute: () => displayed.subject } : null;
            if (selector === '#listview-publish-paging [data-page="number"]') return { textContent: String(page + 1) };
            if (selector.endsWith('pagingbtn-first')) return control(page > 0, () => { page = 0; });
            if (selector.endsWith('pagingbtn-prev')) return control(page > 0, () => { page--; });
            if (selector.endsWith('pagingbtn-next')) return control(page < pages.length - 1, () => { page++; });
            const id = selector.match(/data-id="([^"]+)"/)?.[1];
            return id ? pages[page].find(item => item.id === id) || null : null;
        }
    };
    return { page: () => page, display: item => { displayed = item; } };
};

const outgoingDetailSubject = 'Phê duyệt kết quả trúng đấu giá quyền khai thác khoáng sản Khu vực mỏ số 78 - Mỏ đất sét làm gạch xã Chư A Thai, tỉnh Gia Lai';
const detailedRow = () => row('4222801', true, { selected: true, subject: outgoingDetailSubject, signNumber: '3550/QĐ-UBND' });

test('requires the rendered internal-transfer icon, even though captured templates contain it on every row', () => {
    const html = readFileSync(new URL('left_panel.html', resources), 'utf8');
    for (const [id, visible] of [['4671069', false], ['4222801', true]]) {
        const block = html.split(`<div data-id="${id}" class="messageListItem`)[1]?.split('<div data-id="')[0];
        assert.ok(block?.includes('icon-share-sign blue" title="Đã chuyển nội bộ"'));
        browser([[row(id, visible)]]);
        assert.equal(hasInternalTransferMarker(document.querySelectorAll('#listview-publish-list-content .messageListItem[data-id]')[0]), visible);
    }
    assert.equal(hasInternalTransferMarker(row('hidden-parent', true, { hiddenParent: true })), false);
});

test('filters all pages by visible marker before applying the document limit and resets old eligibility', async () => {
    const navigation = browser([[row('a', false), row('b')], [row('c', false), row('d'), row('e')]], 1);
    documents.set('stale', { id: 'stale', eligible: true });
    const count = await scanDocuments({ limit: 2 });
    assert.equal(count, 2);
    assert.deepEqual([...documents.values()].filter(doc => doc.eligible).map(doc => doc.id), ['b', 'd']);
    assert.equal(documents.get('stale').eligible, false);
    assert.equal(navigation.page(), 1);
    assert.equal(documents.get('d').page, 2);
});

test('includes registered rows with matching main files after skipping empty, foreign-number and unnumbered attachments before the limit', async () => {
    const attachment = (name, contentUid) => ({ name, contentUid, format: 'pdf', signed: 'Y' });
    const good = row('12629', false, { book: true, attachments: [
        { name: '26.10.10 CVUB gui Bo K.doc', contentUid: 'draft', format: 'doc' },
        attachment('12629_UBND-KGVX_13102026.pdf', 'main')
    ] });
    browser([[
        row('empty', false, { book: true }),
        row('foreign', false, { book: true, signNumber: '12629/UBND-KGVX', attachments: [attachment('12628_dadongdau.pdf', 'foreign')] }),
        row('unnumbered', false, { book: true, attachments: [attachment('du-thao.pdf', 'draft')] }),
        row('hidden', false, { book: true, hiddenBook: true, attachments: [attachment('9.pdf', 'hidden')] }),
    ], [good, row('internal')]]);
    globalThis.fetch = window.fetch;
    assert.equal(await scanDocuments({ limit: 2 }), 2);
    assert.deepEqual([...documents.values()].filter(doc => doc.eligible).map(doc => doc.id), ['12629', 'internal']);
    assert.equal(documents.get('12629').selectionMarker, 'book');
    assert.equal(chooseAttachment(documents.get('12629')).contentUid, 'main');
    assert.equal(await ensureDocumentDetails('12629'), documents.get('12629'));
});

test('registered main-file selection requires a matching number and downloadable attachment before existing signed/PDF priorities', () => {
    const doc = { selectionMarker: 'book', signNumber: '339/QĐ-UBND', attachments: [
        { name: '340_dadongdau.pdf', signed: 'Y', format: 'pdf', size: 10000, contentUid: 'foreign' },
        { name: '0339_QD_UBND.doc', format: 'doc', size: 100, contentUid: 'main' }
    ] };
    assert.equal(chooseAttachment(doc)?.contentUid, 'main');
    for (const attachments of [[], [doc.attachments[0]], [{ name: 'du-thao.pdf', contentUid: 'draft' }], [{ name: '339.pdf' }]]) {
        assert.equal(chooseAttachment({ ...doc, attachments }), null);
    }
    assert.equal(chooseAttachment({ ...doc, signNumber: '[Không có số ký hiệu]' }), null);
    assert.equal(chooseAttachment({ ...doc, selectionMarker: 'internal' }).contentUid, 'foreign');
});

test('does not mistake dates, embedded references or numbered appendices for a registered main file', () => {
    for (const name of ['26.10.10 CVUB gui Bo K.doc', '26-10-2026.pdf', '20261026.pdf', 'du-thao-26.doc', '26_phu_luc.pdf', '26 PL daky.pdf']) {
        assert.equal(chooseAttachment({ selectionMarker: 'book', signNumber: '26/UBND-KGVX',
            attachments: [{ name, contentUid: 'not-main', signed: 'Y' }] }), null, name);
    }
    assert.equal(chooseAttachment({ selectionMarker: 'book', signNumber: '26/UBND-KGVX',
        attachments: [{ name: 'CV-0026_daky.pdf', contentUid: 'main' }] })?.contentUid, 'main');
});

test('rechecks registered attachment eligibility when opening a cached document', async () => {
    const target = row('339', false, { book: true, attachments: [{ name: '340.pdf', contentUid: 'foreign' }] });
    browser([[row('other'), target]]);
    documents.set('339', { id: '339', selectionMarker: 'book', eligible: true, detailsLoaded: true,
        attachments: [{ name: '339.pdf', contentUid: 'old-main' }] });
    await assert.rejects(ensureDocumentDetails('339'), /tài liệu chính/i);
    assert.equal(documents.get('339').eligible, false);
});

test('refreshes selected registered details before upload instead of accepting a cached main file', async () => {
    const target = row('339', false, { book: true, attachments: [{ name: '339.pdf', contentUid: 'main' }] });
    browser([[row('other'), target]]);
    globalThis.fetch = window.fetch;
    await ensureDocumentDetails('339');
    target.attachments = [];
    await assert.rejects(ensureDocumentDetails('339', { refresh: true }), /tài liệu chính/i);
    assert.equal(documents.get('339').eligible, false);
});

test('finds a qualifying document across pages and selects the exact row', async () => {
    const target = row('second');
    browser([[row('first')], [target]]);
    assert.equal(await showDocument('second'), target);
    assert.equal(target.classes.has('selected'), true);
});

test('does not return a newly selected row while native view still displays another document', async () => {
    const previous = row('previous', true, { selected: true });
    const target = row('target');
    const page = browser([[previous, target]]);
    let waited = false;
    let timer;
    target.click = () => {
        previous.classes.delete('selected');
        target.classes.add('selected');
        timer = setTimeout(() => {
            waited = true;
            page.display(target);
            void window.fetch('/vpub/smartcloud/document/edocs/view.cpx?exeacode=simulated-actor&id=target');
        }, 450);
    };
    try {
        assert.equal(await showDocument('target'), target);
        assert.equal(waited, true);
    } finally { clearTimeout(timer); }
});

test('an explicit detail lookup cannot stand in for an intercepted native rendered-view response', async () => {
    const target = row('target', true, { selected: true });
    const alternative = row('alternative', false);
    browser([[target, alternative]]);
    window.performance.now = () => 100;
    globalThis.fetch = window.fetch;
    await ensureDocumentDetails('target');
    // The only request this bridge made was its own read; the page has no native
    // target-response witness now, so it must reselect before claiming readiness.
    window.performance.getEntriesByType = () => [
        { name: 'https://vpdt.gialai.gov.vn/vpub/smartcloud/document/edocs/view.cpx?exeacode=simulated-actor&id=target', startTime: 100 },
        { name: 'https://vpdt.gialai.gov.vn/vpub/smartcloud/document/edocs/view.cpx?exeacode=simulated-actor&id=alternative', startTime: 2 }
    ];
    let alternativeClicks = 0;
    const originalClick = alternative.click;
    alternative.click = () => { alternativeClicks++; originalClick(); };
    await showDocument('target');
    assert.equal(alternativeClicks, 1);
});

test('refuses a cached eligible document whose current row has a hidden marker', async () => {
    browser([[row('no-marker', false, { selected: true })]]);
    documents.set('no-marker', { id: 'no-marker', eligible: true, attachments: [{ contentUid: 'unsafe' }], detailsLoaded: true });
    await assert.rejects(ensureDocumentDetails('no-marker'), /chuyển nội bộ|chuyen noi bo/i);
    assert.equal(documents.get('no-marker').eligible, false);
});

test('captures only native outgoing API paths and preserves zero flags and client workflow state', () => {
    browser([[]]);
    documents.set('4690164', { id: '4690164', status: 'review', eligible: false });
    ingestResponse('/vpub/smartcloud/document/edocs/qspublishing.cpx', fixture('qspublishing.cpx'));
    const doc = documents.get('4690164');
    assert.equal(doc.status, 'review');
    assert.equal(doc.edStatus, 'create');
    assert.equal(doc.internalTransfer, 0);
    assert.equal(doc.priority, 0);
    assert.equal(doc.eligible, false);
    ingestResponse('https://other.example/vpub/smartcloud/document/edocs/qspublishing.cpx', { items: [{ id: 999 }] });
    ingestResponse('/vpub/smartcloud/other/view.cpx?exeacode=wrong', { ed: { id: 888, type: 'out' } });
    ingestResponse('/vpub/smartcloud/document/edocs/view.cpx?exeacode=current-actor', fixture('view.cpx (văn bản có tài liệu)'));
    assert.equal(documents.has('999'), false);
    assert.equal(documents.has('888'), false);
    assert.equal(context.execAcode, 'current-actor');
    assert.equal(documents.get('4222801').attachments.length, 2);
    assert.equal(chooseAttachment(documents.get('4222801')).contentUid, '6a85787006f7237314815031');
});

test('keeps organization IDs in separate exact-code namespaces and internal alias nodes intact', () => {
    browser([[]]);
    ingestResponse('/vpub/smartcloud/comm/nodes/fbyvsphere.cpx', fixture('fbyvsphere.cpx'));
    ingestResponse('/vpub/smartcloud/history/organext/list.cpx?sphere=int_province_comm', fixture('list.cpx internal province'));
    ingestResponse('/vpub/smartcloud/history/organext/list.cpx?sphere=ext_province_comm', fixture('list.cpx list except_province'));
    assert.equal(internalDirectory.get('249').name, 'UBND tỉnh Gia Lai');
    assert.equal(organizationDirectory.get('int_province_comm:H21.24').name, 'Sở Nông nghiệp và Môi trường - tỉnh Gia Lai');
    assert.ok([...organizationDirectory.keys()].some(key => key.startsWith('ext_province_comm:')));
});

test('bootstraps an already-selected row using the current executor and checks detail document identity', async () => {
    browser([[detailedRow()]]);
    context.execAcode = 'live-current-actor';
    let requestedUrl;
    globalThis.fetch = async url => {
        requestedUrl = new URL(url, window.location.origin);
        return { ok: true, json: async () => fixture('view.cpx (văn bản có tài liệu)') };
    };
    const doc = await ensureDocumentDetails('4222801');
    assert.equal(requestedUrl.searchParams.get('exeacode'), 'live-current-actor');
    assert.equal(requestedUrl.searchParams.get('id'), '4222801');
    assert.equal(doc.id, '4222801');
    assert.equal(doc.attachments[1].signed, 'Y');
    doc.detailsLoaded = false;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ed: { id: 123, type: 'out' }, attachments: [] }) });
    await assert.rejects(ensureDocumentDetails('4222801'), /khớp|khop/i);
});

test('recovers the current executor from same-origin resource timing rather than the document creator', async () => {
    browser([[detailedRow()]]);
    globalThis.unsafeWindow = { performance: { getEntriesByType: () => [
        { name: 'https://other.example/vpub/smartcloud/document/edocs/view.cpx?exeacode=wrong', startTime: 200 },
        { name: 'https://vpdt.gialai.gov.vn/vpub/smartcloud/document/edocs/view.cpx?exeacode=live-actor&id=4222801', startTime: 100 }
    ] } };
    let executor;
    globalThis.fetch = async url => {
        executor = new URL(url, window.location.origin).searchParams.get('exeacode');
        return { ok: true, json: async () => fixture('view.cpx (văn bản có tài liệu)') };
    };
    await ensureDocumentDetails('4222801');
    assert.equal(executor, 'live-actor');
    assert.equal(context.execAcode, 'live-actor');
});

test('loads all three recipient catalogs with the current executor using read-only native endpoints', async () => {
    browser([[]]);
    context.execAcode = 'live-current-actor';
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
        const target = new URL(url, window.location.origin);
        requests.push({ target, init });
        return { ok: true, json: async () => target.pathname.includes('fbyvsphere') ? { elements: [{ id: 1, type: 'alias', name: 'Văn thư' }] } :
            { elements: [{ code: 'same-code', sphere: target.searchParams.get('sphere'), name: 'Một đơn vị' }] } };
    };
    await primeDirectories();
    assert.equal(requests.length, 3);
    const internal = requests.find(request => request.target.pathname.includes('fbyvsphere'));
    assert.equal(internal.init.method, 'POST');
    assert.equal(new URLSearchParams(internal.init.body).get('exeacode'), 'live-current-actor');
    assert.equal(new URLSearchParams(internal.init.body).get('type'), 'transfer');
    assert.ok(requests.filter(request => !request.target.pathname.includes('fbyvsphere')).every(request => request.target.searchParams.get('exeacode') === 'live-current-actor'));
    assert.equal(organizationDirectory.size, 2);
});

test('intercepts native page fetch responses without consuming the page response body', async () => {
    browser([[]]);
    const response = { clone: () => ({ json: async () => ({ items: [{ id: 77, edSearchDto: { id: 77, type: 'out', internalTransfer: 0 } }] }) }) };
    globalThis.unsafeWindow = { fetch: async () => response };
    let changes = 0;
    installInterceptors(() => { changes++; });
    assert.equal(await unsafeWindow.fetch('/vpub/smartcloud/document/edocs/qspublishing.cpx'), response);
    assert.equal(documents.get('77').internalTransfer, 0);
    assert.ok(changes > 0);
});

test('intercepts the native page XHR realm and captures the executor from POST form data', () => {
    browser([[]]);
    class NativeXHR {
        open() {}
        addEventListener(name, listener) { this.listener = listener; }
        send() { this.responseText = JSON.stringify({ elements: [{ id: 42, name: 'Phòng ban' }] }); this.listener(); }
    }
    globalThis.unsafeWindow = { XMLHttpRequest: NativeXHR };
    installInterceptors();
    const xhr = new unsafeWindow.XMLHttpRequest();
    xhr.open('POST', '/vpub/smartcloud/comm/nodes/fbyvsphere.cpx');
    xhr.send('exeacode=native-actor&type=transfer');
    assert.equal(context.execAcode, 'native-actor');
    assert.equal(internalDirectory.get('42').name, 'Phòng ban');
});

test('downloads the selected attachment by encoded contentUid and rejects login HTML even on HTTP 200', async () => {
    browser([[]]);
    let requestedUrl;
    globalThis.GM_xmlhttpRequest = options => {
        requestedUrl = new URL(options.url);
        options.onload({ status: 200, response: new Blob(['%PDF-1.7\nexample'], { type: 'application/pdf' }) });
    };
    const file = await downloadPDF({ contentUid: 'id&with spaces', name: 'Văn bản.doc', format: 'doc' });
    assert.equal(requestedUrl.searchParams.get('docID'), 'id&with spaces');
    assert.equal(file.name, 'Văn bản.pdf');
    assert.equal(file.type, 'application/pdf');
    globalThis.GM_xmlhttpRequest = options => options.onload({ status: 200, response: new Blob(['<html>Login</html>'], { type: 'text/html' }) });
    await assert.rejects(downloadPDF({ contentUid: 'doc', name: 'doc.pdf' }), /PDF/);
});

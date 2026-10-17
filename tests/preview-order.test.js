import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { docCache, state } from '../src/state.js';
import { updateDashboard } from '../src/ui/dashboard.js';
import { getAttachmentPreviewUrl, selectAttachment } from '../src/utils/attachment.js';
import { getPendingDocumentIds } from '../src/controllers/mainController.js';

globalThis.window = { location: { origin: 'https://vpdt.gialai.gov.vn', pathname: '/snnmt/smartcloud/idesk6/page/paperwork/ed/received-doc.cpx' } };
globalThis.document = { getElementById: () => null };

afterEach(() => {
    docCache.clear();
    state.basePath = '';
    document.getElementById = () => null;
});

test('builds the preview URL for the same attachment selected as the main document', () => {
    const doc = {
        signNumber: '12/CV-ABC',
        attachments: [
            { name: 'phu-luc.pdf', format: 'pdf', signed: 'Y', size: 500, contentUid: 'appendix' },
            { name: '12_CV_dadongdau.pdf', format: 'pdf', signed: 'Y', size: 100, contentUid: 'main/id' }
        ]
    };
    const selected = selectAttachment(doc, true);
    assert.equal(selected.contentUid, 'main/id');
    assert.match(getAttachmentPreviewUrl(selected), /^https:\/\/vpdt\.gialai\.gov\.vn\/snnmt\/smartcloud\/docx\/download\.cpx\?docID=main%2Fid&view=pdf&t=\d+$/);
});

test('renders documents from the last row of the last page to the first row of the first page', () => {
    const cardFeed = { innerHTML: '' };
    document.getElementById = id => id === 'rpa-card-feed' ? cardFeed : null;
    const add = (id, page, pageIndex) => docCache.set(id, {
        id, page, pageIndex, eligible: true, kind: 'ordinary', status: 'idle', subject: id,
        attachments: [], aiData: { coordinating_units: [] }
    });
    add('first-page-first-row', 1, 0);
    add('last-page-first-row', 2, 0);
    add('last-page-last-row', 2, 1);

    updateDashboard();

    assert.ok(cardFeed.innerHTML.indexOf('last-page-last-row') < cardFeed.innerHTML.indexOf('last-page-first-row'));
    assert.ok(cardFeed.innerHTML.indexOf('last-page-first-row') < cardFeed.innerHTML.indexOf('first-page-first-row'));
});

test('sorts the scan-and-send queue from the last document to the first document', () => {
    const add = (id, page, pageIndex, status = 'idle') =>
        docCache.set(id, { id, page, pageIndex, status, eligible: true });
    add('first-page-first-row', 1, 0);
    add('last-page-first-row', 2, 0, 'ai_error');
    add('last-page-last-row', 2, 1);
    add('already-done', 3, 0, 'ai_done');

    assert.deepEqual(getPendingDocumentIds(), [
        'last-page-last-row',
        'last-page-first-row',
        'first-page-first-row'
    ]);
});

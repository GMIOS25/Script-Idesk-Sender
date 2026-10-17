import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSessionDocument } from '../src/outgoing/dashboard.js';
import { documentMetadata } from '../src/outgoing/provider.js';

test('discards reviewed recipients and feedback when the native main attachment changes', () => {
    const old = { name: '339.pdf', contentUid: 'old-main' };
    const doc = { id: '339', signNumber: '339/UBND', selectionMarker: 'book', attachments: [old] };
    const session = { doc, attachment: old, metadata: documentMetadata(doc, old),
        review: { recipients: ['old-recipient'] }, reviewed: true, feedbackId: 'old-feedback', applied: ['old-fill'] };
    const replacement = { name: '339_updated.pdf', contentUid: 'new-main' };
    doc.attachments = [replacement];
    refreshSessionDocument(session, doc);
    assert.equal(session.attachment.contentUid, 'new-main');
    assert.equal(session.review, null);
    assert.equal(session.reviewed, false);
    assert.equal(session.feedbackId, '');
    assert.equal(session.applied, null);
});

test('preserves a reviewed session when the refreshed main file and document metadata still match', () => {
    const attachment = { name: '339.pdf', contentUid: 'main' };
    const doc = { id: '339', signNumber: '339/UBND', selectionMarker: 'book', attachments: [attachment] };
    const review = { recipients: ['reviewed-recipient'] };
    const session = { attachment, metadata: documentMetadata(doc, attachment), review, reviewed: true };
    refreshSessionDocument(session, doc);
    assert.equal(session.review, review);
    assert.equal(session.reviewed, true);
});

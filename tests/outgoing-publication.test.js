import assert from 'node:assert/strict';
import test from 'node:test';
import { documentMetadata } from '../src/outgoing/provider.js';
import { createReview, reviewProblems } from '../src/outgoing/review.js';

test('requires explicit publication scope and uses the intended date', () => {
    const doc = { id: '3', publishedDate: 'Oct 26, 2026, 10:57:54 AM', externalTransfer: '2' };
    assert.equal(documentMetadata(doc).publication, undefined);
    assert.deepEqual(documentMetadata(doc, null, { mode: 'confirmed_intent', date: '2026-11-06', external: true }).publication,
        { mode: 'confirmed_intent', date: '2026-11-06', external: true });
    assert.throws(() => documentMetadata(doc, null, { mode: 'confirmed_intent', date: '2026-02-30', external: true }), /Ngày|Thông tin/);
});

test('preselects the required publication field and detects removal', () => {
    const team = { recipient_id: 'team', source_id: '1', recipient_type: 'INTERNAL_PERSON', sphere: 'internal', code: 'team@example.test', name: 'Team' };
    const review = createReview({ schema_version: 'outgoing.v1', people: [team],
        field_suggestions: [{ recipient_id: 'team', field: 'responsible' }],
        audit: { publication: { recipients: ['team'], missing: [] } } });
    assert.deepEqual(review.assignments.team, ['responsible']);
    assert.deepEqual(reviewProblems(review), []);
    review.assignments.team = ['save'];
    assert.ok(reviewProblems(review).length);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocumentList, renderReview } from '../src/outgoing/view.js';
import { createReview } from '../src/outgoing/review.js';
import * as view from '../src/outgoing/view.js';

for (const state of ['pending', 'processing', 'review']) {
    test(`does not offer a department filter in the ${state} document view`, () => {
        const session = {
            doc: { id: '1528', departmentCode: 'KGVX' },
            processing: state === 'processing',
            ...(state === 'review' ? { review: createReview({
                schema_version: 'outgoing.v1', extraction_status: 'complete', registry_version: 'r', alias_policy_version: 'p',
                people: [], units: [], unresolved: [], mentions: [], excluded: []
            }) } : {})
        };
        const html = renderReview(session);
        assert.doesNotMatch(html, /Mã phòng|data-setting="department"/);
        assert.match(html, /data-setting="attachment"/);
    });
}

test('only renders eligible documents and escapes document content', () => {
    const docs = new Map([
        ['1', { id: '1', eligible: true, subject: '<img src=x onerror=alert(1)>', signNumber: '1/UBND' }],
        ['2', { id: '2', eligible: false, subject: 'Chưa chuyển nội bộ' }]
    ]);
    const html = renderDocumentList(docs, '1', new Map());
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('Chưa chuyển nội bộ'));
});

test('renders evidence and review controls safely without converting partial extraction to success', () => {
    const result = { schema_version: 'outgoing.v1', document_id: '1', job_id: 'j', extraction_status: 'partial', registry_version: 'r', alias_policy_version: 'p', people: [], units: [], review_reasons: ['extraction_partial'], unresolved: [{ mention_id: 'm', raw: '<script>bad</script>', reason: 'ambiguous', candidates: [], evidence: [{ page: 2, raw: '<b>raw</b>' }] }], mentions: [], excluded: [] };
    const html = renderReview({ doc: { id: '1' }, review: createReview(result), reviewed: false });
    assert.ok(html.includes('Cần rà soát'));
    assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
    assert.ok(html.includes('&lt;b&gt;raw&lt;/b&gt;'));
    assert.ok(html.includes('data-action="apply" disabled'));
});

test('shows the registered status and offers only number-matching main attachments on registered rows', () => {
    const html = renderReview({ doc: { id: '12629', selectionMarker: 'book', signNumber: '12629/UBND-KGVX', attachments: [
        { name: '12629_UBND-KGVX.pdf', contentUid: 'main' },
        { name: '12628_dadongdau.pdf', contentUid: 'foreign' },
        { name: 'du-thao.doc', contentUid: 'draft' }
    ] }, attachment: { contentUid: 'main' } });
    assert.ok(html.includes('Đã vào sổ'));
    assert.ok(!html.includes('Đã chuyển nội bộ'));
    assert.ok(html.includes('12629_UBND-KGVX.pdf'));
    assert.ok(!html.includes('12628_dadongdau.pdf'));
    assert.ok(!html.includes('du-thao.doc'));
});

test('keeps lookup and recipient assignments outside the scrolling document review', () => {
    const person = { recipient_id: 'person-1', source_id: '1', recipient_type: 'INTERNAL_PERSON', sphere: 'internal', code: 'p1', name: 'Nguyễn Văn An' };
    const session = { doc: { id: '42' }, searchQuery: 'Sở <Nội vụ>', searchResults: [person], review: createReview({
        schema_version: 'outgoing.v1', extraction_status: 'complete', registry_version: 'r', alias_policy_version: 'p',
        people: [person], units: [], unresolved: [{ mention_id: 'm1', raw: 'Sở <Nội vụ>', reason: 'no_match', candidates: [] }], mentions: [], excluded: []
    }) };
    const main = renderReview(session);
    assert.ok(!main.includes('data-form="recipient-search"'), 'lookup belongs in the right panel');
    assert.ok(!main.includes('data-assignment='), 'assignments belong beside lookup');
    assert.ok(main.includes('data-action="lookup-mention"'), 'unmatched names can open lookup in place');
    const right = view.renderRecipientPanel(session);
    assert.ok(right.includes('data-form="recipient-search"'));
    assert.ok(right.includes('data-assignment="responsible"'));
    assert.ok(right.includes('Sở &lt;Nội vụ&gt;'));
    assert.ok(right.includes('Đã thêm'));
    assert.ok(!right.includes('data-action="search-add"'), 'selected identities cannot be added again');
});

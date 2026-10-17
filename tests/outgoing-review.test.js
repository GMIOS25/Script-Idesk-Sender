import test from 'node:test';
import assert from 'node:assert/strict';
import { createReview, assignRecipient, setRecipient, setDecision, reviewProblems, buildFeedback } from '../src/outgoing/review.js';

const person = { recipient_id: 'internal_270', source_id: '270', recipient_type: 'INTERNAL_PERSON', sphere: 'internal', code: 'tuanpa@vpub.gialai.gov.vn', name: 'Chủ tịch UBND tỉnh' };
const unit = { recipient_id: 'comm_1', source_id: 'history-uuid', recipient_type: 'INT_PROVINCE_UNIT', sphere: 'int_province_comm', code: 'H21.17', name: 'Sở Văn hóa' };
const result = (extra = {}) => ({ schema_version: 'outgoing.v1', document_id: '42', job_id: 'job-1', registry_version: 'registry-1', alias_policy_version: 'policy-1', extraction_status: 'complete', people: [person], units: [unit], unresolved: [], excluded: [], review_reasons: [], ...extra });

test('requires choosing an internal field and keeps province identities in their own field', () => {
    const review = createReview(result());
    assert.ok(reviewProblems(review).some(problem => problem.includes('Chủ tịch')));
    assert.throws(() => assignRecipient(review, unit.recipient_id, ['save']), /trường|phạm vi/i);
    assignRecipient(review, person.recipient_id, ['save']);
    const body = buildFeedback(review);
    assert.deepEqual(body.field_assignments, [{ recipient_id: 'internal_270', field: 'save' }, { recipient_id: 'comm_1', field: 'inside_unit' }]);
    assert.deepEqual(body.final_recipients[1], { recipient_id: 'comm_1', recipient_type: 'INT_PROVINCE_UNIT', sphere: 'int_province_comm', code: 'H21.17' });
});

test('blocks confirmed feedback until unresolved mentions and partial extraction reasons are reviewed', () => {
    const review = createReview(result({ extraction_status: 'partial', review_reasons: ['extraction_partial'], unresolved: [{ mention_id: 'm-1', raw: 'PCT', reason: 'ambiguous', candidates: [person] }] }));
    assignRecipient(review, person.recipient_id, ['follow']);
    assert.throws(() => buildFeedback(review), /rà soát/i);
    setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: ['internal_270'], note: '' });
    setDecision(review, { mention_id: 'reason:extraction_partial', action: 'accept_missing', recipient_ids: [], note: 'Đã đọc PDF và kiểm tra đầy đủ nơi nhận.' });
    assert.equal(buildFeedback(review).confirmed, true);
    setRecipient(review, person, false);
    assert.ok(reviewProblems(review).some(problem => problem.includes('m-1')));
});

test('does not accept a resolved mention without recipients or a missing decision without a note', () => {
    const review = createReview(result({ people: [], units: [unit], unresolved: [{ mention_id: 'm-1', raw: 'VT', reason: 'unknown', candidates: [] }] }));
    setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: [], note: '' });
    assert.throws(() => buildFeedback(review), /rà soát/i);
    setDecision(review, { mention_id: 'm-1', action: 'accept_missing', recipient_ids: [], note: '' });
    assert.throws(() => buildFeedback(review), /rà soát/i);
    setDecision(review, { mention_id: 'm-1', action: 'exclude', recipient_ids: [], note: 'Không phải người nhận của văn bản này.' });
    assert.equal(buildFeedback(review).review_decisions[0].action, 'exclude');
});

test('records manual edits and removes assignments with removed recipients', () => {
    const review = createReview(result());
    setRecipient(review, person, false);
    const outside = { ...unit, recipient_id: 'comm_2', sphere: 'ext_province_comm', recipient_type: 'EXT_PROVINCE_UNIT', code: 'A21.11' };
    setRecipient(review, outside, true);
    const feedback = buildFeedback(review);
    assert.deepEqual(feedback.field_assignments, [{ recipient_id: 'comm_1', field: 'inside_unit' }, { recipient_id: 'comm_2', field: 'outside_unit' }]);
    assert.ok(feedback.edits.length >= 2);
});

test('rejects malformed recipient identity and refuses an empty final list', () => {
    assert.throws(() => createReview(result({ people: [{ ...person, sphere: 'ext_province_comm' }] })), /định danh|phạm vi/i);
    assert.throws(() => buildFeedback(createReview(result({ people: [], units: [] }))), /người nhận/i);
});

test('excluding a mention removes its sole auto-added candidate and assignments', () => {
    const review = createReview(result({ people: [] }));
    setRecipient(review, person, true, { mentionId: 'm-1' });
    assignRecipient(review, person.recipient_id, ['save']);
    setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: [person.recipient_id] });
    setDecision(review, { mention_id: 'm-1', action: 'exclude', note: 'Không thuộc nơi nhận.', recipient_ids: [] });
    assert.equal(review.recipients.has(person.recipient_id), false);
    assert.equal(review.assignments[person.recipient_id], undefined);
    assert.deepEqual(buildFeedback(review).final_recipients.map(item => item.recipient_id), [unit.recipient_id]);
});

test('keeps suggested, manually added and shared candidates when one mention is omitted', () => {
    for (const source of ['suggested', 'manual', 'shared']) {
        const review = createReview(result({ people: source === 'suggested' ? [person] : [] }));
        if (source === 'manual') setRecipient(review, person, true);
        setRecipient(review, person, true, { mentionId: 'm-1' });
        assignRecipient(review, person.recipient_id, ['save']);
        setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: [person.recipient_id] });
        if (source === 'shared') setDecision(review, { mention_id: 'm-2', action: 'resolve', recipient_ids: [person.recipient_id] });
        setDecision(review, { mention_id: 'm-1', action: 'accept_missing', note: 'Đã đối chiếu.', recipient_ids: [] });
        assert.equal(review.recipients.has(person.recipient_id), true, source);
    }
});

test('changing a resolved candidate drops the old automatic recipient', () => {
    const review = createReview(result({ people: [] }));
    setRecipient(review, person, true, { mentionId: 'm-1' });
    setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: [person.recipient_id] });
    setDecision(review, { mention_id: 'm-1', action: 'resolve', recipient_ids: [unit.recipient_id] });
    assert.equal(review.recipients.has(person.recipient_id), false);
});

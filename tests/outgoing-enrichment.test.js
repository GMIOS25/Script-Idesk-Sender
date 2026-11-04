import test from 'node:test';
import assert from 'node:assert/strict';
import * as dashboard from '../src/outgoing/dashboard.js';
import { createReview, setDecision } from '../src/outgoing/review.js';

const original = () => ({ schema_version: 'outgoing.v1', job_id: 'job-old', document_id: 'doc', input_sha256: 'a'.repeat(64), registry_version: 'old', alias_policy_version: 'policy',
    people: [], units: [], mentions: [], excluded: [], extraction_status: 'partial', needs_review: true, review_reasons: ['extraction_partial'],
    unresolved: [{ mention_id: 'm1', kind: 'unit', raw: 'Thanh Tra Tỉnh', reason: 'not_in_registry', candidates: [] },
        { mention_id: 'm2', kind: 'person', raw: 'Nguyễn Văn A', reason: 'not_in_registry', candidates: [] }] });
const unit = { recipient_id: 'comm-20', source_id: 'native-20', code: 'H21.20', name: 'Thanh tra tỉnh Gia Lai', sphere: 'int_province_comm', recipient_type: 'INT_PROVINCE_UNIT' };
const session = () => ({ jobId: 'job-old', review: createReview(original()), reviewed: true, feedbackId: 'old-feedback', applied: ['old-fill'] });

test('missing organization search imports results and clears stale decisions on a new snapshot', async () => {
    const s = session(); const queries = []; let imports = 0;
    setDecision(s.review, { mention_id: 'm1', action: 'accept_missing', note: 'old decision' });
    s.client = {
        async syncOrganizations(elements) { imports++; assert.equal(elements[0].code, 'H21.20'); return { registry_version: 'new', alias_policy_version: 'policy' }; },
        async resolveJob(id, prior) {
            assert.equal(id, 'job-old'); assert.equal(prior.registry_version, 'old');
            return { jobId: 'job-new', result: { ...original(), job_id: 'job-new', registry_version: 'new', units: [unit], unresolved: [] } };
        }
    };
    await dashboard.enrichUnresolvedOrganizations(s, { search: async query => { queries.push(query); return { elements: [unit], warnings: [] }; } });
    assert.deepEqual(queries, ['Thanh Tra Tỉnh']);
    assert.equal(imports, 1);
    assert.equal(s.jobId, 'job-new'); assert.equal(s.review.result.registry_version, 'new');
    assert.equal(s.reviewed, false); assert.equal(s.feedbackId, ''); assert.equal(s.applied, null);
    assert.equal(s.review.decisions.size, 0); assert.equal(s.review.recipients.get('comm-20').code, 'H21.20');
});

test('live lookup failure stays visible and does not mark a missing organization resolved', async () => {
    const s = session(); const oldReview = s.review;
    await dashboard.enrichUnresolvedOrganizations(s, { search: async () => { throw new Error('Phiên iDesk hết hạn'); } });
    assert.equal(s.review, oldReview); assert.equal(s.jobId, 'job-old');
    assert.match(s.directoryWarning, /hết hạn/);
    assert.equal(s.review.result.unresolved.length, 2);
});

test('manual lookup falls back live on an empty local result and returns candidates in the fresh snapshot', async () => {
    const s = session(); let imported = false;
    s.client = {
        async searchRecipients() { return { items: imported ? [unit] : [], registry_version: imported ? 'new' : 'old', alias_policy_version: 'policy' }; },
        async syncOrganizations() { imported = true; return { registry_version: 'new', alias_policy_version: 'policy' }; },
        async resolveJob() { return { jobId: 'job-new', result: { ...original(), job_id: 'job-new', registry_version: 'new' } }; }
    };
    const found = await dashboard.searchSessionRecipients(s, 'Thanh Tra Tỉnh', { search: async () => ({ elements: [unit], warnings: [] }) });
    assert.equal(found.items[0].code, 'H21.20'); assert.equal(found.registry_version, s.review.result.registry_version);
    assert.equal(s.reviewed, false);
});

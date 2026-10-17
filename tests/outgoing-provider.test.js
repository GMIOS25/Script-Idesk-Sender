import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const pdfText = '%PDF-1.7\nfixture-one';
const inputHash = createHash('sha256').update(pdfText).digest('hex');
const pdf = () => new Blob([pdfText], { type: 'application/pdf' });
const snapshot = { registry_version: 'sha256:registry-fixture', alias_policy_version: 'sha256:policy-fixture' };
const ready = () => ({ readiness: 'ready', schema_version: 'outgoing.v1', ...snapshot,
    provider: { mode: 'offline', configured: false, capabilities: { text: false, vision: false } },
    limits: { max_file_bytes: 20971520, max_pages: 100 } });
const result = (metadata = { document_id: 'doc' }) => ({
    schema_version: 'outgoing.v1', job_id: 'job-1', document_id: metadata.document_id,
    input_sha256: inputHash, ...snapshot, resolution_as_of: '2026-10-09T00:00:00Z',
    snapshot_basis: 'current_directory_snapshot', extraction_status: 'partial',
    mentions: [], people: [], units: [], unresolved: [], excluded: [], needs_review: true,
    review_reasons: ['provider_unavailable', 'extraction_partial'], timings_ms: {}, audit: {}
});

function server(overrides = {}) {
    const calls = [];
    let currentMetadata = { document_id: 'doc' };
    const transport = options => {
        calls.push(options);
        queueMicrotask(() => {
            let body;
            const path = new URL(options.url).pathname;
            const override = overrides[path];
            if (override) {
                const response = override(options, calls);
                if (response?.pending) return;
                if (response?.network) return options.onerror({});
                if (response?.raw !== undefined) return options.onload({ status: response.status || 200, responseText: response.raw });
                return options.onload({ status: response?.status || 200, responseText: JSON.stringify(response?.body) });
            }
            if (path === '/health') body = ready();
            else if (path === '/v1/outgoing/jobs' && options.method === 'POST') {
                currentMetadata = JSON.parse(options.data.get('metadata'));
                body = { job_id: 'job-1', status: 'queued' };
            } else if (path === '/v1/outgoing/jobs/job-1') body = { job_id: 'job-1', status: 'completed', result: result(currentMetadata), error: null };
            else if (path === '/v1/outgoing/recipients/search') body = { items: [], ...snapshot };
            else if (path.endsWith('/feedback')) body = { feedback_id: 'feedback-1' };
            else return options.onload({ status: 404, responseText: JSON.stringify({ error: { code: 'job_not_found', message: 'Job not found' } }) });
            options.onload({ status: path.endsWith('/feedback') ? 201 : path === '/v1/outgoing/jobs' ? 202 : 200, responseText: JSON.stringify(body) });
        });
        return { abort() {} };
    };
    return { request: transport, calls };
}

async function clientFor(backend, options = {}) {
    const { createSenderClient } = await import('../src/outgoing/provider.js');
    return createSenderClient({ request: backend.request, pollIntervalMs: 0, timeoutMs: 1000, ...options });
}

test('maps outgoing document metadata without submitting legacy department filters or extra fields', async () => {
    await assert.doesNotReject(async () => {
        const { documentMetadata } = await import('../src/outgoing/provider.js');
        assert.deepEqual(documentMetadata({
            id: 4222801, signNumber: '3550/QĐ-UBND', subject: 'Tài liệu thử',
            docDateStr: '2026-08-18T17:00:00+00:00', author: 'UBND tỉnh Gia Lai',
            departmentCode: 'KGVX', cookie: 'must-not-leak'
        }, { contentUid: 'attachment-id', name: 'signed.pdf', password: 'must-not-leak' }), {
            document_id: '4222801', sign_number: '3550/QĐ-UBND', subject: 'Tài liệu thử',
            document_date: '2026-08-19', issuer: 'UBND tỉnh Gia Lai',
            attachment_content_uid: 'attachment-id', attachment_name: 'signed.pdf'
        });
    });
});

test('rejects missing identity and malformed date before preparing metadata', async () => {
    const { documentMetadata } = await import('../src/outgoing/provider.js');
    assert.throws(() => documentMetadata({}, {}), { code: 'invalid_metadata' });
    assert.throws(() => documentMetadata({ id: 'd', docDateStr: '2026-02-30' }, {}), { code: 'invalid_metadata' });
    assert.throws(() => documentMetadata({ id: 'd', docDateStr: '2026-10-09T00:00:00' }, {}), { code: 'invalid_metadata' });
});

test('uploads actual PDF multipart and polls completed partial result without hiding review', async () => {
    const backend = server();
    const client = await clientFor(backend, { apiKey: 'test-local-key' });
    const statuses = [];
    const analysis = await client.analyze({ file: pdf(), metadata: { document_id: 'doc', subject: 'Fixture' }, onStatus: status => statuses.push(status) });
    assert.equal(analysis.jobId, 'job-1');
    assert.equal(analysis.inputSha256, inputHash);
    assert.equal(analysis.result.needs_review, true);
    assert.equal(analysis.result.extraction_status, 'partial');
    assert.deepEqual(analysis.metadata, { document_id: 'doc', subject: 'Fixture' });
    assert.deepEqual(statuses, ['queued', 'completed']);
    const upload = backend.calls.find(call => call.method === 'POST');
    assert.equal(upload.url, 'http://127.0.0.1:8000/v1/outgoing/jobs');
    assert.equal(upload.headers['X-API-Key'], 'test-local-key');
    assert.equal(upload.headers['Content-Type'], undefined);
    assert.equal(await upload.data.get('file').text(), pdfText);
    assert.deepEqual(JSON.parse(upload.data.get('metadata')), { document_id: 'doc', subject: 'Fixture' });
    assert.ok(upload.headers['Idempotency-Key'].length <= 256);
});

test('stable idempotency uses all metadata and both versions while retry nonce opens a new intent', async () => {
    let health = ready();
    const backend = server({ '/health': () => ({ body: health }),
        '/v1/outgoing/jobs/job-1': () => ({ body: { job_id: 'job-1', status: 'completed', result: { ...result(), ...health }, error: null } }) });
    const client = await clientFor(backend);
    await client.analyze({ file: pdf(), metadata: { document_id: 'doc', subject: 'A', department_code: 'KGVX' } });
    await client.analyze({ file: pdf(), metadata: { department_code: 'KGVX', subject: 'A', document_id: 'doc' } });
    await client.analyze({ file: pdf(), metadata: { document_id: 'doc', subject: 'B', department_code: 'KGVX' } });
    health = { ...health, alias_policy_version: 'sha256:policy-new' };
    await client.analyze({ file: pdf(), metadata: { document_id: 'doc', subject: 'B', department_code: 'KGVX' } });
    await client.analyze({ file: pdf(), metadata: { document_id: 'doc', subject: 'B', department_code: 'KGVX' }, retryNonce: 'retry-once' });
    const keys = backend.calls.filter(call => call.method === 'POST').map(call => call.headers['Idempotency-Key']);
    assert.equal(keys[0], keys[1]);
    assert.equal(new Set([keys[1], keys[2], keys[3], keys[4]]).size, 4);
});

test('health schema and versions are checked before uploading', async () => {
    for (const health of [{ ...ready(), schema_version: 'incoming.v1' }, { ...ready(), registry_version: '' }]) {
        const backend = server({ '/health': () => ({ body: health }) });
        const client = await clientFor(backend);
        await assert.rejects(client.analyze({ file: pdf(), metadata: { document_id: 'doc' } }), { code: 'invalid_schema' });
        assert.equal(backend.calls.filter(call => call.method === 'POST').length, 0);
    }
});

test('rejects non-PDF, oversized PDF, and unexpected metadata instead of uploading', async () => {
    for (const [file, metadata, code] of [[new Blob(['html']), { document_id: 'doc' }, 'invalid_pdf'],
        [pdf(), { document_id: 'doc', cookie: 'private' }, 'invalid_metadata']]) {
        const backend = server();
        await assert.rejects((await clientFor(backend)).analyze({ file, metadata }), { code });
        assert.equal(backend.calls.filter(call => call.method === 'POST').length, 0);
    }
    const backend = server({ '/health': () => ({ body: { ...ready(), limits: { max_file_bytes: 5, max_pages: 100 } } }) });
    await assert.rejects((await clientFor(backend)).analyze({ file: pdf(), metadata: { document_id: 'doc' } }), { code: 'upload_too_large' });
    assert.equal(backend.calls.filter(call => call.method === 'POST').length, 0);
});

test('rejects results for a different document, file, job, or schema', async () => {
    for (const mutation of [{ document_id: 'other' }, { input_sha256: 'different' }, { job_id: 'other' }, { schema_version: 'outgoing.v2' }]) {
        const backend = server({ '/v1/outgoing/jobs/job-1': () => ({ body: { job_id: 'job-1', status: 'completed', result: { ...result(), ...mutation }, error: null } }) });
        await assert.rejects((await clientFor(backend)).analyze({ file: pdf(), metadata: { document_id: 'doc' } }), { code: 'invalid_result' });
    }
});

test('polling reads the same job through intermediate statuses without creating another job', async () => {
    let read = 0;
    const backend = server({ '/v1/outgoing/jobs/job-1': () => ({ body: ++read === 1
        ? { job_id: 'job-1', status: 'extracting', result: null, error: null }
        : { job_id: 'job-1', status: 'completed', result: result(), error: null } }) });
    const statuses = [];
    await (await clientFor(backend)).analyze({ file: pdf(), metadata: { document_id: 'doc' }, onStatus: status => statuses.push(status) });
    assert.deepEqual(statuses, ['queued', 'extracting', 'completed']);
    assert.equal(backend.calls.filter(call => call.method === 'POST').length, 1);
});

test('failed jobs report the backend error without silently creating another intent', async () => {
    const backend = server({ '/v1/outgoing/jobs/job-1': () => ({ body: { job_id: 'job-1', status: 'failed', result: null,
        error: { code: 'provider_timeout', message: 'Document processing failed', retryable: true } } }) });
    await assert.rejects((await clientFor(backend)).analyze({ file: pdf(), metadata: { document_id: 'doc' } }), { code: 'provider_timeout', retryable: true, jobFailed: true, jobId: 'job-1' });
    assert.equal(backend.calls.filter(call => call.method === 'POST').length, 1);
});

test('bounded transient transport retries preserve a single upload idempotency key', async () => {
    let attempts = 0;
    const backend = server({ '/v1/outgoing/jobs': () => ++attempts < 3
        ? { status: attempts === 1 ? 429 : 503, body: { error: { code: 'queue_full', message: 'Busy' } } }
        : { body: { job_id: 'job-1', status: 'queued' }, status: 202 } });
    const analysis = await (await clientFor(backend)).analyze({ file: pdf(), metadata: { document_id: 'doc' } });
    assert.equal(analysis.jobId, 'job-1');
    const uploads = backend.calls.filter(call => call.method === 'POST');
    assert.equal(uploads.length, 3);
    assert.equal(new Set(uploads.map(call => call.headers['Idempotency-Key'])).size, 1);
});

test('does not retry validation, auth, idempotency conflicts, malformed JSON, or server 500', async () => {
    for (const status of [401, 409, 422, 500]) {
        const backend = server({ '/health': () => ({ status, body: { error: { code: 'test_error', message: 'Rejected' } } }) });
        await assert.rejects((await clientFor(backend)).health(), { status });
        assert.equal(backend.calls.length, 1);
    }
    const backend = server({ '/health': () => ({ raw: '<html>login</html>' }) });
    await assert.rejects((await clientFor(backend)).health(), { code: 'invalid_response' });
    assert.equal(backend.calls.length, 1);
});

test('network retries stop after three attempts', async () => {
    const backend = server({ '/health': () => ({ network: true }) });
    await assert.rejects((await clientFor(backend)).health(), { code: 'network_error' });
    assert.equal(backend.calls.length, 3);
});

test('deadline stops perpetual queued jobs and transports that never call a callback', async () => {
    const queued = server({ '/v1/outgoing/jobs/job-1': () => ({ body: { job_id: 'job-1', status: 'queued', result: null, error: null } }) });
    await assert.rejects((await clientFor(queued, { timeoutMs: 25, pollIntervalMs: 5 })).analyze({ file: pdf(), metadata: { document_id: 'doc' } }), error => error.code === 'timeout' && !error.jobFailed);
    assert.equal(queued.calls.filter(call => call.method === 'POST').length, 1);
    const hanging = server({ '/health': () => ({ pending: true }) });
    await assert.rejects((await clientFor(hanging, { timeoutMs: 25 })).health(), { code: 'timeout' });
});

test('checks both snapshot versions and passes search and feedback through the strict API boundary', async () => {
    const backend = server();
    const client = await clientFor(backend);
    const health = await client.checkVersions(result());
    assert.equal(health.schema_version, 'outgoing.v1');
    await assert.rejects(client.checkVersions({ ...result(), alias_policy_version: 'stale' }), { code: 'stale_snapshot' });
    const search = await client.searchRecipients('Lê Thị Kim Yến');
    assert.deepEqual(search, { items: [], ...snapshot });
    const query = new URL(backend.calls.at(-1).url).searchParams;
    assert.equal(query.get('q'), 'Lê Thị Kim Yến');
    assert.equal(backend.calls.at(-1).headers['X-API-Key'], undefined);
    const payload = { ...snapshot, final_recipients: [], confirmed: false };
    assert.deepEqual(await client.feedback('job-1', payload), { feedback_id: 'feedback-1' });
    assert.deepEqual(JSON.parse(backend.calls.at(-1).data), payload);
    assert.equal(backend.calls.at(-1).headers['Content-Type'], 'application/json');
});

test('every metadata field, registry version, and changed PDF bytes affect the upload intent', async () => {
    const metadata = { document_id: 'doc', sign_number: '1/UBND-KGVX', subject: 'Fixture',
        document_date: '2026-10-09', issuer: 'UBND tỉnh Gia Lai', department_code: 'KGVX',
        attachment_content_uid: 'content-one', attachment_name: 'main.pdf' };
    let health = ready();
    const backend = server({ '/health': () => ({ body: health }) });
    const client = await clientFor(backend);
    await client.analyze({ file: pdf(), metadata });
    for (const [key, value] of Object.entries({ document_id: 'doc-two', sign_number: '2/UBND-KGVX', subject: 'Changed',
        document_date: '2026-10-10', issuer: 'Changed issuer', department_code: 'NC',
        attachment_content_uid: 'content-two', attachment_name: 'another.pdf' })) {
        await client.analyze({ file: pdf(), metadata: { ...metadata, [key]: value } });
    }
    health = { ...health, registry_version: 'sha256:new-registry' };
    await client.analyze({ file: pdf(), metadata });
    // The response remains pinned to the old file, so the changed upload must be
    // rejected even though it creates a distinct idempotency intent.
    await assert.rejects(client.analyze({ file: new Blob(['%PDF-1.7\nfixture-two']), metadata }), { code: 'invalid_result' });
    const keys = backend.calls.filter(call => call.method === 'POST').map(call => call.headers['Idempotency-Key']);
    assert.equal(new Set(keys).size, 11);
});

test('rejects a changed registry before fill and never retries append-only feedback', async () => {
    const backend = server({ '/v1/outgoing/jobs/job-1/feedback': () => ({ network: true }) });
    const client = await clientFor(backend);
    await assert.rejects(client.checkVersions({ ...result(), registry_version: 'stale' }), { code: 'stale_snapshot' });
    await assert.rejects(client.feedback('job-1', { ...snapshot, final_recipients: [], confirmed: false }), { code: 'network_error' });
    assert.equal(backend.calls.filter(call => call.method === 'POST').length, 1);
});

test('sends X-Tenant-ID header and executes syncLookup', async () => {
    let capturedHeaders = null;
    let capturedBody = null;
    const backend = server({
        '/v1/sync/lookup': (options) => {
            capturedHeaders = options.headers;
            capturedBody = JSON.parse(options.data);
            return { body: { status: 'synced', tenant_id: 'snnmt', total_recipients: 10 } };
        }
    });
    const client = await clientFor(backend, { tenantId: 'snnmt' });
    const res = await client.syncLookup({ person: {}, unit_internal: {}, unit_external: {} });
    assert.equal(res.status, 'synced');
    assert.equal(capturedHeaders['X-Tenant-ID'], 'snnmt');
    assert.deepEqual(capturedBody, { person: {}, unit_internal: {}, unit_external: {} });
});

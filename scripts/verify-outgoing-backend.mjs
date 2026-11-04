// Real HTTP verification against an isolated, offline FastAPI fixture.
// node scripts/verify-outgoing-backend.mjs [backend-directory] [--keep-server]
// --connect-only reuses an already running fixture on port 8052.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSenderClient } from '../src/outgoing/provider.js';

const arguments_ = process.argv.slice(2);
const backend = path.resolve(arguments_.find(value => !value.startsWith('--')) || 'C:/Workspaces/ai-document-sender');
const keepServer = arguments_.includes('--keep-server');
const connectOnly = arguments_.includes('--connect-only');
const baseUrl = 'http://127.0.0.1:8052';
const key = 'integration-test-key';
let server;

function gmRequest(options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout);
    fetch(options.url, { method: options.method, headers: options.headers, body: options.data, signal: controller.signal })
        .then(async response => options.onload({ status: response.status, responseText: await response.text() }))
        .catch(error => error.name === 'AbortError' ? options.ontimeout?.() : options.onerror?.())
        .finally(() => clearTimeout(timeout));
    return { abort: () => controller.abort() };
}

async function fixtureRequest(endpoint, method = 'GET') {
    const response = await fetch(baseUrl + endpoint, { method, headers: { 'X-API-Key': key } });
    assert.equal(response.status, 200, `Fixture control ${endpoint}`);
    return endpoint.endsWith('.pdf') ? response.blob() : response.json();
}

async function main() {
    if (!connectOnly) {
        const serverPath = fileURLToPath(new URL('../tests/outgoing-contract-server.py', import.meta.url));
        const executable = path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        server = spawn(executable, [serverPath, '--backend', backend, '--port', '8052'],
            { cwd: backend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        server.stdout.pipe(process.stdout);
        server.stderr.pipe(process.stderr);
        server.on('error', error => { process.stderr.write(`Fixture startup failed: ${error.code || 'process_error'}\n`); });
        process.on('SIGINT', () => { server.kill(); process.exit(130); });
        process.on('SIGTERM', () => { server.kill(); process.exit(143); });
    }

    const client = createSenderClient({ baseUrl, apiKey: key, request: gmRequest, pollIntervalMs: 50, timeoutMs: 15000 });
    const startupDeadline = Date.now() + 15000;
    let health;
    while (!health) {
        try {
            health = await createSenderClient({ baseUrl, apiKey: key, request: gmRequest, pollIntervalMs: 25, timeoutMs: 1000 }).health();
        } catch (error) {
            if (server?.exitCode != null || Date.now() >= startupDeadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    assert.equal(health.schema_version, 'outgoing.v1');
    assert.equal(health.provider.mode, 'offline');
    assert.equal(health.provider.configured, false);
    const fixture = await fixtureRequest('/__contract__/fixture');
    const file = await fixtureRequest(fixture.pdf_url);
    const analyzed = await client.analyze({ file, metadata: fixture.metadata });
    assert.equal(analyzed.result.document_id, fixture.metadata.document_id);
    assert.equal(analyzed.result.extraction_status, 'partial');
    assert.equal(analyzed.result.needs_review, true);
    assert.deepEqual(analyzed.result.people.map(recipient => recipient.recipient_id).sort(), ['internal_270', 'internal_341']);
    assert.ok(analyzed.result.unresolved.some(mention => mention.raw === 'VT'));
    const duplicate = await client.analyze({ file, metadata: { ...fixture.metadata } });
    assert.equal(duplicate.jobId, analyzed.jobId);

    // Capture the actual stable key emitted by the adapter, then prove FastAPI
    // rejects a different metadata body when a client reuses that same key.
    let uploadKey;
    const capturingClient = createSenderClient({ baseUrl, apiKey: key, pollIntervalMs: 50, timeoutMs: 15000,
        request: options => {
            if (options.method === 'POST' && options.url.endsWith('/jobs')) uploadKey = options.headers['Idempotency-Key'];
            return gmRequest(options);
        } });
    assert.equal((await capturingClient.analyze({ file, metadata: fixture.metadata })).jobId, analyzed.jobId);
    const changed = new FormData();
    changed.append('file', file, 'main.pdf');
    changed.append('metadata', JSON.stringify({ ...fixture.metadata, subject: 'Changed fixture subject' }));
    const conflict = await fetch(baseUrl + '/v1/outgoing/jobs', { method: 'POST', body: changed,
        headers: { 'X-API-Key': key, 'Idempotency-Key': uploadKey } });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'idempotency_key_conflict');

    const search = await client.searchRecipients('V5');
    assert.ok(search.items.some(recipient => recipient.recipient_id === 'internal_341'));
    assert.equal(search.registry_version, analyzed.result.registry_version);
    const payload = {
        registry_version: analyzed.result.registry_version,
        alias_policy_version: analyzed.result.alias_policy_version,
        final_recipients: analyzed.result.people.map(({ recipient_id, recipient_type, sphere, code }) => ({ recipient_id, recipient_type, sphere, code })),
        field_assignments: [{ recipient_id: 'internal_270', field: 'follow' }, { recipient_id: 'internal_341', field: 'save' }],
        review_decisions: [
            ...analyzed.result.unresolved.map(mention => ({ mention_id: mention.mention_id, action: 'accept_missing', note: 'Synthetic unresolved fixture reviewed.', recipient_ids: [] }))
        ], edits: [], confirmed: true
    };
    const feedback = await client.feedback(analyzed.jobId, payload);
    assert.ok(feedback.feedback_id);
    await assert.rejects(client.feedback(analyzed.jobId, { ...payload, review_decisions: [] }), { code: 'review_incomplete', status: 422 });
    await client.checkVersions(analyzed.result);

    for (const version of ['registry', 'policy']) {
        await fixtureRequest('/__contract__/version/' + version, 'POST');
        const changedHealth = await client.health();
        assert.notEqual(changedHealth[version === 'registry' ? 'registry_version' : 'alias_policy_version'],
            analyzed.result[version === 'registry' ? 'registry_version' : 'alias_policy_version']);
        await assert.rejects(client.checkVersions(analyzed.result), { code: 'stale_snapshot' });
        await assert.rejects(client.feedback(analyzed.jobId, payload), { code: 'stale_snapshot', status: 409 });
        await fixtureRequest('/__contract__/version/reset', 'POST');
        await client.checkVersions(analyzed.result);
    }

    // Directory import and checkpoint-only resolution use the real HTTP boundary.
    const observed = [
        { code: 'H21.20', name: 'Thanh tra tỉnh Gia Lai', uuid: 'directory-inspectorate', sphere: 'int_province_comm' },
        { code: 'H21.26', name: 'Sở Ngoại vụ - tỉnh Gia Lai', uuid: 'directory-foreign-affairs', sphere: 'int_province_comm' }
    ];
    const imported = await client.syncOrganizations(observed, 'directory');
    assert.notEqual(imported.registry_version, analyzed.result.registry_version);
    assert.ok((await client.searchRecipients('Sở Ngoại vụ')).items.some(item => item.code === 'H21.26'));
    await assert.rejects(client.checkVersions(analyzed.result), { code: 'stale_snapshot' });
    const resolved = await client.resolveJob(analyzed.jobId, analyzed.result);
    assert.notEqual(resolved.jobId, analyzed.jobId);
    assert.equal(resolved.result.input_sha256, analyzed.result.input_sha256);
    assert.equal(resolved.result.extraction_status, analyzed.result.extraction_status);
    assert.deepEqual(resolved.result.mentions, analyzed.result.mentions);
    assert.ok(resolved.result.units.some(item => item.code === 'H21.20'));
    assert.ok(resolved.result.units.some(item => item.code === 'H21.26'));
    assert.equal((await client.resolveJob(analyzed.jobId, analyzed.result)).jobId, resolved.jobId);
    assert.deepEqual((await client.getJob(analyzed.jobId)).result, analyzed.result);
    const repeatedImport = await client.syncOrganizations(observed, 'directory');
    assert.equal(repeatedImport.registry_version, imported.registry_version);

    console.log(JSON.stringify({ verified: true, transport: 'real Node fetch + FormData → GM adapter → FastAPI',
        base_url: baseUrl, server_pid: server?.pid || null, pdf_path: fixture.pdf_path,
        fixture_root: fixture.fixture_root, job_id: analyzed.jobId,
        recipients: analyzed.result.people.map(recipient => recipient.recipient_id), feedback_id: feedback.feedback_id,
        checks: ['health/offline', 'real PDF extraction', 'same-intent replay', 'metadata conflict 409',
            'recipient search', 'review feedback 201/422', 'registry guard', 'policy guard',
            'directory import', 'checkpoint-only resolution', 'resolution retry', 'immutable original result'], keep_server: keepServer || connectOnly }, null, 2));
    if (keepServer && server) {
        console.log('Fixture server remains available on port 8052. Stop this process with Ctrl+C after browser verification.');
        await once(server, 'exit');
    }
}

try {
    await main();
} catch (error) {
    console.error(`Outgoing integration verification failed: ${error.code || error.name}: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (server && (!keepServer || process.exitCode)) server.kill();
}

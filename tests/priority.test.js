import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleListResponse, handleViewResponse } from '../src/services/api.js';
import { docCache } from '../src/state.js';
import { updateDashboard } from '../src/ui/dashboard.js';
import { resolvePriority } from '../src/utils/helpers.js';

globalThis.document = { getElementById: () => null };

afterEach(() => {
    docCache.clear();
    document.getElementById = () => null;
});

test('reads urgent and normal priority from the supplied receiving fixtures', () => {
    // Urgent record retained from d96e667^ before legacy resource cleanup.
    const urgent = JSON.parse(readFileSync(new URL('./fixtures/receiving-urgent.json', import.meta.url), 'utf8'));
    const normal = JSON.parse(readFileSync(new URL('../resource/Văn bản đến/Tiếp nhận văn bản/Trường hợp 1 Văn bản thường/Văn bản có điền sẵn loại văn bản/view.cpx', import.meta.url), 'utf8'));

    handleListResponse(urgent);
    handleViewResponse(normal);

    assert.equal(docCache.get('5036476').priority, 3);
    assert.equal(docCache.get('19276723').priority, 0);
});

test('reads priority from the list response without losing zero', () => {
    handleListResponse({ items: [{ id: 3988278, edSearchDto: { priority: 0 } }] });
    assert.equal(docCache.get('3988278').priority, 0);
});

test('maps iDesk priority levels used by the interface', () => {
    assert.deepEqual(resolvePriority(0), { level: 0, label: 'Bình thường', isCritical: false });
    assert.deepEqual(resolvePriority('3'), { level: 3, label: 'Hỏa tốc', isCritical: true });
    assert.deepEqual(resolvePriority(4), { level: 4, label: 'Hỏa tốc hẹn giờ', isCritical: true });
    assert.equal(resolvePriority(undefined), null);
});

test('renders Hỏa tốc as a critical badge on the document card', () => {
    const cardFeed = { innerHTML: '' };
    const count = { textContent: '' };
    document.getElementById = (id) => ({ 'rpa-card-feed': cardFeed, 'rpa-doc-count': count })[id] || null;
    docCache.set('17546218', { id: '17546218', priority: 3, status: 'idle', eligible: true, aiData: { coordinating_units: [] } });

    updateDashboard();

    assert.match(cardFeed.innerHTML, /class="rpa-badge-chip is-priority is-critical"[^>]*>Hỏa tốc<\/span>/);
});

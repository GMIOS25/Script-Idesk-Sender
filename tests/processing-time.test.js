import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { docCache } from '../src/state.js';
import { updateDashboard } from '../src/ui/dashboard.js';

globalThis.document = { getElementById: () => null };

afterEach(() => {
    docCache.clear();
    document.getElementById = () => null;
});

test('renders each processing time and the average in seconds', () => {
    const cardFeed = { innerHTML: '' };
    const count = { textContent: '' };
    const average = { textContent: '' };
    document.getElementById = (id) => ({
        'rpa-card-feed': cardFeed,
        'rpa-doc-count': count,
        'rpa-average-time': average
    })[id] || null;

    docCache.set('1', {
        id: '1', eligible: true, status: 'ai_done', processingTimeMs: 1250,
        aiData: { coordinating_units: [] }
    });
    docCache.set('2', {
        id: '2', eligible: true, status: 'ai_done', processingTimeMs: 2750,
        aiData: { coordinating_units: [] }
    });

    updateDashboard();

    assert.match(cardFeed.innerHTML, /Xử lý: 1,3 giây/);
    assert.match(cardFeed.innerHTML, /Xử lý: 2,8 giây/);
    assert.equal(average.textContent, 'TB: 2,0 giây\/văn bản');
});

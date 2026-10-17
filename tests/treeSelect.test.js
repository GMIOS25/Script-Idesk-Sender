import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { selectTreeItem } from '../src/automation/treeSelect.js';

const LINK_SELECTOR = '#field a.user-box-link';
const WRAP_SELECTOR = '#field';
let originalDelays;

beforeEach(() => {
    originalDelays = { ...CONFIG.DELAY_MS };
    CONFIG.DELAY_MS.OPEN_TREE = 0;
    CONFIG.DELAY_MS.EXPAND_TREE = 0;
    CONFIG.DELAY_MS.TREE_SEARCH = 0;
    CONFIG.DELAY_MS.CLOSE_TREE = 0;
});

afterEach(() => {
    Object.assign(CONFIG.DELAY_MS, originalDelays);
    delete globalThis.document;
});

test('does not click a tree selector hidden by its parent container', async () => {
    let clickCount = 0;
    const hiddenLink = { offsetParent: null, click: () => { clickCount++; } };
    globalThis.document = {
        querySelector: selector => selector === LINK_SELECTOR ? hiddenLink : null
    };

    const selected = await selectTreeItem(LINK_SELECTOR, WRAP_SELECTOR, 'Phòng Kinh tế');

    assert.equal(selected, false);
    assert.equal(clickCount, 0);
});

test('uses the visible popup belonging to the current tree selector', async () => {
    let selectedCandidate = false;
    const candidate = {
        offsetParent: {},
        click: () => { selectedCandidate = true; },
        querySelector: selector => selector === '.user-box-group-item-name'
            ? { textContent: 'Phòng Kinh tế' }
            : null
    };
    const visiblePopup = {
        offsetParent: {},
        querySelectorAll: selector => selector === 'a.user-box-group-item' ? [candidate] : [],
        querySelector: () => null
    };
    const hiddenPopup = { offsetParent: null };
    const wrap = {
        querySelectorAll: selector => selector.startsWith('.popover') ? [visiblePopup] : []
    };
    const visibleLink = { offsetParent: {}, click: () => {} };
    globalThis.document = {
        body: { click: () => {} },
        getElementById: () => null,
        querySelector: selector => {
            if (selector === LINK_SELECTOR) return visibleLink;
            if (selector === WRAP_SELECTOR) return wrap;
            if (selector.startsWith('.popover')) return hiddenPopup;
            return null;
        },
        querySelectorAll: selector => selector.startsWith('.popover')
            ? [hiddenPopup, visiblePopup]
            : []
    };

    const selected = await selectTreeItem(LINK_SELECTOR, WRAP_SELECTOR, 'Phòng Kinh tế');

    assert.equal(selected, true);
    assert.equal(selectedCandidate, true);
});

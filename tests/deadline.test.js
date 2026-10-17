import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../src/core/bus.js';
import { docCache } from '../src/state.js';
import { CONFIG, S } from '../src/config.js';
import { autoFillAndSubmit } from '../src/automation/formFiller.js';
import '../src/controllers/mainController.js';

afterEach(() => {
    delete globalThis.document;
    docCache.clear();
});

test('removes an implementation deadline when the editor confirms null', () => {
    docCache.set('doc-1', {
        id: 'doc-1',
        aiData: { implementation_deadline: 'trong 05 ngày làm việc' }
    });

    emit('deadline-update-confirmed', { id: 'doc-1', days: null });

    assert.equal(docCache.get('doc-1').aiData.implementation_deadline, null);
});

test('still applies a numeric deadline after supporting deadline removal', () => {
    docCache.set('doc-2', {
        id: 'doc-2',
        aiData: { implementation_deadline: 'trong 05 ngày làm việc' }
    });

    emit('deadline-update-confirmed', { id: 'doc-2', days: 12 });

    assert.equal(docCache.get('doc-2').aiData.implementation_deadline, 'trong 12 ngày làm việc');
});

test('clears both iDesk deadline fields after the deadline is removed', async () => {
    const row = { classList: { contains: name => name === 'book' || name === 'selected' } };
    const visible = { disabled: false, getClientRects: () => [{}] };
    const transfer = { ...visible, click() {} };
    const agree = { ...visible, click() {} };
    const container = { getClientRects: () => [{}] };
    const widget = { getClientRects: () => [{}], querySelector: selector => selector === S.TRANSFER_CONTAINER ? container : null };
    const deadlineNumber = { value: '5', dispatchEvent() {} };
    const deadlineDate = { value: '10/10/2026', dispatchEvent() {} };
    globalThis.document = {
        getElementById: () => null,
        querySelector: selector => ({
            [S.TRANSFER_BTN]: transfer,
            [S.TRANSFER_WIDGET]: widget,
            [S.DEADLINE_NUMBER]: deadlineNumber,
            [S.DEADLINE_INPUT]: deadlineDate,
            [S.AGREE_BTN]: agree
        })[selector] || (selector.includes('data-id="book-deadline"') ? row : null)
    };

    const previousClickDelay = CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER;
    const previousSubmitDelay = CONFIG.DELAY_MS.AFTER_SUBMIT;
    CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER = 0;
    CONFIG.DELAY_MS.AFTER_SUBMIT = 0;
    try {
        await autoFillAndSubmit('book-deadline', {
            processing_unit: [], coordinating_units: [], monitoring_leader: null,
            implementation_deadline: null
        });
        assert.equal(deadlineNumber.value, '');
        assert.equal(deadlineDate.value, '');
    } finally {
        CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER = previousClickDelay;
        CONFIG.DELAY_MS.AFTER_SUBMIT = previousSubmitDelay;
    }
});

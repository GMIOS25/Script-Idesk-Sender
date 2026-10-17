import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toUiData } from '../src/services/providers/localRouterProvider.js';
import { docCache } from '../src/state.js';
import { emit } from '../src/core/bus.js';
import '../src/controllers/mainController.js';

afterEach(() => docCache.clear());

test('keeps every main processing unit returned by the router', () => {
    const data = toUiData({ id: '1' }, {
        document_id: '1',
        recipients: {
            don_vi_xu_ly_chinh: [
                { id: 'unit-a', name: 'Đơn vị A' },
                { id: 'unit-b', name: 'Đơn vị B' }
            ],
            phoi_hop_xu_ly: [],
            lanh_dao_theo_doi: []
        },
        review_reasons: [],
        extracted_metadata: {}
    }, 'digest');

    assert.deepEqual(data.processing_unit, ['Đơn vị A', 'Đơn vị B']);
    assert.equal(data._router.requires_manual_mapping, false);
    assert.doesNotMatch(data.notes, /nhiều.*đơn vị xử lý chính/i);
});

test('adds, replaces and removes individual main processing units', () => {
    const doc = {
        id: '1',
        aiData: {
            processing_unit: ['Đơn vị A', 'Đơn vị B'],
            _router: { edited: false }
        }
    };
    docCache.set('1', doc);

    emit('unit-remove-requested', { id: '1', kind: 'main', value: 'Đơn vị A' });
    assert.deepEqual(doc.aiData.processing_unit, ['Đơn vị B']);

    emit('unit-add-confirmed', { id: '1', kind: 'main', label: 'Đơn vị C' });
    assert.deepEqual(doc.aiData.processing_unit, ['Đơn vị B', 'Đơn vị C']);

    emit('unit-add-confirmed', {
        id: '1',
        kind: 'main',
        label: 'Đơn vị B đầy đủ',
        replaceValue: 'Đơn vị B'
    });
    assert.deepEqual(doc.aiData.processing_unit, ['Đơn vị C', 'Đơn vị B đầy đủ']);
    assert.equal(doc.aiData._router.edited, true);
});

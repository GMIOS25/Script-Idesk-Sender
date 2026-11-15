import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The remote iDesk adapter and browser DOM are external boundaries. The doubles
// model native chips and their click handlers; form selection itself stays real.
const bridgeUrl = 'data:text/javascript,' + encodeURIComponent(`
  export const internalDirectory = globalThis.__formBridge.internalDirectory;
  export const organizationDirectory = globalThis.__formBridge.organizationDirectory;
  export const showDocument = (...args) => globalThis.__formBridge.showDocument(...args);
  export const isDocumentEligible = row => globalThis.__formBridge.hasInternalTransferMarker(row);
`);
let api, state;

class Element {
    constructor(attrs = {}, onClick = () => {}) {
        this.attrs = attrs;
        this.click = onClick;
        this.offsetParent = {};
        this.isConnected = true;
        this.textContent = '';
        this.one = new Map();
        this.many = new Map();
    }
    getAttribute(key) { return this.attrs[key] ?? null; }
    querySelector(selector) { return this.one.get(selector) ?? this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) { return this.many.get(selector)?.() ?? []; }
    closest() { return this.scope ?? this; }
    contains(element) { return element === this || element.scope === this; }
    dispatchEvent(event) { this.events ??= []; this.events.push(event.type); }
}

const person = {
    recipient_id: 'internal_270', source_id: '270', recipient_type: 'INTERNAL_PERSON',
    sphere: 'internal', code: 'tuanpa@vpub.gialai.gov.vn', name: 'Phạm Anh Tuấn',
};
const PERSON_CHIP = person.source_id;
const SHARED_REF_CODE = 'b4323289-0146-1000-f79c-150813121982';
const department = {
    recipient_id: 'internal_269', source_id: '269', recipient_type: 'INTERNAL_DEPT',
    sphere: 'internal', code: '', name: 'Lãnh đạo UBND tỉnh',
};
const PREFILLED_SAVE = 'b4555501-0146-1000-e741-150813121982';
const PREFILLED_RESPONSIBLE = 'b43c3c24-0146-1000-f250-150813121982';
const unit = {
    recipient_id: 'comm_21', source_id: 'comm_21', recipient_type: 'INT_PROVINCE_UNIT',
    sphere: 'int_province_comm', code: 'H21.17', name: 'Sở Văn hóa',
};
const doc = { id: '4222801', subject: 'Trích yếu văn bản' };
const prefixes = {
    responsible: 'select-user-responsible', save: 'select-user-save',
    participants: 'select-user-participants', follow: 'select-user-follow',
    inside_unit: 'select-inside-unit', outside_unit: 'select-outside-unit',
};

function addChip(field, id) {
    const chip = new Element({ 'data-uuid': String(id) });
    chip.textContent = `Recipient ${id}`;
    chip.one.set('a[data-action="close"]', new Element({}, () => {
        field.chips = field.chips.filter(item => item !== chip);
    }));
    field.chips.push(chip);
    return chip;
}

test('checks current group membership and clicks the native group once', async () => {
    const other = { ...unit, recipient_id: 'comm_other', code: 'H21.19' };
    globalThis.__formBridge.organizationDirectory.set('int_province_comm:H21.19', other);
    const field = state.fields.inside_unit;
    field.popup.one.set('a.user-box-tab[data-type="group"]', new Element());
    let clicks = 0;
    const group = new Element({ 'data-id': 'g1' }, () => {
        clicks++;
        addChip(field, unit.code);
        addChip(field, other.code);
    });
    group.classList = { contains: () => false };
    field.popup.many.set('[data-role="group"] a.user-box-group-item[data-id]', () => [group]);
    globalThis.window = { jQuery: () => ({ data: () => ({ type: 'group', units: [unit, other] }) }) };
    const options = { doc, recipients: [unit, other], assignments: { comm_21: ['inside_unit'], comm_other: ['inside_unit'] },
        registryVersion: 'r', selectionPlan: [{ group_id: 'g1', sphere: unit.sphere,
            registry_version: 'r', member_codes: [unit.code, other.code] }] };
    try {
        globalThis.window.jQuery = () => ({ data: () => ({ type: 'group', units: [unit, { code: 'H21.99' }] }) });
        await assert.rejects(api.prepareOutgoingForm(options), /Thành viên nhóm/);
        assert.equal(clicks, 0);
        globalThis.window.jQuery = () => ({ data: () => ({ type: 'group', units: [unit, other] }) });
        assert.equal((await api.prepareOutgoingForm(options)).applied.length, 2);
        assert.equal(clicks, 1);
        assert.equal(state.submitted, 0);
    } finally { delete globalThis.window; }
});

test('rejects leftover policy chips after publication scope changes', async () => {
    const first = await api.prepareOutgoingForm({ doc, recipients: [person, unit],
        assignments: { internal_270: ['responsible', 'save'], comm_21: ['inside_unit'] },
        publicationAssignments: [{ recipient_id: 'internal_270', field: 'responsible' }] });
    assert.deepEqual(first.publicationChips, [{ field: 'responsible', id: '270' }, { field: 'save', id: '270' }]);
    state.fields.responsible.chips = [];
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [unit],
        assignments: { comm_21: ['inside_unit'] }, previousPolicyChips: first.publicationChips,
        replaceExisting: true }), /phạm vi phát hành trước/);
    assert.equal(state.submitted, 0);
});

function fieldFixture(key) {
    const field = new Element({ id: `ed-full-transfer-${prefixes[key]}` });
    field.chips = [];
    const scope = new Element();
    const popup = new Element();
    popup.scope = scope;
    popup.offsetParent = null;
    field.scope = scope;
    field.popup = popup;
    field.options = [];
    field.many.set('.user-box-item-container .user-box-item', () => field.chips);
    field.one.set('a.user-box-link', new Element({}, () => {
        popup.offsetParent = {};
        state.links.push(key);
    }));
    field.one.set('.user-clear', new Element({}, () => { field.chips = []; state.clears.push(key); }));
    scope.many.set('.popover', () => [popup]);
    field.many.set('.popover', () => [popup]);
    popup.many.set('a.user-box-group-item[data-id]', () => field.options);
    popup.one.set('input[type="text"]', new Element());
    popup.one.set('.close', new Element({}, () => { popup.offsetParent = null; }));
    field.addOption = (id, selectedId = id, afterClick = () => {}) => {
        const option = new Element({ 'data-id': String(id) }, () => {
            addChip(field, selectedId); afterClick();
        });
        option.textContent = 'Phạm Anh Tuấn / Sở Văn hóa';
        field.options.push(option);
        return option;
    };
    return field;
}

beforeEach(async () => {
    state = { opened: 0, submitted: 0, links: [], clears: [], fields: {}, marker: true };
    state.row = new Element({ 'data-id': doc.id });
    state.selected = state.row;
    state.widget = new Element();
    state.widget.offsetParent = null;
    for (const key of Object.keys(prefixes)) state.fields[key] = fieldFixture(key);
    state.fields.responsible.addOption('270');
    state.fields.save.addOption('270');
    state.fields.inside_unit.addOption('H21.17');
    const open = new Element({}, () => { state.opened++; state.widget.offsetParent = {}; });
    const submit = new Element({}, () => { state.submitted++; });
    globalThis.document = {
        querySelector(selector) {
            if (selector === '#listview-publish-list-content .messageListItem.selected[data-id]') return state.selected;
            if (selector === '#ed-view-btn-full-transfer') return open;
            if (selector === '#ed-full-transfer-document-widget') return state.widget;
            if (selector === '#ed-full-transfer-btn-transfer') return submit;
            if (selector === '#ed-full-transfer-doc-text-subject') return { textContent: doc.subject };
            for (const [key, prefix] of Object.entries(prefixes)) {
                if (selector === `#ed-full-transfer-${prefix}`) return state.fields[key];
            }
            if (selector === '#ed-full-transfer-add-participants-btn') return new Element({}, () => {
                state.fields.participants.offsetParent = {};
            });
            if (selector === '#ed-full-transfer-add-follow-btn') return new Element({}, () => {
                state.fields.follow.offsetParent = {};
            });
            return null;
        },
        getElementById() { return null; },
    };
    globalThis.__formBridge = {
        internalDirectory: new Map([
            ['270', { id: 270, type: 'alias', refUname: person.code, refFullname: person.name, refCode: SHARED_REF_CODE }],
            ['269', { id: 269, type: 'dept', name: department.name, refCode: SHARED_REF_CODE }],
        ]),
        organizationDirectory: new Map([['int_province_comm:H21.17', { code: unit.code, sphere: unit.sphere, name: unit.name }]]),
        async showDocument() { return state.row; },
        hasInternalTransferMarker(row) { return row === state.row && state.marker && row.isConnected; },
    };
    let source = await readFile(new URL('../src/outgoing/form.js', import.meta.url), 'utf8');
    source = source.replace(/(['"])\.\/idesk\.js\1/g, JSON.stringify(bridgeUrl + `#${Math.random()}`));
    source += '\n//# sourceURL=outgoing-form.test-module.js';
    api = await import('data:text/javascript,' + encodeURIComponent(source) + `#${Math.random()}`);
});

afterEach(() => { delete globalThis.document; delete globalThis.__formBridge; });

test('rejects a person whose numeric source ID belongs to another username before form opening', async () => {
    const bad = { ...person, code: 'someone-else@vpub.gialai.gov.vn' };
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [bad], assignments: { internal_270: ['save'] } }), /định danh|username/i);
    assert.equal(state.opened, 0);
    assert.deepEqual(state.fields.save.chips, []);
});

test('does not offer internal fields for a recipient with inconsistent type and sphere', () => {
    assert.deepEqual(api.allowedFields({ ...person, sphere: 'ext_province_comm' }), []);
    assert.deepEqual(api.allowedFields(person).map(field => field.key), ['responsible', 'save', 'participants', 'follow']);
});

test('rejects an assignment to the wrong recipient sphere before any opening', async () => {
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [unit], assignments: { comm_21: ['save'] } }), /trường|phạm vi/i);
    assert.equal(state.opened, 0);
});

test('rejects an organization when its exact code is registered only in another sphere', async () => {
    globalThis.__formBridge.organizationDirectory.clear();
    globalThis.__formBridge.organizationDirectory.set('ext_province_comm:H21.17', { code: unit.code, sphere: 'ext_province_comm' });
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [unit], assignments: { comm_21: ['inside_unit'] } }), /định danh|danh mục/i);
    assert.equal(state.opened, 0);
});

test('validates every assigned identity before changing a valid recipient field', async () => {
    const bad = { ...person, recipient_id: 'internal_999', source_id: '999' };
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person, bad], assignments: { internal_270: ['save'], internal_999: ['responsible'] } }));
    assert.equal(state.opened, 0);
    assert.deepEqual(state.fields.save.chips, []);
});

test('preserves prefilled save recipients while adding verified identity and never submits', async () => {
    addChip(state.fields.save, PREFILLED_SAVE);
    const result = await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } });
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), [PREFILLED_SAVE, PERSON_CHIP]);
    assert.deepEqual(result.existing.save, [PREFILLED_SAVE]);
    assert.deepEqual(result.applied, [{ recipient_id: 'internal_270', field: 'save', id: '270' }]);
    assert.equal(state.submitted, 0);
    assert.deepEqual(state.clears, []);
});

test('does not toggle off an identity already selected in its field', async () => {
    addChip(state.fields.save, PERSON_CHIP);
    await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } });
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), [PERSON_CHIP]);
    assert.deepEqual(state.links, []);
});

test('uses exact organization code in its own popup despite a same-named recipient elsewhere', async () => {
    state.fields.outside_unit.addOption('H21.17', 'wrong');
    await api.prepareOutgoingForm({ doc, recipients: [unit], assignments: { comm_21: ['inside_unit'] } });
    assert.deepEqual(state.fields.inside_unit.chips.map(chip => chip.getAttribute('data-uuid')), ['H21.17']);
    assert.deepEqual(state.fields.outside_unit.chips, []);
    assert.equal(state.submitted, 0);
});

test('explicit replacement clears only assigned fields using the native clear handler', async () => {
    addChip(state.fields.save, PREFILLED_SAVE);
    addChip(state.fields.responsible, PREFILLED_RESPONSIBLE);
    const result = await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] }, replaceExisting: true });
    assert.deepEqual(state.clears, ['save']);
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), [PERSON_CHIP]);
    assert.deepEqual(state.fields.responsible.chips.map(chip => chip.getAttribute('data-uuid')), [PREFILLED_RESPONSIBLE]);
    assert.deepEqual(result.existing.save, [PREFILLED_SAVE]);
});

test('rejects a stale selected document before opening the official form', async () => {
    state.selected = new Element({ 'data-id': 'another-document' });
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } }), /văn bản/i);
    assert.equal(state.opened, 0);
});

test('rejects a row whose live internal-transfer marker has disappeared', async () => {
    state.marker = false;
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } }), /nội bộ/i);
    assert.equal(state.opened, 0);
});

test('reports partial fills when selection changes between fields and stops remaining mutations', async () => {
    state.fields.save.options = [];
    state.fields.save.addOption('270', PERSON_CHIP, () => { state.selected = new Element({ 'data-id': 'another-document' }); });
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save', 'responsible'] } }), error => {
        assert.equal(error.applied.length, 1);
        assert.match(error.message, /văn bản/i);
        return true;
    });
    assert.deepEqual(state.fields.responsible.chips, []);
    assert.equal(state.submitted, 0);
});

test('does not report success when native selection creates a different chip ID', async () => {
    state.fields.save.options = [];
    state.fields.save.addOption('270', '999');
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } }), /khớp|xác nhận/i);
    assert.equal(state.submitted, 0);
});

test('reveals a hidden participants field through its native toggle before selecting', async () => {
    state.fields.participants.offsetParent = null;
    state.fields.participants.addOption('270');
    await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['participants'] } });
    assert.deepEqual(state.fields.participants.chips.map(chip => chip.getAttribute('data-uuid')), [PERSON_CHIP]);
    assert.equal(state.submitted, 0);
});

test('detects a native handler that unexpectedly removes a prefilled recipient in another field', async () => {
    addChip(state.fields.save, PREFILLED_SAVE);
    state.fields.responsible.options = [];
    state.fields.responsible.addOption('270', PERSON_CHIP, () => { state.fields.save.chips = []; });
    await assert.rejects(api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['responsible'] } }), /khớp/i);
    assert.equal(state.submitted, 0);
});

test('verifies numeric native chips even when a directory node has no refCode', async () => {
    delete globalThis.__formBridge.internalDirectory.get('270').refCode;
    await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } });
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), ['270']);
    assert.equal(state.submitted, 0);
});

test('selects a department separately from a prefilled person with the same refCode', async () => {
    addChip(state.fields.save, PERSON_CHIP);
    state.fields.save.addOption(department.source_id);
    const result = await api.prepareOutgoingForm({ doc, recipients: [department], assignments: { internal_269: ['save'] } });
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), ['270', '269']);
    assert.deepEqual(result.existing.save, ['270']);
    assert.deepEqual(result.applied, [{ recipient_id: 'internal_269', field: 'save', id: '269' }]);
    assert.equal(state.submitted, 0);
});

test('preserves an ambiguous prefilled acode and verifies the requested numeric node independently', async () => {
    addChip(state.fields.save, SHARED_REF_CODE);
    await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } });
    assert.deepEqual(state.fields.save.chips.map(chip => chip.getAttribute('data-uuid')), [SHARED_REF_CODE, '270']);
    assert.deepEqual(state.links, ['save']);
    assert.equal(state.submitted, 0);
});

test('uses the native search input within its field when the popup has no input', async () => {
    const field = state.fields.save;
    const input = field.popup.one.get('input[type="text"]');
    field.popup.one.delete('input[type="text"]');
    field.one.set('input.user-box-input', input);
    const otherInput = state.fields.responsible.popup.one.get('input[type="text"]');
    await api.prepareOutgoingForm({ doc, recipients: [person], assignments: { internal_270: ['save'] } });
    assert.equal(input.value, person.name);
    assert.deepEqual(input.events, ['input', 'keyup']);
    assert.equal(otherInput.value, undefined);
    assert.equal(state.submitted, 0);
});

test('accepts repeated representations of the same organization code in a single widget', async () => {
    state.fields.inside_unit.addOption('H21.17');
    state.fields.inside_unit.addOption('H21.17');
    await api.prepareOutgoingForm({ doc, recipients: [unit], assignments: { comm_21: ['inside_unit'] } });
    assert.deepEqual(state.fields.inside_unit.chips.map(chip => chip.getAttribute('data-uuid')), ['H21.17']);
    assert.equal(state.submitted, 0);
});

test('collapses multiple int_province_comm native groups plus individual units while keeping firstInsideCode', async () => {
    const pvhcc = { ...unit, recipient_id: 'comm_pvhcc', source_id: 'comm_pvhcc', code: 'H21.21.04', name: 'Trung tâm PVHCC' };
    const so1 = { ...unit, recipient_id: 'comm_so1', source_id: 'comm_so1', code: 'H21.05', name: 'Sở Công Thương' };
    const so2 = { ...unit, recipient_id: 'comm_so2', source_id: 'comm_so2', code: 'H21.06', name: 'Sở Giáo dục' };
    const ban1 = { ...unit, recipient_id: 'comm_ban1', source_id: 'comm_ban1', code: 'H21.38', name: 'Ban QLDA ĐTXD' };
    const ban2 = { ...unit, recipient_id: 'comm_ban2', source_id: 'comm_ban2', code: 'H21.40', name: 'Ban QLDA GTDD' };
    const congAn = { ...unit, recipient_id: 'comm_ca', source_id: 'comm_ca', code: 'G01.035.000.000', name: 'Công an tỉnh' };
    for (const item of [pvhcc, so1, so2, ban1, ban2, congAn]) {
        globalThis.__formBridge.organizationDirectory.set(`int_province_comm:${item.code}`, item);
    }
    const field = state.fields.inside_unit;
    field.addOption(pvhcc.code);
    field.addOption(congAn.code);
    field.popup.one.set('a.user-box-tab[data-type="group"]', new Element());
    let gSoClicks = 0;
    let gBanClicks = 0;
    const gSo = new Element({ 'data-id': 'g_so' }, () => {
        gSoClicks++;
        addChip(field, so1.code);
        addChip(field, so2.code);
    });
    const gBan = new Element({ 'data-id': 'g_ban' }, () => {
        gBanClicks++;
        addChip(field, ban1.code);
        addChip(field, ban2.code);
    });
    gSo.classList = { contains: () => false };
    gBan.classList = { contains: () => false };
    field.popup.many.set('[data-role="group"] a.user-box-group-item[data-id]', () => [gSo, gBan]);
    globalThis.window = {
        jQuery: node => ({
            data: () => (node === gSo ? { type: 'group', units: [so1, so2] } : { type: 'group', units: [ban1, ban2] }),
        }),
    };
    try {
        const result = await api.prepareOutgoingForm({
            doc,
            recipients: [so1, so2, ban1, ban2, congAn, pvhcc],
            assignments: {
                comm_so1: ['inside_unit'], comm_so2: ['inside_unit'],
                comm_ban1: ['inside_unit'], comm_ban2: ['inside_unit'],
                comm_ca: ['inside_unit'], comm_pvhcc: ['inside_unit'],
            },
            firstInsideCode: pvhcc.code,
            registryVersion: 'r1',
            selectionPlan: [
                { group_id: 'g_so', sphere: 'int_province_comm', registry_version: 'r1', member_codes: [so1.code, so2.code] },
                { group_id: 'g_ban', sphere: 'int_province_comm', registry_version: 'r1', member_codes: [ban1.code, ban2.code] },
            ],
        });
        assert.equal(gSoClicks, 1);
        assert.equal(gBanClicks, 1);
        assert.equal(result.applied.length, 6);
        assert.equal(field.chips[0].getAttribute('data-uuid'), 'H21.21.04');
        assert.deepEqual(field.chips.map(c => c.getAttribute('data-uuid')), ['H21.21.04', 'H21.05', 'H21.06', 'H21.38', 'H21.40', 'G01.035.000.000']);
        assert.equal(state.submitted, 0);
    } finally { delete globalThis.window; }
});

test('collapses a fully-covered internal department group into one parent dept selection plus uncovered individuals', async () => {
    const member2 = {
        recipient_id: 'internal_278', source_id: '278', recipient_type: 'INTERNAL_PERSON',
        sphere: 'internal', code: 'thanhnt@vpub.gialai.gov.vn', name: 'Nguyễn Tuấn Thanh',
    };
    const outsideMember = {
        recipient_id: 'internal_491', source_id: '491', recipient_type: 'INTERNAL_PERSON',
        sphere: 'internal', code: 'danhnh@vpub.gialai.gov.vn', name: 'Nguyễn Hoàng Đan',
    };
    globalThis.__formBridge.internalDirectory.set('278', { id: 278, type: 'alias', refUname: member2.code, refFullname: member2.name });
    globalThis.__formBridge.internalDirectory.set('491', { id: 491, type: 'alias', refUname: outsideMember.code, refFullname: outsideMember.name });
    let parentClicks = 0;
    let member1Clicks = 0;
    let outsideClicks = 0;
    state.fields.responsible.options = [];
    state.fields.responsible.addOption('269', '269', () => { parentClicks++; });
    state.fields.responsible.addOption('270', '270', () => { member1Clicks++; });
    state.fields.responsible.addOption('491', '491', () => { outsideClicks++; });
    const result = await api.prepareOutgoingForm({
        doc,
        recipients: [person, member2, outsideMember],
        assignments: {
            internal_270: ['responsible'],
            internal_278: ['responsible'],
            internal_491: ['responsible'],
        },
        registryVersion: 'r1',
        selectionPlan: [
            { group_id: '269', sphere: 'internal', registry_version: 'r1', member_codes: ['270', '278'] },
        ],
    });
    assert.equal(parentClicks, 1);
    assert.equal(member1Clicks, 0);
    assert.equal(outsideClicks, 1);
    assert.deepEqual(state.fields.responsible.chips.map(c => c.getAttribute('data-uuid')), ['269', '491']);
    assert.deepEqual(result.applied, [
        { recipient_id: 'internal_270', field: 'responsible', id: '269' },
        { recipient_id: 'internal_278', field: 'responsible', id: '269' },
        { recipient_id: 'internal_491', field: 'responsible', id: '491' },
    ]);
    assert.equal(state.submitted, 0);
});

test('falls back to individual internal selections when a group member is omitted or split across fields', async () => {
    const member2 = {
        recipient_id: 'internal_278', source_id: '278', recipient_type: 'INTERNAL_PERSON',
        sphere: 'internal', code: 'thanhnt@vpub.gialai.gov.vn', name: 'Nguyễn Tuấn Thanh',
    };
    globalThis.__formBridge.internalDirectory.set('278', { id: 278, type: 'alias', refUname: member2.code, refFullname: member2.name });
    let parentClicks = 0;
    state.fields.responsible.addOption('269', '269', () => { parentClicks++; });
    state.fields.save.addOption('269', '269', () => { parentClicks++; });
    state.fields.save.addOption('278');

    // Case 1: member omitted from assignments
    await api.prepareOutgoingForm({
        doc,
        recipients: [person, member2],
        assignments: { internal_270: ['responsible'] },
        registryVersion: 'r1',
        selectionPlan: [{ group_id: '269', sphere: 'internal', registry_version: 'r1', member_codes: ['270', '278'] }],
    });
    assert.equal(parentClicks, 0);
    assert.deepEqual(state.fields.responsible.chips.map(c => c.getAttribute('data-uuid')), ['270']);

    // Reset chips for Case 2: members assigned to different internal fields
    state.fields.responsible.chips = [];
    state.fields.save.chips = [];
    await api.prepareOutgoingForm({
        doc,
        recipients: [person, member2],
        assignments: { internal_270: ['responsible'], internal_278: ['save'] },
        registryVersion: 'r1',
        selectionPlan: [{ group_id: '269', sphere: 'internal', registry_version: 'r1', member_codes: ['270', '278'] }],
    });
    assert.equal(parentClicks, 0);
    assert.deepEqual(state.fields.responsible.chips.map(c => c.getAttribute('data-uuid')), ['270']);
    assert.deepEqual(state.fields.save.chips.map(c => c.getAttribute('data-uuid')), ['278']);
    assert.equal(state.submitted, 0);
});

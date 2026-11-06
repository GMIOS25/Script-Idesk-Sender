import { showDocument, internalDirectory, organizationDirectory, isDocumentEligible } from './idesk.js';

export const FIELD_DEFINITIONS = [
    { key: 'responsible', label: 'Xử lý văn bản đi', sphere: 'internal', selector: '#ed-full-transfer-select-user-responsible' },
    { key: 'save', label: 'Chuyển để biết', sphere: 'internal', selector: '#ed-full-transfer-select-user-save' },
    { key: 'participants', label: 'Phối hợp xử lý', sphere: 'internal', selector: '#ed-full-transfer-select-user-participants' },
    { key: 'follow', label: 'Theo dõi', sphere: 'internal', selector: '#ed-full-transfer-select-user-follow' },
    { key: 'inside_unit', label: 'Đơn vị nhận trong tỉnh', sphere: 'int_province_comm', selector: '#ed-full-transfer-select-inside-unit' },
    { key: 'outside_unit', label: 'Đơn vị nhận ngoài tỉnh', sphere: 'ext_province_comm', selector: '#ed-full-transfer-select-outside-unit' },
];

const INTERNAL_TYPES = { INTERNAL_PERSON: 'alias', INTERNAL_DEPT: 'dept', INTERNAL_GROUP: 'group', INTERNAL_UNIT: 'unit' };
const selectedRow = () => document.querySelector('#listview-publish-list-content .messageListItem.selected[data-id]');
const visible = node => Boolean(node && node.isConnected !== false && node.offsetParent !== null);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => String(value ?? '').trim();
const username = value => text(value).toLowerCase();
const failedWidgets = new WeakSet();

export function allowedFields(recipient) {
    const expectedSphere = INTERNAL_TYPES[recipient?.recipient_type] ? 'internal'
        : recipient?.recipient_type === 'INT_PROVINCE_UNIT' ? 'int_province_comm'
            : recipient?.recipient_type === 'EXT_PROVINCE_UNIT' ? 'ext_province_comm' : null;
    return expectedSphere && recipient.sphere === expectedSphere
        ? FIELD_DEFINITIONS.filter(field => field.sphere === expectedSphere) : [];
}

async function waitFor(read, message, timeout = 4000) {
    const until = Date.now() + timeout;
    do {
        const value = read();
        if (value) return value;
        await sleep(80);
    } while (Date.now() < until);
    throw new Error(message);
}

function identity(recipient) {
    if (!allowedFields(recipient).length) throw new Error(`Sai phạm vi người nhận: ${recipient.recipient_id}`);
    if (recipient.sphere !== 'internal') {
        const id = text(recipient.code);
        const native = organizationDirectory.get(`${recipient.sphere}:${id}`);
        if (!id || !native || text(native.code) !== id || native.sphere !== recipient.sphere) {
            throw new Error(`Không xác thực được định danh đơn vị trong danh mục iDesk: ${recipient.recipient_id}`);
        }
        return { id, chipId: id, native, search: id };
    }
    const id = text(recipient.source_id);
    const native = internalDirectory.get(id);
    if (!/^[1-9]\d*$/.test(id) || !native || text(native.id) !== id || native.type !== INTERNAL_TYPES[recipient.recipient_type]) {
        throw new Error(`Không xác thực được định danh nội bộ: ${recipient.recipient_id}`);
    }
    if (recipient.recipient_type === 'INTERNAL_PERSON') {
        if (!username(recipient.code) || username(native.refUname) !== username(recipient.code)) {
            throw new Error(`Định danh và username không khớp danh mục iDesk: ${recipient.recipient_id}`);
        }
    } else {
        const nativeCode = native.refCode || native.unitCode || '';
        if (text(recipient.code) && text(recipient.code) !== text(nativeCode)) {
            throw new Error(`Mã định danh nội bộ không khớp danh mục iDesk: ${recipient.recipient_id}`);
        }
    }
    // Native tree selections create chips with the numeric node ID. refCode
    // can be shared by a department and a person, so it cannot prove selection.
    return { id, chipId: id, native, search: native.refFullname || native.name || id };
}

function makePlan(recipients, assignments) {
    const byId = new Map();
    for (const recipient of recipients) {
        if (!recipient?.recipient_id || byId.has(recipient.recipient_id)) throw new Error('Danh sách người nhận bị thiếu hoặc trùng định danh.');
        byId.set(recipient.recipient_id, recipient);
    }
    const plan = [];
    for (const [recipientId, keys] of Object.entries(assignments || {})) {
        if (!Array.isArray(keys)) throw new Error('Các trường người nhận phải là một danh sách.');
        if (!keys.length) continue;
        const recipient = byId.get(recipientId);
        if (!recipient) throw new Error(`Không tìm thấy người nhận đã duyệt: ${recipientId}`);
        const target = identity(recipient);
        const allowed = allowedFields(recipient);
        for (const key of new Set(keys)) {
            const field = allowed.find(item => item.key === key);
            if (!field) throw new Error(`Trường ${key} không thuộc phạm vi của ${recipientId}.`);
            plan.push({ recipient, target, field });
        }
    }
    if (!plan.length) throw new Error('Chưa chọn người nhận và trường để điền.');
    return plan;
}

function chipIds(field) {
    const chips = Array.from(field.querySelectorAll('.user-box-item-container .user-box-item'));
    const ids = chips.map(chip => text(chip.getAttribute('data-uuid') || chip.getAttribute('data-id')));
    if (ids.some(id => !id)) throw new Error('Không xác nhận được định danh chip người nhận sẵn có.');
    return [...new Set(ids)];
}

function assertDocument(docId, row, widget) {
    const selected = selectedRow();
    if (!visible(selected) || text(selected.getAttribute('data-id')) !== docId || row.isConnected === false) {
        throw new Error('Văn bản đang chọn đã thay đổi. Dừng điền để tránh chọn nhầm văn bản.');
    }
    if (!isDocumentEligible(row)) throw new Error('Văn bản không còn đủ điều kiện: Đã chuyển nội bộ hoặc Đã vào sổ có tài liệu chính.');
    if (widget && (!visible(widget) || document.querySelector('#ed-full-transfer-document-widget') !== widget)) {
        throw new Error('Form văn bản đã thay đổi trong khi đang điền.');
    }
}

async function revealField(definition) {
    let field = document.querySelector(definition.selector);
    if (!visible(field) && ['participants', 'follow'].includes(definition.key)) {
        const toggle = document.querySelector(`#ed-full-transfer-add-${definition.key}-btn`);
        if (!visible(toggle)) throw new Error(`Không mở được trường ${definition.label}.`);
        toggle.click();
        field = await waitFor(() => {
            const node = document.querySelector(definition.selector);
            return visible(node) && node;
        }, `Trường ${definition.label} chưa hiển thị.`);
    }
    if (!visible(field)) throw new Error(`Không tìm thấy trường ${definition.label} trên form iDesk.`);
    return field;
}

function fieldPopup(field) {
    // iDesk mounts Bootstrap popovers in this field's rpopover wrapper.
    // Never search another field's open popup, even when it contains the same ID.
    const scope = field.closest('.rpopover') || field;
    const candidates = [...Array.from(field.querySelectorAll('.popover')), ...Array.from(scope.querySelectorAll('.popover'))];
    return [...new Set(candidates)].find(visible);
}

async function selectGroup(field, group, guard) {
    const before = chipIds(field);
    const link = field.querySelector('a.user-box-link');
    if (!visible(link)) throw new Error('Không mở được danh sách nhóm đơn vị.');
    guard();
    link.click();
    const popup = await waitFor(() => fieldPopup(field), 'Không mở được danh sách nhóm đơn vị.');
    try {
        const tab = popup.querySelector('a.user-box-tab[data-type="group"]');
        if (!visible(tab)) throw new Error('Thiếu thẻ Nhóm đơn vị trong tỉnh.');
        guard();
        tab.click();
        const item = await waitFor(() => [...popup.querySelectorAll('[data-role="group"] a.user-box-group-item[data-id]')]
            .find(node => visible(node) && text(node.getAttribute('data-id')) === group.group_id),
        'Không tìm thấy nhóm iDesk đã xác minh.');
        const realm = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        const live = realm.jQuery?.(item).data('data');
        const codes = Array.isArray(live?.units) ? live.units.map(unit => text(unit.code)) : [];
        if (live?.type !== 'group' || codes.length !== group.member_codes.length
            || new Set(codes).size !== codes.length || codes.some(code => !group.member_codes.includes(code))) {
            throw new Error('Thành viên nhóm iDesk đã thay đổi. Đồng bộ rồi đối chiếu lại.');
        }
        if (group.member_codes.every(code => before.includes(code))) return;
        if (item.classList.contains('user-box-group-item-selected')) throw new Error('Trạng thái chọn nhóm trên iDesk không khớp.');
        guard();
        item.click();
        const expected = new Set([...before, ...group.member_codes]);
        await waitFor(() => {
            guard();
            const actual = chipIds(field);
            return actual.length === expected.size && actual.every(id => expected.has(id));
        }, 'Các chip sau khi chọn nhóm không khớp tập kỳ vọng.', 1200);
    } finally {
        const close = popup.querySelector('.close');
        if (visible(close)) close.click();
    }
}

async function selectIdentity(field, definition, target, guard) {
    const before = chipIds(field);
    if (before.includes(target.chipId)) return;
    const link = field.querySelector('a.user-box-link');
    if (!visible(link)) throw new Error(`Không mở được danh sách ${definition.label}.`);
    guard();
    link.click();
    const popup = await waitFor(() => fieldPopup(field), `Không tìm thấy danh sách của trường ${definition.label}.`);
    try {
        guard();
        const expand = document.getElementById(`${definition.selector.slice(1)}-expand-all`)
            || popup.querySelector('[title="Mở rộng tất cả"]');
        if (visible(expand)) expand.click();
        const search = popup.querySelector('input[type="text"]') || field.querySelector('input.user-box-input');
        if (search) {
            search.value = target.search;
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new Event('keyup', { bubbles: true }));
        }
        const candidate = await waitFor(() => {
            const keywordItems = Array.from(popup.querySelectorAll('[data-role="keyword"] a.user-box-group-item[data-id]'));
            const items = keywordItems.length ? keywordItems : Array.from(popup.querySelectorAll('a.user-box-group-item[data-id]'));
            const matches = items
                .filter(node => visible(node) && text(node.getAttribute('data-id')) === target.id);
            // Keyword/rank/type tabs can repeat the same authoritative code.
            // Its exact directory identity, scoped field, and resulting chip
            // still have to match; labels never decide which identity to use.
            return matches[0];
        }, `Không tìm thấy định danh chính xác ${target.id} trong trường ${definition.label}.`);
        guard();
        candidate.click();
        // A click is not a successful fill until the widget's selected chips
        // contain exactly the prior recipients plus the requested native ID.
        await waitFor(() => chipIds(field).includes(target.chipId), `Không xác nhận được chip người nhận ${target.id}.`, 1200);
        const after = chipIds(field);
        const expected = new Set([...before, target.chipId]);
        if (after.length !== expected.size || after.some(id => !expected.has(id))) {
            throw new Error(`Các chip người nhận không khớp sau khi chọn ${target.id}.`);
        }
    } finally {
        const close = popup.querySelector('.close');
        if (visible(close)) close.click();
    }
}

/** Prepare native recipient fields for user review. Never submit or publish. */
export async function prepareOutgoingForm({ doc, recipients, assignments, selectionPlan = [], registryVersion,
    firstInsideCode, publicationAssignments = [], previousPolicyChips = [], replaceExisting = false, onStatus = () => {} }) {
    // Validate all destinations before navigation, opening, clearing, or filling.
    const plan = makePlan(recipients || [], assignments);
    if (firstInsideCode) {
        const first = plan.findIndex(item => item.field.key === 'inside_unit' && item.target.chipId === firstInsideCode);
        if (first < 0) throw new Error('Thiếu đơn vị đầu danh sách theo quy trình phát hành.');
        plan.unshift(...plan.splice(first, 1));
    }
    const groupByCode = new Map();
    const inside = new Set(plan.filter(item => item.field.key === 'inside_unit').map(item => item.target.chipId));
    for (const group of selectionPlan) {
        if (!group?.group_id || group.sphere !== 'int_province_comm' || group.registry_version !== registryVersion
            || !Array.isArray(group.member_codes) || !group.member_codes.length
            || new Set(group.member_codes).size !== group.member_codes.length) {
            throw new Error('Kế hoạch chọn nhóm không hợp lệ hoặc đã cũ.');
        }
        if (!group.member_codes.every(code => inside.has(code) && !groupByCode.has(code))) continue;
        for (const code of group.member_codes) groupByCode.set(code, group);
    }
    const docId = text(doc?.id);
    if (!docId) throw new Error('Thiếu định danh văn bản.');
    const row = await showDocument(docId);
    assertDocument(docId, row);
    const open = document.querySelector('#ed-view-btn-full-transfer');
    if (!visible(open)) throw new Error('Văn bản không có chức năng ban hành đang hiển thị.');
    open.click();
    const widget = await waitFor(() => {
        const node = document.querySelector('#ed-full-transfer-document-widget');
        return visible(node) && node;
    }, 'Form ban hành chưa hiển thị.');
    const guard = () => assertDocument(docId, row, widget);
    guard();
    if (failedWidgets.has(widget)) throw new Error('Form đã bị điền dở. Hãy bỏ qua form và nạp lại văn bản trước khi thử lại.');
    const subject = document.querySelector('#ed-full-transfer-doc-text-subject');
    if (text(doc.subject) && text(subject?.textContent).replace(/\s+/g, ' ') !== text(doc.subject).replace(/\s+/g, ' ')) {
        throw new Error('Trích yếu trên form không khớp văn bản đã phân tích.');
    }
    const applied = [];
    const existing = Object.fromEntries(FIELD_DEFINITIONS.map(definition => {
        const field = document.querySelector(definition.selector);
        return [definition.key, field ? chipIds(field) : []];
    }));
    const planned = new Set(plan.map(item => `${item.field.key}:${item.target.chipId}`));
    if (previousPolicyChips.some(chip => existing[chip.field]?.includes(chip.id)
        && !planned.has(`${chip.field}:${chip.id}`))) {
        throw new Error('Form còn người nhận tự thêm theo phạm vi phát hành trước. Hãy bỏ qua form cũ hoặc loại các chip đó trước khi điền.');
    }
    const cleared = new Set();
    const appliedGroups = new Set();
    if (firstInsideCode && !replaceExisting && existing.inside_unit.length && existing.inside_unit[0] !== firstInsideCode) {
        throw new Error('PVHCC cần đứng đầu. Kiểm tra thứ tự hoặc chọn thay thế người nhận sẵn có.');
    }
    const assignedFields = new Set(plan.map(item => item.field.key));
    const expectedByField = new Map(FIELD_DEFINITIONS.map(definition => [definition.key,
        new Set(replaceExisting && assignedFields.has(definition.key) ? [] : existing[definition.key]),
    ]));
    try {
        for (const { recipient, target, field: definition } of plan) {
            guard();
            const field = await revealField(definition);
            guard();
            if (replaceExisting && !cleared.has(definition.key)) {
                if (chipIds(field).length) {
                    const clear = field.querySelector('.user-clear');
                    if (!visible(clear)) throw new Error(`Không thể xóa người nhận sẵn có ở trường ${definition.label}.`);
                    clear.click();
                    await waitFor(() => chipIds(field).length === 0, `Chưa xóa được người nhận ở trường ${definition.label}.`);
                    guard();
                }
                cleared.add(definition.key);
            }
            onStatus(`Đang điền ${definition.label}: ${recipient.display_name || recipient.name}`);
            const group = definition.key === 'inside_unit' && target.chipId !== firstInsideCode && groupByCode.get(target.chipId);
            if (!group) await selectIdentity(field, definition, target, guard);
            else if (!appliedGroups.has(group.group_id)) {
                await selectGroup(field, group, guard);
                appliedGroups.add(group.group_id);
            }
            expectedByField.get(definition.key).add(target.chipId);
            applied.push({ recipient_id: recipient.recipient_id, field: definition.key, id: target.id });
            guard();
        }
        guard();
        for (const [key, expected] of expectedByField) {
            const definition = FIELD_DEFINITIONS.find(field => field.key === key);
            const node = document.querySelector(definition.selector);
            const actual = node ? chipIds(node) : [];
            if (actual.length !== expected.size || actual.some(id => !expected.has(id))) {
                throw new Error(`Chip đã chọn không khớp trường ${definition.label}.`);
            }
            if (key === 'inside_unit' && firstInsideCode && actual[0] !== firstInsideCode) {
                throw new Error('PVHCC chưa đứng đầu danh sách đơn vị nhận.');
            }
        }
        const publicationRecipients = new Set(publicationAssignments.map(a => a.recipient_id));
        const publicationChips = previousPolicyChips.filter(chip => expectedByField.get(chip.field)?.has(chip.id));
        for (const { recipient, field, target } of plan) {
            if (publicationRecipients.has(recipient.recipient_id)
                && !existing[field.key].includes(target.chipId)
                && !publicationChips.some(chip => chip.field === field.key && chip.id === target.chipId)) {
                publicationChips.push({ field: field.key, id: target.chipId });
            }
        }
        return { applied, existing, publicationChips };
    } catch (error) {
        for (const definition of FIELD_DEFINITIONS) {
            const field = document.querySelector(definition.selector);
            try {
                if (JSON.stringify(field ? chipIds(field) : []) !== JSON.stringify(existing[definition.key])) failedWidgets.add(widget);
            } catch { failedWidgets.add(widget); }
        }
        error.applied = applied;
        error.existing = existing;
        onStatus(`Đã điền ${applied.length} lựa chọn. Dừng: ${error.message}`);
        throw error;
    }
}

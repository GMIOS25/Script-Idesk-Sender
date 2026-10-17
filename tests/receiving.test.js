import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getReceivedItemKind, isOrdinaryReceivedItem } from '../src/utils/helpers.js';
import { autoFillAndSubmit, prepareReceivingForm } from '../src/automation/formFiller.js';
import { scanAllPages, showDocumentInList } from '../src/services/scanner.js';
import { CONFIG, S } from '../src/config.js';
import { docCache } from '../src/state.js';

afterEach(() => {
    delete globalThis.document;
    docCache.clear();
});

test('uses row state rather than the hidden bookFlag span', () => {
    const html = readFileSync(new URL('../resource/Văn bản đến/Tiếp nhận văn bản/left_panel.html', import.meta.url), 'utf8');
    for (const [id, expected] of [['19285007', true], ['19284804', false], ['19284914', false]]) {
        const classes = html.match(new RegExp(`<div data-id="${id}" class="([^"]+)"`))?.[1].split(' ') || [];
        assert.ok(html.includes('class="bookFlag"'));
        assert.equal(isOrdinaryReceivedItem({ classList: { contains: name => classes.includes(name) } }), expected);
    }
    assert.equal(isOrdinaryReceivedItem({
        classList: { contains: () => false },
        querySelector: selector => selector === '.bookFlag' ? { getClientRects: () => [{}] } : null
    }), false);
});

test('classifies update, booked and ordinary receiving rows', () => {
    const row = (classes = []) => ({
        classList: { contains: name => classes.includes(name) },
        querySelector: () => null
    });
    assert.equal(getReceivedItemKind(row(['update'])), 'update');
    assert.equal(getReceivedItemKind(row(['book'])), 'book');
    assert.equal(getReceivedItemKind(row()), 'ordinary');
});

test('approves an update document without requiring AI transfer data', async () => {
    let clicked = false;
    const row = { classList: { contains: name => name === 'update' || name === 'selected' } };
    const accept = { disabled: false, getClientRects: () => [{}], click: () => { clicked = true; } };
    globalThis.document = {
        getElementById: () => null,
        querySelector: selector => selector.includes('data-id="update-1"') ? row : selector === S.ACCEPT_UPDATE_BTN ? accept : null
    };
    const previousDelay = CONFIG.DELAY_MS.AFTER_SUBMIT;
    CONFIG.DELAY_MS.AFTER_SUBMIT = 0;
    try {
        assert.equal(await autoFillAndSubmit('update-1', null), true);
        assert.equal(clicked, true);
    } finally {
        CONFIG.DELAY_MS.AFTER_SUBMIT = previousDelay;
    }
});

test('opens the transfer form for a booked document and confirms it', async () => {
    let transferClicked = false;
    let agreeClicked = false;
    const row = { classList: { contains: name => name === 'book' || name === 'selected' } };
    const visible = { disabled: false, getClientRects: () => [{}] };
    const transfer = { ...visible, click: () => { transferClicked = true; } };
    const agree = { ...visible, click: () => { agreeClicked = true; } };
    const container = { getClientRects: () => [{}] };
    const widget = { getClientRects: () => [{}], querySelector: selector => selector === S.TRANSFER_CONTAINER ? container : null };
    globalThis.document = {
        getElementById: () => null,
        querySelector: selector => {
            if (selector.includes('data-id="book-1"')) return row;
            if (selector === S.TRANSFER_BTN) return transfer;
            if (selector === S.TRANSFER_WIDGET) return widget;
            if (selector === S.AGREE_BTN) return agree;
            return null;
        }
    };
    const previousClickDelay = CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER;
    const previousSubmitDelay = CONFIG.DELAY_MS.AFTER_SUBMIT;
    CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER = 0;
    CONFIG.DELAY_MS.AFTER_SUBMIT = 0;
    try {
        assert.equal(await autoFillAndSubmit('book-1', { processing_unit: [], coordinating_units: [] }), true);
        assert.equal(transferClicked, true);
        assert.equal(agreeClicked, true);
    } finally {
        CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER = previousClickDelay;
        CONFIG.DELAY_MS.AFTER_SUBMIT = previousSubmitDelay;
    }
});

const fakeForm = (category, book, categoryOptions = ['Công văn'], bookOptions = ['Sổ Văn bản đến', 'Sổ Văn bản đến Văn phòng Đảng ủy Sở'], staleCategoryError = false) => {
    let open = null;
    const opened = [];
    const makeField = (name, value, options) => {
        const chosen = { textContent: value };
        const container = {
            classList: { contains: cls => cls === 'select2-container' || (cls === 'error' && (chosen.textContent.startsWith('Chọn') || (name === 'category' && staleCategoryError))) },
            querySelector: selector => selector === '.select2-chosen' ? chosen :
                selector === '.select2-choice' ? {
                    click() {},
                    dispatchEvent(event) {
                        if (event.type === 'mousedown') { open = name; opened.push(name); }
                    }
                } : null
        };
        return { container, options };
    };
    const fields = {
        category: makeField('category', category, categoryOptions),
        book: makeField('book', book, bookOptions)
    };
    const search = { value: '', focus() {}, click() {}, dispatchEvent() {} };
    const drop = {
        getClientRects: () => open ? [{}] : [],
        querySelector: selector => selector === '.select2-results' ? {} :
            selector === 'input.select2-input' ? search : null,
        querySelectorAll: selector => selector === 'li.select2-result-selectable'
            ? fields[open].options.filter(label => !search.value || label.toLowerCase().includes(search.value.toLowerCase())).map(label => ({
                querySelector: () => ({ textContent: `CV ${label}`, querySelector: () => ({ textContent: 'CV' }) }),
                click() {},
                dispatchEvent(event) {
                    if (event.type === 'mouseup') {
                        fields[open].container.querySelector('.select2-chosen').textContent = label;
                        open = null;
                        search.value = '';
                    }
                }
            })) : []
    };
    const save = { get disabled() { return !fields.category.container.querySelector('.select2-chosen').textContent || !fields.book.container.querySelector('.select2-chosen').textContent; }, getClientRects: () => [{}] };
    globalThis.document = {
        getElementById: id => ({
            'edocs-txt-category': { previousElementSibling: fields.category.container },
            'edocs-txt-book': { previousElementSibling: fields.book.container }
        })[id],
        querySelectorAll: selector => selector === '.select2-drop' ? [drop] : [],
        querySelector: selector => selector === S.SAVE_TRANSFER_BTN ? save : null
    };
    return { fields, opened, save };
};

test('keeps a prefilled category despite a stale error class and selects the exact general incoming book', async () => {
    const form = fakeForm('Công văn', 'Chọn sổ văn bản', ['Công văn'], ['Sổ Văn bản đến', 'Sổ Văn bản đến Văn phòng Đảng ủy Sở'], true);
    assert.equal(await prepareReceivingForm('Công văn'), form.save);
    assert.deepEqual(form.opened, ['book']);
    assert.equal(form.fields.book.container.querySelector('.select2-chosen').textContent, 'Sổ Văn bản đến');
});

test('maps a free-form category to Công văn before choosing the book', async () => {
    const form = fakeForm('Chọn loại văn bản', 'Chọn sổ văn bản');
    await prepareReceivingForm('Công văn Xây dựng Công thương');
    assert.deepEqual(form.opened, ['category', 'book']);
    assert.equal(form.fields.category.container.querySelector('.select2-chosen').textContent, 'Công văn');
    assert.equal(form.fields.book.container.querySelector('.select2-chosen').textContent, 'Sổ Văn bản đến');
});

test('refuses to transfer when only the party office book is available', async () => {
    fakeForm('Công văn', 'Chọn sổ văn bản', ['Công văn'], ['Sổ Văn bản đến Văn phòng Đảng ủy Sở']);
    await assert.rejects(prepareReceivingForm('Công văn'), /Không tìm thấy lựa chọn Sổ Văn bản đến/);
});

test('scans every receiving page and keeps all document types eligible', async () => {
    const row = (id, classes = []) => ({
        getClientRects: () => [{}],
        getAttribute: name => name === 'data-id' ? id : null,
        classList: { contains: name => classes.includes(name) },
        querySelector: selector => {
            if (selector === '.sender') return { textContent: `Số ${id}` };
            if (selector === '.subject') return { textContent: `Trích yếu ${id}` };
            if (selector === '.updateFlag' || selector === '.bookFlag') return { getClientRects: () => [] };
            return null;
        }
    });
    const pages = [
        [row('1'), row('2', ['book'])],
        [row('3', ['update']), row('4')],
        [row('5')]
    ];
    let pageIndex = 1;
    let firstClicks = 0;
    let nextClicks = 0;
    let prevClicks = 0;
    const button = (enabled, click) => ({
        get disabled() { return !enabled(); },
        classList: { contains: () => false },
        click
    });
    const first = button(() => pageIndex > 0, () => { firstClicks++; pageIndex = 0; });
    const prev = button(() => pageIndex > 0, () => { prevClicks++; pageIndex--; });
    const next = button(() => pageIndex < pages.length - 1, () => { nextClicks++; pageIndex++; });

    globalThis.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === S.LEFT_LIST ? pages[pageIndex] : [],
        querySelector: selector => {
            if (selector === S.PAGING_FIRST_BTN) return first;
            if (selector === S.PAGING_PREV_BTN) return prev;
            if (selector === S.PAGING_NEXT_BTN) return next;
            if (selector === S.PAGING_CURRENT) return { textContent: String(pageIndex + 1) };
            const id = selector.match(/^\.messageListItem\[data-id="(.+)"\]$/)?.[1];
            if (id) return pages[pageIndex].find(item => item.getAttribute('data-id') === id) || null;
            return null;
        }
    };

    assert.equal(await scanAllPages(), 5);
    assert.equal(firstClicks, 1);
    assert.equal(nextClicks, 2);
    assert.deepEqual([...docCache.keys()], ['1', '2', '3', '4', '5']);
    assert.deepEqual([...docCache.values()].map(doc => doc.page), [1, 1, 2, 2, 3]);
    assert.deepEqual([...docCache.values()].map(doc => doc.pageIndex), [0, 1, 0, 1, 0]);
    assert.deepEqual([...docCache.values()].map(doc => doc.kind), ['ordinary', 'book', 'update', 'ordinary', 'ordinary']);
    assert.ok([...docCache.values()].every(doc => doc.eligible));
    assert.equal(await showDocumentInList('4', 2), true);
    assert.equal(prevClicks, 1);
});

test('collects the oldest documents up to the requested limit (bottom-up)', async () => {
    const row = id => ({
        getClientRects: () => [{}],
        getAttribute: name => name === 'data-id' ? id : null,
        classList: { contains: () => false },
        querySelector: selector => {
            if (selector === '.sender') return { textContent: `Số ${id}` };
            if (selector === '.subject') return { textContent: `Trích yếu ${id}` };
            return null;
        }
    });
    const pages = [
        [row('1'), row('2')],
        [row('3'), row('4')],
        [row('5'), row('6')]
    ];
    let pageIndex = 0;
    let nextClicks = 0;
    let prevClicks = 0;
    const button = (enabled, click) => ({
        get disabled() { return !enabled(); },
        classList: { contains: () => false },
        click
    });
    const first = button(() => pageIndex > 0, () => { pageIndex = 0; });
    const prev = button(() => pageIndex > 0, () => { prevClicks++; pageIndex--; });
    const next = button(() => pageIndex < pages.length - 1, () => { nextClicks++; pageIndex++; });

    globalThis.document = {
        getElementById: () => null,
        querySelectorAll: selector => selector === S.LEFT_LIST ? pages[pageIndex] : [],
        querySelector: selector => {
            if (selector === S.PAGING_FIRST_BTN) return first;
            if (selector === S.PAGING_PREV_BTN) return prev;
            if (selector === S.PAGING_NEXT_BTN) return next;
            if (selector === S.PAGING_CURRENT) return { textContent: String(pageIndex + 1) };
            return null;
        }
    };

    assert.equal(await scanAllPages(3), 3);
    assert.equal(nextClicks, 2);
    assert.equal(prevClicks, 1);
    assert.deepEqual([...docCache.keys()], ['6', '5', '4']);
    assert.deepEqual([...docCache.values()].map(doc => doc.page), [3, 3, 2]);
    assert.deepEqual([...docCache.values()].map(doc => doc.pageIndex), [1, 0, 1]);
    assert.ok([...docCache.values()].every(doc => doc.eligible));
});

test('rejects an invalid document scan limit', async () => {
    globalThis.document = { getElementById: () => null };
    await assert.rejects(scanAllPages(0), /số nguyên lớn hơn 0/i);
});

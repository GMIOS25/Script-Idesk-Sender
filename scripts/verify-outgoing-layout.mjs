// Exercises the real dashboard with deterministic document/directory fixtures.
// No requests or actions are sent to iDesk or the configured backend.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../dist/layout-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const unit = (name, index) => ({ recipient_id: `unit-${index}`, source_id: `source-${index}`, recipient_type: 'INT_PROVINCE_UNIT', sphere: 'int_province_comm', code: `H21.${index}`, name });
const units = ['Sở Nội vụ', 'Sở Tài chính', 'Sở Xây dựng', 'Sở Công Thương', 'Sở Tư pháp', 'Sở Y tế', 'Sở Giáo dục và Đào tạo', 'Sở Văn hóa, Thể thao và Du lịch', 'Sở Khoa học và Công nghệ', 'Thanh tra tỉnh', 'Văn phòng UBND tỉnh', 'Ban Quản lý Khu kinh tế'].map(unit);
const person = { recipient_id: 'person-1', source_id: '1', recipient_type: 'INTERNAL_PERSON', sphere: 'internal', code: 'chuyenviendanthu', name: 'Nguyễn Văn An', display_name: 'Nguyễn Văn An · Chuyên viên Văn thư' };
const manual = unit('Sở Nông nghiệp và Môi trường', 99);
const result = {
    schema_version: 'outgoing.v1', document_id: '339', job_id: 'job-1', extraction_status: 'complete',
    registry_version: 'registry-1', alias_policy_version: 'policy-1', needs_review: true,
    people: [person], units, mentions: [], excluded: [], review_reasons: [],
    unresolved: Array.from({ length: 8 }, (_, i) => ({ mention_id: `m${i}`, raw: i === 7 ? manual.name : `Đơn vị được nhắc tại mục ${i + 1}`, reason: 'no_match', candidates: [], evidence: [{ page: i + 1, raw: 'Kính gửi các sở, ban, ngành; đề nghị phối hợp rà soát và tổng hợp kết quả thực hiện nhiệm vụ được giao.' }] }))
};
const nativeFixture = `
export const context = { basePath: '/vpub/smartcloud' };
export const internalDirectory = new Map();
export const organizationDirectory = new Map();
export const documents = new Map(Array.from({length: 5}, (_, i) => { const id = String(339 + i); return [id, { id, eligible: true, signNumber: id + '/UBND-KGVX', subject: 'Về việc rà soát, phối hợp triển khai nhiệm vụ và báo cáo kết quả thực hiện', selectionMarker: 'book', attachments: [{ contentUid: 'pdf-' + id, name: id + '_UBND-KGVX.pdf' }] }]; }));
export const ensureDocumentDetails = async id => documents.get(id);
export const showDocument = async () => ({});
export const isDocumentEligible = () => true;
export const chooseAttachment = doc => doc.attachments[0];
export const downloadPDF = async () => new Blob(['%PDF-test']);
export const primeDirectories = async () => {};
export const getTenantId = () => 'test';
export const fetchLookupPayload = async () => null;
export const scanDocuments = async () => documents.size;`;
const clientFixture = `
export const documentMetadata = (doc, attachment) => ({ document_id: doc.id, attachment_content_uid: attachment.contentUid });
export const createSenderClient = () => ({
    health: async () => ({}),
    analyze: async () => ({ jobId: 'job-1', metadata: { document_id: '339', attachment_content_uid: 'pdf-339' }, result: ${JSON.stringify(result)} }),
    searchRecipients: async query => {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (query === 'error') throw new Error('Không kết nối được danh bạ. Hãy thử lại.');
        return { registry_version: query === 'stale' ? 'registry-2' : 'registry-1', alias_policy_version: 'policy-1', items: query === 'empty' ? [] : [${JSON.stringify(manual)}, ${JSON.stringify(units[0])}] };
    }
});`;
const bundle = await esbuild.build({
    stdin: { contents: "import { createDashboard } from './src/outgoing/dashboard.js'; createDashboard();", resolveDir: root },
    bundle: true, write: false, format: 'iife', target: 'es2020',
    plugins: [{ name: 'isolated-ui-fixtures', setup(build) {
        build.onLoad({ filter: /outgoing[\\/]idesk\.js$/ }, () => ({ contents: nativeFixture, loader: 'js' }));
        build.onLoad({ filter: /outgoing[\\/]provider\.js$/ }, () => ({ contents: clientFixture, loader: 'js' }));
    } }]
});
const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiểm tra giao diện ban hành văn bản · dữ liệu mẫu</title><body style="margin:0;background:#e8eef2"><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
await writeFile(new URL('preview.html', output), html);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const detail = page.locator('#sender-detail');
const query = page.locator('#sender-recipient-query');
const chosen = page.locator('.sender-recipient-list');
const top = locator => locator.evaluate(node => node.scrollTop);
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 2, `${message}: ${a} vs ${b}`);
const visibleInPanel = async locator => {
    const box = await locator.boundingBox();
    const panel = await page.locator('#sender-panel').boundingBox();
    assert.ok(box && box.y >= panel.y && box.y + box.height <= panel.y + panel.height, 'Control remains inside panel');
};
const search = async term => { await query.fill(term); await query.press('Enter'); await page.waitForFunction(() => document.querySelector('.sender-search')?.getAttribute('aria-busy') === 'false'); };

try {
    await page.goto(new URL('preview.html', output).href);
    await page.locator('#sender-launcher').click();
    assert.equal(await page.locator('.sender-header').count(), 0, 'No redundant window heading');
    assert.equal(await page.locator('.sender-toolbar [data-action="close"]').count(), 1, 'Close stays in the toolbar');
    assert.equal(await page.locator('.sender-connection summary').count(), 0, 'No technical connection summary');
    assert.equal(await page.locator('.sender-connection').isVisible(), false, 'Connection settings occupy no space by default');
    await page.getByRole('button', { name: 'Cài đặt kết nối' }).click();
    assert.equal(await page.locator('#sender-base-url').isVisible(), true);
    await page.getByRole('button', { name: 'Lưu và kiểm tra' }).click();
    await page.locator('#sender-settings-panel').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Cài đặt kết nối' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('button', { name: 'Cài đặt kết nối' }).evaluate(node => node === document.activeElement), true, 'Saving settings returns keyboard focus');
    assert.equal(await page.locator('[data-setting="department"]').count(), 0);
    assert.match(await page.locator('#sender-recipients').innerText(), /Chọn và phân tích/);
    await page.locator('[data-action="analyze"][data-id="339"]').click();
    await query.waitFor();
    assert.equal(await page.locator('#sender-recipients > header, .sender-chosen-heading p').count(), 0);
    const availableHeight = (await page.locator('#sender-recipients').boundingBox()).height;
    const recipientHeight = (await chosen.boundingBox()).height;
    assert.ok(recipientHeight > availableHeight * .8, 'Recipients get at least 80% of the right panel before searching');
    console.log(`Recipient viewport: ${Math.round(recipientHeight)}px / ${Math.round(availableHeight)}px`);
    assert.equal(await page.locator('[data-setting="department"]').count(), 0);
    assert.equal(await page.getByText('Mã phòng đã xác minh', { exact: false }).count(), 0);
    assert.equal(await page.locator('.sender-recipient').count(), 13);
    await detail.evaluate(node => { node.scrollTop = 900; });
    const documentScroll = await top(detail);
    const queryBox = await query.boundingBox();
    await chosen.evaluate(node => { node.scrollTop = 900; });
    assert.deepEqual(await query.boundingBox(), queryBox, 'Lookup stays anchored when chosen recipients scroll');
    near(await top(detail), documentScroll, 'Recipient scrolling leaves document in place');
    await visibleInPanel(query);

    const mention = page.locator('[data-action="lookup-mention"]').last();
    await mention.click();
    const mentionScroll = await top(detail);
    assert.equal(await query.inputValue(), manual.name);
    assert.equal(await query.evaluate(node => node === document.activeElement), true);
    await query.press('Enter');
    assert.equal(await page.locator('.sender-search').getAttribute('aria-busy'), 'true');
    await page.waitForFunction(() => document.querySelector('.sender-search')?.getAttribute('aria-busy') === 'false');
    near(await top(detail), mentionScroll, 'Search leaves current evidence in place');
    assert.equal(await query.inputValue(), manual.name);
    assert.equal(await page.locator('.sender-added').count(), 1);
    const listScroll = await top(chosen);
    await page.locator('[data-action="search-add"]').click();
    assert.equal(await page.locator('.sender-recipient').count(), 14);
    assert.equal(await page.locator('.sender-added').count(), 2);
    near(await top(chosen), listScroll, 'Adding a recipient preserves recipient list position');
    near(await top(detail), mentionScroll, 'Adding a recipient preserves evidence position');
    assert.equal(await query.inputValue(), manual.name);
    await chosen.evaluate(node => { node.scrollTop = 0; });
    const assignment = page.locator('[data-assignment="save"]').first();
    await assignment.check();
    assert.equal(await assignment.isChecked(), true, 'Assignments still work in the right panel');
    assert.equal(await assignment.evaluate(node => node === document.activeElement), true, 'Assignment retains keyboard focus');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('[data-assignment="participants"]').first().evaluate(node => node === document.activeElement), true);
    await page.locator(`[data-action="remove-recipient"][data-recipient-id="${manual.recipient_id}"]`).click();
    assert.equal(await page.locator('.sender-recipient').count(), 13);
    assert.equal(await page.locator('.sender-added').count(), 1);
    console.log('PASS: independent scrolling, contextual lookup, query persistence, add/remove and keyboard assignments');

    await search('empty');
    assert.match(await page.locator('.sender-search-status').innerText(), /Không tìm thấy/);
    await search('error');
    assert.match(await page.locator('.sender-directory [role="alert"]').innerText(), /Không kết nối/);
    await search('stale');
    assert.match(await page.locator('.sender-directory [role="alert"]').innerText(), /Danh bạ đã thay đổi/);
    assert.equal(await page.locator('[data-action="search-add"]').count(), 0);
    await search(manual.name);
    console.log('PASS: loading, empty, transport error and changed-directory protection');

    await page.locator('[data-action="select"][data-id="340"]').click();
    assert.equal(await query.count(), 0, 'Another document does not inherit this directory search');
    await page.locator('[data-action="select"][data-id="339"]').click();
    await query.waitFor();
    assert.equal(await query.inputValue(), manual.name, 'Returning to a document restores its own query');
    assert.equal(await page.locator('.sender-added').count(), 1);
    const accessibility = await page.locator('#sender-recipients').ariaSnapshot();
    assert.match(accessibility, /complementary "Danh bạ & người nhận"/);
    assert.match(accessibility, /searchbox "Tên, chức danh hoặc mã đơn vị"/);
    assert.match(accessibility, /checkbox "Chuyển để biết" \[checked\]/);
    console.log('PASS: document isolation and accessible search/assignment labels');

    for (const width of [1440, 1024, 768, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        let readingPosition;
        if (width <= 700) {
            await page.locator('[data-action="show-review"]').click();
            readingPosition = await top(detail);
            await page.locator('[data-action="show-recipients"]').click();
        }
        await visibleInPanel(query);
        assert.equal(await page.locator('#sender-panel').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, `No panel overflow at ${width}px`);
        assert.equal(await page.locator('#sender-recipients').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, `No sidebar overflow at ${width}px`);
        assert.ok((await chosen.boundingBox()).height > 60, `Recipient list has room at ${width}px`);
        if (width > 700) assert.ok((await query.boundingBox()).x > (await detail.boundingBox()).x, 'Sidebar is to the right');
        await page.screenshot({ path: fileURLToPath(new URL(`${width}.png`, output)) });
        if (width <= 700) {
            await page.locator('[data-action="show-review"]').click();
            near(await top(detail), readingPosition, 'Switching mobile views retains reading position');
            assert.equal(await detail.isVisible(), true);
        }
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await visibleInPanel(query);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await query.isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await detail.evaluate(node => { node.scrollTop = 0; });
    await chosen.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: fileURLToPath(new URL('overview.png', output)) });
    assert.deepEqual(errors, [], 'Browser must have no runtime errors');
    console.log('PASS: 320/375/768/1024/1440px, landscape, reduced motion, no console errors');
    console.log(`Screenshots and isolated preview: ${fileURLToPath(output)}`);
} finally { await browser.close(); }

// Real Chromium verification of the built userscript; requires Playwright.
// PLAYWRIGHT_MODULE_PATH can point to a bundled Playwright package directory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['build-outgoing.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true });
const bundle = await readFile(new URL('../dist/idesk_outgoing.user.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const panel = page.locator('#sender-panel');
const header = page.locator('.sender-toolbar');
const handle = page.locator('.sender-toolbar-spacer');
const close = page.getByRole('button', { name: 'Đóng trợ lý' });
const launcher = page.locator('#sender-launcher');
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: expected ${expected}, got ${actual}`);
const rect = () => panel.boundingBox();
async function dragBy(dx, dy, target = handle) {
    const box = await target.boundingBox();
    const x = box.x + Math.min(100, box.width / 2);
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
}
async function inViewport() {
    const box = await rect();
    const viewport = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0, `Panel outside top/left: ${JSON.stringify(box)}`);
    assert.ok(box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
        `Panel outside bottom/right: ${JSON.stringify(box)}`);
    return box;
}

try {
    await page.setContent('<!doctype html><html lang="vi"><head><title>Outgoing drag verification</title></head><body><div id="publish-document-widget"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await launcher.click();
    const initial = await rect();
    const firstDragX = -Math.min(180, initial.x / 2);
    await dragBy(firstDragX, -8);
    const moved = await rect();
    near(moved.x, initial.x + firstDragX, 'Dragging toolbar moves panel horizontally');
    near(moved.y, initial.y - 8, 'Dragging toolbar moves panel vertically');
    near(moved.width, initial.width, 'Dragging preserves width');
    near(moved.height, initial.height, 'Dragging preserves height');
    console.log('PASS: native mouse drag moves the panel without resizing it');

    await page.mouse.move(700, 400);
    assert.deepEqual(await rect(), moved, 'Mouse movement after release must not move the panel');
    await dragBy(-2000, -2000);
    const topLeft = await inViewport();
    near(topLeft.x, 0, 'Left boundary');
    near(topLeft.y, 0, 'Top boundary');
    await dragBy(3000, 3000);
    const bottomRight = await inViewport();
    near(bottomRight.x + bottomRight.width, 1440, 'Right boundary');
    near(bottomRight.y + bottomRight.height, 900, 'Bottom boundary');
    console.log('PASS: pointer capture, release and all viewport boundaries');

    const beforeControls = await rect();
    await dragBy(-50, 0, close);
    assert.deepEqual(await rect(), beforeControls, 'Close button must not start a drag');
    await close.click();
    assert.equal(await panel.isVisible(), false, 'Close remains functional');
    await launcher.click();
    assert.deepEqual(await rect(), beforeControls, 'Reopening retains position');
    await dragBy(-50, 0, page.locator('[data-action="scan"]'));
    assert.deepEqual(await rect(), beforeControls, 'Toolbar controls must not start a drag');
    const rightClickBox = await handle.boundingBox();
    await page.mouse.move(rightClickBox.x + 100, rightClickBox.y + 20);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(rightClickBox.x + 50, rightClickBox.y + 20);
    await page.mouse.up({ button: 'right' });
    assert.deepEqual(await rect(), beforeControls, 'Right mouse button must not start a drag');
    console.log('PASS: close, reopen and other controls remain functional');

    const captureBox = await handle.boundingBox();
    await page.mouse.move(captureBox.x + 100, captureBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(captureBox.x + 80, captureBox.y + 20);
    await header.evaluate(element => element.releasePointerCapture(1));
    await page.mouse.move(captureBox.x + 70, captureBox.y + 20);
    const released = await rect();
    await page.mouse.move(captureBox.x + 60, captureBox.y + 20);
    assert.deepEqual(await rect(), released, 'Lost pointer capture must stop dragging');
    await page.mouse.up();
    console.log('PASS: losing pointer capture stops dragging');

    for (const eventName of ['pointercancel', 'blur']) {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + 100, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 90, box.y + 20);
        const beforeCancel = await rect();
        await header.dispatchEvent('pointermove', { pointerId: 2, clientX: 0, clientY: 0 });
        assert.deepEqual(await rect(), beforeCancel, 'Another pointer must not move an active drag');
        if (eventName === 'pointercancel') await header.dispatchEvent(eventName, { pointerId: 1 });
        else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await page.mouse.move(box.x + 50, box.y + 20);
        assert.deepEqual(await rect(), beforeCancel, `${eventName} must stop dragging`);
        assert.equal(await header.evaluate(element => element.classList.contains('sender-dragging')), false);
        await page.mouse.up();
    }
    console.log('PASS: cancellation, focus loss and unrelated pointers');

    await page.setViewportSize({ width: 768, height: 700 });
    await page.waitForTimeout(50);
    await inViewport();
    await close.click();
    await page.setViewportSize({ width: 390, height: 700 });
    await launcher.click();
    await inViewport();
    await inViewport();
    const closeBox = await close.boundingBox();
    assert.ok(closeBox.x >= 0 && closeBox.x + closeBox.width <= 390, 'Close stays visible on mobile');
    console.log('PASS: resizing and reopening at narrow viewport sizes');

    assert.deepEqual(errors, [], 'Browser must have no runtime or console errors');
    await mkdir(new URL('../dist/drag-verification/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../dist/drag-verification/mobile.png', import.meta.url)) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await dragBy(140, 8);
    await page.screenshot({ path: fileURLToPath(new URL('../dist/drag-verification/desktop.png', import.meta.url)) });
    console.log('Outgoing drag verification passed; screenshots in dist/drag-verification/.');
} finally {
    await browser.close();
}

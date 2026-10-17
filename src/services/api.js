import { CONFIG } from '../config.js';
import { docCache, unitCache, state } from '../state.js';
import { appendLog } from '../utils/logger.js';
import { sleep, ensureBasePath, getFallbackBasePath } from '../utils/helpers.js';
import { emit } from '../core/bus.js';

export const handleListResponse = (data) => {
    if (!data || !data.items) return;
    appendLog(`API qsreceiving: ${data.items.length} van ban`);
    data.items.forEach(item => {
        const id = item.id.toString();
        const ed = item.edSearchDto || {};
        const doc = docCache.get(id) || { id };

        doc.signNumber = ed.signNumber || doc.signNumber || '';
        doc.subject = ed.subject || doc.subject || '';
        doc.category = ed.category || doc.category || '';
        doc.author = ed.author || doc.author || '';
        doc.signer = ed.signer || doc.signer || '';
        doc.docDateStr = ed.docDateStr || doc.docDateStr || '';
        doc.priority = ed.priority ?? doc.priority ?? null;
        doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || '';
        doc.responsibility = item.responsibility || doc.responsibility || 'main';
        doc.book = item.book || doc.book || null;
        doc.status = doc.status || 'idle';
        doc.aiData = doc.aiData || null;

        docCache.set(id, doc);
    });
    emit('docs-changed');
};

export const handleViewResponse = (data) => {
    if (!data || !data.ed) return;
    const id = data.ed.id.toString();
    const doc = docCache.get(id) || { id };
    const ed = data.ed;

    doc.subject = ed.subject || doc.subject || '';
    doc.signNumber = ed.signNumber || doc.signNumber || '';
    doc.category = ed.category || doc.category || '';
    doc.author = ed.author || doc.author || '';
    doc.signer = ed.signer || doc.signer || '';
    doc.docDateStr = ed.docDateStr || doc.docDateStr || '';
    doc.priority = ed.priority ?? doc.priority ?? null;
    doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || '';
    doc.attachments = data.attachments || doc.attachments || [];
    doc.book = data.book || doc.book || null;

    docCache.set(id, doc);
    emit('docs-changed');
};

export const handleUnitsResponse = (data) => {
    if (!data || !data.elements) return;
    data.elements.forEach(unit => unitCache.set(unit.id, unit));
    appendLog(`API fbyvsphere: Cap nhat ${data.elements.length} don vi/ca nhan xu ly`);
};

// Bắt exeacode trực tiếp từ URL query string của request view.cpx.
export const captureExecAcodeFromUrl = (url) => {
    if (state.execAcode || !url) return;
    const match = url.match(/[?&]exeacode=([^&]+)/);
    if (match && match[1]) {
        state.execAcode = decodeURIComponent(match[1]);
        appendLog(`Da xac dinh ma dinh danh xu ly (exeacode) tu URL view.cpx: ${state.execAcode}`);
    }
};

export const ensureDocDetails = async (id) => {
    let doc = docCache.get(id.toString()) || { id: id.toString(), status: 'idle' };
    docCache.set(id.toString(), doc);

    if (!doc.attachments || doc.attachments.length === 0) {
        const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
        if (itemEl && !itemEl.classList.contains('selected')) {
            itemEl.click();
            await sleep(CONFIG.DELAY_MS.SELECT_DOC);
            doc = docCache.get(id.toString()) || doc;
        }
    }

    if ((!doc.attachments || doc.attachments.length === 0) && state.execAcode) {
        try {
            const bp = state.basePath || getFallbackBasePath();
            const resp = await fetch(`${bp}/document/edocs/view.cpx?exeacode=${state.execAcode}&id=${id}&responsibility=${doc.responsibility || 'main'}`);
            if (resp.ok) {
                handleViewResponse(await resp.json());
                doc = docCache.get(id.toString()) || doc;
            }
        } catch (e) {
            appendLog(`Fetch view.cpx cho ${id} loi: ${e.message}`);
        }
    } else if ((!doc.attachments || doc.attachments.length === 0) && !state.execAcode) {
        appendLog(`Chua xac dinh duoc exeacode xu ly - bo qua fetch thu cong cho VB ${id} (can mo it nhat 1 VB truoc de he thong tra ve receiverAcode).`);
    }

    return doc;
};

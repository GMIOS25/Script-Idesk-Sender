import { CONFIG, S } from '../config.js';
import { sleep, resolveDeadlineDate, findByVisibleText, getReceivedItemKind, isVisible, toStringArray } from '../utils/helpers.js';
import { appendLog } from '../utils/logger.js';
import { selectTreeItem } from './treeSelect.js';
import { docCache } from '../state.js';

const normalText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');

const select2Field = (id) => {
    const field = document.getElementById(id);
    const container = field?.previousElementSibling;
    if (!container?.classList.contains('select2-container')) throw new Error(`Không tìm thấy dropdown ${id}`);
    return container;
};

const selectedText = (container) => container.querySelector('.select2-chosen')?.textContent?.trim() || '';

const waitForActionButton = async (selector, label) => {
    let button;
    for (let i = 0; i < 10; i++) {
        button = document.querySelector(selector);
        if (isVisible(button) && !button.disabled) return button;
        await sleep(300);
    }
    throw new Error(`Nút ${label} chưa khả dụng`);
};

const visibleSelect2Drop = () => Array.from(document.querySelectorAll('.select2-drop'))
    .find(drop => isVisible(drop) && drop.querySelector('.select2-results'));

const select2Options = (drop) => Array.from(drop.querySelectorAll('li.select2-result-selectable'))
    .map(el => {
        const labelEl = el.querySelector('.select2-result-label');
        const code = labelEl?.querySelector('strong')?.textContent || '';
        const label = (labelEl?.textContent || '').replace(code, '').replace(/\s+/g, ' ').trim();
        return { el, label };
    }).filter(option => option.label);

const findCategoryOption = (options, category) => {
    const target = normalText(category);
    const exact = options.find(option => normalText(option.label) === target);
    if (exact) return exact;
    return options.filter(option => target.startsWith(`${normalText(option.label)} `))
        .sort((a, b) => b.label.length - a.label.length)[0] ||
        options.find(option => normalText(option.label).includes(target) && target.length >= 3);
};

const chooseSelect2 = async (container, target, fallback, categoryMatch = false) => {
    const choice = container.querySelector('.select2-choice');
    if (!choice) throw new Error('Không tìm thấy nút mở Select2');
    // Select2 v3 opens a single-choice dropdown on mousedown, not click.
    choice.dispatchEvent(new Event('mousedown', { bubbles: true, cancelable: true }));

    let drop;
    for (let i = 0; i < 10; i++) {
        drop = visibleSelect2Drop();
        if (drop && select2Options(drop).length) break;
        await sleep(150);
    }
    if (!drop) throw new Error(`Không mở được dropdown ${target}`);

    const search = drop.querySelector('input.select2-input');
    if (!search) throw new Error('Không tìm thấy ô tìm kiếm Select2');
    search.focus();
    search.click();

    const findOption = () => {
        const options = select2Options(drop);
        return categoryMatch ? findCategoryOption(options, target) :
            options.find(option => normalText(option.label) === normalText(target));
    };
    let option = findOption();
    if (!option) {
        search.value = target;
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.dispatchEvent(new Event('keyup', { bubbles: true }));
        for (let i = 0; i < 10 && !option; i++) {
            await sleep(150);
            option = findOption();
        }
    }
    if (!option && fallback) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.dispatchEvent(new Event('keyup', { bubbles: true }));
        for (let i = 0; i < 10 && !option; i++) {
            await sleep(150);
            option = select2Options(drop).find(candidate => normalText(candidate.label) === normalText(fallback));
        }
    }
    if (!option) throw new Error(`Không tìm thấy lựa chọn ${target}${fallback ? ` hoặc ${fallback}` : ''}`);

    // Its results handler selects the highlighted option on mouseup.
    option.el.dispatchEvent(new Event('mouseup', { bubbles: true, cancelable: true }));
    await sleep(150);
    if (normalText(selectedText(container)) !== normalText(option.label)) {
        throw new Error(`Dropdown chưa nhận giá trị ${option.label}`);
    }
    appendLog(`Đã chọn ${option.label}`);
};

export const prepareReceivingForm = async (category) => {
    const categoryField = select2Field('edocs-txt-category');
    const bookField = select2Field('edocs-txt-book');
    if (!selectedText(categoryField) || normalText(selectedText(categoryField)).startsWith('chọn loại')) {
        await chooseSelect2(categoryField, category, 'Công văn', true);
    }
    if (normalText(selectedText(bookField)) !== normalText('Sổ Văn bản đến')) {
        await chooseSelect2(bookField, 'Sổ Văn bản đến');
    }

    if (!selectedText(categoryField) || normalText(selectedText(categoryField)).startsWith('chọn loại') ||
        normalText(selectedText(bookField)) !== normalText('Sổ Văn bản đến')) {
        throw new Error('Loại văn bản hoặc Sổ văn bản đến chưa hợp lệ');
    }

    const saveBtn = document.querySelector(S.SAVE_TRANSFER_BTN);
    if (!saveBtn) throw new Error('Không tìm thấy nút Lưu và chuyển');
    for (let i = 0; i < 10 && (saveBtn.disabled || !isVisible(saveBtn)); i++) await sleep(300);
    if (saveBtn.disabled || !isVisible(saveBtn)) throw new Error('Nút Lưu và chuyển chưa khả dụng');
    return saveBtn;
};

export const autoFillAndSubmit = async (docId, aiData) => {
    const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
    if (!itemEl) throw new Error(`Khong tim thay VB ID ${docId}`);
    const kind = getReceivedItemKind(itemEl);

    if (!itemEl.classList.contains('selected')) {
        itemEl.click();
        await sleep(CONFIG.DELAY_MS.SELECT_DOC);
    }

    if (kind === 'update') {
        const acceptBtn = await waitForActionButton(S.ACCEPT_UPDATE_BTN, 'Đồng ý cập nhật');
        acceptBtn.click();
        appendLog('Đã click "Đồng ý cập nhật"');
        await sleep(CONFIG.DELAY_MS.AFTER_SUBMIT);
        return true;
    }

    if (kind === 'book') {
        const transferBtn = await waitForActionButton(S.TRANSFER_BTN, 'Chuyển xử lý');
        transferBtn.click();
        appendLog('Đã click "Chuyển xử lý"');
    } else {
        const saveBtn = await prepareReceivingForm(docCache.get(String(docId))?.category || '');
        saveBtn.click();
        appendLog('Da click "Lưu và chuyển"');
    }
    await sleep(CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER);

    let container;
    for (let i = 0; i < 10; i++) {
        const widget = document.querySelector(S.TRANSFER_WIDGET);
        container = isVisible(widget) ? widget.querySelector(S.TRANSFER_CONTAINER) : null;
        if (isVisible(container)) break;
        await sleep(300);
    }
    if (!isVisible(container)) {
        throw new Error('Không thấy form chuyển văn bản sau khi Lưu và chuyển');
    }

    const mainUnits = toStringArray(aiData.processing_unit);
    for (let i = 0; i < mainUnits.length; i++) {
        const mainUnit = mainUnits[i];
        appendLog(`Xu ly chinh: ${mainUnit}`);
        const ok = await selectTreeItem(S.RESPONSIBLE_LINK, S.RESPONSIBLE_WRAP, mainUnit);
        if (!ok) throw new Error(`Khong chon duoc don vi xu ly chinh "${mainUnit}" tren form`);
        // Cho widget render xong chip vừa chọn và đóng hẳn popup trước khi mở lần kế tiếp
        // (giống vòng lặp đơn vị phối hợp ở bên dưới, vốn đã chọn được nhiều đơn vị).
        if (i < mainUnits.length - 1) await sleep(600);
    }

    const subUnits = aiData.coordinating_units;
    if (subUnits && Array.isArray(subUnits)) {
        for (const unit of subUnits) {
            if (unit && unit.trim()) {
                const ok = await selectTreeItem(S.PARTICIPANTS_LINK, S.PARTICIPANTS_WRAP, unit.trim());
                if (!ok) throw new Error(`Khong chon duoc don vi phoi hop "${unit.trim()}" tren form`);
                await sleep(250);
            }
        }
    }

    // `monitoring_leader` theo docs/en/METADATA_SCHEMA.md (#10) la string | null - MOT
    // lanh dao duy nhat duoc chon lam nguoi theo doi (khac coordinating_units la mang
    // nhieu don vi phoi hop). Khac voi 2 truong tren, khoi field nay MAC DINH BI AN
    // tren form that (div[data-role="follow"], class "hide") - chi hien ra sau khi
    // bam lien ket S.FOLLOW_TOGGLE_BTN (xem resource/"Van thu role" vs resource/
    // "Chu tich role" trong right_panel_after_save_and_transfer.html: cung 1 element,
    // khac trang thai an/hien va chu link "Thêm người theo dõi" <-> "Ẩn người theo dõi").
    // CHI bam nut nay va dien khi AI thuc su tra ve gia tri (!= null/rong) - neu AI
    // khong co bang chung trong van ban, GIU NGUYEN trang thai an mac dinh cua form,
    // khong tu y bam mo.
    const monitoringLeader = aiData.monitoring_leader;
    if (monitoringLeader && monitoringLeader.trim()) {
        const followWrap = document.querySelector(S.FOLLOW_WRAP);
        const isFollowHidden = !isVisible(followWrap);
        if (isFollowHidden) {
            const followToggleBtn = document.querySelector(S.FOLLOW_TOGGLE_BTN);
            if (followToggleBtn) {
                followToggleBtn.click();
                await sleep(CONFIG.DELAY_MS.TOGGLE_FOLLOW);
            } else {
                appendLog('Khong tim thay nut "Ẩn/Thêm người theo dõi" (S.FOLLOW_TOGGLE_BTN)');
            }
        }
        appendLog(`Lanh dao theo doi: ${monitoringLeader}`);
        const ok = await selectTreeItem(S.FOLLOW_LINK, S.FOLLOW_WRAP, monitoringLeader.trim());
        if (!ok) throw new Error(`Khong chon duoc lanh dao theo doi "${monitoringLeader}" tren form`);
    }

    // `implementation_deadline` theo docs/en/METADATA_SCHEMA.md (#11) la string | null
    // (ISO date hoac cau tuong doi da chuan hoa), khong phai luon la so ngay. Ham
    // resolveDeadlineDate() xu ly ca 2 dang do, cong voi so nguyen de tuong thich
    // nguoc voi mock/BE cu.
    const deadlineInfo = resolveDeadlineDate(aiData.implementation_deadline);
    const deadlineWasRemoved = aiData.implementation_deadline === null;
    if (deadlineInfo.daysNum !== null) {
        const numInput = document.querySelector(S.DEADLINE_NUMBER);
        if (numInput) {
            numInput.value = deadlineInfo.daysNum;
            numInput.dispatchEvent(new Event('input', { bubbles: true }));
            numInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } else if (deadlineWasRemoved) {
        const numInput = document.querySelector(S.DEADLINE_NUMBER);
        if (numInput) {
            numInput.value = '';
            numInput.dispatchEvent(new Event('input', { bubbles: true }));
            numInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    if (deadlineInfo.dateStr) {
        const dateInput = document.querySelector(S.DEADLINE_INPUT);
        if (dateInput) {
            dateInput.value = deadlineInfo.dateStr;
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
            appendLog(`Han xu ly: ${deadlineInfo.dateStr}${deadlineInfo.daysNum !== null ? ` (+${deadlineInfo.daysNum} ngay)` : ' (tu chuoi AI tra ve)'}`);
        }
    } else if (deadlineWasRemoved) {
        const dateInput = document.querySelector(S.DEADLINE_INPUT);
        if (dateInput) {
            dateInput.value = '';
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
        }
    } else if (deadlineInfo.unparsed) {
        appendLog(`Khong tu dong xac dinh duoc han xu ly tu AI: "${deadlineInfo.raw}" — vui long nhap tay tren form`);
    }

    // `priority` KHONG nam trong 13 truong hop dong API (docs/en/METADATA_SCHEMA.md
    // muc 1). BE that dung schema `extra="forbid"` se khong bao gio tra field nay —
    // gia tri chi ton tai khi goi mock/BE thu nghiem cu. Giu lai o day nhu mot phan
    // mo rong tuy chon, KHONG coi day la nguon xac dinh do khan chinh thuc; neu can
    // tinh nang nay chinh thuc, phai bo sung `priority` vao METADATA_SCHEMA.md truoc.
    const prioritySelect = document.querySelector(S.PRIORITY_SELECT);
    if (prioritySelect) {
        let pVal = '0';
        const pRaw = aiData.priority;
        if (pRaw !== undefined && pRaw !== null) {
            if (pRaw === 1 || pRaw === '1') pVal = '1';
            else if (pRaw === 2 || pRaw === '2') pVal = '2';
            else pVal = String(pRaw);
        }
        prioritySelect.value = pVal;
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
        const pText = prioritySelect.options[prioritySelect.selectedIndex]?.text || pVal;
        appendLog(`Do khan: ${pText}`);
    }

    // Phần tóm tắt AI chỉ để đọc trên thẻ review (dashboard),
    // KHÔNG được đưa kèm vào trường nội dung khi chuyển văn bản đi. Vì vậy cố tình
    // bỏ qua S.CONTENT_TEXTAREA ở đây — không ghi aiData.summary vào form nữa.

    const agreeBtn = document.querySelector(S.AGREE_BTN) || findByVisibleText(container, 'button, a', ['Đồng ý', 'Dong y']);
    if (!agreeBtn) throw new Error('Khong tim thay nut "Dong y"!');
    if (agreeBtn.disabled) {
        for (let i = 0; i < 5; i++) {
            await sleep(500);
            if (!agreeBtn.disabled) break;
        }
    }
    if (agreeBtn.disabled) throw new Error('Nút Đồng ý chưa khả dụng');
    agreeBtn.click();
    appendLog('Da click "Dong y"');
    await sleep(CONFIG.DELAY_MS.AFTER_SUBMIT);

    return true;
};

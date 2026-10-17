import { CONFIG } from '../config.js';
import { sleep, isVisible } from '../utils/helpers.js';
import { appendLog } from '../utils/logger.js';
import { findBestUnitMatch } from '../utils/unitMatch.js';

const POPUP_SELECTORS = [
    '.popover:not(.hide):not([style*="display: none"])',
    '.modal:not(.hide):not([style*="display: none"])',
    '.ui-dialog:not([style*="display: none"])',
    '.select2-drop:not([style*="display: none"])',
    'div[role="dialog"]:not([style*="display: none"])'
];

const findVisiblePopup = (root) => POPUP_SELECTORS
    .flatMap(selector => Array.from(root.querySelectorAll(selector)))
    .find(isVisible);

export const selectTreeItem = async (linkSelector, wrapSelector, targetName) => {
    if (!targetName || !targetName.trim()) return false;
    const wrap = document.querySelector(wrapSelector);
    const link = document.querySelector(linkSelector);
    if (!isVisible(link)) return false;

    link.click();
    await sleep(CONFIG.DELAY_MS.OPEN_TREE);

    const popup = (wrap && findVisiblePopup(wrap)) || findVisiblePopup(document);
    if (!popup) {
        document.body.click();
        await sleep(200);
        return false;
    }

    // Bam "Mo rong tat ca" TRUOC khi tim/quet — mac dinh khi popover vua mo,
    // nhieu nhanh cua cay CHUA duoc mo rong (co nut rieng bien cho viec nay,
    // xem <button id="${wrapSelector}-expand-all" title="Mo rong tat ca">
    // trong resource/"Chu tich role"/right_panel_after_save_and_transfer.html).
    // Neu bo qua buoc nay, node muc tieu co the dang nam trong 1 nhanh dang
    // thu gon (offsetParent === null) va se bi dieu kien loc offsetParent ben
    // duoi loai bo, dan den "Khong chon duoc" du textContent da khop dinh
    // dang "Vai tro (Ho ten)" dung nhu tren giao dien.
    const expandAllBtn = document.querySelector(`${wrapSelector}-expand-all`);
    if (expandAllBtn) {
        expandAllBtn.click();
        await sleep(CONFIG.DELAY_MS.EXPAND_TREE);
    }

    const searchInput = popup.querySelector('input[type="text"]');
    if (searchInput) {
        searchInput.value = targetName;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.TREE_SEARCH);
    }

    // Chi query dung the <a class="user-box-group-item"> — day la phan tu
    // THAT SU co the click de chon 1 don vi/nguoi trong cay (xem cau truc that
    // trong resource/"Chu tich role"/right_panel_after_save_and_transfer.html).
    // KHONG duoc query them 'li'/'div'/'span'/'label' nhu truoc: <li> cha luon
    // dung TRUOC <a> con cua no trong document order, va vi textContent cua
    // <li> bao gom ca text cua <a> ben trong (voi node la) nen se bi khop
    // (includes) va click NHAM vao <li> truoc khi kip toi <a> — click vao <li>
    // khong kich hoat duoc handler chon (chi gan tren chinh <a>), khien code
    // tuong da "chon" thanh cong (khong loi) nhung thuc te khong co gi duoc
    // chon tren form that.
    const candidates = Array.from(popup.querySelectorAll('a.user-box-group-item'))
        // Loai node dac biet "Chon tat ca" (co class phu
        // "user-box-group-item-all" tren div ten ben trong) de tranh khop
        // nham neu targetName qua ngan/chung chung.
        .filter(el => !el.querySelector('.user-box-group-item-all'))
        .filter(isVisible);

    let clicked = false;

    const tryClick = (el) => {
        const cb = el.querySelector('input[type="checkbox"], input[type="radio"]');
        if (cb) { cb.click(); return true; }
        el.click();
        return true;
    };

    // Lay dung PHAN TEN HIEN THI tren UI (vd "Phong Kinh te - Xa Vinh Thanh -
    // Tinh Gia Lai", "Hieu truong (Dinh Van Ngo)") de doi chieu — KHONG dung
    // thang el.textContent cua ca the <a>: ben trong con 1 <div class="hide">
    // chua "chi muc tim kiem" noi (ten + ban khong dau) dung TRUOC phan ten
    // hien thi (xem cau truc that trong resource/"Chu tich role"/
    // right_panel_after_save_and_transfer.html, node id="286" - "Phong Kinh
    // te..."). Lay lan ca doan nay vao lam co so so khop se khien khop CHINH
    // XAC gan nhu khong bao gio thanh cong, va con lam includes() kem tin cay
    // hon can thiet. .user-box-group-item-name la noi CHI chua dung phan ten
    // nguoi dung thay tren man hinh, dung cho ca loai "dept"/"unit" (ten don
    // vi) lan loai "alias" (chuoi "Vai tro (Ho ten)" — luu y attribute title
    // cua node alias CHI co Vai tro, khong co Ho ten, nen phai doc textContent
    // chu khong doc title).
    const displayTextOf = (el) => {
        const nameEl = el.querySelector('.user-box-group-item-name');
        const raw = (nameEl ? nameEl.textContent : el.textContent) || '';
        return raw.replace(/\s+/g, ' ').trim();
    };

    // YEU CAU NGHIEP VU: don vi/nguoi tren he thong that thuong co them hau to
    // (ten xa/phuong, "UBND xa ...") ma AI backend khong the biet truoc va se
    // KHONG BAO GIO tra ve dung 100% nhu vay (vd AI tra "Phong kinh te" nhung
    // DOM that la "Phong Kinh te - Xa Vinh Thanh - Tinh Gia Lai"). Vi vay tieu
    // chi chon KHONG con bat buoc khop 100% (exact) nhu code cu nua.
    const candidateLabels = candidates.map(el => ({ el, label: displayTextOf(el) }));

    // Thuat toan khop (chuan hoa hoa/thuong, uu tien startsWith roi fallback
    // includes, chon label ngan nhat khi co nhieu ung vien cung thoa) dat
    // chung trong ../utils/unitMatch.js de ui/unitPicker.js dung lai Y HET cho
    // phan goi y luc review (truoc khi bam "Duyet"), dam bao gia tri goi y va
    // gia tri thuc su duoc chon luc fill KHONG bao gio lech nhau. Xem
    // unitMatch.js de biet chi tiet ly do uu tien startsWith hon includes.
    const best = findBestUnitMatch(candidateLabels, targetName);

    if (best) {
        tryClick(best.el);
        clicked = true;
    }

    if (clicked) appendLog(`Da chon "${targetName}"`);
    else appendLog(`Khong chon duoc "${targetName}" trong popup`);

    const closeBtn = popup.querySelector('button.close, .close, [data-dismiss="modal"]');
    if (closeBtn) closeBtn.click();
    else document.body.click();
    await sleep(CONFIG.DELAY_MS.CLOSE_TREE);

    return clicked;
};

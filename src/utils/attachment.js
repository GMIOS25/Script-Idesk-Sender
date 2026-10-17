import { appendLog } from './logger.js';
import { state } from '../state.js';
import { getFallbackBasePath } from './helpers.js';

// Cac tu khoa trong ten file cho biet day la ban da ky/da dong dau chinh thuc
const SEALED_KEYWORDS = ['dadongdau', 'daky'];

const normalizeText = (str) =>
    (str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bo dau tieng Viet
        .toLowerCase()
        .replace(/[\s\-_]/g, '');

// Trich so hieu van ban theo pattern ro rang (CV-<so>, So <so>...) thay vi
// lay bua chuoi so dau tien gap trong chuoi. Chuan hoa bo so 0 dau de so
// sanh linh hoat ("339" === "0339").
const extractDocNumber = (str) => {
    if (!str) return null;
    const s = String(str).trim();

    // 1) Số hiệu văn bản dạng "NNN/CODE" (vd "185/TB-KT", "339/QĐ-UBND"):
    //    số đứng đầu trước dấu "/".
    const slash = s.match(/^(\d{1,7})\s*\/[A-Za-zÀ-ỹ]/);
    if (slash) return parseInt(slash[1], 10).toString();

    // 2) Dạng "CV-NNN" / "Số NNN".
    const cv = s.match(/CV[-_\s]?0*(\d+)/i) || s.match(/S[ôoố][^\d]{0,3}0*(\d+)/i);
    if (cv) return parseInt(cv[1], 10).toString();

    // 3) Số đầu tiên không phải cụm 8 chữ số (cụm 8 chữ số gần như chắc chắn là
    //    ngày tháng yyyymmdd/ddmmyyyy trong tên file, không phải số hiệu văn bản).
    const nums = [...s.matchAll(/\d+/g)].map(m => m[0]);
    for (const n of nums) {
        if (n.length !== 8) return parseInt(n, 10).toString();
    }

    // 4) Chỉ còn toàn cụm 8 chữ số: lấy cụm đầu.
    return nums.length ? parseInt(nums[0], 10).toString() : null;
};

const isPdf = (att) => att.format === 'pdf' || (att.name || '').toLowerCase().endsWith('.pdf');
const isSigned = (att) => att.signed === 'Y';

// Registered outgoing rows need a positive number match, not the generic
// single-file/largest-file fallback used for already transferred documents.
export const getNumberMatchedAttachments = (doc) => {
    const number = extractDocNumber(doc.signNumber);
    return number ? (doc.attachments || []).filter(att => {
        const name = String(att.name || '').trim();
        const prefix = name.match(/^(?:(?:CV|Số|So)[\s_:-]*)?(\d{1,7})(?=[\s._/-]|$)/i);
        // Date-prefixed drafts and explicitly named appendices are not main files.
        const date = /^\d{1,4}([._-])\d{1,2}\1\d{1,4}(?=\D|$)/.test(name);
        const appendix = normalizeText(name).includes('phuluc') || /(?:^|[\s_.-])pl(?:[\s_.-]|$)/i.test(name);
        return att.contentUid && prefix && !date && !appendix &&
            parseInt(prefix[1], 10).toString() === number;
    }) : [];
};

export const getAttachmentPreviewUrl = (attachment) => {
    if (!attachment?.contentUid) return '';
    const basePath = state.basePath || getFallbackBasePath();
    return `${window.location.origin}${basePath}/docx/download.cpx?docID=${encodeURIComponent(attachment.contentUid)}&view=pdf&t=${Date.now()}`;
};

export const selectAttachment = (doc, silent = false) => {
    const attachments = doc.attachments || [];
    if (attachments.length === 0) return null;

    // Buoc 1: chi xet file PDF + da ky lam ung vien "file chinh". Noi dan
    // dieu kien neu nhom rong - file .doc/.docx chi duoc chon khi khong
    // con lua chon nao khac. Dieu nay tranh viec mot ban thao chua ky bi
    // chon nham chi vi trung so trong ten file.
    let candidates = attachments.filter(att => isPdf(att) && isSigned(att));
    let stage = 'pdf+signed';
    if (candidates.length === 0) { candidates = attachments.filter(isSigned); stage = 'signed'; }
    if (candidates.length === 0) { candidates = attachments.filter(isPdf); stage = 'pdf'; }
    if (candidates.length === 0) { candidates = attachments; stage = 'all'; }

    if (candidates.length === 1) {
        if (!silent) appendLog(`Chi co 1 ung vien hop le (${stage}): ${candidates[0].name}`);
        return candidates[0];
    }

    // Buoc 2: uu tien file co dau hieu da dong dau trong ten - day la ban
    // phat hanh cuoi cung, co gia tri phap ly cao nhat.
    const sealedMatch = candidates.find(att =>
        SEALED_KEYWORDS.some(kw => normalizeText(att.name).includes(kw))
    );
    if (sealedMatch) {
        if (!silent) appendLog(`Match file dinh kem theo tu khoa da dong dau: ${sealedMatch.name}`);
        return sealedMatch;
    }

    // Buoc 3: match theo so hieu van ban (signNumber), da chuan hoa so 0 dau
    const signDigits = extractDocNumber(doc.signNumber || '');
    if (signDigits) {
        const matchedByNum = candidates.find(att => extractDocNumber(att.name) === signDigits);
        if (matchedByNum) {
            if (!silent) appendLog(`Match file dinh kem theo so hieu "${signDigits}": ${matchedByNum.name}`);
            return matchedByNum;
        }
    }

    // Buoc 4: fallback - file co kich thuoc lon nhat trong nhom ung vien
    // (ban da dong dau/scan thuong nang hon ban thao do co anh chu ky/con dau)
    const bySize = [...candidates].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    const fallback = bySize || candidates[0];
    if (!silent) appendLog(`Fallback chon file lon nhat trong nhom hop le (${stage}): ${fallback ? fallback.name : 'N/A'}`);
    return fallback;
};

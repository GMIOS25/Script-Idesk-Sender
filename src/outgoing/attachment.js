const SEALED_KEYWORDS = ['dadongdau', 'daky'];

export const normalizeText = (str) =>
    (str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\s\-_]/g, '');

export const extractDocNumber = (str) => {
    if (!str) return null;
    const s = String(str).trim();

    const slash = s.match(/^(\d{1,7})\s*\/[A-Za-zÀ-ỹ]/);
    if (slash) return parseInt(slash[1], 10).toString();

    const cv = s.match(/CV[-_\s]?0*(\d+)/i) || s.match(/S[ôoố][^\d]{0,3}0*(\d+)/i);
    if (cv) return parseInt(cv[1], 10).toString();

    const nums = [...s.matchAll(/\d+/g)].map(m => m[0]);
    for (const n of nums) {
        if (n.length !== 8) return parseInt(n, 10).toString();
    }

    return nums.length ? parseInt(nums[0], 10).toString() : null;
};

export const isPdf = (att) => att.format === 'pdf' || (att.name || '').toLowerCase().endsWith('.pdf');
export const isSigned = (att) => att.signed === 'Y';

export const getNumberMatchedAttachments = (doc) => {
    const number = extractDocNumber(doc.signNumber);
    return number ? (doc.attachments || []).filter(att => {
        const name = String(att.name || '').trim();
        const prefix = name.match(/^(?:(?:CV|Số|So)[\s_:-]*)?(\d{1,7})(?=[\s._/-]|$)/i);
        const date = /^\d{1,4}([._-])\d{1,2}\1\d{1,4}(?=\D|$)/.test(name);
        const appendix = normalizeText(name).includes('phuluc') || /(?:^|[\s_.-])pl(?:[\s_.-]|$)/i.test(name);
        return att.contentUid && prefix && !date && !appendix &&
            parseInt(prefix[1], 10).toString() === number;
    }) : [];
};

export const selectAttachment = (doc, silent = true) => {
    const attachments = doc.attachments || [];
    if (attachments.length === 0) return null;

    let candidates = attachments.filter(att => isPdf(att) && isSigned(att));
    if (candidates.length === 0) { candidates = attachments.filter(isSigned); }
    if (candidates.length === 0) { candidates = attachments.filter(isPdf); }
    if (candidates.length === 0) { candidates = attachments; }

    if (candidates.length === 1) {
        return candidates[0];
    }

    const sealedMatch = candidates.find(att =>
        SEALED_KEYWORDS.some(kw => normalizeText(att.name).includes(kw))
    );
    if (sealedMatch) {
        return sealedMatch;
    }

    const signDigits = extractDocNumber(doc.signNumber || '');
    if (signDigits) {
        const matchedByNum = candidates.find(att => extractDocNumber(att.name) === signDigits);
        if (matchedByNum) {
            return matchedByNum;
        }
    }

    const bySize = [...candidates].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    return bySize || candidates[0];
};

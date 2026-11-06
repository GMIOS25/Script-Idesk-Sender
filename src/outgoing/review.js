const fieldsBySphere = {
    internal: ['responsible', 'save', 'participants', 'follow'],
    int_province_comm: ['inside_unit'],
    ext_province_comm: ['outside_unit']
};

export const recipientFields = recipient => fieldsBySphere[recipient.sphere] || [];

const validateIdentity = recipient => {
    const internalTypes = ['INTERNAL_PERSON', 'INTERNAL_DEPT', 'INTERNAL_GROUP', 'INTERNAL_UNIT'];
    const expected = internalTypes.includes(recipient.recipient_type) ? 'internal'
        : recipient.recipient_type === 'INT_PROVINCE_UNIT' ? 'int_province_comm'
            : recipient.recipient_type === 'EXT_PROVINCE_UNIT' ? 'ext_province_comm' : '';
    const needsCode = recipient.recipient_type === 'INTERNAL_PERSON' || expected !== 'internal';
    if (!recipient.recipient_id || !recipient.source_id || !expected || recipient.sphere !== expected || (needsCode && !recipient.code)) {
        throw new Error('Định danh người nhận hoặc phạm vi không hợp lệ.');
    }
};

const initialFields = recipient => recipient.sphere === 'internal' ? [] : recipientFields(recipient);

export const createReview = result => {
    if (result.schema_version !== 'outgoing.v1') throw new Error('Kết quả không đúng outgoing.v1.');
    const recipients = new Map();
    for (const recipient of [...(result.people || []), ...(result.units || [])]) {
        validateIdentity(recipient);
        recipients.set(recipient.recipient_id, recipient);
    }
    const assignments = Object.fromEntries([...recipients.values()].map(r => [r.recipient_id, initialFields(r)]));
    for (const { recipient_id: id, field } of result.field_suggestions || []) {
        if (!recipients.has(id) || !recipientFields(recipients.get(id)).includes(field)) {
            throw new Error('Đề xuất trường người nhận không khớp định danh.');
        }
        assignments[id] = [...new Set([...assignments[id], field])];
    }
    return {
        result, recipients, explicitRecipients: new Set(recipients.keys()),
        assignments,
        decisions: new Map(), edits: []
    };
};

export const setRecipient = (review, recipient, included, { mentionId } = {}) => {
    validateIdentity(recipient);
    if (included) {
        if (!mentionId) review.explicitRecipients.add(recipient.recipient_id);
        if (review.recipients.has(recipient.recipient_id)) return;
        review.recipients.set(recipient.recipient_id, recipient);
        review.assignments[recipient.recipient_id] = initialFields(recipient);
    } else {
        review.recipients.delete(recipient.recipient_id);
        review.explicitRecipients.delete(recipient.recipient_id);
        delete review.assignments[recipient.recipient_id];
    }
    review.edits.push({ action: included ? 'add' : 'remove', recipient_id: recipient.recipient_id });
};

export const assignRecipient = (review, id, fields) => {
    const recipient = review.recipients.get(id);
    if (!recipient) throw new Error('Người nhận không còn trong danh sách đã chọn.');
    const values = [...new Set(fields)];
    if (values.some(field => !recipientFields(recipient).includes(field))) {
        throw new Error('Trường người nhận không phù hợp với phạm vi định danh.');
    }
    review.assignments[id] = values;
    review.edits.push({ action: 'assign', recipient_id: id, fields: values });
};

export const setDecision = (review, decision) => {
    const previous = review.decisions.get(decision.mention_id);
    review.decisions.set(decision.mention_id, {
        mention_id: decision.mention_id, action: decision.action,
        note: String(decision.note || '').trim(), recipient_ids: [...new Set(decision.recipient_ids || [])]
    });
    // A candidate picked solely for this mention must leave the final list
    // when that choice is replaced. Keep deliberate additions and shared IDs.
    for (const id of previous?.recipient_ids || []) {
        const stillReferenced = [...review.decisions.values()].some(item => item.action === 'resolve' && item.recipient_ids.includes(id));
        if (!stillReferenced && !review.explicitRecipients.has(id) && review.recipients.has(id)) {
            setRecipient(review, review.recipients.get(id), false);
        }
    }
};

export const setDecisionRecipient = (review, mentionId, recipient, included) => {
    const previous = review.decisions.get(mentionId);
    const ids = new Set(previous?.action === 'resolve' ? previous.recipient_ids : []);
    if (included) {
        setRecipient(review, recipient, true, { mentionId });
        ids.add(recipient.recipient_id);
    } else ids.delete(recipient.recipient_id);
    setDecision(review, {
        mention_id: mentionId, action: ids.size ? 'resolve' : '', recipient_ids: [...ids],
        note: previous?.action === 'resolve' ? previous.note : ''
    });
};

export const reviewProblems = review => {
    const problems = [];
    if (review.result.audit?.publication?.missing?.length) problems.push('Chưa xác minh đủ đích theo quy trình phát hành. Đồng bộ danh bạ rồi đối chiếu lại.');
    for (const { recipient_id: id, field } of review.result.field_suggestions || []) {
        if (!review.recipients.has(id) || !review.assignments[id]?.includes(field)) {
            problems.push('Cần giữ người nhận và trường theo quy trình phát hành đã chọn.');
        }
    }
    if (!review.recipients.size) problems.push('Chưa có người nhận trong danh sách cuối.');
    for (const recipient of review.recipients.values()) {
        const fields = review.assignments[recipient.recipient_id] || [];
        if (!fields.length) problems.push(`Chọn trường cho ${recipient.display_name || recipient.name}.`);
        if (fields.some(field => !recipientFields(recipient).includes(field))) problems.push(`Sai phạm vi của ${recipient.name}.`);
    }
    for (const item of review.result.unresolved || []) {
        const decision = review.decisions.get(item.mention_id);
        const resolved = decision?.action === 'resolve' && decision.recipient_ids.length > 0
            && decision.recipient_ids.every(id => review.recipients.has(id));
        const omitted = ['exclude', 'accept_missing'].includes(decision?.action)
            && !!decision.note && decision.recipient_ids.length === 0;
        if (!resolved && !omitted) problems.push(`Cần rà soát ${item.mention_id}: ${item.raw}.`);
    }
    return problems;
};

export const buildFeedback = (review, { confirmed = true } = {}) => {
    const problems = reviewProblems(review);
    if (confirmed && problems.length) throw new Error(`Chưa hoàn tất rà soát: ${problems.join(' ')}`);
    const finalRecipients = [...review.recipients.values()].map(recipient => {
        validateIdentity(recipient);
        return { recipient_id: recipient.recipient_id, recipient_type: recipient.recipient_type, sphere: recipient.sphere, code: recipient.code };
    });
    return {
        registry_version: review.result.registry_version,
        alias_policy_version: review.result.alias_policy_version,
        final_recipients: finalRecipients,
        field_assignments: [...review.recipients.values()].flatMap(recipient =>
            (review.assignments[recipient.recipient_id] || []).map(field => ({ recipient_id: recipient.recipient_id, field }))),
        review_decisions: [...review.decisions.values()], edits: review.edits, confirmed
    };
};

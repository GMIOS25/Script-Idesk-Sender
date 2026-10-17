import { reviewProblems, recipientFields } from './review.js';
import { getNumberMatchedAttachments } from '../utils/attachment.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const e = escapeHtml;
const FIELD_LABELS = { responsible: 'Xử lý văn bản đi', save: 'Chuyển để biết', participants: 'Phối hợp xử lý', follow: 'Theo dõi', inside_unit: 'Trong tỉnh', outside_unit: 'Ngoài tỉnh' };
const REASONS = { extraction_partial: 'Chưa đọc đầy đủ tài liệu', extraction_failed: 'Chưa đọc được tài liệu', provider_unavailable: 'Model phân tích chưa khả dụng', ambiguous: 'Có nhiều định danh phù hợp', no_match: 'Chưa tìm thấy trong danh bạ', unverified_alias: 'Tên viết tắt chưa được xác minh' };
export const reasonLabel = reason => REASONS[reason] || reason;
const displayName = recipient => recipient.display_name || recipient.name || recipient.recipient_id;
const sphereLabel = sphere => ({ internal: 'Nội bộ', int_province_comm: 'Trong tỉnh', ext_province_comm: 'Ngoài tỉnh' })[sphere] || sphere;
const evidence = items => (items || []).map(item => `<blockquote><small>Trang ${e(item.page)}</small><br>${e(item.raw)}</blockquote>`).join('');

export const renderRecipientPanel = session => {
    const review = session?.review;
    const recipients = review ? [...review.recipients.values()] : [];
    if (!review) return `<div class="sender-empty" role="status">${session?.processing ? 'Đang suy luận người và đơn vị nhận…' : session ? 'Phân tích văn bản để xem người nhận được suy luận và tra cứu danh bạ.' : 'Chọn và phân tích một văn bản để bắt đầu.'}</div>`;
    const rows = recipients.map(recipient => {
        const fields = review.assignments[recipient.recipient_id] || [];
        return `<article class="sender-recipient"><div class="sender-recipient-identity"><strong>${e(displayName(recipient))}</strong><small>${e(sphereLabel(recipient.sphere))}${recipient.code ? ` · ${e(recipient.code)}` : ''}</small></div><button type="button" class="sender-remove" data-action="remove-recipient" data-recipient-id="${e(recipient.recipient_id)}" aria-label="Bỏ ${e(displayName(recipient))}">Bỏ</button><fieldset class="sender-assignments"><legend class="sender-sr-only">Trường sẽ điền cho ${e(displayName(recipient))}</legend>${recipientFields(recipient).map(field => `<label><input type="checkbox" data-assignment="${e(field)}" data-recipient-id="${e(recipient.recipient_id)}" ${fields.includes(field) ? 'checked' : ''}> ${e(FIELD_LABELS[field])}</label>`).join('')}</fieldset></article>`;
    }).join('');
    const results = session.searchResults;
    const searchResults = results ? `<p class="sender-search-status" role="status">${results.length ? `${results.length} kết quả trong danh bạ` : 'Không tìm thấy. Thử tên đầy đủ, chức danh hoặc mã đơn vị.'}</p><div class="sender-search-matches" tabindex="0" aria-label="Kết quả tra cứu danh bạ">${results.map(item => `<div class="sender-search-match"><div><strong>${e(displayName(item))}</strong><small>${e(sphereLabel(item.sphere))}${item.code ? ` · ${e(item.code)}` : ''}</small></div>${review.recipients.has(item.recipient_id) ? '<span class="sender-added">Đã thêm</span>' : `<button type="button" data-action="search-add" data-recipient-id="${e(item.recipient_id)}" aria-label="Thêm ${e(displayName(item))}">Thêm</button>`}</div>`).join('')}</div>` : '';
    return `<section class="sender-directory" aria-label="Tra cứu danh bạ"><form data-form="recipient-search" class="sender-search" aria-busy="${Boolean(session.searching)}"><label for="sender-recipient-query" class="sender-sr-only">Tên, chức danh hoặc mã đơn vị</label><div class="sender-search-controls"><input id="sender-recipient-query" type="search" name="query" minlength="1" maxlength="256" placeholder="Tên, chức danh hoặc mã đơn vị" value="${e(session.searchQuery || '')}" required><button type="submit" class="sender-primary">${session.searching ? 'Đang tìm…' : 'Tra cứu'}</button></div></form>${session.searchError ? `<p class="sender-warning" role="alert">${e(session.searchError)}</p>` : ''}${searchResults}</section>
        <section class="sender-chosen"><div class="sender-chosen-heading"><h2 id="sender-chosen-title">Danh sách người nhận <span class="sender-badge">${recipients.length}</span></h2></div><div class="sender-recipient-list" tabindex="0" aria-labelledby="sender-chosen-title">${rows || '<div class="sender-empty">Chưa có người nhận.<br>Tra cứu danh bạ phía trên để bổ sung.</div>'}</div></section>`;
};

export const renderDocumentList = (documents, selectedId, sessions) => {
    const docs = [...documents.values()].filter(doc => doc.eligible).sort((a, b) => (a.page - b.page) || (a.pageIndex - b.pageIndex));
    if (!docs.length) return '<div class="sender-empty">Chưa có văn bản đủ điều kiện.<br>Quét danh sách để chọn văn bản <strong>Đã chuyển nội bộ</strong> hoặc <strong>Đã vào sổ</strong> có tài liệu chính khớp số văn bản.</div>';
    return docs.map(doc => {
        const session = sessions.get(doc.id);
        const status = session?.processing ? 'Đang phân tích…' : session?.review ? (session.reviewed ? 'Đã rà soát' : 'Cần rà soát') : session?.error ? 'Có lỗi' : 'Chưa phân tích';
        return `<article class="sender-doc ${selectedId === doc.id ? 'is-selected' : ''}"><button type="button" class="sender-doc-select" data-action="select" data-id="${e(doc.id)}"><strong>${e(doc.signNumber || 'Chưa có số/ký hiệu')}</strong><span>${e(doc.subject || 'Chưa có trích yếu')}</span></button><div class="sender-doc-meta"><span>${e(status)}</span><button type="button" data-action="analyze" data-id="${e(doc.id)}" ${session?.processing ? 'disabled' : ''}>Phân tích</button></div></article>`;
    }).join('');
};

const metadataHtml = session => {
    const doc = session.doc;
    const attachments = doc.selectionMarker === 'book' ? getNumberMatchedAttachments(doc) : (doc.attachments || []);
    return `<h2>${e(doc.signNumber || 'Văn bản đi')}</h2><p class="sender-subject">${e(doc.subject)}</p><div class="sender-meta"><span>ID ${e(doc.id)}</span><span>${doc.selectionMarker === 'book' ? 'Đã vào sổ' : 'Đã chuyển nội bộ'}</span>${Number(doc.externalTransfer) > 0 ? '<span>Đã gửi liên thông</span>' : ''}</div>
        <label class="sender-label">Tài liệu chính<select data-setting="attachment">${attachments.map(item => `<option value="${e(item.contentUid)}" ${item.contentUid === session.attachment?.contentUid ? 'selected' : ''}>${e(item.name)}${item.signed === 'Y' ? ' · Đã ký' : ''}</option>`).join('') || '<option value="">Không có tài liệu chính phù hợp</option>'}</select></label>
        ${session.previewUrl ? `<a href="${e(session.previewUrl)}" target="_blank" rel="noopener">Mở PDF để đối chiếu</a>` : ''}`;
};

export const renderReview = session => {
    if (!session) return '<div class="sender-empty">Chọn một văn bản để xem tài liệu và kết quả phân tích.</div>';
    const meta = metadataHtml(session);
    if (session.processing) return `${meta}<p role="status">Đang phân tích tài liệu. ${e(session.progress || '')}</p>`;
    if (!session.review) return `${meta}${session.error ? `<p class="sender-warning" role="alert">${e(session.error)}</p>` : ''}<p>Gửi tài liệu chính đến backend để xác định người và đơn vị nhận.</p><button type="button" class="sender-primary" data-action="analyze" data-id="${e(session.doc.id)}" ${!session.attachment ? 'disabled' : ''}>Phân tích văn bản này</button>`;
    const review = session.review;
    const result = review.result;
    const problems = reviewProblems(review);
    const final = [...review.recipients.values()];
    const unresolved = (result.unresolved || []).map(item => {
        const decision = review.decisions.get(item.mention_id);
        return `<div class="sender-review-item"><div class="sender-review-heading"><strong>${e(item.raw)}</strong><button type="button" data-action="lookup-mention" data-query="${e(item.raw)}">Tra danh bạ</button></div><p>${e(reasonLabel(item.reason))}</p>${evidence(item.evidence)}<div class="sender-candidates">${(item.candidates || []).map(candidate => `<button type="button" data-action="candidate" data-mention-id="${e(item.mention_id)}" data-recipient-id="${e(candidate.recipient_id)}">Chọn ${e(displayName(candidate))}</button>`).join('')}</div><label class="sender-label">Quyết định<select data-decision-action="${e(item.mention_id)}">${[['', 'Chưa rà soát'], ['resolve', 'Đã chọn định danh'], ['exclude', 'Loại khỏi nơi nhận'], ['accept_missing', 'Chấp nhận thiếu người nhận']].map(([value, label]) => `<option value="${value}" ${decision?.action === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="sender-label">Định danh đã chọn (có thể chọn nhiều)<select multiple size="3" data-decision-recipients="${e(item.mention_id)}">${final.map(recipient => `<option value="${e(recipient.recipient_id)}" ${decision?.recipient_ids.includes(recipient.recipient_id) ? 'selected' : ''}>${e(displayName(recipient))}</option>`).join('')}</select></label><label class="sender-label">Ghi chú rà soát<textarea rows="2" data-decision-note="${e(item.mention_id)}">${e(decision?.note || '')}</textarea></label></div>`;
    }).join('');
    const reasons = [...new Set(result.review_reasons || [])];
    if (result.extraction_status !== 'complete' && !reasons.includes(`extraction_${result.extraction_status}`)) reasons.push(`extraction_${result.extraction_status}`);
    const reasonRows = reasons.map(reason => `<label class="sender-label sender-warning">${e(reasonLabel(reason))}<textarea rows="2" data-global-reason="${e(reason)}" placeholder="Ghi rõ kết quả đối chiếu PDF và cách xử lý cảnh báo">${e(review.decisions.get(`reason:${reason}`)?.note || '')}</textarea></label>`).join('');
    const audit = (result.mentions || []).map(mention => `<div><strong>${e(mention.raw)}</strong>${evidence(mention.evidence)}</div>`).join('')
        + (result.excluded || []).map(item => `<div><strong>Đã loại: ${e(item.raw)}</strong><p>${e(reasonLabel(item.reason))}</p>${evidence(item.evidence)}</div>`).join('');
    return `${meta}<div class="sender-result-summary"><strong>${result.needs_review || problems.length ? 'Cần rà soát' : 'Đã phân tích'}</strong><span>${final.length} người/đơn vị · ${e(result.extraction_status === 'complete' ? 'Đã đọc đầy đủ' : 'Chưa đọc đầy đủ')}</span></div>
        ${unresolved ? `<h3>Các mục cần quyết định</h3>${unresolved}` : ''}${reasonRows ? `<h3>Cảnh báo cần đối chiếu</h3>${reasonRows}` : ''}
        <details><summary>Bằng chứng và các mục đã loại</summary>${audit || '<p>Chưa có bằng chứng trích xuất.</p>'}<small>Danh bạ ${e(result.registry_version.slice(0, 12))} · Chính sách ${e(result.alias_policy_version.slice(0, 12))}</small></details>
        ${problems.length ? `<div class="sender-warning">${problems.length} mục cần hoàn tất trước khi điền.</div>` : ''}
        <label class="sender-check"><input type="checkbox" data-setting="reviewed" ${session.reviewed ? 'checked' : ''}> Tôi đã đối chiếu PDF, người nhận và các trường sẽ điền.</label>
        <label class="sender-check"><input type="checkbox" data-setting="replace" ${session.replaceExisting ? 'checked' : ''}> Thay thế người nhận sẵn có ở các trường được điền.</label>
        <div class="sender-actions"><button type="button" class="sender-primary" data-action="apply" ${!session.reviewed || problems.length ? 'disabled' : ''}>Điền vào iDesk</button><button type="button" data-action="feedback" ${!session.reviewed || problems.length ? 'disabled' : ''}>Lưu kết quả rà soát</button><button type="button" data-action="analyze" data-id="${e(session.doc.id)}">Phân tích lại</button></div>
        ${session.feedbackId ? '<p class="sender-success">Đã lưu kết quả rà soát trên backend.</p>' : ''}${session.applied ? `<p class="sender-success">Đã điền ${session.applied.length} lựa chọn. Kiểm tra form iDesk rồi bấm Đồng ý để gửi.</p>${session.existingSummary ? `<p>${e(session.existingSummary)}</p>` : ''}` : ''}${session.error ? `<p class="sender-warning" role="alert">${e(session.error)}</p>` : ''}`;
};

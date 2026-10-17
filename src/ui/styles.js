export const CSS_STYLES = `
    /* ===== Nhận và chuyển văn bản trên trục công văn Minimalist Light UI v3.0 ===== */
    #idesk-rpa-hub {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: min(1200px, 95vw) !important;
        height: min(780px, 88vh) !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        border-radius: 8px !important;
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.15) !important;
        color: #1E293B !important;
        font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        z-index: 999999 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
        transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease !important;
        user-select: none !important;
    }
    #idesk-rpa-hub.rpa-dragging { transition: none !important; }
    #idesk-rpa-hub * { box-sizing: border-box !important; }

    #idesk-rpa-hub.minimized {
        width: 340px !important;
        height: 42px !important;
        border-radius: 6px !important;
    }
    #idesk-rpa-hub.minimized .rpa-body,
    #idesk-rpa-hub.minimized .rpa-footer { display: none !important; }

    .rpa-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 10px 16px !important;
        background: #438eb9 !important;
        border-bottom: 1px solid #357298 !important;
        cursor: grab !important;
        min-height: 42px !important;
    }
    .rpa-header:active { cursor: grabbing !important; }

    .rpa-title {
        font-weight: 600 !important;
        font-size: 14px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        color: #FFFFFF !important;
        letter-spacing: -0.01em !important;
    }
    .rpa-title .badge-count {
        background: rgba(255, 255, 255, 0.25) !important;
        color: #FFFFFF !important;
        font-size: 11px !important;
        padding: 1px 8px !important;
        border-radius: 9999px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }

    .rpa-header-actions { display: flex !important; gap: 6px !important; }
    .rpa-header-actions button {
        background: rgba(255, 255, 255, 0.15) !important;
        border: 1px solid rgba(255, 255, 255, 0.3) !important;
        color: #FFFFFF !important;
        cursor: pointer !important;
        padding: 4px 10px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        transition: all 0.15s !important;
    }
    .rpa-header-actions button:hover {
        background: rgba(255, 255, 255, 0.3) !important;
        color: #FFFFFF !important;
    }

    .rpa-body {
        flex: 1 !important;
        padding: 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        overflow: hidden !important;
    }

    .rpa-toolbar {
        display: flex !important;
        gap: 12px !important;
        align-items: center !important;
        background: #F8F8F8 !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        border: 1px solid #E2E8F0 !important;
    }

    .rpa-scan-limit {
        display: inline-flex !important;
        align-items: center !important;
        gap: 7px !important;
        color: #475569 !important;
        font-size: 11px !important;
        white-space: nowrap !important;
    }
    .rpa-scan-limit input {
        width: 78px !important;
        height: 30px !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        border-radius: 4px !important;
        color: #0F172A !important;
        padding: 5px 8px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 12px !important;
        outline: none !important;
    }
    .rpa-scan-limit input:focus {
        border-color: #438eb9 !important;
        box-shadow: 0 0 0 2px rgba(67, 142, 185, 0.2) !important;
    }
    .rpa-scan-limit input::placeholder { color: #94A3B8 !important; }

    .rpa-btn {
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        color: #1E293B !important;
        border-radius: 4px !important;
        padding: 7px 16px !important;
        font-weight: 500 !important;
        font-size: 12px !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        transition: background 0.15s, transform 0.1s, border-color 0.15s !important;
    }
    .rpa-btn:hover { background: #F1F5F9 !important; color: #0F172A !important; border-color: #94A3B8 !important; }
    .rpa-btn:active { transform: scale(0.98) !important; }

    .rpa-btn-primary {
        background: #438eb9 !important;
        color: #FFFFFF !important;
        border: 1px solid #438eb9 !important;
        font-weight: 600 !important;
    }
    .rpa-btn-primary:hover { background: #357298 !important; border-color: #357298 !important; color: #FFFFFF !important; }

    .rpa-btn-purple {
        background: #438eb9 !important;
        color: #FFFFFF !important;
        border: 1px solid #438eb9 !important;
        font-weight: 600 !important;
    }
    .rpa-btn-purple:hover { background: #357298 !important; border-color: #357298 !important; color: #FFFFFF !important; }

    .rpa-btn-outline {
        background: transparent !important;
        border: 1px solid #CBD5E1 !important;
        color: #475569 !important;
    }
    .rpa-btn-outline:hover { border-color: #438eb9 !important; color: #438eb9 !important; background: #DFEFFF !important; }

    /* ===== CARD FEED WRAPPER ===== */
    .rpa-feed-wrap {
        flex: 1 !important;
        overflow-y: auto !important;
        padding-right: 4px !important;
    }
    .rpa-feed-wrap::-webkit-scrollbar { width: 6px !important; }
    .rpa-feed-wrap::-webkit-scrollbar-thumb { background: #CBD5E1 !important; border-radius: 3px !important; }
    .rpa-feed-wrap::-webkit-scrollbar-thumb:hover { background: #94A3B8 !important; }

    .rpa-card-feed {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
    }

    .rpa-empty-state {
        text-align: center !important;
        color: #64748B !important;
        padding: 48px 20px !important;
        background: #F5F5F5 !important;
        border: 1px solid #E2E8F0 !important;
        border-radius: 8px !important;
        font-size: 13px !important;
    }

    /* ===== DOCUMENT BENTO CARD ===== */
    .rpa-doc-card {
        background: #F8F8F8 !important;
        border: 1px solid #E2E8F0 !important;
        border-radius: 8px !important;
        padding: 14px 16px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        transition: border-color 0.15s, background 0.15s, box-shadow 0.15s !important;
    }
    .rpa-doc-card:hover {
        border-color: #438eb9 !important;
        background: #FFFFFF !important;
        box-shadow: 0 4px 12px rgba(67, 142, 185, 0.08) !important;
    }

    /* Card Header — flex-wrap badges row */
    .rpa-card-header {
        display: flex !important;
        align-items: flex-start !important;
        gap: 8px !important;
        padding-bottom: 10px !important;
        border-bottom: 1px solid #E2E8F0 !important;
    }
    .rpa-card-header-left {
        flex: 1 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        flex-wrap: wrap !important;
        min-width: 0 !important;
    }
    .rpa-card-header-right {
        flex-shrink: 0 !important;
        display: flex !important;
        align-items: center !important;
    }

    /* === Unified Badge Chip (Header metadata) === */
    .rpa-badge-chip {
        display: inline-flex !important;
        align-items: center !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        color: #334155 !important;
        background: #F1F5F9 !important;
        border: 1px solid #E2E8F0 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 260px !important;
        line-height: 1.4 !important;
        transition: border-color 0.12s, background 0.12s !important;
    }
    .rpa-badge-chip:hover {
        border-color: #CBD5E1 !important;
        background: #E2E8F0 !important;
        color: #0F172A !important;
    }
    .rpa-badge-chip.is-signnumber {
        color: #0F172A !important;
        font-weight: 700 !important;
        background: #F9F9F9 !important;
        border-color: #E2E8F0 !important;
        font-size: 12px !important;
    }
    .rpa-badge-chip.is-signnumber:hover {
        background: #DFEFFF !important;
        border-color: #BEE3F8 !important;
        color: #0284C7 !important;
    }
    .rpa-badge-chip.is-processing-time {
        color: #1F6C9F !important;
        background: #E1F3FE !important;
        border-color: #BAE6FD !important;
        font-weight: 600 !important;
    }
    .rpa-badge-chip.is-kind.is-update {
        color: #9F2F2D !important;
        background: #FDEBEC !important;
        border-color: #FECACA !important;
    }
    .rpa-badge-chip.is-kind.is-book {
        color: #1F6C9F !important;
        background: #E1F3FE !important;
        border-color: #BAE6FD !important;
    }

    /* === Priority chip — Trắng vàng mềm mại, tương phản cao === */
    .rpa-badge-chip.is-priority {
        color: #B45309 !important;
        background: #FEF3C7 !important;
        border-color: #FDE68A !important;
        font-weight: 600 !important;
    }
    .rpa-badge-chip.is-priority:hover {
        background: #FDE68A !important;
        border-color: #FCD34D !important;
        color: #92400E !important;
    }
    .rpa-badge-chip.is-priority.is-critical {
        color: #991B1B !important;
        background: #FEE2E2 !important;
        border-color: #FCA5A5 !important;
        font-weight: 700 !important;
    }
    .rpa-badge-chip.is-priority.is-critical:hover {
        color: #7F1D1D !important;
        background: #FECACA !important;
        border-color: #F87171 !important;
    }

    /* === Status Badge (pill, round) === */
    .rpa-badge {
        display: inline-flex !important;
        align-items: center !important;
        padding: 3px 10px !important;
        border-radius: 9999px !important;
        font-weight: 600 !important;
        font-size: 11px !important;
        letter-spacing: 0.03em !important;
        text-transform: uppercase !important;
    }
    .rpa-badge-idle { background: #F1F5F9 !important; color: #475569 !important; border: 1px solid #E2E8F0 !important; }
    .rpa-badge-pending { background: #E1F3FE !important; color: #1F6C9F !important; border: 1px solid #BAE6FD !important; }
    .rpa-badge-success { background: #EDF3EC !important; color: #346538 !important; border: 1px solid #BBF7D0 !important; }
    .rpa-badge-error { background: #FDEBEC !important; color: #9F2F2D !important; border: 1px solid #FECACA !important; }
    .rpa-badge-sent { background: #E1F3FE !important; color: #1F6C9F !important; border: 1px solid #BAE6FD !important; }

    /* Card Body */
    .rpa-card-body {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
    }

    .rpa-card-subject {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: #0F172A !important;
        line-height: 1.5 !important;
    }
    .rpa-subject-label {
        color: #475569 !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        margin-right: 4px !important;
    }
    .rpa-preview-link {
        display: inline-flex !important;
        align-items: center !important;
        margin-left: 10px !important;
        padding: 2px 8px !important;
        border: 1px solid #93C5FD !important;
        border-radius: 4px !important;
        background: #EFF6FF !important;
        color: #1D4ED8 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        text-decoration: none !important;
        white-space: nowrap !important;
    }
    .rpa-preview-link:hover {
        background: #DBEAFE !important;
        color: #1E40AF !important;
    }

    /* AI Summary Callout */
    .rpa-card-summary {
        background: #DFEFFF !important;
        border: 1px solid #BEE3F8 !important;
        border-left: 4px solid #438eb9 !important;
        border-radius: 6px !important;
        padding: 10px 14px !important;
    }
    .rpa-summary-title {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.08em !important;
        color: #1E3A8A !important;
        font-weight: 700 !important;
        margin-bottom: 4px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }
    .rpa-summary-text {
        font-size: 13px !important;
        color: #1E293B !important;
        line-height: 1.6 !important;
        white-space: pre-wrap !important;
    }
    .rpa-reason-line {
        margin-top: 6px !important;
        font-size: 12px !important;
        color: #475569 !important;
        line-height: 1.5 !important;
    }
    .rpa-router-notes {
        margin-top: 8px !important;
        padding-top: 7px !important;
        border-top: 1px dashed #93C5FD !important;
        color: #92400E !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
        white-space: pre-wrap !important;
    }

    /* === Assignment Grid (4 columns: unit, co-unit, leader, deadline) === */
    .rpa-assignment-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
        background: #F3F7FA !important;
        border: 1px solid #E2E8F0 !important;
        padding: 10px 12px !important;
        border-radius: 6px !important;
    }

    .rpa-assign-item {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
        min-width: 0 !important;
    }
    .rpa-assign-item.span-full {
        grid-column: 1 / -1 !important;
    }

    .rpa-assign-label {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #64748B !important;
        font-weight: 600 !important;
    }
    .rpa-assign-value {
        font-size: 12px !important;
        color: #334155 !important;
        line-height: 1.4 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
    }
    .rpa-assign-value.is-main-unit {
        color: #0F172A !important;
        font-weight: 600 !important;
    }
    .rpa-assign-value.is-deadline {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        color: #0F172A !important;
        font-weight: 600 !important;
    }

    /* Nút "Hạn thực hiện" — bấm để mở popover chỉnh số ngày (chỉ tương tác con số). */
    .rpa-deadline-btn {
        display: inline-flex !important;
        align-items: center !important;
        align-self: flex-start !important;
        gap: 5px !important;
        background: transparent !important;
        border: 1px solid transparent !important;
        padding: 1px 4px !important;
        margin: -1px -4px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        color: #0F172A !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        width: fit-content !important;
        max-width: 100% !important;
        text-align: left !important;
    }
    .rpa-deadline-btn:hover {
        background: #E2E8F0 !important;
        border-color: #CBD5E1 !important;
    }
    .rpa-deadline-btn-text {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
    }
    .rpa-deadline-btn-icon {
        flex-shrink: 0 !important;
        color: #64748B !important;
    }
    .rpa-deadline-btn:hover .rpa-deadline-btn-icon { color: #0F172A !important; }

    /* ===== DEADLINE EDITOR (popover chỉnh số ngày hạn thực hiện) ===== */
    .rpa-deadline-editor {
        position: fixed !important;
        z-index: 1000001 !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        border-radius: 6px !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
        padding: 10px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
        font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        color: #1E293B !important;
    }
    .rpa-deadline-editor-title {
        font-size: 11px !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #64748B !important;
    }
    .rpa-deadline-editor-row {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
    }
    .rpa-deadline-step {
        flex-shrink: 0 !important;
        width: 28px !important;
        height: 28px !important;
        background: #F1F5F9 !important;
        border: 1px solid #CBD5E1 !important;
        color: #1E293B !important;
        border-radius: 4px !important;
        font-size: 15px !important;
        line-height: 1 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
    }
    .rpa-deadline-step:hover { background: #E2E8F0 !important; color: #0F172A !important; }
    .rpa-deadline-step:active { transform: scale(0.96) !important; }
    .rpa-deadline-input {
        flex: 1 !important;
        min-width: 0 !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        color: #0F172A !important;
        border-radius: 4px !important;
        padding: 5px 8px !important;
        font-size: 13px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        text-align: center !important;
        outline: none !important;
    }
    .rpa-deadline-input:focus { border-color: #438eb9 !important; box-shadow: 0 0 0 2px rgba(67, 142, 185, 0.2) !important; }
    .rpa-deadline-editor-hint {
        font-size: 10px !important;
        color: #64748B !important;
        text-align: center !important;
    }
    .rpa-deadline-editor-actions {
        display: flex !important;
        justify-content: flex-end !important;
        gap: 6px !important;
        margin-top: 2px !important;
    }
    .rpa-deadline-editor-actions .rpa-btn {
        padding: 5px 12px !important;
        font-size: 11px !important;
    }
    .rpa-deadline-editor-actions .rpa-deadline-remove {
        margin-right: auto !important;
        color: #B91C1C !important;
        border-color: #FCA5A5 !important;
    }
    .rpa-deadline-editor-actions .rpa-deadline-remove:hover {
        color: #991B1B !important;
        border-color: #EF4444 !important;
        background: #FEF2F2 !important;
    }

    .rpa-unit-tags {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 4px !important;
    }
    .rpa-unit-pill {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        background: #E2E8F0 !important;
        border: 1px solid #CBD5E1 !important;
        color: #1E293B !important;
        padding: 2px 4px 2px 8px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        max-width: 100% !important;
    }
    .rpa-unit-pill-text {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        max-width: 220px !important;
    }
    .rpa-unit-remove {
        background: transparent !important;
        border: none !important;
        color: #64748B !important;
        cursor: pointer !important;
        font-size: 14px !important;
        line-height: 1 !important;
        padding: 0 3px !important;
        border-radius: 3px !important;
        font-family: inherit !important;
    }
    .rpa-unit-remove:hover { color: #0F172A !important; background: #CBD5E1 !important; }

    /* Chip "+ Thêm": dashed border */
    .rpa-unit-pill.rpa-unit-add {
        background: transparent !important;
        border: 1px dashed #94A3B8 !important;
        color: #475569 !important;
        cursor: pointer !important;
        padding: 2px 9px !important;
        font-family: inherit !important;
    }
    .rpa-unit-pill.rpa-unit-add:hover {
        border-color: #438eb9 !important;
        color: #0284C7 !important;
        background: #DFEFFF !important;
    }

    /* Chip "Gợi ý": suggestUnitLabel() (ui/unitPicker.js) đã dò được 1 khớp GẦN
       ĐÚNG trên cây đơn vị thật (unitCache) ngay lúc review, hiện cạnh chip AI
       trả về thô — bấm là dùng luôn giá trị này (áp dụng y hệt như đang tự
       chọn thủ công qua rpa-unit-picker), không cần mở popup. */
    .rpa-unit-suggest {
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        background: #ECFDF5 !important;
        border: 1px dashed #34D399 !important;
        color: #047857 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        max-width: 100% !important;
        cursor: pointer !important;
        font-family: inherit !important;
    }
    .rpa-unit-suggest:hover {
        background: #D1FAE5 !important;
        border-color: #10B981 !important;
        color: #065F46 !important;
    }
    .rpa-unit-suggest-label {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        max-width: 260px !important;
    }

    /* ===== UNIT PICKER (dropdown chọn đơn vị/người từ fbyvsphere.cpx) ===== */
    .rpa-unit-picker {
        position: fixed !important;
        z-index: 1000001 !important;
        max-height: 320px !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        border-radius: 6px !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
        display: flex !important;
        flex-direction: column !important;
        font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-size: 12px !important;
        color: #1E293B !important;
        overflow: hidden !important;
    }
    .rpa-unit-picker-search-wrap {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        padding: 8px !important;
        border-bottom: 1px solid #E2E8F0 !important;
        flex-shrink: 0 !important;
    }
    .rpa-unit-picker-search {
        flex: 1 !important;
        background: #FFFFFF !important;
        border: 1px solid #CBD5E1 !important;
        color: #0F172A !important;
        border-radius: 4px !important;
        padding: 5px 8px !important;
        font-size: 12px !important;
        outline: none !important;
        font-family: inherit !important;
    }
    .rpa-unit-picker-search:focus { border-color: #438eb9 !important; box-shadow: 0 0 0 2px rgba(67, 142, 185, 0.2) !important; }
    .rpa-unit-picker-search-icon { color: #64748B !important; flex-shrink: 0 !important; }

    .rpa-unit-picker-list {
        overflow-y: auto !important;
        padding: 4px 0 !important;
    }
    .rpa-unit-picker-list::-webkit-scrollbar { width: 6px !important; }
    .rpa-unit-picker-list::-webkit-scrollbar-thumb { background: #CBD5E1 !important; border-radius: 3px !important; }

    .rpa-unit-picker-empty {
        padding: 16px 10px !important;
        color: #64748B !important;
        text-align: center !important;
        font-size: 12px !important;
    }
    .rpa-unit-picker-row {
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        padding: 5px 10px 5px 0 !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
    }
    .rpa-unit-picker-row:hover { background: #DFEFFF !important; }
    .rpa-unit-picker-row.is-branch .rpa-unit-picker-label { color: #0F172A !important; font-weight: 600 !important; }
    .rpa-unit-picker-caret {
        display: inline-flex !important;
        width: 14px !important;
        flex-shrink: 0 !important;
        justify-content: center !important;
        color: #64748B !important;
        font-size: 10px !important;
    }
    .rpa-unit-picker-label {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #1E293B !important;
    }

    /* ===== LOG PANEL ===== */
    .rpa-log-panel {
        display: none !important;
        height: 120px !important;
        background: #0A0A0A !important;
        border: 1px solid #222222 !important;
        border-radius: 4px !important;
        padding: 8px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        overflow-y: auto !important;
        color: #00FF66 !important;
    }
    .rpa-log-panel.open { display: block !important; }

    /* ===== FOOTER ===== */
    .rpa-footer {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 16px !important;
        background: #438eb9 !important;
        border-top: 1px solid #357298 !important;
        font-size: 11px !important;
        color: #E0F2FE !important;
    }
    .rpa-status-text {
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
    }

    .rpa-progress-wrap {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        flex-shrink: 0 !important;
    }
    .rpa-average-time {
        padding-right: 8px !important;
        border-right: 1px solid rgba(255, 255, 255, 0.35) !important;
        color: #FFFFFF !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-weight: 600 !important;
        white-space: nowrap !important;
    }
    .rpa-progress-bar {
        width: 100px !important;
        height: 6px !important;
        background: rgba(255, 255, 255, 0.3) !important;
        border-radius: 3px !important;
        overflow: hidden !important;
    }
    .rpa-progress-fill {
        width: 0% !important;
        height: 100% !important;
        background: #FFFFFF !important;
        transition: width 0.2s ease !important;
    }
`;

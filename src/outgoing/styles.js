export const styles = `
#sender-launcher, #sender-panel { font-family: Arial, sans-serif; font-size: 14px; color: #173042; box-sizing: border-box; }
#sender-launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; background: #176080; color: white; border: 0; border-radius: 6px; padding: 12px 20px; font-weight: 700; box-shadow: 0 3px 12px #0003; cursor: pointer; }
#sender-panel {
    --sender-blue: #176080;
    --sender-ink: #173042;
    --sender-muted: #506775;
    --sender-border: #d8e2e8;
    --sender-surface: #f5f8fa;
    --sender-tint: #edf5f8;
    position: fixed; inset: 16px 16px 16px auto; width: min(1360px, calc(100vw - 32px)); height: calc(100vh - 32px);
    z-index: 2147483001; background: white; border: 1px solid var(--sender-border); border-radius: 8px;
    box-shadow: 0 8px 40px #17304233; display: flex; flex-direction: column; line-height: 1.5; overflow: hidden;
}
#sender-panel[hidden], #sender-panel [hidden] { display: none !important; }
#sender-panel * { box-sizing: border-box; }
#sender-panel .sender-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
#sender-panel h2 { font-size: 20px; margin: 0 0 8px; }
#sender-panel h3 { font-size: 16px; margin: 24px 0 12px; }
#sender-panel p { margin: 8px 0 16px; }
#sender-panel button, #sender-panel input, #sender-panel select, #sender-panel textarea { font: inherit; }
#sender-panel button { border: 1px solid var(--sender-border); border-radius: 4px; background: white; color: var(--sender-ink); padding: 8px 12px; cursor: pointer; line-height: 1.4; }
#sender-panel button:disabled { opacity: .5; cursor: default; }
#sender-panel button:hover:not(:disabled) { background: var(--sender-tint); border-color: #a9c5d3; }
#sender-panel .sender-primary { background: var(--sender-blue); color: white; border-color: var(--sender-blue); }
#sender-panel .sender-primary:hover:not(:disabled) { background: #114962; }
#sender-panel :focus-visible { outline: 3px solid #1d82ac; outline-offset: 2px; }
#sender-panel input:not([type=checkbox]), #sender-panel select, #sender-panel textarea { width: 100%; min-width: 0; padding: 8px; border: 1px solid #aabcc7; border-radius: 4px; background: white; color: var(--sender-ink); margin: 4px 0 0; }
/* iDesk skins hide native checkboxes to draw their own .lbl; restore ours. */
#sender-panel input[type=checkbox] { appearance: auto !important; display: inline-block !important; position: static !important; opacity: 1 !important; visibility: visible !important; clip: auto !important; clip-path: none !important; width: 16px; height: 16px; flex-shrink: 0; margin: 0 6px 0 0; vertical-align: middle; accent-color: var(--sender-blue); }
#sender-panel textarea { resize: vertical; }
.sender-toolbar { padding: 8px 12px; border-bottom: 1px solid var(--sender-border); display: flex; align-items: center; gap: 8px; flex-shrink: 0; cursor: grab; user-select: none; }
.sender-toolbar.sender-dragging { cursor: grabbing; }
.sender-toolbar-controls, .sender-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.sender-toolbar-controls { min-width: 0; overflow: auto; scrollbar-width: thin; touch-action: auto; }
.sender-toolbar-controls > *, .sender-toolbar-actions { flex-shrink: 0; white-space: nowrap; }
.sender-toolbar-spacer { flex: 1; min-width: 16px; align-self: stretch; touch-action: none; }
.sender-toolbar-actions svg { display: block; }
#sender-panel .sender-toolbar [data-action=stop]:disabled { display: none; }
.sender-toolbar label { display: flex; align-items: center; gap: 8px; }
#sender-panel .sender-toolbar input { max-width: 70px; margin: 0; }
.sender-connection { padding: 8px 12px; border-bottom: 1px solid var(--sender-border); flex-shrink: 0; max-height: 40%; overflow: auto; }
.sender-settings { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; }
.sender-body { display: grid; grid-template-columns: 224px minmax(0, 1fr) 400px; min-height: 0; flex: 1; overflow: hidden; }
.sender-list, .sender-detail, .sender-recipient-list, .sender-search-matches { overscroll-behavior: contain; scrollbar-gutter: stable; }
.sender-list { min-width: 0; overflow: auto; background: var(--sender-surface); border-right: 1px solid var(--sender-border); padding: 12px; }
.sender-detail { min-width: 0; overflow: auto; padding: 24px; overflow-wrap: anywhere; }
.sender-empty { color: var(--sender-muted); padding: 32px 12px; text-align: center; }
.sender-doc { border: 1px solid var(--sender-border); border-radius: 4px; background: white; margin: 0 0 12px; overflow: hidden; }
.sender-doc.is-selected { border-color: var(--sender-blue); box-shadow: inset 3px 0 var(--sender-blue); }
#sender-panel .sender-doc-select { border: 0; border-radius: 0; text-align: left; width: 100%; padding: 12px; background: transparent; overflow-wrap: anywhere; }
.sender-doc-select strong, .sender-doc-select span { display: block; }
.sender-doc-select span { font-size: 13px; margin-top: 6px; }
.sender-doc-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 0 12px 12px; font-size: 12px; }
.sender-subject { font-size: 16px; }
.sender-meta { display: flex; gap: 12px; font-size: 12px; color: var(--sender-muted); flex-wrap: wrap; margin-bottom: 16px; }
.sender-label { display: block; margin: 12px 0; font-weight: 600; }
.sender-label input, .sender-label textarea, .sender-label select { font-weight: 400; }
.sender-check { display: block; margin: 16px 0; font-weight: 400; }
.sender-result-summary { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px; margin: 20px 0; background: var(--sender-tint); border-radius: 4px; }
.sender-result-summary span { font-size: 12px; }
.sender-warning { background: #fff6df; color: #6e4c0e; border: 1px solid #ead294; padding: 12px; border-radius: 4px; overflow-wrap: anywhere; }
.sender-success { background: #eaf6ef; color: #19543a; padding: 12px; border-radius: 4px; }
.sender-review-item { padding: 16px; border: 1px solid #ead294; border-radius: 4px; margin: 12px 0; }
.sender-review-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.sender-review-heading button { flex-shrink: 0; }
.sender-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
#sender-panel .sender-candidates { display: grid; gap: 8px; min-width: 0; max-height: 280px; overflow: auto; border: 0; padding: 0; margin: 12px 0; }
#sender-panel .sender-candidates legend { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
#sender-panel .sender-choice { display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 8px; margin: 0; border: 1px solid var(--sender-border); border-radius: 4px; background: white; color: var(--sender-ink); font-weight: 400; cursor: pointer; }
#sender-panel .sender-choice span { min-width: 0; overflow-wrap: anywhere; }
#sender-panel .sender-choice small { display: block; font-size: 12px; color: var(--sender-muted); }
#sender-panel .sender-choice:hover { border-color: var(--sender-blue); }
#sender-panel .sender-choice.is-selected { background: var(--sender-tint); border-color: var(--sender-blue); box-shadow: inset 3px 0 var(--sender-blue); font-weight: 600; }
#sender-panel .sender-choice:focus-within { outline: 2px solid var(--sender-blue); outline-offset: 2px; }
#sender-panel .sender-selection-count { font-size: 12px; color: var(--sender-muted); margin: 8px 0; }
#sender-panel blockquote { font-size: 13px; margin: 8px 0; padding: 8px 12px; background: var(--sender-surface); border-left: 3px solid #a9c5d3; overflow-wrap: anywhere; }
#sender-panel details { margin: 16px 0; }
#sender-panel summary { cursor: pointer; font-weight: 600; }
.sender-footer { padding: 10px 20px; border-top: 1px solid var(--sender-border); font-size: 12px; overflow-wrap: anywhere; max-height: 80px; overflow: auto; flex-shrink: 0; }
.sender-count { font-size: 12px; color: var(--sender-muted); }
.sender-mobile-switch { display: none; }

/* Lookup stays visible while the document and chosen recipients scroll independently. */
.sender-recipients { min-width: 0; min-height: 0; border-left: 1px solid var(--sender-border); background: white; display: flex; flex-direction: column; }
.sender-badge { color: var(--sender-muted); font-size: 12px; font-weight: 400; flex-shrink: 0; }
.sender-directory { padding: 12px; border-bottom: 1px solid var(--sender-border); flex-shrink: 0; }
.sender-search { margin: 0; }
.sender-search-controls { display: flex; align-items: center; gap: 8px; }
#sender-panel .sender-search-controls input { margin: 0; height: 40px; flex: 1; }
.sender-search-controls button { flex-shrink: 0; min-height: 40px; }
#sender-panel .sender-search-status { font-size: 12px; color: var(--sender-muted); margin: 12px 0 4px; }
.sender-search-matches { max-height: 160px; overflow: auto; }
.sender-search-match { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-top: 1px solid var(--sender-border); }
.sender-search-match > div, .sender-recipient-identity { min-width: 0; overflow-wrap: anywhere; }
.sender-search-match strong, .sender-search-match small, .sender-recipient-identity strong, .sender-recipient-identity small { display: block; }
.sender-search-match strong { font-size: 13px; }
.sender-search-match small, .sender-recipient small { color: var(--sender-muted); font-size: 12px; }
.sender-added { color: #19543a; font-size: 12px; white-space: nowrap; }
.sender-chosen { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sender-chosen-heading { padding: 10px 12px; flex-shrink: 0; }
#sender-panel .sender-chosen h2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; margin: 0; }
.sender-recipient-list { min-height: 0; overflow: auto; padding: 0 12px 12px; }
.sender-recipient { border-bottom: 1px solid var(--sender-border); padding: 12px 4px; margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.sender-remove { align-self: start; }
.sender-assignments { min-width: 0; grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; border: 0; padding: 0; margin: 0; font-size: 13px; }

@media (max-width: 1100px) {
    .sender-body { grid-template-columns: 184px minmax(0, 1fr) 340px; }
    .sender-detail { padding: 16px; }
}
@media (max-width: 900px) {
    #sender-panel { inset: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); }
    .sender-body { grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: auto minmax(0, 1fr); }
    .sender-list { grid-column: 1 / -1; display: flex; gap: 8px; max-height: 112px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--sender-border); }
    .sender-list .sender-empty { padding: 8px; text-align: left; }
    .sender-doc { min-width: 216px; max-width: 260px; margin: 0; flex-shrink: 0; }
    .sender-doc-select span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #sender-panel .sender-doc-select { padding: 8px 12px; }
    .sender-doc-meta { padding-bottom: 8px; }
    .sender-settings { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
    .sender-body { grid-template-columns: minmax(0, 1fr); }
    .sender-toolbar { gap: 4px; padding: 8px; }
    .sender-toolbar-controls { flex: 1; }
    .sender-toolbar-spacer { display: none; }
    .sender-mobile-switch { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid var(--sender-border); background: var(--sender-surface); flex-shrink: 0; }
    #sender-panel .sender-mobile-switch button { flex: 1; padding: 8px; font-size: 12px; min-height: 40px; }
    #sender-panel .sender-mobile-switch button[aria-pressed=true] { background: var(--sender-blue); border-color: var(--sender-blue); color: white; }
    #sender-panel[data-mobile-view=review] .sender-recipients, #sender-panel[data-mobile-view=recipients] .sender-detail { display: none; }
    .sender-recipients { border-left: 0; }
    .sender-result-summary { display: block; }
    .sender-result-summary span { display: block; margin-top: 4px; }
    .sender-search-matches { max-height: 120px; }
    .sender-assignments label { min-height: 40px; }
    .sender-footer { padding: 8px 12px; }
}
@media (max-height: 650px) {
    .sender-list { max-height: 88px; }
    .sender-recipients { display: block; overflow: auto; }
    .sender-recipient-list { overflow: visible; }
}
`;

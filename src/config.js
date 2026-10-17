const AUTH_BASE_URL = process.env.AUTH_BASE_URL;
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AI_PROVIDER = process.env.AI_PROVIDER || 'local-router';
const ROUTER_BASE_URL = process.env.ROUTER_BASE_URL || 'http://127.0.0.1:8000';
const ROUTER_API_KEY = process.env.ROUTER_API_KEY || '';
const ROUTER_POLL_INTERVAL_MS = Number(process.env.ROUTER_POLL_INTERVAL_MS || 1500);
const ROUTER_TIMEOUT_MS = Number(process.env.ROUTER_TIMEOUT_MS || 330000);

export const CONFIG = {
    AI_PROVIDER,
    ROUTER: {
        BASE_URL: ROUTER_BASE_URL.replace(/\/$/, ''),
        API_KEY: ROUTER_API_KEY,
        POLL_INTERVAL_MS: ROUTER_POLL_INTERVAL_MS,
        TIMEOUT_MS: ROUTER_TIMEOUT_MS
    },
    AUTH_BASE_URL,
    AUTH_USERNAME,
    AUTH_PASSWORD,
    BACKEND_URL: `${AUTH_BASE_URL}/documents/process`,
    LOOKUP_URL: `${AUTH_BASE_URL}/documents/lookup`,
    PATCH_URL_BASE: `${AUTH_BASE_URL}/documents`,
    AUTH_URL: `${AUTH_BASE_URL}/auth/token`,
    // docs/en/docflowv2.md muc 6-7: xin URL tam de day file PDF that len truoc khi
    // goi /documents/process, thay cho viec gui thang link noi bo iDesk (yeu cau
    // cookie phien dang nhap -> AI backend that khong tai duoc, xem docs/changes/
    // De_xuat_presigned_url.md). "upload_url" tra ve tu presign da la URL day du,
    // FE khong tu ghep them nen khong can them 1 base URL rieng cho buoc upload.
    PRESIGN_URL: `${AUTH_BASE_URL}/files/presign`,
    // Backoff cho 429 RATE_LIMITED / 503 SERVER_BUSY (docs/en/docflow.md muc 10)
    RETRY: {
        MAX_ATTEMPTS: 3,
        BASE_DELAY_MS: 1000
    },
    // Thời gian tối đa tải 1 file PDF qua session iDesk. Trước đây downloadPDF()
    // không đặt timeout nên ontimeout là code chết; một lần tải treo làm batch
    // treo vĩnh viễn (kẹt state.isProcessing, không có nút huỷ).
    DOWNLOAD_TIMEOUT_MS: 60000,
    DELAY_MS: {
        SELECT_DOC: 1000,
        CLICK_SAVE_TRANSFER: 1200,
        OPEN_TREE: 800,
        EXPAND_TREE: 600,
        TREE_SEARCH: 500,
        CLOSE_TREE: 350,
        // Delay cho hieu ung an/hien (slideDown/show) cua khoi div[data-role="follow"]
        // sau khi bam #ed-transfer-add-follow-btn, TRUOC khi popup cay #ed-transfer-select-user-follow
        // co the duoc mo va thao tac (xem ghi chu trong formFiller.js).
        TOGGLE_FOLLOW: 500,
        AFTER_SUBMIT: 1800,
        BETWEEN_DOCS: 800,
        PAGE_CHANGE_POLL: 150,
        // Backend gioi han 30 request/60s cho moi endpoint (xem mock_backend.py
        // RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_SEC). 2200ms/van ban ~ 27 van ban/60s,
        // du bien de tranh 429 khi scanAndSendAll xu ly nhieu van ban lien tiep.
        BETWEEN_AI_CALLS: 2200
    }
};

export const S = {
    LEFT_LIST: '#listview-list-content div.messageListItem',
    LEFT_LIST_FALLBACK: 'div.messageListItem[data-id]',
    PAGING_FIRST_BTN: '#listview-paging-listview-pagingbtn-first',
    PAGING_PREV_BTN: '#listview-paging-listview-pagingbtn-prev',
    PAGING_NEXT_BTN: '#listview-paging-listview-pagingbtn-next',
    PAGING_CURRENT: '#listview-paging [data-page="number"]',
    ACCEPT_UPDATE_BTN: '#ed-view-btn-accept-update',
    TRANSFER_BTN: '#ed-view-btn-transfer',
    SAVE_TRANSFER_BTN: '#ed-new-receiver-btn-save-transfer',
    TRANSFER_WIDGET: '#ed-transfer-document-widget',
    TRANSFER_CONTAINER: '#ed-transfer-document-container',
    RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
    RESPONSIBLE_WRAP: '#ed-transfer-select-user-responsible',
    PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
    PARTICIPANTS_WRAP: '#ed-transfer-select-user-participants',
    // Truong "Theo doi" (lanh dao theo doi) MAC DINH AN tren form that - nam trong
    // div[data-role="follow"] co class "hide". Phai bam FOLLOW_TOGGLE_BTN de lo dien
    // no ra truoc khi co the query/click vao FOLLOW_LINK (xem formFiller.js va
    // resource/"Van thu role"/right_panel_after_save_and_transfer.html - link luc
    // an hien chu "Thêm người theo dõi", sau khi bam doi thanh "Ẩn người theo dõi").
    FOLLOW_TOGGLE_BTN: '#ed-transfer-add-follow-btn',
    FOLLOW_LINK: '#ed-transfer-select-user-follow a.user-box-link',
    FOLLOW_WRAP: '#ed-transfer-select-user-follow',
    DEADLINE_INPUT: '#ed-transfer-txt-deadline',
    DEADLINE_NUMBER: '#ed-transfer-txt-deadline-number',
    PRIORITY_SELECT: '#ed-transfer-select-priority',
    CONTENT_TEXTAREA: '#ed-transfer-txt-content',
    AGREE_BTN: '#ed-transfer-btn-transfer',
    CANCEL_BTN: '#ed-transfer-btn-cancel'
};

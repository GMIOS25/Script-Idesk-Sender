"""
Mock Backend cho Nhận và chuyển văn bản trên trục công văn Automation (DocFlow API v3.1)
Mo phong AI xu ly van ban den theo tai lieu docs/en/docflow.md va
docs/en/METADATA_SCHEMA.md (NGUON SU THAT DUY NHAT ve schema).

Endpoints ho tro:
- POST /auth/token              : Lay access token
- POST /files/presign            : Xin URL tam de day file len (docs/en/docflowv2.md muc 6)
- PUT  /files/upload/<token>     : Day bytes tho cua file (docs/en/docflowv2.md muc 7)
- GET  /files/tmp/<token>        : Tai lai file tam (docs/en/docflowv2.md muc 8)
- POST /documents/process       : Tra cache hoac xu ly van ban (Endpoint chinh)
- POST /api/v1/documents/process: Alias cho /documents/process
- POST /api/process-doc         : Legacy endpoint (backward compatibility)
- POST /documents/lookup        : Tra metadata van ban khong can file URL
- PATCH /documents/<stt>        : Cap nhat 6 truong thong tin AI
- GET  /wards                    : Danh sach xa trong danh muc to chuc (muc 12.1)
- GET  /wards/compare            : So sanh cac xa theo comparison_code (muc 12.2)
- GET  /wards/<ward_code>/organizations    : Don vi cua 1 xa (muc 12.3)
- GET  /organizations/<id>/entries         : Chuc danh/dau moi cua 1 don vi (muc 12.4)
- GET  /health                  : Check Liveness
- GET  /health/ready            : Check Readiness

Hanh vi loi (docs/en/docflow.md muc 9-10):
- Moi response deu co header `X-Request-Id` (giu lai gia tri FE gui neu hop le,
  nguoc lai tu sinh).
- Payload thieu/sai schema -> loi chuan `{"error": {"code","message","detail"}}`.
- Vuot rate limit -> 429 `RATE_LIMITED`; qua so job OCR/AI dong thoi -> 503
  `SERVER_BUSY`.
- Co the ep loi thu cong de FE/QA test cac nhanh nay bang header:
    X-Mock-Force-Error: RATE_LIMITED | SERVER_BUSY | VALIDATION | NOT_COMPLETED
  (NOT_COMPLETED chi ap dung cho PATCH /documents/<stt> - xem muc 6b ben duoi:
  mock nay xu ly /documents/process dong bo nen khong tu nhien co van ban o
  trang thai "processing" giua 2 request de test nhanh 409 DOCUMENT_NOT_COMPLETED,
  phai ep bang header).
"""

import sys
import os
import re
import json
import time
import uuid
import random
import secrets
import threading
from collections import defaultdict, deque

# Dam bao terminal log tieng Viet khong bi loi font/encoding tren Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, request, jsonify, g
from flask_cors import CORS

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
if hasattr(app, 'json'):
    app.json.ensure_ascii = False

CORS(app, expose_headers=['X-Request-Id'])

# ----------------------------------------------------
# 0. Ha tang chung: X-Request-Id, rate limit, error payload chuan (docs muc 9-10)
# ----------------------------------------------------
REQUEST_ID_RE = re.compile(r'^[A-Za-z0-9._-]{8,128}$')

RATE_LIMIT_MAX = int(os.environ.get('MOCK_RATE_LIMIT_MAX', '30'))
RATE_LIMIT_WINDOW_SEC = int(os.environ.get('MOCK_RATE_LIMIT_WINDOW_SEC', '60'))
MAX_CONCURRENT_JOBS = int(os.environ.get('MOCK_MAX_CONCURRENT_JOBS', '3'))

_rate_limit_lock = threading.Lock()
_rate_limit_hits = defaultdict(deque)  # key -> deque[timestamp, ...]

_active_jobs_lock = threading.Lock()
_active_jobs = 0


def _check_rate_limit(key):
    """Sliding-window dan gian, luu trong bo nho. Du cho mock/dev, khong dung
    cho production that (can Redis/rate-limit store dung dan)."""
    now = time.monotonic()
    with _rate_limit_lock:
        hits = _rate_limit_hits[key]
        while hits and now - hits[0] > RATE_LIMIT_WINDOW_SEC:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_MAX:
            return False
        hits.append(now)
        return True


def _client_key(suffix=''):
    base = request.headers.get('Authorization') or request.remote_addr or 'anonymous'
    return f"{base}:{suffix}" if suffix else base


def _error_response(code, message, status, detail=None):
    return jsonify({"error": {"code": code, "message": message, "detail": detail}}), status


def _forced_error():
    """Cho phep FE/QA ep tinh huong loi de test 429/503/422 (docs muc 9-10) ma
    khong phu thuoc vao rate-limit/concurrency thuc te (kho tai hien on dinh)."""
    forced = (request.headers.get('X-Mock-Force-Error') or '').strip().upper()
    if forced == 'RATE_LIMITED':
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep (ep buoc de test)', 429)
    if forced == 'SERVER_BUSY':
        return _error_response('SERVER_BUSY', 'He thong dang qua tai OCR/AI (ep buoc de test)', 503)
    if forced == 'VALIDATION':
        return _error_response('INVALID_PROCESS_PAYLOAD', 'Du lieu gui len sai schema (ep buoc de test)', 422)
    return None


@app.before_request
def _assign_request_id():
    incoming = request.headers.get('X-Request-Id', '')
    g.request_id = incoming if REQUEST_ID_RE.match(incoming or '') else uuid.uuid4().hex


@app.after_request
def _attach_request_id(response):
    response.headers['X-Request-Id'] = getattr(g, 'request_id', uuid.uuid4().hex)
    return response


# ----------------------------------------------------
# 0b. Bearer auth (docs/en/docflowv2.md muc 1): moi endpoint TRU /auth/token,
#     /health, /health/ready deu doi hoi header:
#         Authorization: Bearer <access_token>
#     Truoc ban nay, mock hoan toan khong xac thuc token (_client_key chi dung
#     no lam key rate-limit) -> khac hanh vi server that (xem
#     docs/en/api_host.md, Request 3: goi /documents/lookup thieu token phai
#     tra 401 UNAUTHORIZED). Token phat ra tu /auth/token duoc luu tam trong
#     bo nho (khong persist qua restart, du cho muc dich mock) kem TTL 24h
#     dung nhu `expires_in` da cong bo o muc 5.
# ----------------------------------------------------
AUTH_EXEMPT_ENDPOINTS = {'auth_token', 'health', 'health_ready'}
BEARER_RE = re.compile(r'^Bearer\s+(.+)$', re.IGNORECASE)
TOKEN_TTL_SEC = 86400

_issued_tokens_lock = threading.Lock()
_issued_tokens = {}  # token -> epoch expiry (time.time())


def _issue_token():
    token = f"mock_bearer_token_{uuid.uuid4().hex[:16]}"
    with _issued_tokens_lock:
        _issued_tokens[token] = time.time() + TOKEN_TTL_SEC
    return token


def _is_token_valid(token):
    with _issued_tokens_lock:
        expires_at = _issued_tokens.get(token)
        if expires_at is None:
            return False
        if expires_at < time.time():
            del _issued_tokens[token]
            return False
        return True


@app.before_request
def _enforce_bearer_auth():
    # Preflight CORS khong kem Authorization -> luon cho qua.
    if request.method == 'OPTIONS':
        return None
    # Route khong khop endpoint nao (vd 404) -> de Flask xu ly binh thuong,
    # khong che bang 401 truoc khi kip bao 404.
    if request.endpoint is None or request.endpoint in AUTH_EXEMPT_ENDPOINTS:
        return None

    match = BEARER_RE.match(request.headers.get('Authorization', ''))
    if not match:
        return _error_response(
            'UNAUTHORIZED',
            'Thieu hoac sai dinh dang header Authorization: Bearer <access_token>',
            401
        )

    if not _is_token_valid(match.group(1).strip()):
        return _error_response(
            'UNAUTHORIZED',
            'Token khong hop le hoac da het han, goi lai POST /auth/token',
            401
        )

    return None


# ----------------------------------------------------
# 1. Validation payload theo hop dong API (docs/en/docflow.md muc 4-6)
# ----------------------------------------------------
REQUIRED_METADATA_FIELDS = ['document_number', 'document_type', 'issuing_agency', 'document_date', 'signer', 'subject']
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
PATCHABLE_FIELDS = {'summary', 'processing_unit', 'monitoring_leader', 'implementation_deadline', 'coordinating_units', 'notes'}


def _validate_identity_metadata(metadata):
    """Dung chung cho POST /documents/process (key `metadata`) va POST
    /documents/lookup (chinh body request).

    Doi lai theo hanh vi thuc te cua server that: khi cao du lieu bi thieu 1
    vai truong trong 6 truong identity, server VAN CHAP NHAN request va xu ly
    tiep voi cac truong con lai — truong nao thieu thi tra ve null, KHONG con
    tra loi 422 nhu truoc day nua. Chi tra loi khi:
      - metadata khong phai JSON object, HOAC
      - metadata rong hoan toan (khong co truong nao ca -> khong the dinh
        danh duoc van ban nay la van ban gi), HOAC
      - mot truong DA DUOC GUI (khong rong) nhung sai kieu / qua dai / sai
        dinh dang — day la loi du lieu that su, khac voi truong hop "thieu".
    """
    if not isinstance(metadata, dict):
        return "metadata phai la mot JSON object"

    if not any(metadata.get(f) for f in REQUIRED_METADATA_FIELDS):
        return f"Metadata rong hoan toan, can it nhat 1 trong cac truong: {', '.join(REQUIRED_METADATA_FIELDS)}"

    for f in REQUIRED_METADATA_FIELDS:
        val = metadata.get(f)
        if not val:
            continue  # thieu truong nay -> chap nhan, se tra ve null cho FE
        if not isinstance(val, str):
            return f"Truong '{f}' phai la string"
        if len(val) > 500:
            return f"Truong '{f}' vuot qua 500 ky tu"

    document_date = metadata.get('document_date')
    if document_date and not DATE_RE.match(document_date):
        return "document_date phai theo dinh dang YYYY-MM-DD"

    return None


# ----------------------------------------------------
# 1b. Du lieu don vi/nguoi mau — trich tu resource/"Chu tich role"/fbyvsphere.cpx
#     (cay don vi that cua xa Vinh Thanh) de gia lap dung dinh dang the hien
#     tren "tag" ma FE dung khi chon "processing_unit" / "coordinating_units"
#     trong cay to chuc (xem selectTreeItem trong src/automation/treeSelect.js
#     va autoFillAndSubmit trong src/automation/formFiller.js).
#
#     Quy tac hien thi tren tag (theo yeu cau QA):
#       - type "dept" hoac "unit"  -> hien thi dung gia tri `name`
#       - type "alias"             -> hien thi "name (refFullname)"
#         (alias la "vi tri/chuc danh" gan voi 1 nguoi cu the — nhieu alias
#         co cung `name` vd "Van thu" nen bat buoc phai kem refFullname de
#         phan biet, giong nhu hien thi that tren giao dien iDesk)
# ----------------------------------------------------
ORG_SAMPLE_ELEMENTS = {
    # -- type: dept (don vi/phong ban) --
    "congan_xa":          {"id": 71446,   "name": "Công an xã", "type": "dept"},
    "vanphong_ubnd_hdnd": {"id": 280,     "name": "Văn phòng UBND và HĐND", "type": "dept"},
    "tram_yte":           {"id": 1920094, "name": "Trạm y tế", "type": "dept"},
    "phong_vhxh":         {"id": 289,     "name": "Phòng Văn hóa - Xã hội", "type": "dept"},
    "phong_kt":           {"id": 286,     "name": "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai", "type": "dept"},
    "trungtam_hcc":       {"id": 283,     "name": "Trung tâm phục vụ Hành chính công", "type": "dept"},

    # -- type: unit (don vi cap tren/cay goc) --
    "ubnd_xa": {"id": 276, "name": "UBND Xã Vĩnh Thạnh - Tỉnh Gia Lai", "type": "unit"},

    # -- type: alias (chuc danh gan voi 1 nguoi cu the) --
    "chu_tich":       {"id": 279,   "name": "Chủ tịch UBND", "refFullname": "Lê Minh Thông", "type": "alias"},
    "pho_chu_tich_1": {"id": 375,   "name": "Phó Chủ tịch UBND", "refFullname": "Nguyễn Quốc Trường", "type": "alias"},
    "pho_chu_tich_2": {"id": 376,   "name": "Phó Chủ tịch UBND", "refFullname": "Trịnh Bảo Luân", "type": "alias"},
    "van_thu_congan": {"id": 71447, "name": "Văn thư", "refFullname": "Văn thư Công an xã", "type": "alias"},
    "van_thu_kt":     {"id": 287,   "name": "Văn thư", "refFullname": "Văn thư phòng Kinh tế", "type": "alias"},
    "van_thu_hcc":    {"id": 284,   "name": "Văn thư", "refFullname": "Văn thư Trung tâm phục vụ Hành chính công", "type": "alias"},

    # them nhieu alias da dang hon (cung ten "Chuyen vien" nhung khac nguoi,
    # cac chuc danh Truong/Pho phong ban...) de kiem tra format alias tren
    # nhieu tinh huong ngau nhien hon, khong chi lap lai vai gia tri co dinh.
    "chuyen_vien_vhxh_1": {"id": 8475,    "name": "Chuyên viên", "refFullname": "Nguyễn Quốc Khánh", "type": "alias"},
    "chuyen_vien_vhxh_2": {"id": 3887910, "name": "Chuyên viên", "refFullname": "Đinh Giang Sơn", "type": "alias"},
    "chuyen_vien_kt_1":   {"id": 131941,  "name": "Chuyên viên", "refFullname": "Trần Quốc Huy", "type": "alias"},
    "chuyen_vien_kt_2":   {"id": 1901,    "name": "Chuyên viên", "refFullname": "Đặng Thị Kim Oanh", "type": "alias"},
    "chuyen_vien_vp_1":   {"id": 385,     "name": "Chuyên viên", "refFullname": "Lê Kim Anh", "type": "alias"},
    "chuyen_vien_vp_2":   {"id": 386,     "name": "Chuyên viên", "refFullname": "Lê Minh Phong", "type": "alias"},
    "chanh_van_phong":    {"id": 388,     "name": "Chánh Văn phòng", "refFullname": "Võ Trọng Duy", "type": "alias"},
    "pho_chanh_van_phong": {"id": 8500,   "name": "Phó Chánh Văn phòng", "refFullname": "Lê Thị Lệ", "type": "alias"},
    "truong_phong_kt":    {"id": 423,     "name": "Trưởng phòng Kinh tế", "refFullname": "Nguyễn Tuấn Trình", "type": "alias"},
    "truong_ban_kt_ns":   {"id": 37714,   "name": "Trưởng Ban Kinh tế - Ngân Sách", "refFullname": "Đinh Khánh", "type": "alias"},
    "truong_ban_vhxh":    {"id": 37886,   "name": "Trưởng Ban Văn hóa - Xã hội", "refFullname": "Đinh Tiêu", "type": "alias"},
    "truong_congan_xa":   {"id": 329981,  "name": "Trưởng Công an xã", "refFullname": "Đinh Văn Ngoan", "type": "alias"},
    "chi_huy_truong":     {"id": 38060,   "name": "Chỉ huy trưởng", "refFullname": "Trần Thanh Đức", "type": "alias"},
    "truong_tram_yte":    {"id": 1921184, "name": "Trưởng trạm", "refFullname": "Nguyễn Văn Tám", "type": "alias"},
    "giam_doc_hcc":       {"id": 8422,    "name": "Giám đốc", "refFullname": "Lê Hàn Sinh", "type": "alias"},
    "pho_giam_doc_hcc":   {"id": 8408,    "name": "Phó giám đốc", "refFullname": "Nguyễn Văn Bình", "type": "alias"},
}

_DEPT_KEYS = [k for k, v in ORG_SAMPLE_ELEMENTS.items() if v["type"] == "dept"]
_UNIT_KEYS = [k for k, v in ORG_SAMPLE_ELEMENTS.items() if v["type"] == "unit"]
_ALIAS_KEYS = [k for k, v in ORG_SAMPLE_ELEMENTS.items() if v["type"] == "alias"]
_ALL_KEYS = _DEPT_KEYS + _UNIT_KEYS + _ALIAS_KEYS


def _random_processing_and_coordinating_units():
    """Sinh ngau nhien 1 cap (processing_unit, coordinating_units) tu
    ORG_SAMPLE_ELEMENTS moi lan goi, tron ca 3 loai dept/unit/alias — dung cho
    cac van ban KHONG khop mau nao trong SAMPLE_RESPONSES (truoc day luon tra
    ve dung 1 gia tri mac dinh co dinh nen khong the kiem tra duoc nhieu bien
    the cua tag "alias").
    """
    processing_key = random.choice(_ALL_KEYS)
    processing_unit = _org_tag_label(processing_key)

    # Uu tien co it nhat 1 alias trong coordinating_units de dam bao luon co
    # tinh huong kiem tra dinh dang "name (refFullname)".
    pool = [k for k in _ALL_KEYS if k != processing_key]
    alias_pool = [k for k in pool if k in _ALIAS_KEYS]

    n_coordinating = random.randint(2, 3)
    picks = []
    if alias_pool:
        picks.append(random.choice(alias_pool))
    remaining_needed = n_coordinating - len(picks)
    rest_pool = [k for k in pool if k not in picks]
    if remaining_needed > 0 and rest_pool:
        picks.extend(random.sample(rest_pool, min(remaining_needed, len(rest_pool))))

    random.shuffle(picks)
    coordinating_units = [_org_tag_label(k) for k in picks]
    return processing_unit, coordinating_units


def _random_monitoring_leader():
    """Sinh ngau nhien 1 gia tri monitoring_leader tu ORG_SAMPLE_ELEMENTS, dung
    cho cac van ban KHONG khop mau nao trong SAMPLE_RESPONSES — cung muc dich
    voi _random_processing_and_coordinating_units() o tren, de FE/QA co the
    kiem tra tinh nang thêm/sửa "Lãnh đạo theo dõi" (giống hệt "Đơn vị xử lý
    chính") voi du lieu bam sat dinh dang tag that ("name (refFullname)")
    thay vi 1 chuoi tu do co dinh khong khop bat ky phan tu nao trong cay
    to chuc that (fbyvsphere.cpx).

    `monitoring_leader` la 1 LANH DAO duy nhat (xem docs/en/METADATA_SCHEMA.md
    #10 va patch feat auto-fill monitoring_leader) nen chi chon trong nhom
    "alias" (chuc danh gan voi 1 nguoi cu the), khong chon dept/unit nhu
    processing_unit/coordinating_units.
    """
    key = random.choice(_ALIAS_KEYS)
    return _org_tag_label(key)


def _org_tag_label(key):
    """Tra ve chuoi hien thi tren tag dung quy tac:
    - dept/unit -> name
    - alias     -> "name (refFullname)"
    """
    elem = ORG_SAMPLE_ELEMENTS[key]
    if elem["type"] == "alias":
        return f"{elem['name']} ({elem['refFullname']})"
    return elem["name"]


# ----------------------------------------------------
# 2. Du lieu mau — dung 13 cot theo METADATA_SCHEMA.md v2.0
#    Luu y `implementation_deadline` la string|null (khong phai so nguyen), va
#    KHONG co truong `priority` (khong nam trong 13 cot cong khai — schema AI
#    output dung extra="forbid" nen BE that se reject/khong bao gio tra field nay).
#
#    `processing_unit`, `coordinating_units` va `monitoring_leader` deu duoc gan
#    bang _org_tag_label() tu ORG_SAMPLE_ELEMENTS o tren (dung dinh dang de xuat
#    trong docs/changes/De_xuat_dinh_dang_processing_unit_coordinating_units.md
#    muc 2: dept/unit -> name, alias -> "name (refFullname)"), phu du 3 to hop de
#    QA/FE kiem tra viec dien tag: dept-only, dept+alias, va unit/alias.
#    `monitoring_leader` luon lay tu nhom alias (mot lanh dao/chuc danh duy nhat,
#    xem docs/en/METADATA_SCHEMA.md #10), khac processing_unit/coordinating_units
#    co the la ca dept/unit.
# ----------------------------------------------------
SAMPLE_RESPONSES = [
    {
        "sign_number_match": "5637/SYT-TCCB",
        "data": {
            "stt": 1,
            "document_number": "5637/SYT-TCCB",
            "document_type": "Thông báo",
            "issuing_agency": "Sở Y tế",
            "document_date": "2026-07-20",
            "signer": "Nguyễn Văn A",
            "subject": "Trình tự, thủ tục, biểu mẫu thực hiện chính sách thu hút và ưu đãi bác sĩ, dược sĩ theo NQ 54/2026/NQ-HĐND",
            "summary": "Trình tự, thủ tục, biểu mẫu thực hiện chính sách thu hút và ưu đãi bác sĩ, dược sĩ theo NQ 54/2026/NQ-HĐND",
            "processing_unit": _org_tag_label("tram_yte"),
            "monitoring_leader": _org_tag_label("chu_tich"),
            "implementation_deadline": "trong 07 ngày làm việc",
            "coordinating_units": [_org_tag_label("phong_vhxh"), _org_tag_label("vanphong_ubnd_hdnd")],
            "notes": "Văn bản ưu đãi ngành Y tế - Ưu tiên xử lý"
        }
    },
    {
        "sign_number_match": "8069/SNNMT-PTNT",
        "data": {
            "stt": 2,
            "document_number": "8069/SNNMT-PTNT",
            "document_type": "Công văn",
            "issuing_agency": "Sở Nông nghiệp và PTNT",
            "document_date": "2026-07-19",
            "signer": "Trần Văn B",
            "subject": "Phối hợp cung cấp số liệu về tỷ lệ nghèo đa chiều phục vụ xác định thôn vùng đồng bào DTTS",
            "summary": "Phối hợp cung cấp số liệu về tỷ lệ nghèo đa chiều phục vụ xác định thôn vùng đồng bào DTTS",
            "processing_unit": _org_tag_label("phong_kt"),
            "monitoring_leader": _org_tag_label("pho_chu_tich_1"),
            "implementation_deadline": "trong 05 ngày làm việc",
            "coordinating_units": [_org_tag_label("phong_vhxh"), _org_tag_label("trungtam_hcc")],
            "notes": "Yêu cầu số liệu trước ngày 25"
        }
    },
    {
        "sign_number_match": "445/TB-UBND",
        "data": {
            "stt": 3,
            "document_number": "445/TB-UBND",
            "document_type": "Thông báo",
            "issuing_agency": "UBND Huyện Phù Mỹ",
            "document_date": "2026-07-18",
            "signer": "Lê Văn C",
            "subject": "Niêm yết công khai xác nhận nguồn gốc đất, thời điểm sử dụng đất và cấp GCN QSD đất lần đầu",
            "summary": "Niêm yết công khai xác nhận nguồn gốc đất, thời điểm sử dụng đất và cấp GCN QSD đất lần đầu",
            "processing_unit": _org_tag_label("vanphong_ubnd_hdnd"),
            "monitoring_leader": _org_tag_label("chu_tich"),
            "implementation_deadline": "trong 15 ngày",
            "coordinating_units": [_org_tag_label("congan_xa"), _org_tag_label("phong_kt")],
            "notes": "Niêm yết 15 ngày tại trụ sở"
        }
    },
    {
        "sign_number_match": "274a/TB-UBND",
        "data": {
            "stt": 4,
            "document_number": "274a/TB-UBND",
            "document_type": "Thông báo",
            "issuing_agency": "UBND xã",
            "document_date": "2026-07-17",
            "signer": "Phạm Văn D",
            "subject": "Niêm yết công khai kết quả kiểm tra hồ sơ đăng ký của ông Nguyễn Văn Cang",
            "summary": "Niêm yết công khai kết quả kiểm tra hồ sơ đăng ký của ông Nguyễn Văn Cang",
            "processing_unit": _org_tag_label("vanphong_ubnd_hdnd"),
            "monitoring_leader": _org_tag_label("chu_tich"),
            "implementation_deadline": "trong 10 ngày làm việc",
            "coordinating_units": [_org_tag_label("congan_xa"), _org_tag_label("phong_kt"), _org_tag_label("van_thu_congan")],
            "notes": "Hồ sơ đất đai cá nhân"
        }
    },
    {
        "sign_number_match": "5174/SNV-CCVC",
        "data": {
            "stt": 5,
            "document_number": "5174/SNV-CCVC",
            "document_type": "Công văn",
            "issuing_agency": "Sở Nội vụ",
            "document_date": "2026-07-16",
            "signer": "Hoàng Văn E",
            "subject": "Góp ý dự thảo Thông tư hướng dẫn xây dựng, khai thác học liệu số trong bồi dưỡng cán bộ",
            "summary": "Góp ý dự thảo Thông tư hướng dẫn xây dựng, khai thác học liệu số trong bồi dưỡng cán bộ",
            "processing_unit": _org_tag_label("chu_tich"),
            "monitoring_leader": _org_tag_label("pho_chu_tich_2"),
            "implementation_deadline": "trong 07 ngày làm việc",
            "coordinating_units": [_org_tag_label("van_thu_kt"), _org_tag_label("pho_chu_tich_2")],
            "notes": "Gửi văn bản góp ý về Sở Nội vụ"
        }
    },
    {
        "sign_number_match": "3059/QĐ-UBND",
        "data": {
            "stt": 6,
            "document_number": "3059/QĐ-UBND",
            "document_type": "Quyết định",
            "issuing_agency": "UBND Tỉnh",
            "document_date": "2026-07-15",
            "signer": "Vũ Văn F",
            "subject": "Phê duyệt danh sách tổ chức, cá nhân tham gia mạng lưới tư vấn viên pháp luật tỉnh Gia Lai",
            "summary": "Phê duyệt danh sách tổ chức, cá nhân tham gia mạng lưới tư vấn viên pháp luật tỉnh Gia Lai",
            "processing_unit": _org_tag_label("ubnd_xa"),
            "monitoring_leader": _org_tag_label("chu_tich"),
            "implementation_deadline": "trong 05 ngày làm việc",
            "coordinating_units": [_org_tag_label("congan_xa"), _org_tag_label("phong_vhxh")],
            "notes": "Cập nhật danh sách tư vấn viên"
        }
    },
    {
        "sign_number_match": "5636/SYT-NVY",
        "data": {
            "stt": 7,
            "document_number": "5636/SYT-NVY",
            "document_type": "Kế hoạch",
            "issuing_agency": "Sở Y tế",
            "document_date": "2026-07-14",
            "signer": "Đặng Văn G",
            "subject": "Triển khai Kế hoạch số 261/KH-UBND ngày 26/6/2026 về thực hiện BHYT toàn dân giai đoạn mới",
            "summary": "Triển khai Kế hoạch số 261/KH-UBND ngày 26/6/2026 về thực hiện BHYT toàn dân giai đoạn mới",
            "processing_unit": _org_tag_label("tram_yte"),
            "monitoring_leader": _org_tag_label("pho_chu_tich_1"),
            "implementation_deadline": "trong 10 ngày làm việc",
            "coordinating_units": [_org_tag_label("phong_vhxh"), _org_tag_label("trungtam_hcc"), _org_tag_label("van_thu_hcc")],
            "notes": "Tuyên truyền BHYT toàn dân"
        }
    },
    {
        "sign_number_match": "8497/CAT-PV01",
        "data": {
            "stt": 8,
            "document_number": "8497/CAT-PV01",
            "document_type": "Công văn",
            "issuing_agency": "Công an tỉnh",
            "document_date": "2026-07-13",
            "signer": "Bùi Văn H",
            "subject": "Thông báo tiếp nhận văn bản hệ thống quản lý văn bản trên môi trường điện tử",
            "summary": "Thông báo tiếp nhận văn bản hệ thống quản lý văn bản trên môi trường điện tử",
            "processing_unit": _org_tag_label("pho_chu_tich_1"),
            "monitoring_leader": _org_tag_label("chu_tich"),
            "implementation_deadline": "trong 03 ngày làm việc",
            "coordinating_units": [_org_tag_label("vanphong_ubnd_hdnd"), _org_tag_label("chu_tich")],
            "notes": "Văn bản khẩn điện tử"
        }
    }
]

DEFAULT_DOC_DATA = {
    "stt": 99,
    "document_number": "999/VB-KXD",
    "document_type": "Công văn",
    "issuing_agency": "Cơ quan ban hành",
    "document_date": "2026-07-21",
    "signer": "Người ký",
    "subject": "Tự động phân tích văn bản đến",
    "summary": "Tự động phân tích văn bản đến từ hệ thống iDesk",
    "processing_unit": _org_tag_label("phong_kt"),
    "monitoring_leader": _org_tag_label("chu_tich"),
    "implementation_deadline": "trong 05 ngày làm việc",
    "coordinating_units": [_org_tag_label("vanphong_ubnd_hdnd"), _org_tag_label("phong_kt")],
    "notes": "Phân tích mặc định từ AI Mock Backend"
}

# "Database" gia lap trong bo nho: luu lai ban ghi da tra ve theo `stt`, de
# PATCH /documents/<stt> co the cap nhat dung ban ghi hien co thay vi khoi tao
# lai tu DEFAULT_DOC_DATA (bug cu lam "mat" du lieu goc).
PROCESSED_DOCS = {}


def _find_sample_by_stt(stt):
    for sample in SAMPLE_RESPONSES:
        if sample['data']['stt'] == stt:
            return sample['data'].copy()
    return None


IDENTITY_FIELDS = ('document_number', 'document_type', 'issuing_agency', 'document_date', 'signer', 'subject')


def _find_cached_by_identity(metadata):
    """Nhanh CACHE cua POST /documents/process (docs/en/docflowv2.md muc 9):
    tra dung 6 truong dinh danh, KHONG dong den file_url. Van ban da tung
    duoc xu ly (nam trong PROCESSED_DOCS) voi CUNG 6 truong nay -> tra ve
    ban ghi cu ngay, khong goi AI lai."""
    wanted = tuple(metadata.get(k) for k in IDENTITY_FIELDS)
    for data in PROCESSED_DOCS.values():
        if tuple(data.get(k) for k in IDENTITY_FIELDS) == wanted:
            return data.copy()
    return None


# ----------------------------------------------------
# 2b. POST /files/presign, PUT /files/upload/<token>, GET /files/tmp/<token>
#     (docs/en/docflowv2.md muc 2 nhanh (b), muc 6-8) — mo phong storage tam de
#     FE day file that len truoc khi goi /documents/process, thay the viec gui
#     thang link noi bo iDesk (yeu cau cookie phien dang nhap cua nguoi dung,
#     xem docs/changes/De_xuat_presigned_url.md).
# ----------------------------------------------------
ALLOWED_UPLOAD_CONTENT_TYPES = {
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
}

PRESIGN_TTL_SEC = int(os.environ.get('MOCK_PRESIGN_TTL_SEC', '600'))       # 10 phut (muc 6-7)
MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024                                    # 25 MB (muc 7)
MAX_TMP_STORAGE_BYTES = int(os.environ.get('MOCK_MAX_TMP_STORAGE_MB', '200')) * 1024 * 1024  # kho tam 200 MB

# Nhan dien file_url tro ve chinh storage tam cua server nay (khac voi 1 URL
# cong khai that su ben ngoai) de /documents/process doc thang tu bo nho theo
# token thay vi that su di fetch qua HTTP (dung nhu ghi chu o muc 8).
TMP_URL_RE = re.compile(r'^https?://[^/]+/files/tmp/([A-Za-z0-9_\-]{20,64})$')

_tmp_lock = threading.Lock()
_tmp_uploads = {}  # token -> {content_type, filename, expires_at, data: bytes|None}


def _purge_expired_tmp_uploads():
    now = time.monotonic()
    with _tmp_lock:
        expired = [t for t, e in _tmp_uploads.items() if e['expires_at'] <= now]
        for t in expired:
            del _tmp_uploads[t]


def _tmp_storage_used_bytes():
    with _tmp_lock:
        return sum(len(e['data']) for e in _tmp_uploads.values() if e.get('data'))


@app.route('/files/presign', methods=['POST'])
def files_presign():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('presign')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    _purge_expired_tmp_uploads()

    body = request.get_json(silent=True) or {}
    filename = body.get('filename', '')
    content_type = body.get('content_type', '')

    if not filename or content_type not in ALLOWED_UPLOAD_CONTENT_TYPES:
        return _error_response(
            'PRESIGN_FAILED',
            f"content_type phai la mot trong: {', '.join(sorted(ALLOWED_UPLOAD_CONTENT_TYPES))}",
            422
        )

    token = secrets.token_urlsafe(32)  # 43 ky tu tu 32 byte ngau nhien (docs muc 6)
    with _tmp_lock:
        _tmp_uploads[token] = {
            'content_type': content_type,
            'filename': filename,  # chi de log, KHONG xuat hien trong URL tra ve
            'expires_at': time.monotonic() + PRESIGN_TTL_SEC,
            'data': None
        }

    base = request.host_url.rstrip('/')
    print(f"[PRESIGN] token={token} filename={filename} content_type={content_type}")

    return jsonify({
        "upload_url": f"{base}/files/upload/{token}",
        "public_url": f"{base}/files/tmp/{token}",
        "upload_method": "PUT",
        "upload_headers": {"Content-Type": content_type},
        "expires_in": PRESIGN_TTL_SEC
    }), 200


@app.route('/files/upload/<token>', methods=['PUT'])
def files_upload(token):
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('upload')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    _purge_expired_tmp_uploads()

    with _tmp_lock:
        entry = _tmp_uploads.get(token)
    if not entry:
        return _error_response('UPLOAD_TOKEN_INVALID', 'Token khong ton tai hoac da het han', 404)

    sent_content_type = (request.content_type or '').split(';')[0].strip()
    if sent_content_type != entry['content_type']:
        return _error_response(
            'UPLOAD_CONTENT_TYPE_MISMATCH',
            f"Content-Type '{sent_content_type}' khong khop voi '{entry['content_type']}' luc presign",
            400
        )

    data = request.get_data()
    if not data:
        return _error_response('EMPTY_FILE', 'Body rong', 400)
    if len(data) > MAX_UPLOAD_FILE_BYTES:
        return _error_response('FILE_TOO_LARGE', 'File vuot qua 25 MB', 413)
    if _tmp_storage_used_bytes() + len(data) > MAX_TMP_STORAGE_BYTES:
        return _error_response('SERVER_BUSY', 'Kho tam da day (tran 200 MB), vui long thu lai sau', 503)

    with _tmp_lock:
        entry['data'] = data
    print(f"[UPLOAD] token={token} bytes={len(data)}")

    return '', 204


@app.route('/files/tmp/<token>', methods=['GET'])
def files_tmp(token):
    _purge_expired_tmp_uploads()
    with _tmp_lock:
        entry = _tmp_uploads.get(token)
    if not entry or entry.get('data') is None:
        return _error_response('UPLOAD_TOKEN_INVALID', 'Token khong ton tai, chua upload, hoac da het han', 404)

    from flask import Response
    return Response(entry['data'], mimetype=entry['content_type'])


# ----------------------------------------------------
# 2c. Danh muc co cau to chuc (Ward -> Organization -> Entry) - docs/en/docflowv2.md
#     muc 12: 4 endpoint /wards, /wards/compare, /wards/{ward_code}/organizations,
#     /organizations/{organization_id}/entries. Doc lap tu 2 file du lieu THAT da
#     co san trong repo (clean_data/payload_vinhthanh.json, payload_phumy.json -
#     cay to chuc dinh dang unit/dept/alias, xem clean_data/generate_inserts.py)
#     thay vi hard-code lai bang tay, de tranh sai lech voi du lieu goc. Doc lap
#     1 lan luc import module, KHONG phu thuoc request nao.
# ----------------------------------------------------
_CLEAN_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'clean_data'
)

WARD_SOURCE_FILES = [
    ("VINH_THANH", "payload_vinhthanh.json"),
    ("PHU_MY_TAY", "payload_phumy.json"),
]

# comparison_code duoc gan theo tu khoa trong ten don vi (muc 12.2: "Nhom theo
# comparison_code, KHONG so theo name - ten don vi giua cac xa khac cach viet
# (vd 'Van phong UBND va HDND' vs 'Van phong HDND va UBND') nen khop theo ten
# se sai"). Danh sach luat tu cu the -> chung, dung chung cho ca 2 xa.
_COMPARISON_CODE_RULES = [
    (('quân sự',), 'MILITARY_COMMAND'),
    (('công an',), 'COMMUNE_POLICE'),
    (('y tế',), 'HEALTH_STATION'),
    (('kinh tế',), 'ECONOMIC_DEPARTMENT'),
    (('thông tin', 'thể thao'), 'CULTURE_INFO_SPORTS_CENTER'),
    (('văn hóa', 'xã hội'), 'CULTURE_SOCIAL_DEPARTMENT'),
    (('hành chính công',), 'PUBLIC_ADMIN_CENTER'),
    (('lãnh đạo',), 'COMMITTEE_LEADERSHIP'),
    (('hội đồng nhân dân',), 'PEOPLE_COUNCIL'),
    (('trường',), 'SCHOOL'),
    (('bầu cử',), 'ELECTION_COMMITTEE'),
    (('thi đua',), 'EMULATION_COMMENDATION_CLUSTER'),
    (('ban quản lý',), 'MANAGEMENT_BOARD'),
    (('quản trị',), 'SYSTEM_ADMIN'),
]


def _classify_comparison_code(dept_name):
    n = (dept_name or '').lower()
    # Kiem "Van phong UBND/HDND" truoc tien vi ten nay chua ca tu "HDND" (de
    # nham voi PEOPLE_COUNCIL) lan cac tu khoa khac trong danh sach chung.
    if 'văn phòng' in n and ('ubnd' in n or 'hđnd' in n):
        return 'OFFICE_PC_PC'
    for keywords, code in _COMPARISON_CODE_RULES:
        if all(kw in n for kw in keywords):
            return code
    # Fallback an toan cho ten chua tung gap trong du lieu mau: sinh code on
    # dinh tu chinh ten thay vi loi, de danh muc moi van hien thi duoc.
    slug = re.sub(r'[^0-9a-zA-Z]+', '_', dept_name.strip()).strip('_').upper()
    return slug or 'OTHER'


def _load_ward_catalog():
    """Doc cay to chuc that (unit/dept/alias) cua tung xa tu clean_data/*.json
    va dung thanh Ward -> Organization -> Entry. Neu thieu file (vd moi truong
    deploy khong dong kem thu muc clean_data/), tra ve danh muc rong thay vi
    lam sap ca mock backend (/wards se tra data: [] thay vi loi 500 luc import).
    """
    wards = {}
    organizations_by_id = {}
    org_seq = 1
    entry_seq = 1

    for ward_code, filename in WARD_SOURCE_FILES:
        path = os.path.join(_CLEAN_DATA_DIR, filename)
        try:
            with open(path, encoding='utf-8') as f:
                elements = json.load(f).get('elements', [])
        except (OSError, ValueError):
            elements = []

        units = [e for e in elements if e.get('type') == 'unit']
        depts = [e for e in elements if e.get('type') == 'dept']
        aliases = [e for e in elements if e.get('type') == 'alias']

        # Tat ca dept trong 1 file deu co chung `parent` = id cua unit goc
        # (chinh xa do); cac unit cap tren (huyen/tinh) khong nam trong file.
        root_parent_id = depts[0].get('parent') if depts else None
        root_unit = next((u for u in units if u['id'] == root_parent_id), None)
        ward_name = root_unit['name'] if root_unit else ward_code

        organizations = []
        for dept in depts:
            dept_entries = []
            for alias in aliases:
                if alias.get('parent') != dept['id']:
                    continue
                dept_entries.append({
                    "id": entry_seq,
                    "source_id": alias['id'],
                    "position_name": alias.get('name', ''),
                    "ref_uname": alias.get('refUname', ''),
                    "ref_fullname": alias.get('refFullname', ''),
                    "rank": alias.get('rank', ''),
                    "sort_order": alias.get('order', 0),
                })
                entry_seq += 1

            org = {
                "id": org_seq,
                "source_id": dept['id'],
                "name": dept.get('name', ''),
                "comparison_code": _classify_comparison_code(dept.get('name', '')),
                "sort_order": dept.get('order', 0),
                "entries": dept_entries,
            }
            organizations.append(org)
            organizations_by_id[org_seq] = org
            org_seq += 1

        wards[ward_code] = {
            "id": len(wards) + 1,
            "code": ward_code,
            "name": ward_name,
            "organizations": organizations,
        }

    return wards, organizations_by_id


WARDS, ORGANIZATIONS_BY_ID = _load_ward_catalog()


# ----------------------------------------------------
# 3. POST /auth/token
#    Danh sach tai khoan dich vu hop le (docs/en/docflowv2.md muc 5: sai
#    tai khoan/mat khau -> 401 INVALID_CREDENTIALS). Co the override qua
#    bien moi truong MOCK_AUTH_USERNAME/MOCK_AUTH_PASSWORD; mac dinh khop
#    voi bruno/environments/Local.bru (fe-server / secret_password) de FE
#    chay duoc ngay khong can cau hinh gi them.
# ----------------------------------------------------
VALID_CREDENTIALS = {
    os.environ.get('MOCK_AUTH_USERNAME', 'fe-server-prod'): os.environ.get('MOCK_AUTH_PASSWORD', 'secret_password'),
}


@app.route('/auth/token', methods=['POST'])
def auth_token():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('auth')):
        return _error_response('RATE_LIMITED', 'Qua tan suat lay token, vui long thu lai sau', 429)

    payload = request.get_json(silent=True) or {}
    username = payload.get('username', '')
    password = payload.get('password', '')

    print(f"[AUTH] Request token for user: '{username}'")

    expected_password = VALID_CREDENTIALS.get(username)
    if expected_password is None or not secrets.compare_digest(password, expected_password):
        return _error_response(
            'INVALID_CREDENTIALS',
            'Sai ten tai khoan hoac mat khau',
            401
        )

    token = _issue_token()
    return jsonify({
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 86400
    }), 200

# ----------------------------------------------------
# 4. POST /documents/process (va cac Route Aliases)
# ----------------------------------------------------
@app.route('/documents/process', methods=['POST'])
@app.route('/api/v1/documents/process', methods=['POST'])
@app.route('/api/process-doc', methods=['POST'])
def process_document():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('process')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    print("=" * 60)
    print("RECEIVED PROCESS REQUEST FOR DOCFLOW API (v3.1)")
    print("=" * 60)

    request_data = request.get_json(silent=True)
    metadata = {}
    file_url = ""

    if request_data and isinstance(request_data, dict):
        metadata = request_data.get('metadata', {})
        file_url = request_data.get('file_url', '')
        print(f"File URL Received: {file_url}")
    else:
        # Support fallback FormData if client sends legacy format
        metadata_str = request.form.get('metadata', '{}')
        try:
            metadata = json.loads(metadata_str)
        except Exception:
            metadata = {}

        pdf_file = request.files.get('pdf')
        if pdf_file:
            pdf_dir = os.path.join(os.getcwd(), 'received_pdfs')
            os.makedirs(pdf_dir, exist_ok=True)
            save_path = os.path.join(pdf_dir, pdf_file.filename)
            pdf_file.save(save_path)
            file_url = f"file://{save_path}"

    print("\nMetadata Received:")
    print(json.dumps(metadata, indent=2))

    validation_error = _validate_identity_metadata(metadata)
    if validation_error:
        return _error_response('INVALID_PROCESS_PAYLOAD', validation_error, 422)

    if not file_url or len(file_url) > 2048:
        return _error_response('INVALID_PROCESS_PAYLOAD', 'file_url thieu hoac vuot qua 2048 ky tu', 422)

    # Nhanh CACHE (docs muc 9): tra dung 6 truong dinh danh TRUOC, KHONG kiem
    # file_url (khong SSRF-check, khong doi hoi token tmp con song). Van ban
    # da xu ly truoc do -> tra ngay ket qua cu, khong goi AI, khong tang
    # _active_jobs, khong dong den tmp storage.
    cached = _find_cached_by_identity(metadata)
    if cached is not None:
        response_payload = {"source": "cache", "data": cached}
        print("\nCache hit theo 6 truong dinh danh - tra ngay, khong goi AI")
        print(json.dumps(response_payload, indent=2, ensure_ascii=False))
        print("=" * 60)
        return jsonify(response_payload), 200

    # file_url tro ve chinh storage tam cua server nay (tra ve tu POST
    # /files/presign) thi doc thang tu bo nho theo token, KHONG bi chan boi luat
    # cam localhost o duoi — dung nhu ghi chu docs/en/docflowv2.md muc 8:
    # "backend doc bytes truc tiep tu bo nho theo token, khong di qua HTTP".
    # Cac URL khac van phai la link cong khai that su, khong duoc tro ve localhost.
    consumed_tmp_token = None
    own_tmp_match = TMP_URL_RE.match(file_url)
    if own_tmp_match:
        candidate_token = own_tmp_match.group(1)
        _purge_expired_tmp_uploads()
        with _tmp_lock:
            tmp_entry = _tmp_uploads.get(candidate_token)
        if not tmp_entry or tmp_entry.get('data') is None:
            return _error_response('INVALID_FILE_URL', 'Token upload khong ton tai, chua duoc upload, hoac da het han', 422)
        consumed_tmp_token = candidate_token
    elif '127.0.0.1' in file_url or 'localhost' in file_url:
        return _error_response('INVALID_FILE_URL', 'file_url phai la URL PDF cong khai hop le', 422)

    global _active_jobs
    with _active_jobs_lock:
        if _active_jobs >= MAX_CONCURRENT_JOBS:
            return _error_response('SERVER_BUSY', 'So van ban dang OCR/AI dong thoi da dat tran', 503)
        _active_jobs += 1

    try:
        doc_number = metadata.get('document_number', '')
        subject = metadata.get('subject', '')

        matched_data = None
        for sample in SAMPLE_RESPONSES:
            pattern = sample["sign_number_match"]
            if pattern in doc_number or pattern in subject:
                matched_data = sample["data"].copy()
                print(f"\nMatched sample for pattern: {pattern}")
                break

        if not matched_data:
            matched_data = DEFAULT_DOC_DATA.copy()
            matched_data["document_number"] = doc_number or "999/VB-KXD"
            matched_data["subject"] = subject or "Văn bản chưa khớp mẫu"
            matched_data["summary"] = f"Tóm tắt tự động cho: {subject}" if subject else "Chờ xử lý"
            # Van ban khong khop mau nao -> sinh ngau nhien processing_unit /
            # coordinating_units / monitoring_leader (tron dept/unit/alias) thay
            # vi luon tra dung 1 gia tri co dinh cua DEFAULT_DOC_DATA, de FE/QA
            # co the kiem tra duoc nhieu bien the cua tag "alias" qua nhieu lan
            # goi — bao gom ca tinh nang thêm/sửa "Lãnh đạo theo dõi" moi.
            random_processing_unit, random_coordinating_units = _random_processing_and_coordinating_units()
            random_monitoring_leader = _random_monitoring_leader()
            matched_data["processing_unit"] = random_processing_unit
            matched_data["coordinating_units"] = random_coordinating_units
            matched_data["monitoring_leader"] = random_monitoring_leader
            print("\nNo exact pattern match, using randomized default mock response")
            print(f"Random processing_unit: {random_processing_unit}")
            print(f"Random coordinating_units: {random_coordinating_units}")
            print(f"Random monitoring_leader: {random_monitoring_leader}")

        # Update dynamic fields (FE authoritative — field 2-7 theo METADATA_SCHEMA.md).
        # FE co the cao thieu 1 vai truong (xem _validate_identity_metadata da noi
        # long o tren): truong nao FE KHONG gui (rong/None) thi tra ve dung null,
        # KHONG con tu dien gia tri mau/doan tu matched_data nua — vi day la cac
        # truong FE-authoritative, tu dien vao se tao cam giac sai la "da co du
        # lieu" trong khi thuc ra van con thieu.
        for _identity_field in REQUIRED_METADATA_FIELDS:
            _val = metadata.get(_identity_field)
            matched_data[_identity_field] = _val if _val else None

        PROCESSED_DOCS[matched_data["stt"]] = matched_data.copy()

        response_payload = {
            "source": "processed",
            "data": matched_data
        }

        print("\nResponse Payload:")
        print(json.dumps(response_payload, indent=2))
        print("=" * 60)

        return jsonify(response_payload), 200
    finally:
        with _active_jobs_lock:
            _active_jobs -= 1
        # docs/en/docflowv2.md muc 7: "bi xoa ngay sau khi /documents/process xu ly
        # xong" — don don thay vi de token song het TTL 10 phut goc.
        if consumed_tmp_token:
            with _tmp_lock:
                _tmp_uploads.pop(consumed_tmp_token, None)

# ----------------------------------------------------
# 5. POST /documents/lookup
# ----------------------------------------------------
@app.route('/documents/lookup', methods=['POST'])
def lookup_document():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('lookup')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    req_body = request.get_json(silent=True)
    if not isinstance(req_body, dict):
        return _error_response('INVALID_LOOKUP_PAYLOAD', 'Body phai la mot JSON object', 422)

    validation_error = _validate_identity_metadata(req_body)
    if validation_error:
        return _error_response('INVALID_LOOKUP_PAYLOAD', validation_error, 422)

    doc_number = req_body.get('document_number', '')

    for sample in SAMPLE_RESPONSES:
        if sample["sign_number_match"] in doc_number:
            return jsonify({
                "found": True,
                "state": "completed",
                "data": sample["data"]
            }), 200

    for data in PROCESSED_DOCS.values():
        if data.get('document_number') == doc_number:
            return jsonify({
                "found": True,
                "state": "completed",
                "data": data
            }), 200

    return jsonify({
        "found": False,
        "state": "not_found",
        "data": None
    }), 200

# ----------------------------------------------------
# 6b. PATCH /documents/<stt> — nhanh loi 409 DOCUMENT_NOT_COMPLETED
#     (docs/en/docflowv2.md muc 11) truoc day chua duoc hien thuc: mock nay xu
#     ly /documents/process HOAN TOAN DONG BO nen mot van ban da nam trong
#     PROCESSED_DOCS/SAMPLE_RESPONSES la coi nhu "completed" ngay, khong bao
#     gio tu nhien roi vao trang thai "processing" giua 2 request de FE/QA
#     bat gap 409. Cho phep ep bang header X-Mock-Force-Error: NOT_COMPLETED
#     de van co the kiem thu duoc nhanh nay ma khong can dung toi mot hang doi
#     xu ly bat dong bo that su.
# ----------------------------------------------------
def _forced_not_completed():
    forced = (request.headers.get('X-Mock-Force-Error') or '').strip().upper()
    if forced == 'NOT_COMPLETED':
        return _error_response(
            'DOCUMENT_NOT_COMPLETED',
            'Van ban chua xu ly xong, chua sua duoc (ep buoc de test)',
            409
        )
    return None


# ----------------------------------------------------
# 6. PATCH /documents/<stt>
# ----------------------------------------------------
@app.route('/documents/<int:stt>', methods=['PATCH'])
def patch_document(stt):
    forced = _forced_error()
    if forced:
        return forced
    forced_not_completed = _forced_not_completed()
    if forced_not_completed:
        return forced_not_completed
    if not _check_rate_limit(_client_key('patch')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    patch_body = request.get_json(silent=True)
    if not isinstance(patch_body, dict) or not patch_body:
        return _error_response('INVALID_UPDATE_PAYLOAD', 'Body phai la JSON object va co it nhat 1 truong', 422)

    unknown_fields = [k for k in patch_body.keys() if k not in PATCHABLE_FIELDS]
    if unknown_fields:
        return _error_response(
            'INVALID_UPDATE_PAYLOAD',
            f"Chi nhan cac truong {sorted(PATCHABLE_FIELDS)}, nhan duoc truong khong hop le: {', '.join(unknown_fields)}",
            422
        )

    # Lay dung ban ghi hien co theo stt (tu du lieu da xu ly hoac du lieu mau),
    # KHONG khoi tao lai tu DEFAULT_DOC_DATA — day chinh la bug cu lam "mat" du
    # lieu goc cua van ban khi PATCH.
    existing = PROCESSED_DOCS.get(stt) or _find_sample_by_stt(stt)
    if existing is None:
        return _error_response('DOCUMENT_NOT_FOUND', f'Khong tim thay van ban co stt={stt}', 404)

    updated = existing.copy()
    for key, val in patch_body.items():
        if key == 'coordinating_units' and val is None:
            updated[key] = []  # theo docs muc 6: coordinating_units: null -> luu thanh []
        else:
            updated[key] = val

    PROCESSED_DOCS[stt] = updated
    return jsonify({"data": updated}), 200

# ----------------------------------------------------
# 7. GET /wards, /wards/compare, /wards/<ward_code>/organizations,
#    GET /organizations/<organization_id>/entries (docs/en/docflowv2.md muc 12)
#    Doc du lieu tu WARDS/ORGANIZATIONS_BY_ID (muc 2c o tren) — doc lap
#    luc import module, DOC LAP voi luong /documents/* ben tren, goi luc nao
#    cung duoc dung nhu ghi chu o dau file docs/en/docflowv2.md.
# ----------------------------------------------------
@app.route('/wards', methods=['GET'])
def list_wards():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('wards')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    data = [{
        "id": ward["id"],
        "code": ward["code"],
        "name": ward["name"],
        "organization_count": len(ward["organizations"]),
        "entry_count": sum(len(org["entries"]) for org in ward["organizations"]),
    } for ward in WARDS.values()]

    return jsonify({"data": data}), 200


@app.route('/wards/compare', methods=['GET'])
def compare_wards():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('wards_compare')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    # ?ward_code=A&ward_code=B (lap lai duoc, xem muc 12.2). Bo trong = so tat
    # ca xa. Loai trung neu FE lo gui trung ma xa.
    requested = request.args.getlist('ward_code')
    ward_codes = list(dict.fromkeys(requested)) if requested else list(WARDS.keys())

    unknown = [c for c in ward_codes if c not in WARDS]
    if unknown:
        return _error_response(
            'WARD_NOT_FOUND',
            f"Khong tim thay ma xa: {', '.join(unknown)}",
            404
        )

    # Thu thap comparison_code theo dung thu tu xuat hien dau tien trong cac
    # xa duoc chon, dam bao MOI xa duoc chon deu co mat trong tung nhom (ke ca
    # voi o 0/0) dung yeu cau "xa khong co don vi nao trong nhom van xuat hien".
    comparison_codes = []
    seen = set()
    for code in ward_codes:
        for org in WARDS[code]["organizations"]:
            if org["comparison_code"] not in seen:
                seen.add(org["comparison_code"])
                comparison_codes.append(org["comparison_code"])

    data = []
    for comp_code in comparison_codes:
        wards_field = {}
        for code in ward_codes:
            matched = [o for o in WARDS[code]["organizations"] if o["comparison_code"] == comp_code]
            wards_field[code] = {
                "organization_count": len(matched),
                "entry_count": sum(len(o["entries"]) for o in matched),
            }
        data.append({"comparison_code": comp_code, "wards": wards_field})

    return jsonify({"ward_codes": ward_codes, "data": data}), 200


@app.route('/wards/<ward_code>/organizations', methods=['GET'])
def ward_organizations(ward_code):
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('ward_orgs')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    ward = WARDS.get(ward_code)
    if ward is None:
        return _error_response('WARD_NOT_FOUND', f"Khong tim thay ma xa '{ward_code}'", 404)

    # Sap theo (sort_order, source_id) - luon dung ca 2 khoa vi sort_order mot
    # minh khong tat dinh (co xa toan bo sort_order = 0, xem muc 12.3).
    ordered = sorted(ward["organizations"], key=lambda o: (o["sort_order"], o["source_id"]))
    data = [{
        "id": o["id"],
        "source_id": o["source_id"],
        "name": o["name"],
        "comparison_code": o["comparison_code"],
        "sort_order": o["sort_order"],
        "entry_count": len(o["entries"]),
    } for o in ordered]

    return jsonify({"ward_code": ward_code, "data": data}), 200


@app.route('/organizations/<int:organization_id>/entries', methods=['GET'])
def organization_entries(organization_id):
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('org_entries')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    org = ORGANIZATIONS_BY_ID.get(organization_id)
    if org is None:
        return _error_response('ORGANIZATION_NOT_FOUND', f"Khong tim thay don vi co id={organization_id}", 404)

    # Cung ap dung (sort_order, source_id) nhu muc 12.3 de dam bao thu tu tat
    # dinh — doc khong noi ro thu tu cho 12.4 nen dung nhat quan voi 12.3.
    ordered = sorted(org["entries"], key=lambda e: (e["sort_order"], e["source_id"]))
    data = [{
        "id": e["id"],
        "source_id": e["source_id"],
        "position_name": e["position_name"],
        "ref_uname": e["ref_uname"],
        "ref_fullname": e["ref_fullname"],
        "rank": e["rank"],
        "sort_order": e["sort_order"],
    } for e in ordered]

    return jsonify({"organization_id": organization_id, "data": data}), 200


# ----------------------------------------------------
# 8. GET /health & GET /health/ready
# ----------------------------------------------------
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "DocFlow AI Mock Backend",
        "version": "3.1"
    }), 200

@app.route('/health/ready', methods=['GET'])
def health_ready():
    return jsonify({
        "status": "ready",
        "checks": {
            "database": "ok",
            "prompt": "ok",
            "ai_provider": "ok",
            "ocr_dependencies": "ok"
        }
    }), 200

if __name__ == '__main__':
    print("""
+------------------------------------------------------+
|     DocFlow AI Mock Backend v3.1 (Flask)             |
|     Running on http://localhost:5000                 |
|     Endpoint: POST /documents/process                |
|     Endpoint: POST /files/presign                    |
|     Endpoint: PUT  /files/upload/<token>              |
+------------------------------------------------------+
    """)
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
"""Offline FastAPI fixture for the real outgoing JavaScript adapter.

All registry, policy mutations, PDFs, jobs and feedback live in a temporary
directory. Production Settings.from_env() and cloud providers are never used.
"""
import argparse
from dataclasses import replace
import json
from pathlib import Path
import runpy
import sqlite3
import tempfile

import uvicorn
from fastapi import Header, HTTPException
from fastapi.responses import FileResponse
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from ai_document_sender.api import create_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", type=Path, default=Path("C:/Workspaces/ai-document-sender"))
    parser.add_argument("--port", type=int, default=8052)
    args = parser.parse_args()
    backend = args.backend.resolve()
    temporary_parent = backend / ".tmp"
    temporary_parent.mkdir(exist_ok=True)
    fixture = runpy.run_path(str(backend / "tests/conftest.py"))["settings"]

    with tempfile.TemporaryDirectory(prefix="outgoing-contract-", dir=temporary_parent) as directory:
        fixture_root = Path(directory)
        settings = fixture.__wrapped__(fixture_root)
        policy_bytes = settings.policy_path.read_bytes()
        policy_path = fixture_root / "policy.json"
        policy_path.write_bytes(policy_bytes)
        settings = replace(settings, policy_path=policy_path, provider_mode="offline", api_key="integration-test-key",
                           host="127.0.0.1", port=args.port, worker_enabled=True)
        registry_bytes = settings.lookup_db.read_bytes()

        font_path = next((path for path in (Path("C:/Windows/Fonts/arial.ttf"),
                         Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")) if path.exists()), None)
        if font_path is None:
            raise RuntimeError("A Unicode font is required for the synthetic Vietnamese PDF")
        pdfmetrics.registerFont(TTFont("ContractUnicode", str(font_path)))
        pdf_path = fixture_root / "main.pdf"
        pdf = canvas.Canvas(str(pdf_path), pagesize=(595, 842))
        pdf.setFont("ContractUnicode", 11)
        for y, text in ((770, "Tài liệu tổng hợp dùng kiểm thử tích hợp."), (250, "Nơi nhận:"),
                        (230, "- Chủ tịch UBND tỉnh;"), (210, "- Lưu: VT, V5.")):
            pdf.drawString(40, y, text)
        pdf.save()

        app = create_app(settings)

        def authorize(key):
            if key != "integration-test-key":
                raise HTTPException(status_code=401, detail="Fixture API key is required")

        @app.get("/__contract__/fixture")
        async def fixture_info(x_api_key: str | None = Header(default=None)):
            authorize(x_api_key)
            return {"pdf_path": str(pdf_path), "pdf_url": "/__contract__/fixture.pdf",
                    "fixture_root": str(fixture_root), "metadata": {
                        "document_id": "outgoing-contract-smoke", "sign_number": "1/UBND-KGVX",
                        "subject": "Synthetic integration fixture", "document_date": "2026-10-09",
                        "issuer": "UBND tỉnh Gia Lai", "department_code": "KGVX",
                        "attachment_content_uid": "synthetic-attachment", "attachment_name": "main.pdf"}}

        @app.get("/__contract__/fixture.pdf")
        async def fixture_pdf(x_api_key: str | None = Header(default=None)):
            authorize(x_api_key)
            return FileResponse(pdf_path, media_type="application/pdf", filename="main.pdf")

        @app.post("/__contract__/version/{kind}")
        async def version(kind: str, x_api_key: str | None = Header(default=None)):
            authorize(x_api_key)
            if kind == "registry":
                with sqlite3.connect(settings.lookup_db) as connection:
                    connection.execute("UPDATE recipients SET full_name=full_name || ' (fixture revision)' WHERE recipient_id='internal_341'")
            elif kind == "policy":
                policy = json.loads(policy_path.read_text(encoding="utf-8-sig"))
                policy["contract_fixture_revision"] = policy.get("contract_fixture_revision", 0) + 1
                policy_path.write_text(json.dumps(policy, ensure_ascii=False), encoding="utf-8")
            elif kind == "reset":
                settings.lookup_db.write_bytes(registry_bytes)
                policy_path.write_bytes(policy_bytes)
            else:
                raise HTTPException(status_code=404, detail="Unknown fixture version kind")
            return {"changed": kind}

        print(json.dumps({"fixture_root": str(fixture_root), "pdf_path": str(pdf_path),
                          "base_url": f"http://127.0.0.1:{args.port}", "mode": "offline"}), flush=True)
        uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()

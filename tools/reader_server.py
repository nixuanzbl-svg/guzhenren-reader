#!/usr/bin/env python3
"""Small local HTTP server for the public Gu Zhen Ren comic reader."""

from __future__ import annotations

import argparse
import cgi
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse


SESSION_COOKIE = "gzr_admin_session"
SESSION_TTL_SECONDS = 12 * 60 * 60
MAX_UPLOAD_BYTES = 500 * 1024 * 1024


def json_bytes(data: Any) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def default_paths() -> tuple[Path, Path, Path]:
    tools_root = Path(__file__).resolve().parent
    reader_root = tools_root.parent / "web"
    project_root = tools_root.parents[2]
    pdf_root = project_root / "pdf"
    password_file = tools_root / "admin-password.local.txt"
    return reader_root, pdf_root, password_file


def ensure_admin_password(password_file: Path) -> str:
    if password_file.exists():
        password = password_file.read_text(encoding="utf-8-sig").strip().lstrip("\ufeff")
        if password:
            return password

    password = secrets.token_urlsafe(18)
    password_file.write_text(password + "\n", encoding="utf-8")
    print(f"Created developer password file: {password_file}", flush=True)
    print(f"Developer password: {password}", flush=True)
    return password


def safe_file_name(name: str) -> str:
    name = Path(name).name.strip()
    if not name:
        raise ValueError("文件名为空。")
    if "/" in name or "\\" in name:
        raise ValueError("文件名不能包含路径分隔符。")
    if any(ord(ch) < 32 for ch in name):
        raise ValueError("文件名不能包含控制字符。")
    if name in {".", ".."} or ".." in Path(name).parts:
        raise ValueError("文件名非法。")
    if not name.lower().endswith(".pdf"):
        raise ValueError("只允许上传 PDF 文件。")
    return name


def chinese_to_number(text: str) -> int | None:
    text = text.strip()
    if not text:
        return None
    text = text.replace("两", "二").replace("〇", "零").replace("○", "零")
    digits = {
        "零": 0,
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100, "千": 1000}
    if all(ch in digits for ch in text):
        value = 0
        for ch in text:
            value = value * 10 + digits[ch]
        return value

    total = 0
    section = 0
    number = 0
    found = False
    for ch in text:
        if ch in digits:
            number = digits[ch]
            found = True
        elif ch in units:
            found = True
            unit = units[ch]
            section += (number or 1) * unit
            number = 0
        else:
            return None
    total += section + number
    return total if found else None


def extract_chapter_number(file_name: str) -> int | None:
    stem = Path(file_name).stem
    match = re.search(r"第\s*([0-9]+)\s*章", stem)
    if match:
        return int(match.group(1))
    match = re.search(r"第\s*([零〇○一二两三四五六七八九十百千]+)\s*章", stem)
    if match:
        return chinese_to_number(match.group(1))
    match = re.search(r"(?:chapter|ch)\s*([0-9]+)", stem, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def chapter_record(pdf_root: Path, file_path: Path) -> dict[str, Any]:
    stat = file_path.stat()
    chapter_number = extract_chapter_number(file_path.name)
    if chapter_number is not None:
        chapter_id = f"chapter-{chapter_number}"
    else:
        digest = hashlib.sha1(file_path.name.encode("utf-8")).hexdigest()[:12]
        chapter_id = f"pdf-{digest}"
    return {
        "id": chapter_id,
        "chapterNumber": chapter_number,
        "title": file_path.stem,
        "fileName": file_path.name,
        "size": stat.st_size,
        "mtime": int(stat.st_mtime * 1000),
        "pdfUrl": "/pdf/" + quote(file_path.name),
    }


def list_chapters(pdf_root: Path) -> dict[str, Any]:
    pdf_root.mkdir(parents=True, exist_ok=True)
    files = [path for path in pdf_root.iterdir() if path.is_file() and path.suffix.lower() == ".pdf"]
    chapters = [chapter_record(pdf_root, path) for path in files]

    def sort_key(chapter: dict[str, Any]) -> tuple[int, int, str]:
        number = chapter.get("chapterNumber")
        return (0, int(number), chapter["title"]) if isinstance(number, int) else (1, 0, chapter["title"])

    chapters.sort(key=sort_key)
    max_mtime = max((chapter["mtime"] for chapter in chapters), default=0)
    updated_at = datetime.fromtimestamp(max_mtime / 1000, tz=timezone.utc).astimezone().isoformat() if max_mtime else ""
    return {
        "version": f"{len(chapters)}-{max_mtime}",
        "updatedAt": updated_at,
        "chapters": chapters,
    }


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}
    body = handler.rfile.read(length)
    return json.loads(body.decode("utf-8"))


def make_handler(reader_root: Path, pdf_root: Path, admin_password: str):
    sessions: dict[str, float] = {}

    class ReaderHandler(BaseHTTPRequestHandler):
        server_version = "GuzhenrenReader/1.0"

        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("%s - - [%s] %s\n" % (
                self.client_address[0],
                self.log_date_time_string(),
                fmt % args,
            ))

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            try:
                if path == "/api/chapters":
                    return self.send_json(list_chapters(pdf_root), cache=False)
                if path == "/api/admin/session":
                    return self.send_json({"authenticated": self.is_authenticated()}, cache=False)
                if path.startswith("/pdf/"):
                    return self.serve_pdf(path[len("/pdf/"):])
                return self.serve_static(path)
            except Exception as error:
                self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            try:
                if path == "/api/admin/login":
                    return self.handle_login()
                if path == "/api/admin/pdfs":
                    return self.handle_upload()
                self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在。")
            except ValueError as error:
                self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
            except Exception as error:
                self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))

        def handle_login(self) -> None:
            data = parse_json_body(self)
            password = str(data.get("password") or "")
            if not hmac.compare_digest(password, admin_password):
                return self.send_error_json(HTTPStatus.UNAUTHORIZED, "口令错误。")

            token = secrets.token_urlsafe(32)
            sessions[token] = time.time() + SESSION_TTL_SECONDS
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Set-Cookie",
                f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax",
            )
            payload = json_bytes({"authenticated": True})
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def handle_upload(self) -> None:
            if not self.is_authenticated():
                return self.send_error_json(HTTPStatus.UNAUTHORIZED, "需要开发者登录。")
            content_length = int(self.headers.get("Content-Length") or "0")
            if content_length <= 0:
                return self.send_error_json(HTTPStatus.BAD_REQUEST, "没有收到上传内容。")
            if content_length > MAX_UPLOAD_BYTES:
                return self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "上传内容过大。")

            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": str(content_length),
                },
            )
            fields = form["files"] if "files" in form else []
            if not isinstance(fields, list):
                fields = [fields]
            if not fields:
                return self.send_error_json(HTTPStatus.BAD_REQUEST, "请选择 PDF 文件。")

            current = list_chapters(pdf_root)["chapters"]
            existing_names = {chapter["fileName"].casefold() for chapter in current}
            existing_numbers = {
                chapter["chapterNumber"]
                for chapter in current
                if isinstance(chapter.get("chapterNumber"), int)
            }
            seen_names: set[str] = set()
            seen_numbers: set[int] = set()
            results = []

            for field in fields:
                if not getattr(field, "filename", ""):
                    continue
                original_name = field.filename
                try:
                    file_name = safe_file_name(original_name)
                    folded_name = file_name.casefold()
                    chapter_number = extract_chapter_number(file_name)
                    if folded_name in existing_names or folded_name in seen_names:
                        raise ValueError("已存在同名 PDF。")
                    if isinstance(chapter_number, int):
                        if chapter_number in existing_numbers or chapter_number in seen_numbers:
                            raise ValueError(f"第 {chapter_number} 章已经存在。")
                        seen_numbers.add(chapter_number)

                    target = pdf_root / file_name
                    temp = pdf_root / f".uploading-{secrets.token_hex(8)}.tmp"
                    with temp.open("xb") as output:
                        shutil.copyfileobj(field.file, output)
                    if temp.stat().st_size <= 0:
                        temp.unlink(missing_ok=True)
                        raise ValueError("PDF 文件为空。")
                    os.replace(temp, target)
                    seen_names.add(folded_name)
                    results.append({
                        "fileName": file_name,
                        "chapterNumber": chapter_number,
                        "status": "uploaded",
                        "size": target.stat().st_size,
                    })
                except Exception as error:
                    results.append({
                        "fileName": original_name,
                        "status": "error",
                        "message": str(error),
                    })

            return self.send_json({
                "results": results,
                "catalog": list_chapters(pdf_root),
            }, cache=False)

        def serve_pdf(self, encoded_name: str) -> None:
            try:
                file_name = safe_file_name(unquote(encoded_name))
            except ValueError:
                return self.send_error_json(HTTPStatus.BAD_REQUEST, "PDF 路径非法。")
            path = (pdf_root / file_name).resolve()
            if path.parent != pdf_root.resolve() or not path.exists() or not path.is_file():
                return self.send_error_json(HTTPStatus.NOT_FOUND, "PDF 不存在。")
            self.send_file(path, "application/pdf", cache=True)

        def serve_static(self, requested_path: str) -> None:
            if requested_path in {"", "/"}:
                requested_path = "/index.html"
            if requested_path == "/admin":
                requested_path = "/admin.html"
            relative = unquote(requested_path.lstrip("/"))
            if not relative:
                relative = "index.html"
            path = (reader_root / relative).resolve()
            root = reader_root.resolve()
            if root not in path.parents and path != root:
                return self.send_error(HTTPStatus.FORBIDDEN)
            if not path.exists() or not path.is_file():
                return self.send_error(HTTPStatus.NOT_FOUND)
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_file(path, content_type, cache=not path.name.endswith(".html"))

        def send_file(self, path: Path, content_type: str, cache: bool) -> None:
            stat = path.stat()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
            self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
            self.end_headers()
            with path.open("rb") as file:
                shutil.copyfileobj(file, self.wfile)

        def send_json(self, data: Any, cache: bool) -> None:
            payload = json_bytes(data)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "public, max-age=15" if cache else "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def send_error_json(self, status: HTTPStatus, message: str) -> None:
            payload = json_bytes({"error": message})
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def is_authenticated(self) -> bool:
            cookie_header = self.headers.get("Cookie") or ""
            cookie = SimpleCookie()
            cookie.load(cookie_header)
            token = cookie.get(SESSION_COOKIE)
            if not token:
                return False
            value = token.value
            expires_at = sessions.get(value)
            if not expires_at:
                return False
            if expires_at < time.time():
                sessions.pop(value, None)
                return False
            sessions[value] = time.time() + SESSION_TTL_SECONDS
            return True

    return ReaderHandler


def parse_args() -> argparse.Namespace:
    reader_root, pdf_root, password_file = default_paths()
    parser = argparse.ArgumentParser(description="Serve the Gu Zhen Ren comic reader.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--reader-root", type=Path, default=reader_root)
    parser.add_argument("--pdf-root", type=Path, default=pdf_root)
    parser.add_argument("--password-file", type=Path, default=password_file)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    reader_root = args.reader_root.resolve()
    pdf_root = args.pdf_root.resolve()
    password_file = args.password_file.resolve()
    if not reader_root.exists():
        raise SystemExit(f"Reader root does not exist: {reader_root}")
    pdf_root.mkdir(parents=True, exist_ok=True)
    password_file.parent.mkdir(parents=True, exist_ok=True)
    admin_password = ensure_admin_password(password_file)
    handler = make_handler(reader_root, pdf_root, admin_password)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving reader on http://{args.host}:{args.port}/", flush=True)
    print(f"PDF root: {pdf_root}", flush=True)
    print(f"Admin password file: {password_file}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

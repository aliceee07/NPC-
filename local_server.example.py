#!/usr/bin/env python3
"""
本地开发服务器示例（复制为 local_server.py 使用，已在 .gitignore 中）。

  python local_server.example.py
  # 或复制后: python local_server.py

提供：
  POST /api/log          — 追加 NDJSON 审计日志（与 audit-log.js 一致）
  GET  /api/logs/ndjson  — 读取 logs/*.ndjson 供 log-restore.js 续接存档
"""

from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent
LOGS_DIR = ROOT / "logs"

ALLOWED_FEATURES = frozenset({
    "dialogue_npc",
    "api_connectivity_test",
    "ending_stage3",
    "loop_memory",
    "subconscious_settlement",
    "diary_generation",
    "artifact_registry",
})

FEATURE_RE = re.compile(r"^[a-z0-9_]+$")
MAX_BODY_BYTES = 2 * 1024 * 1024


def send_cors(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        send_cors(self)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/logs/ndjson":
            self._handle_logs_ndjson(parsed)
            return
        self._json_response(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/api/log":
            self._json_response(404, {"ok": False, "error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY_BYTES:
            self._json_response(413, {"ok": False, "error": "payload_too_large"})
            return
        raw = self.rfile.read(length)
        try:
            entry = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json_response(400, {"ok": False, "error": "invalid_json"})
            return
        feature = entry.get("feature")
        if feature not in ALLOWED_FEATURES or not FEATURE_RE.match(str(feature)):
            self._json_response(400, {"ok": False, "error": "invalid_feature"})
            return
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        path = LOGS_DIR / ("%s.ndjson" % feature)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        log_id = entry.get("log_id", "")
        self._json_response(200, {
            "ok": True,
            "log_id": log_id,
            "path": "logs/%s.ndjson" % feature,
        })

    def _handle_logs_ndjson(self, parsed) -> None:
        qs = parse_qs(parsed.query)
        raw_features = qs.get("features", [""])[0]
        if raw_features.strip():
            names = [f.strip() for f in raw_features.split(",") if f.strip()]
        else:
            names = sorted(ALLOWED_FEATURES)
        invalid = [f for f in names if f not in ALLOWED_FEATURES]
        if invalid:
            self._json_response(400, {"ok": False, "error": "invalid_feature", "invalid": invalid})
            return
        lines = []
        for name in names:
            path = LOGS_DIR / ("%s.ndjson" % name)
            if not path.is_file():
                continue
            with path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        lines.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        self._json_response(200, {"ok": True, "lines": lines, "count": len(lines)})

    def _json_response(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        send_cors(self)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    os.chdir(ROOT)
    server = HTTPServer((HOST, PORT), Handler)
    print("NPC local server at http://%s:%d (logs -> %s)" % (HOST, PORT, LOGS_DIR))
    server.serve_forever()


if __name__ == "__main__":
    main()

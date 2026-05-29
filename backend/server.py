"""
NPC 项目后端服务（FastAPI + SQLite + uvicorn）
设计文档：§2.7 API 路由详细设计
"""
from __future__ import annotations

import os
import re
import json
import time
import uuid
import sqlite3
import logging
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import bcrypt
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

# ────────────────────────────────────────────────────────────
#  配置
# ────────────────────────────────────────────────────────────

load_dotenv()

SERVER_PORT        = int(os.getenv("SERVER_PORT", "8090"))
DB_PATH            = os.getenv("DB_PATH", "./data/npc.db")
ADMIN_TOKEN        = os.getenv("ADMIN_TOKEN", "")
CORS_ORIGINS_RAW   = os.getenv("CORS_ORIGINS", "http://127.0.0.1:8765,http://localhost:3000")
LOG_DIR            = os.getenv("LOG_DIR", "./logs")
LOG_DIR_MAX_MB     = int(os.getenv("LOG_DIR_MAX_MB", "500"))
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_LOG_PER_USER_PER_MIN", "60"))
VERSION            = "1.0.0"

CORS_ORIGINS = [s.strip() for s in CORS_ORIGINS_RAW.split(",") if s.strip()]

LOG_DIR_MAX_BYTES = LOG_DIR_MAX_MB * 1024 * 1024
MAX_LOG_BODY_BYTES = 2 * 1024 * 1024  # 2 MB 单条上限

ALLOWED_LOG_FEATURES = {
    "dialogue_npc", "api_connectivity_test", "ending_stage3",
    "loop_memory", "subconscious_settlement", "diary_generation", "artifact_registry",
}
FEATURE_RE = re.compile(r"^[a-z0-9_]+$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("npc-server")

# ────────────────────────────────────────────────────────────
#  速率限制（内存）
# ────────────────────────────────────────────────────────────

_rate_counters: dict[str, list[float]] = defaultdict(list)

def _check_rate_limit(key: str, limit: int, window_secs: int = 60) -> bool:
    """返回 True 表示通过，False 表示超限。"""
    now = time.time()
    events = _rate_counters[key]
    # 清理过期记录
    _rate_counters[key] = [t for t in events if now - t < window_secs]
    if len(_rate_counters[key]) >= limit:
        return False
    _rate_counters[key].append(now)
    return True

# ────────────────────────────────────────────────────────────
#  数据库
# ────────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db(conn: sqlite3.Connection):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id      TEXT PRIMARY KEY,
            nickname     TEXT UNIQUE NOT NULL,
            pin_hash     TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            last_seen_at TEXT
        );

        CREATE TABLE IF NOT EXISTS sessions (
            session_token TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL REFERENCES users(user_id),
            created_at    TEXT NOT NULL,
            expires_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS saves (
            user_id              TEXT PRIMARY KEY REFERENCES users(user_id),
            archive_version      INTEGER NOT NULL DEFAULT 2,
            current_stage_id     TEXT,
            completed_stage_ids  TEXT,
            legacy_loop_index    INTEGER,
            mutable_subconscious TEXT,
            dialogue_histories   TEXT,
            notebook_pages       TEXT,
            session_id           TEXT,
            updated_at           TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backup_saves (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            saved_data TEXT NOT NULL,
            saved_at   TEXT NOT NULL
        );
    """)
    conn.commit()


# 全局连接（单 worker 模式）
_db: Optional[sqlite3.Connection] = None


def get_global_db() -> sqlite3.Connection:
    global _db
    if _db is None:
        _db = get_db()
        init_db(_db)
    return _db

# ────────────────────────────────────────────────────────────
#  FastAPI 应用
# ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    db = get_global_db()
    logger.info(f"NPC Server started — DB: {DB_PATH}, LOG_DIR: {LOG_DIR}")
    yield
    if db:
        db.close()


app = FastAPI(title="NPC Server", version=VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ────────────────────────────────────────────────────────────
#  鉴权辅助
# ────────────────────────────────────────────────────────────

def verify_bearer(request: Request) -> str:
    """校验 Authorization: Bearer token，返回对应 user_id，否则抛 401。"""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = auth[len("Bearer "):]
    db = get_global_db()
    row = db.execute(
        "SELECT user_id, expires_at FROM sessions WHERE session_token = ?", (token,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session token")
    if row["expires_at"]:
        exp = datetime.fromisoformat(row["expires_at"])
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=401, detail="Session expired")
    return row["user_id"]


def verify_admin(request: Request):
    """校验 X-Admin-Token。"""
    token = request.headers.get("X-Admin-Token", "")
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Admin token required")


# ────────────────────────────────────────────────────────────
#  磁盘容量检查
# ────────────────────────────────────────────────────────────

def check_log_dir_size() -> bool:
    try:
        total = sum(
            os.path.getsize(os.path.join(LOG_DIR, f))
            for f in os.listdir(LOG_DIR) if f.endswith(".ndjson")
        )
        return total <= LOG_DIR_MAX_BYTES
    except Exception:
        return True  # 检查失败时允许写入


# ────────────────────────────────────────────────────────────
#  Pydantic Models
# ────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    nickname: str
    pin: str  # 4 位数字字符串


class SaveObject(BaseModel):
    archive_version: Optional[int] = 2
    current_stage_id: Optional[str] = None
    completed_stage_ids: Optional[list] = None
    legacy_loop_index: Optional[int] = None
    loop_index: Optional[int] = None
    mutableSubconscious: Optional[dict] = None
    characters: Optional[dict] = None
    notebook: Optional[list] = None
    summary: Optional[str] = None
    ran_at: Optional[str] = None
    session_id: Optional[str] = None


# ────────────────────────────────────────────────────────────
#  /api/health
# ────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"ok": True, "version": VERSION}


# ────────────────────────────────────────────────────────────
#  /api/user/login  （注册 or 登录）
# ────────────────────────────────────────────────────────────

@app.post("/api/user/login")
async def user_login(body: LoginRequest):
    nickname = body.nickname.strip()
    pin = body.pin.strip()

    if not nickname or len(nickname) > 50:
        return JSONResponse({"ok": False, "error": "invalid_nickname"}, status_code=400)
    if not re.match(r"^\d{4}$", pin):
        return JSONResponse({"ok": False, "error": "pin_must_be_4_digits"}, status_code=400)

    db = get_global_db()
    row = db.execute("SELECT user_id, pin_hash FROM users WHERE nickname = ?", (nickname,)).fetchone()

    now_iso = datetime.now(timezone.utc).isoformat()
    is_new = False

    if row is None:
        # 新用户：注册
        user_id = str(uuid.uuid4())
        pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
        db.execute(
            "INSERT INTO users (user_id, nickname, pin_hash, created_at, last_seen_at) VALUES (?,?,?,?,?)",
            (user_id, nickname, pin_hash, now_iso, now_iso)
        )
        db.commit()
        is_new = True
    else:
        # 已有用户：校验 PIN
        if not bcrypt.checkpw(pin.encode(), row["pin_hash"].encode()):
            return JSONResponse({"ok": False, "error": "wrong_pin"}, status_code=401)
        user_id = row["user_id"]
        db.execute("UPDATE users SET last_seen_at = ? WHERE user_id = ?", (now_iso, user_id))
        db.commit()

    # 生成 session_token
    import secrets
    session_token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    db.execute(
        "INSERT INTO sessions (session_token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (session_token, user_id, now_iso, expires_at)
    )
    db.commit()

    return {
        "ok": True,
        "user_id": user_id,
        "nickname": nickname,
        "session_token": session_token,
        "is_new": is_new,
    }


# ────────────────────────────────────────────────────────────
#  /api/user/{user_id}/save  （读/写）
# ────────────────────────────────────────────────────────────

@app.get("/api/user/{user_id}/save")
async def load_save(user_id: str, request: Request):
    authed_user_id = verify_bearer(request)
    if authed_user_id != user_id:
        raise HTTPException(status_code=401, detail="user_id mismatch")

    db = get_global_db()
    row = db.execute("SELECT * FROM saves WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {"ok": True, "save": None, "updated_at": None}

    save = dict(row)
    # JSON 字段反序列化
    for field in ("completed_stage_ids", "mutable_subconscious", "notebook_pages"):
        if save.get(field):
            try:
                save[field] = json.loads(save[field])
            except Exception:
                save[field] = None

    return {"ok": True, "save": save, "updated_at": save.get("updated_at")}


@app.put("/api/user/{user_id}/save")
async def push_save(user_id: str, body: SaveObject, request: Request):
    authed_user_id = verify_bearer(request)
    if authed_user_id != user_id:
        raise HTTPException(status_code=401, detail="user_id mismatch")

    db = get_global_db()

    # 备份旧存档
    old = db.execute("SELECT * FROM saves WHERE user_id = ?", (user_id,)).fetchone()
    if old:
        db.execute(
            "INSERT INTO backup_saves (user_id, saved_data, saved_at) VALUES (?,?,?)",
            (user_id, json.dumps(dict(old)), datetime.now(timezone.utc).isoformat())
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    body_dict = body.dict()

    completed_ids_json = json.dumps(body_dict.get("completed_stage_ids") or [])
    mutable_json = json.dumps(body_dict.get("mutableSubconscious") or body_dict.get("characters") or {})
    notebook_json = json.dumps(body_dict.get("notebook") or [])
    legacy_loop = body_dict.get("legacy_loop_index") or body_dict.get("loop_index")

    db.execute("""
        INSERT INTO saves
          (user_id, archive_version, current_stage_id, completed_stage_ids,
           legacy_loop_index, mutable_subconscious, notebook_pages, session_id, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
          archive_version      = excluded.archive_version,
          current_stage_id     = excluded.current_stage_id,
          completed_stage_ids  = excluded.completed_stage_ids,
          legacy_loop_index    = excluded.legacy_loop_index,
          mutable_subconscious = excluded.mutable_subconscious,
          notebook_pages       = excluded.notebook_pages,
          session_id           = excluded.session_id,
          updated_at           = excluded.updated_at
    """, (
        user_id,
        body_dict.get("archive_version") or 2,
        body_dict.get("current_stage_id"),
        completed_ids_json,
        legacy_loop,
        mutable_json,
        notebook_json,
        body_dict.get("session_id"),
        now_iso,
    ))
    db.commit()
    return {"ok": True, "updated_at": now_iso}


# ────────────────────────────────────────────────────────────
#  /api/user/{user_id}/export
# ────────────────────────────────────────────────────────────

@app.get("/api/user/{user_id}/export")
async def export_save(user_id: str, request: Request):
    authed_user_id = verify_bearer(request)
    if authed_user_id != user_id:
        raise HTTPException(status_code=401, detail="user_id mismatch")

    db = get_global_db()
    row = db.execute("SELECT * FROM saves WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No save found")

    save = dict(row)
    for field in ("completed_stage_ids", "mutable_subconscious", "notebook_pages"):
        if save.get(field):
            try:
                save[field] = json.loads(save[field])
            except Exception:
                save[field] = None
    return save


# ────────────────────────────────────────────────────────────
#  /api/log
# ────────────────────────────────────────────────────────────

@app.post("/api/log")
async def write_log(request: Request):
    body_bytes = await request.body()
    if len(body_bytes) > MAX_LOG_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Log entry too large (max 2MB)")

    if not check_log_dir_size():
        logger.warning("Log directory exceeded %d MB, rejecting write", LOG_DIR_MAX_MB)
        raise HTTPException(status_code=507, detail="Log storage full")

    try:
        entry = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    feature = entry.get("feature", "")
    if not feature or feature not in ALLOWED_LOG_FEATURES or not FEATURE_RE.match(feature):
        raise HTTPException(status_code=400, detail="Unknown or invalid feature")

    # 速率限制
    user_id = entry.get("user_id") or None
    if user_id:
        key = f"log:user:{user_id}"
        limit = RATE_LIMIT_PER_MIN
    else:
        # 匿名：按 IP 限速，10/min
        client_ip = request.client.host if request.client else "unknown"
        key = f"log:ip:{client_ip}"
        limit = 10

    if not _check_rate_limit(key, limit):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.path.join(LOG_DIR, f"{feature}.ndjson")
    log_id = entry.get("log_id") or str(uuid.uuid4())
    entry["log_id"] = log_id

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {"ok": True, "log_id": log_id, "path": f"logs/{feature}.ndjson"}


# ────────────────────────────────────────────────────────────
#  /api/logs/ndjson  （本地 log-restore.js 用，兼容旧接口）
# ────────────────────────────────────────────────────────────

@app.get("/api/logs/ndjson")
async def get_logs_ndjson(features: str = ""):
    feature_list = [f.strip() for f in features.split(",") if f.strip()]
    if not feature_list:
        feature_list = list(ALLOWED_LOG_FEATURES)

    all_lines = []
    for feature in feature_list:
        if feature not in ALLOWED_LOG_FEATURES:
            continue
        log_path = os.path.join(LOG_DIR, f"{feature}.ndjson")
        if not os.path.exists(log_path):
            continue
        with open(log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    all_lines.append(json.loads(line))
                except Exception:
                    pass

    return {"ok": True, "lines": all_lines}


# ────────────────────────────────────────────────────────────
#  /api/admin/users
# ────────────────────────────────────────────────────────────

@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    verify_admin(request)
    db = get_global_db()
    rows = db.execute(
        "SELECT user_id, nickname, created_at, last_seen_at FROM users ORDER BY created_at DESC"
    ).fetchall()
    return {"ok": True, "users": [dict(r) for r in rows]}


# ────────────────────────────────────────────────────────────
#  入口
# ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=SERVER_PORT, log_level="info")

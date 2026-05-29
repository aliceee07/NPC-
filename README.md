# 流浪者与三个路人 · V2

一个**轮回叙事 RPG Demo**。玩家扮演一个在生日当天被杀的女孩，反复回到同一条街道，与三个见死不救的旁观者对话，试图通过理解他们走向释然。完整游戏分为「初入迷茫 / 寻找真相 / 完善记忆画像 / 寻找结束轮回的方法 / 送花超度 / 反杀凶手」六个阶段；V2 Demo 覆盖前两个阶段，并加入了阶段三的入口（笔记本系统）。

---

## 近期更新（2026-05-19 ~ 2026-05-28）

| 日期 | 内容 |
|---|---|
| 05-19 | **F-004** 跨周目 AI 日记本（第 2 周目起；7–8 周目 `<del>` 模糊化；终局与 summary 并行生成） |
| 05-19 | **F-005** NPC 多周目静态感受补丁（`npc-loop-memory.js`）+ 动态 impression 双层叠加 |
| 05-21 前后 | **架构 Phase 1–3**：`stageId` 目录表、存档 **v2 schema**、昵称+PIN 云端存档（`backend/server.py`） |
| 05-27 | **`dialogue.js` 拆分为 `dialogue/` 子模块**（`window.DialogueState` 对外 API 不变） |
| 05-28 | **`log-restore.js` 已接入**；续档后笔记本图标可见性修复；测试 mock（quick reply + 占位日记）按真实运行日志重写 |

更细的条目见策划本地笔记 `dev-notes/03_update-log.md`（该目录默认不提交）。

---

## V2 机制速览

- **多周目系统**：sessionStorage 自动续档，archive 跨周目持久化；入场四句旁白随周目动态切换。
- **跨周目笔记本（F-004）**：第 2 周目起 AI 生成第一人称日记（7–8 模糊化、9/10 终局约束）。
- **NPC 跨周目记忆（F-005）**：静态感受补丁 + 动态 impression 双层叠加。
- **线性 NPC 出场**、**quick reply chip**、**尾声花店暗示**。
- **存档 v2 + stageId**：`stage-catalog.js` 映射周目与阶段；旧 v1 导入经 `loop.js` 三路径升级。
- **Phase 3（可选）**：昵称 + PIN 登录，云端 push/load 存档（`backend/server.py`）。
- **日志续接（可选）**：`log-restore.js` 已从 NDJSON 重建 archive；周目选择页「继续上一段记忆」与登录兜底可消费（需本地 `POST /api/log` 服务写入日志）。

V1 核心机制不变：**Context Memory**、**candor 颜色**、**三种心理原型**。

### 前端模块（加载顺序见 `ARCHITECTURE.md`）

配置与周目数据：`characters.js` → `stage-catalog.js` → `npc-loop-memory.js` → `notebook-config.js` → `loop-script.js` → … → `audit-log.js` → `log-restore.js` → **`dialogue/`**（8 个子脚本）→ `dialogue.js`（bootstrap）→ `ending.js` → `loop.js`。

---

## 快速开始

### 1. 配置

```bash
cp config.example.js config.local.js
# 编辑 config.local.js，填入 Gemini 或 SiliconFlow 的 API Key
```

### 2. 启动（纯本地，推荐先这样验收）

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

未配置 `NPC_CLOUD_BASE_URL` 时**不会**出现登录遮罩，直接进入周目选择。

### 3. 测试模式（无需 API Key）

浏览器控制台：

```js
localStorage.setItem('npc_test_mode', '1')
```

刷新后可用「测试：跳转到指定周目」快速走 1–10 弧线；命中当周 quick reply 文本时会走 `loop-script.js` 中的 mock 回复与占位日记。

### 4. 可选：云端存档 + 审计日志

**纯本地（默认）**：不配置 `NPC_CLOUD_BASE_URL` → 无登录遮罩，终局续档走 `sessionStorage`。

**云端存档**：需**额外**启动 FastAPI（可与一键启动并存）：

```bash
cd backend
cp .env.example .env   # 确认 CORS_ORIGINS 含你打开页面的 origin（如 http://127.0.0.1:8765）
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 8090
```

在 `config.local.js` 中设置（且不要启用 `NPC_SKIP_LOGIN`）：

```js
window.NPC_CLOUD_BASE_URL = "http://127.0.0.1:8090";
```

刷新后应出现**登录遮罩**（「继续上一段记忆 / 开启新的记忆」）。验收步骤见 **dev-notes/00_acceptance-checklist.md §7.0–7.8**。

**本地 NDJSON 审计日志**（对话/终局 prompt 全量记录；一键启动通常已包含 8765 服务）：

```bash
cp local_server.example.py local_server.py
python local_server.py   # http://127.0.0.1:8765 — POST /api/log、GET /api/logs/ndjson
```

未配云端时日志写入项目根 `logs/`；配云端后写入后端 `LOG_DIR`（默认 `backend/logs/`）。写入后可在周目入口用「继续上一段记忆」续接（见清单 §2.7、§8.5）。

### 5. 架构烟测（零依赖 Node）

```bash
node scripts/architecture-smoke.js
```

校验 `index.html` script 顺序与 `window.DialogueState` API 形状。

---

## 验收

人工浏览器验收请使用策划本地清单：**dev-notes/00_acceptance-checklist.md**（默认不提交；可复制到 issue 使用）。

---

## 相关子项目

| 路径 | 说明 |
|---|---|
| [game-pet-agent/](game-pet-agent/) | 独立 Demo：截图 → VLM → 键鼠执行，与主游戏无 script 依赖 |
| [backend/](backend/) | Phase 3 FastAPI + SQLite 云端存档服务 |

---

## 文档

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 模块边界、数据流、Phase 1–3、`dialogue/` 拆分 |
| [AI_DEV_WORKFLOW.md](AI_DEV_WORKFLOW.md) | AI 协作与三 Agent 流 |

---

**[在线 Demo](https://npcdemov1.vercel.app)** · [GitHub](https://github.com/aliceee07/NPC-)

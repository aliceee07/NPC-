# ARCHITECTURE.md
> **Source of Truth** — 供未来 AI 或人类开发者使用的架构参考文档。
> 生成日期：2026-03-05 | 最后更新：2026-05-28 | 审查者：资深架构师（AI）

---

## 1. 项目概述 (Project Overview)

本项目是一个**纯前端单页互动 NPC Demo**，以"旁观者效应"为叙事核心：玩家通过与三个 NPC 的自然语言对话（由 Google Gemini API 驱动）建立不同深度的连结，随后触发危机事件，观察 NPC 因与玩家的关系深浅而做出截然不同的行为选择——是对"环境与情感连结能否改变一个人危机时刻决策"这一命题的可玩化实验。

### 技术栈清单

| 技术 / 库 | 版本 | 用途 |
|---|---|---|
| 原生 HTML5 | — | 页面结构与入口 |
| 原生 CSS3 | — | 全局样式、动画、响应式布局 |
| 原生 JavaScript (ES2020+) | — | 所有业务逻辑，使用 IIFE 模块模式 |
| Google Gemini REST API | v1beta | 驱动 NPC 对话（`generateContent` 端点），可选来源之一 |
| 硅基流动 OpenAI 兼容 API | v1 | 驱动 NPC 对话（`/v1/chat/completions` 端点），可选来源之一 |
| 原生 `fetch` API | — | 所有 HTTP 请求 |
| 原生 `Blob` + `URL.createObjectURL` | — | 终局对话记录导出为 `.txt` 文件 |

**无任何第三方库，无 npm，无构建工具，无 ES Module / CommonJS。**

---

## 2. 核心目录结构 (Directory Structure)

```
g:\works\NPC-\
│
├── index.html            # [唯一 HTML 入口] intro / 登录遮罩（Phase 3）/ API 配置 /
│                         # 笔记本弹层（F-004b）；<script> 顺序即依赖（见 §3.2）。
│
├── style.css             # [全局样式层] 全部视觉与动画。
│
├── characters.js         # [数据层] NPC 数据、颜色工具、injectSubconscious。
│                         # 对外暴露：window.NPCConfig
│
├── stage-catalog.js      # [配置层 · Phase 1] stageId ↔ legacyLoopIndex 目录表。
│                         # 对外暴露：window.StageCatalog
│
├── npc-loop-memory.js    # [配置层 · F-005] 三角色 × 1–10 周目静态 subconscious 补丁。
│                         # 对外暴露：window.NPCLoopMemory
│
├── notebook-config.js    # [配置层 · F-004] LOOP_NOTEBOOK_TONE 1–10。
│                         # 对外暴露：window.NotebookConfig
│
├── loop-script.js        # [配置层] quick reply / 测试 mock / 占位日记。
│                         # 对外暴露：window.LoopScript
│
├── progression-engine.js # [预留 · Phase 4] 攻略值引擎 stub（当前全 no-op）。
│                         # 对外暴露：window.ProgressionEngine
│
├── ending-participation.js # [配置层] 终局 stage3 / 结算参与开关（按 stageId）。
│                         # 对外暴露：window.EndingParticipation
│
├── cloud-sync.js         # [网络层 · Phase 3] login / loadSave / pushSave / pushLog。
│                         # 对外暴露：window.CloudSync
│
├── user-session.js       # [会话层 · Phase 3] userId / sessionToken / login()。
│                         # 对外暴露：window.UserSession
│
├── save-adapter.js       # [存档层 · Phase 3] load() / save() 统一本地+云端。
│                         # 对外暴露：window.SaveAdapter
│
├── audit-log.js          # [审计层] NDJSON 日志 + artifact 注册。
│                         # 对外暴露：window.AuditLog（见 §9）
│
├── log-restore.js        # [工具层 · 日志续接] 从 NDJSON 重建 v2 archive，
│                         # 由 loop.js showManualSelect 与 index.html doLogin 兜底消费。
│                         # 对外暴露：window.LogRestore
│
├── dialogue/             # [对话核心层 · IIFE 拆分] 内部子模块命名空间 window.NPCDialogue。
│   ├── core.js           # namespace、常量、状态、基础查询
│   ├── output.js         # AI sidebar 输出
│   ├── request.js        # abort / fetchWithTimeout / 错误格式化 / 硅基探测
│   ├── provider.js       # schema normalize、mock、Gemini / SiliconFlow、callGemini
│   ├── render.js         # 对话 DOM、角色按钮、输入状态、quick reply UI
│   ├── audit.js          # dialogue_npc AuditLog 旁路记录（mock_source / write / pushDialogueLogId）
│   ├── flow.js           # appendMessage、切换角色、玩家回合、candor/closing（经 D.audit 记日志）
│   ├── settings.js       # provider 表单、测试连接、setup event binding
│   └── public-api.js     # patch/reset/advance 与 createPublicApi()
│
├── dialogue.js           # [对话层 bootstrap] 创建 window.DialogueState 并在 DOMContentLoaded setup。
│                         # 对外暴露：window.DialogueState（API 形状不变）
│
├── ending.js             # [终局层] 分屏叙事、结算、日记生成、SaveAdapter.save。
│                         # 对外暴露：window.EndingState（内部状态对象，非完整 public API）
│
├── loop.js               # [周目入口层] 续档、导入、v2 升级、injectArchive。
│                         # Phase 3：LoopState.start() 由登录完成后显式调用。
│                         # 对外暴露：window.LoopState
│
├── local_server.example.py # [本地工具] 静态服务 + POST /api/log + GET /api/logs/ndjson
│
├── scripts/
│   └── architecture-smoke.js # [工程化验收] 零依赖 Node 架构烟测（script 顺序 / 对话层 API）
│
├── backend/              # [可选后端 · Phase 3] FastAPI + SQLite（server.py）
│
├── dev-notes/            # 验收清单、项目状态、功能路线图
│
├── config.example.js     # 配置模板 → 复制为 config.local.js
├── config.local.js       # 本地密钥与云端 URL（.gitignore）
├── PORTFOLIO.md          # 作品集与机制详解
├── AI_DEV_WORKFLOW.md    # AI 协作与三 Agent 流
└── README.md             # 快速开始
```

---

## 3. 核心模块与架构设计 (Core Modules & Architecture)

### 3.1 模块划分

项目按职责被划分为 6 个层次（含周目入口层与入场展示层）：

```
┌─────────────────────────────────────────────────────────┐
│  [周目入口层]   loop.js                                   │
│                 #loop-select-overlay（全屏黑底遮罩，       │
│                 sessionStorage 自动导入 / 手动 JSON 导入） │
│                 window.LoopState { getLoopIndex, getStageId,
│                   start, jumpToTestLoop, getNotebookEntries,
│                   getLastLoopSummary, upgradeRestoredArchive, … }
└──────────────────────┬──────────────────────────────────┘
                       │ 退出后进入
┌──────────────────────▼──────────────────────────────────┐
│  [入场层]   index.html 内联脚本                           │
│             #intro-overlay（全屏黑底遮罩，用后销毁）       │
│             逐行显示叙事文案，点击/按键后淡出移除           │
└──────────────────────┬──────────────────────────────────┘
                       │ 退出后暴露主界面
┌──────────────────────▼──────────────────────────────────┐
│  [配置层]   config.local.js (可选)                       │
│             window.AI_PROVIDER                           │
│             window.GEMINI_PRESET_KEY / PRESET_MODEL      │
│             window.SILICONFLOW_PRESET_KEY / PRESET_MODEL │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量注入
┌──────────────────────▼──────────────────────────────────┐
│  [数据层]   characters.js                                │
│             window.NPCConfig                             │
│             { MAX_CANDOR, baseCharacters,                │
│               updateCandorAndColor, mixColors,           │
│               injectSubconscious, clamp, hexToRgb }      │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量消费
┌──────────────────────▼──────────────────────────────────┐
│  [对话层]   dialogue/*.js + dialogue.js bootstrap         │
│             内部 window.NPCDialogue；对外 window.DialogueState │
│             { getSnapshot, getCharacters,                │
│               getDialogueHistories, callGemini,          │
│               appendAiOutput, patchCharacter,            │
│               resetForNewLoop, abortAllRequests,         │
│               tryAdvanceUnlock,                          │
│               advanceOrTriggerEnding, isUnlocked, isPassed } │
│             内部：callGemini（测试模式 / 无 Key 时按 responseSchema     │
│             生成占位；否则 Provider 路由）、callGeminiProvider /        │
│             callSiliconFlow-Provider                                     │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量消费（`#ending-button`：`DialogueState.advanceOrTriggerEnding()` → 需在 char3 上才 `runEnding`）
┌──────────────────────▼──────────────────────────────────┐
│  [终局层]   ending.js                                    │
│             window.EndingState                           │
│             { triggered, stage2Results,                  │
│               stage3Results, dialogueSnapshot,           │
│               loopSummary }                              │
└─────────────────────────────────────────────────────────┘
```

### 3.2 模块依赖关系

- **单向依赖**：数据层 → 对话层 → 终局层，下层不知道上层的存在。
- **通信媒介**：`window` 全局对象作为模块间唯一的"接口总线"，无依赖注入，无事件总线。
- **无循环依赖**。
- **`index.html` 中的 `<script>` 加载顺序即隐式依赖声明**，改变顺序会导致运行时错误。
- 当前顺序：`config.local.js` → `characters.js` → **`stage-catalog.js`** → **`npc-loop-memory.js`** → **`notebook-config.js`** → **`loop-script.js`** → **`progression-engine.js`** → **`ending-participation.js`** → **`cloud-sync.js`** → **`user-session.js`** → **`save-adapter.js`** → **`audit-log.js`** → **`log-restore.js`** → `dialogue/core.js` → `dialogue/output.js` → `dialogue/request.js` → `dialogue/provider.js` → `dialogue/render.js` → `dialogue/audit.js` → `dialogue/flow.js` → `dialogue/settings.js` → `dialogue/public-api.js` → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本（含登录遮罩 Phase 3、intro、笔记本 UI）。

  `log-restore.js` 已加载，位置严格按"`audit-log.js` 之后、**首个对话脚本 `dialogue/core.js` 之前**"约束（依赖 `AuditLog` / `NPCConfig` / `StageCatalog` / `NotebookConfig`，全部在它之前加载）；周目入口 UI 通过 `loop.js` `showManualSelect()` 的「继续上一段记忆」按钮触发。

  配置层文件均无运行时依赖；`save-adapter.js` 依赖 `CloudSync` + `UserSession` + `LoopState`（后者在运行时调用，加载顺序上 `save-adapter` 先于 `loop.js` 仅注册函数，无立即调用）。`loop.js` 的 keydown 拦截器须在内联 intro 脚本之前注册。

---

## 4. 数据流与状态管理 (Data Flow & State Management)

### 4.1 全局状态

本项目无状态管理框架。状态以两种形式存在：

| 状态位置 | 内容 | 生命周期 |
|---|---|---|
| `dialogue/core.js` 内闭包 `state`（经 `window.NPCDialogue` 与各子模块共享；根 `dialogue.js` 不持有该对象） | `characters[]`（含坦诚度、mutableSubconscious）、`dialogueHistories{}`、`closingStreaks{}`、`unlockedChars`、`passedChars`、**`readOnly`**（查看已离开角色时为只读）、`activeRequests{ charId: AbortController }`（也作为当前角色“思考中”门禁来源） | 页面整个生命周期；`activeRequests` 仅记录当前 in-flight 请求，完成或取消后清理 |
| `ending.js` 内部 `window.EndingState` | 终局快照、各阶段 AI 结果、`loopSummary`（结算一句话总结） | 终局触发后 |
| `loop.js` 内部 `loopState` | `currentLoopIndex`、`lastLoopSummary`、**`notebook[]`**、**`completedStageIds[]`（Phase 2）** | 页面整个生命周期 |
| `npc-loop-memory.js`（无可变状态） | `STATIC_PATCH_BY_CHAR_LOOP`（三角色 × 1–10 周目静态补丁文本；1–3 / 10 为 null） | 页面整个生命周期（只读） |
| `notebook-config.js`（无可变状态） | `LOOP_NOTEBOOK_TONE`（1–10 静态骨架表，AI 仅看当前周目 entry） | 页面整个生命周期（只读） |
| `loop-script.js`（无可变状态） | `QUICK_REPLIES_BY_LOOP`（1–10 三角色 × 两选项的 quick reply 文本 + 测试模式 mock）、`TEST_NOTEBOOK_BODY_BY_LOOP`（测试占位日记正文） | 页面整个生命周期（只读） |
| `window.AI_PROVIDER` | 当前选择的 API 来源（`"gemini"` \| `"siliconflow"`） | 页面整个生命周期 |
| `window.GEMINI_PRESET_KEY/MODEL` | Gemini 用户配置 | 页面整个生命周期 |
| `window.SILICONFLOW_PRESET_KEY/MODEL` | 硅基流动用户配置 | 页面整个生命周期 |
| `localStorage('npc_api_provider')` | 用户上次选择的 API 来源（页面刷新后自动回填表单，回退至 `window.AI_PROVIDER`） | 浏览器本地持久化 |
| `localStorage('npc_api_key')` | 用户上次填写的 API Key（`dialogue/settings.js` 在 input/change/blur、`pagehide`/`beforeunload` 及 `ending.js` 的 `location.reload()` 前写入；进入页面优先回填 `#api-key-input`，无缓存时回退 `config.local.js` 预设） | 浏览器本地持久化 |
| `localStorage('npc_api_model')` | 用户上次填写的模型名（页面刷新后自动回填输入框） | 浏览器本地持久化 |
| `localStorage('npc_audit_session_id')` | 审计日志会话 ID（uuid v4；跨 reload 延续；「重开一局」时由 `AuditLog.resetSessionForNewGame()` 清除重置） | 浏览器本地持久化 |
| `localStorage('npc_session_token')` 等 | Phase 3 用户会话（`UserSession`：含 `npc_user_id`、`npc_nickname`） | 浏览器本地持久化 |
| `UserSession` 内存 | `userId` / `nickname` / `sessionToken`；`NPC_SKIP_LOGIN` 时视为已登录 | 页面生命周期 |
| `sessionStorage('npc_pending_loop')` | 跨刷新传递 loop_archive（本地续档；云端 load 亦写入此键） | 跨 reload，标签页关闭后清空 |

### 4.2 对话阶段数据流

```
[用户输入 #player-input]
         │
         ▼ handleSend()
若当前角色在 activeRequests 中已有 in-flight 请求 → 阻止重复发送（send/quick-reply/textarea disabled）
         │
         ▼ state.dialogueHistories[charId].push({ role: "user", content })
         │
         ▼ state.activeRequests[charId] = new AbortController()
         │
         ▼ callGemini({ signal })
         ├── [测试模式 localStorage npc_test_mode=1] → 按 responseSchema 内省占位
         ├── [无 API Key] → 同上占位（非对话场景沿用 schema）
         └── [有 API Key] → 按 provider 路由
              ├── callGeminiProvider()：
                     白名单过滤（仅保留 "user"/"model"，
                     "error"/"system" 等无效角色被丢弃）
                     → role 映射后构建 contents
                     → fetch({ signal })
               └── callSiliconFlowProvider()：
                     过滤非法 role（仅保留 "user"/"assistant"/"system"/"tool"，
                     "model" 转换为 "assistant"，"error" 等无效角色被丢弃）
                     → fetch POST OpenAI 兼容 API({ signal })
                   (system_instruction + filtered history + responseSchema)
                                         │
                                         ▼ 解析 JSON
                    { reply: string, touched: boolean, closing_signal: boolean }
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
  appendMessage("model", reply)   stepCandorAndColor()     closing_signal=true → 立即关闭
  → history.push(model msg)       → touched=true: +rise    → closing_signal=false → streak 归零
  → appendMessageToDom()          → touched=false: -fall   → 首次关闭时插入系统提示
    (增量追加单条消息)              → updateCandorAndColor()
                                   → currentColor = mixColors()
                                   → renderSceneCharacters()
                                     (圆圈颜色渐变 + active class)
```

切换角色时：**切到已离开角色（`passedChars`）只读查看记录**不取消离开角色的 in-flight 请求，后台回复仍写入该角色历史并更新 candor/closing；切到未离开的另一可玩角色仍会 abort（常规路径下通常仅能通过「继续走」解锁下一人）。`advanceOrTriggerEnding()` 推进到下一人、`resetForNewLoop()` 或进入终局时，会取消对应角色或全部对话层 `activeRequests`。同角色重复发送不会再取消旧请求，而是在当前角色思考中禁用 `send-button`、quick reply 与 textarea。`AbortError` 只有在对应 `AbortController` 已由本地取消路径打标时才属于主动取消，调用方静默丢弃，不写回对话历史、不更新 candor/closing，也不追加红色错误消息；其他 HTTP、网络、JSON 解析或字段缺失错误必须展示给用户。

### 4.3 终局阶段数据流

```
[#ending-button click] → runEnding()（一次性保护：EndingState.triggered）
         │
         ▼
DialogueState.getSnapshot() → 深拷贝所有角色数据 + 对话历史
         │
         ▼ runProducer()
4 个页面帧入队（文案按 `LoopState.getLoopIndex()` 从 `ENDING_PHASE_BY_LOOP` 1–10 读取）：
  [0] 阶段一: 纯叙述（`showNpcSlots: false`，无 API，可立即翻页）
  [1] 阶段二: 纯叙述（同上）
  [2] 阶段三: 叙述 + 三位 NPC 反应（仅本阶段 callGemini；prompt 仅告知「附近刚说过话的人被人捅了」，不含阶段一/二细节）
  [3] 尾声: 轮回句（周目 3 为「买花」变体；1–10 均已配置 `ENDING_PHASE_BY_LOOP` epilogue）+ summary block + 四按钮
         │
         ├─ stage 3 完成后（三者并行、非阻塞）：
         │   ① runLoopMemory()（完整对话+终局→记忆整理）→ endingState.loopSummary → 尾声页
         │   ② runAllSubconsciousSettlements()（高维命运观测者，逐 NPC 并行）
         │      → **输入仅含本轮对话历史 + currentCandor**，**不读取 stage1/2/3 的行为或台词**
         │        （刻意切断终局事件对潜意识的污染：NPC 不应记住袭击或自己的终局选择）
         │      → prompt 强约束：补丁文本主语 = NPC、宾语 = 「那个陌生人」(玩家)，
         │        必须含 1–3 个对话里真实出现过的关键词，禁止 NPC 自身特征（背相机/书包/店家）
         │        被错写成玩家特征，禁止出现死/刀/血/危险等终局词
         │      → 写入 endingState.dialogueSnapshot.characters[].mutableSubconscious
         │        { subconsciousImpression, thresholdAdjustment, nextLoopPromptPatch }
         │      → buildArchiveObject 读 snapshot 导出时自动包含结算内容
         │   ③ runNotebookGeneration()（F-004c；**在 ① 完成后**再调）
         │      输入：当周 tone 预设 + ① 的记忆整理正文 + 上页日记末尾 60 字（不再截断对话摘要）
         │      7-8 周目 prompt 显式要求 `<del>` + 截断句、严禁错别字
         │      成功 → LoopState.replaceLastNotebookEntry(真实 entry) 覆盖 runEnding 触发时已 append 的 fallback
         │      失败 / 长度异常 / 含元信息 → 保留 fallback（body=""，弹层显示「这一轮的记忆模糊了……」）
         │
         ▼ createOverlay() → document.body 追加 #ending-overlay
用户翻页（点击；等待阶段二/三 AI 时 footer 显示进度）→ advance()（翻页前检查当前帧所有 slots.ready）→ renderEntry()
         │
         ▼ [尾声页]
  非最终周目：点击屏幕 → beginNextLoopTransition()（居中沙漏过渡）→ doStartNextLoop() → sessionStorage('npc_pending_loop') → reload
  最终周目：「打开笔记本」「再玩一次」（无重新开始）
```

### 4.4 跨周目数据流

```
[尾声页「直接开启下一轮次」]
         │
         ▼ buildArchiveObject(currentIndex + 1)
         │ → { loop_index, ran_at, characters:{ immutableCore, mutableSubconscious }, summary,
         │     notebook[] // F-004：跨周目主角第一人称日记数组，逐轮 append/replace }
         │
         ▼ sessionStorage.setItem('npc_pending_loop', JSON.stringify(archive))
         ▼ await SaveAdapter.save(archive)   // Phase 3：有云端配置时 pushSave，失败弹重试框
         ▼ location.reload()
         │
         ▼ [新页面 loop.js IIFE 执行]
         │
sessionStorage.getItem('npc_pending_loop')
  ├── 存在 → removeItem → injectArchive() → 注入三角色 mutableSubconscious
  │          → currentLoopIndex = archive.loop_index
  │          → 显示「— 记忆已延续 · 第 N 周目 —」1.5s → 进入 intro-overlay
  └── 不存在 → 显示手动周目选择界面（新周目 / 手动导入 JSON）
```

---

## 5. 核心约定与模式 (Conventions & Patterns)

### 5.1 命名约定

| 类型 | 规范 | 示例 |
|---|---|---|
| 函数 / 变量 | `camelCase` | `handleSend`, `currentCharacterId` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_CANDOR`, `CLOSE_THRESHOLD` |
| DOM ID | `kebab-case` | `#send-button`, `#ending-overlay` |
| 模块接口 | `PascalCase` 前缀 + `window.` | `window.NPCConfig`, `window.DialogueState` |

### 5.2 模块封装模式

**所有 JS 文件均使用 IIFE（立即执行函数表达式）封装**，将内部实现隔离于局部作用域，仅通过 `window.XXX = {}` 显式暴露公共 API：

```javascript
(function () {
  // 内部状态与实现...
  window.SomeModule = { publicMethod };
})();
```

### 5.3 错误处理标准

- 所有异步操作使用 `async/await` + `try/catch`。
- AI 调用失败时，`callGemini` 返回 `null`，调用方（`handleSend`、`runEnding`）需检查 `null`。
- Schema 解析失败时，`normalizeSchema()` 不抛出，返回原始值（防御性编程）。
- API 调用失败时，`handleSend` 的 `catch` 及 null/字段检查会 `console.error` 完整错误对象，并向 AI sidebar 与对话框追加红色 `error` 类型的系统提示消息，告知用户发生了错误。**无全局错误边界**，对话流之外的异常仍仅打印到控制台。
- `AbortError` 只有在对应请求确认为本地代码主动取消（切换角色、推进下一人、进入终局、reset/reload 前 best-effort 取消）时才静默丢弃；不得仅凭 `err.name === "AbortError"` 或 `signal.aborted` 吞掉真实 fetch/HTTP/JSON 失败。同角色重复发送不属于取消路径，必须被 UI 思考态门禁阻止。
- `dispatchPlayerTurn` 在 `await callGemini()` 返回后仍核验 `AbortController.signal` 与 `state.activeRequests[charId]`；若请求已被推进/终局/切到未离开角色等路径主动取消则丢弃。若用户仅切到**已离开角色**只读查看，回复仍经 `appendMessageForCharacter` 写入该角色历史并更新 candor/closing/场景色，仅当 `currentCharacterId` 仍为该角色时才刷新 closing 提示与输入区。
- **`error` 角色消息过滤**：`appendMessage("error", ...)` 追加的错误提示消息会被存入 `dialogueHistories`（用于页面渲染），但在出站 API 请求时会被过滤：`callSiliconFlowProvider` 通过 `VALID_SF_ROLES` 白名单丢弃；`callGeminiProvider` 通过 `VALID_GEMINI_ROLES` 白名单（仅 `user`/`model`）丢弃。`system` 等 UI 专用角色同样不会进入任一 provider 的请求体。

### 5.4 不可变更新模式

`updateCandorAndColor()` 采用不可变更新，返回新对象而非直接修改原角色对象：

```javascript
return { ...character, currentCandor: newCandor, currentColor: newColor };
```

### 5.5 响应式 DOM 渲染模式

项目无虚拟 DOM。列表型 UI 优先使用增量追加：对话区新增消息经 `appendMessageToDom()` 只插入一个 `.message-row`，AI sidebar 经 `appendAiOutput()` 插入单条输出；`renderDialogueHistory()` 保留为切换角色、初始化、`resetForNewLoop()` 与导入存档后的全量兜底。

### 5.6 candor 代码驱动累加约定

`currentCandor`（0–6）由代码完全控制，AI 不再返回绝对值，只返回 `touched: boolean`（本轮是否真实触碰角色）。`stepCandorAndColor(character, touched)` 读取角色的 `candorRates` 字段进行单步累加或衰减，再调用 `updateCandorAndColor` 计算颜色。

**设计动机**：AI 每轮重新评估绝对坦诚度时存在随机抖动，导致颜色在相近质量的对话间跳动。改为 boolean 后，AI 只判断本轮有无连结，累加逻辑由代码保证确定性。

各 NPC 的 `candorRates` 配置：

| NPC | rise | fall | 说明 |
|---|---|---|---|
| char1（小一） | 1 | 1 | 双向缓慢，无声退潮 |
| char2（小二） | 1 | 6 | 上升缓慢，一次刺激直接归零（二元人格） |
| char3（三三） | 1 | 1 | 双向缓慢，退潮一旦开始持续不停 |

`candor` 可退回 0（`mixColors` 传入 `factor=0` 时返回纯黑 `#000000`，代码已原生支持）。退潮触发条件由各 NPC `systemPrompt` 的 `【退潮触发】` 段落描述，速率由 `candorRates.fall` 保证。

### 5.7 `window.NPCDialogue` 仅为对话层内部命名空间

`window.NPCDialogue` 是 `dialogue/*.js` 子模块之间共享闭包外状态、函数引用与装配点的**内部命名空间**，不是稳定 public API。除 `dialogue/` 子模块与根 `dialogue.js` bootstrap 外，其他模块不得读取或调用 `window.NPCDialogue.*`。

外部模块（尤其 `ending.js`、`loop.js`、`index.html` 内联脚本）必须只依赖 `window.DialogueState`。若对话层需要新增跨模块能力，先在 `dialogue/public-api.js` 的 `createPublicApi()` 中明确登记到 `window.DialogueState`，再同步更新本文件的 API 形状说明。

### 5.8 架构烟测

项目提供零依赖 Node 烟测脚本：

```bash
node scripts/architecture-smoke.js
```

该脚本用于快速检查：

- `index.html` 中本地 `<script src="...">` 是否存在；`config.local.js` 因带 `onerror` 被视为可选，缺失只提示不失败。
- **从 `index.html` 动态解析** script 顺序并校验结构契约（无需在烟测脚本内维护完整硬编码列表）：
  - `audit-log.js` 之前允许插入新脚本，但须满足跨模块相对顺序约束（如 `characters.js` 必须在 `dialogue/core.js` 之前）；
  - `audit-log.js` 之后必须是固定结构：`log-restore.js` → **连续的** `dialogue/*.js` 块（顺序以 index 为准，并与 `dialogue/` 目录文件一一对应）→ `dialogue.js` → `ending.js` → `loop.js` → 内联脚本；
  - `loop.js` 之后不得再出现外部 `<script src>`。
- 用 Node `vm` 和最小浏览器 mock **按 index.html 解析出的 dialogue 顺序**加载对话层 IIFE，验证到 `dialogue.js` bootstrap 不抛错。
- `window.DialogueState` public API 是否精确包含当前约定的方法集合。
- 测试模式主路径是否仍引用 `npc_test_mode` 与 quick reply mock 短路。

注意：该脚本不执行真实浏览器 DOM 交互、动画、网络请求或完整终局流程；它只覆盖架构契约与对话层加载烟测。

---

---

## 4.5 loop_archive JSON 结构

`loop_archive_[ISO时间戳].json` 由「保存轮回记忆」导出，可通过「继续上一段记忆」手动导入，或由「直接开启下一轮次」经 sessionStorage 自动传递。

```json
{
  "archive_version": 2,
  "loop_index": 2,
  "current_stage_id": "flower_resonance",
  "legacy_loop_index": 2,
  "completed_stage_ids": ["orientation"],
  "ran_at": "2026-03-11T12:00:00.000Z",
  "characters": {
    "char1": {
      "immutableCore": {
        "id": "char1",
        "name": "小一",
        "targetColor": "#8B9EA8",
        "candorRates": { "rise": 1, "fall": 1 }
      },
      "mutableSubconscious": {
        "dejaVuLevel": 4,
        "subconsciousImpression": "玩家曾以具体的细节触碰到她，她记得那种感觉。",
        "thresholdAdjustment": "",
        "nextLoopPromptPatch": ""
      }
    },
    "char2": { "...": "..." },
    "char3": { "...": "..." }
  },
  "summary": "玩家与小一建立了真实连结，但在危机时刻仍未能改变旁观者的沉默。",
  "notebook": [
    {
      "loopIndex": 1,
      "headerLabel": "第一次轮回",
      "body": "我醒来还什么都不知道……",
      "tonePreset": {
        "emotion": "初始无知、被杀后的惊惧、想找真相",
        "memoryLevel": "low",
        "infoSnippet": "...",
        "headerLabel": "第一次轮回"
      },
      "generatedAt": "2026-05-19T05:00:00.000Z",
      "source": "ai",
      "error": null
    }
  ]
}
```

- `archive_version`：2 表示 Phase 2+ schema；缺省或 1 时由 `loop.js` 三路径升级函数推断（pending / export / restored 语义不同，见 §10.1）
- `current_stage_id` / `legacy_loop_index` / `completed_stage_ids`：与 `StageCatalog` 对齐；终局推进时 `appendCompletedStage()`
- `dejaVuLevel`：上轮终局时的 `currentCandor`（0–6），用作下轮"似曾相识"程度的数值参考
- `nextLoopPromptPatch`：若非空，导入时自动追加到对应角色的 systemPrompt（`【你刚刚遇到的那个陌生人的印象】`）；与按周目查表的静态补丁（`【这段时间你模糊地察觉到的事】`，来自 `npc-loop-memory.js`，不入本 JSON）叠加，见 §8.3
- `summary`：由轮回记忆整理 Prompt（`runLoopMemory()`）生成，记录「与谁聊了、关系、值得记住的事、终局行为」；失败则为空字符串。日记生成复用此字段，不再单独截断对话摘要
- `notebook[]`（F-004）：跨周目主角第一人称碎碎念日记，逐轮 append。entry 含 `loopIndex` / `headerLabel` / `body` / `tonePreset` 快照 / `generatedAt` / `source`（`ai` | `fallback` | `mock`）/ `error`。第 1 周目 UI 隐藏；第 2+ 周目右下角 64×64 图标按钮 + 居中弹层翻页。7-8 周目页眉「轮回了不知道多少次……」，正文允许 `<del>` 标签划字 + 截断句（严禁错别字）。失败兜底正文为空，UI 显示「这一轮的记忆模糊了……」。AI 仅看当前周目 `LOOP_NOTEBOOK_TONE[loopIndex]` 预设，不见全表。

---

### ⚠️ 警告未来开发者 (Critical Warnings)

> ~~**1. `dialogue.js` 是最脆弱的核心文件**~~
> ~~该文件（历史形态）曾同时承担：状态管理、AI 调用、JSON 解析、DOM 渲染、事件绑定，修改易产生跨关注点副作用。（拆分前为维护者需整文件通读的典型热点。）~~ **✓ 已修复（2026-05-27 IIFE 拆分）：对话层已拆入 `dialogue/` 子模块，`dialogue.js` 仅保留 bootstrap；最终 `window.DialogueState` API 不变。**

> **2. `<script>` 加载顺序不可随意调整**
> 顺序是隐式依赖声明：`dialogue/core.js` 在脚本解析执行时即读取 `window.NPCConfig` 克隆 `baseCharacters` 并初始化 `state`；同一加载链路内后续 `dialogue/*.js` 陆续挂到 `window.NPCDialogue`。根目录 **`dialogue.js` 仅作 bootstrap**：创建 `window.DialogueState` 并在 `DOMContentLoaded`（或文档已结束 loading 时的同步分支）调用 `settings.setup()`，**不在**脚本读入瞬间访问 `NPCConfig`。`loop.js` 在加载时立即访问 `window.NPCConfig` 与 `window.DialogueState`；`ending.js` / `loop.js` 在终局/导入路径中访问 `window.NotebookConfig`；内联 intro-overlay 脚本必须在 `loop.js` 之后运行（`loop.js` 的 capture `keydown` 拦截器须先注册）。任何顺序调整都可能导致运行时崩溃或拦截器失效。
> 当前顺序：`config.local.js` → `characters.js` → `stage-catalog.js` → `npc-loop-memory.js` → `notebook-config.js` → `loop-script.js` → `progression-engine.js` → `ending-participation.js` → `cloud-sync.js` → `user-session.js` → `save-adapter.js` → `audit-log.js` → `dialogue/core.js` → `dialogue/output.js` → `dialogue/request.js` → `dialogue/provider.js` → `dialogue/render.js` → `dialogue/audit.js` → `dialogue/flow.js` → `dialogue/settings.js` → `dialogue/public-api.js` → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本。

> **3. `closingStreaks` 在单局内单向不可逆，但跨周目会被重置**
> 某个角色在单轮 AI 响应中返回 `closing_signal: true` 时，`closingStreak` 会立即设为 `CLOSE_THRESHOLD`（3），该角色对话在**本局**永久关闭，无法通过任何用户操作恢复。`closing_signal: false` 且尚未关闭时，streak 归零。这是刻意的设计决定。
> 跨周目导入存档时，`loop.js` 的 `injectArchive` 会在注入前调用 `DialogueState.resetForNewLoop()`，将 `closingStreaks`、`dialogueHistories`、`currentCandor` 全部归零，保证新一周目以干净状态开始。✓ 已修复（陷阱 B）

> ~~**4. `ending.js` 的 `#ending-panel` DOM 节点是死代码**~~
> ~~`index.html` 中定义的 `<section class="ending-panel">` 在运行时**从不被使用**。`ending.js` 通过 `document.body.appendChild(overlay)` 动态创建完全独立的 `#ending-overlay`。该 HTML 节点可安全移除。~~ **✓ 已修复：废弃节点已从 `index.html` 删除。**

> **5. API Key 存在泄露风险**
> Gemini API Key 以 `?key=` 形式附加在 `fetch` URL 的 query string 中；硅基流动 API Key 以 `Authorization: Bearer` 请求头形式发送。两者均会被浏览器 `devtools` 网络面板及任何代理日志捕获。作为 Demo 项目这是已知权衡，但若部署于公开环境，须通过后端代理隐藏 Key。
> API Key 会写入 `localStorage('npc_api_key')` 以便跨刷新/跨周目（`location.reload`）自动回填；仅限本机浏览器，勿在公共电脑上使用。公开部署须通过后端代理隐藏 Key，勿依赖前端 localStorage 保密。
>
> **（控制台）CORS 与 `Authorization` 头**：跨域请求携带 `Authorization` 时，浏览器可能对远端返回的 `Access-Control-Allow-Headers: *` 打印弃用或策略类警告；属浏览器与服务商 CORS 配置问题，**不作为本 Demo 业务逻辑缺陷**。长期可由官方修正 CORS、或经同源代理、或改用不设该头的调用方式。

> ~~**7. `error` 角色消息在 Gemini provider 中未被过滤**~~ **✓ 已修复（2026-05-18 性能修复包）**：`callGeminiProvider` 在构建 `contents` 时使用 `VALID_GEMINI_ROLES` 白名单，仅保留 `user`/`model`；`error`、`system` 等角色仍存入 `dialogueHistories` 供页面渲染，但不再进入 Gemini 请求上下文。

> **6. `injectSubconscious` 的 `systemPrompt` 追加必须使用 `_originalSystemPrompt` 为基准**
> `characters.js` 中每个角色在数组定义后立即快照 `_originalSystemPrompt`。`injectSubconscious(charId, data, opts)` 必须写成 `char.systemPrompt = char._originalSystemPrompt + staticPatch块 + dynamicPatch块`（赋值覆盖），**不得使用 `+=`（追加）**。若改回追加形式，玩家在同一页面生命周期内多次导入存档时，补丁会叠加，AI 收到重复指令。新签名 `opts.staticPatch`（来自 `window.NPCLoopMemory`）与原有 `data.nextLoopPromptPatch`（动态）仍然维持同一份幂等约束。✓ 已修复（陷阱 A）

> ~~**8. 笔记本入口可见性不得在 `LoopState.start()` 之前一次性判定**~~ **✓ 已修复（2026-05-28）**：`index.html` 内联笔记本 UI 曾在脚本 IIFE 执行时读取 `getLoopIndex()`（此时仍为默认 1），将 `#notebook-panel` 设为 `hidden`；`tryAutoImport` / 测试跳周目在 `LoopState.start()` 内才提升周目，导致第 2+ 周目续档后图标永不出现。现由 `NPCNotebookUi.syncPanelVisibility()` 在 `loop.js` 的 `finishLoopSelect()` 中再次同步；关闭弹层时 `resetNotebookIconVisualState()` 清除 `nb-closing` 残留（`animationend` 兜底），避免按钮长期 `opacity:0`。

---

## 6. 待优化点 (Tech Debt & Refactoring)

### P0 — 架构性问题

| # | 问题 | 影响 | 建议方向 |
|---|---|---|---|
| 1 | **`window` 全局共享带来隐式耦合** | 模块加载顺序错误时无任何静态检查，调试困难 | 迁移至 ES Module（`import/export`）+ `<script type="module">`，消除全局依赖 |
| ~~2~~ | ~~**`dialogue.js` 职责过重（God Object）**~~ | ~~状态、网络、渲染、事件全混在一起，极难单独测试~~ **✓ 已修复（2026-05-27）：在不引入 ES modules / build tools 的前提下拆分为 `dialogue/core.js`、`output.js`、`request.js`、`provider.js`、`render.js`、`flow.js`、`settings.js`、`public-api.js`，以 `window.NPCDialogue` 作为内部命名空间，`window.DialogueState` public API 保持不变。** | ~~拆分为 `state.js`（状态）、`api.js`（Gemini 封装）、`renderer.js`（DOM）~~ |

### P1 — 代码质量问题

| # | 问题 | 影响 | 建议方向 |
|---|---|---|---|
| ~~3~~ | ~~**`renderDialogueHistory()` 全量重绘**~~ | ~~随对话轮次增加，每次发送消息后整个对话 DOM 被销毁重建，性能随对话增长线性下降~~ **✓ 已修复（2026-05-18 性能修复包）：新增消息经 `appendMessageToDom()` 增量追加，`renderDialogueHistory()` 仅作兜底。** | ~~改为增量追加：仅 `appendChild()` 新消息节点~~ |
| ~~4~~ | ~~**`colorMood()` 重复实现 `hexToRgb`**~~ | ~~`characters.js` 已有 `hexToRgb()`，`ending.js` 又自行实现了一遍相同逻辑~~ **✓ 已修复（2026-05-18 性能修复包）：`ending.js` 的 `colorMood()` 复用 `window.NPCConfig.hexToRgb`。** | ~~将 `hexToRgb` 移入 `window.NPCConfig` 工具函数并复用~~ |
| ~~5~~ | ~~**角色 `name` 字段不唯一**~~ | ~~char1 和 char3 均为 `"她"`，导出文本中会出现歧义的 `【她】...【她】`~~ **✓ 已修复：char1 / char2 / char3 改为唯一显示名 `"小一"` / `"小二"` / `"三三"`（曾用名 `"她·蓝"` / `"他·锈橙"` / `"她·暗紫"`）。** | ~~为角色增加可读唯一标识或在导出时使用 `id`~~ |
| 6 | **`mockResponse()` 的条件判断脆弱** | 通过检查 `schema?.properties?.reply` 存在性来区分两种模拟响应，若 schema 结构变化将静默返回错误格式 | 增加明确的 `type` 或 `mode` 参数来区分调用场景 |

### P2 — 工程化缺失

| # | 问题 | 影响 | 建议方向 |
|---|---|---|---|
| ~~7~~ | ~~**无任何错误向用户展示机制**~~ | ~~API 调用失败（网络、Key 失效、配额超限）时用户只看到输入框无响应，无任何提示~~ **✓ 已修复：`handleSend` 的 `catch` 及 null 检查均追加红色 `error` 系统提示。** | ~~在 `handleSend` 的 `catch` 中向对话框追加错误提示消息~~ |
| ~~10~~ | ~~**API 配置页面刷新后丢失**~~ | ~~每次刷新后用户需重新填写 provider / API Key / 模型名，体验差~~ **✓ 已修复：`dialogue/settings.js` 的 `setup()` 通过 `localStorage` 持久化 `npc_api_provider` / `npc_api_model` / `npc_api_key` 并在进入页面时回填；`loop.js` 不再清除 `npc_api_key`（否则每次轮回 reload 会抹掉缓存）。** | ~~将表单输入持久化到 localStorage~~ |
| ~~7~~ | ~~**`README.md` 内容极少**~~ | ~~新开发者无法快速了解如何启动项目、如何配置 API Key~~ **✓ 已补充（2026-05-27）：快速开始、云端配置、dev-notes 索引。** | ~~补充：安装说明、`config.local.js` 配置方法、运行方式、项目背景~~ |
| 9 | **自动化测试覆盖仍不足**（已由 `scripts/architecture-smoke.js` 部分缓解） | 目前已有轻量架构烟测覆盖 script 引用、加载顺序、对话层 IIFE 载入与 `DialogueState` API；纯函数单元测试仍缺失 | 继续引入 `Vitest` 或原生 `Node.js test runner` 对 `updateCandorAndColor`、`mixColors`、`normalizeSchema` 等纯函数层添加单元测试 |

---

---

## 7. 开发协作文档

本项目包含 [`AI_DEV_WORKFLOW.md`](AI_DEV_WORKFLOW.md)，规定了与 AI 协作进行结构化更新的完整工作流：前置阅读清单、更新请求模板、`ARCHITECTURE.md` 同步规则及验收自查清单。每次向 AI 提交更新请求前，建议先阅读该文档。

---

---

## 8. 多周目体验说明 (Multi-Loop Flow)

### 8.1 尾声页四按钮

| 按钮 | 行为 | 互斥 |
|---|---|---|
| 点击屏幕进入下一轮（非最终周目） | 过渡动画（居中沙漏）→ 等待日记（真实 API）→ sessionStorage 写入 archive → reload | 否 |
| 最终周目：打开笔记本 / 再玩一次 | 翻阅日记或 `npc_fresh_journey` 清白重开 | 否 |
| 重新开始 | 清白 reload，无数据传递 | 否 |

### 8.2 周目入口与启动流

**Phase 3 启动顺序：**

1. 页面加载各 `<script>` 模块（`loop.js` 注册 `LoopState.start` 但**不**自动执行）
2. 内联登录脚本：若 `NPC_SKIP_LOGIN` 或无 `NPC_CLOUD_BASE_URL` → 直接 `LoopState.start()`
3. 否则显示 `#login-overlay` → 用户登录 → （继续记忆时）`SaveAdapter.load()`；若云端无存档/失败，静默兜底走 `LogRestore.resolveLatestRestore()` 写入 sessionStorage → `LoopState.start()`
4. `start()`：`tryFreshJourney` → `tryAutoImport(sessionStorage)` → 否则 `showManualSelect()`

| 状态 | 触发条件 | 行为 |
|---|---|---|
| 自动续档 | sessionStorage 有 `npc_pending_loop` | 显示「记忆已延续·第N周目」1.5s → intro |
| 新周目 | 无 sessionStorage，点击「开启新的旅程」 | currentLoopIndex=1 → intro |
| 日志续接 | 无 sessionStorage，点击「继续上一段记忆」 | 调 `LogRestore.resolveLatestRestore()`（API `/api/logs/ndjson` → 静态 `logs/*.ndjson`）→ `AuditLog.applySessionId(旧 sessionId)` → 写 sessionStorage → `location.reload()` → 走自动续档；无可用日志时显示「未找到可用的日志记忆」+「返回」 |
| 云端续档 | 登录后 `SaveAdapter.load()` 成功 | 写入 sessionStorage → 同上自动续档 |
| 云端 → 日志兜底 | 登录后 `SaveAdapter.load()` 返回 `archive=null` 或抛错 | 静默调 `LogRestore.resolveLatestRestore()`；命中则 `applySessionId` + 写 sessionStorage，dismiss 登录遮罩后由 `LoopState.start → tryAutoImport` 完成自动续档；未命中则照常进入「无 sessionStorage」分支显示周目选择遮罩 |
| 测试跳转 | 测试模式 +「测试：跳转到指定周目」 | 合成 mock archive → inject → intro |

### 8.3 mutableSubconscious 生命周期

每个 NPC 的 `mutableSubconscious` 在 `characters.js` 中以空值初始化。

**systemPrompt 拼装（三段式 · 幂等）**：

```
_originalSystemPrompt
  + 【这段时间你模糊地察觉到的事】     ← 静态补丁（按 loopIndex 从 NPCLoopMemory 查）
  + 【你刚刚遇到的那个陌生人的印象】   ← 动态补丁（上一轮 AI 提取的 nextLoopPromptPatch）
```

- **静态补丁**：来自 `window.NPCLoopMemory.getStaticPatchFor(charId, loopIndex)`。**只按 loopIndex 即时查询，不入 archive JSON**（避免存档版本污染：未来若调整文案，旧存档导入也会用新文案）。分期规则：1–3 周目为 null（NPC 完全没有违和）；4–6 周目为感受层（莫名亲近 / 不愿反击 / 心软，不直说记忆）；7–8 周目为同情·熟悉（即便对方表现疯狂仍感熟悉）；9 周目完全放开（直接承认记忆与愧疚）；10 周目为 null（NPC 已退场，对应 `ending-participation.js` 的 `LOOP_PARTICIPATION_OVERRIDES`）。
- **动态补丁**：来自上一周目结算阶段写入的 `mutableSubconscious.nextLoopPromptPatch`，仍由 archive JSON 持久化。
- **幂等保证**：`injectSubconscious(charId, data, opts)` 始终以 `char._originalSystemPrompt` 为基准重写 `systemPrompt`（赋值覆盖，禁用 `+=`）。无论调用多少次、是否同时传入静态/动态补丁，结果相同。

**导入阶段**：`loop.js` 的 `injectArchive` 先调用 `DialogueState.resetForNewLoop()` 清空状态，然后取 `loopState.currentLoopIndex`（兜底 `archive.loop_index`）作为当前周目，对每个 charId 调用 `NPCLoopMemory.getStaticPatchFor(charId, loopIdx)` 得到静态补丁，再调用 `NPCConfig.injectSubconscious(charId, entry.mutableSubconscious, { staticPatch })` 将数据写入 `baseCharacters`（幂等：以 `_originalSystemPrompt` 为基准覆盖写入 `systemPrompt`），最后通过 `DialogueState.patchCharacter` 将 `baseCharacters` 的规范值同步到活跃的 `state.characters`。

**结算阶段**：`ending.js` 在 stage 3 全部完成后，非阻塞地对三个 NPC 并行调用「高维命运观测者」结算 Prompt（`runAllSubconsciousSettlements`）。**该结算只看本轮对话历史 + `currentCandor`，不读取 stage1/2/3 的行为与台词**——刻意切断终局事件对潜意识的污染（NPC 不应记得「自己最终救/没救玩家」或「被刀刺」之类的具体事件）。Prompt 强约束：补丁文本主语必须是 NPC、宾语必须是「那个陌生人」(玩家)，必须从对话里抽取 1–3 个真实出现过的关键词（话题/物件/场景）作为印象锚点；**禁止**把 NPC 自身设定特征（背相机、背书包、店家、刚从图书馆出来等）误写成玩家的特征；**禁止**出现死/刀/血/危险/救等终局相关词。结果写入 `endingState.dialogueSnapshot.characters[].mutableSubconscious` 的三个叙事字段（`subconsciousImpression`、`thresholdAdjustment`、`nextLoopPromptPatch`）。`dejaVuLevel` 始终由 `buildArchiveObject` 从 `currentCandor` 计算覆盖，不使用 AI 返回值。

**导出阶段**：`buildArchiveObject` 从 `endingState.dialogueSnapshot` 读取已结算的 `mutableSubconscious`，写入 `loop_archive` JSON。下一周目导入时注入，实现情绪残留的跨轮传递。同时读取 `LoopState.getNotebookEntries()` 写入 `archive.notebook[]`（F-004）。

### 8.4 笔记本数据流（F-004）

`runEnding()` 触发时立刻通过 `appendCurrentLoopFallbackEntry()` 在 `loopState.notebook` 末尾 append 一条占位 entry（`body=""`、`source="fallback"`），保证任何瞬时点击「保存轮回记忆」/「直接开启下一轮次」都能携带当前周目条目。

`runEndingPostStage` 的第三并行任务 `notebookTask` 复用 `DialogueState.callGemini({ responseSchema: NOTEBOOK_SCHEMA, ... })`：
- 仅传当前周目 `NotebookConfig.getTonePresetFor(loopIndex)` + 本轮上下文摘要 + 上一页末尾 60 字，AI **不见** 完整 `LOOP_NOTEBOOK_TONE` 1–10 表。
- 7-8 周目 prompt 显式要求 `<del>` + 截断句、严禁错别字（所有"模糊感"通过 `<del>` 与截断句呈现）。
- 第 9 周目 prompt 要求「真相 + 疲惫 + 想结束」主题，**不再嵌入任何固定金句**（旧金句「既然有时间，为什么不现在去过呢？」已废除）；第 10 周目要求「反杀凶手 + 留下花 + 合上笔记本离开」释然告别基调。
- 成功 → `LoopState.replaceLastNotebookEntry(真实 entry)` 覆盖 fallback；失败 / 长度异常 / 含元信息 → 保留 fallback。

UI 端（`index.html` 内联）使用受控 HTML 渲染 `renderNotebookBodyHtml(body)`：先全转义 `& < >`，再仅放回 `<del>` / `</del>` / `<br>` 三个白名单标签，其他 HTML 一律字面化，杜绝 XSS。第 1 周目隐藏入口；第 2+ 周目右下 64×64 图标按钮 + 居中弹层（70vw × 80vh，z-index 700/710，低于终局 overlay）+ 翻页（按钮 / ←/→ / Esc / 点遮罩关闭）。

**入口可见性时序（勿破坏）**：

1. 笔记本内联 IIFE 在 `loop.js` 之后执行，初次 `syncNotebookPanelVisibility()` 时 `currentLoopIndex` 可能仍为 1（正常）。
2. `LoopState.start()` → `tryAutoImport` / 手动选周目 / 测试跳周目 完成后，`loop.js` **`finishLoopSelect()`** 必须调用 `window.NPCNotebookUi.syncPanelVisibility()`，再 `NPCOnLoopReady()` 启动 intro。
3. 第 2 周目 intro 退场后会 `NPCNotebookUi.open({ page: 'last' })`；打开时按钮加 `nb-closing`（故意淡出），**关闭弹层**须经 `resetNotebookIconVisualState()`（含 `animationend` + 超时兜底），否则按钮会卡在 `opacity:0` 而面板容器仍可见。

对外 API：`window.NPCNotebookUi` = `{ open, close, isOpen, syncPanelVisibility }`。

`dialogue/provider.js` 中 `buildMockFromSchema` 扩展了 `responseSchema.title === "notebook"` 分支，返回含 `<del>` 样例的稳定 mock 文本（随 2026-05-27 IIFE 拆分从单体文件迁至子模块）；**不改变** `callGemini` 主路由与外置 schema 契约。

### 8.5 周目剧本（quick reply 周目化 + 测试模式默认对白）

`loop-script.js` 作为独立配置层持有 1–10 周目的剧本数据：
- `QUICK_REPLIES_BY_LOOP[loopIndex][charId]`：当前周目该角色的两条 quick reply 文本 + 对应的 mock 回复（`reply` / `touched` / `closing_signal`）。
- `TEST_NOTEBOOK_BODY_BY_LOOP[loopIndex]`：跳周目测试时直接显示的占位日记正文（不走 AI 生成）。
- 第 7/8 周目 quick reply 通用为「我恨你们 / 可以陪陪我吗？」；选择「可以陪陪我吗？」时 mock 回复触发该角色的回忆主题（蓝→看书 / 橙→吵架 / 紫→装扮）。
- 第 9/10 周目 quick reply 为「告别 + 谢谢/恨」基调，配合第 10 周目反杀凶手 + 留下花的终局叙述。

**消费路径**：
- `dialogue/render.js`：`syncQuickReplyUi` 优先按当前周目从 `LoopScript.getQuickReplies(charId, loopIndex)` 取文本，回退到 `characters.js` 静态 `quickReplies`。
- `dialogue/flow.js`：`dispatchPlayerTurn` 在 **测试模式 + 命中本周目某条 quick reply 文本** 时短路 `callGemini`，直接用 mock 走原 `appendMessage("model", ...)`、candor、closing 校验路径；**不修改 callGemini 路由、provider 实现、错误处理链路**。
- `loop.js` `buildTestNotebookBody` 优先读 `LoopScript.getTestNotebookBody(loopIndex)`，回退到 `NOTEBOOK_MOCK_BODY_DEL` / 通用占位。

---

---

## 9. 审计日志体系 (Audit Log System)

### 9.1 概述

`audit-log.js` 为每次 LLM 调用写一条 NDJSON 日志到本地 `logs/<feature>.ndjson`，通过 `local_server.py` 的 `POST /api/log` 端点落盘。日志体积不做压缩，全量记录 prompt + 原始输出。

### 9.2 window.AuditLog API

| 方法 | 说明 |
|---|---|
| `startSession()` | 初始化 session（优先读 localStorage，否则生成 uuid 写入） |
| `getSessionId()` | 返回当前 session_id |
| `resetSessionForNewGame()` | 清除 localStorage 中的 session_id，下次 startSession 生成新 id（「重开一局」时调用） |
| `applySessionId(sessionId)` | 写入已有 session_id 到内存与 localStorage（日志续接时调用，不重置追踪表） |
| `write(feature, payload, opts)` | 写一条日志，返回 Promise\<log_id\>；失败 console.warn 后静默 |
| `registerArtifact(type, payload, opts)` | 注册 artifact_registry 条目，带内存去重缓存，返回 Promise\<log_id\> |
| `getBaselineId(key)` | 返回 `"baseline:<key>"`（保留 ID，不需要注册） |
| `registerPromptArtifact(charId, prompt)` | 检查 systemPrompt 是否变化；若未变化返回 baseline ID，否则注册 mutated_system_prompt |
| `resetLoopTracking()` | 清空本周目对话/阶段三/记忆 log_id 追踪表（在 resetForNewLoop 时自动调用） |
| `pushDialogueLogId(charId, logId)` | 追加 dialogue_npc log_id 到本周目该角色记录 |
| `getLastDialogueLogId(charId)` | 获取该角色最近一条 dialogue_npc log_id（对话链上游） |
| `getAllDialogueLogIds(charId)` | 获取该角色本周目所有 dialogue_npc log_id |
| `getAllCharDialogueLogIds()` | 获取所有角色本周目所有 dialogue_npc log_id |
| `setStage3LogId(charId, logId)` / `getAllStage3LogIds()` | 追踪 ending_stage3 log_id |
| `setLoopMemoryLogId(logId)` / `getLoopMemoryLogId()` | 追踪 loop_memory log_id |
| `setDiaryLogId(logId)` / `getDiaryLogId()` | 追踪最近 diary_generation log_id（跨周目日记链） |

### 9.3 feature 文件映射

| feature | NDJSON 文件 | 写入时机 |
|---|---|---|
| `dialogue_npc` | `logs/dialogue_npc.ndjson` | `flow.js` 的 `dispatchPlayerTurn` 成功/失败（非 abort）经 `dialogue/audit.js` 写入 |
| `api_connectivity_test` | `logs/api_connectivity_test.ndjson` | 测试连接按钮 click handler 成功/失败 |
| `ending_stage3` | `logs/ending_stage3.ndjson` | `runProducer` 阶段三，每参与角色一条 |
| `loop_memory` | `logs/loop_memory.ndjson` | `runLoopMemory` 成功后 |
| `subconscious_settlement` | `logs/subconscious_settlement.ndjson` | `runSubconsciousSettlement` 成功后 |
| `diary_generation` | `logs/diary_generation.ndjson` | `runNotebookGeneration` 成功/失败；重试时 retry_attempt=1 |
| `artifact_registry` | `logs/artifact_registry.ndjson` | `registerArtifact` / `registerPromptArtifact` 去重后注册 |

### 9.4 ID 体系

- **普通 log_id**：uuid v4，浏览器侧生成
- **保留 baseline ID**：`"baseline:char1_systemPrompt"` / `"baseline:char2_systemPrompt"` / `"baseline:char3_systemPrompt"` / `"baseline:0"`（无上游占位）
- **mutated artifact ID**：真实 uuid，存于 `artifact_registry` feature，指向 mutated_system_prompt / subconscious_patch / notebook_tone_preset 快照
- **source_ids**：每条日志携带上游 log_id 列表，构成可查询的数据链路

### 9.5 本地服务器端点（`local_server.example.py` → 复制为 `local_server.py`）

#### POST /api/log

- URL：`POST http://127.0.0.1:8765/api/log`
- 请求体：单条日志 JSON（UTF-8）
- 校验：feature 字段必须匹配白名单（7 个 feature）且通过 `[a-z0-9_]+` 正则校验
- 写入：追加一行到 `logs/<feature>.ndjson`（相对项目根，UTF-8，不覆盖）
- 大小限制：单条请求体 > 2MB 返回 413
- 响应：`{"ok": true, "log_id": "...", "path": "logs/<feature>.ndjson"}`
- CORS：允许所有来源（`Access-Control-Allow-Origin: *`）

#### GET /api/logs/ndjson

- URL：`GET http://127.0.0.1:8765/api/logs/ndjson?features=loop_memory,subconscious_settlement,diary_generation`
- 查询参数 `features`（可选，逗号分隔）：限定读取的 feature 文件；缺省则读取全部白名单 feature
- 响应：`{"ok": true, "lines": [ {...}, ... ], "count": N}` — 每行一条已解析的日志对象
- 消费方：`log-restore.js` → `loop.js` `showManualSelect()` 的「继续上一段记忆」入口、以及 `index.html` 登录遮罩 `doLogin()` 的「云端无存档/失败」兜底分支

### 9.6 logs/ 目录约定

- 路径：项目根下 `logs/` 子目录，由 `local_server.py` 或 `backend/server.py` 在首次写入时创建
- 格式：NDJSON（每行一个完整 JSON 对象）
- 版本控制：`logs/` 已加入 `.gitignore`

### 9.7 云端后端端点（`backend/server.py`，默认 `:8090`）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/user/login` | 昵称 + 4 位 PIN 登录/注册 |
| GET | `/api/user/{user_id}/save` | 拉取 v2 archive |
| PUT | `/api/user/{user_id}/save` | 推送 v2 archive（`SaveAdapter.save`） |
| POST | `/api/log` | 审计日志落盘（与本地 server 兼容） |
| GET | `/api/logs/ndjson` | 日志批量读取（log-restore 用） |

前端 `window.NPC_CLOUD_BASE_URL` 指向上述服务根 URL；未配置时降级纯本地模式。

---

## 10. Phase 1–3 扩展模块

### 10.1 存档 v2 三路径升级（`loop.js`）

| 函数 | 调用场景 | `loop_index` 语义 |
|---|---|---|
| `upgradePendingArchive` | sessionStorage 自动续档、`SaveAdapter.load` 的 v1 档 | 已是**下一周目**（resume target），不 +1 |
| `upgradeExportArchive` | 用户手动粘贴导出 JSON | 是**已完成周目**，resume = loop_index + 1 |
| `upgradeRestoredArchive` | 云端拉取 | v2 直返；v1 同 pending |

### 10.2 `window.LoopState` 公共 API（完整）

`getLoopIndex` · `getStageId` · `getCompletedStageIds` · `appendCompletedStage` · `start` · `jumpToTestLoop` · `getLastLoopSummary` · `getNotebookEntries` · `appendNotebookEntry` · `replaceLastNotebookEntry` · `upgradeRestoredArchive`

### 10.3 Phase 3 云端模块

| 模块 | 职责 |
|---|---|
| `CloudSync` | `login` / `loadSave` / `pushSave` / `pushLog`；`BASE_URL` 来自 config |
| `UserSession` | 会话持久化；`NPC_SKIP_LOGIN` 跳过登录 |
| `SaveAdapter` | `load()` 写 sessionStorage；`save(archive)` 必须 await 后再 reload |

### 10.4 `config.local.js` 全局变量

| 变量 | 说明 |
|---|---|
| `window.AI_PROVIDER` | `"gemini"` \| `"siliconflow"` |
| `window.GEMINI_PRESET_*` / `SILICONFLOW_PRESET_*` | API Key 与模型 |
| `window.NPC_CLOUD_BASE_URL` | 云端 API 根 URL；空则跳过登录 |
| `window.NPC_SKIP_LOGIN` | `true` 时强制本地模式 |

### 10.5 验收与状态文档

- 浏览器验收清单：`dev-notes/00_acceptance-checklist.md`
- 项目状态：`dev-notes/00_project-status.md`
- 功能路线图：`dev-notes/05_feature-roadmap.md`

---

*文档终。架构级变更后须同步更新。最后同步：2026-05-28（API 缓存：`loop.js` 不再清除 `npc_api_key`；`settings.js` 在 unload/reload 前强制 `persistApiConfigCache`；`ending.js` 在 `location.reload()` 前同步写入）。*

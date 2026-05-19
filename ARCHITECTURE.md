# ARCHITECTURE.md
> **Source of Truth** — 供未来 AI 或人类开发者使用的架构参考文档。
> 生成日期：2026-03-05 | 最后更新：2026-03-11 | 审查者：资深架构师（AI）

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
├── index.html            # [唯一 HTML 入口] 内联 intro `#intro-overlay`；header 含 API 配置区与
│                         # `#test-mode-checkbox`（`npc_test_mode`）；`#timeline-actions` 仅 `#ending-button`；
│                         # 主界面 `#notebook-panel` / `#notebook-body`（只读上轮 `archive.summary` 占位）；
│                         # 通过顺序 <script> 标签编排所有 JS 模块的加载顺序（顺序即依赖）。
│
├── style.css             # [全局样式层] 所有 CSS 均在此；包含入场遮罩动画、场景动画、
│                         # 对话气泡、终局遮罩、周目选择遮罩等全部视觉。
│
├── characters.js         # [数据定义层] NPC 原始数据、颜色计算工具函数。
│                         # 职责边界：只管"角色是什么"，不管"对话怎么发生"。
│                         # 对外暴露：window.NPCConfig
│
├── notebook-config.js    # [配置层 · F-004] 跨周目笔记本静态骨架表。
│                         # LOOP_NOTEBOOK_TONE（1–10 emotion/memoryLevel/infoSnippet/headerLabel）。
│                         # 职责边界：只持有静态配置；不发请求、不写 DOM。
│                         # 对外暴露：window.NotebookConfig
│
├── loop-script.js        # [配置层] 周目剧本：1–10 周目三角色 × 两选项的 quick reply 文本、
│                         # 测试模式 mock 回复（reply/touched/closing_signal）、测试占位日记正文。
│                         # 职责边界：只持有静态剧本；不发请求、不写 DOM。
│                         # 对外暴露：window.LoopScript
│
├── dialogue.js           # [对话核心层] 对话状态、AI 调用、DOM 渲染全部集中于此。
│                         # 职责最重，是项目最核心也是最脆弱的文件。
│                         # 对外暴露：window.DialogueState
│
├── ending.js             # [终局演出层] 全屏覆盖遮罩、分屏叙事、异步 API 调用、导出。
│                         # 依赖 window.DialogueState 的快照数据。
│                         # 对外暴露：window.EndingState
│
├── loop.js               # [周目入口层] 周目选择界面、sessionStorage 自动导入、
│                         # 手动 JSON 导入、mutableSubconscious 注入。
│                         # 对外暴露：window.LoopState
│
├── config.example.js     # [配置模板] 明确标注需复制为 config.local.js 并填入 Key。
│                         # 此文件永远不应包含真实密钥，应提交到版本库。
│
├── config.local.js       # [本地密钥] .gitignore 排除，不提交。注入五个预设全局变量：
│                         # window.AI_PROVIDER（"gemini" | "siliconflow"）
│                         # window.GEMINI_PRESET_KEY, window.GEMINI_PRESET_MODEL
│                         # window.SILICONFLOW_PRESET_KEY, window.SILICONFLOW_PRESET_MODEL
│
├── AI_DEV_WORKFLOW.md    # [AI 协作规范] 供人类开发者每次提交 AI 更新请求时使用的
│                         # 标准化操作文档：前置动作清单、更新请求模板、
│                         # ARCHITECTURE.md 同步规则、验收自查清单。
│
└── README.md             # 极简说明（当前内容极少，需补充）
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
│                 window.LoopState { getLoopIndex,          │
│                   jumpToTestLoop, getNotebookEntries,     │
│                   getLastLoopSummary, … }                 │
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
│  [对话层]   dialogue.js                                  │
│             window.DialogueState                         │
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
- 当前顺序：`config.local.js` → `characters.js` → **`notebook-config.js`** → **`loop-script.js`** → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本。`notebook-config.js` / `loop-script.js` 都是无依赖的静态配置层；`dialogue.js`（quick reply 渲染 + 测试模式短路 mock）、`loop.js`（`buildTestNotebookBody`）、`ending.js`（notebook prompt 与 8.3 跨周目剧本约束）通过 `window.LoopScript` 在运行时消费。

---

## 4. 数据流与状态管理 (Data Flow & State Management)

### 4.1 全局状态

本项目无状态管理框架。状态以两种形式存在：

| 状态位置 | 内容 | 生命周期 |
|---|---|---|
| `dialogue.js` 内部 `const state = {}` | `characters[]`（含坦诚度、mutableSubconscious）、`dialogueHistories{}`、`closingStreaks{}`、`unlockedChars`、`passedChars`、**`readOnly`**（查看已离开角色时为只读）、`activeRequests{ charId: AbortController }`（也作为当前角色“思考中”门禁来源） | 页面整个生命周期；`activeRequests` 仅记录当前 in-flight 请求，完成或取消后清理 |
| `ending.js` 内部 `window.EndingState` | 终局快照、各阶段 AI 结果、`loopSummary`（结算一句话总结） | 终局触发后 |
| `loop.js` 内部 `loopState` | `currentLoopIndex`（当前周目编号）、`lastLoopSummary`（上一周目 `archive.summary`，由 `injectArchive` 写入）、**`notebook[]`（跨周目日记 entry 数组，由 `injectArchive` 读入、`ending.js` 通过 `appendNotebookEntry` / `replaceLastNotebookEntry` 写回）** | 页面整个生命周期 |
| `notebook-config.js`（无可变状态） | `LOOP_NOTEBOOK_TONE`（1–10 静态骨架表，AI 仅看当前周目 entry） | 页面整个生命周期（只读） |
| `loop-script.js`（无可变状态） | `QUICK_REPLIES_BY_LOOP`（1–10 三角色 × 两选项的 quick reply 文本 + 测试模式 mock）、`TEST_NOTEBOOK_BODY_BY_LOOP`（测试占位日记正文） | 页面整个生命周期（只读） |
| `window.AI_PROVIDER` | 当前选择的 API 来源（`"gemini"` \| `"siliconflow"`） | 页面整个生命周期 |
| `window.GEMINI_PRESET_KEY/MODEL` | Gemini 用户配置 | 页面整个生命周期 |
| `window.SILICONFLOW_PRESET_KEY/MODEL` | 硅基流动用户配置 | 页面整个生命周期 |
| `localStorage('npc_api_provider')` | 用户上次选择的 API 来源（页面刷新后自动回填表单，回退至 `window.AI_PROVIDER`） | 浏览器本地持久化 |
| `localStorage('npc_api_key')` | 用户上次填写的 API Key（页面刷新后自动回填输入框） | 浏览器本地持久化 |
| `localStorage('npc_api_model')` | 用户上次填写的模型名（页面刷新后自动回填输入框） | 浏览器本地持久化 |
| `sessionStorage('npc_pending_loop')` | 跨刷新传递的 loop_archive 对象（由「直接开启下一轮次」写入，loop.js 启动时消费并删除） | 跨 reload，标签页关闭后清空 |

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

切换角色、`advanceOrTriggerEnding()` 推进到下一人、`resetForNewLoop()` 或进入终局时，会取消对应角色或全部对话层 `activeRequests`。同角色重复发送不会再取消旧请求，而是在当前角色思考中禁用 `send-button`、quick reply 与 textarea。`AbortError` 只有在对应 `AbortController` 已由本地取消路径打标时才属于主动取消，调用方静默丢弃，不写回对话历史、不更新 candor/closing，也不追加红色错误消息；其他 HTTP、网络、JSON 解析或字段缺失错误必须展示给用户。

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
  [3] 尾声: 轮回句（周目 3 为「买花」变体，其余多为「她闭上眼，然后又睁开」；8–10 为 `[待替换]` 占位）+ summary block + 四按钮
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
         ▼ [尾声页四按钮]
  ① 保存对话数据 → doExportTxt() → Blob → .txt（含初始人设）
  ② 保存轮回记忆 → doExportJson() → Blob → loop_archive_[ts].json
  ③ 直接开启下一轮次 → doStartNextLoop() → sessionStorage('npc_pending_loop') → reload
  ④ 重新开始 → location.reload()（清白刷新）
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
         │
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
- `handleSend` 在 `await callGemini()` 返回后会核验 `AbortController.signal`、`state.activeRequests[charId]` 与 `state.currentCharacterId` 是否仍匹配；若用户在等待期间切换了角色或发起了更新请求，则静默丢弃该回复，不写入历史也不触发任何渲染。
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

---

---

## 4.5 loop_archive JSON 结构

`loop_archive_[ISO时间戳].json` 由「保存轮回记忆」导出，可通过「继续上一段记忆」手动导入，或由「直接开启下一轮次」经 sessionStorage 自动传递。

```json
{
  "loop_index": 2,
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

- `dejaVuLevel`：上轮终局时的 `currentCandor`（0–6），用作下轮"似曾相识"程度的数值参考
- `nextLoopPromptPatch`：若非空，导入时自动追加到对应角色的 systemPrompt（`【前世记忆补丁】`）
- `summary`：由轮回记忆整理 Prompt（`runLoopMemory()`）生成，记录「与谁聊了、关系、值得记住的事、终局行为」；失败则为空字符串。日记生成复用此字段，不再单独截断对话摘要
- `notebook[]`（F-004）：跨周目主角第一人称碎碎念日记，逐轮 append。entry 含 `loopIndex` / `headerLabel` / `body` / `tonePreset` 快照 / `generatedAt` / `source`（`ai` | `fallback` | `mock`）/ `error`。第 1 周目 UI 隐藏；第 2+ 周目右下角 64×64 图标按钮 + 居中弹层翻页。7-8 周目页眉「轮回了不知道多少次……」，正文允许 `<del>` 标签划字 + 截断句（严禁错别字）。失败兜底正文为空，UI 显示「这一轮的记忆模糊了……」。AI 仅看当前周目 `LOOP_NOTEBOOK_TONE[loopIndex]` 预设，不见全表。

---

### ⚠️ 警告未来开发者 (Critical Warnings)

> **1. `dialogue.js` 是最脆弱的核心文件**
> 该文件同时承担：状态管理、AI 调用、JSON 解析、DOM 渲染、事件绑定。任何修改都可能产生跨关注点的副作用。在修改前务必完整阅读全文。

> **2. `<script>` 加载顺序不可随意调整**
> `index.html` 中的脚本顺序是隐式的依赖声明：`dialogue.js` 在加载时立即访问 `window.NPCConfig`，`loop.js` 在加载时立即访问 `window.NPCConfig` 和 `window.DialogueState`，`ending.js` / `loop.js` 在终局/导入路径中访问 `window.NotebookConfig`，内联 intro-overlay 脚本必须在 `loop.js` 之后运行（loop.js 的 capture keydown 拦截器须先注册）。任何顺序调整都可能导致运行时崩溃或拦截器失效。
> 当前顺序：`config.local.js` → `characters.js` → **`notebook-config.js`** → **`loop-script.js`** → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本。

> **3. `closingStreaks` 在单局内单向不可逆，但跨周目会被重置**
> 某个角色在单轮 AI 响应中返回 `closing_signal: true` 时，`closingStreak` 会立即设为 `CLOSE_THRESHOLD`（3），该角色对话在**本局**永久关闭，无法通过任何用户操作恢复。`closing_signal: false` 且尚未关闭时，streak 归零。这是刻意的设计决定。
> 跨周目导入存档时，`loop.js` 的 `injectArchive` 会在注入前调用 `DialogueState.resetForNewLoop()`，将 `closingStreaks`、`dialogueHistories`、`currentCandor` 全部归零，保证新一周目以干净状态开始。✓ 已修复（陷阱 B）

> ~~**4. `ending.js` 的 `#ending-panel` DOM 节点是死代码**~~
> ~~`index.html` 中定义的 `<section class="ending-panel">` 在运行时**从不被使用**。`ending.js` 通过 `document.body.appendChild(overlay)` 动态创建完全独立的 `#ending-overlay`。该 HTML 节点可安全移除。~~ **✓ 已修复：废弃节点已从 `index.html` 删除。**

> **5. API Key 存在泄露风险**
> Gemini API Key 以 `?key=` 形式附加在 `fetch` URL 的 query string 中；硅基流动 API Key 以 `Authorization: Bearer` 请求头形式发送。两者均会被浏览器 `devtools` 网络面板及任何代理日志捕获。作为 Demo 项目这是已知权衡，但若部署于公开环境，须通过后端代理隐藏 Key。
> 此外，API Key 现在通过 `localStorage` 持久化（明文存储）。在共享设备上使用时需注意，其他访问该浏览器的用户可在 devtools 中直接读取 `localStorage.getItem('npc_api_key')`。
>
> **（控制台）CORS 与 `Authorization` 头**：跨域请求携带 `Authorization` 时，浏览器可能对远端返回的 `Access-Control-Allow-Headers: *` 打印弃用或策略类警告；属浏览器与服务商 CORS 配置问题，**不作为本 Demo 业务逻辑缺陷**。长期可由官方修正 CORS、或经同源代理、或改用不设该头的调用方式。

> ~~**7. `error` 角色消息在 Gemini provider 中未被过滤**~~ **✓ 已修复（2026-05-18 性能修复包）**：`callGeminiProvider` 在构建 `contents` 时使用 `VALID_GEMINI_ROLES` 白名单，仅保留 `user`/`model`；`error`、`system` 等角色仍存入 `dialogueHistories` 供页面渲染，但不再进入 Gemini 请求上下文。

> **6. `injectSubconscious` 的 `systemPrompt` 追加必须使用 `_originalSystemPrompt` 为基准**
> `characters.js` 中每个角色在数组定义后立即快照 `_originalSystemPrompt`。`injectSubconscious` 必须写成 `char.systemPrompt = char._originalSystemPrompt + patch`（赋值覆盖），**不得使用 `+=`（追加）**。若改回追加形式，玩家在同一页面生命周期内多次导入存档时，补丁会叠加，AI 收到重复指令。✓ 已修复（陷阱 A）

---

## 6. 待优化点 (Tech Debt & Refactoring)

### P0 — 架构性问题

| # | 问题 | 影响 | 建议方向 |
|---|---|---|---|
| 1 | **`window` 全局共享带来隐式耦合** | 模块加载顺序错误时无任何静态检查，调试困难 | 迁移至 ES Module（`import/export`）+ `<script type="module">`，消除全局依赖 |
| 2 | **`dialogue.js` 职责过重（God Object）** | 状态、网络、渲染、事件全混在一起，极难单独测试 | 拆分为 `state.js`（状态）、`api.js`（Gemini 封装）、`renderer.js`（DOM）|

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
| ~~10~~ | ~~**API 配置页面刷新后丢失**~~ | ~~每次刷新后用户需重新填写 provider / API Key / 模型名，体验差~~ **✓ 已修复：`setup()` 通过 `localStorage`（键名 `npc_api_provider`、`npc_api_key`、`npc_api_model`）在加载时自动回填、在 `input`/`change` 事件时实时保存。** | ~~将表单输入持久化到 localStorage~~ |
| 8 | **`README.md` 内容极少** | 新开发者无法快速了解如何启动项目、如何配置 API Key | 补充：安装说明、`config.local.js` 配置方法、运行方式、项目背景 |
| 9 | **无任何自动化测试** | 核心函数（`updateCandorAndColor`, `mixColors`, `normalizeSchema`）均为纯函数，天然可测 | 引入 `Vitest` 或原生 `Node.js test runner` 对纯函数层添加单元测试 |

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
| 保存对话数据 | 下载 .txt（含初始人设） | 否 |
| 保存轮回记忆 | 下载 loop_archive JSON（供手动导入） | 否 |
| 直接开启下一轮次 | sessionStorage 写入 archive → reload | 否 |
| 重新开始 | 清白 reload，无数据传递 | 否 |

### 8.2 周目入口三状态

| 状态 | 触发条件 | 行为 |
|---|---|---|
| 自动续档 | sessionStorage 有 `npc_pending_loop` | 显示「记忆已延续·第N周目」1.5s → intro |
| 新周目 | 无 sessionStorage，点击「开启新的旅程」 | currentLoopIndex=1 → intro |
| 手动导入 | 无 sessionStorage，点击「继续上一段记忆」 | 粘贴 JSON → 注入 → 预览3s → intro |
| **测试跳转** | 无 sessionStorage，页眉已勾选测试模式，点击「测试：跳转到指定周目」 | 选择 1–10 → 合成 mock `characters` + `notebook[1..N-1]` → `injectArchive` → 预览 1.5s → intro；上次周目记入 `localStorage.npc_test_start_loop` |

### 8.3 mutableSubconscious 生命周期

每个 NPC 的 `mutableSubconscious` 在 `characters.js` 中以空值初始化。

**导入阶段**：`loop.js` 的 `injectArchive` 先调用 `DialogueState.resetForNewLoop()` 清空状态，再调用 `NPCConfig.injectSubconscious` 将数据写入 `baseCharacters`（幂等：以 `_originalSystemPrompt` 为基准覆盖写入 `systemPrompt`），最后通过 `DialogueState.patchCharacter` 将 `baseCharacters` 的规范值同步到活跃的 `state.characters`。

**结算阶段**：`ending.js` 在 stage 3 全部完成后，非阻塞地对三个 NPC 并行调用「高维命运观测者」结算 Prompt（`runAllSubconsciousSettlements`）。**该结算只看本轮对话历史 + `currentCandor`，不读取 stage1/2/3 的行为与台词**——刻意切断终局事件对潜意识的污染（NPC 不应记得「自己最终救/没救玩家」或「被刀刺」之类的具体事件）。Prompt 强约束：补丁文本主语必须是 NPC、宾语必须是「那个陌生人」(玩家)，必须从对话里抽取 1–3 个真实出现过的关键词（话题/物件/场景）作为印象锚点；**禁止**把 NPC 自身设定特征（背相机、背书包、店家、刚从图书馆出来等）误写成玩家的特征；**禁止**出现死/刀/血/危险/救等终局相关词。结果写入 `endingState.dialogueSnapshot.characters[].mutableSubconscious` 的三个叙事字段（`subconsciousImpression`、`thresholdAdjustment`、`nextLoopPromptPatch`）。`dejaVuLevel` 始终由 `buildArchiveObject` 从 `currentCandor` 计算覆盖，不使用 AI 返回值。

**导出阶段**：`buildArchiveObject` 从 `endingState.dialogueSnapshot` 读取已结算的 `mutableSubconscious`，写入 `loop_archive` JSON。下一周目导入时注入，实现情绪残留的跨轮传递。同时读取 `LoopState.getNotebookEntries()` 写入 `archive.notebook[]`（F-004）。

### 8.4 笔记本数据流（F-004）

`runEnding()` 触发时立刻通过 `appendCurrentLoopFallbackEntry()` 在 `loopState.notebook` 末尾 append 一条占位 entry（`body=""`、`source="fallback"`），保证任何瞬时点击「保存轮回记忆」/「直接开启下一轮次」都能携带当前周目条目。

`runEndingPostStage` 的第三并行任务 `notebookTask` 复用 `DialogueState.callGemini({ responseSchema: NOTEBOOK_SCHEMA, ... })`：
- 仅传当前周目 `NotebookConfig.getTonePresetFor(loopIndex)` + 本轮上下文摘要 + 上一页末尾 60 字，AI **不见** 完整 `LOOP_NOTEBOOK_TONE` 1–10 表。
- 7-8 周目 prompt 显式要求 `<del>` + 截断句、严禁错别字（所有"模糊感"通过 `<del>` 与截断句呈现）。
- 第 9 周目 prompt 要求「真相 + 疲惫 + 想结束」主题，**不再嵌入任何固定金句**（旧金句「既然有时间，为什么不现在去过呢？」已废除）；第 10 周目要求「反杀凶手 + 留下花 + 合上笔记本离开」释然告别基调。
- 成功 → `LoopState.replaceLastNotebookEntry(真实 entry)` 覆盖 fallback；失败 / 长度异常 / 含元信息 → 保留 fallback。

UI 端（`index.html` 内联）使用受控 HTML 渲染 `renderNotebookBodyHtml(body)`：先全转义 `& < >`，再仅放回 `<del>` / `</del>` / `<br>` 三个白名单标签，其他 HTML 一律字面化，杜绝 XSS。第 1 周目隐藏入口；第 2+ 周目右下 64×64 图标按钮 + 居中弹层（70vw × 80vh，z-index 700/710，低于终局 overlay）+ 翻页（按钮 / ←/→ / Esc / 点遮罩关闭）。`dialogue.js` 仅扩展 `buildMockFromSchema` 内一行 `responseSchema.title === "notebook"` 识别，返回含 `<del>` 样例的稳定 mock 文本，**未拆分、未重构 provider、未改 `callGemini`**。

### 8.5 周目剧本（quick reply 周目化 + 测试模式默认对白）

`loop-script.js` 作为独立配置层持有 1–10 周目的剧本数据：
- `QUICK_REPLIES_BY_LOOP[loopIndex][charId]`：当前周目该角色的两条 quick reply 文本 + 对应的 mock 回复（`reply` / `touched` / `closing_signal`）。
- `TEST_NOTEBOOK_BODY_BY_LOOP[loopIndex]`：跳周目测试时直接显示的占位日记正文（不走 AI 生成）。
- 第 7/8 周目 quick reply 通用为「我恨你们 / 可以陪陪我吗？」；选择「可以陪陪我吗？」时 mock 回复触发该角色的回忆主题（蓝→看书 / 橙→吵架 / 紫→装扮）。
- 第 9/10 周目 quick reply 为「告别 + 谢谢/恨」基调，配合第 10 周目反杀凶手 + 留下花的终局叙述。

**消费路径**：
- `dialogue.js` `syncQuickReplyUi` 优先按当前周目从 `LoopScript.getQuickReplies(charId, loopIndex)` 取文本，回退到 `characters.js` 静态 `quickReplies`。
- `dialogue.js` `dispatchPlayerTurn` 在 **测试模式 + 命中本周目某条 quick reply 文本** 时短路 `callGemini`，直接用 mock 走原 `appendMessage("model", ...)`、candor、closing 校验路径；**不修改 callGemini 路由、provider 实现、错误处理链路**。
- `loop.js` `buildTestNotebookBody` 优先读 `LoopScript.getTestNotebookBody(loopIndex)`，回退到 `NOTEBOOK_MOCK_BODY_DEL` / 通用占位。

---

*文档终。此文档应在每次架构级别变更后同步更新。最后同步：2026-05-19（周目剧本：(1) 新增 `loop-script.js` 配置层，承载 1–10 周目 quick reply 文本 + 测试模式默认对白 + 测试占位日记；(2) `dialogue.js` quick reply 周目化 + 测试模式短路 mock；(3) Intro 文案补齐第 4/5/6 周目；(4) notebook-config 第 4 周目信息边界改为「记起为买花被杀，凶手在路人之中」、第 9 周目改为「真相+疲惫+有人通过留花离开+想结束」；(5) ending.js 第 9 周目废除「既然有时间」金句、第 10 周目终局叙述改为主角反杀凶手并留下一束花。）*

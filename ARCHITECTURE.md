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
├── index.html            # [唯一 HTML 入口] 定义完整 DOM 结构；通过顺序 <script> 标签
│                         # 编排所有 JS 模块的加载顺序（顺序即依赖）。
│                         # 关键 DOM 节点：#intro-overlay（入场遮罩，渲染后由内联脚本移除）
│
├── style.css             # [全局样式层] 所有 CSS 均在此；包含入场遮罩动画、场景动画、
│                         # 对话气泡、终局遮罩、周目选择遮罩等全部视觉。
│
├── characters.js         # [数据定义层] NPC 原始数据、颜色计算工具函数。
│                         # 职责边界：只管"角色是什么"，不管"对话怎么发生"。
│                         # 对外暴露：window.NPCConfig
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
│                 window.LoopState { getLoopIndex }         │
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
│               resetForNewLoop }                          │
│             内部：callGeminiProvider / callSiliconFlow-  │
│             Provider（由 callGemini 按 AI_PROVIDER 路由） │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量消费（触发时机：#ending-button click）
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

---

## 4. 数据流与状态管理 (Data Flow & State Management)

### 4.1 全局状态

本项目无状态管理框架。状态以两种形式存在：

| 状态位置 | 内容 | 生命周期 |
|---|---|---|
| `dialogue.js` 内部 `const state = {}` | `characters[]`（含坦诚度、mutableSubconscious）、`dialogueHistories{}`、`closingStreaks{}` | 页面整个生命周期 |
| `ending.js` 内部 `window.EndingState` | 终局快照、各阶段 AI 结果、`loopSummary`（结算一句话总结） | 终局触发后 |
| `loop.js` 内部 `loopState` | `currentLoopIndex`（当前周目编号） | 页面整个生命周期 |
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
state.dialogueHistories[charId].push({ role: "user", content })
         │
         ▼ callGemini()
         ├── [无 API Key] → mockResponse() → 返回硬编码模拟数据
         └── [有 API Key] → 按 provider 路由
               ├── callGeminiProvider()：role 直接映射（"user"/"model"）
               └── callSiliconFlowProvider()：
                     过滤非法 role（仅保留 "user"/"assistant"/"system"/"tool"，
                     "model" 转换为 "assistant"，"error" 等无效角色被丢弃）
                     → fetch POST OpenAI 兼容 API
                   (system_instruction + filtered history + responseSchema)
                                         │
                                         ▼ 解析 JSON
                    { reply: string, touched: boolean, closing_signal: boolean }
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
  appendMessage("model", reply)   stepCandorAndColor()     closingStreaks[charId]++
  → history.push(model msg)       → touched=true: +rise    → if >= 3: 对话关闭
  → renderDialogueHistory()       → touched=false: -fall   → 插入系统提示消息
    (全量重绘对话 DOM)              → updateCandorAndColor()
                                   → currentColor = mixColors()
                                   → renderSceneCharacters()
                                     (圆圈颜色渐变 + active class)
```

### 4.3 终局阶段数据流

```
[#ending-button click] → runEnding()（一次性保护：EndingState.triggered）
         │
         ▼
DialogueState.getSnapshot() → 深拷贝所有角色数据 + 对话历史
         │
         ▼ runProducer()
4 个页面帧入队：
  [0] 阶段一: 静态文案（根据 colorMood() 生成，立即 ready）
  [1] 阶段二: 每个 NPC 的"即时行为"（异步 callGemini，slot loading → fillSlot）
  [2] 阶段三: 每个 NPC 的"最终选择"（依赖阶段二结果，异步 callGemini）
  [3] 尾声: summary block（响应式）+ 四按钮
         │
         ├─ stage 3 完成后（两者并行、非阻塞）：
         │   ① runSummary() → endingState.loopSummary → updateSummaryDom() 响应式填入尾声页
         │   ② runAllSubconsciousSettlements()（高维命运观测者，逐 NPC 并行）
         │      → 写入 endingState.dialogueSnapshot.characters[].mutableSubconscious
         │        { subconsciousImpression, thresholdAdjustment, nextLoopPromptPatch }
         │      → buildArchiveObject 读 snapshot 导出时自动包含结算内容
         │
         ▼ createOverlay() → document.body 追加 #ending-overlay
用户翻页（点击 / 60s 超时）→ advance()（翻页前检查当前帧所有 slots.ready）→ renderEntry()
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
         │ → { loop_index, ran_at, characters:{ immutableCore, mutableSubconscious }, summary }
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
- API 调用失败时，`handleSend` 的 `catch` 及 null 检查会向对话框追加红色 `error` 类型的系统提示消息，告知用户发生了错误。**无全局错误边界**，对话流之外的异常仍仅打印到控制台。
- `handleSend` 在 `await callGemini()` 返回后会核验 `state.currentCharacterId` 是否仍等于请求发起时的角色 id；若用户在等待期间切换了角色，则静默丢弃该回复，不写入历史也不触发任何渲染。
- **`error` 角色消息过滤**：`appendMessage("error", ...)` 追加的错误提示消息会被存入 `dialogueHistories`（用于页面渲染），但 `callSiliconFlowProvider` 在构建请求体时会通过白名单（`VALID_SF_ROLES`）将其过滤，不发送给 API。`callGeminiProvider` 侧通过 `role !== "user"` 时全部映射为 `"model"` 的方式亦不会引发问题，但错误消息会以 `model` 角色进入 Gemini 上下文——这是一个已知的轻微不一致，尚未统一修复。

### 5.4 不可变更新模式

`updateCandorAndColor()` 采用不可变更新，返回新对象而非直接修改原角色对象：

```javascript
return { ...character, currentCandor: newCandor, currentColor: newColor };
```

### 5.5 响应式 DOM 渲染模式

项目无虚拟 DOM，使用**全量重绘**策略：每次状态变化后，对应的 `render*()` 函数清空容器 `innerHTML` 并重建所有 DOM 节点。适合当前对话数量规模，但有性能上限。

### 5.6 candor 代码驱动累加约定

`currentCandor`（0–6）由代码完全控制，AI 不再返回绝对值，只返回 `touched: boolean`（本轮是否真实触碰角色）。`stepCandorAndColor(character, touched)` 读取角色的 `candorRates` 字段进行单步累加或衰减，再调用 `updateCandorAndColor` 计算颜色。

**设计动机**：AI 每轮重新评估绝对坦诚度时存在随机抖动，导致颜色在相近质量的对话间跳动。改为 boolean 后，AI 只判断本轮有无连结，累加逻辑由代码保证确定性。

各 NPC 的 `candorRates` 配置：

| NPC | rise | fall | 说明 |
|---|---|---|---|
| char1（她·蓝） | 1 | 1 | 双向缓慢，无声退潮 |
| char2（他） | 1 | 6 | 上升缓慢，一次刺激直接归零（二元人格） |
| char3（她·紫） | 1 | 1 | 双向缓慢，退潮一旦开始持续不停 |

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
        "name": "她·蓝",
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
  "summary": "玩家与她·蓝建立了真实连结，但在危机时刻仍未能改变旁观者的沉默。"
}
```

- `dejaVuLevel`：上轮终局时的 `currentCandor`（0–6），用作下轮"似曾相识"程度的数值参考
- `nextLoopPromptPatch`：若非空，导入时自动追加到对应角色的 systemPrompt（`【前世记忆补丁】`）
- `summary`：由结算 Prompt（ending.js 内 `runSummary()`）生成，若 API 调用失败则为空字符串

---

### ⚠️ 警告未来开发者 (Critical Warnings)

> **1. `dialogue.js` 是最脆弱的核心文件**
> 该文件同时承担：状态管理、AI 调用、JSON 解析、DOM 渲染、事件绑定。任何修改都可能产生跨关注点的副作用。在修改前务必完整阅读全文。

> **2. `<script>` 加载顺序不可随意调整**
> `index.html` 中的脚本顺序是隐式的依赖声明：`dialogue.js` 在加载时立即访问 `window.NPCConfig`，`loop.js` 在加载时立即访问 `window.NPCConfig` 和 `window.DialogueState`，内联 intro-overlay 脚本必须在 `loop.js` 之后运行（loop.js 的 capture keydown 拦截器须先注册）。任何顺序调整都可能导致运行时崩溃或拦截器失效。
> 当前顺序：`config.local.js` → `characters.js` → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本。

> **3. `closingStreaks` 在单局内单向不可逆，但跨周目会被重置**
> 某个角色的 `closingStreak` 一旦达到 `CLOSE_THRESHOLD`（3），该角色对话在**本局**永久关闭，无法通过任何用户操作恢复。这是刻意的设计决定。
> 跨周目导入存档时，`loop.js` 的 `injectArchive` 会在注入前调用 `DialogueState.resetForNewLoop()`，将 `closingStreaks`、`dialogueHistories`、`currentCandor` 全部归零，保证新一周目以干净状态开始。✓ 已修复（陷阱 B）

> ~~**4. `ending.js` 的 `#ending-panel` DOM 节点是死代码**~~
> ~~`index.html` 中定义的 `<section class="ending-panel">` 在运行时**从不被使用**。`ending.js` 通过 `document.body.appendChild(overlay)` 动态创建完全独立的 `#ending-overlay`。该 HTML 节点可安全移除。~~ **✓ 已修复：废弃节点已从 `index.html` 删除。**

> **5. API Key 存在泄露风险**
> Gemini API Key 以 `?key=` 形式附加在 `fetch` URL 的 query string 中；硅基流动 API Key 以 `Authorization: Bearer` 请求头形式发送。两者均会被浏览器 `devtools` 网络面板及任何代理日志捕获。作为 Demo 项目这是已知权衡，但若部署于公开环境，须通过后端代理隐藏 Key。
> 此外，API Key 现在通过 `localStorage` 持久化（明文存储）。在共享设备上使用时需注意，其他访问该浏览器的用户可在 devtools 中直接读取 `localStorage.getItem('npc_api_key')`。

> **7. `error` 角色消息在 Gemini provider 中未被过滤**
> `appendMessage("error", ...)` 产生的错误提示消息会进入 `dialogueHistories`。`callSiliconFlowProvider` 通过白名单 `VALID_SF_ROLES` 正确过滤了这类消息。但 `callGeminiProvider` 对所有非 `"user"` 角色一律映射为 `"model"`，导致错误提示消息会以 `role: "model"` 混入 Gemini 上下文，污染 NPC 的对话记忆。若出现 NPC 突然"提及自己听不见"等异常表现，优先排查此问题。修复方向：在 `callGeminiProvider` 的 contents 构建处同样增加角色白名单过滤。

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
| 3 | **`renderDialogueHistory()` 全量重绘** | 随对话轮次增加，每次发送消息后整个对话 DOM 被销毁重建，性能随对话增长线性下降 | 改为增量追加：仅 `appendChild()` 新消息节点 |
| 4 | **`colorMood()` 重复实现 `hexToRgb`** | `characters.js` 已有 `hexToRgb()`，`ending.js` 又自行实现了一遍相同逻辑 | 将 `hexToRgb` 移入 `window.NPCConfig` 工具函数并复用 |
| ~~5~~ | ~~**角色 `name` 字段不唯一**~~ | ~~char1 和 char3 均为 `"她"`，导出文本中会出现歧义的 `【她】...【她】`~~ **✓ 已修复：char1 改为 `"她·蓝"`，char3 改为 `"她·紫"`。** | ~~为角色增加可读唯一标识（如 `"她（蓝）"`）或在导出时使用 `id`~~ |
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

### 8.3 mutableSubconscious 生命周期

每个 NPC 的 `mutableSubconscious` 在 `characters.js` 中以空值初始化。

**导入阶段**：`loop.js` 的 `injectArchive` 先调用 `DialogueState.resetForNewLoop()` 清空状态，再调用 `NPCConfig.injectSubconscious` 将数据写入 `baseCharacters`（幂等：以 `_originalSystemPrompt` 为基准覆盖写入 `systemPrompt`），最后通过 `DialogueState.patchCharacter` 将 `baseCharacters` 的规范值同步到活跃的 `state.characters`。

**结算阶段**：`ending.js` 在 stage 3 全部完成后，非阻塞地对三个 NPC 并行调用「高维命运观测者」结算 Prompt（`runAllSubconsciousSettlements`）。结果写入 `endingState.dialogueSnapshot.characters[].mutableSubconscious` 的三个叙事字段（`subconsciousImpression`、`thresholdAdjustment`、`nextLoopPromptPatch`）。`dejaVuLevel` 始终由 `buildArchiveObject` 从 `currentCandor` 计算覆盖，不使用 AI 返回值。

**导出阶段**：`buildArchiveObject` 从 `endingState.dialogueSnapshot` 读取已结算的 `mutableSubconscious`，写入 `loop_archive` JSON。下一周目导入时注入，实现情绪残留的跨轮传递。

---

*文档终。此文档应在每次架构级别变更后同步更新。最后同步：2026-03-11（API 配置持久化、error 角色过滤）*

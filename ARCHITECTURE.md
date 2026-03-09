# ARCHITECTURE.md
> **Source of Truth** — 供未来 AI 或人类开发者使用的架构参考文档。
> 生成日期：2026-03-05 | 审查者：资深架构师（AI）

---

## 1. 项目概述 (Project Overview)

本项目是一个**纯前端单页互动 NPC Demo**，以"旁观者效应"为叙事核心：玩家通过与三个 NPC 的自然语言对话（由 Google Gemini API 驱动）建立不同深度的连结，随后触发危机事件，观察 NPC 因与玩家的关系深浅而做出截然不同的行为选择——是对"环境与情感连结能否改变一个人危机时刻决策"这一命题的可玩化实验。

### 技术栈清单

| 技术 / 库 | 版本 | 用途 |
|---|---|---|
| 原生 HTML5 | — | 页面结构与入口 |
| 原生 CSS3 | — | 全局样式、动画、响应式布局 |
| 原生 JavaScript (ES2020+) | — | 所有业务逻辑，使用 IIFE 模块模式 |
| Google Gemini REST API | v1beta | 驱动 NPC 对话（`generateContent` 端点） |
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
│                         # 对话气泡、终局遮罩等全部视觉。无 CSS Module/BEM 方法论，
│                         # 直接使用 ID/class 选择器。
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
├── config.example.js     # [配置模板] 明确标注需复制为 config.local.js 并填入 Key。
│                         # 此文件永远不应包含真实密钥，应提交到版本库。
│
├── config.local.js       # [本地密钥] .gitignore 排除，不提交。注入两个预设全局变量：
│                         # window.GEMINI_PRESET_KEY, window.GEMINI_PRESET_MODEL
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

项目按职责被划分为 5 个层次（含入场展示层）：

```
┌─────────────────────────────────────────────────────────┐
│  [入场层]   index.html 内联脚本                           │
│             #intro-overlay（全屏黑底遮罩，用后销毁）       │
│             逐行显示叙事文案，点击/按键后淡出移除           │
└──────────────────────┬──────────────────────────────────┘
                       │ 退出后暴露主界面
┌──────────────────────▼──────────────────────────────────┐
│  [配置层]   config.local.js (可选)                       │
│             window.GEMINI_PRESET_KEY / PRESET_MODEL      │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量注入
┌──────────────────────▼──────────────────────────────────┐
│  [数据层]   characters.js                                │
│             window.NPCConfig                             │
│             { MAX_CANDOR, baseCharacters,                │
│               updateCandorAndColor, mixColors,           │
│               clamp, hexToRgb }                          │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量消费
┌──────────────────────▼──────────────────────────────────┐
│  [对话层]   dialogue.js                                  │
│             window.DialogueState                         │
│             { getSnapshot, getCharacters,                │
│               getDialogueHistories, callGemini,          │
│               appendAiOutput }                           │
└──────────────────────┬──────────────────────────────────┘
                       │ 全局变量消费（触发时机：#ending-button click）
┌──────────────────────▼──────────────────────────────────┐
│  [终局层]   ending.js                                    │
│             window.EndingState                           │
│             { triggered, stage2Results,                  │
│               stage3Results, dialogueSnapshot }          │
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
| `dialogue.js` 内部 `const state = {}` | `characters[]`（含坦诚度）、`dialogueHistories{}`、`closingStreaks{}` | 页面整个生命周期 |
| `ending.js` 内部 `window.EndingState` | 终局快照、各阶段 AI 结果 | 终局触发后 |
| `window.GEMINI_PRESET_KEY/MODEL` | 用户配置 | 页面整个生命周期 |

### 4.2 对话阶段数据流

```
[用户输入 #player-input]
         │
         ▼ handleSend()
state.dialogueHistories[charId].push({ role: "user", content })
         │
         ▼ callGemini()
         ├── [无 API Key] → mockResponse() → 返回硬编码模拟数据
         └── [有 API Key] → fetch POST Gemini API
                               (system_instruction + full history + responseSchema)
                                         │
                                         ▼ 解析 JSON
                    { reply: string, candor_level: 0-6, closing_signal: boolean }
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 ▼                       ▼                        ▼
  appendMessage("model", reply)   updateCandorAndColor()   closingStreaks[charId]++
  → history.push(model msg)       → state.characters[i]    → if >= 3: 对话关闭
  → renderDialogueHistory()       → currentCandor = level  → 插入系统提示消息
    (全量重绘对话 DOM)              → currentColor = mixColors()
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
         ▼ buildQueue()
4 个页面帧入队：
  [0] 阶段一: 静态文案（根据 colorMood() 生成，立即 ready）
  [1] 阶段二: 每个 NPC 的"即时行为"（异步 callGemini，slot loading → fillSlot）
  [2] 阶段三: 每个 NPC 的"内心独白"（依赖阶段二结果，异步 callGemini）
  [3] 尾声: 导出按钮 + 新对话按钮（静态）
         │
         ▼ createOverlay() → document.body 追加 #ending-overlay
用户翻页（点击 / 60s 超时）→ advance() → renderCurrentFrame()
         │
         ▼ [尾声页导出按钮]
formatExport() → Blob → URL.createObjectURL → <a> 下载 .txt
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

### 5.4 不可变更新模式

`updateCandorAndColor()` 采用不可变更新，返回新对象而非直接修改原角色对象：

```javascript
return { ...character, currentCandor: newCandor, currentColor: newColor };
```

### 5.5 响应式 DOM 渲染模式

项目无虚拟 DOM，使用**全量重绘**策略：每次状态变化后，对应的 `render*()` 函数清空容器 `innerHTML` 并重建所有 DOM 节点。适合当前对话数量规模，但有性能上限。

---

### ⚠️ 警告未来开发者 (Critical Warnings)

> **1. `dialogue.js` 是最脆弱的核心文件**
> 该文件同时承担：状态管理、AI 调用、JSON 解析、DOM 渲染、事件绑定。任何修改都可能产生跨关注点的副作用。在修改前务必完整阅读全文。

> **2. `<script>` 加载顺序不可随意调整**
> `index.html` 中的脚本顺序是隐式的依赖声明。`dialogue.js` 在加载时立即访问 `window.NPCConfig`（由 `characters.js` 注入），任何顺序调整将导致 `Cannot read properties of undefined` 运行时崩溃。

> **3. `closingStreaks` 是单向不可逆的**
> 某个角色的 `closingStreak` 一旦达到 `CLOSE_THRESHOLD`（3），该角色对话即永久关闭，**无法通过任何用户操作恢复**。这是刻意的设计决定，但代码中无注释说明，修改时须注意。

> ~~**4. `ending.js` 的 `#ending-panel` DOM 节点是死代码**~~
> ~~`index.html` 中定义的 `<section class="ending-panel">` 在运行时**从不被使用**。`ending.js` 通过 `document.body.appendChild(overlay)` 动态创建完全独立的 `#ending-overlay`。该 HTML 节点可安全移除。~~ **✓ 已修复：废弃节点已从 `index.html` 删除。**

> **5. Gemini API Key 暴露于请求 URL**
> API Key 以 `?key=` 形式附加在 `fetch` URL 的 query string 中，会被浏览器历史记录、`devtools` 网络面板及任何代理日志捕获。作为 Demo 项目这是已知权衡，但若部署于公开环境，须通过后端代理隐藏 Key。

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
| 8 | **`README.md` 内容极少** | 新开发者无法快速了解如何启动项目、如何配置 API Key | 补充：安装说明、`config.local.js` 配置方法、运行方式、项目背景 |
| 9 | **无任何自动化测试** | 核心函数（`updateCandorAndColor`, `mixColors`, `normalizeSchema`）均为纯函数，天然可测 | 引入 `Vitest` 或原生 `Node.js test runner` 对纯函数层添加单元测试 |

---

---

## 7. 开发协作文档

本项目包含 [`AI_DEV_WORKFLOW.md`](AI_DEV_WORKFLOW.md)，规定了与 AI 协作进行结构化更新的完整工作流：前置阅读清单、更新请求模板、`ARCHITECTURE.md` 同步规则及验收自查清单。每次向 AI 提交更新请求前，建议先阅读该文档。

---

*文档终。此文档应在每次架构级别变更后同步更新。*

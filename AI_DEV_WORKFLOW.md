# AI 开发工作流文档

> 供人类开发者在每次向 AI 提交代码更新请求时使用的标准化操作规范。  
> 遵循本文档可确保每次更新保持架构一致性，并使 ARCHITECTURE.md 始终是可靠的事实来源。

---

## 0. 标准启动 Prompt（每次对话开始时复制使用）

> 以下是一段可直接复制、填空后发送给任意 AI Agent 的标准 Prompt。  
> 在对 `NPC-` 文件夹进行任何操作之前，请先发送此 Prompt 以初始化上下文。

---

````
你是一名负责维护「NPC 对话项目」的 AI 开发助手。在执行任何代码修改之前，请先完成以下前置阅读：

【必读文件（无条件）】
1. 阅读 `ARCHITECTURE.md` 全文 —— 了解模块结构、全局变量约定、技术债与警告
2. 阅读 `index.html` 全文 —— 确认 <script> 加载顺序与现有 DOM 节点

【按需阅读（根据任务涉及范围决定）】
- NPC 数据 / 颜色逻辑      → characters.js
- 对话流程 / AI 调用 / 渲染 / API 表单  → dialogue/*.js + 根目录 dialogue.js（bootstrap，极薄，仅在 DOM ready 上调 setup）
  子模块职责（internal：window.NPCDialogue；对外 API 仍为 window.DialogueState）：
  · core.js — 命名空间入口、常量、state、基础查询（首脚本即读取 window.NPCConfig 克隆角色）
  · output.js — AI 侧栏输出
  · request.js — Abort、超时 fetch、错误文案、连通性探测
  · provider.js — schema/mock、Gemini／硅基路由、callGemini
  · render.js — 对话 DOM、角色按钮、输入区、quick reply UI
  · audit.js — dialogue_npc AuditLog 旁路（mock_source 判定、write、pushDialogueLogId）
  · flow.js — appendMessage、切角、玩家回合、candor／closing（经 D.audit 记日志）
  · settings.js — provider 表单、测试连接、事件绑定入口
  · public-api.js — patch／reset／advance、createPublicApi()
  · 根 dialogue.js — 仅创建 window.DialogueState 并调 settings.setup()
  规则：window.NPCDialogue 只允许 dialogue 层内部使用；ending.js、loop.js、index.html 内联脚本等外部模块必须只调用 window.DialogueState。
  （按任务收窄阅读：**不必**默认通读整套文件；但若动到状态／路由／DOM 任一轴，务必连同相邻耦合子模块一起核对）
- 终局演出 / 分屏 / 导出    → ending.js
- 周目入口 / 存档导入注入   → loop.js
- 视觉样式 / 动画           → style.css
- API Key / 模型配置        → config.example.js

【本次任务】
更新类型：[ ] 新功能  [ ] 样式调整  [ ] 逻辑修改  [ ] Bug修复  [ ] 文案变更  [ ] 架构改动

影响层：
[ ] 配置层（config）
[ ] 数据层（characters.js）
[ ] 对话层（dialogue/*.js + dialogue.js bootstrap）
[ ] 终局层（ending.js）
[ ] 样式层（style.css）
[ ] HTML 结构（index.html）
[ ] 文档（ARCHITECTURE.md / README.md）

具体需求：
[在此描述你希望实现的效果、行为或变化。如有文案，请逐字提供。]

预期交互 / 行为：
[描述用户操作后应发生什么，或代码应产生什么输出。]

---
▼ 根据更新类型，从以下补充块中选择一个填写（其余可删除）：

【Bug 修复时填写】
报错信息（原始文本，直接粘贴）：[粘贴完整报错 / 截图描述]
触发路径（做了什么操作导致报错）：[描述操作步骤]
期望行为（正常情况应该是什么）：[描述预期]
已排除的可能原因（如有）：[例如"连接测试正常，排除网络和 Key 问题"]

【功能实现时填写】
涉及的字段 / 数据范围（明确列出，不要让 AI 自行推断）：[例如"只持久化 Key，不存 provider 和 model"]
边界条件：
- 已有预设值时（如 config.local.js 有值），新逻辑的优先级：[ ] 覆盖预设  [ ] 保留预设  [ ] 不确定→AI 判断
- 用户主动清空时的行为：[例如"清空输入框即删除存储值"]
安全 / 兼容约束（如有）：[例如"Key 明文存储 localStorage 可接受"]

【文档同步时填写】
触发原因（本次代码做了哪些变更）：[例如"修复了 Bug A，新增了功能 B"]
更新范围：
- [ ] 只更新与本次变更直接相关的章节
- [ ] 全文审查（包括笔误、过时内容）
允许新增内容（如新的警告条目）：[ ] 是  [ ] 否
允许修改未变更章节（如发现笔误）：[ ] 是  [ ] 否
明确禁止：[例如"不要重写架构总览章节，不要删除现有警告条目"]
---

不应改变的部分（可选）：
[列出不希望 AI 修改的逻辑或样式。]

【完成后自查】
完成修改后，在回复我之前，请确认：
- 新代码遵循 IIFE 封装，未引入未声明的全局变量
- <script> 加载顺序未发生无意变动
- 所有异步操作使用 async/await + try/catch
- 命名遵循约定：函数/变量 camelCase、常量 UPPER_SNAKE_CASE、DOM ID kebab-case
- 未跨层调用，未在职责不符的文件中添加逻辑
- 已按 §4 规则判断并（如需）同步更新 ARCHITECTURE.md
````

---

## 1. 文档定位

本文档是**人类开发者 ↔ AI 协作的接口协议**。它规定：

- AI 每次开始工作前必须执行哪些前置动作
- 开发者应以什么格式描述更新需求
- 哪些变更必须同步更新 `ARCHITECTURE.md`
- AI 完成后需自查哪些项目

本文档本身也是项目文件之一，应随项目约定演进而更新。

---

## 2. AI 前置动作清单（每次必做）

在执行任何代码修改之前，AI **必须**按顺序完成以下动作：

### 必读（无条件）

| 步骤 | 动作 | 原因 |
|---|---|---|
| 1 | 阅读 `ARCHITECTURE.md` 全文 | 了解当前模块结构、全局变量约定、已知技术债和警告 |
| 2 | 阅读 `index.html` 全文 | 确认 `<script>` 加载顺序、DOM 结构、当前存在的节点 |

### 按需阅读（根据更新影响范围决定）

| 涉及范围 | 需阅读的文件 |
|---|---|
| NPC 角色数据、颜色逻辑 | `characters.js` |
| stageId / 存档 v2 升级 | `stage-catalog.js`、`loop.js` |
| 跨周目静态补丁 | `npc-loop-memory.js` |
| 笔记本 tone / 终局参与 | `notebook-config.js`、`ending-participation.js` |
| 周目剧本 / 测试 mock | `loop-script.js` |
| 云端登录与存档 | `cloud-sync.js`、`user-session.js`、`save-adapter.js` |
| 对话流程、AI 调用、状态、DOM、设置面板 | 见 **§0** 标准 Prompt 中的对话层子模块枚举（**core / output / request / provider / render / audit / flow / settings / public-api** + **`dialogue.js` bootstrap**）。按改动点选读；牵涉状态快照、解锁推进、closing 者多读 **`core.js`、`flow.js`**；牵涉模型请求与占位 mock 者多读 **`provider.js`、`request.js`**；牵涉 UI / quick reply 者多读 **`render.js`、`settings.js`**；牵涉 dialogue_npc 审计旁路者读 **`audit.js`**；仅接线 public API 时读 **`public-api.js`** |
| 终局演出、分屏叙事、导出 | `ending.js` |
| 周目入口、存档导入注入 | `loop.js` |
| 视觉样式、动画 | `style.css` |
| API Key / 模型 / 云端 URL | `config.example.js` |

> **原则**：宁可多读，不要少读。对话层虽已拆分，但 `core.js`／`flow.js`／`provider.js`／`render.js` 之间仍是高耦合：`state` 与历史在 **core**，回合与 candor 在 **flow**，网络与 mock 在 **provider**，DOM 在 **render**。跨轴改动时至少通读相关子模块 + 根 **`dialogue.js` bootstrap**，避免只改单文件留下不一致。

### 多文件对话层阅读清单

| 子模块 | 阅读触发 | 对外边界 |
|---|---|---|
| `dialogue/core.js` | 状态、角色顺序、解锁/关闭、API provider/key/model 查询 | 只供 `window.NPCDialogue` 内部共享 |
| `dialogue/output.js` | AI sidebar 输出、错误/思考过程展示 | 通过 `DialogueState.appendAiOutput` 间接开放 |
| `dialogue/request.js` | abort、超时、错误格式化、SiliconFlow 探测 | 通过 `DialogueState.abortAllRequests` 间接开放 |
| `dialogue/provider.js` | `callGemini`、schema normalize、测试/本地 mock、provider 路由 | 通过 `DialogueState.callGemini` 间接开放 |
| `dialogue/render.js` | 对话 DOM、角色按钮、输入禁用、quick reply UI | 内部 DOM 层，不对外开放 |
| `dialogue/audit.js` | dialogue_npc AuditLog 旁路、mock_source 判定 | 仅 `window.NPCDialogue.audit`，不对外开放 |
| `dialogue/flow.js` | 玩家回合、append message、candor、closing、quick reply mock | 通过 `tryAdvanceUnlock` 等 public API 间接开放 |
| `dialogue/settings.js` | DOMContentLoaded 后事件绑定、provider 表单、测试连接按钮 | 仅由 `dialogue.js` bootstrap 调用 |
| `dialogue/public-api.js` | `createPublicApi()` 与 `window.DialogueState` 的唯一出口 | 外部模块只能依赖这里登记的方法 |
| `dialogue.js` | 薄 bootstrap：创建 `window.DialogueState`、调 `settings.setup()` | 不承载业务逻辑 |

`window.NPCDialogue` 是内部装配命名空间，**不是 public API**。外部模块需要新能力时，应先扩展 `dialogue/public-api.js` 并同步 `ARCHITECTURE.md`，不得直接读写 `window.NPCDialogue.core.state` 或调用内部子模块。

---

## 3. 更新请求标准模板

> **核心原则**：Prompt 的质量取决于两件事——**描述清楚要做什么**，以及**约束清楚边界在哪里**。  
> 描述问题（What）通常做得好；真正容易产生返工的，是操作边界（How far）没说清楚。  
> 越是范围模糊的任务（功能实现、文档更新），越需要把"不做什么"显式写出来。

根据任务类型选择对应的模板，不需要同时填写所有模板。

---

### 模板 A：Bug 修复

直接贴原始报错是最有效的 prompt——它天然包含错误码、字段名、触发路径，AI 几乎无需推断。

```
## Bug 修复

### 报错信息（原始文本，直接粘贴）
[粘贴完整报错 / HTTP 响应 / 控制台输出]

### 触发路径
[做了什么操作导致报错，例如"选择 Gemini provider → 填写 Key → 点击'小一·对话'"]

### 期望行为
[正常情况下应该发生什么]

### 已排除的可能原因（如有）
[例如"连接测试正常，排除网络和 Key 问题"]

### 不应改变的部分（可选）
[不希望 AI 动到的逻辑]
```

---

### 模板 B：功能实现 / 逻辑修改

功能实现最容易产生"AI 自行决策"的灰色地带，需要显式约定字段范围和边界条件。

```
## 功能实现

### 具体需求
[用自然语言描述想要的效果或行为。如有文案，请逐字提供。]

### 涉及的字段 / 数据范围（明确列出，不要让 AI 自行推断）
[例如"只持久化 API Key 一个字段，不存 provider 选择和 model 名"]

### 边界条件
- 已有预设值时（如 config.local.js 中有值）：[ ] 新逻辑覆盖预设  [ ] 保留预设  [ ] AI 自行判断
- 用户主动清空输入框时的行为：[例如"清空即删除存储值" 或 "保留存储值不变"]
- 其他边界：[列出任何会影响实现方式的特殊情况]

### 安全 / 兼容约束（如有）
[例如"Key 明文存储 localStorage 在此 Demo 项目中可接受"]

### 预期交互/行为
[描述用户操作后应发生什么]

### 不应改变的部分
[明确列出不希望 AI 修改的逻辑、样式或文件]
```

---

### 模板 C：文档同步（ARCHITECTURE.md 等）

文档更新最容易产生"我以为你知道要改哪里"的误解，必须给出触发原因和明确的更新范围。

```
## 文档同步

### 触发原因（本次做了哪些代码变更）
[例如"修复了 Gemini provider 的 role 字段 Bug，新增了 localStorage 持久化功能"]

### 更新范围
- [ ] 只更新与本次变更直接相关的章节（推荐默认选项）
- [ ] 全文审查（包括笔误、过时内容）——仅在明确需要时选择

### 操作许可（明确授权，避免 AI 超出范围）
- 允许新增内容（如新的警告条目）：[ ] 是  [ ] 否
- 允许修改未直接涉及的章节（如发现笔误）：[ ] 是  [ ] 否
- 允许删除现有条目：[ ] 是  [ ] 否

### 明确禁止（不要做的事）
[例如"不要重写架构总览章节""不要删除现有技术债条目"]
```

---

### 示例（模板 B：功能实现）

```
## 功能实现

### 具体需求
增加入场文案屏：页面打开时全黑，逐行显示以下文案：
1. 你好像掉进了一个不知名的地方。
2. 不记得自己从哪里来，也不知道要去哪里。
3. 前面有几个人。
4. 要不要过去说说话？

### 涉及的字段 / 数据范围
仅涉及 DOM 遮罩层和文案动画，不涉及任何状态变量或 localStorage。

### 边界条件
- 用户刷新页面时：每次都重新播放入场动画
- 无需处理其他边界情况

### 预期交互/行为
- 每行间隔约 1.2 秒依次淡入
- 最后一行出现后显示"点击任意处继续"提示
- 点击任意处或按任意键后，遮罩淡出消失，进入主界面

### 不应改变的部分
不修改 `dialogue/` 内与对话回合、AI 路由相关的逻辑（含 `flow.js` / `provider.js`）。
```

---

## 4. ARCHITECTURE.md 同步规则

以下任意一种变更发生后，AI **必须**同步更新 `ARCHITECTURE.md`：

| 变更类型 | 需更新的 ARCHITECTURE.md 位置 |
|---|---|
| 新增 JS 文件（新模块） | §2 目录结构、§3 模块划分与依赖关系图 |
| 新增 `window.XXX` 全局变量 | §3 模块划分（对应层的"对外暴露"说明） |
| 新增 `<script>` 标签或改变加载顺序 | §2 目录结构、§3.2 依赖关系 |
| 新增永久性 DOM 节点（有 ID 的关键节点） | §2 目录结构（在 index.html 条目下注明） |
| 修复已在 §5"警告"或 §6"技术债"中登记的问题 | 划线对应条目，追加 ✓ 已修复说明 |
| 新增约定（命名规范、模式、错误处理标准） | §5 核心约定与模式（新增或修改对应小节） |
| 新增技术债或已知问题 | §6 待优化点（按 P0/P1/P2 优先级分类追加） |
| 架构级重构（模块拆分、通信方式变更等） | §3 全部相关小节，可能涉及数据流图更新 |

**不需要更新** `ARCHITECTURE.md` 的情况：

- 纯文案/内容变更（如修改 NPC 对话提示词、UI 标签文字）
- 样式微调（颜色、间距、字号等），除非引入了新的 CSS 类命名约定
- Bug 修复中没有改变接口或约定的情况

---

## 5. 验收自查清单（AI 完成后必检）

AI 完成代码修改后，在回复用户前，应确认以下所有项目：

### 代码正确性
- [ ] 新代码遵循 IIFE 封装模式（JS 文件）
- [ ] 未引入新的全局变量（除非通过 `window.XXX` 显式暴露并已在文档中登记）
- [ ] `<script>` 加载顺序变更时，已确认符合 `ARCHITECTURE.md` §3.2 依赖关系，并已同步更新文档
- [ ] 若涉及 `index.html` script、`dialogue/*.js`、`dialogue.js`、`ending.js` 或 `loop.js`，已运行 `node scripts/architecture-smoke.js`（该脚本**从 index.html 动态解析**顺序，通常**无需**再手工维护烟测内的 script 列表）
- [ ] 所有异步操作使用 `async/await` + `try/catch`
- [ ] 命名遵循约定：函数/变量 `camelCase`、常量 `UPPER_SNAKE_CASE`、DOM ID `kebab-case`

### 架构一致性
- [ ] 未跨层调用（下层不知道上层的存在）
- [ ] 未在与职责不符的文件中添加逻辑（例如不在 `characters.js` 中添加 DOM 操作）
- [ ] 若涉及对话层，已按任务范围阅读相关 `dialogue/*.js` 与 `dialogue.js` bootstrap，并确认无跨关注点副作用

### 文档同步
- [ ] 按照§4 规则判断是否需要更新 `ARCHITECTURE.md`
- [ ] 若需要，已完成更新，且更新内容准确反映本次变更

### 用户体验
- [ ] 新增交互有明确的视觉反馈（加载状态、禁用状态、错误提示）
- [ ] 不破坏现有功能（对话流程、终局演出、API Key 配置）

---

## 6. 快速参考：项目关键约定

| 约定 | 内容 |
|---|---|
| 模块通信 | 仅通过 `window.XXX` 全局对象，无事件总线，无依赖注入 |
| 脚本顺序 | 见 `ARCHITECTURE.md` §3.2；对话层链路为：`dialogue/core.js` → `output` → `request` → `provider` → `render` → `audit` → `flow` → `settings` → `public-api.js` → **`dialogue.js`（bootstrap）** → `ending.js` → `loop.js` → 内联脚本 |
| 架构烟测 | 对话层或 script 顺序相关改动后运行 `node scripts/architecture-smoke.js`；脚本**从 index.html 动态解析**加载顺序并校验结构契约（跨模块相对顺序 + post-audit 固定链路 + dialogue 目录对齐），同时覆盖对话层 IIFE 载入与 `DialogueState` API |
| NPCDialogue 边界 | `window.NPCDialogue` 仅为对话层内部命名空间；外部模块必须使用 `window.DialogueState` |
| 错误处理 | 异步操作一律 `try/catch`；AI 调用失败返回 `null`，调用方检查 null |
| DOM 渲染 | 全量重绘（`innerHTML` 清空后重建），无虚拟 DOM |
| 高风险区 | 对话层：**多文件 + 紧耦合**。按上文子模块清单与任务收窄阅读 |
| API Key 位置 | `?key=` query string（已知安全权衡，Demo 项目可接受） |

### 新增 `<script>` 时的检查规则（烟测自动覆盖）

| 插入位置 | 开发者 / AI 需确认 | 烟测自动校验 |
|---|---|---|
| `audit-log.js` **之前** | 不破坏模块依赖；同步 `ARCHITECTURE.md` §3.2 | 跨模块 `ORDER_CONSTRAINTS`（如 `characters.js` 必须在 `dialogue/core.js` 前） |
| `audit-log.js` 与 `loop.js` **之间** | 只允许 post-audit 固定结构：`log-restore.js` → 连续 `dialogue/*.js` → `dialogue.js` → `ending.js` → `loop.js` | 从 index 动态解析并与 `dialogue/` 目录对齐 |
| 新增 `dialogue/*.js` | 在 index 中按依赖顺序插入**连续块**；**无需**修改 `architecture-smoke.js` | VM 按 index 顺序加载 + 文件存在性 |
| `loop.js` **之后** | 只允许内联 `<script>` | 拒绝任何外部 script |

---

## 7. Prompt 质量速查

| 任务类型 | 天然精准的写法 | 最常见的返工根因 |
|---|---|---|
| Bug 修复 | 直接粘贴原始报错（含错误码、字段名、触发路径） | 只描述现象，未附原始报错文本 |
| 功能实现 | 显式列出涉及字段范围 + 边界条件 | 字段范围或优先级让 AI 自行推断 |
| 文档同步 | 给出触发原因 + 明确"允许/禁止"操作 | 只说"更新文档"，未约定更新范围 |

> **一句话总结**：Prompt 在"描述要做什么"上通常够用；真正需要花心思的，是把**操作边界**和**不做什么**显式写出来。范围越模糊的任务，越需要负面约束。

---

---

## 8. 三 Agent 自动流使用说明

本节描述基于 Cursor Agent Skills 的三阶段自动化工作流：**Review → Implement → Deploy Check**。三个 Agent 通过文件传递状态，不依赖对话上下文，可独立触发也可自动串联。

---

### 8.1 技能文件位置

```
.cursor/
├── skills/
│   ├── review/SKILL.md          # Agent 1：任务审查
│   ├── implement/SKILL.md       # Agent 2：代码实现 + 自审
│   └── deploy-check/SKILL.md    # Agent 3：最终验收
└── agent-output/
    ├── review_output.md         # Agent 1 → Agent 2 的中转文件
    └── implement_output.md      # Agent 2 → Agent 3 的中转文件
```

---

### 8.2 触发方式

#### 自动触发（推荐）

Cursor Agent 会根据技能的 `description` 字段自动判断何时调用：

- **review**：收到新的代码修改任务 prompt 时，Agent 在执行任何文件编辑前自动触发
- **implement**：review 输出 PASS 后，Agent 自动读取 `review_output.md` 并触发实现
- **deploy-check**：implement 输出 READY 后，Agent 自动读取 `implement_output.md` 并触发验收

#### 手动触发（显式调用）

在 Agent 对话框中输入 `/` 并搜索技能名称：

```
/review          # 手动触发审查（适用于需要重新审查的场景）
/implement       # 手动触发实现（适用于 review 已 PASS 但未自动触发的场景）
/deploy-check    # 手动触发验收（适用于想单独验收已有实现的场景）
```

---

### 8.3 标准工作流

```
1. 开发者提交任务 prompt（使用 §0 或 §3 的模板）
        ↓
2. review skill 自动触发
   → 读取 ARCHITECTURE.md + 相关源文件
   → 输出 review_output.md
        ↓
3a. 结论 PASS → implement skill 自动触发
   → 读取 review_output.md
   → 实现代码 + 自审（最多3次）
   → 输出 implement_output.md
        ↓
4a. 结论 READY → deploy-check skill 自动触发
   → 五项验收检查
   → 在对话中输出最终报告
        ↓
5a. APPROVED → 任务完成，按报告建议同步更新 ARCHITECTURE.md
```

---

### 8.4 异常处理路径

| 阶段 | 状态 | 处理方式 |
|---|---|---|
| review 输出 | `BLOCK` | 查看 `review_output.md` 中列出的阻塞原因，补充任务描述后重新触发 `/review` |
| implement 输出 | `FAILED` | 查看 `implement_output.md` 中的遗留问题，人工修复或调整方案后重新触发 `/implement` |
| deploy-check 输出 | `REJECTED` | 查看验收报告中的「修复指引」，修复后重新触发 `/implement`，再触发 `/deploy-check` |

---

### 8.5 每次新任务前的准备

**必须在开始新任务前清空中转文件**，防止上一次任务的状态影响当前任务：

在 Agent 对话中说：「请清空 `.cursor/agent-output/` 下的两个文件」，或手动将 `review_output.md` 和 `implement_output.md` 内容清空（文件保留，内容清空即可）。

---

### 8.6 设计说明

- **无对话上下文依赖**：三个 Agent 仅通过 Markdown 文件传递状态，即使对话被中断也可从任意阶段恢复
- **自审闭环**：implement skill 内置最多 3 次自审循环，绝大多数格式/约定问题可在交付前自动修复
- **deploy-check 不写文件**：最终验收报告直接输出到对话，供人工确认，避免文件状态混乱
- **与现有工作流兼容**：三 Agent 流是 §0 标准启动 Prompt 的自动化增强，两种方式可混用

*文档终。本文档应在项目约定发生变化时同步更新。*

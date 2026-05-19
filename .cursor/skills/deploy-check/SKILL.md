---
name: deploy-check
description: NPC项目最终验收技能。当 .cursor/agent-output/implement_output.md 存在且交付结论为 READY 时触发。对已实现的代码进行五项系统性验收检查，输出最终 APPROVED 或 REJECTED 结论，并在通过时列出需同步更新的文档章节。
---

# Deploy Check Skill — NPC 项目最终验收

## 触发守卫

**在执行任何检查之前，必须先完成以下确认：**

1. 读取 `.cursor/agent-output/implement_output.md`
2. 检查文件末尾的「交付结论」字段
3. 若结论为 `FAILED`：**立即停止**，告知用户 implement 阶段未通过，需先解决 implement_output.md 中列出的遗留问题
4. 若结论为 `READY`：继续执行以下步骤

> 若 `implement_output.md` 文件不存在或内容为空，停止并提示用户先执行 implement skill。

同时读取 `.cursor/agent-output/review_output.md`，获取「文件影响范围」列表，作为本次验收的检查目标。

---

## 执行步骤

### 第一步：读取验收上下文

读取 `implement_output.md` 中「已修改文件」列表，对每个文件执行完整读取。

此外，无论本次任务是否涉及，必须读取 `index.html` 全文用于验收项三（script 加载顺序）。

### 第二步：逐项执行五项验收检查

#### 验收项一：命名、封装与错误处理合规性

对「已修改文件」中的每一个 JS 文件逐条验证：

| 检查点 | 标准 | 依据 |
|---|---|---|
| IIFE 封装 | 所有新增逻辑在 IIFE 内，或追加至现有 IIFE | ARCHITECTURE.md §5.2 |
| window.XXX 声明 | 公共 API 通过 `window.PascalCase` 显式暴露 | ARCHITECTURE.md §5.2 |
| 无隐式全局变量 | 未在 IIFE 外声明变量，未直接使用未声明的全局引用 | ARCHITECTURE.md §5.2 |
| async/await 覆盖 | 所有异步操作（fetch、AI 调用等）使用 `async/await` | ARCHITECTURE.md §5.3 |
| try/catch 覆盖 | 所有 `await` 语句在 `try/catch` 内 | ARCHITECTURE.md §5.3 |
| null 返回检查 | `callGemini()` 等调用后有 null 判断 | ARCHITECTURE.md §5.3 |
| camelCase 函数/变量 | 新增函数名、变量名均为 `camelCase` | ARCHITECTURE.md §5.1 |
| UPPER_SNAKE_CASE 常量 | 新增常量均为 `UPPER_SNAKE_CASE` | ARCHITECTURE.md §5.1 |
| kebab-case DOM ID | 新增 DOM id 属性均为 `kebab-case` | ARCHITECTURE.md §5.1 |
| 职责边界 | 未在职责不符的文件添加逻辑（如 characters.js 无 DOM 操作） | ARCHITECTURE.md §3.1 |

#### 验收项二：`<script>` 加载顺序完整性

读取 `index.html`，确认当前 `<script>` 标签顺序与以下基准完全一致：

```
config.local.js → characters.js → dialogue.js → ending.js → loop.js → 内联脚本
```

检查要点：
- 顺序是否被改变？
- 是否新增了 `<script>` 标签？若新增，其位置是否正确？
- `loop.js` 是否仍在内联脚本之前（loop.js 的 keydown 拦截器须先注册）？

若顺序被改变，必须有 review_output.md 的明确批准记录，否则判定为 FAIL。

#### 验收项三：`window.*` 公共 API 一致性

对所有被修改的 JS 文件，逐一验证其 `window.XXX` 暴露的公共方法与 `ARCHITECTURE.md §3.1` 中的描述一致：

| 模块 | 应暴露的 window 对象及方法 |
|---|---|
| `characters.js` | `window.NPCConfig`：`{ MAX_CANDOR, baseCharacters, updateCandorAndColor, mixColors, injectSubconscious, clamp, hexToRgb }` |
| `dialogue.js` | `window.DialogueState`：`{ getSnapshot, getCharacters, getDialogueHistories, callGemini, appendAiOutput, patchCharacter, resetForNewLoop }` |
| `ending.js` | `window.EndingState`：`{ triggered, stage2Results, stage3Results, dialogueSnapshot, loopSummary }` |
| `loop.js` | `window.LoopState`：`{ getLoopIndex }` |

检查：
- 是否有方法被意外删除？
- 是否新增了未在 ARCHITECTURE.md 中登记的方法（若有，需标注为「需同步文档」）？
- 方法签名是否发生了破坏性变更？

#### 验收项四：无新增未声明全局变量

对所有被修改的 JS 文件进行扫描，确认：
- 无在 IIFE 外部、`window.` 前缀之外的顶层 `var`/`let`/`const` 声明
- 无直接赋值给未声明变量的语句（隐式全局）
- 若 config.local.js 被修改，仅允许以下五个预设全局变量：`window.AI_PROVIDER`、`window.GEMINI_PRESET_KEY`、`window.GEMINI_PRESET_MODEL`、`window.SILICONFLOW_PRESET_KEY`、`window.SILICONFLOW_PRESET_MODEL`

#### 验收项五：`mutableSubconscious` 写入逻辑正确性（涉及终局/多周目时）

若本次修改涉及 `loop.js`、`ending.js` 或 `characters.js` 中与 `mutableSubconscious` / `systemPrompt` / `injectSubconscious` 相关的逻辑，执行以下检查：

| 检查点 | 标准 | 依据 |
|---|---|---|
| 覆盖写入基准 | `injectSubconscious` 使用 `char.systemPrompt = char._originalSystemPrompt + patch`，而非 `+=` | ARCHITECTURE.md §警告6 |
| 幂等性 | 同一页面生命周期内多次调用 `injectSubconscious` 不会造成补丁叠加 | ARCHITECTURE.md §8.3 |
| resetForNewLoop 调用顺序 | `loop.js` 的 `injectArchive` 先调用 `resetForNewLoop()`，再注入 mutableSubconscious | ARCHITECTURE.md §8.3 |
| dejaVuLevel 来源 | `buildArchiveObject` 中 `dejaVuLevel` 由 `currentCandor` 计算覆盖，不使用 AI 返回值 | ARCHITECTURE.md §8.3 |
| 结算写入目标 | 结算结果写入 `endingState.dialogueSnapshot.characters[].mutableSubconscious`（非直接写入 state） | ARCHITECTURE.md §4.3 |

若本次修改不涉及上述逻辑，此项标注为「不涉及，跳过」。

### 第三步：输出最终验收报告

在对话中输出以下格式的最终验收报告（**不写入文件**，直接呈现给用户）：

```markdown
# Deploy Check Output

## 验收项逐条结果

### 验收项一：命名、封装与错误处理
- `文件名`
  - IIFE 封装：[PASS / FAIL：说明]
  - window.XXX 声明：[PASS / FAIL：说明]
  - 无隐式全局变量：[PASS / FAIL：说明]
  - async/await 覆盖：[PASS / FAIL：说明 / 不涉及]
  - try/catch 覆盖：[PASS / FAIL：说明 / 不涉及]
  - null 返回检查：[PASS / FAIL：说明 / 不涉及]
  - 命名规范（camelCase/UPPER_SNAKE_CASE/kebab-case）：[PASS / FAIL：说明]
  - 职责边界：[PASS / FAIL：说明]

### 验收项二：`<script>` 加载顺序
- 当前顺序：[列出 index.html 中的实际顺序]
- 基准顺序：config.local.js → characters.js → dialogue.js → ending.js → loop.js → 内联脚本
- 结果：[PASS / FAIL：说明变化]

### 验收项三：window.* 公共 API 一致性
- `文件名`：[PASS / FAIL：说明差异 / 新增方法需登记]

### 验收项四：无新增未声明全局变量
- `文件名`：[PASS / FAIL：列出发现的未声明全局变量]

### 验收项五：mutableSubconscious 写入逻辑
- [不涉及，跳过 / 逐条检查结果]

## 最终结论
[APPROVED / REJECTED]

**原因**：[APPROVED：所有验收项通过 / REJECTED：列出 FAIL 的具体项目和文件]

## 若 APPROVED：建议同步更新文档
[列出需要同步更新的 ARCHITECTURE.md 章节，例如：]
- §3.1 模块划分：新增 window.XXX 的方法描述
- §6 待优化点：将已修复的技术债条目划线
[若无需更新，写：无需更新 ARCHITECTURE.md]

## 若 REJECTED：修复指引
[逐条列出失败项对应的修复方向，供 implement skill 下一轮使用]
```

---

## 验收通过标准

所有五项验收项均为 PASS（或合理标注「不涉及」）时，给出 `APPROVED`。

任意一项存在 `FAIL` 条目时，给出 `REJECTED`，并在「修复指引」中明确说明每个 FAIL 项的修复方向，用户可据此重新触发 implement skill。

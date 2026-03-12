---
name: review
description: NPC项目任务审查技能。当收到新的代码修改任务时，在执行任何代码变更之前自动触发。读取任务目标与相关源文件，对照 ARCHITECTURE.md 检查计划的完整性、边界合规性与架构一致性，输出结构化审查报告至 .cursor/agent-output/review_output.md，并给出 PASS 或 BLOCK 结论。
---

# Review Skill — NPC 项目任务审查

## 触发时机

当 Agent 收到针对 NPC 项目的代码修改任务 prompt 时，**在执行任何文件编辑之前**调用本技能。

---

## 执行步骤

### 第一步：读取基础上下文

必须按顺序读取以下文件：

1. `ARCHITECTURE.md` 全文 — 了解模块结构、全局变量约定、加载顺序、已知技术债与警告
2. `index.html` 全文 — 确认 `<script>` 当前加载顺序与 DOM 节点

> **若以上任一必读文件不存在，立即输出 BLOCK，不得跳过或继续执行后续步骤。**

根据任务涉及范围，按需追加读取：

| 涉及范围 | 需读取文件 |
|---|---|
| NPC 角色数据、颜色逻辑 | `characters.js` |
| 对话流程、AI 调用、状态管理、DOM 渲染 | `dialogue.js`（极脆弱，涉及即全文阅读） |
| 终局演出、分屏、导出、mutableSubconscious | `ending.js` |
| 周目入口、存档导入注入 | `loop.js` |
| 视觉样式、动画 | `style.css` |
| API Key / 模型配置 | `config.example.js` |

### 第二步：理解任务目标

用一句话复述任务要做什么，明确：
- 变更类型（新功能 / 样式调整 / 逻辑修改 / Bug 修复 / 文案变更 / 架构改动）
- 影响层（配置层 / 数据层 / 对话层 / 终局层 / 样式层 / HTML 结构 / 文档）

### 第三步：架构合规性检查

逐项核查以下约束，记录每项结果（合规 / 风险 / 冲突）：

**模块封装检查（ARCHITECTURE.md §5.2）**
- 新增 JS 逻辑是否使用 IIFE 封装？
- 是否通过 `window.XXX` 显式暴露公共 API，不引入隐式全局变量？

**加载顺序检查（ARCHITECTURE.md §3.2 警告2）**
- 当前顺序：`config.local.js` → `characters.js` → `dialogue.js` → `ending.js` → `loop.js` → 内联脚本
- 任务是否会新增 `<script>` 标签或改变顺序？若是，是否有充分理由？

**单向依赖检查（ARCHITECTURE.md §3.2）**
- 修改是否会造成循环依赖或下层知道上层存在？
- 是否在职责不符的文件中添加逻辑？

**命名约定检查（ARCHITECTURE.md §5.1）**
- 函数/变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- DOM ID：`kebab-case`
- 模块接口：`window.PascalCase`

**错误处理检查（ARCHITECTURE.md §5.3）**
- 新增异步操作是否使用 `async/await + try/catch`？
- AI 调用路径是否处理 `null` 返回？

**mutableSubconscious 安全检查（ARCHITECTURE.md §8.3 / 警告6）**
- 若任务涉及 `systemPrompt` 修改，是否使用 `_originalSystemPrompt` 为基准覆盖写入？（不得使用 `+=`）

**终局/多周目安全检查（ARCHITECTURE.md §警告3）**
- 若任务涉及终局逻辑，是否影响 `mutableSubconscious` 写入流程？
- `closingStreaks` 在本局内是否仍保持单向不可逆？

**ARCHITECTURE.md 同步检查（ARCHITECTURE.md §4）**
- 本次变更是否需要更新 ARCHITECTURE.md？（新增 JS 文件、新增 window.XXX、改变 script 顺序、修复已登记技术债等）

### 第四步：影响范围边界确认

- 明确列出会被修改的文件
- 明确列出**不会**被修改的文件
- 确认 `dialogue.js` 是否被涉及（若是，标注已完整阅读）

### 第五步：输出审查报告

将以下格式的完整报告写入 `.cursor/agent-output/review_output.md`，**覆盖写入（不追加）**：

```markdown
# Review Output

## 任务理解
[一句话复述任务目标，包含变更类型和影响层]

## 计划风险
[逐条列出，格式：「风险N：风险描述 → 建议处理方式」]
[若无风险，写：无明显风险]

## 文件影响范围
### 将被修改
- `文件名`：修改原因

### 不会修改
- `文件名`：确认原因

## 架构合规性逐项结果
- 模块封装（IIFE + window.XXX）：[合规 / 风险：说明]
- script 加载顺序：[不受影响 / 风险：说明]
- 单向依赖：[合规 / 风险：说明]
- 命名约定：[合规 / 风险：说明]
- 错误处理（async/await + try/catch）：[合规 / 风险：说明]
- mutableSubconscious 安全：[不涉及 / 合规 / 风险：说明]
- ARCHITECTURE.md 同步需求：[不需要 / 需要：指定章节]

## 放行结论
[PASS / BLOCK]

**原因**：[说明放行或阻塞的具体理由]

**若 PASS**：下一步由 implement skill 读取本文件并开始实现。
**若 BLOCK**：[列出需要人工确认的具体问题，等待澄清后重新执行 review]
```

---

## 放行条件

| 结论 | 条件 |
|---|---|
| **PASS** | 无架构冲突、无遗漏边界条件、影响范围清晰、命名与封装方案明确 |
| **BLOCK** | 发现架构冲突 / 影响范围不明 / `dialogue.js` 涉及但任务描述不足以安全实现 / mutableSubconscious 写入存在风险 |

> **注意**：若任务描述本身过于模糊（无法判断影响范围），应直接输出 BLOCK 并说明需要补充的信息，而不是猜测实现方式。

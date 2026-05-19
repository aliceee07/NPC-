---
name: implement
description: NPC项目代码实现技能。当 .cursor/agent-output/review_output.md 存在且放行结论为 PASS 时触发。按 review 报告的计划实现代码，完成后进行最多3轮架构合规自审，输出实现报告至 .cursor/agent-output/implement_output.md。
---

# Implement Skill — NPC 项目代码实现

## 触发守卫

**在执行任何代码修改之前，必须先完成以下检查：**

1. 读取 `.cursor/agent-output/review_output.md`
2. 检查文件末尾的「放行结论」字段
3. 若结论为 `BLOCK`：**立即停止**，告知用户 review 尚未放行，需先解决 BLOCK 中列出的问题
4. 若结论为 `PASS`：继续执行以下步骤

> 若 `review_output.md` 文件不存在或内容为空，停止并提示用户先执行 review skill。

---

## 执行步骤

### 第一步：读取实现上下文

根据 `review_output.md` 中「文件影响范围」列出的文件，完整阅读所有将被修改的源文件。

**特别注意**：若涉及 `dialogue.js`，无论改动大小，必须完整阅读该文件全文（该文件同时承担状态管理、AI 调用、JSON 解析、DOM 渲染、事件绑定，是最容易产生跨关注点副作用的文件）。

### 第二步：实现代码

按照 `review_output.md` 中「任务理解」和「计划风险」描述的方案实现代码，同时遵守以下硬性约束：

**封装约束**
- 所有新增 JS 逻辑必须在 IIFE 内部（或追加至已有 IIFE 内）
- 公共 API 仅通过 `window.XXX = {}` 显式暴露，不引入任何未声明的全局变量

**异步约束**
- 所有异步操作使用 `async/await + try/catch`，不使用裸 `.then()/.catch()` 链
- AI 调用（`callGemini`）的返回值必须检查 `null`

**命名约束**
- 函数/变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- DOM ID：`kebab-case`
- 模块接口：`window.PascalCase`

**依赖约束**
- 下层模块不得知道上层存在（数据层 → 对话层 → 终局层，单向）
- 不在职责不符的文件中添加逻辑（例如不在 `characters.js` 添加 DOM 操作）

**范围约束**
- 严格按照 `review_output.md` 中「将被修改」列表操作，不修改「不会修改」列表中的任何文件
- 不修改 `<script>` 加载顺序，除非 review 已明确批准并说明理由

**mutableSubconscious 约束（如涉及）**
- 修改 `systemPrompt` 时，必须使用 `char.systemPrompt = char._originalSystemPrompt + patch` 形式覆盖写入
- 禁止使用 `+=`（追加形式会在多次导入时造成补丁叠加）

### 第三步：自审循环（最多 3 次）

实现完成后，执行自审。每次自审逐文件检查以下项目：

| 检查项 | 标准 |
|---|---|
| IIFE 封装 | 新增逻辑是否在 IIFE 内？ |
| 全局变量 | 是否有未通过 `window.XXX` 声明就使用的全局引用？ |
| 异步处理 | 所有 `await` 调用是否在 `try/catch` 内？ |
| null 检查 | `callGemini()` 等可能返回 null 的调用是否有 null 判断？ |
| 命名规范 | 是否遵守 camelCase / UPPER_SNAKE_CASE / kebab-case 约定？ |
| 职责边界 | 是否在职责不符的文件中添加了逻辑？ |
| 范围边界 | 是否意外修改了 review 中「不会修改」的文件？ |
| script 顺序 | `index.html` 的 `<script>` 加载顺序是否保持不变？ |
| mutableSubconscious | 若涉及，是否使用 `_originalSystemPrompt` 为基准覆盖写入？ |

**自审结果处理：**
- 若发现问题 → 立即修复 → 重新执行自审（计入循环次数）
- 若自审全部通过 → 结束循环，进入第四步
- 若第 3 次自审仍有问题 → 停止修复，在报告中标注 `FAILED` 并详细说明遗留问题

### 第四步：输出实现报告

将以下格式的完整报告写入 `.cursor/agent-output/implement_output.md`，**覆盖写入（不追加）**：

```markdown
# Implement Output

## 已修改文件
- `文件名`：改动摘要（一句话描述具体改了什么）

## 自审结果
### `文件名`
- IIFE 封装：[PASS / 问题描述 → 修复说明]
- 全局变量：[PASS / 问题描述 → 修复说明]
- 异步处理：[PASS / 问题描述 → 修复说明]
- null 检查：[PASS / 不涉及]
- 命名规范：[PASS / 问题描述 → 修复说明]
- 职责边界：[PASS / 问题描述 → 修复说明]
- 范围边界：[PASS / 问题描述 → 修复说明]
- script 顺序：[PASS / 不涉及]
- mutableSubconscious：[PASS / 不涉及 / 问题描述 → 修复说明]

## 自审循环次数
[N 次（最多3次）]

## 遗留问题（若有）
[自审3次后仍存在的问题，供 deploy-check 重点关注]
[若无，写：无]

## 交付结论
[READY / FAILED]

**原因**：[READY：所有自审项通过 / FAILED：说明未能解决的具体问题]

**若 READY**：下一步由 deploy-check skill 读取本文件进行最终验收。
**若 FAILED**：[说明需要人工介入的具体问题]
```

---

## 约束速查

| 约束 | 要点 |
|---|---|
| 封装 | IIFE + `window.XXX` 显式暴露，无隐式全局 |
| 异步 | `async/await + try/catch`，检查 `callGemini` 的 null 返回 |
| 命名 | `camelCase` / `UPPER_SNAKE_CASE` / `kebab-case` / `window.PascalCase` |
| 范围 | 不修改 review 报告「不会修改」列表中的任何文件 |
| mutableSubconscious | 覆盖写入（`= base + patch`），禁用 `+=` |
| script 顺序 | 不改变，除非 review 已明确批准 |
| dialogue.js | 涉及即全文阅读，该文件极脆弱 |

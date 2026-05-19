# 流浪者与三个路人 · V2

一个**轮回叙事 RPG Demo**。玩家扮演一个在生日当天被杀的女孩，反复回到同一条街道，与三个见死不救的旁观者对话，试图通过理解他们走向释然。完整游戏分为「初入迷茫 / 寻找真相 / 完善记忆画像 / 寻找结束轮回的方法 / 送花超度 / 反杀凶手」六个阶段；V2 Demo 覆盖前两个阶段，并加入了阶段三的入口（笔记本系统）。

---

## V2 新增机制速览

- **多周目系统**：sessionStorage 自动续档，archive 跨周目持久化；入场四句旁白随周目 1 / 2 / 3 / N>3 动态切换。
- **跨周目笔记本**：第 2 周目起，右下角出现笔记本图标；每完成一轮，主角写下一页第一人称日记，由 AI 在终局后非阻塞生成。7-8 周目会自动插入 `<del>` 划掉的字与未写完的句子，表达失忆与崩溃；第 9 周目嵌入暗语「既然有时间，为什么不现在去过呢？」；第 10 周目释然告别。
- **线性 NPC 出场**：写死 char1 → char2 → char3；可自然 closing 推进，也可点「结束对话，寻找其他人」主动离开。
- **快速回复 chip**：每角色 2 个预设短句，分别对应「尝试触碰」和「容易退潮」两种设计意图。
- **尾声花店暗示**：第 2 周目起，终局尾声出现「那里，是不是有一家花店？」，呼应阶段五的送花超度。

V1 沿用至今的核心机制：**Context Memory 替代数值系统**（NPC 危机决策由大模型读完整对话历史后自主判断，不用任何好感度变量）；**颜色 candor 系统**（黑色圆形 = 被格式化的陌生人，真诚对话让颜色显现，套路触发防线则颜色回黑，双向可逆）；**三种心理原型**（char1 逃型 / char2 战型 / char3 僵型，搭配不同行动阈值）。

---

## 技术栈

纯前端单页 HTML / CSS / JS，无构建工具，无第三方库。双 AI provider：Google Gemini + 硅基流动（SiliconFlow），UI 可切换。带测试模式（`npc_test_mode`），跳过真实 AI 调用以便开发与演示备份。

---

## 快速开始

```bash
# 1. 复制配置模板，填入 Gemini 或 SiliconFlow API Key
cp config.example.js config.local.js

# 2. 启动任意静态服务器
python -m http.server 8000

# 3. 浏览器访问 http://localhost:8000
```

测试模式（无需 API Key）：浏览器控制台执行 `localStorage.setItem('npc_test_mode', '1')` 后刷新。

---

## 文档

- [完整作品集](PORTFOLIO.md) — 剧情概要、机制详解、V1/V2 对比、当前进度
- [架构文档](ARCHITECTURE.md) — 模块边界、数据流、警告与历史决策
- [AI 协作规范](AI_DEV_WORKFLOW.md) — 三 Agent 流程（review / implement / deploy-check）

---

**[打开在线 Demo](https://npcdemov1.vercel.app)** · [GitHub](https://github.com/aliceee07/NPC-)

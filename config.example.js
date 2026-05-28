/* 复制此文件为 config.local.js，然后填入你的 API Key。
   config.local.js 已被 .gitignore 排除，不会上传到 GitHub。

   AI_PROVIDER 可选值："gemini"（默认）或 "siliconflow"
   未填写时页面顶部选择器默认选中 Google Gemini。 */

window.AI_PROVIDER = "gemini"; // "gemini" | "siliconflow"

/* Google Gemini */
window.GEMINI_PRESET_KEY   = "在此填入你的 Gemini API Key";
window.GEMINI_PRESET_MODEL = "gemini-2.0-flash";

/* 硅基流动（SiliconFlow） */
window.SILICONFLOW_PRESET_KEY   = "在此填入你的硅基流动 API Key";
window.SILICONFLOW_PRESET_MODEL = "Qwen/Qwen2.5-72B-Instruct";

/* ── Phase 3：云端存档（可选）──────────────────────────────
   不配置或留空 → 纯本地模式（无登录遮罩，行为与 V2 一致）。
   配置后 → 页面会先显示登录遮罩，终局时 pushSave 到后端。

   本地开发示例：
   1. cd backend && cp .env.example .env && pip install -r requirements.txt
   2. uvicorn server:app --host 127.0.0.1 --port 8090
   3. 取消下行注释并填入后端地址
*/
// window.NPC_CLOUD_BASE_URL = "http://127.0.0.1:8090";

/* 强制跳过登录（本地调试 / 离线演示）— 与未配置 CLOUD_BASE_URL 效果相同 */
// window.NPC_SKIP_LOGIN = true;

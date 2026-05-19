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

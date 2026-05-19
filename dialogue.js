(function () {
  const NPC_CONFIG = window.NPCConfig || {};
  const BASE_CHARACTERS = (NPC_CONFIG.baseCharacters || []).map((c) => ({ ...c }));

  const PLAYABLE_ORDER = ["char1", "char2", "char3"];

  /* ─── State ─────────────────────────────────────────────── */

  const state = {
    characters: BASE_CHARACTERS,
    currentCharacterId: BASE_CHARACTERS[0] ? BASE_CHARACTERS[0].id : null,
    dialogueHistories: {},
    closingStreaks: {},
    unlockedChars: ["char1"],
    passedChars: [],
    readOnly: false,
    activeRequests: {},
  };

  const locallyAbortedSignals = new WeakSet();
  const ERROR_MESSAGE_MAX_LENGTH = 180;
  const API_FETCH_TIMEOUT_PROBE_MS = 12000;
  const API_FETCH_TIMEOUT_TEST_MS = 90000;
  const API_FETCH_TIMEOUT_DIALOGUE_MS = 180000;
  const API_DEBUG_LS_KEY = "npc_api_debug";

  BASE_CHARACTERS.forEach((c) => {
    state.dialogueHistories[c.id] = [];
    state.closingStreaks[c.id] = 0;
  });

  /* ─── Config helpers ─────────────────────────────────────── */

  function getApiProvider() {
    const el = document.getElementById("api-provider-select");
    return (el ? el.value : "") || window.AI_PROVIDER || "gemini";
  }

  function getApiKey() {
    const el = document.getElementById("api-key-input");
    const inputVal = el ? el.value.trim() : "";
    if (inputVal) return inputVal;
    /* 优先级：页面输入框 > config.local.js 对应来源 > 空 */
    return getApiProvider() === "siliconflow"
      ? (window.SILICONFLOW_PRESET_KEY || "")
      : (window.GEMINI_PRESET_KEY || "");
  }

  function getModelName() {
    const el = document.getElementById("model-name-input");
    const inputVal = el ? el.value.trim() : "";
    if (inputVal) return inputVal;
    /* 优先级：页面输入框 > config.local.js 对应来源 > 默认值 */
    return getApiProvider() === "siliconflow"
      ? (window.SILICONFLOW_PRESET_MODEL || "Qwen/Qwen2.5-72B-Instruct")
      : (window.GEMINI_PRESET_MODEL || "gemini-2.0-flash");
  }

  function getActiveCharacter() {
    return (
      state.characters.find((c) => c.id === state.currentCharacterId) ||
      state.characters[0]
    );
  }

  // === AbortController 管理 ===

  function isAbortError(err) {
    return !!err && (err.name === "AbortError" || err.code === 20);
  }

  function isLocalAbortError(err, controller) {
    return isAbortError(err) &&
      !!controller &&
      !!controller.signal &&
      locallyAbortedSignals.has(controller.signal);
  }

  function isCharacterThinking(charId) {
    return !!(charId && state.activeRequests[charId]);
  }

  function isCurrentCharacterThinking() {
    return isCharacterThinking(state.currentCharacterId);
  }

  function formatErrorSummary(err) {
    const name = err && err.name ? err.name : "Error";
    const message = err && err.message ? String(err.message) : String(err);
    const shortMessage = message.length > ERROR_MESSAGE_MAX_LENGTH
      ? message.slice(0, ERROR_MESSAGE_MAX_LENGTH) + "..."
      : message;
    return `${name}: ${shortMessage}`;
  }

  function isApiDebugEnabled() {
    try {
      return localStorage.getItem(API_DEBUG_LS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function logApi(tag, message, data) {
    const prefix = `[NPC API · ${tag}]`;
    if (data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  // #region agent log
  function debugLog(location, message, data, hypothesisId, runId) {
    const entry = {
      sessionId: "8a0631",
      location: location,
      message: message,
      data: data || {},
      timestamp: Date.now(),
      hypothesisId: hypothesisId || "",
      runId: runId || "post-fix",
    };
    try {
      const key = "npc_debug_log_8a0631";
      const prev = JSON.parse(localStorage.getItem(key) || "[]");
      prev.push(entry);
      localStorage.setItem(key, JSON.stringify(prev.slice(-40)));
    } catch (_) {}
    fetch("http://127.0.0.1:7764/ingest/6b2fbdd3-d339-4a3a-8619-adf10e031bda", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "8a0631",
      },
      body: JSON.stringify(entry),
    }).catch(function () {});
  }
  // #endregion

  function isLocalDevOrigin() {
    if (typeof location === "undefined") return false;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
      location.origin
    );
  }

  function getSiliconFlowApiUrl() {
    const viaProxy = isLocalDevOrigin();
    const url = viaProxy
      ? location.origin + "/api-proxy/siliconflow/v1/chat/completions"
      : "https://api.siliconflow.cn/v1/chat/completions";
    // #region agent log
    debugLog(
      "dialogue.js:getSiliconFlowApiUrl",
      "resolve-url",
      { url: url, viaProxy: viaProxy, origin: location && location.origin },
      "H2"
    );
    // #endregion
    return url;
  }

  function formatErrorDetail(err, context) {
    const lines = [formatErrorSummary(err)];
    const msg = err && err.message ? String(err.message) : "";
    if (/failed to fetch/i.test(msg)) {
      lines.push(
        "提示：浏览器没能连上 API（还没收到 HTTP 状态码）。",
        "常见原因：代理/VPN、公司网络拦截、或 api.siliconflow.cn 不可达。",
        "建议：F12 → Network 看 completions 请求；或关代理、换手机热点再试。"
      );
    }
    if (err && err.name === "NetworkUnreachableError") {
      lines.push(
        "【原因】浏览器无法直连 api.siliconflow.cn（常见于 localhost 安全策略）。",
        "【建议】请用「一键启动.bat」打开页面（会自动走本地代理）；或运行「网络诊断.bat」。"
      );
    }
    if (err && err.name === "TimeoutError") {
      lines.push(
        "【原因】在允许的时间内没有任何 HTTP 响应（不是 Key 错；Key 错通常会几秒内返回 401）。",
        "【常见】代理/VPN/Clash/Mihomo 拦截、公司网屏蔽、或浏览器走代理与系统不一致。",
        "【建议】① 双击运行项目里的「网络诊断.bat」看本机能否连上硅基",
        "        ② Windows 设置 → 网络和 Internet → 代理 → 关闭代理",
        "        ③ 手机热点再试  ④ 有 Mihomo/Clash 时给 api.siliconflow.cn 设 DIRECT"
      );
      if (context && context.probe) {
        lines.push("【探测】 " + JSON.stringify(context.probe));
      }
    }
    if (context) {
      if (context.url) lines.push("URL: " + context.url);
      if (context.provider) lines.push("来源: " + context.provider);
      if (context.model) lines.push("模型: " + context.model);
      if (context.elapsedMs != null) lines.push("耗时: " + context.elapsedMs + " ms");
    }
    return lines.join("\n");
  }

  async function probeSiliconFlowReachable() {
    const url = getSiliconFlowApiUrl();
    const viaProxy = isLocalDevOrigin();
    const pageOrigin =
      typeof location !== "undefined" ? location.origin : "unknown";

    // #region agent log
    debugLog(
      "dialogue.js:probeSiliconFlowReachable",
      "probe-start",
      {
        pageOrigin: pageOrigin,
        pageProtocol:
          typeof location !== "undefined" ? location.protocol : "unknown",
        ua: (typeof navigator !== "undefined" && navigator.userAgent
          ? navigator.userAgent.slice(0, 120)
          : ""),
      },
      "H2"
    );
    // #endregion

    async function tryProbe(label, fetchOptions, hypothesisId) {
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(url, fetchOptions, 12000);
        const out = {
          ok: true,
          label: label,
          status: res.status,
          httpOk: res.ok,
          elapsedMs: Date.now() - t0,
        };
        // #region agent log
        debugLog(
          "dialogue.js:probeSiliconFlowReachable",
          label + "-success",
          out,
          hypothesisId
        );
        // #endregion
        return out;
      } catch (err) {
        const out = {
          ok: false,
          label: label,
          elapsedMs: Date.now() - t0,
          errorName: err && err.name ? err.name : "",
          errorMessage: err && err.message ? String(err.message) : String(err),
        };
        // #region agent log
        debugLog(
          "dialogue.js:probeSiliconFlowReachable",
          label + "-fail",
          out,
          hypothesisId
        );
        // #endregion
        return out;
      }
    }

    const optionsProbe = await tryProbe(
      "OPTIONS",
      { method: "OPTIONS", mode: "cors" },
      "H1"
    );
    const postProbe = await tryProbe(
      "POST",
      {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test-invalid",
        },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-7B-Instruct",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
      },
      "H2"
    );

    const postReachable =
      postProbe.ok && (postProbe.status === 401 || postProbe.httpOk);
    const summary = {
      ok: postReachable || optionsProbe.ok,
      viaProxy: viaProxy,
      status: postProbe.status || optionsProbe.status,
      elapsedMs: postProbe.elapsedMs || optionsProbe.elapsedMs,
      error: postReachable
        ? undefined
        : formatErrorSummary({
            name: postProbe.errorName || optionsProbe.errorName,
            message: postProbe.errorMessage || optionsProbe.errorMessage,
          }),
      options: optionsProbe,
      post: postProbe,
      postReachable: postReachable,
    };

    // #region agent log
    debugLog(
      "dialogue.js:probeSiliconFlowReachable",
      "probe-summary",
      summary,
      "H1"
    );
    // #endregion

    return summary;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const ms = timeoutMs || API_FETCH_TIMEOUT_DIALOGUE_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const external = options && options.signal;
    if (external) {
      if (external.aborted) {
        clearTimeout(timer);
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      external.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted && !(external && external.aborted)) {
        const timeoutErr = new Error(
          `请求超时（已等待约 ${Math.round(ms / 1000)} 秒仍无响应）。对话生成较慢时可再试，或换更小/更快模型。`
        );
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      // #region agent log
      debugLog(
        "dialogue.js:fetchWithTimeout",
        "fetch-error",
        {
          url: url,
          method: (options && options.method) || "GET",
          errorName: err && err.name ? err.name : "",
          errorMessage: err && err.message ? String(err.message) : String(err),
          timeoutMs: ms,
        },
        "H2"
      );
      // #endregion
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function abortCharacterRequest(charId, reason) {
    const controller = state.activeRequests[charId];
    if (!controller) return false;

    console.log(`[abort] ${charId} request cancelled by ${reason || "unknown"}`);
    locallyAbortedSignals.add(controller.signal);
    controller.abort();
    delete state.activeRequests[charId];
    return true;
  }

  function abortAllRequests(reason) {
    Object.keys(state.activeRequests).forEach((charId) => {
      abortCharacterRequest(charId, reason || "abort-all");
    });
    updateInputState(false);
  }

  /* ─── Schema utils ──────────────────────────────────────── */

  const TYPE_MAP = {
    object: "OBJECT",
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    array: "ARRAY",
  };

  function normalizeSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    const out = {};
    Object.keys(schema).forEach((k) => {
      const v = schema[k];
      if (k === "type" && typeof v === "string") {
        out[k] = TYPE_MAP[v.toLowerCase()] || v.toUpperCase();
      } else if (k === "properties" && v && typeof v === "object") {
        out[k] = {};
        Object.keys(v).forEach((prop) => {
          out[k][prop] = normalizeSchema(v[prop]);
        });
      } else if (k === "items") {
        out[k] = normalizeSchema(v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  /* ─── AI Sidebar ─────────────────────────────────────────── */

  function appendAiOutput(entry) {
    const list = document.getElementById("ai-output-list");
    if (!list) return;

    const empty = list.querySelector(".ai-output-empty");
    if (empty) empty.remove();

    const item = document.createElement("div");
    item.className = "ai-output-item";
    if (entry.error || entry.statusType === "error") {
      item.classList.add("is-error");
    } else if (entry.statusType === "success") {
      item.classList.add("is-success");
    } else if (entry.statusType === "info") {
      item.classList.add("is-info");
    }

    /* Header */
    const header = document.createElement("div");
    header.className = "ai-output-item-header";

    const labelEl = document.createElement("span");
    labelEl.className = "ai-output-label";
    labelEl.textContent = entry.label || "AI 响应";

    const timeEl = document.createElement("span");
    timeEl.className = "ai-output-time";
    timeEl.textContent = new Date().toLocaleTimeString("zh-CN");

    header.appendChild(labelEl);
    header.appendChild(timeEl);
    item.appendChild(header);

    /* Error body */
    if (entry.error) {
      const errEl = document.createElement("div");
      errEl.className = "ai-output-error-body";
      errEl.textContent = entry.error;
      item.appendChild(errEl);
    }

    /* Info / success status (诊断进度) */
    if (entry.parsed && (entry.statusType === "info" || entry.statusType === "success")) {
      const infoEl = document.createElement("div");
      infoEl.className = "ai-output-info-body";
      infoEl.textContent =
        typeof entry.parsed === "string"
          ? entry.parsed
          : JSON.stringify(entry.parsed, null, 2);
      item.appendChild(infoEl);
    }

    /* Thinking section (collapsible) */
    if (entry.thinking) {
      const details = document.createElement("details");
      details.className = "ai-section thinking";
      details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = "思考过程";

      const body = document.createElement("div");
      body.className = "ai-section-body";

      const pre = document.createElement("pre");
      pre.className = "ai-pre thinking-pre";
      pre.textContent = entry.thinking;

      body.appendChild(pre);
      details.appendChild(summary);
      details.appendChild(body);
      item.appendChild(details);
    }

    /* Raw JSON (collapsible) */
    if (entry.rawJson) {
      const details = document.createElement("details");
      details.className = "ai-section";

      const summary = document.createElement("summary");
      summary.textContent = "原始响应 JSON";

      const body = document.createElement("div");
      body.className = "ai-section-body";

      const pre = document.createElement("pre");
      pre.className = "ai-pre";
      pre.textContent = JSON.stringify(entry.rawJson, null, 2);

      body.appendChild(pre);
      details.appendChild(summary);
      details.appendChild(body);
      item.appendChild(details);
    }

    /* Parsed result (always visible) */
    if (
      entry.parsed &&
      entry.statusType !== "info" &&
      entry.statusType !== "success"
    ) {
      const parsedSection = document.createElement("div");
      parsedSection.className = "ai-parsed-section";

      const parsedLabel = document.createElement("div");
      parsedLabel.className = "ai-parsed-label";
      parsedLabel.textContent = "解析结果";

      const pre = document.createElement("pre");
      pre.className = "ai-pre parsed-pre";
      pre.textContent = JSON.stringify(entry.parsed, null, 2);

      parsedSection.appendChild(parsedLabel);
      parsedSection.appendChild(pre);
      item.appendChild(parsedSection);
    }

    /* Token usage */
    if (entry.usage) {
      const usageEl = document.createElement("div");
      usageEl.className = "ai-usage";

      const fmt = (label, count) => {
        const s = document.createElement("span");
        s.innerHTML = `<span style="color:#444">${label}</span> ${count ?? "—"}`;
        return s;
      };

      usageEl.appendChild(fmt("输入", entry.usage.promptTokenCount));
      usageEl.appendChild(fmt("输出", entry.usage.candidatesTokenCount));
      if (entry.usage.thoughtsTokenCount != null) {
        usageEl.appendChild(fmt("思考", entry.usage.thoughtsTokenCount));
      }
      item.appendChild(usageEl);
    }

    /* Prepend so newest is at top */
    list.insertBefore(item, list.firstChild);
  }

  /* ─── Core AI Callers ────────────────────────────────────── */

  async function callGeminiProvider(options, apiKey, modelName) {
    const {
      label,
      systemPrompt,
      messages,
      responseSchema,
      signal,
      quietSidebarOnError,
      fetchTimeoutMs,
    } = options || {};

    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(modelName) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const VALID_GEMINI_ROLES = new Set(["user", "model"]);
    const contents = (messages || [])
      .filter((m) => VALID_GEMINI_ROLES.has(m.role))
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content || "" }],
      }));

    const body = {
      systemInstruction: systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined,
      contents,
      generationConfig: responseSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: normalizeSchema(responseSchema),
          }
        : undefined,
    };

    let rawJson = null;
    const t0 = Date.now();
    logApi("Gemini", "请求开始", { url, model: modelName, label });

    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
        fetchTimeoutMs || API_FETCH_TIMEOUT_DIALOGUE_MS
      );

      rawJson = await res.json();
      logApi("Gemini", "收到 HTTP 响应", {
        status: res.status,
        ok: res.ok,
        elapsedMs: Date.now() - t0,
      });

      const parts = rawJson?.candidates?.[0]?.content?.parts || [];
      const thinkingText = parts
        .filter((p) => p.thought === true)
        .map((p) => p.text || "")
        .join("\n")
        .trim();
      const textContent = parts
        .filter((p) => !p.thought)
        .map((p) => p.text || "")
        .join("");

      const usage = rawJson?.usageMetadata || null;

      if (!res.ok) {
        const errMsg =
          rawJson?.error?.message ||
          `HTTP ${res.status}: ${JSON.stringify(rawJson).slice(0, 200)}`;
        appendAiOutput({ label: label || "AI 响应", error: errMsg, rawJson, usage });
        throw new Error(`Gemini API 返回错误状态码: ${res.status} — ${errMsg}`);
      }

      let parsed = null;
      try {
        parsed = textContent ? JSON.parse(textContent) : null;
      } catch (_) {
        parsed = null;
      }

      appendAiOutput({
        label: label || "AI 响应",
        thinking: thinkingText || null,
        rawJson,
        parsed,
        usage,
      });

      if (!parsed && responseSchema) {
        throw new Error("Gemini 响应无法解析为预期 JSON。");
      }

      return parsed || {};
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      if (rawJson === null && !quietSidebarOnError) {
        appendAiOutput({
          label: label || "AI 响应",
          error: formatErrorDetail(err, {
            url,
            provider: "gemini",
            model: modelName,
            elapsedMs: Date.now() - t0,
          }),
        });
      }
      logApi("Gemini", "请求失败", err);
      throw err;
    }
  }

  async function callSiliconFlowProvider(options, apiKey, modelName) {
    const {
      label,
      systemPrompt,
      messages,
      responseSchema,
      signal,
      quietSidebarOnError,
      fetchTimeoutMs,
    } = options || {};

    const url = getSiliconFlowApiUrl();

    /* 将对话历史转换为 OpenAI 格式，system prompt 作为首条 system 消息 */
    const openAiMessages = [];
    let effectiveSystemPrompt = systemPrompt || "";
    if (responseSchema) {
      effectiveSystemPrompt +=
        "\n\n请严格按照以下 JSON Schema 返回纯 JSON，不得包含任何多余文字：\n" +
        JSON.stringify(responseSchema);
    }
    if (effectiveSystemPrompt) {
      openAiMessages.push({ role: "system", content: effectiveSystemPrompt });
    }
    const VALID_SF_ROLES = new Set(["user", "assistant", "system", "tool"]);
    (messages || []).forEach((m) => {
      const role = m.role === "model" ? "assistant" : m.role;
      if (!VALID_SF_ROLES.has(role)) return;
      openAiMessages.push({ role, content: m.content || "" });
    });

    const body = {
      model: modelName,
      messages: openAiMessages,
      response_format: responseSchema ? { type: "json_object" } : undefined,
    };

    let rawJson = null;
    const t0 = Date.now();
    logApi("SiliconFlow", "请求开始", { url, model: modelName, label });

    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify(body),
          signal,
        },
        fetchTimeoutMs || API_FETCH_TIMEOUT_DIALOGUE_MS
      );

      rawJson = await res.json();
      logApi("SiliconFlow", "收到 HTTP 响应", {
        status: res.status,
        ok: res.ok,
        elapsedMs: Date.now() - t0,
      });

      /* 归一化 usage 字段，与 Gemini 格式保持一致供 appendAiOutput 复用 */
      const sfUsage = rawJson?.usage || null;
      const usage = sfUsage
        ? {
            promptTokenCount: sfUsage.prompt_tokens,
            candidatesTokenCount: sfUsage.completion_tokens,
          }
        : null;

      if (!res.ok) {
        const errMsg =
          rawJson?.error?.message ||
          `HTTP ${res.status}: ${JSON.stringify(rawJson).slice(0, 200)}`;
        appendAiOutput({ label: label || "AI 响应", error: errMsg, rawJson, usage });
        throw new Error(`硅基流动 API 返回错误状态码: ${res.status} — ${errMsg}`);
      }

      const textContent = rawJson?.choices?.[0]?.message?.content || "";

      let parsed = null;
      try {
        parsed = textContent ? JSON.parse(textContent) : null;
      } catch (_) {
        parsed = null;
      }

      appendAiOutput({
        label: label || "AI 响应",
        rawJson,
        parsed,
        usage,
      });

      if (!parsed && responseSchema) {
        throw new Error("硅基流动响应无法解析为预期 JSON。");
      }

      return parsed || {};
    } catch (err) {
      if (isAbortError(err)) {
        throw err;
      }
      if (rawJson === null && !quietSidebarOnError) {
        appendAiOutput({
          label: label || "AI 响应",
          error: formatErrorDetail(err, {
            url,
            provider: "siliconflow",
            model: modelName,
            elapsedMs: Date.now() - t0,
          }),
        });
      }
      logApi("SiliconFlow", "请求失败", err);
      throw err;
    }
  }

  function legacyMockEnding(isEndingPhase) {
    if (isEndingPhase) {
      return {
        action: "默默站在一旁，没有立刻介入。",
        line: "……这事儿，好像不该我管。",
        reason: "本地模拟数据。",
      };
    }
    return {
      reply: "（本地模拟：未填写 API Key，当前显示模拟回复。）",
      touched: true,
      closing_signal: false,
    };
  }

  function mockValueForSchema(subSchema) {
    if (!subSchema || typeof subSchema !== "object") return "（测试模式占位）";
    const t = String(subSchema.type || "string").toLowerCase();
    if (t === "object" && subSchema.properties && typeof subSchema.properties === "object") {
      const inner = {};
      Object.keys(subSchema.properties).forEach((k) => {
        inner[k] = mockValueForSchema(subSchema.properties[k]);
      });
      return inner;
    }
    if (t === "array") {
      return [];
    }
    if (t === "integer" || t === "number") {
      return 0;
    }
    if (t === "boolean") {
      return false;
    }
    return "（测试模式占位）";
  }

  function buildMockFromSchema(responseSchema, isEndingPhase) {
    if (!responseSchema || typeof responseSchema !== "object") {
      return legacyMockEnding(isEndingPhase);
    }
    /* F-004c：notebook 无 API / 测试模式走 LoopScript 周目占位日记，保持记忆递进。 */
    if (responseSchema.title === "notebook") {
      let loopIndex = 1;
      try {
        if (window.LoopState && typeof window.LoopState.getLoopIndex === "function") {
          loopIndex = window.LoopState.getLoopIndex();
        }
      } catch (_) { /* ignore */ }
      try {
        if (window.LoopScript && typeof window.LoopScript.getTestNotebookBody === "function") {
          const scripted = window.LoopScript.getTestNotebookBody(loopIndex);
          if (typeof scripted === "string" && scripted.trim().length > 0) {
            return { body: scripted };
          }
        }
      } catch (_) { /* ignore */ }
      return { body: "[测试占位] 第 " + loopIndex + " 周目日记。" };
    }
    if (responseSchema.title === "loop_memory") {
      return {
        summary: [
          "【小一】在街口说过图书馆，连结不深但不算完全陌生。",
          "【小二】话不多，常常用嘲讽掩盖在意；危机时像是僵在原地。",
          "【三三】提到过花店，语气里有一种我说不清的熟悉。",
          "终局时刀落下来，他们各自做了旁观或靠近的选择——这些我打算写进本子里，免得下次又忘。",
        ].join("\n"),
      };
    }
    const props = responseSchema.properties;
    if (!props || typeof props !== "object") {
      return legacyMockEnding(isEndingPhase);
    }
    const out = {};
    Object.keys(props).forEach((k) => {
      out[k] = mockValueForSchema(props[k]);
    });
    return out;
  }

  /**
   * 公共路由入口（options 可传入 signal 取消真实出站请求）。
   * 测试模式 / 无 API Key 时按 schema 内省生成占位；有 Key 时按 provider 路由。
   */
  async function callGemini(options) {
    const { label, responseSchema, isEndingPhase } = options || {};

    let testMode = false;
    try {
      testMode = localStorage.getItem("npc_test_mode") === "1";
    } catch (_) {
      testMode = false;
    }
    if (testMode) {
      const mock = buildMockFromSchema(responseSchema, isEndingPhase);
      appendAiOutput({
        label: (label || "AI 响应") + " [测试模式]",
        parsed: mock,
      });
      return mock;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      const mock = buildMockFromSchema(responseSchema, isEndingPhase);
      appendAiOutput({
        label: (label || "AI 响应") + " [本地模拟]",
        parsed: mock,
      });
      return mock;
    }

    const modelName = getModelName();
    const provider  = getApiProvider();

    return provider === "siliconflow"
      ? callSiliconFlowProvider(options, apiKey, modelName)
      : callGeminiProvider(options, apiKey, modelName);
  }

  /* ─── UI Rendering ───────────────────────────────────────── */

  function scrollDialogueToBottom() {
    const el = document.getElementById("dialogue-history");
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderSceneCharacters() {
    state.characters.forEach((c, i) => {
      const circle = document.getElementById(`npc-${i + 1}`);
      if (!circle) return;
      if (c.currentColor) circle.style.backgroundColor = c.currentColor;
      circle.classList.toggle("active", c.id === state.currentCharacterId);
      const atFull = (c.currentCandor || 0) >= (c.maxCandor || NPCConfig.MAX_CANDOR);
      circle.classList.toggle("at-full-candor", atFull);
    });
  }

  function renderCharacterButtons() {
    document.querySelectorAll(".character-button").forEach((btn) => {
      const id = btn.getAttribute("data-character-id");
      const passed = isPassed(id);
      const unlocked = isUnlocked(id);
      btn.classList.toggle("active", id === state.currentCharacterId);
      const closedDial = unlocked && !passed && isCharacterClosed(id);
      btn.classList.toggle("closed", closedDial);
      btn.classList.toggle("is-passed", passed);
      btn.classList.toggle("is-locked", !unlocked && !passed);

      const canEnter = unlocked || passed;
      btn.disabled = !canEnter;
      if (passed) {
        btn.title = "已经离开";
      } else if (!unlocked) {
        btn.title = "先和前面的人说点什么";
      } else {
        btn.removeAttribute("title");
      }
    });
  }

  function buildMessageRow(msg) {
    const row = document.createElement("div");
    const roleClass =
      msg.role === "user"  ? "player" :
      msg.role === "error" ? "system error" :
      msg.role === "system"? "system" : "npc";
    row.className = `message-row ${roleClass}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (msg.role !== "system" && msg.role !== "error") {
      const meta = document.createElement("span");
      meta.className = "message-meta";
      meta.textContent = msg.role === "user" ? "你" : "对方";
      bubble.appendChild(meta);
    }

    const text = document.createElement("div");
    text.textContent = msg.content;

    bubble.appendChild(text);
    row.appendChild(bubble);
    return row;
  }

  function appendMessageToDom(msg) {
    const container = document.getElementById("dialogue-history");
    if (!container) return;

    const empty = container.querySelector(".dialogue-empty");
    if (empty) empty.remove();

    container.appendChild(buildMessageRow(msg));
    scrollDialogueToBottom();
  }

  function renderDialogueHistory() {
    const container = document.getElementById("dialogue-history");
    if (!container) return;

    const history = state.dialogueHistories[state.currentCharacterId] || [];
    container.innerHTML = "";

    if (history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dialogue-empty";
      empty.textContent = "选择角色，开始对话。";
      container.appendChild(empty);
      return;
    }

    history.forEach((msg) => {
      container.appendChild(buildMessageRow(msg));
    });

    scrollDialogueToBottom();
  }

  function appendMessageForCharacter(charId, role, content) {
    const id = charId;
    if (!id) return;
    const hist = state.dialogueHistories[id] || [];
    const msg = { role, content: String(content || "") };
    hist.push(msg);
    state.dialogueHistories[id] = hist;
    if (id === state.currentCharacterId) {
      appendMessageToDom(msg);
    }
  }

  function appendMessage(role, content) {
    appendMessageForCharacter(state.currentCharacterId, role, content);
  }

  const CLOSE_THRESHOLD = 3;

  function isCharacterClosed(id) {
    return (state.closingStreaks[id] || 0) >= CLOSE_THRESHOLD;
  }

  function isUnlocked(charId) {
    return state.unlockedChars.includes(charId);
  }

  function isPassed(charId) {
    return state.passedChars.includes(charId);
  }

  /**
   * @param {boolean} options.force — S3「移到下一人」在未自然关闭时也推进
   * @returns {boolean} 是否发生了推进（新解锁了一名后续角色）
   */
  function tryAdvanceUnlock(fromCharId, options) {
    const force = !!(options && options.force);
    if (!fromCharId) return false;
    const ix = PLAYABLE_ORDER.indexOf(fromCharId);
    if (ix < 0) return false;
    if (state.passedChars.includes(fromCharId)) return false;

    const closed = isCharacterClosed(fromCharId);
    if (!closed && !force) return false;

    const isLastNpc = ix >= PLAYABLE_ORDER.length - 1;
    state.passedChars.push(fromCharId);

    if (!isLastNpc) {
      const nextId = PLAYABLE_ORDER[ix + 1];
      if (nextId && !state.unlockedChars.includes(nextId)) {
        state.unlockedChars.push(nextId);
      }
    }
    renderCharacterButtons();
    return true;
  }

  function updateClosingHint() {
    const el = document.getElementById("closing-hint");
    if (!el) return;
    const id     = state.currentCharacterId;
    const streak = state.closingStreaks[id] || 0;
    if (isCharacterClosed(id)) {
      el.textContent = "对方已经不想再和你说话了。";
    } else if (streak >= 2) {
      el.textContent = "对方好像不太想继续聊下去了。";
    } else {
      el.textContent = "";
    }
  }

  /* Disable/enable the input area, respecting "closed", read-only, and in-flight turns. */
  function syncDialogueReadOnlyClass() {
    const panel = document.querySelector(".dialogue-panel");
    if (panel) panel.classList.toggle("is-readonly", !!state.readOnly);
  }

  function updateInputState(sending) {
    const textarea = document.getElementById("player-input");
    const sendBtn  = document.getElementById("send-button");
    const endBtn   = document.getElementById("ending-button");
    const closed   = isCharacterClosed(state.currentCharacterId);
    const ro       = state.readOnly;
    const thinking = !!sending || isCurrentCharacterThinking();

    syncDialogueReadOnlyClass();

    if (textarea) {
      textarea.disabled = closed || ro || thinking;
      if (ro) {
        textarea.placeholder = "对话已结束，仅可查看";
      } else if (thinking) {
        textarea.placeholder = "对方正在思考中…";
      } else {
        textarea.placeholder = closed
          ? "对方已经关闭了对话。"
          : "你想对他说什么？（Ctrl + Enter 发送）";
      }
    }
    if (sendBtn) {
      sendBtn.disabled = closed || ro || thinking;
      sendBtn.textContent = ro
        ? "（已离开此人）"
        : thinking
          ? "思考中…"
          : "说出这句";
    }
    if (endBtn) endBtn.disabled = false;
    syncQuickReplyUi(sending);
  }

  function getCurrentLoopIndexForQuickReply() {
    try {
      if (window.LoopState && typeof window.LoopState.getLoopIndex === "function") {
        const v = window.LoopState.getLoopIndex();
        if (Number.isFinite(v) && v >= 1) return Math.floor(v);
      }
    } catch (_) { /* ignore */ }
    return 1;
  }

  function syncQuickReplyUi(sending) {
    const wrap = document.getElementById("quick-replies");
    if (!wrap) return;
    const char = getActiveCharacter();
    if (!char) {
      wrap.hidden = true;
      return;
    }
    const cid = char.id;
    const showQuick = isUnlocked(cid) && !isPassed(cid) && !state.readOnly;
    wrap.hidden = !showQuick;
    if (!showQuick) return;
    /* 优先按当前周目从 LoopScript 取（周目化剧本提示），回退到 characters.js 静态 quickReplies */
    let list = null;
    try {
      if (window.LoopScript && typeof window.LoopScript.getQuickReplies === "function") {
        list = window.LoopScript.getQuickReplies(cid, getCurrentLoopIndexForQuickReply());
      }
    } catch (_) { list = null; }
    if (!Array.isArray(list) || list.length === 0) {
      list = Array.isArray(char.quickReplies) ? char.quickReplies : [];
    }
    wrap.querySelectorAll(".quick-reply-button").forEach((btn, i) => {
      const line = list[i] || "";
      btn.textContent = line;
      btn.dataset.quickText = line;
      const closedChat = isCharacterClosed(cid);
      btn.disabled = !line || closedChat || isCharacterThinking(cid);
    });
  }

  function setSending(on) {
    updateInputState(on);
  }

  /* ─── Character Switch ───────────────────────────────────── */

  function switchCharacter(id) {
    if (!id || !state.characters.find((c) => c.id === id)) return;
    if (!isUnlocked(id) && !isPassed(id)) return;
    const oldCharId = state.currentCharacterId;
    if (oldCharId && oldCharId !== id) {
      abortCharacterRequest(oldCharId, "switch-character");
    }
    state.readOnly = isPassed(id);
    state.currentCharacterId = id;
    renderCharacterButtons();
    renderSceneCharacters();
    renderDialogueHistory();
    updateClosingHint();
    updateInputState(false);
  }

  /* ─── Send Message ───────────────────────────────────────── */

  async function dispatchPlayerTurn(content) {
    const trimmed = String(content || "").trim();
    if (!trimmed) return;

    if (state.readOnly) return;

    const character = getActiveCharacter();
    if (!character) return;

    if (isCharacterClosed(character.id)) return;

    if (isCharacterThinking(character.id)) {
      updateInputState(false);
      return;
    }

    appendMessage("user", trimmed);

    const history = state.dialogueHistories[character.id] || [];

    const schema = {
      type: "object",
      properties: {
        reply: { type: "string" },
        touched: { type: "boolean" },
        closing_signal: { type: "boolean" },
      },
      required: ["reply", "touched", "closing_signal"],
    };

    const requestedCharId = character.id;
    const controller = new AbortController();
    state.activeRequests[requestedCharId] = controller;
    setSending(true);
    try {
      /* 测试模式 + 命中本周目 quick reply 预设文本 → 短路 callGemini，
         直接走原校验/candor/closing 路径。不破坏 callGemini 通用性。 */
      let testModeActive = false;
      try {
        testModeActive = localStorage.getItem("npc_test_mode") === "1";
      } catch (_) { testModeActive = false; }

      let presetMock = null;
      if (testModeActive && window.LoopScript && typeof window.LoopScript.getQuickReplyMock === "function") {
        try {
          const loopIdx = getCurrentLoopIndexForQuickReply();
          presetMock = window.LoopScript.getQuickReplyMock(requestedCharId, loopIdx, trimmed);
        } catch (_) { presetMock = null; }
      }

      let result;
      if (presetMock) {
        appendAiOutput({
          label: `${character.name} · 对话 [测试模式 · 周目剧本]`,
          parsed: presetMock,
        });
        result = presetMock;
      } else {
        result = await callGemini({
          label: `${character.name} · 对话`,
          systemPrompt: character.systemPrompt,
          messages: history,
          responseSchema: schema,
          signal: controller.signal,
          fetchTimeoutMs: API_FETCH_TIMEOUT_DIALOGUE_MS,
        });
      }

      if (controller.signal.aborted) return;
      if (state.activeRequests[requestedCharId] !== controller) return;
      if (state.currentCharacterId !== requestedCharId) return;

      if (!result || !result.reply) {
        throw new Error("AI 响应缺少 reply 字段。");
      }
      if (typeof result.touched !== "boolean" || typeof result.closing_signal !== "boolean") {
        throw new Error("AI 响应缺少 touched 或 closing_signal 字段。");
      }

      if (!String(result.reply).trim()) {
        appendMessageForCharacter(requestedCharId, "error", "对方没有返回可显示的回复，请稍后再试。");
        return;
      }

      appendMessage("model", result.reply);

      /* Step candor up or down based on whether this round touched the character */
      const touched = result.touched === true;
      const updated = window.NPCConfig.stepCandorAndColor(character, touched);
      const idx = state.characters.findIndex((c) => c.id === character.id);
      if (idx >= 0) state.characters[idx] = updated;

      renderSceneCharacters();

      /* closing_signal=true 表示模型判定本轮应结束对话，立即达到关闭阈值（非累加 3 次） */
      const charId = requestedCharId;
      const prev = state.closingStreaks[charId] || 0;
      let next = prev;
      if (!isCharacterClosed(charId)) {
        if (result.closing_signal) {
          next = CLOSE_THRESHOLD;
        } else if (prev < CLOSE_THRESHOLD) {
          next = 0;
        }
        state.closingStreaks[charId] = next;
      }

      if (next >= CLOSE_THRESHOLD && prev < CLOSE_THRESHOLD) {
        /* First time threshold is crossed — show a one-time system notice */
        appendMessage("system", "对方已经不想再说下去了。");
      }

      tryAdvanceUnlock(character.id);

      updateClosingHint();
      updateInputState(false);
    } catch (err) {
      if (isLocalAbortError(err, controller)) {
        console.log(`[abort] ${requestedCharId} request ignored after cancellation`);
        return;
      }
      console.error(`[dialogue.js] ${requestedCharId} turn failed`, err);
      const failProvider = getApiProvider();
      appendAiOutput({
        label: `${character.name} · 对话`,
        error: formatErrorDetail(err, {
          provider: failProvider,
          model: getModelName(),
        }),
      });
      appendMessageForCharacter(
        requestedCharId,
        "error",
        `请求失败：${formatErrorSummary(err)}`
      );
    } finally {
      if (state.activeRequests[requestedCharId] === controller) {
        delete state.activeRequests[requestedCharId];
        if (state.currentCharacterId === requestedCharId) {
          setSending(false);
        }
      }
    }
  }

  async function handleSend() {
    const textarea = document.getElementById("player-input");
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) return;
    if (isCurrentCharacterThinking()) {
      updateInputState(false);
      return;
    }
    textarea.value = "";
    await dispatchPlayerTurn(content);
  }

  /* ─── Setup ──────────────────────────────────────────────── */

  const PROVIDER_DEFAULTS = {
    gemini: {
      modelPlaceholder: "如 gemini-2.0-flash / gemini-2.5-pro-preview",
      modelDefault: () => window.GEMINI_PRESET_MODEL || "gemini-2.0-flash",
      keyPlaceholder: "粘贴 Gemini API Key（仅保存在内存）",
      hint: "支持思考的模型将在侧边栏显示思考过程",
    },
    siliconflow: {
      modelPlaceholder: "如 Qwen/Qwen2.5-72B-Instruct / deepseek-ai/DeepSeek-V3",
      modelDefault: () => window.SILICONFLOW_PRESET_MODEL || "Qwen/Qwen2.5-72B-Instruct",
      keyPlaceholder: "粘贴硅基流动 API Key（仅保存在内存）",
      hint: "硅基流动兼容 OpenAI 接口，支持多种开源模型",
    },
  };

  function applyProviderUi(provider) {
    const cfg = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini;
    const keyInput   = document.getElementById("api-key-input");
    const modelInput = document.getElementById("model-name-input");
    const hintEl     = document.getElementById("model-hint");

    if (keyInput)   keyInput.placeholder   = cfg.keyPlaceholder;
    if (modelInput) {
      modelInput.placeholder = cfg.modelPlaceholder;
      /* 仅在输入框为空或仍是另一个来源的默认值时自动切换，不覆盖用户手动填写的值 */
      const otherProvider = provider === "gemini" ? "siliconflow" : "gemini";
      const otherDefault  = PROVIDER_DEFAULTS[otherProvider].modelDefault();
      if (!modelInput.value.trim() || modelInput.value.trim() === otherDefault) {
        modelInput.value = cfg.modelDefault();
      }
    }
    if (hintEl) hintEl.textContent = cfg.hint;
  }

  function setup() {
    if (isLocalDevOrigin()) {
      appendAiOutput({
        label: "[系统] 本地模式",
        statusType: "info",
        parsed: {
          说明: "已启用硅基同源代理（绕过浏览器跨域限制）",
          API地址: getSiliconFlowApiUrl(),
        },
      });
    }

    /* Character buttons */
    document.querySelectorAll(".character-button").forEach((btn) => {
      btn.addEventListener("click", () =>
        switchCharacter(btn.getAttribute("data-character-id"))
      );
    });

    /* Send */
    const sendBtn = document.getElementById("send-button");
    if (sendBtn) sendBtn.addEventListener("click", handleSend);

    document.querySelectorAll(".quick-reply-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = btn.getAttribute("data-quick-text") || "";
        void dispatchPlayerTurn(line);
      });
    });

    const textarea = document.getElementById("player-input");
    if (textarea) {
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    /* Provider selector + 持久化恢复 */
    const providerSelect = document.getElementById("api-provider-select");
    const keyInput       = document.getElementById("api-key-input");
    const modelInput     = document.getElementById("model-name-input");

    const LS_PROVIDER = "npc_api_provider";
    const LS_KEY      = "npc_api_key";
    const LS_MODEL    = "npc_api_model";

    /* 读取上次保存的配置，回退到 config.local.js 预设 */
    const savedProvider = localStorage.getItem(LS_PROVIDER);
    const savedKey      = localStorage.getItem(LS_KEY);
    const savedModel    = localStorage.getItem(LS_MODEL);

    if (providerSelect) {
      const initialProvider = savedProvider || window.AI_PROVIDER || "gemini";
      providerSelect.value = initialProvider;
      applyProviderUi(initialProvider);

      providerSelect.addEventListener("change", () => {
        const p = providerSelect.value;
        localStorage.setItem(LS_PROVIDER, p);
        applyProviderUi(p);
      });
    }

    if (keyInput) {
      if (savedKey) keyInput.value = savedKey;
      keyInput.addEventListener("input", () => {
        localStorage.setItem(LS_KEY, keyInput.value.trim());
      });
    }

    if (modelInput) {
      if (savedModel) modelInput.value = savedModel;
      modelInput.addEventListener("input", () => {
        localStorage.setItem(LS_MODEL, modelInput.value.trim());
      });
    }

    /* Test connection button in sidebar */
    const testBtn = document.getElementById("test-gemini-btn");
    if (testBtn) {
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "测试中…";
        const provider = getApiProvider();
        const providerName = provider === "siliconflow" ? "SiliconFlow" : "Gemini";
        const modelName = getModelName();
        const label = `[测试连接] ${providerName}`;
        const progressLabel = `${label} · 进度`;
        const apiUrl =
          provider === "siliconflow"
            ? getSiliconFlowApiUrl()
            : "https://generativelanguage.googleapis.com/...";
        const t0 = Date.now();

        function reportProgress(step, extra) {
          const payload = { 步骤: step, ...(extra || {}) };
          logApi("测试连接", step, extra);
          appendAiOutput({
            label: progressLabel,
            statusType: "info",
            parsed: payload,
          });
        }

        reportProgress("① 开始", {
          来源: providerName,
          模型: modelName,
          已填Key: !!getApiKey(),
          测试模式: localStorage.getItem("npc_test_mode") === "1",
          API调试: isApiDebugEnabled(),
        });

        let probeResult = null;
        try {
          let testMode = false;
          try {
            testMode = localStorage.getItem("npc_test_mode") === "1";
          } catch (_) {
            testMode = false;
          }
          if (testMode) {
            throw new Error(
              "当前勾选了「测试模式」，不会发起真实网络请求。请取消勾选后再点测试连接。"
            );
          }
          if (!getApiKey()) {
            throw new Error(`${providerName} API Key 为空，无法测试真实连接。`);
          }

          if (provider === "siliconflow") {
            reportProgress("②-a 探测硅基服务器是否可达（约 12 秒）", {
              URL: apiUrl,
            });
            probeResult = await probeSiliconFlowReachable();
            reportProgress(
              probeResult.ok ? "②-a 探测通过" : "②-a 探测失败",
              probeResult
            );
            if (!probeResult.ok) {
              const probeErr = new Error(
                isLocalDevOrigin()
                  ? "本地代理探测失败。请确认用「一键启动.bat」启动（不要用纯 http.server），并查看 NPC-Demo-服务 窗口是否有报错。"
                  : "浏览器无法连接硅基 API。请运行「网络诊断.bat」检查网络。"
              );
              probeErr.name = "NetworkUnreachableError";
              probeErr.probe = probeResult;
              throw probeErr;
            }
          }

          reportProgress("②-b 发送测试对话（最多约 90 秒）", {
            URL: apiUrl,
            模型: modelName,
            说明: "与顶部输入框模型一致",
          });

          const result = await callGemini({
            label,
            quietSidebarOnError: true,
            fetchTimeoutMs: API_FETCH_TIMEOUT_TEST_MS,
            systemPrompt: "你是一个简单的健康检查端点，只返回 JSON。",
            messages: [
              {
                role: "user",
                content: '请返回 {"ok": true, "message": "pong"} 这样的 JSON。',
              },
            ],
            responseSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                message: { type: "string" },
              },
              required: ["ok", "message"],
            },
          });

          reportProgress("③ 已收到响应，正在校验", {
            耗时ms: Date.now() - t0,
          });

          if (!result || result.ok !== true) {
            throw new Error("连接测试响应缺少 ok=true。");
          }

          appendAiOutput({
            label,
            statusType: "success",
            parsed: {
              结果: "连接成功",
              provider,
              message: result.message || "pong",
              耗时ms: Date.now() - t0,
            },
          });
          logApi("测试连接", "成功", { elapsedMs: Date.now() - t0 });
        } catch (err) {
          console.error(`[NPC 测试连接] ${providerName} 失败`, err);
          appendAiOutput({
            label,
            statusType: "error",
            error: formatErrorDetail(err, {
              url: apiUrl,
              provider,
              model: modelName,
              elapsedMs: Date.now() - t0,
              probe: probeResult,
            }),
          });
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = "测试连接";
        }
      });
    }

    /* Clear sidebar */
    const clearBtn = document.getElementById("clear-output-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const list = document.getElementById("ai-output-list");
        if (list) {
          list.innerHTML =
            '<p class="ai-output-empty">对话开始后，AI 的思考过程与原始输出将在此显示。</p>';
        }
      });
    }

    /* Initial render */
    renderCharacterButtons();
    renderSceneCharacters();
    renderDialogueHistory();
    updateClosingHint();
    updateInputState(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }

  /* ─── Public API (used by ending.js) ────────────────────── */

  /* ─── patchCharacter ─────────────────────────────────────── */
  /* loop.js 导入存档后调用，同步更新已初始化的活跃角色对象。     */
  /* 只修改已存在的项，不新增字段，不触发任何渲染。               */
  function patchCharacter(charId, patch) {
    const idx = state.characters.findIndex((c) => c.id === charId);
    if (idx < 0) return;
    state.characters[idx] = { ...state.characters[idx], ...patch };
  }

  /* ─── resetForNewLoop ────────────────────────────────────── */
  /* 在导入新存档前调用，将对话状态彻底清空：                     */
  /*   · closingStreaks 全部归零（消除跨轮"永久关闭"残留）        */
  /*   · dialogueHistories 全部清空                              */
  /*   · currentCandor 归零（初始值均为 0，归零 = 恢复初始）      */
  /* 归零后触发渲染刷新，保证 UI 与状态同步。                     */
  function resetForNewLoop() {
    abortAllRequests("reset-for-new-loop");
    state.characters = state.characters.map(function (c) {
      return NPC_CONFIG.updateCandorAndColor(c, 0);
    });
    state.characters.forEach(function (c) {
      state.dialogueHistories[c.id] = [];
      state.closingStreaks[c.id] = 0;
    });
    state.unlockedChars = ["char1"];
    state.passedChars = [];
    state.readOnly = false;
    renderDialogueHistory();
    renderSceneCharacters();
    renderCharacterButtons();
    updateClosingHint();
    updateInputState(false);
  }

  function advanceOrTriggerEnding() {
    const id = state.currentCharacterId;
    if (!id) return undefined;
    if (id === "char3") {
      abortAllRequests("trigger-ending");
      return "trigger-ending";
    }
    abortCharacterRequest(id, "advance");
    tryAdvanceUnlock(id, { force: true });
    const ix = PLAYABLE_ORDER.indexOf(id);
    const nextId = PLAYABLE_ORDER[ix + 1];
    if (nextId && isUnlocked(nextId) && !isPassed(nextId)) {
      switchCharacter(nextId);
    }
    updateClosingHint();
    updateInputState(false);
    return "advanced";
  }

  window.DialogueState = {
    getSnapshot() {
      return {
        characters: state.characters.map((c) => ({ ...c })),
        dialogueHistories: JSON.parse(JSON.stringify(state.dialogueHistories)),
      };
    },
    getCharacters: () => state.characters,
    getDialogueHistories: () => state.dialogueHistories,
    callGemini,
    appendAiOutput,
    patchCharacter,
    resetForNewLoop,
    abortAllRequests,
    isUnlocked,
    isPassed,
    tryAdvanceUnlock,
    advanceOrTriggerEnding,
  };
})();

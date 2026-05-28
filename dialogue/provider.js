(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

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
    D.request.logApi("Gemini", "请求开始", { url, model: modelName, label });

    try {
      const res = await D.request.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
        fetchTimeoutMs || D.core.API_FETCH_TIMEOUT_DIALOGUE_MS
      );

      rawJson = await res.json();
      D.request.logApi("Gemini", "收到 HTTP 响应", {
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
        D.output.appendAiOutput({ label: label || "AI 响应", error: errMsg, rawJson, usage });
        throw new Error(`Gemini API 返回错误状态码: ${res.status} — ${errMsg}`);
      }

      let parsed = null;
      try {
        parsed = textContent ? JSON.parse(textContent) : null;
      } catch (_) {
        parsed = null;
      }

      D.output.appendAiOutput({
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
      if (D.request.isAbortError(err)) {
        throw err;
      }
      if (rawJson === null && !quietSidebarOnError) {
        D.output.appendAiOutput({
          label: label || "AI 响应",
          error: D.request.formatErrorDetail(err, {
            url,
            provider: "gemini",
            model: modelName,
            elapsedMs: Date.now() - t0,
          }),
        });
      }
      D.request.logApi("Gemini", "请求失败", err);
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

    const url = D.core.getSiliconFlowApiUrl();

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
    D.request.logApi("SiliconFlow", "请求开始", { url, model: modelName, label });

    try {
      const res = await D.request.fetchWithTimeout(
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
        fetchTimeoutMs || D.core.API_FETCH_TIMEOUT_DIALOGUE_MS
      );

      rawJson = await res.json();
      D.request.logApi("SiliconFlow", "收到 HTTP 响应", {
        status: res.status,
        ok: res.ok,
        elapsedMs: Date.now() - t0,
      });

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
        D.output.appendAiOutput({ label: label || "AI 响应", error: errMsg, rawJson, usage });
        throw new Error(`硅基流动 API 返回错误状态码: ${res.status} — ${errMsg}`);
      }

      const textContent = rawJson?.choices?.[0]?.message?.content || "";

      let parsed = null;
      try {
        parsed = textContent ? JSON.parse(textContent) : null;
      } catch (_) {
        parsed = null;
      }

      D.output.appendAiOutput({
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
      if (D.request.isAbortError(err)) {
        throw err;
      }
      if (rawJson === null && !quietSidebarOnError) {
        D.output.appendAiOutput({
          label: label || "AI 响应",
          error: D.request.formatErrorDetail(err, {
            url,
            provider: "siliconflow",
            model: modelName,
            elapsedMs: Date.now() - t0,
          }),
        });
      }
      D.request.logApi("SiliconFlow", "请求失败", err);
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
      D.output.appendAiOutput({
        label: (label || "AI 响应") + " [测试模式]",
        parsed: mock,
      });
      return mock;
    }

    const apiKey = D.core.getApiKey();
    if (!apiKey) {
      const mock = buildMockFromSchema(responseSchema, isEndingPhase);
      D.output.appendAiOutput({
        label: (label || "AI 响应") + " [本地模拟]",
        parsed: mock,
      });
      return mock;
    }

    const modelName = D.core.getModelName();
    const provider  = D.core.getApiProvider();

    return provider === "siliconflow"
      ? callSiliconFlowProvider(options, apiKey, modelName)
      : callGeminiProvider(options, apiKey, modelName);
  }

  D.provider = {
    normalizeSchema,
    buildMockFromSchema,
    callGeminiProvider,
    callSiliconFlowProvider,
    callGemini,
  };
})();

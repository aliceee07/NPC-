(function () {
  const NPC_CONFIG = window.NPCConfig || {};
  const BASE_CHARACTERS = (NPC_CONFIG.baseCharacters || []).map((c) => ({ ...c }));

  /* ─── State ─────────────────────────────────────────────── */

  const state = {
    characters: BASE_CHARACTERS,
    currentCharacterId: BASE_CHARACTERS[0] ? BASE_CHARACTERS[0].id : null,
    dialogueHistories: {},
    closingStreaks: {},
  };

  BASE_CHARACTERS.forEach((c) => {
    state.dialogueHistories[c.id] = [];
    state.closingStreaks[c.id] = 0;
  });

  /* ─── Config helpers ─────────────────────────────────────── */

  function getApiKey() {
    const el = document.getElementById("api-key-input");
    const inputVal = el ? el.value.trim() : "";
    /* 优先级：页面输入框 > config.local.js > 空 */
    return inputVal || window.GEMINI_PRESET_KEY || "";
  }

  function getModelName() {
    const el = document.getElementById("model-name-input");
    /* 优先级：页面输入框 > config.local.js > 默认值 */
    return (el ? el.value.trim() : "") || window.GEMINI_PRESET_MODEL || "gemini-2.0-flash";
  }

  function getActiveCharacter() {
    return (
      state.characters.find((c) => c.id === state.currentCharacterId) ||
      state.characters[0]
    );
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
    item.className = "ai-output-item" + (entry.error ? " is-error" : "");

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
    if (entry.parsed) {
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

  /* ─── Core Gemini Caller ─────────────────────────────────── */

  /**
   * Calls the Gemini REST API.
   *
   * Fixes vs previous version:
   * 1. camelCase body fields: systemInstruction, generationConfig,
   *    responseMimeType, responseSchema (snake_case caused 400 errors).
   * 2. No `role` inside systemInstruction (also caused 400).
   * 3. Extracts thinking tokens (parts with thought:true) separately.
   * 4. Appends every call result to the AI sidebar.
   */
  async function callGemini(options) {
    const { label, systemPrompt, messages, responseSchema, isEndingPhase } = options || {};

    const apiKey = getApiKey();
    if (!apiKey) {
      const mock = mockResponse(isEndingPhase);
      appendAiOutput({
        label: (label || "AI 响应") + " [本地模拟]",
        parsed: mock,
      });
      return mock;
    }

    const modelName = getModelName();
    /* systemInstruction / responseSchema are v1beta-only features.
       v1beta uses camelCase field names. */
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(modelName) +
      ":generateContent?key=" +
      encodeURIComponent(apiKey);

    const contents = (messages || []).map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content || "" }],
    }));

    /* v1beta endpoint uses camelCase.
       systemInstruction must NOT have a role field. */
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

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      rawJson = await res.json();

      /* Split thinking parts from text parts */
      const parts =
        rawJson?.candidates?.[0]?.content?.parts || [];
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
        appendAiOutput({
          label: label || "AI 响应",
          error: errMsg,
          rawJson,
          usage,
        });
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
      if (rawJson === null) {
        /* Network-level failure */
        appendAiOutput({
          label: label || "AI 响应",
          error: err.message || String(err),
        });
      }
      throw err;
    }
  }

  function mockResponse(isEndingPhase) {
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
      btn.classList.toggle("active", id === state.currentCharacterId);
      btn.classList.toggle("closed", isCharacterClosed(id));
    });
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
      container.appendChild(row);
    });

    scrollDialogueToBottom();
  }

  function appendMessage(role, content) {
    const id = state.currentCharacterId;
    if (!id) return;
    const hist = state.dialogueHistories[id] || [];
    hist.push({ role, content: String(content || "") });
    state.dialogueHistories[id] = hist;
    renderDialogueHistory();
  }

  const CLOSE_THRESHOLD = 3;

  function isCharacterClosed(id) {
    return (state.closingStreaks[id] || 0) >= CLOSE_THRESHOLD;
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

  /* Disable/enable the input area, respecting both "sending" and "closed" states */
  function updateInputState(sending) {
    const textarea = document.getElementById("player-input");
    const sendBtn  = document.getElementById("send-button");
    const endBtn   = document.getElementById("ending-button");
    const closed   = isCharacterClosed(state.currentCharacterId);

    if (textarea) {
      textarea.disabled = sending || closed;
      textarea.placeholder = closed
        ? "对方已经关闭了对话。"
        : "你想对他说什么？（Ctrl + Enter 发送）";
    }
    if (sendBtn) {
      sendBtn.disabled = sending || closed;
      sendBtn.textContent = sending ? "思考中…" : "说出这句";
    }
    if (endBtn) endBtn.disabled = sending;
  }

  function setSending(on) {
    updateInputState(on);
  }

  /* ─── Character Switch ───────────────────────────────────── */

  function switchCharacter(id) {
    if (!id || !state.characters.find((c) => c.id === id)) return;
    state.currentCharacterId = id;
    renderCharacterButtons();
    renderSceneCharacters();
    renderDialogueHistory();
    updateClosingHint();
    updateInputState(false);
  }

  /* ─── Send Message ───────────────────────────────────────── */

  async function handleSend() {
    const textarea = document.getElementById("player-input");
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) return;

    const character = getActiveCharacter();
    if (!character) return;

    if (isCharacterClosed(character.id)) return;

    appendMessage("user", content);
    textarea.value = "";

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

    setSending(true);
    try {
      const result = await callGemini({
        label: `${character.name} · 对话`,
        systemPrompt: character.systemPrompt,
        messages: history,
        responseSchema: schema,
      });

      if (!result || !result.reply) {
        appendMessage("error", "对方似乎没有听见你的声音，请稍后再试。");
        return;
      }

      appendMessage("model", result.reply);

      /* Step candor up or down based on whether this round touched the character */
      const touched = result.touched === true;
      const updated = window.NPCConfig.stepCandorAndColor(character, touched);
      const idx = state.characters.findIndex((c) => c.id === character.id);
      if (idx >= 0) state.characters[idx] = updated;

      renderSceneCharacters();

      const prev = state.closingStreaks[character.id] || 0;
      const next = result.closing_signal ? prev + 1 : 0;
      state.closingStreaks[character.id] = next;

      if (next >= CLOSE_THRESHOLD && prev < CLOSE_THRESHOLD) {
        /* First time threshold is crossed — show a one-time system notice */
        appendMessage("system", "对方已经不想再说下去了。");
      }

      updateClosingHint();
      updateInputState(false);
    } catch (_) {
      appendMessage("error", "对方似乎没有听见你的声音，请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  /* ─── Setup ──────────────────────────────────────────────── */

  function setup() {
    /* Character buttons */
    document.querySelectorAll(".character-button").forEach((btn) => {
      btn.addEventListener("click", () =>
        switchCharacter(btn.getAttribute("data-character-id"))
      );
    });

    /* Send */
    const sendBtn = document.getElementById("send-button");
    if (sendBtn) sendBtn.addEventListener("click", handleSend);

    const textarea = document.getElementById("player-input");
    if (textarea) {
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    /* Test connection button in sidebar */
    const testBtn = document.getElementById("test-gemini-btn");
    if (testBtn) {
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "测试中…";
        try {
          await callGemini({
            label: "连接测试",
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
        } catch (_) {
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }

  /* ─── Public API (used by ending.js) ────────────────────── */

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
  };
})();

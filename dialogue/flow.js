(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function appendMessageForCharacter(charId, role, content) {
    const id = charId;
    if (!id) return;
    const hist = D.core.state.dialogueHistories[id] || [];
    const msg = { role, content: String(content || "") };
    hist.push(msg);
    D.core.state.dialogueHistories[id] = hist;
    if (id === D.core.state.currentCharacterId) {
      D.render.appendMessageToDom(msg);
    }
  }

  function appendMessage(role, content) {
    appendMessageForCharacter(D.core.state.currentCharacterId, role, content);
  }

  function tryAdvanceUnlock(fromCharId, options) {
    const force = !!(options && options.force);
    if (!fromCharId) return false;
    const ix = D.core.PLAYABLE_ORDER.indexOf(fromCharId);
    if (ix < 0) return false;
    if (D.core.state.passedChars.includes(fromCharId)) return false;

    const closed = D.core.isCharacterClosed(fromCharId);
    if (!closed && !force) return false;

    const isLastNpc = ix >= D.core.PLAYABLE_ORDER.length - 1;
    D.core.state.passedChars.push(fromCharId);

    if (!isLastNpc) {
      const nextId = D.core.PLAYABLE_ORDER[ix + 1];
      if (nextId && !D.core.state.unlockedChars.includes(nextId)) {
        D.core.state.unlockedChars.push(nextId);
      }
    }
    D.render.renderCharacterButtons();
    return true;
  }

  function switchCharacter(id) {
    if (!id || !D.core.state.characters.find((c) => c.id === id)) return;
    if (!D.core.isUnlocked(id) && !D.core.isPassed(id)) return;
    const oldCharId = D.core.state.currentCharacterId;
    if (oldCharId && oldCharId !== id && !D.core.isPassed(id)) {
      D.request.abortCharacterRequest(oldCharId, "switch-character");
    }
    D.core.state.readOnly = D.core.isPassed(id);
    D.core.state.currentCharacterId = id;
    D.render.renderCharacterButtons();
    D.render.renderSceneCharacters();
    D.render.renderDialogueHistory();
    D.render.updateClosingHint();
    D.render.updateInputState(D.core.isCurrentCharacterThinking());
  }

  async function dispatchPlayerTurn(content) {
    const trimmed = String(content || "").trim();
    if (!trimmed) return;

    if (D.core.state.readOnly) return;

    const character = D.core.getActiveCharacter();
    if (!character) return;

    if (D.core.isCharacterClosed(character.id)) return;

    if (D.core.isCharacterThinking(character.id)) {
      D.render.updateInputState(false);
      return;
    }

    appendMessage("user", trimmed);

    const history = D.core.state.dialogueHistories[character.id] || [];

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
    D.core.state.activeRequests[requestedCharId] = controller;
    D.render.setSending(true);
    const _auditT0 = Date.now();
    const _auditMsgsSent = history.slice();
    try {
      let testModeActive = false;
      try {
        testModeActive = localStorage.getItem("npc_test_mode") === "1";
      } catch (_) { testModeActive = false; }

      let presetMock = null;
      if (testModeActive && window.LoopScript && typeof window.LoopScript.getQuickReplyMock === "function") {
        try {
          const loopIdx = D.render.getCurrentLoopIndexForQuickReply();
          presetMock = window.LoopScript.getQuickReplyMock(requestedCharId, loopIdx, trimmed);
        } catch (_) { presetMock = null; }
      }

      let result;
      if (presetMock) {
        D.output.appendAiOutput({
          label: `${character.name} · 对话 [测试模式 · 周目剧本]`,
          parsed: presetMock,
        });
        result = presetMock;
      } else {
        result = await D.provider.callGemini({
          label: `${character.name} · 对话`,
          systemPrompt: character.systemPrompt,
          messages: history,
          responseSchema: schema,
          signal: controller.signal,
          fetchTimeoutMs: D.core.API_FETCH_TIMEOUT_DIALOGUE_MS,
        });
      }

      if (controller.signal.aborted) return;
      if (D.core.state.activeRequests[requestedCharId] !== controller) return;

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

      appendMessageForCharacter(requestedCharId, "model", result.reply);

      const touched = result.touched === true;
      const updated = window.NPCConfig.stepCandorAndColor(character, touched);
      const idx = D.core.state.characters.findIndex((c) => c.id === character.id);
      if (idx >= 0) D.core.state.characters[idx] = updated;

      const charId = requestedCharId;
      const prev = D.core.state.closingStreaks[charId] || 0;
      let next = prev;
      if (!D.core.isCharacterClosed(charId)) {
        if (result.closing_signal) {
          next = D.core.CLOSE_THRESHOLD;
        } else if (prev < D.core.CLOSE_THRESHOLD) {
          next = 0;
        }
        D.core.state.closingStreaks[charId] = next;
      }

      if (next >= D.core.CLOSE_THRESHOLD && prev < D.core.CLOSE_THRESHOLD) {
        appendMessageForCharacter(requestedCharId, "system", "对方已经不想再说下去了。");
      }

      tryAdvanceUnlock(character.id);

      D.render.renderSceneCharacters();

      if (D.core.state.currentCharacterId === requestedCharId) {
        D.render.updateClosingHint();
        D.render.updateInputState(false);
      }

      D.audit.recordDialogueSuccess({
        requestedCharId,
        character,
        trimmed,
        auditMsgsSent: _auditMsgsSent,
        schema,
        result,
        presetMock,
        auditT0: _auditT0,
      });
    } catch (err) {
      if (D.request.isLocalAbortError(err, controller)) {
        console.log(`[abort] ${requestedCharId} request ignored after cancellation`);
        return;
      }
      D.audit.recordDialogueError({
        requestedCharId,
        character,
        trimmed,
        auditMsgsSent: _auditMsgsSent,
        schema,
        err,
        auditT0: _auditT0,
      });
      console.error(`[dialogue.js] ${requestedCharId} turn failed`, err);
      const failProvider = D.core.getApiProvider();
      D.output.appendAiOutput({
        label: `${character.name} · 对话`,
        error: D.request.formatErrorDetail(err, {
          provider: failProvider,
          model: D.core.getModelName(),
        }),
      });
      appendMessageForCharacter(
        requestedCharId,
        "error",
        `请求失败：${D.request.formatErrorSummary(err)}`
      );
    } finally {
      if (D.core.state.activeRequests[requestedCharId] === controller) {
        delete D.core.state.activeRequests[requestedCharId];
        if (D.core.state.currentCharacterId === requestedCharId) {
          D.render.setSending(false);
        }
      }
    }
  }

  function handleSend() {
    const textarea = document.getElementById("player-input");
    if (!textarea) return;
    const content = textarea.value.trim();
    if (!content) return;
    if (D.core.isCurrentCharacterThinking()) {
      D.render.updateInputState(false);
      return;
    }
    textarea.value = "";
    void dispatchPlayerTurn(content);
  }

  D.flow = {
    appendMessageForCharacter,
    appendMessage,
    tryAdvanceUnlock,
    switchCharacter,
    dispatchPlayerTurn,
    handleSend,
  };
})();

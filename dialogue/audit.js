(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function resolveDialogueMockSource(presetMock) {
    if (presetMock) {
      return { mockSource: "quick_reply_script", status: "mock" };
    }
    let testMode = false;
    try {
      testMode = localStorage.getItem("npc_test_mode") === "1";
    } catch (_) {}
    if (testMode) {
      return { mockSource: "test_mode", status: "mock" };
    }
    if (!D.core.getApiKey()) {
      return { mockSource: "no_api_key", status: "mock" };
    }
    return { mockSource: null, status: "ok" };
  }

  function recordDialogueSuccess(params) {
    if (!window.AuditLog) return;
    (async function () {
      try {
        const {
          requestedCharId,
          character,
          trimmed,
          auditMsgsSent,
          schema,
          result,
          presetMock,
          auditT0,
        } = params;

        const { mockSource, status } = resolveDialogueMockSource(presetMock);

        const promptId = await window.AuditLog.registerPromptArtifact(
          requestedCharId,
          character.systemPrompt
        );
        const prevId = window.AuditLog.getLastDialogueLogId(requestedCharId);
        const sourceIds = [promptId].concat(prevId ? [prevId] : []);

        const loopIdx =
          window.LoopState && typeof window.LoopState.getLoopIndex === "function"
            ? window.LoopState.getLoopIndex()
            : 1;

        const logId = await window.AuditLog.write(
          "dialogue_npc",
          {
            character_id: requestedCharId,
            player_input: trimmed,
            effective_system_prompt: character.systemPrompt,
            messages_sent: auditMsgsSent,
            response_schema: schema,
            raw_ai_output: JSON.stringify(result),
            parsed_reply: result.reply,
            parsed_touched: result.touched,
            parsed_closing_signal: result.closing_signal,
            mock_source: mockSource,
          },
          {
            label: (character.name || requestedCharId) + "\u00B7\u5BF9\u8BDD",
            status: status,
            durationMs: Date.now() - auditT0,
            loopPhase: "loop_" + loopIdx + "_dialogue",
            model: D.core.getModelName(),
            provider: D.core.getApiProvider(),
            sourceIds: sourceIds,
          }
        );
        if (logId) window.AuditLog.pushDialogueLogId(requestedCharId, logId);
      } catch (err) {
        console.warn("[AuditLog] dialogue_npc log failed", err);
      }
    })();
  }

  function recordDialogueError(params) {
    if (!window.AuditLog) return;
    (async function () {
      try {
        const {
          requestedCharId,
          character,
          trimmed,
          auditMsgsSent,
          schema,
          err,
          auditT0,
        } = params;

        const loopIdx =
          window.LoopState && typeof window.LoopState.getLoopIndex === "function"
            ? window.LoopState.getLoopIndex()
            : 1;

        const logId = await window.AuditLog.write(
          "dialogue_npc",
          {
            character_id: requestedCharId,
            player_input: trimmed,
            effective_system_prompt: character ? character.systemPrompt : null,
            messages_sent: auditMsgsSent,
            response_schema: schema,
            raw_ai_output: null,
            parsed_reply: null,
            parsed_touched: null,
            parsed_closing_signal: null,
            mock_source: null,
          },
          {
            label:
              (character ? character.name || requestedCharId : requestedCharId) +
              "\u00B7\u5BF9\u8BDD",
            status: "error",
            error: err && err.message ? String(err.message) : String(err),
            durationMs: Date.now() - auditT0,
            loopPhase: "loop_" + loopIdx + "_dialogue",
            model: D.core.getModelName(),
            provider: D.core.getApiProvider(),
            sourceIds: [],
          }
        );
        if (logId) window.AuditLog.pushDialogueLogId(requestedCharId, logId);
      } catch (logErr) {
        console.warn("[AuditLog] dialogue_npc error log failed", logErr);
      }
    })();
  }

  D.audit = {
    resolveDialogueMockSource,
    recordDialogueSuccess,
    recordDialogueError,
  };
})();

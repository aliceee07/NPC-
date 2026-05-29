(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function patchCharacter(charId, patch) {
    const idx = D.core.state.characters.findIndex((c) => c.id === charId);
    if (idx < 0) return;
    D.core.state.characters[idx] = { ...D.core.state.characters[idx], ...patch };
  }

  function resetForNewLoop() {
    D.request.abortAllRequests("reset-for-new-loop");
    if (window.AuditLog && typeof window.AuditLog.resetLoopTracking === "function") {
      window.AuditLog.resetLoopTracking();
    }
    D.core.state.characters = D.core.state.characters.map(function (c) {
      return D.core.NPC_CONFIG.updateCandorAndColor(c, 0);
    });
    D.core.state.characters.forEach(function (c) {
      D.core.state.dialogueHistories[c.id] = [];
      D.core.state.closingStreaks[c.id] = 0;
    });
    D.core.state.unlockedChars = ["char1"];
    D.core.state.passedChars = [];
    D.core.state.readOnly = false;
    D.render.renderDialogueHistory();
    D.render.renderSceneCharacters();
    D.render.renderCharacterButtons();
    D.render.updateClosingHint();
    D.render.updateInputState(false);
  }

  function advanceOrTriggerEnding() {
    const id = D.core.state.currentCharacterId;
    if (!id) return undefined;
    if (id === "char3") {
      D.request.abortAllRequests("trigger-ending");
      return "trigger-ending";
    }
    D.request.abortCharacterRequest(id, "advance");
    D.flow.tryAdvanceUnlock(id, { force: true });
    const ix = D.core.PLAYABLE_ORDER.indexOf(id);
    const nextId = D.core.PLAYABLE_ORDER[ix + 1];
    if (nextId && D.core.isUnlocked(nextId) && !D.core.isPassed(nextId)) {
      D.flow.switchCharacter(nextId);
    }
    D.render.updateClosingHint();
    D.render.updateInputState(false);
    return "advanced";
  }

  function createPublicApi() {
    return {
      getSnapshot() {
        return {
          characters: D.core.state.characters.map((c) => ({ ...c })),
          dialogueHistories: JSON.parse(JSON.stringify(D.core.state.dialogueHistories)),
        };
      },
      getCharacters: () => D.core.state.characters,
      getDialogueHistories: () => D.core.state.dialogueHistories,
      callGemini: D.provider.callGemini,
      appendAiOutput: D.output.appendAiOutput,
      patchCharacter,
      resetForNewLoop,
      abortAllRequests: D.request.abortAllRequests,
      isUnlocked: D.core.isUnlocked,
      isPassed: D.core.isPassed,
      tryAdvanceUnlock: D.flow.tryAdvanceUnlock,
      advanceOrTriggerEnding,
    };
  }

  D.publicApi = {
    patchCharacter,
    resetForNewLoop,
    advanceOrTriggerEnding,
    createPublicApi,
  };
})();

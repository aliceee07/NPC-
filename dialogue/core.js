(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  const NPC_CONFIG = window.NPCConfig || {};
  const BASE_CHARACTERS = (NPC_CONFIG.baseCharacters || []).map((c) => ({ ...c }));
  const PLAYABLE_ORDER = ["char1", "char2", "char3"];
  const CLOSE_THRESHOLD = 3;
  const ERROR_MESSAGE_MAX_LENGTH = 180;
  const API_FETCH_TIMEOUT_PROBE_MS = 12000;
  const API_FETCH_TIMEOUT_TEST_MS = 90000;
  const API_FETCH_TIMEOUT_DIALOGUE_MS = 180000;
  const API_DEBUG_LS_KEY = "npc_api_debug";

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

  BASE_CHARACTERS.forEach((c) => {
    state.dialogueHistories[c.id] = [];
    state.closingStreaks[c.id] = 0;
  });

  function getApiProvider() {
    const el = document.getElementById("api-provider-select");
    return (el ? el.value : "") || window.AI_PROVIDER || "gemini";
  }

  function getApiKey() {
    const el = document.getElementById("api-key-input");
    const inputVal = el ? el.value.trim() : "";
    if (inputVal) return inputVal;
    return getApiProvider() === "siliconflow"
      ? (window.SILICONFLOW_PRESET_KEY || "")
      : (window.GEMINI_PRESET_KEY || "");
  }

  function getModelName() {
    const el = document.getElementById("model-name-input");
    const inputVal = el ? el.value.trim() : "";
    if (inputVal) return inputVal;
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

  function isCharacterThinking(charId) {
    return !!(charId && state.activeRequests[charId]);
  }

  function isCurrentCharacterThinking() {
    return isCharacterThinking(state.currentCharacterId);
  }

  function isCharacterClosed(id) {
    return (state.closingStreaks[id] || 0) >= CLOSE_THRESHOLD;
  }

  function isUnlocked(charId) {
    return state.unlockedChars.includes(charId);
  }

  function isPassed(charId) {
    return state.passedChars.includes(charId);
  }

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
    debugLog(
      "dialogue.js:getSiliconFlowApiUrl",
      "resolve-url",
      { url: url, viaProxy: viaProxy, origin: location && location.origin },
      "H2"
    );
    return url;
  }

  function debugLog(locationName, message, data, hypothesisId, runId) {
    const entry = {
      sessionId: "8a0631",
      location: locationName,
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

  D.core = {
    NPC_CONFIG,
    BASE_CHARACTERS,
    PLAYABLE_ORDER,
    CLOSE_THRESHOLD,
    ERROR_MESSAGE_MAX_LENGTH,
    API_FETCH_TIMEOUT_PROBE_MS,
    API_FETCH_TIMEOUT_TEST_MS,
    API_FETCH_TIMEOUT_DIALOGUE_MS,
    API_DEBUG_LS_KEY,
    state,
    locallyAbortedSignals,
    getApiProvider,
    getApiKey,
    getModelName,
    getActiveCharacter,
    isCharacterThinking,
    isCurrentCharacterThinking,
    isCharacterClosed,
    isUnlocked,
    isPassed,
    isLocalDevOrigin,
    getSiliconFlowApiUrl,
    debugLog,
  };
})();

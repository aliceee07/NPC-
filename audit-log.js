(function () {
  'use strict';

  /* ─── UUID v4 ───────────────────────────────────────────────────── */
  function uuidv4() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (_) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* ─── Simple hash（内存缓存 key，非加密用途）────────────────────── */
  function simpleHash(str) {
    var h = 5381;
    var sample = String(str || '').slice(0, 256) + '|' + String(str || '').length;
    for (var i = 0; i < sample.length; i++) {
      h = ((h << 5) + h) ^ sample.charCodeAt(i);
      h = h | 0;
    }
    return (h >>> 0).toString(16);
  }

  /* ─── 常量 ──────────────────────────────────────────────────────── */
  var SESSION_LS_KEY = 'npc_audit_session_id';
  // Phase 3：LOG_ENDPOINT 改为动态函数（父 agent 补丁3：严格判空 BASE_URL）
  // var LOG_ENDPOINT = 'http://127.0.0.1:8765/api/log';  // 已废弃静态常量
  function getLogEndpoint() {
    // 父 agent 补丁3：严格检查 BASE_URL 非空字符串，防止拼出错误 URL
    if (window.CloudSync &&
        typeof window.CloudSync.BASE_URL === 'string' &&
        window.CloudSync.BASE_URL.length > 0) {
      return window.CloudSync.BASE_URL + '/api/log';
    }
    return 'http://127.0.0.1:8765/api/log';
  }
  var ALLOWED_FEATURES = {
    dialogue_npc: 1, api_connectivity_test: 1, ending_stage3: 1,
    loop_memory: 1, subconscious_settlement: 1, diary_generation: 1, artifact_registry: 1,
  };

  /* ─── Session ───────────────────────────────────────────────────── */
  var _sessionId = null;

  function _ensureSession() {
    if (_sessionId) return _sessionId;
    try {
      var saved = localStorage.getItem(SESSION_LS_KEY);
      if (saved && typeof saved === 'string' && saved.length > 4) {
        _sessionId = saved;
        return _sessionId;
      }
    } catch (_) {}
    _sessionId = uuidv4();
    try { localStorage.setItem(SESSION_LS_KEY, _sessionId); } catch (_) {}
    return _sessionId;
  }

  function startSession()         { _ensureSession(); }
  function getSessionId()         { return _ensureSession(); }
  function resetSessionForNewGame() {
    try { localStorage.removeItem(SESSION_LS_KEY); } catch (_) {}
    _sessionId = null;
  }

  /** 从日志续接时写入已有 session_id（不触发 resetSessionForNewGame） */
  function applySessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 4) return;
    _sessionId = sessionId;
    try { localStorage.setItem(SESSION_LS_KEY, sessionId); } catch (_) {}
  }

  /* ─── 周目追踪状态（per session / per loop）────────────────────── */
  var _loopDialogueLogs = {}; // charId → [logId, ...]
  var _loopStage3Logs   = {}; // charId → logId
  var _loopMemoryLogId  = null;
  var _diaryLogId       = null; // 最近一条 diary log（跨周目日记链）

  /* 注册缓存 */
  var _promptArtifactCache = {}; // charId → { promptHash → id }
  var _artifactCache       = {}; // "artifactType:payloadHash" → logId

  function resetLoopTracking() {
    _loopDialogueLogs = {};
    _loopStage3Logs   = {};
    _loopMemoryLogId  = null;
    /* _diaryLogId 故意不清零：它是跨周目日记链的上游引用 */
  }

  /* ─── DOM 回退读取 ──────────────────────────────────────────────── */
  function _readModelFromDom() {
    try {
      var el = document.getElementById('model-name-input');
      if (el && el.value) return el.value.trim();
    } catch (_) {}
    return '';
  }

  function _readProviderFromDom() {
    try {
      var el = document.getElementById('api-provider-select');
      if (el && el.value) return el.value;
    } catch (_) {}
    return (typeof window.AI_PROVIDER === 'string' ? window.AI_PROVIDER : 'gemini');
  }

  function _getCurrentLoopIndex() {
    try {
      if (window.LoopState && typeof window.LoopState.getLoopIndex === 'function') {
        var v = window.LoopState.getLoopIndex();
        if (typeof v === 'number' && isFinite(v) && v >= 1) return Math.floor(v);
      }
    } catch (_) {}
    return 1;
  }

  /* ─── 核心 write ────────────────────────────────────────────────── */
  async function write(feature, payload, opts) {
    var o = opts || {};
    if (!ALLOWED_FEATURES[feature]) {
      console.warn('[AuditLog] unknown feature, dropped:', feature);
      return null;
    }
    var logId   = uuidv4();
    var loopIdx = _getCurrentLoopIndex();
    // Phase 2：新增 stage_id 字段（双写，loop_index 保留兼容过渡期）
    var stageId = (window.LoopState && typeof window.LoopState.getStageId === 'function')
      ? window.LoopState.getStageId()
      : null;
    // Phase 3：新增 user_id 字段
    var userId = (window.UserSession && typeof window.UserSession.getUserId === 'function')
      ? window.UserSession.getUserId()
      : null;
    var entry = {
      log_id:      logId,
      timestamp:   new Date().toISOString(),
      session_id:  getSessionId(),
      user_id:     userId,         // Phase 3 新增
      loop_phase:  o.loopPhase  || ('loop_' + loopIdx),
      stage_id:    stageId,        // Phase 2 新增
      loop_index:  loopIdx,        // 保留兼容
      feature:     feature,
      model:       o.model    || _readModelFromDom(),
      provider:    o.provider || _readProviderFromDom(),
      duration_ms: (o.durationMs != null) ? Number(o.durationMs) : null,
      status:      o.status || 'ok',
      error:       o.error  || null,
      source_ids:  Array.isArray(o.sourceIds) ? o.sourceIds : [],
      label:       o.label  || '',
      payload:     payload  || {},
    };
    try {
      await fetch(getLogEndpoint(), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(entry),
      });
    } catch (fetchErr) {
      console.warn('[AuditLog] log dropped:', feature, fetchErr);
    }
    return logId;
  }

  /* ─── Artifact 注册（带去重缓存）──────────────────────────────── */
  async function registerArtifact(artifactType, artifactPayload, opts) {
    var payloadStr = JSON.stringify(artifactPayload || {});
    var cacheKey   = artifactType + ':' + simpleHash(payloadStr);
    if (_artifactCache[cacheKey]) return _artifactCache[cacheKey];
    var logId = await write('artifact_registry', {
      artifact_type: artifactType,
      payload:       artifactPayload || {},
    }, opts || {});
    if (logId) _artifactCache[cacheKey] = logId;
    return logId;
  }

  function getBaselineId(key) { return 'baseline:' + key; }

  /* ─── Prompt artifact 注册（mutated_system_prompt 去重）──────── */
  async function registerPromptArtifact(charId, effectivePrompt) {
    var promptHash = simpleHash(effectivePrompt || '');
    if (!_promptArtifactCache[charId]) _promptArtifactCache[charId] = {};
    if (_promptArtifactCache[charId][promptHash]) {
      return _promptArtifactCache[charId][promptHash];
    }
    /* 检查是否与 _originalSystemPrompt 相同（baseline） */
    var originalPrompt = '';
    try {
      var chars = window.NPCConfig && window.NPCConfig.baseCharacters;
      if (Array.isArray(chars)) {
        var c = chars.find(function (ch) { return ch.id === charId; });
        if (c && typeof c._originalSystemPrompt === 'string') {
          originalPrompt = c._originalSystemPrompt;
        }
      }
    } catch (_) {}
    if (!effectivePrompt || effectivePrompt === originalPrompt) {
      var baseId = getBaselineId(charId + '_systemPrompt');
      _promptArtifactCache[charId][promptHash] = baseId;
      return baseId;
    }
    /* 变化版本 — 注册 */
    var logId = await registerArtifact('mutated_system_prompt', {
      character_id:       charId,
      source_baseline_id: getBaselineId(charId + '_systemPrompt'),
      effective_prompt:   effectivePrompt,
    }, { loopPhase: 'between_loops' });
    var result = logId || getBaselineId(charId + '_systemPrompt');
    _promptArtifactCache[charId][promptHash] = result;
    return result;
  }

  /* ─── Per-loop 追踪 helpers ──────────────────────────────────── */
  function pushDialogueLogId(charId, logId) {
    if (!_loopDialogueLogs[charId]) _loopDialogueLogs[charId] = [];
    _loopDialogueLogs[charId].push(logId);
  }
  function getLastDialogueLogId(charId) {
    var arr = _loopDialogueLogs[charId];
    return (arr && arr.length > 0) ? arr[arr.length - 1] : null;
  }
  function getAllDialogueLogIds(charId) {
    return (_loopDialogueLogs[charId] || []).slice();
  }
  function getAllCharDialogueLogIds() {
    var all = [];
    Object.keys(_loopDialogueLogs).forEach(function (cid) {
      all = all.concat(_loopDialogueLogs[cid]);
    });
    return all;
  }

  function setStage3LogId(charId, logId)  { _loopStage3Logs[charId] = logId; }
  function getAllStage3LogIds()            { return Object.values(_loopStage3Logs).filter(Boolean); }

  function setLoopMemoryLogId(logId)  { _loopMemoryLogId = logId; }
  function getLoopMemoryLogId()       { return _loopMemoryLogId; }

  function setDiaryLogId(logId) { _diaryLogId = logId; }
  function getDiaryLogId()      { return _diaryLogId; }

  /* ─── Init ───────────────────────────────────────────────────── */
  startSession();

  /* ─── Public API ─────────────────────────────────────────────── */
  window.AuditLog = {
    startSession:            startSession,
    getSessionId:            getSessionId,
    resetSessionForNewGame:  resetSessionForNewGame,
    applySessionId:          applySessionId,
    write:                   write,
    registerArtifact:        registerArtifact,
    getBaselineId:           getBaselineId,
    registerPromptArtifact:  registerPromptArtifact,
    resetLoopTracking:       resetLoopTracking,
    /* Per-loop dialogue tracking */
    pushDialogueLogId:       pushDialogueLogId,
    getLastDialogueLogId:    getLastDialogueLogId,
    getAllDialogueLogIds:     getAllDialogueLogIds,
    getAllCharDialogueLogIds: getAllCharDialogueLogIds,
    /* Per-loop stage3 / memory / diary tracking */
    setStage3LogId:          setStage3LogId,
    getAllStage3LogIds:       getAllStage3LogIds,
    setLoopMemoryLogId:      setLoopMemoryLogId,
    getLoopMemoryLogId:      getLoopMemoryLogId,
    setDiaryLogId:           setDiaryLogId,
    getDiaryLogId:           getDiaryLogId,
  };
})();

(function () {
  /* ═══════════════════════════════════════════════════════════
     PROGRESSION ENGINE  —  攻略值引擎空 stub（Phase 1 预留接口）
     Phase 4 才实现；Phase 1-3 所有方法均为 no-op。
     依赖：无
     对外暴露：window.ProgressionEngine
  ═══════════════════════════════════════════════════════════ */

  window.ProgressionEngine = {
    observe:          function (eventType, payload) { /* no-op，Phase 4 实现 */ },
    getValue:         function () { return 0; },
    hydrate:          function (progressionState) { /* no-op */ },
    applyAdjustment:  function (delta, reason) { /* no-op */ },
    subscribe:        function (cb) { /* no-op */ },
    unsubscribe:      function (cb) { /* no-op */ },
  };
})();

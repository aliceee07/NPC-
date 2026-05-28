(function () {
  /* ═══════════════════════════════════════════════════════════
     STAGE CATALOG  —  轻量 stageId 目录表（Phase 1 新建）
     职责：提供 stageId ↔ legacyLoopIndex 双向映射。
     依赖：无
     对外暴露：window.StageCatalog
  ═══════════════════════════════════════════════════════════ */

  var STAGE_CATALOG = [
    { stageId: 'orientation',      order: 1,  legacyLoopIndex: 1,  gate: null },
    { stageId: 'flower_resonance', order: 2,  legacyLoopIndex: 2,  gate: null },
    { stageId: 'flower_impulse',   order: 3,  legacyLoopIndex: 3,  gate: null },
    { stageId: 'truth_unveiled',   order: 4,  legacyLoopIndex: 4,  gate: null },
    { stageId: 'rage_fracture',    order: 5,  legacyLoopIndex: 5,  gate: null },
    { stageId: 'bitter_conflict',  order: 6,  legacyLoopIndex: 6,  gate: null },
    { stageId: 'dissolution_a',    order: 7,  legacyLoopIndex: 7,  gate: null },
    { stageId: 'dissolution_b',    order: 8,  legacyLoopIndex: 8,  gate: null },
    { stageId: 'seeking_release',  order: 9,  legacyLoopIndex: 9,  gate: null },
    { stageId: 'final_departure',  order: 10, legacyLoopIndex: 10, gate: null },
  ];

  var _byId  = {};
  var _byIdx = {};
  STAGE_CATALOG.forEach(function (e) {
    _byId[e.stageId]          = e;
    _byIdx[e.legacyLoopIndex] = e;
  });

  window.StageCatalog = {
    getAll: function () { return STAGE_CATALOG.slice(); },

    getByStageId:     function (stageId) { return _byId[stageId]  || null; },
    getByLegacyIndex: function (idx)     { return _byIdx[idx]      || null; },

    // 宽松版：未知 stageId 时 console.warn 后返回 null（不返回 1！）
    // 使用场景：渲染兜底（避免崩页，调用方自行处理 null）
    toLoopIndex: function (stageId) {
      var e = _byId[stageId];
      if (!e) { console.warn('[StageCatalog] Unknown stageId: ' + stageId); return null; }
      return e.legacyLoopIndex;
    },

    // 严格版：未知 stageId 时抛出 Error
    // 使用场景：升级路径（早 fail，避免坏存档悄悄重置到周目 1）
    toLoopIndexStrict: function (stageId) {
      var e = _byId[stageId];
      if (!e) throw new Error('[StageCatalog] Unknown stageId: ' + stageId);
      return e.legacyLoopIndex;
    },

    // loopIndex → stageId 字符串（未知返回 null）
    fromLoopIndex: function (idx) {
      var e = _byIdx[idx];
      return e ? e.stageId : null;
    },

    // 下一个 stageId（终局推进时使用；已是最终阶段则原样返回）
    nextStageId: function (currentStageId) {
      var e = _byId[currentStageId];
      if (!e) return null;
      var next = _byIdx[e.legacyLoopIndex + 1];
      return next ? next.stageId : currentStageId;
    },

    isFinalStage: function (stageId) {
      var e = _byId[stageId];
      return e ? (e.order === STAGE_CATALOG.length) : false;
    },
  };
})();

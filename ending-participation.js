(function () {
  /* ═══════════════════════════════════════════════════════════
     ENDING PARTICIPATION  —  终局按角色 / 周目参与配置
     职责：声明某周目、某角色是否调用终局阶段 3 判定、是否展示第三页栏目、
           是否做潜意识结算（供角色在场/离场扩展）。
     依赖：window.NotebookConfig（读取最终周目序号，可选）
     被消费：ending.js
     对外暴露：window.EndingParticipation
  ═══════════════════════════════════════════════════════════ */

  const ALL_CHARS = "*";

  /** 默认：全部参与 */
  const DEFAULT_FLAGS = {
    callStage3Judgment: true,
    showStage3Slot: true,
    callSubconsciousSettlement: true,
  };

  /**
   * 按 stageId 覆盖（Phase 2 迁移：key 从整数 loopIndex 改为 stageId 字符串）。
   * 值为 charId → 局部 flags，或 "*" 表示本局全部角色。
   * 未出现的 charId 仍走 DEFAULT_FLAGS（便于后续只配置「离场」角色）。
   *
   * flags:
   *   callStage3Judgment — 是否请求该角色的阶段 3 API 判定
   *   showStage3Slot     — 是否在阶段 3 显示该角色反应栏（可与上项独立，供仅占位不拉 API）
   *   callSubconsciousSettlement — 是否在终局后做潜意识结算
   */
  const LOOP_PARTICIPATION_OVERRIDES = {
    'final_departure': {
      [ALL_CHARS]: {
        callStage3Judgment: false,
        showStage3Slot: false,
        callSubconsciousSettlement: false,
      },
    },
  };

  function getFinalLoopIndex() {
    try {
      if (window.NotebookConfig && typeof window.NotebookConfig.getFinalLoopIndex === "function") {
        const n = Number(window.NotebookConfig.getFinalLoopIndex());
        if (Number.isFinite(n) && n >= 1) return Math.floor(n);
      }
    } catch (_) { /* ignore */ }
    return 10;
  }

  function mergeFlags(base, patch) {
    if (!patch || typeof patch !== "object") return { ...base };
    const out = { ...base };
    if (typeof patch.callStage3Judgment === "boolean") {
      out.callStage3Judgment = patch.callStage3Judgment;
    }
    if (typeof patch.showStage3Slot === "boolean") {
      out.showStage3Slot = patch.showStage3Slot;
    }
    if (typeof patch.callSubconsciousSettlement === "boolean") {
      out.callSubconsciousSettlement = patch.callSubconsciousSettlement;
    }
    return out;
  }

  /**
   * Phase 2 迁移：入参改为 stageId（字符串）
   * @param {{ stageId: string, charId: string, character?: object }} ctx
   * @returns {{ callStage3Judgment: boolean, showStage3Slot: boolean, callSubconsciousSettlement: boolean }}
   */
  function resolve(ctx) {
    const stageId = ctx && ctx.stageId;
    const charId = ctx && ctx.charId;
    let flags = { ...DEFAULT_FLAGS };

    if (!stageId || typeof stageId !== "string" || !charId) {
      return flags;
    }

    const bucket = LOOP_PARTICIPATION_OVERRIDES[stageId];
    if (bucket && typeof bucket === "object") {
      if (bucket[ALL_CHARS]) {
        flags = mergeFlags(flags, bucket[ALL_CHARS]);
      }
      if (bucket[charId]) {
        flags = mergeFlags(flags, bucket[charId]);
      }
    }

    return flags;
  }

  /**
   * Phase 2 迁移：入参改为 stageId（字符串）
   * @param {string} stageId  当前 stage 的 stageId
   * @param {Array} characters  角色数组
   */
  function getMapForCharacters(stageId, characters) {
    const map = Object.create(null);
    if (!Array.isArray(characters)) return map;
    characters.forEach(function (c) {
      if (!c || !c.id) return;
      map[c.id] = resolve({
        stageId: stageId,
        charId: c.id,
        character: c,
      });
    });
    return map;
  }

  window.EndingParticipation = {
    ALL_CHARS,
    DEFAULT_FLAGS,
    LOOP_PARTICIPATION_OVERRIDES,
    getFinalLoopIndex,
    resolve,
    getMapForCharacters,
  };
})();

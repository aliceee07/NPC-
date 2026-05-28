(function () {
  /* ═══════════════════════════════════════════════════════════
     LOOP STATE  —  周目入口层
     职责：周目选择界面展示、sessionStorage 自动导入、
           手动 JSON 导入、mutableSubconscious 注入。
     依赖：window.NPCConfig（characters.js）、
           window.DialogueState（dialogue.js）
     对外暴露：window.LoopState
  ═══════════════════════════════════════════════════════════ */

  const SESSION_KEY = "npc_pending_loop";
  const FRESH_JOURNEY_KEY = "npc_fresh_journey";
  const TEST_MODE_LS_KEY = "npc_test_mode";
  const TEST_START_LOOP_LS_KEY = "npc_test_start_loop";
  const MAX_TEST_LOOP_INDEX = 10;

  function getMaxLoopIndex() {
    try {
      if (window.NotebookConfig && typeof window.NotebookConfig.getFinalLoopIndex === "function") {
        const n = Number(window.NotebookConfig.getFinalLoopIndex());
        if (Number.isFinite(n) && n >= 1) return Math.floor(n);
      }
    } catch (_) { /* ignore */ }
    return MAX_TEST_LOOP_INDEX;
  }
  const NOTEBOOK_MOCK_BODY_DEL = [
    "今天又是这样的一天，我醒来还是不知道自己在哪。",
    "<del>也许这次会不一样</del>不对，我说过不能再这么想。",
    "我看见他们站在那里，脸熟得让人心慌，可我又叫不出名字。",
    "<del>我恨他们</del>不，我不知道自己在恨谁。",
    "如果还有一次机会，我想……",
  ].join("");

  const loopState = {
    currentLoopIndex: 1,
    lastLoopSummary: "",
    notebook: [],
    completedStageIds: [],  // Phase 2 新增：已完成的 stageId 列表（随 injectArchive hydrate）
  };

  // ──────────────────────────────────────────────────────────────
  // Phase 2：三路径级升级函数（§3.3）
  // 说明：v1 存档 loop_index 在不同写入路径下语义不同，必须分别处理
  // ──────────────────────────────────────────────────────────────

  function inferCompletedStageIds(resumeLoopIndex) {
    /* 推断 completed_stage_ids：所有 legacyLoopIndex < resumeLoopIndex 的 stage */
    if (!window.StageCatalog) return [];
    var all = window.StageCatalog.getAll();
    var result = [];
    all.forEach(function (e) {
      if (e.legacyLoopIndex < resumeLoopIndex) {
        result.push(e.stageId);
      }
    });
    return result;
  }

  /**
   * upgradePendingArchive — sessionStorage 路径（doStartNextLoop 写入）
   * 语义：raw.loop_index 已是"下一周目"（ending.js 写入时已 +1）= resume target
   * 父 agent 补丁1：若 resumeLoopIndex > MAX_LOOP_INDEX 返回 null
   */
  function upgradePendingArchive(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.archive_version === 2) return raw;  // 已是 v2，直接返回
    var resumeLoopIndex = Math.floor(Number(raw.loop_index));
    if (!Number.isFinite(resumeLoopIndex) || resumeLoopIndex < 1) return null;
    if (resumeLoopIndex > MAX_TEST_LOOP_INDEX) return null;  // 已是终局，返回 null
    var currentStageId = window.StageCatalog
      ? window.StageCatalog.fromLoopIndex(resumeLoopIndex)
      : null;
    if (!currentStageId) return null;
    var legacyLoopIndex = resumeLoopIndex;
    var completedStageIds = inferCompletedStageIds(resumeLoopIndex);
    return Object.assign({}, raw, {
      archive_version:     2,
      current_stage_id:    currentStageId,
      legacy_loop_index:   legacyLoopIndex,
      completed_stage_ids: completedStageIds,
    });
  }

  /**
   * upgradeExportArchive — 手动导入路径（用户导出的 JSON 文件）
   * 语义：raw.loop_index 是"已完成周目"，需 +1 才是 resume target
   * 父 agent 补丁1：若 resumeLoopIndex > MAX_LOOP_INDEX 返回 null
   */
  function upgradeExportArchive(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.archive_version === 2) return raw;  // 已是 v2，直接返回
    var completedLoopIndex = Math.floor(Number(raw.loop_index));
    if (!Number.isFinite(completedLoopIndex) || completedLoopIndex < 1) return null;
    var resumeLoopIndex = completedLoopIndex + 1;  // 必须 +1
    if (resumeLoopIndex > MAX_TEST_LOOP_INDEX) return null;  // 已是终局，返回 null
    var currentStageId;
    try {
      currentStageId = window.StageCatalog
        ? window.StageCatalog.fromLoopIndex(resumeLoopIndex)
        : null;
    } catch (e) {
      return null;
    }
    if (!currentStageId) return null;
    var legacyLoopIndex = resumeLoopIndex;
    // completed_stage_ids 包含所有 legacyLoopIndex <= completedLoopIndex 的 stage
    var completedStageIds = inferCompletedStageIds(resumeLoopIndex);
    return Object.assign({}, raw, {
      archive_version:     2,
      current_stage_id:    currentStageId,
      legacy_loop_index:   legacyLoopIndex,
      completed_stage_ids: completedStageIds,
    });
  }

  /**
   * upgradeRestoredArchive — 云端拉取存档路径（Phase 3 使用）
   * 语义：云端存档应已是 v2；历史上传的 v1 按 pending 语义处理（loop_index = resume target）
   */
  function upgradeRestoredArchive(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.archive_version === 2) return raw;  // 已是 v2，直接返回
    // v1 历史存档：按 upgradePendingArchive 同等处理
    return upgradePendingArchive(raw);
  }

  /* ─── notebook entry 归一化 ───────────────────────────────── */
  function normalizeNotebookEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const idx = Number(item.loopIndex);
      if (!Number.isFinite(idx)) return;
      out.push({
        loopIndex: idx,
        headerLabel: typeof item.headerLabel === "string" ? item.headerLabel : "",
        body: typeof item.body === "string" ? item.body : "",
        tonePreset: (item.tonePreset && typeof item.tonePreset === "object")
          ? item.tonePreset
          : {},
        generatedAt: typeof item.generatedAt === "string" ? item.generatedAt : "",
        source: typeof item.source === "string" ? item.source : "fallback",
        error: (typeof item.error === "string" || item.error === null) ? item.error : null,
      });
    });
    return out;
  }

  let loopSelectActive = true;

  /* ─── keydown capture 拦截器（阻断 intro-overlay 的 bubble 监听器） ── */
  /* 注意：此拦截器在 IIFE 执行时立即注册，早于内联 intro-overlay 脚本。  */
  /* capture:true 保证先于 bubble-phase 监听器触发，stopImmediatePropagation */
  /* 阻止同阶段后续监听器 AND 阻止事件向 bubble 阶段传播。                  */

  function keydownInterceptor(e) {
    if (!loopSelectActive) return;
    // 不拦截 textarea 内的键盘输入（粘贴存档框）
    if (e.target && e.target.tagName === "TEXTAREA") return;
    e.stopImmediatePropagation();
  }

  document.addEventListener("keydown", keydownInterceptor, true);

  /* ─── 释放拦截器（周目选择完成后调用） ──────────────────────── */
  function releaseInterceptor() {
    loopSelectActive = false;
    document.removeEventListener("keydown", keydownInterceptor, true);
  }

  /* 周目入口遮罩完全关闭后再刷新 intro 文案并启动 intro（避免加载时误用默认第 1 周目） */
  function notifyIntroReady() {
    if (typeof window.NPCOnLoopReady === "function") {
      window.NPCOnLoopReady();
    }
  }

  function finishLoopSelect() {
    releaseInterceptor();
    if (window.NPCNotebookUi && typeof window.NPCNotebookUi.syncPanelVisibility === "function") {
      try {
        window.NPCNotebookUi.syncPanelVisibility();
      } catch (_) { /* ignore */ }
    }
    notifyIntroReady();
  }

  /* ═══════════════════════════════════════════════════════════
     OVERLAY HELPERS
  ═══════════════════════════════════════════════════════════ */

  function createOverlay() {
    const ov = document.createElement("div");
    ov.id = "loop-select-overlay";
    document.body.appendChild(ov);
    return ov;
  }

  function dismissOverlay(ov, delay, onDone) {
    setTimeout(function () {
      var doneCalled = false;
      function fireDone() {
        if (doneCalled) return;
        doneCalled = true;
        if (onDone) onDone();
      }
      ov.classList.add("ls-fading");
      ov.addEventListener("transitionend", function onEnd(e) {
        if (e.target !== ov) return;
        ov.removeEventListener("transitionend", onEnd);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        fireDone();
      });
      // 防止 transitionend 因某些情况不触发时挂死
      setTimeout(function () {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        fireDone();
      }, 1200);
    }, delay);
  }

  /* ═══════════════════════════════════════════════════════════
     INJECTION  —  将 mutableSubconscious 注入角色
  ═══════════════════════════════════════════════════════════ */

  function injectArchive(archive) {
    if (!archive || !archive.characters) return;

    // 先清空当前局所有对话状态，避免跨轮状态残留（closingStreaks / dialogueHistories / candor）
    if (window.DialogueState && window.DialogueState.resetForNewLoop) {
      window.DialogueState.resetForNewLoop();
    }

    const chars = archive.characters;
    /* 当前周目编号：优先读 v2 存档的 legacy_loop_index；回退 loopState.currentLoopIndex；
       最后兜底 archive.loop_index（v1 兼容）。
       注意：injectArchive 只读取已升级好的字段，不做推断（父 agent 补丁2）。 */
    var loopIdx = Number(loopState.currentLoopIndex);
    if (!Number.isFinite(loopIdx) || loopIdx < 1) {
      if (archive.archive_version === 2 && typeof archive.legacy_loop_index === "number") {
        loopIdx = archive.legacy_loop_index;
      } else {
        loopIdx = Number(archive.loop_index);
      }
    }

    // Phase 2：hydrate completedStageIds（只读取已升级存档的字段，不推断）
    if (archive.archive_version === 2 && Array.isArray(archive.completed_stage_ids)) {
      loopState.completedStageIds = archive.completed_stage_ids.slice();
    } else {
      loopState.completedStageIds = [];
    }
    Object.keys(chars).forEach(function (charId) {
      const entry = chars[charId];
      if (!entry || !entry.mutableSubconscious) return;
      try {
        // 数据层注入（幂等：characters.js 内已将 systemPrompt 重写为 _originalSystemPrompt + patch）
        var staticPatch = (window.NPCLoopMemory && typeof window.NPCLoopMemory.getStaticPatchFor === "function")
          ? window.NPCLoopMemory.getStaticPatchFor(charId, loopIdx)
          : "";
        if (window.NPCConfig && window.NPCConfig.injectSubconscious) {
          window.NPCConfig.injectSubconscious(charId, entry.mutableSubconscious, { staticPatch: staticPatch });
        }
        // 对话层同步：从 baseCharacters 读取注入后的规范值，避免重复追加
        if (window.DialogueState && window.DialogueState.patchCharacter) {
          const patch = { mutableSubconscious: entry.mutableSubconscious };
          if (window.NPCConfig && window.NPCConfig.baseCharacters) {
            const basChar = window.NPCConfig.baseCharacters.find(function (c) {
              return c.id === charId;
            });
            if (basChar) {
              patch.systemPrompt = basChar.systemPrompt;
            }
          }
          window.DialogueState.patchCharacter(charId, patch);
        }
      } catch (err) {
        console.error("[loop.js] injectArchive error for", charId, err);
      }
    });

    loopState.lastLoopSummary = archive.summary || "";
    loopState.notebook = normalizeNotebookEntries(archive.notebook);
  }

  /* ═══════════════════════════════════════════════════════════
     AUTO IMPORT  —  sessionStorage 自动导入路径
  ═══════════════════════════════════════════════════════════ */

  function tryAutoImport() {
    var raw = null;
    try {
      raw = sessionStorage.getItem(SESSION_KEY);
    } catch (_) {}

    if (!raw) return false;

    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}

    var archive = null;
    try {
      archive = JSON.parse(raw);
    } catch (_) {
      return false;
    }

    if (!archive || typeof archive.loop_index !== "number") return false;

    // Phase 2：升级 v1 存档（pending 语义：loop_index 已是下一周目，不 +1）
    var upgraded = upgradePendingArchive(archive);
    if (!upgraded) {
      // upgradePendingArchive 返回 null：已是终局或数据异常
      return false;
    }

    const maxLoop = getMaxLoopIndex();
    // v2 存档优先读 legacy_loop_index；v1 存档读原 loop_index
    var nextLoop;
    if (upgraded.archive_version === 2 && typeof upgraded.legacy_loop_index === "number") {
      nextLoop = Math.floor(upgraded.legacy_loop_index);
    } else {
      nextLoop = Math.floor(upgraded.loop_index);
    }
    if (!Number.isFinite(nextLoop) || nextLoop < 1) return false;
    if (nextLoop > maxLoop) nextLoop = maxLoop;
    loopState.currentLoopIndex = nextLoop;
    injectArchive(upgraded);

    // 显示「记忆已延续」提示，1.5s 后自动进入 intro
    var ov = createOverlay();
    var wrap = document.createElement("div");
    wrap.className = "ls-options";
    var msg = document.createElement("p");
    msg.className = "ls-auto-msg";
    msg.textContent = "— 记忆已延续 · 第 " + loopState.currentLoopIndex + " 周目 —";
    wrap.appendChild(msg);
    ov.appendChild(wrap);

    dismissOverlay(ov, 1500, finishLoopSelect);
    return true;
  }

  /* ═══════════════════════════════════════════════════════════
     TEST LOOP JUMP  —  测试模式直接跳转周目
  ═══════════════════════════════════════════════════════════ */

  function isTestModeEnabled() {
    try {
      return localStorage.getItem(TEST_MODE_LS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function readLastTestStartLoop() {
    try {
      const raw = localStorage.getItem(TEST_START_LOOP_LS_KEY);
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1 && n <= MAX_TEST_LOOP_INDEX) return n;
    } catch (_) {}
    return 2;
  }

  function rememberTestStartLoop(loopIndex) {
    try {
      localStorage.setItem(TEST_START_LOOP_LS_KEY, String(loopIndex));
    } catch (_) {}
  }

  function buildTestNotebookBody(loopIndex) {
    /* 优先用 LoopScript 周目剧本占位文案 */
    try {
      if (window.LoopScript && typeof window.LoopScript.getTestNotebookBody === "function") {
        const body = window.LoopScript.getTestNotebookBody(loopIndex);
        if (typeof body === "string" && body.trim().length > 0) return body;
      }
    } catch (_) { /* ignore */ }
    if (loopIndex === 7 || loopIndex === 8) return NOTEBOOK_MOCK_BODY_DEL;
    return "[测试占位] 第 " + loopIndex + " 周目日记（跳过真实游玩）。";
  }

  function buildTestNotebookEntries(targetLoopIndex) {
    const entries = [];
    const maxPrev = Math.min(Number(targetLoopIndex) - 1, MAX_TEST_LOOP_INDEX);
    if (!Number.isFinite(maxPrev) || maxPrev < 1) return entries;

    for (let i = 1; i <= maxPrev; i++) {
      let tone = {};
      if (window.NotebookConfig && typeof window.NotebookConfig.getTonePresetFor === "function") {
        tone = window.NotebookConfig.getTonePresetFor(i) || {};
      }
      entries.push({
        loopIndex: i,
        headerLabel: tone.headerLabel || ("第 " + i + " 次轮回"),
        body: buildTestNotebookBody(i),
        tonePreset: {
          emotion: tone.emotion || "",
          memoryLevel: tone.memoryLevel || "",
          infoSnippet: tone.infoSnippet || "",
          headerLabel: tone.headerLabel || "",
        },
        generatedAt: new Date().toISOString(),
        source: "mock",
        error: null,
      });
    }
    return entries;
  }

  function buildTestCharactersArchive(targetLoopIndex) {
    const chars = {};
    const base = (window.NPCConfig && window.NPCConfig.baseCharacters)
      ? window.NPCConfig.baseCharacters
      : [];
    const dejaVu = Math.min(Math.max(Number(targetLoopIndex) - 1, 0), 6);

    base.forEach(function (c) {
      if (!c || !c.id) return;
      chars[c.id] = {
        immutableCore: {
          id: c.id,
          name: c.name || c.id,
          targetColor: c.targetColor || "#000000",
          candorRates: c.candorRates || { rise: 1, fall: 1 },
        },
        mutableSubconscious: {
          dejaVuLevel: dejaVu,
          subconsciousImpression:
            "[测试] 跳转至第 " + targetLoopIndex + " 周目，模拟前世印象。",
          thresholdAdjustment: "",
          nextLoopPromptPatch:
            "[测试周目] 你隐约觉得眼前这个人并非第一次出现在这条街上。",
        },
      };
    });
    return chars;
  }

  function buildTestJumpArchive(targetLoopIndex) {
    return {
      loop_index: targetLoopIndex - 1,
      ran_at: new Date().toISOString(),
      characters: buildTestCharactersArchive(targetLoopIndex),
      summary: "[测试] 直接跳转至第 " + targetLoopIndex + " 周目",
      notebook: buildTestNotebookEntries(targetLoopIndex),
    };
  }

  function applyTestLoopJump(targetLoopIndex, onDone) {
    const idx = Number(targetLoopIndex);
    if (!Number.isFinite(idx) || idx < 1 || idx > MAX_TEST_LOOP_INDEX) return false;

    loopState.currentLoopIndex = idx;
    injectArchive(buildTestJumpArchive(idx));
    rememberTestStartLoop(idx);
    if (onDone) onDone();
    return true;
  }

  /* ═══════════════════════════════════════════════════════════
     MANUAL SELECT  —  手动周目选择界面
  ═══════════════════════════════════════════════════════════ */

  function buildPreviewHtml(archive) {
    if (!archive || !archive.characters) return "";
    var lines = [];
    Object.keys(archive.characters).forEach(function (charId) {
      var entry = archive.characters[charId];
      if (!entry) return;
      var core = entry.immutableCore || {};
      var sub  = entry.mutableSubconscious || {};
      var name = core.name || charId;
      var lvl  = sub.dejaVuLevel !== undefined ? sub.dejaVuLevel : "—";
      var imp  = sub.subconsciousImpression ? sub.subconsciousImpression.slice(0, 30) : "（空）";
      lines.push(name + "  似曾相识值 " + lvl + "　" + imp);
    });
    return lines.join("\n");
  }

  function showManualSelect() {
    var ov = createOverlay();

    /* ── 初始两选项 ── */
    var optionsWrap = document.createElement("div");
    optionsWrap.className = "ls-options";

    var title = document.createElement("p");
    title.className = "ls-title";
    title.textContent = "你站在这条街上。";
    optionsWrap.appendChild(title);

    var optA = document.createElement("button");
    optA.className = "ls-option";
    optA.textContent = "开启新的旅程";

    var optB = document.createElement("button");
    optB.className = "ls-option ls-option--dim";
    optB.textContent = "继续上一段记忆";

    optionsWrap.appendChild(optA);
    optionsWrap.appendChild(optB);

    var optC = null;
    if (isTestModeEnabled()) {
      optC = document.createElement("button");
      optC.className = "ls-option ls-option--dim ls-option--test";
      optC.textContent = "测试：跳转到指定周目";
      optionsWrap.appendChild(optC);
    }

    ov.appendChild(optionsWrap);

    /* ── 测试周目选择区（隐藏，点 C 后显示） ── */
    var testBox = document.createElement("div");
    testBox.className = "ls-import-box ls-import-box--hidden";

    var testLabel = document.createElement("p");
    testLabel.className = "ls-status";
    testLabel.textContent = "选择要测试的周目（1–10）：";

    var testRow = document.createElement("div");
    testRow.className = "ls-test-row";

    var testSelect = document.createElement("select");
    testSelect.className = "ls-select";
    testSelect.setAttribute("aria-label", "测试周目");
    for (var ti = 1; ti <= MAX_TEST_LOOP_INDEX; ti++) {
      var testOpt = document.createElement("option");
      testOpt.value = String(ti);
      testOpt.textContent = "第 " + ti + " 周目";
      if (ti === readLastTestStartLoop()) testOpt.selected = true;
      testSelect.appendChild(testOpt);
    }

    var testConfirmBtn = document.createElement("button");
    testConfirmBtn.className = "ls-confirm-btn";
    testConfirmBtn.textContent = "进入该周目";

    var testHint = document.createElement("p");
    testHint.className = "ls-status ls-status--test";
    testHint.textContent = "将注入模拟前世记忆与笔记本；上次选择会记住。";

    testRow.appendChild(testSelect);
    testRow.appendChild(testConfirmBtn);
    testBox.appendChild(testLabel);
    testBox.appendChild(testRow);
    testBox.appendChild(testHint);
    ov.appendChild(testBox);

    var importBox = document.createElement("div");
    importBox.className = "ls-import-box ls-import-box--hidden";

    var importLabel = document.createElement("p");
    importLabel.className = "ls-status";

    var importHint = document.createElement("p");
    importHint.className = "ls-status ls-status--test";

    var importBtnRow = document.createElement("div");
    importBtnRow.className = "ls-options";

    var importBackBtn = document.createElement("button");
    importBackBtn.className = "ls-confirm-btn";
    importBackBtn.textContent = "返回";

    importBtnRow.appendChild(importBackBtn);

    importBox.appendChild(importLabel);
    importBox.appendChild(importHint);
    importBox.appendChild(importBtnRow);
    ov.appendChild(importBox);

    /* ── 选项 A：新的旅程 ── */
    optA.addEventListener("click", function () {
      loopState.currentLoopIndex = 1;
      dismissOverlay(ov, 0, finishLoopSelect);
    });

    /* ── 选项 B：继续记忆 → 从本地日志续接 ── */
    optB.addEventListener("click", function () {
      optionsWrap.style.display = "none";
      testBox.classList.add("ls-import-box--hidden");
      importBox.classList.remove("ls-import-box--hidden");
      resetLogRestoreUi();
      runLogRestore();
    });

    /* ── 选项 C：测试跳转 ── */
    if (optC) {
      optC.addEventListener("click", function () {
        optionsWrap.style.display = "none";
        importBox.classList.add("ls-import-box--hidden");
        testBox.classList.remove("ls-import-box--hidden");
      });
    }

    testConfirmBtn.addEventListener("click", function () {
      var target = Number(testSelect.value);
      if (!applyTestLoopJump(target, null)) return;

      testBox.style.display = "none";
      var previewWrap = document.createElement("div");
      previewWrap.className = "ls-options";

      var previewTitle = document.createElement("p");
      previewTitle.className = "ls-status";
      previewTitle.textContent = "第 " + target + " 周目 · 测试跳转已载入";

      var previewPre = document.createElement("pre");
      previewPre.className = "ls-preview";
      previewPre.textContent = buildPreviewHtml(buildTestJumpArchive(target));

      previewWrap.appendChild(previewTitle);
      previewWrap.appendChild(previewPre);
      ov.appendChild(previewWrap);

      dismissOverlay(ov, 1500, finishLoopSelect);
    });

    /* ── 日志续接：UI 复位 ── */
    function resetLogRestoreUi() {
      importLabel.textContent = "正在读取本地日志……";
      importHint.textContent = "";
      importBackBtn.style.display = "none";
    }

    /* ── 日志续接：主流程（自动 API → 静态 logs/*.ndjson） ── */
    async function runLogRestore() {
      if (!window.LogRestore || typeof window.LogRestore.resolveLatestRestore !== "function") {
        importLabel.textContent = "日志续接模块未加载，无法继续。";
        importBackBtn.style.display = "";
        return;
      }
      var result = null;
      try {
        result = await window.LogRestore.resolveLatestRestore();
      } catch (restoreErr) {
        console.warn("[loop] log restore failed", restoreErr);
      }
      if (!result || !result.archive || !result.targetLoopIndex) {
        importLabel.textContent = "未找到可用的日志记忆。";
        importHint.textContent = "请确认「一键启动.bat」已运行，或返回开启新的旅程。";
        importBackBtn.style.display = "";
        return;
      }
      applyRestoreResult(result);
    }

    /* ── 日志续接：把重建出的 archive 写入 sessionStorage 后 reload，
       由 LoopState.start → tryAutoImport 完成自动续档显示 ── */
    function applyRestoreResult(result) {
      try {
        if (window.AuditLog &&
            typeof window.AuditLog.applySessionId === "function" &&
            result.sessionId) {
          window.AuditLog.applySessionId(result.sessionId);
        }
      } catch (sessionErr) {
        console.warn("[loop] applySessionId failed", sessionErr);
      }
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(result.archive));
      } catch (storageErr) {
        console.warn("[loop] sessionStorage write failed", storageErr);
        importLabel.textContent = "本地存储不可用，无法续接。";
        importHint.textContent = "";
        importBackBtn.style.display = "";
        return;
      }
      importLabel.textContent = "第 " + result.targetLoopIndex + " 周目 · 记忆已就绪";
      importHint.textContent = "正在载入……";
      setTimeout(function () {
        location.reload();
      }, 600);
    }

    /* ── 返回：回到初始两选项 ── */
    importBackBtn.addEventListener("click", function () {
      importBox.classList.add("ls-import-box--hidden");
      optionsWrap.style.display = "";
      resetLogRestoreUi();
    });
  }

  /* ═══════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════ */

  function tryFreshJourney() {
    var flag = null;
    try {
      flag = sessionStorage.getItem(FRESH_JOURNEY_KEY);
    } catch (_) {}
    if (flag !== "1") return false;
    try {
      sessionStorage.removeItem(FRESH_JOURNEY_KEY);
    } catch (_) {}
    loopState.currentLoopIndex = 1;
    loopState.lastLoopSummary = "";
    loopState.notebook = [];
    finishLoopSelect();
    return true;
  }

  // Phase 3：将启动逻辑封装进 start()，由登录流程显式调用，不再自动执行（R-21）
  function start() {
    if (tryFreshJourney()) return;
    var autoImported = tryAutoImport();
    if (!autoImported) {
      showManualSelect();
    }
  }

  // Phase 3：不再立即执行 init()；start() 由外部登录完成后显式调用

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════ */

  window.LoopState = {
    getLoopIndex: function () { return loopState.currentLoopIndex; },
    // Phase 1 新增：将当前 loopIndex 转为 stageId（依赖 StageCatalog，未加载时返回 null）
    getStageId: function () {
      return window.StageCatalog
        ? window.StageCatalog.fromLoopIndex(loopState.currentLoopIndex)
        : null;
    },
    // Phase 2 新增：终局推进时将当前 stage 推入 completedStageIds
    appendCompletedStage: function () {
      var stageId = window.StageCatalog
        ? window.StageCatalog.fromLoopIndex(loopState.currentLoopIndex)
        : null;
      if (stageId && loopState.completedStageIds.indexOf(stageId) === -1) {
        loopState.completedStageIds.push(stageId);
      }
    },
    getCompletedStageIds: function () { return loopState.completedStageIds.slice(); },
    // Phase 2：暴露升级函数供云端恢复路径（Phase 3 SaveAdapter）使用
    upgradeRestoredArchive: function (raw) { return upgradeRestoredArchive(raw); },
    // Phase 3 新增：登录完成后显式调用 start()（R-21 反竞态）
    start: start,
    jumpToTestLoop: function (loopIndex) {
      return applyTestLoopJump(loopIndex, null);
    },
    getLastLoopSummary: function () { return loopState.lastLoopSummary; },
    /* notebook 接口（F-004a） */
    getNotebookEntries: function () {
      // 返回浅拷贝数组，防止外部直接 mutate
      return loopState.notebook.slice();
    },
    appendNotebookEntry: function (entry) {
      if (!entry || typeof entry !== "object") return;
      // 复用归一化器保证字段一致
      const normalized = normalizeNotebookEntries([entry]);
      if (normalized.length === 0) return;
      loopState.notebook.push(normalized[0]);
    },
    /* F-004c：AI 真生成成功后，用真实 entry 替换最后一条 fallback 占位。
       仅当 entry.loopIndex 与最后一条相同（或最后一条 loopIndex 缺失）时替换；
       否则视为竞态保护失败，回落为 append。                              */
    replaceLastNotebookEntry: function (entry) {
      if (!entry || typeof entry !== "object") return;
      const normalized = normalizeNotebookEntries([entry]);
      if (normalized.length === 0) return;
      const last = loopState.notebook[loopState.notebook.length - 1];
      if (last && Number(last.loopIndex) === Number(normalized[0].loopIndex)) {
        loopState.notebook[loopState.notebook.length - 1] = normalized[0];
      } else {
        loopState.notebook.push(normalized[0]);
      }
    },
  };
})();

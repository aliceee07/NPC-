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
  };

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
    Object.keys(chars).forEach(function (charId) {
      const entry = chars[charId];
      if (!entry || !entry.mutableSubconscious) return;
      try {
        // 数据层注入（幂等：characters.js 内已将 systemPrompt 重写为 _originalSystemPrompt + patch）
        if (window.NPCConfig && window.NPCConfig.injectSubconscious) {
          window.NPCConfig.injectSubconscious(charId, entry.mutableSubconscious);
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

    const maxLoop = getMaxLoopIndex();
    let nextLoop = Math.floor(archive.loop_index);
    if (!Number.isFinite(nextLoop) || nextLoop < 1) return false;
    if (nextLoop > maxLoop) nextLoop = maxLoop;
    loopState.currentLoopIndex = nextLoop;
    injectArchive(archive);

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
    importLabel.textContent = "粘贴上一轮导出的存档 JSON：";

    var textarea = document.createElement("textarea");
    textarea.className = "ls-textarea";
    textarea.rows = 6;
    textarea.placeholder = '{ "loop_index": 1, "characters": { ... } }';

    var confirmBtn = document.createElement("button");
    confirmBtn.className = "ls-confirm-btn";
    confirmBtn.textContent = "确认导入";

    var statusMsg = document.createElement("p");
    statusMsg.className = "ls-status";
    statusMsg.textContent = "";

    importBox.appendChild(importLabel);
    importBox.appendChild(textarea);
    importBox.appendChild(confirmBtn);
    importBox.appendChild(statusMsg);
    ov.appendChild(importBox);

    /* ── 选项 A：新的旅程 ── */
    optA.addEventListener("click", function () {
      loopState.currentLoopIndex = 1;
      dismissOverlay(ov, 0, finishLoopSelect);
    });

    /* ── 选项 B：继续记忆 → 展示导入区 ── */
    optB.addEventListener("click", function () {
      optionsWrap.style.display = "none";
      testBox.classList.add("ls-import-box--hidden");
      importBox.classList.remove("ls-import-box--hidden");
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

    /* ── 确认导入 ── */
    confirmBtn.addEventListener("click", function () {
      var raw = textarea.value.trim();
      if (!raw) {
        statusMsg.textContent = "内容为空，请粘贴存档 JSON。";
        return;
      }

      var archive = null;
      try {
        archive = JSON.parse(raw);
      } catch (_) {
        archive = null;
      }

      if (!archive || typeof archive.loop_index !== "number" || !archive.characters) {
        // 解析失败
        statusMsg.textContent = "记忆已损坏，只能重新开始。";
        setTimeout(function () {
          loopState.currentLoopIndex = 1;
          dismissOverlay(ov, 0, finishLoopSelect);
        }, 2000);
        return;
      }

      // 注入数据（loop_index 为已完成周目，下一 playable = +1）
      var maxLoop = getMaxLoopIndex();
      var nextLoop = archive.loop_index + 1;
      if (!Number.isFinite(nextLoop) || nextLoop < 1) {
        statusMsg.textContent = "记忆已损坏，只能重新开始。";
        setTimeout(function () {
          loopState.currentLoopIndex = 1;
          dismissOverlay(ov, 0, finishLoopSelect);
        }, 2000);
        return;
      }
      if (nextLoop > maxLoop) {
        statusMsg.textContent = "已是第十次轮回的尽头，请从第一周目重新开始。";
        return;
      }
      loopState.currentLoopIndex = nextLoop;
      injectArchive(archive);

      // 显示 3s 预览
      importBox.style.display = "none";
      var previewWrap = document.createElement("div");
      previewWrap.className = "ls-options";

      var previewTitle = document.createElement("p");
      previewTitle.className = "ls-status";
      previewTitle.textContent = "第 " + loopState.currentLoopIndex + " 周目 · 记忆已载入";

      var previewPre = document.createElement("pre");
      previewPre.className = "ls-preview";
      previewPre.textContent = buildPreviewHtml(archive);

      previewWrap.appendChild(previewTitle);
      previewWrap.appendChild(previewPre);
      ov.appendChild(previewWrap);

      dismissOverlay(ov, 3000, finishLoopSelect);
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

  (function init() {
    if (tryFreshJourney()) return;
    var autoImported = tryAutoImport();
    if (!autoImported) {
      showManualSelect();
    }
  })();

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════ */

  window.LoopState = {
    getLoopIndex: function () { return loopState.currentLoopIndex; },
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

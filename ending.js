(function () {
  const DialogueState = window.DialogueState;

  const endingState = {
    triggered: false,
    stage1Results: {},
    stage2Results: {},
    stage3Results: {},
    dialogueSnapshot: null,
    loopSummary: null,       // 轮回记忆整理（原 summary；写入 archive.summary 与日记 prompt，不在尾声页展示）
  };

  let endingAbortController = null;
  let endingPostStagePromise = null;
  let loopTransitionStarted = false;

  const NOTEBOOK_WAIT_TIMEOUT_MS = 90000;
  const LOOP_TRANSITION_HINTS = [
    "记忆正在沉淀……",
    "街道在褪色……",
    "又一次轮回即将开始……",
    "笔记本上的字迹渐渐清晰……",
  ];

  function isAbortError(err) {
    return !!err && (err.name === "AbortError" || err.code === 20);
  }

  function createEndingController() {
    if (endingAbortController) {
      endingAbortController.abort();
    }
    endingAbortController = new AbortController();
    return endingAbortController;
  }

  function abortEndingRequests(reason) {
    if (!endingAbortController) return;
    console.log(`[abort] ending requests cancelled by ${reason || "unknown"}`);
    endingAbortController.abort();
    endingAbortController = null;
  }

  function isNpcTestMode() {
    try {
      return localStorage.getItem("npc_test_mode") === "1";
    } catch (_) {
      return false;
    }
  }

  function getEndingApiProvider() {
    const el = document.getElementById("api-provider-select");
    return (el ? el.value : "") || window.AI_PROVIDER || "gemini";
  }

  function hasRealApiKeyForEnding() {
    const el = document.getElementById("api-key-input");
    const inputVal = el ? el.value.trim() : "";
    if (inputVal) return true;
    return getEndingApiProvider() === "siliconflow"
      ? !!(window.SILICONFLOW_PRESET_KEY || "")
      : !!(window.GEMINI_PRESET_KEY || "");
  }

  /** 真实 API 路线：需等日记生成完成再允许进入下一轮，避免 abort 后只剩 fallback。 */
  function shouldGateNextLoopOnNotebook() {
    return !isNpcTestMode() && hasRealApiKeyForEnding();
  }

  function isCurrentLoopNotebookReady() {
    if (!window.LoopState || typeof window.LoopState.getNotebookEntries !== "function") {
      return true;
    }
    let entries = [];
    try {
      entries = window.LoopState.getNotebookEntries();
    } catch (_) {
      return true;
    }
    const last = entries[entries.length - 1];
    if (!last) return true;
    const loopIndex = (typeof window.LoopState.getLoopIndex === "function")
      ? window.LoopState.getLoopIndex()
      : 1;
    if (last.loopIndex !== loopIndex) return true;
    if (last.source === "ai" || last.source === "mock") return true;
    if (typeof last.body === "string" && last.body.trim().length > 0) return true;
    return false;
  }

  /* ═══════════════════════════════════════════════════════════
     QUEUE  —  4 entries, one per screen:
       0: phase 1 (slots fill reactively as API returns)
       1: phase 2 (same)
       2: phase 3 (same)
       3: epilogue
     All entries are pushed immediately so the user can page
     forward even before API results arrive; slots update in-place.
  ═══════════════════════════════════════════════════════════ */

  const queue  = [];
  let   cursor = -1;

  function enqueue(data) { queue.push({ data }); }

  function setProgress(f) {
    const el = document.getElementById("eo-progress-fill");
    if (el) el.style.width = Math.max(0, Math.min(1, f) * 100) + "%";
  }

  /* ─── Advance (click or timer) ─────────────────────────────── */

  function advance() {
    const current = queue[cursor];
    if (current && current.data.type === "phase" && current.data.showNpcSlots === false) {
      /* 纯叙述阶段，无需等待 NPC */
    } else if (current && current.data.slots && current.data.slots.length > 0) {
      const slots = current.data.slots;
      const readyCount = slots.filter((s) => s.ready).length;
      const allReady = slots.every((s) => s.ready);
      if (!allReady) {
        setHint(`正在等待回复…（已完成 ${readyCount}/3）`);
        setProgress(readyCount / 3);
        return;
      }
    }
    const next = cursor + 1;
    if (next >= queue.length) return;
    cursor = next;
    renderEntry(queue[next].data);
  }

  /* ═══════════════════════════════════════════════════════════
     REACTIVE SLOTS  —  characters within a phase
  ═══════════════════════════════════════════════════════════ */

  function makeSlot(c, action, line, ready) {
    return {
      charId: c.id, name: c.name || c.id,
      color: getColor(c),
      ready: !!ready,
      action: action || null,
      line:   line   || null,
      domEl:  null,
    };
  }

  /* Called when an API result arrives; updates slot DOM in-place */
  function fillSlot(slot, action, line) {
    slot.ready  = true;
    slot.action = action;
    slot.line   = line;
    if (!slot.domEl) {
      refreshEndingFooter();
      return;
    }

    const actionEl = slot.domEl.querySelector(".eo-slot-action");
    const lineEl   = slot.domEl.querySelector(".eo-slot-line");

    if (actionEl) {
      actionEl.style.opacity = "0";
      setTimeout(() => {
        actionEl.textContent = action || "";
        actionEl.style.opacity = "1";
        actionEl.classList.remove("eo-loading-shimmer");
      }, 200);
    }
    if (lineEl) {
      setTimeout(() => {
        lineEl.textContent = line ? `「${line}」` : "";
      }, 220);
    }
    slot.domEl.classList.replace("eo-slot-loading", "eo-slot-filled");
    refreshEndingFooter();
  }

  /* ═══════════════════════════════════════════════════════════
     OVERLAY  &  RENDERING
  ═══════════════════════════════════════════════════════════ */

  function createOverlay() {
    const ov = document.createElement("div");
    ov.id = "ending-overlay";
    ov.innerHTML = `
      <div class="eo-body">
        <div class="eo-slot" id="eo-slot"></div>
      </div>
      <footer class="eo-footer">
        <div class="eo-progress-track">
          <div class="eo-progress-fill" id="eo-progress-fill"></div>
        </div>
        <div class="eo-hint" id="eo-hint">点击任意位置继续</div>
      </footer>`;

    document.body.appendChild(ov);

    ov.addEventListener("click", (e) => {
      if (e.target.closest(".eo-actions")) return;
      if (e.target.closest(".eo-btn-retry")) return;
      if (e.target.closest("#eo-loop-transition")) return;
      const cur = queue[cursor];
      if (cur && cur.data.type === "epilogue") {
        if (!isOnFinalLoop() && !loopTransitionStarted) {
          beginNextLoopTransition();
        }
        return;
      }
      advance();
    });

    requestAnimationFrame(() => ov.classList.add("eo-visible"));
    return ov;
  }

  function setHint(text) {
    const el = document.getElementById("eo-hint");
    if (el) el.textContent = text;
  }

  function refreshEndingFooter() {
    const cur = queue[cursor];
    if (!cur || cur.data.type !== "phase") {
      return;
    }
    if (cur.data.showNpcSlots === false) {
      setHint("点击任意位置继续 →");
      setProgress(1);
      return;
    }
    const slots = cur.data.slots;
    if (!slots || slots.length === 0) {
      setHint("点击任意位置继续 →");
      setProgress(1);
      return;
    }
    const readyCount = slots.filter((s) => s.ready).length;
    const allReady = slots.every((s) => s.ready);
    if (!allReady) {
      setHint(`正在等待回复…（已完成 ${readyCount}/3）`);
      setProgress(readyCount / 3);
    } else {
      setHint("点击任意位置继续 →");
      setProgress(1);
    }
  }

  /* Swap content with fade */
  function renderEntry(data) {
    const slotEl = document.getElementById("eo-slot");
    if (!slotEl) return;

    slotEl.classList.add("eo-out");
    setTimeout(() => {
      slotEl.innerHTML = "";
      const child = data.type === "phase"    ? buildPhaseEl(data)
                  : data.type === "epilogue" ? buildEpilogueEl(data)
                  : null;
      if (child) slotEl.appendChild(child);
      slotEl.classList.remove("eo-out");
      slotEl.classList.add("eo-in");
      setTimeout(() => slotEl.classList.remove("eo-in"), 500);
      if (data.type === "phase") {
        refreshEndingFooter();
      } else {
        if (isOnFinalLoop()) {
          setHint("选择下方操作，或翻阅笔记本");
        } else {
          setHint("点击任意位置，进入下一轮轮回");
        }
        setProgress(0);
      }
    }, 220);

  }

  /* ─── Phase screen ─────────────────────────────────────────── */

  function buildPhaseEl(data) {
    const wrap = document.createElement("div");
    wrap.className = "eo-phase";

    // Stage header
    const hdr = document.createElement("div");
    hdr.className = "eo-phase-header";
    hdr.innerHTML =
      `<div class="eo-phase-num">${data.label}</div>` +
      `<div class="eo-phase-desc">${data.desc}</div>`;
    wrap.appendChild(hdr);

    if (data.showNpcSlots !== false) {
      const slots = data.slots || [];
      if (slots.length > 0) {
        const slotsWrap = document.createElement("div");
        slotsWrap.className = "eo-char-slots";
        slots.forEach((slot) => {
          const el = buildSlotEl(slot);
          slot.domEl = el;
          slotsWrap.appendChild(el);
        });
        wrap.appendChild(slotsWrap);
      }
    }

    return wrap;
  }

  function buildSlotEl(slot) {
    const el = document.createElement("div");
    el.className = "eo-char-slot " + (slot.ready ? "eo-slot-filled" : "eo-slot-loading");

    const dot = document.createElement("div");
    dot.className = "eo-slot-dot";
    dot.style.backgroundColor = slot.color;

    const body = document.createElement("div");
    body.className = "eo-slot-body";

    const name = document.createElement("div");
    name.className = "eo-slot-name";
    name.textContent = slot.name;

    const action = document.createElement("div");
    action.className = "eo-slot-action" + (slot.ready ? "" : " eo-loading-shimmer");
    action.style.transition = "opacity 200ms ease";
    action.textContent = slot.ready ? (slot.action || "") : "";

    const line = document.createElement("div");
    line.className = "eo-slot-line";
    line.textContent = (slot.ready && slot.line) ? `「${slot.line}」` : "";

    body.appendChild(name);
    body.appendChild(action);
    body.appendChild(line);
    el.appendChild(dot);
    el.appendChild(body);
    return el;
  }

  /* ─── Epilogue screen ──────────────────────────────────────── */

  function buildEpilogueEl(data) {
    const wrap = document.createElement("div");
    wrap.className = "eo-epilogue-screen";

    const title = document.createElement("div");
    title.className = "eo-epilogue-title";
    title.textContent = data.label;
    wrap.appendChild(title);

    const onFinalLoop = isOnFinalLoop();
    if (onFinalLoop) {
      const leaveHint = document.createElement("p");
      leaveHint.className = "eo-final-leave-hint";
      leaveHint.textContent = "似乎留下了什么。";
      wrap.appendChild(leaveHint);
    } else {
      const nextHint = document.createElement("p");
      nextHint.className = "eo-next-loop-hint";
      nextHint.textContent = "点击屏幕，进入下一轮轮回";
      wrap.appendChild(nextHint);
    }

    const actions = document.createElement("div");
    actions.className = "eo-actions";

    const gateNotebook = shouldGateNextLoopOnNotebook();
    let notebookStatus = null;

    if (onFinalLoop) {
      const openNotebookBtn = document.createElement("button");
      openNotebookBtn.className = "eo-btn";
      openNotebookBtn.id = "eo-open-notebook-btn";
      openNotebookBtn.textContent = "打开笔记本";
      openNotebookBtn.addEventListener("click", () => {
        if (gateNotebook && !isCurrentLoopNotebookReady()) {
          if (notebookStatus) {
            notebookStatus.textContent = "日记仍在记录中，请稍候片刻再打开。";
          }
          return;
        }
        openNotebookFromEnding();
      });

      const playAgainBtn = document.createElement("button");
      playAgainBtn.className = "eo-btn eo-btn-secondary";
      playAgainBtn.textContent = "再玩一次";
      playAgainBtn.addEventListener("click", doPlayAgain);

      if (gateNotebook) {
        notebookStatus = document.createElement("p");
        notebookStatus.className = "eo-notebook-status";
        notebookStatus.id = "eo-notebook-status";

        var hourglassElFinal = document.createElement("span");
        hourglassElFinal.className = "eo-hourglass-anim";
        hourglassElFinal.setAttribute("aria-hidden", "true");
        hourglassElFinal.textContent = "⏳";
        notebookStatus.appendChild(hourglassElFinal);

        var statusTextFinal = document.createElement("span");
        statusTextFinal.className = "eo-notebook-status-text";
        statusTextFinal.textContent = "写存档中请不要离开……";
        notebookStatus.appendChild(statusTextFinal);

        actions.appendChild(notebookStatus);
        openNotebookBtn.disabled = true;
        void waitForNotebookThenEnable(openNotebookBtn, notebookStatus, {
          ready: "存档完成，笔记本已记下全部轮回，点击「打开」翻阅。",
          partial: "日记仍有些模糊",
          retryCallGemini: DialogueState && DialogueState.callGemini,
        });
      }

      actions.appendChild(openNotebookBtn);
      actions.appendChild(playAgainBtn);
      wrap.appendChild(actions);
    }

    return wrap;
  }

  function showLoopTransitionOverlay() {
    const ov = document.getElementById("ending-overlay");
    if (!ov || document.getElementById("eo-loop-transition")) return;

    const layer = document.createElement("div");
    layer.id = "eo-loop-transition";
    layer.className = "eo-loop-transition";
    layer.setAttribute("role", "status");
    layer.setAttribute("aria-live", "polite");

    const glow = document.createElement("div");
    glow.className = "eo-loop-transition-glow";
    layer.appendChild(glow);

    const ring = document.createElement("div");
    ring.className = "eo-loop-transition-ring";
    layer.appendChild(ring);

    const hourglass = document.createElement("div");
    hourglass.className = "eo-loop-transition-hourglass eo-hourglass-anim";
    hourglass.setAttribute("aria-hidden", "true");
    hourglass.textContent = "⏳";
    layer.appendChild(hourglass);

    const status = document.createElement("p");
    status.className = "eo-loop-transition-status";
    status.id = "eo-loop-transition-status";
    status.textContent = "写存档中请不要离开……";
    layer.appendChild(status);

    const hint = document.createElement("p");
    hint.className = "eo-loop-transition-hint";
    hint.id = "eo-loop-transition-hint";
    hint.textContent = LOOP_TRANSITION_HINTS[0];
    layer.appendChild(hint);

    ov.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add("eo-loop-transition-visible"));

    let hintIdx = 0;
    const hintTimer = setInterval(() => {
      if (!document.getElementById("eo-loop-transition-hint")) {
        clearInterval(hintTimer);
        return;
      }
      hintIdx = (hintIdx + 1) % LOOP_TRANSITION_HINTS.length;
      hint.textContent = LOOP_TRANSITION_HINTS[hintIdx];
    }, 2400);

    layer._hintTimer = hintTimer;
  }

  function setLoopTransitionStatus(text) {
    const el = document.getElementById("eo-loop-transition-status");
    if (el) el.textContent = text;
  }

  function beginNextLoopTransition() {
    if (loopTransitionStarted) return;
    loopTransitionStarted = true;

    const ov = document.getElementById("ending-overlay");
    if (ov) ov.classList.add("eo-loop-transition-active");

    const actions = document.querySelector("#ending-overlay .eo-actions");
    if (actions) actions.style.visibility = "hidden";

    setHint("");
    const progressFill = document.getElementById("eo-progress-fill");
    if (progressFill) progressFill.style.width = "0%";

    showLoopTransitionOverlay();
    void waitForNotebookThenStartNextLoop();
  }

  async function waitForNotebookThenStartNextLoop() {
    const gate = shouldGateNextLoopOnNotebook();
    if (!gate) {
      setLoopTransitionStatus("轮回即将开启……");
      await sleep(480);
      doStartNextLoop();
      return;
    }

    setLoopTransitionStatus("写存档中请不要离开……");
    const deadline = Date.now() + NOTEBOOK_WAIT_TIMEOUT_MS;
    try {
      if (endingPostStagePromise) {
        await Promise.race([
          endingPostStagePromise,
          sleep(NOTEBOOK_WAIT_TIMEOUT_MS),
        ]);
      }
      while (!isCurrentLoopNotebookReady() && Date.now() < deadline) {
        await sleep(300);
      }
    } catch (_) { /* ignore */ }

    const ready = isCurrentLoopNotebookReady();
    setLoopTransitionStatus(ready ? "记忆已记下，轮回开启……" : "记忆有些模糊，仍踏入下一轮……");
    await sleep(ready ? 720 : 520);
    doStartNextLoop();
  }

  function showHourglassInStatus(el, textContent) {
    el.innerHTML = "";
    var hg = document.createElement("span");
    hg.className = "eo-hourglass-anim";
    hg.setAttribute("aria-hidden", "true");
    hg.textContent = "⏳";
    el.appendChild(hg);
    var tx = document.createElement("span");
    tx.className = "eo-notebook-status-text";
    tx.textContent = textContent || "写存档中请不要离开……";
    el.appendChild(tx);
  }

  function showPartialWithRetry(btn, statusEl, msgs) {
    statusEl.innerHTML = "";
    var partialMsg = document.createElement("span");
    partialMsg.textContent = (msgs.partial || "日记仍有些模糊") + "，网络不好，可点击重新尝试";
    statusEl.appendChild(partialMsg);
    var retryBtn = document.createElement("button");
    retryBtn.className = "eo-btn eo-btn-retry";
    retryBtn.textContent = "重新尝试";
    statusEl.appendChild(retryBtn);
    retryBtn.addEventListener("click", async function () {
      retryBtn.disabled = true;
      btn.disabled = true;
      showHourglassInStatus(statusEl, "写存档中请不要离开……");
      try {
        const callGemini = msgs.retryCallGemini;
        if (typeof callGemini !== "function") throw new Error("no callGemini");
        const loopIndex = (window.LoopState && typeof window.LoopState.getLoopIndex === "function")
          ? window.LoopState.getLoopIndex() : 1;
        const tone = (window.NotebookConfig && typeof window.NotebookConfig.getTonePresetFor === "function")
          ? window.NotebookConfig.getTonePresetFor(loopIndex) : null;
        if (!tone) throw new Error("no tone preset");
        const allEntries = (window.LoopState && typeof window.LoopState.getNotebookEntries === "function")
          ? window.LoopState.getNotebookEntries() : [];
        const previousNotebook = allEntries.slice(0, Math.max(0, allEntries.length - 1));
        const loopMemory = endingState.loopSummary || "（本轮记忆整理未完成或为空）";
        const result = await runNotebookGeneration({
          loopIndex,
          tonePreset: tone,
          loopMemory,
          previousNotebook,
          callGemini,
          signal: endingAbortController ? endingAbortController.signal : undefined,
          retryAttempt: 1,
        });
        if (result && result.body) {
          if (window.LoopState && typeof window.LoopState.replaceLastNotebookEntry === "function") {
            window.LoopState.replaceLastNotebookEntry({
              loopIndex,
              headerLabel: tone.headerLabel,
              body: result.body,
              tonePreset: tone,
              generatedAt: new Date().toISOString(),
              source: "ai",
              error: null,
            });
          }
          statusEl.innerHTML = "";
          statusEl.textContent = msgs.ready || "存档完成，可以继续。";
        } else {
          showPartialWithRetry(btn, statusEl, msgs);
        }
      } catch (err) {
        if (!isAbortError(err)) console.error("[ending.js] retry notebook failed", err);
        showPartialWithRetry(btn, statusEl, msgs);
      }
      btn.disabled = false;
      btn.title = "";
    });
  }

  async function waitForNotebookThenEnable(btn, statusEl, messages) {
    if (!btn || !statusEl) return;
    const msgs = messages || {};
    const deadline = Date.now() + NOTEBOOK_WAIT_TIMEOUT_MS;
    try {
      if (endingPostStagePromise) {
        await Promise.race([
          endingPostStagePromise,
          sleep(NOTEBOOK_WAIT_TIMEOUT_MS),
        ]);
      }
      while (!isCurrentLoopNotebookReady() && Date.now() < deadline) {
        await sleep(300);
      }
    } catch (_) { /* ignore */ }

    const ready = isCurrentLoopNotebookReady();
    /* 清空 status 内容（含沙漏动画） */
    statusEl.innerHTML = "";

    if (ready) {
      statusEl.textContent = msgs.ready || "本轮日记已记下，可以开启下一轮。";
    } else {
      /* 部分失败：显示"日记仍有些模糊"+ 重试提示 + 重试按钮 */
      showPartialWithRetry(btn, statusEl, msgs);
    }
    btn.disabled = false;
    btn.title = "";
  }

  /* ═══════════════════════════════════════════════════════════
     EXPORT FUNCTIONS
  ═══════════════════════════════════════════════════════════ */

  /* ① 保存对话数据（增强版：含初始人设） */
  function doExportTxt() {
    const snap = endingState.dialogueSnapshot;
    if (!snap) return;

    const lines = [];
    const now   = new Date().toLocaleString("zh-CN");

    lines.push("流浪者与三个路人 — 本轮对话记录");
    lines.push(`导出时间：${now}`);
    if (endingState.loopSummary) {
      lines.push(`本轮记忆整理：${endingState.loopSummary}`);
    }
    lines.push("=".repeat(48));
    lines.push("");

    snap.characters.forEach((c) => {
      lines.push(`【${c.name || c.id}】`);
      lines.push("─".repeat(32));

      // 初始人设（新增）
      if (c.systemPrompt) {
        lines.push("【初始人设】");
        lines.push(c.systemPrompt);
        lines.push("─".repeat(32));
      }

      const hist = snap.dialogueHistories[c.id] || [];
      if (hist.length === 0) {
        lines.push("（无对话记录）");
      } else {
        hist.forEach((m) => {
          lines.push(m.role === "user" ? `你：${m.content}` : `对方：${m.content}`);
        });
      }

      lines.push("");
      lines.push("[ 终局 ]");

      lines.push("阶段 1  （叙述阶段，无路人反馈）");
      lines.push("阶段 2  （叙述阶段，无路人反馈）");

      const p3 = endingState.stage3Results[c.id] || {};
      lines.push(`阶段 3  ${p3.action || "（未知）"}`);
      if (p3.line) lines.push(`        「${p3.line}」`);

      lines.push("");
      lines.push("");
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `对话记录_${now.replace(/[/:]/g, "-").replace(/\s/g, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ─── 构建 loop archive 对象（② 和 ③ 共用）—— Phase 2 输出 v2 resume-state schema ── */
  function buildArchiveObject() {
    const snap = endingState.dialogueSnapshot;
    const characters = {};

    if (snap) {
      snap.characters.forEach((c) => {
        const sub = c.mutableSubconscious
          ? { ...c.mutableSubconscious }
          : { dejaVuLevel: 0, subconsciousImpression: "", thresholdAdjustment: "", nextLoopPromptPatch: "" };
        // dejaVuLevel 由代码（currentCandor）决定，不使用 AI 结算返回的 deja_vu_level。
        sub.dejaVuLevel = c.currentCandor || 0;

        characters[c.id] = {
          immutableCore: {
            id:          c.id,
            name:        c.name        || c.id,
            targetColor: c.targetColor || "#000000",
            candorRates: c.candorRates || { rise: 1, fall: 1 },
          },
          mutableSubconscious: sub,
        };
      });
    }

    // 读取 LoopState 中已 append 的 notebook entries（含当前轮的占位/真实 entry）
    let notebook = [];
    if (window.LoopState && typeof window.LoopState.getNotebookEntries === "function") {
      try {
        notebook = window.LoopState.getNotebookEntries();
      } catch (_) {
        notebook = [];
      }
    }

    // Phase 2：计算 v2 resume-state schema 字段
    // current_stage_id = 下次加载时要进入的 stage（resume target）
    const currentLoopIdx = getCurrentLoopIndex();
    let currentStageId = null;
    let nextStageId = null;
    let legacyLoopIndex = currentLoopIdx + 1;  // 默认兜底（v1 语义）
    if (window.StageCatalog) {
      currentStageId = window.StageCatalog.fromLoopIndex(currentLoopIdx);
      if (currentStageId) {
        nextStageId = window.StageCatalog.nextStageId(currentStageId);
        try {
          legacyLoopIndex = window.StageCatalog.toLoopIndexStrict(nextStageId || currentStageId);
        } catch (_) {
          legacyLoopIndex = currentLoopIdx + 1;
        }
      }
    }
    const resumeStageId = nextStageId || currentStageId;

    // completed_stage_ids：包含 appendCompletedStage() 已推入的当前 stage
    const completedStageIds = (window.LoopState && typeof window.LoopState.getCompletedStageIds === "function")
      ? window.LoopState.getCompletedStageIds()
      : [];

    const maxLoop = typeof getFinalLoopIndex === "function" ? getFinalLoopIndex() : 10;
    if (legacyLoopIndex > maxLoop) {
      legacyLoopIndex = maxLoop;
    }

    return {
      // v2 resume-state schema（§3.4）
      archive_version:     2,
      current_stage_id:    resumeStageId,          // resume target：下次进入的 stage
      completed_stage_ids: completedStageIds,       // 已完成 stage 列表（含刚完成的）
      legacy_loop_index:   legacyLoopIndex,         // 与 current_stage_id 严格一致映射
      // 兼容保留字段
      loop_index:          legacyLoopIndex,         // v1 读档路径兜底（upgradePendingArchive 会读此字段）
      ran_at:              new Date().toISOString(),
      characters,
      summary:             endingState.loopSummary || "",
      notebook,
    };
    // 注意：next_stage_id 字段已删除（v3 修正 R-15）
  }

  /* ─── F-004a fallback notebook entry ───────────────────────── */
  /* F-004a 阶段每轮终局都 append 一条 fallback entry（body=""）；
     F-004c 阶段会被 AI 真生成路径替换/覆盖。                       */
  function buildFallbackNotebookEntry(spec) {
    const opt = spec || {};
    const loopIndex = Number(opt.loopIndex);
    const tone = opt.tonePreset || {};
    return {
      loopIndex: Number.isFinite(loopIndex) ? loopIndex : 1,
      headerLabel: typeof opt.headerLabel === "string" && opt.headerLabel
        ? opt.headerLabel
        : (tone.headerLabel || ""),
      body: "",
      tonePreset: {
        emotion: tone.emotion || "",
        memoryLevel: tone.memoryLevel || "",
        infoSnippet: tone.infoSnippet || "",
        headerLabel: tone.headerLabel || "",
      },
      generatedAt: new Date().toISOString(),
      source: "fallback",
      error: typeof opt.error === "string" ? opt.error : "not_yet_generated",
    };
  }

  /* 在终局触发后立即把当前周目的 fallback entry append 到 LoopState；
     F-004c 启用 AI 时改为「先 fallback、AI 成功后用真实 entry 重写最后一条」或
     「等待 AI 完成再 append」二选一。F-004a 先采用 fallback 永远存在的保守策略。 */
  function appendCurrentLoopFallbackEntry() {
    if (!window.LoopState || typeof window.LoopState.appendNotebookEntry !== "function") return;
    if (!window.NotebookConfig || typeof window.NotebookConfig.getTonePresetFor !== "function") return;
    const loopIndex = (typeof window.LoopState.getLoopIndex === "function")
      ? window.LoopState.getLoopIndex()
      : 1;
    // 已有同 loopIndex 的 entry 则不重复 append（防御性）
    const existing = (typeof window.LoopState.getNotebookEntries === "function")
      ? window.LoopState.getNotebookEntries()
      : [];
    if (existing.some(function (e) { return e && e.loopIndex === loopIndex; })) return;
    const tone = window.NotebookConfig.getTonePresetFor(loopIndex) || {};
    const entry = buildFallbackNotebookEntry({
      loopIndex,
      headerLabel: tone.headerLabel,
      tonePreset: tone,
      error: "not_yet_generated",
    });
    window.LoopState.appendNotebookEntry(entry);
  }

  /* ② 保存轮回记忆（JSON，供下次手动导入） */
  function doExportJson() {
    // Phase 2：buildArchiveObject 已内部计算 resume-state，不再需要传 loopIndex
    const archive = buildArchiveObject();

    const isoTs  = archive.ran_at.replace(/[:.]/g, "-").replace("Z", "");
    const blob   = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json;charset=utf-8" });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement("a");
    a.href       = url;
    a.download   = `loop_archive_${isoTs}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function persistApiConfigBeforeReload() {
    try {
      if (
        window.NPCDialogue &&
        window.NPCDialogue.settings &&
        typeof window.NPCDialogue.settings.persistApiConfigCache === "function"
      ) {
        window.NPCDialogue.settings.persistApiConfigCache();
      }
    } catch (_) {}
  }

  /* ③ 直接开启下一轮次（sessionStorage + reload） */
  async function doStartNextLoop() {
    const currentIndex = getCurrentLoopIndex();
    if (currentIndex >= getFinalLoopIndex()) {
      return;
    }
    abortEndingRequests("next-loop");

    // Phase 2：将当前 stage 推入 completedStageIds（在 buildArchiveObject 之前）
    if (window.LoopState && typeof window.LoopState.appendCompletedStage === "function") {
      window.LoopState.appendCompletedStage();
    }

    const archive = buildArchiveObject();  // Phase 2：无需传 nextLoop，内部计算

    try {
      sessionStorage.setItem("npc_pending_loop", JSON.stringify(archive));
    } catch (err) {
      console.error("[ending.js] sessionStorage write failed:", err);
    }

    // Phase 3：await SaveAdapter.save() 后才 reload（§2.5 强制约束）
    if (window.SaveAdapter && typeof window.SaveAdapter.save === "function") {
      try {
        await window.SaveAdapter.save(archive);
      } catch (saveErr) {
        // SaveAdapter 内部已处理重试对话框；此处兜底静默继续
        console.error("[ending.js] SaveAdapter.save error:", saveErr);
      }
    }

    persistApiConfigBeforeReload();
    location.reload();
  }

  /* ═══════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════ */

  function sleep(ms)      { return new Promise((r) => setTimeout(r, ms)); }
  function getColor(c)    { return c.currentColor || c.targetColor || "#000000"; }

  function histText(map, id) {
    return (map[id] || [])
      .map((m) => (m.role === "user" ? `玩家：${m.content}` : `路人：${m.content}`))
      .join("\n");
  }

  function colorMood(hex) {
    if (!hex || hex === "#000000") return "陌生而冷淡";
    const { r, g, b } = window.NPCConfig.hexToRgb(hex);
    const br = (r + g + b) / 3;
    if (br < 40)  return "陌生而冷淡";
    if (br < 100) return "略有波动";
    return "带着某种温度";
  }

  const SCHEMA = {
    type: "object",
    properties: {
      action: { type: "string" },
      line:   { type: "string" },
      reason: { type: "string" },
    },
    required: ["action", "line", "reason"],
  };

  /* title 供测试模式 mock；字段名 summary 与 archive.summary 兼容 */
  const LOOP_MEMORY_SCHEMA = {
    type: "object",
    title: "loop_memory",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
  };

  const SUBCONSCIOUS_SCHEMA = {
    type: "object",
    properties: {
      deja_vu_level:           { type: "integer" },
      subconscious_impression: { type: "string"  },
      threshold_adjustment:    { type: "string"  },
      next_loop_prompt_patch:  { type: "string"  },
    },
    required: ["deja_vu_level", "subconscious_impression", "threshold_adjustment", "next_loop_prompt_patch"],
  };

  /* F-004c：notebook schema —— title 字段供 dialogue.js mockResponse 识别。
     真实 API 也接受此 schema；body 是主角第一人称碎碎念正文。            */
  const NOTEBOOK_SCHEMA = {
    type: "object",
    title: "notebook",
    properties: {
      body: { type: "string" },
    },
    required: ["body"],
  };

  const DEFAULT_EPILOGUE_LABEL = "她闭上眼，然后又睁开";

  /* 按周目：阶段一/二/三叙述（仅玩家可见）；尾声轮回句；阶段三 NPC 仅知「有人被捅」 */
  const ENDING_PHASE_BY_LOOP = {
    1: {
      phase1: "你继续往前走。身侧忽然炸开一声骂——街角有碰撞，有口角，空气里有什么东西，轻轻点燃了。",
      phase2: "有个人朝你走来。面色不善，步子不快，却一步都不肯停。街上的路人，都看见了。",
      phase3: "他掏出刀，向你身上捅来。一刀，又一刀……",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    2: {
      phase1: "你还是往前走。身侧忽然有人吵起来——肩膀撞了肩，骂声擦过耳根，空气一点点绷紧。",
      phase2: "你想错开步子走开。身后的脚步声却跟了上来，不快，却一步也不肯放。",
      phase3: "还是被追上了。混乱里你抬眼，街角居然有家小花店——橱窗里的花在晕眩里格外清楚。你心里忽然觉得，那或许才是要紧的。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    3: {
      phase1: "又到了这个时刻。你看见他从不远处走来，步子还是那样——慢，却一步都不肯停。",
      phase2: "你比别人更早惊醒似的，拔腿就跑；可街道太窄，退路一眼就看得见底。",
      phase3: "他还是追上来了。你栽在路灯下，脑子里忽然只剩一个念头：要是能买一束花就好了。",
      epilogue: "你想买一束花。指尖还没碰到店门，视野就先暗了下去——再亮起时，又是一条熟悉的街。",
    },
    4: {
      phase1: "又到了这个时刻。天色照旧，人潮照旧，而他照旧朝你走来。",
      phase2: "不知为何，你双膝先软了下去，像被什么按住——嘴里念出的，连你自己都听不清是祈祷还是恳求。",
      phase3: "刀子还是落了下来。你连那句祷告都没来得及说完。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    5: {
      phase1: "又到了这个时刻——这一回你没有退。你盯住他的肩、他的手，身子一侧，准备扑上去。",
      phase2: "他比你快半步。你摸到了袖中的刀，可还没出鞘，手腕就被对方一把按住——重心被带歪的那一瞬，整个人朝坚硬的路面栽去。",
      phase3: "还是失败了。刀尖贴上来时，你只觉冷——和每一次一样冷。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    6: {
      phase1: "又到了这个时刻。这一回你看得更清楚：他抬手前肩会先沉一下，脚步总比预想慢半拍才落地。",
      phase2: "你知道他要来了——可身体还是迟了一拍，像隔着一层水，怎样也迈不出那一步。",
      phase3: "你还是被追上了。所有预兆都在眼前排好队，你却一步也踏不出去。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    7: {
      phase1: "又到了这个时刻。你甚至数得清他第几步会贴近——差距明明白白，像一道早就画好的线。",
      phase2: "你想动，肌肉却不听使唤，像被钉在原地，只能眼睁眼看着那条线一寸寸压近。你甚至想不起袖中那把刀是什么时候掉的——也许根本没拿出来过。",
      phase3: "你什么也做不了。刀落下来的时候，你只剩下一种清澈的无力。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    8: {
      phase1: "又到了这个时刻。脑子像被什么东西啃过，昨天、上周、上一辈子叠在同一条街上，分不清哪一层才是今天。",
      phase2: "你明明记得结局，却还是忍不住笑出声，骂一句，又重复昨天做过的动作——像一台坏掉的录音机。袖中那把刀又被夺走了。像每一次。",
      phase3: "刀落下来的时候，你分不清疼和笑哪个更响；这一回，声音特别大，大到连自己的心跳都听不见。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    9: {
      phase1: "又到了这个时刻。街景叠在一起，像几张透印的底片，连路灯都印着上一轮的影子。",
      phase2: "你听见自己在说话，却像隔着玻璃——字句碎掉，拼不回完整的句子，只剩呼吸贴着喉咙。",
      phase3: "刀光闪了一下。你竟想笑，又想哭，最后什么也说不出，只觉这一遍终于轻了一点。",
      epilogue: DEFAULT_EPILOGUE_LABEL,
    },
    10: {
      phase1: "又到了这个时刻——这一回，你已经知道接下来会发生什么。你抬手，握紧了袖中那把每一次都被夺走的刀。",
      phase2: "他还是朝你走来，步子还是那样不肯停。可这一次，你迎了上去，没有躲，也没有再求。",
      phase3: "刀光闪了一下。这一回，倒下的是他。你弯腰，把手里那束刚买的花，轻轻放在他身边——这一次，留下的人不是他，是花。",
      epilogue: "她合上笔记本，转身离开了这条街。",
    },
  };

  const STAGE3_NPC_EVENT_BRIEF =
    "你方才与街头一位陌生人（玩家）交谈过。此刻你得知：刚才还在附近、与你们说过话或刚离开的那个人，被人用刀捅了——局面万分危急。" +
    "你不知道在此之前街上还发生了什么（口角、追逐、祈祷、反击等细节只是主角的经历，不是你目击到的信息）。" +
    "请仅根据你与这位陌生人的对话历史，判断你在得知有人被捅的这一刻会做什么、会说什么。";

  function getFinalLoopIndex() {
    try {
      if (window.EndingParticipation && typeof window.EndingParticipation.getFinalLoopIndex === "function") {
        return window.EndingParticipation.getFinalLoopIndex();
      }
      if (window.NotebookConfig && typeof window.NotebookConfig.getFinalLoopIndex === "function") {
        const n = Number(window.NotebookConfig.getFinalLoopIndex());
        if (Number.isFinite(n) && n >= 1) return Math.floor(n);
      }
    } catch (_) { /* ignore */ }
    return 10;
  }

  function getEndingParticipationMap(characters) {
    // Phase 2：改为传 stageId（ending-participation.js 已迁移到 stageId 查表）
    const stageId = (window.LoopState && typeof window.LoopState.getStageId === "function")
      ? window.LoopState.getStageId()
      : null;
    try {
      if (window.EndingParticipation && typeof window.EndingParticipation.getMapForCharacters === "function") {
        return window.EndingParticipation.getMapForCharacters(stageId, characters);
      }
    } catch (_) { /* ignore */ }
    const map = Object.create(null);
    (characters || []).forEach((c) => {
      if (!c || !c.id) return;
      map[c.id] = {
        callStage3Judgment: true,
        showStage3Slot: true,
        callSubconsciousSettlement: true,
      };
    });
    return map;
  }

  function resolveCharParticipation(participationMap, charId) {
    const p = participationMap && participationMap[charId];
    if (p) return p;
    return {
      callStage3Judgment: true,
      showStage3Slot: true,
      callSubconsciousSettlement: true,
    };
  }

  function getCurrentLoopIndex() {
    try {
      if (window.LoopState && typeof window.LoopState.getLoopIndex === "function") {
        const v = window.LoopState.getLoopIndex();
        if (Number.isFinite(v) && v >= 1) return Math.floor(v);
      }
    } catch (_) { /* ignore */ }
    return 1;
  }

  function isOnFinalLoop() {
    return getCurrentLoopIndex() >= getFinalLoopIndex();
  }

  function openNotebookFromEnding() {
    try {
      if (window.NPCNotebookUi && typeof window.NPCNotebookUi.open === "function") {
        window.NPCNotebookUi.open({ page: "last" });
        return;
      }
    } catch (_) { /* ignore */ }
    console.warn("[ending.js] NPCNotebookUi.open unavailable");
  }

  function doPlayAgain() {
    abortEndingRequests("play-again");
    try {
      sessionStorage.removeItem("npc_pending_loop");
    } catch (_) { /* ignore */ }
    try {
      sessionStorage.setItem("npc_fresh_journey", "1");
    } catch (err) {
      console.error("[ending.js] sessionStorage write failed:", err);
    }
    if (window.AuditLog && typeof window.AuditLog.resetSessionForNewGame === 'function') {
      window.AuditLog.resetSessionForNewGame();
    }
    persistApiConfigBeforeReload();
    location.reload();
  }

  function getEndingCopyForLoop(loopIndex) {
    const idx = Math.max(1, Math.min(10, loopIndex));
    return ENDING_PHASE_BY_LOOP[idx] || ENDING_PHASE_BY_LOOP[1];
  }

  // Phase 1 追加——by-stageId wrapper，内部转回 legacyLoopIndex
  function getEndingCopyByStageId(stageId) {
    var idx = window.StageCatalog ? window.StageCatalog.toLoopIndex(stageId) : null;
    if (idx === null) idx = 1;
    return getEndingCopyForLoop(idx);
  }

  function getEpilogueLabel() {
    const copy = getEndingCopyForLoop(getCurrentLoopIndex());
    return copy.epilogue || DEFAULT_EPILOGUE_LABEL;
  }

  /* ═══════════════════════════════════════════════════════════
     LOOP MEMORY  —  轮回记忆整理（原 summary），供尾声展示与日记输入
  ═══════════════════════════════════════════════════════════ */

  function truncateChineseText(text, maxLen, minCutoff) {
    if (!text || text.length <= maxLen) return text;
    const slice = text.slice(0, maxLen);
    const lastIdx = Math.max(
      slice.lastIndexOf("。"),
      slice.lastIndexOf("！"),
      slice.lastIndexOf("？"),
      slice.lastIndexOf("……"),
      slice.lastIndexOf("\n"),
    );
    const floor = typeof minCutoff === "number" ? minCutoff : 80;
    return lastIdx > floor ? slice.slice(0, lastIdx + 1) : slice;
  }

  const META_EXPOSE_PATTERNS = [
    /作为(?:一个)?(?:AI|人工智能|语言模型)/i,
    /^好的[，,]?\s*以下/,
    /^这里是/,
    /\bschema\b/i,
    /\bprompt\b/i,
  ];

  function hasMetaExposure(text) {
    return META_EXPOSE_PATTERNS.some((re) => re.test(text));
  }

  function normalizeLoopMemory(value) {
    if (typeof value !== "string") return null;
    let text = value.trim();
    if (text.length === 0) return null;
    if (hasMetaExposure(text)) return null;
    if (text.length > 900) {
      text = truncateChineseText(text, 900, 120);
    }
    if (text.length < 8) return null;
    return text;
  }

  async function runLoopMemory(characters, histories, p3Results, participationMap, callGemini, signal) {
    const charLines = characters.map((c) => {
      const part = resolveCharParticipation(participationMap, c.id);
      const p3 = p3Results[c.id] || {};
      const candor = Number.isFinite(c.currentCandor) ? c.currentCandor : 0;
      const maxCandor = Number.isFinite(c.maxCandor) ? c.maxCandor : 6;
      const lines = [
        `【${c.name || c.id}】`,
        `连结深度 currentCandor：${candor} / ${maxCandor}（0=几乎陌生，6=亲近）`,
        "",
        "【完整对话记录】",
        histText(histories, c.id) || "（无对话）",
      ];
      if (part.callStage3Judgment) {
        lines.push(
          "",
          "【终局阶段行为】",
          `行动：${p3.action || "（未知）"}`,
          `台词：${p3.line || "（无）"}`,
          `内心/理由摘要：${p3.reason || "（无）"}`,
        );
      }
      return lines.join("\n");
    }).join("\n\n");

    const sp = [
      "你是「轮回记忆整理者」。你的任务不是写剧情点评或煽情总结，而是整理「这一轮结束后，主角与下一轮都值得记住的事实」。",
      "",
      "请根据输入，写出结构清晰的记忆正文，必须覆盖：",
      "1. **和谁说过话**：三位路人分别聊了多少、关系大致如何（冷淡/试探/冲突/亲近等，可结合连结深度）；",
      "2. **值得记住的具体事**：对话里真实出现的话题、物件、场景、情绪转折、承诺或回避（禁止编造输入里没有的内容）；",
      "3. **终局发生了什么**：每位路人在危机时刻最终做了什么、对主角意味着什么。",
      "",
      "写作要求：",
      "- 用客观、可复述的叙述或短清单，具体、有名词，少用空泛形容词。",
      "- 可分 2–4 个自然段，总长度建议 150–500 字；不必刻意压成一句话。",
      "- 不要写成诗、口号或「本轮核心是……」式评论。",
      "- 禁止提到 AI、玩家、prompt、schema、系统、代码。",
    ].join("\n");

    const uc = [
      "以下是本轮完整对话与终局行为记录：",
      "",
      charLines,
      "",
      "请输出 JSON：{ \"summary\": \"<本轮记忆整理正文>\" }。不要 Markdown，不要额外字段。",
    ].join("\n");

    const r = await callGemini({
      label: "轮回记忆整理",
      systemPrompt: sp,
      messages: [{ role: "user", content: uc }],
      responseSchema: LOOP_MEMORY_SCHEMA,
      isEndingPhase: true,
      signal,
    });

    if (!r || typeof r.summary !== "string") return "";
    const normalized = normalizeLoopMemory(r.summary);
    /* ─── AuditLog: loop_memory ──────────────────────────────── */
    if (window.AuditLog) {
      (async function () {
        try {
          const _lmSrcIds = window.AuditLog.getAllCharDialogueLogIds()
            .concat(window.AuditLog.getAllStage3LogIds());
          const _lmLoopIdx = getCurrentLoopIndex();
          const _lmIncludeStage3 = characters.some(function (ch) {
            return resolveCharParticipation(participationMap, ch.id).callStage3Judgment;
          });
          const _lmLogId = await window.AuditLog.write('loop_memory', {
            system_prompt_full: sp,
            user_content:       uc,
            raw_ai_output:      JSON.stringify(r),
            raw_summary:        r.summary,
            normalized_summary: normalized || null,
            included_stage3:    _lmIncludeStage3,
          }, {
            label:     '\u8F6E\u56DE\u8BB0\u5FC6\u6574\u7406',
            loopPhase: 'loop_' + _lmLoopIdx + '_memory',
            sourceIds: _lmSrcIds,
          });
          if (_lmLogId) window.AuditLog.setLoopMemoryLogId(_lmLogId);
        } catch (_lmErr) {
          console.warn('[AuditLog] loop_memory log failed', _lmErr);
        }
      })();
    }
    /* ─────────────────────────────────────────────────────────── */
    return normalized || "";
  }

  /* ═══════════════════════════════════════════════════════════
     SUBCONSCIOUS SETTLEMENT  —  高维命运观测者，stage 3 后逐角色结算
     为每个 NPC 生成下一轮潜意识残留，写入 dialogueSnapshot。
  ═══════════════════════════════════════════════════════════ */

  async function runSubconsciousSettlement(character, histories, callGemini, signal) {
    const charName = character.name || character.id;
    const candor = Number.isFinite(character.currentCandor) ? character.currentCandor : 0;
    const maxCandor = Number.isFinite(character.maxCandor) ? character.maxCandor : 6;

    const sp = [
      "<Role>",
      `你是一个「高维命运观测者」。NPC ${charName} 刚刚与一个陌生人（玩家）在街头交谈过，时空循环即将重启。`,
      "你的工作只有一件事：从这段对话里，为该 NPC 提取「TA 对刚才那个陌生人的印象碎片」，写成一段下一轮投到 TA 脑海里的潜意识余韵。",
      "</Role>",
      "",
      "<Hard Rules>",
      "1. **视角约束**：补丁文本的主语必须是 NPC（用「你」开头或隐含 NPC 视角），宾语必须是「那个人 / TA / 刚才那个陌生人」。补丁是 NPC 对玩家这个对象的印象，不是 NPC 对自己身体/情绪反应的描写。",
      "2. **禁止 NPC 自我特征混入**：以下是 NPC 自己的人设特征，绝对不能写成玩家的特征——背着相机、背着书包、是摄影师、是店家、刚从图书馆出来、站在自家店门口……这些是 NPC 自己，不是「那个人」。",
      "3. **关键词锚点（核心）**：必须从下文「对话历史」里挑出 1–3 个**真实出现过**的话题、物件或场景作为印象的核心（例：图书馆、一起看书、花店、加缪、命运、说自己会死……）。禁止编造对话里从未出现的话题。",
      "4. **基于连结深度**：参考 `currentCandor` 数值：",
      "   - 0：几乎没有连结，TA 几乎想不起对方，只剩一丝模糊的违和感。",
      "   - 1–2：印象稀薄，能记起话题方向但记不起具体内容。",
      "   - 3–4：能想起 1–2 个具体片段。",
      "   - 5–6：印象清晰，甚至带有偏好/警惕的情绪倾向。",
      "5. **禁止终局污染**：禁止出现「死、刀、血、袭击、危险、救、逃、刺、捅、躲」等任何与暴力或危机相关的词。当前轮发生过什么严重事件，潜意识不应保留。",
      "8. **禁止跨周目具体引用**：`next_loop_prompt_patch` 中只能表达模糊的似曾相识感（如「好像见过」「有种熟悉感」），严禁直接引用或复述上一周目具体发生过的台词、事件、场景细节；那些只能以「说不清的感觉」形式影响 NPC 的态度，不能被明确复述。",
      "6. **长度**：`next_loop_prompt_patch` 必须 ≤ 50 个中文字符。",
      "7. **风格**：不要写成诗或抒情段落，写成一种自言自语式的内心碎片，像「你好像在哪里听过这个人聊起 X」「TA 提过 Y，那种感觉你记得」这样具体而克制。",
      "</Hard Rules>",
    ].join("\n");

    const uc = [
      "<Input>",
      `- NPC 基础设定（仅供你理解 TA 在意什么，不可写进补丁）：${character.systemPrompt || "（无）"}`,
      "",
      `- 本轮连结深度 currentCandor：${candor} / ${maxCandor}`,
      "",
      "- 本轮对话历史（你抽取关键词的唯一来源）：",
      histText(histories, character.id) || "（几乎没有实质对话——这种情况下补丁必须如实写陌生与模糊，禁止编造话题。）",
      "</Input>",
      "",
      "<OutputFormat>",
      "请严格输出以下 JSON 格式，不要包含任何其他文字，所有字段都围绕「NPC 对那个陌生人的印象」这一主题：",
      "{",
      '  "deja_vu_level": "[0-5的整数，代表 TA 对那个陌生人的熟悉/警惕程度]",',
      '  "subconscious_impression": "[一句话：下一轮 TA 见到那个陌生人时，第一眼浮起的关于对方的印象（不写自己反应）]",',
      '  "threshold_adjustment": "[一句话：见到这种类型的人时，TA 下一轮会更愿意/更不愿意停下来说话]",',
      '  "next_loop_prompt_patch": "[≤50字。第二人称写给 NPC 的潜意识余韵，必须含 1–3 个对话里出现过的关键词，描述 TA 记得的关于「那个人」的什么。禁止写 NPC 自己的身体反应。]"',
      "}",
      "</OutputFormat>",
    ].join("\n");

    const r = await callGemini({
      label: `${charName} · 潜意识结算`,
      systemPrompt: sp,
      messages: [{ role: "user", content: uc }],
      responseSchema: SUBCONSCIOUS_SCHEMA,
      isEndingPhase: true,
      signal,
    });

    /* ─── AuditLog: subconscious_settlement ──────────────────── */
    if (window.AuditLog && r) {
      (async function () {
        try {
          const _ssSrcIds = window.AuditLog.getAllDialogueLogIds(character.id);
          _ssSrcIds.push(window.AuditLog.getBaselineId(character.id + '_systemPrompt'));
          const _ssLoopIdx = getCurrentLoopIndex();
          const _ssMutableOut = {
            subconsciousImpression: r.subconscious_impression || '',
            thresholdAdjustment:    r.threshold_adjustment    || '',
            nextLoopPromptPatch:    r.next_loop_prompt_patch   || '',
          };
          const _ssLogId = await window.AuditLog.write('subconscious_settlement', {
            character_id:          character.id,
            current_candor:        candor,
            system_prompt_full:    sp,
            user_content:          uc,
            raw_ai_output:         JSON.stringify(r),
            raw_parsed:            r,
            mutable_subconscious_out: _ssMutableOut,
          }, {
            label:     charName + '\u00B7\u6F5C\u610F\u8BC6\u7ED3\u7B97',
            loopPhase: 'loop_' + _ssLoopIdx + '_settle',
            sourceIds: _ssSrcIds,
          });
          /* 额外注册 subconscious_patch artifact，供下周目 dialogue_npc source_ids 引用 */
          if (r.next_loop_prompt_patch) {
            await window.AuditLog.registerArtifact('subconscious_patch', {
              character_id:           character.id,
              loop_index:             _ssLoopIdx,
              subconscious_impression: r.subconscious_impression || '',
              threshold_adjustment:   r.threshold_adjustment    || '',
              next_loop_prompt_patch: r.next_loop_prompt_patch   || '',
              source_settlement_log_id: _ssLogId || null,
            }, { loopPhase: 'between_loops' });
          }
        } catch (_ssErr) {
          console.warn('[AuditLog] subconscious_settlement log failed', _ssErr);
        }
      })();
    }
    /* ─────────────────────────────────────────────────────────── */
    return r || null;
  }

  async function runAllSubconsciousSettlements(characters, histories, participationMap, callGemini, signal) {
    const eligible = characters.filter((c) => {
      if (!c || !c.id) return false;
      return resolveCharParticipation(participationMap, c.id).callSubconsciousSettlement;
    });
    await Promise.all(eligible.map(async (c) => {
      try {
        const result = await runSubconsciousSettlement(c, histories, callGemini, signal);
        if (signal && signal.aborted) return;
        if (result && endingState.dialogueSnapshot) {
          const snap = endingState.dialogueSnapshot;
          const idx = snap.characters.findIndex((sc) => sc.id === c.id);
          if (idx >= 0) {
            snap.characters[idx].mutableSubconscious = {
              // dejaVuLevel 由 buildArchiveObject 从 currentCandor 计算覆盖，此处占位
              dejaVuLevel:            snap.characters[idx].mutableSubconscious
                                        ? snap.characters[idx].mutableSubconscious.dejaVuLevel
                                        : 0,
              subconsciousImpression: result.subconscious_impression || "",
              thresholdAdjustment:    result.threshold_adjustment    || "",
              nextLoopPromptPatch:    result.next_loop_prompt_patch   || "",
            };
          }
        }
      } catch (err) {
        if (isAbortError(err)) {
          console.log(`[abort] ending subconscious settlement cancelled for ${c.id}`);
          return;
        }
        console.error("[ending.js] subconscious settlement failed for", c.id, err);
      }
    }));
  }

  /* ═══════════════════════════════════════════════════════════
     NOTEBOOK GENERATION (F-004c)  —  主角第一人称碎碎念日记
     在轮回记忆整理完成后触发；输入为记忆层正文，不再截断对话摘要。
     成功 → LoopState.replaceLastNotebookEntry 覆盖 F-004a 占位；
     失败 → 保留 F-004a 占位（body=""），UI 显示「这一轮的记忆模糊了……」。
  ═══════════════════════════════════════════════════════════ */

  function extractPreviousNoteTail(previousNotebook) {
    if (!Array.isArray(previousNotebook) || previousNotebook.length === 0) return "";
    const last = previousNotebook[previousNotebook.length - 1];
    if (!last || typeof last.body !== "string" || last.body.trim().length === 0) return "";
    const body = last.body
      .replace(/<\/?del>/g, "")
      .replace(/<br\s*\/?>/g, "")
      .trim();
    if (!body) return "";
    return body.slice(-60);
  }

  function buildNotebookSystemPrompt(loopIndex) {
    const baseLines = [
      "你要为一个轮回叙事游戏生成「主角第一人称日记」。",
      "",
      "**视角核心约束（极重要）**：主角「我」是那个在这条街上一次次被杀死、又一次次醒来的人。她不是旁观者，不是观察者，不是旁边的路人——她是被杀的那个。所有日记都必须从「我=被反复杀死的主人公」的视角书写，绝对不能写成「我只是看着」「他们面对这件事」等旁观叙事。",
      "",
      "你不是全知旁白，也不知道完整剧本。你只能根据当前周目预设、已整理好的「本轮记忆」和上一页日记末尾的余韵，写下主角此刻可能会写在笔记本上的内容。",
      "",
      "写作要求：",
      "1. 使用第一人称「我」，且「我」始终是那个被杀死又轮回的主角本人。",
      "2. 150-300 个中文字符。",
      "3. **碎碎念、偏意识流的内心独白**：允许重复、停顿、自我打断、思绪跳跃，像私人笔记中的喃喃自语。不要写成系统总结、剧情大纲、任务日志或诗。",
      "4. 不使用复杂排版，不分点，不用 Markdown。",
      "5. 不要透露当前周目预设以外的真相，不要提前写出未来周目的信息。",
      "6. 不要提到 AI、玩家、prompt、schema、系统、代码。",
      "7. 不允许写错别字，不允许标点错位；所有「模糊」必须通过下文允许的标签呈现。",
    ];
    if (loopIndex === 7 || loopIndex === 8) {
      baseLines.push(
        "8. **本周目（第 7 或第 8 次轮回）必须模糊化**：",
        "   - 在文本中使用 `<del>...</del>` 标签划掉 2–6 处文字（每处 1–6 个汉字），表达「写下又划掉」的反复。",
        "   - 末尾必须使用未写完的截断句：以「……」收尾、或在半句中断（如「我又…」「她那时是不是」）。",
        "   - **严禁错别字与标点错位**：所有「模糊感」只能通过 `<del>` 与截断句呈现，不许把字写错。",
        "   - 仅允许 `<del>` 标签，不要用其他 HTML 标签或 Markdown。",
      );
    } else if (loopIndex === 9) {
      baseLines.push(
        "8. **本周目（第 9 次轮回）的核心是「真相 + 疲惫 + 想结束」**：",
        "   - 主角已经能看清这条街上发生过什么，并且发现这里曾有人真的「离开」过——离开的方式是把一束花留下。",
        "   - 主角非常疲惫，不想再来一遍；这是开始酝酿告别、想替自己结束这一切的一页。",
        "   - 不要写成顿悟金句或宣言，写成她自言自语地把这件事承认下来。",
        "9. 不要再嵌入任何固定金句或口号；也不要在这一页里直接写「一切消失、自己离开」（那是第 10 周目的收束）。",
      );
    } else if (loopIndex === 10) {
      baseLines.push(
        "8. **本周目（第 10 次轮回）是真正的终局，核心是「看见一切消失，然后自己也离开」**：",
        "   - 主角环顾这条街：花店、路人、熟悉的声音与角落……像被收走一样逐一淡去、消失，世界变得空。",
        "   - 她知道（或感到）轮回到此为止；不是怒吼着告别，而是轻轻承认：我也该走了。",
        "   - 可以写到合上笔记本、放下笔，或转身走向空处；重点是「景物先没，我再没」。",
        "9. 语气走向释然、道别。不要再制造新的悬念，不要再追问真相；这一页的功能是收束。",
        "10. 不要把「本轮记忆」未提及的情节硬编进来（例如反杀、留花、买到花等）；若记忆里没有，就只写消散与离去。",
      );
    } else {
      baseLines.push(
        "8. 不使用 HTML 标签，不使用 Markdown，不使用删除线。",
      );
    }
    baseLines.push(
      "",
      "只输出 JSON：{ \"body\": \"<这一页日记正文>\" }。不要 Markdown，不要解释，不要额外字段。",
    );
    return baseLines.join("\n");
  }

  function buildNotebookUserContent(spec) {
    const opt = spec || {};
    const tone = opt.tonePreset || {};
    const lines = [
      `当前周目：${opt.loopIndex}`,
      `页眉：${tone.headerLabel || ""}`,
      `情绪方向：${tone.emotion || ""}`,
      `记忆量：${tone.memoryLevel || ""}`,
      `本轮可知道的信息边界：${tone.infoSnippet || ""}`,
      "",
      "本轮记忆整理（系统已从完整对话与终局提炼；请据此写日记，勿编造其中未列出的事实）：",
      opt.loopMemory || "（本轮几乎无可记录之事）",
    ];
    if (opt.previousNoteTail) {
      lines.push("", `上一页结尾（仅供语气连续）：${opt.previousNoteTail}`);
    }
    lines.push("", "请写出这一页日记。");
    return lines.join("\n");
  }

  /* 严格校验 + 失败转 fallback。返回字符串或 null。 */
  function normalizeNotebookBody(value) {
    if (typeof value !== "string") return null;
    let body = value.trim();
    if (body.length === 0) return null;
    if (hasMetaExposure(body)) return null;
    if (body.length > 800) {
      body = truncateChineseText(body, 800, 80);
    }
    if (body.length < 8) return null;
    return body;
  }

  async function runNotebookGeneration(spec) {
    const opt = spec || {};
    const loopIndex    = Number(opt.loopIndex);
    const tone         = opt.tonePreset || {};
    const previousNotebook = opt.previousNotebook || [];
    const callGemini   = opt.callGemini;
    const signal       = opt.signal;
    const retryAttempt = Number(opt.retryAttempt) || 0;

    if (!Number.isFinite(loopIndex) || typeof callGemini !== "function") {
      return { body: null, error: "invalid_args", logId: null };
    }

    const sp = buildNotebookSystemPrompt(loopIndex);
    const uc = buildNotebookUserContent({
      loopIndex,
      tonePreset: tone,
      loopMemory: typeof opt.loopMemory === "string" ? opt.loopMemory : "",
      previousNoteTail: extractPreviousNoteTail(previousNotebook),
    });

    /* 注册 tone preset artifact（去重） */
    let _tonePresetLogId = null;
    if (window.AuditLog) {
      try {
        _tonePresetLogId = await window.AuditLog.registerArtifact('notebook_tone_preset', {
          loop_index: loopIndex,
          tone_preset: tone,
        }, { loopPhase: 'loop_' + loopIndex + '_notebook' });
      } catch (_) {}
    }

    const _nbT0 = Date.now();
    let raw = null;
    try {
      raw = await callGemini({
        label: `轮回 ${loopIndex} · 日记生成`,
        systemPrompt: sp,
        messages: [{ role: "user", content: uc }],
        responseSchema: NOTEBOOK_SCHEMA,
        isEndingPhase: true,
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return { body: null, error: "aborted", logId: null };
      }
      console.error("[ending.js] notebook generation failed", err);
      const errType = (err && err.name) ? err.name : "Error";
      /* ─── AuditLog: diary_generation 失败（API错误）──────────── */
      let _nbErrLogId = null;
      if (window.AuditLog) {
        try {
          const _nbSrcIds = [
            window.AuditLog.getLoopMemoryLogId(),
            _tonePresetLogId,
            window.AuditLog.getDiaryLogId(),
            opt.prevFailedLogId || null,
          ].filter(Boolean);
          _nbErrLogId = await window.AuditLog.write('diary_generation', {
            loop_index:        loopIndex,
            tone_preset_log_id: _tonePresetLogId,
            loop_memory_input: opt.loopMemory || '',
            previous_note_tail: extractPreviousNoteTail(previousNotebook),
            system_prompt_full: sp,
            raw_ai_output:     null,
            raw_body:          null,
            normalized_body:   null,
            source_out:        'fallback',
            retry_attempt:     retryAttempt,
          }, {
            label:     '\u8F6E\u56DE' + loopIndex + '\u00B7\u65E5\u8BB0\u751F\u6210',
            status:    'error',
            error:     err && err.message ? String(err.message) : String(err),
            durationMs: Date.now() - _nbT0,
            loopPhase: 'loop_' + loopIndex + '_notebook',
            sourceIds: _nbSrcIds,
          });
        } catch (_) {}
      }
      /* ─────────────────────────────────────────────────────────── */
      return { body: null, error: `api_${errType}`, logId: _nbErrLogId };
    }

    if (!raw || typeof raw !== "object") {
      let _nbEmptyLogId = null;
      if (window.AuditLog) {
        try {
          const _nbSrcIds = [
            window.AuditLog.getLoopMemoryLogId(),
            _tonePresetLogId,
            window.AuditLog.getDiaryLogId(),
          ].filter(Boolean);
          _nbEmptyLogId = await window.AuditLog.write('diary_generation', {
            loop_index: loopIndex, tone_preset_log_id: _tonePresetLogId,
            loop_memory_input: opt.loopMemory || '', previous_note_tail: extractPreviousNoteTail(previousNotebook),
            system_prompt_full: sp, raw_ai_output: null, raw_body: null,
            normalized_body: null, source_out: 'fallback', retry_attempt: retryAttempt,
          }, {
            label: '\u8F6E\u56DE' + loopIndex + '\u00B7\u65E5\u8BB0\u751F\u6210',
            status: 'error', error: 'empty_response',
            durationMs: Date.now() - _nbT0,
            loopPhase: 'loop_' + loopIndex + '_notebook',
            sourceIds: [window.AuditLog.getLoopMemoryLogId(), _tonePresetLogId].filter(Boolean),
          });
        } catch (_) {}
      }
      return { body: null, error: "empty_response", logId: _nbEmptyLogId };
    }
    const normalized = normalizeNotebookBody(raw.body);
    if (!normalized) {
      let _nbInvalidLogId = null;
      if (window.AuditLog) {
        try {
          _nbInvalidLogId = await window.AuditLog.write('diary_generation', {
            loop_index: loopIndex, tone_preset_log_id: _tonePresetLogId,
            loop_memory_input: opt.loopMemory || '', previous_note_tail: extractPreviousNoteTail(previousNotebook),
            system_prompt_full: sp, raw_ai_output: JSON.stringify(raw), raw_body: raw.body || null,
            normalized_body: null, source_out: 'fallback', retry_attempt: retryAttempt,
          }, {
            label: '\u8F6E\u56DE' + loopIndex + '\u00B7\u65E5\u8BB0\u751F\u6210',
            status: 'error', error: 'invalid_body',
            durationMs: Date.now() - _nbT0,
            loopPhase: 'loop_' + loopIndex + '_notebook',
            sourceIds: [window.AuditLog.getLoopMemoryLogId(), _tonePresetLogId].filter(Boolean),
          });
        } catch (_) {}
      }
      return { body: null, error: "invalid_body", logId: _nbInvalidLogId };
    }
    /* 成功 */
    let _nbOkLogId = null;
    if (window.AuditLog) {
      try {
        const _nbOkSrcIds = [
          window.AuditLog.getLoopMemoryLogId(),
          _tonePresetLogId,
          window.AuditLog.getDiaryLogId(),
          opt.prevFailedLogId || null,
        ].filter(Boolean);
        _nbOkLogId = await window.AuditLog.write('diary_generation', {
          loop_index:        loopIndex,
          tone_preset_log_id: _tonePresetLogId,
          loop_memory_input: opt.loopMemory || '',
          previous_note_tail: extractPreviousNoteTail(previousNotebook),
          system_prompt_full: sp,
          raw_ai_output:     JSON.stringify(raw),
          raw_body:          raw.body,
          normalized_body:   normalized,
          source_out:        'ai',
          retry_attempt:     retryAttempt,
        }, {
          label:     '\u8F6E\u56DE' + loopIndex + '\u00B7\u65E5\u8BB0\u751F\u6210',
          status:    'ok',
          durationMs: Date.now() - _nbT0,
          loopPhase: 'loop_' + loopIndex + '_notebook',
          sourceIds: _nbOkSrcIds,
        });
        if (_nbOkLogId) window.AuditLog.setDiaryLogId(_nbOkLogId);
      } catch (_nbOkErr) {
        console.warn('[AuditLog] diary_generation log failed', _nbOkErr);
      }
    }
    /* ─────────────────────────────────────────────────────────── */
    return { body: normalized, error: null, logId: _nbOkLogId };
  }

  async function runEndingPostStage(characters, histories, p3Results, participationMap, callGemini, signal) {
    endingState.loopSummary = null;

    const memoryTask = (async () => {
      try {
        const s = await runLoopMemory(characters, histories, p3Results, participationMap, callGemini, signal);
        if (signal && signal.aborted) return;
        endingState.loopSummary = s;
      } catch (err) {
        if (!isAbortError(err)) {
          console.error("[ending.js] loop memory failed", err);
        }
      }
    })();

    const subconsciousTask = (async () => {
      try {
        await runAllSubconsciousSettlements(characters, histories, participationMap, callGemini, signal);
      } catch (err) {
        if (!isAbortError(err)) {
          console.error("[ending.js] subconscious settlements failed", err);
        }
      }
    })();

    /* F-004c：notebook 在 memoryTask 完成后生成（输入为记忆层，不再截断对话）。 */
    const notebookTask = (async () => {
      if (!window.LoopState || !window.NotebookConfig) return;
      if (typeof window.LoopState.replaceLastNotebookEntry !== "function") return;

      try {
        await memoryTask;
      } catch (_) {}

      if (signal && signal.aborted) return;

      const loopIndex = (typeof window.LoopState.getLoopIndex === "function")
        ? window.LoopState.getLoopIndex()
        : 1;
      const tone = window.NotebookConfig.getTonePresetFor(loopIndex);
      if (!tone) return;
      const loopMemory = endingState.loopSummary || "（本轮记忆整理未完成或为空）";
      // 取除最后一条 fallback 之外的历史（runEnding 已 append 占位）
      const allEntries = (typeof window.LoopState.getNotebookEntries === "function")
        ? window.LoopState.getNotebookEntries()
        : [];
      const previousNotebook = allEntries.slice(0, Math.max(0, allEntries.length - 1));

      try {
        const result = await runNotebookGeneration({
          loopIndex,
          tonePreset: tone,
          loopMemory,
          previousNotebook,
          callGemini,
          signal,
        });
        if (signal && signal.aborted) return;
        if (result.body) {
          window.LoopState.replaceLastNotebookEntry({
            loopIndex,
            headerLabel: tone.headerLabel,
            body: result.body,
            tonePreset: tone,
            generatedAt: new Date().toISOString(),
            source: "ai",
            error: null,
          });
        } else if (result.error && result.error !== "aborted") {
          // 失败：保留 fallback，但更新 error 字段以便排查
          window.LoopState.replaceLastNotebookEntry({
            loopIndex,
            headerLabel: tone.headerLabel,
            body: "",
            tonePreset: tone,
            generatedAt: new Date().toISOString(),
            source: "fallback",
            error: result.error,
          });
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.error("[ending.js] notebook task failed", err);
        }
      }
    })();

    await Promise.all([memoryTask, subconsciousTask, notebookTask]);
  }

  async function retryCurrentLoopNotebookGeneration() {
    if (!window.LoopState || !window.NotebookConfig || !DialogueState) {
      return { ok: false, error: "missing_dependencies" };
    }
    if (typeof DialogueState.callGemini !== "function") {
      return { ok: false, error: "missing_call_gemini" };
    }
    if (typeof window.LoopState.getNotebookEntries !== "function" ||
        typeof window.LoopState.getLoopIndex !== "function" ||
        typeof window.LoopState.replaceLastNotebookEntry !== "function") {
      return { ok: false, error: "missing_loop_api" };
    }

    const allEntries = window.LoopState.getNotebookEntries() || [];
    const lastIndex = allEntries.length - 1;
    if (lastIndex < 0) return { ok: false, error: "no_entry" };

    const targetEntry = allEntries[lastIndex] || {};
    const loopIndex = Number(targetEntry.loopIndex);
    if (!Number.isFinite(loopIndex)) {
      return { ok: false, error: "invalid_loop_index" };
    }

    const tone = window.NotebookConfig.getTonePresetFor(loopIndex);
    if (!tone) return { ok: false, error: "missing_tone_preset" };

    const previousNotebook = allEntries.slice(0, lastIndex);
    let loopMemory = endingState.loopSummary || "";
    if (!loopMemory && typeof window.LoopState.getLastLoopSummary === "function") {
      loopMemory = window.LoopState.getLastLoopSummary() || "";
    }
    if (!loopMemory) {
      loopMemory = "（本轮记忆整理未完成或为空）";
    }
    const signal = endingAbortController ? endingAbortController.signal : undefined;

    try {
      const result = await runNotebookGeneration({
        loopIndex,
        tonePreset: tone,
        loopMemory,
        previousNotebook,
        callGemini: DialogueState.callGemini,
        signal,
        retryAttempt: 1,
      });
      if (result && result.body) {
        window.LoopState.replaceLastNotebookEntry({
          loopIndex,
          headerLabel: tone.headerLabel,
          body: result.body,
          tonePreset: tone,
          generatedAt: new Date().toISOString(),
          source: "ai",
          error: null,
        });
        return { ok: true, body: result.body, error: null };
      }

      const errCode = (result && result.error) ? result.error : "retry_failed";
      window.LoopState.replaceLastNotebookEntry({
        loopIndex,
        headerLabel: tone.headerLabel,
        body: "",
        tonePreset: tone,
        generatedAt: new Date().toISOString(),
        source: "fallback",
        error: errCode,
      });
      return { ok: false, error: errCode };
    } catch (err) {
      if (!isAbortError(err)) {
        console.error("[ending.js] retry current loop notebook failed", err);
      }
      return { ok: false, error: isAbortError(err) ? "aborted" : "retry_exception" };
    }
  }

  /* ═══════════════════════════════════════════════════════════
     PRODUCER  —  sequential API calls, fills slots reactively
  ═══════════════════════════════════════════════════════════ */

  async function runProducer(characters, histories, callGemini, signal) {
    const loopCopy = getEndingCopyForLoop(getCurrentLoopIndex());
    const participationMap = getEndingParticipationMap(characters);

    const stage3Entries = characters
      .filter((c) => c && c.id && resolveCharParticipation(participationMap, c.id).showStage3Slot)
      .map((c) => ({
        character: c,
        participation: resolveCharParticipation(participationMap, c.id),
        slot: makeSlot(c, null, null, false),
      }));

    const p3Slots = stage3Entries.map((e) => e.slot);
    const showStage3NpcSlots = p3Slots.length > 0;

    enqueue({
      type: "phase",
      label: "阶段 一",
      desc: loopCopy.phase1,
      slots: [],
      showNpcSlots: false,
    });

    enqueue({
      type: "phase",
      label: "阶段 二",
      desc: loopCopy.phase2,
      slots: [],
      showNpcSlots: false,
    });

    enqueue({
      type: "phase",
      label: "阶段 三",
      desc: loopCopy.phase3,
      slots: p3Slots,
      showNpcSlots: showStage3NpcSlots,
    });

    enqueue({ type: "epilogue", label: getEpilogueLabel() });

    endingState.stage1Results = {};
    endingState.stage2Results = {};

    advance();

    const p3Results = {};

    for (let i = 0; i < stage3Entries.length; i++) {
      const entry = stage3Entries[i];
      const c = entry.character;
      if (!entry.participation.callStage3Judgment) {
        continue;
      }
      await sleep(0);
      try {
        const sp = [
          c.systemPrompt || "",
          "",
          "【当前事件说明（你作为路人 NPC 所知）】",
          STAGE3_NPC_EVENT_BRIEF,
          "反应必须符合你的身份与性格，不要跳出人设。",
          "",
          "回答时只需要根据给定的 JSON schema 返回数据，不要加入多余解释。",
        ].join("\n");
        const uc = [
          "你得知：方才在附近说话的那个人，被人用刀捅了。",
          "在这个瞬间，你会做什么？会说一句什么话？为什么？",
          "",
          "【你和玩家的对话历史】",
          histText(histories, c.id) || "（你与玩家之间几乎没有实质对话。）",
        ].join("\n");

        const r = await callGemini({
          label: `${c.name || c.id} · 终局阶段 3`,
          systemPrompt: sp,
          messages: [{ role: "user", content: uc }],
          responseSchema: SCHEMA,
          isEndingPhase: true,
          signal,
        });

        if (signal && signal.aborted) return;
        p3Results[c.id] = r;
        fillSlot(entry.slot, r.action || "", r.line || "");
        /* ─── AuditLog: ending_stage3 成功 ──────────────────────── */
        if (window.AuditLog) {
          (async function () {
            try {
              const _s3SrcIds = window.AuditLog.getAllDialogueLogIds(c.id);
              const _s3PromptId = await window.AuditLog.registerPromptArtifact(
                c.id, c.systemPrompt || ''
              );
              if (_s3PromptId) _s3SrcIds.push(_s3PromptId);
              const _s3LogId = await window.AuditLog.write('ending_stage3', {
                character_id:       c.id,
                participation_flags: entry.participation,
                system_prompt_full: sp,
                user_content:       uc,
                raw_ai_output:      JSON.stringify(r),
                parsed_action:      r.action || '',
                parsed_line:        r.line   || '',
                parsed_reason:      r.reason || '',
              }, {
                label:     (c.name || c.id) + '\u00B7\u7EC8\u5C40\u9636\u6BB53',
                loopPhase: 'loop_' + getCurrentLoopIndex() + '_stage3',
                sourceIds: _s3SrcIds,
              });
              if (_s3LogId) window.AuditLog.setStage3LogId(c.id, _s3LogId);
            } catch (_s3Err) {
              console.warn('[AuditLog] ending_stage3 log failed', _s3Err);
            }
          })();
        }
        /* ─────────────────────────────────────────────────────── */
      } catch (err) {
        if (isAbortError(err)) {
          console.log(`[abort] ending stage 3 cancelled for ${c.id}`);
          return;
        }
        console.error(`[ending.js] stage 3 ${c.id}`, err);
        const errType = err && err.name ? err.name : "Error";
        const errMsg = err && err.message ? String(err.message) : String(err);
        p3Results[c.id] = { action: `(获取失败 · ${errType})`, line: errMsg.slice(0, 60), reason: errMsg };
        fillSlot(entry.slot, `(获取失败 · ${errType})`, errMsg.slice(0, 60));
        /* ─── AuditLog: ending_stage3 失败 ──────────────────────── */
        if (window.AuditLog) {
          window.AuditLog.write('ending_stage3', {
            character_id:       c.id,
            participation_flags: entry.participation,
            system_prompt_full: null,
            user_content:       null,
            raw_ai_output:      null,
            parsed_action:      null,
            parsed_line:        null,
            parsed_reason:      null,
          }, {
            label:     (c.name || c.id) + '\u00B7\u7EC8\u5C40\u9636\u6BB53',
            status:    'error',
            error:     errMsg,
            loopPhase: 'loop_' + getCurrentLoopIndex() + '_stage3',
            sourceIds: window.AuditLog.getAllDialogueLogIds(c.id),
          }).catch(function (_) {});
        }
        /* ─────────────────────────────────────────────────────── */
      }
    }
    endingState.stage3Results = p3Results;

    endingPostStagePromise = runEndingPostStage(
      characters,
      histories,
      p3Results,
      participationMap,
      callGemini,
      signal,
    );
    void endingPostStagePromise;
  }

  /* ═══════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════ */

  async function runEnding() {
    if (!DialogueState) return;
    if (typeof DialogueState.abortAllRequests === "function") {
      DialogueState.abortAllRequests("ending-start");
    }
    const controller = createEndingController();

    const btn = document.getElementById("ending-button");
    if (btn) { btn.disabled = true; btn.textContent = "事件进行中…"; }

    const snap           = DialogueState.getSnapshot();
    endingState.dialogueSnapshot = snap;
    const characters     = snap.characters  || [];
    const histories      = snap.dialogueHistories || {};
    const callGemini     = DialogueState.callGemini;

    // F-004a：终局触发的同时 append 当前周目的 fallback 日记 entry。
    // 这样无论用户多快点击「保存轮回记忆」/「直接开启下一轮次」，
    // archive.notebook 都已包含当前轮。F-004c 后由 AI 真生成路径覆盖。
    try {
      appendCurrentLoopFallbackEntry();
    } catch (err) {
      console.error("[ending.js] append fallback notebook entry failed", err);
    }

    createOverlay();
    await runProducer(characters, histories, callGemini, controller.signal);
  }

  function setupEndingButton() {
    const btn = document.getElementById("ending-button");
    if (!btn) return;
    const DS = window.DialogueState;
    btn.addEventListener("click", () => {
      if (endingState.triggered) return;
      if (!DS || typeof DS.advanceOrTriggerEnding !== "function") return;
      const action = DS.advanceOrTriggerEnding();
      if (action === "trigger-ending") {
        endingState.triggered = true;
        void runEnding();
      }
    });
    window.addEventListener("beforeunload", () => {
      abortEndingRequests("beforeunload");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupEndingButton);
  } else {
    setupEndingButton();
  }

  endingState.retryCurrentLoopNotebookGeneration = retryCurrentLoopNotebookGeneration;
  window.EndingState = endingState;
})();

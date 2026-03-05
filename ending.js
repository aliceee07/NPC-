(function () {
  const DialogueState = window.DialogueState;

  const endingState = {
    triggered: false,
    stage2Results: {},
    stage3Results: {},
    dialogueSnapshot: null,
  };

  /* ═══════════════════════════════════════════════════════════
     QUEUE  —  4 entries, one per screen:
       0: phase 1 (all static)
       1: phase 2 (slots fill reactively as API returns)
       2: phase 3 (same)
       3: epilogue
     All entries are pushed immediately so the user can page
     forward even before API results arrive; slots update in-place.
  ═══════════════════════════════════════════════════════════ */

  const queue  = [];
  let   cursor = -1;
  let   autoTimer = null;

  const AUTO_MS = 60_000;
  const TICK_MS = 100;

  function enqueue(data) { queue.push({ data }); }

  /* ─── Auto-advance timer (per screen) ─────────────────────── */

  function startAutoTimer() {
    clearAutoTimer();
    let elapsed = 0;
    setProgress(1);
    autoTimer = setInterval(() => {
      elapsed += TICK_MS;
      setProgress(1 - elapsed / AUTO_MS);
      if (elapsed >= AUTO_MS) advance();
    }, TICK_MS);
  }

  function clearAutoTimer() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    setProgress(0);
  }

  function setProgress(f) {
    const el = document.getElementById("eo-progress-fill");
    if (el) el.style.width = Math.max(0, Math.min(1, f) * 100) + "%";
  }

  /* ─── Advance (click or timer) ─────────────────────────────── */

  function advance() {
    clearAutoTimer();
    const next = cursor + 1;
    if (next >= queue.length) return;
    cursor = next;
    renderEntry(queue[next].data);
    if (queue[next].data.type !== "epilogue") startAutoTimer();
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
    if (!slot.domEl) return;

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
      if (e.target.closest(".eo-actions")) return; // don't advance when clicking buttons
      advance();
    });

    requestAnimationFrame(() => ov.classList.add("eo-visible"));
    return ov;
  }

  function setHint(text) {
    const el = document.getElementById("eo-hint");
    if (el) el.textContent = text;
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
    }, 220);

    setHint(data.type === "epilogue" ? "" : "点击任意位置继续");
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

    // Character slots
    const slotsWrap = document.createElement("div");
    slotsWrap.className = "eo-char-slots";
    data.slots.forEach((slot) => {
      const el = buildSlotEl(slot);
      slot.domEl = el;
      slotsWrap.appendChild(el);
    });
    wrap.appendChild(slotsWrap);

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

    const actions = document.createElement("div");
    actions.className = "eo-actions";

    const exportBtn = document.createElement("button");
    exportBtn.className = "eo-btn";
    exportBtn.textContent = "导出对话记录";
    exportBtn.addEventListener("click", doExport);

    const newBtn = document.createElement("button");
    newBtn.className = "eo-btn eo-btn-secondary";
    newBtn.textContent = "开启新对话";
    newBtn.addEventListener("click", () => location.reload());

    actions.appendChild(exportBtn);
    actions.appendChild(newBtn);
    wrap.appendChild(actions);
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════
     EXPORT
  ═══════════════════════════════════════════════════════════ */

  function doExport() {
    const snap = endingState.dialogueSnapshot;
    if (!snap) return;

    const lines = [];
    const now   = new Date().toLocaleString("zh-CN");

    lines.push("流浪者与三个路人 — 本轮对话记录");
    lines.push(`导出时间：${now}`);
    lines.push("=".repeat(48));
    lines.push("");

    snap.characters.forEach((c) => {
      lines.push(`【${c.name || c.id}】`);
      lines.push("─".repeat(32));

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

      const p2 = endingState.stage2Results[c.id] || {};
      lines.push(`阶段 2  ${p2.action || "（未知）"}`);
      if (p2.line) lines.push(`        「${p2.line}」`);

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
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
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

  /* ═══════════════════════════════════════════════════════════
     PRODUCER  —  sequential API calls, fills slots reactively
  ═══════════════════════════════════════════════════════════ */

  async function runProducer(characters, histories, callGemini) {

    /* Build all slots upfront */
    const p1Slots = characters.map((c) =>
      makeSlot(c, `站在原地，神色${colorMood(getColor(c))}。`, "", true));
    const p2Slots = characters.map((c) => makeSlot(c, null, null, false));
    const p3Slots = characters.map((c) => makeSlot(c, null, null, false));

    /* Push all 4 screens immediately */
    enqueue({ type: "phase", label: "阶段 一",
      desc: "街角的碰撞与口角。你继续往前走，身侧突然传来一声不满的骂声——空气里有什么轻微地炸开了。",
      slots: p1Slots });

    enqueue({ type: "phase", label: "阶段 二",
      desc: "几个人把你按在地上，开始殴打。每一个路人都能清楚地看到这一切。",
      slots: p2Slots });

    enqueue({ type: "phase", label: "阶段 三",
      desc: "其中一个人慢慢掏出了刀。局势在这一秒急剧升级——可能有人会死。",
      slots: p3Slots });

    enqueue({ type: "epilogue", label: "那一刻，他们各自做了什么" });

    /* Show phase 1 immediately */
    advance();

    /* ── Phase 2 API calls ─────────────────────────────────── */
    const p2Results = {};

    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      await sleep(2000);
      try {
        const sp = [
          c.systemPrompt || "",
          "",
          "【当前事件阶段说明】",
          "阶段 2：玩家被几个人按在地上殴打，你就在几步之外，能够清楚看到这一切。",
          "请结合你与玩家刚才的全部对话历史，判断你在这个时刻会做出怎样的第一反应。",
          "",
          "回答时只需要根据给定的 JSON schema 返回数据，不要加入多余解释。",
        ].join("\n");
        const uc = [
          "事件阶段 2：玩家被按在地上殴打。",
          "你看到这一切的当下，会做什么？会说一句什么话？为什么？",
          "",
          "【你和玩家的对话历史】",
          histText(histories, c.id) || "（你与玩家之间几乎没有实质对话。）",
        ].join("\n");

        const r = await callGemini({
          label: `${c.name || c.id} · 终局阶段 2`,
          systemPrompt: sp,
          messages: [{ role: "user", content: uc }],
          responseSchema: SCHEMA,
        });

        p2Results[c.id] = r;
        fillSlot(p2Slots[i], r.action || "", r.line || "");
      } catch (err) {
        p2Results[c.id] = { action: "（获取失败）", line: "", reason: String(err) };
        fillSlot(p2Slots[i], "（获取失败）", "");
      }
    }
    endingState.stage2Results = p2Results;

    /* ── Phase 3 API calls ─────────────────────────────────── */
    const p3Results = {};

    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      await sleep(2000);
      try {
        const p2 = p2Results[c.id] || {};
        const sp = [
          c.systemPrompt || "",
          "",
          "【当前事件阶段说明】",
          "阶段 3：其中一名袭击者掏出了刀，局势急剧升级，可能会有人受重伤甚至死亡。",
          "请结合你与玩家的对话历史、你刚才在阶段 2 的行为，判断你在这一刻会做什么。",
          "",
          `你在阶段 2 的行为是：${p2.action || "（未知）"}`,
          "",
          "回答时只需要根据给定的 JSON schema 返回数据，不要加入多余解释。",
        ].join("\n");
        const uc = [
          "事件阶段 3：袭击者掏出了刀，情况非常危险。",
          "在这个瞬间，你的最终选择是什么？你会说出怎样的一句话？为什么？",
          "",
          "【你和玩家的对话历史】",
          histText(histories, c.id) || "（你与玩家之间几乎没有实质对话。）",
        ].join("\n");

        const r = await callGemini({
          label: `${c.name || c.id} · 终局阶段 3`,
          systemPrompt: sp,
          messages: [{ role: "user", content: uc }],
          responseSchema: SCHEMA,
        });

        p3Results[c.id] = r;
        fillSlot(p3Slots[i], r.action || "", r.line || "");
      } catch (err) {
        p3Results[c.id] = { action: "（获取失败）", line: "", reason: String(err) };
        fillSlot(p3Slots[i], "（获取失败）", "");
      }
    }
    endingState.stage3Results = p3Results;
  }

  /* ═══════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════ */

  async function runEnding() {
    if (!DialogueState) return;

    const btn = document.getElementById("ending-button");
    if (btn) { btn.disabled = true; btn.textContent = "事件进行中…"; }

    const snap           = DialogueState.getSnapshot();
    endingState.dialogueSnapshot = snap;
    const characters     = snap.characters  || [];
    const histories      = snap.dialogueHistories || {};
    const callGemini     = DialogueState.callGemini;

    createOverlay();
    await runProducer(characters, histories, callGemini);
  }

  function setupEndingButton() {
    const btn = document.getElementById("ending-button");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (endingState.triggered) return;
      endingState.triggered = true;
      runEnding();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupEndingButton);
  } else {
    setupEndingButton();
  }

  window.EndingState = endingState;
})();

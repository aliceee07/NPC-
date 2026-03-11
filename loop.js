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

  const loopState = {
    currentLoopIndex: 1,
  };

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
      ov.classList.add("ls-fading");
      ov.addEventListener("transitionend", function onEnd(e) {
        if (e.target !== ov) return;
        ov.removeEventListener("transitionend", onEnd);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (onDone) onDone();
      });
      // 防止 transitionend 因某些情况不触发时挂死
      setTimeout(function () {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (onDone) onDone();
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

    loopState.currentLoopIndex = archive.loop_index;
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

    dismissOverlay(ov, 1500, releaseInterceptor);
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
    ov.appendChild(optionsWrap);

    /* ── 导入区（隐藏，点 B 后显示） ── */
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
      releaseInterceptor();
      dismissOverlay(ov, 0, null);
    });

    /* ── 选项 B：继续记忆 → 展示导入区 ── */
    optB.addEventListener("click", function () {
      optionsWrap.style.display = "none";
      importBox.classList.remove("ls-import-box--hidden");
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
          releaseInterceptor();
          dismissOverlay(ov, 0, null);
        }, 2000);
        return;
      }

      // 注入数据
      loopState.currentLoopIndex = archive.loop_index + 1;
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

      releaseInterceptor();
      dismissOverlay(ov, 3000, null);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     ENTRY POINT
  ═══════════════════════════════════════════════════════════ */

  (function init() {
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
  };
})();

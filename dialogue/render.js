(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function scrollDialogueToBottom() {
    const el = document.getElementById("dialogue-history");
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderSceneCharacters() {
    D.core.state.characters.forEach((c, i) => {
      const circle = document.getElementById(`npc-${i + 1}`);
      if (!circle) return;
      if (c.currentColor) circle.style.backgroundColor = c.currentColor;
      circle.classList.toggle("active", c.id === D.core.state.currentCharacterId);
      const atFull = (c.currentCandor || 0) >= (c.maxCandor || D.core.NPC_CONFIG.MAX_CANDOR);
      circle.classList.toggle("at-full-candor", atFull);
    });
  }

  function renderCharacterButtons() {
    document.querySelectorAll(".character-button").forEach((btn) => {
      const id = btn.getAttribute("data-character-id");
      const passed = D.core.isPassed(id);
      const unlocked = D.core.isUnlocked(id);
      btn.classList.toggle("active", id === D.core.state.currentCharacterId);
      const closedDial = unlocked && !passed && D.core.isCharacterClosed(id);
      btn.classList.toggle("closed", closedDial);
      btn.classList.toggle("is-passed", passed);
      btn.classList.toggle("is-locked", !unlocked && !passed);

      const canEnter = unlocked || passed;
      btn.disabled = !canEnter;
      if (passed) {
        btn.title = "已经离开";
      } else if (!unlocked) {
        btn.title = "先和前面的人说点什么";
      } else {
        btn.removeAttribute("title");
      }
    });
  }

  function buildMessageRow(msg) {
    const row = document.createElement("div");
    const roleClass =
      msg.role === "user"  ? "player" :
      msg.role === "error" ? "system error" :
      msg.role === "system"? "system" : "npc";
    row.className = `message-row ${roleClass}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (msg.role !== "system" && msg.role !== "error") {
      const meta = document.createElement("span");
      meta.className = "message-meta";
      meta.textContent = msg.role === "user" ? "你" : "对方";
      bubble.appendChild(meta);
    }

    const text = document.createElement("div");
    text.textContent = msg.content;

    bubble.appendChild(text);
    row.appendChild(bubble);
    return row;
  }

  function appendMessageToDom(msg) {
    const container = document.getElementById("dialogue-history");
    if (!container) return;

    const empty = container.querySelector(".dialogue-empty");
    if (empty) empty.remove();

    container.appendChild(buildMessageRow(msg));
    scrollDialogueToBottom();
  }

  function renderDialogueHistory() {
    const container = document.getElementById("dialogue-history");
    if (!container) return;

    const history = D.core.state.dialogueHistories[D.core.state.currentCharacterId] || [];
    container.innerHTML = "";

    if (history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dialogue-empty";
      empty.textContent = "选择角色，开始对话。";
      container.appendChild(empty);
      return;
    }

    history.forEach((msg) => {
      container.appendChild(buildMessageRow(msg));
    });

    scrollDialogueToBottom();
  }

  function updateClosingHint() {
    const el = document.getElementById("closing-hint");
    if (!el) return;
    const id     = D.core.state.currentCharacterId;
    const streak = D.core.state.closingStreaks[id] || 0;
    if (D.core.isCharacterClosed(id)) {
      el.textContent = "对方已经不想再和你说话了。";
    } else if (streak >= 2) {
      el.textContent = "对方好像不太想继续聊下去了。";
    } else {
      el.textContent = "";
    }
  }

  function syncDialogueReadOnlyClass() {
    const panel = document.querySelector(".dialogue-panel");
    if (panel) panel.classList.toggle("is-readonly", !!D.core.state.readOnly);
  }

  function updateInputState(sending) {
    const textarea = document.getElementById("player-input");
    const sendBtn  = document.getElementById("send-button");
    const endBtn   = document.getElementById("ending-button");
    const closed   = D.core.isCharacterClosed(D.core.state.currentCharacterId);
    const ro       = D.core.state.readOnly;
    const thinking = !!sending || D.core.isCurrentCharacterThinking();

    syncDialogueReadOnlyClass();

    if (textarea) {
      textarea.disabled = closed || ro || thinking;
      if (ro) {
        textarea.placeholder = "对话已结束，仅可查看";
      } else if (thinking) {
        textarea.placeholder = "对方正在思考中…";
      } else {
        textarea.placeholder = closed
          ? "对方已经关闭了对话。"
          : "你想对他说什么？（Ctrl + Enter 发送）";
      }
    }
    if (sendBtn) {
      sendBtn.disabled = closed || ro || thinking;
      sendBtn.textContent = ro
        ? "（已离开此人）"
        : thinking
          ? "思考中…"
          : "说出这句";
    }
    if (endBtn) endBtn.disabled = false;
    syncQuickReplyUi(sending);
  }

  function getCurrentLoopIndexForQuickReply() {
    try {
      if (window.LoopState && typeof window.LoopState.getLoopIndex === "function") {
        const v = window.LoopState.getLoopIndex();
        if (Number.isFinite(v) && v >= 1) return Math.floor(v);
      }
    } catch (_) { /* ignore */ }
    return 1;
  }

  function syncQuickReplyUi(sending) {
    const wrap = document.getElementById("quick-replies");
    if (!wrap) return;
    const char = D.core.getActiveCharacter();
    if (!char) {
      wrap.hidden = true;
      return;
    }
    const cid = char.id;
    const showQuick = D.core.isUnlocked(cid) && !D.core.isPassed(cid) && !D.core.state.readOnly;
    wrap.hidden = !showQuick;
    if (!showQuick) return;
    let list = null;
    try {
      if (window.LoopScript && typeof window.LoopScript.getQuickReplies === "function") {
        list = window.LoopScript.getQuickReplies(cid, getCurrentLoopIndexForQuickReply());
      }
    } catch (_) { list = null; }
    if (!Array.isArray(list) || list.length === 0) {
      list = Array.isArray(char.quickReplies) ? char.quickReplies : [];
    }
    wrap.querySelectorAll(".quick-reply-button").forEach((btn, i) => {
      const line = list[i] || "";
      btn.textContent = line;
      btn.dataset.quickText = line;
      const closedChat = D.core.isCharacterClosed(cid);
      btn.disabled = !line || closedChat || D.core.isCharacterThinking(cid);
    });
  }

  function setSending(on) {
    updateInputState(on);
  }

  D.render = {
    scrollDialogueToBottom,
    renderSceneCharacters,
    renderCharacterButtons,
    buildMessageRow,
    appendMessageToDom,
    renderDialogueHistory,
    updateClosingHint,
    syncDialogueReadOnlyClass,
    updateInputState,
    getCurrentLoopIndexForQuickReply,
    syncQuickReplyUi,
    setSending,
  };
})();

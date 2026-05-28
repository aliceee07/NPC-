(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function appendAiOutput(entry) {
    const list = document.getElementById("ai-output-list");
    if (!list) return;

    const empty = list.querySelector(".ai-output-empty");
    if (empty) empty.remove();

    const item = document.createElement("div");
    item.className = "ai-output-item";
    if (entry.error || entry.statusType === "error") {
      item.classList.add("is-error");
    } else if (entry.statusType === "success") {
      item.classList.add("is-success");
    } else if (entry.statusType === "info") {
      item.classList.add("is-info");
    }

    const header = document.createElement("div");
    header.className = "ai-output-item-header";

    const labelEl = document.createElement("span");
    labelEl.className = "ai-output-label";
    labelEl.textContent = entry.label || "AI 响应";

    const timeEl = document.createElement("span");
    timeEl.className = "ai-output-time";
    timeEl.textContent = new Date().toLocaleTimeString("zh-CN");

    header.appendChild(labelEl);
    header.appendChild(timeEl);
    item.appendChild(header);

    if (entry.error) {
      const errEl = document.createElement("div");
      errEl.className = "ai-output-error-body";
      errEl.textContent = entry.error;
      item.appendChild(errEl);
    }

    if (entry.parsed && (entry.statusType === "info" || entry.statusType === "success")) {
      const infoEl = document.createElement("div");
      infoEl.className = "ai-output-info-body";
      infoEl.textContent =
        typeof entry.parsed === "string"
          ? entry.parsed
          : JSON.stringify(entry.parsed, null, 2);
      item.appendChild(infoEl);
    }

    if (entry.thinking) {
      const details = document.createElement("details");
      details.className = "ai-section thinking";
      details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = "思考过程";

      const body = document.createElement("div");
      body.className = "ai-section-body";

      const pre = document.createElement("pre");
      pre.className = "ai-pre thinking-pre";
      pre.textContent = entry.thinking;

      body.appendChild(pre);
      details.appendChild(summary);
      details.appendChild(body);
      item.appendChild(details);
    }

    if (entry.rawJson) {
      const details = document.createElement("details");
      details.className = "ai-section";

      const summary = document.createElement("summary");
      summary.textContent = "原始响应 JSON";

      const body = document.createElement("div");
      body.className = "ai-section-body";

      const pre = document.createElement("pre");
      pre.className = "ai-pre";
      pre.textContent = JSON.stringify(entry.rawJson, null, 2);

      body.appendChild(pre);
      details.appendChild(summary);
      details.appendChild(body);
      item.appendChild(details);
    }

    if (
      entry.parsed &&
      entry.statusType !== "info" &&
      entry.statusType !== "success"
    ) {
      const parsedSection = document.createElement("div");
      parsedSection.className = "ai-parsed-section";

      const parsedLabel = document.createElement("div");
      parsedLabel.className = "ai-parsed-label";
      parsedLabel.textContent = "解析结果";

      const pre = document.createElement("pre");
      pre.className = "ai-pre parsed-pre";
      pre.textContent = JSON.stringify(entry.parsed, null, 2);

      parsedSection.appendChild(parsedLabel);
      parsedSection.appendChild(pre);
      item.appendChild(parsedSection);
    }

    if (entry.usage) {
      const usageEl = document.createElement("div");
      usageEl.className = "ai-usage";

      const fmt = (label, count) => {
        const s = document.createElement("span");
        s.innerHTML = `<span style="color:#444">${label}</span> ${count ?? "—"}`;
        return s;
      };

      usageEl.appendChild(fmt("输入", entry.usage.promptTokenCount));
      usageEl.appendChild(fmt("输出", entry.usage.candidatesTokenCount));
      if (entry.usage.thoughtsTokenCount != null) {
        usageEl.appendChild(fmt("思考", entry.usage.thoughtsTokenCount));
      }
      item.appendChild(usageEl);
    }

    list.insertBefore(item, list.firstChild);
  }

  D.output = {
    appendAiOutput,
  };
})();

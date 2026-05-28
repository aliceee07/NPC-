(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  function isAbortError(err) {
    return !!err && (err.name === "AbortError" || err.code === 20);
  }

  function isLocalAbortError(err, controller) {
    return isAbortError(err) &&
      !!controller &&
      !!controller.signal &&
      D.core.locallyAbortedSignals.has(controller.signal);
  }

  function formatErrorSummary(err) {
    const name = err && err.name ? err.name : "Error";
    const message = err && err.message ? String(err.message) : String(err);
    const shortMessage = message.length > D.core.ERROR_MESSAGE_MAX_LENGTH
      ? message.slice(0, D.core.ERROR_MESSAGE_MAX_LENGTH) + "..."
      : message;
    return `${name}: ${shortMessage}`;
  }

  function isApiDebugEnabled() {
    try {
      return localStorage.getItem(D.core.API_DEBUG_LS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function logApi(tag, message, data) {
    const prefix = `[NPC API · ${tag}]`;
    if (data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  function formatErrorDetail(err, context) {
    const lines = [formatErrorSummary(err)];
    const msg = err && err.message ? String(err.message) : "";
    if (/failed to fetch/i.test(msg)) {
      lines.push(
        "提示：浏览器没能连上 API（还没收到 HTTP 状态码）。",
        "常见原因：代理/VPN、公司网络拦截、或 api.siliconflow.cn 不可达。",
        "建议：F12 → Network 看 completions 请求；或关代理、换手机热点再试。"
      );
    }
    if (err && err.name === "NetworkUnreachableError") {
      lines.push(
        "【原因】浏览器无法直连 api.siliconflow.cn（常见于 localhost 安全策略）。",
        "【建议】请用「一键启动.bat」打开页面（会自动走本地代理）；或运行「网络诊断.bat」。"
      );
    }
    if (err && err.name === "TimeoutError") {
      lines.push(
        "【原因】在允许的时间内没有任何 HTTP 响应（不是 Key 错；Key 错通常会几秒内返回 401）。",
        "【常见】代理/VPN/Clash/Mihomo 拦截、公司网屏蔽、或浏览器走代理与系统不一致。",
        "【建议】① 双击运行项目里的「网络诊断.bat」看本机能否连上硅基",
        "        ② Windows 设置 → 网络和 Internet → 代理 → 关闭代理",
        "        ③ 手机热点再试  ④ 有 Mihomo/Clash 时给 api.siliconflow.cn 设 DIRECT"
      );
      if (context && context.probe) {
        lines.push("【探测】 " + JSON.stringify(context.probe));
      }
    }
    if (context) {
      if (context.url) lines.push("URL: " + context.url);
      if (context.provider) lines.push("来源: " + context.provider);
      if (context.model) lines.push("模型: " + context.model);
      if (context.elapsedMs != null) lines.push("耗时: " + context.elapsedMs + " ms");
    }
    return lines.join("\n");
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const ms = timeoutMs || D.core.API_FETCH_TIMEOUT_DIALOGUE_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const external = options && options.signal;
    if (external) {
      if (external.aborted) {
        clearTimeout(timer);
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      external.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted && !(external && external.aborted)) {
        const timeoutErr = new Error(
          `请求超时（已等待约 ${Math.round(ms / 1000)} 秒仍无响应）。对话生成较慢时可再试，或换更小/更快模型。`
        );
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      D.core.debugLog(
        "dialogue.js:fetchWithTimeout",
        "fetch-error",
        {
          url: url,
          method: (options && options.method) || "GET",
          errorName: err && err.name ? err.name : "",
          errorMessage: err && err.message ? String(err.message) : String(err),
          timeoutMs: ms,
        },
        "H2"
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeSiliconFlowReachable() {
    const url = D.core.getSiliconFlowApiUrl();
    const viaProxy = D.core.isLocalDevOrigin();
    const pageOrigin =
      typeof location !== "undefined" ? location.origin : "unknown";

    D.core.debugLog(
      "dialogue.js:probeSiliconFlowReachable",
      "probe-start",
      {
        pageOrigin: pageOrigin,
        pageProtocol:
          typeof location !== "undefined" ? location.protocol : "unknown",
        ua: (typeof navigator !== "undefined" && navigator.userAgent
          ? navigator.userAgent.slice(0, 120)
          : ""),
      },
      "H2"
    );

    async function tryProbe(label, fetchOptions, hypothesisId) {
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(url, fetchOptions, D.core.API_FETCH_TIMEOUT_PROBE_MS);
        const out = {
          ok: true,
          label: label,
          status: res.status,
          httpOk: res.ok,
          elapsedMs: Date.now() - t0,
        };
        D.core.debugLog(
          "dialogue.js:probeSiliconFlowReachable",
          label + "-success",
          out,
          hypothesisId
        );
        return out;
      } catch (err) {
        const out = {
          ok: false,
          label: label,
          elapsedMs: Date.now() - t0,
          errorName: err && err.name ? err.name : "",
          errorMessage: err && err.message ? String(err.message) : String(err),
        };
        D.core.debugLog(
          "dialogue.js:probeSiliconFlowReachable",
          label + "-fail",
          out,
          hypothesisId
        );
        return out;
      }
    }

    let optionsProbe;
    let postProbe;
    let postReachable;
    let summary;
    try {
      optionsProbe = await tryProbe(
        "OPTIONS",
        { method: "OPTIONS", mode: "cors" },
        "H1"
      );
      postProbe = await tryProbe(
        "POST",
        {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer sk-test-invalid",
          },
          body: JSON.stringify({
            model: "Qwen/Qwen2.5-7B-Instruct",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
        },
        "H2"
      );

      postReachable =
        postProbe.ok && (postProbe.status === 401 || postProbe.httpOk);
      summary = {
        ok: postReachable || optionsProbe.ok,
        viaProxy: viaProxy,
        status: postProbe.status || optionsProbe.status,
        elapsedMs: postProbe.elapsedMs || optionsProbe.elapsedMs,
        error: postReachable
          ? undefined
          : formatErrorSummary({
              name: postProbe.errorName || optionsProbe.errorName,
              message: postProbe.errorMessage || optionsProbe.errorMessage,
            }),
        options: optionsProbe,
        post: postProbe,
        postReachable: postReachable,
      };
    } catch (err) {
      summary = {
        ok: false,
        viaProxy: viaProxy,
        error: formatErrorSummary(err),
        options: optionsProbe || null,
        post: postProbe || null,
        postReachable: false,
      };
    }

    D.core.debugLog(
      "dialogue.js:probeSiliconFlowReachable",
      "probe-summary",
      summary,
      "H1"
    );

    return summary;
  }

  function abortCharacterRequest(charId, reason) {
    const controller = D.core.state.activeRequests[charId];
    if (!controller) return false;

    console.log(`[abort] ${charId} request cancelled by ${reason || "unknown"}`);
    D.core.locallyAbortedSignals.add(controller.signal);
    controller.abort();
    delete D.core.state.activeRequests[charId];
    return true;
  }

  function abortAllRequests(reason) {
    Object.keys(D.core.state.activeRequests).forEach((charId) => {
      abortCharacterRequest(charId, reason || "abort-all");
    });
    if (D.render && typeof D.render.updateInputState === "function") {
      D.render.updateInputState(false);
    }
  }

  D.request = {
    isAbortError,
    isLocalAbortError,
    formatErrorSummary,
    isApiDebugEnabled,
    logApi,
    formatErrorDetail,
    fetchWithTimeout,
    probeSiliconFlowReachable,
    abortCharacterRequest,
    abortAllRequests,
  };
})();

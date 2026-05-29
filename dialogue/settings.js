(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  const PROVIDER_DEFAULTS = {
    gemini: {
      modelPlaceholder: "如 gemini-2.0-flash / gemini-2.5-pro-preview",
      modelDefault: () => window.GEMINI_PRESET_MODEL || "gemini-2.0-flash",
      keyPlaceholder: "粘贴 Gemini API Key（保存在本机浏览器）",
      hint: "支持思考的模型将在侧边栏显示思考过程",
    },
    siliconflow: {
      modelPlaceholder: "如 Qwen/Qwen2.5-72B-Instruct / deepseek-ai/DeepSeek-V3",
      modelDefault: () => window.SILICONFLOW_PRESET_MODEL || "Qwen/Qwen2.5-72B-Instruct",
      keyPlaceholder: "粘贴硅基流动 API Key（保存在本机浏览器）",
      hint: "硅基流动兼容 OpenAI 接口，支持多种开源模型",
    },
  };

  const LS_API_PROVIDER = "npc_api_provider";
  const LS_API_MODEL = "npc_api_model";
  const LS_API_KEY = "npc_api_key";

  function persistApiConfigCache() {
    try {
      const providerSelect = document.getElementById("api-provider-select");
      const keyInput = document.getElementById("api-key-input");
      const modelInput = document.getElementById("model-name-input");
      if (providerSelect && providerSelect.value) {
        localStorage.setItem(LS_API_PROVIDER, providerSelect.value);
      }
      if (modelInput) {
        localStorage.setItem(LS_API_MODEL, modelInput.value.trim());
      }
      if (keyInput) {
        let key = keyInput.value.trim();
        if (!key) {
          const provider =
            (providerSelect && providerSelect.value) ||
            window.AI_PROVIDER ||
            "gemini";
          key =
            provider === "siliconflow"
              ? (window.SILICONFLOW_PRESET_KEY || "")
              : (window.GEMINI_PRESET_KEY || "");
        }
        if (key) {
          localStorage.setItem(LS_API_KEY, key);
        }
      }
    } catch (_) {}
  }

  function restoreApiConfigCache() {
    let savedProvider = "";
    let savedModel = "";
    let savedApiKey = "";
    try {
      savedProvider = localStorage.getItem(LS_API_PROVIDER) || "";
      savedModel = localStorage.getItem(LS_API_MODEL) || "";
      savedApiKey = localStorage.getItem(LS_API_KEY) || "";
    } catch (_) {
      return;
    }

    const providerSelect = document.getElementById("api-provider-select");
    const keyInput = document.getElementById("api-key-input");
    const modelInput = document.getElementById("model-name-input");

    if (providerSelect) {
      const initialProvider = savedProvider || window.AI_PROVIDER || "gemini";
      providerSelect.value = initialProvider;
      applyProviderUi(initialProvider);
    }
    if (keyInput && savedApiKey) {
      keyInput.value = savedApiKey;
    }
    if (modelInput && savedModel) {
      modelInput.value = savedModel;
    }
  }

  function bindApiConfigPersistence() {
    const providerSelect = document.getElementById("api-provider-select");
    const keyInput = document.getElementById("api-key-input");
    const modelInput = document.getElementById("model-name-input");
    const save = () => persistApiConfigCache();

    if (providerSelect) {
      providerSelect.addEventListener("change", () => {
        applyProviderUi(providerSelect.value);
        save();
      });
    }
    if (keyInput) {
      keyInput.addEventListener("input", save);
      keyInput.addEventListener("change", save);
      keyInput.addEventListener("blur", save);
    }
    if (modelInput) {
      modelInput.addEventListener("input", save);
      modelInput.addEventListener("change", save);
    }

    if (!D.__apiConfigUnloadBound) {
      D.__apiConfigUnloadBound = true;
      window.addEventListener("pagehide", save);
      window.addEventListener("beforeunload", save);
    }
  }

  function applyProviderUi(provider) {
    const cfg = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.gemini;
    const keyInput   = document.getElementById("api-key-input");
    const modelInput = document.getElementById("model-name-input");
    const hintEl     = document.getElementById("model-hint");

    if (keyInput)   keyInput.placeholder   = cfg.keyPlaceholder;
    if (modelInput) {
      modelInput.placeholder = cfg.modelPlaceholder;
      const otherProvider = provider === "gemini" ? "siliconflow" : "gemini";
      const otherDefault  = PROVIDER_DEFAULTS[otherProvider].modelDefault();
      if (!modelInput.value.trim() || modelInput.value.trim() === otherDefault) {
        modelInput.value = cfg.modelDefault();
      }
    }
    if (hintEl) hintEl.textContent = cfg.hint;
  }

  function setup() {
    if (D.__setupDone) return;
    D.__setupDone = true;

    if (D.core.isLocalDevOrigin()) {
      D.output.appendAiOutput({
        label: "[系统] 本地模式",
        statusType: "info",
        parsed: {
          说明: "已启用硅基同源代理（绕过浏览器跨域限制）",
          API地址: D.core.getSiliconFlowApiUrl(),
        },
      });
    }

    document.querySelectorAll(".character-button").forEach((btn) => {
      btn.addEventListener("click", () =>
        D.flow.switchCharacter(btn.getAttribute("data-character-id"))
      );
    });

    const sendBtn = document.getElementById("send-button");
    if (sendBtn) sendBtn.addEventListener("click", D.flow.handleSend);

    document.querySelectorAll(".quick-reply-button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const line = btn.getAttribute("data-quick-text") || "";
        void D.flow.dispatchPlayerTurn(line);
      });
    });

    const textarea = document.getElementById("player-input");
    if (textarea) {
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          D.flow.handleSend();
        }
      });
    }

    restoreApiConfigCache();
    bindApiConfigPersistence();
    // reload 后偶发晚于 setup 的浏览器自动填充：延迟再同步一次
    setTimeout(function () {
      restoreApiConfigCache();
      persistApiConfigCache();
    }, 300);

    const testBtn = document.getElementById("test-gemini-btn");
    if (testBtn) {
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "测试中…";
        const provider = D.core.getApiProvider();
        const providerName = provider === "siliconflow" ? "SiliconFlow" : "Gemini";
        const modelName = D.core.getModelName();
        const label = `[测试连接] ${providerName}`;
        const progressLabel = `${label} · 进度`;
        const apiUrl =
          provider === "siliconflow"
            ? D.core.getSiliconFlowApiUrl()
            : "https://generativelanguage.googleapis.com/...";
        const t0 = Date.now();

        function reportProgress(step, extra) {
          const payload = { 步骤: step, ...(extra || {}) };
          D.request.logApi("测试连接", step, extra);
          D.output.appendAiOutput({
            label: progressLabel,
            statusType: "info",
            parsed: payload,
          });
        }

        reportProgress("① 开始", {
          来源: providerName,
          模型: modelName,
          已填Key: !!D.core.getApiKey(),
          测试模式: localStorage.getItem("npc_test_mode") === "1",
          API调试: D.request.isApiDebugEnabled(),
        });

        let probeResult = null;
        try {
          let testMode = false;
          try {
            testMode = localStorage.getItem("npc_test_mode") === "1";
          } catch (_) {
            testMode = false;
          }
          if (testMode) {
            throw new Error(
              "当前勾选了「测试模式」，不会发起真实网络请求。请取消勾选后再点测试连接。"
            );
          }
          if (!D.core.getApiKey()) {
            throw new Error(`${providerName} API Key 为空，无法测试真实连接。`);
          }

          if (provider === "siliconflow") {
            reportProgress("②-a 探测硅基服务器是否可达（约 12 秒）", {
              URL: apiUrl,
            });
            probeResult = await D.request.probeSiliconFlowReachable();
            reportProgress(
              probeResult.ok ? "②-a 探测通过" : "②-a 探测失败",
              probeResult
            );
            if (!probeResult.ok) {
              const probeErr = new Error(
                D.core.isLocalDevOrigin()
                  ? "本地代理探测失败。请确认用「一键启动.bat」启动（不要用纯 http.server），并查看 NPC-Demo-服务 窗口是否有报错。"
                  : "浏览器无法连接硅基 API。请运行「网络诊断.bat」检查网络。"
              );
              probeErr.name = "NetworkUnreachableError";
              probeErr.probe = probeResult;
              throw probeErr;
            }
          }

          reportProgress("②-b 发送测试对话（最多约 90 秒）", {
            URL: apiUrl,
            模型: modelName,
            说明: "与顶部输入框模型一致",
          });

          const result = await D.provider.callGemini({
            label,
            quietSidebarOnError: true,
            fetchTimeoutMs: D.core.API_FETCH_TIMEOUT_TEST_MS,
            systemPrompt: "你是一个简单的健康检查端点，只返回 JSON。",
            messages: [
              {
                role: "user",
                content: '请返回 {"ok": true, "message": "pong"} 这样的 JSON。',
              },
            ],
            responseSchema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                message: { type: "string" },
              },
              required: ["ok", "message"],
            },
          });

          reportProgress("③ 已收到响应，正在校验", {
            耗时ms: Date.now() - t0,
          });

          if (!result || result.ok !== true) {
            throw new Error("连接测试响应缺少 ok=true。");
          }

          D.output.appendAiOutput({
            label,
            statusType: "success",
            parsed: {
              结果: "连接成功",
              provider,
              message: result.message || "pong",
              耗时ms: Date.now() - t0,
            },
          });
          D.request.logApi("测试连接", "成功", { elapsedMs: Date.now() - t0 });
          if (window.AuditLog) {
            window.AuditLog.write("api_connectivity_test", {
              probe_result:   probeResult || null,
              system_prompt:  "你是一个简单的健康检查端点，只返回 JSON。",
              user_content:   '请返回 {"ok": true, "message": "pong"} 这样的 JSON。',
              raw_ai_output:  JSON.stringify(result),
              parsed_ok:      result && result.ok,
              parsed_message: result && result.message,
            }, {
              label:      label,
              status:     "ok",
              durationMs: Date.now() - t0,
              loopPhase:  "connectivity_test",
              model:      modelName,
              provider:   provider,
              sourceIds:  [],
            }).catch(function (_) {});
          }
        } catch (err) {
          console.error(`[NPC 测试连接] ${providerName} 失败`, err);
          D.output.appendAiOutput({
            label,
            statusType: "error",
            error: D.request.formatErrorDetail(err, {
              url: apiUrl,
              provider,
              model: modelName,
              elapsedMs: Date.now() - t0,
              probe: probeResult,
            }),
          });
          if (window.AuditLog) {
            window.AuditLog.write("api_connectivity_test", {
              probe_result:   probeResult || null,
              system_prompt:  "你是一个简单的健康检查端点，只返回 JSON。",
              user_content:   '请返回 {"ok": true, "message": "pong"} 这样的 JSON。',
              raw_ai_output:  null,
              parsed_ok:      false,
              parsed_message: null,
            }, {
              label:      label,
              status:     "error",
              error:      err && err.message ? String(err.message) : String(err),
              durationMs: Date.now() - t0,
              loopPhase:  "connectivity_test",
              model:      modelName,
              provider:   provider,
              sourceIds:  [],
            }).catch(function (_) {});
          }
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = "测试连接";
        }
      });
    }

    const clearBtn = document.getElementById("clear-output-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        const list = document.getElementById("ai-output-list");
        if (list) {
          list.innerHTML =
            '<p class="ai-output-empty">对话开始后，AI 的思考过程与原始输出将在此显示。</p>';
        }
      });
    }

    D.render.renderCharacterButtons();
    D.render.renderSceneCharacters();
    D.render.renderDialogueHistory();
    D.render.updateClosingHint();
    D.render.updateInputState(false);
  }

  D.settings = {
    PROVIDER_DEFAULTS,
    applyProviderUi,
    setup,
    persistApiConfigCache,
    restoreApiConfigCache,
  };
})();

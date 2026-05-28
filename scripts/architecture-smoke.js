#!/usr/bin/env node

(function () {
  "use strict";

  const fs = require("fs");
  const path = require("path");
  const vm = require("vm");

  const PROJECT_ROOT = path.resolve(__dirname, "..");
  const INDEX_PATH = path.join(PROJECT_ROOT, "index.html");
  /** Post-audit 链路的固定前缀/后缀；中间 dialogue/*.js 块从 index.html 动态提取。 */
  const POST_AUDIT_PREFIX = ["log-restore.js"];
  const POST_AUDIT_SUFFIX = ["dialogue.js", "ending.js", "loop.js"];
  /** 跨模块顺序约束：允许在 audit-log.js 之前插入新脚本，只要这些相对顺序仍成立。 */
  const ORDER_CONSTRAINTS = [
    ["characters.js", "dialogue/core.js"],
    ["audit-log.js", "log-restore.js"],
    ["log-restore.js", "dialogue/core.js"],
    ["dialogue.js", "ending.js"],
    ["ending.js", "loop.js"],
  ];
  const EXPECTED_DIALOGUE_STATE_API = [
    "getSnapshot",
    "getCharacters",
    "getDialogueHistories",
    "callGemini",
    "appendAiOutput",
    "patchCharacter",
    "resetForNewLoop",
    "abortAllRequests",
    "isUnlocked",
    "isPassed",
    "tryAdvanceUnlock",
    "advanceOrTriggerEnding",
  ];

  const results = [];

  function pass(name, detail) {
    results.push({ ok: true, name, detail });
  }

  function fail(name, detail) {
    results.push({ ok: false, name, detail });
  }

  function normalizeScriptPath(src) {
    return src.split(/[?#]/)[0].replace(/\\/g, "/").replace(/^\.\//, "");
  }

  function isExternalScript(src) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || src.startsWith("//");
  }

  function readText(relativePath) {
    return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8");
  }

  function parseScripts(html) {
    const scripts = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) {
      const attrs = match[1] || "";
      const srcMatch = attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
      if (srcMatch) {
        const rawSrc = srcMatch[2];
        scripts.push({
          kind: "external",
          rawSrc,
          srcPath: normalizeScriptPath(rawSrc),
          optional: /\bonerror\s*=/i.test(attrs),
          external: isExternalScript(rawSrc),
        });
      } else {
        scripts.push({ kind: "inline" });
      }
    }
    return scripts;
  }

  function buildDiff(expected, actual) {
    const max = Math.max(expected.length, actual.length);
    const lines = [];
    for (let i = 0; i < max; i += 1) {
      const exp = expected[i] || "<missing>";
      const got = actual[i] || "<missing>";
      const marker = exp === got ? " " : "!";
      lines.push(`${marker} ${String(i + 1).padStart(2, "0")} expected ${exp} | got ${got}`);
    }
    return lines.join("\n");
  }

  function checkScriptRefs(scripts) {
    const missing = [];
    const optionalMissing = [];
    scripts.forEach((script) => {
      if (script.kind !== "external" || script.external) return;
      const scriptPath = path.join(PROJECT_ROOT, script.srcPath);
      if (fs.existsSync(scriptPath)) return;
      if (script.optional) {
        optionalMissing.push(script.srcPath);
      } else {
        missing.push(script.srcPath);
      }
    });

    if (missing.length > 0) {
      fail("index.html script refs exist", "Missing required script files:\n" + missing.join("\n"));
      return;
    }

    const detail = optionalMissing.length > 0
      ? "Optional missing script(s), allowed by onerror: " + optionalMissing.join(", ")
      : "All local script refs exist.";
    pass("index.html script refs exist", detail);
  }

  function getLocalExternalScriptPaths(scripts) {
    return scripts
      .filter((script) => script.kind === "external" && !script.external && !script.optional)
      .map((script) => script.srcPath);
  }

  function extractDialogueStack(scriptPaths) {
    return scriptPaths.filter((srcPath) => srcPath.startsWith("dialogue/") && srcPath.endsWith(".js"));
  }

  function findScriptIndex(scripts, srcPath) {
    return scripts.findIndex((script) => script.kind === "external" && script.srcPath === srcPath);
  }

  function checkDialogueStackOnDisk(dialogueStack) {
    const errors = [];
    const dialogueDir = path.join(PROJECT_ROOT, "dialogue");
    if (!fs.existsSync(dialogueDir)) {
      return errors;
    }

    const onDisk = fs
      .readdirSync(dialogueDir)
      .filter((fileName) => fileName.endsWith(".js"))
      .map((fileName) => "dialogue/" + fileName)
      .sort();
    const inIndex = dialogueStack.slice().sort();

    onDisk
      .filter((filePath) => !inIndex.includes(filePath))
      .forEach((filePath) => errors.push("dialogue/*.js on disk but missing from index.html: " + filePath));
    inIndex
      .filter((filePath) => !onDisk.includes(filePath))
      .forEach((filePath) => errors.push("index.html references missing dialogue/*.js: " + filePath));

    return errors;
  }

  function checkDialogueStackContiguous(scriptPaths, dialogueStack) {
    const errors = [];
    if (dialogueStack.length === 0) {
      errors.push("No dialogue/*.js scripts found in index.html.");
      return errors;
    }

    const firstIdx = scriptPaths.indexOf(dialogueStack[0]);
    dialogueStack.forEach((filePath, index) => {
      if (scriptPaths.indexOf(filePath) !== firstIdx + index) {
        errors.push("dialogue/*.js must appear as one contiguous block in index.html; problem at " + filePath);
      }
    });
    return errors;
  }

  function checkOrderConstraints(scriptPaths) {
    const errors = [];
    ORDER_CONSTRAINTS.forEach(([before, after]) => {
      const beforeIdx = scriptPaths.indexOf(before);
      const afterIdx = scriptPaths.indexOf(after);
      if (beforeIdx >= 0 && afterIdx >= 0 && beforeIdx >= afterIdx) {
        errors.push(before + " must come before " + after);
      }
    });
    return errors;
  }

  function checkPostAuditChain(scriptPaths, dialogueStack) {
    const errors = [];
    const auditIdx = scriptPaths.indexOf("audit-log.js");
    const loopIdx = scriptPaths.indexOf("loop.js");
    if (auditIdx < 0 || loopIdx < 0) {
      return errors;
    }

    const afterAudit = scriptPaths.slice(auditIdx + 1, loopIdx + 1);
    const expected = POST_AUDIT_PREFIX.concat(dialogueStack, POST_AUDIT_SUFFIX);

    if (afterAudit.join("|") !== expected.join("|")) {
      errors.push(
        [
          "Post-audit script chain must be:",
          expected.join(" -> "),
          "",
          "Actual:",
          afterAudit.join(" -> "),
          "",
          "Diff:",
          buildDiff(expected, afterAudit),
        ].join("\n")
      );
    }

    return errors;
  }

  function checkScriptOrder(scripts, dialogueStack) {
    const scriptPaths = getLocalExternalScriptPaths(scripts);
    const errors = [];

    ["characters.js", "audit-log.js", "log-restore.js", "dialogue.js", "ending.js", "loop.js"].forEach((required) => {
      if (scriptPaths.indexOf(required) < 0) {
        errors.push("Missing required script in index.html: " + required);
      }
    });

    errors.push.apply(errors, checkOrderConstraints(scriptPaths));
    errors.push.apply(errors, checkDialogueStackOnDisk(dialogueStack));
    errors.push.apply(errors, checkDialogueStackContiguous(scriptPaths, dialogueStack));
    errors.push.apply(errors, checkPostAuditChain(scriptPaths, dialogueStack));

    const loopScriptIndex = findScriptIndex(scripts, "loop.js");
    if (loopScriptIndex >= 0) {
      const trailingExternal = scripts
        .slice(loopScriptIndex + 1)
        .filter((script) => script.kind === "external" && !script.external);
      if (trailingExternal.length > 0) {
        errors.push(
          "Only inline scripts may follow loop.js; found external scripts:\n" +
            trailingExternal.map((script) => script.srcPath).join("\n")
        );
      }
    }

    if (errors.length > 0) {
      fail("script order contract", errors.join("\n\n"));
      return;
    }

    const auditIdx = scriptPaths.indexOf("audit-log.js");
    const loopIdx = scriptPaths.indexOf("loop.js");
    const afterAudit = scriptPaths.slice(auditIdx + 1, loopIdx + 1);
    pass(
      "script order contract",
      "Validated from index.html: " + afterAudit.join(" -> ") + " -> <inline only>"
    );
  }

  function createElementStub(tagName) {
    return {
      tagName: String(tagName || "").toUpperCase(),
      style: {},
      dataset: {},
      className: "",
      hidden: false,
      disabled: false,
      textContent: "",
      innerHTML: "",
      value: "",
      children: [],
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      insertBefore(child) {
        return this.appendChild(child);
      },
      remove() {},
      removeAttribute() {},
      setAttribute() {},
      getAttribute() {
        return null;
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      focus() {},
    };
  }

  function createDocumentStub() {
    const body = createElementStub("body");
    return {
      readyState: "loading",
      body,
      createElement: createElementStub,
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
    };
  }

  function createLocalStorageStub() {
    const store = Object.create(null);
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
      clear() {
        Object.keys(store).forEach((key) => delete store[key]);
      },
    };
  }

  function createSandbox() {
    const document = createDocumentStub();
    const localStorage = createLocalStorageStub();
    const windowObject = {
      document,
      localStorage,
      location: { origin: "http://localhost:8000", protocol: "http:" },
      navigator: { userAgent: "architecture-smoke" },
      NPCConfig: {
        MAX_CANDOR: 6,
        baseCharacters: [
          { id: "char1", name: "小一", systemPrompt: "", currentCandor: 0, maxCandor: 6 },
          { id: "char2", name: "小二", systemPrompt: "", currentCandor: 0, maxCandor: 6 },
          { id: "char3", name: "三三", systemPrompt: "", currentCandor: 0, maxCandor: 6 },
        ],
        updateCandorAndColor(character, candor) {
          return { ...character, currentCandor: candor };
        },
        stepCandorAndColor(character, touched) {
          return {
            ...character,
            currentCandor: touched ? Math.min((character.currentCandor || 0) + 1, 6) : 0,
          };
        },
      },
    };

    const sandbox = {
      window: windowObject,
      document,
      localStorage,
      location: windowObject.location,
      navigator: windowObject.navigator,
      console,
      setTimeout,
      clearTimeout,
      AbortController,
      DOMException,
      fetch: async function () {
        throw new Error("fetch is not available in architecture smoke tests");
      },
    };
    windowObject.window = windowObject;
    windowObject.console = console;
    windowObject.setTimeout = setTimeout;
    windowObject.clearTimeout = clearTimeout;
    windowObject.AbortController = AbortController;
    windowObject.DOMException = DOMException;
    windowObject.fetch = sandbox.fetch;
    return sandbox;
  }

  function checkDialogueVmLoad(dialogueStack) {
    const sandbox = createSandbox();
    const context = vm.createContext(sandbox);
    const files = dialogueStack.concat(["dialogue.js"]);

    try {
      files.forEach((relativePath) => {
        const code = readText(relativePath);
        vm.runInContext(code, context, { filename: relativePath });
      });
      pass(
        "dialogue/*.js load in order",
        "Loaded " + dialogueStack.length + " dialogue module(s) from index.html, then dialogue.js bootstrap."
      );
    } catch (err) {
      fail("dialogue/*.js load in order", err && err.stack ? err.stack : String(err));
      return null;
    }

    return sandbox.window;
  }

  function checkDialogueStateApi(windowObject) {
    if (!windowObject) return;
    const api = windowObject.DialogueState;
    if (!api || typeof api !== "object") {
      fail("window.DialogueState API contract", "window.DialogueState was not created.");
      return;
    }

    const actual = Object.keys(api).sort();
    const expected = EXPECTED_DIALOGUE_STATE_API.slice().sort();
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    const wrongType = expected.filter((key) => typeof api[key] !== "function");

    if (missing.length || extra.length || wrongType.length) {
      fail(
        "window.DialogueState API contract",
        [
          missing.length ? "Missing: " + missing.join(", ") : null,
          extra.length ? "Extra: " + extra.join(", ") : null,
          wrongType.length ? "Not functions: " + wrongType.join(", ") : null,
        ].filter(Boolean).join("\n")
      );
      return;
    }

    pass("window.DialogueState API contract", "Exact public API keys are present and functions.");
  }

  function checkTestModeStaticPath() {
    const providerCode = readText("dialogue/provider.js");
    const flowCode = readText("dialogue/flow.js");
    const hasTestModeKey = providerCode.includes("npc_test_mode") || flowCode.includes("npc_test_mode");
    const hasQuickReplyMock =
      flowCode.includes("getQuickReplyMock") &&
      flowCode.includes("测试模式") &&
      flowCode.includes("presetMock");

    if (!hasTestModeKey || !hasQuickReplyMock) {
      fail(
        "test mode main flow static check",
        "Expected npc_test_mode and quick reply mock path references in dialogue/provider.js or dialogue/flow.js."
      );
      return;
    }

    pass("test mode main flow static check", "Found npc_test_mode and quick reply mock short-circuit path.");
  }

  function printResults() {
    console.log("NPC architecture smoke tests");
    console.log("============================");
    results.forEach((result) => {
      const mark = result.ok ? "[PASS]" : "[FAIL]";
      console.log(`${mark} ${result.name}`);
      if (result.detail) {
        console.log(String(result.detail).split("\n").map((line) => `       ${line}`).join("\n"));
      }
    });
    console.log("============================");
    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      console.error(`FAILED: ${failed.length} check(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: ${results.length} check(s) passed.`);
    }
  }

  function main() {
    try {
      const html = fs.readFileSync(INDEX_PATH, "utf8");
      const scripts = parseScripts(html);
      const scriptPaths = getLocalExternalScriptPaths(scripts);
      const dialogueStack = extractDialogueStack(scriptPaths);
      checkScriptRefs(scripts);
      checkScriptOrder(scripts, dialogueStack);
      const windowObject = checkDialogueVmLoad(dialogueStack);
      checkDialogueStateApi(windowObject);
      checkTestModeStaticPath();
    } catch (err) {
      fail("architecture-smoke runner", err && err.stack ? err.stack : String(err));
    } finally {
      printResults();
    }
  }

  main();
})();

(function () {
  "use strict";

  /* ═══════════════════════════════════════════════════════════
     LOG RESTORE  —  从本地审计日志续接周目
     职责：拉取 NDJSON、解析最新 session、重建 loop_archive、
           恢复 AuditLog session_id；UI 挂在周目入口遮罩。
     依赖：window.AuditLog、window.NPCConfig（archive 骨架）
     对外暴露：window.LogRestore
  ═══════════════════════════════════════════════════════════ */

  var LOG_API_ENDPOINT = "http://127.0.0.1:8765/api/logs/ndjson";
  var RESTORE_FEATURE_LIST = ["loop_memory", "subconscious_settlement", "diary_generation"];
  var RESTORE_FEATURES = RESTORE_FEATURE_LIST.join(",");
  var STATIC_LOG_BASE = "logs/";
  var CHAR_IDS = ["char1", "char2", "char3"];
  var MAX_LOOP_INDEX = 10;

  function emptyMutableSubconscious() {
    return {
      dejaVuLevel: 0,
      subconsciousImpression: "",
      thresholdAdjustment: "",
      nextLoopPromptPatch: "",
    };
  }

  function parseNdjsonText(text, defaultFeature) {
    var lines = [];
    if (!text || typeof text !== "string") return lines;
    text.split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line) return;
      try {
        var obj = JSON.parse(line);
        if (obj && typeof obj === "object") {
          if (!obj.feature && defaultFeature) obj.feature = defaultFeature;
          lines.push(obj);
        }
      } catch (_) { /* skip bad line */ }
    });
    return lines;
  }

  async function readNdjsonFromUrl(url, defaultFeature) {
    try {
      var res = await fetch(url, { method: "GET" });
      if (!res.ok) return [];
      var text = await res.text();
      return parseNdjsonText(text, defaultFeature);
    } catch (_) {
      return [];
    }
  }

  async function fetchRestoreLinesFromApi() {
    var url = LOG_API_ENDPOINT + "?features=" + encodeURIComponent(RESTORE_FEATURES);
    var res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error("logs_api_" + res.status);
    var data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.lines)) {
      throw new Error("logs_api_invalid");
    }
    return data.lines;
  }

  async function fetchRestoreLinesFromStatic() {
    var all = [];
    for (var i = 0; i < RESTORE_FEATURE_LIST.length; i++) {
      var feature = RESTORE_FEATURE_LIST[i];
      var chunk = await readNdjsonFromUrl(STATIC_LOG_BASE + feature + ".ndjson", feature);
      all = all.concat(chunk);
    }
    return all;
  }

  function parseFilesToLines(fileList) {
    var all = [];
    var files = Array.prototype.slice.call(fileList || []);
    files.forEach(function (file) {
      if (!file || !file.name) return;
      var m = file.name.match(/^([a-z0-9_]+)\.ndjson$/i);
      var feature = m ? m[1] : null;
      var text = file._logRestoreText;
      if (!text) return;
      all = all.concat(parseNdjsonText(text, feature));
    });
    return all;
  }

  async function readFilesAsText(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    await Promise.all(files.map(function (file) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          file._logRestoreText = reader.result || "";
          resolve();
        };
        reader.onerror = function () {
          file._logRestoreText = "";
          resolve();
        };
        reader.readAsText(file, "UTF-8");
      });
    }));
    return parseFilesToLines(files);
  }

  function parseTimestamp(ts) {
    if (!ts || typeof ts !== "string") return 0;
    var t = Date.parse(ts);
    return Number.isFinite(t) ? t : 0;
  }

  // Phase 2：从 stageId 或 loopIndex 解析出整数 legacyLoopIndex（用于比较最大周目）
  function rowToLoopIdx(row) {
    // 优先读 stage_id（Phase 2 新增字段）
    if (row.stage_id && typeof row.stage_id === "string" && window.StageCatalog) {
      var idx = window.StageCatalog.toLoopIndex(row.stage_id);
      if (idx !== null) return idx;
    }
    // 兜底：读 loop_index 整数字段
    var n = Number(row.loop_index);
    return (Number.isFinite(n) && n >= 1) ? Math.floor(n) : 0;
  }

  function pickLatestSession(lines) {
    var bySession = {};
    lines.forEach(function (row) {
      if (!row || typeof row !== "object") return;
      var sid = row.session_id;
      if (!sid || typeof sid !== "string") return;
      var ts = parseTimestamp(row.timestamp);
      var loopIdx = rowToLoopIdx(row);
      if (!bySession[sid]) {
        bySession[sid] = { sessionId: sid, latestTs: 0, maxLoop: 0, maxStageId: null, rows: [] };
      }
      var bucket = bySession[sid];
      bucket.rows.push(row);
      if (ts >= bucket.latestTs) {
        bucket.latestTs = ts;
        // 同时记录最大 stage_id（用于 buildArchiveFromSession 输出 v2 字段）
        if (loopIdx >= bucket.maxLoop) {
          bucket.maxLoop = loopIdx;
          bucket.maxStageId = (row.stage_id && typeof row.stage_id === "string")
            ? row.stage_id
            : (window.StageCatalog ? window.StageCatalog.fromLoopIndex(loopIdx) : null);
        }
      }
      if (loopIdx > bucket.maxLoop) {
        bucket.maxLoop = loopIdx;
        bucket.maxStageId = (row.stage_id && typeof row.stage_id === "string")
          ? row.stage_id
          : (window.StageCatalog ? window.StageCatalog.fromLoopIndex(loopIdx) : null);
      }
    });
    var sessions = Object.keys(bySession).map(function (k) { return bySession[k]; });
    if (sessions.length === 0) return null;
    sessions.sort(function (a, b) {
      if (b.latestTs !== a.latestTs) return b.latestTs - a.latestTs;
      return b.maxLoop - a.maxLoop;
    });
    return sessions[0];
  }

  function buildImmutableCore(charId) {
    var base = null;
    try {
      var list = window.NPCConfig && window.NPCConfig.baseCharacters;
      if (Array.isArray(list)) {
        base = list.find(function (c) { return c && c.id === charId; }) || null;
      }
    } catch (_) { /* ignore */ }
    return {
      id: charId,
      name: (base && base.name) ? base.name : charId,
      targetColor: (base && base.targetColor) ? base.targetColor : "#000000",
      candorRates: (base && base.candorRates) ? base.candorRates : { rise: 1, fall: 1 },
    };
  }

  function latestRowFor(sessionRows, feature, filterFn) {
    var best = null;
    var bestTs = -1;
    sessionRows.forEach(function (row) {
      if (!row || row.feature !== feature) return;
      if (row.status && row.status !== "ok") return;
      if (filterFn && !filterFn(row)) return;
      var ts = parseTimestamp(row.timestamp);
      if (ts >= bestTs) {
        bestTs = ts;
        best = row;
      }
    });
    return best;
  }

  function buildArchiveFromSession(session) {
    if (!session || !Array.isArray(session.rows) || session.rows.length === 0) {
      return null;
    }

    var rows = session.rows;
    var maxLoop = session.maxLoop;
    if (!Number.isFinite(maxLoop) || maxLoop < 1) return null;

    var memoryAtMax = latestRowFor(rows, "loop_memory", function (r) {
      return rowToLoopIdx(r) === maxLoop;
    });
    var hasCompletedLoop = !!memoryAtMax;

    var targetLoop = hasCompletedLoop ? maxLoop + 1 : maxLoop;
    if (targetLoop > MAX_LOOP_INDEX) targetLoop = MAX_LOOP_INDEX;
    if (targetLoop < 1) return null;

    // Phase 2：计算 resume-state stageId
    var targetStageId = null;
    var maxStageId = session.maxStageId || null;
    if (window.StageCatalog && hasCompletedLoop && maxStageId) {
      targetStageId = window.StageCatalog.nextStageId(maxStageId);
    } else if (window.StageCatalog) {
      targetStageId = window.StageCatalog.fromLoopIndex(targetLoop);
    }

    var summaryRow = latestRowFor(rows, "loop_memory", function (r) {
      var li = Number(r.loop_index);
      return li >= 1 && li <= maxLoop;
    });
    var summary = "";
    if (summaryRow && summaryRow.payload) {
      var p = summaryRow.payload;
      if (typeof p.normalized_summary === "string" && p.normalized_summary.trim()) {
        summary = p.normalized_summary.trim();
      } else if (typeof p.raw_summary === "string" && p.raw_summary.trim()) {
        summary = p.raw_summary.trim();
      }
    }

    var characters = {};
    var charFound = 0;
    var hasLoopMemory = !!latestRowFor(rows, "loop_memory");

    CHAR_IDS.forEach(function (charId) {
      var settleRow = latestRowFor(rows, "subconscious_settlement", function (r) {
        return r.payload && r.payload.character_id === charId;
      });
      var sub = emptyMutableSubconscious();
      if (settleRow && settleRow.payload) {
        var pl = settleRow.payload;
        var out = pl.mutable_subconscious_out || {};
        var parsed = pl.raw_parsed || {};
        var candor = Number(pl.current_candor);
        if (!Number.isFinite(candor) && parsed.deja_vu_level != null) {
          candor = Number(parsed.deja_vu_level);
        }
        sub = {
          dejaVuLevel: Number.isFinite(candor) ? Math.max(0, Math.min(6, Math.floor(candor))) : 0,
          subconsciousImpression: out.subconsciousImpression || parsed.subconscious_impression || "",
          thresholdAdjustment: out.thresholdAdjustment || parsed.threshold_adjustment || "",
          nextLoopPromptPatch: out.nextLoopPromptPatch || parsed.next_loop_prompt_patch || "",
        };
      }
      characters[charId] = {
        immutableCore: buildImmutableCore(charId),
        mutableSubconscious: sub,
      };
      if (settleRow) charFound += 1;
    });

    if (charFound === 0 && !hasLoopMemory) return null;

    var notebook = [];
    rows.forEach(function (row) {
      if (!row || row.feature !== "diary_generation") return;
      if (row.status && row.status !== "ok") return;
      var pl = row.payload || {};
      var body = typeof pl.normalized_body === "string" ? pl.normalized_body : "";
      if (!body.trim()) return;
      var loopIndex = rowToLoopIdx(row);
      if (!loopIndex || loopIndex < 1) return;
      var rowStageId = (row.stage_id && typeof row.stage_id === "string") ? row.stage_id
        : (window.StageCatalog ? window.StageCatalog.fromLoopIndex(loopIndex) : null);
      var headerLabel = "";
      try {
        // Phase 2：优先使用 by-stageId 查询
        if (rowStageId && window.NotebookConfig && typeof window.NotebookConfig.getTonePresetByStageId === "function") {
          var tone = window.NotebookConfig.getTonePresetByStageId(rowStageId) || {};
          headerLabel = tone.headerLabel || "";
        } else if (window.NotebookConfig && typeof window.NotebookConfig.getTonePresetFor === "function") {
          var tone2 = window.NotebookConfig.getTonePresetFor(loopIndex) || {};
          headerLabel = tone2.headerLabel || "";
        }
      } catch (_) { /* ignore */ }
      notebook.push({
        loopIndex: loopIndex,
        headerLabel: headerLabel || ("第 " + loopIndex + " 次轮回"),
        body: body,
        tonePreset: {},
        generatedAt: row.timestamp || new Date().toISOString(),
        source: (pl.source_out === "ai") ? "ai" : "fallback",
        error: null,
      });
    });
    notebook.sort(function (a, b) { return a.loopIndex - b.loopIndex; });

    // Phase 2：推断 completed_stage_ids（所有 legacyLoopIndex < targetLoop 的 stage）
    var completedStageIds = [];
    if (window.StageCatalog) {
      window.StageCatalog.getAll().forEach(function (e) {
        if (e.legacyLoopIndex < targetLoop) completedStageIds.push(e.stageId);
      });
    }

    return {
      archive: {
        // v2 resume-state schema
        archive_version:     2,
        current_stage_id:    targetStageId,
        completed_stage_ids: completedStageIds,
        legacy_loop_index:   targetLoop,
        // v1 兼容字段保留
        loop_index:          targetLoop,
        ran_at:              new Date().toISOString(),
        characters:          characters,
        summary:             summary,
        notebook:            notebook,
      },
      sessionId:        session.sessionId,
      targetLoopIndex:  targetLoop,
      sourceMaxLoop:    maxLoop,
      hasCompletedLoop: hasCompletedLoop,
    };
  }

  async function fetchRestoreLines() {
    try {
      var apiLines = await fetchRestoreLinesFromApi();
      if (apiLines.length) return apiLines;
    } catch (apiErr) {
      console.warn("[log-restore] API unavailable, trying static logs/", apiErr);
    }
    return fetchRestoreLinesFromStatic();
  }

  async function resolveLatestRestoreFromLines(lines) {
    if (!lines || !lines.length) return null;
    var session = pickLatestSession(lines);
    if (!session) return null;
    return buildArchiveFromSession(session);
  }

  async function resolveLatestRestore() {
    var lines = await fetchRestoreLines();
    return resolveLatestRestoreFromLines(lines);
  }

  function applySessionId(sessionId) {
    if (!sessionId || typeof sessionId !== "string") return;
    try {
      if (window.AuditLog && typeof window.AuditLog.applySessionId === "function") {
        window.AuditLog.applySessionId(sessionId);
      }
    } catch (err) {
      console.warn("[log-restore] applySessionId failed", err);
    }
  }

  function buildPreviewHtml(archive) {
    if (!archive || !archive.characters) return "";
    var lines = [];
    Object.keys(archive.characters).forEach(function (charId) {
      var entry = archive.characters[charId];
      if (!entry) return;
      var core = entry.immutableCore || {};
      var sub = entry.mutableSubconscious || {};
      var name = core.name || charId;
      var lvl = sub.dejaVuLevel !== undefined ? sub.dejaVuLevel : "—";
      var imp = sub.subconsciousImpression
        ? sub.subconsciousImpression.slice(0, 30)
        : "（空）";
      lines.push(name + "  似曾相识值 " + lvl + "　" + imp);
    });
    return lines.join("\n");
  }

  /**
   * @param {object} ctx
   * @param {HTMLElement} ctx.overlay
   * @param {HTMLElement} ctx.optionsWrap
   * @param {function(object, number): void} ctx.onApplied  archive, targetLoopIndex
   */
  function showFilePickerFallback(box, statusEl, onApplied) {
    statusEl.textContent =
      "未能自动读取 logs/。请选择 logs 目录下的 .ndjson 文件（可多选）：";

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "ls-file-input";
    fileInput.accept = ".ndjson,application/x-ndjson,application/json,text/plain";
    fileInput.multiple = true;
    fileInput.style.marginTop = "12px";

    fileInput.addEventListener("change", function () {
      if (!fileInput.files || fileInput.files.length === 0) return;
      statusEl.textContent = "正在解析所选日志文件……";
      (async function () {
        try {
          var lines = await readFilesAsText(fileInput.files);
          var result = await resolveLatestRestoreFromLines(lines);
          if (!result || !result.archive || !result.targetLoopIndex) {
            statusEl.textContent = "无可用存档（所选文件中没有可识别的完整会话记录）。";
            return;
          }
          applySessionId(result.sessionId);
          box.style.display = "none";
          if (typeof onApplied === "function") {
            onApplied(result.archive, result.targetLoopIndex, result);
          }
        } catch (err) {
          console.warn("[log-restore] file restore failed", err);
          statusEl.textContent = "无可用存档（文件无法解析或记录已损坏）。";
        }
      })();
    });

    box.appendChild(fileInput);
  }

  function openRestoreFlow(ctx) {
    var ov = ctx && ctx.overlay;
    var optionsWrap = ctx && ctx.optionsWrap;
    var onApplied = ctx && ctx.onApplied;
    if (!ov || !optionsWrap) return;

    var box = document.createElement("div");
    box.className = "ls-import-box";

    var statusEl = document.createElement("p");
    statusEl.className = "ls-status";
    statusEl.textContent = "正在读取本地日志……";

    box.appendChild(statusEl);
    if (optionsWrap.parentNode) {
      optionsWrap.style.display = "none";
    }
    ov.appendChild(box);

    (async function () {
      try {
        var result = await resolveLatestRestore();
        if (!result || !result.archive || !result.targetLoopIndex) {
          statusEl.textContent =
            "未能自动读取日志。请关掉「NPC-Demo-服务」黑窗口后重新双击「一键启动.bat」，或用手动选文件。";
          showFilePickerFallback(box, statusEl, onApplied);
          return;
        }
        applySessionId(result.sessionId);
        box.style.display = "none";
        if (typeof onApplied === "function") {
          onApplied(result.archive, result.targetLoopIndex, result);
        }
      } catch (err) {
        console.warn("[log-restore] restore failed", err);
        statusEl.textContent =
          "自动读取失败。请重新运行「一键启动.bat」后再试，或用手动选文件。";
        showFilePickerFallback(box, statusEl, onApplied);
      }
    })();
  }

  window.LogRestore = {
    fetchRestoreLines: fetchRestoreLines,
    resolveLatestRestore: resolveLatestRestore,
    resolveLatestRestoreFromLines: resolveLatestRestoreFromLines,
    buildArchiveFromSession: buildArchiveFromSession,
    buildPreviewHtml: buildPreviewHtml,
    openRestoreFlow: openRestoreFlow,
  };
})();

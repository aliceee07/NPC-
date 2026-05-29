(function () {
  /* ═══════════════════════════════════════════════════════════
     SAVE ADAPTER  —  统一存档接口（Phase 3 新建）
     职责：load() / save() 统一接口，内部决定走本地或云端。
           save() 必须 await 完成后才允许 location.reload()（§2.5）。
     依赖：window.CloudSync、window.UserSession、window.LoopState
     对外暴露：window.SaveAdapter
  ═══════════════════════════════════════════════════════════ */

  /**
   * load() — 「继续上一段」登录成功后调用
   * 从云端拉取存档并注入到 sessionStorage（由 LoopState.tryAutoImport 消费）
   * @returns {Promise<{ok:boolean, archive?:object, error?:string}>}
   */
  async function load() {
    // 本地跳过登录模式：直接返回无存档
    if (window.NPC_SKIP_LOGIN) {
      return { ok: true, archive: null };
    }

    var userId       = window.UserSession && window.UserSession.getUserId();
    var sessionToken = window.UserSession && window.UserSession.getSessionToken();
    if (!userId || !sessionToken) {
      return { ok: false, error: 'not_logged_in' };
    }

    var baseUrl = window.CloudSync && window.CloudSync.BASE_URL;
    if (!baseUrl) {
      return { ok: false, error: 'no_base_url' };
    }

    try {
      var result = await window.CloudSync.loadSave(userId, sessionToken);
      if (!result || !result.ok) {
        return { ok: false, error: 'load_failed' };
      }
      var rawSave = result.save;
      if (!rawSave) {
        return { ok: true, archive: null };  // 新用户，无存档
      }

      // 升级云端存档到 v2（可能是历史 v1 存档）
      var archive = rawSave;
      if (window.LoopState && typeof window.LoopState.upgradeRestoredArchive === 'function') {
        var upgraded = window.LoopState.upgradeRestoredArchive(rawSave);
        if (upgraded) archive = upgraded;
      }

      // 注入到 sessionStorage，由 LoopState.tryAutoImport 消费
      try {
        sessionStorage.setItem('npc_pending_loop', JSON.stringify(archive));
      } catch (_) { /* ignore */ }

      return { ok: true, archive: archive };
    } catch (err) {
      console.error('[SaveAdapter] load failed:', err);
      return { ok: false, error: 'network_error' };
    }
  }

  /**
   * save(archive) — 周目结束时调用，必须 await 完成后才 reload
   * 失败弹出「存档失败」对话框，提供重试选项
   * @param {object} archive  v2 schema archive 对象
   * @returns {Promise<void>}  成功或用户确认放弃后 resolve
   */
  async function save(archive) {
    // 本地跳过登录模式：跳过云端推送
    if (window.NPC_SKIP_LOGIN) {
      return;
    }

    var userId       = window.UserSession && window.UserSession.getUserId();
    var sessionToken = window.UserSession && window.UserSession.getSessionToken();
    var baseUrl      = window.CloudSync && window.CloudSync.BASE_URL;

    if (!userId || !sessionToken || !baseUrl) {
      // 未登录或无云端配置：静默跳过（降级到本地模式）
      return;
    }

    try {
      await window.CloudSync.pushSave(userId, sessionToken, archive);
    } catch (saveErr) {
      console.warn('[SaveAdapter] save failed, showing retry dialog:', saveErr);
      var retry = await _showSaveErrorDialog();
      if (retry) {
        try {
          await window.CloudSync.pushSave(userId, sessionToken, archive);
        } catch (retryErr) {
          console.error('[SaveAdapter] retry also failed:', retryErr);
          // 二次失败：静默继续（存档已在 sessionStorage，游戏可继续）
        }
      }
    }
  }

  /**
   * 弹出「存档失败」对话框，返回用户是否选择重试
   * @returns {Promise<boolean>}
   */
  function _showSaveErrorDialog() {
    return new Promise(function (resolve) {
      // 创建简单模态对话框
      var overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed;top:0;left:0;width:100%;height:100%;',
        'background:rgba(0,0,0,0.7);z-index:9999;',
        'display:flex;align-items:center;justify-content:center;',
      ].join('');

      var box = document.createElement('div');
      box.style.cssText = [
        'background:#1a1a1a;color:#e0e0e0;border:1px solid #444;',
        'border-radius:8px;padding:24px 28px;max-width:360px;text-align:center;',
      ].join('');

      var msg = document.createElement('p');
      msg.textContent = '存档未能同步到云端，是否重试？';
      msg.style.margin = '0 0 20px';

      var hint = document.createElement('p');
      hint.textContent = '（无论如何，本次进度已保存在本地，游戏将继续）';
      hint.style.cssText = 'margin:0 0 20px;font-size:0.85em;color:#888;';

      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';

      var retryBtn = document.createElement('button');
      retryBtn.textContent = '重试';
      retryBtn.style.cssText = 'padding:8px 20px;cursor:pointer;background:#333;color:#fff;border:1px solid #666;border-radius:4px;';

      var skipBtn = document.createElement('button');
      skipBtn.textContent = '继续（不重试）';
      skipBtn.style.cssText = 'padding:8px 20px;cursor:pointer;background:#222;color:#aaa;border:1px solid #444;border-radius:4px;';

      function dismiss(doRetry) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(doRetry);
      }

      retryBtn.addEventListener('click', function () { dismiss(true); });
      skipBtn.addEventListener('click', function () { dismiss(false); });

      btnRow.appendChild(retryBtn);
      btnRow.appendChild(skipBtn);
      box.appendChild(msg);
      box.appendChild(hint);
      box.appendChild(btnRow);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  }

  window.SaveAdapter = {
    load: load,
    save: save,
  };
})();

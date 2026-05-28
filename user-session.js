(function () {
  /* ═══════════════════════════════════════════════════════════
     USER SESSION  —  玩家身份管理层（Phase 3 新建）
     职责：维护 userId / nickname / sessionToken 的内存状态与 localStorage 缓存；
           提供 login() 流程（走 CloudSync）；支持本地跳过登录（NPC_SKIP_LOGIN）。
     依赖：window.CloudSync
     对外暴露：window.UserSession
  ═══════════════════════════════════════════════════════════ */

  var LS_USER_ID      = 'npc_user_id';
  var LS_NICKNAME     = 'npc_nickname';
  var LS_SESSION_TOKEN = 'npc_session_token';

  var _userId       = null;
  var _nickname     = null;
  var _sessionToken = null;

  /* ──────────────────── localStorage 持久化 ──────────────── */

  function _saveToStorage() {
    try {
      if (_userId)       localStorage.setItem(LS_USER_ID,       _userId);
      if (_nickname)     localStorage.setItem(LS_NICKNAME,      _nickname);
      if (_sessionToken) localStorage.setItem(LS_SESSION_TOKEN, _sessionToken);
    } catch (_) { /* ignore */ }
  }

  function _clearStorage() {
    try {
      localStorage.removeItem(LS_USER_ID);
      localStorage.removeItem(LS_NICKNAME);
      localStorage.removeItem(LS_SESSION_TOKEN);
    } catch (_) { /* ignore */ }
  }

  function _restoreFromStorage() {
    try {
      _userId       = localStorage.getItem(LS_USER_ID)       || null;
      _nickname     = localStorage.getItem(LS_NICKNAME)      || null;
      _sessionToken = localStorage.getItem(LS_SESSION_TOKEN) || null;
    } catch (_) { /* ignore */ }
  }

  // 初始化时从 localStorage 恢复
  _restoreFromStorage();

  /* ──────────────────── 公共 API ─────────────────────────── */

  function isLoggedIn() {
    // NPC_SKIP_LOGIN 模式：始终视为已登录
    if (window.NPC_SKIP_LOGIN) return true;
    return !!((_userId) && (_sessionToken));
  }

  function getUserId() {
    if (window.NPC_SKIP_LOGIN) return 'local-anon';
    return _userId;
  }

  function getNickname() {
    return _nickname || null;
  }

  function getSessionToken() {
    return _sessionToken || null;
  }

  /**
   * 登录或注册
   * @param {string} nickname
   * @param {string} pin  4 位数字
   * @returns {Promise<{ok:boolean, is_new?:boolean, error?:string}>}
   */
  async function login(nickname, pin) {
    try {
      var result = await window.CloudSync.login(nickname, pin);
      if (!result || !result.ok) {
        return { ok: false, error: (result && result.error) || 'login_failed' };
      }
      _userId       = result.user_id;
      _nickname     = result.nickname;
      _sessionToken = result.session_token;
      _saveToStorage();
      return { ok: true, is_new: !!result.is_new };
    } catch (err) {
      console.error('[UserSession] login error:', err);
      return { ok: false, error: 'network_error' };
    }
  }

  function logout() {
    _userId       = null;
    _nickname     = null;
    _sessionToken = null;
    _clearStorage();
  }

  window.UserSession = {
    isLoggedIn:      isLoggedIn,
    getUserId:       getUserId,
    getNickname:     getNickname,
    getSessionToken: getSessionToken,
    login:           login,
    logout:          logout,
  };
})();

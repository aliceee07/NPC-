(function () {
  /* ═══════════════════════════════════════════════════════════
     CLOUD SYNC  —  云端 HTTP 请求封装层（Phase 3 新建）
     职责：封装所有后端 API 调用（login / loadSave / pushSave / pushLog）。
     BASE_URL 从 window.NPC_CLOUD_BASE_URL 读取（config.local.js 中设置）。
     所有需鉴权的请求携带 Authorization: Bearer {session_token}。
     依赖：无（window.UserSession 不能反依赖此模块）
     对外暴露：window.CloudSync
  ═══════════════════════════════════════════════════════════ */

  // BASE_URL 从 config.local.js 的全局变量读取；空串表示本地开发模式
  var BASE_URL = (typeof window !== 'undefined' && typeof window.NPC_CLOUD_BASE_URL === 'string')
    ? window.NPC_CLOUD_BASE_URL.replace(/\/$/, '')
    : '';

  function getBaseUrl() {
    return BASE_URL;
  }

  /**
   * POST /api/user/login
   * @param {string} nickname
   * @param {string} pin  4 位数字字符串
   * @returns {Promise<{ok:boolean, user_id?:string, nickname?:string, session_token?:string, is_new?:boolean, error?:string}>}
   */
  async function login(nickname, pin) {
    if (!BASE_URL) throw new Error('CloudSync: BASE_URL not configured');
    try {
      var res = await fetch(BASE_URL + '/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname, pin: pin }),
      });
      var data = await res.json();
      return data;
    } catch (err) {
      console.error('[CloudSync] login failed:', err);
      return { ok: false, error: 'network_error' };
    }
  }

  /**
   * GET /api/user/{userId}/save
   * @param {string} userId
   * @param {string} sessionToken
   * @returns {Promise<{ok:boolean, save:object|null, updated_at:string|null}>}
   */
  async function loadSave(userId, sessionToken) {
    if (!BASE_URL) throw new Error('CloudSync: BASE_URL not configured');
    try {
      var res = await fetch(BASE_URL + '/api/user/' + encodeURIComponent(userId) + '/save', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + sessionToken },
      });
      if (!res.ok) throw new Error('http_' + res.status);
      return await res.json();
    } catch (err) {
      console.error('[CloudSync] loadSave failed:', err);
      throw err;
    }
  }

  /**
   * PUT /api/user/{userId}/save
   * @param {string} userId
   * @param {string} sessionToken
   * @param {object} archive  v2 schema
   * @returns {Promise<{ok:boolean, updated_at:string}>}
   */
  async function pushSave(userId, sessionToken, archive) {
    if (!BASE_URL) throw new Error('CloudSync: BASE_URL not configured');
    try {
      var res = await fetch(BASE_URL + '/api/user/' + encodeURIComponent(userId) + '/save', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + sessionToken,
        },
        body: JSON.stringify(archive),
      });
      if (!res.ok) throw new Error('http_' + res.status);
      return await res.json();
    } catch (err) {
      console.error('[CloudSync] pushSave failed:', err);
      throw err;
    }
  }

  /**
   * POST /api/log  （无强鉴权，内部附 X-User-Id 辅助字段）
   * @param {object} entry  日志对象
   * @returns {Promise<void>}  失败静默（调用方 console.warn）
   */
  async function pushLog(entry) {
    if (!BASE_URL) throw new Error('CloudSync: BASE_URL not configured');
    var res = await fetch(BASE_URL + '/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      var err = new Error('http_' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  window.CloudSync = {
    BASE_URL: BASE_URL,
    getBaseUrl: getBaseUrl,
    login: login,
    loadSave: loadSave,
    pushSave: pushSave,
    pushLog: pushLog,
  };
})();

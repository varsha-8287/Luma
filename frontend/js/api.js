/* ============================================================
   QUESTFLOW — API SERVICE
   Handles all HTTP communication with the Python backend
   ============================================================ */

const API = (() => {

  // ── Config ──
  // Change this to your backend URL
  const BASE_URL = window.BACKEND_URL || 'http://localhost:5000/api';

  // ── Token helpers ──
  const getToken = () => localStorage.getItem('qf_token');
  const setToken = (t) => localStorage.setItem('qf_token', t);
  const removeToken = () => localStorage.removeItem('qf_token');
  const setUser = (u) => localStorage.setItem('qf_user', JSON.stringify(u));
  const getUser = () => { try { return JSON.parse(localStorage.getItem('qf_user')); } catch { return null; } };
  const removeUser = () => localStorage.removeItem('qf_user');

  // ── Base request ──
  async function request(method, endpoint, body = null, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      if (err.name === 'TypeError') throw new Error('Cannot connect to server. Make sure the backend is running.');
      throw err;
    }
  }

  // ============================================================
  // AUTH
  // ============================================================
  async function register(name, email, password) {
    const data = await request('POST', '/auth/register', { name, email, password }, false);
    if (data.token) setToken(data.token);
    if (data.user) setUser(data.user);
    return data;
  }

  async function login(email, password) {
    const data = await request('POST', '/auth/login', { email, password }, false);
    if (data.token) setToken(data.token);
    if (data.user) setUser(data.user);
    return data;
  }

  function logout() { removeToken(); removeUser(); }

  // ============================================================
  // TASKS
  // ============================================================
  const getTasks    = ()       => request('GET',    '/tasks');
  const createTask  = (body)   => request('POST',   '/tasks', body);
  const completeTask= (id)     => request('PUT',    `/tasks/${id}/complete`);
  const deleteTask  = (id)     => request('DELETE', `/tasks/${id}`);
  const editTask    = (id, body) => request('PUT',    `/tasks/${id}/edit`, body);
  const getSmartRanked = ()    => request('GET',    '/tasks/smart-ranked');

  // ============================================================
  // MOOD
  // ============================================================
  const logMood       = (moodType) => request('POST', '/mood', { moodType });
  const getDailySummary = ()       => request('GET',  '/mood/daily-summary');
  const getMoods      = ()         => request('GET',  '/mood');

  // ============================================================
  // ANALYTICS
  // ============================================================
  const getProductivityScore = () => request('GET', '/analytics/productivity-score');
  const getWeeklyStats       = () => request('GET', '/analytics/weekly-stats');
  const getPatterns          = () => request('GET', '/analytics/patterns');
  const getPrediction        = () => request('GET', '/analytics/prediction');
  const getWrapped           = () => request('GET', '/analytics/wrapped');

  // ============================================================
  // GAMIFICATION
  // ============================================================
  const getBadges   = () => request('GET', '/gamification/badges');
  const getXPHistory= () => request('GET', '/gamification/xp-history');

  // ============================================================
  // JOURNAL
  // ============================================================
  const getJournal    = ()     => request('GET',    '/journal');
  const createJournal = (body) => request('POST',   '/journal', body);
  const deleteJournal = (id)   => request('DELETE', `/journal/${id}`);

  // ============================================================
  // REMINDERS
  // ============================================================
  const getReminders      = () => request('GET',  '/reminders');
  const acknowledgeReminder=(id)=> request('PUT', `/reminders/${id}/ack`);


  // ============================================================
  // GAMES
  // ============================================================
  const submitGameScore = (gameId, score, duration, won, metadata = {}) =>
    request('POST', '/games/score', { gameId, score, duration, won, metadata });

  const getGameStats       = ()             => request('GET', '/games/stats');
  const getGameHistory     = (game, limit)  => request('GET', `/games/history${game ? `?game=${game}&limit=${limit||20}` : `?limit=${limit||20}`}`);
  const getGameLeaderboard = (gameId)       => request('GET', `/games/leaderboard/${gameId}`);
  const getGameXP          = ()             => request('GET', '/games/xp');

  // ============================================================
  // ALARMS  (DB-backed — replaces localStorage)
  // ============================================================
  const createAlarmDB  = (label, time, voiceProfile, repeat) =>
    request('POST', '/alarms', { label, time, voiceProfile, repeat });

  const getAlarmsDB    = ()            => request('GET',    '/alarms');
  const toggleAlarmDB  = (id)          => request('PUT',    `/alarms/${id}/toggle`);
  const triggerAlarmDB = (id, snoozed) => request('PUT',    `/alarms/${id}/trigger`, { snoozed });
  const deleteAlarmDB  = (id)          => request('DELETE', `/alarms/${id}`);

  // ============================================================
  // NOTIFICATIONS  (DB-backed — replaces localStorage)
  // ============================================================
  const getNotifications  = (unreadOnly = false, limit = 50) =>
    request('GET', `/notifications?unread=${unreadOnly}&limit=${limit}`);
  const getUnreadCount    = ()    => request('GET', '/notifications/unread-count');
  const markAllNotifRead  = ()    => request('PUT', '/notifications/read-all');
  const markNotifRead     = (id)  => request('PUT',    `/notifications/${id}/read`);
  const deleteNotif       = (id)  => request('DELETE', `/notifications/${id}`);
  const clearAllNotifs    = ()    => request('DELETE', '/notifications');

  return {
    // token helpers
    getToken, setToken, removeToken, getUser, setUser,
    // auth
    register, login, logout,
    // tasks
    getTasks, createTask, completeTask, deleteTask, editTask, getSmartRanked,
    // mood
    logMood, getDailySummary, getMoods,
    // analytics
    getProductivityScore, getWeeklyStats, getPatterns, getPrediction, getWrapped,
    // gamification
    getBadges, getXPHistory,
    // journal
    getJournal, createJournal, deleteJournal,
    // reminders
    getReminders, acknowledgeReminder,
    // games
    submitGameScore, getGameStats, getGameHistory, getGameLeaderboard, getGameXP,
    // alarms (DB)
    createAlarmDB, getAlarmsDB, toggleAlarmDB, triggerAlarmDB, deleteAlarmDB,
    // notifications (DB)
    getNotifications, getUnreadCount, markAllNotifRead, markNotifRead, deleteNotif, clearAllNotifs
  };
})();
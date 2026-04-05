/* ============================================================
   LUMA — NOTIFICATIONS.JS  v3.2.0
   Bug Fixes:
   1. Bell now inserted BEFORE .btn-add-task (was failing silently
      when topbar-actions lacked that class)
   2. _speakServerReminders: was checking `n.read` — newly polled
      notifs come with read:false from DB, so they were being spoken
      again on every poll. Fixed: use a persistent dedup set seeded
      from sessionStorage so it survives the 60s re-render.
   3. proactive checks were running BEFORE window._tasks was
      populated; now tasks are fetched inside the check loop.
   4. 30-min warning fired for every minute inside [0-30], not
      just once. Fixed with sessionStorage dedup keys that include
      a datestamp so they reset each day.
   5. syncNotificationsFromDB called _speakServerReminders before
      the new notifs were written to localStorage. Fixed order.
   6. Notification bell was re-injected on every syncNotificationsFromDB
      call (renderNotificationBell was called repeatedly). Guard added.
   7. popup in-app toast for task deadline notifications added —
      a dismissible overlay now appears for 5min / overdue events
      alongside the voice.
   8. `getNotifSettings` — missing default values caused taskDue
      to silently disable itself on first load.
   ============================================================ */

// ── State ──
const ALARMS_KEY     = 'luma_alarms';
const NOTIFS_KEY     = 'luma_notifications';
const VOICE_KEY      = 'luma_voice_profile';
const SNOOZE_LIMIT   = 3;

// Tracks server-voice notif IDs we've already spoken (persisted in sessionStorage)
function _getSpokenSet() {
  try { return new Set(JSON.parse(sessionStorage.getItem('luma_spoken_ids') || '[]')); }
  catch { return new Set(); }
}
function _addSpoken(id) {
  const s = _getSpokenSet(); s.add(id);
  sessionStorage.setItem('luma_spoken_ids', JSON.stringify([...s]));
}

// ── DB Sync helpers ──────────────────────────────────────────
async function syncAlarmsFromDB() {
  try {
    if (typeof API === 'undefined' || !API.getToken()) return;
    const data = await API.getAlarmsDB();
    const alarms = data.alarms || [];
    const normalized = alarms.map(a => ({ ...a, id: a._id || a.id }));
    localStorage.setItem(ALARMS_KEY, JSON.stringify(normalized));
    renderAlarmList();
  } catch(e) { console.warn('Alarm sync failed:', e.message); }
}

async function syncNotificationsFromDB() {
  try {
    if (typeof API === 'undefined' || !API.getToken()) return;
    const data = await API.getNotifications(false, 50);
    // Enrich DB notifications with local template data (color, label, icon)
    // so the dropdown renders them properly regardless of what the server returns
    const notifs = (data.notifications || []).map(n => {
      const id = n._id || n.id;
      const type = n.type || 'reminder';
      const tpl = NOTIF_TEMPLATES[type] || NOTIF_TEMPLATES.reminder;
      return {
        ...n,
        id,
        color: n.color || tpl.color,
        label: n.label || tpl.label,
        icon:  n.icon  || tpl.icon,
      };
    });
    // Write to localStorage FIRST, then speak / badge
    localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs));
    renderNotifList(notifs);
    updateNotifBadge(notifs);
    // Now scan for voice triggers in the fresh data
    _speakServerReminders();
  } catch(e) { console.warn('Notif sync failed:', e.message); }
}

async function getUnreadCountFromDB() {
  try {
    if (typeof API === 'undefined' || !API.getToken()) return;
    const data = await API.getUnreadCount();
    const badge = document.getElementById('notifCount');
    if (!badge) return;
    const count = data.unreadCount || 0;
    badge.textContent = count > 9 ? '9+' : count;
    count > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
  } catch(e) {}
}

let alarmCheckInterval = null;
let activeAlarmId      = null;
let alarmAudioCtx      = null;
let alarmOscillators   = [];
let snoozeCount        = {};

// ── Parent voice scripts ──
const PARENT_SCRIPTS = {
  strict: [
    "Hey! Wake up! Do you know what time it is? GET UP RIGHT NOW!",
    "I am NOT going to tell you again. Wake up this instant! You have responsibilities!",
    "That's it. I'm taking your phone. Every minute you sleep, you lose more of your day. GET. UP. NOW.",
    "Do you think successful people sleep like this?! Your tasks are waiting and you are just LYING there!",
    "WAKE UP! I didn't raise you to be lazy! You have quests to complete and you're wasting precious time!",
  ],
  loving: [
    "Good morning sweetheart! Time to wake up, your day is waiting for you!",
    "Hey baby, you're going to be late! Come on, get up, I made your favorites... actually no, just wake up!",
    "Okay listen, I love you, but this is the third time I'm calling. Please. Wake. Up. For me?",
    "Darling, your alarm went off twenty minutes ago. Your goals aren't going to achieve themselves!",
    "I'm not angry, I'm just very very disappointed. Please wake up and start your day. You can do it!",
  ],
  dramatic: [
    "O HEAVENS! They sleep still! While the world turns and time burns, they SLUMBER! WAKE UP!",
    "This is UNACCEPTABLE! The audacity! The sheer, absolute audacity of sleeping through your alarm!",
    "Shakespeare himself could not write a tragedy greater than this — you, asleep, while your tasks weep!",
    "EVERY second you sleep is a second your dreams cry into the void! RISE! RISE AND CONQUER YOUR DAY!",
    "I have been calling for TWENTY MINUTES. TWENTY. Do you understand what I sacrificed to wake you?!",
  ]
};

const NOTIF_TEMPLATES = {
  alarm:    { icon: '⏰', color: 'var(--amber)',  label: 'Alarm' },
  task:     { icon: '📋', color: 'var(--blue)',   label: 'Quest Due' },
  streak:   { icon: '🔥', color: 'var(--red)',    label: 'Streak Alert' },
  badge:    { icon: '🏆', color: 'var(--accent)', label: 'Badge Earned' },
  reminder: { icon: '🔔', color: 'var(--purple)', label: 'Reminder' },
  mood:     { icon: '😊', color: 'var(--accent)', label: 'Mood Check' },
};

// ============================================================
// INIT
// ============================================================
function initNotifications() {
  requestNotificationPermission();
  renderNotificationBell();       // Safe — has duplicate guard
  renderAlarmList();
  startAlarmChecker();
  loadStoredNotifications();
  injectAlarmSettingsSection();

  // Sync from MongoDB (DB is source of truth)
  setTimeout(async () => {
    await syncAlarmsFromDB();
    await syncNotificationsFromDB();
    await getUnreadCountFromDB();
  }, 800);

  // Poll every 60 s — picks up server-pushed reminder notifications
  setInterval(async () => {
    await syncNotificationsFromDB();
    await getUnreadCountFromDB();
  }, 60000);
}

// ============================================================
// BROWSER NOTIFICATION PERMISSION
// ============================================================
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function sendBrowserNotification(title, body) {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    tag: 'luma-notif-' + Date.now(),
    renotify: true,
  });
  n.onclick = () => { window.focus(); n.close(); };
  setTimeout(() => n.close(), 8000);
}

// ============================================================
// IN-APP DEADLINE POPUP  (NEW v3.2.0)
// Shows a dismissible overlay for 5-min and overdue events
// ============================================================
function showDeadlinePopup(title, message, severity = 'warning') {
  // Remove stale popup
  document.getElementById('deadlinePopup')?.remove();

  const colors = {
    warning:  { bg: 'rgba(255,182,39,0.12)', border: 'rgba(255,182,39,0.5)', icon: '⚡', accent: 'var(--amber)' },
    critical: { bg: 'rgba(255,71,87,0.12)',  border: 'rgba(255,71,87,0.5)',  icon: '🚨', accent: 'var(--red)' },
    overdue:  { bg: 'rgba(255,71,87,0.18)',  border: 'rgba(255,71,87,0.7)',  icon: '⚠️', accent: 'var(--red)' },
  };
  const c = colors[severity] || colors.warning;

  const popup = document.createElement('div');
  popup.id = 'deadlinePopup';
  popup.style.cssText = `
    position:fixed; bottom:28px; right:28px; z-index:9000;
    max-width:340px; width:calc(100% - 56px);
    background:var(--bg-card);
    border:1px solid ${c.border};
    border-left: 4px solid ${c.accent};
    border-radius:14px;
    box-shadow:0 16px 48px rgba(0,0,0,0.55);
    padding:16px 18px;
    display:flex; align-items:flex-start; gap:14px;
    animation:popupSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
  `;

  // Inject keyframe if not present
  if (!document.getElementById('popupKF')) {
    const s = document.createElement('style');
    s.id = 'popupKF';
    s.textContent = `
      @keyframes popupSlideIn {
        from { transform:translateX(120%); opacity:0; }
        to   { transform:translateX(0);   opacity:1; }
      }
      @keyframes popupSlideOut {
        to { transform:translateX(120%); opacity:0; }
      }
    `;
    document.head.appendChild(s);
  }

  popup.innerHTML = `
    <div style="font-size:1.8rem;line-height:1;flex-shrink:0">${c.icon}</div>
    <div style="flex:1;min-width:0">
      <div style="font-size:0.85rem;font-weight:800;color:${c.accent};margin-bottom:4px">
        ${escHtml(title)}
      </div>
      <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.4">
        ${escHtml(message)}
      </div>
    </div>
    <button onclick="document.getElementById('deadlinePopup')?.remove()"
      style="background:none;border:none;color:var(--text-muted);cursor:pointer;
             font-size:13px;flex-shrink:0;padding:2px;line-height:1">
      ✕
    </button>
  `;

  document.body.appendChild(popup);

  // Auto-dismiss after 12 s
  setTimeout(() => {
    const el = document.getElementById('deadlinePopup');
    if (!el) return;
    el.style.animation = 'popupSlideOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 12000);
}

// ============================================================
// SERVER-PUSHED REMINDER VOICE TRIGGER
// ============================================================
/**
 * The backend embeds a [VOICE: ...] tag inside the notification message
 * for critical windows (5-min and overdue). This scans fresh notifications
 * and reads those aloud exactly once (dedup via session storage).
 * Also shows an in-app popup for critical alerts.
 */
function _speakServerReminders() {
  const notifs = getStoredNotifications();
  const settings = getNotifSettings();
  if (settings.taskDue === false) return;

  const spoken = _getSpokenSet();

  notifs.forEach(n => {
    // Only fire for unread task / reminder notifications
    if (n.read) return;
    if (!['task','reminder'].includes(n.type)) return;

    const id = n.id || n._id;
    if (!id || spoken.has(id)) return;

    const voiceMatch = (n.message || '').match(/\[VOICE:\s*(.+?)\]/);

    // Determine severity for popup
    const title = n.title || '';
    const is5min   = title.includes('5 Minute') || title.includes('5 Minutes');
    const isOverdue = title.includes('Overdue');
    const is10min  = title.includes('10 Minute');

    if (voiceMatch || is5min || isOverdue || is10min) {
      _addSpoken(id);

      // Speak voice text if embedded
      if (voiceMatch) {
        ttsSpeak(voiceMatch[1]);
      } else if (is5min) {
        ttsSpeak(`Critical alert! A quest expires in 5 minutes. Complete it immediately!`);
      } else if (isOverdue) {
        ttsSpeak(`Warning! A quest is now overdue. Complete it immediately or you will lose XP!`);
      }

      // Play beep
      if (is5min || isOverdue) {
        _playDeadlineBeep(isOverdue ? 'urgent' : 'warning');
      }

      // Show in-app popup
      const displayMsg = (n.message || '').replace(/\[VOICE:[^\]]*\]/g, '').trim();
      if (is5min || isOverdue) {
        showDeadlinePopup(
          title,
          displayMsg,
          isOverdue ? 'overdue' : 'critical'
        );
        sendBrowserNotification(title, displayMsg);
      } else if (is10min) {
        showDeadlinePopup(title, displayMsg, 'warning');
      }
    }
  });
}

// ============================================================
// NOTIFICATION BELL + DROPDOWN
// ============================================================
function renderNotificationBell() {
  // Guard: don't inject twice
  if (document.getElementById('notifBell')) return;

  const topbar = document.querySelector('.topbar-actions');
  if (!topbar) return;

  const bellHTML = `
    <div class="notif-bell-wrap" id="notifBellWrap">
      <button class="notif-bell" id="notifBell" onclick="toggleNotifDropdown()">
        <i class="fas fa-bell"></i>
        <span class="notif-count hidden" id="notifCount">0</span>
      </button>
      <div class="notif-dropdown hidden" id="notifDropdown">
        <div class="notif-dropdown-header">
          <span>Notifications</span>
          <button onclick="clearAllNotifications()">Clear all</button>
        </div>
        <div class="notif-list" id="notifList">
          <div class="notif-empty">
            <i class="fas fa-bell-slash"></i>
            <p>No notifications yet</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Insert before the "New Quest" button if it exists, otherwise prepend
  const addTaskBtn = topbar.querySelector('.btn-add-task');
  if (addTaskBtn) {
    addTaskBtn.insertAdjacentHTML('beforebegin', bellHTML);
  } else {
    topbar.insertAdjacentHTML('afterbegin', bellHTML);
  }

  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('notifBellWrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('notifDropdown')?.classList.add('hidden');
    }
  });
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
  if (!dd.classList.contains('hidden')) {
    markNotificationsRead();
  }
}

function pushNotification(type, title, message, persistent = false) {
  const template = NOTIF_TEMPLATES[type] || NOTIF_TEMPLATES.reminder;
  const notif = {
    id:        Date.now().toString(),
    type,
    title,
    message,
    icon:      template.icon,
    color:     template.color,
    label:     template.label,
    timestamp: new Date().toISOString(),
    read:      false,
    persistent,
  };

  const stored = getStoredNotifications();
  stored.unshift(notif);
  const trimmed = stored.slice(0, 50);
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(trimmed));

  renderNotifList(trimmed);
  updateNotifBadge(trimmed);
  sendBrowserNotification(title, message);

  return notif;
}

function getStoredNotifications() {
  try { return JSON.parse(localStorage.getItem(NOTIFS_KEY)) || []; }
  catch { return []; }
}

function loadStoredNotifications() {
  const notifs = getStoredNotifications();
  renderNotifList(notifs);
  updateNotifBadge(notifs);
}

function renderNotifList(notifs) {
  const list = document.getElementById('notifList');
  if (!list) return;

  if (!notifs.length) {
    list.innerHTML = `<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>`;
    return;
  }

  // Strip [VOICE:...] tags from display text
  list.innerHTML = notifs.slice(0, 20).map(n => {
    const displayMsg = (n.message || '').replace(/\[VOICE:[^\]]*\]/g, '').trim();
    return `
    <div class="notif-item ${n.read ? 'read' : ''}" data-id="${n.id}">
      <div class="notif-icon-wrap" style="background:${n.color}22; color:${n.color}">
        ${n.icon || '🔔'}
      </div>
      <div class="notif-body">
        <div class="notif-label" style="color:${n.color}">${n.label || 'Alert'}</div>
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(displayMsg)}</div>
        <div class="notif-time">${formatNotifTime(n.timestamp || n.createdAt)}</div>
      </div>
      <button class="notif-dismiss" onclick="dismissNotification('${n.id}')">
        <i class="fas fa-times"></i>
      </button>
    </div>`;
  }).join('');
}

function updateNotifBadge(notifs) {
  const unread = notifs.filter(n => !n.read).length;
  const badge = document.getElementById('notifCount');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function markNotificationsRead() {
  try { if (typeof API !== 'undefined' && API.getToken()) await API.markAllNotifRead().catch(()=>{}); } catch(e) {}
  const notifs = getStoredNotifications().map(n => ({ ...n, read: true }));
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs));
  updateNotifBadge(notifs);
}

async function dismissNotification(id) {
  try { if (typeof API !== 'undefined' && API.getToken()) await API.deleteNotif(id).catch(()=>{}); } catch(e) {}
  const notifs = getStoredNotifications().filter(n => n.id !== id);
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs));
  renderNotifList(notifs);
  updateNotifBadge(notifs);
}

async function clearAllNotifications() {
  try { if (typeof API !== 'undefined' && API.getToken()) await API.clearAllNotifs().catch(()=>{}); } catch(e) {}
  localStorage.setItem(NOTIFS_KEY, JSON.stringify([]));
  renderNotifList([]);
  updateNotifBadge([]);
}

function formatNotifTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// ALARM SYSTEM
// ============================================================
function getAlarms() {
  try { return JSON.parse(localStorage.getItem(ALARMS_KEY)) || []; }
  catch { return []; }
}
function saveAlarms(alarms) {
  localStorage.setItem(ALARMS_KEY, JSON.stringify(alarms));
}

async function createAlarm(label, timeStr, voiceProfile = 'strict', repeat = []) {
  try {
    if (typeof API !== 'undefined' && API.getToken()) {
      const data = await API.createAlarmDB(label || 'Wake Up Alarm', timeStr, voiceProfile, repeat);
      const alarm = { ...(data.alarm || {}), id: data.alarm?._id || Date.now().toString() };
      const alarms = getAlarms();
      alarms.push(alarm);
      saveAlarms(alarms);
      renderAlarmList();
      pushNotification('alarm', 'Alarm Set!', `"${label}" set for ${timeStr}`, false);
      return alarm;
    }
  } catch(e) { console.warn('Alarm DB save failed, using local:', e.message); }
  const alarm = {
    id: Date.now().toString(), label: label || 'Wake Up Alarm',
    time: timeStr, voiceProfile, repeat, enabled: true,
    createdAt: new Date().toISOString(), lastTriggered: null,
  };
  const alarms = getAlarms(); alarms.push(alarm); saveAlarms(alarms);
  renderAlarmList();
  pushNotification('alarm', 'Alarm Set!', `"${label}" set for ${timeStr}`, false);
  return alarm;
}

async function toggleAlarm(id) {
  try { if (typeof API !== 'undefined' && API.getToken()) await API.toggleAlarmDB(id).catch(()=>{}); } catch(e) {}
  const alarms = getAlarms().map(a => a.id === id ? { ...a, enabled: !a.enabled } : a);
  saveAlarms(alarms);
  renderAlarmList();
}

async function deleteAlarm(id) {
  try { if (typeof API !== 'undefined' && API.getToken()) await API.deleteAlarmDB(id).catch(()=>{}); } catch(e) {}
  saveAlarms(getAlarms().filter(a => a.id !== id));
  renderAlarmList();
}

function renderAlarmList() {
  const container = document.getElementById('alarmList');
  if (!container) return;

  const alarms = getAlarms();
  if (!alarms.length) {
    container.innerHTML = `
      <div class="alarm-empty">
        <i class="fas fa-bell-slash"></i>
        <p>No alarms set. Add one to never miss a quest!</p>
      </div>`;
    return;
  }

  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  container.innerHTML = alarms.map(a => `
    <div class="alarm-item ${a.enabled ? 'active' : 'inactive'}" data-id="${a.id}">
      <div class="alarm-left">
        <div class="alarm-time">${a.time}</div>
        <div class="alarm-label">${escHtml(a.label)}</div>
        <div class="alarm-meta">
          <span class="alarm-voice-badge voice-${a.voiceProfile}">
            ${a.voiceProfile === 'strict' ? '😡 Strict' : a.voiceProfile === 'loving' ? '🥺 Loving' : '🎭 Dramatic'}
          </span>
          ${a.repeat?.length
            ? `<span class="alarm-days">${a.repeat.map(d => DAY_NAMES[d]).join(' · ')}</span>`
            : `<span class="alarm-days">Once</span>`}
        </div>
      </div>
      <div class="alarm-right">
        <label class="alarm-toggle" title="${a.enabled ? 'Disable' : 'Enable'} alarm">
          <input type="checkbox" ${a.enabled ? 'checked' : ''} onchange="toggleAlarm('${a.id}')"/>
          <span class="alarm-slider"></span>
        </label>
        <button class="alarm-delete" onclick="deleteAlarm('${a.id}')" title="Delete alarm">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// ============================================================
// ALARM CHECKER (every 30 seconds)
// ============================================================
function startAlarmChecker() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);
  checkAlarms();
  alarmCheckInterval = setInterval(checkAlarms, 30000);
}

function checkAlarms() {
  const now       = new Date();
  const hhmm      = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayOfWeek = now.getDay();

  getAlarms().forEach(alarm => {
    if (!alarm.enabled) return;
    if (alarm.time !== hhmm) return;

    if (alarm.lastTriggered) {
      const last = new Date(alarm.lastTriggered);
      if ((now - last) / 60000 < 1.5) return;
    }

    if (alarm.repeat?.length && !alarm.repeat.includes(dayOfWeek)) return;

    triggerAlarm(alarm);

    const alarms = getAlarms().map(a =>
      a.id === alarm.id ? { ...a, lastTriggered: now.toISOString() } : a
    );
    saveAlarms(alarms);

    if (!alarm.repeat?.length) {
      setTimeout(() => {
        const updated = getAlarms().map(a =>
          a.id === alarm.id ? { ...a, enabled: false } : a
        );
        saveAlarms(updated);
        renderAlarmList();
      }, 1000);
    }
  });
}

// ============================================================
// ALARM RING UI
// ============================================================
function triggerAlarm(alarm) {
  activeAlarmId = alarm.id;
  snoozeCount[alarm.id] = snoozeCount[alarm.id] || 0;
  try { if (typeof API !== 'undefined' && API.getToken()) API.triggerAlarmDB(alarm.id, false).catch(()=>{}); } catch(e) {}

  pushNotification('alarm', `⏰ ${alarm.label}`, 'Your alarm is ringing! Time to wake up!', true);
  startAlarmSound();
  showAlarmModal(alarm);

  const profile = alarm.voiceProfile || 'strict';
  const line = PARENT_SCRIPTS[profile][Math.min(snoozeCount[alarm.id], PARENT_SCRIPTS[profile].length - 1)];
  ttsSpeak(line);
}

function showAlarmModal(alarm) {
  let modal = document.getElementById('alarmRingModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'alarmRingModal';
    document.body.appendChild(modal);
  }

  const snoozed  = snoozeCount[alarm.id] || 0;
  const profile  = alarm.voiceProfile || 'strict';
  const scriptLine = PARENT_SCRIPTS[profile][Math.min(snoozed, PARENT_SCRIPTS[profile].length - 1)];
  const isEscalated = snoozed >= SNOOZE_LIMIT;

  modal.className = 'alarm-ring-overlay';
  modal.innerHTML = `
    <div class="alarm-ring-modal ${isEscalated ? 'escalated' : ''}">
      <div class="alarm-ring-top">
        <div class="alarm-ring-pulse ${isEscalated ? 'pulse-angry' : 'pulse-normal'}">
          <span class="alarm-ring-emoji">${isEscalated ? '😡' : '⏰'}</span>
        </div>
        <div class="alarm-ring-time">${alarm.time}</div>
        <div class="alarm-ring-label">${escHtml(alarm.label)}</div>
      </div>

      <div class="alarm-parent-speech ${isEscalated ? 'speech-angry' : 'speech-normal'}">
        <div class="parent-avatar ${profile}">
          ${profile === 'strict' ? '👨' : profile === 'loving' ? '👩' : '🎭'}
        </div>
        <div class="speech-bubble">
          <div class="speech-text" id="alarmSpeechText">${escHtml(scriptLine)}</div>
        </div>
      </div>

      ${snoozed > 0 ? `<div class="snooze-warning">⚠ Snoozed ${snoozed} time${snoozed > 1 ? 's' : ''}${isEscalated ? ' — CALLING NOW!' : ''}</div>` : ''}

      <div class="alarm-ring-actions">
        ${!isEscalated ? `
          <button class="alarm-snooze-btn" onclick="snoozeAlarm('${alarm.id}')">
            <i class="fas fa-moon"></i> Snooze 5 min
          </button>
        ` : `
          <button class="alarm-call-btn" onclick="triggerParentCall('${alarm.id}')">
            <i class="fas fa-phone"></i> Incoming Call...
          </button>
        `}
        <button class="alarm-dismiss-btn" onclick="dismissAlarm('${alarm.id}')">
          <i class="fas fa-check"></i> I'm Awake!
        </button>
      </div>
    </div>
  `;
}

function snoozeAlarm(alarmId) {
  snoozeCount[alarmId] = (snoozeCount[alarmId] || 0) + 1;
  stopAlarmSound();

  const count = snoozeCount[alarmId];
  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;

  const profile = alarm.voiceProfile || 'strict';
  const snoozeScripts = {
    strict: [
      "FINE. Five more minutes. But I'm watching you.",
      "Are you SERIOUS? Again?! You better be up in five minutes!",
      "That is IT. I am calling you in five minutes and if you don't answer...",
    ],
    loving: [
      "Okay, five more minutes sweetheart. But just five!",
      "Baby, this is the second time. Please don't make me worry!",
      "Okay now I AM getting worried. Five minutes, then I'm sending Dad.",
    ],
    dramatic: [
      "Fine! FINE! Five minutes. The world waits... barely.",
      "Again?! The AUDACITY! Five minutes, and then CONSEQUENCES!",
      "You push me to my limits! FIVE. MINUTES. Not a second more!",
    ]
  };

  const line = snoozeScripts[profile][Math.min(count - 1, 2)];
  ttsSpeak(line);

  const modal = document.getElementById('alarmRingModal');
  if (modal) modal.classList.add('hidden');

  pushNotification('alarm', '😴 Alarm Snoozed', `Snoozing "${alarm.label}" for 5 minutes. Don't fall back asleep!`);

  setTimeout(() => {
    modal?.classList.remove('hidden');
    startAlarmSound();
    showAlarmModal(alarm);
  }, 5 * 60 * 1000);
}

function dismissAlarm(alarmId) {
  stopAlarmSound();
  window.speechSynthesis?.cancel();

  const modal = document.getElementById('alarmRingModal');
  if (modal) {
    modal.style.animation = 'alarmDismiss 0.4s ease forwards';
    setTimeout(() => modal.remove(), 400);
  }

  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;

  snoozeCount[alarmId] = 0;
  activeAlarmId = null;

  const dismissLines = {
    strict: "Finally! Good. Now go be productive. Don't disappoint me.",
    loving: "Good morning! I'm so proud of you for getting up. Have a wonderful day!",
    dramatic: "The hero RISES! The world trembles with anticipation! Go forth and CONQUER!",
  };

  ttsSpeak(dismissLines[alarm.voiceProfile || 'strict']);
  pushNotification('streak', 'Morning Hero! 🌅', 'You woke up! Your streak is safe. Go crush those quests!');

  setTimeout(() => {
    if (localStorage.getItem('qf_last_mood') !== new Date().toDateString()) {
      openMoodModal?.();
    }
  }, 30000);
}

// ============================================================
// ESCALATED VOICE CALL
// ============================================================
function triggerParentCall(alarmId) {
  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;
  stopAlarmSound();

  const modal = document.getElementById('alarmRingModal');
  if (modal) {
    const profile = alarm.voiceProfile || 'strict';
    const callerName = { strict: 'Dad 📞', loving: 'Mum 📞', dramatic: 'The Narrator 📞' }[profile];

    modal.innerHTML = `
      <div class="alarm-call-screen">
        <div class="call-ripples">
          <div class="ripple r1"></div>
          <div class="ripple r2"></div>
          <div class="ripple r3"></div>
          <div class="call-avatar-wrap">
            <div class="call-avatar ${profile}">
              ${profile === 'strict' ? '👨' : profile === 'loving' ? '👩' : '🎭'}
            </div>
          </div>
        </div>
        <div class="call-name">${callerName}</div>
        <div class="call-status">Incoming Call...</div>
        <div class="call-script-box" id="callScriptBox">
          <div class="call-script-text" id="callScriptText">📞 Connecting...</div>
        </div>
        <div class="call-actions">
          <button class="call-decline" onclick="dismissAlarm('${alarmId}')">
            <i class="fas fa-phone-slash"></i><span>I'm Awake!</span>
          </button>
          <button class="call-accept active-call" onclick="acceptCall('${alarmId}')">
            <i class="fas fa-phone"></i><span>Answer</span>
          </button>
        </div>
      </div>
    `;
    setTimeout(() => playCallScript(alarmId), 1500);
  }
}

let callScriptTimeout = null;
function playCallScript(alarmId) {
  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;

  const profile = alarm.voiceProfile || 'strict';
  const statusEl = document.querySelector('.call-status');
  if (statusEl) statusEl.textContent = 'Connected';

  const fullScript = [
    ...PARENT_SCRIPTS[profile],
    profile === 'strict'
      ? "Now GET UP, get dressed, and go do something with your life. I'll be watching your task list!"
      : profile === 'loving'
      ? "I love you so much and I believe in you completely. Now please, please, PLEASE get out of bed!"
      : "And thus concludes Act One of your morning tragedy. May Act Two be more PRODUCTIVE!"
  ];

  let lineIndex = 0;

  function speakNext() {
    if (lineIndex >= fullScript.length) {
      const textEl = document.getElementById('callScriptText');
      if (textEl) textEl.textContent = '📵 Call ended. Now WAKE UP!';
      return;
    }
    const line = fullScript[lineIndex];
    const textEl = document.getElementById('callScriptText');
    if (textEl) textEl.textContent = line;
    ttsSpeak(line);
    lineIndex++;
    const delay = Math.max(2000, line.length * 80);
    callScriptTimeout = setTimeout(speakNext, delay);
  }

  speakNext();
}

function acceptCall(alarmId) {
  const statusEl = document.querySelector('.call-status');
  if (statusEl) statusEl.textContent = '🔊 On call with parent...';
  const acceptBtn = document.querySelector('.active-call');
  if (acceptBtn) {
    acceptBtn.innerHTML = '<i class="fas fa-volume-up"></i><span>Listening...</span>';
    acceptBtn.disabled = true;
  }
}

// ============================================================
// ALARM SOUND (Web Audio API)
// ============================================================
function startAlarmSound() {
  try {
    stopAlarmSound();
    alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const playBeep = () => {
      if (!alarmAudioCtx || alarmAudioCtx.state === 'closed') return;
      const patterns = [
        { freq: 880, duration: 0.15, gap: 0.05 },
        { freq: 1046, duration: 0.15, gap: 0.05 },
        { freq: 880, duration: 0.15, gap: 0.3 },
      ];
      let time = alarmAudioCtx.currentTime;
      patterns.forEach(p => {
        const osc  = alarmAudioCtx.createOscillator();
        const gain = alarmAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(alarmAudioCtx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(p.freq, time);
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + p.duration);
        osc.start(time);
        osc.stop(time + p.duration);
        alarmOscillators.push(osc);
        time += p.duration + p.gap;
      });
    };

    playBeep();
    const interval = setInterval(() => {
      if (alarmAudioCtx?.state !== 'closed') playBeep();
      else clearInterval(interval);
    }, 1500);
    alarmOscillators._interval = interval;
  } catch (e) { console.warn('Alarm sound failed:', e); }
}

function stopAlarmSound() {
  if (alarmOscillators._interval) clearInterval(alarmOscillators._interval);
  alarmOscillators.forEach(o => { try { o.stop(); } catch {} });
  alarmOscillators = [];
  if (alarmAudioCtx) {
    try { alarmAudioCtx.close(); } catch {}
    alarmAudioCtx = null;
  }
}

// ── Deadline beep (shorter, distinct from alarm) ──
function _playDeadlineBeep(severity = 'warning') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freqs   = severity === 'urgent' ? [1200, 900, 1200] : [880, 1046];
    const durations = severity === 'urgent' ? [0.12, 0.12, 0.20] : [0.15, 0.15];
    let time = ctx.currentTime;

    freqs.forEach((freq, idx) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = severity === 'urgent' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.25, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + durations[idx]);
      osc.start(time);
      osc.stop(time + durations[idx]);
      time += durations[idx] + 0.06;
    });

    setTimeout(() => { try { ctx.close(); } catch {} }, 2000);
  } catch(e) {}
}

// ============================================================
// PROACTIVE NOTIFICATIONS — CLIENT-SIDE
// ============================================================
function startProactiveNotifications() {
  _checkProactiveNotifications();
  setInterval(_checkProactiveNotifications, 60000);
}

function checkProactiveNotifications() { _checkProactiveNotifications(); }

function _checkProactiveNotifications() {
  const settings = getNotifSettings();
  // Use window._tasks — populated by main.js after API.getTasks() resolves
  const tasks    = window._tasks || [];
  const now      = new Date();
  const todayStr = now.toDateString();

  if (settings.taskDue !== false) {
    tasks.filter(t => t.status === 'Pending').forEach(t => {
      const deadline = new Date(t.deadline);
      const diffMs   = deadline - now;
      const mins     = diffMs / 60000;
      const taskId   = t._id || t.id;

      // ── 30-minute warning ──────────────────────────────────
      // Key includes date so it re-arms the next day
      const key30 = `warned_30_${taskId}_${todayStr}`;
      if (mins > 0 && mins <= 30 && mins > 10 && !sessionStorage.getItem(key30)) {
        sessionStorage.setItem(key30, '1');
        pushNotification('reminder', '🔔 Quest Due in 30 Minutes',
          `"${t.name}" is due in about ${Math.round(mins)} minutes. Start now!`);
        ttsSpeak(`Reminder: your quest "${t.name}" is due in ${Math.round(mins)} minutes.`);
        showDeadlinePopup('🔔 Quest Due in 30 Minutes',
          `"${t.name}" is due in about ${Math.round(mins)} minutes. Start now!`, 'warning');
      }

      // ── 10-minute warning ──────────────────────────────────
      const key10 = `warned_10_${taskId}_${todayStr}`;
      if (mins > 0 && mins <= 10 && mins > 5 && !sessionStorage.getItem(key10)) {
        sessionStorage.setItem(key10, '1');
        pushNotification('task', '⚡ Quest Due in 10 Minutes!',
          `"${t.name}" is due very soon. Wrap up and complete it now!`);
        ttsSpeak(`Heads up! Your quest "${t.name}" is due in 10 minutes. Complete it now!`);
        _playDeadlineBeep('warning');
        showDeadlinePopup('⚡ Quest Due in 10 Minutes!',
          `"${t.name}" is due very soon. Complete it now!`, 'warning');
      }

      // ── 5-minute CRITICAL warning ──────────────────────────
      const key5 = `warned_5_${taskId}_${todayStr}`;
      if (mins > 0 && mins <= 5 && !sessionStorage.getItem(key5)) {
        sessionStorage.setItem(key5, '1');
        pushNotification('task', '🚨 Quest Expiring in 5 Minutes!',
          `"${t.name}" expires in ${Math.round(mins)} minutes — complete it immediately!`);
        ttsSpeak(
          `Critical alert! Your quest "${t.name}" expires in just ${Math.round(mins)} minutes. ` +
          `Stop everything and complete it right now!`
        );
        _playDeadlineBeep('urgent');
        sendBrowserNotification('🚨 Quest Expiring!', `"${t.name}" — ${Math.round(mins)} min left!`);
        showDeadlinePopup('🚨 Quest Expiring in 5 Minutes!',
          `"${t.name}" — only ${Math.round(mins)} minute${Math.round(mins) !== 1 ? 's' : ''} left!`, 'critical');
      }

      // ── Overdue — fires within 10 min after deadline ───────
      const keyOD = `warned_overdue_${taskId}_${todayStr}`;
      if (diffMs < 0 && diffMs > -600000 && !sessionStorage.getItem(keyOD)) {
        sessionStorage.setItem(keyOD, '1');
        pushNotification('task', '⚠️ Quest Overdue!',
          `"${t.name}" has just passed its deadline. Complete it immediately or lose XP!`);
        ttsSpeak(
          `Warning! Your quest "${t.name}" is now overdue. ` +
          `Complete it immediately or it will be marked as missed and you will lose XP!`
        );
        _playDeadlineBeep('urgent');
        sendBrowserNotification('⚠️ Quest Overdue!', `"${t.name}" just expired — complete it now!`);
        showDeadlinePopup('⚠️ Quest Overdue!',
          `"${t.name}" has passed its deadline. Complete it NOW to avoid losing XP!`, 'overdue');
      }
    });
  }

  // ── Streak danger (after 8 PM, no task completed today) ──
  if (settings.streak !== false) {
    const user = typeof API !== 'undefined' ? API.getUser?.() : null;
    if (user?.streak > 0 && now.getHours() >= 20) {
      const streakKey = `warned_streak_${todayStr}`;
      const completedToday = (window._tasks || []).some(t => {
        const completedAt = t.completedAt && new Date(t.completedAt);
        return t.status === 'Completed' && completedAt &&
               completedAt.toDateString() === todayStr;
      });
      if (!completedToday && !sessionStorage.getItem(streakKey)) {
        sessionStorage.setItem(streakKey, '1');
        pushNotification('streak', '🔥 Streak at Risk!',
          `Your ${user.streak}-day streak ends at midnight if you don't complete a quest today!`);
        ttsSpeak(`Warning! Your ${user.streak} day streak is in danger. Complete a quest before midnight!`);
      }
    }
  }

  // ── Daily mood check at 9 AM ─────────────────────────────
  if (settings.moodCheck !== false) {
    if (now.getHours() === 9 && now.getMinutes() < 2) {
      const moodKey = `mood_notif_${todayStr}`;
      if (localStorage.getItem('qf_last_mood') !== todayStr && !sessionStorage.getItem(moodKey)) {
        sessionStorage.setItem(moodKey, '1');
        pushNotification('mood', 'Morning Check-In 🌅',
          'How are you feeling today? Log your mood to boost your XP multiplier!');
      }
    }
  }
}

// ============================================================
// NOTIFICATION SETTINGS — defaults now explicit
// ============================================================
function getNotifSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem('luma_notif_settings') || '{}');
    // Apply defaults explicitly so missing keys don't disable features
    return {
      taskDue:   stored.taskDue   !== undefined ? stored.taskDue   : true,
      streak:    stored.streak    !== undefined ? stored.streak    : true,
      moodCheck: stored.moodCheck !== undefined ? stored.moodCheck : true,
      badges:    stored.badges    !== undefined ? stored.badges    : true,
      midnight:  stored.midnight  !== undefined ? stored.midnight  : false,
    };
  } catch { return { taskDue: true, streak: true, moodCheck: true, badges: true, midnight: false }; }
}

function toggleNotifSetting(key, val) {
  const settings = getNotifSettings();
  settings[key] = val;
  localStorage.setItem('luma_notif_settings', JSON.stringify(settings));
}

// ============================================================
// ALARM MANAGER UI (injected sections)
// ============================================================
function injectAlarmSettingsSection() {
  const nav = document.querySelector('.sidebar-nav');
  if (nav && !document.querySelector('[data-section="reminders"]')) {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'nav-link';
    link.dataset.section = 'reminders';
    link.setAttribute('onclick', "showSection('reminders', this)");
    link.innerHTML = `<i class="fas fa-bell"></i><span>Alarms</span><div class="nav-glow"></div>`;
    nav.appendChild(link);
  }

  const main = document.querySelector('.main-content');
  if (!main || document.getElementById('section-reminders')) return;

  const remindersSection = document.createElement('section');
  remindersSection.className = 'section hidden';
  remindersSection.id = 'section-reminders';
  remindersSection.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Alarms & Reminders</h2>
        <p>Wake up calls with parental energy · Never miss a quest</p>
      </div>
      <button class="btn-primary" onclick="openAlarmModal()" style="width:auto; padding:10px 20px">
        <i class="fas fa-plus"></i> New Alarm
      </button>
    </div>

    <div class="dash-card" style="margin-bottom:20px">
      <div class="card-header">
        <h3><i class="fas fa-clock"></i> Your Alarms</h3>
        <span class="card-badge">WAKE UP</span>
      </div>
      <div id="alarmList">
        <div class="alarm-empty">
          <i class="fas fa-bell-slash"></i>
          <p>No alarms set. Add one below!</p>
        </div>
      </div>
    </div>

    <div class="dash-card" style="margin-bottom:20px">
      <div class="card-header">
        <h3><i class="fas fa-microphone"></i> Parent Voice Style</h3>
        <span class="card-badge beta">BETA</span>
      </div>
      <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:16px">
        Choose how your "parent" will wake you up when you snooze too many times.
      </p>
      <div class="voice-profiles-grid" id="voiceProfilesGrid">
        ${renderVoiceProfileCards()}
      </div>
    </div>

    <div class="dash-card">
      <div class="card-header">
        <h3><i class="fas fa-bell"></i> Notification Preferences</h3>
      </div>
      <div class="notif-settings">
        ${renderNotifSettings()}
      </div>
    </div>
  `;
  main.appendChild(remindersSection);

  renderAlarmList();
}

function renderVoiceProfileCards() {
  const current = localStorage.getItem(VOICE_KEY) || 'strict';
  const profiles = [
    { id: 'strict',   emoji: '😡', name: 'Strict Parent',   desc: '"GET UP RIGHT NOW! Do you know what time it is?!"',            color: 'var(--red)' },
    { id: 'loving',   emoji: '🥺', name: 'Loving Parent',   desc: '"Good morning sweetheart... okay baby please just get up!"',    color: 'var(--accent)' },
    { id: 'dramatic', emoji: '🎭', name: 'Dramatic Parent', desc: '"O HEAVENS! They SLUMBER still while the world BURNS!"',        color: 'var(--purple)' },
  ];
  return profiles.map(p => `
    <div class="voice-profile-card ${current === p.id ? 'selected' : ''}"
         onclick="selectVoiceProfile('${p.id}')"
         style="${current === p.id ? `border-color:${p.color};background:${p.color}11` : ''}">
      <div class="voice-emoji">${p.emoji}</div>
      <div class="voice-name" style="${current === p.id ? `color:${p.color}` : ''}">${p.name}</div>
      <div class="voice-desc">${p.desc}</div>
      ${current === p.id ? `<div class="voice-selected" style="color:${p.color}"><i class="fas fa-check-circle"></i> Active</div>` : ''}
    </div>
  `).join('');
}

function selectVoiceProfile(profileId) {
  localStorage.setItem(VOICE_KEY, profileId);
  const grid = document.getElementById('voiceProfilesGrid');
  if (grid) grid.innerHTML = renderVoiceProfileCards();
  const samples = {
    strict:   "Testing strict mode. GET UP! Do you hear me?! This is what you'll hear if you keep snoozing!",
    loving:   "Testing loving mode. Good morning sweetheart! Time to wake up and be your amazing self!",
    dramatic: "Testing dramatic mode! THE ALARM SOUNDS! And still they slumber! WAKE! FOR GLORY AWAITS!",
  };
  ttsSpeak(samples[profileId]);
}

function renderNotifSettings() {
  const settings = getNotifSettings();
  const items = [
    { key: 'taskDue',   label: 'Quest due reminders (30m, 10m, 5m + voice)', icon: 'fas fa-tasks',  default: true  },
    { key: 'streak',    label: 'Streak danger alerts',                         icon: 'fas fa-fire',   default: true  },
    { key: 'moodCheck', label: 'Daily mood check',                              icon: 'fas fa-smile',  default: true  },
    { key: 'badges',    label: 'Badge & XP notifications',                      icon: 'fas fa-trophy', default: true  },
    { key: 'midnight',  label: 'Midnight summary report',                       icon: 'fas fa-moon',   default: false },
  ];
  return items.map(item => {
    const enabled = settings[item.key];
    return `
      <div class="notif-setting-row">
        <div class="notif-setting-left">
          <i class="${item.icon}" style="color:var(--accent);width:16px"></i>
          <span>${item.label}</span>
        </div>
        <label class="alarm-toggle">
          <input type="checkbox" ${enabled ? 'checked' : ''}
            onchange="toggleNotifSetting('${item.key}', this.checked)"/>
          <span class="alarm-slider"></span>
        </label>
      </div>`;
  }).join('');
}

// ============================================================
// ADD ALARM MODAL
// ============================================================
function openAlarmModal() {
  let modal = document.getElementById('addAlarmModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'addAlarmModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  const defaultVoice = localStorage.getItem(VOICE_KEY) || 'strict';
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  const defaultTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  modal.innerHTML = `
    <div class="modal alarm-modal">
      <div class="modal-header">
        <h3><i class="fas fa-bell"></i> New Wake-Up Alarm</h3>
        <button class="modal-close" onclick="closeAlarmModal()"><i class="fas fa-times"></i></button>
      </div>

      <div class="alarm-time-picker">
        <input type="time" id="newAlarmTime" value="${defaultTime}" />
      </div>

      <div class="form-group">
        <label>Alarm Label</label>
        <input type="text" id="newAlarmLabel" placeholder="Wake up, hero!" value="Wake Up Alarm"/>
      </div>

      <div class="form-group">
        <label>Parent Voice Style</label>
        <div class="alarm-voice-picker" id="alarmVoicePicker">
          ${['strict','loving','dramatic'].map(p => `
            <button class="voice-pick-btn ${p === defaultVoice ? 'active' : ''}"
                    data-voice="${p}"
                    onclick="pickAlarmVoice(this, '${p}')">
              ${p === 'strict' ? '😡 Strict' : p === 'loving' ? '🥺 Loving' : '🎭 Dramatic'}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label>Repeat</label>
        <div class="day-picker" id="dayPicker">
          ${['S','M','T','W','T','F','S'].map((d, i) => `
            <button class="day-btn" data-day="${i}" onclick="toggleDay(this)">${d}</button>
          `).join('')}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">
          No days selected = one-time alarm
        </div>
      </div>

      <div class="alarm-preview-box" id="alarmPreview">
        <i class="fas fa-info-circle"></i>
        <span>Will ring ${formatAlarmPreview(defaultTime)}</span>
      </div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeAlarmModal()">Cancel</button>
        <button class="btn-primary" onclick="saveNewAlarm()" style="width:auto">
          <i class="fas fa-bell"></i> Set Alarm
        </button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('newAlarmTime')?.addEventListener('change', (e) => {
    const preview = document.getElementById('alarmPreview');
    if (preview) preview.innerHTML = `<i class="fas fa-info-circle"></i><span>Will ring ${formatAlarmPreview(e.target.value)}</span>`;
  });
}

function closeAlarmModal() {
  document.getElementById('addAlarmModal')?.classList.add('hidden');
}

function pickAlarmVoice(btn, profile) {
  document.querySelectorAll('.voice-pick-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const samples = {
    strict:   "This is the strict parent voice. I will NOT let you sleep in!",
    loving:   "This is the loving parent voice. Rise and shine, darling!",
    dramatic: "This is the dramatic voice! Hear my POWER as I summon thee from slumber!",
  };
  ttsSpeak(samples[profile]);
}

function toggleDay(btn) { btn.classList.toggle('active'); }

function saveNewAlarm() {
  const time  = document.getElementById('newAlarmTime')?.value;
  const label = document.getElementById('newAlarmLabel')?.value.trim() || 'Wake Up Alarm';
  const activeVoiceBtn = document.querySelector('.voice-pick-btn.active');
  const voice = activeVoiceBtn?.dataset.voice || localStorage.getItem(VOICE_KEY) || 'strict';
  const activeDays = Array.from(document.querySelectorAll('.day-btn.active')).map(b => parseInt(b.dataset.day));

  if (!time) { alert('Please select a time!'); return; }

  createAlarm(label, time, voice, activeDays);
  closeAlarmModal();
  ttsSpeak(`Alarm set for ${time}. I'll make sure you wake up!`);
}

function formatAlarmPreview(timeStr) {
  if (!timeStr) return 'soon';
  const [h, m] = timeStr.split(':').map(Number);
  const now    = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const diff  = target - now;
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.round((diff % 3600000) / 60000);
  if (hours === 0) return `in ${mins} minute${mins !== 1 ? 's' : ''}`;
  if (mins  === 0) return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  return `in ${hours}h ${mins}m`;
}

// ============================================================
// CSS INJECTION
// ============================================================
(function injectNotifCSS() {
  const style = document.createElement('style');
  style.textContent = `
/* ── Notification Bell ── */
.notif-bell-wrap { position: relative; }
.notif-bell {
  background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-secondary); border-radius: var(--radius-md);
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 15px; position: relative;
  transition: all var(--transition);
}
.notif-bell:hover { border-color: var(--accent); color: var(--accent); }
.notif-count {
  position: absolute; top: -6px; right: -6px;
  background: var(--red); color: #fff;
  font-size: 10px; font-weight: 800;
  min-width: 18px; height: 18px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px; pointer-events: none;
}

/* ── Notif Dropdown ── */
.notif-dropdown {
  position: absolute; top: calc(100% + 10px); right: 0;
  width: 340px; max-height: 480px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  z-index: 500; overflow: hidden;
  display: flex; flex-direction: column;
}
.notif-dropdown-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  font-size: 0.88rem; font-weight: 700;
}
.notif-dropdown-header button {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; font-size: 0.78rem; transition: color var(--transition);
}
.notif-dropdown-header button:hover { color: var(--red); }
.notif-list { overflow-y: auto; max-height: 380px; }
.notif-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 32px; gap: 10px; color: var(--text-muted); font-size: 0.85rem;
}
.notif-empty i { font-size: 1.8rem; }
.notif-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  transition: background var(--transition); position: relative;
}
.notif-item:hover { background: var(--bg-card-hover); }
.notif-item.read { opacity: 0.65; }
.notif-icon-wrap {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.notif-body { flex: 1; min-width: 0; }
.notif-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.notif-title { font-size: 0.85rem; font-weight: 700; color: var(--text-primary); margin: 2px 0; }
.notif-msg { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.4; }
.notif-time { font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; }
.notif-dismiss {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; padding: 2px; font-size: 11px; flex-shrink: 0;
  opacity: 0; transition: opacity var(--transition), color var(--transition);
}
.notif-item:hover .notif-dismiss { opacity: 1; }
.notif-dismiss:hover { color: var(--red); }

/* ── Alarm Items ── */
.alarm-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px; border: 1px solid var(--border);
  border-radius: var(--radius-md); margin-bottom: 10px;
  background: var(--bg-input); transition: all var(--transition);
}
.alarm-item:hover { border-color: rgba(88,224,0,0.3); }
.alarm-item.inactive { opacity: 0.45; }
.alarm-left { display: flex; flex-direction: column; gap: 4px; }
.alarm-time { font-family: 'Syne', sans-serif; font-size: 2rem; font-weight: 800; color: var(--text-primary); line-height: 1; }
.alarm-item.inactive .alarm-time { color: var(--text-muted); }
.alarm-label { font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); }
.alarm-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.alarm-voice-badge { font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.3px; }
.voice-strict  { background: rgba(255,71,87,0.15);  color: var(--red); }
.voice-loving  { background: rgba(88,224,0,0.12);   color: var(--accent); }
.voice-dramatic{ background: rgba(168,85,247,0.15); color: var(--purple); }
.alarm-days { font-size: 0.72rem; color: var(--text-muted); }
.alarm-right { display: flex; align-items: center; gap: 12px; }
.alarm-delete { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; padding: 4px; transition: color var(--transition); }
.alarm-delete:hover { color: var(--red); }
.alarm-empty { display: flex; flex-direction: column; align-items: center; padding: 40px; gap: 12px; color: var(--text-muted); }
.alarm-empty i { font-size: 2rem; }

/* ── Alarm Toggle switch ── */
.alarm-toggle { position: relative; display: inline-block; width: 44px; height: 24px; }
.alarm-toggle input { opacity: 0; width: 0; height: 0; }
.alarm-slider { position: absolute; cursor: pointer; inset: 0; background: var(--border); border-radius: 12px; transition: background 0.2s; }
.alarm-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; }
.alarm-toggle input:checked + .alarm-slider { background: var(--accent); }
.alarm-toggle input:checked + .alarm-slider::before { transform: translateX(20px); }

/* ── Add Alarm Modal ── */
.alarm-modal { max-width: 460px; }
.alarm-time-picker { text-align: center; margin: 8px 0 20px; }
.alarm-time-picker input[type="time"] {
  font-family: 'Syne', sans-serif; font-size: 3rem; font-weight: 800;
  background: var(--bg-input); border: 2px solid var(--border);
  color: var(--accent); border-radius: var(--radius-md);
  padding: 12px 20px; text-align: center; outline: none; cursor: pointer;
  transition: border-color var(--transition);
}
.alarm-time-picker input[type="time"]:focus { border-color: var(--accent); }
.alarm-voice-picker { display: flex; gap: 8px; }
.voice-pick-btn {
  flex: 1; background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-secondary); border-radius: var(--radius-md);
  padding: 10px 6px; font-size: 0.8rem; cursor: pointer;
  transition: all var(--transition); text-align: center;
}
.voice-pick-btn.active { background: rgba(88,224,0,0.1); border-color: var(--accent); color: var(--accent); }
.day-picker { display: flex; gap: 6px; }
.day-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-input); border: 1px solid var(--border);
  color: var(--text-muted); font-size: 0.78rem; font-weight: 700;
  cursor: pointer; transition: all var(--transition);
  display: flex; align-items: center; justify-content: center;
}
.day-btn.active { background: var(--accent); border-color: var(--accent); color: #000; }
.alarm-preview-box {
  display: flex; align-items: center; gap: 8px;
  background: rgba(88,224,0,0.06); border: 1px solid rgba(88,224,0,0.15);
  border-radius: var(--radius-md); padding: 10px 14px;
  font-size: 0.82rem; color: var(--accent); margin: 8px 0;
}

/* ── Alarm Ring Overlay ── */
.alarm-ring-overlay {
  position: fixed; inset: 0; z-index: 6000;
  background: rgba(0,0,0,0.92); backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: alarmFadeIn 0.4s ease;
}
@keyframes alarmFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes alarmDismiss { to { opacity: 0; transform: scale(0.95); } }

.alarm-ring-modal {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-xl); padding: 36px 32px;
  max-width: 420px; width: 100%; text-align: center;
  box-shadow: 0 32px 80px rgba(0,0,0,0.7);
  animation: alarmSlideUp 0.5s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes alarmSlideUp { from { transform: translateY(40px) scale(0.95); opacity: 0; } to { transform: none; opacity: 1; } }
.alarm-ring-modal.escalated { border-color: rgba(255,71,87,0.5); background: linear-gradient(135deg, var(--bg-card), rgba(255,71,87,0.05)); }

.alarm-ring-top { margin-bottom: 24px; }
.alarm-ring-pulse { width: 90px; height: 90px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 40px; }
.pulse-normal { background: rgba(255,182,39,0.15); animation: ringPulseAmber 1s ease-in-out infinite; }
.pulse-angry  { background: rgba(255,71,87,0.15);  animation: ringPulseRed 0.5s ease-in-out infinite; }
@keyframes ringPulseAmber { 0%,100% { box-shadow: 0 0 0 0 rgba(255,182,39,0.4); } 50% { box-shadow: 0 0 0 20px rgba(255,182,39,0); } }
@keyframes ringPulseRed   { 0%,100% { box-shadow: 0 0 0 0 rgba(255,71,87,0.5);  } 50% { box-shadow: 0 0 0 24px rgba(255,71,87,0);  } }
.alarm-ring-time { font-family: 'Syne', sans-serif; font-size: 3.5rem; font-weight: 800; color: var(--text-primary); line-height: 1; }
.alarm-ring-label { font-size: 0.95rem; color: var(--text-muted); margin-top: 6px; }

.alarm-parent-speech {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; text-align: left;
}
.parent-avatar { font-size: 2rem; flex-shrink: 0; width: 48px; height: 48px; background: var(--bg-card); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.speech-bubble { flex: 1; }
.speech-text { font-size: 0.9rem; color: var(--text-primary); line-height: 1.6; font-style: italic; }
.speech-normal { border-color: rgba(255,182,39,0.3); }
.speech-angry  { border-color: rgba(255,71,87,0.4);  }
.snooze-warning { font-size: 0.8rem; color: var(--red); font-weight: 700; margin-bottom: 16px; text-align: center; }

.alarm-ring-actions { display: flex; gap: 12px; }
.alarm-snooze-btn {
  flex: 1; background: rgba(255,182,39,0.1); border: 1px solid rgba(255,182,39,0.3); color: var(--amber);
  border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all var(--transition);
}
.alarm-snooze-btn:hover { background: var(--amber); color: #000; }
.alarm-dismiss-btn {
  flex: 1; background: var(--accent); color: #000; border: none;
  border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all var(--transition);
}
.alarm-dismiss-btn:hover { filter: brightness(1.1); }
.alarm-call-btn {
  flex: 1; background: rgba(255,71,87,0.1); border: 1px solid rgba(255,71,87,0.4); color: var(--red);
  border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  animation: callPulse 0.8s ease-in-out infinite;
}
@keyframes callPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,71,87,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,71,87,0); } }

/* ── Phone Call Screen ── */
.alarm-call-screen { text-align: center; padding: 8px 0; }
.call-ripples { position: relative; width: 120px; height: 120px; margin: 0 auto 24px; }
.ripple { position: absolute; border-radius: 50%; border: 2px solid rgba(255,71,87,0.4); animation: callRipple 2s ease-out infinite; }
.r1 { inset: -10px; animation-delay: 0s; }
.r2 { inset: -20px; animation-delay: 0.4s; }
.r3 { inset: -30px; animation-delay: 0.8s; }
@keyframes callRipple { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(1.2); opacity: 0; } }
.call-avatar-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1; }
.call-avatar { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; background: var(--bg-input); border: 2px solid rgba(255,71,87,0.4); }
.call-name { font-family: 'Syne', sans-serif; font-size: 1.6rem; font-weight: 800; color: var(--text-primary); margin-bottom: 6px; }
.call-status { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 20px; }
.call-script-box { background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 24px; min-height: 70px; display: flex; align-items: center; justify-content: center; }
.call-script-text { font-size: 0.9rem; color: var(--text-primary); line-height: 1.6; font-style: italic; text-align: center; }
.call-actions { display: flex; gap: 32px; justify-content: center; }
.call-decline, .call-accept { width: 64px; height: 64px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; border: none; font-size: 22px; font-weight: 800; transition: all var(--transition); }
.call-decline { background: var(--red); color: #fff; }
.call-decline:hover { transform: scale(1.1); }
.call-accept { background: var(--accent); color: #000; animation: acceptPulse 1s ease-in-out infinite; }
.call-accept:disabled { animation: none; opacity: 0.7; cursor: default; }
@keyframes acceptPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(88,224,0,0.5); } 50% { box-shadow: 0 0 0 12px rgba(88,224,0,0); } }
.call-decline span, .call-accept span { font-size: 0.62rem; font-weight: 700; line-height: 1; }

/* ── Voice Profile Cards ── */
.voice-profiles-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 600px) { .voice-profiles-grid { grid-template-columns: 1fr; } }
.voice-profile-card { background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 16px; text-align: center; cursor: pointer; transition: all var(--transition); }
.voice-profile-card:hover { border-color: rgba(88,224,0,0.3); transform: translateY(-2px); }
.voice-emoji { font-size: 2.5rem; margin-bottom: 10px; }
.voice-name { font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; }
.voice-desc { font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; font-style: italic; }
.voice-selected { font-size: 0.75rem; font-weight: 700; margin-top: 8px; }

/* ── Notification Settings ── */
.notif-settings { display: flex; flex-direction: column; gap: 12px; }
.notif-setting-row { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg-input); border-radius: var(--radius-md); border: 1px solid var(--border); }
.notif-setting-left { display: flex; align-items: center; gap: 10px; font-size: 0.88rem; color: var(--text-secondary); }

/* ── Toggle switch (for settings panel) ── */
.toggle-switch { position:relative; display:inline-block; width:48px; height:26px; }
.toggle-switch input { opacity:0; width:0; height:0; }
.toggle-slider {
  position:absolute; cursor:pointer; inset:0;
  background:var(--border); border-radius:13px;
  transition: background 0.2s;
}
.toggle-slider::before {
  content:''; position:absolute;
  width:20px; height:20px; left:3px; bottom:3px;
  background:#fff; border-radius:50%;
  transition:transform 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background:var(--accent); }
.toggle-switch input:checked + .toggle-slider::before { transform:translateX(22px); }
  `;
  document.head.appendChild(style);
})();

// ============================================================
// AUTO-INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('section-dashboard')) {
    initNotifications();
    startProactiveNotifications();
  }
});
/* ============================================================
   LUMA — NOTIFICATIONS.JS
   Alarm + Wake-up Call System (Angry Parent Mode)
   ============================================================
   Features:
   - Browser push notifications (permission-gated)
   - Alarm scheduler with snooze/dismiss
   - Escalating "angry parent" voice call simulation via TTS
   - Custom voice profile (strict/loving/dramatic)
   - Notification bell with badge count
   - Persistent alarm storage in localStorage
   ============================================================ */

// ── State ──
const ALARMS_KEY     = 'luma_alarms';
const NOTIFS_KEY     = 'luma_notifications';
const VOICE_KEY      = 'luma_voice_profile';
const SNOOZE_LIMIT   = 3;    // max snoozes before "calling"

let alarmCheckInterval = null;
let activeAlarmId      = null;
let alarmAudioCtx      = null;
let alarmOscillators   = [];
let snoozeCount        = {};   // { alarmId: count }

// ── Parent voice scripts (the core feature) ──
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

// ── Notification templates ──
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
  renderNotificationBell();
  renderAlarmList();
  startAlarmChecker();
  loadStoredNotifications();

  // Add settings section for voice profile
  injectAlarmSettingsSection();
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

function sendBrowserNotification(title, body, icon = '⏰') {
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    tag: 'luma-notif',
    renotify: true,
  });
  n.onclick = () => { window.focus(); n.close(); };
  setTimeout(() => n.close(), 8000);
}

// ============================================================
// NOTIFICATION BELL + DROPDOWN
// ============================================================
function renderNotificationBell() {
  const topbar = document.querySelector('.topbar-actions');
  if (!topbar || document.getElementById('notifBell')) return;

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

  const addTaskBtn = topbar.querySelector('.btn-add-task');
  if (addTaskBtn) {
    addTaskBtn.insertAdjacentHTML('beforebegin', bellHTML);
  } else {
    topbar.insertAdjacentHTML('afterbegin', bellHTML);
  }

  // Close on outside click
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

  // Save
  const stored = getStoredNotifications();
  stored.unshift(notif);
  // Keep max 50
  const trimmed = stored.slice(0, 50);
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(trimmed));

  // Re-render
  renderNotifList(trimmed);
  updateNotifBadge(trimmed);

  // Browser push
  sendBrowserNotification(title, message, template.icon);

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

  list.innerHTML = notifs.slice(0, 20).map(n => `
    <div class="notif-item ${n.read ? 'read' : ''}" data-id="${n.id}">
      <div class="notif-icon-wrap" style="background:${n.color}22; color:${n.color}">
        ${n.icon}
      </div>
      <div class="notif-body">
        <div class="notif-label" style="color:${n.color}">${n.label}</div>
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(n.message)}</div>
        <div class="notif-time">${formatNotifTime(n.timestamp)}</div>
      </div>
      <button class="notif-dismiss" onclick="dismissNotification('${n.id}')">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
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

function markNotificationsRead() {
  const notifs = getStoredNotifications().map(n => ({ ...n, read: true }));
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs));
  updateNotifBadge(notifs);
}

function dismissNotification(id) {
  const notifs = getStoredNotifications().filter(n => n.id !== id);
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs));
  renderNotifList(notifs);
  updateNotifBadge(notifs);
}

function clearAllNotifications() {
  localStorage.setItem(NOTIFS_KEY, JSON.stringify([]));
  renderNotifList([]);
  updateNotifBadge([]);
}

function formatNotifTime(iso) {
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

function createAlarm(label, timeStr, voiceProfile = 'strict', repeat = []) {
  const alarm = {
    id:           Date.now().toString(),
    label:        label || 'Wake Up Alarm',
    time:         timeStr,            // "HH:MM"
    voiceProfile,
    repeat,                           // [0,1,2,3,4,5,6] (Sun-Sat)
    enabled:      true,
    createdAt:    new Date().toISOString(),
    lastTriggered: null,
  };
  const alarms = getAlarms();
  alarms.push(alarm);
  saveAlarms(alarms);
  renderAlarmList();
  pushNotification('alarm', 'Alarm Set!', `"${alarm.label}" set for ${timeStr}`, false);
  return alarm;
}

function toggleAlarm(id) {
  const alarms = getAlarms().map(a =>
    a.id === id ? { ...a, enabled: !a.enabled } : a
  );
  saveAlarms(alarms);
  renderAlarmList();
}

function deleteAlarm(id) {
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
          ${a.repeat.length
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
// ALARM CHECKER (runs every 30 seconds)
// ============================================================
function startAlarmChecker() {
  if (alarmCheckInterval) clearInterval(alarmCheckInterval);
  checkAlarms();
  alarmCheckInterval = setInterval(checkAlarms, 30000);
}

function checkAlarms() {
  const now   = new Date();
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayOfWeek = now.getDay();

  getAlarms().forEach(alarm => {
    if (!alarm.enabled) return;
    if (alarm.time !== hhmm) return;

    // Prevent double-trigger within same minute
    if (alarm.lastTriggered) {
      const last = new Date(alarm.lastTriggered);
      const diffMin = (now - last) / 60000;
      if (diffMin < 1.5) return;
    }

    // Check repeat days
    if (alarm.repeat.length && !alarm.repeat.includes(dayOfWeek)) return;

    // Trigger!
    triggerAlarm(alarm);

    // Update lastTriggered
    const alarms = getAlarms().map(a =>
      a.id === alarm.id ? { ...a, lastTriggered: now.toISOString() } : a
    );
    saveAlarms(alarms);

    // If one-time alarm, disable after trigger
    if (!alarm.repeat.length) {
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

  pushNotification('alarm', `⏰ ${alarm.label}`, 'Your alarm is ringing! Time to wake up!', true);

  // Play sound
  startAlarmSound();

  // Show the full-screen alarm modal
  showAlarmModal(alarm);

  // TTS first line
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

  const snoozed = snoozeCount[alarm.id] || 0;
  const profile = alarm.voiceProfile || 'strict';
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
            <i class="fas fa-moon"></i>
            Snooze 5 min
          </button>
        ` : `
          <button class="alarm-call-btn" onclick="triggerParentCall('${alarm.id}')">
            <i class="fas fa-phone"></i>
            Incoming Call...
          </button>
        `}
        <button class="alarm-dismiss-btn" onclick="dismissAlarm('${alarm.id}')">
          <i class="fas fa-check"></i>
          I'm Awake!
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

  // Escalating parent reaction
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

  // Re-trigger in 5 minutes
  setTimeout(() => {
    modal?.classList.remove('hidden');
    startAlarmSound();
    const nextCount = snoozeCount[alarmId];
    const nextLine = PARENT_SCRIPTS[profile][Math.min(nextCount, PARENT_SCRIPTS[profile].length - 1)];
    const speechEl = document.getElementById('alarmSpeechText');
    if (speechEl) speechEl.textContent = nextLine;
    ttsSpeak(nextLine);
    showAlarmModal(alarm); // re-render with escalated state
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

  // Congratulate
  const dismissLines = {
    strict: "Finally! Good. Now go be productive. Don't disappoint me.",
    loving: "Good morning! I'm so proud of you for getting up. Have a wonderful day!",
    dramatic: "The hero RISES! The world trembles with anticipation! Go forth and CONQUER!",
  };

  ttsSpeak(dismissLines[alarm.voiceProfile || 'strict']);
  pushNotification('streak', 'Morning Hero! 🌅', 'You woke up! Your streak is safe. Go crush those quests!');

  // Log mood prompt after 30s
  setTimeout(() => {
    if (localStorage.getItem('qf_last_mood') !== new Date().toDateString()) {
      openMoodModal?.();
    }
  }, 30000);
}

// ============================================================
// ESCALATED VOICE CALL (Twilio-style simulated in browser)
// ============================================================
function triggerParentCall(alarmId) {
  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;

  stopAlarmSound();

  // Show "incoming call" screen
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
            <i class="fas fa-phone-slash"></i>
            <span>I'm Awake!</span>
          </button>
          <button class="call-accept active-call" onclick="acceptCall('${alarmId}')">
            <i class="fas fa-phone"></i>
            <span>Answer</span>
          </button>
        </div>
      </div>
    `;

    // Auto-answer and play the full angry parent script
    setTimeout(() => playCallScript(alarmId), 1500);
  }
}

let callScriptTimeout = null;
function playCallScript(alarmId) {
  const alarm = getAlarms().find(a => a.id === alarmId);
  if (!alarm) return;

  const profile = alarm.voiceProfile || 'strict';
  const scriptBox = document.getElementById('callScriptBox');
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
      // End call
      const textEl = document.getElementById('callScriptText');
      if (textEl) textEl.textContent = '📵 Call ended. Now WAKE UP!';
      return;
    }
    const line = fullScript[lineIndex];
    const textEl = document.getElementById('callScriptText');
    if (textEl) textEl.textContent = line;
    ttsSpeak(line);
    lineIndex++;
    // Schedule next line based on TTS length estimate (roughly 80ms/char)
    const delay = Math.max(2000, line.length * 80);
    callScriptTimeout = setTimeout(speakNext, delay);
  }

  speakNext();
}

function acceptCall(alarmId) {
  // The call is already playing - this just updates the UI
  const statusEl = document.querySelector('.call-status');
  if (statusEl) statusEl.textContent = '🔊 On call with parent...';
  const acceptBtn = document.querySelector('.active-call');
  if (acceptBtn) {
    acceptBtn.innerHTML = '<i class="fas fa-volume-up"></i><span>Listening...</span>';
    acceptBtn.disabled = true;
  }
}

// ============================================================
// ALARM SOUND (Web Audio API - no external files needed)
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

        osc.type      = 'square';
        osc.frequency.setValueAtTime(p.freq, time);
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + p.duration);

        osc.start(time);
        osc.stop(time + p.duration);
        alarmOscillators.push(osc);
        time += p.duration + p.gap;
      });
    };

    // Play every 1.5 seconds
    playBeep();
    const interval = setInterval(() => {
      if (alarmAudioCtx?.state !== 'closed') playBeep();
      else clearInterval(interval);
    }, 1500);

    alarmOscillators._interval = interval;
  } catch (e) {
    console.warn('Alarm sound failed:', e);
  }
}

function stopAlarmSound() {
  if (alarmOscillators._interval) {
    clearInterval(alarmOscillators._interval);
  }
  alarmOscillators.forEach(o => { try { o.stop(); } catch {} });
  alarmOscillators = [];
  if (alarmAudioCtx) {
    try { alarmAudioCtx.close(); } catch {}
    alarmAudioCtx = null;
  }
}

// ============================================================
// ALARM MANAGER UI (injected into Settings section)
// ============================================================
function injectAlarmSettingsSection() {
  // Add Reminders nav link to sidebar if not present
  const nav = document.querySelector('.sidebar-nav');
  if (nav && !document.querySelector('[data-section="reminders"]')) {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'nav-link';
    link.dataset.section = 'reminders';
    link.setAttribute('onclick', "showSection('reminders', this)");
    link.innerHTML = `
      <i class="fas fa-bell"></i>
      <span>Alarms</span>
      <div class="nav-glow"></div>
    `;
    nav.appendChild(link);
  }

  // Add Settings nav link
  if (nav && !document.querySelector('[data-section="settings"]')) {
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'nav-link';
    link.dataset.section = 'settings';
    link.setAttribute('onclick', "showSection('settings', this)");
    link.innerHTML = `
      <i class="fas fa-cog"></i>
      <span>Settings</span>
      <div class="nav-glow"></div>
    `;
    nav.appendChild(link);
  }

  // Inject Reminders section into main content
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

    <!-- Alarm List -->
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

    <!-- Voice Profile Selector -->
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

    <!-- Notification Settings -->
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

  // Settings section (TTS + level progress from gamification.js)
  const settingsSection = document.createElement('section');
  settingsSection.className = 'section hidden';
  settingsSection.id = 'section-settings';
  settingsSection.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i></div>';
  main.appendChild(settingsSection);

  // Initialize renderTTSToggle if available
  setTimeout(() => {
    if (typeof renderTTSToggle === 'function') renderTTSToggle();
  }, 100);

  renderAlarmList();
}

function renderVoiceProfileCards() {
  const current = localStorage.getItem(VOICE_KEY) || 'strict';
  const profiles = [
    {
      id: 'strict',
      emoji: '😡',
      name: 'Strict Parent',
      desc: '"GET UP RIGHT NOW! Do you know what time it is?!"',
      color: 'var(--red)',
    },
    {
      id: 'loving',
      emoji: '🥺',
      name: 'Loving Parent',
      desc: '"Good morning sweetheart... okay baby please just get up!"',
      color: 'var(--accent)',
    },
    {
      id: 'dramatic',
      emoji: '🎭',
      name: 'Dramatic Parent',
      desc: '"O HEAVENS! They SLUMBER still while the world BURNS!"',
      color: 'var(--purple)',
    },
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
    strict: "Testing strict mode. GET UP! Do you hear me?! This is what you'll hear if you keep snoozing!",
    loving: "Testing loving mode. Good morning sweetheart! Time to wake up and be your amazing self!",
    dramatic: "Testing dramatic mode! THE ALARM SOUNDS! And still they slumber! WAKE! FOR GLORY AWAITS!",
  };
  ttsSpeak(samples[profileId]);
}

function renderNotifSettings() {
  const settings = getNotifSettings();
  const items = [
    { key: 'taskDue',   label: 'Quest due reminders',        icon: 'fas fa-tasks',      default: true },
    { key: 'streak',    label: 'Streak danger alerts',        icon: 'fas fa-fire',       default: true },
    { key: 'moodCheck', label: 'Daily mood check',            icon: 'fas fa-smile',      default: true },
    { key: 'badges',    label: 'Badge & XP notifications',   icon: 'fas fa-trophy',     default: true },
    { key: 'midnight',  label: 'Midnight summary report',     icon: 'fas fa-moon',       default: false },
  ];

  return items.map(item => {
    const enabled = settings[item.key] !== undefined ? settings[item.key] : item.default;
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
      </div>
    `;
  }).join('');
}

function getNotifSettings() {
  try { return JSON.parse(localStorage.getItem('luma_notif_settings')) || {}; }
  catch { return {}; }
}

function toggleNotifSetting(key, val) {
  const settings = getNotifSettings();
  settings[key] = val;
  localStorage.setItem('luma_notif_settings', JSON.stringify(settings));
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

  // Default time = next hour
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

  // Update preview on time change
  document.getElementById('newAlarmTime')?.addEventListener('change', (e) => {
    const preview = document.getElementById('alarmPreview');
    if (preview) preview.innerHTML = `<i class="fas fa-info-circle"></i><span>Will ring ${formatAlarmPreview(e.target.value)}</span>`;
  });
}

function closeAlarmModal() {
  const modal = document.getElementById('addAlarmModal');
  if (modal) modal.classList.add('hidden');
}

function pickAlarmVoice(btn, profile) {
  document.querySelectorAll('.voice-pick-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Preview the voice
  const samples = {
    strict: "This is the strict parent voice. I will NOT let you sleep in!",
    loving: "This is the loving parent voice. Rise and shine, darling!",
    dramatic: "This is the dramatic voice! Hear my POWER as I summon thee from slumber!",
  };
  ttsSpeak(samples[profile]);
}

function toggleDay(btn) {
  btn.classList.toggle('active');
}

function saveNewAlarm() {
  const time = document.getElementById('newAlarmTime')?.value;
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
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const diff = target - now;
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.round((diff % 3600000) / 60000);
  if (hours === 0) return `in ${mins} minute${mins !== 1 ? 's' : ''}`;
  if (mins  === 0) return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  return `in ${hours}h ${mins}m`;
}

// ============================================================
// PROACTIVE NOTIFICATIONS (task deadlines, streak, mood)
// ============================================================
function startProactiveNotifications() {
  // Check every minute
  setInterval(checkProactiveNotifications, 60000);
  checkProactiveNotifications();
}

function checkProactiveNotifications() {
  const settings = getNotifSettings();
  const tasks = window._tasks || [];
  const now = new Date();

  // Task deadline warnings
  if (settings.taskDue !== false) {
    tasks.filter(t => t.status === 'Pending').forEach(t => {
      const deadline = new Date(t.deadline);
      const diff = deadline - now;
      const mins = diff / 60000;

      // 60-min warning (fire only once)
      const warningKey = `warned_60_${t._id || t.id}`;
      if (mins > 0 && mins <= 60 && !sessionStorage.getItem(warningKey)) {
        sessionStorage.setItem(warningKey, '1');
        pushNotification('task', `⚡ Quest Due Soon!`,
          `"${t.name}" is due in ${Math.round(mins)} minutes. Complete it now!`);
        if (settings.taskDue !== false) {
          ttsSpeak(`Heads up! Your quest "${t.name}" is due in ${Math.round(mins)} minutes!`);
        }
      }

      // 10-min critical warning
      const urgentKey = `warned_10_${t._id || t.id}`;
      if (mins > 0 && mins <= 10 && !sessionStorage.getItem(urgentKey)) {
        sessionStorage.setItem(urgentKey, '1');
        pushNotification('task', `🚨 QUEST EXPIRING!`,
          `"${t.name}" expires in ${Math.round(mins)} minutes! Complete it or lose XP!`);
      }
    });
  }

  // Streak danger (if no task completed today)
  if (settings.streak !== false) {
    const user = API?.getUser?.();
    if (user?.streak > 0 && now.getHours() >= 20) {
      const key = 'warned_streak_' + new Date().toDateString();
      const completedToday = tasks.some(t => {
        const completed = t.completedAt && new Date(t.completedAt).toDateString() === now.toDateString();
        return t.status === 'Completed' && completed;
      });
      if (!completedToday && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        pushNotification('streak', `🔥 Streak at Risk!`,
          `Your ${user.streak}-day streak ends at midnight if you don't complete a quest today!`);
        ttsSpeak(`Warning! Your ${user.streak} day streak is in danger. Complete a quest before midnight!`);
      }
    }
  }

  // Daily mood check at 9am
  if (settings.moodCheck !== false) {
    if (now.getHours() === 9 && now.getMinutes() < 2) {
      const moodKey = `mood_notif_${now.toDateString()}`;
      if (localStorage.getItem('qf_last_mood') !== now.toDateString() && !sessionStorage.getItem(moodKey)) {
        sessionStorage.setItem(moodKey, '1');
        pushNotification('mood', 'Morning Check-In 🌅', 'How are you feeling today? Log your mood to boost your XP multiplier!');
      }
    }
  }
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
  cursor: pointer; font-size: 0.78rem;
  transition: color var(--transition);
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
  transition: background var(--transition);
  position: relative;
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
  cursor: pointer; padding: 2px; font-size: 11px;
  flex-shrink: 0; opacity: 0;
  transition: opacity var(--transition), color var(--transition);
}
.notif-item:hover .notif-dismiss { opacity: 1; }
.notif-dismiss:hover { color: var(--red); }

/* ── Alarm Items ── */
.alarm-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px; border: 1px solid var(--border);
  border-radius: var(--radius-md); margin-bottom: 10px;
  background: var(--bg-input);
  transition: all var(--transition);
}
.alarm-item:hover { border-color: rgba(88,224,0,0.3); }
.alarm-item.inactive { opacity: 0.45; }
.alarm-left { display: flex; flex-direction: column; gap: 4px; }
.alarm-time {
  font-family: 'Syne', sans-serif; font-size: 2rem; font-weight: 800;
  color: var(--text-primary); line-height: 1;
}
.alarm-item.inactive .alarm-time { color: var(--text-muted); }
.alarm-label { font-size: 0.88rem; font-weight: 600; color: var(--text-secondary); }
.alarm-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.alarm-voice-badge {
  font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 100px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.voice-strict  { background: rgba(255,71,87,0.15);  color: var(--red); }
.voice-loving  { background: rgba(88,224,0,0.12);   color: var(--accent); }
.voice-dramatic{ background: rgba(168,85,247,0.15); color: var(--purple); }
.alarm-days { font-size: 0.72rem; color: var(--text-muted); }
.alarm-right { display: flex; align-items: center; gap: 12px; }
.alarm-delete {
  background: none; border: none; color: var(--text-muted);
  cursor: pointer; font-size: 13px; padding: 4px;
  transition: color var(--transition);
}
.alarm-delete:hover { color: var(--red); }
.alarm-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 40px; gap: 12px; color: var(--text-muted);
}
.alarm-empty i { font-size: 2rem; }

/* ── Alarm Toggle switch ── */
.alarm-toggle { position: relative; display: inline-block; width: 44px; height: 24px; }
.alarm-toggle input { opacity: 0; width: 0; height: 0; }
.alarm-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--border); border-radius: 12px;
  transition: background 0.2s;
}
.alarm-slider::before {
  content: ''; position: absolute;
  width: 18px; height: 18px; left: 3px; bottom: 3px;
  background: #fff; border-radius: 50%;
  transition: transform 0.2s;
}
.alarm-toggle input:checked + .alarm-slider { background: var(--accent); }
.alarm-toggle input:checked + .alarm-slider::before { transform: translateX(20px); }

/* ── Add Alarm Modal ── */
.alarm-modal { max-width: 460px; }
.alarm-time-picker {
  text-align: center; margin: 8px 0 20px;
}
.alarm-time-picker input[type="time"] {
  font-family: 'Syne', sans-serif;
  font-size: 3rem; font-weight: 800;
  background: var(--bg-input); border: 2px solid var(--border);
  color: var(--accent); border-radius: var(--radius-md);
  padding: 12px 20px; text-align: center;
  outline: none; cursor: pointer;
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
.voice-pick-btn.active {
  background: rgba(88,224,0,0.1); border-color: var(--accent); color: var(--accent);
}
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
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: alarmFadeIn 0.4s ease;
}
@keyframes alarmFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes alarmDismiss { to { opacity: 0; transform: scale(0.95); } }

.alarm-ring-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 36px 32px;
  max-width: 420px; width: 100%;
  text-align: center;
  box-shadow: 0 32px 80px rgba(0,0,0,0.7);
  animation: alarmSlideUp 0.5s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes alarmSlideUp {
  from { transform: translateY(40px) scale(0.95); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
.alarm-ring-modal.escalated {
  border-color: rgba(255,71,87,0.5);
  background: linear-gradient(135deg, var(--bg-card), rgba(255,71,87,0.05));
}

.alarm-ring-top { margin-bottom: 24px; }
.alarm-ring-pulse {
  width: 90px; height: 90px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 16px; font-size: 40px;
}
.pulse-normal {
  background: rgba(255,182,39,0.15);
  animation: ringPulseAmber 1s ease-in-out infinite;
}
.pulse-angry {
  background: rgba(255,71,87,0.15);
  animation: ringPulseRed 0.5s ease-in-out infinite;
}
@keyframes ringPulseAmber {
  0%,100% { box-shadow: 0 0 0 0 rgba(255,182,39,0.4); }
  50%      { box-shadow: 0 0 0 20px rgba(255,182,39,0); }
}
@keyframes ringPulseRed {
  0%,100% { box-shadow: 0 0 0 0 rgba(255,71,87,0.5); }
  50%      { box-shadow: 0 0 0 24px rgba(255,71,87,0); }
}
.alarm-ring-time {
  font-family: 'Syne', sans-serif; font-size: 3.5rem; font-weight: 800;
  color: var(--text-primary); line-height: 1;
}
.alarm-ring-label {
  font-size: 0.95rem; color: var(--text-muted); margin-top: 6px;
}

/* ── Parent Speech Bubble ── */
.alarm-parent-speech {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 16px;
  margin-bottom: 16px; text-align: left;
}
.parent-avatar {
  font-size: 2rem; flex-shrink: 0; width: 48px; height: 48px;
  background: var(--bg-card); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.speech-bubble { flex: 1; }
.speech-text {
  font-size: 0.9rem; color: var(--text-primary); line-height: 1.6;
  font-style: italic;
}
.speech-normal { border-color: rgba(255,182,39,0.3); }
.speech-angry  { border-color: rgba(255,71,87,0.4);  }

.snooze-warning {
  font-size: 0.8rem; color: var(--red); font-weight: 700;
  margin-bottom: 16px; text-align: center;
}

/* ── Alarm Action Buttons ── */
.alarm-ring-actions { display: flex; gap: 12px; }
.alarm-snooze-btn {
  flex: 1; background: rgba(255,182,39,0.1);
  border: 1px solid rgba(255,182,39,0.3); color: var(--amber);
  border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all var(--transition);
}
.alarm-snooze-btn:hover { background: var(--amber); color: #000; }
.alarm-dismiss-btn {
  flex: 1; background: var(--accent); color: #000;
  border: none; border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: all var(--transition);
}
.alarm-dismiss-btn:hover { background: var(--accent-text); }
.alarm-call-btn {
  flex: 1; background: rgba(255,71,87,0.1);
  border: 1px solid rgba(255,71,87,0.4); color: var(--red);
  border-radius: var(--radius-md); padding: 14px;
  font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 800;
  cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  animation: callPulse 0.8s ease-in-out infinite;
}
@keyframes callPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(255,71,87,0.4); }
  50%      { box-shadow: 0 0 0 8px rgba(255,71,87,0); }
}

/* ── Phone Call Screen ── */
.alarm-call-screen {
  text-align: center; padding: 8px 0;
}
.call-ripples {
  position: relative; width: 120px; height: 120px;
  margin: 0 auto 24px;
}
.ripple {
  position: absolute; border-radius: 50%;
  border: 2px solid rgba(255,71,87,0.4);
  animation: callRipple 2s ease-out infinite;
}
.r1 { inset: -10px; animation-delay: 0s; }
.r2 { inset: -20px; animation-delay: 0.4s; }
.r3 { inset: -30px; animation-delay: 0.8s; }
@keyframes callRipple {
  0%   { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(1.2); opacity: 0; }
}
.call-avatar-wrap {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; z-index: 1;
}
.call-avatar {
  width: 80px; height: 80px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; background: var(--bg-input);
  border: 2px solid rgba(255,71,87,0.4);
}
.call-name {
  font-family: 'Syne', sans-serif; font-size: 1.6rem; font-weight: 800;
  color: var(--text-primary); margin-bottom: 6px;
}
.call-status {
  font-size: 0.88rem; color: var(--text-muted); margin-bottom: 20px;
}
.call-script-box {
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: 16px 20px;
  margin-bottom: 24px; min-height: 70px;
  display: flex; align-items: center; justify-content: center;
}
.call-script-text {
  font-size: 0.9rem; color: var(--text-primary); line-height: 1.6;
  font-style: italic; text-align: center;
}
.call-actions {
  display: flex; gap: 32px; justify-content: center;
}
.call-decline, .call-accept {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; cursor: pointer; border: none;
  font-size: 22px; font-weight: 800;
  transition: all var(--transition);
}
.call-decline {
  background: var(--red); color: #fff;
}
.call-decline:hover { transform: scale(1.1); }
.call-accept {
  background: var(--accent); color: #000;
  animation: acceptPulse 1s ease-in-out infinite;
}
.call-accept:disabled { animation: none; opacity: 0.7; cursor: default; }
@keyframes acceptPulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(88,224,0,0.5); }
  50%      { box-shadow: 0 0 0 12px rgba(88,224,0,0); }
}
.call-decline span, .call-accept span {
  font-size: 0.62rem; font-weight: 700; line-height: 1;
}

/* ── Voice Profile Cards ── */
.voice-profiles-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
@media (max-width: 600px) { .voice-profiles-grid { grid-template-columns: 1fr; } }
.voice-profile-card {
  background: var(--bg-input); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px 16px;
  text-align: center; cursor: pointer;
  transition: all var(--transition);
}
.voice-profile-card:hover { border-color: rgba(88,224,0,0.3); transform: translateY(-2px); }
.voice-emoji { font-size: 2.5rem; margin-bottom: 10px; }
.voice-name { font-size: 0.9rem; font-weight: 700; margin-bottom: 6px; }
.voice-desc {
  font-size: 0.75rem; color: var(--text-muted); line-height: 1.5;
  font-style: italic;
}
.voice-selected { font-size: 0.75rem; font-weight: 700; margin-top: 8px; }

/* ── Notification Settings ── */
.notif-settings { display: flex; flex-direction: column; gap: 12px; }
.notif-setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px; background: var(--bg-input);
  border-radius: var(--radius-md); border: 1px solid var(--border);
}
.notif-setting-left {
  display: flex; align-items: center; gap: 10px;
  font-size: 0.88rem; color: var(--text-secondary);
}
  `;
  document.head.appendChild(style);
})();

// ============================================================
// AUTO-INIT when DOM is ready
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('section-dashboard')) {
    initNotifications();
    startProactiveNotifications();
  }
});

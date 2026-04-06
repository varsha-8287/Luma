/* ============================================================
   QUESTFLOW — MAIN.JS
   Auth handling, routing, dashboard bootstrap, TTS, confetti
   ============================================================ */

// ── State ──
let currentUser = null;
let ttsEnabled = localStorage.getItem('qf_tts') !== 'false';

// ============================================================
// AUTH PAGE (index.html)
// ============================================================
if (document.getElementById('loginForm')) {

  // Generate floating XP particles
  (function spawnParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    const texts = ['+10 XP', '+20 XP', '⭐ Level Up!', '🔥 Streak!', '+5 XP'];
    setInterval(() => {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.cssText = `
        left: ${Math.random() * 100}%;
        top: ${80 + Math.random() * 20}%;
        animation-delay: ${Math.random() * 2}s;
        animation-duration: ${3 + Math.random() * 3}s;
      `;
      container.appendChild(p);
      setTimeout(() => p.remove(), 6000);
    }, 800);
  })();

  // Animate stat counters on left panel
  document.querySelectorAll('.stat-num[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target);
    let current = 0;
    const step = target / 50;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = Math.floor(current);
      if (current >= target) clearInterval(timer);
    }, 30);
  });

  // Enter key support
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const loginForm = document.getElementById('loginForm');
    if (!loginForm.classList.contains('hidden')) handleLogin();
    else handleRegister();
  });
}

// Tab switching
function switchTab(tab) {
  const indicator = document.getElementById('tabIndicator');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    indicator.classList.remove('right');
  } else {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    indicator.classList.add('right');
  }
  clearErrors();
}

function clearErrors() {
  ['loginError','registerError','registerSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.closest('.auth-form')?.classList.add('shake');
  setTimeout(() => el.closest('.auth-form')?.classList.remove('shake'), 400);
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.style.opacity = loading ? '0' : '1';
  if (loader) loader.classList.toggle('hidden', !loading);
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  clearErrors();
  if (!email || !password) return showError('loginError', 'Please fill in all fields.');
  setLoading('loginBtn', true);
  try {
    const data = await API.login(email, password);
    ttsSpeak(`Welcome back, ${data.user?.name || 'Hero'}! Your quests await.`);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError('loginError', err.message);
  } finally {
    setLoading('loginBtn', false);
  }
}

async function handleRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;
  clearErrors();
  if (!name || !email || !password) return showError('registerError', 'Please fill in all fields.');
  if (password !== confirm) return showError('registerError', 'Passwords do not match.');
  if (password.length < 6) return showError('registerError', 'Password must be at least 6 characters.');
  setLoading('registerBtn', true);
  try {
    const data = await API.register(name, email, password);
    ttsSpeak(`Welcome to QuestFlow, ${name}! Your adventure begins now.`);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError('registerError', err.message);
  } finally {
    setLoading('registerBtn', false);
  }
}

function togglePassword(id, btn) {
  const input = document.getElementById(id);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
}

// ============================================================
// DASHBOARD (dashboard.html)
// ============================================================
if (document.getElementById('section-dashboard')) {
  // Auth guard
  if (!API.getToken()) {
    window.location.href = 'index.html';
  }

  currentUser = API.getUser();

  // Scripts are at the bottom of <body> so DOMContentLoaded has already fired
  // by the time this code runs — addEventListener would register too late.
  // Use readyState check so it works in both cases.
  async function initDashboard() {
    console.log('[Luma] initDashboard() called, readyState:', document.readyState);
    initTimeGreeting();
    renderUserUI();
    await loadDashboardData();
    checkMoodPopup();
    checkReminders();
  }

  console.log('[Luma] section-dashboard found, readyState:', document.readyState);

  if (document.readyState === 'loading') {
    console.log('[Luma] DOM still loading — adding DOMContentLoaded listener');
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    console.log('[Luma] DOM already ready — calling initDashboard directly');
    initDashboard();
  }
}

function initTimeGreeting() {
  const h = new Date().getHours();
  const el = document.getElementById('timeOfDay');
  if (!el) return;
  if (h < 12) el.textContent = 'morning';
  else if (h < 17) el.textContent = 'afternoon';
  else el.textContent = 'evening';
}

function renderUserUI() {
  if (!currentUser) return;
  const name = currentUser.name || 'Hero';
  ['topbarName', 'sidebarName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });
  const av = document.getElementById('sidebarAvatar');
  if (av) av.textContent = name[0].toUpperCase();
  const slevel = document.getElementById('sidebarLevel');
  if (slevel) slevel.textContent = `Level ${currentUser.level || 0}`;
}

async function loadDashboardData() {
  try {
    // Load in parallel
    const [tasks, moodSummary, scoreData, prediction] = await Promise.allSettled([
      API.getTasks(),
      API.getDailySummary(),
      API.getProductivityScore(),
      API.getPrediction()
    ]);

    if (tasks.status === 'fulfilled') {
      window._tasks = tasks.value;
      if (typeof _checkProactiveNotifications === 'function') _checkProactiveNotifications();
      renderDashboardTasks(tasks.value);
      renderTaskBoard(tasks.value);
      updateTaskBadge(tasks.value);
    }
    if (moodSummary.status === 'fulfilled') {
      renderMoodDisplay(moodSummary.value);
    }
    if (scoreData.status === 'fulfilled') {
      renderProductivityScore(scoreData.value);
      renderUserStats(scoreData.value);
    }
    if (prediction.status === 'fulfilled') {
      renderPrediction(prediction.value);
    }

    // Load suggestions from patterns
    loadSmartSuggestions();
    loadBadges();
    loadJournal();

  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ── User stats ──
function renderUserStats(data) {
  const user = data.user || currentUser || {};
  const xp   = user.totalXP  || data.total_xp  || 0;
  const level = user.level    || data.level      || 0;
  const streak = user.streak  || data.streak     || 0;
  const score  = data.score   || data.productivity_score || null;

  // Update local ref
  if (currentUser) {
    currentUser.totalXP = xp;
    currentUser.level   = level;
    currentUser.streak  = streak;
    API.setUser(currentUser);
  }

  const xpProgress = xp % 100;

  setEl('statXP', xp);
  setEl('statLevel', level);
  setEl('statStreak', streak);
  setEl('statScore', score !== null ? score : '—');
  setEl('xpLevel', level);
  setEl('xpNextLevel', level + 1);
  setEl('xpProgressText', `${xpProgress} / 100 XP to next level`);
  setEl('topbarStreak', streak);
  setEl('sidebarLevel', `Level ${level}`);

  // XP bar
  const pct = xpProgress;
  const bar = document.getElementById('xpBar');
  const glow = document.getElementById('xpBarGlow');
  if (bar) setTimeout(() => { bar.style.width = pct + '%'; }, 100);
  if (glow) setTimeout(() => { glow.style.width = pct + '%'; }, 100);

  // Sidebar mini bar
  const miniFill = document.getElementById('xpMiniFill');
  if (miniFill) setTimeout(() => { miniFill.style.width = pct + '%'; }, 100);
  setEl('xpMiniLabel', `${xpProgress} / 100 XP`);

  // Streak chip animation
  if (streak >= 3) {
    document.querySelector('.streak-chip')?.classList.add('streak-active');
  }
}

// ── Dashboard task list ──
function renderDashboardTasks(tasks) {
  const container = document.getElementById('todayTaskList');
  if (!container) return;
  const today = new Date();
  const todayTasks = tasks.filter(t => {
    const d = new Date(t.deadline);
    return d.toDateString() === today.toDateString() || t.status === 'Pending';
  }).slice(0, 6);

  if (!todayTasks.length) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>All clear! No quests today.</p></div>';
    return;
  }

  container.innerHTML = todayTasks.map((t, i) => `
    <div class="task-item ${t.status.toLowerCase()} card-enter stagger-${Math.min(i+1,5)}"
         onclick="quickCompleteTask('${t._id || t.id}', this)" data-id="${t._id || t.id}">
      <div class="task-check">
        ${t.status === 'Completed' ? '<i class="fas fa-check check-icon"></i>' : ''}
        ${t.status === 'Missed' ? '<i class="fas fa-times check-icon"></i>' : ''}
      </div>
      <div class="text">
        <div class="task-name ${t.status === 'Completed' ? 'done' : ''}">${escHtml(t.name)}</div>
        <div class="task-meta">${formatDeadline(t.deadline)} · ${getCategoryEmoji(t.category)} ${t.category || 'Task'}</div>
      </div>
      <div class="priority-dot priority-${t.priority || 2}"></div>
    </div>
  `).join('');
}

function updateTaskBadge(tasks) {
  const pending = tasks.filter(t => t.status === 'Pending').length;
  const badge = document.getElementById('pendingBadge');
  if (badge) badge.textContent = pending;
}

// ── Mood display ──
function renderMoodDisplay(data) {
  const moods = data.moods || [];
  const lastMood = moods[0];
  const moodMap = { Happy: '😊', Neutral: '😐', Sad: '😢', Angry: '😠', Tired: '😴' };
  if (lastMood) {
    setEl('moodEmoji', moodMap[lastMood.moodType] || '🤔');
    setEl('moodType', lastMood.moodType);
    setEl('moodScore', `Score: ${lastMood.moodScore > 0 ? '+' : ''}${lastMood.moodScore}`);
  }
}

// ── Productivity Score Ring ──
function renderProductivityScore(data) {
  const score = data.score || data.productivity_score || 0;
  const factors = data.factors || {};

  setEl('scoreRingNum', Math.round(score));
  setEl('statScore', Math.round(score));

  // Animate ring (circumference = 2π × 50 ≈ 314)
  const fill = document.getElementById('scoreRingFill');
  if (fill) {
    const offset = 314 - (score / 100) * 314;
    setTimeout(() => { fill.style.strokeDashoffset = offset; }, 300);

    // Color by score
    if (score >= 75) fill.style.stroke = 'var(--accent)';
    else if (score >= 50) fill.style.stroke = 'var(--amber)';
    else fill.style.stroke = 'var(--red)';
  }

  // Factors
  const factorNames = {
    completion_rate: 'Completion Rate',
    streak_score: 'Streak',
    mood_stability: 'Mood Stability',
    difficulty_bonus: 'Task Difficulty'
  };
  const container = document.getElementById('scoreFactors');
  if (container && Object.keys(factors).length) {
    container.innerHTML = Object.entries(factors).map(([k, v]) => `
      <div class="score-factor">
        <span class="factor-label">${factorNames[k] || k}</span>
        <div class="factor-bar"><div class="factor-fill" style="width:${Math.round(v)}%"></div></div>
        <span class="factor-val">${Math.round(v)}%</span>
      </div>
    `).join('');
  }

  renderUserStats(data);
}

// ── Prediction ──
function renderPrediction(data) {
  const prob = data.probability || data.completion_probability || 0;
  const pct = Math.round(prob * 100);
  const factors = data.factors || [];

  const bar = document.getElementById('predictionBar');
  if (bar) setTimeout(() => { bar.style.width = pct + '%'; }, 400);
  setEl('predictionPct', pct + '%');

  const container = document.getElementById('predictionFactors');
  if (container) {
    container.innerHTML = factors.map(f => `
      <div class="pred-factor-chip ${f.positive ? 'positive' : 'negative'}">
        <i class="fas fa-${f.positive ? 'arrow-up' : 'arrow-down'}"></i>
        ${escHtml(f.label)}
      </div>
    `).join('');
  }
}

// ── Smart Suggestions ──
async function loadSmartSuggestions() {
  try {
    const data = await API.getPatterns();
    const patterns = data.patterns || [];
    const suggestions = data.suggestions || [];

    const container = document.getElementById('suggestionsList');
    if (!container) return;

    // Behavioral alert
    const burnout = patterns.find(p => p.type === 'burnout');
    const procrastination = patterns.find(p => p.type === 'procrastination');
    if (burnout || procrastination) {
      const alertEl = document.getElementById('behaviorAlert');
      const alertText = document.getElementById('behaviorAlertText');
      if (alertEl && alertText) {
        alertText.textContent = burnout
          ? '⚠️ Burnout detected: Your completion rate has dropped. Consider simplifying today\'s quests.'
          : '⏳ Procrastination pattern: You tend to delay similar tasks. Try the 2-minute rule!';
        alertEl.classList.remove('hidden');
      }
    }

    if (!suggestions.length) {
      container.innerHTML = '<div class="suggestion-item"><i class="fas fa-check"></i> You\'re on track! Keep up the great work.</div>';
      return;
    }

    container.innerHTML = suggestions.slice(0, 3).map(s => `
      <div class="suggestion-item card-enter">
        <i class="fas fa-${s.icon || 'lightbulb'}"></i>
        <span>${escHtml(s.text || s.message)}</span>
      </div>
    `).join('');
  } catch (err) {
    const c = document.getElementById('suggestionsList');
    if (c) c.innerHTML = '<div class="suggestion-item"><i class="fas fa-bolt"></i> Complete your first quest to unlock AI insights!</div>';
  }
}

// ============================================================
// SECTION NAVIGATION
// ============================================================
function showSection(name, linkEl) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const section = document.getElementById(`section-${name}`);
  if (section) section.classList.remove('hidden');
  if (linkEl) linkEl.classList.add('active');

  // Lazy load analytics charts when switching to analytics
  if (name === 'analytics') loadAnalytics();
  if (name === 'badges') loadBadges();
  if (name === 'journal') loadJournal();

  // Close sidebar on mobile
  document.getElementById('sidebar')?.classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
}

// ============================================================
// QUICK COMPLETE (dashboard task list)
// ============================================================
async function quickCompleteTask(taskId, el) {
  if (el.classList.contains('completed')) return;
  if (el.classList.contains('missed')) return;

  // Optimistic UI
  el.classList.add('completed');
  const check = el.querySelector('.task-check');
  if (check) check.innerHTML = '<i class="fas fa-check check-icon"></i>';
  const nameEl = el.querySelector('.task-name');
  if (nameEl) nameEl.classList.add('done');

  try {
    const data = await API.completeTask(taskId);
    const xp = data.xpEarned || data.xp_earned || 10;
    const user = data.user || data.updated_user;
    if (user) {
      const prevLevel = currentUser?.level || 0;
      currentUser = { ...currentUser, ...user };
      API.setUser(currentUser);
      renderUserStats({ ...data, user });

      // Level up?
      if (user.level > prevLevel) showLevelUp(user.level);
    }

    floatXP(el, `+${xp} XP`);
    triggerConfetti();
    ttsSpeak(`Quest complete! You earned ${xp} XP.`);
    checkBadgeUnlocks(data.badges_unlocked);
    window._tasks = (window._tasks || []).map(t =>
      (t._id||t.id) === taskId ? { ...t, status: 'Completed' } : t
    );
    updateTaskBadge(window._tasks);
  } catch (err) {
    // Revert on fail
    el.classList.remove('completed');
    if (check) check.innerHTML = '';
    if (nameEl) nameEl.classList.remove('done');
  }
}

// ============================================================
// SECTION: LOGOUT
// ============================================================
function logout() {
  ttsSpeak('Goodbye, hero! See you soon.');
  setTimeout(() => {
    API.logout();
    window.location.href = 'index.html';
  }, 500);
}

// ============================================================
// MOOD POPUP
// ============================================================
function checkMoodPopup() {
  const lastMoodDate = localStorage.getItem('qf_last_mood');
  const today = new Date().toDateString();
  console.log('[Luma] checkMoodPopup — lastMoodDate:', lastMoodDate, '| today:', today, '| will show:', lastMoodDate !== today);
  if (lastMoodDate !== today) {
    console.log('[Luma] Scheduling mood popup in 1500ms...');
    setTimeout(() => {
      console.log('[Luma] Opening mood modal now');
      openMoodModal();
      ttsSpeak('Good day! How are you feeling today?');
    }, 1500);
  }
}

function openMoodModal() {
  document.getElementById('moodModal').classList.remove('hidden');
}
function closeMoodModal() {
  document.getElementById('moodModal').classList.add('hidden');
}

// ============================================================
// REMINDERS CHECK
// ============================================================
async function checkReminders() {
  try {
    const data = await API.getReminders();
    const reminders = data.reminders || [];
    if (reminders.length && 'speechSynthesis' in window) {
      setTimeout(() => {
        reminders.forEach(r => ttsSpeak(r.message || `Reminder: ${r.task_name} is due soon!`));
      }, 3000);
    }
  } catch { /* silent */ }
}

// ============================================================
// UTILS
// ============================================================
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// formatDeadline: timezone-safe version defined in task.js (parseDeadline-based).
// This stub is kept for backward compatibility but defers to task.js at runtime.
if (typeof formatDeadline === 'undefined') {
  window.formatDeadline = function(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    const now = new Date();
    const diff = d - now;
    if (diff < 0) return '⚠ Overdue';
    if (diff < 3600000) return `${Math.round(diff/60000)}m left`;
    if (diff < 86400000) return `${Math.round(diff/3600000)}h left`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
}

// getCategoryEmoji defined in task.js — skip duplicate
if (typeof getCategoryEmoji === 'undefined') {
  window.getCategoryEmoji = function(cat) {
    const map = { work: '💼', health: '💪', personal: '🏠', learning: '📚', social: '👥' };
    return map[cat] || '📌';
  };
}

// XP float animation
function floatXP(el, text) {
  const rect = el.getBoundingClientRect();
  const div = document.createElement('div');
  div.className = 'xp-float';
  div.textContent = text;
  div.style.cssText = `left:${rect.left + rect.width / 2}px; top:${rect.top}px;`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1500);
}

// Level Up splash
function showLevelUp(level) {
  const div = document.createElement('div');
  div.className = 'level-up-splash';
  div.innerHTML = `
    <div class="level-up-icon">🏆</div>
    <div class="level-up-text">LEVEL UP!</div>
    <div class="level-up-sub">You reached Level ${level}</div>
  `;
  document.body.appendChild(div);
  ttsSpeak(`Incredible! You reached Level ${level}! Keep it up, hero!`);
  setTimeout(() => div.remove(), 2500);
}

// ── TTS ──
function ttsSpeak(text) {
  const enabled = localStorage.getItem('qf_tts') !== 'false';
  if (!enabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.0; utt.pitch = 1.05; utt.volume = 0.9;
  // Prefer a pleasant voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Alex'));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
}

// ── Confetti ──
function triggerConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: -10,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    r: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 4,
    vy: 3 + Math.random() * 4,
    vr: (Math.random() - 0.5) * 0.2,
    color: ['#58e000','#ffb627','#3d9df3','#a855f7','#ff4757','#fff'][Math.floor(Math.random() * 6)]
  }));

  let frame = 0;
  const loop = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.1;
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - frame / 80);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (frame < 90) requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(loop);
}

// Badge unlocks
function checkBadgeUnlocks(badges) {
  if (!badges || !badges.length) return;
  badges.forEach((b, i) => {
    setTimeout(() => showBadgeToast(b), i * 2000);
  });
}

function showBadgeToast(badge) {
  const toast = document.getElementById('badgeToast');
  if (!toast) return;
  document.getElementById('badgeIcon').textContent = badge.emoji || '🏅';
  document.getElementById('badgeName').textContent = badge.name || 'New Badge';
  toast.classList.remove('hidden');
  ttsSpeak(`Badge unlocked: ${badge.name}!`);
  setTimeout(() => toast.classList.add('hidden'), 4000);
}
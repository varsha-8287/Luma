/* ============================================================
   QUESTFLOW — GAMIFICATION.JS
   Badges, level system, XP multipliers, TTS settings
   ============================================================ */

// ============================================================
// BADGE DEFINITIONS
// ============================================================
const BADGE_DEFINITIONS = [
  { id: 'first_quest',    emoji: '⚔️',  name: 'First Blood',      desc: 'Complete your first quest',           xpReq: 0,    tasksReq: 1  },
  { id: 'streak_3',       emoji: '🔥',  name: 'On Fire',           desc: '3-day streak maintained',             streakReq: 3              },
  { id: 'streak_7',       emoji: '🌊',  name: 'Unstoppable',       desc: '7-day streak',                        streakReq: 7              },
  { id: 'streak_30',      emoji: '🌟',  name: 'Legendary Streak',  desc: '30-day streak',                       streakReq: 30             },
  { id: 'xp_100',         emoji: '💫',  name: 'XP Hunter',         desc: 'Earn 100 XP',                         xpReq: 100               },
  { id: 'xp_500',         emoji: '⭐',  name: 'XP Warrior',        desc: 'Earn 500 XP',                         xpReq: 500               },
  { id: 'xp_1000',        emoji: '🏆',  name: 'XP Legend',         desc: 'Earn 1000 XP',                        xpReq: 1000              },
  { id: 'tasks_10',       emoji: '📋',  name: 'Quest Adept',       desc: 'Complete 10 quests',                  tasksReq: 10             },
  { id: 'tasks_50',       emoji: '🗡️',  name: 'Quest Master',      desc: 'Complete 50 quests',                  tasksReq: 50             },
  { id: 'tasks_100',      emoji: '👑',  name: 'Quest Champion',    desc: 'Complete 100 quests',                 tasksReq: 100            },
  { id: 'early_bird',     emoji: '🐦',  name: 'Early Bird',        desc: 'Complete 5 tasks before deadline',    earlyReq: 5             },
  { id: 'happy_streak',   emoji: '😊',  name: 'Mood Warrior',      desc: '3 days of Happy mood',                moodReq: 'Happy'        },
  { id: 'level_5',        emoji: '🎯',  name: 'Apprentice Hero',   desc: 'Reach Level 5',                       levelReq: 5             },
  { id: 'level_10',       emoji: '🦸',  name: 'True Hero',         desc: 'Reach Level 10',                      levelReq: 10            },
  { id: 'level_25',       emoji: '🧙',  name: 'Productivity Sage', desc: 'Reach Level 25',                      levelReq: 25            },
  { id: 'perfect_day',    emoji: '💎',  name: 'Perfect Day',       desc: 'Complete all tasks in a single day',  special: true           },
  { id: 'journal_10',     emoji: '📖',  name: 'Chronicler',        desc: 'Write 10 journal entries',            journalReq: 10          },
  { id: 'night_owl',      emoji: '🦉',  name: 'Night Owl',         desc: 'Complete a task after midnight',      special: true           }
];

// ============================================================
// LOAD & RENDER BADGES
// ============================================================
async function loadBadges() {
  const container = document.getElementById('badgesGrid');
  if (!container) return;

  let earnedIds = [];
  try {
    const data = await API.getBadges();
    earnedIds = (data.badges || data).map(b => b.badge_id || b.id || b);
  } catch { /* show all locked if API fails */ }

  container.innerHTML = BADGE_DEFINITIONS.map((badge, i) => {
    const earned = earnedIds.includes(badge.id);
    return `
      <div class="badge-card ${earned ? 'earned' : 'locked'} card-enter stagger-${Math.min(i%5+1, 5)}">
        <div class="badge-emoji">${badge.emoji}</div>
        <div class="badge-name">${badge.name}</div>
        <div class="badge-desc">${badge.desc}</div>
        ${earned ? '<div class="badge-earned-label"><i class="fas fa-check-circle"></i> Earned</div>' : '<div class="badge-earned-label" style="color:var(--text-muted)">🔒 Locked</div>'}
      </div>`;
  }).join('');
}

// ============================================================
// LEVEL PROGRESSION TABLE
// ============================================================
const LEVEL_TITLES = {
  0:  'Rookie Hero',
  1:  'Quest Beginner',
  3:  'Motivated Learner',
  5:  'Task Warrior',
  10: 'Focused Champion',
  15: 'Productivity Knight',
  20: 'Discipline Master',
  25: 'Productivity Sage',
  50: 'Legendary Achiever'
};

function getLevelTitle(level) {
  const keys = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const k of keys) {
    if (level >= k) return LEVEL_TITLES[k];
  }
  return 'Rookie Hero';
}

// ============================================================
// XP MULTIPLIER LOGIC (display only — computed in backend)
// ============================================================
function getXPMultiplierLabel(streak, moodScore) {
  let mult = 1.0;
  if (streak >= 7) mult += 0.5;
  else if (streak >= 3) mult += 0.25;
  if (moodScore >= 3) mult += 0.25;
  return mult.toFixed(2) + 'x';
}

// ============================================================
// TTS SETTINGS PANEL
// ============================================================
function renderTTSToggle() {
  const enabled = localStorage.getItem('qf_tts') !== 'false';
  const section = document.getElementById('section-settings');
  if (!section) return;

  section.innerHTML = `
    <div class="section-header">
      <div><h2>Settings</h2><p>Customize your quest experience</p></div>
    </div>

    <div class="dash-card" style="max-width:560px">
      <div class="card-header"><h3><i class="fas fa-volume-up"></i> Voice Assistant (TTS)</h3></div>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:20px">
        Enable voice announcements for XP gains, level-ups, reminders, and journal read-aloud.
      </p>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
        <label class="toggle-switch">
          <input type="checkbox" id="ttsToggle" ${enabled ? 'checked' : ''} onchange="setTTS(this.checked)"/>
          <span class="toggle-slider"></span>
        </label>
        <span id="ttsLabel" style="font-weight:600">${enabled ? 'Voice Enabled' : 'Voice Disabled'}</span>
      </div>
      <button class="btn-ghost" onclick="testTTS()" style="width:auto">
        <i class="fas fa-play"></i> Test Voice
      </button>
    </div>

    <div class="dash-card" style="max-width:560px;margin-top:16px">
      <div class="card-header"><h3><i class="fas fa-layer-group"></i> Level Progress</h3></div>
      <div id="levelProgressDisplay"></div>
    </div>`;

  renderLevelProgress();
}

function setTTS(val) {
  localStorage.setItem('qf_tts', val ? 'true' : 'false');
  const label = document.getElementById('ttsLabel');
  if (label) label.textContent = val ? 'Voice Enabled' : 'Voice Disabled';
  if (val) ttsSpeak('Voice assistant enabled. I\'ll be your guide on this quest!');
}

function testTTS() {
  const user = API.getUser();
  ttsSpeak(`Testing voice. Hello ${user?.name || 'Hero'}! You are at level ${user?.level || 0}. Voice is working perfectly!`);
}

function renderLevelProgress() {
  const user = API.getUser();
  if (!user) return;
  const container = document.getElementById('levelProgressDisplay');
  if (!container) return;
  const level = user.level || 0;
  const xp = user.totalXP || user.total_xp || 0;
  const xpInLevel = xp % 100;
  const title = getLevelTitle(level);
  const nextTitle = getLevelTitle(level + 1);

  container.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:1.4rem;font-weight:800;color:var(--accent)">Level ${level}</div>
      <div style="color:var(--text-muted);font-size:0.88rem;margin-top:4px">${title}</div>
    </div>
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:8px">
      ${xpInLevel} / 100 XP → Level ${level + 1} (${nextTitle})
    </div>
    <div class="xp-bar-outer" style="height:10px">
      <div class="xp-bar-inner" style="width:${xpInLevel}%"></div>
    </div>
    <div style="margin-top:20px;font-size:0.85rem;color:var(--text-muted)">
      XP Multiplier: <strong style="color:var(--accent)">${getXPMultiplierLabel(user.streak || 0, 3)}</strong>
      (based on streak + mood)
    </div>`;
}

// Toggle switch CSS (injected)
(function injectToggleCSS() {
  const style = document.createElement('style');
  style.textContent = `
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
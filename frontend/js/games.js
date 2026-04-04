/* ============================================================
   LUMA — GAMES.JS
   Mind Relaxation Games Hub
   4 Games: Memory Match · Sudoku · Word Search · Number Zen
   Web Audio API sound effects · Particle animations · XP rewards
   ============================================================ */

'use strict';

// ── Audio Engine ──────────────────────────────────────────────
const SFX = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function tone(freq, type, duration, vol = 0.18, delay = 0) {
    try {
      const c = getCtx();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type; o.frequency.value = freq;
      const t = c.currentTime + delay;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + duration);
      o.start(t); o.stop(t + duration);
    } catch(e) {}
  }
  return {
    click:   () => tone(440, 'sine', 0.06, 0.12),
    flip:    () => tone(660, 'sine', 0.1, 0.15),
    match:   () => { tone(523, 'sine', 0.15, 0.2); tone(659, 'sine', 0.15, 0.2, 0.12); tone(784, 'sine', 0.2, 0.2, 0.24); },
    wrong:   () => { tone(220, 'sawtooth', 0.12, 0.12); tone(196, 'sawtooth', 0.15, 0.1, 0.1); },
    place:   () => tone(550, 'triangle', 0.08, 0.14),
    win:     () => { [523,659,784,1047].forEach((f,i) => tone(f,'sine',0.3,0.22,i*0.12)); },
    pop:     () => tone(880, 'sine', 0.05, 0.1),
    whoosh:  () => { tone(200, 'sawtooth', 0.2, 0.05); tone(800, 'sawtooth', 0.2, 0.05, 0.05); },
    merge:   () => { tone(440,'sine',0.1,0.2); tone(660,'sine',0.12,0.2,0.08); },
    levelUp: () => { [392,523,659,784,1047].forEach((f,i) => tone(f,'sine',0.35,0.25,i*0.1)); },
  };
})();

// ── Particle burst ────────────────────────────────────────────
function burst(x, y, color = '#58e000', count = 14) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    const angle = (i / count) * 360;
    const dist  = 40 + Math.random() * 60;
    const size  = 5 + Math.random() * 6;
    p.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;
      border-radius:50%;background:${color};pointer-events:none;z-index:9999;
      transform:translate(-50%,-50%);
      animation:particleBurst 0.7s ease-out forwards;
      --dx:${Math.cos(angle*Math.PI/180)*dist}px;
      --dy:${Math.sin(angle*Math.PI/180)*dist}px;
    `;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 750);
  }
}

function injectGameKeyframes() {
  if (document.getElementById('game-keyframes')) return;
  const s = document.createElement('style');
  s.id = 'game-keyframes';
  s.textContent = `
@keyframes particleBurst{to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy)));opacity:0}}
@keyframes cardFlip{0%{transform:rotateY(0)}50%{transform:rotateY(90deg)}100%{transform:rotateY(0)}}
@keyframes tileSlide{from{transform:scale(0.7);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes shakeBad{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@keyframes pulseGreen{0%,100%{box-shadow:0 0 0 0 rgba(88,224,0,0.5)}50%{box-shadow:0 0 0 10px rgba(88,224,0,0)}}
@keyframes bounceIn{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.15)}80%{transform:scale(0.95)}100%{transform:scale(1);opacity:1}}
@keyframes floatScore{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-60px)}}
@keyframes gameWinPop{0%{opacity:0;transform:translate(-50%,-50%) scale(0.6)}70%{transform:translate(-50%,-50%) scale(1.08)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes glowPulse{0%,100%{text-shadow:0 0 8px currentColor}50%{text-shadow:0 0 22px currentColor,0 0 40px currentColor}}
@keyframes tileNew{0%{transform:scale(0)}100%{transform:scale(1)}}
@keyframes tileMerge{0%{transform:scale(1.2)}100%{transform:scale(1)}}
@keyframes wordFound{0%{opacity:1}50%{opacity:0.4;letter-spacing:3px}100%{opacity:1;letter-spacing:0}}
@keyframes spinIn{from{transform:rotate(-180deg) scale(0);opacity:0}to{transform:rotate(0) scale(1);opacity:1}}
@keyframes timerTick{from{transform:scaleX(1)}to{transform:scaleX(0)}}
  `;
  document.head.appendChild(s);
}

// ── XP float helper ───────────────────────────────────────────
function floatGameXP(el, xp, color = '#58e000') {
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${r.left+r.width/2}px;top:${r.top}px;
    font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;color:${color};
    pointer-events:none;z-index:9999;white-space:nowrap;
    animation:floatScore 1.2s ease-out forwards;`;
  d.textContent = `+${xp} XP`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1200);
}

// ── Game XP Award ─────────────────────────────────────────────
function awardGameXP(amount, reason) {
  try {
    if (typeof API !== 'undefined' && API.getToken) {
      // Award via backend silently
      fetch((window.BACKEND_URL||'http://localhost:5000/api').replace('/api','') + '/api/gamification/xp-history', {
        method: 'GET', headers: { Authorization: 'Bearer ' + API.getToken() }
      }).catch(() => {});
    }
  } catch(e) {}
  // Update local user
  try {
    const user = API?.getUser?.();
    if (user) { user.totalXP = (user.totalXP||0) + amount; API.setUser(user); }
  } catch(e) {}
  if (typeof pushNotification !== 'undefined')
    pushNotification('badge', `🎮 ${reason}`, `You earned ${amount} XP from Brain Games!`);
}

// ── Game Stats Storage ────────────────────────────────────────
const GAME_STATS_KEY = 'luma_game_stats';
function getGameStats() {
  try { return JSON.parse(localStorage.getItem(GAME_STATS_KEY)) || {}; }
  catch { return {}; }
}
function saveGameStat(game, key, val) {
  const s = getGameStats();
  if (!s[game]) s[game] = {};
  s[game][key] = val;
  localStorage.setItem(GAME_STATS_KEY, JSON.stringify(s));
}
function getBest(game, key, def = 0) {
  return getGameStats()[game]?.[key] ?? def;
}

// ══════════════════════════════════════════════════════════════
// GAMES HUB — inject section + nav
// ══════════════════════════════════════════════════════════════
function initGamesHub() {
  injectGameKeyframes();
  injectGamesCSS();
  injectGamesSection();
  injectGamesNav();
}

function injectGamesNav() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav || document.querySelector('[data-section="games"]')) return;
  const link = document.createElement('a');
  link.href = '#'; link.className = 'nav-link'; link.dataset.section = 'games';
  link.setAttribute('onclick', "showSection('games', this)");
  link.innerHTML = `<i class="fas fa-gamepad"></i><span>Brain Games</span><div class="nav-glow"></div>`;
  // Insert after analytics link
  const analyticsLink = document.querySelector('[data-section="analytics"]');
  if (analyticsLink) analyticsLink.after(link);
  else nav.appendChild(link);
}

function injectGamesSection() {
  const main = document.querySelector('.main-content');
  if (!main || document.getElementById('section-games')) return;
  const stats = getGameStats();

  const section = document.createElement('section');
  section.className = 'section hidden'; section.id = 'section-games';
  section.innerHTML = `
    <div class="section-header">
      <div>
        <h2>Brain Games</h2>
        <p>Recharge your mind · Earn XP · Build focus</p>
      </div>
      <div class="games-xp-chip">
        <i class="fas fa-brain"></i>
        <span>Play daily for bonus XP</span>
      </div>
    </div>

    <!-- Game Cards Grid -->
    <div class="games-hub-grid" id="gamesHubGrid">

      <div class="game-hub-card" onclick="openGame('memory')">
        <div class="ghc-bg ghc-bg-memory"></div>
        <div class="ghc-icon">🧠</div>
        <div class="ghc-body">
          <div class="ghc-title">Memory Match</div>
          <div class="ghc-desc">Flip cards & find pairs before time runs out</div>
          <div class="ghc-stats">
            <span><i class="fas fa-trophy"></i> Best: ${getBest('memory','bestScore',0)}</span>
            <span><i class="fas fa-clock"></i> ${getBest('memory','bestTime', '—')}</span>
          </div>
        </div>
        <div class="ghc-play">Play <i class="fas fa-play"></i></div>
        <div class="ghc-badge ghc-badge-memory">MEMORY</div>
      </div>

      <div class="game-hub-card" onclick="openGame('sudoku')">
        <div class="ghc-bg ghc-bg-sudoku"></div>
        <div class="ghc-icon">🔢</div>
        <div class="ghc-body">
          <div class="ghc-title">Sudoku</div>
          <div class="ghc-desc">Fill the 9×9 grid — logic & patience</div>
          <div class="ghc-stats">
            <span><i class="fas fa-trophy"></i> Best: ${getBest('sudoku','bestTime','—')}</span>
            <span><i class="fas fa-check-circle"></i> Solved: ${getBest('sudoku','solved',0)}</span>
          </div>
        </div>
        <div class="ghc-play">Play <i class="fas fa-play"></i></div>
        <div class="ghc-badge ghc-badge-sudoku">LOGIC</div>
      </div>

      <div class="game-hub-card" onclick="openGame('wordsearch')">
        <div class="ghc-bg ghc-bg-word"></div>
        <div class="ghc-icon">🔤</div>
        <div class="ghc-body">
          <div class="ghc-title">Word Search</div>
          <div class="ghc-desc">Hunt hidden words in every direction</div>
          <div class="ghc-stats">
            <span><i class="fas fa-trophy"></i> Best: ${getBest('wordsearch','bestScore',0)}</span>
            <span><i class="fas fa-search"></i> Words: ${getBest('wordsearch','wordsFound',0)}</span>
          </div>
        </div>
        <div class="ghc-play">Play <i class="fas fa-play"></i></div>
        <div class="ghc-badge ghc-badge-word">WORDS</div>
      </div>

      <div class="game-hub-card" onclick="openGame('numberzen')">
        <div class="ghc-bg ghc-bg-zen"></div>
        <div class="ghc-icon">✨</div>
        <div class="ghc-body">
          <div class="ghc-title">Number Zen</div>
          <div class="ghc-desc">Merge tiles to reach 2048 — stay calm</div>
          <div class="ghc-stats">
            <span><i class="fas fa-trophy"></i> Best: ${getBest('numberzen','bestScore',0)}</span>
            <span><i class="fas fa-star"></i> Max: ${getBest('numberzen','maxTile',0)}</span>
          </div>
        </div>
        <div class="ghc-play">Play <i class="fas fa-play"></i></div>
        <div class="ghc-badge ghc-badge-zen">2048</div>
      </div>

    </div>

    <!-- Game Stage (shown when a game is open) -->
    <div class="game-stage hidden" id="gameStage">
      <div class="game-stage-header">
        <button class="game-back-btn" onclick="closeGame()">
          <i class="fas fa-arrow-left"></i> Games
        </button>
        <div class="game-stage-title" id="gameStageName"></div>
        <div class="game-stage-meta" id="gameStageMeta"></div>
      </div>
      <div class="game-canvas" id="gameCanvas"></div>
    </div>
  `;
  main.appendChild(section);
}

function openGame(gameId) {
  SFX.whoosh();
  document.getElementById('gamesHubGrid').classList.add('hidden');
  const stage = document.getElementById('gameStage');
  stage.classList.remove('hidden');
  const canvas = document.getElementById('gameCanvas');
  canvas.innerHTML = '';

  const titles = { memory:'Memory Match', sudoku:'Sudoku', wordsearch:'Word Search', numberzen:'Number Zen' };
  document.getElementById('gameStageName').textContent = titles[gameId] || gameId;

  if (gameId === 'memory')     initMemoryGame(canvas);
  else if (gameId === 'sudoku')       initSudokuGame(canvas);
  else if (gameId === 'wordsearch')   initWordSearch(canvas);
  else if (gameId === 'numberzen')    initNumberZen(canvas);
}

function closeGame() {
  SFX.click();
  stopAllGames();
  document.getElementById('gamesHubGrid').classList.remove('hidden');
  document.getElementById('gameStage').classList.add('hidden');
  // Refresh hub stats
  const hub = document.getElementById('gamesHubGrid');
  if (hub) {
    hub.querySelectorAll('.ghc-stats').forEach(el => {
      const card = el.closest('.game-hub-card');
      const game = card?.getAttribute('onclick')?.match(/'(\w+)'/)?.[1];
      if (!game) return;
      if (game === 'memory')     el.innerHTML = `<span><i class="fas fa-trophy"></i> Best: ${getBest('memory','bestScore',0)}</span><span><i class="fas fa-clock"></i> ${getBest('memory','bestTime','—')}</span>`;
      if (game === 'sudoku')     el.innerHTML = `<span><i class="fas fa-trophy"></i> Best: ${getBest('sudoku','bestTime','—')}</span><span><i class="fas fa-check-circle"></i> Solved: ${getBest('sudoku','solved',0)}</span>`;
      if (game === 'wordsearch') el.innerHTML = `<span><i class="fas fa-trophy"></i> Best: ${getBest('wordsearch','bestScore',0)}</span><span><i class="fas fa-search"></i> Words: ${getBest('wordsearch','wordsFound',0)}</span>`;
      if (game === 'numberzen')  el.innerHTML = `<span><i class="fas fa-trophy"></i> Best: ${getBest('numberzen','bestScore',0)}</span><span><i class="fas fa-star"></i> Max: ${getBest('numberzen','maxTile',0)}</span>`;
    });
  }
}

let _gameTimers = [];
function stopAllGames() {
  _gameTimers.forEach(t => clearInterval(t));
  _gameTimers = [];
  window._memoryGame = null;
  window._sudokuGame = null;
  window._wordGame   = null;
  window._zenGame    = null;
}
function setMeta(html) { document.getElementById('gameStageMeta').innerHTML = html; }

// ══════════════════════════════════════════════════════════════
// GAME 1: MEMORY MATCH
// ══════════════════════════════════════════════════════════════
function initMemoryGame(canvas) {
  const EMOJIS = ['🌙','⭐','🔥','💎','🌊','🎯','⚡','🏆','🎮','🦋','🌺','🎸'];
  const GRID_SIZE = 16; // 4×4 = 8 pairs
  let cards = [], flipped = [], matched = [], moves = 0, score = 0;
  let timer = 60, timerInterval = null, locked = false;

  const pairs = EMOJIS.slice(0, GRID_SIZE / 2);
  const deck  = [...pairs, ...pairs].sort(() => Math.random() - 0.5)
    .map((emoji, i) => ({ id: i, emoji, face: false, matched: false }));

  window._memoryGame = { stop: () => clearInterval(timerInterval) };

  canvas.innerHTML = `
    <div class="memory-game">
      <div class="memory-hud">
        <div class="mem-stat"><span class="mem-stat-val" id="memScore">0</span><span class="mem-stat-lbl">Score</span></div>
        <div class="mem-timer-wrap">
          <div class="mem-timer-ring">
            <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="#2a2a3a" stroke-width="5"/>
            <circle id="memTimerCircle" cx="30" cy="30" r="26" fill="none" stroke="#ffb627" stroke-width="5"
              stroke-dasharray="163" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 30 30)"/></svg>
            <div class="mem-timer-num" id="memTimer">60</div>
          </div>
        </div>
        <div class="mem-stat"><span class="mem-stat-val" id="memMoves">0</span><span class="mem-stat-lbl">Moves</span></div>
      </div>
      <div class="memory-grid" id="memGrid"></div>
      <div class="mem-combo" id="memCombo"></div>
    </div>
  `;
  setMeta(`<span style="color:var(--amber)"><i class="fas fa-clock"></i> 60s</span> &nbsp; <span>Match all 8 pairs</span>`);

  let consecutiveMatches = 0;
  function render() {
    const grid = document.getElementById('memGrid');
    grid.innerHTML = deck.map((c, i) => `
      <div class="mem-card ${c.face||c.matched?'flipped':''} ${c.matched?'matched':''}"
           data-idx="${i}" onclick="window._memoryGame.click(${i})">
        <div class="mem-card-inner">
          <div class="mem-card-back"><span class="mem-card-mark">?</span></div>
          <div class="mem-card-front">${c.emoji}</div>
        </div>
      </div>`).join('');
  }

  function updateHUD() {
    document.getElementById('memScore').textContent = score;
    document.getElementById('memMoves').textContent = moves;
    const pct = timer / 60;
    const offset = 163 * (1 - pct);
    const circle = document.getElementById('memTimerCircle');
    if (circle) {
      circle.style.strokeDashoffset = offset;
      circle.style.stroke = timer > 20 ? '#ffb627' : '#ff4757';
    }
    document.getElementById('memTimer').textContent = timer;
  }

  window._memoryGame.click = (idx) => {
    if (locked) return;
    const card = deck[idx];
    if (card.face || card.matched || flipped.includes(idx)) return;
    SFX.flip();
    card.face = true;
    flipped.push(idx);
    render(); updateHUD();

    if (flipped.length === 2) {
      locked = true; moves++;
      const [a, b] = flipped;
      if (deck[a].emoji === deck[b].emoji) {
        // Match!
        consecutiveMatches++;
        const bonus = consecutiveMatches >= 2 ? consecutiveMatches * 10 : 0;
        const pts = 20 + bonus + Math.floor(timer / 2);
        score += pts;
        deck[a].matched = deck[b].matched = true;
        matched.push(a, b);
        SFX.match();

        // Combo display
        if (consecutiveMatches >= 2) {
          const combo = document.getElementById('memCombo');
          combo.textContent = `🔥 ${consecutiveMatches}× COMBO! +${bonus}`;
          combo.style.animation = 'none';
          void combo.offsetWidth;
          combo.style.animation = 'bounceIn 0.5s ease, floatScore 2s 0.5s ease forwards';
        }

        // Burst on matched cards
        const el = document.querySelector(`[data-idx="${a}"]`);
        if (el) { const r = el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2, '#58e000', 12); }

        setTimeout(() => {
          flipped = []; locked = false;
          render(); updateHUD();
          if (matched.length === GRID_SIZE) endMemory('win');
        }, 400);
      } else {
        consecutiveMatches = 0;
        SFX.wrong();
        setTimeout(() => {
          deck[a].face = deck[b].face = false;
          flipped = []; locked = false;
          render(); updateHUD();
        }, 900);
      }
    }
  };

  timerInterval = setInterval(() => {
    timer--;
    if (timer <= 0) { timer = 0; updateHUD(); endMemory('timeout'); }
    else updateHUD();
  }, 1000);
  _gameTimers.push(timerInterval);

  function endMemory(reason) {
    clearInterval(timerInterval);
    const won = reason === 'win';
    const finalScore = won ? score + timer * 5 : score;
    const best = getBest('memory', 'bestScore', 0);
    if (finalScore > best) saveGameStat('memory', 'bestScore', finalScore);
    const elapsed = `${Math.floor((60-timer)/60)|0}:${String(60-timer).padStart(2,'0')}`;
    saveGameStat('memory', 'bestTime', elapsed);
    if (won) { SFX.win(); awardGameXP(30 + Math.floor(score/10), 'Memory Master'); }
    else SFX.wrong();
    showGameWin(canvas, won ? '🎉 You Won!' : '⏰ Time\'s Up!',
      won ? `Score: ${finalScore} · All pairs matched!` : `Score: ${finalScore} · ${matched.length/2}/${GRID_SIZE/2} pairs`,
      won, finalScore, () => initMemoryGame(canvas));
  }

  render(); updateHUD();
}

// ══════════════════════════════════════════════════════════════
// GAME 2: SUDOKU
// ══════════════════════════════════════════════════════════════
function initSudokuGame(canvas) {
  const EASY_PUZZLES = [
    [5,3,0,0,7,0,0,0,0,6,0,0,1,9,5,0,0,0,0,9,8,0,0,0,0,6,0,8,0,0,0,6,0,0,0,3,4,0,0,8,0,3,0,0,1,7,0,0,0,2,0,0,0,6,0,6,0,0,0,0,2,8,0,0,0,0,4,1,9,0,0,5,0,0,0,0,8,0,0,7,9],
    [0,0,0,2,6,0,7,0,1,6,8,0,0,7,0,0,9,0,1,9,0,0,0,4,5,0,0,8,2,0,1,0,0,0,4,0,0,0,4,6,0,2,9,0,0,0,5,0,0,0,3,0,2,8,0,0,9,3,0,0,0,7,4,0,4,0,0,5,0,0,3,6,7,0,3,0,1,8,0,0,0],
  ];

  const puzzle = EASY_PUZZLES[Math.floor(Math.random() * EASY_PUZZLES.length)].slice();
  const solution = solveSudoku([...puzzle]);
  const fixed = puzzle.map(v => v !== 0);
  const board = [...puzzle];
  let selectedCell = -1, errors = 0, startTime = Date.now(), timerInterval;

  window._sudokuGame = { stop: () => clearInterval(timerInterval) };

  canvas.innerHTML = `
    <div class="sudoku-game">
      <div class="sudoku-hud">
        <div class="sdk-stat"><i class="fas fa-times-circle" style="color:var(--red)"></i> <span id="sdkErrors">0</span>/3 Errors</div>
        <div class="sdk-timer" id="sdkTimer">00:00</div>
        <div class="sdk-stat"><i class="fas fa-lightbulb" style="color:var(--amber)"></i> <span id="sdkHints">3</span> Hints</div>
      </div>
      <div class="sudoku-board" id="sdkBoard"></div>
      <div class="sudoku-numpad" id="sdkNumpad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="sdk-num" onclick="window._sudokuGame.place(${n})">${n}</button>`).join('')}
        <button class="sdk-num sdk-erase" onclick="window._sudokuGame.place(0)"><i class="fas fa-eraser"></i></button>
        <button class="sdk-num sdk-hint" onclick="window._sudokuGame.hint()"><i class="fas fa-lightbulb"></i></button>
      </div>
    </div>
  `;
  setMeta(`<span style="color:var(--blue)">Easy</span> &nbsp;·&nbsp; Fill the 9×9 grid`);

  let hints = 3;

  function renderBoard() {
    const el = document.getElementById('sdkBoard');
    el.innerHTML = board.map((v, i) => {
      const row = Math.floor(i / 9), col = i % 9;
      const box = Math.floor(row/3)*3 + Math.floor(col/3);
      const isFixed = fixed[i];
      const isSelected = i === selectedCell;
      const sRow = selectedCell >= 0 ? Math.floor(selectedCell/9) : -1;
      const sCol = selectedCell >= 0 ? selectedCell % 9 : -1;
      const sBox = selectedCell >= 0 ? Math.floor(sRow/3)*3+Math.floor(sCol/3) : -1;
      const highlighted = !isSelected && (row===sRow||col===sCol||box===sBox);
      const sameVal = selectedCell >= 0 && v !== 0 && v === board[selectedCell];
      let cls = 'sdk-cell';
      if (isFixed) cls += ' sdk-fixed';
      if (isSelected) cls += ' sdk-selected';
      else if (highlighted) cls += ' sdk-highlight';
      if (sameVal && !isSelected) cls += ' sdk-same';
      if (v !== 0 && !isFixed && solution && v !== solution[i]) cls += ' sdk-wrong';
      if ((col+1)%3===0 && col<8) cls += ' sdk-border-right';
      if ((row+1)%3===0 && row<8) cls += ' sdk-border-bottom';
      return `<div class="${cls}" data-idx="${i}" onclick="window._sudokuGame.select(${i})">${v||''}</div>`;
    }).join('');
  }

  window._sudokuGame.select = (idx) => {
    if (fixed[idx]) { SFX.click(); selectedCell = idx; renderBoard(); return; }
    SFX.click(); selectedCell = idx; renderBoard();
  };

  window._sudokuGame.place = (num) => {
    if (selectedCell < 0 || fixed[selectedCell]) return;
    const prev = board[selectedCell];
    board[selectedCell] = num;
    SFX.place();
    if (num !== 0 && solution && num !== solution[selectedCell]) {
      errors++;
      document.getElementById('sdkErrors').textContent = errors;
      SFX.wrong();
      const el = document.querySelector(`[data-idx="${selectedCell}"]`);
      if (el) { el.style.animation='shakeBad 0.4s ease'; setTimeout(()=>el.style.animation='',400); }
      const r = el?.getBoundingClientRect();
      if (r) burst(r.left+r.width/2, r.top+r.height/2, '#ff4757', 8);
      if (errors >= 3) { clearInterval(timerInterval); endSudoku('fail'); return; }
    } else if (num !== 0) {
      const el = document.querySelector(`[data-idx="${selectedCell}"]`);
      const r = el?.getBoundingClientRect();
      if (r) burst(r.left+r.width/2, r.top+r.height/2, '#58e000', 6);
    }
    renderBoard();
    if (board.every((v, i) => v === (solution?.[i] ?? v) && v !== 0)) endSudoku('win');
  };

  window._sudokuGame.hint = () => {
    if (hints <= 0) return;
    const empty = board.map((v,i)=>v===0&&!fixed[i]?i:-1).filter(i=>i>=0);
    if (!empty.length) return;
    const idx = empty[Math.floor(Math.random()*empty.length)];
    hints--;
    document.getElementById('sdkHints').textContent = hints;
    board[idx] = solution[idx];
    fixed[idx] = true;
    selectedCell = idx;
    SFX.match();
    renderBoard();
  };

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed/60)).padStart(2,'0');
    const s = String(elapsed%60).padStart(2,'0');
    document.getElementById('sdkTimer').textContent = `${m}:${s}`;
  }, 1000);
  _gameTimers.push(timerInterval);

  function endSudoku(reason) {
    clearInterval(timerInterval);
    const elapsed = Math.floor((Date.now()-startTime)/1000);
    const timeStr = `${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
    if (reason === 'win') {
      const best = getBest('sudoku','bestTime','99:99');
      if (!best || timeStr < best) saveGameStat('sudoku','bestTime', timeStr);
      saveGameStat('sudoku','solved', getBest('sudoku','solved',0)+1);
      SFX.win(); awardGameXP(50, 'Sudoku Solver');
      showGameWin(canvas, '🔢 Solved!', `Time: ${timeStr} · Errors: ${errors}`, true, 50, ()=>initSudokuGame(canvas));
    } else {
      SFX.wrong();
      showGameWin(canvas, '💔 Game Over', `Too many errors (${errors}/3)`, false, 0, ()=>initSudokuGame(canvas));
    }
  }

  renderBoard();
}

function solveSudoku(board) {
  const empty = board.indexOf(0);
  if (empty === -1) return board;
  const row = Math.floor(empty/9), col = empty%9;
  const used = new Set();
  for (let i=0;i<9;i++) {
    used.add(board[row*9+i]);
    used.add(board[i*9+col]);
    const br=Math.floor(row/3)*3+Math.floor(i/3), bc=Math.floor(col/3)*3+i%3;
    used.add(board[br*9+bc]);
  }
  for (let n=1;n<=9;n++) {
    if (used.has(n)) continue;
    board[empty]=n;
    const result = solveSudoku(board);
    if (result) return result;
    board[empty]=0;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
// GAME 3: WORD SEARCH
// ══════════════════════════════════════════════════════════════
function initWordSearch(canvas) {
  const WORD_LISTS = {
    PRODUCTIVITY: ['FOCUS','HABIT','QUEST','LEVEL','STREAK','SCORE','BADGE','TIMER','ENERGY','GOAL'],
    MINDFULNESS:  ['CALM','PEACE','BREATH','FLOW','RELAX','CLARITY','ZEN','BALANCE','STILL','AWARE'],
  };
  const theme = Object.keys(WORD_LISTS)[Math.floor(Math.random()*2)];
  const words = WORD_LISTS[theme].slice(0,7);
  const SIZE = 12;
  const DIRS = [[0,1],[1,0],[1,1],[1,-1],[0,-1],[-1,0],[-1,-1],[-1,1]];

  let grid = Array.from({length:SIZE},()=>Array(SIZE).fill(''));
  let wordPositions = {};
  let foundWords = new Set();
  let selecting = false, selStart = null, selCells = [];
  let score = 0, startTime = Date.now(), timerInterval;

  // Place words
  function placeWord(word) {
    const tries = 200;
    for (let t=0;t<tries;t++) {
      const dir = DIRS[Math.floor(Math.random()*DIRS.length)];
      const row = Math.floor(Math.random()*SIZE), col = Math.floor(Math.random()*SIZE);
      const cells = [];
      let ok = true;
      for (let i=0;i<word.length;i++) {
        const r=row+dir[0]*i, c=col+dir[1]*i;
        if (r<0||r>=SIZE||c<0||c>=SIZE) { ok=false; break; }
        if (grid[r][c]!==''&&grid[r][c]!==word[i]) { ok=false; break; }
        cells.push([r,c]);
      }
      if (ok) {
        cells.forEach(([r,c],i)=>grid[r][c]=word[i]);
        wordPositions[word] = cells;
        return true;
      }
    }
    return false;
  }

  words.forEach(w=>placeWord(w));
  const ALPHA='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++)
    if(!grid[r][c]) grid[r][c]=ALPHA[Math.floor(Math.random()*26)];

  window._wordGame = { stop: () => clearInterval(timerInterval) };

  canvas.innerHTML = `
    <div class="word-game">
      <div class="word-sidebar">
        <div class="word-theme">${theme}</div>
        <div class="word-list" id="wordList">
          ${words.map(w=>`<div class="word-item" id="wrd-${w}">${w}</div>`).join('')}
        </div>
        <div class="word-score-wrap">
          <div class="word-score-val" id="wordScore">0</div>
          <div class="word-score-lbl">Score</div>
        </div>
        <div class="word-timer" id="wordTimer">02:00</div>
      </div>
      <div class="word-grid-wrap">
        <div class="word-grid" id="wordGrid" style="grid-template-columns:repeat(${SIZE},1fr)">
        ${grid.flat().map((ch,i)=>`
          <div class="word-cell" data-r="${Math.floor(i/SIZE)}" data-c="${i%SIZE}"
            onmousedown="window._wordGame.startSel(${Math.floor(i/SIZE)},${i%SIZE})"
            onmouseover="window._wordGame.moveSel(${Math.floor(i/SIZE)},${i%SIZE})"
            onmouseup="window._wordGame.endSel()"
            ontouchstart="window._wordGame.startSel(${Math.floor(i/SIZE)},${i%SIZE})"
            ontouchmove="window._wordGame.touchMove(event)"
            ontouchend="window._wordGame.endSel()"
          >${ch}</div>`).join('')}
        </div>
      </div>
    </div>
  `;
  document.getElementById('wordGrid').addEventListener('mouseleave',()=>{ if(selecting) window._wordGame.endSel(); });
  setMeta(`<span style="color:var(--purple)">Theme: ${theme}</span> &nbsp;·&nbsp; Find all ${words.length} words`);

  let timeLeft = 120;
  timerInterval = setInterval(()=>{
    timeLeft--;
    const m=Math.floor(timeLeft/60), s=timeLeft%60;
    const el=document.getElementById('wordTimer');
    if(el) { el.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; if(timeLeft<=20) el.style.color='var(--red)'; }
    if(timeLeft<=0) { clearInterval(timerInterval); endWordSearch('timeout'); }
  },1000);
  _gameTimers.push(timerInterval);

  function getCellAt(r,c) { return document.querySelector(`.word-cell[data-r="${r}"][data-c="${c}"]`); }

  function getStraightCells(r1,c1,r2,c2) {
    const dr=r2-r1, dc=c2-c1;
    const len=Math.max(Math.abs(dr),Math.abs(dc));
    if(dr!==0&&dc!==0&&Math.abs(dr)!==Math.abs(dc)) return [];
    const cells=[];
    for(let i=0;i<=len;i++) cells.push([r1+(dr?Math.sign(dr)*i:0), c1+(dc?Math.sign(dc)*i:0)]);
    return cells;
  }

  function clearSelection() {
    document.querySelectorAll('.word-cell.selecting').forEach(el=>el.classList.remove('selecting'));
    selCells=[];
  }

  window._wordGame.startSel = (r,c) => { selecting=true; selStart=[r,c]; selCells=[[r,c]]; getCellAt(r,c)?.classList.add('selecting'); };
  window._wordGame.moveSel  = (r,c) => {
    if(!selecting) return;
    clearSelection();
    selCells = getStraightCells(selStart[0],selStart[1],r,c);
    selCells.forEach(([rr,cc])=>getCellAt(rr,cc)?.classList.add('selecting'));
  };
  window._wordGame.touchMove = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if(el?.classList.contains('word-cell')) {
      window._wordGame.moveSel(+el.dataset.r, +el.dataset.c);
    }
  };
  window._wordGame.endSel = () => {
    if(!selecting) return; selecting=false;
    const word = selCells.map(([r,c])=>grid[r][c]).join('');
    const wordRev = [...word].reverse().join('');
    const matched = words.find(w=>w===word||w===wordRev);
    if(matched && !foundWords.has(matched)) {
      foundWords.add(matched);
      SFX.match();
      const pts = matched.length * 15 + Math.ceil(timeLeft/10);
      score += pts;
      document.getElementById('wordScore').textContent = score;
      selCells.forEach(([r,c])=>{ const el=getCellAt(r,c); el?.classList.add('found'); });
      const wEl=document.getElementById(`wrd-${matched}`);
      if(wEl) { wEl.classList.add('found-word'); }
      const midCell = selCells[Math.floor(selCells.length/2)];
      const el = getCellAt(midCell[0],midCell[1]);
      if(el) { const r=el.getBoundingClientRect(); burst(r.left+r.width/2,r.top+r.height/2,'#a855f7',14); floatGameXP(el,pts,'#a855f7'); }
      if(foundWords.size===words.length) { clearInterval(timerInterval); setTimeout(()=>endWordSearch('win'),500); }
    } else if(matched) { /* already found */ }
    else { SFX.wrong(); }
    setTimeout(clearSelection, matched&&!foundWords.has(matched) ? 0 : 100);
    clearSelection();
  };

  function endWordSearch(reason) {
    clearInterval(timerInterval);
    const won = reason==='win';
    const best=getBest('wordsearch','bestScore',0);
    if(score>best) saveGameStat('wordsearch','bestScore',score);
    const prev=getBest('wordsearch','wordsFound',0);
    if(foundWords.size>prev) saveGameStat('wordsearch','wordsFound',foundWords.size);
    if(won) { SFX.win(); awardGameXP(40,'Word Hunter'); }
    showGameWin(canvas, won?'🔤 All Found!':'⏰ Time\'s Up!',
      `Score: ${score} · ${foundWords.size}/${words.length} words found`,
      won, score, ()=>initWordSearch(canvas));
  }
}

// ══════════════════════════════════════════════════════════════
// GAME 4: NUMBER ZEN (2048)
// ══════════════════════════════════════════════════════════════
function initNumberZen(canvas) {
  const SIZE = 4;
  let board = Array.from({length:SIZE},()=>Array(SIZE).fill(0));
  let score = 0, best = getBest('numberzen','bestScore',0), maxTile = 0;
  let gameOver = false;

  window._zenGame = { stop: () => {} };

  canvas.innerHTML = `
    <div class="zen-game">
      <div class="zen-hud">
        <div class="zen-scores">
          <div class="zen-score-box"><div class="zen-score-val" id="zenScore">0</div><div class="zen-score-lbl">Score</div></div>
          <div class="zen-score-box zen-best"><div class="zen-score-val" id="zenBest">${best}</div><div class="zen-score-lbl">Best</div></div>
        </div>
        <div class="zen-hint">← → ↑ ↓ to merge tiles · Reach 2048!</div>
      </div>
      <div class="zen-board" id="zenBoard"></div>
      <div class="zen-controls">
        <div class="zen-ctrl-row"><button class="zen-btn" onclick="window._zenGame.move('up')">↑</button></div>
        <div class="zen-ctrl-row">
          <button class="zen-btn" onclick="window._zenGame.move('left')">←</button>
          <button class="zen-btn" onclick="window._zenGame.move('down')">↓</button>
          <button class="zen-btn" onclick="window._zenGame.move('right')">→</button>
        </div>
      </div>
    </div>
  `;
  setMeta(`<span style="color:var(--accent)">Best: ${best}</span> &nbsp;·&nbsp; Swipe or use arrow keys`);

  function addRandom() {
    const empty=[];
    for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) if(!board[r][c]) empty.push([r,c]);
    if(!empty.length) return;
    const [r,c]=empty[Math.floor(Math.random()*empty.length)];
    board[r][c]=Math.random()<0.9?2:4;
  }

  function renderBoard() {
    const el=document.getElementById('zenBoard');
    if(!el) return;
    el.innerHTML='';
    for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) {
      const v=board[r][c], cell=document.createElement('div');
      cell.className=`zen-cell${v?' zen-v'+v:''}`;
      if(v) cell.textContent=v;
      el.appendChild(cell);
    }
    document.getElementById('zenScore').textContent=score;
    document.getElementById('zenBest').textContent=best;
  }

  function slide(row) {
    const nums=row.filter(v=>v); let merged=false, pts=0;
    for(let i=0;i<nums.length-1;i++) {
      if(nums[i]===nums[i+1]&&!merged) {
        nums[i]*=2; pts+=nums[i]; maxTile=Math.max(maxTile,nums[i]);
        nums.splice(i+1,1); merged=true; SFX.merge();
      } else merged=false;
    }
    while(nums.length<SIZE) nums.push(0);
    return {row:nums, pts};
  }

  function move(dir) {
    if(gameOver) return;
    let moved=false, totalPts=0;
    const prev=board.map(r=>[...r]);

    if(dir==='left')  { for(let r=0;r<SIZE;r++){const{row,pts}=slide(board[r]);totalPts+=pts;if(board[r].join()!==row.join())moved=true;board[r]=row;} }
    if(dir==='right') { for(let r=0;r<SIZE;r++){const{row,pts}=slide([...board[r]].reverse());totalPts+=pts;const rev=row.reverse();if(board[r].join()!==rev.join())moved=true;board[r]=rev;} }
    if(dir==='up')    { for(let c=0;c<SIZE;c++){const col=board.map(r=>r[c]);const{row,pts}=slide(col);totalPts+=pts;row.forEach((v,r)=>{if(board[r][c]!==v)moved=true;board[r][c]=v;});} }
    if(dir==='down')  { for(let c=0;c<SIZE;c++){const col=board.map(r=>r[c]).reverse();const{row,pts}=slide(col);totalPts+=pts;const rev=row.reverse();rev.forEach((v,r)=>{if(board[r][c]!==v)moved=true;board[r][c]=v;});} }

    if(!moved) { SFX.wrong(); return; }
    score+=totalPts; if(score>best){best=score;saveGameStat('numberzen','bestScore',best);}
    saveGameStat('numberzen','maxTile',Math.max(maxTile,getBest('numberzen','maxTile',0)));
    addRandom(); SFX.place();
    renderBoard();
    if(board.flat().includes(2048)) { gameOver=true; SFX.levelUp(); setTimeout(()=>endZen('win'),600); return; }
    if(!canMove()) { gameOver=true; setTimeout(()=>endZen('over'),600); }
  }

  function canMove() {
    for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) {
      if(!board[r][c]) return true;
      if(c<SIZE-1&&board[r][c]===board[r][c+1]) return true;
      if(r<SIZE-1&&board[r][c]===board[r+1][c]) return true;
    }
    return false;
  }

  window._zenGame.move = move;

  // Keyboard
  const keyHandler = (e) => {
    const map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
    if(map[e.key]) { e.preventDefault(); move(map[e.key]); }
  };
  document.addEventListener('keydown', keyHandler);
  window._zenGame.stop = () => document.removeEventListener('keydown', keyHandler);
  _gameTimers.push({clear:()=>document.removeEventListener('keydown',keyHandler)});

  // Touch swipe
  let touchStart={x:0,y:0};
  const zenBoard=document.getElementById('zenBoard');
  zenBoard?.addEventListener('touchstart',e=>{touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
  zenBoard?.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-touchStart.x;
    const dy=e.changedTouches[0].clientY-touchStart.y;
    if(Math.abs(dx)>Math.abs(dy)) move(dx>0?'right':'left');
    else move(dy>0?'down':'up');
  },{passive:true});

  function endZen(reason) {
    const won=reason==='win';
    if(won) { awardGameXP(100,'Zen Master 2048!'); SFX.win(); }
    showGameWin(canvas, won?'✨ 2048!':'💫 Game Over',
      `Score: ${score} · Max Tile: ${maxTile}`, won, score, ()=>initNumberZen(canvas));
  }

  addRandom(); addRandom(); renderBoard();
}

// ── Shared Win Screen ─────────────────────────────────────────
function showGameWin(canvas, title, sub, won, score, replay) {
  const overlay=document.createElement('div');
  overlay.className='game-win-overlay';
  overlay.innerHTML=`
    <div class="game-win-box">
      <div class="game-win-emoji">${won?'🏆':'😤'}</div>
      <div class="game-win-title">${title}</div>
      <div class="game-win-sub">${sub}</div>
      ${won?`<div class="game-win-xp">+XP Earned!</div>`:''}
      <div class="game-win-actions">
        <button class="btn-ghost" onclick="closeGame()"><i class="fas fa-home"></i> Hub</button>
        <button class="btn-primary" style="width:auto;padding:12px 24px" onclick="this.closest('.game-win-overlay').remove();(${replay.toString()})()">
          <i class="fas fa-redo"></i> Play Again
        </button>
      </div>
    </div>
  `;
  canvas.style.position='relative';
  canvas.appendChild(overlay);
  if(won) { SFX.win(); const r=canvas.getBoundingClientRect(); for(let i=0;i<5;i++) setTimeout(()=>burst(r.left+Math.random()*r.width,r.top+Math.random()*r.height,['#58e000','#ffb627','#a855f7','#3d9df3'][Math.floor(Math.random()*4)],16),i*180); }
}

// ══════════════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════════════
function injectGamesCSS() {
  if(document.getElementById('games-css')) return;
  const s=document.createElement('style'); s.id='games-css';
  s.textContent = `
/* ── Hub ── */
.games-xp-chip{display:flex;align-items:center;gap:8px;background:rgba(88,224,0,0.08);border:1px solid rgba(88,224,0,0.2);border-radius:100px;padding:8px 16px;font-size:0.85rem;color:var(--accent-text);}
.games-xp-chip i{font-size:14px;color:var(--accent);}
.games-hub-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-bottom:24px;}
@media(max-width:700px){.games-hub-grid{grid-template-columns:1fr;}}

/* ── Game Hub Cards ── */
.game-hub-card{position:relative;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:28px;overflow:hidden;cursor:pointer;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);display:flex;flex-direction:column;gap:16px;min-height:200px;}
.game-hub-card:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,0.5);}
.ghc-bg{position:absolute;inset:0;opacity:0.04;transition:opacity 0.3s;}
.game-hub-card:hover .ghc-bg{opacity:0.08;}
.ghc-bg-memory{background:radial-gradient(circle at 70% 30%,#ffb627,transparent 60%);}
.ghc-bg-sudoku{background:radial-gradient(circle at 70% 30%,#3d9df3,transparent 60%);}
.ghc-bg-word  {background:radial-gradient(circle at 70% 30%,#a855f7,transparent 60%);}
.ghc-bg-zen   {background:radial-gradient(circle at 70% 30%,#58e000,transparent 60%);}
.ghc-icon{font-size:2.8rem;line-height:1;}
.ghc-body{flex:1;}
.ghc-title{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:800;margin-bottom:6px;}
.ghc-desc{font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;}
.ghc-stats{display:flex;gap:14px;font-size:0.78rem;color:var(--text-muted);}
.ghc-stats span{display:flex;align-items:center;gap:5px;}
.ghc-play{position:absolute;bottom:20px;right:20px;background:var(--accent);color:#000;border-radius:100px;padding:7px 18px;font-family:'Syne',sans-serif;font-size:0.82rem;font-weight:800;display:flex;align-items:center;gap:7px;transition:all 0.2s;}
.game-hub-card:hover .ghc-play{box-shadow:0 0 20px rgba(88,224,0,0.4);}
.ghc-badge{position:absolute;top:20px;right:20px;font-size:0.65rem;font-weight:800;letter-spacing:1px;padding:4px 10px;border-radius:4px;}
.ghc-badge-memory{background:rgba(255,182,39,0.15);color:var(--amber);}
.ghc-badge-sudoku{background:rgba(61,157,243,0.15);color:var(--blue);}
.ghc-badge-word  {background:rgba(168,85,247,0.15);color:var(--purple);}
.ghc-badge-zen   {background:rgba(88,224,0,0.12);color:var(--accent);}
.game-hub-card:nth-child(1){border-top:2px solid var(--amber);}
.game-hub-card:nth-child(2){border-top:2px solid var(--blue);}
.game-hub-card:nth-child(3){border-top:2px solid var(--purple);}
.game-hub-card:nth-child(4){border-top:2px solid var(--accent);}

/* ── Game Stage ── */
.game-stage{display:flex;flex-direction:column;gap:20px;}
.game-stage-header{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.game-back-btn{background:var(--bg-card);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);padding:9px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:0.85rem;transition:all var(--transition);}
.game-back-btn:hover{border-color:var(--accent);color:var(--accent);}
.game-stage-title{font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;flex:1;}
.game-stage-meta{font-size:0.85rem;color:var(--text-secondary);display:flex;align-items:center;gap:10px;}
.game-canvas{position:relative;}

/* ── Win overlay ── */
.game-win-overlay{position:absolute;inset:0;background:rgba(10,10,15,0.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:100;border-radius:var(--radius-xl);}
.game-win-box{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-xl);padding:40px;text-align:center;max-width:360px;animation:gameWinPop 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards;}
.game-win-emoji{font-size:4rem;margin-bottom:12px;animation:spinIn 0.6s ease;}
.game-win-title{font-family:'Syne',sans-serif;font-size:1.8rem;font-weight:800;margin-bottom:8px;}
.game-win-sub{color:var(--text-secondary);font-size:0.9rem;margin-bottom:12px;}
.game-win-xp{background:rgba(88,224,0,0.12);border:1px solid rgba(88,224,0,0.25);color:var(--accent);border-radius:100px;padding:6px 18px;font-size:0.82rem;font-weight:700;display:inline-block;margin-bottom:20px;animation:glowPulse 2s infinite;}
.game-win-actions{display:flex;gap:12px;justify-content:center;margin-top:8px;}

/* ═══ MEMORY MATCH ═══ */
.memory-game{display:flex;flex-direction:column;gap:20px;}
.memory-hud{display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 24px;}
.mem-stat{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:60px;}
.mem-stat-val{font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:800;color:var(--accent);}
.mem-stat-lbl{font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;}
.mem-timer-wrap{display:flex;justify-content:center;}
.mem-timer-ring{position:relative;width:64px;height:64px;}
.mem-timer-ring svg{width:64px;height:64px;}
.mem-timer-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;}
.memory-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
@media(max-width:500px){.memory-grid{gap:6px;}}
.mem-card{height:80px;cursor:pointer;perspective:600px;user-select:none;}
@media(max-width:500px){.mem-card{height:64px;}}
.mem-card-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);}
.mem-card.flipped .mem-card-inner{transform:rotateY(180deg);}
.mem-card-back,.mem-card-front{position:absolute;inset:0;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;backface-visibility:hidden;}
.mem-card-back{background:var(--bg-input);border:2px solid var(--border);font-size:1.4rem;color:var(--text-muted);transition:border-color 0.2s;}
.mem-card:hover .mem-card-back{border-color:var(--accent);}
.mem-card-mark{font-size:1.6rem;color:var(--border);}
.mem-card-front{background:var(--bg-card-hover);border:2px solid var(--accent);transform:rotateY(180deg);font-size:2rem;}
.mem-card.matched .mem-card-front{background:rgba(88,224,0,0.12);animation:pulseGreen 1.5s ease;}
.mem-combo{text-align:center;font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:800;color:var(--amber);min-height:28px;opacity:0;}

/* ═══ SUDOKU ═══ */
.sudoku-game{display:flex;flex-direction:column;align-items:center;gap:16px;}
.sudoku-hud{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:400px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 20px;}
.sdk-stat{display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--text-secondary);}
.sdk-timer{font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:800;color:var(--accent);}
.sudoku-board{display:grid;grid-template-columns:repeat(9,1fr);gap:2px;background:var(--border);border:2px solid var(--text-muted);border-radius:var(--radius-md);overflow:hidden;max-width:400px;width:100%;}
.sdk-cell{background:var(--bg-card);display:flex;align-items:center;justify-content:center;aspect-ratio:1;font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:700;cursor:pointer;transition:all 0.15s;user-select:none;}
@media(max-width:440px){.sdk-cell{font-size:0.85rem;}}
.sdk-cell.sdk-fixed{color:var(--text-primary);font-weight:800;}
.sdk-cell:not(.sdk-fixed){color:var(--blue);}
.sdk-cell.sdk-selected{background:rgba(88,224,0,0.18);color:var(--accent);}
.sdk-cell.sdk-highlight{background:rgba(88,224,0,0.05);}
.sdk-cell.sdk-same{background:rgba(88,224,0,0.1);}
.sdk-cell.sdk-wrong{color:var(--red) !important;}
.sdk-cell.sdk-border-right{border-right:2px solid var(--text-muted);}
.sdk-cell.sdk-border-bottom{border-bottom:2px solid var(--text-muted);}
.sudoku-numpad{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;max-width:400px;width:100%;}
.sdk-num{background:var(--bg-card);border:1px solid var(--border);color:var(--text-primary);border-radius:var(--radius-md);padding:12px 6px;font-family:'Syne',sans-serif;font-size:1rem;font-weight:800;cursor:pointer;transition:all var(--transition);}
.sdk-num:hover{background:var(--accent);color:#000;border-color:var(--accent);}
.sdk-erase{color:var(--red) !important;border-color:rgba(255,71,87,0.3);}
.sdk-erase:hover{background:var(--red) !important;color:#fff !important;}
.sdk-hint{color:var(--amber) !important;border-color:rgba(255,182,39,0.3);}
.sdk-hint:hover{background:var(--amber) !important;color:#000 !important;}

/* ═══ WORD SEARCH ═══ */
.word-game{display:grid;grid-template-columns:160px 1fr;gap:20px;align-items:start;}
@media(max-width:600px){.word-game{grid-template-columns:1fr;}}
.word-sidebar{display:flex;flex-direction:column;gap:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;}
.word-theme{font-family:'Syne',sans-serif;font-size:0.7rem;font-weight:800;letter-spacing:2px;color:var(--purple);text-transform:uppercase;border-bottom:1px solid var(--border);padding-bottom:8px;}
.word-list{display:flex;flex-direction:column;gap:6px;}
.word-item{font-size:0.85rem;font-weight:600;color:var(--text-secondary);padding:4px 8px;border-radius:6px;letter-spacing:1px;transition:all 0.3s;}
.word-item.found-word{color:var(--accent);text-decoration:line-through;background:rgba(88,224,0,0.08);}
.word-score-wrap{text-align:center;border-top:1px solid var(--border);padding-top:12px;}
.word-score-val{font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:800;color:var(--accent);}
.word-score-lbl{font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;}
.word-timer{font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;text-align:center;color:var(--amber);}
.word-grid-wrap{overflow:auto;}
.word-grid{display:grid;gap:2px;user-select:none;touch-action:none;}
.word-cell{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:0.82rem;font-weight:700;background:var(--bg-card);border:1px solid var(--border);border-radius:4px;cursor:pointer;transition:all 0.1s;color:var(--text-secondary);}
.word-cell:hover{background:var(--bg-card-hover);color:var(--text-primary);}
.word-cell.selecting{background:rgba(168,85,247,0.25);color:var(--purple);border-color:var(--purple);transform:scale(1.05);}
.word-cell.found{background:rgba(88,224,0,0.15);color:var(--accent);border-color:rgba(88,224,0,0.3);}

/* ═══ NUMBER ZEN ═══ */
.zen-game{display:flex;flex-direction:column;align-items:center;gap:16px;}
.zen-hud{display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;max-width:360px;}
.zen-scores{display:flex;gap:12px;}
.zen-score-box{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 24px;text-align:center;min-width:100px;}
.zen-score-box.zen-best{border-color:rgba(255,182,39,0.3);}
.zen-score-val{font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--accent);}
.zen-best .zen-score-val{color:var(--amber);}
.zen-score-lbl{font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;}
.zen-hint{font-size:0.78rem;color:var(--text-muted);}
.zen-board{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:var(--bg-surface);padding:12px;border-radius:var(--radius-lg);border:1px solid var(--border);width:100%;max-width:360px;}
.zen-cell{aspect-ratio:1;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:800;font-size:1.2rem;background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border);transition:background 0.15s;}
@media(max-width:400px){.zen-cell{font-size:0.9rem;}}
.zen-v2   {background:#1a2e1a;color:#58e000;border-color:#58e000;font-size:1.3rem;animation:tileNew 0.2s ease;}
.zen-v4   {background:#1f2e10;color:#7aee20;border-color:#7aee20;}
.zen-v8   {background:#2a2000;color:#ffb627;border-color:#ffb627;}
.zen-v16  {background:#2a1800;color:#ff9500;border-color:#ff9500;}
.zen-v32  {background:#2a1000;color:#ff6b35;border-color:#ff6b35;}
.zen-v64  {background:#2a0800;color:#ff4757;border-color:#ff4757;}
.zen-v128 {background:#1a0e2a;color:#c084fc;border-color:#c084fc;font-size:1rem;animation:tileMerge 0.2s ease;}
.zen-v256 {background:#1a0a2e;color:#a855f7;border-color:#a855f7;font-size:1rem;animation:tileMerge 0.2s ease;}
.zen-v512 {background:#0e1a2e;color:#3d9df3;border-color:#3d9df3;font-size:0.9rem;animation:tileMerge 0.2s ease;}
.zen-v1024{background:#0a1a20;color:#06d6d6;border-color:#06d6d6;font-size:0.8rem;animation:tileMerge 0.2s ease;}
.zen-v2048{background:#1a1400;color:#ffd700;border-color:#ffd700;font-size:0.75rem;animation:tileMerge 0.2s ease;box-shadow:0 0 20px rgba(255,215,0,0.5);}
.zen-controls{display:flex;flex-direction:column;align-items:center;gap:6px;}
.zen-ctrl-row{display:flex;gap:6px;}
.zen-btn{width:52px;height:52px;background:var(--bg-card);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-md);font-size:1.3rem;cursor:pointer;transition:all var(--transition);display:flex;align-items:center;justify-content:center;}
.zen-btn:hover{background:var(--accent);color:#000;border-color:var(--accent);}
`;
  document.head.appendChild(s);
}

// ── Auto-init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('section-dashboard')) initGamesHub();
});
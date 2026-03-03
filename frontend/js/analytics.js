/* ============================================================
   QUESTFLOW — ANALYTICS.JS
   Charts (Chart.js), heatmap, patterns, Spotify Wrapped
   ============================================================ */

let analyticsLoaded = false;
let xpChartInstance = null;
let moodChartInstance = null;
let catChartInstance = null;
let currentRange = 'week';

async function loadAnalytics() {
  if (analyticsLoaded) return;

  try {
    const [weekly, patterns, wrapped] = await Promise.allSettled([
      API.getWeeklyStats(),
      API.getPatterns(),
      API.getWrapped()
    ]);

    if (weekly.status === 'fulfilled') {
      renderXPChart(weekly.value);
      renderMoodChart(weekly.value);
      renderCategoryChart(weekly.value);
      renderHeatmap(weekly.value);
    } else {
      renderChartsWithPlaceholder();
    }

    if (patterns.status === 'fulfilled') {
      renderPatterns(patterns.value);
    }

    if (wrapped.status === 'fulfilled') {
      renderWrapped(wrapped.value);
    }

    analyticsLoaded = true;
  } catch (err) {
    console.error('Analytics load error:', err);
    renderChartsWithPlaceholder();
  }
}

function setRange(range, btnEl) {
  currentRange = range;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  analyticsLoaded = false;
  loadAnalytics();
}

// ── Chart defaults ──
const chartDefaults = () => ({
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1c1c28',
      borderColor: '#2a2a3a',
      borderWidth: 1,
      titleColor: '#f0f0f8',
      bodyColor: '#8888aa',
      padding: 12,
      cornerRadius: 8
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#55556a', font: { family: 'DM Sans', size: 11 } }
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#55556a', font: { family: 'DM Sans', size: 11 } },
      beginAtZero: true
    }
  }
});

// ============================================================
// XP CHART
// ============================================================
function renderXPChart(data) {
  const ctx = document.getElementById('xpChart');
  if (!ctx) return;
  if (xpChartInstance) xpChartInstance.destroy();

  const days = data.days || data.dates || generateFakeDays();
  const xpData = data.xp_per_day || data.xpPerDay || generateFakeXP(days.length);

  xpChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => formatChartDate(d)),
      datasets: [{
        label: 'XP Earned',
        data: xpData,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 200);
          g.addColorStop(0, 'rgba(88,224,0,0.8)');
          g.addColorStop(1, 'rgba(88,224,0,0.1)');
          return g;
        },
        borderColor: '#58e000',
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        hoverBackgroundColor: 'rgba(88,224,0,0.9)'
      }]
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          ...chartDefaults().plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.parsed.y} XP`
          }
        }
      }
    }
  });
}

// ============================================================
// MOOD vs PRODUCTIVITY CHART
// ============================================================
function renderMoodChart(data) {
  const ctx = document.getElementById('moodChart');
  if (!ctx) return;
  if (moodChartInstance) moodChartInstance.destroy();

  const days = data.days || data.dates || generateFakeDays();
  const moodScores = data.mood_scores || data.moodScores || generateFakeMoods(days.length);
  const compRates = data.completion_rates || data.completionRates || generateFakeCompletion(days.length);

  moodChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: days.map(d => formatChartDate(d)),
      datasets: [
        {
          label: 'Mood Score',
          data: moodScores,
          borderColor: '#ffb627',
          backgroundColor: 'rgba(255,182,39,0.08)',
          tension: 0.4,
          pointBackgroundColor: '#ffb627',
          pointRadius: 4,
          fill: true
        },
        {
          label: 'Completion %',
          data: compRates.map(v => v * 10),
          borderColor: '#58e000',
          backgroundColor: 'rgba(88,224,0,0.06)',
          tension: 0.4,
          pointBackgroundColor: '#58e000',
          pointRadius: 4,
          fill: true
        }
      ]
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        legend: {
          display: true,
          labels: {
            color: '#8888aa',
            font: { family: 'DM Sans', size: 11 },
            boxWidth: 12, boxHeight: 12, borderRadius: 4
          }
        }
      }
    }
  });
}

// ============================================================
// CATEGORY CHART (Doughnut)
// ============================================================
const CATEGORY_COLORS = {
  work: '#3d9df3', health: '#58e000', personal: '#ffb627',
  learning: '#a855f7', social: '#ff6b9d'
};

function renderCategoryChart(data) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (catChartInstance) catChartInstance.destroy();

  const raw = data.category_breakdown || data.categoryBreakdown || {
    work: 40, health: 20, personal: 15, learning: 20, social: 5
  };

  const labels = Object.keys(raw);
  const values = Object.values(raw);
  const colors = labels.map(l => CATEGORY_COLORS[l] || '#8888aa');

  catChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{
        data: values,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { ...chartDefaults().plugins.tooltip }
      }
    }
  });

  // Custom legend
  const legend = document.getElementById('categoryLegend');
  if (legend) {
    legend.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${colors[i]}"></div>
        <span>${l.charAt(0).toUpperCase() + l.slice(1)}</span>
        <span style="margin-left:auto;color:var(--text-muted)">${values[i]}%</span>
      </div>
    `).join('');
  }
}

// ============================================================
// COMPLETION HEATMAP (7-column grid, last 28 days)
// ============================================================
function renderHeatmap(data) {
  const wrap = document.getElementById('heatmapWrap');
  if (!wrap) return;

  const rawMap = data.completion_heatmap || data.completionHeatmap || {};
  const days = 28;
  const cells = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const count = rawMap[key] || 0;
    cells.push({ date: key, count, label: `${key}: ${count} completed` });
  }

  const maxCount = Math.max(...cells.map(c => c.count), 1);

  wrap.innerHTML = cells.map(c => {
    const intensity = c.count / maxCount;
    const opacity = c.count === 0 ? 0 : 0.15 + intensity * 0.85;
    const color = `rgba(88,224,0,${opacity})`;
    return `<div class="heat-cell" style="background:${color}" data-label="${c.label}" title="${c.label}"></div>`;
  }).join('');
}

// ============================================================
// BEHAVIORAL PATTERNS
// ============================================================
function renderPatterns(data) {
  const patterns = data.patterns || [];
  const suggestions = data.suggestions || [];
  const container = document.getElementById('patternsGrid');
  if (!container) return;

  if (!patterns.length) {
    container.innerHTML = `
      <div class="pattern-item" style="grid-column:1/-1">
        <div class="pattern-icon positive"><i class="fas fa-check"></i></div>
        <div>
          <div class="pattern-title">No Issues Detected</div>
          <div class="pattern-desc">Keep completing quests to build a behavioral model. More data = smarter insights!</div>
        </div>
      </div>`;
    return;
  }

  const patternConfig = {
    burnout:         { icon: 'fire', cls: 'burnout',         title: '🔥 Burnout Risk',         desc: 'Completion rate has dropped over 3+ days. Consider reducing task load.' },
    procrastination: { icon: 'clock', cls: 'procrastination', title: '⏳ Procrastination',       desc: 'You frequently delay tasks of similar type close to deadline.' },
    peak_hours:      { icon: 'sun', cls: 'positive',          title: '⏰ Peak Hours Found',      desc: null },
    positive_streak: { icon: 'star', cls: 'positive',         title: '🌟 Positive Momentum',    desc: 'Strong streak detected! You\'re in a productive zone.' }
  };

  container.innerHTML = patterns.map(p => {
    const cfg = patternConfig[p.type] || { icon: 'info', cls: 'positive', title: p.type, desc: null };
    return `
      <div class="pattern-item card-enter">
        <div class="pattern-icon ${cfg.cls}"><i class="fas fa-${cfg.icon}"></i></div>
        <div>
          <div class="pattern-title">${cfg.title}</div>
          <div class="pattern-desc">${escHtml(p.description || cfg.desc || '')}</div>
        </div>
      </div>`;
  }).join('');

  // Also update dashboard suggestions
  const suggContainer = document.getElementById('suggestionsList');
  if (suggContainer && suggestions.length) {
    suggContainer.innerHTML = suggestions.slice(0, 3).map(s => `
      <div class="suggestion-item card-enter">
        <i class="fas fa-${s.icon || 'lightbulb'}"></i>
        <span>${escHtml(s.text || s.message)}</span>
      </div>`).join('');
  }
}

// ============================================================
// SPOTIFY WRAPPED
// ============================================================
function renderWrapped(data) {
  const banner = document.getElementById('wrappedBanner');
  const statsEl = document.getElementById('wrappedStats');
  if (!banner || !statsEl) return;

  const stats = [
    { val: data.tasks_completed ?? data.total_completed ?? '—',  label: 'Quests Completed' },
    { val: data.xp_earned ?? data.total_xp_earned ?? '—',        label: 'XP Earned' },
    { val: data.best_streak ?? data.max_streak ?? '—',            label: 'Best Streak' },
    { val: data.top_category ?? data.most_active_category ?? '—', label: 'Top Category' },
    { val: data.completion_rate ?? data.avg_completion_rate
        ? Math.round((data.completion_rate || data.avg_completion_rate) * 100) + '%'
        : '—',                                                    label: 'Completion Rate' },
    { val: data.growth_pct ?? data.growth_percentage
        ? (data.growth_pct > 0 ? '+' : '') + Math.round(data.growth_pct || data.growth_percentage) + '%'
        : '—',                                                    label: 'Growth vs Last Week' }
  ].filter(s => s.val !== '—' && s.val !== undefined);

  if (!stats.length) { banner.classList.add('hidden'); return; }

  statsEl.innerHTML = stats.map(s => `
    <div class="wrapped-stat">
      <div class="wrapped-stat-val">${escHtml(String(s.val))}</div>
      <div class="wrapped-stat-label">${escHtml(s.label)}</div>
    </div>`).join('');
}

// ============================================================
// PLACEHOLDER CHARTS (when backend not available)
// ============================================================
function renderChartsWithPlaceholder() {
  const days = generateFakeDays();
  renderXPChart({ days, xp_per_day: generateFakeXP(days.length) });
  renderMoodChart({ days, mood_scores: generateFakeMoods(days.length), completion_rates: generateFakeCompletion(days.length) });
  renderCategoryChart({});
  renderHeatmap({});
}

function generateFakeDays() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
}
function generateFakeXP(n) { return Array.from({ length: n }, () => Math.floor(Math.random() * 60)); }
function generateFakeMoods(n) { return Array.from({ length: n }, () => (Math.random() * 8 - 2).toFixed(1)); }
function generateFakeCompletion(n) { return Array.from({ length: n }, () => (Math.random() * 8 + 2).toFixed(1)); }

function formatChartDate(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}
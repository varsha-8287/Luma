/* ============================================================
   QUESTFLOW — TASK.JS
   Task board, smart ranking display, CRUD, modal, filters
   ============================================================ */

let allTasks = [];
let currentFilter = 'all';

// ============================================================
// RENDER TASK BOARD (full task section)
// ============================================================
function renderTaskBoard(tasks) {
  allTasks = tasks || [];
  filterTasks(currentFilter);
}

function filterTasks(filter, btnEl) {
  currentFilter = filter;
  // Update active tab
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const filtered = filter === 'all'
    ? allTasks
    : allTasks.filter(t => t.status === filter);

  renderTaskCards(filtered);
}

function renderTaskCards(tasks) {
  const container = document.getElementById('taskCardsGrid');
  if (!container) return;

  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <i class="fas fa-scroll" style="font-size:3rem;color:var(--border)"></i>
        <p>No quests found. Add your first quest!</p>
      </div>`;
    return;
  }

  container.innerHTML = tasks.map((t, i) => buildTaskCard(t, i)).join('');
}

function buildTaskCard(t, i = 0) {
  const id = t._id || t.id;
  const isPending = t.status === 'Pending';
  const isCompleted = t.status === 'Completed';
  const isMissed = t.status === 'Missed';
  const deadline = new Date(t.deadline);
  const isOverdue = isPending && deadline < new Date();
  const rank = t.smart_rank || t.smartRank || null;
  const priority = t.priority || 2;
  const xp = t.points || t.xp_earned || 0;

  const priorityLabel = { 3: '🔴 Critical', 2: '🟡 Normal', 1: '🟢 Low' }[priority] || '🟡 Normal';

  return `
    <div class="task-card-full ${t.status.toLowerCase()} card-enter stagger-${Math.min(i+1,5)}" data-id="${id}">
      ${xp !== 0 ? `<span class="xp-earned ${xp < 0 ? 'xp-lost' : ''}">${xp > 0 ? '+' : ''}${xp} XP</span>` : ''}

      <div class="task-card-header">
        <div class="task-card-title ${isCompleted ? 'done' : ''}">${escHtml(t.name)}</div>
        <span class="task-card-status status-${t.status}">
          <i class="fas fa-${isCompleted ? 'check' : isMissed ? 'times' : 'clock'}"></i>
          ${t.status}
        </span>
      </div>

      ${t.description ? `<p class="task-card-desc">${escHtml(t.description)}</p>` : ''}

      <div class="task-card-meta">
        <span class="task-meta-chip ${isOverdue ? 'overdue' : ''}">
          <i class="fas fa-calendar"></i>
          ${isOverdue ? 'Overdue' : formatDeadlineShort(deadline)}
        </span>
        <span class="task-meta-chip">
          <i class="fas fa-flag"></i> ${priorityLabel}
        </span>
        ${t.category ? `<span class="task-meta-chip">${getCategoryEmoji(t.category)} ${t.category}</span>` : ''}
        ${t.completedAt ? `<span class="task-meta-chip"><i class="fas fa-check-circle"></i> ${new Date(t.completedAt).toLocaleDateString()}</span>` : ''}
      </div>

      ${rank !== null ? `
        <div class="smart-rank">
          <i class="fas fa-brain" style="color:var(--accent);font-size:10px"></i>
          <span style="font-size:0.75rem;color:var(--text-muted)">Smart Rank</span>
          <div class="rank-bar"><div class="rank-fill" style="width:${Math.round(rank * 100)}%"></div></div>
          <span style="font-size:0.75rem;color:var(--text-muted)">${Math.round(rank * 100)}</span>
        </div>` : ''}

      ${isPending ? `
        <div class="task-card-actions">
          <button class="btn-complete" onclick="completeTaskFromBoard('${id}', this)">
            <i class="fas fa-check"></i> Complete
          </button>
          <button class="btn-delete" onclick="deleteTaskFromBoard('${id}', this)" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>` : `
        <div class="task-card-actions">
          <button class="btn-delete" onclick="deleteTaskFromBoard('${id}', this)" style="flex:1" title="Delete">
            <i class="fas fa-trash"></i> Remove
          </button>
        </div>`}
    </div>`;
}

// ============================================================
// COMPLETE TASK
// ============================================================
async function completeTaskFromBoard(taskId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    const data = await API.completeTask(taskId);
    const xp = data.xpEarned || data.xp_earned || 10;
    const user = data.user || data.updated_user;

    // Update local
    allTasks = allTasks.map(t =>
      (t._id||t.id) === taskId
        ? { ...t, status: 'Completed', points: xp, completedAt: new Date().toISOString() }
        : t
    );
    window._tasks = allTasks;

    // Re-render
    filterTasks(currentFilter);
    renderDashboardTasks(allTasks);
    updateTaskBadge(allTasks);

    if (user) {
      const prevLevel = currentUser?.level || 0;
      currentUser = { ...currentUser, ...user };
      API.setUser(currentUser);
      renderUserStats({ ...data, user });
      if (user.level > prevLevel) showLevelUp(user.level);
    }

    // Effects
    triggerConfetti();
    ttsSpeak(`Quest conquered! ${xp} XP earned. ${data.completedEarly || data.completed_early ? 'Bonus for early completion!' : ''}`);
    checkBadgeUnlocks(data.badges_unlocked);

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> Complete';
    alert(err.message);
  }
}

// ============================================================
// DELETE TASK
// ============================================================
async function deleteTaskFromBoard(taskId, btn) {
  if (!confirm('Remove this quest permanently?')) return;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    await API.deleteTask(taskId);
    allTasks = allTasks.filter(t => (t._id||t.id) !== taskId);
    window._tasks = allTasks;
    filterTasks(currentFilter);
    renderDashboardTasks(allTasks);
    updateTaskBadge(allTasks);
    ttsSpeak('Quest removed.');
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-trash"></i>';
    alert(err.message);
  }
}

// ============================================================
// ADD TASK MODAL
// ============================================================
function openTaskModal() {
  // Set min datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const el = document.getElementById('taskDeadline');
  if (el) el.min = now.toISOString().slice(0, 16);
  document.getElementById('taskModal').classList.remove('hidden');
  document.getElementById('taskName').focus();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.add('hidden');
  ['taskName','taskDesc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

async function createTask() {
  const name = document.getElementById('taskName')?.value.trim();
  const desc = document.getElementById('taskDesc')?.value.trim();
  const deadline = document.getElementById('taskDeadline')?.value;
  const priority = parseInt(document.getElementById('taskPriority')?.value || '2');
  const category = document.getElementById('taskCategory')?.value || 'work';

  if (!name || !deadline) {
    alert('Quest name and deadline are required!');
    return;
  }

  const btn = document.querySelector('#taskModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

  try {
    const data = await API.createTask({ name, description: desc, deadline, priority, category });
    const newTask = data.task || data;
    allTasks.unshift(newTask);
    allTasks.sort((a, b) => {
      const ra = a.smart_rank || 0;
      const rb = b.smart_rank || 0;
      return rb - ra;
    });
    window._tasks = allTasks;
    filterTasks(currentFilter);
    renderDashboardTasks(allTasks);
    updateTaskBadge(allTasks);
    closeTaskModal();
    ttsSpeak(`Quest "${name}" added to your board!`);
  } catch (err) {
    alert(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Add Quest'; }
  }
}

// Enter key in task modal
document.addEventListener('keydown', e => {
  const modal = document.getElementById('taskModal');
  if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeTaskModal();
});

// ============================================================
// HELPERS
// ============================================================
function formatDeadlineShort(date) {
  const diff = date - new Date();
  if (diff < 0) return 'Overdue';
  if (diff < 3600000) return `${Math.round(diff/60000)}m left`;
  if (diff < 86400000) return `${Math.round(diff/3600000)}h left`;
  const days = Math.round(diff/86400000);
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `${days}d left`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
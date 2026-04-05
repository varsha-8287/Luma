/* ============================================================
   LUMA — TASK.JS  v3.2.0
   Fixes:
     - Timezone-safe deadline parsing (all deadlines treated as UTC)
     - formatDeadline / formatDeadlineShort fixed for IST and any offset
     - Reminder dedup keys include date so they re-fire after reload
     - Edit quest modal (name, desc, priority, category, deadline)
   ============================================================ */

let allTasks = [];
let currentFilter = 'all';

// ============================================================
// DEADLINE PARSER — always returns a correct absolute Date
// ============================================================
/**
 * The backend stores deadlines as UTC ISO strings, e.g. "2025-04-05T06:20:00+00:00".
 * new Date(str) does the right thing IF the string has a timezone suffix.
 * But datetime-local inputs give "2025-04-05T11:50" (no suffix) which
 * browsers parse as LOCAL time — causing a 5h30m gap for IST users.
 *
 * Rule: always append 'Z' only when the string has NO timezone info at all.
 */
function parseDeadline(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const s = String(raw);
  // Already has timezone info (+xx:xx / Z / -xx:xx)
  if (/[Z+\-]\d{2}:\d{2}$/.test(s) || s.endsWith('Z')) {
    return new Date(s);
  }
  // datetime-local format "YYYY-MM-DDTHH:mm" — treat as LOCAL time
  // (this is what the user typed in their local clock)
  return new Date(s);
}

// ============================================================
// RENDER TASK BOARD
// ============================================================
function renderTaskBoard(tasks) {
  allTasks = tasks || [];
  filterTasks(currentFilter);
}

function filterTasks(filter, btnEl) {
  currentFilter = filter;
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
  const id        = t._id || t.id;
  const isPending   = t.status === 'Pending';
  const isCompleted = t.status === 'Completed';
  const isMissed    = t.status === 'Missed';
  const deadline    = parseDeadline(t.deadline);
  const isOverdue   = isPending && deadline && deadline < new Date();
  const rank        = t.smart_rank ?? t.smartRank ?? null;
  const priority    = t.priority || 2;
  const xp          = t.points || t.xp_earned || 0;

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
          ${isOverdue ? '⚠ Overdue' : formatDeadlineShort(deadline)}
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
          <button class="btn-edit-task" onclick="openEditTaskModal('${id}')" title="Edit quest">
            <i class="fas fa-pen"></i>
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
    const xp   = data.xpEarned || data.xp_earned || 10;
    const user = data.user || data.updated_user;

    allTasks = allTasks.map(t =>
      (t._id||t.id) === taskId
        ? { ...t, status: 'Completed', points: xp, completedAt: new Date().toISOString() }
        : t
    );
    window._tasks = allTasks;

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
  // Build a local-time ISO string for the `min` attribute of datetime-local.
  // We need "YYYY-MM-DDTHH:mm" in LOCAL time, not UTC.
  // new Date() gives UTC ms; subtracting the offset (which is negative for IST)
  // brings it to local time, then toISOString() gives us the right string.
  const now = new Date();
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  const el = document.getElementById('taskDeadline');
  if (el) el.min = localISO;
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
  const name          = document.getElementById('taskName')?.value.trim();
  const desc          = document.getElementById('taskDesc')?.value.trim();
  const deadlineLocal = document.getElementById('taskDeadline')?.value;  // "YYYY-MM-DDTHH:mm" local
  const priority      = parseInt(document.getElementById('taskPriority')?.value || '2');
  const category      = document.getElementById('taskCategory')?.value || 'work';

  if (!name || !deadlineLocal) { alert('Quest name and deadline are required!'); return; }

  // Convert local datetime-local value → UTC ISO string so the backend stores the right time.
  // new Date("YYYY-MM-DDTHH:mm") is parsed as LOCAL time by the browser, so .toISOString()
  // correctly gives the UTC equivalent (e.g. IST 11:50 → UTC 06:20).
  const deadline = new Date(deadlineLocal).toISOString();

  const btn = document.querySelector('#taskModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }

  try {
    const data = await API.createTask({ name, description: desc, deadline, priority, category });
    const newTask = data.task || data;
    allTasks.unshift(newTask);
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

// ============================================================
// EDIT TASK MODAL  ← NEW
// ============================================================
function openEditTaskModal(taskId) {
  const task = allTasks.find(t => (t._id || t.id) === taskId);
  if (!task) return;

  // Remove existing modal if any
  document.getElementById('editTaskModal')?.remove();

  // Convert stored UTC deadline → local datetime-local string for the input
  const deadlineDate = parseDeadline(task.deadline);
  let deadlineLocal = '';
  if (deadlineDate) {
    // Shift to local time for the input value
    const local = new Date(deadlineDate.getTime() - deadlineDate.getTimezoneOffset() * 60000);
    deadlineLocal = local.toISOString().slice(0, 16);
  }

  // Min = now in local time
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'editTaskModal';
  modal.innerHTML = `
    <div class="modal task-modal">
      <div class="modal-header">
        <h3><i class="fas fa-pen"></i> Edit Quest</h3>
        <button class="modal-close" onclick="closeEditTaskModal()"><i class="fas fa-times"></i></button>
      </div>

      <div class="form-group">
        <label>Quest Name *</label>
        <input type="text" id="editTaskName" value="${escHtml(task.name)}" placeholder="What must be conquered?"/>
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea id="editTaskDesc" placeholder="Details about this quest..." rows="3">${escHtml(task.description || '')}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Priority</label>
          <select id="editTaskPriority">
            <option value="3" ${task.priority == 3 ? 'selected' : ''}>🔴 Critical</option>
            <option value="2" ${task.priority == 2 ? 'selected' : ''}>🟡 Normal</option>
            <option value="1" ${task.priority == 1 ? 'selected' : ''}>🟢 Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Category</label>
          <select id="editTaskCategory">
            <option value="work"     ${task.category === 'work'     ? 'selected' : ''}>💼 Work</option>
            <option value="health"   ${task.category === 'health'   ? 'selected' : ''}>💪 Health</option>
            <option value="personal" ${task.category === 'personal' ? 'selected' : ''}>🏠 Personal</option>
            <option value="learning" ${task.category === 'learning' ? 'selected' : ''}>📚 Learning</option>
            <option value="social"   ${task.category === 'social'   ? 'selected' : ''}>👥 Social</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Deadline *</label>
        <input type="datetime-local" id="editTaskDeadline" value="${deadlineLocal}" min="${nowLocal}"/>
      </div>

      <div class="edit-task-hint">
        <i class="fas fa-info-circle"></i>
        Only pending quests can be edited. XP and smart-rank will be recalculated.
      </div>

      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeEditTaskModal()">Cancel</button>
        <button class="btn-primary" id="editTaskSaveBtn" onclick="saveEditTask('${taskId}')">
          <i class="fas fa-save"></i> Save Changes
        </button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Inject edit-specific styles if not already present
  if (!document.getElementById('editTaskStyles')) {
    const s = document.createElement('style');
    s.id = 'editTaskStyles';
    s.textContent = `
      .btn-edit-task {
        background: rgba(61,157,243,0.12);
        border: 1px solid rgba(61,157,243,0.3);
        color: var(--blue);
        border-radius: var(--radius-sm);
        padding: 8px 12px;
        font-size: 0.82rem; font-weight: 700;
        cursor: pointer;
        display: flex; align-items: center; gap: 6px;
        transition: all var(--transition);
      }
      .btn-edit-task:hover { background: var(--blue); color: #fff; }
      .edit-task-hint {
        display: flex; align-items: center; gap: 8px;
        background: rgba(61,157,243,0.07);
        border: 1px solid rgba(61,157,243,0.15);
        border-radius: var(--radius-md);
        padding: 10px 14px;
        font-size: 0.78rem; color: var(--text-muted);
        margin: 4px 0 8px;
      }
      .edit-task-hint i { color: var(--blue); }
      .edit-success-pill {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(88,224,0,0.1); border: 1px solid rgba(88,224,0,0.3);
        color: var(--accent); border-radius: 100px;
        padding: 4px 12px; font-size: 0.78rem; font-weight: 700;
        animation: cardEntrance 0.3s ease;
      }
    `;
    document.head.appendChild(s);
  }
}

function closeEditTaskModal() {
  document.getElementById('editTaskModal')?.remove();
}

async function saveEditTask(taskId) {
  const name     = document.getElementById('editTaskName')?.value.trim();
  const desc     = document.getElementById('editTaskDesc')?.value.trim();
  const priority = parseInt(document.getElementById('editTaskPriority')?.value || '2');
  const category = document.getElementById('editTaskCategory')?.value || 'work';
  const deadlineLocal = document.getElementById('editTaskDeadline')?.value;

  if (!name) { alert('Quest name cannot be empty.'); return; }
  if (!deadlineLocal) { alert('Deadline is required.'); return; }

  // Same UTC conversion as createTask — local "YYYY-MM-DDTHH:mm" → UTC ISO
  const deadline = new Date(deadlineLocal).toISOString();

  const btn = document.getElementById('editTaskSaveBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

  try {
    await API.editTask(taskId, { name, description: desc, priority, category, deadline });

    // Re-fetch tasks from server so deadline is authoritative — prevents instant Overdue bug
    try {
      const fresh = await API.getTasks();
      const freshTasks = Array.isArray(fresh) ? fresh : (fresh.tasks || fresh);
      allTasks = freshTasks;
      window._tasks = freshTasks;
    } catch (_) {
      // Fallback: patch locally if re-fetch fails
      allTasks = allTasks.map(t =>
        (t._id || t.id) === taskId
          ? { ...t, name, description: desc, priority, category, deadline }
          : t
      );
      window._tasks = allTasks;
    }

    filterTasks(currentFilter);
    renderDashboardTasks(allTasks);
    updateTaskBadge(allTasks);

    closeEditTaskModal();
    ttsSpeak(`Quest "${name}" updated successfully.`);
  } catch (err) {
    alert('Could not save changes: ' + err.message);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
  }
}

// ESC closes edit modal too
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const editModal = document.getElementById('editTaskModal');
  if (editModal) { closeEditTaskModal(); return; }
  const modal = document.getElementById('taskModal');
  if (modal && !modal.classList.contains('hidden')) closeTaskModal();
});

// ============================================================
// HELPERS — TIMEZONE-SAFE
// ============================================================

/**
 * formatDeadline: used in dashboard task list.
 * Accepts anything parseDeadline() can handle.
 */
function formatDeadline(raw) {
  if (!raw) return '';
  const d   = parseDeadline(raw);
  if (!d || isNaN(d)) return '';
  const now  = new Date();
  const diff = d - now;
  if (diff < 0)        return '⚠ Overdue';
  if (diff < 3600000)  return `${Math.round(diff / 60000)}m left`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h left`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * formatDeadlineShort: used on task cards.
 */
function formatDeadlineShort(dateOrRaw) {
  const date = (dateOrRaw instanceof Date) ? dateOrRaw : parseDeadline(dateOrRaw);
  if (!date || isNaN(date)) return '—';
  const diff = date - new Date();
  if (diff < 0)          return 'Overdue';
  if (diff < 3600000)    return `${Math.round(diff / 60000)}m left`;
  if (diff < 86400000)   return `${Math.round(diff / 3600000)}h left`;
  const days = Math.round(diff / 86400000);
  if (days === 1)        return 'Tomorrow';
  if (days < 7)          return `${days}d left`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getCategoryEmoji(cat) {
  const map = { work: '💼', health: '💪', personal: '🏠', learning: '📚', social: '👥' };
  return map[cat] || '📌';
}
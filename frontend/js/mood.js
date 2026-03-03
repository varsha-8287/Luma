/* ============================================================
   QUESTFLOW — MOOD.JS
   Mood popup, selection, save, journal CRUD
   ============================================================ */

let selectedMood = null;
let journalEntries = [];

// ============================================================
// MOOD MODAL
// ============================================================
function selectMood(btn) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMood = btn.dataset.mood;
  const saveBtn = document.getElementById('saveMoodBtn');
  if (saveBtn) saveBtn.disabled = false;
  ttsSpeak(`${selectedMood} selected.`);
}

async function saveMood() {
  if (!selectedMood) return;
  const btn = document.getElementById('saveMoodBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const data = await API.logMood(selectedMood);
    localStorage.setItem('qf_last_mood', new Date().toDateString());

    // Update mood display on dashboard
    const moodMap = { Happy: '😊', Neutral: '😐', Sad: '😢', Angry: '😠', Tired: '😴' };
    const scoreMap = { Happy: 5, Neutral: 0, Sad: -3, Angry: -5, Tired: -2 };
    setEl('moodEmoji', moodMap[selectedMood]);
    setEl('moodType', selectedMood);
    const score = scoreMap[selectedMood];
    setEl('moodScore', `Score: ${score > 0 ? '+' : ''}${score}`);

    const moodMsg = {
      Happy: "Amazing! A positive mood boosts your XP multiplier.",
      Neutral: "A steady mind gets things done. You've got this!",
      Tired: "Rest is productive too. Prioritize your energy today.",
      Sad: "It's okay to have tough days. Be kind to yourself.",
      Angry: "Channel that energy into crushing your quests!"
    };
    ttsSpeak(moodMsg[selectedMood] || 'Mood saved!');
    closeMoodModal();
    selectedMood = null;
  } catch (err) {
    alert('Could not save mood: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Mood'; }
  }
}

// ============================================================
// JOURNAL
// ============================================================
async function loadJournal() {
  try {
    const data = await API.getJournal();
    journalEntries = Array.isArray(data) ? data : (data.entries || []);
    renderJournalGrid(journalEntries);
  } catch (err) {
    const g = document.getElementById('journalGrid');
    if (g) g.innerHTML = '<div class="empty-state"><i class="fas fa-book-open"></i><p>Could not load journal. Is the backend running?</p></div>';
  }
}

function renderJournalGrid(entries) {
  const grid = document.getElementById('journalGrid');
  if (!grid) return;

  if (!entries.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <i class="fas fa-feather-alt" style="font-size:3rem;color:var(--border)"></i>
        <p>No journal entries yet. Write your first reflection!</p>
        <button class="btn-primary" style="margin-top:16px;width:auto;padding:12px 24px" onclick="openJournalModal()">
          <i class="fas fa-feather-alt"></i> Write Entry
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = entries.map((e, i) => buildJournalCard(e, i)).join('');
}

function buildJournalCard(entry, i = 0) {
  const id = entry._id || entry.id;
  const date = new Date(entry.createdAt || entry.created_at);
  const preview = (entry.content || '').substring(0, 200);

  return `
    <div class="journal-card card-enter stagger-${Math.min(i+1,5)}" onclick="openJournalView('${id}')">
      <div class="journal-date">
        <i class="fas fa-calendar-alt"></i>
        ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
      <div class="journal-title">${escHtml(entry.title)}</div>
      <div class="journal-preview">${escHtml(preview)}${entry.content?.length > 200 ? '...' : ''}</div>
      <div class="journal-actions" onclick="event.stopPropagation()">
        <button class="btn-tts" onclick="readJournalEntry('${id}')" title="Read aloud">
          <i class="fas fa-volume-up"></i> Read
        </button>
        <button class="btn-sm" onclick="deleteJournalEntry('${id}', this)" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>`;
}

function openJournalView(id) {
  const entry = journalEntries.find(e => (e._id||e.id) === id);
  if (!entry) return;
  const date = new Date(entry.createdAt || entry.created_at);

  // Build a view modal
  const existing = document.getElementById('journalViewModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'journalViewModal';
  modal.innerHTML = `
    <div class="modal journal-full-modal">
      <div class="modal-header">
        <h3><i class="fas fa-book-open"></i> ${escHtml(entry.title)}</h3>
        <button class="modal-close" onclick="document.getElementById('journalViewModal').remove()">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="journal-date" style="margin-bottom:16px">
        <i class="fas fa-calendar-alt"></i>
        ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
      <div class="journal-body">${escHtml(entry.content)}</div>
      <div class="modal-actions" style="margin-top:24px">
        <button class="btn-ghost" onclick="readJournalEntry('${entry._id||entry.id}')">
          <i class="fas fa-volume-up"></i> Read Aloud
        </button>
        <button class="btn-ghost" onclick="document.getElementById('journalViewModal').remove()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// TTS read journal
function readJournalEntry(id) {
  const entry = journalEntries.find(e => (e._id||e.id) === id);
  if (!entry) return;
  ttsSpeak(`Journal entry: ${entry.title}. ${entry.content}`);
}

// Journal Modal
function openJournalModal() {
  document.getElementById('journalModal').classList.remove('hidden');
  document.getElementById('journalTitle')?.focus();
}
function closeJournalModal() {
  document.getElementById('journalModal').classList.add('hidden');
  const t = document.getElementById('journalTitle');
  const c = document.getElementById('journalContent');
  if (t) t.value = '';
  if (c) c.value = '';
}

async function saveJournalEntry() {
  const title = document.getElementById('journalTitle')?.value.trim();
  const content = document.getElementById('journalContent')?.value.trim();
  if (!title || !content) { alert('Title and content are required.'); return; }

  const btn = document.querySelector('#journalModal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

  try {
    const data = await API.createJournal({ title, content });
    const newEntry = data.entry || data;
    journalEntries.unshift(newEntry);
    renderJournalGrid(journalEntries);
    closeJournalModal();
    ttsSpeak('Journal entry saved. Your thoughts have been recorded.');
  } catch (err) {
    alert('Could not save journal: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Entry'; }
  }
}

async function deleteJournalEntry(id, btn) {
  if (!confirm('Delete this journal entry?')) return;
  if (btn) btn.disabled = true;
  try {
    await API.deleteJournal(id);
    journalEntries = journalEntries.filter(e => (e._id||e.id) !== id);
    renderJournalGrid(journalEntries);
    ttsSpeak('Journal entry deleted.');
  } catch (err) {
    alert(err.message);
    if (btn) btn.disabled = false;
  }
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const jm = document.getElementById('journalModal');
  if (jm && !jm.classList.contains('hidden')) closeJournalModal();
  const mm = document.getElementById('moodModal');
  if (mm && !mm.classList.contains('hidden')) closeMoodModal();
}); 
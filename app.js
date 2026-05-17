let tasks  = [];
let nextId = 1;
let activeFilter = 'all';

// ---------- CRUD ----------

function handleAdd() {
  const input = document.getElementById('task-input');
  const text  = input.value.trim();
  if (!text) return;

  tasks.push({
    id: nextId++,
    text,
    priority:   null,
    urgency:    null,
    category:   null,
    actionable: null,
    done:       false
  });

  input.value = '';
  saveTasks();
  render();
  prioritizeWithAI();
}

// allow pressing Enter to add
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('task-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
  loadTasks();
  render();
});

function toggleDone(id) {
  const task = tasks.find(t => t.id === id);
  if (task) task.done = !task.done;
  saveTasks();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  render();
}

function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-tab')
    .forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().startsWith(f)));
  render();
}

// ---------- RENDER ----------

function render() {
  // Metrics
  document.getElementById('total-count').textContent = tasks.length;
  document.getElementById('done-count').textContent  = tasks.filter(t => t.done).length;
  document.getElementById('high-count').textContent  = tasks.filter(t => t.urgency === 'high' && !t.done).length;

  // Filter
  let visible = [...tasks];
  if (activeFilter === 'high')    visible = visible.filter(t => t.urgency === 'high' && !t.done);
  if (activeFilter === 'pending') visible = visible.filter(t => !t.done && t.priority === null);
  if (activeFilter === 'done')    visible = visible.filter(t => t.done);

  // Sort: undone + scored first (highest priority), then unscored, then done
  visible.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (b.priority ?? -1) - (a.priority ?? -1);
  });

  const list = document.getElementById('task-list');

  if (visible.length === 0) {
    list.innerHTML = '<p class="empty-msg">No tasks here yet.</p>';
    return;
  }

  list.innerHTML = visible.map(task => {
    const badgeClass = task.urgency
      ? `badge-${task.urgency}`
      : 'badge-pending';
    const badgeText = task.urgency ?? 'scoring...';

    return `
      <div class="task-item ${task.done ? 'done' : ''}">
        <input type="checkbox" ${task.done ? 'checked' : ''}
          onchange="toggleDone(${task.id})">
        <div class="task-body">
          <p class="task-text">${task.text}</p>
          ${task.actionable
            ? `<p class="task-tip">${task.actionable}</p>`
            : ''}
        </div>
        <div class="task-meta">
          <span class="badge ${badgeClass}">${badgeText}</span>
          <span class="score">${task.priority ?? '—'}</span>
        </div>
        <button class="del-btn" onclick="deleteTask(${task.id})">✕</button>
      </div>
    `;
  }).join('');
}

// ---------- AI PRIORITIZE ----------

async function prioritizeWithAI() {
  const unscored = tasks.filter(t => t.priority === null && !t.done);
  if (unscored.length === 0) return;

  const taskList = unscored
    .map((t, i) => `${i + 1}. (id:${t.id}) ${t.text}`)
    .join('\n');

  const prompt = `
You are a productivity assistant. Analyze these tasks and return ONLY a valid JSON array.

Tasks:
${taskList}

Each item in the array must have:
- id (number, matching the id in the list)
- priority (integer 1-10, where 10 is most important/urgent)
- urgency ("low", "medium", or "high")
- category (e.g. "Work", "Personal", "Health", "Finance")
- actionable (one short sentence — the single next physical action to do)

Example output:
[{"id":1,"priority":9,"urgency":"high","category":"Work","actionable":"Open the doc and write the first paragraph."}]

Return ONLY the JSON array. No explanation, no markdown, no code fences.
`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data  = await res.json();
    const raw   = data.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const scores = JSON.parse(clean);

    scores.forEach(score => {
      const task = tasks.find(t => t.id === score.id);
      if (task) Object.assign(task, score);
    });

    saveTasks();
    render();
  } catch (err) {
    console.error('AI scoring failed:', err);
  }
}

// ---------- AI SCHEDULE ----------

async function generateSchedule() {
  const output  = document.getElementById('schedule-output');
  const pending = tasks
    .filter(t => !t.done && t.priority !== null)
    .sort((a, b) => b.priority - a.priority);

  if (pending.length === 0) {
    output.textContent = 'Add and score some tasks first!';
    return;
  }

  output.textContent = 'Building your schedule...';

  const taskList = pending
    .map(t => `- [${t.urgency}] ${t.text} (priority ${t.priority})`)
    .join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a productivity coach. Here are my tasks sorted by priority:\n\n${taskList}\n\nCreate a practical time-blocked schedule starting at 9 AM. Group similar tasks, put high-urgency items in the morning, add short breaks, use specific times (e.g. 9:00–9:45 AM), and keep it realistic for one workday.`
        }]
      })
    });

    const data = await res.json();
    output.textContent = data.content[0].text;
  } catch (err) {
    output.textContent = 'Could not generate schedule. Please try again.';
  }
}

// ---------- STORAGE ----------

function saveTasks() {
  localStorage.setItem('tasks-v1', JSON.stringify(tasks));
}

function loadTasks() {
  const saved = localStorage.getItem('tasks-v1');
  if (saved) {
    tasks  = JSON.parse(saved);
    nextId = Math.max(0, ...tasks.map(t => t.id)) + 1;
  }
}
// ============================================
// KeuringsPlanner - Applicatie
// ============================================

// ─── Constants ───
const STATUSES = ['intake', 'in_behandeling', 'klaar', 'afgeleverd'];
const STATUS_LABELS = { intake: 'Intake', in_behandeling: 'In behandeling', klaar: 'Klaar', afgeleverd: 'Afgeleverd' };
const STATUS_ICONS = { intake: '📥', in_behandeling: '🔧', klaar: '✅', afgeleverd: '📦' };
const STATUS_COLORS = { intake: '#D97706', in_behandeling: '#7C3AED', klaar: '#059669', afgeleverd: '#6B7280' };
const DAY_NAMES = ['ma', 'di', 'wo', 'do', 'vr'];
const DAY_NAMES_FULL = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'];
const WARNING_DAYS = 8;
const AFKEUR_OPTIES = [
  'Niet vervangen',
  'Kleine reparaties meteen uitvoeren',
  'Alles meteen vervangen voor vergelijkbaar product',
  'Eerst bellen',
];

// ─── State ───
let state = {
  jobs: [],
  archief: [],
  todos: [],
  settings: {
    template: { ma: 8, di: 8, wo: 8, do: 8, vr: 8 },
    setTypes: [
      { id: 'basis', label: 'Basis klimsets', minuten: 20 },
      { id: 'plus', label: 'Klimset plus', minuten: 35 },
      { id: 'hoogwerker', label: 'Hoogwerker sets', minuten: 30 },
      { id: 'industrie', label: 'Industrie-sets', minuten: 45 },
      { id: 'afvang', label: 'Afvangsets', minuten: 15 },
    ],
    ruimtes: ['Showroom', 'Kantoor', 'Magazijn', 'Website'],
    personen: ['Arda'],
    dagOverrides: {},
  },
  activeTab: 'kalender',
  weeksToShow: 4,
  archiefZoek: '',
  loading: true,
};

// ─── Date helpers ───
const toDateStr = (d) => d.toISOString().split('T')[0];
const parseDate = (s) => new Date(s + 'T00:00:00');
const todayStr = () => toDateStr(new Date());
const nowTimeStr = () => { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const dayKey = (dateStr) => DAY_NAMES[parseDate(dateStr).getDay() - 1];
const formatDateShort = (s) => { if (!s) return '—'; try { return parseDate(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }); } catch { return s; } };
const formatDateFull = (s) => { try { return parseDate(s).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { return s; } };

function workdaysBetween(fromStr, toStr) {
  let count = 0; const cur = parseDate(fromStr); const end = parseDate(toStr);
  while (cur < end) { cur.setDate(cur.getDate() + 1); if (cur.getDay() >= 1 && cur.getDay() <= 5) count++; }
  return count;
}

function getWorkdays(startMonday, weeks) {
  const days = []; const d = new Date(startMonday);
  for (let i = 0; i < weeks * 7; i++) { const cur = new Date(d); cur.setDate(d.getDate() + i); if (cur.getDay() >= 1 && cur.getDay() <= 5) days.push(toDateStr(cur)); }
  return days;
}

function getMondayOfWeek(date) {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); return toDateStr(d);
}

function capacityForDay(dateStr, template, overrides) {
  if (overrides[dateStr] !== undefined) return overrides[dateStr];
  const dk = dayKey(dateStr);
  return dk ? (template[dk] ?? 8) : 0;
}

// ─── Calendar scheduling ───
function buildCalendar(jobs, days, template, overrides) {
  const cal = {};
  days.forEach(d => { cal[d] = { date: d, capacity: capacityForDay(d, template, overrides), items: [], usedHours: 0 }; });
  const today = todayStr();
  const futureDays = days.filter(d => d >= today);
  const activeJobs = jobs.filter(j => !j.gearchiveerd && j.status !== 'afgeleverd' && j.status !== 'klaar');

  const afspraakJobs = activeJobs.filter(j => j.heeftAfspraak && j.afspraakDatum)
    .sort((a, b) => a.afspraakDatum.localeCompare(b.afspraakDatum));

  afspraakJobs.forEach(job => {
    let remaining = job.geschatteUren;
    const startFrom = job.datumBinnen && job.datumBinnen >= today ? job.datumBinnen : today;
    const deadline = job.afspraakDatum;
    for (const d of futureDays) {
      if (d < startFrom || remaining <= 0) continue;
      if (d > deadline) break;
      const entry = cal[d]; if (!entry) continue;
      const free = entry.capacity - entry.usedHours;
      if (free <= 0) continue;
      const allocate = Math.min(remaining, free);
      entry.items.push({ job, hours: allocate, type: 'afspraak' });
      entry.usedHours += allocate;
      remaining -= allocate;
    }
    if (remaining > 0) {
      const target = cal[deadline] || cal[futureDays[futureDays.length - 1]];
      if (target) { target.items.push({ job, hours: remaining, type: 'afspraak', overflow: true }); target.usedHours += remaining; }
    }
  });

  const tussendoorJobs = activeJobs.filter(j => !j.heeftAfspraak)
    .sort((a, b) => (a.datumBinnen || '').localeCompare(b.datumBinnen || ''));
  const jobQueue = [...tussendoorJobs];
  const scheduled = {};

  for (const d of futureDays) {
    if (jobQueue.length === 0) break;
    const entry = cal[d]; if (!entry) continue;
    let free = entry.capacity - entry.usedHours;
    let qi = 0;
    while (free > 0 && qi < jobQueue.length) {
      const job = jobQueue[qi];
      const alreadyDone = scheduled[job.id] || 0;
      const remaining = job.geschatteUren - alreadyDone;
      if (remaining <= 0) { jobQueue.splice(qi, 1); continue; }
      const allocate = Math.min(remaining, free);
      entry.items.push({ job, hours: allocate, type: 'tussendoor' });
      entry.usedHours += allocate;
      free -= allocate;
      scheduled[job.id] = alreadyDone + allocate;
      if (allocate >= remaining) { jobQueue.splice(qi, 1); } else { break; }
    }
  }
  return cal;
}

// ─── Toast notifications ───
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

// ─── Modal helpers ───
function openModal(content) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-content">${content}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return overlay;
}

function closeModal() {
  const m = document.querySelector('.modal-overlay');
  if (m) { m.classList.remove('show'); setTimeout(() => m.remove(), 200); }
}

// ─── RENDER: Stats Bar ───
function renderStatsBar() {
  const active = state.jobs.filter(j => j.status !== 'afgeleverd' && j.status !== 'klaar');
  const met = active.filter(j => j.heeftAfspraak).length;
  const zonder = active.filter(j => !j.heeftAfspraak).length;
  const uren = active.reduce((s, j) => s + (j.geschatteUren || 0), 0);
  const warn = active.filter(j => !j.heeftAfspraak && workdaysBetween(j.datumBinnen || todayStr(), todayStr()) >= WARNING_DAYS).length;

  return `<div class="stats-bar">
    <div class="stat-card"><div class="stat-val accent">${met}</div><div class="stat-label">Met afleverdatum</div></div>
    <div class="stat-card"><div class="stat-val muted">${zonder}</div><div class="stat-label">Wachtlijst</div></div>
    <div class="stat-card"><div class="stat-val">${uren}u</div><div class="stat-label">Totaal uren</div></div>
    <div class="stat-card ${warn > 0 ? 'stat-warn' : ''}"><div class="stat-val ${warn > 0 ? 'danger' : ''}">${warn}</div><div class="stat-label">⚠ >${WARNING_DAYS} dagen</div></div>
  </div>`;
}

// ─── RENDER: Calendar ───
function renderCalendar() {
  const startMonday = getMondayOfWeek(todayStr());
  const allDays = getWorkdays(startMonday, state.weeksToShow);
  const calendar = buildCalendar(state.jobs, allDays, state.settings.template, state.settings.dagOverrides);
  const today = todayStr();

  const weeks = [];
  for (let i = 0; i < allDays.length; i += 5) weeks.push(allDays.slice(i, i + 5));

  let html = `<div class="cal-legend">
    <span class="legend-item"><span class="legend-dot accent-bg"></span> Met afleverdatum</span>
    <span class="legend-item"><span class="legend-dot muted-bg"></span> Wachtlijst</span>
    <span class="legend-item"><span class="legend-dot free-bg"></span> Vrij</span>
    <span class="legend-sep">|</span>
    <span class="legend-hint">Klik op dag = capaciteit aanpassen</span>
  </div>`;

  html += `<div class="cal-header">${DAY_NAMES_FULL.map(n => `<div class="cal-header-day">${n}</div>`).join('')}</div>`;

  weeks.forEach((week, wi) => {
    html += `<div class="cal-week">`;
    week.forEach(dateStr => {
      const entry = calendar[dateStr];
      if (!entry) { html += `<div class="cal-day empty"></div>`; return; }
      const isToday = dateStr === today;
      const isPast = dateStr < today;
      const isOvr = state.settings.dagOverrides[dateStr] !== undefined;
      const isOver = entry.usedHours > entry.capacity;
      const freeH = Math.max(0, entry.capacity - entry.usedHours);
      const date = parseDate(dateStr);
      const aItems = entry.items.filter(it => it.type === 'afspraak');
      const tItems = entry.items.filter(it => it.type === 'tussendoor');
      const aPercent = entry.capacity > 0 ? Math.min((aItems.reduce((s,i)=>s+i.hours,0) / entry.capacity) * 100, 100) : 0;
      const tPercent = entry.capacity > 0 ? Math.min((tItems.reduce((s,i)=>s+i.hours,0) / entry.capacity) * 100, 100 - aPercent) : 0;

      html += `<div class="cal-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${isOvr ? 'override' : ''}"
        ${!isPast ? `onclick="openDayOverride('${dateStr}')"` : ''}>
        <div class="cal-day-header">
          <div class="cal-day-num">
            <span class="day-number">${date.getDate()}</span>
            ${(date.getDate() <= 7 || wi === 0) ? `<span class="day-month">${date.toLocaleDateString('nl-NL', { month: 'short' })}</span>` : ''}
          </div>
          <div class="cal-day-badges">
            ${isToday ? '<span class="badge badge-today">NU</span>' : ''}
            ${isOvr ? '<span class="badge badge-override">✎</span>' : ''}
          </div>
        </div>
        <div class="capacity-bar"><div class="cap-afspraak" style="width:${aPercent}%"></div><div class="cap-tussendoor" style="width:${tPercent}%"></div></div>
        <div class="cal-day-info ${isOver ? 'danger' : ''}">
          <span>${Math.round(entry.usedHours * 100) / 100}/${entry.capacity}u</span>
          ${freeH > 0 && !isOver ? `<span class="free">${Math.round(freeH * 100) / 100}u vrij</span>` : ''}
          ${isOver ? '<span class="over">OVER</span>' : ''}
        </div>
        <div class="cal-day-items">
          ${aItems.map(it => renderCalPill(it)).join('')}
          ${aItems.length > 0 && tItems.length > 0 ? '<div class="pill-divider"></div>' : ''}
          ${tItems.map(it => renderCalPill(it)).join('')}
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

function renderCalPill(item) {
  const { job, hours, type, overflow } = item;
  const daysOpen = workdaysBetween(job.datumBinnen || todayStr(), todayStr());
  const isWarning = type === 'tussendoor' && daysOpen >= WARNING_DAYS;
  const cls = overflow ? 'pill-overflow' : type === 'afspraak' ? 'pill-afspraak' : isWarning ? 'pill-warning' : 'pill-tussendoor';
  return `<div class="cal-pill ${cls}" onclick="event.stopPropagation(); openJobModal(${job.id})">
    <span class="pill-name">${(isWarning || overflow) ? '⚠ ' : ''}${escHtml(job.klant)}</span>
    <span class="pill-hours">${Math.round(hours * 100) / 100}u</span>
  </div>`;
}

// ─── RENDER: Kanban ───
function renderKanban() {
  let html = '<div class="kanban-board">';
  STATUSES.forEach((status, si) => {
    const col = state.jobs.filter(j => j.status === status).sort((a, b) => {
      if (a.heeftAfspraak !== b.heeftAfspraak) return a.heeftAfspraak ? -1 : 1;
      if (a.heeftAfspraak) return (a.afspraakDatum || '').localeCompare(b.afspraakDatum || '');
      return (a.datumBinnen || '').localeCompare(b.datumBinnen || '');
    });
    html += `<div class="kanban-col" style="--col-color: ${STATUS_COLORS[status]}">
      <div class="kanban-col-header">
        <span>${STATUS_ICONS[status]} ${STATUS_LABELS[status]}</span>
        <span class="kanban-count">${col.length}</span>
      </div>`;

    col.forEach(job => {
      const daysOpen = workdaysBetween(job.datumBinnen || todayStr(), todayStr());
      const isW = !job.heeftAfspraak && daysOpen >= WARNING_DAYS;
      html += `<div class="kanban-card ${job.heeftAfspraak ? 'border-accent' : isW ? 'border-danger' : 'border-muted'}" onclick="openJobModal(${job.id})">
        <div class="kanban-card-top">
          <div class="kanban-card-info">
            <div class="kanban-card-name">${isW ? '⚠ ' : ''}${escHtml(job.klant)}</div>
            <div class="kanban-card-desc">${escHtml(job.omschrijving)}</div>
          </div>
          <span class="kanban-badge ${job.heeftAfspraak ? 'badge-afspraak' : 'badge-tussendoor'}">
            ${job.heeftAfspraak ? `📅 Aflevering ${formatDateShort(job.afspraakDatum)}` : 'Wachtlijst'}
          </span>
        </div>
        <div class="kanban-card-meta">
          <span>⏱ ${job.geschatteUren}u</span>
          ${isW ? `<span class="danger">⚠ ${daysOpen}d</span>` : ''}
          ${(job.contactLog || []).length > 0 ? `<span>📞${job.contactLog.length}</span>` : ''}
        </div>
        <div class="kanban-card-actions" onclick="event.stopPropagation()">
          ${si > 0 ? `<button class="btn-sm" onclick="changeJobStatus(${job.id},'${STATUSES[si - 1]}')">← ${STATUS_LABELS[STATUSES[si - 1]]}</button>` : ''}
          ${si < 3 ? `<button class="btn-sm btn-status" style="--btn-color:${STATUS_COLORS[STATUSES[si + 1]]}" onclick="changeJobStatus(${job.id},'${STATUSES[si + 1]}')">${STATUS_LABELS[STATUSES[si + 1]]} →</button>` : ''}
          ${status === 'afgeleverd' ? `<button class="btn-sm btn-archive" onclick="doArchiveerKlus(${job.id})">📁 Archiveer</button>` : ''}
          <button class="btn-sm btn-delete" onclick="doDeleteJob(${job.id})">🗑</button>
        </div>
      </div>`;
    });
    if (col.length === 0) html += '<div class="kanban-empty">Geen klussen</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ─── RENDER: Todo ───
function renderTodo() {
  const filterR = document.getElementById('todo-filter-room')?.value || 'alle';
  const filterP = document.getElementById('todo-filter-person')?.value || 'alle';
  const filtered = state.todos.filter(t =>
    (filterR === 'alle' || t.ruimte === filterR) &&
    (filterP === 'alle' || t.persoon === filterP)
  );
  const priColors = { hoog: 'var(--danger)', normaal: 'var(--warning)', laag: 'var(--muted)' };
  const open = filtered.filter(t => !t.klaar);
  const done = filtered.filter(t => t.klaar);

  let html = `<div class="todo-filters">
    <div class="filter-group">
      <span class="filter-label">Ruimte:</span>
      <select id="todo-filter-room" onchange="render()" class="input-sm">
        <option value="alle">Alle</option>
        ${state.settings.ruimtes.map(r => `<option value="${escHtml(r)}" ${filterR === r ? 'selected' : ''}>${escHtml(r)}</option>`).join('')}
      </select>
    </div>
    <div class="filter-group">
      <span class="filter-label">Persoon:</span>
      <select id="todo-filter-person" onchange="render()" class="input-sm">
        <option value="alle">Alle</option>
        ${state.settings.personen.map(p => `<option value="${escHtml(p)}" ${filterP === p ? 'selected' : ''}>${escHtml(p)}</option>`).join('')}
      </select>
    </div>
    <button class="btn-primary btn-yellow" onclick="openTodoModal()">+ Nieuw</button>
  </div>`;

  open.forEach(todo => {
    html += `<div class="todo-item" style="--pri-color: ${priColors[todo.prioriteit] || priColors.normaal}">
      <button class="todo-check" onclick="event.stopPropagation(); toggleTodo(${todo.id}, true)"></button>
      <div class="todo-info" onclick="openEditTodoModal(${todo.id})" style="cursor:pointer">
        <div class="todo-text">${escHtml(todo.tekst)}</div>
        <div class="todo-meta">
          ${todo.ruimte ? `<span>📍${escHtml(todo.ruimte)}</span>` : ''}
          ${todo.persoon ? `<span>👤${escHtml(todo.persoon)}</span>` : ''}
          <span>${formatDateShort(todo.datum)}</span>
        </div>
      </div>
      <button class="btn-icon" onclick="event.stopPropagation(); doDeleteTodo(${todo.id})">✕</button>
    </div>`;
  });

  if (done.length > 0) {
    html += '<div class="todo-done-header">✅ Afgerond</div>';
    done.forEach(todo => {
      html += `<div class="todo-item done">
        <button class="todo-check checked" onclick="toggleTodo(${todo.id}, false)">✓</button>
        <span class="todo-text strike">${escHtml(todo.tekst)}</span>
        <button class="btn-icon" onclick="doDeleteTodo(${todo.id})">✕</button>
      </div>`;
    });
  }
  if (filtered.length === 0) html += '<div class="empty-state">Geen taken' + (filterR !== 'alle' || filterP !== 'alle' ? ' met deze filters' : '') + '</div>';
  return html;
}

// ─── RENDER: Archief ───
function renderArchief() {
  const z = state.archiefZoek.toLowerCase();
  const results = state.archief.filter(k =>
    !z || k.klant.toLowerCase().includes(z) || (k.klantNummer || '').toLowerCase().includes(z) || k.omschrijving.toLowerCase().includes(z)
  );

  let html = `<div class="archief-search">
    <input type="text" class="input" placeholder="Zoek op klantnaam, nummer of omschrijving..."
      value="${escHtml(state.archiefZoek)}" oninput="state.archiefZoek = this.value; render();" />
    <span class="archief-count">${results.length} klus${results.length !== 1 ? 'sen' : ''} in archief</span>
  </div>`;

  if (results.length === 0) {
    html += '<div class="empty-state">Geen gearchiveerde klussen' + (z ? ' gevonden' : '') + '</div>';
  } else {
    results.forEach(job => {
      html += `<div class="archief-card" onclick="openJobModal(${job.id}, true)">
        <div class="archief-card-left">
          <div class="archief-card-name">${escHtml(job.klant)}</div>
          <div class="archief-card-desc">${escHtml(job.omschrijving)}</div>
          <div class="archief-card-meta">
            ${job.klantNummer ? `<span>📋 ${escHtml(job.klantNummer)}</span>` : ''}
            <span>📅 Binnen: ${formatDateShort(job.datumBinnen)}</span>
            <span>⏱ ${job.geschatteUren}u</span>
            ${job.heeftAfspraak ? `<span class="accent">📅 Afspraak: ${formatDateShort(job.afspraakDatum)}</span>` : '<span>Tussendoor</span>'}
            ${(job.contactLog || []).length > 0 ? `<span>📞 ${job.contactLog.length}x contact</span>` : ''}
          </div>
        </div>
        <div class="archief-card-right">
          <button class="btn-sm" onclick="event.stopPropagation(); doDeArchiveer(${job.id})">📤 Terugzetten</button>
        </div>
      </div>`;
    });
  }
  return html;
}

// ─── RENDER: Main ───
function render() {
  const app = document.getElementById('app');
  if (state.loading) { app.innerHTML = '<div class="loading"><div class="spinner"></div><p>KeuringsPlanner laden...</p></div>'; return; }

  const showStats = state.activeTab === 'kalender' || state.activeTab === 'kanban';

  let tabContent = '';
  switch (state.activeTab) {
    case 'kalender': tabContent = renderCalendar(); break;
    case 'kanban': tabContent = renderKanban(); break;
    case 'todo': tabContent = renderTodo(); break;
    case 'archief': tabContent = renderArchief(); break;
  }

  app.innerHTML = `
    <header class="header">
      <div class="header-inner">
        <div class="header-left">
          <h1 class="logo">⚙️ KeuringsPlanner</h1>
          <p class="subtitle">Intake · Planning · Capaciteit · To-do</p>
        </div>
        <div class="header-right">
          <button class="btn-header" onclick="openSettingsModal()">⚙️ Instellingen</button>
          <button class="btn-primary" onclick="openJobModal(null)">+ Nieuwe klus</button>
        </div>
      </div>
    </header>
    <main class="main">
      ${showStats ? renderStatsBar() : ''}
      <div class="tab-bar-row">
        <div class="tab-bar">
          ${['kalender', 'kanban', 'todo', 'archief'].map(tab =>
            `<button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" onclick="switchTab('${tab}')">
              ${{ kalender: '📅 Kalender', kanban: '📋 Kanban', todo: '✅ To-do', archief: '📁 Archief' }[tab]}
            </button>`
          ).join('')}
        </div>
        ${state.activeTab === 'kalender' ? `<div class="week-picker">
          <span class="filter-label">Weken:</span>
          ${[3, 4, 6, 8, 12].map(w => `<button class="week-btn ${state.weeksToShow === w ? 'active' : ''}" onclick="state.weeksToShow=${w}; render();">${w}</button>`).join('')}
        </div>` : ''}
      </div>
      <div class="tab-content">${tabContent}</div>
    </main>`;
}

// ─── Actions ───
function switchTab(tab) { state.activeTab = tab; render(); }

async function changeJobStatus(id, newStatus) {
  const job = state.jobs.find(j => j.id === id);
  if (!job) return;
  job.status = newStatus;
  render();
  const saved = await saveKlus(job);
  if (saved) showToast(`${job.klant} → ${STATUS_LABELS[newStatus]}`);
}

async function doDeleteJob(id) {
  if (!confirm('Weet je zeker dat je deze klus wilt verwijderen?')) return;
  const ok = await deleteKlus(id);
  if (ok) { state.jobs = state.jobs.filter(j => j.id !== id); render(); showToast('Klus verwijderd'); }
}

async function doArchiveerKlus(id) {
  const ok = await archiveerKlus(id);
  if (ok) {
    const job = state.jobs.find(j => j.id === id);
    if (job) { job.gearchiveerd = true; state.jobs = state.jobs.filter(j => j.id !== id); state.archief.unshift(job); }
    render(); showToast('Klus gearchiveerd 📁');
  }
}

async function doDeArchiveer(id) {
  const ok = await deArchiveerKlus(id);
  if (ok) {
    const job = state.archief.find(j => j.id === id);
    if (job) { job.gearchiveerd = false; job.status = 'intake'; state.archief = state.archief.filter(j => j.id !== id); state.jobs.push(job); }
    render(); showToast('Klus teruggezet naar Intake');
  }
}

async function toggleTodo(id, klaar) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;
  todo.klaar = klaar;
  render();
  await saveTodo(todo);
}

async function doDeleteTodo(id) {
  const ok = await deleteTodo(id);
  if (ok) { state.todos = state.todos.filter(t => t.id !== id); render(); }
}

// ─── Day Override Modal ───
function openDayOverride(dateStr) {
  const cap = capacityForDay(dateStr, state.settings.template, state.settings.dagOverrides);
  const isOvr = state.settings.dagOverrides[dateStr] !== undefined;
  const html = `
    <div class="modal-header">
      <h2>${formatDateFull(dateStr)}</h2>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="field-row center">
        <span class="filter-label">Capaciteit:</span>
        <button class="btn-step" onclick="adjustDayCap(-0.5)">−</button>
        <input type="number" id="day-cap-input" step="0.5" value="${cap}" class="input-num" />
        <button class="btn-step" onclick="adjustDayCap(0.5)">+</button>
        <span class="unit">uur</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" onclick="saveDayOverride('${dateStr}')">✓ Opslaan</button>
      ${isOvr ? `<button class="btn-sm" onclick="resetDayOverride('${dateStr}')">Reset naar sjabloon</button>` : ''}
    </div>`;
  openModal(html);
}

function adjustDayCap(delta) {
  const inp = document.getElementById('day-cap-input');
  if (inp) { let v = parseFloat(inp.value) + delta; v = Math.max(0, Math.min(24, v)); inp.value = v; }
}

async function saveDayOverride(dateStr) {
  const val = parseFloat(document.getElementById('day-cap-input')?.value);
  if (isNaN(val)) return;
  state.settings.dagOverrides[dateStr] = val;
  await saveInstellingen(state.settings);
  closeModal(); render(); showToast('Capaciteit aangepast');
}

async function resetDayOverride(dateStr) {
  delete state.settings.dagOverrides[dateStr];
  await saveInstellingen(state.settings);
  closeModal(); render(); showToast('Teruggezet naar sjabloon');
}

// ─── Job Modal ───
function openJobModal(id, isArchief = false) {
  const isNew = id === null;
  const job = isNew ? null : (isArchief ? state.archief : state.jobs).find(j => j.id === id);
  const emptyAantallen = {};
  state.settings.setTypes.forEach(st => { emptyAantallen[st.id] = 0; });

  const form = job ? { ...job, aantallen: { ...emptyAantallen, ...(job.aantallen || {}) }, contactLog: [...(job.contactLog || [])] }
    : { klant: '', klantNummer: '', telefoon: '', omschrijving: '', aantallen: { ...emptyAantallen },
        heeftAfspraak: false, status: 'intake', geschatteUren: 0, afspraakDatum: '', afspraakTijd: '',
        binnenkomstWijze: '', binnenkomstDatum: '', binnenkomstTijd: '', retourWijze: '', retourDatum: '', retourTijd: '',
        afkeurBeleid: '', afkeurToelichting: '', contactLog: [], notities: '' };

  // Store form in a global for modal interactions
  window._modalForm = form;
  window._modalIsNew = isNew;
  window._modalIsArchief = isArchief;
  window._modalJobId = id;

  renderJobModalContent();
}

function syncFormToModal() {
  const form = window._modalForm;
  if (!form) return;
  const el = (id) => document.getElementById(id);
  if (el('jf-klant')) form.klant = el('jf-klant').value;
  if (el('jf-klantnr')) form.klantNummer = el('jf-klantnr').value;
  if (el('jf-tel')) form.telefoon = el('jf-tel').value;
  if (el('jf-omschr')) form.omschrijving = el('jf-omschr').value;
  if (el('jf-uren')) form.geschatteUren = parseFloat(el('jf-uren').value) || 0;
  if (el('jf-binn-wijze')) form.binnenkomstWijze = el('jf-binn-wijze').value;
  if (el('jf-binn-datum')) form.binnenkomstDatum = el('jf-binn-datum').value;
  if (el('jf-binn-tijd')) form.binnenkomstTijd = el('jf-binn-tijd').value;
  if (el('jf-ret-wijze')) form.retourWijze = el('jf-ret-wijze').value;
  if (el('jf-ret-datum')) form.retourDatum = el('jf-ret-datum').value;
  if (el('jf-ret-tijd')) form.retourTijd = el('jf-ret-tijd').value;
  if (el('jf-afkeur-toel')) form.afkeurToelichting = el('jf-afkeur-toel').value;
  if (el('jf-status')) form.status = el('jf-status').value;
  if (el('jf-notities')) form.notities = el('jf-notities').value;
  // Derive afspraak from retourDatum
  form.heeftAfspraak = !!(form.retourDatum);
  form.afspraakDatum = form.retourDatum || '';
  form.afspraakTijd = form.retourTijd || '';
  document.querySelectorAll('.set-type-input').forEach(inp => {
    form.aantallen[inp.dataset.typeId] = parseInt(inp.value) || 0;
  });
}

function renderJobModalContent() {
  // Save current form values before re-rendering
  syncFormToModal();

  const form = window._modalForm;
  const isNew = window._modalIsNew;
  const isArchief = window._modalIsArchief;

  const totalItems = Object.values(form.aantallen).reduce((s, v) => s + (v || 0), 0);

  const html = `
    <div class="modal-header">
      <h2>${isNew ? '📥 Nieuwe klus' : '✏️ Klus bewerken'}</h2>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body job-form">
      <div class="form-section">
        <div class="section-title">👤 Klantgegevens</div>
        <div class="form-grid-2-1">
          <div class="field"><label>Klantnaam *</label><input class="input" id="jf-klant" value="${escHtml(form.klant)}" placeholder="Van Dijk BV" /></div>
          <div class="field"><label>Klantnummer</label><input class="input" id="jf-klantnr" value="${escHtml(form.klantNummer)}" placeholder="K-1042" /></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label>Telefoon</label><input class="input" id="jf-tel" value="${escHtml(form.telefoon)}" placeholder="06-12345678" /></div>
          <div class="field"><label>Omschrijving</label><input class="input" id="jf-omschr" value="${escHtml(form.omschrijving)}" placeholder="Korte omschrijving" /></div>
        </div>
      </div>

      <div class="form-section">
        <div class="section-title">📦 Aantallen per type</div>
        <div class="set-types-grid">
          ${state.settings.setTypes.map(st => `
            <div class="set-type-row">
              <span class="set-type-label">${escHtml(st.label)}</span>
              <input type="number" min="0" class="input-num set-type-input" data-type-id="${st.id}" value="${form.aantallen[st.id] || 0}"
                onchange="updateJobAantallen()" placeholder="0" />
            </div>
          `).join('')}
        </div>
        <div class="set-types-total">
          <span>Totaal: <strong>${totalItems} items</strong></span>
          <div class="field-row">
            <span>Uren:</span>
            <input type="number" step="0.5" class="input-num" id="jf-uren" value="${form.geschatteUren}" onchange="window._modalForm.geschatteUren = parseFloat(this.value) || 0" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="section-title">🚫 Bij afkeur</div>
        <div class="afkeur-options">
          ${AFKEUR_OPTIES.map(opt => `
            <label class="radio-option ${form.afkeurBeleid === opt ? 'selected' : ''}">
              <input type="radio" name="afkeur" value="${escHtml(opt)}" ${form.afkeurBeleid === opt ? 'checked' : ''}
                onchange="window._modalForm.afkeurBeleid = this.value; renderJobModalContent();" />
              <span>${escHtml(opt)}</span>
            </label>
          `).join('')}
        </div>
        <input class="input" id="jf-afkeur-toel" value="${escHtml(form.afkeurToelichting)}" placeholder="Aanvullende afspraken bij afkeur..." />
      </div>

      <div class="form-section">
        <div class="section-title">🔄 Binnenkomst & Aflevering</div>
        <div class="form-grid-2">
          <div>
            <div class="sub-label">BINNENKOMST</div>
            <input class="input mb-4" id="jf-binn-wijze" value="${escHtml(form.binnenkomstWijze)}" placeholder="Klant brengt, post, wij halen..." />
            <div class="form-grid-2">
              <input type="date" class="input" id="jf-binn-datum" value="${form.binnenkomstDatum}" />
              <input type="time" class="input" id="jf-binn-tijd" value="${form.binnenkomstTijd}" />
            </div>
          </div>
          <div>
            <div class="sub-label">AFLEVERING KLANT</div>
            <input class="input mb-4" id="jf-ret-wijze" value="${escHtml(form.retourWijze)}" placeholder="Klant haalt op, post, wij brengen..." />
            <div class="form-grid-2">
              <input type="date" class="input" id="jf-ret-datum" value="${form.retourDatum}" />
              <input type="time" class="input" id="jf-ret-tijd" value="${form.retourTijd}" />
            </div>
            <div class="deadline-hint">${form.retourDatum ? '📅 Afleverdatum ingevuld → wordt ingepland met voorrang' : '💡 Vul een datum in als er een afspraak is — dan krijgt deze klus voorrang'}</div>
          </div>
        </div>
      </div>

      ${!isNew ? `
        <div class="form-section">
          <div class="field"><label>Status</label>
            <select class="input" id="jf-status">${STATUSES.map(s => `<option value="${s}" ${form.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>
          </div>
        </div>

        <div class="form-section">
          <div class="section-title-row">
            <span class="section-title">📞 Klantcontact</span>
            <button class="btn-sm btn-accent" onclick="addContactEntry()">+ Moment toevoegen</button>
          </div>
          <div id="contact-add-area"></div>
          <div id="contact-log-list">
            ${(form.contactLog || []).slice().reverse().map((entry, i) => `
              <div class="contact-entry">
                <span class="contact-date">${formatDateShort(entry.datum)} ${entry.tijd || ''}</span>
                <span class="contact-text">${escHtml(entry.tekst)}</span>
                <button class="btn-icon" onclick="removeContactEntry(${form.contactLog.length - 1 - i})">✕</button>
              </div>
            `).join('')}
            ${(form.contactLog || []).length === 0 ? '<div class="empty-hint">Nog geen contactmomenten</div>' : ''}
          </div>
        </div>

        <div class="form-section">
          <div class="section-title">📷 Foto\'s</div>
          <div class="foto-upload-row">
            <input type="file" id="foto-upload-input" accept="image/*" multiple onchange="handleFotoUpload()" style="display:none" />
            <button class="btn-sm btn-accent" onclick="document.getElementById('foto-upload-input').click()">📷 Foto toevoegen</button>
            <span class="foto-hint">${form.id ? '' : 'Foto\'s uploaden kan na het opslaan'}</span>
          </div>
          <div id="foto-gallery"></div>
        </div>
      ` : ''}

      <div class="form-section">
        <div class="field"><label>Notities</label>
          <textarea class="input textarea" id="jf-notities" placeholder="Extra info, afwijkingen...">${escHtml(form.notities)}</textarea>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" onclick="submitJobForm()">${isNew ? '✓ Registreren' : '✓ Opslaan'}</button>
      ${!isNew ? `<button class="btn-sm btn-delete" onclick="doDeleteJob(${form.id}); closeModal();">🗑 Verwijderen</button>` : ''}
    </div>`;

  const existing = document.querySelector('.modal-overlay');
  if (existing) {
    existing.querySelector('.modal-content').innerHTML = html;
  } else {
    openModal(html);
  }

  // Load fotos if editing existing job
  if (!window._modalIsNew && form.id) loadFotos(form.id);
}

function updateJobAantallen() {
  const form = window._modalForm;
  document.querySelectorAll('.set-type-input').forEach(inp => {
    form.aantallen[inp.dataset.typeId] = parseInt(inp.value) || 0;
  });
  let totalMin = 0;
  state.settings.setTypes.forEach(st => { totalMin += (form.aantallen[st.id] || 0) * st.minuten; });
  form.geschatteUren = Math.round((totalMin / 60) * 10) / 10;
  const urenInp = document.getElementById('jf-uren');
  if (urenInp) urenInp.value = form.geschatteUren;
  const totalItems = Object.values(form.aantallen).reduce((s, v) => s + (v || 0), 0);
  const totalEl = document.querySelector('.set-types-total strong');
  if (totalEl) totalEl.textContent = totalItems + ' items';
}

function addContactEntry() {
  const area = document.getElementById('contact-add-area');
  if (!area) return;
  area.innerHTML = `
    <div class="contact-add-form">
      <div class="form-grid-2">
        <input type="date" class="input" id="cl-datum" value="${todayStr()}" />
        <input type="time" class="input" id="cl-tijd" value="${nowTimeStr()}" />
      </div>
      <input class="input" id="cl-tekst" placeholder="Bijv. voicemail ingesproken, klant gesproken — haalt vrijdag op..." />
      <div class="field-row">
        <button class="btn-primary btn-sm" onclick="saveContactEntry()">✓ Opslaan</button>
        <button class="btn-sm" onclick="document.getElementById('contact-add-area').innerHTML=''">Annuleren</button>
      </div>
    </div>`;
  document.getElementById('cl-tekst')?.focus();
}

function saveContactEntry() {
  const tekst = document.getElementById('cl-tekst')?.value?.trim();
  if (!tekst) return;
  const entry = { id: Date.now(), datum: document.getElementById('cl-datum')?.value || todayStr(), tijd: document.getElementById('cl-tijd')?.value || nowTimeStr(), tekst };
  window._modalForm.contactLog.push(entry);
  renderJobModalContent();
}

function removeContactEntry(idx) {
  window._modalForm.contactLog.splice(idx, 1);
  renderJobModalContent();
}

async function loadFotos(klusId) {
  const gallery = document.getElementById('foto-gallery');
  if (!gallery) return;
  const fotos = await fetchFotos(klusId);
  if (fotos.length === 0) { gallery.innerHTML = '<div class="empty-hint">Nog geen foto\'s</div>'; return; }
  gallery.innerHTML = fotos.map(f => `
    <div class="foto-thumb">
      <img src="${f.url}" alt="${escHtml(f.bestandsnaam)}" onclick="window.open('${f.url}', '_blank')" />
      <button class="foto-delete" onclick="doDeleteFoto(${f.id}, '${escHtml(f.storage_path)}', ${klusId})">✕</button>
    </div>
  `).join('');
}

async function handleFotoUpload() {
  const input = document.getElementById('foto-upload-input');
  const klusId = window._modalForm?.id;
  if (!input?.files?.length || !klusId) return;
  for (const file of input.files) {
    showToast('Foto uploaden...');
    await uploadFoto(klusId, file);
  }
  input.value = '';
  loadFotos(klusId);
  showToast('Foto\'s geüpload! 📷');
}

async function doDeleteFoto(fotoId, storagePath, klusId) {
  const ok = await deleteFoto({ id: fotoId, storage_path: storagePath });
  if (ok) loadFotos(klusId);
}

function collectFormData() {
  syncFormToModal();
  const form = window._modalForm;
  return {
    ...form,
    klant: form.klant,
    klantNummer: form.klantNummer,
    telefoon: form.telefoon,
    omschrijving: form.omschrijving,
    geschatteUren: form.geschatteUren || 1,
    heeftAfspraak: !!(form.retourDatum),
    afspraakDatum: form.retourDatum || '',
    afspraakTijd: form.retourTijd || '',
    binnenkomstWijze: form.binnenkomstWijze || '',
    binnenkomstDatum: form.binnenkomstDatum || '',
    binnenkomstTijd: form.binnenkomstTijd || '',
    retourWijze: form.retourWijze || '',
    retourDatum: form.retourDatum || '',
    retourTijd: form.retourTijd || '',
    afkeurBeleid: form.afkeurBeleid || '',
    afkeurToelichting: form.afkeurToelichting || '',
    contactLog: form.contactLog || [],
    status: form.status || 'intake',
    notities: form.notities || '',
    datumBinnen: form.binnenkomstDatum || form.datumBinnen || todayStr(),
  };
}

async function submitJobForm() {
  const data = collectFormData();
  if (!data.klant.trim()) { showToast('Klantnaam is verplicht!', 'error'); return; }
  const saved = await saveKlus(data);
  if (saved) {
    if (window._modalIsNew) {
      state.jobs.push(saved);
    } else if (window._modalIsArchief) {
      state.archief = state.archief.map(j => j.id === saved.id ? saved : j);
    } else {
      state.jobs = state.jobs.map(j => j.id === saved.id ? saved : j);
    }
    closeModal(); render();
    showToast(window._modalIsNew ? 'Klus geregistreerd! ✓' : 'Klus opgeslagen ✓');
  }
}

// ─── Todo Modal ───
function openTodoModal(existingTodo = null) {
  const isEdit = !!existingTodo;
  const html = `
    <div class="modal-header">
      <h2>${isEdit ? '✏️ Taak bewerken' : '✅ Nieuwe taak'}</h2>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="field"><label>Wat moet er gebeuren? *</label><input class="input" id="td-tekst" value="${escHtml(existingTodo?.tekst || '')}" placeholder="Bijv. stelling nummeren in magazijn" /></div>
      <div class="form-grid-3" style="margin-top:10px">
        <div class="field"><label>Ruimte</label>
          <select class="input" id="td-ruimte">
            ${state.settings.ruimtes.map(r => `<option value="${escHtml(r)}" ${existingTodo?.ruimte === r ? 'selected' : ''}>${escHtml(r)}</option>`).join('')}
          </select>
          <div class="inline-add">
            <input class="input input-sm" id="td-new-room" placeholder="Nieuwe ruimte..." />
            <button class="btn-step" onclick="addTodoRoom()">+</button>
          </div>
        </div>
        <div class="field"><label>Voor wie</label>
          <input class="input" id="td-persoon" value="${escHtml(existingTodo?.persoon || '')}" placeholder="Naam (of meerdere, komma-gescheiden)" list="td-personen-dl" />
          <datalist id="td-personen-dl">${state.settings.personen.map(p => `<option value="${escHtml(p)}">`).join('')}</datalist>
          <div class="inline-add">
            <input class="input input-sm" id="td-new-person" placeholder="Nieuwe persoon..." />
            <button class="btn-step" onclick="addTodoPerson()">+</button>
          </div>
        </div>
        <div class="field"><label>Prioriteit</label>
          <select class="input" id="td-prio">
            <option value="hoog" ${existingTodo?.prioriteit === 'hoog' ? 'selected' : ''}>🔴 Hoog</option>
            <option value="normaal" ${!existingTodo || existingTodo?.prioriteit === 'normaal' ? 'selected' : ''}>🟡 Normaal</option>
            <option value="laag" ${existingTodo?.prioriteit === 'laag' ? 'selected' : ''}>⚪ Laag</option>
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" onclick="submitTodo(${isEdit ? existingTodo.id : 'null'})">${isEdit ? '✓ Opslaan' : '✓ Toevoegen'}</button>
      ${isEdit ? `<button class="btn-sm btn-delete" onclick="doDeleteTodo(${existingTodo.id}); closeModal();">🗑 Verwijderen</button>` : ''}
    </div>`;
  openModal(html);
  setTimeout(() => document.getElementById('td-tekst')?.focus(), 100);
}

function openEditTodoModal(id) {
  const todo = state.todos.find(t => t.id === id);
  if (!todo) return;
  openTodoModal(todo);
}

async function addTodoRoom() {
  const inp = document.getElementById('td-new-room');
  if (!inp?.value.trim()) return;
  const room = inp.value.trim();
  if (!state.settings.ruimtes.includes(room)) {
    state.settings.ruimtes.push(room);
    await saveInstellingen(state.settings);
  }
  const sel = document.getElementById('td-ruimte');
  if (sel) { const opt = document.createElement('option'); opt.value = room; opt.text = room; opt.selected = true; sel.add(opt); }
  inp.value = '';
}

async function addTodoPerson() {
  const inp = document.getElementById('td-new-person');
  if (!inp?.value.trim()) return;
  const person = inp.value.trim();
  if (!state.settings.personen.includes(person)) {
    state.settings.personen.push(person);
    await saveInstellingen(state.settings);
  }
  inp.value = '';
  showToast(`${person} toegevoegd`);
}

async function submitTodo(editId = null) {
  const tekst = document.getElementById('td-tekst')?.value?.trim();
  if (!tekst) { showToast('Vul in wat er moet gebeuren!', 'error'); return; }
  const todo = {
    tekst, ruimte: document.getElementById('td-ruimte')?.value || '',
    persoon: document.getElementById('td-persoon')?.value || '',
    prioriteit: document.getElementById('td-prio')?.value || 'normaal',
    datum: todayStr(),
  };
  if (editId) {
    todo.id = editId;
    const existing = state.todos.find(t => t.id === editId);
    if (existing) todo.klaar = existing.klaar;
    const saved = await saveTodo(todo);
    if (saved) { state.todos = state.todos.map(t => t.id === editId ? saved : t); closeModal(); render(); showToast('Taak bijgewerkt ✓'); }
  } else {
    const saved = await saveTodo(todo);
    if (saved) { state.todos.unshift(saved); closeModal(); render(); showToast('Taak toegevoegd ✓'); }
  }
}

// ─── Settings Modal ───
function openSettingsModal() {
  window._settingsForm = {
    template: { ...state.settings.template },
    setTypes: state.settings.setTypes.map(s => ({ ...s })),
    ruimtes: [...state.settings.ruimtes],
    personen: [...state.settings.personen],
  };
  renderSettingsModal();
}

function renderSettingsModal() {
  const f = window._settingsForm;
  const html = `
    <div class="modal-header">
      <h2>⚙️ Instellingen</h2>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-section">
        <div class="section-title">📅 Weeksjabloon capaciteit</div>
        ${DAY_NAMES.map((d, i) => `
          <div class="field-row compact">
            <span class="day-label">${DAY_NAMES_FULL[i]}</span>
            <button class="btn-step" onclick="adjSettDay('${d}',-0.5)">−</button>
            <input type="number" step="0.5" class="input-num" id="set-day-${d}" value="${f.template[d]}" onchange="window._settingsForm.template['${d}']=parseFloat(this.value)||0" />
            <button class="btn-step" onclick="adjSettDay('${d}',0.5)">+</button>
            <span class="unit">uur</span>
          </div>
        `).join('')}
      </div>

      <div class="form-section">
        <div class="section-title">⏱ Standaardtijden per set-type</div>
        ${f.setTypes.map((st, i) => `
          <div class="field-row compact">
            <input class="input flex-1" value="${escHtml(st.label)}" onchange="window._settingsForm.setTypes[${i}].label=this.value" />
            <input type="number" class="input-num" value="${st.minuten}" onchange="window._settingsForm.setTypes[${i}].minuten=parseInt(this.value)||0" />
            <span class="unit">min</span>
            <button class="btn-step btn-danger" onclick="window._settingsForm.setTypes.splice(${i},1); renderSettingsModal();">✕</button>
          </div>
        `).join('')}
        <div class="field-row compact">
          <input class="input flex-1" id="set-new-type" placeholder="Nieuw type..." />
          <button class="btn-sm btn-accent" onclick="addSettType()">+ Toevoegen</button>
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-section">
          <div class="section-title">📍 Ruimtes</div>
          ${f.ruimtes.map((r, i) => `<div class="field-row compact"><span class="flex-1">${escHtml(r)}</span><button class="btn-step btn-danger" onclick="window._settingsForm.ruimtes.splice(${i},1); renderSettingsModal();">✕</button></div>`).join('')}
          <div class="field-row compact"><input class="input flex-1" id="set-new-room" placeholder="Ruimte..." /><button class="btn-step" onclick="addSettRoom()">+</button></div>
        </div>
        <div class="form-section">
          <div class="section-title">👤 Personen</div>
          ${f.personen.map((p, i) => `<div class="field-row compact"><span class="flex-1">${escHtml(p)}</span><button class="btn-step btn-danger" onclick="window._settingsForm.personen.splice(${i},1); renderSettingsModal();">✕</button></div>`).join('')}
          <div class="field-row compact"><input class="input flex-1" id="set-new-person" placeholder="Naam..." /><button class="btn-step" onclick="addSettPerson()">+</button></div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary full-width" onclick="saveSettingsModal()">✓ Alles opslaan</button>
    </div>`;

  const existing = document.querySelector('.modal-overlay');
  if (existing) { existing.querySelector('.modal-content').innerHTML = html; } else { openModal(html); }
}

function adjSettDay(d, delta) {
  const inp = document.getElementById('set-day-' + d);
  if (inp) { let v = parseFloat(inp.value) + delta; v = Math.max(0, Math.min(24, v)); inp.value = v; window._settingsForm.template[d] = v; }
}

function addSettType() {
  const inp = document.getElementById('set-new-type');
  if (!inp?.value.trim()) return;
  window._settingsForm.setTypes.push({ id: inp.value.toLowerCase().replace(/\s+/g, '_'), label: inp.value.trim(), minuten: 30 });
  renderSettingsModal();
}

function addSettRoom() {
  const inp = document.getElementById('set-new-room');
  if (!inp?.value.trim()) return;
  window._settingsForm.ruimtes.push(inp.value.trim());
  renderSettingsModal();
}

function addSettPerson() {
  const inp = document.getElementById('set-new-person');
  if (!inp?.value.trim()) return;
  window._settingsForm.personen.push(inp.value.trim());
  renderSettingsModal();
}

async function saveSettingsModal() {
  state.settings = { ...state.settings, ...window._settingsForm };
  await saveInstellingen(state.settings);
  closeModal(); render(); showToast('Instellingen opgeslagen ✓');
}

// ─── Helpers ───
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Init ───
async function initApp() {
  if (!initSupabase()) {
    document.getElementById('app').innerHTML = '<div class="error-state"><h2>⚠️ Supabase niet geconfigureerd</h2><p>Vul je Supabase URL en key in in <code>config.js</code></p></div>';
    return;
  }
  state.loading = true;
  render();

  try {
    const [inst, jobs, archief, todos] = await Promise.all([
      fetchInstellingen(),
      fetchKlussen(false),
      fetchArchief(),
      fetchTodos(),
    ]);
    if (inst) state.settings = { ...state.settings, ...inst };
    state.jobs = jobs;
    state.archief = archief;
    state.todos = todos;
  } catch (err) {
    console.error('Init error:', err);
    showToast('Fout bij laden data', 'error');
  }

  state.loading = false;
  render();

  // Realtime sync
  subscribeToChanges(
    async () => { state.jobs = await fetchKlussen(false); state.archief = await fetchArchief(); render(); },
    async () => { state.todos = await fetchTodos(); render(); },
    async () => { const inst = await fetchInstellingen(); if (inst) state.settings = { ...state.settings, ...inst }; render(); },
  );
}

document.addEventListener('DOMContentLoaded', initApp);

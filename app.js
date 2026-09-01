// ============================================
// KeuringsPlanner - Applicatie v2
// ============================================

// Drie stappen. "Verwacht / binnen" is geen kolom maar een badge op de kaart,
// afgeleid uit datumBinnen. Retour is geen kolom maar een knop op Klaar die
// meteen archiveert -- dekt opgehaald, opgestuurd en teruggegeven op locatie.
const STATUSES = ['ingepland', 'in_behandeling', 'klaar'];
const STATUS_LABELS = { ingepland: 'Ingepland', in_behandeling: 'In behandeling', klaar: 'Klaar' };
const STATUS_ICONS = { ingepland: '📥', in_behandeling: '🔧', klaar: '✅' };
const STATUS_COLORS = { ingepland: '#D97706', in_behandeling: '#7C3AED', klaar: '#059669' };

// Gekeurd: telt niet meer mee in planning, capaciteit of agenda-export. Stond
// op vijf plekken los uitgeschreven; daardoor liep het uit de pas zodra de
// statussen wijzigden.
function isAfgerond(job) { return job.status === 'klaar'; }

// De twee datums die bij een status horen. Staat op een gedeelde plek omdat de
// status op twee manieren wijzigt: via de knoppen op de kanban en via de
// keuzelijst in het keuringsformulier.
function pasStatusDatumsAan(job) {
  if (job.status === 'in_behandeling') { if (!job.gestartOp) job.gestartOp = todayStr(); }
  else if (job.status === 'ingepland') { job.gestartOp = ''; }
  if (job.status === 'klaar') {
    // Niet stempelen op wat al gearchiveerd is: dan zou het openen en opslaan
    // van een oude keuring er vandaag als keurdatum op zetten.
    if (!job.gekeurdOp && !job.gearchiveerd) job.gekeurdOp = todayStr();
  } else {
    job.gekeurdOp = '';
  }
  return job;
}
const DAY_NAMES = ['ma', 'di', 'wo', 'do', 'vr'];
const DAY_NAMES_FULL = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'];
const WARNING_DAYS = 8;
const HOUR_START = 8;
const HOUR_END = 18;
const AFKEUR_OPTIES = ['Niet vervangen', 'Kleine reparaties meteen uitvoeren', 'Alles meteen vervangen voor vergelijkbaar product', 'Eerst bellen'];
const STAFF_COLORS = ['#DC2626','#EA580C','#D97706','#CA8A04','#65A30D','#16A34A','#0891B2','#2563EB','#4338CA','#6D28D9','#7C3AED','#9333EA','#C026D3','#DB2777','#E11D48'];
const ABSENCE_LABELS = { ziek: '🤒 Ziek', vakantie: '🏖️ Vakantie', verlof: '📋 Verlof', adv: '⏱️ ADV', anders: '📋 Anders' };

let state = {
  jobs: [], archief: [], todos: [], personeel: [], afwezigheden: [], dagOverrides: [], afspraken: [],
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
  activeTab: 'kalender', weeksToShow: 6, kalenderOffset: 0, archiefZoek: '', loading: true, ingelogd: false, gebruikerEmail: '',
  vakantieOverrides: null, urenJaar: new Date().getFullYear(),
};


// Date helpers
// Op lokale datum, niet via toISOString(): die rekent naar UTC, en omdat
// Nederland voorloopt werd middernacht de dag ervoor. new Date(2026,0,1) gaf
// zo '2025-12-31'. Alle feestdagen stonden daardoor een dag te vroeg, en
// todayStr() klopte tussen middernacht en 02:00 niet.
const toDateStr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parseDate = (s) => new Date(s + 'T00:00:00');
const todayStr = () => toDateStr(new Date());
const nowTimeStr = () => { const d = new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); };
const dayKey = (dateStr) => { const dow = parseDate(dateStr).getDay(); return dow >= 1 && dow <= 5 ? DAY_NAMES[dow - 1] : null; };
const formatDateShort = (s) => { if (!s) return '—'; try { return parseDate(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }); } catch { return s; } };
const formatDateFull = (s) => { try { return parseDate(s).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { return s; } };
const r2 = (n) => Math.round(n * 100) / 100;
function timeToHours(t) { if (!t) return 0; const p = t.split(':').map(Number); return p[0] + (p[1] || 0) / 60; }

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
function escHtml(str) { if (!str) return ''; return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Staff helpers
function isPersonAfwezig(persoonId, dateStr) {
  return state.afwezigheden.some(a => a.persoon_id === persoonId && dateStr >= a.van_datum && dateStr <= a.tot_datum);
}
function getAfwezigheidReden(persoonId, dateStr) {
  const a = state.afwezigheden.find(a => a.persoon_id === persoonId && dateStr >= a.van_datum && dateStr <= a.tot_datum);
  return a ? a.reden : null;
}
function getDagOverrideForPerson(persoonId, dateStr) {
  return state.dagOverrides.find(o => o.persoon_id === persoonId && o.datum === dateStr);
}
function getCapOverrideForDay(dateStr) {
  return state.dagOverrides.find(o => o.persoon_id === null && o.datum === dateStr);
}
function getStaffForDay(dateStr) {
  const dk = dayKey(dateStr); if (!dk) return [];
  return state.personeel.map(p => {
    const rooster = p.weekrooster && p.weekrooster[dk];
    const ov = getDagOverrideForPerson(p.id, dateStr);
    // ZZP'ers: only include if there's an explicit aanwezig:true override for this day
    if (p.is_zzper) {
      if (!ov || ov.aanwezig !== true) return null;
      return { ...p, aanwezig: true,
        start: (ov && ov.start_override) || '09:00',
        eind: (ov && ov.eind_override) || '17:00',
        keuringsuren: (ov && ov.keuringsuren_override != null) ? ov.keuringsuren_override : (p.is_keurmeester ? 4 : 0),
      };
    }
    if (!rooster || !rooster.actief) {
      // Toch tonen als er een expliciete aanwezig:true override is voor deze dag
      if (ov && ov.aanwezig === true) return { ...p, aanwezig: true,
        start: ov.start_override || '09:00', eind: ov.eind_override || '17:00',
        keuringsuren: ov.keuringsuren_override != null ? ov.keuringsuren_override : (p.is_keurmeester ? 4 : 0),
      };
      return null;
    }
    if (isPersonAfwezig(p.id, dateStr)) return { ...p, aanwezig: false, reden: getAfwezigheidReden(p.id, dateStr), start: rooster.start, eind: rooster.eind, keuringsuren: 0 };
    return { ...p, aanwezig: ov ? ov.aanwezig !== false : true,
      start: (ov && ov.start_override) || rooster.start || '09:00',
      eind: (ov && ov.eind_override) || rooster.eind || '17:00',
      keuringsuren: (ov && ov.keuringsuren_override != null) ? ov.keuringsuren_override : (p.is_keurmeester ? (rooster.keuringsuren != null ? rooster.keuringsuren : 4) : 0),
    };
  }).filter(Boolean);
}
function getAfsprakenForPersonDay(persoonId, dateStr) {
  return state.afspraken.filter(function(a) {
    return a.datum === dateStr && (
      a.persoon_id === persoonId ||
      (Array.isArray(a.personen_ids) && a.personen_ids.includes(persoonId))
    );
  });
}
function getTotalAfspraakHoursForDay(dateStr) {
  return state.afspraken.filter(function(a) { return a.datum === dateStr; }).reduce(function(s, a) {
    return s + Math.max(0, timeToHours(a.eind_tijd) - timeToHours(a.start_tijd));
  }, 0);
}

function capacityForDay(dateStr) {
  var base;
  const capOv = getCapOverrideForDay(dateStr);
  if (capOv && capOv.capaciteit_override != null) {
    base = capOv.capaciteit_override;
  } else if (state.personeel.length === 0) {
    const dk = dayKey(dateStr);
    base = dk ? (state.settings.template[dk] || 0) : 0;
  } else {
    base = getStaffForDay(dateStr).filter(s => s.aanwezig && s.is_keurmeester).reduce(function(sum, s) {
      var afspraakUren = getAfsprakenForPersonDay(s.id, dateStr).reduce(function(t, a) {
        return t + Math.max(0, timeToHours(a.eind_tijd) - timeToHours(a.start_tijd));
      }, 0);
      return sum + Math.max(0, (s.keuringsuren || 0) - afspraakUren);
    }, 0);
  }
  var opLocatieUren = state.jobs.filter(function(j) {
    return j.opLocatie && j.afspraakDatum === dateStr && !isAfgerond(j) && !j.gearchiveerd;
  }).reduce(function(sum, j) { return sum + (j.geschatteUren || 0); }, 0);
  return base + opLocatieUren;
}

// Hoeveel uur er nog te gaan is bij een keuring die in behandeling is.
// Je vult niets in: de app schat het uit de capaciteit van de dagen die sinds
// de startdag verstreken zijn. Ben je drie dagen bezig, dan is er drie dagen
// capaciteit verbruikt. De startdag zelf telt nog niet mee -- je zet de kaart
// meestal pas om als je er al een deel van de dag mee bezig bent.
// Klopt de schatting niet, sleep de kaart dan terug naar Ingepland: dan
// vervalt de startdag en staat de volle schatting er weer.
function resterendeUren(job, today) {
  if (!job.gestartOp || job.gestartOp >= today) return job.geschatteUren;
  let verbruikt = 0;
  const d = parseDate(job.gestartOp);
  const eind = parseDate(today);
  while (d < eind) {
    const ds = toDateStr(d);
    if (d.getDay() >= 1 && d.getDay() <= 5) verbruikt += capacityForDay(ds);
    d.setDate(d.getDate() + 1);
  }
  return Math.max(0, job.geschatteUren - verbruikt);
}

// Calendar scheduling
function buildCalendar(jobs, days) {
  const cal = {};
  days.forEach(d => { cal[d] = { date: d, capacity: capacityForDay(d), staff: getStaffForDay(d), items: [], usedHours: 0 }; });
  const today = todayStr();
  const futureDays = days.filter(d => d >= today);
  const activeJobs = jobs.filter(j => !j.gearchiveerd && !isAfgerond(j));

  // Terugblik: wat er al gekeurd is, op de dag waarop het gekeurd is. Dit gaat
  // eerst, want die uren zijn echt besteed en dus niet meer beschikbaar. Zonder
  // deze telling zou een dag waarop je vijf uur gekeurd hebt alsnog als volledig
  // vrij gelden, en zou het afronden van een keuring de capaciteit van vandaag
  // opnieuw vrijgeven.
  jobs.forEach(job => {
    if (!job.gekeurdOp) return;
    if (!isAfgerond(job) && !job.gearchiveerd) return;
    const entry = cal[job.gekeurdOp]; if (!entry) return;
    entry.items.push({ job, hours: job.geschatteUren, type: 'historie' });
    entry.usedHours += job.geschatteUren;
  });

  // Daarna: keuringen waar iemand mee bezig is. Die krijgen voorrang en
  // een aflopende teller, zodat een grote set niet elke dag opnieuw met zijn
  // volle uren vooraan gaat staan en de rest vooruit duwt.
  const bezigJobs = activeJobs.filter(j => j.status === 'in_behandeling');
  bezigJobs.forEach(job => {
    let remaining = resterendeUren(job, today);
    for (const d of futureDays) {
      if (remaining <= 0) break;
      const entry = cal[d]; if (!entry) continue;
      const free = entry.capacity - entry.usedHours; if (free <= 0) continue;
      const allocate = Math.min(remaining, free);
      entry.items.push({ job, hours: allocate, type: 'afspraak', bezig: true });
      entry.usedHours += allocate; remaining -= allocate;
    }
  });

  const restJobs = activeJobs.filter(j => j.status !== 'in_behandeling');
  const afspraakJobs = restJobs.filter(j => j.heeftAfspraak && j.afspraakDatum).sort((a, b) => a.afspraakDatum.localeCompare(b.afspraakDatum));
  afspraakJobs.forEach(job => {
    let remaining = job.geschatteUren;
    const startFrom = job.datumBinnen && job.datumBinnen >= today ? job.datumBinnen : today;
    const deadline = job.afspraakDatum;
    // Afleverdatum al verstreken: de keuring hoort op zijn eigen dag te blijven
    // staan. Zonder deze tak viel hij door naar de overflow-regel onderaan:
    // futureDays bevat alleen vandaag en later, dus elke dag is > deadline en
    // de lus breekt meteen af; cal[deadline] bestaat niet (die dag ligt buiten
    // het venster) en dan landde de keuring op de laatste dag van het zichtbare
    // venster -- wat eruitzag alsof hij vanzelf een maand vooruit werd gepland.
    // Valt de eigen dag buiten het venster, dan hoort hij hier simpelweg niet
    // in beeld; de kanban blijft hem gewoon tonen.
    if (deadline < today) {
      const eigenDag = cal[deadline];
      if (eigenDag) {
        eigenDag.items.push({ job, hours: remaining, type: 'afspraak', verstreken: true });
        eigenDag.usedHours += remaining;
      }
      return;
    }
    for (const d of futureDays) {
      if (d < startFrom || remaining <= 0) continue;
      if (d > deadline) break;
      const entry = cal[d]; if (!entry) continue;
      const free = entry.capacity - entry.usedHours; if (free <= 0) continue;
      const allocate = Math.min(remaining, free);
      entry.items.push({ job, hours: allocate, type: 'afspraak' });
      entry.usedHours += allocate; remaining -= allocate;
    }
    if (remaining > 0) {
      const target = cal[deadline] || cal[futureDays[futureDays.length - 1]];
      if (target) { target.items.push({ job, hours: remaining, type: 'afspraak', overflow: true }); target.usedHours += remaining; }
    }
  });
  const tussendoorJobs = restJobs.filter(j => !j.heeftAfspraak).sort((a, b) => (a.datumBinnen || '').localeCompare(b.datumBinnen || ''));
  const jobQueue = [...tussendoorJobs]; const scheduled = {};
  for (const d of futureDays) {
    if (jobQueue.length === 0) break;
    const entry = cal[d]; if (!entry) continue;
    let free = entry.capacity - entry.usedHours; let qi = 0;
    while (free > 0 && qi < jobQueue.length) {
      const job = jobQueue[qi]; const alreadyDone = scheduled[job.id] || 0;
      const remaining = job.geschatteUren - alreadyDone;
      if (remaining <= 0) { jobQueue.splice(qi, 1); continue; }
      if (job.datumBinnen && d < job.datumBinnen) { qi++; continue; }
      const allocate = Math.min(remaining, free);
      entry.items.push({ job, hours: allocate, type: 'tussendoor' });
      entry.usedHours += allocate; free -= allocate;
      scheduled[job.id] = alreadyDone + allocate;
      if (allocate >= remaining) { jobQueue.splice(qi, 1); } else { break; }
    }
  }
  return cal;
}

// Toast & Modal
function showToast(msg, type) {
  type = type || 'success';
  const t = document.createElement('div'); t.className = 'toast toast-' + type; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 2500);
}
function openModal(content, wide) {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal-content' + (wide ? ' modal-wide' : '') + '">' + content + '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(function() { overlay.classList.add('show'); });
  return overlay;
}
function closeModal() { const m = document.querySelector('.modal-overlay'); if (m) { m.classList.remove('show'); setTimeout(function() { m.remove(); }, 200); } }

// Stats Bar
function renderStatsBar() {
  const active = state.jobs.filter(function(j) { return !isAfgerond(j); });
  const met = active.filter(function(j) { return j.heeftAfspraak; }).length;
  const zonder = active.filter(function(j) { return !j.heeftAfspraak; }).length;
  const uren = active.reduce(function(s, j) { return s + (j.geschatteUren || 0); }, 0);
  const warn = active.filter(function(j) { return !j.heeftAfspraak && workdaysBetween(j.datumBinnen || todayStr(), todayStr()) >= WARNING_DAYS; }).length;
  return '<div class="stats-bar">' +
    '<div class="stat-card"><div class="stat-val accent">' + met + '</div><div class="stat-label">Met afleverdatum</div></div>' +
    '<div class="stat-card"><div class="stat-val muted">' + zonder + '</div><div class="stat-label">Wachtlijst</div></div>' +
    '<div class="stat-card"><div class="stat-val">' + r2(uren) + 'u</div><div class="stat-label">Totaal uren</div></div>' +
    '<div class="stat-card ' + (warn > 0 ? 'stat-warn' : '') + '"><div class="stat-val ' + (warn > 0 ? 'danger' : '') + '">' + warn + '</div><div class="stat-label">⚠ >' + WARNING_DAYS + ' dagen</div></div>' +
    '</div>';
}

// Calendar Render
function renderCalendar() {
  var startMonday = zichtbareStartMaandag();
  var allDays = getWorkdays(startMonday, state.weeksToShow);
  // Archief meegeven voor de terugblik: gekeurde keuringen zijn gearchiveerd
  // en zitten dus niet in state.jobs. De planning zelf raakt dit niet -- die
  // filtert gearchiveerde en afgeronde keuringen weg.
  var calendar = buildCalendar(state.jobs.concat(state.archief), allDays);
  var today = todayStr();
  var weeks = [];
  for (var i = 0; i < allDays.length; i += 5) weeks.push(allDays.slice(i, i + 5));
  var totalHours = HOUR_END - HOUR_START;

  var html = '<div class="cal-legend">' +
    '<span class="legend-item"><span class="legend-dot" style="background:var(--accent)"></span> Keuring (met datum)</span>' +
    '<span class="legend-item"><span class="legend-dot muted-bg"></span> Wachtlijst</span>' +
    '<span class="legend-item"><span class="legend-dot" style="background:var(--success)"></span> Vrij</span>' +
    '<span class="legend-item"><span class="legend-dot" style="background:var(--text-faint);opacity:0.55"></span> Al gekeurd</span>' +
    '<span class="legend-sep">|</span><span class="legend-hint">Klik op naam in balk → afspraak plannen</span></div>';

  html += '<div class="cal-grid-outer">';
  html += '<div class="cal-header"><div class="cal-header-spacer"></div>' + DAY_NAMES_FULL.map(function(n) { return '<div class="cal-header-day">' + n + '</div>'; }).join('') + '</div>';

  var hourLabelsHtml = '<div class="hour-labels">';
  for (var h = HOUR_START; h <= HOUR_END; h++) hourLabelsHtml += '<div class="hour-label">' + h + ':00</div>';
  hourLabelsHtml += '</div>';

  weeks.forEach(function(week, wi) {
    html += '<div class="cal-week-row">' + hourLabelsHtml + '<div class="cal-week">';
    week.forEach(function(dateStr) {
      var entry = calendar[dateStr];
      if (!entry) { html += '<div class="cal-day empty"></div>'; return; }
      var isToday = dateStr === today;
      var isPast = dateStr < today;
      var isOver = entry.usedHours > entry.capacity;
      var date = parseDate(dateStr);
      var hasCapOverride = getCapOverrideForDay(dateStr) && getCapOverrideForDay(dateStr).capaciteit_override != null;
      var staffPresent = entry.staff.filter(function(s) { return s.aanwezig; });
      var staffAbsent = entry.staff.filter(function(s) { return !s.aanwezig; });

      html += '<div class="cal-day ' + (isToday ? 'today' : '') + ' ' + (isPast ? 'past' : '') + '" onclick="openDayOverride(\'' + dateStr + '\')">';

      // ─── Header ───
      html += '<div class="cal-day-header"><div class="cal-day-num">' +
        '<span class="day-abbr">' + DAY_NAMES_FULL[date.getDay() - 1].substring(0, 2).toUpperCase() + '</span>' +
        '<span class="day-number">' + date.getDate() + '</span>';
      html += '<span class="day-month">' + date.toLocaleDateString('nl-NL', { month: 'short' }) + '</span>';
      html += '</div><div class="cal-day-badges">';
      if (isToday) html += '<span class="badge badge-today">NU</span>';
      if (hasCapOverride) html += '<span class="badge badge-override">✎</span>';
      if (staffAbsent.length > 0) html += '<span class="badge badge-absent">' + staffAbsent.length + '×afw</span>';
      var mmdd = dateStr.substring(5); // MM-DD
      var jarigen = state.personeel.filter(function(p) { return p.geboortedatum && p.geboortedatum.substring(5) === mmdd; });
      if (jarigen.length > 0) html += '<span class="badge" style="background:#FEF3C7;color:#92400E" title="' + jarigen.map(function(p){return p.naam;}).join(', ') + '">🎂</span>';
      html += '</div></div>';

      // ─── Capaciteitssectie (boven de personeelsbalkjes) ───
      // Alleen keuringen in de pil; afspraken verminderen al de capaciteit via capacityForDay()
      var aItems = entry.items.filter(function(it) { return it.type === 'afspraak'; });
      var tItems = entry.items.filter(function(it) { return it.type === 'tussendoor'; });
      var hItems = entry.items.filter(function(it) { return it.type === 'historie'; });
      var freeH = Math.max(0, entry.capacity - entry.usedHours);

      html += '<div class="cal-cap-section" onclick="event.stopPropagation()">';
      html += '<div class="cap-bar-new">';

      if (entry.capacity > 0) {
        // Terugblik: al gekeurd op deze dag. Doorzichtig, zodat het duidelijk
        // verschilt van werk dat nog moet gebeuren.
        hItems.forEach(function(item) {
          var pct = Math.min((item.hours / entry.capacity) * 100, 100);
          if (pct < 0.5) return;
          html += '<div class="cap-seg cap-seg-historie" style="width:' + pct.toFixed(1) + '%" title="Gekeurd op ' + formatDateShort(item.job.gekeurdOp) + ': ' + escHtml(item.job.klant) + ' · ' + r2(item.hours) + 'u' + (item.job.opLocatie ? ' · 🚗 op locatie' : '') + '" onclick="openJobModal(' + item.job.id + ',' + (item.job.gearchiveerd ? 'true' : 'false') + ')">✔ ' + (item.job.opLocatie ? '🚗 ' : '') + escHtml(item.job.klant) + '</div>';
        });
        // Blauwe segmenten: keuringen met afsprakendatum
        aItems.forEach(function(item) {
          var pct = Math.min((item.hours / entry.capacity) * 100, 100);
          if (pct < 0.5) return;
          var cls = (item.overflow || item.verstreken) ? 'cap-seg-overflow' : 'cap-seg-keuring';
          var warning = (item.overflow || item.verstreken) ? '⚠ ' : '';
          html += '<div class="cap-seg ' + cls + '" style="width:' + pct.toFixed(1) + '%" title="' + escHtml(item.job.klant) + ' · ' + r2(item.hours) + 'u' + (item.job.opLocatie ? ' · 🚗 op locatie' : '') + (item.verstreken ? ' · ⚠ afleverdatum verstreken' : '') + '" onclick="openJobModal(' + item.job.id + ')">' + warning + (item.job.opLocatie ? '🚗 ' : '') + escHtml(item.job.klant) + '</div>';
        });
        // Grijze segmenten: wachtlijst keuringen
        tItems.forEach(function(item) {
          var pct = Math.min((item.hours / entry.capacity) * 100, 100);
          if (pct < 0.5) return;
          var daysOpen = workdaysBetween(item.job.datumBinnen || todayStr(), todayStr());
          var isWarn = daysOpen >= WARNING_DAYS;
          html += '<div class="cap-seg ' + (isWarn ? 'cap-seg-overflow' : 'cap-seg-wacht') + '" style="width:' + pct.toFixed(1) + '%" title="' + escHtml(item.job.klant) + ' · ' + r2(item.hours) + 'u' + (isWarn ? ' · ' + daysOpen + ' dagen open' : '') + '" onclick="openJobModal(' + item.job.id + ')">' + (isWarn ? '⚠ ' : '') + escHtml(item.job.klant) + '</div>';
        });
        // Groen: vrij keuring-capaciteit
        if (freeH > 0) {
          html += '<div class="cap-seg cap-seg-vrij" style="flex:1" title="' + r2(freeH) + 'u vrij voor keuringen">' + r2(freeH) + 'u vrij</div>';
        }
      } else {
        html += '<div class="cap-seg cap-seg-vrij" style="flex:1">geen keur-capaciteit</div>';
      }

      html += '</div>'; // cap-bar-new
      html += '<div class="cal-day-info ' + (isOver ? 'danger' : '') + '"><span>' + r2(entry.usedHours) + '/' + entry.capacity + 'u keuringen</span>';
      if (isOver) html += '<span class="over">OVER</span>';
      html += '</div>';
      html += '</div>'; // cal-cap-section

      // ─── Personeelsbalkjes sectie ───
      html += '<div class="cal-staff-area" onclick="event.stopPropagation()">';
      if (staffPresent.length > 0) {
        var barW = Math.floor(100 / staffPresent.length);

        // Vaste naamrij boven de tijdslijn
        html += '<div class="staff-name-row">';
        staffPresent.forEach(function(s, si) {
          html += '<div class="staff-name-cell" style="width:' + barW + '%;left:' + (si * barW) + '%;border-color:' + s.kleur + '">' +
            '<span class="staff-bar-name" style="color:' + s.kleur + ';cursor:pointer" title="Afspraak plannen voor ' + escHtml(s.naam) + '" onclick="openAfspraakModal(' + s.id + ', \'' + dateStr + '\', null)">+ ' + escHtml(s.naam) + '</span>' +
            (s.is_keurmeester ? '<span class="staff-bar-cap" style="color:' + s.kleur + ';cursor:pointer" title="Nieuwe keuring voor ' + escHtml(s.naam) + '" onclick="event.stopPropagation();openNieuweKeuringVanafKalender(\'' + dateStr + '\',' + s.id + ')">' + s.keuringsuren + 'u keur.</span>' : '') +
            '</div>';
        });
        html += '</div>';

        // Tijdslijn balkjes
        html += '<div class="staff-bars-timeline">';
        staffPresent.forEach(function(s, si) {
          var startH = timeToHours(s.start) - HOUR_START;
          var endH = timeToHours(s.eind) - HOUR_START;
          var persAfspraken = getAfsprakenForPersonDay(s.id, dateStr);

          var effectiveStartH = persAfspraken.reduce(function(min, ap) {
            return Math.min(min, timeToHours(ap.start_tijd) - HOUR_START);
          }, startH);
          var effectiveEndH = persAfspraken.reduce(function(max, ap) {
            return Math.max(max, timeToHours(ap.eind_tijd) - HOUR_START);
          }, endH);
          effectiveStartH = Math.max(0, effectiveStartH);
          effectiveEndH = Math.min(totalHours, effectiveEndH);

          var topPct = (effectiveStartH / totalHours) * 100;
          var heightPct = ((effectiveEndH - effectiveStartH) / totalHours) * 100;
          var leftPct = si * barW;
          var barDurH = effectiveEndH - effectiveStartH;
          var effectiveStartTime = HOUR_START + effectiveStartH;

          var bgAlpha = persAfspraken.length > 0 ? '28' : '12';

          html += '<div class="staff-bar-bg" style="left:' + leftPct + '%;width:' + barW + '%;top:' + topPct + '%;height:' + heightPct + '%;background:' + s.kleur + bgAlpha + ';border-color:' + s.kleur + '">';

          // Losse afspraak blokken
          if (barDurH > 0) {
            persAfspraken.forEach(function(ap) {
              var apS = Math.max(0, timeToHours(ap.start_tijd) - effectiveStartTime);
              var apE = Math.min(barDurH, timeToHours(ap.eind_tijd) - effectiveStartTime);
              if (apE <= apS) return;
              var apTop = (apS / barDurH) * 100;
              var apH = ((apE - apS) / barDurH) * 100;
              html += '<div class="afspraak-blok" style="top:' + apTop.toFixed(1) + '%;height:' + apH.toFixed(1) + '%;background:' + s.kleur + 'BB;border:1px solid ' + s.kleur + '" title="' + escHtml(ap.titel) + (ap.opmerkingen ? ': ' + escHtml(ap.opmerkingen) : '') + '" onclick="openAfspraakModal(' + s.id + ', \'' + dateStr + '\', ' + ap.id + ')">' + escHtml(ap.titel) + '</div>';
            });

            // Keuring blokken (voor keuringen die aan deze keurmeester zijn gekoppeld)
            state.jobs.filter(function(j) {
              return j.persoonId === s.id && j.heeftAfspraak && j.afspraakDatum === dateStr && !isAfgerond(j);
            }).forEach(function(job) {
              var kTijd = job.binnenkomstTijd || job.afspraakTijd || '';
              var kStart = kTijd ? timeToHours(kTijd) : effectiveStartTime;
              var kEnd = kStart + (job.geschatteUren || 1);
              var kS = Math.max(0, kStart - effectiveStartTime);
              var kE = Math.min(barDurH, kEnd - effectiveStartTime);
              if (kE <= kS) return;
              var kTop = (kS / barDurH) * 100;
              var kH = ((kE - kS) / barDurH) * 100;
              html += '<div class="keuring-blok" style="top:' + kTop.toFixed(1) + '%;height:' + kH.toFixed(1) + '%;background:' + s.kleur + '" title="' + (job.opLocatie ? '🚗 Op locatie: ' : 'Keuring: ') + escHtml(job.klant) + '" onclick="openJobModal(' + job.id + ')">' + (job.opLocatie ? '🚗 ' : '') + escHtml(job.klant) + '</div>';
            });
          }
          html += '</div>';
        });
        html += '</div>'; // staff-bars-timeline
      } else {
        html += '<div class="staff-area-hint">geen personeel</div>';
      }
      html += '</div>'; // cal-staff-area

      html += '</div>'; // cal-day
    });
    html += '</div></div>';
  });
  html += '</div>';
  return html;
}

// Kanban
function renderKanban() {
  var html = '<div class="kanban-board">';
  STATUSES.forEach(function(status, si) {
    var col = state.jobs.filter(function(j) { return j.status === status; }).sort(function(a, b) {
      if (a.heeftAfspraak !== b.heeftAfspraak) return a.heeftAfspraak ? -1 : 1;
      if (a.heeftAfspraak) return (a.afspraakDatum || '').localeCompare(b.afspraakDatum || '');
      return (a.datumBinnen || '').localeCompare(b.datumBinnen || '');
    });
    html += '<div class="kanban-col" style="--col-color: ' + STATUS_COLORS[status] + '">' +
      '<div class="kanban-col-header"><span>' + STATUS_ICONS[status] + ' ' + STATUS_LABELS[status] + '</span><span class="kanban-count">' + col.length + '</span></div>';
    col.forEach(function(job) {
      var daysOpen = workdaysBetween(job.datumBinnen || todayStr(), todayStr());
      var isW = !job.heeftAfspraak && daysOpen >= WARNING_DAYS;
      var isFuture = job.datumBinnen && job.datumBinnen > todayStr();
      html += '<div class="kanban-card ' + (isFuture ? 'border-future' : job.heeftAfspraak ? 'border-accent' : isW ? 'border-danger' : 'border-muted') + '" onclick="openJobModal(' + job.id + ')">' +
        '<div class="kanban-card-top"><div class="kanban-card-info">' +
        '<div class="kanban-card-name"' + (job.opLocatie ? ' title="Keuring op locatie bij de klant"' : '') + '>' + (isW ? '⚠ ' : '') + (job.opLocatie ? '🚗 ' : '') + escHtml(job.klant) + '</div>' +
        '<div class="kanban-card-desc">' + escHtml(job.omschrijving) + '</div></div>' +
        '<span class="kanban-badge ' + (isFuture ? 'badge-future' : job.heeftAfspraak ? 'badge-afspraak' : 'badge-tussendoor') + '">' +
        (isFuture ? '📦 Verwacht ' + formatDateShort(job.datumBinnen) : job.heeftAfspraak ? '📅 Aflevering ' + formatDateShort(job.afspraakDatum) : 'Wachtlijst') + '</span></div>' +
        '<div class="kanban-card-meta"><span>⏱ ' + job.geschatteUren + 'u</span>' +
        (isW ? '<span class="danger">⚠ ' + daysOpen + 'd</span>' : '') +
        ((job.contactLog || []).length > 0 ? '<span>📞' + job.contactLog.length + '</span>' : '') + '</div>' +
        '<div class="kanban-card-actions" onclick="event.stopPropagation()">' +
        (si > 0 ? '<button class="btn-sm" onclick="changeJobStatus(' + job.id + ',\'' + STATUSES[si - 1] + '\')">← ' + STATUS_LABELS[STATUSES[si - 1]] + '</button>' : '') +
        (si < STATUSES.length - 1 ? '<button class="btn-sm btn-status" style="--btn-color:' + STATUS_COLORS[STATUSES[si + 1]] + '" onclick="changeJobStatus(' + job.id + ',\'' + STATUSES[si + 1] + '\')">' + STATUS_LABELS[STATUSES[si + 1]] + ' →</button>' : '') +
        (status === 'klaar' ? '<button class="btn-sm btn-archive" onclick="doArchiveerKlus(' + job.id + ')" title="Set is terug bij de klant — verplaatst de keuring naar het archief">📦 Retour</button>' : '') +
        '<button class="btn-sm btn-delete" onclick="doDeleteJob(' + job.id + ')">🗑</button></div></div>';
    });
    if (col.length === 0) html += '<div class="kanban-empty">Geen keuringen</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Todo
function renderTodo() {
  var filterR = (document.getElementById('todo-filter-room') || {}).value || 'alle';
  var filterP = (document.getElementById('todo-filter-person') || {}).value || 'alle';
  var filtered = state.todos.filter(function(t) { return (filterR === 'alle' || t.ruimte === filterR) && (filterP === 'alle' || t.persoon === filterP); });
  var priColors = { hoog: 'var(--danger)', normaal: 'var(--warning)', laag: 'var(--muted)' };
  var open = filtered.filter(function(t) { return !t.klaar; });
  var done = filtered.filter(function(t) { return t.klaar; });
  var html = '<div class="todo-filters"><div class="filter-group"><span class="filter-label">Ruimte:</span>' +
    '<select id="todo-filter-room" onchange="render()" class="input-sm"><option value="alle">Alle</option>' +
    state.settings.ruimtes.map(function(r) { return '<option value="' + escHtml(r) + '" ' + (filterR === r ? 'selected' : '') + '>' + escHtml(r) + '</option>'; }).join('') +
    '</select></div><div class="filter-group"><span class="filter-label">Persoon:</span>' +
    '<select id="todo-filter-person" onchange="render()" class="input-sm"><option value="alle">Alle</option>' +
    state.settings.personen.map(function(p) { return '<option value="' + escHtml(p) + '" ' + (filterP === p ? 'selected' : '') + '>' + escHtml(p) + '</option>'; }).join('') +
    '</select></div><button class="btn-primary btn-yellow" onclick="openTodoModal()">+ Nieuw</button></div>';
  open.forEach(function(todo) {
    html += '<div class="todo-item" style="--pri-color: ' + (priColors[todo.prioriteit] || priColors.normaal) + '">' +
      '<button class="todo-check" onclick="event.stopPropagation(); toggleTodo(' + todo.id + ', true)"></button>' +
      '<div class="todo-info" onclick="openEditTodoModal(' + todo.id + ')" style="cursor:pointer">' +
      '<div class="todo-text">' + escHtml(todo.tekst) + '</div><div class="todo-meta">' +
      (todo.ruimte ? '<span>📍' + escHtml(todo.ruimte) + '</span>' : '') +
      (todo.persoon ? '<span>👤' + escHtml(todo.persoon) + '</span>' : '') +
      '<span>' + formatDateShort(todo.datum) + '</span></div></div>' +
      '<button class="btn-icon" onclick="event.stopPropagation(); doDeleteTodo(' + todo.id + ')">✕</button></div>';
  });
  if (done.length > 0) {
    html += '<div class="todo-done-header">✅ Afgerond</div>';
    done.forEach(function(todo) {
      html += '<div class="todo-item done"><button class="todo-check checked" onclick="toggleTodo(' + todo.id + ', false)">✓</button>' +
        '<span class="todo-text strike">' + escHtml(todo.tekst) + '</span>' +
        '<button class="btn-icon" onclick="doDeleteTodo(' + todo.id + ')">✕</button></div>';
    });
  }
  if (filtered.length === 0) html += '<div class="empty-state">Geen taken' + (filterR !== 'alle' || filterP !== 'alle' ? ' met deze filters' : '') + '</div>';
  return html;
}

// Archief
function renderArchief() {
  var z = state.archiefZoek.toLowerCase();
  var results = state.archief.filter(function(k) { return !z || k.klant.toLowerCase().indexOf(z) >= 0 || (k.klantNummer || '').toLowerCase().indexOf(z) >= 0 || k.omschrijving.toLowerCase().indexOf(z) >= 0; });
  // Nieuwste keuring bovenaan. Keuringen van voor de invoering van gekeurdOp
  // hebben die datum niet; die vallen terug op de laatste wijziging, zodat ze
  // niet allemaal onderaan belanden.
  results = results.slice().sort(function(a, b) {
    return (b.gekeurdOp || (b.updatedAt || '').slice(0, 10)).localeCompare(a.gekeurdOp || (a.updatedAt || '').slice(0, 10));
  });
  var html = '<div class="archief-search"><input type="text" class="input" placeholder="Zoek op klantnaam, nummer of omschrijving..." value="' + escHtml(state.archiefZoek) + '" oninput="state.archiefZoek = this.value; render();" />' +
    '<span class="archief-count">' + results.length + ' keuring' + (results.length !== 1 ? 'en' : '') + ' in archief</span></div>';
  if (results.length === 0) html += '<div class="empty-state">Geen gearchiveerde keuringen' + (z ? ' gevonden' : '') + '</div>';
  else results.forEach(function(job) {
    html += '<div class="archief-card" onclick="openJobModal(' + job.id + ', true)"><div class="archief-card-left">' +
      '<div class="archief-card-name">' + escHtml(job.klant) + '</div><div class="archief-card-desc">' + escHtml(job.omschrijving) + '</div>' +
      '<div class="archief-card-meta">' + (job.klantNummer ? '<span>📋 ' + escHtml(job.klantNummer) + '</span>' : '') +
      (job.gekeurdOp ? '<span class="accent">🔍 Gekeurd: ' + formatDateShort(job.gekeurdOp) + '</span>' : '') +
      '<span>📅 Binnen: ' + formatDateShort(job.datumBinnen) + '</span><span>⏱ ' + job.geschatteUren + 'u</span>' +
      (job.heeftAfspraak ? '<span class="accent">📅 Aflevering: ' + formatDateShort(job.afspraakDatum) + '</span>' : '<span>Wachtlijst</span>') +
      '</div></div><div class="archief-card-right"><button class="btn-sm" onclick="event.stopPropagation(); doDeArchiveer(' + job.id + ')">📤 Terugzetten</button></div></div>';
  });
  return html;
}

// Main render
function render() {
  var app = document.getElementById('app');
  if (state.loading) { app.innerHTML = '<div class="loading"><div class="spinner"></div><p>KeuringsPlanner laden...</p></div>'; return; }
  if (!state.ingelogd) { renderLoginScherm(); return; }
  var showStats = state.activeTab === 'kalender' || state.activeTab === 'kanban';
  var tabContent = '';
  switch (state.activeTab) {
    case 'kalender': tabContent = renderCalendar(); break;
    case 'kanban': tabContent = renderKanban(); break;
    case 'todo': tabContent = renderTodo(); break;
    case 'archief': tabContent = renderArchief(); break;
    case 'uren': tabContent = renderUrenOverzicht(); break;
  }
  var tabs = ['kalender','kanban','todo','archief','uren'];
  var tabLabels = { kalender:'📅 Kalender', kanban:'📋 Kanban', todo:'✅ To-do', archief:'📁 Archief', uren:'🏖️ Uren' };
  var tabBarHtml = tabs.map(function(tab) {
    return '<button class="tab-btn ' + (state.activeTab === tab ? 'active' : '') + '" onclick="switchTab(\'' + tab + '\')">' + tabLabels[tab] + '</button>';
  }).join('');
  var weekPicker = '';
  if (state.activeTab === 'kalender') {
    var navDate = parseDate(zichtbareStartMaandag());
    var maandNamen = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
    var navLabel = maandNamen[navDate.getMonth()] + ' ' + navDate.getFullYear();
    weekPicker = '<div class="week-picker" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
      '<button class="week-btn" onclick="gaNaarKalenderPeriode(state.kalenderOffset - state.weeksToShow)" title="Vorige periode">◀</button>' +
      '<button class="week-btn" style="min-width:130px;font-weight:600" onclick="openMaandPicker()">' + navLabel + ' ▾</button>' +
      (state.kalenderOffset !== 0 ? '<button class="week-btn" onclick="gaNaarKalenderPeriode(0)" title="Naar vandaag">↩ Nu</button>' : '') +
      '<button class="week-btn" onclick="gaNaarKalenderPeriode(state.kalenderOffset + state.weeksToShow)" title="Volgende periode">▶</button>' +
      '<span class="filter-label" style="margin-left:6px">Weken:</span>' +
      [3,4,6,8,12].map(function(w) { return '<button class="week-btn ' + (state.weeksToShow === w ? 'active' : '') + '" onclick="gaNaarKalenderPeriode(state.kalenderOffset, ' + w + ')">' + w + '</button>'; }).join('') +
      '</div>';
  }
  app.innerHTML = '<header class="header"><div class="header-inner"><div class="header-left">' +
    '<h1 class="logo">⚙️ KeuringsPlanner</h1><p class="subtitle">Intake · Planning · Capaciteit · Personeel</p></div>' +
    '<div class="header-right">' +
    '<button class="btn-header" onclick="openPersoneelModal()">👥 Personeel</button>' +
    '<button class="btn-header" onclick="openAfwezigheidModal()">🏖️ Afwezigheid</button>' +
    '<button class="btn-header" onclick="openSettingsModal()">⚙️ Instellingen</button>' +
    '<button class="btn-header" onclick="openHandleiding()" title="Handleiding">❓</button>' +
    '<button class="btn-new-job" onclick="openJobModal(null)">+ Nieuwe keuring</button>' +
    '</div></div></header>' +
    '<main class="main">' + (showStats ? renderStatsBar() : '') +
    '<div class="tab-bar-row"><div class="tab-bar">' + tabBarHtml + '</div>' + weekPicker + '</div>' +
    '<div class="tab-content">' + tabContent + '</div></main>';
}

// Password screen
function renderLoginScherm() {
  document.getElementById('app').innerHTML = '<div class="password-screen"><div class="password-box">' +
    '<h1>⚙️ KeuringsPlanner</h1><p>Log in om verder te gaan</p>' +
    '<input type="email" class="input" id="login-email" placeholder="E-mailadres" autocomplete="username" style="margin-bottom:8px" onkeydown="if(event.key===\'Enter\') doLogin()" />' +
    '<input type="password" class="input" id="login-ww" placeholder="Wachtwoord" autocomplete="current-password" onkeydown="if(event.key===\'Enter\') doLogin()" />' +
    '<button class="btn-primary full-width" id="login-knop" onclick="doLogin()" style="margin-top:10px">Inloggen</button>' +
    '<div id="login-fout" class="pw-error"></div>' +
    '<button class="btn-link" onclick="doWachtwoordVergeten()" style="margin-top:12px;background:none;border:none;color:#6B7280;font-size:13px;cursor:pointer;text-decoration:underline">Wachtwoord vergeten?</button>' +
    '</div></div>';
  setTimeout(function() { var el = document.getElementById('login-email'); if (el) el.focus(); }, 100);
}

async function doLogin() {
  var email = (document.getElementById('login-email') || {}).value || '';
  var ww = (document.getElementById('login-ww') || {}).value || '';
  var fout = document.getElementById('login-fout');
  var knop = document.getElementById('login-knop');
  if (!email.trim() || !ww) { if (fout) fout.textContent = 'Vul e-mailadres en wachtwoord in'; return; }
  if (knop) { knop.disabled = true; knop.textContent = 'Inloggen...'; }
  var res = await db.auth.signInWithPassword({ email: email.trim(), password: ww });
  if (res.error) {
    if (fout) fout.textContent = 'Inloggen mislukt: controleer e-mailadres en wachtwoord';
    if (knop) { knop.disabled = false; knop.textContent = 'Inloggen'; }
    return;
  }
  // Verder gaat via onAuthStateChange -- niet hier data ophalen.
}

async function doLogout() {
  if (!confirm('Uitloggen?')) return;
  await db.auth.signOut();
}

async function doWachtwoordVergeten() {
  var email = ((document.getElementById('login-email') || {}).value || '').trim();
  if (!email) {
    var fout = document.getElementById('login-fout');
    if (fout) fout.textContent = 'Vul eerst je e-mailadres in, dan sturen we een herstelmail';
    return;
  }
  var res = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  if (res.error) { showToast('Versturen mislukt', 'error'); return; }
  showToast('Herstelmail verstuurd naar ' + email);
}

function openHandleiding() {
  var s = function(t) { return '<div style="font-weight:700;font-size:14px;color:#1E293B;margin:16px 0 6px">' + t + '</div>'; };
  var p = function(t) { return '<p style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:6px">' + t + '</p>'; };
  var li = function(items) { return '<ul style="font-size:13px;color:#374151;line-height:1.9;padding-left:18px;margin-bottom:6px">' + items.map(function(i){return '<li>' + i + '</li>';}).join('') + '</ul>'; };
  var html = '<div class="modal-header"><h2>❓ Handleiding KeuringsPlanner</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body">' +

    s('📥 Nieuwe keuring aanmaken') +
    li([
      'Klik rechtsboven op <strong>+ Nieuwe keuring</strong>.',
      'Typ de klantnaam — bekende klanten verschijnen als lijst. Klik erop om gegevens in te vullen.',
      'Bij terugkerende klant zie je een blauw kader met eerdere bezoeken. Gebruik <strong>"↩ Gebruik als basis"</strong> om aantallen over te nemen.',
      'Vul de <strong>afgesproken sets</strong> in per type — uren worden automatisch berekend.',
      'Optioneel: koppel een <strong>keurmeester</strong> aan de keuring. Die ziet een blok in zijn personeelsbalk op de kalender.',
    ]) +

    s('✅ Werkelijk ontvangen sets') +
    p('Zodra de keuring binnenkomt: open de keuring en vul de werkelijke aantallen in via het groene kader. Dit is zichtbaar bij volgende afspraken van dezelfde klant.') +

    s('📋 Kanban bord') +
    li([
      '<strong>Intake → In behandeling → Klaar → Afgeleverd</strong>',
      'Keuringen mét afleverdatum staan bovenaan (vroegste eerst). Zonder datum: op volgorde van binnenkomst.',
    ]) +

    s('📅 Kalender') +
    li([
      'De <strong>capaciteitsbalk</strong> bovenin toont per dag de geplande keuringen (blauw = ingepland, grijs = wachtlijst, groen = vrij). Klik een segment om die keuring te openen.',
      'Personeelsbalken eronder tonen wie er die dag is. Klik op een naam om een <strong>losse afspraak</strong> in te plannen (bijv. NKB, leverancier, overleg).',
      'Klik op de dag zelf om tijden aan te passen, iemand vrij te zetten, of iemand <strong>extra toe te voegen</strong> voor die dag.',
      'Losse afspraken buiten normale werktijden? De balk rekt automatisch mee.',
    ]) +

    s('📆 Losse afspraken plannen') +
    li([
      'Klik op een naam in de personeelsbalk → vul titel, type, tijden en opmerkingen in.',
      'De afspraak verschijnt als gekleurd blok in de balk van die persoon.',
      'Afspraakuren worden automatisch afgetrokken van de keurmeestercapaciteit van die dag.',
    ]) +

    s('👤 ZZP\'ers & extra medewerkers') +
    li([
      'Markeer een medewerker als <strong>ZZP\'er</strong> via Personeel → bewerken. ZZP\'ers staan niet standaard ingepland.',
      'Voeg ze per dag toe via <strong>klik op de dag → "Toevoegen voor deze dag"</strong>.',
    ]) +

    s('🏖️ Afwezigheid & vakantiesaldo') +
    li([
      'Hele periodes: klik op <strong>🏖️ Afwezigheid</strong>.',
      'Paar uur: pas tijden aan via de kalender en geef de reden op.',
      'Saldo bekijken: tabblad <strong>🏖️ Uren</strong>. Vakantie-uren per jaar instellen via Personeel → medewerker bewerken.',
    ]) +

    s('👥 Personeel') +
    p('Voeg medewerkers toe, stel weekrooster in en geef aan of ze keurmeester zijn. Keurmeesters tellen mee in de dagcapaciteit.') +

    s('⚙️ Instellingen') +
    li([
      'Inloggen gaat via een e-mailadres en wachtwoord. Vergeten? Klik "Wachtwoord vergeten?" op het inlogscherm, dan krijg je een herstelmail.',
      'Voeg set-types of ruimtes toe die bij jullie situatie passen.',
      '<strong>iCal export</strong>: download een .ics bestand met alle afspraken en keuringen, importeerbaar in Google Agenda, Outlook of Apple Agenda.',
    ]) +

    s('📱 App installeren') +
    p('Telefoon: open in browser → tik <strong>Delen → Zet op beginscherm</strong>. Computer (Chrome): klik het installeer-icoon rechts in de adresbalk.') +

    '</div>';
  openModal(html, true);
}

// Actions
async function switchTab(tab) {
  state.activeTab = tab;
  if (tab === 'uren' && state.vakantieOverrides === null) {
    state.vakantieOverrides = await fetchVakantieOverrides(state.urenJaar);
  }
  render();
}
async function changeJobStatus(id, newStatus) {
  var job = state.jobs.find(function(j) { return j.id === id; }); if (!job) return;
  // De kaart verschuift meteen zodat het klikken vlot voelt, maar wordt
  // teruggezet als het opslaan niet lukt. Anders toont het bord een kolom
  // waar de keuring in de database niet staat, en zie je dat pas de volgende
  // keer dat je de app opent.
  var vorige = { status: job.status, gestartOp: job.gestartOp, gekeurdOp: job.gekeurdOp };
  job.status = newStatus;
  pasStatusDatumsAan(job);
  render();
  if (!(await saveKlus(job))) {
    job.status = vorige.status; job.gestartOp = vorige.gestartOp; job.gekeurdOp = vorige.gekeurdOp;
    render();  // meldDbFout heeft de melding al getoond
    return;
  }
  showToast(job.klant + ' → ' + STATUS_LABELS[newStatus]);
}
async function doDeleteJob(id) {
  if (!confirm('Weet je zeker dat je deze keuring wilt verwijderen?')) return;
  if (await deleteKlus(id)) { state.jobs = state.jobs.filter(function(j) { return j.id !== id; }); render(); showToast('Keuring verwijderd'); }
}
async function doArchiveerKlus(id) {
  if (await archiveerKlus(id)) {
    var job = state.jobs.find(function(j) { return j.id === id; });
    if (job) { job.gearchiveerd = true; state.jobs = state.jobs.filter(function(j) { return j.id !== id; }); state.archief.unshift(job); }
    render(); showToast('Keuring gearchiveerd 📁');
  }
}
async function doDeArchiveer(id) {
  if (await deArchiveerKlus(id)) {
    var job = state.archief.find(function(j) { return j.id === id; });
    if (job) { job.gearchiveerd = false; job.status = 'ingepland'; state.archief = state.archief.filter(function(j) { return j.id !== id; }); state.jobs.push(job); }
    render(); showToast('Keuring teruggezet naar Intake');
  }
}
async function toggleTodo(id, klaar) {
  var todo = state.todos.find(function(t) { return t.id === id; }); if (!todo) return;
  todo.klaar = klaar; render(); await saveTodo(todo);
}
async function doDeleteTodo(id) { if (await deleteTodo(id)) { state.todos = state.todos.filter(function(t) { return t.id !== id; }); render(); } }

// Day Override Modal
function openDayOverride(dateStr) {
  var staff = getStaffForDay(dateStr);
  var capOv = getCapOverrideForDay(dateStr);
  var cap = capacityForDay(dateStr);
  var html = '<div class="modal-header"><h2>📅 ' + formatDateFull(dateStr) + '</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body"><div class="form-section"><div class="section-title">👥 Personeel deze dag</div>' +
    '<div class="hint-text">Pas tijden aan voor deze dag. Wijzigingen gelden alleen voor deze datum.</div>';
  if (staff.length === 0) html += '<div class="empty-hint">Geen personeel geconfigureerd. Ga naar 👥 Personeel om medewerkers toe te voegen.</div>';
  else staff.forEach(function(s) {
    var absent = !s.aanwezig;
    var reden = absent ? getAfwezigheidReden(s.id, dateStr) : null;
    var ov = getDagOverrideForPerson(s.id, dateStr);
    var hasOverride = ov && (ov.start_override || ov.eind_override || ov.keuringsuren_override != null);
    html += '<div class="staff-day-edit-row ' + (absent ? 'staff-absent' : '') + '">' +
      '<div class="staff-day-edit-left">' +
      '<div class="staff-color-dot" style="background:' + s.kleur + '"></div>' +
      '<span class="staff-day-name">' + escHtml(s.naam) + (s.is_keurmeester ? ' 🔧' : '') + '</span>' +
      (absent ? '<span class="staff-day-badge absent">' + (ABSENCE_LABELS[reden] || 'Afwezig') + '</span>' : '') +
      (hasOverride ? '<span class="badge badge-override">aangepast</span>' : '') +
      '</div>';
    if (!absent) {
      var ovReden = ov ? (ov.reden || '') : '';
      var redenOpts = [['','— Roosterwijziging'],['vakantie','🏖️ Vakantie'],['verlof','📋 Verlof'],['ziek','🤒 Ziek']];
      html += '<div class="staff-day-edit-fields">' +
        '<input type="time" class="input-time" id="dov-start-' + s.id + '" value="' + s.start + '" />' +
        '<span>—</span>' +
        '<input type="time" class="input-time" id="dov-eind-' + s.id + '" value="' + s.eind + '" />';
      if (s.is_keurmeester) html += '<input type="number" step="0.5" class="input-num" id="dov-keur-' + s.id + '" value="' + s.keuringsuren + '" /><span class="unit">keur.u</span>';
      html += '<select class="input" style="font-size:12px;padding:2px 4px;height:28px" id="dov-reden-' + s.id + '">' +
        redenOpts.map(function(o) { return '<option value="' + o[0] + '"' + (ovReden === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
        '</select>';
      html += '<button class="btn-icon" title="Vrij deze dag" onclick="setDayPersonAbsent(\'' + dateStr + '\',' + s.id + ')">🚫</button>';
      html += '</div>';
    } else if (!reden) {
      // Absent via dag_override (not via afwezigheden), show undo button
      html += '<div class="staff-day-edit-fields"><button class="btn-sm" onclick="undoDayPersonAbsent(\'' + dateStr + '\',' + s.id + ')">↩ Toch aanwezig</button></div>';
    }
    html += '</div>';
  });
  // Medewerkers die deze dag NIET ingepland staan (ZZP'ers + regulier niet in rooster)
  var staffIds = staff.map(function(s) { return s.id; });
  var nietIngepland = state.personeel.filter(function(p) { return staffIds.indexOf(p.id) === -1; });
  if (nietIngepland.length > 0) {
    html += '</div><div class="form-section"><div class="section-title">➕ Toevoegen voor deze dag</div>' +
      '<div class="hint-text">Deze medewerkers staan niet in het rooster voor vandaag. Klik op "Toevoegen" om ze eenmalig in te plannen.</div>';
    nietIngepland.forEach(function(p) {
      var ov = getDagOverrideForPerson(p.id, dateStr);
      var isToegevoegd = ov && ov.aanwezig === true;
      html += '<div class="staff-day-row"><div class="staff-color-dot" style="background:' + p.kleur + '"></div>' +
        '<span class="staff-day-name">' + escHtml(p.naam) + (p.is_keurmeester ? ' 🔧' : '') + (p.is_zzper ? ' 🔑' : '') + '</span>';
      if (!isToegevoegd) {
        html += '<button class="btn-sm btn-accent" onclick="enableZzperForDay(\'' + dateStr + '\',' + p.id + ')">📥 Toevoegen</button>';
      } else {
        html += '<span class="badge badge-override">toegevoegd</span>' +
          '<button class="btn-icon" title="Verwijderen" onclick="undoDayPersonAbsent(\'' + dateStr + '\',' + p.id + ')">✕</button>';
      }
      html += '</div>';
    });
  }
  html += '</div><div class="form-section"><div class="section-title">📊 Capaciteit</div>' +
    '<div class="field-row center"><span class="filter-label">Berekend: ' + cap + 'u</span><span class="filter-label">|</span>' +
    '<span class="filter-label">Overschrijven:</span>' +
    '<input type="number" step="0.5" class="input-num" id="day-cap-input" value="' + (capOv && capOv.capaciteit_override != null ? capOv.capaciteit_override : '') + '" placeholder="' + cap + '" />' +
    '<span class="unit">uur</span></div></div></div>' +
    '<div class="modal-footer"><button class="btn-primary" onclick="saveDayOverrides(\'' + dateStr + '\')">✓ Opslaan</button>' +
    (capOv ? '<button class="btn-sm" onclick="resetDayCapOverride(' + capOv.id + ',\'' + dateStr + '\')">Reset capaciteit</button>' : '') + '</div>';
  openModal(html);
}
async function saveDayOverrides(dateStr) {
  var promises = [];
  state.personeel.forEach(function(p) {
    var startEl = document.getElementById('dov-start-' + p.id);
    var eindEl = document.getElementById('dov-eind-' + p.id);
    var keurEl = document.getElementById('dov-keur-' + p.id);
    if (!startEl || !eindEl) return;
    var dk = dayKey(dateStr);
    var rooster = p.weekrooster && p.weekrooster[dk];
    var origStart = rooster ? rooster.start : '09:00';
    var origEind = rooster ? rooster.eind : '17:00';
    var origKeur = (rooster && rooster.keuringsuren != null) ? rooster.keuringsuren : 4;
    var newStart = startEl.value;
    var newEind = eindEl.value;
    var newKeur = keurEl ? parseFloat(keurEl.value) : null;
    var redenEl = document.getElementById('dov-reden-' + p.id);
    var newReden = redenEl ? redenEl.value : '';
    if (newStart !== origStart || newEind !== origEind || (newKeur !== null && newKeur !== origKeur) || newReden) {
      promises.push(saveDagOverride({
        datum: dateStr, persoon_id: p.id,
        start_override: newStart, eind_override: newEind,
        keuringsuren_override: newKeur, reden: newReden || null
      }));
    }
  });
  // Save capacity override
  var capVal = (document.getElementById('day-cap-input') || {}).value;
  if (capVal !== '' && capVal !== undefined) {
    promises.push(saveDagOverride({ datum: dateStr, persoon_id: null, capaciteit_override: parseFloat(capVal) }));
  }
  if (promises.length > 0) await Promise.all(promises);
  await reloadDagOverrides(); closeModal(); render(); showToast('Dag aangepast ✓');
}
async function setDayPersonAbsent(dateStr, persoonId) {
  await saveDagOverride({ datum: dateStr, persoon_id: persoonId, aanwezig: false });
  await reloadDagOverrides(); closeModal(); render();
  openDayOverride(dateStr); showToast('Vrij gezet voor deze dag');
}
async function undoDayPersonAbsent(dateStr, persoonId) {
  var ov = getDagOverrideForPerson(persoonId, dateStr);
  if (ov) await deleteDagOverride(ov.id);
  await reloadDagOverrides(); closeModal(); render();
  openDayOverride(dateStr); showToast('Weer aanwezig');
}
async function enableZzperForDay(dateStr, persoonId) {
  var p = state.personeel.find(function(x) { return x.id === persoonId; });
  // Gebruik standaard rooster-uren van een actieve dag, anders 09:00-17:00
  var defaultStart = '09:00', defaultEind = '17:00', defaultKeur = p && p.is_keurmeester ? 4 : 0;
  if (p && p.weekrooster) {
    var activeDag = DAY_NAMES.find(function(d) { return p.weekrooster[d] && p.weekrooster[d].actief; });
    if (activeDag) {
      defaultStart = p.weekrooster[activeDag].start || '09:00';
      defaultEind = p.weekrooster[activeDag].eind || '17:00';
      defaultKeur = p.weekrooster[activeDag].keuringsuren != null ? p.weekrooster[activeDag].keuringsuren : defaultKeur;
    }
  }
  await saveDagOverride({
    datum: dateStr, persoon_id: persoonId, aanwezig: true,
    start_override: defaultStart, eind_override: defaultEind,
    keuringsuren_override: defaultKeur
  });
  await reloadDagOverrides(); closeModal(); render();
  openDayOverride(dateStr); showToast((p ? p.naam : 'Medewerker') + ' toegevoegd voor ' + formatDateShort(dateStr));
}
async function saveDayCapOverride(dateStr) {
  var val = (document.getElementById('day-cap-input') || {}).value;
  if (val === '' || val === undefined) { closeModal(); return; }
  await saveDagOverride({ datum: dateStr, persoon_id: null, capaciteit_override: parseFloat(val) });
  await reloadDagOverrides(); closeModal(); render(); showToast('Capaciteit aangepast');
}
async function resetDayCapOverride(id) {
  await deleteDagOverride(id);
  await reloadDagOverrides(); closeModal(); render(); showToast('Teruggezet naar berekend');
}

// Afspraak Modal
function renderAfspraakPersonenField(type, persoonId, personen_ids) {
  if (type === 'intern') {
    var html = '<label>Personen (meerdere selecteerbaar)</label><div class="personen-checkboxes">';
    state.personeel.forEach(function(p) {
      var checked = (Array.isArray(personen_ids) && personen_ids.includes(p.id)) || (!personen_ids && p.id === persoonId) ? ' checked' : '';
      html += '<label class="checkbox-label"><input type="checkbox" class="af2-persoon-check" value="' + p.id + '"' + checked + '><span class="person-dot" style="background:' + p.kleur + '"></span>' + escHtml(p.naam) + '</label>';
    });
    html += '</div>';
    return html;
  }
  var opties = state.personeel.map(function(p) {
    var sel = p.id === persoonId ? ' selected' : '';
    return '<option value="' + p.id + '"' + sel + '>' + escHtml(p.naam) + '</option>';
  }).join('');
  return '<label>Persoon</label><select class="input" id="af2-persoon">' + opties + '</select>';
}

function updateAfspraakPersonenField() {
  var type = (document.getElementById('af2-type') || {}).value;
  var wrap = document.getElementById('af2-persoon-wrap');
  if (!wrap) return;
  var currentPersoonId = null;
  var currentPersonenIds = [];
  var singleSel = document.getElementById('af2-persoon');
  if (singleSel) currentPersoonId = parseInt(singleSel.value) || null;
  document.querySelectorAll('.af2-persoon-check:checked').forEach(function(cb) { currentPersonenIds.push(parseInt(cb.value)); });
  wrap.innerHTML = renderAfspraakPersonenField(type, currentPersoonId || currentPersonenIds[0] || null, currentPersonenIds.length ? currentPersonenIds : null);
}

function openAfspraakModal(persoonId, dateStr, afspraakId) {
  var afspraak = afspraakId ? state.afspraken.find(function(a) { return a.id === afspraakId; }) : null;
  var isNew = !afspraak;
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var defaultStart = hh + ':' + mm;
  var defaultEindH = String((now.getHours() + 1) % 24).padStart(2, '0');
  var defaultEind = defaultEindH + ':' + mm;

  var currentType = afspraak ? afspraak.type : 'klant';
  var currentPersoonId = afspraak ? afspraak.persoon_id : persoonId;
  var currentPersonenIds = afspraak ? (afspraak.personen_ids || null) : null;

  var typeOpties = [['klant', '🤝 Klant'], ['leverancier', '🚚 Leverancier'], ['intern', '🏢 Intern']].map(function(t) {
    var sel = currentType === t[0] ? ' selected' : '';
    return '<option value="' + t[0] + '"' + sel + '>' + t[1] + '</option>';
  }).join('');

  var html = '<div class="modal-header"><h2>' + (isNew ? '📅 Nieuwe afspraak' : '✏️ Afspraak bewerken') + '</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body">' +
    '<div class="form-section">' +
    '<div class="field"><label>Type</label><select class="input" id="af2-type" onchange="updateAfspraakPersonenField()">' + typeOpties + '</select></div>' +
    '<div class="field" id="af2-persoon-wrap">' + renderAfspraakPersonenField(currentType, currentPersoonId, currentPersonenIds) + '</div>' +
    '<div class="field"><label>Datum</label><input type="date" class="input" id="af2-datum" value="' + (afspraak ? afspraak.datum : (dateStr || todayStr())) + '" /></div>' +
    '<div class="field"><label>Titel *</label><input class="input" id="af2-titel" value="' + escHtml(afspraak ? afspraak.titel : '') + '" placeholder="Bijv. Klantbezoek, Leveranciersgesprek..." /></div>' +
    '<div class="form-grid-2"><div class="field"><label>Begintijd</label><input type="time" class="input" id="af2-start" value="' + (afspraak ? afspraak.start_tijd : defaultStart) + '" /></div>' +
    '<div class="field"><label>Eindtijd</label><input type="time" class="input" id="af2-eind" value="' + (afspraak ? afspraak.eind_tijd : defaultEind) + '" /></div></div>' +
    '<div class="field"><label>Opmerkingen</label><textarea class="input textarea" id="af2-opmerking" placeholder="Optionele toelichting...">' + escHtml(afspraak ? afspraak.opmerkingen : '') + '</textarea></div>' +
    '</div></div>' +
    '<div class="modal-footer"><button class="btn-primary" onclick="submitAfspraak(' + (afspraak ? afspraak.id : 'null') + ')">✓ ' + (isNew ? 'Opslaan' : 'Bijwerken') + '</button>' +
    (!isNew ? '<button class="btn-sm btn-delete" onclick="doDeleteAfspraak(' + afspraak.id + ')">🗑 Verwijderen</button>' : '') + '</div>';
  openModal(html);
}

async function submitAfspraak(editId) {
  var type = (document.getElementById('af2-type') || {}).value || 'klant';
  var persoonId, personen_ids;
  if (type === 'intern') {
    var checks = Array.from(document.querySelectorAll('.af2-persoon-check:checked'));
    personen_ids = checks.map(function(cb) { return parseInt(cb.value); });
    if (personen_ids.length === 0) { showToast('Selecteer minimaal één persoon!', 'error'); return; }
    persoonId = personen_ids[0];
  } else {
    persoonId = parseInt((document.getElementById('af2-persoon') || {}).value);
    personen_ids = null;
  }
  var datum = (document.getElementById('af2-datum') || {}).value;
  var titel = ((document.getElementById('af2-titel') || {}).value || '').trim();
  var start = (document.getElementById('af2-start') || {}).value;
  var eind = (document.getElementById('af2-eind') || {}).value;
  var opmerkingen = (document.getElementById('af2-opmerking') || {}).value || '';
  if (!titel) { showToast('Titel is verplicht!', 'error'); return; }
  if (!datum) { showToast('Datum is verplicht!', 'error'); return; }
  var a = { persoon_id: persoonId, datum: datum, type: type, titel: titel, start_tijd: start, eind_tijd: eind, opmerkingen: opmerkingen, personen_ids: personen_ids };
  if (editId) a.id = editId;
  var saved = await saveAfspraak(a);
  if (saved) {
    if (editId) state.afspraken = state.afspraken.map(function(x) { return x.id === editId ? saved : x; });
    else state.afspraken.push(saved);
    closeModal(); render(); showToast('Afspraak opgeslagen ✓');
  }
}

async function doDeleteAfspraak(id) {
  if (!confirm('Weet je zeker dat je deze afspraak wilt verwijderen?')) return;
  if (await deleteAfspraak(id)) {
    state.afspraken = state.afspraken.filter(function(a) { return a.id !== id; });
    closeModal(); render(); showToast('Afspraak verwijderd');
  }
}

// Personeel Modal
function openPersoneelModal() { renderPersoneelModal(); }
function renderPersoneelModal() {
  var html = '<div class="modal-header"><h2>👥 Personeel</h2><button class="btn-close" onclick="closeModal()">✕</button></div><div class="modal-body">';
  state.personeel.forEach(function(p) {
    html += '<div class="staff-card"><div class="staff-card-header">' +
      '<div class="staff-color-dot" style="background:' + p.kleur + '"></div>' +
      '<span class="staff-card-name">' + escHtml(p.naam) + '</span>' +
      (p.is_keurmeester ? '<span class="badge badge-keur">🔧 Keurmeester</span>' : '<span class="badge badge-other">Overig</span>') +
      '<button class="btn-sm" onclick="openEditPersoneelModal(' + p.id + ')">✏️ Bewerken</button></div>' +
      '<div class="staff-card-rooster">';
    DAY_NAMES.forEach(function(d, di) {
      var r = p.weekrooster && p.weekrooster[d];
      if (r && r.actief) html += '<span class="rooster-day active">' + DAY_NAMES_FULL[di].substring(0, 2) + ' ' + r.start + '-' + r.eind + (p.is_keurmeester ? ' (' + r.keuringsuren + 'u)' : '') + '</span>';
      else html += '<span class="rooster-day off">' + DAY_NAMES_FULL[di].substring(0, 2) + ' vrij</span>';
    });
    html += '</div></div>';
  });
  if (state.personeel.length === 0) html += '<div class="empty-state">Nog geen personeel. Voeg je eerste medewerker toe!</div>';
  html += '</div><div class="modal-footer"><button class="btn-primary" onclick="openEditPersoneelModal(null)">+ Medewerker toevoegen</button></div>';
  var existing = document.querySelector('.modal-overlay');
  if (existing) existing.querySelector('.modal-content').innerHTML = html;
  else openModal(html, true);
}

function openEditPersoneelModal(id) {
  var isNew = id === null;
  var p = isNew ? { naam: '', kleur: STAFF_COLORS[state.personeel.length % STAFF_COLORS.length], is_keurmeester: false,
    weekrooster: { ma:{actief:true,start:'09:00',eind:'17:00',keuringsuren:4}, di:{actief:true,start:'09:00',eind:'17:00',keuringsuren:4},
      wo:{actief:true,start:'09:00',eind:'17:00',keuringsuren:4}, do:{actief:true,start:'09:00',eind:'17:00',keuringsuren:4},
      vr:{actief:true,start:'09:00',eind:'17:00',keuringsuren:4} }
  } : state.personeel.find(function(x) { return x.id === id; });
  if (!p) return;
  window._editPerson = JSON.parse(JSON.stringify(p));
  window._editPersonIsNew = isNew;
  renderEditPersoneelForm();
}

function syncPersoneelForm() {
  var nameEl = document.getElementById('ep-naam');
  if (nameEl) window._editPerson.naam = nameEl.value;
}
function renderEditPersoneelForm() {
  syncPersoneelForm();
  var p = window._editPerson;
  var isNew = window._editPersonIsNew;
  var html = '<div class="modal-header"><h2>' + (isNew ? '➕ Nieuwe medewerker' : '✏️ ' + escHtml(p.naam)) + '</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body"><div class="form-section"><div class="form-grid-2">' +
    '<div class="field"><label>Naam *</label><input class="input" id="ep-naam" value="' + escHtml(p.naam) + '" placeholder="Voornaam" /></div>' +
    '<div class="field"><label>Kleur</label><div class="color-picker">' +
    STAFF_COLORS.map(function(c) { return '<div class="color-opt ' + (p.kleur === c ? 'selected' : '') + '" style="background:' + c + '" onclick="window._editPerson.kleur=\'' + c + '\'; renderEditPersoneelForm()"></div>'; }).join('') +
    '</div></div></div>' +
    '<div class="toggle-row" style="margin-top:8px" onclick="window._editPerson.is_keurmeester = !window._editPerson.is_keurmeester; renderEditPersoneelForm();">' +
    '<div class="toggle-switch ' + (p.is_keurmeester ? 'on' : '') + '"><div class="toggle-dot"></div></div>' +
    '<span class="toggle-label">' + (p.is_keurmeester ? '🔧 Keurmeester — draagt bij aan capaciteit' : 'Geen keurmeester') + '</span></div>' +
    '<div class="toggle-row" style="margin-top:8px" onclick="window._editPerson.is_zzper = !window._editPerson.is_zzper; renderEditPersoneelForm();">' +
    '<div class="toggle-switch ' + (p.is_zzper ? 'on' : '') + '"><div class="toggle-dot"></div></div>' +
    '<span class="toggle-label">' + (p.is_zzper ? '🔑 ZZP\'er — standaard niet ingepland, per dag in te schakelen via de kalender' : 'Geen ZZP\'er') + '</span></div>' +
    '<div class="field" style="margin-top:10px"><label>🎂 Verjaardag <span style="color:#6B7280;font-weight:400">(dag en maand, jaar niet zichtbaar)</span></label>' +
    '<input type="date" class="input" style="max-width:180px" value="' + (p.geboortedatum || '') + '" onchange="window._editPerson.geboortedatum=this.value||null" /></div>' +
    (!p.is_zzper ? (
      '<div class="form-section"><div class="section-title">⏱️ Uren & verlof</div>' +
      '<div class="field"><label>Contracturen / week</label>' +
      '<div class="field-row compact"><input type="number" step="0.5" class="input-num" style="width:70px" value="' + (p.contract_uren_per_week || '') + '" placeholder="32" onchange="window._editPerson.contract_uren_per_week=parseFloat(this.value)||null" /><span class="unit">u/week</span>' +
      '<span class="hint-text" style="margin-left:8px">Feitelijk gewerkt komt uit het weekrooster. Verschil bouwt ADV op.</span></div></div>' +
      '<div class="field"><label>🏖️ Vakantie-uren per jaar <span style="color:#6B7280;font-weight:400">(leeg = automatisch 5 wk × contracturen)</span></label>' +
      '<div class="field-row compact"><input type="number" step="1" class="input-num" style="width:70px" value="' + (p.vakantie_uren_per_jaar != null ? p.vakantie_uren_per_jaar : '') + '" placeholder="auto" onchange="window._editPerson.vakantie_uren_per_jaar=this.value===\'\'?null:(parseFloat(this.value)||0)" /><span class="unit">uur</span>' +
      '<span class="hint-text" style="margin-left:8px">handmatige override</span></div></div>' +
      '</div>'
    ) : '') +
    '</div>' +
    '<div class="form-section"><div class="section-title">📅 Weekrooster</div>';
  DAY_NAMES.forEach(function(d, di) {
    var r = p.weekrooster[d];
    html += '<div class="rooster-edit-row"><label class="rooster-toggle">' +
      '<input type="checkbox" ' + (r.actief ? 'checked' : '') + ' onchange="window._editPerson.weekrooster[\'' + d + '\'].actief = this.checked; renderEditPersoneelForm();" />' +
      '<span class="rooster-day-label">' + DAY_NAMES_FULL[di] + '</span></label>';
    if (r.actief) {
      html += '<input type="time" class="input-time" value="' + r.start + '" onchange="window._editPerson.weekrooster[\'' + d + '\'].start = this.value" /> <span>—</span> ' +
        '<input type="time" class="input-time" value="' + r.eind + '" onchange="window._editPerson.weekrooster[\'' + d + '\'].eind = this.value" />';
      if (p.is_keurmeester) html += ' <input type="number" step="0.5" class="input-num" value="' + r.keuringsuren + '" onchange="window._editPerson.weekrooster[\'' + d + '\'].keuringsuren = parseFloat(this.value) || 0" /><span class="unit">keur.uren</span>';
    } else html += '<span class="rooster-off">Vrij</span>';
    html += '</div>';
  });
  html += '</div></div><div class="modal-footer"><button class="btn-primary" onclick="saveEditPersoneel()">✓ ' + (isNew ? 'Toevoegen' : 'Opslaan') + '</button>' +
    (!isNew ? '<button class="btn-sm btn-delete" onclick="doDeletePersoneel(' + p.id + ')">🗑 Verwijderen</button>' : '') + '</div>';
  var existing = document.querySelector('.modal-overlay');
  if (existing) existing.querySelector('.modal-content').innerHTML = html;
  else openModal(html, true);
}

async function saveEditPersoneel() {
  var p = window._editPerson;
  var nameEl = document.getElementById('ep-naam');
  if (nameEl) p.naam = nameEl.value.trim();
  if (!p.naam) { showToast('Naam is verplicht!', 'error'); return; }
  var saved = await savePersoneelslid(p);
  if (saved) {
    if (window._editPersonIsNew) state.personeel.push(saved);
    else state.personeel = state.personeel.map(function(x) { return x.id === saved.id ? saved : x; });
    closeModal(); render(); showToast(window._editPersonIsNew ? 'Medewerker toegevoegd!' : 'Medewerker opgeslagen');
  }
}
async function doDeletePersoneel(id) {
  if (!confirm('Weet je zeker dat je dit personeelslid wilt verwijderen?')) return;
  if (await deletePersoneelslid(id)) { state.personeel = state.personeel.filter(function(p) { return p.id !== id; }); closeModal(); render(); showToast('Medewerker verwijderd'); }
}

// Afwezigheid Modal
function openMaandPicker() {
  var maandNamen = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  var today = new Date();
  var curYear = today.getFullYear();
  // Toon 3 jaar: vorig jaar, dit jaar, volgend jaar
  var years = [curYear - 1, curYear, curYear + 1];
  var html = '<div class="modal-header"><h2>📅 Ga naar maand</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body">';
  years.forEach(function(jaar) {
    html += '<div style="margin-bottom:16px"><div style="font-weight:600;margin-bottom:8px">' + jaar + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">';
    maandNamen.forEach(function(naam, mi) {
      // Bereken offset: eerste maandag van die maand t.o.v. huidige maandag
      var target = new Date(jaar, mi, 1);
      var targetMonday = getMondayOfWeek(toDateStr(target));
      var todayMonday = getMondayOfWeek(toDateStr(today));
      var diffMs = parseDate(targetMonday) - parseDate(todayMonday);
      var diffWeken = Math.round(diffMs / (7 * 24 * 3600 * 1000));
      var isHuidig = (jaar === today.getFullYear() && mi === today.getMonth());
      html += '<button class="btn-sm' + (isHuidig ? ' active' : '') + '" style="' + (isHuidig ? 'font-weight:700;' : '') + '" ' +
        'onclick="closeModal();gaNaarKalenderPeriode(' + diffWeken + ')">' + naam + '</button>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  openModal(html);
}

function openAfwezigheidModal() {
  var html = '<div class="modal-header"><h2>🏖️ Afwezigheden</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body"><div class="form-section"><div class="section-title">Nieuwe afwezigheid plannen</div>' +
    '<div class="form-grid-2"><div class="field"><label>Wie</label><select class="input" id="af-persoon">' +
    state.personeel.map(function(p) { return '<option value="' + p.id + '">' + escHtml(p.naam) + '</option>'; }).join('') +
    '</select></div><div class="field"><label>Reden</label>' +
    '<select class="input" id="af-reden"><option value="vakantie">🏖️ Vakantie</option><option value="adv">⏱️ ADV</option><option value="verlof">📋 Verlof</option><option value="ziek">🤒 Ziek</option><option value="anders">📋 Anders</option></select></div></div>' +
    '<div class="form-grid-2"><div class="field"><label>Van</label><input type="date" class="input" id="af-van" value="' + todayStr() + '" /></div>' +
    '<div class="field"><label>Tot en met</label><input type="date" class="input" id="af-tot" value="' + todayStr() + '" /></div></div>' +
    '<div class="field"><label>Notitie</label><input class="input" id="af-notitie" placeholder="Optioneel..." /></div>' +
    '<button class="btn-primary" onclick="saveNewAfwezigheid()" style="margin-top:8px">+ Plannen</button></div>' +
    '<div class="form-section"><div class="section-title">Geplande afwezigheden</div>';
  var upcoming = state.afwezigheden.filter(function(a) { return a.tot_datum >= todayStr(); });
  if (upcoming.length === 0) html += '<div class="empty-hint">Geen geplande afwezigheden</div>';
  else upcoming.forEach(function(a) {
    var persoon = state.personeel.find(function(p) { return p.id === a.persoon_id; });
    html += '<div class="afwezigheid-row"><div class="staff-color-dot" style="background:' + (persoon ? persoon.kleur : '#999') + '"></div>' +
      '<span>' + escHtml(persoon ? persoon.naam : '?') + '</span>' +
      '<span class="badge">' + (ABSENCE_LABELS[a.reden] || a.reden) + '</span>' +
      '<span>' + formatDateShort(a.van_datum) + ' — ' + formatDateShort(a.tot_datum) + '</span>' +
      (a.notitie ? '<span class="text-muted">' + escHtml(a.notitie) + '</span>' : '') +
      '<button class="btn-icon" onclick="doDeleteAfwezigheid(' + a.id + ')">✕</button></div>';
  });
  html += '</div></div>';
  openModal(html, true);
}
async function saveNewAfwezigheid() {
  var pid = parseInt((document.getElementById('af-persoon') || {}).value);
  var van = (document.getElementById('af-van') || {}).value;
  var tot = (document.getElementById('af-tot') || {}).value;
  var reden = (document.getElementById('af-reden') || {}).value || 'vakantie';
  var notitie = (document.getElementById('af-notitie') || {}).value || '';
  if (!pid || !van || !tot) { showToast('Vul alle velden in', 'error'); return; }
  if (tot < van) { showToast('Tot-datum moet na van-datum liggen', 'error'); return; }
  var saved = await saveAfwezigheid({ persoon_id: pid, van_datum: van, tot_datum: tot, reden: reden, notitie: notitie });
  if (saved) { state.afwezigheden.push(saved); closeModal(); render(); showToast('Afwezigheid gepland'); }
}
async function doDeleteAfwezigheid(id) {
  if (await deleteAfwezigheid(id)) { state.afwezigheden = state.afwezigheden.filter(function(a) { return a.id !== id; }); closeModal(); render(); showToast('Afwezigheid verwijderd'); }
}

// Job Modal
function syncFormToModal() {
  var form = window._modalForm; if (!form) return;
  var el = function(id) { return document.getElementById(id); };
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
  if (el('jf-persoon')) form.persoonId = el('jf-persoon').value ? parseInt(el('jf-persoon').value) : null;
  if (el('jf-op-locatie')) form.opLocatie = el('jf-op-locatie').checked;
  form.heeftAfspraak = !!(form.retourDatum);
  form.afspraakDatum = form.retourDatum || '';
  document.querySelectorAll('.set-type-input').forEach(function(inp) { form.aantallen[inp.dataset.typeId] = parseInt(inp.value) || 0; });
  var werkelijkInputs = document.querySelectorAll('.set-type-werkelijk-input');
  if (werkelijkInputs.length > 0) {
    if (!form.aantallenWerkelijk) form.aantallenWerkelijk = {};
    werkelijkInputs.forEach(function(inp) { form.aantallenWerkelijk[inp.dataset.typeId] = parseInt(inp.value) || 0; });
  }
}

function openNieuweKeuringVanafKalender(dateStr, persoonId) {
  var emptyAantallen = {}; state.settings.setTypes.forEach(function(st) { emptyAantallen[st.id] = 0; });
  window._modalForm = {
    klant:'', klantNummer:'', telefoon:'', omschrijving:'', aantallen: emptyAantallen,
    heeftAfspraak: false, status:'ingepland', geschatteUren: 0,
    afspraakDatum: '', afspraakTijd: '',
    binnenkomstWijze:'', binnenkomstDatum: dateStr, binnenkomstTijd: nowTimeStr(),
    retourWijze:'', retourDatum:'', retourTijd:'',
    afkeurBeleid:'', afkeurToelichting:'', contactLog:[], notities:'', opLocatie: false,
    persoonId: persoonId || null,
  };
  window._modalIsNew = true; window._modalIsArchief = false;
  renderJobModalContent();
}

function openJobModal(id, isArchief) {
  var isNew = id === null;
  var job = isNew ? null : (isArchief ? state.archief : state.jobs).find(function(j) { return j.id === id; });
  var emptyAantallen = {}; state.settings.setTypes.forEach(function(st) { emptyAantallen[st.id] = 0; });
  var form = job ? JSON.parse(JSON.stringify(job)) : { klant:'',klantNummer:'',telefoon:'',omschrijving:'',aantallen:emptyAantallen,
    heeftAfspraak:false,status:'ingepland',geschatteUren:0,afspraakDatum:'',afspraakTijd:'',
    binnenkomstWijze:'',binnenkomstDatum:todayStr(),binnenkomstTijd:nowTimeStr(),
    retourWijze:'',retourDatum:'',retourTijd:'',afkeurBeleid:'',afkeurToelichting:'',contactLog:[],notities:'',opLocatie:false };
  if (job) { form.aantallen = Object.assign({}, emptyAantallen, form.aantallen || {}); form.contactLog = form.contactLog ? form.contactLog.slice() : []; }
  window._modalForm = form; window._modalIsNew = isNew; window._modalIsArchief = !!isArchief;
  renderJobModalContent();
}

function renderJobModalContent(skipSync) {
  if (!skipSync) syncFormToModal();
  var form = window._modalForm, isNew = window._modalIsNew, isArchief = window._modalIsArchief;
  var totalItems = Object.values(form.aantallen).reduce(function(s,v) { return s + (v||0); }, 0);
  var setTypesHtml = state.settings.setTypes.map(function(st) {
    return '<div class="set-type-row"><span class="set-type-label">' + escHtml(st.label) + '</span>' +
      '<input type="number" min="0" class="input-num set-type-input" data-type-id="' + st.id + '" value="' + (form.aantallen[st.id] || 0) + '" onchange="updateJobAantallen()" /></div>';
  }).join('');
  var totalWerkelijk = form.aantallenWerkelijk ? Object.values(form.aantallenWerkelijk).reduce(function(s,v){return s+(v||0);},0) : 0;
  var setTypesWerkelijkHtml = state.settings.setTypes.map(function(st) {
    var val = (form.aantallenWerkelijk && form.aantallenWerkelijk[st.id]) || 0;
    return '<div class="set-type-row"><span class="set-type-label">' + escHtml(st.label) + '</span>' +
      '<input type="number" min="0" class="input-num set-type-werkelijk-input" data-type-id="' + st.id + '" value="' + val + '" onchange="updateJobAantallenWerkelijk()" /></div>';
  }).join('');
  var afkeurHtml = AFKEUR_OPTIES.map(function(opt) {
    return '<label class="radio-option ' + (form.afkeurBeleid === opt ? 'selected' : '') + '">' +
      '<input type="radio" name="afkeur" value="' + escHtml(opt) + '" ' + (form.afkeurBeleid === opt ? 'checked' : '') +
      ' onchange="window._modalForm.afkeurBeleid = this.value; renderJobModalContent();" /><span>' + escHtml(opt) + '</span></label>';
  }).join('');
  var statusHtml = STATUSES.map(function(s) { return '<option value="' + s + '" ' + (form.status === s ? 'selected' : '') + '>' + STATUS_LABELS[s] + '</option>'; }).join('');
  var contactHtml = (form.contactLog || []).slice().reverse().map(function(entry, i) {
    return '<div class="contact-entry"><span class="contact-date">' + formatDateShort(entry.datum) + ' ' + (entry.tijd || '') + '</span>' +
      '<span class="contact-text">' + escHtml(entry.tekst) + '</span>' +
      '<button class="btn-icon" onclick="removeContactEntry(' + (form.contactLog.length - 1 - i) + ')">✕</button></div>';
  }).join('');
  var deadlineHint = form.retourDatum ? '📅 Afleverdatum ingevuld → wordt ingepland met voorrang' : '💡 Vul een datum in als er een afspraak is — dan krijgt deze keuring voorrang';

  var html = '<div class="modal-header"><h2>' + (isNew ? '📥 Nieuwe keuring' : '✏️ Keuring bewerken') + '</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body job-form">' +
    '<div class="form-section"><div class="section-title">👤 Klantgegevens</div>' +
    '<div class="form-grid-2-1"><div class="field"><label>Klantnaam *</label>' +
    '<div style="position:relative">' +
    '<input class="input" id="jf-klant" value="' + escHtml(form.klant) + '" placeholder="Typ naam of klantnummer..." autocomplete="off" oninput="zoekKlantAutocomplete(this.value)" onblur="setTimeout(sluitKlantDropdown,200)" />' +
    '<div id="klant-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #E5E7EB;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:999;max-height:280px;overflow-y:auto"></div>' +
    '</div></div>' +
    '<div class="field"><label>Klantnummer</label><input class="input" id="jf-klantnr" value="' + escHtml(form.klantNummer) + '" placeholder="K-1042" /></div></div>' +
    '<div class="form-grid-2"><div class="field"><label>Telefoon</label><input class="input" id="jf-tel" value="' + escHtml(form.telefoon) + '" placeholder="06-12345678" /></div>' +
    '<div class="field"><label>Omschrijving</label><input class="input" id="jf-omschr" value="' + escHtml(form.omschrijving) + '" placeholder="Korte omschrijving" /></div></div></div>' +
    '<div id="klant-historiek-section"></div>' +
    '<div class="form-section"><div class="section-title">📦 Afgesproken sets</div><div class="set-types-grid">' + setTypesHtml + '</div>' +
    '<div class="set-types-total"><span>Totaal: <strong>' + totalItems + ' items</strong></span>' +
    '<div class="field-row"><span>Uren:</span><input type="number" step="0.5" class="input-num" id="jf-uren" value="' + form.geschatteUren + '" onchange="window._modalForm.geschatteUren = parseFloat(this.value) || 0" /></div></div></div>' +
    (!isNew ? '<div class="form-section" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px">' +
    '<div class="section-title" style="color:#166534">✅ Werkelijk ontvangen sets</div>' +
    '<div class="hint-text" style="margin-bottom:8px">Vul in wat de klant écht heeft meegebracht — wordt zichtbaar in de klanthistoriek</div>' +
    '<div class="set-types-grid">' + setTypesWerkelijkHtml + '</div>' +
    (function() { var totalMinW = 0; state.settings.setTypes.forEach(function(st) { totalMinW += ((form.aantallenWerkelijk && form.aantallenWerkelijk[st.id]) || 0) * st.minuten; }); var urenW = Math.round((totalMinW/60)*10)/10; return '<div class="set-types-total"><span>Totaal werkelijk: <strong id="werkelijk-totaal">' + totalWerkelijk + ' sets' + (totalWerkelijk > 0 ? ' · ' + urenW + 'u' : '') + '</strong></span></div></div>'; })() : '') +
    '<div class="form-section"><div class="section-title">🚫 Bij afkeur</div><div class="afkeur-options">' + afkeurHtml + '</div>' +
    '<input class="input" id="jf-afkeur-toel" value="' + escHtml(form.afkeurToelichting) + '" placeholder="Aanvullende afspraken bij afkeur..." /></div>' +
    '<div class="form-section"><div class="section-title">🔄 Binnenkomst & Aflevering</div><div class="form-grid-2">' +
    '<div><div class="sub-label">BINNENKOMST</div><input class="input mb-4" id="jf-binn-wijze" value="' + escHtml(form.binnenkomstWijze) + '" placeholder="Klant brengt, post, wij halen..." />' +
    '<div class="form-grid-2"><input type="date" class="input" id="jf-binn-datum" value="' + (form.binnenkomstDatum || '') + '" /><input type="time" class="input" id="jf-binn-tijd" value="' + (form.binnenkomstTijd || '') + '" /></div></div>' +
    '<div><div class="sub-label">AFLEVERING KLANT</div><input class="input mb-4" id="jf-ret-wijze" value="' + escHtml(form.retourWijze) + '" placeholder="Klant haalt op, post, wij brengen..." />' +
    '<div class="form-grid-2"><input type="date" class="input" id="jf-ret-datum" value="' + (form.retourDatum || '') + '" /><input type="time" class="input" id="jf-ret-tijd" value="' + (form.retourTijd || '') + '" /></div>' +
    '<div class="deadline-hint">' + deadlineHint + '</div></div></div>' +
    '<div class="field" style="margin-top:10px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:normal">' +
    '<input type="checkbox" id="jf-op-locatie"' + (form.opLocatie ? ' checked' : '') + ' onchange="syncFormToModal();renderJobModalContent(true)" />' +
    '🚗 Op locatie — keuring vindt plaats bij klant ter plaatse</label></div>' +
    (state.personeel.filter(function(p){return p.is_keurmeester;}).length > 0
      ? '<div class="field" style="margin-top:6px"><label>🔧 Toegewezen keurmeester' + (form.opLocatie ? ' <span style="color:#dc2626">*</span>' : ' (optioneel)') + '</label>' +
        '<select class="input" id="jf-persoon">' +
        '<option value="">— Niet toegewezen</option>' +
        state.personeel.filter(function(p){return p.is_keurmeester;}).map(function(p){
          return '<option value="' + p.id + '"' + (form.persoonId === p.id ? ' selected' : '') + '>' + escHtml(p.naam) + '</option>';
        }).join('') +
        '</select><div class="hint-text" style="margin-top:4px">' + (form.opLocatie ? '🚗 Uren tellen als extra keurcapaciteit voor de dag van de afleverdatum' : 'Wanneer gekoppeld verschijnt de keuring als blok op de binnenkomsttijd in de tijdsbalk') + '</div></div>'
      : '') +
    '</div>';
  if (!isNew) {
    html += '<div class="form-section"><div class="field"><label>Status</label><select class="input" id="jf-status">' + statusHtml + '</select></div></div>' +
      '<div class="form-section"><div class="section-title-row"><span class="section-title">📞 Klantcontact</span>' +
      '<button class="btn-sm btn-accent" onclick="addContactEntry()">+ Moment toevoegen</button></div>' +
      '<div id="contact-add-area"></div><div id="contact-log-list">' + contactHtml +
      ((form.contactLog || []).length === 0 ? '<div class="empty-hint">Nog geen contactmomenten</div>' : '') + '</div></div>' +
      '<div class="form-section"><div class="section-title">📷 Foto\'s</div>' +
      '<div class="foto-upload-row"><input type="file" id="foto-upload-input" accept="image/*" multiple onchange="handleFotoUpload()" style="display:none" />' +
      '<button class="btn-sm btn-accent" onclick="document.getElementById(\'foto-upload-input\').click()">📷 Foto toevoegen</button></div>' +
      '<div id="foto-gallery"></div></div>';
  }
  html += '<div class="form-section"><div class="field"><label>Notities</label>' +
    '<textarea class="input textarea" id="jf-notities" placeholder="Extra info, afwijkingen...">' + escHtml(form.notities) + '</textarea></div></div></div>' +
    '<div class="modal-footer"><button class="btn-primary" onclick="submitJobForm()">' + (isNew ? '✓ Registreren' : '✓ Opslaan') + '</button>' +
    (!isNew ? '<button class="btn-sm btn-delete" onclick="doDeleteJob(' + form.id + '); closeModal();">🗑 Verwijderen</button>' : '') + '</div>';

  var existing = document.querySelector('.modal-overlay');
  if (existing) existing.querySelector('.modal-content').innerHTML = html;
  else openModal(html);
  if (!window._modalIsNew && form.id) loadFotos(form.id);
  // Auto-populate klant historiek
  if (form.klant) {
    var match = getUniekeKlanten().find(function(k) {
      if (form.klantNummer && k.klantNummer && k.klantNummer.toLowerCase() === form.klantNummer.toLowerCase()) return true;
      return k.klant.toLowerCase() === form.klant.toLowerCase();
    });
    if (match) {
      var prevJobs = match.jobs.filter(function(j) { return j.id !== form.id; });
      if (prevJobs.length > 0) toonKlantHistoriekInModal({ klant: match.klant, jobs: prevJobs, bezoeken: prevJobs.length });
    }
  }
}

// Job modal helpers
function updateJobAantallen() {
  var form = window._modalForm;
  document.querySelectorAll('.set-type-input').forEach(function(inp) { form.aantallen[inp.dataset.typeId] = parseInt(inp.value) || 0; });
  var totalMin = 0; state.settings.setTypes.forEach(function(st) { totalMin += (form.aantallen[st.id] || 0) * st.minuten; });
  form.geschatteUren = Math.round((totalMin / 60) * 10) / 10;
  var urenInp = document.getElementById('jf-uren'); if (urenInp) urenInp.value = form.geschatteUren;
  var totalEl = document.querySelector('.set-types-total strong');
  if (totalEl) totalEl.textContent = Object.values(form.aantallen).reduce(function(s,v){return s+(v||0);}, 0) + ' items';
}
function updateJobAantallenWerkelijk() {
  var form = window._modalForm; if (!form) return;
  if (!form.aantallenWerkelijk) form.aantallenWerkelijk = {};
  document.querySelectorAll('.set-type-werkelijk-input').forEach(function(inp) { form.aantallenWerkelijk[inp.dataset.typeId] = parseInt(inp.value) || 0; });
  var totaal = Object.values(form.aantallenWerkelijk).reduce(function(s,v){return s+(v||0);},0);
  var totalMin = 0; state.settings.setTypes.forEach(function(st) { totalMin += (form.aantallenWerkelijk[st.id] || 0) * st.minuten; });
  form.geschatteUrenWerkelijk = Math.round((totalMin / 60) * 10) / 10;
  var el = document.getElementById('werkelijk-totaal'); if (el) el.textContent = totaal + ' sets · ' + form.geschatteUrenWerkelijk + 'u';
}
function addContactEntry() {
  var area = document.getElementById('contact-add-area'); if (!area) return;
  area.innerHTML = '<div class="contact-add-form"><div class="form-grid-2">' +
    '<input type="date" class="input" id="cl-datum" value="' + todayStr() + '" />' +
    '<input type="time" class="input" id="cl-tijd" value="' + nowTimeStr() + '" /></div>' +
    '<input class="input" id="cl-tekst" placeholder="Bijv. voicemail ingesproken, klant gesproken..." />' +
    '<div class="field-row"><button class="btn-primary btn-sm" onclick="saveContactEntry()">✓ Opslaan</button>' +
    '<button class="btn-sm" onclick="document.getElementById(\'contact-add-area\').innerHTML=\'\'">Annuleren</button></div></div>';
  var el = document.getElementById('cl-tekst'); if (el) el.focus();
}
function saveContactEntry() {
  var tekst = (document.getElementById('cl-tekst') || {}).value; if (!tekst || !tekst.trim()) return;
  window._modalForm.contactLog.push({ id: Date.now(), datum: (document.getElementById('cl-datum') || {}).value || todayStr(), tijd: (document.getElementById('cl-tijd') || {}).value || nowTimeStr(), tekst: tekst.trim() });
  renderJobModalContent();
}
function removeContactEntry(idx) { window._modalForm.contactLog.splice(idx, 1); renderJobModalContent(); }

async function loadFotos(klusId) {
  var gallery = document.getElementById('foto-gallery'); if (!gallery) return;
  var fotos = await fetchFotos(klusId);
  if (fotos.length === 0) { gallery.innerHTML = '<div class="empty-hint">Nog geen foto\'s</div>'; return; }
  gallery.innerHTML = fotos.map(function(f) {
    return '<div class="foto-thumb"><img src="' + f.url + '" alt="' + escHtml(f.bestandsnaam) + '" onclick="window.open(\'' + f.url + '\', \'_blank\')" />' +
      '<button class="foto-delete" onclick="doDeleteFoto(' + f.id + ', \'' + escHtml(f.storage_path) + '\', ' + klusId + ')">✕</button></div>';
  }).join('');
}
async function handleFotoUpload() {
  var input = document.getElementById('foto-upload-input');
  var klusId = window._modalForm && window._modalForm.id; if (!input || !input.files || !input.files.length || !klusId) return;
  for (var i = 0; i < input.files.length; i++) { showToast('Foto uploaden...'); await uploadFoto(klusId, input.files[i]); }
  input.value = ''; loadFotos(klusId); showToast('Foto\'s geupload! 📷');
}
async function doDeleteFoto(fotoId, storagePath, klusId) {
  if (await deleteFoto({ id: fotoId, storage_path: storagePath })) loadFotos(klusId);
}

function collectFormData() {
  syncFormToModal(); var form = window._modalForm;
  return pasStatusDatumsAan(Object.assign({}, form, { heeftAfspraak: !!(form.retourDatum), afspraakDatum: form.retourDatum || '',
    datumBinnen: form.binnenkomstDatum || form.datumBinnen || todayStr() }));
}
async function submitJobForm() {
  var data = collectFormData();
  if (!data.klant.trim()) { showToast('Klantnaam is verplicht!', 'error'); return; }
  if (data.opLocatie && !data.persoonId) { showToast('Op locatie: selecteer een keurmeester', 'error'); return; }
  if (data.opLocatie && !data.retourDatum) { showToast('Op locatie: vul de afleverdatum in', 'error'); return; }
  var saved = await saveKlus(data);
  if (saved) {
    if (window._modalIsNew) state.jobs.push(saved);
    else if (window._modalIsArchief) state.archief = state.archief.map(function(j) { return j.id === saved.id ? saved : j; });
    else state.jobs = state.jobs.map(function(j) { return j.id === saved.id ? saved : j; });
    closeModal(); render(); showToast(window._modalIsNew ? 'Keuring geregistreerd! ✓' : 'Keuring opgeslagen ✓');
  }
}

// Todo Modal
function openTodoModal(existingTodo) {
  var isEdit = !!existingTodo;
  var html = '<div class="modal-header"><h2>' + (isEdit ? '✏️ Taak bewerken' : '✅ Nieuwe taak') + '</h2><button class="btn-close" onclick="closeModal()">✕</button></div>' +
    '<div class="modal-body"><div class="field"><label>Wat moet er gebeuren? *</label>' +
    '<input class="input" id="td-tekst" value="' + escHtml(existingTodo ? existingTodo.tekst : '') + '" placeholder="Bijv. stelling nummeren in magazijn" /></div>' +
    '<div class="form-grid-3" style="margin-top:10px"><div class="field"><label>Ruimte</label><select class="input" id="td-ruimte">' +
    state.settings.ruimtes.map(function(r) { return '<option value="' + escHtml(r) + '" ' + (existingTodo && existingTodo.ruimte === r ? 'selected' : '') + '>' + escHtml(r) + '</option>'; }).join('') +
    '</select><div class="inline-add"><input class="input input-sm" id="td-new-room" placeholder="Nieuwe ruimte..." /><button class="btn-step" onclick="addTodoRoom()">+</button></div></div>' +
    '<div class="field"><label>Voor wie</label><input class="input" id="td-persoon" value="' + escHtml(existingTodo ? existingTodo.persoon : '') + '" placeholder="Naam (komma-gescheiden)" list="td-personen-dl" />' +
    '<datalist id="td-personen-dl">' + state.settings.personen.map(function(p) { return '<option value="' + escHtml(p) + '">'; }).join('') + '</datalist></div>' +
    '<div class="field"><label>Prioriteit</label><select class="input" id="td-prio">' +
    '<option value="hoog" ' + (existingTodo && existingTodo.prioriteit === 'hoog' ? 'selected' : '') + '>🔴 Hoog</option>' +
    '<option value="normaal" ' + (!existingTodo || existingTodo.prioriteit === 'normaal' ? 'selected' : '') + '>🟡 Normaal</option>' +
    '<option value="laag" ' + (existingTodo && existingTodo.prioriteit === 'laag' ? 'selected' : '') + '>⚪ Laag</option></select></div></div></div>' +
    '<div class="modal-footer"><button class="btn-primary" onclick="submitTodo(' + (isEdit ? existingTodo.id : 'null') + ')">' + (isEdit ? '✓ Opslaan' : '✓ Toevoegen') + '</button>' +
    (isEdit ? '<button class="btn-sm btn-delete" onclick="doDeleteTodo(' + existingTodo.id + '); closeModal();">🗑 Verwijderen</button>' : '') + '</div>';
  openModal(html);
  setTimeout(function() { var el = document.getElementById('td-tekst'); if (el) el.focus(); }, 100);
}
function openEditTodoModal(id) { var todo = state.todos.find(function(t) { return t.id === id; }); if (todo) openTodoModal(todo); }

async function addTodoRoom() {
  var inp = document.getElementById('td-new-room'); if (!inp || !inp.value.trim()) return;
  var room = inp.value.trim();
  if (state.settings.ruimtes.indexOf(room) < 0) { state.settings.ruimtes.push(room); await saveInstellingen(state.settings); }
  var sel = document.getElementById('td-ruimte');
  if (sel) { var opt = document.createElement('option'); opt.value = room; opt.text = room; opt.selected = true; sel.add(opt); }
  inp.value = '';
}
async function submitTodo(editId) {
  var tekst = (document.getElementById('td-tekst') || {}).value;
  if (!tekst || !tekst.trim()) { showToast('Vul in wat er moet gebeuren!', 'error'); return; }
  var todo = { tekst: tekst.trim(), ruimte: (document.getElementById('td-ruimte') || {}).value || '', persoon: (document.getElementById('td-persoon') || {}).value || '',
    prioriteit: (document.getElementById('td-prio') || {}).value || 'normaal', datum: todayStr() };
  if (editId) {
    todo.id = editId; var existing = state.todos.find(function(t) { return t.id === editId; }); if (existing) todo.klaar = existing.klaar;
    var saved = await saveTodo(todo);
    if (saved) { state.todos = state.todos.map(function(t) { return t.id === editId ? saved : t; }); closeModal(); render(); showToast('Taak bijgewerkt ✓'); }
  } else {
    var saved2 = await saveTodo(todo);
    if (saved2) { state.todos.unshift(saved2); closeModal(); render(); showToast('Taak toegevoegd ✓'); }
  }
}

// Settings Modal
function openSettingsModal() {
  window._settingsForm = { setTypes: state.settings.setTypes.map(function(s) { return Object.assign({}, s); }),
    ruimtes: state.settings.ruimtes.slice(), email: state.settings.email || '' };
  renderSettingsModal();
}
function exportIcal() {
  function fmtDT(date, time) {
    var t = (time || '09:00').replace(':', '');
    return date.replace(/-/g, '') + 'T' + t + '00';
  }
  function esc(s) {
    return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  var lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KeuringsPlanner//NL',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:KeuringsPlanner',
  ];
  state.afspraken.forEach(function(ap) {
    var p = state.personeel.find(function(x) { return x.id === ap.persoon_id; });
    var titel = (p ? p.naam + ' - ' : '') + ap.titel;
    lines.push('BEGIN:VEVENT');
    lines.push('UID:afspraak-' + ap.id + '@keuringsplanner');
    lines.push('DTSTART;TZID=Europe/Amsterdam:' + fmtDT(ap.datum, ap.start_tijd));
    lines.push('DTEND;TZID=Europe/Amsterdam:' + fmtDT(ap.datum, ap.eind_tijd));
    lines.push('SUMMARY:' + esc(titel));
    if (ap.opmerkingen) lines.push('DESCRIPTION:' + esc(ap.opmerkingen));
    lines.push('END:VEVENT');
  });
  state.jobs.filter(function(j) { return j.heeftAfspraak && j.afspraakDatum && !isAfgerond(j); }).forEach(function(job) {
    var startMin = Math.round(timeToHours(job.afspraakTijd || '09:00') * 60);
    var endMin = startMin + Math.round((job.geschatteUren || 1) * 60);
    var endTijd = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:keuring-' + job.id + '@keuringsplanner');
    lines.push('DTSTART;TZID=Europe/Amsterdam:' + fmtDT(job.afspraakDatum, job.afspraakTijd || '09:00'));
    lines.push('DTEND;TZID=Europe/Amsterdam:' + fmtDT(job.afspraakDatum, endTijd));
    lines.push('SUMMARY:Keuring: ' + esc(job.klant));
    if (job.omschrijving) lines.push('DESCRIPTION:' + esc(job.omschrijving));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'keuringsplanner.ics'; a.click();
  URL.revokeObjectURL(url);
  showToast('Kalender gedownload ✓');
}

function renderSettingsModal() {
  var f = window._settingsForm;
  var html = '<div class="modal-header"><h2>⚙️ Instellingen</h2><button class="btn-close" onclick="closeModal()">✕</button></div><div class="modal-body">' +
    '<div class="form-section"><div class="section-title">⏱ Standaardtijden per set-type</div>' +
    f.setTypes.map(function(st, i) {
      return '<div class="field-row compact"><input class="input flex-1" value="' + escHtml(st.label) + '" onchange="window._settingsForm.setTypes[' + i + '].label=this.value" />' +
        '<input type="number" class="input-num" value="' + st.minuten + '" onchange="window._settingsForm.setTypes[' + i + '].minuten=parseInt(this.value)||0" /><span class="unit">min</span>' +
        '<button class="btn-step btn-danger" onclick="window._settingsForm.setTypes.splice(' + i + ',1); renderSettingsModal();">✕</button></div>';
    }).join('') +
    '<div class="field-row compact"><input class="input flex-1" id="set-new-type" placeholder="Nieuw type..." /><button class="btn-sm btn-accent" onclick="addSettType()">+ Toevoegen</button></div></div>' +
    '<div class="form-grid-2"><div class="form-section"><div class="section-title">📍 Ruimtes</div>' +
    f.ruimtes.map(function(r, i) { return '<div class="field-row compact"><span class="flex-1">' + escHtml(r) + '</span><button class="btn-step btn-danger" onclick="window._settingsForm.ruimtes.splice(' + i + ',1); renderSettingsModal();">✕</button></div>'; }).join('') +
    '<div class="field-row compact"><input class="input flex-1" id="set-new-room" placeholder="Ruimte..." /><button class="btn-step" onclick="addSettRoom()">+</button></div></div>' +
    '<div class="form-section"><div class="section-title">🔒 Beveiliging</div>' +
    '<div class="field"><label>E-mailadres beheerder</label>' +
    '<input type="email" class="input" id="set-email" value="' + escHtml(f.email || '') + '" placeholder="info@bedrijf.nl" /></div>' +
    '<div class="field"><label>Ingelogd als</label>' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<span style="font-size:14px;color:#374151">' + escHtml(state.gebruikerEmail || '—') + '</span>' +
    '<button class="btn-sm" onclick="doLogout()">Uitloggen</button></div>' +
    '<div class="hint-text" style="margin-top:4px">Het wachtwoord beheer je in Supabase, niet meer hier. Vergeten? Gebruik "Wachtwoord vergeten?" op het inlogscherm.</div>' +
    '</div></div></div>' +
    '<div class="form-section"><div class="section-title">📅 Google Agenda / iCal</div>' +
    '<p style="font-size:12px;color:var(--text-faint);margin:0 0 8px">Download een .ics bestand met alle afspraken en keuringen. Importeer dit in Google Agenda, Outlook of Apple Agenda.</p>' +
    '<button class="btn-secondary full-width" onclick="exportIcal()">⬇ Download kalender (.ics)</button></div></div>' +
    '<div class="modal-footer"><button class="btn-primary full-width" onclick="saveSettingsModal()">✓ Alles opslaan</button></div>';
  var existing = document.querySelector('.modal-overlay');
  if (existing) existing.querySelector('.modal-content').innerHTML = html;
  else openModal(html, true);
}
function addSettType() {
  var inp = document.getElementById('set-new-type'); if (!inp || !inp.value.trim()) return;
  window._settingsForm.setTypes.push({ id: inp.value.toLowerCase().replace(/\s+/g, '_'), label: inp.value.trim(), minuten: 30 });
  renderSettingsModal();
}
function addSettRoom() {
  var inp = document.getElementById('set-new-room'); if (!inp || !inp.value.trim()) return;
  window._settingsForm.ruimtes.push(inp.value.trim()); renderSettingsModal();
}
async function saveSettingsModal() {
  var email = (document.getElementById('set-email') || {}).value || '';
  state.settings.setTypes = window._settingsForm.setTypes;
  state.settings.ruimtes = window._settingsForm.ruimtes;
  state.settings.email = email;
  state.settings.dagOverrides = Object.assign({}, state.settings.dagOverrides || {}, { __email: email });
  await saveInstellingen(state.settings);
  closeModal(); render(); showToast('Instellingen opgeslagen ✓');
}

// Reload helpers
// De maandag waarop het zichtbare kalendervenster begint. Gedeeld met
// renderCalendar, zodat het ophalen van afspraken en dagaanpassingen niet uit
// de pas kan lopen met wat er getekend wordt. Daar zat de fout: er werd altijd
// vanaf deze week opgehaald, ook als je maanden terugbladerde -- afspraken en
// verlof uit het verleden kwamen daardoor nooit in beeld.
function zichtbareStartMaandag() {
  var base = new Date(); base.setDate(base.getDate() + state.kalenderOffset * 7);
  return getMondayOfWeek(toDateStr(base));
}

// Verschuift het kalendervenster en haalt de data voor de nieuwe periode op.
// Alle knoppen die de kalender verplaatsen lopen hierlangs.
async function gaNaarKalenderPeriode(offset, weken) {
  state.kalenderOffset = offset;
  if (weken) state.weeksToShow = weken;
  render();
  await reloadDagOverrides();
  render();
}

async function reloadDagOverrides() {
  var startMonday = zichtbareStartMaandag();
  var endDate = new Date(startMonday); endDate.setDate(endDate.getDate() + state.weeksToShow * 7);
  var endDateStr = toDateStr(endDate);
  var results = await Promise.all([fetchDagOverrides(startMonday, endDateStr), fetchAfspraken(startMonday, endDateStr)]);
  state.dagOverrides = results[0];
  state.afspraken = results[1];
}

// === KLANT AUTOCOMPLETE & HISTORIEK ===
function getUniekeKlanten() {
  var map = {};
  state.jobs.concat(state.archief).slice().sort(function(a, b) {
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  }).forEach(function(j) {
    if (!j.klant || !j.klant.trim()) return;
    var key = (j.klantNummer && j.klantNummer.trim())
      ? 'nr:' + j.klantNummer.toLowerCase().trim()
      : 'nm:' + j.klant.toLowerCase().trim();
    if (!map[key]) map[key] = { klant: j.klant, klantNummer: j.klantNummer || '', telefoon: j.telefoon || '', jobs: [], laatste: null };
    map[key].jobs.push(j);
    if (!map[key].laatste || (j.createdAt || '') > (map[key].laatste.createdAt || '')) {
      map[key].laatste = j;
      map[key].klant = j.klant;
      map[key].klantNummer = j.klantNummer || map[key].klantNummer;
      map[key].telefoon = j.telefoon || map[key].telefoon;
    }
  });
  return Object.values(map).map(function(k) { return Object.assign({}, k, { bezoeken: k.jobs.length }); });
}

function zoekKlantAutocomplete(query) {
  var dd = document.getElementById('klant-dropdown'); if (!dd) return;
  if (!query || query.length < 2) { sluitKlantDropdown(); return; }
  var q = query.toLowerCase();
  var resultaten = getUniekeKlanten().filter(function(k) {
    return k.klant.toLowerCase().includes(q) || (k.klantNummer && k.klantNummer.toLowerCase().includes(q));
  }).slice(0, 7);
  if (resultaten.length === 0) { sluitKlantDropdown(); return; }
  window._klantSuggesties = resultaten;
  dd.innerHTML = resultaten.map(function(k, i) {
    var totaal = k.laatste && k.laatste.aantallen ? Object.values(k.laatste.aantallen).reduce(function(s,v){return s+(parseInt(v)||0);},0) : 0;
    var werkelijk = k.laatste && k.laatste.aantallenWerkelijk ? Object.values(k.laatste.aantallenWerkelijk).reduce(function(s,v){return s+(parseInt(v)||0);},0) : null;
    var setsStr = werkelijk !== null ? werkelijk + ' sets werkelijk' : (totaal > 0 ? totaal + ' sets' : '');
    return '<div onmousedown="selecteerKlantSuggestie(' + i + ')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F3F4F6" onmouseover="this.style.background=\'#F9FAFB\'" onmouseout="this.style.background=\'\'">' +
      '<div style="font-weight:600;font-size:14px">' + escHtml(k.klant) +
      (k.klantNummer ? ' <span style="color:#9CA3AF;font-weight:normal;font-size:12px">' + escHtml(k.klantNummer) + '</span>' : '') + '</div>' +
      '<div style="font-size:12px;color:#6B7280">' +
      (k.bezoeken > 1 ? k.bezoeken + '× geweest · ' : '') +
      'Laatste: ' + formatDateShort(k.laatste && (k.laatste.datumBinnen || k.laatste.createdAt)) +
      (setsStr ? ' · ' + setsStr : '') + '</div></div>';
  }).join('');
  dd.style.display = 'block';
}

function selecteerKlantSuggestie(i) {
  var k = window._klantSuggesties && window._klantSuggesties[i]; if (!k) return;
  var nameEl = document.getElementById('jf-klant');
  var nrEl = document.getElementById('jf-klantnr');
  var telEl = document.getElementById('jf-tel');
  if (nameEl) nameEl.value = k.klant;
  if (nrEl) nrEl.value = k.klantNummer || '';
  if (telEl && k.telefoon) telEl.value = k.telefoon;
  if (window._modalForm) { window._modalForm.klant = k.klant; window._modalForm.klantNummer = k.klantNummer || ''; window._modalForm.telefoon = k.telefoon || ''; }
  sluitKlantDropdown();
  var prevJobs = k.jobs.filter(function(j) { return j.id !== (window._modalForm && window._modalForm.id); });
  if (prevJobs.length > 0) toonKlantHistoriekInModal({ klant: k.klant, jobs: prevJobs, bezoeken: prevJobs.length });
}

function sluitKlantDropdown() {
  var dd = document.getElementById('klant-dropdown');
  if (dd) { dd.innerHTML = ''; dd.style.display = 'none'; }
}

function toonKlantHistoriekInModal(klantData) {
  var container = document.getElementById('klant-historiek-section'); if (!container) return;
  var jobs = klantData.jobs.slice().sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  var html = '<div class="form-section" style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px">' +
    '<div class="section-title" style="color:#1D4ED8">📋 Eerder bij ons geweest (' + klantData.bezoeken + '×)</div>';
  jobs.slice(0, 5).forEach(function(j) {
    var totaal = Object.values(j.aantallen || {}).reduce(function(s,v){return s+(parseInt(v)||0);},0);
    var werkelijk = j.aantallenWerkelijk ? Object.values(j.aantallenWerkelijk).reduce(function(s,v){return s+(parseInt(v)||0);},0) : null;
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #BFDBFE">' +
      '<div><span style="font-size:13px;font-weight:600">' + formatDateShort(j.datumBinnen || j.createdAt) + '</span>' +
      ' <span style="font-size:12px;color:#6B7280">afgesproken: ' + totaal + ' sets' +
      (werkelijk !== null ? ' · <strong style="color:' + (werkelijk > totaal ? '#DC2626' : '#059669') + '">werkelijk: ' + werkelijk + '</strong>' : '') + '</span>' +
      (j.omschrijving ? '<div style="font-size:12px;color:#6B7280">' + escHtml(j.omschrijving) + '</div>' : '') + '</div>' +
      '<button class="btn-sm" style="white-space:nowrap;font-size:12px" onclick="nieuweKlusVanVorige(' + j.id + ',\'' + (j.gearchiveerd ? 'archief' : 'jobs') + '\')">↩ Gebruik als basis</button>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function nieuweKlusVanVorige(id, bron) {
  var vorige = (bron === 'archief' ? state.archief : state.jobs).find(function(j) { return j.id === id; });
  if (!vorige) return;
  var emptyAantallen = {}; state.settings.setTypes.forEach(function(st) { emptyAantallen[st.id] = 0; });
  var heeftWerkelijk = vorige.aantallenWerkelijk && Object.values(vorige.aantallenWerkelijk).some(function(v){return (parseInt(v)||0)>0;});
  var aantallen = Object.assign({}, emptyAantallen, heeftWerkelijk ? vorige.aantallenWerkelijk : vorige.aantallen);
  var totalMin = 0; state.settings.setTypes.forEach(function(st) { totalMin += (aantallen[st.id] || 0) * st.minuten; });
  var geschatteUren = totalMin > 0 ? Math.round((totalMin / 60) * 10) / 10 : vorige.geschatteUren;
  window._modalForm = {
    klant: vorige.klant, klantNummer: vorige.klantNummer, telefoon: vorige.telefoon,
    omschrijving: vorige.omschrijving, aantallen: aantallen, heeftAfspraak: false,
    status: 'ingepland', geschatteUren: geschatteUren, afspraakDatum: '', afspraakTijd: '',
    binnenkomstWijze: vorige.binnenkomstWijze, binnenkomstDatum: todayStr(), binnenkomstTijd: nowTimeStr(),
    retourWijze: vorige.retourWijze, retourDatum: '', retourTijd: '',
    afkeurBeleid: vorige.afkeurBeleid, afkeurToelichting: vorige.afkeurToelichting,
    contactLog: [], notities: ''
  };
  window._modalIsNew = true; window._modalIsArchief = false;
  renderJobModalContent(true);
  showToast('Vooringevuld op basis van ' + formatDateShort(vorige.datumBinnen) + (heeftWerkelijk ? ' (werkelijke aantallen)' : '') + ' ✓');
}

// Uren / vakantiesaldo
// ─── FEESTDAGEN ───
function easterDate(year) {
  var a = year % 19, b = Math.floor(year / 100), c = year % 100;
  var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var month = Math.floor((h + l - 7 * m + 114) / 31);
  var day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
// Alle Nederlandse feestdagen van een jaar, met hun naam. Eén bron: het
// overzicht onderaan bouwde dezelfde lijst nog een keer op, met eigen
// datumberekeningen en handgeschreven sleutels als jaar + '-01-01'. Zodra die
// twee uit elkaar liepen toonde het overzicht een kale datum in plaats van de
// naam -- precies wat er gebeurde.
function getNLFeestdagenMetNaam(jaar) {
  var pasen = easterDate(jaar);
  var paasPlus = function(n) { var r = new Date(pasen); r.setDate(r.getDate() + n); return r; };
  // Koningsdag is 27 april, maar valt die op zondag dan wordt het 26 april.
  var kd = new Date(jaar, 3, 27);
  if (kd.getDay() === 0) kd = new Date(jaar, 3, 26);
  // Bevrijdingsdag is hier alleen een vrije dag in een lustrumjaar. In de
  // andere jaren blijft hij wel in het overzicht staan, maar telt hij als
  // gewone werkdag mee in de capaciteit.
  var lustrum = jaar % 5 === 0;
  return [
    { d: new Date(jaar, 0, 1),   naam: 'Nieuwjaarsdag' },
    { d: paasPlus(-2),           naam: 'Goede Vrijdag' },
    { d: pasen,                  naam: '1e Paasdag' },
    { d: paasPlus(1),            naam: '2e Paasdag' },
    { d: kd,                     naam: 'Koningsdag' },
    { d: new Date(jaar, 4, 5),   naam: 'Bevrijdingsdag', vrij: lustrum },
    { d: paasPlus(39),           naam: 'Hemelvaartsdag' },
    { d: paasPlus(49),           naam: '1e Pinksterdag' },
    { d: paasPlus(50),           naam: '2e Pinksterdag' },
    { d: new Date(jaar, 11, 25), naam: '1e Kerstdag' },
    { d: new Date(jaar, 11, 26), naam: '2e Kerstdag' },
  ].map(function(f) { return { datum: toDateStr(f.d), naam: f.naam, vrij: f.vrij !== false }; })
   .sort(function(a, b) { return a.datum.localeCompare(b.datum); });
}
// Alleen de dagen waarop niet gewerkt wordt -- dit is wat de planning en de
// urenberekening gebruiken.
function getNLFeestdagen(jaar) {
  return getNLFeestdagenMetNaam(jaar).filter(function(f) { return f.vrij; }).map(function(f) { return f.datum; });
}
function isFeestdag(dateStr, feestdagen) {
  return feestdagen.indexOf(dateStr) !== -1;
}
function getWerkdagenInJaar(jaar, feestdagen) {
  // Tel alle ma-vr in het jaar, minus feestdagen op werkdagen
  var count = 0;
  var d = new Date(jaar, 0, 1);
  while (d.getFullYear() === jaar) {
    var dw = d.getDay();
    if (dw >= 1 && dw <= 5 && !isFeestdag(toDateStr(d), feestdagen)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function berekenVakantieUren(persoonId, jaar, vakantieOverrides) {
  var p = state.personeel.find(function(x) { return x.id === persoonId; });
  if (!p) return { toegekend: 0, opgenomen: 0, resterend: 0, automatisch: false };
  // Toegekend: handmatige override of 5 weken × contracturen/week
  var contract = parseFloat(p.contract_uren_per_week) || 0;
  var automatischToegewezen = false;
  var toegekend;
  if (p.vakantie_uren_per_jaar != null && p.vakantie_uren_per_jaar !== '') {
    toegekend = parseFloat(p.vakantie_uren_per_jaar) || 0;
  } else if (contract > 0) {
    toegekend = r2(5 * contract);
    automatischToegewezen = true;
  } else {
    toegekend = 0;
  }
  var feestdagen = getNLFeestdagen(jaar);
  var opgenomen = 0;
  state.afwezigheden.filter(function(a) {
    return a.persoon_id === persoonId && a.reden === 'vakantie';
  }).forEach(function(a) {
    var cur = parseDate(a.van_datum); var end = parseDate(a.tot_datum);
    while (cur <= end) {
      var ds = toDateStr(cur);
      if (ds.substring(0, 4) === String(jaar) && !isFeestdag(ds, feestdagen)) {
        var dk = dayKey(ds);
        if (dk) { var r = p.weekrooster && p.weekrooster[dk]; if (r && r.actief) opgenomen += timeToHours(r.eind) - timeToHours(r.start); }
      }
      cur.setDate(cur.getDate() + 1);
    }
  });
  (vakantieOverrides || []).filter(function(ov) { return ov.persoon_id === persoonId; }).forEach(function(ov) {
    var dk = dayKey(ov.datum); if (!dk) return;
    var r = p.weekrooster && p.weekrooster[dk]; if (!r || !r.actief) return;
    var normaal = timeToHours(r.eind) - timeToHours(r.start);
    var actueel = timeToHours(ov.eind_override || r.eind) - timeToHours(ov.start_override || r.start);
    var diff = r2(normaal - actueel); if (diff > 0) opgenomen += diff;
  });
  opgenomen = r2(opgenomen);
  return { toegekend: toegekend, opgenomen: opgenomen, resterend: r2(toegekend - opgenomen), automatisch: automatischToegewezen };
}

function berekenADVUren(persoonId, jaar) {
  var p = state.personeel.find(function(x) { return x.id === persoonId; });
  if (!p || p.is_zzper) return null;
  var contract = parseFloat(p.contract_uren_per_week) || 0;
  if (contract <= 0) return null;

  // Feitelijk uit weekrooster
  var roosterDagen = DAY_NAMES.filter(function(d) { return p.weekrooster && p.weekrooster[d] && p.weekrooster[d].actief; });
  var feitelijkPerWeek = roosterDagen.reduce(function(sum, d) {
    var r = p.weekrooster[d]; return sum + timeToHours(r.eind) - timeToHours(r.start);
  }, 0);
  feitelijkPerWeek = r2(feitelijkPerWeek);
  if (feitelijkPerWeek <= contract) return null;

  // ADV-opbouw per dag = roosteruren die dag - (contract / aantal roosterdagen)
  var contractPerDag = roosterDagen.length > 0 ? r2(contract / roosterDagen.length) : 0;
  var feestdagen = getNLFeestdagen(jaar);

  // Loop door alle werkdagen van het jaar, tel alleen aanwezige dagen mee
  var opgebouwd = 0;
  var d = new Date(jaar, 0, 1);
  while (d.getFullYear() === jaar) {
    var dw = d.getDay();
    if (dw >= 1 && dw <= 5) {
      var ds = toDateStr(d);
      var dk = dayKey(ds);
      if (dk && !isFeestdag(ds, feestdagen)) {
        var rr = p.weekrooster && p.weekrooster[dk];
        if (rr && rr.actief) {
          // Niet opbouwen als afwezig (welke reden dan ook)
          var afwezig = state.afwezigheden.some(function(a) { return a.persoon_id === persoonId && ds >= a.van_datum && ds <= a.tot_datum; });
          var dagOv = state.dagOverrides.find(function(o) { return o.persoon_id === persoonId && o.datum === ds; });
          var aanwezig = !afwezig && !(dagOv && dagOv.aanwezig === false);
          if (aanwezig) {
            var dagUren = timeToHours(rr.eind) - timeToHours(rr.start);
            var extra = r2(dagUren - contractPerDag);
            if (extra > 0) opgebouwd += extra;
          }
        }
      }
    }
    d.setDate(d.getDate() + 1);
  }
  opgebouwd = r2(opgebouwd);

  // Opgenomen ADV
  var opgenomen = 0;
  state.afwezigheden.filter(function(a) {
    return a.persoon_id === persoonId && a.reden === 'adv';
  }).forEach(function(a) {
    var cur = parseDate(a.van_datum); var end = parseDate(a.tot_datum);
    while (cur <= end) {
      var ds = toDateStr(cur);
      if (ds.substring(0, 4) === String(jaar) && !isFeestdag(ds, feestdagen)) {
        var dk = dayKey(ds);
        if (dk) { var r = p.weekrooster && p.weekrooster[dk]; if (r && r.actief) opgenomen += timeToHours(r.eind) - timeToHours(r.start); }
      }
      cur.setDate(cur.getDate() + 1);
    }
  });
  opgenomen = r2(opgenomen);

  return { feitelijkPerWeek: feitelijkPerWeek, extraPerWeek: r2(feitelijkPerWeek - contract), opgebouwd: opgebouwd, opgenomen: opgenomen, resterend: r2(opgebouwd - opgenomen) };
}

function renderSaldoBalk(opgenomen, totaal, kleur) {
  var pct = totaal > 0 ? Math.min(100, Math.round(opgenomen / totaal * 100)) : 0;
  return '<div style="background:#F3F4F6;border-radius:6px;height:8px;margin:6px 0;overflow:hidden">' +
    '<div style="height:100%;width:' + pct + '%;background:' + kleur + ';border-radius:6px"></div></div>';
}
function renderSaldoRij(label, opgenomen, totaal, resterend) {
  var kleur = resterend < 0 ? '#EF4444' : '#059669';
  return '<div style="display:flex;justify-content:space-between;font-size:12px;color:#6B7280">' +
    '<span>' + label + '</span>' +
    '<span>Opgenomen: <strong style="color:#111">' + opgenomen + 'u</strong> &nbsp;·&nbsp; ' +
    'Resterend: <strong style="color:' + kleur + '">' + resterend + 'u</strong> &nbsp;·&nbsp; ' +
    'Totaal: ' + totaal + 'u</span></div>';
}

function renderUrenOverzicht() {
  var jaar = state.urenJaar;
  var ovs = state.vakantieOverrides || [];
  var feestdagen = getNLFeestdagen(jaar);
  var DAG_NL = ['zo','ma','di','wo','do','vr','za'];
  var maandNL = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  var html = '<div class="page-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<h2 style="margin:0">🏖️ Uren & verlof ' + jaar + '</h2>' +
    '<div style="display:flex;gap:6px">' +
    '<button class="btn-sm" onclick="state.urenJaar=' + (jaar - 1) + ';state.vakantieOverrides=null;switchTab(\'uren\')">← ' + (jaar - 1) + '</button>' +
    '<button class="btn-sm" onclick="state.urenJaar=' + (jaar + 1) + ';state.vakantieOverrides=null;switchTab(\'uren\')">' + (jaar + 1) + ' →</button>' +
    '</div></div>';
  if (state.personeel.length === 0) return html + '<div class="empty-hint">Geen personeel geconfigureerd.</div></div>';
  if (state.vakantieOverrides === null) return html + '<div class="empty-hint">Laden...</div></div>';

  // Medewerkers (niet-ZZP eerst, dan ZZP)
  var medewerkers = state.personeel.slice().sort(function(a,b) { return (a.is_zzper ? 1 : 0) - (b.is_zzper ? 1 : 0); });
  medewerkers.forEach(function(p) {
    html += '<div class="card" style="margin-bottom:16px">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
      '<div class="staff-color-dot" style="background:' + p.kleur + '"></div>' +
      '<strong>' + escHtml(p.naam) + '</strong>' +
      (p.is_zzper ? ' <span style="font-size:11px;color:#6B7280">ZZP</span>' : '') +
      '</div>';

    if (p.is_zzper) {
      html += '<div class="hint-text">ZZP\'ers hebben geen vakantiesaldo via de planner.</div>';
    } else {
      var vak = berekenVakantieUren(p.id, jaar, ovs);
      var adv = berekenADVUren(p.id, jaar);
      var contract = parseFloat(p.contract_uren_per_week) || 0;

      // Contract info
      if (contract > 0) {
        var infoStr = contract + 'u/week contract';
        if (adv) infoStr += ' · ' + adv.feitelijkPerWeek + 'u/week feitelijk (weekrooster) · +' + adv.extraPerWeek + 'u ADV-opbouw op gewerkte dagen';
        html += '<div style="font-size:12px;color:#6B7280;margin-bottom:10px">📋 ' + infoStr + '</div>';
      } else {
        html += '<div style="font-size:12px;color:#F59E0B;margin-bottom:10px">⚠️ Stel contracturen in via 👥 Personeel om automatisch te berekenen.</div>';
      }

      // Vakantiesaldo
      html += '<div style="margin-bottom:12px">';
      html += '<div style="font-size:12px;font-weight:600;margin-bottom:2px">🏖️ Vakantie' + (vak.automatisch ? ' <span style="color:#6B7280;font-weight:400">(5 wk × ' + contract + 'u)</span>' : '') + '</div>';
      html += renderSaldoBalk(vak.opgenomen, vak.toegekend, vak.resterend < 0 ? '#EF4444' : '#2563EB');
      html += renderSaldoRij('', vak.opgenomen, vak.toegekend, vak.resterend);
      html += '</div>';

      // ADV-saldo (alleen als er overuren zijn)
      if (adv) {
        html += '<div style="margin-bottom:4px">';
        html += '<div style="font-size:12px;font-weight:600;margin-bottom:2px">⏱️ ADV <span style="color:#6B7280;font-weight:400">(' + adv.extraPerWeek + 'u/week × ' + adv.werkweken + ' werkweken)</span></div>';
        html += renderSaldoBalk(adv.opgenomen, adv.opgebouwd, adv.resterend < 0 ? '#EF4444' : '#7C3AED');
        html += renderSaldoRij('', adv.opgenomen, adv.opgebouwd, adv.resterend);
        html += '</div>';
      } else if (!p.is_zzper && contract > 0) {
        html += '<div style="font-size:12px;color:#6B7280">⏱️ Geen ADV-opbouw (weekroosteruren ≤ contracturen)</div>';
      }
    }
    html += '</div>';
  });

  // Feestdagen blok
  html += '<div class="card" style="margin-top:8px"><div style="font-weight:600;margin-bottom:10px">🇳🇱 Officiële feestdagen ' + jaar + '</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px">';
  getNLFeestdagenMetNaam(jaar).forEach(function(f) {
    var d = parseDate(f.datum);
    var dagNaam = DAG_NL[d.getDay()];
    var label = d.getDate() + ' ' + maandNL[d.getMonth()] + ' (' + dagNaam + ')';
    var isWerkdag = d.getDay() >= 1 && d.getDay() <= 5;
    html += '<div style="font-size:12px;padding:3px 0;display:flex;gap:6px' + (!f.vrij ? ';opacity:0.6' : '') + '">' +
      '<span style="color:#6B7280;min-width:80px">' + label + '</span>' +
      '<span' + (!f.vrij ? ' style="color:#9CA3AF"' : '') + '>' + f.naam + '</span>' +
      (!f.vrij ? '<span style="color:#9CA3AF;font-size:10px">(geen vrije dag)</span>'
               : !isWerkdag ? '<span style="color:#9CA3AF;font-size:10px">(weekend)</span>' : '') +
      '</div>';
  });
  html += '</div></div>';

  return html + '</div>';
}

// Init
async function initApp() {
  if (!initSupabase()) {
    document.getElementById('app').innerHTML = '<div class="error-state"><h2>⚠️ Supabase niet geconfigureerd</h2><p>Vul je Supabase URL en key in in <code>config.js</code></p></div>';
    return;
  }
  // Auth-luisteraar. Binnen deze callback mag NIETS met supabase gebeuren: de
  // interne auth-vergrendeling staat dan vast en elke query blijft daarop
  // wachten, waardoor de app op "Laden..." blijft hangen. Vandaar het werk
  // uitstellen tot buiten de callback-tick.
  db.auth.onAuthStateChange(function(event, session) {
    setTimeout(function() { verwerkSessie(session); }, 0);
  });

  var huidige = await db.auth.getSession();
  await verwerkSessie(huidige.data ? huidige.data.session : null);
}

var _dataGeladen = false;
var _geabonneerd = false;

async function verwerkSessie(session) {
  if (!session) {
    // Uitgelogd of sessie verlopen: alles uit het geheugen, terug naar login.
    // Eerst een eventueel open venster sluiten. Dat hangt aan document.body en
    // niet aan #app, dus render() ruimt het niet op -- na uitloggen vanuit
    // Instellingen bleef het scherm anders over het inlogscherm heen staan.
    closeModal();
    _dataGeladen = false;
    state.ingelogd = false; state.gebruikerEmail = '';
    state.jobs = []; state.archief = []; state.todos = [];
    state.personeel = []; state.afwezigheden = []; state.afspraken = []; state.dagOverrides = [];
    state.loading = false; render();
    return;
  }
  state.ingelogd = true;
  state.gebruikerEmail = session.user ? session.user.email : '';
  // getSession() en onAuthStateChange vuren allebei bij het opstarten; zonder
  // deze vlag zou alles twee keer opgehaald worden.
  if (_dataGeladen) { render(); return; }
  _dataGeladen = true;
  await laadAlleData();
}

async function laadAlleData() {
  state.loading = true; render();
  try {
    var results = await Promise.all([fetchInstellingen(), fetchKlussen(false), fetchArchief(), fetchTodos(), fetchPersoneel(), fetchAfwezigheden()]);
    var inst = results[0]; if (inst) { state.settings = Object.assign({}, state.settings, inst); state.settings.email = (inst.dagOverrides && inst.dagOverrides.__email) || ''; }
    state.jobs = results[1]; state.archief = results[2]; state.todos = results[3]; state.personeel = results[4]; state.afwezigheden = results[5];
    await reloadDagOverrides();
  } catch (err) { console.error('Init error:', err); showToast('Fout bij laden data', 'error'); }
  state.loading = false; render();
  // Maar één keer abonneren: na uitloggen en opnieuw inloggen draait deze
  // functie nogmaals, en een tweede abonnement zou elke wijziging dubbel
  // binnenhalen.
  if (_geabonneerd) return;
  _geabonneerd = true;
  subscribeToChanges(
    async function() { state.jobs = await fetchKlussen(false); state.archief = await fetchArchief(); render(); },
    async function() { state.todos = await fetchTodos(); render(); },
    async function() { var inst = await fetchInstellingen(); if (inst) { state.settings = Object.assign({}, state.settings, inst); state.settings.email = (inst.dagOverrides && inst.dagOverrides.__email) || ''; } render(); },
    async function() { state.personeel = await fetchPersoneel(); state.afwezigheden = await fetchAfwezigheden(); await reloadDagOverrides(); render(); }
  );
}
document.addEventListener('DOMContentLoaded', initApp);

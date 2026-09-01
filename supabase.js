// ============================================
// KeuringsPlanner - Supabase Data Layer v2
// ============================================

let db;

function initSupabase() {
  if (!window.supabase) {
    console.error('Supabase library niet geladen!');
    return false;
  }
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
}

// Eén plek voor mislukte database-acties. Tot nu toe verdween zo'n fout in de
// console en deed de app alsof er niets aan de hand was, terwijl er niets
// opgeslagen werd. Sinds het inloggen verplicht is voelt een verlopen sessie
// precies zo, dus die krijgt een eigen tekst.
var _laatsteDbFout = { tekst: '', tijd: 0 };
function meldDbFout(wat, error) {
  console.error(wat + ' mislukt:', error);
  var code = (error && (error.code || error.status)) || '';
  var msg = String((error && error.message) || '');
  var tekst;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    tekst = 'Geen internet — ' + wat.toLowerCase() + ' is niet gelukt.';
  } else if (code === 401 || code === 403 || code === 'PGRST301' || /jwt|token|expired|not authenticated/i.test(msg)) {
    tekst = 'Je sessie is verlopen. Log opnieuw in — dit is niet opgeslagen.';
  } else {
    tekst = wat + ' is niet gelukt. Probeer het opnieuw.';
  }
  // Bij het opstarten mislukken meerdere acties tegelijk; niet zes keer
  // dezelfde melding tonen.
  var nu = Date.now();
  if (tekst !== _laatsteDbFout.tekst || nu - _laatsteDbFout.tijd > 5000) {
    _laatsteDbFout = { tekst: tekst, tijd: nu };
    if (typeof showToast === 'function') showToast(tekst, 'error');
  }
  return null;
}

// ─── KLUSSEN ───

async function fetchKlussen(inclusiefArchief = false) {
  let query = db.from('klussen').select('*').order('created_at', { ascending: false });
  if (!inclusiefArchief) query = query.eq('gearchiveerd', false);
  const { data, error } = await query;
  if (error) { meldDbFout('Keuringen ophalen', error); return []; }
  return data.map(mapKlusFromDB);
}

async function fetchArchief(zoekterm = '') {
  let query = db.from('klussen').select('*').eq('gearchiveerd', true).order('updated_at', { ascending: false });
  const { data, error } = await query;
  if (error) { meldDbFout('Archief ophalen', error); return []; }
  let results = data.map(mapKlusFromDB);
  if (zoekterm.trim()) {
    const z = zoekterm.toLowerCase();
    results = results.filter(k => k.klant.toLowerCase().includes(z) || k.klantNummer.toLowerCase().includes(z) || k.omschrijving.toLowerCase().includes(z));
  }
  return results;
}

async function saveKlus(klus) {
  const dbData = mapKlusToDB(klus);
  if (klus.id) {
    const { data, error } = await db.from('klussen').update(dbData).eq('id', klus.id).select().single();
    if (error) { meldDbFout('Keuring opslaan', error); return null; }
    return mapKlusFromDB(data);
  } else {
    delete dbData.id;
    const { data, error } = await db.from('klussen').insert(dbData).select().single();
    if (error) { meldDbFout('Keuring aanmaken', error); return null; }
    return mapKlusFromDB(data);
  }
}

async function deleteKlus(id) { const { error } = await db.from('klussen').delete().eq('id', id); if (error) meldDbFout('Keuring verwijderen', error); return !error; }
async function archiveerKlus(id) { const { error } = await db.from('klussen').update({ gearchiveerd: true }).eq('id', id); if (error) meldDbFout('Archiveren', error); return !error; }
async function deArchiveerKlus(id) { const { error } = await db.from('klussen').update({ gearchiveerd: false, status: 'ingepland', gestart_op: null, gekeurd_op: null }).eq('id', id); if (error) meldDbFout('Terugzetten uit archief', error); return !error; }

function mapKlusFromDB(row) {
  return {
    id: row.id, klant: row.klant || '', klantNummer: row.klant_nummer || '',
    telefoon: row.telefoon || '', omschrijving: row.omschrijving || '',
    aantallen: row.aantallen || {}, heeftAfspraak: row.heeft_afspraak || false,
    status: row.status || 'ingepland', geschatteUren: parseFloat(row.geschatte_uren) || 1,
    afspraakDatum: row.afspraak_datum || '', afspraakTijd: row.afspraak_tijd || '',
    binnenkomstWijze: row.binnenkomst_wijze || '', binnenkomstDatum: row.binnenkomst_datum || '',
    binnenkomstTijd: row.binnenkomst_tijd || '', retourWijze: row.retour_wijze || '',
    retourDatum: row.retour_datum || '', retourTijd: row.retour_tijd || '',
    datumBinnen: row.datum_binnen || '', afkeurBeleid: row.afkeur_beleid || '',
    afkeurToelichting: row.afkeur_toelichting || '', contactLog: row.contact_log || [],
    notities: row.notities || '', gearchiveerd: row.gearchiveerd || false,
    aantallenWerkelijk: row.aantallen_werkelijk || null,
    persoonId: row.persoon_id || null,
    opLocatie: row.op_locatie || false,
    gestartOp: row.gestart_op || '',
    gekeurdOp: row.gekeurd_op || '',
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapKlusToDB(klus) {
  return {
    id: klus.id || undefined, klant: klus.klant, klant_nummer: klus.klantNummer || '',
    telefoon: klus.telefoon || '', omschrijving: klus.omschrijving || '',
    aantallen: klus.aantallen || {}, heeft_afspraak: klus.heeftAfspraak || false,
    status: klus.status || 'ingepland', geschatte_uren: parseFloat(klus.geschatteUren) || 1,
    afspraak_datum: klus.afspraakDatum || null, afspraak_tijd: klus.afspraakTijd || '',
    binnenkomst_wijze: klus.binnenkomstWijze || '', binnenkomst_datum: klus.binnenkomstDatum || null,
    binnenkomst_tijd: klus.binnenkomstTijd || '', retour_wijze: klus.retourWijze || '',
    retour_datum: klus.retourDatum || null, retour_tijd: klus.retourTijd || '',
    datum_binnen: klus.datumBinnen || klus.binnenkomstDatum || todayStr(),
    afkeur_beleid: klus.afkeurBeleid || '', afkeur_toelichting: klus.afkeurToelichting || '',
    contact_log: klus.contactLog || [], notities: klus.notities || '',
    gearchiveerd: klus.gearchiveerd || false,
    aantallen_werkelijk: klus.aantallenWerkelijk || null,
    persoon_id: klus.persoonId || null,
    op_locatie: !!klus.opLocatie,
    gestart_op: klus.gestartOp || null,
    gekeurd_op: klus.gekeurdOp || null,
  };
}

// ─── TODOS ───

async function fetchTodos() {
  const { data, error } = await db.from('todos').select('*').order('created_at', { ascending: false });
  if (error) { meldDbFout('Taken ophalen', error); return []; }
  return data;
}

async function saveTodo(todo) {
  if (todo.id && typeof todo.id === 'number') {
    const { data, error } = await db.from('todos').update({
      tekst: todo.tekst, ruimte: todo.ruimte, persoon: todo.persoon,
      prioriteit: todo.prioriteit, klaar: todo.klaar,
    }).eq('id', todo.id).select().single();
    if (error) { meldDbFout('Taak opslaan', error); return null; }
    return data;
  } else {
    const { data, error } = await db.from('todos').insert({
      tekst: todo.tekst, ruimte: todo.ruimte || '', persoon: todo.persoon || '',
      prioriteit: todo.prioriteit || 'normaal', klaar: false,
      datum: todo.datum || todayStr(),
    }).select().single();
    if (error) { meldDbFout('Taak aanmaken', error); return null; }
    return data;
  }
}

async function deleteTodo(id) { const { error } = await db.from('todos').delete().eq('id', id); if (error) meldDbFout('Taak verwijderen', error); return !error; }

// ─── INSTELLINGEN ───

async function fetchInstellingen() {
  const { data, error } = await db.from('instellingen').select('*').eq('id', 'global').single();
  if (error) { meldDbFout('Instellingen ophalen', error); return null; }
  return { template: data.week_template, setTypes: data.set_types, ruimtes: data.ruimtes, personen: data.personen, dagOverrides: data.dag_overrides };
}

async function saveInstellingen(inst) {
  const { error } = await db.from('instellingen').update({
    week_template: inst.template, set_types: inst.setTypes,
    ruimtes: inst.ruimtes, personen: inst.personen, dag_overrides: inst.dagOverrides || {},
  }).eq('id', 'global');
  if (error) meldDbFout('Instellingen opslaan', error);
  return !error;
}

// ─── PERSONEEL ───

async function fetchPersoneel() {
  const { data, error } = await db.from('personeel').select('*').eq('actief', true).order('naam');
  if (error) { meldDbFout('Personeel ophalen', error); return []; }
  return data;
}

async function savePersoneelslid(p) {
  const row = { naam: p.naam, kleur: p.kleur, is_keurmeester: p.is_keurmeester, is_zzper: p.is_zzper || false, weekrooster: p.weekrooster, actief: p.actief !== false, vakantie_uren_per_jaar: p.vakantie_uren_per_jaar ?? null, contract_uren_per_week: p.contract_uren_per_week ?? null, feitelijk_uren_per_week: p.feitelijk_uren_per_week ?? null, geboortedatum: p.geboortedatum ?? null };
  if (p.id) {
    const { data, error } = await db.from('personeel').update(row).eq('id', p.id).select().single();
    if (error) { meldDbFout('Personeelslid opslaan', error); return null; }
    return data;
  } else {
    const { data, error } = await db.from('personeel').insert(row).select().single();
    if (error) { meldDbFout('Personeelslid aanmaken', error); return null; }
    return data;
  }
}

async function deletePersoneelslid(id) {
  const { error } = await db.from('personeel').update({ actief: false }).eq('id', id);
  return !error;
}

// ─── AFWEZIGHEDEN ───

async function fetchAfwezigheden() {
  const { data, error } = await db.from('afwezigheden').select('*').order('van_datum');
  if (error) { meldDbFout('Afwezigheid ophalen', error); return []; }
  return data;
}

async function saveAfwezigheid(a) {
  const row = { persoon_id: a.persoon_id, van_datum: a.van_datum, tot_datum: a.tot_datum, reden: a.reden, notitie: a.notitie || '' };
  if (a.id) {
    const { data, error } = await db.from('afwezigheden').update(row).eq('id', a.id).select().single();
    if (error) { meldDbFout('Afwezigheid opslaan', error); return null; }
    return data;
  } else {
    const { data, error } = await db.from('afwezigheden').insert(row).select().single();
    if (error) { meldDbFout('Afwezigheid aanmaken', error); return null; }
    return data;
  }
}

async function deleteAfwezigheid(id) { const { error } = await db.from('afwezigheden').delete().eq('id', id); if (error) meldDbFout('Afwezigheid verwijderen', error); return !error; }

// ─── DAG OVERRIDES ───

async function fetchDagOverrides(vanDatum, totDatum) {
  const { data, error } = await db.from('dag_overrides').select('*').gte('datum', vanDatum).lte('datum', totDatum);
  if (error) { meldDbFout('Dagaanpassingen ophalen', error); return []; }
  return data;
}

async function saveDagOverride(ov) {
  const { data, error } = await db.from('dag_overrides').upsert({
    datum: ov.datum, persoon_id: ov.persoon_id || null,
    aanwezig: ov.aanwezig !== false, start_override: ov.start_override || null,
    eind_override: ov.eind_override || null, keuringsuren_override: ov.keuringsuren_override ?? null,
    capaciteit_override: ov.capaciteit_override ?? null, reden: ov.reden || null,
  }, { onConflict: 'datum,persoon_id' }).select().single();
  if (error) { meldDbFout('Dagaanpassing opslaan', error); return null; }
  return data;
}

async function deleteDagOverride(id) { const { error } = await db.from('dag_overrides').delete().eq('id', id); if (error) meldDbFout('Dagaanpassing verwijderen', error); return !error; }

async function fetchVakantieOverrides(jaar) {
  const { data, error } = await db.from('dag_overrides').select('*')
    .eq('reden', 'vakantie').gte('datum', jaar + '-01-01').lte('datum', jaar + '-12-31')
    .not('persoon_id', 'is', null);
  if (error) { meldDbFout('Vakantiegegevens ophalen', error); return []; }
  return data;
}

// ─── AFSPRAKEN ───

async function fetchAfspraken(vanDatum, totDatum) {
  const { data, error } = await db.from('afspraken').select('*').gte('datum', vanDatum).lte('datum', totDatum).order('datum').order('start_tijd');
  if (error) { meldDbFout('Afspraken ophalen', error); return []; }
  return data;
}
async function saveAfspraak(a) {
  const row = { persoon_id: a.persoon_id, datum: a.datum, type: a.type || 'klant', titel: a.titel, start_tijd: a.start_tijd, eind_tijd: a.eind_tijd, opmerkingen: a.opmerkingen || '', personen_ids: a.personen_ids || null };
  if (a.id) {
    const { data, error } = await db.from('afspraken').update(row).eq('id', a.id).select().single();
    if (error) { meldDbFout('Afspraak opslaan', error); return null; }
    return data;
  } else {
    const { data, error } = await db.from('afspraken').insert(row).select().single();
    if (error) { meldDbFout('Afspraak aanmaken', error); return null; }
    return data;
  }
}
async function deleteAfspraak(id) { const { error } = await db.from('afspraken').delete().eq('id', id); if (error) meldDbFout('Afspraak verwijderen', error); return !error; }

// ─── FOTO'S ───

async function uploadFoto(klusId, file) {
  const ext = file.name.split('.').pop();
  const path = `klus_${klusId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await db.storage.from('fotos').upload(path, file);
  if (uploadError) { meldDbFout('Foto uploaden', uploadError); return null; }
  // Ondertekende URL in plaats van een publieke: de bucket staat niet meer
  // open voor iedereen. De link verloopt na een uur en wordt bij elke
  // fetchFotos opnieuw aangemaakt.
  const { data: urlData } = await db.storage.from('fotos').createSignedUrl(path, 3600);
  const { data, error } = await db.from('fotos').insert({ klus_id: klusId, bestandsnaam: file.name, storage_path: path, notitie: '' }).select().single();
  if (error) { meldDbFout('Foto opslaan', error); return null; }
  return { ...data, url: urlData ? urlData.signedUrl : '' };
}

async function fetchFotos(klusId) {
  const { data, error } = await db.from('fotos').select('*').eq('klus_id', klusId).order('created_at', { ascending: true });
  if (error) { meldDbFout("Foto's ophalen", error); return []; }
  const paden = data.map(f => f.storage_path);
  if (paden.length === 0) return [];
  const { data: urls, error: urlError } = await db.storage.from('fotos').createSignedUrls(paden, 3600);
  if (urlError) meldDbFout("Fotolinks ophalen", urlError);
  const perPad = {};
  (urls || []).forEach(u => { if (u.path) perPad[u.path] = u.signedUrl; });
  return data.map(f => ({ ...f, url: perPad[f.storage_path] || '' }));
}

async function deleteFoto(foto) {
  await db.storage.from('fotos').remove([foto.storage_path]);
  const { error } = await db.from('fotos').delete().eq('id', foto.id);
  return !error;
}

// ─── REALTIME ───

function subscribeToChanges(onKlussenChange, onTodosChange, onInstellingenChange, onPersoneelChange) {
  db.channel('klussen-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'klussen' }, () => onKlussenChange()).subscribe();
  db.channel('todos-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => onTodosChange()).subscribe();
  db.channel('instellingen-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'instellingen' }, () => onInstellingenChange()).subscribe();
  db.channel('personeel-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'personeel' }, () => onPersoneelChange()).subscribe();
  db.channel('afwezigheden-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'afwezigheden' }, () => onPersoneelChange()).subscribe();
  db.channel('dag-overrides-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'dag_overrides' }, () => onPersoneelChange()).subscribe();
  db.channel('afspraken-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'afspraken' }, () => onPersoneelChange()).subscribe();
}

// ============================================
// KeuringsPlanner - Supabase Data Layer
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

// ─── KLUSSEN ───

async function fetchKlussen(inclusiefArchief = false) {
  let query = db.from('klussen').select('*').order('created_at', { ascending: false });
  if (!inclusiefArchief) query = query.eq('gearchiveerd', false);
  const { data, error } = await query;
  if (error) { console.error('Fout bij ophalen klussen:', error); return []; }
  return data.map(mapKlusFromDB);
}

async function fetchArchief(zoekterm = '') {
  let query = db.from('klussen').select('*').eq('gearchiveerd', true).order('updated_at', { ascending: false });
  const { data, error } = await query;
  if (error) { console.error('Fout bij ophalen archief:', error); return []; }
  let results = data.map(mapKlusFromDB);
  if (zoekterm.trim()) {
    const z = zoekterm.toLowerCase();
    results = results.filter(k =>
      k.klant.toLowerCase().includes(z) ||
      k.klantNummer.toLowerCase().includes(z) ||
      k.omschrijving.toLowerCase().includes(z)
    );
  }
  return results;
}

async function saveKlus(klus) {
  const dbData = mapKlusToDB(klus);
  if (klus.id) {
    const { data, error } = await db.from('klussen').update(dbData).eq('id', klus.id).select().single();
    if (error) { console.error('Fout bij opslaan klus:', error); return null; }
    return mapKlusFromDB(data);
  } else {
    delete dbData.id;
    const { data, error } = await db.from('klussen').insert(dbData).select().single();
    if (error) { console.error('Fout bij aanmaken klus:', error); return null; }
    return mapKlusFromDB(data);
  }
}

async function deleteKlus(id) {
  const { error } = await db.from('klussen').delete().eq('id', id);
  if (error) console.error('Fout bij verwijderen klus:', error);
  return !error;
}

async function archiveerKlus(id) {
  const { error } = await db.from('klussen').update({ gearchiveerd: true }).eq('id', id);
  if (error) console.error('Fout bij archiveren klus:', error);
  return !error;
}

async function deArchiveerKlus(id) {
  const { error } = await db.from('klussen').update({ gearchiveerd: false, status: 'intake' }).eq('id', id);
  if (error) console.error('Fout bij de-archiveren klus:', error);
  return !error;
}

// Mapping: DB snake_case ↔ JS camelCase
function mapKlusFromDB(row) {
  return {
    id: row.id,
    klant: row.klant || '',
    klantNummer: row.klant_nummer || '',
    telefoon: row.telefoon || '',
    omschrijving: row.omschrijving || '',
    aantallen: row.aantallen || {},
    heeftAfspraak: row.heeft_afspraak || false,
    status: row.status || 'intake',
    geschatteUren: parseFloat(row.geschatte_uren) || 1,
    afspraakDatum: row.afspraak_datum || '',
    afspraakTijd: row.afspraak_tijd || '',
    binnenkomstWijze: row.binnenkomst_wijze || '',
    binnenkomstDatum: row.binnenkomst_datum || '',
    binnenkomstTijd: row.binnenkomst_tijd || '',
    retourWijze: row.retour_wijze || '',
    retourDatum: row.retour_datum || '',
    retourTijd: row.retour_tijd || '',
    datumBinnen: row.datum_binnen || '',
    afkeurBeleid: row.afkeur_beleid || '',
    afkeurToelichting: row.afkeur_toelichting || '',
    contactLog: row.contact_log || [],
    notities: row.notities || '',
    gearchiveerd: row.gearchiveerd || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKlusToDB(klus) {
  return {
    id: klus.id || undefined,
    klant: klus.klant,
    klant_nummer: klus.klantNummer || '',
    telefoon: klus.telefoon || '',
    omschrijving: klus.omschrijving || '',
    aantallen: klus.aantallen || {},
    heeft_afspraak: klus.heeftAfspraak || false,
    status: klus.status || 'intake',
    geschatte_uren: parseFloat(klus.geschatteUren) || 1,
    afspraak_datum: klus.afspraakDatum || null,
    afspraak_tijd: klus.afspraakTijd || '',
    binnenkomst_wijze: klus.binnenkomstWijze || '',
    binnenkomst_datum: klus.binnenkomstDatum || null,
    binnenkomst_tijd: klus.binnenkomstTijd || '',
    retour_wijze: klus.retourWijze || '',
    retour_datum: klus.retourDatum || null,
    retour_tijd: klus.retourTijd || '',
    datum_binnen: klus.datumBinnen || klus.binnenkomstDatum || new Date().toISOString().split('T')[0],
    afkeur_beleid: klus.afkeurBeleid || '',
    afkeur_toelichting: klus.afkeurToelichting || '',
    contact_log: klus.contactLog || [],
    notities: klus.notities || '',
    gearchiveerd: klus.gearchiveerd || false,
  };
}

// ─── TODOS ───

async function fetchTodos() {
  const { data, error } = await db.from('todos').select('*').order('created_at', { ascending: false });
  if (error) { console.error('Fout bij ophalen todos:', error); return []; }
  return data;
}

async function saveTodo(todo) {
  if (todo.id && typeof todo.id === 'number') {
    const { data, error } = await db.from('todos').update({
      tekst: todo.tekst, ruimte: todo.ruimte, persoon: todo.persoon,
      prioriteit: todo.prioriteit, klaar: todo.klaar,
    }).eq('id', todo.id).select().single();
    if (error) { console.error('Fout bij opslaan todo:', error); return null; }
    return data;
  } else {
    const { data, error } = await db.from('todos').insert({
      tekst: todo.tekst, ruimte: todo.ruimte || '', persoon: todo.persoon || '',
      prioriteit: todo.prioriteit || 'normaal', klaar: false, datum: todo.datum || new Date().toISOString().split('T')[0],
    }).select().single();
    if (error) { console.error('Fout bij aanmaken todo:', error); return null; }
    return data;
  }
}

async function deleteTodo(id) {
  const { error } = await db.from('todos').delete().eq('id', id);
  if (error) console.error('Fout bij verwijderen todo:', error);
  return !error;
}

// ─── INSTELLINGEN ───

async function fetchInstellingen() {
  const { data, error } = await db.from('instellingen').select('*').eq('id', 'global').single();
  if (error) { console.error('Fout bij ophalen instellingen:', error); return null; }
  return {
    template: data.week_template,
    setTypes: data.set_types,
    ruimtes: data.ruimtes,
    personen: data.personen,
    dagOverrides: data.dag_overrides,
  };
}

async function saveInstellingen(inst) {
  const { error } = await db.from('instellingen').update({
    week_template: inst.template,
    set_types: inst.setTypes,
    ruimtes: inst.ruimtes,
    personen: inst.personen,
    dag_overrides: inst.dagOverrides || {},
  }).eq('id', 'global');
  if (error) console.error('Fout bij opslaan instellingen:', error);
  return !error;
}

// ─── FOTO'S ───

async function uploadFoto(klusId, file) {
  const ext = file.name.split('.').pop();
  const path = `klus_${klusId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await db.storage.from('fotos').upload(path, file);
  if (uploadError) { console.error('Fout bij uploaden foto:', uploadError); return null; }

  const { data: urlData } = db.storage.from('fotos').getPublicUrl(path);

  const { data, error } = await db.from('fotos').insert({
    klus_id: klusId, bestandsnaam: file.name, storage_path: path, notitie: '',
  }).select().single();
  if (error) { console.error('Fout bij opslaan foto record:', error); return null; }

  return { ...data, url: urlData.publicUrl };
}

async function fetchFotos(klusId) {
  const { data, error } = await db.from('fotos').select('*').eq('klus_id', klusId).order('created_at', { ascending: true });
  if (error) { console.error('Fout bij ophalen fotos:', error); return []; }
  return data.map(f => {
    const { data: urlData } = db.storage.from('fotos').getPublicUrl(f.storage_path);
    return { ...f, url: urlData.publicUrl };
  });
}

async function deleteFoto(foto) {
  await db.storage.from('fotos').remove([foto.storage_path]);
  const { error } = await db.from('fotos').delete().eq('id', foto.id);
  if (error) console.error('Fout bij verwijderen foto:', error);
  return !error;
}

// ─── REALTIME SUBSCRIPTIONS ───

function subscribeToChanges(onKlussenChange, onTodosChange, onInstellingenChange) {
  db.channel('klussen-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'klussen' }, () => { onKlussenChange(); })
    .subscribe();

  db.channel('todos-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => { onTodosChange(); })
    .subscribe();

  db.channel('instellingen-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'instellingen' }, () => { onInstellingenChange(); })
    .subscribe();
}

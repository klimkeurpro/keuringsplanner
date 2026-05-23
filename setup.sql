-- ============================================
-- KeuringsPlanner - Supabase Database Setup
-- ============================================
-- Voer dit uit in de Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → plak dit → Run)
-- ============================================

-- 1. INSTELLINGEN TABEL
-- Slaat weeksjabloon, set-types, ruimtes, personen op
CREATE TABLE IF NOT EXISTS instellingen (
  id TEXT PRIMARY KEY DEFAULT 'global',
  week_template JSONB NOT NULL DEFAULT '{"ma":8,"di":8,"wo":8,"do":8,"vr":8}',
  set_types JSONB NOT NULL DEFAULT '[
    {"id":"basis","label":"Basis klimsets","minuten":20},
    {"id":"plus","label":"Klimset plus","minuten":35},
    {"id":"hoogwerker","label":"Hoogwerker sets","minuten":30},
    {"id":"industrie","label":"Industrie-sets","minuten":45},
    {"id":"afvang","label":"Afvangsets","minuten":15}
  ]',
  ruimtes JSONB NOT NULL DEFAULT '["Showroom","Kantoor","Magazijn","Website"]',
  personen JSONB NOT NULL DEFAULT '["Arda"]',
  dag_overrides JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Voeg standaard instellingen toe
INSERT INTO instellingen (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

-- 2. KLUSSEN TABEL
CREATE TABLE IF NOT EXISTS klussen (
  id BIGSERIAL PRIMARY KEY,
  klant TEXT NOT NULL,
  klant_nummer TEXT DEFAULT '',
  telefoon TEXT DEFAULT '',
  omschrijving TEXT DEFAULT '',
  aantallen JSONB NOT NULL DEFAULT '{}',
  heeft_afspraak BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'intake' CHECK (status IN ('intake','in_behandeling','klaar','afgeleverd')),
  geschatte_uren NUMERIC(5,1) NOT NULL DEFAULT 1,
  afspraak_datum DATE,
  afspraak_tijd TEXT DEFAULT '',
  binnenkomst_wijze TEXT DEFAULT '',
  binnenkomst_datum DATE,
  binnenkomst_tijd TEXT DEFAULT '',
  retour_wijze TEXT DEFAULT '',
  retour_datum DATE,
  retour_tijd TEXT DEFAULT '',
  datum_binnen DATE NOT NULL DEFAULT CURRENT_DATE,
  afkeur_beleid TEXT DEFAULT '',
  afkeur_toelichting TEXT DEFAULT '',
  contact_log JSONB NOT NULL DEFAULT '[]',
  notities TEXT DEFAULT '',
  gearchiveerd BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index voor snelle queries
CREATE INDEX IF NOT EXISTS idx_klussen_status ON klussen(status);
CREATE INDEX IF NOT EXISTS idx_klussen_gearchiveerd ON klussen(gearchiveerd);
CREATE INDEX IF NOT EXISTS idx_klussen_datum_binnen ON klussen(datum_binnen);

-- 3. TODOS TABEL
CREATE TABLE IF NOT EXISTS todos (
  id BIGSERIAL PRIMARY KEY,
  tekst TEXT NOT NULL,
  ruimte TEXT DEFAULT '',
  persoon TEXT DEFAULT '',
  prioriteit TEXT NOT NULL DEFAULT 'normaal' CHECK (prioriteit IN ('hoog','normaal','laag')),
  klaar BOOLEAN NOT NULL DEFAULT FALSE,
  datum DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. FOTO'S TABEL
CREATE TABLE IF NOT EXISTS fotos (
  id BIGSERIAL PRIMARY KEY,
  klus_id BIGINT NOT NULL REFERENCES klussen(id) ON DELETE CASCADE,
  bestandsnaam TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  notitie TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotos_klus ON fotos(klus_id);

-- 5. AUTO-UPDATE TIMESTAMPS
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_klussen_updated
  BEFORE UPDATE ON klussen
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_todos_updated
  BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_instellingen_updated
  BEFORE UPDATE ON instellingen
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. STORAGE BUCKET VOOR FOTO'S
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos', 'fotos', true)
ON CONFLICT (id) DO NOTHING;

-- 7. ROW LEVEL SECURITY (open voor iedereen - geen login nodig)
-- Zet RLS aan maar sta alles toe via anon key
ALTER TABLE klussen ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE instellingen ENABLE ROW LEVEL SECURITY;
ALTER TABLE fotos ENABLE ROW LEVEL SECURITY;

-- Policies: iedereen met de anon key mag alles
CREATE POLICY "Iedereen mag klussen lezen" ON klussen FOR SELECT USING (true);
CREATE POLICY "Iedereen mag klussen maken" ON klussen FOR INSERT WITH CHECK (true);
CREATE POLICY "Iedereen mag klussen wijzigen" ON klussen FOR UPDATE USING (true);
CREATE POLICY "Iedereen mag klussen verwijderen" ON klussen FOR DELETE USING (true);

CREATE POLICY "Iedereen mag todos lezen" ON todos FOR SELECT USING (true);
CREATE POLICY "Iedereen mag todos maken" ON todos FOR INSERT WITH CHECK (true);
CREATE POLICY "Iedereen mag todos wijzigen" ON todos FOR UPDATE USING (true);
CREATE POLICY "Iedereen mag todos verwijderen" ON todos FOR DELETE USING (true);

CREATE POLICY "Iedereen mag instellingen lezen" ON instellingen FOR SELECT USING (true);
CREATE POLICY "Iedereen mag instellingen maken" ON instellingen FOR INSERT WITH CHECK (true);
CREATE POLICY "Iedereen mag instellingen wijzigen" ON instellingen FOR UPDATE USING (true);

CREATE POLICY "Iedereen mag fotos lezen" ON fotos FOR SELECT USING (true);
CREATE POLICY "Iedereen mag fotos maken" ON fotos FOR INSERT WITH CHECK (true);
CREATE POLICY "Iedereen mag fotos verwijderen" ON fotos FOR DELETE USING (true);

-- Storage policies
CREATE POLICY "Iedereen mag fotos uploaden" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'fotos');
CREATE POLICY "Iedereen mag fotos bekijken" ON storage.objects
  FOR SELECT USING (bucket_id = 'fotos');
CREATE POLICY "Iedereen mag fotos verwijderen" ON storage.objects
  FOR DELETE USING (bucket_id = 'fotos');

-- 8. REALTIME AANZETTEN
ALTER PUBLICATION supabase_realtime ADD TABLE klussen;
ALTER PUBLICATION supabase_realtime ADD TABLE todos;
ALTER PUBLICATION supabase_realtime ADD TABLE instellingen;

-- ============================================
-- KLAAR! Ga nu naar Settings → API om je
-- URL en anon key te kopiëren voor config.js
-- ============================================

-- ============================================
-- MIGRATIE: Uren-registratie (voer uit in SQL Editor als je de
-- basistabellen al hebt aangemaakt)
-- ============================================

-- Voeg reden toe aan dag_overrides (vakantie / verlof / ziek)
ALTER TABLE dag_overrides ADD COLUMN IF NOT EXISTS reden TEXT DEFAULT NULL;

-- Voeg vakantie-uren per jaar toe aan personeel
ALTER TABLE personeel ADD COLUMN IF NOT EXISTS vakantie_uren_per_jaar NUMERIC DEFAULT NULL;

-- Voeg werkelijk ontvangen aantallen toe aan klussen
ALTER TABLE klussen ADD COLUMN IF NOT EXISTS aantallen_werkelijk JSONB DEFAULT NULL;

-- Voeg personen_ids toe aan afspraken (voor interne afspraken met meerdere personeelsleden)
ALTER TABLE afspraken ADD COLUMN IF NOT EXISTS personen_ids JSONB DEFAULT NULL;

-- ============================================

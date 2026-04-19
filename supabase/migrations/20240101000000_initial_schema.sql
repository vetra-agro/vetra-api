-- ============================================================
-- Vetra ERP Agro — Schema inicial
-- Executar no Supabase SQL Editor ou via CLI
-- ============================================================

-- Habilitar extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ── FARMS ───────────────────────────────────────────────────
CREATE TABLE farms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  city        VARCHAR(100),
  state       CHAR(2),
  total_area_ha NUMERIC(10, 2),
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── FIELDS (talhões) ────────────────────────────────────────
CREATE TABLE fields (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  crop            VARCHAR(100),
  area_ha         NUMERIC(10, 2),
  geometry        JSONB,           -- GeoJSON Polygon
  current_season  VARCHAR(20),     -- ex: "2024-10"
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice espacial (quando migrar para PostGIS geometry nativo)
-- CREATE INDEX fields_geometry_idx ON fields USING GIST (geometry);

-- ── INPUTS (insumos/estoque) ─────────────────────────────────
CREATE TABLE inputs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id       UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  category      VARCHAR(50) CHECK (category IN ('seed','pesticide','fertilizer','fuel','other')),
  unit          VARCHAR(20) NOT NULL,
  quantity      NUMERIC(12, 3) NOT NULL DEFAULT 0,
  min_quantity  NUMERIC(12, 3) DEFAULT 0,
  unit_cost     NUMERIC(10, 2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRANSACTIONS (financeiro) ────────────────────────────────
CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id     UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  field_id    UUID REFERENCES fields(id) ON DELETE SET NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  description VARCHAR(300) NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL,
  date        DATE NOT NULL,
  category    VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── WORKERS (equipe) ─────────────────────────────────────────
CREATE TABLE workers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id       UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  role          VARCHAR(50) CHECK (role IN ('manager','operator','field','driver')),
  monthly_wage  NUMERIC(10, 2),
  phone         VARCHAR(20),
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_farms_updated_at   BEFORE UPDATE ON farms   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_fields_updated_at  BEFORE UPDATE ON fields  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_inputs_updated_at  BEFORE UPDATE ON inputs  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE farms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fields       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inputs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers      ENABLE ROW LEVEL SECURITY;

-- Política: usuário só acessa suas próprias fazendas
CREATE POLICY farms_owner ON farms
  FOR ALL USING (owner_id = auth.uid());

-- Política: acesso a talhões via fazenda do usuário
CREATE POLICY fields_via_farm ON fields
  FOR ALL USING (farm_id IN (SELECT id FROM farms WHERE owner_id = auth.uid()));

CREATE POLICY inputs_via_farm ON inputs
  FOR ALL USING (farm_id IN (SELECT id FROM farms WHERE owner_id = auth.uid()));

CREATE POLICY transactions_via_farm ON transactions
  FOR ALL USING (farm_id IN (SELECT id FROM farms WHERE owner_id = auth.uid()));

CREATE POLICY workers_via_farm ON workers
  FOR ALL USING (farm_id IN (SELECT id FROM farms WHERE owner_id = auth.uid()));

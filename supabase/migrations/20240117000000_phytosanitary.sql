-- ============================================================
-- Vetra — Aplicações Fitossanitárias
-- Receituário agronômico + rastreabilidade regulatória
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE application_method AS ENUM (
    'aerial',        -- aéreo (avião/drone)
    'ground_boom',   -- terrestre barra
    'ground_knap',   -- costal / mochilas
    'pivot',         -- via pivô (fertirrigação)
    'drip',          -- gotejamento
    'granular',      -- aplicação granular
    'seed_treatment' -- tratamento de sementes
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_category AS ENUM (
    'herbicide',       -- herbicida
    'fungicide',       -- fungicida
    'insecticide',     -- inseticida
    'acaricide',       -- acaricida
    'nematicide',      -- nematicida
    'fertilizer_leaf', -- fertilizante foliar
    'growth_reg',      -- regulador de crescimento
    'biological',      -- produto biológico
    'adjuvant',        -- adjuvante / espalhante
    'other'            -- outro
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela principal de aplicações ───────────────────────────
CREATE TABLE phytosanitary_applications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id          UUID NOT NULL REFERENCES farms(id)     ON DELETE CASCADE,
  season_id        UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  field_note_id    UUID REFERENCES field_notes(id)        ON DELETE SET NULL, -- origem: monitoramento
  activity_id      UUID REFERENCES activities(id)         ON DELETE SET NULL, -- vínculo: apontamento

  -- ── Identificação ─────────────────────────────────────────
  method           application_method NOT NULL DEFAULT 'ground_boom',
  applied_at       TIMESTAMPTZ NOT NULL,        -- data/hora do início
  finished_at      TIMESTAMPTZ,                 -- data/hora do fim

  -- ── Onde ──────────────────────────────────────────────────
  field_ids        UUID[]   DEFAULT '{}',       -- talhões
  area_ha          NUMERIC(10,4),               -- área aplicada

  -- ── Equipamento ───────────────────────────────────────────
  machinery_id     UUID REFERENCES machinery(id) ON DELETE SET NULL,
  machinery_name   VARCHAR(200),                -- snapshot
  nozzle_type      VARCHAR(100),                -- ponta de pulverização
  nozzle_spacing_m NUMERIC(4,2),               -- espaçamento entre bicos (m)
  pressure_bar     NUMERIC(5,2),               -- pressão de trabalho (bar)
  volume_ha_l      NUMERIC(7,2),               -- volume de calda (L/ha)
  total_volume_l   NUMERIC(10,2),              -- volume total aplicado (L)
  speed_kmh        NUMERIC(5,2),               -- velocidade de aplicação (km/h)
  height_m         NUMERIC(5,2),               -- altura de barra/drone (m)

  -- ── Operador ──────────────────────────────────────────────
  operator_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  operator_name    VARCHAR(200),
  agronomist_name  VARCHAR(200),               -- responsável técnico
  agronomist_crea  VARCHAR(30),                -- CREA do agrônomo

  -- ── Produtos aplicados (JSONB array) ──────────────────────
  -- [{
  --   "product_name": "Roundup Original",
  --   "active_ingredient": "Glifosato",
  --   "registration_number": "00100", -- Mapa
  --   "category": "herbicide",
  --   "formulation": "SL",
  --   "dose_per_ha": 3.0,
  --   "unit": "L",
  --   "total_quantity": 450,
  --   "mhz_code": "...",             -- código de compra/NF
  --   "withholding_days": 30,        -- carência (dias)
  --   "reentry_interval_h": 4,       -- intervalo de reentrada (horas)
  --   "lot_number": "LOT-2024-001"
  -- }]
  products         JSONB NOT NULL DEFAULT '[]',

  -- ── Condições climáticas na aplicação ─────────────────────
  temp_c           NUMERIC(4,1),               -- temperatura (°C)
  humidity_pct     NUMERIC(5,1),               -- umidade relativa (%)
  wind_speed_kmh   NUMERIC(5,1),               -- velocidade do vento (km/h)
  wind_dir         VARCHAR(5),                 -- direção do vento (N, NE, etc.)
  cloud_cover_pct  NUMERIC(5,1),               -- cobertura de nuvens (%)
  condition_ok     BOOLEAN DEFAULT TRUE,       -- condições adequadas para aplicação?
  condition_notes  TEXT,                       -- observações sobre o clima

  -- ── Rastreabilidade ───────────────────────────────────────
  prescription_number VARCHAR(50),             -- número do receituário
  invoice_number       VARCHAR(50),            -- nota fiscal dos produtos
  batch_number         VARCHAR(100),           -- lote do produto principal

  -- ── Carência e reentrada ──────────────────────────────────
  max_withholding_days INTEGER,                -- maior carência entre os produtos (dias)
  safe_harvest_date    DATE,                   -- data mínima de colheita
  reentry_date         TIMESTAMPTZ,            -- liberação para reentrada

  -- ── Resultado ─────────────────────────────────────────────
  efficacy_pct     NUMERIC(5,1),               -- eficácia estimada (%) — avaliação pós-aplicação
  efficacy_notes   TEXT,
  efficacy_at      DATE,                       -- data da avaliação de eficácia

  -- ── Custo ─────────────────────────────────────────────────
  product_cost     NUMERIC(12,2),              -- custo dos produtos (R$)
  service_cost     NUMERIC(12,2),              -- custo do serviço (R$)
  total_cost       NUMERIC(12,2),              -- total (R$)

  -- ── Extras ────────────────────────────────────────────────
  notes            TEXT,
  tags             TEXT[] DEFAULT '{}',
  images           TEXT[] DEFAULT '{}',

  -- ── Auditoria ─────────────────────────────────────────────
  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX phyto_tenant_idx   ON phytosanitary_applications (tenant_id);
CREATE INDEX phyto_farm_idx     ON phytosanitary_applications (farm_id, applied_at DESC);
CREATE INDEX phyto_season_idx   ON phytosanitary_applications (season_id);
CREATE INDEX phyto_date_idx     ON phytosanitary_applications (applied_at DESC);
CREATE INDEX phyto_fields_idx   ON phytosanitary_applications USING GIN (field_ids);
CREATE INDEX phyto_products_idx ON phytosanitary_applications USING GIN (products);

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_phyto_updated_at
  BEFORE UPDATE ON phytosanitary_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: calcular carência e custo total ─────────────────
CREATE OR REPLACE FUNCTION calc_phyto_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Custo total
  NEW.total_cost = COALESCE(NEW.product_cost, 0) + COALESCE(NEW.service_cost, 0);

  -- Calcular data segura de colheita (maior carência entre os produtos)
  IF NEW.products IS NOT NULL AND jsonb_array_length(NEW.products) > 0 THEN
    SELECT MAX((p->>'withholding_days')::INTEGER)
    INTO NEW.max_withholding_days
    FROM jsonb_array_elements(NEW.products) AS p
    WHERE p->>'withholding_days' IS NOT NULL;

    IF NEW.max_withholding_days IS NOT NULL THEN
      NEW.safe_harvest_date = NEW.applied_at::DATE + NEW.max_withholding_days;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_phyto_fields
  BEFORE INSERT OR UPDATE ON phytosanitary_applications
  FOR EACH ROW EXECUTE FUNCTION calc_phyto_fields();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE phytosanitary_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY phyto_tenant_isolation ON phytosanitary_applications
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── View: aplicações com dados calculados ─────────────────────
CREATE VIEW phyto_summary AS
SELECT
  pa.*,
  f.name  AS farm_name,
  s.name  AS season_name,
  s.crop  AS season_crop,
  -- Dias até a data segura de colheita
  CASE
    WHEN pa.safe_harvest_date IS NOT NULL
    THEN pa.safe_harvest_date - CURRENT_DATE
    ELSE NULL
  END AS days_to_safe_harvest,
  -- Alerta de carência: colheita antes do prazo?
  CASE
    WHEN pa.safe_harvest_date IS NOT NULL
    AND pa.safe_harvest_date > CURRENT_DATE
    THEN TRUE ELSE FALSE
  END AS withholding_active,
  -- Reentrada liberada?
  CASE
    WHEN pa.reentry_date IS NOT NULL
    AND pa.reentry_date > NOW()
    THEN TRUE ELSE FALSE
  END AS reentry_restricted,
  -- Número de produtos
  jsonb_array_length(pa.products) AS products_count
FROM phytosanitary_applications pa
JOIN farms  f ON f.id = pa.farm_id
LEFT JOIN seasons s ON s.id = pa.season_id;

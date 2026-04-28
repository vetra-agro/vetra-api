-- ============================================================
-- Vetra — Safras / Ciclos Produtivos
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE season_status AS ENUM (
    'planning',   -- em planejamento
    'planting',   -- plantio em andamento
    'growing',    -- desenvolvimento vegetativo
    'harvesting', -- colheita em andamento
    'finished',   -- encerrada
    'cancelled'   -- cancelada
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE season_type AS ENUM (
    'summer',    -- safra (verão / 1ª safra)
    'winter',    -- safrinha (inverno / 2ª safra)
    'third',     -- 3ª safra
    'perennial', -- cultura perene (café, cana, eucalipto)
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela de safras ──────────────────────────────────────────
CREATE TABLE seasons (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id          UUID NOT NULL REFERENCES farms(id)   ON DELETE CASCADE,

  -- Identificação
  name             VARCHAR(200) NOT NULL,  -- ex: "Soja 2025/26 - 1ª safra"
  code             VARCHAR(30),            -- ex: "2026-01"
  type             season_type  NOT NULL DEFAULT 'summer',
  status           season_status NOT NULL DEFAULT 'planning',
  crop             VARCHAR(100) NOT NULL,  -- cultura principal
  variety          VARCHAR(200),           -- cultivar / variedade

  -- Período
  planting_start   DATE,                   -- início do plantio
  planting_end     DATE,                   -- fim do plantio
  harvest_start    DATE,                   -- início da colheita
  harvest_end      DATE,                   -- fim da colheita (encerramento)
  cycle_days       INTEGER,                -- ciclo total em dias

  -- Área
  total_area_ha    NUMERIC(12,4),          -- área total planejada
  planted_area_ha  NUMERIC(12,4),          -- área efetivamente plantada
  harvested_area_ha NUMERIC(12,4),         -- área colhida

  -- Produção
  expected_yield_sc_ha NUMERIC(8,2),       -- produtividade esperada (sc/ha)
  actual_yield_sc_ha   NUMERIC(8,2),       -- produtividade real (sc/ha)
  expected_production_sc NUMERIC(12,2),    -- produção esperada (sacas)
  actual_production_sc   NUMERIC(12,2),    -- produção real (sacas)
  unit                 VARCHAR(20) DEFAULT 'sc60', -- sc60, ton, kg, cx

  -- Financeiro (resumo — detalhes no módulo financeiro)
  expected_revenue     NUMERIC(14,2),      -- receita esperada (R$)
  actual_revenue       NUMERIC(14,2),      -- receita real (R$)
  expected_cost_ha     NUMERIC(10,2),      -- custo esperado por ha (R$)
  actual_cost_ha       NUMERIC(10,2),      -- custo real por ha (R$)
  price_per_unit       NUMERIC(10,2),      -- preço de venda por unidade (R$)

  -- Clima e solo
  rainfall_mm          NUMERIC(8,1),       -- precipitação no ciclo (mm)
  avg_temp_c           NUMERIC(4,1),       -- temperatura média do ciclo (°C)

  -- Talhões vinculados
  field_ids            UUID[] DEFAULT '{}', -- talhões desta safra

  -- Observações
  notes                TEXT,
  tags                 TEXT[] DEFAULT '{}',

  -- Auditoria
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint: código único por fazenda
  UNIQUE (farm_id, code)
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX seasons_tenant_idx   ON seasons (tenant_id);
CREATE INDEX seasons_farm_idx     ON seasons (farm_id);
CREATE INDEX seasons_status_idx   ON seasons (farm_id, status);
CREATE INDEX seasons_crop_idx     ON seasons (crop);
CREATE INDEX seasons_year_idx     ON seasons (farm_id, planting_start DESC);
CREATE INDEX seasons_fields_idx   ON seasons USING GIN (field_ids);

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_seasons_updated_at
  BEFORE UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY seasons_tenant_isolation ON seasons
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── View: safras com cálculos derivados ───────────────────────
CREATE VIEW seasons_summary AS
SELECT
  s.*,
  -- Progresso da área
  CASE
    WHEN s.total_area_ha > 0
    THEN ROUND((COALESCE(s.harvested_area_ha, 0) / s.total_area_ha) * 100, 1)
    ELSE 0
  END AS harvest_progress_pct,
  -- Gap de produtividade
  CASE
    WHEN s.expected_yield_sc_ha > 0 AND s.actual_yield_sc_ha > 0
    THEN ROUND(((s.actual_yield_sc_ha - s.expected_yield_sc_ha) / s.expected_yield_sc_ha) * 100, 1)
    ELSE NULL
  END AS yield_gap_pct,
  -- Receita estimada ainda pendente
  CASE
    WHEN s.actual_yield_sc_ha IS NOT NULL AND s.price_per_unit IS NOT NULL
    THEN ROUND(s.planted_area_ha * s.actual_yield_sc_ha * s.price_per_unit, 2)
    ELSE NULL
  END AS estimated_revenue,
  -- Duração do ciclo até hoje
  CASE
    WHEN s.planting_start IS NOT NULL
    THEN (CURRENT_DATE - s.planting_start)
    ELSE NULL
  END AS days_since_planting,
  -- Nome da fazenda
  f.name AS farm_name,
  f.state AS farm_state,
  f.city  AS farm_city
FROM seasons s
JOIN farms f ON f.id = s.farm_id;

-- ── Sincronizar current_season nos talhões ────────────────────
-- Quando uma safra é ativada (planting), atualiza o campo
-- current_season nos talhões vinculados
CREATE OR REPLACE FUNCTION sync_field_seasons()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'planting' AND NEW.code IS NOT NULL
     AND array_length(NEW.field_ids, 1) > 0 THEN
    UPDATE fields
    SET current_season = NEW.code
    WHERE id = ANY(NEW.field_ids);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_field_seasons
  AFTER INSERT OR UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION sync_field_seasons();

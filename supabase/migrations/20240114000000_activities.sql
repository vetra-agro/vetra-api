-- ============================================================
-- Vetra — Apontamento de Atividades de Campo
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM (
    'planting',       -- Plantio
    'spraying',       -- Pulverização
    'fertilizing',    -- Adubação / Fertilização
    'harvesting',     -- Colheita
    'soil_prep',      -- Preparo de solo
    'irrigation',     -- Irrigação
    'scouting',       -- Monitoramento / Vistoria
    'transport',      -- Transporte interno
    'maintenance',    -- Manutenção de campo
    'other'           -- Outra atividade
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE activity_status AS ENUM (
    'planned',    -- planejada
    'in_progress',-- em andamento
    'done',       -- concluída
    'cancelled'   -- cancelada
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela principal de apontamentos ──────────────────────────
CREATE TABLE activities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  farm_id         UUID NOT NULL REFERENCES farms(id)    ON DELETE CASCADE,
  season_id       UUID REFERENCES seasons(id)           ON DELETE SET NULL,

  -- ── Classificação ─────────────────────────────────────────
  type            activity_type  NOT NULL,
  status          activity_status NOT NULL DEFAULT 'done',
  name            VARCHAR(300),           -- descrição curta opcional

  -- ── Quando ────────────────────────────────────────────────
  started_at      TIMESTAMPTZ NOT NULL,   -- início da atividade
  finished_at     TIMESTAMPTZ,            -- fim da atividade
  duration_h      NUMERIC(6,2),           -- duração calculada ou manual (horas)

  -- ── Onde ──────────────────────────────────────────────────
  field_ids       UUID[]   DEFAULT '{}', -- talhões onde ocorreu
  area_ha         NUMERIC(10,4),          -- área trabalhada (ha)

  -- ── Com quê (máquinas) ────────────────────────────────────
  machinery_ids   UUID[]   DEFAULT '{}', -- equipamentos utilizados
  hourmeter_start NUMERIC(10,1),          -- horímetro inicial
  hourmeter_end   NUMERIC(10,1),          -- horímetro final
  fuel_used_l     NUMERIC(8,2),           -- combustível consumido (L)

  -- ── Quem ──────────────────────────────────────────────────
  operator_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  operator_name   VARCHAR(200),           -- snapshot

  -- ── Insumos aplicados (JSONB array) ───────────────────────
  -- [{ "name":"Roundup", "dose_ha":2.5, "unit":"L", "total":125, "cost_unit":38 }]
  inputs_applied  JSONB DEFAULT '[]',

  -- ── Resultado / produção (colheita) ───────────────────────
  production_sc   NUMERIC(12,2),          -- produção colhida (sacas)
  production_ton  NUMERIC(12,4),          -- produção colhida (toneladas)
  moisture_pct    NUMERIC(5,2),           -- umidade no momento (%)
  impurity_pct    NUMERIC(5,2),           -- impureza (%)

  -- ── Clima no momento ──────────────────────────────────────
  weather_temp_c  NUMERIC(4,1),
  weather_wind_kmh NUMERIC(5,1),
  weather_humidity_pct NUMERIC(5,1),
  weather_condition VARCHAR(50),          -- 'sunny','cloudy','rainy'

  -- ── Custo ─────────────────────────────────────────────────
  labor_cost      NUMERIC(12,2),          -- custo de mão de obra (R$)
  machinery_cost  NUMERIC(12,2),          -- custo de maquinário (R$)
  input_cost      NUMERIC(12,2),          -- custo de insumos (R$)
  total_cost      NUMERIC(12,2),          -- custo total (R$)

  -- ── Extras ────────────────────────────────────────────────
  notes           TEXT,
  tags            TEXT[]   DEFAULT '{}',
  images          TEXT[]   DEFAULT '{}',  -- URLs de fotos

  -- ── Auditoria ─────────────────────────────────────────────
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX activities_tenant_idx    ON activities (tenant_id);
CREATE INDEX activities_farm_idx      ON activities (farm_id);
CREATE INDEX activities_season_idx    ON activities (season_id);
CREATE INDEX activities_type_idx      ON activities (farm_id, type);
CREATE INDEX activities_status_idx    ON activities (farm_id, status);
CREATE INDEX activities_date_idx      ON activities (farm_id, started_at DESC);
CREATE INDEX activities_operator_idx  ON activities (operator_id);
CREATE INDEX activities_fields_idx    ON activities USING GIN (field_ids);
CREATE INDEX activities_machinery_idx ON activities USING GIN (machinery_ids);

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: calcular duração automaticamente ─────────────────
CREATE OR REPLACE FUNCTION calc_activity_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.started_at IS NOT NULL AND NEW.finished_at IS NOT NULL THEN
    NEW.duration_h = ROUND(
      EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at)) / 3600.0,
      2
    );
  END IF;
  -- Calcular custo total
  NEW.total_cost = COALESCE(NEW.labor_cost, 0)
                 + COALESCE(NEW.machinery_cost, 0)
                 + COALESCE(NEW.input_cost, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_activity_duration
  BEFORE INSERT OR UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION calc_activity_duration();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_tenant_isolation ON activities
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── View: apontamentos com dados relacionados ─────────────────
CREATE VIEW activities_summary AS
SELECT
  a.*,
  f.name  AS farm_name,
  s.name  AS season_name,
  s.crop  AS season_crop,
  p.full_name AS operator_full_name,
  -- Custo por hectare
  CASE
    WHEN a.area_ha > 0 AND a.total_cost > 0
    THEN ROUND(a.total_cost / a.area_ha, 2)
    ELSE NULL
  END AS cost_per_ha,
  -- Horas do horímetro consumidas
  CASE
    WHEN a.hourmeter_end IS NOT NULL AND a.hourmeter_start IS NOT NULL
    THEN a.hourmeter_end - a.hourmeter_start
    ELSE NULL
  END AS hourmeter_used
FROM activities a
JOIN farms    f ON f.id = a.farm_id
LEFT JOIN seasons s ON s.id = a.season_id
LEFT JOIN profiles p ON p.id = a.operator_id;

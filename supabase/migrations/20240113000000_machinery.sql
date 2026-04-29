-- ============================================================
-- Vetra — Maquinário e Implementos
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE machinery_type AS ENUM (
    'tractor',        -- Trator
    'harvester',      -- Colheitadeira
    'sprayer',        -- Pulverizador autopropelido
    'planter',        -- Plantadeira
    'spreader',       -- Distribuidora / adubadora
    'truck',          -- Caminhão
    'implement',      -- Implemento (grade, arado, etc.)
    'irrigation',     -- Equipamento de irrigação
    'loader',         -- Carregadeira / pá-carregadeira
    'other'           -- Outro
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE machinery_status AS ENUM (
    'active',         -- em operação
    'maintenance',    -- em manutenção
    'idle',           -- parado / sem uso
    'sold',           -- vendido
    'scrapped'        -- sucateado / baixado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fuel_type AS ENUM (
    'diesel',
    'gasoline',
    'flex',
    'electric',
    'none'            -- implemento sem motor
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela de maquinário ──────────────────────────────────────
CREATE TABLE machinery (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  farm_id           UUID REFERENCES farms(id) ON DELETE SET NULL,

  -- ── Identificação ────────────────────────────────────────
  name              VARCHAR(300) NOT NULL,   -- nome / apelido
  type              machinery_type NOT NULL DEFAULT 'tractor',
  status            machinery_status NOT NULL DEFAULT 'active',
  brand             VARCHAR(100),            -- fabricante
  model             VARCHAR(200),            -- modelo
  model_year        SMALLINT,                -- ano do modelo
  manufacture_year  SMALLINT,                -- ano de fabricação
  serial_number     VARCHAR(100) UNIQUE,     -- número de série / chassi
  license_plate     VARCHAR(20),             -- placa (veículos)
  color             VARCHAR(50),
  fleet_number      VARCHAR(30),             -- número da frota interna

  -- ── Vinculação contábil (Gestão de Ativos) ───────────────
  asset_id          UUID,                    -- FK futura para assets.id
  asset_value       NUMERIC(14,2),           -- valor de aquisição (R$)
  acquisition_date  DATE,                    -- data de aquisição
  acquisition_doc   VARCHAR(100),            -- NF ou documento de compra

  -- ── Especificações técnicas ──────────────────────────────
  fuel_type         fuel_type NOT NULL DEFAULT 'diesel',
  engine_power_hp   NUMERIC(7,1),            -- potência do motor (CV)
  engine_model      VARCHAR(100),
  working_width_m   NUMERIC(6,2),            -- largura de trabalho (m)
  tank_capacity_l   NUMERIC(8,1),            -- capacidade do tanque (L)
  weight_kg         NUMERIC(8,1),            -- peso (kg)

  -- ── Horímetro / Odômetro ─────────────────────────────────
  hourmeter_current NUMERIC(10,1),           -- horímetro atual (h)
  odometer_current_km NUMERIC(10,1),         -- odômetro atual (km)
  hourmeter_at_purchase NUMERIC(10,1),       -- horímetro na compra
  avg_consumption_l_h NUMERIC(6,2),          -- consumo médio (L/h ou L/100km)

  -- ── Manutenção preventiva ────────────────────────────────
  next_service_h    NUMERIC(10,1),           -- próxima manutenção (horas)
  next_service_km   NUMERIC(10,1),           -- próxima manutenção (km)
  next_service_date DATE,                    -- próxima manutenção (data)
  last_service_h    NUMERIC(10,1),           -- última manutenção (horas)
  last_service_date DATE,                    -- última manutenção (data)

  -- ── Localização atual ────────────────────────────────────
  current_field_id  UUID REFERENCES fields(id) ON DELETE SET NULL,
  location_notes    VARCHAR(300),            -- ex: "Galpão 2 - setor norte"

  -- ── Operador responsável ─────────────────────────────────
  operator_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  operator_name     VARCHAR(200),            -- snapshot do nome

  -- ── Implementos vinculados ───────────────────────────────
  -- (implemento aponta para o trator que puxa)
  parent_id         UUID REFERENCES machinery(id) ON DELETE SET NULL,

  -- ── Documentação ─────────────────────────────────────────
  insurance_policy  VARCHAR(100),
  insurance_expiry  DATE,
  crvl_expiry       DATE,                    -- vencimento CRVL (veículos)
  antt_number       VARCHAR(30),             -- ANTT (caminhões)

  -- ── Extras ───────────────────────────────────────────────
  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',
  images            TEXT[] DEFAULT '{}',     -- URLs de fotos

  -- ── Auditoria ────────────────────────────────────────────
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX machinery_tenant_idx   ON machinery (tenant_id);
CREATE INDEX machinery_farm_idx     ON machinery (farm_id);
CREATE INDEX machinery_status_idx   ON machinery (tenant_id, status);
CREATE INDEX machinery_type_idx     ON machinery (tenant_id, type);
CREATE INDEX machinery_parent_idx   ON machinery (parent_id);

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_machinery_updated_at
  BEFORE UPDATE ON machinery
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE machinery ENABLE ROW LEVEL SECURITY;

CREATE POLICY machinery_tenant_isolation ON machinery
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── View: maquinário com alertas de manutenção ───────────────
CREATE VIEW machinery_summary AS
SELECT
  m.*,
  f.name  AS farm_name,
  fi.name AS field_name,
  p.full_name AS operator_full_name,
  pm.name AS parent_name,
  -- Alerta de manutenção por horas
  CASE
    WHEN m.next_service_h IS NOT NULL AND m.hourmeter_current IS NOT NULL
      AND m.hourmeter_current >= m.next_service_h
    THEN TRUE ELSE FALSE
  END AS service_overdue_h,
  -- Alerta de manutenção por data
  CASE
    WHEN m.next_service_date IS NOT NULL
      AND m.next_service_date <= CURRENT_DATE
    THEN TRUE ELSE FALSE
  END AS service_overdue_date,
  -- Alerta de seguro vencido
  CASE
    WHEN m.insurance_expiry IS NOT NULL
      AND m.insurance_expiry <= CURRENT_DATE
    THEN TRUE ELSE FALSE
  END AS insurance_expired,
  -- Alerta CRVL vencido
  CASE
    WHEN m.crvl_expiry IS NOT NULL
      AND m.crvl_expiry <= CURRENT_DATE
    THEN TRUE ELSE FALSE
  END AS crvl_expired,
  -- Total de alertas
  (
    CASE WHEN m.next_service_h IS NOT NULL AND m.hourmeter_current IS NOT NULL
           AND m.hourmeter_current >= m.next_service_h THEN 1 ELSE 0 END +
    CASE WHEN m.next_service_date IS NOT NULL
           AND m.next_service_date <= CURRENT_DATE    THEN 1 ELSE 0 END +
    CASE WHEN m.insurance_expiry IS NOT NULL
           AND m.insurance_expiry <= CURRENT_DATE     THEN 1 ELSE 0 END +
    CASE WHEN m.crvl_expiry IS NOT NULL
           AND m.crvl_expiry <= CURRENT_DATE          THEN 1 ELSE 0 END
  ) AS alert_count
FROM machinery m
LEFT JOIN farms    f  ON f.id  = m.farm_id
LEFT JOIN fields   fi ON fi.id = m.current_field_id
LEFT JOIN profiles p  ON p.id  = m.operator_id
LEFT JOIN machinery pm ON pm.id = m.parent_id;

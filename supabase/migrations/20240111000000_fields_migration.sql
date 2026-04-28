-- ============================================================
-- Vetra — Migração da tabela fields (talhões)
-- Preserva os 2 registros existentes incluindo geometria
-- Execute no Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Passo 1: Criar enums ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE field_status AS ENUM (
    'active',    -- em produção
    'fallow',    -- em pousio / descanso
    'preparing', -- em preparo de solo
    'inactive'   -- desativado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE irrigation_type AS ENUM (
    'none',       -- sequeiro
    'pivot',      -- pivô central
    'drip',       -- gotejamento
    'sprinkler',  -- aspersão
    'flood',      -- inundação
    'subsurface'  -- subsuperficial
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Passo 2: Adicionar novas colunas ─────────────────────────
ALTER TABLE fields
  ADD COLUMN IF NOT EXISTS tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS status           field_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS active           BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS code             VARCHAR(20),        -- código interno ex: "AA", "T-01"
  ADD COLUMN IF NOT EXISTS color            VARCHAR(7),         -- cor no mapa ex: "#4CAF50"
  ADD COLUMN IF NOT EXISTS crops            TEXT[] DEFAULT '{}', -- múltiplas culturas (rotação)
  ADD COLUMN IF NOT EXISTS soil_type        VARCHAR(100),       -- tipo de solo
  ADD COLUMN IF NOT EXISTS slope_pct        NUMERIC(5,2),       -- declive em %
  ADD COLUMN IF NOT EXISTS altitude_m       NUMERIC(7,1),       -- altitude média
  ADD COLUMN IF NOT EXISTS irrigation       irrigation_type NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS boundary         GEOMETRY(POLYGON, 4326), -- polígono PostGIS
  ADD COLUMN IF NOT EXISTS centroid         GEOMETRY(POINT,   4326), -- centróide PostGIS
  ADD COLUMN IF NOT EXISTS perimeter_m      NUMERIC(12,2),      -- perímetro calculado (metros)
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS tags             TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES auth.users(id);

-- ── Passo 3: Migrar tenant_id a partir do farm ────────────────
UPDATE fields fi
SET tenant_id = f.tenant_id
FROM farms f
WHERE f.id = fi.farm_id
  AND fi.tenant_id IS NULL;

-- ── Passo 4: Migrar crop → crops (array) ─────────────────────
UPDATE fields
SET crops = ARRAY[crop]
WHERE crop IS NOT NULL AND (crops IS NULL OR crops = '{}');

-- ── Passo 5: Migrar name → code (o nome curto já é o código) ─
UPDATE fields
SET code = name
WHERE code IS NULL AND length(name) <= 10;

-- ── Passo 6: Converter geometry JSONB → PostGIS boundary ──────
-- Converte o GeoJSON armazenado em JSONB para geometria nativa PostGIS
UPDATE fields
SET boundary = ST_GeomFromGeoJSON(geometry::text)
WHERE geometry IS NOT NULL
  AND boundary IS NULL;

-- Calcula centróide e perímetro a partir do boundary
UPDATE fields
SET
  centroid    = ST_Centroid(boundary),
  perimeter_m = ST_Perimeter(ST_Transform(boundary, 31982)) -- SIRGAS 2000 / UTM para metros
WHERE boundary IS NOT NULL
  AND centroid IS NULL;

-- ── Passo 7: Índices ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS fields_farm_idx     ON fields (farm_id);
CREATE INDEX IF NOT EXISTS fields_tenant_idx   ON fields (tenant_id);
CREATE INDEX IF NOT EXISTS fields_status_idx   ON fields (farm_id, status);
CREATE INDEX IF NOT EXISTS fields_active_idx   ON fields (farm_id, active);
CREATE INDEX IF NOT EXISTS fields_boundary_idx ON fields USING GIST (boundary) WHERE boundary IS NOT NULL;
CREATE INDEX IF NOT EXISTS fields_centroid_idx ON fields USING GIST (centroid)  WHERE centroid IS NOT NULL;

-- ── Passo 8: Trigger updated_at ───────────────────────────────
DROP TRIGGER IF EXISTS trg_fields_updated_at ON fields;
CREATE TRIGGER trg_fields_updated_at
  BEFORE UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Passo 9: Trigger centróide automático ─────────────────────
CREATE OR REPLACE FUNCTION update_field_centroid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.boundary IS NOT NULL THEN
    NEW.centroid    = ST_Centroid(NEW.boundary);
    NEW.perimeter_m = ST_Perimeter(ST_Transform(NEW.boundary, 31982));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_field_centroid ON fields;
CREATE TRIGGER trg_field_centroid
  BEFORE INSERT OR UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION update_field_centroid();

-- ── Passo 10: RLS ─────────────────────────────────────────────
ALTER TABLE fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fields_tenant_isolation ON fields;
CREATE POLICY fields_tenant_isolation ON fields
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── Passo 11: Atualizar view farms_summary ────────────────────
DROP VIEW IF EXISTS farms_summary;
CREATE VIEW farms_summary AS
SELECT
  f.*,
  COUNT(fi.id)                 AS fields_count,
  COALESCE(SUM(fi.area_ha), 0) AS fields_area_ha,
  array_agg(DISTINCT unnest) FILTER (WHERE unnest IS NOT NULL)
    AS all_crops
FROM farms f
LEFT JOIN fields fi ON fi.farm_id = f.id AND fi.active = TRUE
LEFT JOIN LATERAL unnest(fi.crops) ON TRUE
GROUP BY f.id;

-- ── Verificação final ─────────────────────────────────────────
SELECT
  fi.id,
  fi.name,
  fi.code,
  fi.farm_id,
  fi.tenant_id,
  fi.area_ha,
  fi.crops,
  fi.status,
  fi.irrigation,
  ST_IsValid(fi.boundary)  AS boundary_valid,
  ST_AsText(fi.centroid)   AS centroid_wkt,
  fi.perimeter_m
FROM fields fi
ORDER BY fi.created_at;

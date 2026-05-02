-- ============================================================
-- Vetra — Caderno de Campo Digital
-- Registro técnico/agronômico por talhão e safra
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE field_note_type AS ENUM (
    'observation',    -- observação geral
    'pest',           -- praga identificada
    'disease',        -- doença identificada
    'weed',           -- plantas daninhas
    'phenology',      -- estágio fenológico
    'soil',           -- solo (compactação, erosão, umidade)
    'irrigation',     -- ocorrência de irrigação / déficit hídrico
    'recommendation', -- recomendação técnica
    'sampling',       -- coleta de amostras
    'other'           -- outro
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE severity_level AS ENUM (
    'low',      -- baixa (monitorar)
    'medium',   -- média (atenção)
    'high',     -- alta (intervenção necessária)
    'critical'  -- crítica (ação imediata)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tabela principal do caderno ───────────────────────────────
CREATE TABLE field_notes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  farm_id         UUID NOT NULL REFERENCES farms(id)    ON DELETE CASCADE,
  field_id        UUID REFERENCES fields(id)            ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)           ON DELETE SET NULL,

  -- ── Classificação ─────────────────────────────────────────
  type            field_note_type NOT NULL DEFAULT 'observation',
  severity        severity_level,           -- relevante para pragas/doenças
  title           VARCHAR(300) NOT NULL,    -- título da observação

  -- ── Quando / onde ─────────────────────────────────────────
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat             NUMERIC(10,7),            -- coordenada do ponto observado
  lng             NUMERIC(10,7),
  location_desc   VARCHAR(200),             -- descrição do local ("divisa norte")

  -- ── Estágio fenológico ────────────────────────────────────
  phenology_stage VARCHAR(100),             -- ex: "V6", "R1", "pré-floração"
  bbch_code       VARCHAR(10),              -- código BBCH padronizado

  -- ── Ocorrência de praga/doença ────────────────────────────
  organism_name   VARCHAR(200),             -- nome científico ou popular
  infestation_pct NUMERIC(5,2),             -- % de infestação / incidência
  incidence_pct   NUMERIC(5,2),             -- % de incidência
  severity_desc   TEXT,                     -- descrição detalhada da severidade

  -- ── Recomendação técnica ──────────────────────────────────
  recommendation  TEXT,                     -- ação recomendada
  deadline_at     DATE,                     -- prazo para execução
  resolved        BOOLEAN DEFAULT FALSE,    -- ocorrência resolvida?
  resolved_at     TIMESTAMPTZ,

  -- ── Conteúdo ──────────────────────────────────────────────
  description     TEXT,                     -- corpo da observação
  images          TEXT[] DEFAULT '{}',      -- URLs de fotos

  -- ── Autor ─────────────────────────────────────────────────
  author_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  author_name     VARCHAR(200),             -- snapshot
  author_role     VARCHAR(100),             -- "Agrônomo", "Técnico", "Operador"

  -- ── Extras ────────────────────────────────────────────────
  tags            TEXT[] DEFAULT '{}',
  linked_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,

  -- ── Auditoria ─────────────────────────────────────────────
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX fn_tenant_idx   ON field_notes (tenant_id);
CREATE INDEX fn_farm_idx     ON field_notes (farm_id, observed_at DESC);
CREATE INDEX fn_field_idx    ON field_notes (field_id);
CREATE INDEX fn_season_idx   ON field_notes (season_id);
CREATE INDEX fn_type_idx     ON field_notes (farm_id, type);
CREATE INDEX fn_severity_idx ON field_notes (farm_id, severity) WHERE severity IS NOT NULL;
CREATE INDEX fn_resolved_idx ON field_notes (resolved, farm_id) WHERE resolved = FALSE;

-- ── Trigger updated_at ────────────────────────────────────────
CREATE TRIGGER trg_field_notes_updated_at
  BEFORE UPDATE ON field_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: data de resolução ────────────────────────────────
CREATE OR REPLACE FUNCTION set_resolved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.resolved = TRUE AND OLD.resolved = FALSE THEN
    NEW.resolved_at = NOW();
  END IF;
  IF NEW.resolved = FALSE THEN
    NEW.resolved_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_field_note_resolved
  BEFORE UPDATE ON field_notes
  FOR EACH ROW EXECUTE FUNCTION set_resolved_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE field_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY fn_tenant_isolation ON field_notes
  FOR ALL USING (
    tenant_id IN (
      SELECT ut.tenant_id FROM user_tenants ut
      WHERE ut.user_id = auth.uid() AND ut.active = TRUE
    )
  );

-- ── View com dados relacionados ───────────────────────────────
CREATE VIEW field_notes_summary AS
SELECT
  fn.*,
  f.name  AS farm_name,
  fi.name AS field_name,
  s.name  AS season_name,
  s.crop  AS season_crop,
  -- Dias em aberto (para pendências)
  CASE
    WHEN fn.resolved = FALSE AND fn.deadline_at IS NOT NULL
    THEN fn.deadline_at - CURRENT_DATE
    ELSE NULL
  END AS days_to_deadline,
  -- Status de prazo
  CASE
    WHEN fn.resolved = TRUE                                   THEN 'resolved'
    WHEN fn.deadline_at IS NULL                               THEN 'open'
    WHEN fn.deadline_at < CURRENT_DATE                        THEN 'overdue'
    WHEN fn.deadline_at <= CURRENT_DATE + INTERVAL '3 days'  THEN 'urgent'
    ELSE 'ok'
  END AS deadline_status
FROM field_notes fn
JOIN farms f ON f.id = fn.farm_id
LEFT JOIN fields  fi ON fi.id = fn.field_id
LEFT JOIN seasons s  ON s.id  = fn.season_id;

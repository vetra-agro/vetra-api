-- ============================================================
-- Vetra — Gestão de Crédito e Cobrança (versão final corrigida)
-- ============================================================

DO $$ BEGIN
  CREATE TYPE credit_status AS ENUM (
    'active', 'suspended', 'blocked', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE collection_status AS ENUM (
    'open', 'negotiating', 'agreed', 'legal', 'written_off', 'recovered'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contact_type AS ENUM (
    'call', 'email', 'whatsapp', 'letter', 'visit', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Limite de crédito por parceiro ────────────────────────────
CREATE TABLE credit_limits (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  partner_id       UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  status           credit_status NOT NULL DEFAULT 'active',
  credit_limit     NUMERIC(14,2) NOT NULL DEFAULT 0,
  used_credit      NUMERIC(14,2) NOT NULL DEFAULT 0,
  available_credit NUMERIC(14,2),

  payment_term_days INTEGER DEFAULT 30,
  interest_rate_mo  NUMERIC(6,4) DEFAULT 0,
  fine_rate         NUMERIC(6,4) DEFAULT 2,
  discount_rate     NUMERIC(6,4) DEFAULT 0,

  risk_score        SMALLINT,
  risk_class        VARCHAR(1),
  last_analysis_at  DATE,
  collateral        TEXT,
  guarantor_name    VARCHAR(200),
  approved_by       VARCHAR(200),
  approved_at       DATE,
  review_date       DATE,
  notes             TEXT,

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, partner_id)
);

CREATE INDEX cl_tenant_idx  ON credit_limits (tenant_id);
CREATE INDEX cl_partner_idx ON credit_limits (partner_id);
CREATE INDEX cl_status_idx  ON credit_limits (tenant_id, status);

CREATE TRIGGER trg_cl_updated_at
  BEFORE UPDATE ON credit_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE credit_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY cl_rls ON credit_limits FOR ALL USING (
  tenant_id IN (
    SELECT ut.tenant_id FROM user_tenants ut
    WHERE ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- Trigger: recalcula available_credit
CREATE OR REPLACE FUNCTION calc_available_credit()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(SUM(amount_remaining), 0)
  INTO   NEW.used_credit
  FROM   accounts_receivable
  WHERE  partner_id = (SELECT partner_id FROM credit_limits WHERE id = NEW.id)
    AND  tenant_id  = NEW.tenant_id
    AND  status     NOT IN ('paid', 'cancelled');

  NEW.available_credit = GREATEST(0, NEW.credit_limit - NEW.used_credit);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cl_available
  BEFORE INSERT OR UPDATE ON credit_limits
  FOR EACH ROW EXECUTE FUNCTION calc_available_credit();

-- ── Casos de cobrança ─────────────────────────────────────────
CREATE TABLE collection_cases (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  partner_id        UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  credit_limit_id   UUID REFERENCES credit_limits(id)     ON DELETE SET NULL,

  status            collection_status NOT NULL DEFAULT 'open',
  case_number       VARCHAR(50),
  total_debt        NUMERIC(14,2) NOT NULL,
  total_interest    NUMERIC(14,2) DEFAULT 0,
  total_fine        NUMERIC(14,2) DEFAULT 0,
  total_recovered   NUMERIC(14,2) DEFAULT 0,
  receivable_ids    UUID[] DEFAULT '{}',

  opened_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  due_since         DATE,
  last_contact_at   DATE,
  next_contact_at   DATE,
  agreed_date       DATE,
  written_off_at    DATE,

  assigned_to       VARCHAR(200),
  legal_process     VARCHAR(100),
  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX colcase_tenant_idx  ON collection_cases (tenant_id);
CREATE INDEX colcase_partner_idx ON collection_cases (partner_id);
CREATE INDEX colcase_status_idx  ON collection_cases (tenant_id, status);

CREATE TRIGGER trg_colcase_updated_at
  BEFORE UPDATE ON collection_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE collection_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY colcase_rls ON collection_cases FOR ALL USING (
  tenant_id IN (
    SELECT ut.tenant_id FROM user_tenants ut
    WHERE ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- ── Histórico de contatos ─────────────────────────────────────
CREATE TABLE collection_contacts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id      UUID NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  contact_type contact_type NOT NULL DEFAULT 'call',
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_by VARCHAR(200),
  summary      TEXT NOT NULL,
  next_action  TEXT,
  next_date    DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX colcontact_case_idx ON collection_contacts (case_id, contacted_at DESC);

ALTER TABLE collection_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY colcontact_rls ON collection_contacts FOR ALL USING (
  tenant_id IN (
    SELECT ut.tenant_id FROM user_tenants ut
    WHERE ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- ── Views (usando p.types conforme estrutura real da tabela) ──
CREATE VIEW credit_summary AS
SELECT
  cl.*,
  p.name     AS partner_name,
  p.types    AS partner_type,
  p.document AS partner_document,
  CASE WHEN cl.review_date IS NOT NULL
    THEN cl.review_date - CURRENT_DATE
    ELSE NULL
  END AS days_to_review,
  CASE WHEN cl.credit_limit > 0
    THEN ROUND(cl.used_credit / cl.credit_limit * 100, 1)
    ELSE 0
  END AS usage_pct,
  EXISTS (
    SELECT 1 FROM collection_cases cx
    WHERE cx.partner_id = cl.partner_id
      AND cx.tenant_id  = cl.tenant_id
      AND cx.status NOT IN ('written_off', 'recovered')
  ) AS has_open_collection
FROM credit_limits cl
JOIN partners p ON p.id = cl.partner_id;

CREATE VIEW collection_summary AS
SELECT
  cx.*,
  p.name     AS partner_name,
  p.types    AS partner_type,
  p.document AS partner_document,
  CASE WHEN cx.due_since IS NOT NULL
    THEN CURRENT_DATE - cx.due_since
    ELSE NULL
  END AS days_overdue,
  cx.total_debt
    + COALESCE(cx.total_interest, 0)
    + COALESCE(cx.total_fine, 0) AS total_with_charges,
  (SELECT COUNT(*)       FROM collection_contacts ct WHERE ct.case_id = cx.id) AS contact_count,
  (SELECT MAX(contacted_at) FROM collection_contacts ct WHERE ct.case_id = cx.id) AS last_contact_date
FROM collection_cases cx
JOIN partners p ON p.id = cx.partner_id;

-- ============================================================
-- Vetra — Módulo de Compras
-- Requisição → Cotação → Pedido → Aprovação → Contrato → Follow-up
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE purchase_request_status AS ENUM (
    'draft', 'pending', 'approved', 'rejected', 'cancelled', 'ordered'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE purchase_order_status AS ENUM (
    'draft', 'pending_approval', 'approved', 'rejected',
    'sent', 'partial', 'received', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE purchase_contract_status AS ENUM (
    'active', 'expired', 'cancelled', 'suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM (
    'pending', 'partial', 'received', 'late', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_action AS ENUM (
    'approved', 'rejected', 'returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Requisição de Compra ──────────────────────────────────────
CREATE TABLE purchase_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)                 ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)               ON DELETE SET NULL,
  cost_center_id  UUID REFERENCES cost_centers(id)          ON DELETE SET NULL,

  request_number  VARCHAR(30),
  status          purchase_request_status NOT NULL DEFAULT 'draft',
  title           VARCHAR(300) NOT NULL,
  description     TEXT,
  urgency         VARCHAR(20) DEFAULT 'normal',   -- low, normal, high, critical
  needed_by       DATE,                            -- prazo máximo necessário

  -- Itens (JSONB para flexibilidade)
  -- [{ product, unit, qty, estimated_unit_price, notes }]
  items           JSONB NOT NULL DEFAULT '[]',
  estimated_total NUMERIC(14,2),

  requested_by    VARCHAR(200),
  approved_by     VARCHAR(200),
  approved_at     TIMESTAMPTZ,
  rejection_reason TEXT,

  notes           TEXT,
  tags            TEXT[] DEFAULT '{}',
  attachments     TEXT[] DEFAULT '{}',

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pr_tenant_idx  ON purchase_requests (tenant_id);
CREATE INDEX pr_status_idx  ON purchase_requests (tenant_id, status);
CREATE INDEX pr_farm_idx    ON purchase_requests (farm_id);
CREATE INDEX pr_season_idx  ON purchase_requests (season_id);

CREATE TRIGGER trg_pr_updated_at BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_rls ON purchase_requests FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Cotações / Mapa de Comparação ─────────────────────────────
CREATE TABLE purchase_quotes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  request_id         UUID REFERENCES purchase_requests(id)   ON DELETE SET NULL,
  farm_id            UUID REFERENCES farms(id)               ON DELETE SET NULL,

  quote_number       VARCHAR(30),
  title              VARCHAR(300) NOT NULL,
  status             VARCHAR(20) DEFAULT 'open',   -- open, closed, awarded
  deadline           DATE,                          -- prazo para receber cotações

  -- Itens a cotar (cópia da requisição ou manual)
  items              JSONB NOT NULL DEFAULT '[]',
  -- [{ product, unit, qty, notes }]

  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pq_tenant_idx  ON purchase_quotes (tenant_id);
CREATE INDEX pq_request_idx ON purchase_quotes (request_id);

CREATE TRIGGER trg_pq_updated_at BEFORE UPDATE ON purchase_quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY pq_rls ON purchase_quotes FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Respostas de fornecedores às cotações ─────────────────────
CREATE TABLE purchase_quote_responses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id       UUID NOT NULL REFERENCES purchase_quotes(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id)         ON DELETE CASCADE,
  partner_id     UUID REFERENCES partners(id)                 ON DELETE SET NULL,

  partner_name   VARCHAR(200),                   -- fallback se não cadastrado
  responded_at   TIMESTAMPTZ DEFAULT NOW(),
  valid_until    DATE,
  payment_terms  VARCHAR(200),
  delivery_days  INTEGER,
  notes          TEXT,
  is_winner      BOOLEAN DEFAULT FALSE,

  -- Itens com preços do fornecedor
  -- [{ product, unit, qty, unit_price, total, brand, notes }]
  items          JSONB NOT NULL DEFAULT '[]',
  total_amount   NUMERIC(14,2),

  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pqr_quote_idx   ON purchase_quote_responses (quote_id);
CREATE INDEX pqr_partner_idx ON purchase_quote_responses (partner_id);

ALTER TABLE purchase_quote_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY pqr_rls ON purchase_quote_responses FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Pedido de Compra ──────────────────────────────────────────
CREATE TABLE purchase_orders (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id)         ON DELETE CASCADE,
  farm_id            UUID REFERENCES farms(id)                    ON DELETE SET NULL,
  season_id          UUID REFERENCES seasons(id)                  ON DELETE SET NULL,
  cost_center_id     UUID REFERENCES cost_centers(id)             ON DELETE SET NULL,
  partner_id         UUID NOT NULL REFERENCES partners(id)        ON DELETE RESTRICT,
  request_id         UUID REFERENCES purchase_requests(id)        ON DELETE SET NULL,
  quote_id           UUID REFERENCES purchase_quotes(id)          ON DELETE SET NULL,
  contract_id        UUID,                                         -- referência ao contrato (FK add depois)

  order_number       VARCHAR(30),
  status             purchase_order_status NOT NULL DEFAULT 'draft',

  -- Itens do pedido
  -- [{ product, unit, qty, unit_price, total, sku, notes }]
  items              JSONB NOT NULL DEFAULT '[]',
  subtotal           NUMERIC(14,2) DEFAULT 0,
  discount           NUMERIC(14,2) DEFAULT 0,
  freight            NUMERIC(14,2) DEFAULT 0,
  taxes              NUMERIC(14,2) DEFAULT 0,
  total_amount       NUMERIC(14,2) DEFAULT 0,

  -- Datas
  order_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery  DATE,
  delivery_address   TEXT,

  -- Condições comerciais
  payment_terms      VARCHAR(200),
  payment_method     VARCHAR(50),
  incoterm           VARCHAR(10),               -- FOB, CIF, etc.
  currency           VARCHAR(3) DEFAULT 'BRL',

  -- Aprovação
  approval_level     SMALLINT DEFAULT 1,         -- nível de alçada exigido
  approved_by        VARCHAR(200),
  approved_at        TIMESTAMPTZ,
  rejection_reason   TEXT,

  notes              TEXT,
  internal_notes     TEXT,
  attachments        TEXT[] DEFAULT '{}',
  tags               TEXT[] DEFAULT '{}',

  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX po_tenant_idx   ON purchase_orders (tenant_id);
CREATE INDEX po_status_idx   ON purchase_orders (tenant_id, status);
CREATE INDEX po_partner_idx  ON purchase_orders (partner_id);
CREATE INDEX po_farm_idx     ON purchase_orders (farm_id);
CREATE INDEX po_season_idx   ON purchase_orders (season_id);

CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_rls ON purchase_orders FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Histórico de aprovações ───────────────────────────────────
CREATE TABLE purchase_approvals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  level        SMALLINT NOT NULL,
  action       approval_action NOT NULL,
  approver     VARCHAR(200) NOT NULL,
  approver_id  UUID REFERENCES auth.users(id),
  comments     TEXT,
  acted_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pa_order_idx ON purchase_approvals (order_id);

ALTER TABLE purchase_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY pa_rls ON purchase_approvals FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Contratos de Fornecimento ─────────────────────────────────
CREATE TABLE purchase_contracts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id          UUID REFERENCES farms(id)              ON DELETE SET NULL,
  partner_id       UUID NOT NULL REFERENCES partners(id)  ON DELETE RESTRICT,

  contract_number  VARCHAR(50),
  title            VARCHAR(300) NOT NULL,
  status           purchase_contract_status NOT NULL DEFAULT 'active',
  contract_type    VARCHAR(50) DEFAULT 'supply',   -- supply, frame, exclusive

  -- Objeto / escopo
  description      TEXT,
  -- Itens/categorias cobertas
  -- [{ product_category, unit, annual_qty, unit_price, notes }]
  items            JSONB DEFAULT '[]',

  -- Valores
  total_value      NUMERIC(14,2),
  currency         VARCHAR(3) DEFAULT 'BRL',

  -- Vigência
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  auto_renewal     BOOLEAN DEFAULT FALSE,
  renewal_notice_days INTEGER DEFAULT 30,

  -- Condições
  payment_terms    VARCHAR(200),
  delivery_terms   TEXT,
  penalty_clause   TEXT,
  warranty_months  INTEGER,

  -- Controle
  signed_at        DATE,
  total_ordered    NUMERIC(14,2) DEFAULT 0,   -- total já pedido neste contrato
  balance          NUMERIC(14,2),             -- saldo disponível

  notes            TEXT,
  attachments      TEXT[] DEFAULT '{}',
  tags             TEXT[] DEFAULT '{}',

  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Adiciona FK de purchase_orders para purchase_contracts
ALTER TABLE purchase_orders
  ADD CONSTRAINT fk_po_contract
  FOREIGN KEY (contract_id) REFERENCES purchase_contracts(id) ON DELETE SET NULL;

CREATE INDEX pc_tenant_idx  ON purchase_contracts (tenant_id);
CREATE INDEX pc_partner_idx ON purchase_contracts (partner_id);
CREATE INDEX pc_status_idx  ON purchase_contracts (tenant_id, status);
CREATE INDEX pc_dates_idx   ON purchase_contracts (start_date, end_date);

CREATE TRIGGER trg_pc_updated_at BEFORE UPDATE ON purchase_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pc_rls ON purchase_contracts FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- Trigger: atualiza total_ordered e balance no contrato
CREATE OR REPLACE FUNCTION update_contract_ordered()
RETURNS TRIGGER AS $$
DECLARE v_contract_id UUID;
BEGIN
  v_contract_id := COALESCE(NEW.contract_id, OLD.contract_id);
  IF v_contract_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE purchase_contracts SET
    total_ordered = COALESCE((
      SELECT SUM(total_amount) FROM purchase_orders
      WHERE contract_id = v_contract_id
        AND status NOT IN ('rejected','cancelled')
    ), 0),
    balance = COALESCE(total_value, 0) - COALESCE((
      SELECT SUM(total_amount) FROM purchase_orders
      WHERE contract_id = v_contract_id
        AND status NOT IN ('rejected','cancelled')
    ), 0)
  WHERE id = v_contract_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_po_contract_balance
  AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_contract_ordered();

-- ── Follow-up de Entrega ──────────────────────────────────────
CREATE TABLE purchase_deliveries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

  status          delivery_status NOT NULL DEFAULT 'pending',
  expected_date   DATE NOT NULL,
  received_date   DATE,
  received_by     VARCHAR(200),

  -- Itens recebidos (parcial ou total)
  -- [{ product, qty_ordered, qty_received, unit, notes }]
  items           JSONB NOT NULL DEFAULT '[]',

  nf_number       VARCHAR(50),
  nf_value        NUMERIC(14,2),
  transport_name  VARCHAR(200),
  notes           TEXT,
  attachments     TEXT[] DEFAULT '{}',

  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pd_tenant_idx ON purchase_deliveries (tenant_id);
CREATE INDEX pd_order_idx  ON purchase_deliveries (order_id);
CREATE INDEX pd_status_idx ON purchase_deliveries (tenant_id, status);
CREATE INDEX pd_date_idx   ON purchase_deliveries (tenant_id, expected_date);

CREATE TRIGGER trg_pd_updated_at BEFORE UPDATE ON purchase_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE purchase_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY pd_rls ON purchase_deliveries FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Views ─────────────────────────────────────────────────────
CREATE VIEW purchase_orders_summary AS
SELECT
  po.*,
  p.name         AS partner_name,
  p.document     AS partner_document,
  f.name         AS farm_name,
  s.name         AS season_name,
  cc.name        AS cost_center_name,
  -- Entregas
  (SELECT COUNT(*) FROM purchase_deliveries pd WHERE pd.order_id = po.id)      AS delivery_count,
  (SELECT COUNT(*) FROM purchase_deliveries pd WHERE pd.order_id = po.id
     AND pd.status = 'received')                                                AS deliveries_received,
  (SELECT MAX(pd.expected_date) FROM purchase_deliveries pd WHERE pd.order_id = po.id
     AND pd.status = 'pending')                                                 AS next_delivery_date,
  -- Dias de atraso
  CASE WHEN po.expected_delivery < CURRENT_DATE
    AND po.status NOT IN ('received','cancelled')
    THEN CURRENT_DATE - po.expected_delivery ELSE NULL
  END AS days_late,
  -- Aprovações
  (SELECT COUNT(*) FROM purchase_approvals pa WHERE pa.order_id = po.id)       AS approval_count
FROM purchase_orders po
JOIN partners     p  ON p.id  = po.partner_id
LEFT JOIN farms   f  ON f.id  = po.farm_id
LEFT JOIN seasons s  ON s.id  = po.season_id
LEFT JOIN cost_centers cc ON cc.id = po.cost_center_id;

CREATE VIEW purchase_contracts_summary AS
SELECT
  pc.*,
  p.name         AS partner_name,
  p.document     AS partner_document,
  f.name         AS farm_name,
  pc.end_date - CURRENT_DATE AS days_to_expiry,
  CASE WHEN pc.total_value > 0
    THEN ROUND(COALESCE(pc.total_ordered,0) / pc.total_value * 100, 1)
    ELSE 0
  END AS consumed_pct,
  (SELECT COUNT(*) FROM purchase_orders po
   WHERE po.contract_id = pc.id AND po.status NOT IN ('cancelled','rejected')) AS order_count
FROM purchase_contracts pc
JOIN partners p ON p.id = pc.partner_id
LEFT JOIN farms f ON f.id = pc.farm_id;

-- ============================================================
-- Vetra — Módulo de Vendas (Agro + Serviços)
-- products, price_lists, sales_orders, commissions, approvals
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE product_type AS ENUM (
    'grain',       -- grão (soja, milho, sorgo, trigo)
    'fiber',       -- fibra (algodão)
    'coffee',      -- café
    'sugarcane',   -- cana-de-açúcar
    'livestock',   -- pecuária
    'service',     -- serviço agrícola
    'other'        -- outro
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_type AS ENUM (
    'fixed',       -- preço fixo em R$
    'indexed',     -- indexado (CBOT+basis, B3)
    'market'       -- preço de mercado no momento da entrega
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sale_status AS ENUM (
    'draft',           -- rascunho / orçamento
    'pending_approval',-- aguardando aprovação
    'approved',        -- aprovado
    'rejected',        -- rejeitado
    'invoiced',        -- faturado
    'delivered',       -- entregue
    'cancelled'        -- cancelado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE commission_status AS ENUM (
    'pending',   -- aguardando pagamento
    'paid',      -- pago
    'cancelled'  -- cancelado
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Catálogo de produtos ──────────────────────────────────────
-- Produtos agrícolas e serviços que o tenant comercializa
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,

  code          VARCHAR(30),
  name          VARCHAR(300) NOT NULL,
  type          product_type NOT NULL DEFAULT 'grain',
  description   TEXT,
  unit          VARCHAR(20)  NOT NULL DEFAULT 'sc',  -- sc, t, kg, L, ha, un
  ncm           VARCHAR(10),    -- código NCM (fiscal)
  active        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Para grãos: safra padrão de referência
  crop          VARCHAR(100),   -- ex: "Soja", "Milho"

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX prod_tenant_idx ON products (tenant_id);
CREATE TRIGGER trg_prod_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY prod_rls ON products FOR ALL USING (
  tenant_id IS NULL
  OR tenant_id IN (
    SELECT ut.tenant_id
    FROM user_tenants ut
    WHERE ut.user_id = auth.uid() AND ut.active = TRUE
  )
);

-- Seeds: produtos padrão globais (tenant_id NULL)
INSERT INTO products (id, tenant_id, code, name, type, unit, crop) VALUES
  (uuid_generate_v4(), NULL, 'SOJ', 'Soja',            'grain', 'sc',  'Soja'),
  (uuid_generate_v4(), NULL, 'MLH', 'Milho',            'grain', 'sc',  'Milho'),
  (uuid_generate_v4(), NULL, 'ALG', 'Algodão em Pluma', 'fiber', 'kg',  'Algodão'),
  (uuid_generate_v4(), NULL, 'CAF', 'Café Arábica',     'coffee','sc',  'Café'),
  (uuid_generate_v4(), NULL, 'SRG', 'Sorgo',            'grain', 'sc',  'Sorgo'),
  (uuid_generate_v4(), NULL, 'TRG', 'Trigo',            'grain', 'sc',  'Trigo'),
  (uuid_generate_v4(), NULL, 'SRV', 'Serviço Agrícola', 'service','ha', NULL)
ON CONFLICT DO NOTHING;

-- ── Tabela de Preços ──────────────────────────────────────────
CREATE TABLE price_lists (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  season_id     UUID REFERENCES seasons(id)           ON DELETE SET NULL,

  name          VARCHAR(200) NOT NULL,   -- ex: "Soja Nov/25 — Fixo"
  price_type    price_type NOT NULL DEFAULT 'fixed',
  valid_from    DATE NOT NULL,
  valid_until   DATE,

  -- Preço fixo
  unit_price    NUMERIC(14,4),           -- R$/sc, R$/kg, R$/ha
  currency      VARCHAR(3) DEFAULT 'BRL',

  -- Preço indexado (CBOT+basis)
  index_base    VARCHAR(50),             -- ex: "CBOT", "B3", "ESALQ"
  basis         NUMERIC(10,4),           -- diferencial em USD/bushel ou R$/sc
  basis_unit    VARCHAR(10),             -- USD/bushel, R$/sc

  -- Condições
  min_qty       NUMERIC(14,4),           -- quantidade mínima para este preço
  payment_terms VARCHAR(200),
  notes         TEXT,

  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX pl_tenant_idx  ON price_lists (tenant_id);
CREATE INDEX pl_product_idx ON price_lists (product_id);
CREATE INDEX pl_dates_idx   ON price_lists (valid_from, valid_until);

CREATE TRIGGER trg_pl_updated_at BEFORE UPDATE ON price_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY pl_rls ON price_lists FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Pedido de Venda / Orçamento ───────────────────────────────
CREATE TABLE sales_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  farm_id         UUID REFERENCES farms(id)              ON DELETE SET NULL,
  season_id       UUID REFERENCES seasons(id)            ON DELETE SET NULL,
  cost_center_id  UUID REFERENCES cost_centers(id)       ON DELETE SET NULL,
  partner_id      UUID NOT NULL REFERENCES partners(id)  ON DELETE RESTRICT,

  order_number    VARCHAR(30),
  status          sale_status NOT NULL DEFAULT 'draft',
  order_type      VARCHAR(20) DEFAULT 'spot',  -- spot, forward, contract
  is_quote        BOOLEAN DEFAULT FALSE,        -- TRUE = orçamento, FALSE = pedido

  -- Datas
  order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_date   DATE,
  expiry_date     DATE,   -- validade do orçamento

  -- Itens JSONB
  -- [{ product_id, product_name, unit, qty, unit_price, price_type,
  --    index_base, basis, total, notes }]
  items           JSONB NOT NULL DEFAULT '[]',

  -- Totalizadores
  subtotal        NUMERIC(16,2) DEFAULT 0,
  discount        NUMERIC(16,2) DEFAULT 0,
  taxes           NUMERIC(16,2) DEFAULT 0,
  total_amount    NUMERIC(16,2) DEFAULT 0,
  currency        VARCHAR(3)    DEFAULT 'BRL',

  -- Contrato a termo (forward)
  is_forward      BOOLEAN DEFAULT FALSE,
  forward_price   NUMERIC(14,4),
  forward_expiry  DATE,

  -- Comissão
  salesperson     VARCHAR(200),
  commission_pct  NUMERIC(6,3) DEFAULT 0,  -- % de comissão

  -- Aprovação
  approved_by     VARCHAR(200),
  approved_at     TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Entrega
  delivery_address TEXT,
  payment_terms    VARCHAR(200),
  nf_number        VARCHAR(50),
  invoiced_at      TIMESTAMPTZ,

  notes            TEXT,
  internal_notes   TEXT,
  tags             TEXT[] DEFAULT '{}',
  attachments      TEXT[] DEFAULT '{}',

  created_by       UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX so_tenant_idx  ON sales_orders (tenant_id);
CREATE INDEX so_status_idx  ON sales_orders (tenant_id, status);
CREATE INDEX so_partner_idx ON sales_orders (partner_id);
CREATE INDEX so_farm_idx    ON sales_orders (farm_id);
CREATE INDEX so_season_idx  ON sales_orders (season_id);
CREATE INDEX so_date_idx    ON sales_orders (tenant_id, order_date DESC);

CREATE TRIGGER trg_so_updated_at BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_rls ON sales_orders FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Histórico de aprovações de venda ─────────────────────────
CREATE TABLE sales_approvals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  order_id    UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL,   -- approved, rejected, returned
  approver    VARCHAR(200) NOT NULL,
  level       SMALLINT DEFAULT 1,
  comments    TEXT,
  acted_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sa_order_idx ON sales_approvals (order_id);

ALTER TABLE sales_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY sa_rls ON sales_approvals FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Comissões de vendas ───────────────────────────────────────
CREATE TABLE sales_commissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,

  salesperson   VARCHAR(200) NOT NULL,
  commission_pct NUMERIC(6,3) NOT NULL,
  base_amount   NUMERIC(16,2) NOT NULL,   -- valor base para cálculo
  commission_amt NUMERIC(16,2) NOT NULL,  -- valor calculado

  status        commission_status NOT NULL DEFAULT 'pending',
  due_date      DATE,
  paid_at       DATE,
  payment_ref   VARCHAR(100),
  notes         TEXT,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX sc_tenant_idx      ON sales_commissions (tenant_id);
CREATE INDEX sc_order_idx       ON sales_commissions (order_id);
CREATE INDEX sc_salesperson_idx ON sales_commissions (tenant_id, salesperson);
CREATE INDEX sc_status_idx      ON sales_commissions (tenant_id, status);

CREATE TRIGGER trg_sc_updated_at BEFORE UPDATE ON sales_commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sales_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sc_rls ON sales_commissions FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- Trigger: cria comissão automaticamente ao aprovar pedido de venda
CREATE OR REPLACE FUNCTION create_sale_commission()
RETURNS TRIGGER AS $$
BEGIN
  -- Cria comissão quando pedido vai para approved e tem % de comissão
  IF NEW.status = 'approved' AND OLD.status != 'approved'
     AND COALESCE(NEW.commission_pct, 0) > 0
     AND NEW.salesperson IS NOT NULL THEN

    INSERT INTO sales_commissions (
      tenant_id, order_id, salesperson,
      commission_pct, base_amount, commission_amt, status
    ) VALUES (
      NEW.tenant_id, NEW.id, NEW.salesperson,
      NEW.commission_pct,
      NEW.total_amount,
      ROUND(NEW.total_amount * NEW.commission_pct / 100, 2),
      'pending'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_so_commission
  AFTER UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION create_sale_commission();

-- ── Views ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sales_orders_summary AS
SELECT
  so.*,
  p.name       AS partner_name,
  p.document   AS partner_document,
  p.email      AS partner_email,
  p.phone      AS partner_phone,
  f.name       AS farm_name,
  s.name       AS season_name,
  s.crop       AS season_crop,
  cc.name      AS cost_center_name,
  so.order_date - CURRENT_DATE              AS days_until_delivery,
  CASE WHEN so.delivery_date < CURRENT_DATE
    AND so.status NOT IN ('delivered','cancelled','invoiced')
    THEN CURRENT_DATE - so.delivery_date ELSE NULL
  END                                       AS days_late,
  (SELECT COUNT(*) FROM sales_approvals sa WHERE sa.order_id = so.id) AS approval_count
FROM sales_orders     so
JOIN  partners        p  ON p.id  = so.partner_id
LEFT JOIN farms       f  ON f.id  = so.farm_id
LEFT JOIN seasons     s  ON s.id  = so.season_id
LEFT JOIN cost_centers cc ON cc.id = so.cost_center_id;

-- KPIs de comissões por vendedor
CREATE OR REPLACE VIEW commission_summary AS
SELECT
  tenant_id,
  salesperson,
  COUNT(*)                                          AS total_orders,
  SUM(commission_amt)                               AS total_commission,
  SUM(CASE WHEN status = 'paid'    THEN commission_amt ELSE 0 END) AS paid,
  SUM(CASE WHEN status = 'pending' THEN commission_amt ELSE 0 END) AS pending,
  MIN(created_at)                                   AS first_sale,
  MAX(created_at)                                   AS last_sale
FROM sales_commissions
GROUP BY tenant_id, salesperson;

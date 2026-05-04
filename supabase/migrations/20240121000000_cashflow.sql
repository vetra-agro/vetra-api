-- ============================================================
-- Vetra — Fluxo de Caixa + Import OFX/CNAB
-- ============================================================

-- ── Enums ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE cash_flow_direction AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cash_entry_origin AS ENUM (
    'manual',       -- lançamento manual
    'payable',      -- originado de contas a pagar
    'receivable',   -- originado de contas a receber
    'ofx_import',   -- importado via OFX
    'cnab_import',  -- importado via CNAB 240/400
    'transfer'      -- transferência entre contas
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE reconcile_status AS ENUM (
    'unmatched',   -- não conciliado
    'matched',     -- conciliado automaticamente
    'confirmed',   -- confirmado pelo usuário
    'ignored'      -- ignorado (não conciliar)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Lançamentos do fluxo de caixa ────────────────────────────
CREATE TABLE cash_flow_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_account_id   UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  cost_center_id    UUID REFERENCES cost_centers(id)   ON DELETE SET NULL,
  category_id       UUID REFERENCES financial_categories(id) ON DELETE SET NULL,
  farm_id           UUID REFERENCES farms(id)           ON DELETE SET NULL,
  season_id         UUID REFERENCES seasons(id)         ON DELETE SET NULL,

  -- Origem (vínculo com payable/receivable se originado de lá)
  payable_id        UUID REFERENCES accounts_payable(id)    ON DELETE SET NULL,
  receivable_id     UUID REFERENCES accounts_receivable(id) ON DELETE SET NULL,
  transfer_pair_id  UUID REFERENCES cash_flow_entries(id)   ON DELETE SET NULL,

  -- Dados do lançamento
  direction         cash_flow_direction NOT NULL,   -- 'in' ou 'out'
  origin            cash_entry_origin NOT NULL DEFAULT 'manual',
  description       VARCHAR(500) NOT NULL,
  amount            NUMERIC(14,2) NOT NULL,
  entry_date        DATE NOT NULL,                  -- data de competência/caixa
  value_date        DATE,                           -- data de liquidação/valuta

  -- Conciliação
  reconcile_status  reconcile_status NOT NULL DEFAULT 'unmatched',
  reconciled_at     TIMESTAMPTZ,
  bank_memo         VARCHAR(500),                   -- descrição do extrato bancário
  bank_doc          VARCHAR(100),                   -- documento do banco (cheque, TED, etc.)

  -- Importação OFX/CNAB
  import_batch_id   UUID,                           -- ID do lote de importação
  external_id       VARCHAR(200),                   -- ID único no extrato (evita duplicatas)

  notes             TEXT,
  tags              TEXT[] DEFAULT '{}',

  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX cfe_tenant_idx     ON cash_flow_entries (tenant_id);
CREATE INDEX cfe_account_idx    ON cash_flow_entries (bank_account_id, entry_date DESC);
CREATE INDEX cfe_date_idx       ON cash_flow_entries (tenant_id, entry_date DESC);
CREATE INDEX cfe_direction_idx  ON cash_flow_entries (tenant_id, direction, entry_date);
CREATE INDEX cfe_reconcile_idx  ON cash_flow_entries (reconcile_status);
CREATE INDEX cfe_external_idx   ON cash_flow_entries (bank_account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX cfe_farm_idx       ON cash_flow_entries (farm_id);

CREATE TRIGGER trg_cfe_updated_at BEFORE UPDATE ON cash_flow_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE cash_flow_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfe_rls ON cash_flow_entries FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── Lotes de importação (histórico de imports) ────────────────
CREATE TABLE import_batches (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES bank_accounts(id)  ON DELETE SET NULL,
  format         VARCHAR(20) NOT NULL,    -- 'ofx', 'cnab240', 'cnab400'
  filename       VARCHAR(300),
  entry_count    INTEGER DEFAULT 0,
  matched_count  INTEGER DEFAULT 0,
  date_from      DATE,
  date_to        DATE,
  imported_by    UUID REFERENCES auth.users(id),
  imported_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ib_tenant_idx ON import_batches (tenant_id, imported_at DESC);
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY ib_rls ON import_batches FOR ALL USING (
  tenant_id IN (SELECT ut.tenant_id FROM user_tenants ut WHERE ut.user_id = auth.uid() AND ut.active = TRUE)
);

-- ── View: fluxo de caixa com dados relacionados ───────────────
CREATE VIEW cash_flow_summary AS
SELECT
  cfe.*,
  ba.name         AS bank_account_name,
  ba.bank_name    AS bank_name,
  f.name          AS farm_name,
  s.name          AS season_name,
  cc.name         AS cost_center_name,
  fc.name         AS category_name,
  fc.color        AS category_color
FROM cash_flow_entries cfe
LEFT JOIN bank_accounts       ba  ON ba.id  = cfe.bank_account_id
LEFT JOIN farms               f   ON f.id   = cfe.farm_id
LEFT JOIN seasons             s   ON s.id   = cfe.season_id
LEFT JOIN cost_centers        cc  ON cc.id  = cfe.cost_center_id
LEFT JOIN financial_categories fc ON fc.id  = cfe.category_id;

-- ── View: saldo diário por conta (para o gráfico de fluxo) ───
CREATE VIEW daily_balance AS
SELECT
  bank_account_id,
  tenant_id,
  entry_date,
  SUM(CASE WHEN direction = 'in'  THEN amount ELSE 0 END) AS total_in,
  SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END) AS total_out,
  SUM(CASE WHEN direction = 'in'  THEN amount ELSE -amount END) AS net
FROM cash_flow_entries
GROUP BY bank_account_id, tenant_id, entry_date;

-- ── Trigger: quando contas a pagar são pagas, lança no fluxo ─
CREATE OR REPLACE FUNCTION sync_payable_to_cashflow()
RETURNS TRIGGER AS $$
BEGIN
  -- Só age quando payment_date é definido pela primeira vez ou muda
  IF NEW.payment_date IS NOT NULL AND NEW.status = 'paid'
     AND (OLD.payment_date IS NULL OR OLD.status != 'paid') THEN
    INSERT INTO cash_flow_entries (
      tenant_id, bank_account_id, payable_id,
      direction, origin, description,
      amount, entry_date, reconcile_status, created_by
    ) VALUES (
      NEW.tenant_id, NEW.bank_account_id, NEW.id,
      'out', 'payable', NEW.description,
      NEW.amount_paid, NEW.payment_date, 'matched', NEW.created_by
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payable_cashflow
  AFTER UPDATE ON accounts_payable
  FOR EACH ROW EXECUTE FUNCTION sync_payable_to_cashflow();

-- ── Trigger: quando contas a receber são recebidas ────────────
CREATE OR REPLACE FUNCTION sync_receivable_to_cashflow()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.receipt_date IS NOT NULL AND NEW.status = 'paid'
     AND (OLD.receipt_date IS NULL OR OLD.status != 'paid') THEN
    INSERT INTO cash_flow_entries (
      tenant_id, bank_account_id, receivable_id,
      direction, origin, description,
      amount, entry_date, reconcile_status, created_by
    ) VALUES (
      NEW.tenant_id, NEW.bank_account_id, NEW.id,
      'in', 'receivable', NEW.description,
      NEW.amount_received, NEW.receipt_date, 'matched', NEW.created_by
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receivable_cashflow
  AFTER UPDATE ON accounts_receivable
  FOR EACH ROW EXECUTE FUNCTION sync_receivable_to_cashflow();

-- ============================================================
-- Vetra — Centros de Custo / Lucro
-- A tabela cost_centers já existe — apenas enriquecemos
-- ============================================================

-- Adiciona colunas faltantes (safe: IF NOT EXISTS)
ALTER TABLE cost_centers
  ADD COLUMN IF NOT EXISTS description   TEXT,
  ADD COLUMN IF NOT EXISTS budget        NUMERIC(14,2),   -- orçamento anual
  ADD COLUMN IF NOT EXISTS budget_year   SMALLINT,        -- ano do orçamento
  ADD COLUMN IF NOT EXISTS color         VARCHAR(7),      -- cor para UI
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_updated_at ON cost_centers;
CREATE TRIGGER trg_cc_updated_at
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── View: centros com totais de payable/receivable ────────────────────────
CREATE OR REPLACE VIEW cost_center_summary AS
SELECT
  cc.*,
  f.name AS farm_name,
  p.name AS parent_name,
  -- Total de despesas lançadas (contas a pagar)
  COALESCE((
    SELECT SUM(ap.amount)
    FROM accounts_payable ap
    WHERE ap.cost_center_id = cc.id
      AND ap.status != 'cancelled'
  ), 0) AS total_payable,
  -- Total pago
  COALESCE((
    SELECT SUM(ap.amount_paid)
    FROM accounts_payable ap
    WHERE ap.cost_center_id = cc.id
      AND ap.status = 'paid'
  ), 0) AS total_paid,
  -- Total de receitas (contas a receber)
  COALESCE((
    SELECT SUM(ar.amount)
    FROM accounts_receivable ar
    WHERE ar.cost_center_id = cc.id
      AND ar.status != 'cancelled'
  ), 0) AS total_receivable,
  -- Total recebido
  COALESCE((
    SELECT SUM(ar.amount_received)
    FROM accounts_receivable ar
    WHERE ar.cost_center_id = cc.id
      AND ar.status = 'paid'
  ), 0) AS total_received,
  -- Saldo (receitas - despesas pagas)
  COALESCE((
    SELECT SUM(ar.amount_received)
    FROM accounts_receivable ar
    WHERE ar.cost_center_id = cc.id AND ar.status = 'paid'
  ), 0) -
  COALESCE((
    SELECT SUM(ap.amount_paid)
    FROM accounts_payable ap
    WHERE ap.cost_center_id = cc.id AND ap.status = 'paid'
  ), 0) AS balance,
  -- Utilização do orçamento (%)
  CASE
    WHEN cc.budget > 0 THEN ROUND(
      COALESCE((
        SELECT SUM(ap.amount_paid)
        FROM accounts_payable ap
        WHERE ap.cost_center_id = cc.id AND ap.status = 'paid'
      ), 0) / cc.budget * 100, 1
    )
    ELSE NULL
  END AS budget_used_pct
FROM cost_centers cc
LEFT JOIN farms        f  ON f.id  = cc.farm_id
LEFT JOIN cost_centers p  ON p.id  = cc.parent_id;

-- Seeds de centros padrão para agronegócio (inserção condicional)
-- (serão inseridos via API com tenant_id correto — apenas estrutura de exemplo)

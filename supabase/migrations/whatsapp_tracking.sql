-- ============================================================
-- Vetra — Tracking de envio do PO via WhatsApp
-- Adiciona colunas em purchase_orders
-- ============================================================

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_status     VARCHAR(20),   -- sent, delivered, read, failed
  ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(100),  -- ID retornado pela Meta API
  ADD COLUMN IF NOT EXISTS po_pdf_url          TEXT;          -- URL do PDF gerado (storage)

-- Atualiza a view summary para incluir os novos campos
CREATE OR REPLACE VIEW purchase_orders_summary AS
SELECT
  po.*,
  p.name         AS partner_name,
  p.document     AS partner_document,
  p.phone        AS partner_phone,       -- telefone do parceiro (para WhatsApp)
  p.email        AS partner_email,
  f.name         AS farm_name,
  s.name         AS season_name,
  cc.name        AS cost_center_name,
  (SELECT COUNT(*) FROM purchase_deliveries pd WHERE pd.order_id = po.id)     AS delivery_count,
  (SELECT COUNT(*) FROM purchase_deliveries pd WHERE pd.order_id = po.id
     AND pd.status = 'received')                                               AS deliveries_received,
  CASE WHEN po.expected_delivery < CURRENT_DATE
    AND po.status NOT IN ('received','cancelled')
    THEN CURRENT_DATE - po.expected_delivery ELSE NULL
  END AS days_late,
  (SELECT COUNT(*) FROM purchase_approvals pa WHERE pa.order_id = po.id)      AS approval_count
FROM purchase_orders po
JOIN partners      p  ON p.id  = po.partner_id
LEFT JOIN farms    f  ON f.id  = po.farm_id
LEFT JOIN seasons  s  ON s.id  = po.season_id
LEFT JOIN cost_centers cc ON cc.id = po.cost_center_id;

-- Garante coluna phone na tabela partners (se não existir)
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

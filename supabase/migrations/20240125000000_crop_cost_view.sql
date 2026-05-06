-- ============================================================
-- Vetra — Custo de Produção por Safra
-- View analítica — sem novas tabelas
-- ============================================================

CREATE OR REPLACE VIEW crop_cost_by_season AS
SELECT
  s.id                      AS season_id,
  s.tenant_id,
  s.farm_id,
  f.name                    AS farm_name,
  s.name                    AS season_name,
  s.code                    AS season_code,
  s.crop,
  s.variety,
  s.status,
  s.planting_start,
  s.harvest_end,
  s.planted_area_ha,
  s.harvested_area_ha,
  s.actual_yield_sc_ha,
  s.actual_production_sc,
  s.price_per_unit,
  s.actual_revenue,

  -- ── Custos por origem ──────────────────────────────────────

  -- Atividades de campo (mão de obra + maquinário + insumos internos)
  COALESCE((
    SELECT SUM(a.total_cost)
    FROM activities a
    WHERE a.season_id = s.id AND a.status != 'cancelled'
  ), 0) AS cost_activities,

  -- Fitossanitários
  COALESCE((
    SELECT SUM(pa.total_cost)
    FROM phytosanitary_applications pa
    WHERE pa.season_id = s.id
  ), 0) AS cost_phytosanitary,

  -- Combustível
  COALESCE((
    SELECT SUM(fs.total_cost)
    FROM fuel_supplies fs
    WHERE fs.season_id = s.id
  ), 0) AS cost_fuel,

  -- Contas a pagar vinculadas à safra
  COALESCE((
    SELECT SUM(ap.amount_paid)
    FROM accounts_payable ap
    WHERE ap.season_id = s.id AND ap.status = 'paid'
  ), 0) AS cost_payable,

  -- Custo manual registrado na safra (campo actual_cost_ha × área)
  COALESCE(s.actual_cost_ha * s.planted_area_ha, 0) AS cost_manual,

  -- ── Custo total consolidado ────────────────────────────────
  COALESCE((
    SELECT SUM(a.total_cost) FROM activities a
    WHERE a.season_id = s.id AND a.status != 'cancelled'
  ), 0) +
  COALESCE((
    SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa
    WHERE pa.season_id = s.id
  ), 0) +
  COALESCE((
    SELECT SUM(fs.total_cost) FROM fuel_supplies fs
    WHERE fs.season_id = s.id
  ), 0) +
  COALESCE((
    SELECT SUM(ap.amount_paid) FROM accounts_payable ap
    WHERE ap.season_id = s.id AND ap.status = 'paid'
  ), 0) AS total_cost,

  -- ── Métricas derivadas ────────────────────────────────────
  -- Custo por hectare
  CASE WHEN s.planted_area_ha > 0 THEN ROUND(
    (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
     COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
     COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
     COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0)
    ) / s.planted_area_ha, 2)
  ELSE NULL END AS cost_per_ha,

  -- Custo por saca
  CASE WHEN s.actual_production_sc > 0 THEN ROUND(
    (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
     COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
     COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
     COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0)
    ) / s.actual_production_sc, 2)
  ELSE NULL END AS cost_per_sc,

  -- Margem bruta (receita - custo total)
  CASE WHEN s.actual_revenue IS NOT NULL THEN
    s.actual_revenue -
    (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
     COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
     COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
     COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0))
  ELSE NULL END AS gross_margin,

  -- Margem % sobre receita
  CASE WHEN s.actual_revenue > 0 THEN ROUND(
    (s.actual_revenue -
     (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
      COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
      COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
      COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0))
    ) / s.actual_revenue * 100, 1)
  ELSE NULL END AS margin_pct,

  -- Ponto de equilíbrio (sacas necessárias para cobrir o custo)
  CASE WHEN s.price_per_unit > 0 AND s.planted_area_ha > 0 THEN ROUND(
    (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
     COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
     COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
     COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0)
    ) / s.price_per_unit, 1)
  ELSE NULL END AS breakeven_sc,

  -- Breakeven sc/ha
  CASE WHEN s.price_per_unit > 0 AND s.planted_area_ha > 0 THEN ROUND(
    (COALESCE((SELECT SUM(a.total_cost) FROM activities a WHERE a.season_id = s.id AND a.status != 'cancelled'), 0) +
     COALESCE((SELECT SUM(pa.total_cost) FROM phytosanitary_applications pa WHERE pa.season_id = s.id), 0) +
     COALESCE((SELECT SUM(fs.total_cost) FROM fuel_supplies fs WHERE fs.season_id = s.id), 0) +
     COALESCE((SELECT SUM(ap.amount_paid) FROM accounts_payable ap WHERE ap.season_id = s.id AND ap.status = 'paid'), 0)
    ) / s.price_per_unit / s.planted_area_ha, 2)
  ELSE NULL END AS breakeven_sc_ha,

  -- Contagens de registros
  (SELECT COUNT(*) FROM activities a WHERE a.season_id = s.id) AS activity_count,
  (SELECT COUNT(*) FROM phytosanitary_applications pa WHERE pa.season_id = s.id) AS spray_count

FROM seasons s
JOIN farms f ON f.id = s.farm_id;
